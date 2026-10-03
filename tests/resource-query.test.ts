import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, cp, rm, writeFile, readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { setDataDirOverride } from "../src/utils/paths.js";
import { setDataDirResolver, invalidateCache } from "../src/utils/cache.js";
import { registerResources } from "../src/resources/register.js";
import { registerCognitiveResources, registerCognitiveTools } from "../src/cognitive/register.js";
import { registerDisciplineResource } from "../src/discipline/register.js";
import { registerApiSurfaceTools } from "../src/tools/api-surface.js";
import { registerQueryResourceTool } from "../src/tools/query-resource.js";
import { clearResourceBackendsForTest, listedResourceUris, queryResourcePage, queryResourceLegacy } from "../src/resources/resolver.js";
import { commitGraphWrites } from "../src/graph/publication.js";
import { releaseGraphWriter } from "../src/graph/writer-lease.js";
import { formatJsonToolOutput } from "../src/utils/tool-output.js";
import { config } from "../src/config/config.js";

let directory: string, server: McpServer;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "dg-resource-query-"));
  await cp("templates/default", directory, { recursive: true });
  setDataDirOverride(directory); setDataDirResolver(() => directory); invalidateCache();
  server = new McpServer({ name: "resource-contract-fixture", version: "1" });
  registerResources(server); registerCognitiveResources(server); registerDisciplineResource(server);
  registerApiSurfaceTools(server); registerQueryResourceTool(server);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await server.close(); clearResourceBackendsForTest(); await releaseGraphWriter(directory);
  setDataDirOverride(null); invalidateCache(); await rm(directory, { recursive: true, force: true });
});
const put = (file: string, value: unknown) => writeFile(join(directory, file), JSON.stringify(value));
const collect = async (input: { uri: string; limit?: number; max_bytes?: number; filter?: Record<string, unknown> }) => {
  const records: unknown[] = []; let cursor: string | undefined;
  do {
    const page = await queryResourcePage({ ...input, ...(cursor ? { cursor } : {}) });
    expect(page.count).toBe(page.records.length); expect(page.count! + page.omitted_count!).toBe(page.total);
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(input.max_bytes ?? 8192);
    records.push(...page.records); cursor = page.continuation ?? undefined;
  } while (cursor);
  return records;
};

describe("shared resource query authority", () => {
  it("defines query behavior for every baseline URI and separates runtime/project capabilities", async () => {
    const expected = ["system://overview", "system://features", "system://workflows", "system://data-model", "system://datastores", "system://capabilities", "system://capability-entities", "system://index", "ops://metrics", "system://metrics", "system://plugins", "system://webhooks", "dream://graph", "dream://candidates", "dream://validated", "dream://status", "dream://tensions", "dream://history", "dream://adrs", "dream://ui-registry", "dream://threats", "dream://archetypes", "dream://metacognition", "dream://events", "dream://story", "dream://schedules", "dream://schedule-history", "dream://context", "dream://lucid", "discipline://manifest", "ops://api-surface"].sort();
    expect(listedResourceUris()).toEqual(expected);
    const signatures = async (relative = ""): Promise<unknown[]> => {
      const entries = await readdir(join(directory, relative), { withFileTypes: true });
      return Promise.all(entries.sort((a, b) => a.name.localeCompare(b.name)).map(async entry => {
        const file = join(relative, entry.name);
        return entry.isDirectory() ? [file, await signatures(file)] : [file, createHash("sha256").update(await readFile(join(directory, file))).digest("hex")];
      }));
    };
    const before = await signatures();
    for (const uri of expected) {
      const page = await queryResourcePage({ uri, max_bytes: 65536 });
      expect(page.uri, uri).toBe(uri); expect(page.schema).toBe("dreamgraph.resource_result.v1");
    }
    expect(await signatures()).toEqual(before);
    await put("capabilities.json", [{ id: "fixture-graph-capability", name: "Project capability" }]);
    const runtime = await queryResourcePage({ uri: "system://capabilities" });
    expect(runtime.records.find((r: any) => r.key === "server")).toMatchObject({ payload: { version: config.server.version } });
    const graph = await queryResourcePage({ uri: "system://capability-entities" });
    expect(graph.records[0]).toMatchObject({ identity: { kind: "capability", id: "fixture-graph-capability" } });
  });

  it("unions pages without missing middle records, duplicates or byte overflow", async () => {
    const rows = Array.from({ length: 83 }, (_, id) => ({ id: `feature:${id}`, description: "å 漢字 " + "evidence ".repeat(30) }));
    await put("features.json", rows);
    const records = await collect({ uri: "system://features", limit: 7, max_bytes: 4096 });
    expect(records.map((r: any) => r.payload)).toEqual(rows);
  });

  it("filters documented wrapper arrays and returns successful empty matches", async () => {
    await put("adr_log.json", { metadata: {}, decisions: [{ id: "ADR-one", status: "accepted" }, { id: "ADR-two", status: "proposed" }] });
    expect((await collect({ uri: "dream://adrs", filter: { status: "accepted" } })).map((r: any) => r.payload.id)).toEqual(["ADR-one"]);
    const empty = await queryResourcePage({ uri: "dream://adrs", filter: { id: "absent" } });
    expect(empty).toMatchObject({ records: [], count: 0, total: 0, continuation: null, state: { availability: "available", completeness: "complete" } });
  });

  it("pages complete history and actual scheduler executions rather than invented backing files", async () => {
    await put("dream_history.json", { metadata: {}, cycles: Array.from({ length: 62 }, (_, cycle) => ({ cycle, action: "dream" })) });
    const history = await collect({ uri: "dream://history", limit: 9 });
    expect(history.filter((r: any) => r.collection === "cycles")).toHaveLength(62);
    await put("schedules.json", { schedules: [], executions: [{ id: "execution:1", schedule_id: "schedule:1" }] });
    expect(await collect({ uri: "dream://schedule-history" })).toMatchObject([{ payload: { id: "execution:1" } }]);
  });

  it("rejects revision/scope/filter changes and tampered cursors", async () => {
    await put("features.json", [{ id: "a" }, { id: "b" }]);
    const first = await queryResourcePage({ uri: "system://features", limit: 1 });
    const cursor = first.continuation!;
    await expect(queryResourcePage({ uri: "system://workflows", cursor })).rejects.toThrow("another resource");
    await expect(queryResourcePage({ uri: "system://features", filter: { id: "a" }, cursor })).rejects.toThrow("another resource");
    await expect(queryResourcePage({ uri: "system://features", cursor: cursor.slice(0, -8) + "tampered" })).rejects.toThrow("invalid");
    await commitGraphWrites({ writes: [{ file: "features.json", content: '[{"id":"a"},{"id":"b"},{"id":"c"}]' }] });
    await expect(queryResourcePage({ uri: "system://features", cursor })).rejects.toThrow("different revisions");
  });

  it("binds cursors to the physical instance and expires them", async () => {
    await put("features.json", [{ id: "a" }, { id: "b" }]);
    const cursor = (await queryResourcePage({ uri: "system://features", limit: 1 })).continuation!;
    const other = await mkdtemp(join(tmpdir(), "dg-other-resource-"));
    const otherServer = new McpServer({ name: "other-resource-fixture", version: "1" });
    try {
      await cp(directory, other, { recursive: true }); setDataDirOverride(other);
      registerResources(otherServer);
      await expect(queryResourcePage({ uri: "system://features", cursor })).rejects.toThrow("another resource, instance");
      clearResourceBackendsForTest();
    } finally { await otherServer.close(); setDataDirOverride(directory); await rm(other, { recursive: true, force: true }); }
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31 * 60_000);
    await expect(queryResourcePage({ uri: "system://features", cursor })).rejects.toThrow("expired");
  });

  it("retains candidate uncertainty and refuses newer raw store schemas", async () => {
    await put("candidate_edges.json", { results: [{ dream_id: "orphan", dream_type: "edge" }] });
    const candidate = await queryResourcePage({ uri: "dream://candidates" });
    expect(candidate.state).toMatchObject({ completeness: "partial", reasons: [expect.objectContaining({ code: "CANDIDATE_ENDPOINTS_UNKNOWN" })] });
    expect(candidate.records[0]).toMatchObject({ identity: { id: "edge:orphan" }, payload: { dream_id: "orphan", dream_type: "edge" } });
    await put("dream_history.json", { metadata: { schema_version: "99.0.0" }, cycles: [] });
    expect(await queryResourcePage({ uri: "dream://history" })).toMatchObject({ total: null, state: { availability: "unavailable", reasons: [expect.objectContaining({ code: "UNSUPPORTED_STORE_SCHEMA" })] } });
  });

  it("never skips or clips an oversized record or treats malformed data as empty", async () => {
    await put("features.json", [{ id: "large", description: "x".repeat(10000) }, { id: "after" }]);
    await expect(queryResourcePage({ uri: "system://features", max_bytes: 4096 })).rejects.toThrow("next whole record");
    await expect(queryResourceLegacy({ uri: "system://features" })).rejects.toThrow("bounded whole JSON");
    await writeFile(join(directory, "features.json"), "{broken");
    expect((await queryResourcePage({ uri: "system://features" })).state).toMatchObject({ availability: "unavailable", completeness: "partial" });
    expect(JSON.parse(formatJsonToolOutput({ payload: "x".repeat(20000) }))).toMatchObject({ success: false, error: { code: "OUTPUT_LIMIT_EXCEEDED" } });
  });

  it("gives MCP resource and tool reads the same meaning and sets the MCP error signal", async () => {
    const client = new Client({ name: "resource-client", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a); await client.connect(b);
    try {
      const read = await client.readResource({ uri: "system://capabilities" });
      const resource = JSON.parse((read.contents[0] as { text: string }).text);
      const queried = await client.callTool({ name: "query_resource", arguments: { uri: "system://capabilities" } });
      const tool = JSON.parse((queried.content as Array<{ text: string }>)[0].text);
      expect(tool.data.records).toEqual(resource.records);
      expect(tool.data.content_revision).toBe(resource.content_revision);
      expect((await client.callTool({ name: "query_resource", arguments: { uri: "invalid://unknown" } })).isError).toBe(true);
      const legacy = await client.callTool({ name: "query_resource", arguments: { uri: "system://capabilities", contract_version: "legacy", max_bytes: 65536 } });
      expect(JSON.parse((legacy.content as Array<{ text: string }>)[0].text).data.server.version).toBe(config.server.version);
    } finally { await client.close(); }
  });

  it("delivers one bounded canonical context pack through MCP tools and the context resource", async () => {
    await put("capabilities.json", [{ id: "dashboard", name: "Dashboard", description: "Engine controls" }]);
    registerCognitiveTools(server);
    const client = new Client({ name: "context-client", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a); await client.connect(b);
    try {
      const result = await client.callTool({ name: "graph_rag_retrieve", arguments: { query: "dashboard", token_budget: 500, depth: 0 } });
      const decoded = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(result.isError).toBe(false);
      expect(decoded.data.schema).toBe("dreamgraph.context_pack.v1");
      expect(decoded.data.context_text).toContain("Engine controls");
      expect(decoded.data.records).toHaveLength(1);
      expect(decoded.data.token_count).toBeLessThanOrEqual(500);
      expect(result.structuredContent).toEqual(decoded);
      expect(decoded.data.context_pack).toBeUndefined(); // Text is never duplicated as a compatibility alias in the wire representation.
      const resource = await client.readResource({ uri: "dream://context" });
      const page = JSON.parse((resource.contents[0] as { text: string }).text);
      expect(page.records[0].payload.schema).toBe("dreamgraph.context_pack.v1");
      expect(page.records[0].payload.records.some((record: { identity: { kind: string } | null }) => record.identity?.kind === "capability")).toBe(true);
      const error = await client.callTool({ name: "graph_rag_retrieve", arguments: { query: "dashboard", mandatory_identities: [{ instance_id: "other", kind: "capability", id: "dashboard" }] } });
      expect(error.isError).toBe(true);
    } finally { await client.close(); }
  });
});
