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
  expect(data.matches).toEqual([{ filePath: "a.ts", line: 2, preview: "> 2: const needle = 1;", preview_truncated: false, read_source_code: {repo:"fixture",filePath:"a.ts",entity:"needle"} }]);
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

it("returns usable compact pointers, supports an exact filename, and reads the declaration rather than an earlier callsite", async () => {
  await writeFile(join(root,"a.ts"), 'function before() {\n  needle("caller");\n}\nexport function needle(value: string) {\n  return value;\n}\n');
  const data = await search({pathPrefix:"a.ts"});
  expect(data.filesScanned).toBe(1);
  expect(data.matches).toHaveLength(2);
  expect(data.matches[0].read_source_code).toEqual({repo:"fixture",filePath:"a.ts",startLine:2,endLine:2});
  expect(data.matches[1].read_source_code).toEqual({repo:"fixture",filePath:"a.ts",entity:"needle"});
  for (const hit of data.matches) {
    const result = await client.callTool({name:"read_source_code",arguments:hit.read_source_code});
    const text = JSON.stringify(result.content);
    expect(text).toContain(hit.line === 2 ? "caller" : "return value");
  }
});
it("missing paths and sibling-prefix escapes cannot masquerade as no matches", async () => {
  for (const pathPrefix of ["missing.ts",root+"-outside"]) {
    const response = await client.callTool({name:"search_source_code",arguments:{repo:"fixture",query:"needle",pathPrefix}});
    expect(JSON.parse((response.content as Array<{text:string}>)[0].text).success).toBe(false);
  }
});
it("keeps default hints compact while explicit context previews remain available", async () => {
  await writeFile(join(root,"a.ts"), "before\nneedle " + "x".repeat(900) + "\nafter");
  const compact = await search(), preview = await search({contextLines:1});
  expect(Buffer.byteLength(compact.matches[0].preview)).toBeLessThanOrEqual(240);
  expect(compact.matches[0].preview_truncated).toBe(true);
  expect(preview.matches[0].preview).toContain("before");
  expect(preview.matches[0].preview).toContain("after");
  expect(preview.matches[0].read_source_code).toMatchObject({startLine:1,endLine:3});
});

it("discovery shares scanner gitignore exclusions and negations",async()=>{
 await writeFile(join(root,".gitignore"),"*.ts\n!keep.ts\n");
 await writeFile(join(root,"ignored.ts"),"needle");await writeFile(join(root,"keep.ts"),"needle");
 const data=await search();expect(data.filesScanned).toBe(1);expect(data.matches.map((hit:any)=>hit.filePath)).toEqual(["keep.ts"]);
});
