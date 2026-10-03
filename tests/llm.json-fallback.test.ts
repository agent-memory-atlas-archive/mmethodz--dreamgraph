import { installOfflineAdmissionFixtures } from "./helpers/offline-admission.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLlmProviderForConfig } from "../src/cognitive/llm.js";
import type { ProviderCapability } from "../src/config/provider-capabilities.js";
afterEach(() => vi.unstubAllGlobals());
const schema = { name: "evidence", schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false } };
// Contract checks use a finite allowance for real durable admission under parallel CI.
// They do not measure provider timeout latency.
const config = { provider: "lmstudio" as const, model: "custom", baseUrl: "http://localhost:1234/v1", apiKey: "fixture", temperature: 0.3, maxTokens: 1000, timeoutMs: 10000 };
const capability: ProviderCapability = { provider: "lmstudio", model: "custom", version: "fixture-1", source: "offline-fixture", apis: ["chat-completions"], default_api: "chat-completions", efforts: [], strict_schema: true, tools: true, images: false };
const response = () => Response.json({ choices: [{ message: { content: JSON.stringify({ ok: true }) }, finish_reason: "stop" }] });
const rejected = () => Response.json({ error: { message: "response_format json_schema unsupported" } }, { status: 400 });
installOfflineAdmissionFixtures();

describe("explicit schema contracts", () => {
  it("blocks unqualified strict generation without a request", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(createLlmProviderForConfig(config).complete([], { jsonSchema: schema })).rejects.toThrow("STRICT_SCHEMA_CAPABILITY_REQUIRED"); expect(fetch).not.toHaveBeenCalled();
  });
  it("does not silently downgrade a qualified strict request", async () => {
    const fetch = vi.fn(rejected); vi.stubGlobal("fetch", fetch);
    await expect(createLlmProviderForConfig({ ...config, capability }).complete([], { jsonSchema: schema })).rejects.toThrow("400"); expect(fetch).toHaveBeenCalledOnce();
  });
  it("uses explicit local validation, discloses it, and never poisons later contracts", async () => {
    const bodies: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, options) => { bodies.push(JSON.parse(options.body)); return bodies.length % 2 ? rejected() : response(); }));
    const provider = createLlmProviderForConfig({ ...config, capability });
    for (let i = 0; i < 2; i++) expect((await provider.complete([], { jsonSchema: schema, schemaFallback: "local_validation" })).outputContract).toMatchObject({ mode: "local_validation", capabilityVersion: "fixture-1", fallbackReason: expect.stringContaining("explicitly authorized") });
    expect(bodies.map(b => b.response_format.type)).toEqual(["json_schema", "json_object", "json_schema", "json_object"]);
  });
  it("does not retry auth failures even with fallback authorization", async () => {
    const fetch = vi.fn(async () => new Response("unauthorized", { status: 401 })); vi.stubGlobal("fetch", fetch);
    await expect(createLlmProviderForConfig({ ...config, capability }).complete([], { jsonSchema: schema, schemaFallback: "local_validation" })).rejects.toThrow("401"); expect(fetch).toHaveBeenCalledOnce();
  });
  it("validates original schema after explicit unqualified JSON mode", async () => {
    const fetch = vi.fn(async (_url, options) => { expect(JSON.parse(options.body).response_format).toEqual({ type: "json_object" }); return Response.json({ choices: [{ message: { content: JSON.stringify({ ok: "yes" }) } }], usage: { completion_tokens: 7 } }); }); vi.stubGlobal("fetch", fetch);
    await expect(createLlmProviderForConfig(config).complete([], { jsonSchema: schema, schemaFallback: "local_validation" })).rejects.toMatchObject({ code: "PROVIDER_OUTPUT_INVALID", usage: { outputTokens: 7 } }); expect(fetch).toHaveBeenCalledOnce();
  });
  it("binds override evidence to exactly one provider/model", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(createLlmProviderForConfig({ ...config, capability: { ...capability, model: "other" } }).complete([], { jsonSchema: schema })).rejects.toThrow("PROVIDER_CAPABILITY_MISMATCH"); expect(fetch).not.toHaveBeenCalled();
  });
  it("discloses only an authorized Responses schema retry with one shared signal", async () => {
    const bodies: any[] = [], signals: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, options) => { bodies.push(JSON.parse(options.body)); signals.push(options.signal); return bodies.length === 1 ? rejected() : Response.json({ status: "completed", output_text: '{"ok":true}', usage: { output_tokens: 8 } }); }));
    const provider = createLlmProviderForConfig({ ...config, provider: "openai", model: "gpt-6.1-sol", baseUrl: "https://provider.invalid/v1", capability: undefined });
    const result = await provider.complete([], { api: "responses", jsonSchema: schema, schemaFallback: "local_validation" });
    expect(bodies.map(body => body.text.format.type)).toEqual(["json_schema", "json_object"]); expect(signals[0]).toBe(signals[1]); expect(result.outputContract).toMatchObject({ mode: "local_validation", fallbackReason: expect.stringContaining("explicitly authorized") }); expect(result.usage?.outputTokens).toBe(8);
  });

});
