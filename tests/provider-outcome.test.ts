import { installOfflineAdmissionFixtures } from "./helpers/offline-admission.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLlmProviderForConfig, completeWithNativeTools, type ArchitectLlmConfig } from "../src/cognitive/llm.js";
import { providerCapability } from "../src/config/provider-capabilities.js";
import { providerUsage, anthropicOutputSchema, assertProviderOutcome } from "../src/cognitive/provider-outcome.js";
afterEach(() => vi.unstubAllGlobals());
const config = (provider: "openai" | "anthropic", model: string): ArchitectLlmConfig => ({ provider, model, baseUrl: "https://offline.invalid/v1", apiKey: "fixture", temperature: 0.7, maxTokens: 1000, timeoutMs: 5000, component: "architect", providerSource: "architect", modelSource: "architect" });
const schema = { name: "rating", schema: { type: "object", properties: { rating: { type: "number", minimum: 0, maximum: 1 } }, required: ["rating"], additionalProperties: false } };
const usage = { input_tokens: 110, output_tokens: 20, total_tokens: 130, input_tokens_details: { cached_tokens: 90 }, output_tokens_details: { reasoning_tokens: 10 } };
installOfflineAdmissionFixtures();

describe("provider outcome boundary", () => {
  it.each(['computer_call','custom_tool_call','local_shell_call','future_native_call'])('refuses an unmapped Responses %s instead of ignoring it as a final answer',async type=>{
    const fetch=vi.fn(async()=>Response.json({status:'completed',output:[{type,call_id:'unmapped',actions:[{type:'click',x:1,y:1}],input:'DO_NOT_LOG_SECRET'}],usage}));vi.stubGlobal('fetch',fetch);
    await expect(completeWithNativeTools(config('openai','gpt-6.1-sol'),[],[{name:'inspect'}])).rejects.toMatchObject({code:'PROVIDER_OUTPUT_INVALID',stopReason:'unmapped_tool_output',usage:{totalTokens:130}});
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('refuses malformed function calls even beside an otherwise valid answer',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Done'}]},{type:'function_call',name:'inspect',arguments:'{}'}],usage})));
    await expect(completeWithNativeTools(config('openai','gpt-6.1-sol'),[],[{name:'inspect'}])).rejects.toMatchObject({code:'PROVIDER_OUTPUT_INVALID',stopReason:'incomplete_function_call',usage:{totalTokens:130}});
  });
  it('refuses unadvertised Anthropic server tools with reported usage and no native dispatch',async()=>{
    const fetch=vi.fn(async()=>Response.json({stop_reason:'end_turn',content:[{type:'text',text:'Done'},{type:'server_tool_use',id:'native',name:'computer',input:{secret:'DO_NOT_LOG_SECRET'}}],usage:{input_tokens:110,output_tokens:20}}));vi.stubGlobal('fetch',fetch);
    try{await completeWithNativeTools(config('anthropic','claude-opus-5-5'),[],[{name:'inspect'}]);throw new Error('Expected unmapped output to refuse');}
    catch(error){expect(error).toMatchObject({code:'PROVIDER_OUTPUT_INVALID',stopReason:'unmapped_tool_output',usage:{inputTokens:110,outputTokens:20}});expect(String(error)).not.toContain('DO_NOT_LOG_SECRET');}
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does not silently discard unmapped image output in a client-function message',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_image',image_url:'DO_NOT_LOG_SECRET'}]}],usage})));
    await expect(completeWithNativeTools(config('openai','gpt-6.1-sol'),[],[{name:'inspect'}])).rejects.toMatchObject({code:'PROVIDER_OUTPUT_INVALID',stopReason:'unmapped_message_output',usage:{totalTokens:130}});
  });
  it.each(["incomplete", "failed", "cancelled", "in_progress", "queued"])("rejects Responses %s and retains usage", async status => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status, output_text: '{"rating":0.5}', usage })));
    await expect(createLlmProviderForConfig(config("openai", "gpt-6.1-sol")).complete([], { jsonSchema: schema })).rejects.toMatchObject({ code: status === "failed" ? "PROVIDER_FAILED" : "PROVIDER_INCOMPLETE", usage: { inputTokens: 110, outputTokens: 20, cachedInputTokens: 90, reasoningTokens: 10, totalTokens: 130 } });
  });
  it("detects a refusal despite successful HTTP/response status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "declined" }] }], usage })));
    await expect(createLlmProviderForConfig(config("openai", "gpt-6.1-sol")).complete([])).rejects.toMatchObject({ code: "PROVIDER_REFUSAL", usage: { totalTokens: 130 } });
  });
  it.each(["length", "content_filter"])("rejects Chat %s before accepting generated JSON", async finish_reason => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ choices: [{ message: { content: '{"rating":0.5}' }, finish_reason }], usage: { prompt_tokens: 10, completion_tokens: 8 } })));
    await expect(createLlmProviderForConfig(config("openai", "gpt-4.1")).complete([], { jsonSchema: schema })).rejects.toMatchObject({ code: finish_reason === "length" ? "PROVIDER_INCOMPLETE" : "PROVIDER_REFUSAL", usage: { inputTokens: 10, outputTokens: 8 } });
  });
  it("does not equate valid JSON with valid evidence shape", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "completed", output_text: '{"rating":2}', usage })));
    await expect(createLlmProviderForConfig(config("openai", "gpt-6.1-sol")).complete([], { jsonSchema: schema })).rejects.toMatchObject({ code: "PROVIDER_OUTPUT_INVALID", stopReason: "schema_mismatch" });
  });
  it("compiles invalid schemas before spending tokens", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(createLlmProviderForConfig(config("openai", "gpt-4.1")).complete([], { jsonSchema: { name: "invalid", schema: { type: "impossible" } } })).rejects.toMatchObject({ code: "OUTPUT_SCHEMA_INVALID" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("preserves Claude effort/native schema and validates original numeric limits", async () => {
    let body: any;
    vi.stubGlobal("fetch", vi.fn(async (_url, options) => { body = JSON.parse(options.body); return Response.json({ stop_reason: "end_turn", content: [{ type: "text", text: '{"rating":2}' }], usage: { input_tokens: 5, cache_read_input_tokens: 80, cache_creation_input_tokens: 10, output_tokens: 9 } }); }));
    await expect(createLlmProviderForConfig({ ...config("anthropic", "claude-sonnet-5-5"), reasoningEffort: "high" }).complete([], { jsonSchema: schema, cognitiveRole: "normalizer" })).rejects.toMatchObject({ code: "PROVIDER_OUTPUT_INVALID", usage: { inputTokens: 95, cachedInputTokens: 80, cacheCreationInputTokens: 10, outputTokens: 9 } });
    expect(body.output_config).toMatchObject({ effort: "high", format: { type: "json_schema" } });
    expect(body.output_config.format.schema.properties.rating).not.toHaveProperty("minimum");
    expect(schema.schema.properties.rating.minimum).toBe(0); expect(body).not.toHaveProperty("temperature"); expect(body.system).toContain("strict critic");
  });
  it.each(["refusal", "max_tokens", "pause_turn", "model_context_window_exceeded"])("rejects Claude %s with usage retained", async stop_reason => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ stop_reason, content: [{ type: "text", text: "{}" }], usage: { output_tokens: 3 } })));
    await expect(createLlmProviderForConfig(config("anthropic", "claude-sonnet-5-5")).complete([])).rejects.toMatchObject({ code: stop_reason === "refusal" ? "PROVIDER_REFUSAL" : "PROVIDER_INCOMPLETE", usage: { outputTokens: 3 } });
  });
  it("does not fabricate missing usage or double-count cache/reasoning", () => {
    expect(providerUsage("openai", usage)).toEqual({ inputTokens: 110, outputTokens: 20, totalTokens: 130, cachedInputTokens: 90, reasoningTokens: 10 });
    expect(providerUsage("openai", { output_tokens: 3 })).toEqual({ outputTokens: 3 }); expect(providerUsage("openai", { output_tokens: -2 })).toBeUndefined();
  });
  it("preserves property names and original schema during grammar adaptation", () => {
    const original = { type: "object", properties: { minimum: { type: "string", minLength: 2 } } };
    expect(anthropicOutputSchema(original)).toEqual({ type: "object", properties: { minimum: { type: "string" } } }); expect(original.properties.minimum.minLength).toBe(2);
  });
  it.each(["openai", "anthropic"] as const)("cancels the active %s HTTP request", async provider => {
    const controller = new AbortController(); let actualSignal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_url, init) => new Promise((_resolve, reject) => { actualSignal = init.signal; actualSignal!.addEventListener("abort", () => reject(actualSignal!.reason), { once: true }); })));
    const request = createLlmProviderForConfig(config(provider, provider === "openai" ? "gpt-6.1-sol" : "claude-sonnet-5-5")).complete([], { signal: controller.signal });
    while (!actualSignal) await new Promise(resolve => setTimeout(resolve, 5));
    controller.abort(new Error("user_cancelled")); await expect(request).rejects.toThrow("user_cancelled"); expect(actualSignal?.aborted).toBe(true);
  });
  it("rejects pre-aborted requests without dispatch", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(createLlmProviderForConfig(config("openai", "gpt-4.1")).complete([], { signal: AbortSignal.abort(new Error("stopped")) })).rejects.toThrow("stopped"); expect(fetch).not.toHaveBeenCalled();
  });
  it("does not grant future/custom/CLI identifiers API capabilities", () => {
    for (const model of ["gpt-7.1", "gpt-6.1-sol-custom", "codex-cli/gpt-6.1-sol"]) expect(providerCapability("openai", model)).toBeNull();
    expect(providerCapability("openai", "gpt-4.1-2025-04-14")?.strict_schema).toBe(true);
  });
  it.each([null, { output: {} }, { output: [{ type: 'message', content: {} }] }, { choices: [{ message: { tool_calls: {} } }] }, { status: 'unknown' }])('rejects malformed provider envelopes with usage intact', value => {
    expect(() => assertProviderOutcome('openai', 'fixture', value, { outputTokens: 7 })).toThrow(expect.objectContaining({ code: 'PROVIDER_OUTPUT_INVALID', usage: { outputTokens: 7 } }));
  });
  it('uses model-specific documented APIs and efforts', async () => {
    expect(providerCapability('openai', 'gpt-5-pro')).toMatchObject({ apis: ['responses'], efforts: ['high'] });
    expect(providerCapability('openai', 'o3-mini')?.images).toBe(false);
    expect(providerCapability('openai', 'gpt-5.1')?.efforts).not.toContain('xhigh');
    expect(providerCapability('openai', 'gpt-6.1-sol')?.efforts).toContain('max');
    expect(providerCapability('openai', 'gpt-4.1-2099-01-01')).toBeNull();
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(createLlmProviderForConfig(config('openai','gpt-5-pro')).complete([], { api:'chat-completions' })).rejects.toThrow('PROVIDER_API_UNSUPPORTED');
    await expect(createLlmProviderForConfig(config('openai','gpt-5.1')).complete([], { reasoningEffort:'xhigh' })).rejects.toThrow('REASONING_EFFORT_UNSUPPORTED');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('retains usage on malformed tool JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ status:'completed', output:[{type:'function_call', call_id:'x', name:'read', arguments:'{oops'}], usage })));
    await expect(completeWithNativeTools(config('openai','gpt-6.1-sol'),[],[{name:'read'}])).rejects.toMatchObject({code:'TOOL_ARGUMENTS_INVALID',provider:'openai',model:'gpt-6.1-sol',usage:{totalTokens:130}});
  });
  it("rejects invalid or unadvertised native tools before dispatch", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ output: [{ type: "function_call", call_id: "t1", name: "write", arguments: '{"path":4}' }], usage })));
    await expect(completeWithNativeTools(config("openai", "gpt-6.1-sol"), [], [{ name: "write", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } }])).rejects.toMatchObject({ code: "TOOL_ARGUMENTS_INVALID", usage: { totalTokens: 130 } });
    await expect(completeWithNativeTools(config("openai", "gpt-6.1-sol"), [], [])).rejects.toMatchObject({ code: "TOOL_ARGUMENTS_INVALID" });
  });
  it("preserves nested tool schemas and validates their constraints locally", async () => {
    const original = { type: "object", properties: { rating: { $ref: "#/$defs/rating" } }, $defs: { rating: { type: "number", minimum: 0, maximum: 1 } }, required: ["rating"], additionalProperties: false }; let body: any;
    vi.stubGlobal("fetch", vi.fn(async (_url, options) => { body = JSON.parse(options.body); return Response.json({ output: [{ type: "function_call", call_id: "t1", name: "rate", arguments: '{"rating":2}' }] }); }));
    await expect(completeWithNativeTools(config("openai", "gpt-6.1-sol"), [], [{ name: "rate", inputSchema: original }])).rejects.toMatchObject({ code: "TOOL_ARGUMENTS_INVALID" }); expect(body.tools[0].parameters).toEqual(original);
  });
  it("requires Responses for GPT-6 tool reasoning without implicit protocol/effort changes", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(completeWithNativeTools({ ...config("openai", "gpt-6.1-sol"), api: "chat-completions" }, [], [{ name: "inspect" }])).rejects.toThrow("TOOLS_REQUIRE_RESPONSES");
    await expect(completeWithNativeTools({ ...config("openai", "gpt-6-sol"), api: "chat-completions", reasoningEffort: "high" }, [], [{ name: "inspect" }])).rejects.toThrow("TOOLS_REQUIRE_RESPONSES"); expect(fetch).not.toHaveBeenCalled();
  });
});
