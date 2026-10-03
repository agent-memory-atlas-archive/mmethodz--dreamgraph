import { describe, expect, it } from "vitest";

import { turnEndedRequest, turnIdsFromClientLine, turnIdsFromNotify } from "../src/architect/codex-cua-proxy.js";
import { codexGrantedNotify, createCodexItemClock, wrapCodexServersWithProxy } from "../src/architect/codex-computer-use.js";

describe("DreamGraph cua_repl proxy performs the Codex turn-end cleanup", () => {
  it("reads Codex turn metadata from tool calls (string or object form)", () => {
    const meta = JSON.stringify({ session_id: "01a103fb-5b47-7b30-9f96-0efcf6c2ee4a", turn_id: "t-1", model: "gpt-6.1-sol" });
    expect(turnIdsFromClientLine(JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "js", arguments: {}, _meta: { "x-codex-turn-metadata": meta } } })))
      .toEqual({ session_id: "01a103fb-5b47-7b30-9f96-0efcf6c2ee4a", turn_id: "t-1" });
    expect(turnIdsFromClientLine(JSON.stringify({ method: "tools/call", params: { _meta: { "x-codex-turn-metadata": { thread_source: "subagent", thread_id: "sub-1", session_id: "s", turn_id: "t-2" } } } })))
      .toEqual({ session_id: "sub-1", turn_id: "t-2" });
    expect(turnIdsFromClientLine(JSON.stringify({ method: "initialize", params: {} }))).toBeNull();
    expect(turnIdsFromClientLine("garbage")).toBeNull();
  });

  it("reads thread and turn from Codex notify payloads", () => {
    expect(turnIdsFromNotify(JSON.stringify({ type: "agent-turn-complete", "thread-id": "th-1", "turn-id": "tu-1" }))).toEqual({ session_id: "th-1", turn_id: "tu-1" });
    expect(turnIdsFromNotify("{}")).toBeNull();
  });

  it("sends the same turn_ended call as the Codex app's plugin hook", () => {
    expect(JSON.parse(turnEndedRequest({ session_id: "s", turn_id: "t" }))).toEqual({
      jsonrpc: "2.0", id: "dreamgraph-turn-ended", method: "tools/call",
      params: { name: "turn_ended", arguments: { hook_event_name: "Stop", session_id: "s", turn_id: "t" } },
    });
  });

  it("wraps cua_repl behind the proxy and chains the operator's own notify", () => {
    const [wrapped] = wrapCodexServersWithProxy([{ name: "cua_repl", command: "C:\\cua\\node.exe", args: ["cua-repl.mjs"], env: { A: "1" }, env_vars: [], source: "x" }], "node.exe", "proxy.js", "C:\\run\\cua-control");
    expect(wrapped).toMatchObject({ command: "node.exe", args: ["proxy.js", "--proxy", "C:\\run\\cua-control", "--", "C:\\cua\\node.exe", "cua-repl.mjs"], env: { A: "1" } });
    expect(codexGrantedNotify("node.exe", "proxy.js", "D", ["codex-computer-use.exe", "turn-ended"])).toEqual(["node.exe", "proxy.js", "--notify", "D", "--", "codex-computer-use.exe", "turn-ended"]);
    expect(codexGrantedNotify("node.exe", "proxy.js", "D", [])).toEqual(["node.exe", "proxy.js", "--notify", "D"]);
  });

  it("times Codex's own tool calls from the live stream", () => {
    let t = 1000;
    const clock = createCodexItemClock(() => t);
    clock.onStdout('{"type":"item.started","item":{"id":"item_7","type":"mcp_tool_call","server":"cua_repl"}}\n');
    t = 3500;
    clock.onStdout('{"type":"item.completed","item":{"id":"item_7","type":"mcp_tool_call","server":"cua_repl"}}\n');
    expect(clock.durations.get("item_7")).toBe(2500);
  });
});
