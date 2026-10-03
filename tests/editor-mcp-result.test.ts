/** Actual editor MCP transport; no VS Code runtime, paid model or termination inference. */
import { expect, it } from "vitest";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { McpClient } from "../extensions/vscode/src/mcp-client.js";
import { ToolOwnerResultError, stringifyToolFailure } from "../extensions/vscode/src/chat-panel/helpers.js";
import { boundMachineResult } from "../packages/token-economy/src/machine-result.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function fixture(options: { bearer?: string; initializeGate?: ReturnType<typeof deferred> } = {}) {
  const upstream = new Server({ name: "editor-owner-fixture", version: "1" }, { capabilities: { tools: {} } });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID });
  const literal = {
    content: [{ type: "text" as const, text: JSON.stringify({
      receipt: { schema: "dreamgraph.commit_receipt.v1", operation_id: "committed-before-error", revision: 7 },
      error: { code: "LATER_OWNER_FAILURE" }, source: "🌿 é exact source",
    }) }, { type: "image" as const, mimeType: "image/png", data: "AA==" }],
    structuredContent: { complete: false, continuation: "next", obligation_id: "owned-debt" },
    _meta: { owner: "fixture", revision: 7 }, isError: true,
  };
  const entered = deferred(), cancelled = deferred(), initializing = deferred();
  let initializations = 0, calls = 0, deny = false;
  upstream.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    calls++;
    if (request.params.name === "wait") {
      entered.resolve();
      await new Promise<void>(done => extra.signal.addEventListener("abort", () => { cancelled.resolve(); done(); }, { once: true }));
    }
    return literal;
  });
  await upstream.connect(transport);
  const http = createServer(async (req, res) => {
    if (deny || (options.bearer && req.headers["x-dreamgraph-session"] !== options.bearer)) {
      res.writeHead(403); res.end(); return;
    }
    if (req.method === "POST" && !req.headers["mcp-session-id"]) {
      initializations++; initializing.resolve(); await options.initializeGate?.promise;
    }
    try { await transport.handleRequest(req, res); }
    catch { if (!res.headersSent) res.writeHead(500); res.end(); }
  });
  await new Promise<void>(done => http.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
  const client = new McpClient(base, options.bearer ? { sessionBearer: options.bearer } : undefined);
  return { client, literal, base, entered, cancelled, initializing,
    counts: () => ({ initializations, calls }), deny: (value: boolean) => { deny = value; },
    close: async () => {
      options.initializeGate?.resolve(); await client.disconnect(); await upstream.close();
      http.closeAllConnections(); await new Promise<void>(done => http.close(() => done()));
    } };
}

it("the actual editor agent port retains complete error/media/meta/receipt results; UI projection stays compatible", async () => {
  const owner = await fixture({ bearer: "fixture-worker" });
  try {
    await owner.client.connect();
    const result = await owner.client.callToolRaw("effect", {});
    expect(result).toEqual(owner.literal);
    const failure = new ToolOwnerResultError(result);
    expect(JSON.parse(stringifyToolFailure(failure, result, true))).toEqual(owner.literal);
    const hostFailure = JSON.parse(stringifyToolFailure(new Error("ANCHORS_EXCEED_BUDGET"), result, true));
    expect(hostFailure).toMatchObject({ owner_result: owner.literal, host_error: { message: "ANCHORS_EXCEED_BUDGET" } });
    expect(hostFailure.effect_status).toContain("not_failure_or_rollback");
    expect(await owner.client.callTool("effect", {})).toEqual(JSON.parse(owner.literal.content[0].text!));
    expect(owner.counts()).toEqual({ initializations: 1, calls: 2 });
    expect(() => owner.client.updateBaseUrl("http://127.0.0.1:1")).toThrow("AUTHORITY_ENDPOINT_BOUND");
    expect(owner.client.baseUrl).toBe(owner.base);
  } finally { await owner.close(); }
});

it("concurrent editor connections share initialization and never report ready before the handshake", async () => {
  const gate = deferred(), owner = await fixture({ initializeGate: gate });
  try {
    const first = owner.client.connect(); await owner.initializing.promise;
    expect(owner.client.isConnected).toBe(false);
    const second = owner.client.connect(); gate.resolve(); await Promise.all([first, second]);
    expect(owner.counts().initializations).toBe(1); expect(owner.client.isConnected).toBe(true);
    await owner.client.disconnect(); expect(owner.client.isConnected).toBe(false);
  } finally { await owner.close(); }
});

it("failed initialization remains disconnected and permits a fresh valid handshake", async () => {
  const owner = await fixture();
  try {
    owner.deny(true); await expect(owner.client.connect()).rejects.toThrow();
    expect(owner.client.isConnected).toBe(false);
    await expect(owner.client.callToolRaw("effect", {})).rejects.toThrow("not connected");
    owner.deny(false); await owner.client.connect(); expect(await owner.client.callToolRaw("effect", {})).toEqual(owner.literal);
  } finally { await owner.close(); }
});

it("a superseded endpoint handshake cannot overwrite the newly connected editor client", async () => {
  const gate = deferred(), before = await fixture({ initializeGate: gate }), after = await fixture();
  try {
    const prior = before.client.connect().catch(error => error); await before.initializing.promise;
    before.client.updateBaseUrl(after.base); await before.client.connect(); gate.resolve();
    expect(await prior).toBeInstanceOf(Error);
    expect(before.client.isConnected).toBe(true); expect(before.client.baseUrl).toBe(after.base);
    expect(await before.client.callToolRaw("effect", {})).toEqual(after.literal);
    expect(before.counts().calls).toBe(0); expect(after.counts().calls).toBe(1);
  } finally { gate.resolve(); await before.close(); await after.close(); }
});

it("editor cancellation reaches the actual MCP handler without claiming underlying work termination", async () => {
  const owner = await fixture();
  try {
    await owner.client.connect();
    const controller = new AbortController();
    const waiting = owner.client.callToolRaw("wait", {}, 5_000, undefined, controller.signal);
    const observed = waiting.catch(error => error);
    await owner.entered.promise; controller.abort(new Error("operator stop"));
    expect(await observed).toBeInstanceOf(Error);
    await Promise.race([owner.cancelled.promise, new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error("MCP cancellation not received")), 2_000); timer.unref();
    })]);
    const stopped = new AbortController(); stopped.abort();
    await expect(owner.client.callToolRaw("effect", {}, 5_000, undefined, stopped.signal)).rejects.toThrow();
    expect(owner.counts().calls).toBe(1);
  } finally { await owner.close(); }
});

it("machine omission preserves receipts inside MCP text, independent host failure and exact result hashes", () => {
  const receipt = { schema: "dreamgraph.commit_receipt.v1", operation_id: "owned-commit", revision: 9 };
  const obligation = { schema: "dreamgraph.change_obligation.v1", id: "owned-source-change", status: "unknown" };
  const original = JSON.stringify({ host_error: { message: "review failed after commit" }, owner_result: {
    content: [{ type: "text", text: JSON.stringify({ receipt, obligation, source: "🌿".repeat(10_000) }) }],
    _meta: { owner: "fixture" }, isError: true,
  } });
  const bounded = JSON.parse(boundMachineResult(original, 3_000)!.content);
  expect(bounded).toMatchObject({ isError: true, omitted: true, original_chars: original.length });
  expect(bounded.required_anchors).toContainEqual(receipt); expect(bounded.required_anchors).toContainEqual(obligation);
  expect(bounded.required_anchors).toContainEqual({ host_error: { message: "review failed after commit" } });
  expect(bounded.effect_status).toContain("not_failure_or_rollback");
  expect(() => boundMachineResult(original, 100)).toThrow("MANDATORY_ANCHORS_EXCEED");
  expect(boundMachineResult(original, original.length)!.content).toBe(original);
});

it("omission never recursively interprets source/prose strings as independent owner receipts", () => {
  const misleading = JSON.stringify({ schema: "dreamgraph.commit_receipt.v1", operation_id: "source-example" });
  const literal = JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ source: misleading, extra: "x".repeat(10_000) }) }] });
  expect(JSON.parse(boundMachineResult(literal, 2_000)!.content).required_anchors).toEqual([]);
  expect(stringifyToolFailure(new Error("before result"), undefined, false)).toBe("before result");
});
