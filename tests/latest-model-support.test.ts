import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  completeWithNativeTools, getModelCapabilities, initLlmProvider,
  type ArchitectLlmConfig, type LlmToolLoopMessage,
} from "../src/cognitive/llm.js";

const openai = ["gpt-6.1-sol", "gpt-6-astra", "gpt-6-sol", "gpt-6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"];
const anthropic = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1", "claude-mythos-5-1"];
const config = (provider: "openai" | "anthropic", model: string): ArchitectLlmConfig => ({
  provider, model, baseUrl: "https://provider.invalid/v1", apiKey: "test", temperature: 0.7,
  maxTokens: 4096, timeoutMs: 1000, component: "architect", providerSource: "architect", modelSource: "architect",
});
afterEach(() => vi.unstubAllGlobals());

describe("September 2026 model support", () => {
  it.each(openai)("routes %s through Responses without sampling parameters", async (model) => {
    const fetchMock = vi.fn(async () => Response.json({ output_text: '{"ok":true}', output: [], status: "completed" }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = initLlmProvider(config("openai", model));
    await provider.complete([{ role: "user", content: "Return JSON" }], {
      jsonSchema: { name: "result", schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false } },
    });
    const [url, options] = (fetchMock.mock.calls as unknown as [string, RequestInit][])[0];
    expect(url).toMatch(/\/responses$/);
    const body = JSON.parse(options.body as string);
    expect(body).not.toHaveProperty("temperature");
    expect(body.text.format).toMatchObject({ type: "json_schema", name: "result", strict: true });
    expect(getModelCapabilities("openai", model).supportsReasoningEffort).toBe(true);
  });

  it.each(anthropic)("omits temperature and reads text after thinking for %s", async (model) => {
    const fetchMock = vi.fn(async () => Response.json({ content: [
      { type: "thinking", thinking: "", signature: "opaque" },
      { type: "text", text: "first" }, { type: "text", text: " second" },
    ] }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await initLlmProvider(config("anthropic", model)).complete([{ role: "user", content: "Hello" }]);
    const [, options] = (fetchMock.mock.calls as unknown as [string, RequestInit][])[0];
    expect(JSON.parse(options.body as string)).not.toHaveProperty("temperature");
    expect(result.text).toBe("first second");
  });

  it.each(["openai", "anthropic"] as const)("replays opaque %s assistant state on the next tool turn", async (provider) => {
    const model = provider === "openai" ? "gpt-6.1-sol" : "claude-opus-5-5";
    const raw = provider === "openai" ? [
      { type: "reasoning", id: "r1", encrypted_content: "opaque", summary: [] },
      { type: "function_call", call_id: "t1", name: "inspect", arguments: "{}" },
    ] : [
      { type: "thinking", thinking: "", signature: "opaque" },
      { type: "tool_use", id: "t1", name: "inspect", input: {} },
    ];
    const bodies: Record<string, any>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      if (provider === "anthropic") expect(options.headers["anthropic-beta"]).toBe("thinking-binding-controls-2026-08-01");
      return Response.json(provider === "openai" ? { output: raw } : { content: raw, stop_reason: "tool_use" });
    }));
    const messages: LlmToolLoopMessage[] = [{ role: "user", content: "Inspect" }];
    const tools = [{ name: "inspect", inputSchema: { type: "object", properties: {} } }];
    const first = await completeWithNativeTools(config(provider, model), messages, tools);
    expect(first.providerRawAssistant).toEqual(raw);
    messages.push({ role: "assistant", content: [], providerRawAssistant: first.providerRawAssistant },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "done" }] });
    await completeWithNativeTools(config(provider, model), messages, tools);
    if (provider === "openai") {
      expect(bodies[1].input.slice(1, 3)).toEqual(raw);
      expect(bodies[1].store).toBe(false);
    } else {
      expect(bodies[1].messages[1].content).toEqual(raw);
      expect(bodies[1].thinking.block_binding.prefix_mismatch_behavior).toBe("drop_block");
    }
  });

  it("keeps current models available on all three model selection surfaces", () => {
    for (const file of ["src/architect/routes.ts", "src/server/dashboard.ts", "extensions/vscode/src/architect-llm.ts"]) {
      const source = readFileSync(file, "utf8");
      for (const model of [...openai, ...anthropic]) expect(source, `${file}: ${model}`).toContain(model);
    }
  });
});
