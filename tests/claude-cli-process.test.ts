import { describe, expect, it } from "vitest";
import { ClaudeStream } from "../src/architect/claude-cli-process.js";
const expected = { version: "2.1.293", model: "claude-sonnet-5", tools: ["query_resource"] };
const init = { type: "system", subtype: "init", session_id: "one", permissionMode: "dontAsk",
  claude_code_version: expected.version, model: expected.model, tools: ["mcp__dreamgraph__query_resource"],
  mcp_servers: [{ name: "dreamgraph", status: "connected" }], agents: [], skills: [], plugins: [] };
const result = { type: "result", subtype: "success", is_error: false, result: "Hyvää päivää — 測試", session_id: "one",
  usage: { input_tokens: 3, cache_read_input_tokens: 100, cache_creation_input_tokens: 20, output_tokens: 8 }, total_cost_usd: 42 };
const line = value => Buffer.from(JSON.stringify(value) + "\n");
describe("Claude terminal and streaming truth", () => {
  it("handles split UTF-8 and JSON, ignores duplicated presentation and preserves measured usage", () => {
    let admitted = 0; const parser = new ClaudeStream(expected, () => admitted++);
    const bytes = Buffer.concat([line(init), line({ type: "stream_event", event: {} }),
      line({ type: "assistant", message: { content: [{ type: "text", text: "partial" }] } }), line(result)]);
    for (const byte of bytes) parser.push(Buffer.from([byte]));
    const value = parser.finish();
    expect(admitted).toBe(1); expect(value.content).toBe(result.result);
    expect(value.usage).toBeDefined(); expect(value).not.toHaveProperty("total_cost_usd");
  });
  it("revokes tools at terminal receipt and retains provider usage even on a failed result", () => {
    let closed = false;
    const parser = new ClaudeStream(expected, () => {}, () => { closed = true; });
    parser.push(line(init));
    parser.push(line({ ...result, subtype: "error_max_turns", is_error: true }));
    expect(closed).toBe(true);
    expect(() => parser.finish()).toThrow("CLAUDE_TERMINAL_FAILED");
    expect(parser.usage()).toBeDefined();
  });
  it("refuses a native or foreign capability without opening the gate", () => {
    let admitted = false;
    const parser = new ClaudeStream(expected, () => { admitted = true; });
    expect(() => parser.push(line({ ...init, tools: [...init.tools, "Bash"] }))).toThrow("TOOL_MISMATCH");
    expect(admitted).toBe(false);
  });
  it.each([
    [{ type: "result", subtype: "error_max_turns", is_error: true, session_id: "one" }, "TERMINAL_FAILED"],
    [{ ...result, result: "" }, "CONTENT_MISSING"],
    [{ ...result, session_id: "foreign" }, "SESSION_MISMATCH"],
  ])("cannot promote a failed or foreign terminal to success", (terminal, error) => {
    const parser = new ClaudeStream(expected, () => {});
    parser.push(line(init));
    expect(() => { parser.push(line(terminal)); parser.finish(); }).toThrow(error);
  });
  it("rejects malformed, missing, duplicate or oversized streams", () => {
    for (const [chunks, error] of [
      [[line(init), Buffer.from("{broken}\n")], "JSON_INVALID"],
      [[line(init)], "RESULT_MISSING"],
      [[line(init), line(init)], "INIT_DUPLICATE"],
      [[line(init), line(result), line(result)], "RESULT_DUPLICATE"],
      [[line(init), Buffer.alloc(524289)], "BYTE_BOUND"],
    ] as const) {
      const parser = new ClaudeStream(expected, () => {});
      expect(() => { for (const chunk of chunks) parser.push(chunk); parser.finish(); }).toThrow(error);
    }
  });
  it("refuses catalog changes and attempts at unadvertised tools after admission", () => {
    for (const event of [{ type: "system", subtype: "mcp_tools_list_changed" },
      { type: "assistant", message: { content: [{ type: "tool_use", name: "Bash" }] } }]) {
      const parser = new ClaudeStream(expected, () => {}); parser.push(line(init));
      expect(() => parser.push(line(event))).toThrow(/CATALOG_CHANGED|UNADVERTISED_TOOL/);
    }
  });
});
