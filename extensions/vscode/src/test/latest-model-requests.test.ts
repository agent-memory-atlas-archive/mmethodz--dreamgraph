import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import type { SecretStorage } from "vscode";
import type { ArchitectLlm } from "../architect-llm";
import { RESPONSES_RAW_ITEMS_KEY, translateRawToOpenAIResponses } from "../openai-responses-adapter";

// Load the compiled provider with just VS Code settings/secret storage stubbed.
// Every request still uses the production compaction and transport serializers.
const filename = require.resolve("../architect-llm");
const localRequire = createRequire(filename);
const settings: Record<string, unknown> = {};
let fetchRequest: typeof fetch;
const warnings: unknown[][] = [];
const providerModule = { exports: {} as typeof import("../architect-llm") };
runInNewContext(readFileSync(filename, "utf8"), {
  exports: providerModule.exports, module: providerModule,
  require: (id: string) => id === "vscode"
    ? { workspace: { getConfiguration: () => ({ get: (key: string) => settings[key] }) } }
    : localRequire(id),
  fetch: (...args: Parameters<typeof fetch>) => fetchRequest(...args),
  console: { log() {}, warn: (...args: unknown[]) => warnings.push(args) },
  Buffer, AbortSignal, TextDecoder,
}, { filename });

function client(model: string, provider: "anthropic" | "openai" = "anthropic"): ArchitectLlm {
  for (const key of Object.keys(settings)) delete settings[key];
  warnings.length = 0;
  const llm = new providerModule.exports.ArchitectLlm({ get: async () => "test" } as unknown as SecretStorage);
  llm.applyConfig({ provider, model, baseUrl: "https://provider.invalid/v1", apiKey: "test" });
  return llm;
}

for (const model of ["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1", "claude-mythos-5-1"]) {
  test(`${model}: preserves signed thinking and tool calls through the next request`, async () => {
    const llm = client(model);
    settings["anthropic.adaptiveThinking"] = false;
    const raw = [
      { type: "thinking", thinking: "", signature: "opaque-signed-block" },
      { type: "text", text: "Inspecting" },
      { type: "tool_use", id: "tool1", name: "inspect", input: {} },
    ];
    const requests: Array<{ body: Record<string, any>; headers: Record<string, string> }> = [];
    fetchRequest = async (_url, options) => {
      requests.push({ body: JSON.parse(options!.body as string), headers: options!.headers as Record<string, string> });
      return Response.json({ content: raw, stop_reason: "tool_use", usage: {} });
    };
    const messages = [{ role: "user" as const, content: "Inspect the graph" }];
    const tools = [{ name: "inspect", description: "Inspect", inputSchema: { type: "object", properties: {} } }];
    const first = await llm.callWithTools(messages, tools);
    assert.deepEqual(first.providerRawAssistant, raw);
    await llm.callWithTools(messages, tools, [
      ...messages,
      { role: "assistant", content: [], [RESPONSES_RAW_ITEMS_KEY]: first.providerRawAssistant },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "tool1", content: "done" }] },
    ]);
    assert.deepEqual(requests[1].body.messages[1].content, raw);
    assert.deepEqual(Object.keys(requests[1].body.messages[1]), ["role", "content"]);
    assert.equal(requests[1].body.max_tokens, 128_000);
    assert.equal(requests[1].body.temperature, undefined);
    if (model !== "claude-mythos-5-1") {
      assert.equal(requests[1].body.thinking.type, "adaptive");
      assert.equal(requests[1].body.thinking.block_binding.prefix_mismatch_behavior, "drop_block");
      assert.equal(requests[1].headers["anthropic-beta"], "thinking-binding-controls-2026-08-01");
    }
  });
}

test("Claude reasoning drops produce diagnostics without exposing signatures", async () => {
  const llm = client("claude-opus-5-5");
  fetchRequest = async () => Response.json({ content: [{ type: "text", text: "Done" }], usage: {},
    input_transformations: [{ type: "thinking_dropped", reason: "prefix_binding_mismatch", signature: "private" }] });
  await llm.callWithTools([{ role: "user", content: "Continue" }], []);
  assert.equal(warnings.length, 1);
  assert.match(JSON.stringify(warnings), /"dropped":1/);
  assert.doesNotMatch(JSON.stringify(warnings), /private/);
});

test("GPT-6.1 Sol uses Responses for tools and supports images", async () => {
  const llm = client("gpt-6.1-sol", "openai");
  fetchRequest = async (url, options) => {
    assert.match(String(url), /\/responses$/);
    const body = JSON.parse(options!.body as string);
    assert.equal(body.temperature, undefined);
    assert.deepEqual(body.reasoning, { effort: "medium" });
    assert.equal(body.store, false);
    assert.deepEqual(body.include, ["reasoning.encrypted_content"]);
    return Response.json({ output_text: "Done", output: [], usage: {} });
  };
  await llm.callWithTools([{ role: "user", content: "Inspect" }], []);
  assert.equal(llm.getModelCapabilities("openai", "gpt-6.1-sol").imageAttachments, true);
});

test("switching providers translates neutral history instead of replaying foreign raw blocks", async () => {
  const llm = client("claude-opus-5-5");
  const neutral = [{ type: "text", text: "Earlier reply" }];
  fetchRequest = async (_url, options) => {
    const body = JSON.parse(options!.body as string);
    assert.deepEqual(body.messages[0].content, neutral);
    return Response.json({ content: [], usage: {} });
  };
  await llm.callWithTools([], [], [{ role: "assistant", content: neutral,
    [RESPONSES_RAW_ITEMS_KEY]: [{ type: "reasoning", encrypted_content: "openai-only" }] }]);
  const translated = translateRawToOpenAIResponses([{ role: "assistant", content: neutral,
    [RESPONSES_RAW_ITEMS_KEY]: [{ type: "thinking", signature: "claude-only" }] }]);
  assert.deepEqual(translated, [{ role: "assistant", content: "Earlier reply" }]);
});
