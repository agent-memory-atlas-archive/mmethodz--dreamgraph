import { beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ complete: vi.fn(), tool: vi.fn() }));
vi.mock("../src/cognitive/llm.js", async original => ({
  ...await original<object>(), completeWithNativeTools: fixture.complete,
}));
vi.mock("../src/cli/utils/mcp-call.js", async original => ({
  ...await original<object>(),
  McpSessionConnection: class {
    async connect() { return this; }
    async listTools() { return ["query_resource", "query_architecture_decisions", "read_source_code"].map(name =>
      ({ name, description: name, inputSchema: { type: "object", properties: {} } })); }
    callTool(name: string, args: unknown) { return fixture.tool(name, args); }
    async close() {}
  },
}));
import { runArchitectNativeToolLoop } from "../src/architect/native-tool-loop.js";
beforeEach(() => { fixture.complete.mockReset(); fixture.tool.mockReset(); });
const finalText = 'Done.\n```architect_continuation\n{"schema":"dreamgraph.architect.continuation.v1","status":"completed"}\n```';
function input(provider: string): any {
  return { req: { headers: { host: "127.0.0.1:8010" } },
    config: { provider, model: "fixture", admissionPolicy: { effective: { context_tokens: 100000 } } },
    provider: {}, messages: [{ role: "system", content: "Preserve graph evidence." }, { role: "user", content: "Inspect" }],
    userMessage: "Inspect",
    budgetCoordinator: { getContextPressureLabel: () => "high", recordComponentActual: vi.fn() } };
}
it.each(["openai", "anthropic", "lmstudio"])("%s preserves cumulative evidence and the unchanged request prefix under context pressure", async provider => {
  const evidence = Array.from({ length: 6 }, (_, index) => "entity-" + index + ":" + "specific source evidence ".repeat(1800));
  let round = 0;
  let previous: any[] = [];
  fixture.tool.mockImplementation(async () => ({ content: [{ type: "text", text: evidence[round - 1] }] }));
  fixture.complete.mockImplementation(async (_config, messages) => {
    const snapshot = JSON.parse(JSON.stringify(messages));
    expect(snapshot.slice(0, previous.length)).toEqual(previous);
    previous = snapshot;
    const results = snapshot.flatMap(message => Array.isArray(message.content) ? message.content : [])
      .filter(block => block.type === "tool_result");
    expect(results.map(block => block.content)).toEqual(evidence.slice(0, round));
    round++;
    return { model: "fixture", text: round > 6 ? finalText : "", stopReason: "end_turn",
      toolCalls: round > 6 ? [] : [{ id: String(round),
        name: round === 1 ? "query_architecture_decisions" : round === 2 ? "query_resource" : "read_source_code", input: {} }] };
  });
  const request = input(provider);
  const result = await runArchitectNativeToolLoop(request);
  expect(round).toBe(7);
  expect(result.route.fallback_reason).toBeNull();
  expect(Buffer.byteLength(JSON.stringify(previous))).toBeGreaterThan(200000);
  expect(result.tool_trace.every(entry => entry.budget?.compression_mode === "verbatim")).toBe(true);
  expect(request.budgetCoordinator.recordComponentActual).toHaveBeenCalledTimes(6);
});
it("surfaces an actual admission refusal without deleting evidence or retrying with a shortened conversation", async () => {
  const evidence = "complete entity body ".repeat(2000);
  fixture.tool.mockResolvedValue({ content: [{ type: "text", text: evidence }] });
  const failure = new Error("ADMISSION_CONTEXT_LIMIT");
  fixture.complete.mockImplementationOnce(async () => ({ model: "fixture", text: "",
    toolCalls: [{ id: "read", name: "read_source_code", input: {} }] }))
    .mockImplementationOnce(async (_config, messages) => {
      expect(messages.at(-1).content[0].content).toBe(evidence);
      throw failure;
    });
  await expect(runArchitectNativeToolLoop(input("anthropic"))).rejects.toBe(failure);
  expect(fixture.complete).toHaveBeenCalledTimes(2);
  expect(fixture.tool).toHaveBeenCalledTimes(1);
});
