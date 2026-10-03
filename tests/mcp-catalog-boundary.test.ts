/** Core boundary conformance uses handler doubles; it does not qualify every real owner effect. */
import { expect, it, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectCoreRegistration, coreCatalog } from "../src/server/core-catalog.js";
import { TOOL_CLASSIFICATIONS } from "../src/discipline/manifest.js";
import { invokeToolBoundary, normalizeToolResult } from "../src/server/tool-boundary.js";
import { coreToolPolicy } from "../src/server/tool-policy.js";
import { serializeMcpResult, boundedMachineResult } from "../src/utils/mcp-result.js";
import { withSessionContext } from "../src/server/session-context.js";
import { startSession, getActiveSession } from "../src/discipline/session.js";
import { listAllMcpTools, architectMcpHeaders } from "../src/cli/utils/mcp-session.js";
import { getDataDir, setDataDirOverride } from "../src/utils/paths.js";
import { releaseGraphWriter } from "../src/graph/writer-lease.js";
let boundaryDirectory:string,previousDirectory:string;
beforeEach(async()=>{previousDirectory=getDataDir();boundaryDirectory=await mkdtemp(join(tmpdir(),"dg-catalog-boundary-"));setDataDirOverride(boundaryDirectory);});
afterEach(async()=>{await releaseGraphWriter(boundaryDirectory);setDataDirOverride(previousDirectory);await rm(boundaryDirectory,{recursive:true,force:true});});

it("collects the real registrars once with exact discipline parity and schemas", () => {
  const registered = collectCoreRegistration(), catalog = coreCatalog();
  expect(catalog.tools.length).toBe(93); expect(catalog.resources.length).toBe(31);
  expect(TOOL_CLASSIFICATIONS.length).toBe(94);
  expect(registered.tools.map(t => t.name)).toEqual(catalog.tools.map(t => t.name));
  for (const tool of catalog.tools) {
    expect(tool.inputSchema.type).toBe("object");
    expect(tool.classification.tool_name).toBe(tool.name);
    expect(tool.policy.read_only).toBe(["graph_read", "external_read", "session_read"].includes(tool.policy.effect));
  }
});
for (const tool of collectCoreRegistration().tools) {
  it(`${tool.name}: original owner schema rejects undeclared fields before effects`, async () => {
    let effects = 0;
    const result = await invokeToolBoundary({ name: tool.name, shape: tool.shape, args: { __undeclared: true }, handler: () => { effects++; return {}; } });
    expect(result.structuredContent?.error).toMatchObject({ code: "INVALID_INPUT" }); expect(effects).toBe(0);
  });
  it(`${tool.name}: shared result/dependency/version/cancellation boundary`, async () => {
    let calls = 0;
    const owner = { content: [{ type: "text" as const, text: "literal source" }, { type: "image" as const, mimeType: "image/png", data: "AA==" }],
      structuredContent: { receipt: { operation_id: "op", revision: 7 }, complete: false, continuation: "signed-next" }, _meta: { owner_version: 8 } };
    const invoke = (extra = {}) => invokeToolBoundary({ name: tool.name, shape: { fixture: z.string() }, args: { fixture: "bounded" }, extra,
      handler: () => { calls++; return owner; } });
    const result = await invoke(); expect(result.content).toEqual(owner.content); expect(result.structuredContent).toEqual(owner.structuredContent);
    expect(result._meta?.owner_version).toBe(8); expect(JSON.parse(serializeMcpResult(result)).structuredContent).toEqual(owner.structuredContent);
    expect((await invoke({ _meta: { dreamgraph: { contract_version: 999 } } })).structuredContent?.error).toMatchObject({ code: "CONTRACT_VERSION_UNSUPPORTED" });
    expect((await invoke({ signal: AbortSignal.abort() })).structuredContent?.error).toMatchObject({ code: "REQUEST_CANCELLED" }); expect(calls).toBe(1);
    const failure = await invokeToolBoundary({ name: tool.name, shape: {}, args: {}, handler: () => { throw new Error("offline dependency failed"); } });
    expect(failure.isError).toBe(true); expect(failure.structuredContent?.error).toMatchObject({ code: "OWNER_FAILURE" });
  });
}
it("blocks mutations/cognition in the wrong phase and requires an applicable approved plan", async () => {
  const root = await mkdtemp(join(tmpdir(), "dg-mcp-policy-"));
  try {
    await withSessionContext({ principal: "fixture", session_id: "owner", directory: root, environment: {}, continuation_key: "test", channel: "mcp" }, async () => {
      await startSession({ type: "modification", description: "boundary", target_scope: [root] });
      let ran = false;
      const call = (name: string) => invokeToolBoundary({ name, shape: {}, args: {}, handler: () => { ran = true; return { content: [] }; } });
      expect((await call("edit_file")).isError).toBe(true); expect((await call("dream_cycle")).isError).toBe(true); expect(ran).toBe(false);
      getActiveSession()!.current_phase = "execute";
      expect((await call("edit_file")).structuredContent?.error).toMatchObject({ code: "APPROVED_PLAN_REQUIRED" }); expect(ran).toBe(false);
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});
it("keeps oversized structured output whole or explicitly omitted; never clips JSON", () => {
  const raw = normalizeToolResult("query_resource", { content: [{ type: "text", text: "{}" }], structuredContent: { revision: 2, records: [{ source: "x".repeat(20000) }] } });
  const text = serializeMcpResult(raw), bounded = boundedMachineResult(text, 4000)!;
  expect(JSON.parse(bounded.content)).toMatchObject({ omitted: true, original_chars: text.length });
  expect(bounded.content).not.toContain("x".repeat(500));
  expect(boundedMachineResult(text, text.length)!.content).toBe(text);
});
it("discovers all pages with annotations and rejects cursor cycles/duplicates", async () => {
  const tool = (name: string) => ({ name, inputSchema: { type: "object" as const }, _meta: { marker: "keep" } });
  const seen: unknown[] = [];
  const client = { listTools: async (params?: any) => { seen.push(params); return params?.cursor ? { tools: [tool("b")] } : { tools: [tool("a")], nextCursor: "next" }; } };
  expect((await listAllMcpTools(client as any)).map(t => [t.name, t._meta])).toEqual([["a", { marker: "keep" }], ["b", { marker: "keep" }]]);
  expect(seen).toEqual([undefined, { cursor: "next" }]);
  await expect(listAllMcpTools({ listTools: async () => ({ tools: [], nextCursor: "cycle" }) } as any)).rejects.toThrow("MCP_DISCOVERY_CURSOR_CYCLE");
  await expect(listAllMcpTools({ listTools: async () => ({ tools: [tool("a")], nextCursor: "next" }) } as any)).rejects.toThrow("MCP_DISCOVERY_DUPLICATE_TOOL");
  expect(architectMcpHeaders({ headers: { cookie: "other=no; dg_session=private", authorization: "do not forward" } } as any)).toEqual({});
  expect(architectMcpHeaders({ headers: { "x-dreamgraph-session": "private", authorization: "do not forward" } } as any)).toEqual({ "X-DreamGraph-Session": "private" });
});
it("source/database scans retain analysis discipline phases but require effect authority", () => {
  for (const name of ["scan_project", "scan_database"]) {
    expect(TOOL_CLASSIFICATIONS.find(tool => tool.tool_name === name)?.tool_class).toBe("analysis");
    expect(coreToolPolicy(name)).toMatchObject({ effect: "graph_write", read_only: false });
  }
});
