import { beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ complete: vi.fn(), tool: vi.fn() }));
vi.mock("../src/cognitive/llm.js", async original => ({
  ...await original<object>(), completeWithNativeTools: fixture.complete,
}));
vi.mock("../src/cli/utils/mcp-call.js", async original => ({
  ...await original<object>(),
  McpSessionConnection: class {
    async connect() { return this; }
    async listTools() { return ["query_resource", "query_architecture_decisions", "edit_file"].map(name =>
      ({ name, description: name, inputSchema: { type: "object", properties: {} } })); }
    callTool(name: string, args: unknown) { return fixture.tool(name, args); }
    async close() {}
  },
}));
import { runArchitectNativeToolLoop } from "../src/architect/native-tool-loop.js";
beforeEach(() => {
  fixture.complete.mockReset(); fixture.tool.mockReset();
  fixture.tool.mockResolvedValue({ content: [{ type: "text", text: "fixture evidence" }], isError: false });
});
const finalText = 'Done.\n```architect_continuation\n{"schema":"dreamgraph.architect.continuation.v1","status":"completed"}\n```';
function input(provider: string, signal?: AbortSignal): any {
  return { req: { headers: { host: "127.0.0.1:8010" } }, config: { provider, model: "fixture" },
    provider: {}, messages: [{ role: "user", content: "Inspect" }], userMessage: "Inspect", signal };
}
it.each(["openai", "anthropic", "lmstudio"])("%s permits 100 investigative rounds followed by a mutation and final answer", async provider => {
  let round = 0;
  fixture.complete.mockImplementation(async () => {
    round++;
    const names = round <= 100 ? [round === 1 ? "query_architecture_decisions" : "query_resource"]
      : round === 101 ? ["edit_file"] : [];
    return { model: "fixture", text: names.length ? "" : finalText, stopReason: names.length ? "tool_use" : "end_turn",
      toolCalls: names.map(name => ({ id: String(round), name, input: {} })) };
  });
  const result = await runArchitectNativeToolLoop(input(provider));
  expect(round).toBe(102);
  expect(result.route.fallback_reason).toBeNull();
  expect(result.tool_trace).toHaveLength(101);
  expect(result.tool_trace.every(call => call.status === "completed")).toBe(true);
  expect(fixture.tool.mock.calls[100][0]).toBe("edit_file");
});
it("still obeys cancellation during an ongoing investigation", async () => {
  const controller = new AbortController();
  fixture.complete.mockImplementation(async () => {
    controller.abort(new Error("operator stop"));
    return { model: "fixture", text: "", toolCalls: [{ id: "1", name: "query_resource", input: {} }] };
  });
  await expect(runArchitectNativeToolLoop(input("anthropic", controller.signal))).rejects.toThrow("operator stop");
  expect(fixture.tool).not.toHaveBeenCalled();
});
it("stops when the model repeatedly ends without required evidence instead of looping on corrections", async () => {
  fixture.complete.mockResolvedValue({ model: "fixture", text: "No evidence.", toolCalls: [], stopReason: "end_turn" });
  const result = await runArchitectNativeToolLoop(input("openai"));
  expect(fixture.complete).toHaveBeenCalledTimes(2);
  expect(result.route.stop_reason).toContain("required_tools_not_called");
});
