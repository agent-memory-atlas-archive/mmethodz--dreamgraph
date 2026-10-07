import { describe, expect, it } from "vitest";

import { compactArchitectToolTranscript } from "../src/architect/native-tool-loop.js";

type Message = Parameters<typeof compactArchitectToolTranscript>[0][number];
const required = (): Message[] => [{ role: "system", content: "required ".repeat(500) }, { role: "user", content: "operate the IDE tab" }];
const step = (id: string, size: number): Message[] => [
  { role: "assistant", content: [{ type: "tool_use", id, name: "cua_repl", input: { code: "cua.getState()" } }] },
  { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: `${id}:` + "x".repeat(size) }] },
];
const resultOf = (messages: Message[], index: number) => (messages[index].content as Array<{ type: string; content?: string }>)[0].content!;

describe("native tool loop transcript working set", () => {
  it("leaves a transcript that fits its context allocation untouched", () => {
    const messages = [...required(), ...step("a", 10_000)];
    expect(compactArchitectToolTranscript(messages, 2, [], 512_000)).toBe(0);
    expect(resultOf(messages, 3)).toHaveLength(10_002);
  });

  it("compacts the oldest results first, never the latest exchange or the required prompt", () => {
    const messages = [...required(), ...step("a", 60_000), ...step("b", 60_000), ...step("c", 60_000)];
    const before = JSON.stringify(messages.slice(0, 2));
    const compacted = compactArchitectToolTranscript(messages, 2, [], 200_000);
    // Over 80 % of the allocation: compacts down below 60 % in one go, so the prompt changes rarely.
    expect(compacted).toBe(2);
    expect(resultOf(messages, 3)).toMatch(/^\[Earlier tool result compacted .*\(60002 chars\)\. Beginning: a:x+ … Call the tool again/);
    expect(resultOf(messages, 5)).toMatch(/^\[Earlier tool result compacted .*Beginning: b:x+/);
    expect(resultOf(messages, 7)).toHaveLength(60_002);
    expect(JSON.stringify(messages.slice(0, 2))).toBe(before);
    expect(Buffer.byteLength(JSON.stringify(messages))).toBeLessThanOrEqual(200_000 * 0.6);
  });

  it("counts advertised tool definitions against the allocation and does not compact twice", () => {
    const messages = [...required(), ...step("a", 30_000), ...step("b", 30_000)];
    const tools = [{ name: "big", description: "d".repeat(50_000), inputSchema: { type: "object" } }];
    expect(compactArchitectToolTranscript(messages, 2, tools, 120_000)).toBe(1);
    expect(compactArchitectToolTranscript(messages, 2, tools, 120_000)).toBe(0);
  });

  it("stops when nothing more can be compacted, leaving the limit to model admission", () => {
    const messages = [...required(), ...step("a", 200_000)];
    expect(compactArchitectToolTranscript(messages, 2, [], 100_000)).toBe(0);
    expect(resultOf(messages, 3)).toHaveLength(200_002);
  });
});
