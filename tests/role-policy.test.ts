import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { snapshotRolePolicy, resolveRolePolicy, MODEL_ROLES, previewLegacyRoleMigration, saveRoleProfiles, restoreRoleProfiles, readRoleProfiles, inspectRolePolicies, type RoleAdapterCapabilities } from "../src/config/role-policy.js";
import { setDataDirOverride } from "../src/utils/paths.js";
import { releaseGraphWriter } from "../src/graph/writer-lease.js";
import { loadPublicationState } from "../src/graph/publication.js";

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "dg-role-policy-")); setDataDirOverride(root); });
afterEach(async () => { vi.unstubAllGlobals(); await releaseGraphWriter(root); setDataDirOverride(null); await rm(root, { recursive: true, force: true }); });
const capabilities: RoleAdapterCapabilities = { adapter: "openai-api", model: "custom-fixture", version: "fixture:1", apis: ["responses", "chat_completions"], efforts: ["none", "low", "medium", "high"], retention: ["store_false", "store_true"], strict_schema: true };
describe("independent model role policies", () => {
  it.each(["ollama", "lmstudio", "none"])("native CLI policy does not inherit %s API compatibility", provider => {
    const result = resolveRolePolicy({ role: "architect", env: {}, session: { provider: provider as "ollama", model: "fixture-native", adapter: "codex-cli", api: "native_cli" },
      capabilities: { adapter: "codex-cli", model: "fixture-native", version: "fixture-native.v1", apis: ["native_cli"], efforts: [], retention: [], strict_schema: false } });
    expect(result.status).toBe("configured"); expect(result.billing.channel).toBe("subscription"); expect(result.effective.api).toBe("native_cli");
  });
  it("freezes effective policy evidence independently from later configuration edits", () => {
    const current = resolveRolePolicy({ role: "dreamer", env: { DREAMGRAPH_LLM_PROVIDER: "openai", DREAMGRAPH_LLM_DREAMER_MODEL: "gpt-6.1-sol" } });
    const snapshot = snapshotRolePolicy(current);
    current.effective.model = "another-model"; current.policy.budget.requests = 1;
    expect(snapshot.effective.model).toBe("gpt-6.1-sol"); expect(snapshot.policy.budget.requests).toBe(64);
    expect(Object.isFrozen(snapshot.policy.budget)).toBe(true); expect(Object.isFrozen(snapshot.cognitive_instruction)).toBe(true);
    expect(snapshot.fingerprint).not.toContain("another-model");
  });
  it("preserves user-selected scan/dreamer/normalizer/frontier models independently without provider calls", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const env = { DREAMGRAPH_LLM_PROVIDER: "openai", DREAMGRAPH_LLM_INITIAL_SCAN_MODEL: "gpt-4.1", DREAMGRAPH_LLM_DREAMER_MODEL: "gpt-5.4", DREAMGRAPH_LLM_NORMALIZER_MODEL: "gpt-future-custom", DREAMGRAPH_LLM_ENRICHMENT_MODEL: "gpt-4.1-mini", DREAMGRAPH_LLM_ARCHITECT_ADAPTER: "codex-cli", DREAMGRAPH_LLM_ARCHITECT_MODEL: "gpt-6.1-sol" };
    expect(MODEL_ROLES.map(role => resolveRolePolicy({ role, env }).requested.model)).toEqual(["gpt-4.1", "gpt-4.1-mini", "gpt-5.4", "gpt-future-custom", "gpt-6.1-sol", "gpt-4o-mini"]);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("separates provider endpoints and credentials instead of inheriting another provider's model or key", () => {
    const policy = resolveRolePolicy({ role: "normalizer", env: { DREAMGRAPH_LLM_PROVIDER: "openai", DREAMGRAPH_LLM_MODEL: "gpt-4.1", DREAMGRAPH_LLM_API_KEY: "secret-do-not-copy", DREAMGRAPH_LLM_NORMALIZER_PROVIDER: "anthropic", DREAMGRAPH_LLM_NORMALIZER_MODEL: "claude-user-model", DREAMGRAPH_LLM_NORMALIZER_API_KEY: "another-secret" } });
    expect(policy).toMatchObject({ status: "configured", requested: { temperature: 0.1 }, effective: { provider: "anthropic", model: "claude-user-model", api: "messages", temperature: null }, temperature_control: { support: "unknown" }, connection: { base_url: "https://api.anthropic.com/v1", api_key_env: "DREAMGRAPH_LLM_NORMALIZER_API_KEY" } });
    expect(JSON.stringify(policy)).not.toContain("secret");
    expect(resolveRolePolicy({ role: "normalizer", env: { DREAMGRAPH_LLM_PROVIDER: "openai", DREAMGRAPH_LLM_MODEL: "gpt-4.1", DREAMGRAPH_LLM_NORMALIZER_PROVIDER: "anthropic" } }).requested.model).toBe("claude-sonnet-5-5");
  });
  it("uses explicit session, role env, saved role, legacy and provider defaults in order", () => {
    const shared = { role: "dreamer" as const, env: { DREAMGRAPH_LLM_MODEL: "legacy-model", DREAMGRAPH_LLM_DREAMER_MODEL: "role-model" }, saved: { model: "saved-model" } };
    expect(resolveRolePolicy({ ...shared, session: { model: "session-model" } }).requested.model).toBe("session-model");
    expect(resolveRolePolicy(shared).requested.model).toBe("role-model");
    expect(resolveRolePolicy({ ...shared, env: {} }).requested.model).toBe("saved-model");
    expect(resolveRolePolicy({ role: "dreamer", env: { DREAMGRAPH_LLM_MODEL: "legacy-model" } }).requested.model).toBe("legacy-model");
  });
  it.each(["-1", "NaN", "2.5", "0"])("blocks an invalid output limit %s instead of silently applying it", output => {
    const result = resolveRolePolicy({ role: "dreamer", env: { DREAMGRAPH_LLM_DREAMER_MAX_TOKENS: output } });
    expect(result.status).toBe("blocked"); expect(result.diagnostics.some(d => d.field === "output_tokens")).toBe(true);
  });
  it("keeps explicit API/effort/retention and requires capability evidence for unsupported controls", () => {
    const env = { DREAMGRAPH_LLM_PROVIDER: "openai", DREAMGRAPH_LLM_DREAMER_MODEL: "custom-fixture", DREAMGRAPH_LLM_DREAMER_API: "responses", DREAMGRAPH_LLM_DREAMER_REASONING_EFFORT: "high", DREAMGRAPH_LLM_DREAMER_RETENTION: "store_false", DREAMGRAPH_LLM_DREAMER_STRICT_SCHEMA: "true" };
    const pending = resolveRolePolicy({ role: "dreamer", env });
    expect(pending.status).toBe("capability_required");
    const ready = resolveRolePolicy({ role: "dreamer", env, capabilities });
    expect(ready).toMatchObject({ status: "configured", effective: { api: "responses", effort: "high", retention: "store_false", strict_schema: true } });
    expect(ready.policy.budget).toMatchObject({ run_amount: 0, day_amount: 0 });
    expect(resolveRolePolicy({ role: "dreamer", env, capabilities: { ...capabilities, efforts: ["low"] } }).diagnostics.map(d => d.code)).toContain("EFFORT_UNSUPPORTED");
  });
  it("does not equate request storage with provider/account Zero Data Retention", () => {
    const env = { DREAMGRAPH_LLM_PROVIDER: "openai", DREAMGRAPH_LLM_NORMALIZER_RETENTION: "zero_retention" };
    const policy = resolveRolePolicy({ role: "normalizer", env, capabilities });
    expect(policy).toMatchObject({ status: "blocked", policy: { retention: { requested: "zero_retention", effective: null } } });
    expect(policy.diagnostics.map(d => d.code)).toContain("PROVIDER_RETENTION_UNATTESTED");
  });
  it("does not change retention or permit unpriced allocation when evaluation budget is configured", () => {
    const env = { DREAMGRAPH_LLM_PROVIDER: "openai", DREAMGRAPH_LLM_DREAMER_RUN_BUDGET: "1", DREAMGRAPH_LLM_DREAMER_DAY_BUDGET: "2", DREAMGRAPH_LLM_DREAMER_RETENTION: "store_false" };
    expect(resolveRolePolicy({ role: "dreamer", env }).diagnostics.map(d => d.code)).toContain("PRICING_REQUIRED");
    const policy = resolveRolePolicy({ role: "dreamer", env: { ...env, DREAMGRAPH_LLM_DREAMER_PRICING_VERSION: "explicit-fixture-price:1" } });
    expect(policy.status).toBe("configured"); expect(policy.effective.retention).toBe("store_false");
  });
  it("normalizes CLI identity while preserving native control and separate billing", () => {
    const env = { DREAMGRAPH_LLM_PROVIDER: "openai", DREAMGRAPH_LLM_ARCHITECT_ADAPTER: "codex-cli", DREAMGRAPH_LLM_ARCHITECT_MODEL: "codex-cli/gpt-6.1-sol" };
    const policy = resolveRolePolicy({ role: "architect", env });
    expect(policy).toMatchObject({ effective: { model: "gpt-6.1-sol", api: "native_cli" }, requested: { model: "codex-cli/gpt-6.1-sol" }, billing: { channel: "subscription", currency: "subscription_units" } });
    expect(resolveRolePolicy({ role: "architect", env: { ...env, DREAMGRAPH_LLM_ARCHITECT_API: "responses" } }).diagnostics.map(d => d.code)).toContain("API_CLI_CONTRACT_MISMATCH");
    expect(resolveRolePolicy({ role: "architect", env: { ...env, DREAMGRAPH_LLM_ARCHITECT_BUDGET_CURRENCY: "USD" } }).diagnostics.map(d => d.code)).toContain("BILLING_CHANNEL_MISMATCH");
  });
  it("blocks incompatible providers and local-only disclosure to remote endpoints", () => {
    expect(resolveRolePolicy({ role: "dreamer", env: { DREAMGRAPH_LLM_PROVIDER: "anthropic", DREAMGRAPH_LLM_DREAMER_API: "responses" } }).diagnostics.map(d => d.code)).toContain("PROVIDER_API_UNSUPPORTED");
    expect(resolveRolePolicy({ role: "dreamer", env: { DREAMGRAPH_LLM_PROVIDER: "ollama", DREAMGRAPH_LLM_URL: "https://localhost.evil.example", DREAMGRAPH_LLM_DREAMER_RETENTION: "local_only" } }).diagnostics.map(d => d.code)).toContain("LOCAL_ONLY_UNSATISFIED");
    expect(resolveRolePolicy({ role: "dreamer", env: { DREAMGRAPH_LLM_PROVIDER: "ollama", DREAMGRAPH_LLM_DREAMER_RETENTION: "local_only" } }).status).toBe("configured");
  });
  it("retains explicit fallback provenance and does not invent model escalation", () => {
    const policy = resolveRolePolicy({ role: "normalizer", env: {}, saved: { fallbacks: [{ provider: "openai", model: "user-fallback", adapter: "openai-api", approved: false }] } });
    expect(policy.policy.fallbacks).toEqual([{ provider: "openai", model: "user-fallback", adapter: "openai-api", approved: false }]);
    expect(resolveRolePolicy({ role: "normalizer", env: {} }).policy.fallbacks).toEqual([]);
  });
  it("previews legacy migration without changing models, secrets, files or paid permissions", async () => {
    const preview = previewLegacyRoleMigration({ DREAMGRAPH_LLM_PROVIDER: "openai", DREAMGRAPH_LLM_DREAMER_MODEL: "gpt-5.4", DREAMGRAPH_LLM_NORMALIZER_MODEL: "gpt-custom", DREAMGRAPH_LLM_API_KEY: "migration-secret" });
    expect(preview.roles.dreamer?.model).toBe("gpt-5.4"); expect(preview.roles.normalizer?.model).toBe("gpt-custom");
    expect(preview.roles.dreamer?.budget?.run_amount).toBe(0); expect(JSON.stringify(preview)).not.toContain("migration-secret");
    expect((await readRoleProfiles()).revision).toBe(0);
  });
  it("persists configuration with CAS/replay and explicit rollback while keeping graph time unchanged", async () => {
    const first = await saveRoleProfiles({ expected_revision: 0, operation_id: "policy:1", roles: { dreamer: { provider: "openai", model: "gpt-user-model" } } });
    expect(first.revision).toBe(1);
    expect((await saveRoleProfiles({ expected_revision: 0, operation_id: "policy:1", roles: first.roles })).revision).toBe(1);
    await expect(saveRoleProfiles({ expected_revision: 0, operation_id: "policy:stale", roles: {} })).rejects.toThrow("ROLE_PROFILE_REVISION_CONFLICT");
    const next = await saveRoleProfiles({ expected_revision: 1, operation_id: "policy:2", roles: { dreamer: { model: "new-user-model" } } });
    expect(next.previous).toHaveLength(2);
    const restored = await restoreRoleProfiles({ revision: 1, expected_revision: 2, operation_id: "policy:restore" });
    expect(restored.roles.dreamer?.model).toBe("gpt-user-model");
    expect((await inspectRolePolicies()).find(policy => policy.policy.role === "dreamer")?.requested.model).toBe("gpt-user-model");
    expect((await loadPublicationState()).currency.last_graph_mutation_at).toBeNull();
  });
  it("never silently resets a corrupt persisted profile", async () => {
    await writeFile(join(root, "role_profiles.json"), '{"schema":"dreamgraph.role_profiles.v99"}');
    await expect(readRoleProfiles()).rejects.toThrow("ROLE_PROFILES_UNAVAILABLE");
  });
});
