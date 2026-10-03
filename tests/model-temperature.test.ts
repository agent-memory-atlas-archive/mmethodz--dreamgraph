import { installOfflineAdmissionFixtures } from "./helpers/offline-admission.js";
import { describe, it, expect, afterEach, vi } from "vitest";
import { modelTemperatureCapability } from "../src/config/model-temperature.js";
import { resolveRolePolicy, previewLegacyRoleMigration } from "../src/config/role-policy.js";
import { createLlmProviderForConfig, completeWithNativeTools, initLlmProvider, selectLlmRoute, type ArchitectLlmConfig } from "../src/cognitive/llm.js";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); initLlmProvider({ provider: "none", model: "", baseUrl: "", apiKey: "", temperature: 0.7, maxTokens: 2048, timeoutMs: 1000 }); });
// These are request/policy contracts with durable offline admission, not latency tests.
// Keep a finite allowance under whole-suite disk contention; production deadlines are unchanged.
const config = (provider: "openai" | "anthropic", model: string): ArchitectLlmConfig => ({ provider, model, baseUrl: "https://offline.invalid/v1", apiKey: "fixture", temperature: 0.87, maxTokens: 1234, timeoutMs: 10000, component: "architect", providerSource: "architect", modelSource: "architect" });
const schema = { name: "evidence", schema: { type: "object", properties: { edges: { type: "array", items: { type: "string" } } }, required: ["edges"], additionalProperties: false } };

installOfflineAdmissionFixtures();

describe("cognitive roles without unsupported temperature", () => {
  it.each(["gpt-5.1", "gpt-5.2", "gpt-5.4", "gpt-6-sol", "gpt-6-luna"])("requires explicit none before sending temperature to %s", model => {
    expect(modelTemperatureCapability("openai", model).support).toBe("unsupported");
    expect(modelTemperatureCapability("openai", model, "high").support).toBe("unsupported");
    expect(modelTemperatureCapability("openai", model, "none").support).toBe("supported");
  });
  it.each(["gpt-5.5", "gpt-5.6-sol"])("omits sampling for %s even when none is requested without sampling qualification", model => {
    expect(modelTemperatureCapability("openai", model).support).toBe("unsupported");
    expect(modelTemperatureCapability("openai", model, "none").support).toBe("unknown");
  });
  it.each(["gpt-5", "gpt-5-mini", "gpt-5-nano", "o3", "gpt-6-astra", "gpt-6.1-sol"])("never sends temperature to %s", model => {
    expect(modelTemperatureCapability("openai", model, "none").support).toBe("unsupported");
  });
  it.each(["dreamer", "normalizer"] as const)("preserves %s role, prompt/schema, effort and selected model in Responses", async role => {
    const bodies: any[] = [];
    const fetch = vi.fn(async (_url, options) => { bodies.push(JSON.parse(options.body)); return Response.json({ output_text: '{"edges":[]}', status: "completed", usage: { output_tokens: 5 } }); });
    vi.stubGlobal("fetch", fetch);
    const messages = [{ role: "system" as const, content: "Retain the exact source evidence and response schema." }, { role: "user" as const, content: "Evaluate these supplied entities." }];
    await createLlmProviderForConfig({ ...config("openai", "gpt-6.1-sol"), reasoningEffort: "high", store: false }).complete(messages, { cognitiveRole: role, temperature: role === "dreamer" ? 0.9 : 0.1, jsonSchema: schema });
    expect(fetch).toHaveBeenCalledOnce();
    expect(bodies[0]).not.toHaveProperty("temperature");
    expect(bodies[0]).toMatchObject({ model: "gpt-6.1-sol", reasoning: { effort: "high" }, store: false, max_output_tokens: 1234, text: { format: { name: "evidence", strict: true, schema: schema.schema } } });
    expect(bodies[0].instructions).toContain(`cognitive role: ${role}`);
    expect(bodies[0].instructions).toContain(messages[0].content);
    expect(bodies[0].instructions).toContain(role === "dreamer" ? "hypotheses/dreams" : "strict critic");
    expect(messages).toHaveLength(2);
  });
  it.each(["responses", "chat-completions"] as const)("honors GPT-5.4 explicit none/high in %s without changing the role", async api => {
    const bodies: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, options) => { bodies.push(JSON.parse(options.body)); return Response.json({ choices: [{ message: { content: "{}" } }], output_text: "{}" }); }));
    const provider = createLlmProviderForConfig(config("openai", "gpt-5.4"));
    for (const reasoningEffort of ["none", "high"]) await provider.complete([{ role: "user", content: "Analyze" }], { api, reasoningEffort, cognitiveRole: "normalizer" });
    expect(bodies[0].temperature).toBe(0.87); expect(bodies[1]).not.toHaveProperty("temperature");
    expect(api === "responses" ? bodies[0].reasoning.effort : bodies[0].reasoning_effort).toBe("none");
    expect(api === "responses" ? bodies[1].reasoning.effort : bodies[1].reasoning_effort).toBe("high");
  });
  it("retains GPT-4.1 sampling and conservatively omits unqualified future/custom sampling", async () => {
    const bodies: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, options) => { bodies.push(JSON.parse(options.body)); return Response.json({ choices: [{ message: { content: "{}" } }] }); }));
    const fixturePrices = JSON.parse(process.env.DREAMGRAPH_LLM_PRICING!);
    for (const model of ["gpt-7-new", "user-custom"]) fixturePrices.push({ ...fixturePrices.find((price: any) => price.model === "gpt-4.1"), model });
    vi.stubEnv("DREAMGRAPH_LLM_PRICING", JSON.stringify(fixturePrices));
    for (const model of ["gpt-4.1", "gpt-7-new", "user-custom"]) await createLlmProviderForConfig(config("openai", model)).complete([{ role: "user", content: "Extract" }], { cognitiveRole: "initial_scan" });
    expect(bodies[0].temperature).toBe(0.87);
    for (const body of bodies.slice(1)) { expect(body).not.toHaveProperty("temperature"); expect(body.messages[0].content).toContain("initial scan"); }
  });
  it.each(["claude-opus-4-7", "claude-opus-4-8", "claude-sonnet-5-5", "claude-fable-5-1", "claude-mythos-preview"])("preserves Anthropic normalizer instructions without deprecated sampling for %s", async model => {
    let body: any;
    vi.stubGlobal("fetch", vi.fn(async (_url, options) => { body = JSON.parse(options.body); return Response.json({ content: [{ type: "text", text: "{}" }] }); }));
    await createLlmProviderForConfig(config("anthropic", model)).complete([{ role: "system", content: "Exact semantic criteria." }, { role: "user", content: "Validate" }], { cognitiveRole: "normalizer" });
    expect(body).not.toHaveProperty("temperature"); expect(body.system).toContain("strict critic"); expect(body.system).toContain("Exact semantic criteria.");
  });
  it("keeps requested temperature in policy/migration while exposing effective omission and role intent", () => {
    const env = { DREAMGRAPH_LLM_PROVIDER: "openai", DREAMGRAPH_LLM_DREAMER_MODEL: "gpt-6.1-sol", DREAMGRAPH_LLM_DREAMER_TEMPERATURE: "0.9" };
    const policy = resolveRolePolicy({ role: "dreamer", env });
    expect(policy).toMatchObject({ requested: { temperature: 0.9 }, effective: { model: "gpt-6.1-sol", temperature: null }, temperature_control: { support: "unsupported" } });
    expect(policy.cognitive_instruction).toContain("hypotheses/dreams");
    expect(previewLegacyRoleMigration(env).roles.dreamer?.temperature).toBe(0.9);
    const cli = resolveRolePolicy({ role: "architect", env: { DREAMGRAPH_LLM_PROVIDER: "openai", DREAMGRAPH_LLM_ARCHITECT_ADAPTER: "codex-cli", DREAMGRAPH_LLM_ARCHITECT_MODEL: "gpt-6.1-sol" } });
    expect(cli.effective.temperature).toBeNull(); expect(cli.cognitive_instruction).toContain("architect");
  });
  it("does not let capability evidence for another model enable temperature", () => {
    const env = { DREAMGRAPH_LLM_PROVIDER: "openai", DREAMGRAPH_LLM_NORMALIZER_MODEL: "user-custom" };
    const capability = { adapter: "openai-api", version: "fixture", model: "different-custom", apis: ["responses" as const], efforts: null, retention: [], strict_schema: false, temperature: true };
    expect(resolveRolePolicy({ role: "normalizer", env, capabilities: capability }).effective.temperature).toBeNull();
    expect(resolveRolePolicy({ role: "normalizer", env, capabilities: { ...capability, model: "user-custom" } }).effective.temperature).toBe(0.1);
  });
  it("blocks unsupported none without a provider request or automatic effort escalation", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(createLlmProviderForConfig(config("openai", "gpt-6.1-sol")).complete([{ role: "user", content: "Validate" }], { reasoningEffort: "none", cognitiveRole: "normalizer" })).rejects.toThrow("REASONING_EFFORT_UNSUPPORTED");
    await expect(completeWithNativeTools({ ...config("openai", "gpt-6-astra"), reasoningEffort: "none" }, [{ role: "user", content: "Inspect" }], [])).rejects.toThrow("REASONING_EFFORT_UNSUPPORTED");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("preserves daemon role and exposes omitted temperature in route provenance", async () => {
    vi.stubEnv("DREAMGRAPH_LLM_DREAMER_MODEL", "gpt-6.1-sol"); vi.stubEnv("DREAMGRAPH_LLM_DREAMER_REASONING_EFFORT", "low");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: [] })));
    initLlmProvider(config("openai", "gpt-4.1"));
    const route = await selectLlmRoute({ task: "dream_generation" });
    expect(route.options).toMatchObject({ model: "gpt-6.1-sol", cognitiveRole: "dreamer", reasoningEffort: "low" });
    expect(route.options).not.toHaveProperty("temperature");
    expect(route.provenance).toMatchObject({ cognitive_role: "dreamer", temperature_omitted: expect.any(String) });
  });
});
