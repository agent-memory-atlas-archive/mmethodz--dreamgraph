import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { config } from "../src/config/config.js";
import { registerCodeSensesTools } from "../src/tools/code-senses.js";

let root: string, server: McpServer, client: Client;
const repos = { ...config.repos };
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "dg-search-bounds-"));
  config.repos = { fixture: root };
  server = new McpServer({ name: "search-fixture", version: "1" });
  registerCodeSensesTools(server);
  client = new Client({ name: "search-client", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
});
afterEach(async () => {
  await client.close(); await server.close();
  config.repos = { ...repos };
  await rm(root, { recursive: true, force: true });
});
async function search(args: Record<string, unknown> = {}) {
  const response = await client.callTool({ name: "search_source_code",
    arguments: { repo: "fixture", query: "needle", contextLines: 0, ...args } });
  const body = JSON.parse((response.content as Array<{ text: string }>)[0].text);
  expect(body.success).toBe(true);
  return body.data;
}
it("preserves ordinary hits and exact source positions without unnecessary clipping", async () => {
  await writeFile(join(root, "a.ts"), "before\nconst needle = 1;\nafter\n");
  const data = await search();
  expect(data.matches).toEqual([{ filePath: "a.ts", line: 2, preview: "> 2: const needle = 1;", preview_truncated: false }]);
  expect(data.truncated).toBe(false);
  expect(data.notice).toBeUndefined();
});
it("bounds multibyte/minified previews and whole match payload independently of maxResults", async () => {
  await writeFile(join(root, "a.ts"), Array.from({ length: 100 }, () => "needle " + "😀".repeat(5000)).join("\n"));
  const data = await search({ maxResults: 500, contextLines: 5 });
  expect(data.matchCount).toBeGreaterThan(0);
  expect(data.matchCount).toBeLessThan(100);
  expect(Buffer.byteLength(JSON.stringify(data.matches))).toBeLessThanOrEqual(24 * 1024);
  expect(data.truncated).toBe(true);
  expect(data.output_byte_limit_reached).toBe(true);
  expect(data.notice).toContain("read_source_code");
  for (const hit of data.matches) {
    expect(hit.preview_truncated).toBe(true);
    expect(Buffer.byteLength(hit.preview)).toBeLessThanOrEqual(2048);
    expect(hit.preview).not.toContain("�");
    expect(hit.filePath).toBe("a.ts");
    expect(hit.line).toBeGreaterThan(0);
  }
});
it("still honors the requested result count", async () => {
  await writeFile(join(root, "a.ts"), "needle\nneedle\nneedle");
  const data = await search({ maxResults: 1 });
  expect(data.matchCount).toBe(1);
  expect(data.truncated).toBe(true);
  expect(data.output_byte_limit_reached).toBe(false);
});
