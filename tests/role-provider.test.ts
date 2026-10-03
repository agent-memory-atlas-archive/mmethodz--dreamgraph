import { installOfflineAdmissionFixtures } from "./helpers/offline-admission.js";
import { probeLlmReadiness } from "../src/cognitive/llm-readiness.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setDataDirOverride } from "../src/utils/paths.js";
import { releaseGraphWriter } from "../src/graph/writer-lease.js";
import { getRoleLlmProvider, initLlmProvider, selectLlmRoute } from "../src/cognitive/llm.js";
import { saveRoleProfiles } from "../src/config/role-policy.js";
let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "dg-role-provider-")); setDataDirOverride(root); initLlmProvider({ provider: "none", model: "none", baseUrl: "", apiKey: "", temperature: 0.2, maxTokens: 2000, timeoutMs: 10000 }); });
afterEach(async () => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); await releaseGraphWriter(root); setDataDirOverride(null); await rm(root, { recursive: true, force: true }); });
const messages = [{ role: "user" as const, content: "Classify supplied evidence" }];
installOfflineAdmissionFixtures({ directory: false });

describe("role policy dispatch", () => {
  it("keeps normalizer and dreamer provider/model/secret/protocol independent", async () => {
    for (const [key, value] of Object.entries({ DREAMGRAPH_LLM_NORMALIZER_PROVIDER: "anthropic", DREAMGRAPH_LLM_NORMALIZER_MODEL: "claude-sonnet-5-5", DREAMGRAPH_LLM_NORMALIZER_API_KEY: "normalizer-fixture", DREAMGRAPH_LLM_NORMALIZER_REASONING_EFFORT: "high", DREAMGRAPH_LLM_DREAMER_PROVIDER: "openai", DREAMGRAPH_LLM_DREAMER_MODEL: "gpt-5.4", DREAMGRAPH_LLM_DREAMER_API_KEY: "dreamer-fixture", DREAMGRAPH_LLM_DREAMER_REASONING_EFFORT: "none" })) vi.stubEnv(key, value);
    const calls: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init) => { const body = JSON.parse(init.body); calls.push({ url, body, headers: init.headers }); return Response.json(body.model.startsWith("claude") ? { content: [{ type: "text", text: "{}" }], stop_reason: "end_turn" } : { output_text: "{}", status: "completed" }); }));
    const normalizer = await getRoleLlmProvider("normalizer"), dreamer = await getRoleLlmProvider("dreamer");
    await normalizer.provider.complete(messages, { jsonMode: true }); await dreamer.provider.complete(messages, { jsonMode: true });
    expect(calls[0]).toMatchObject({ url: "https://api.anthropic.com/v1/messages", headers: { "x-api-key": "normalizer-fixture" }, body: { model: "claude-sonnet-5-5", output_config: { effort: "high" } } });
    expect(calls[1]).toMatchObject({ url: "https://api.openai.com/v1/responses", headers: { Authorization: "Bearer dreamer-fixture" }, body: { model: "gpt-5.4", reasoning: { effort: "none" } } });
    expect(JSON.stringify(normalizer.policy)).not.toContain("normalizer-fixture"); expect(JSON.stringify(dreamer.policy)).not.toContain("dreamer-fixture");
  });
  it("binds saved configuration and request limits once despite later profile changes", async () => {
    vi.stubEnv("ROLE_TEST_KEY", "fixture");
    const profile = { provider: "openai" as const, model: "gpt-4.1", api_key_env: "ROLE_TEST_KEY", output_tokens: 200 };
    await saveRoleProfiles({ expected_revision: 0, roles: { dreamer: profile }, operation_id: "first" });
    const bound = await getRoleLlmProvider("dreamer");
    await saveRoleProfiles({ expected_revision: 1, roles: { dreamer: { ...profile, model: "gpt-6.1-sol" } }, operation_id: "second" });
    let body: any;
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => { body = JSON.parse(init.body); return Response.json({ output_text: "{}", status: "completed" }); }));
    await bound.provider.complete(messages, { maxTokens: 10000 });
    expect(body).toMatchObject({ model: "gpt-4.1", max_output_tokens: 200 }); expect(bound.policy.policy.revision).toBe(1); expect(Object.isFrozen(bound.config)).toBe(true);
    expect((await getRoleLlmProvider("dreamer")).config.model).toBe("gpt-6.1-sol");
  });
  it("rejects model/storage/schema-guarantee substitutions before dispatch", async () => {
    vi.stubEnv("ROLE_TEST_KEY", "fixture");
    await saveRoleProfiles({ expected_revision: 0, roles: { normalizer: { provider: "openai", model: "gpt-4.1", strict_schema: true, retention: "store_false", api_key_env: "ROLE_TEST_KEY" } }, operation_id: "first" });
    const bound = await getRoleLlmProvider("normalizer"), fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(bound.provider.complete(messages, { model: "gpt-6.1-sol" })).rejects.toThrow("ROLE_POLICY_REQUEST_MISMATCH");
    await expect(bound.provider.complete(messages, { store: true })).rejects.toThrow("ROLE_POLICY_REQUEST_MISMATCH");
    await expect(bound.provider.complete(messages, { jsonMode: true })).rejects.toThrow("ROLE_STRICT_SCHEMA_REQUIRED");
    await expect(bound.provider.complete(messages, { jsonSchema: { name: "x", schema: { type: "object" } }, schemaFallback: "local_validation" })).rejects.toThrow("ROLE_SCHEMA_FALLBACK_DISALLOWED"); expect(fetch).not.toHaveBeenCalled();
  });
  it("allows exact qualified custom models but blocks unsupported effort without escalation", async () => {
    vi.stubEnv("ROLE_TEST_KEY", "fixture");
    await saveRoleProfiles({ expected_revision: 0, roles: { dreamer: { provider: "openai", model: "custom", effort: "high", api_key_env: "ROLE_TEST_KEY", capability: { provider: "openai", model: "custom", version: "fixture", source: "offline-fixture", apis: ["responses"], default_api: "responses", efforts: ["high"], strict_schema: true, tools: false, images: false } } }, operation_id: "custom" });
    expect((await getRoleLlmProvider("dreamer")).policy.status).toBe("configured");
    await expect(getRoleLlmProvider("dreamer", { effort: "xhigh" })).rejects.toThrow("EFFORT_UNSUPPORTED");
  });
  it("routes enrichment through its own role rather than the dreamer model", async () => {
    vi.stubEnv("DREAMGRAPH_LLM_ENRICHMENT_PROVIDER", "openai"); vi.stubEnv("DREAMGRAPH_LLM_ENRICHMENT_MODEL", "gpt-4.1-mini"); vi.stubEnv("DREAMGRAPH_LLM_ENRICHMENT_API_KEY", "fixture");
    vi.stubEnv("DREAMGRAPH_LLM_DREAMER_MODEL", "gpt-6.1-sol"); vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: [] })));
    const route = await selectLlmRoute({ task: "graph_enrichment", daemon_component: "dreamer" });
    expect(route.options).toMatchObject({ model: "gpt-4.1-mini", cognitiveRole: "enrichment", api: "responses" });
    expect(route.provenance.role_policy_fingerprint).toMatch(/^sha256:/);
  });
  it("never treats native CLI policy as an API transport", async () => {
    vi.stubEnv("DREAMGRAPH_LLM_DREAMER_PROVIDER", "openai"); vi.stubEnv("DREAMGRAPH_LLM_DREAMER_ADAPTER", "codex-cli"); vi.stubEnv("DREAMGRAPH_LLM_DREAMER_MODEL", "codex-cli/gpt-6.1-sol");
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(getRoleLlmProvider("dreamer")).rejects.toThrow("ROLE_NATIVE_CLI_REQUIRED"); expect(fetch).not.toHaveBeenCalled();
  });
});

it('qualifies independent roles from real work without recurring paid probes', async () => {
  for (const role of ['DREAMER','NORMALIZER']) {
    vi.stubEnv('DREAMGRAPH_LLM_'+role+'_PROVIDER','openai'); vi.stubEnv('DREAMGRAPH_LLM_'+role+'_MODEL','gpt-4.1');
    vi.stubEnv('DREAMGRAPH_LLM_'+role+'_API_KEY','fixture');
    vi.stubEnv('DREAMGRAPH_LLM_'+role+'_URL','https://qualification-fixture.invalid');
  }
  const fetch = vi.fn(async (_url, init) => init?.method === 'POST' ? Response.json({ status:'completed', output_text:'{}' }) : Response.json({ data:[] }));
  vi.stubGlobal('fetch',fetch);
  const first = await probeLlmReadiness(); expect(first).toMatchObject({state:'unknown',reason:'completion_unqualified'});
  expect(fetch.mock.calls.every(call => call[1]?.method !== 'POST')).toBe(true);
  const dreamer = await getRoleLlmProvider('dreamer'); await dreamer.provider.complete(messages,{jsonMode:true});
  expect((await probeLlmReadiness()).state).toBe('unknown');
  const normalizer = await getRoleLlmProvider('normalizer'); await normalizer.provider.complete(messages,{jsonMode:true});
  expect((await probeLlmReadiness()).state).toBe('ready');
  vi.stubEnv('DREAMGRAPH_LLM_NORMALIZER_MODEL','gpt-5.4');
  expect((await probeLlmReadiness()).state).toBe('unknown');
  expect(fetch.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(2);
});
