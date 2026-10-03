/** Independent, inspectable role policies. Resolution never probes or buys a model. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { RolePolicySchema, BudgetSchema } from "../graph/contracts.js";
import { dataPath } from "../utils/paths.js";
import { stripBom } from "../utils/read-json.js";
import { withGraphRead, withGraphReconciliation } from "../utils/graph-reconciliation-barrier.js";
import { commitGraphWrites, loadPublicationState, publicationContentHash, recoverGraphPublication } from "../graph/publication.js";
import type { LlmConfig, LlmProviderType } from "../cognitive/llm.js";
import { MODEL_ROLES, ROLE_SETTING_FIELDS, ROLE_BUDGET_FIELDS, roleEnvKey } from "./role-env-fields.js";
import { modelTemperatureCapability, assertReasoningEffort, type TemperatureCapability } from "./model-temperature.js";
import { cognitiveRoleInstruction } from "../cognitive/role-instructions.js";
import { providerCapability, ProviderCapabilitySchema, type ProviderCapability } from "./provider-capabilities.js";

export { MODEL_ROLES } from "./role-env-fields.js";
export type ModelRole = typeof MODEL_ROLES[number];
import { ProviderSchema, ApiSchema, RoleSettingsSchema, type RoleSettings } from "./role-settings.js";
export { RoleSettingsSchema, type RoleSettings } from "./role-settings.js";
type Policy = z.infer<typeof RolePolicySchema>;
export interface RoleAdapterCapabilities {
  adapter: string; version: string; apis: Array<Policy["api"]>;
  model?: string;
  temperature?: boolean;
  efforts: string[] | null; retention: Array<NonNullable<RoleSettings["retention"]>>;
  strict_schema: boolean; provider_retention_attested?: string;
}
export interface ResolvedRolePolicy {
  policy: Policy;
  requested: { provider: string; model: string; adapter: string; api: string; effort: string | null; retention: string; temperature: number };
  effective: { provider: string; model: string; adapter: string; api: Policy["api"]; effort: string | null; retention: string | null; output_tokens: number; context_tokens: number; timeout_ms: number; temperature: number | null; strict_schema: boolean };
  temperature_control: TemperatureCapability;
  cognitive_instruction: string;
  status: "configured" | "blocked" | "capability_required";
  diagnostics: Array<{ field: string; code: string; message: string }>;
  origins: Record<string, "session" | "role_env" | "saved" | "legacy" | "default">;
  fingerprint: string;
  capability: ProviderCapability | null;
  billing: { channel: "local" | "api" | "subscription" | "client"; principal: string; currency: string; pricing_version: string | null };
  connection: { base_url: string; api_key_env: string | null }; // Reference only, never a secret.
}
const defaults = (provider: string) => ({
  ollama: { model: "qwen3:8b", url: "http://localhost:11434" }, lmstudio: { model: "auto", url: "http://localhost:1234/v1" },
  openai: { model: "gpt-4o-mini", url: "https://api.openai.com/v1" }, anthropic: { model: "claude-sonnet-5-5", url: "https://api.anthropic.com/v1" },
  sampling: { model: "client", url: "" }, none: { model: "none", url: "" },
}[provider] ?? { model: "none", url: "" });
const key = roleEnvKey;
const hash = (value: unknown) => "sha256:" + createHash("sha256").update(JSON.stringify(value)).digest("hex");
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable((value as Record<string, unknown>)[key])])) : value;

export function resolveRolePolicy(input: {
  role: ModelRole; env?: Record<string, string | undefined>; saved?: RoleSettings; session?: RoleSettings;
  legacy?: LlmConfig; revision?: number; capabilities?: RoleAdapterCapabilities;
}): ResolvedRolePolicy {
  const env = input.env ?? process.env, role = input.role;
  const saved = RoleSettingsSchema.parse(input.saved ?? {}), session = RoleSettingsSchema.parse(input.session ?? {});
  const diagnostics: ResolvedRolePolicy["diagnostics"] = [], origins: ResolvedRolePolicy["origins"] = {};
  const envSettings: Record<string, unknown> = {};
  for (const [field, suffix] of Object.entries(ROLE_SETTING_FIELDS)) {
    const raw = env[key(role, suffix)]?.trim();
    if (raw === undefined || raw === "") continue;
    if (["temperature", "output_tokens", "context_tokens", "timeout_ms"].includes(field)) envSettings[field] = Number(raw);
    else if (field === "strict_schema") envSettings[field] = raw === "true" ? true : raw === "false" ? false : raw;
    else if (field === "fallbacks" || field === "capability") {
      try { envSettings[field] = JSON.parse(raw); }
      catch { diagnostics.push({ field, code: "INVALID_ROLE_SETTING", message: `${key(role, suffix)} must contain valid JSON.` }); }
    } else envSettings[field] = raw;
  }
  const parsed = RoleSettingsSchema.safeParse(envSettings);
  let roleEnv: RoleSettings = {};
  if (parsed.success) roleEnv = parsed.data;
  else for (const issue of parsed.error.issues) diagnostics.push({ field: issue.path.join("."), code: "INVALID_ROLE_SETTING", message: issue.message });
  const choose = <K extends keyof RoleSettings>(field: K, legacy: RoleSettings[K], fallback: RoleSettings[K]): RoleSettings[K] => {
    for (const [source, values] of [["session", session], ["role_env", roleEnv], ["saved", saved]] as const) {
      if (values[field] !== undefined) { origins[field] = source; return values[field]; }
    }
    origins[field] = legacy !== undefined ? "legacy" : "default";
    return legacy !== undefined ? legacy : fallback;
  };
  const legacyProvider = env.DREAMGRAPH_LLM_PROVIDER ?? input.legacy?.provider;
  const provider = choose("provider", legacyProvider as LlmProviderType | undefined, "ollama")!;
  if (!ProviderSchema.safeParse(provider).success) diagnostics.push({ field: "provider", code: "INVALID_PROVIDER", message: `Unknown provider ${provider}.` });
  const sameProvider = provider === (legacyProvider ?? "ollama");
  const legacyModel = sameProvider ? env.DREAMGRAPH_LLM_MODEL ?? (input.legacy?.model || undefined) : undefined;
  const model = choose("model", legacyModel, defaults(provider).model)!;
  const requestedAdapter = choose("adapter", undefined, provider === "sampling" ? "mcp-sampling" : provider === "none" ? "none" : `${provider}-api`)!;
  // The browser's existing native API adapter name is a presentation alias.
  const adapter = requestedAdapter === "native_api_tool_loop" ? `${provider}-api` : requestedAdapter;
  const requestedApi = choose("api", env.DREAMGRAPH_LLM_API as RoleSettings["api"], "auto")!;
  const selectedApi: Policy["api"] = adapter.endsWith("-cli") ? "native_cli" : requestedApi !== "auto" ? requestedApi
    : provider === "openai" ? "responses" : provider === "anthropic" ? "messages" : provider === "lmstudio" ? "chat_completions" : "local";
  const api = RolePolicySchema.shape.api.safeParse(selectedApi).success ? selectedApi : "local";
  if (!ApiSchema.safeParse(requestedApi).success) diagnostics.push({ field: "api", code: "INVALID_ROLE_SETTING", message: `Unknown requested API ${requestedApi}.` });
  const effort = choose("effort", env.DREAMGRAPH_LLM_REASONING_EFFORT ?? undefined, null) ?? null;
  const retention = choose("retention", env.DREAMGRAPH_LLM_RETENTION as RoleSettings["retention"], "provider_default")!;
  const timeout_ms = choose("timeout_ms", env.DREAMGRAPH_LLM_TIMEOUT_MS ? Number(env.DREAMGRAPH_LLM_TIMEOUT_MS) : input.legacy?.timeoutMs, 120_000)!;
  const output_tokens = choose("output_tokens", env.DREAMGRAPH_LLM_MAX_TOKENS ? Number(env.DREAMGRAPH_LLM_MAX_TOKENS) : input.legacy?.maxTokens, 2048)!;
  const context_tokens = choose("context_tokens", env.DREAMGRAPH_LLM_CONTEXT_TOKENS ? Number(env.DREAMGRAPH_LLM_CONTEXT_TOKENS) : undefined, 32768)!;
  const temperature = choose("temperature", env.DREAMGRAPH_LLM_TEMPERATURE ? Number(env.DREAMGRAPH_LLM_TEMPERATURE) : role === "normalizer" ? 0.1 : input.legacy?.temperature, role === "dreamer" ? 0.7 : 0.2)!;
  const strict_schema = choose("strict_schema", undefined, false)!;
  const base_url = choose("base_url", sameProvider ? env.DREAMGRAPH_LLM_URL ?? input.legacy?.baseUrl : undefined, defaults(provider).url)!;
  const roleSecret = key(role, "API_KEY");
  const api_key_env = choose("api_key_env", env[roleSecret] !== undefined ? roleSecret : sameProvider && (provider === "openai" || provider === "anthropic" || provider === "lmstudio") ? "DREAMGRAPH_LLM_API_KEY" : undefined, undefined) ?? null;
  const local = provider === "ollama" || provider === "lmstudio" || provider === "none";
  const channel = api === "native_cli" ? "subscription" : provider === "sampling" ? "client" : local ? "local" : "api";
  const budgetEnv: Record<string, unknown> = {};
  for (const [field, suffix] of Object.entries(ROLE_BUDGET_FIELDS)) {
    const raw = env[key(role, suffix)]; if (raw !== undefined && raw.trim() !== "") budgetEnv[field] = Number(raw);
  }
  if (env[key(role, "PRICING_VERSION")]) budgetEnv.pricing_version = env[key(role, "PRICING_VERSION")];
  if (env[key(role, "BILLING_PRINCIPAL")]) budgetEnv.billing_principal = env[key(role, "BILLING_PRINCIPAL")];
  if (env[key(role, "BUDGET_CURRENCY")]) budgetEnv.currency = env[key(role, "BUDGET_CURRENCY")];
  const budget = BudgetSchema.safeParse({ requests: 64, input_tokens: 250_000, output_tokens: 100_000, retries: 2, elapsed_ms: 3_600_000,
    concurrency: 1, max_hops: 2, max_neighbors: 40, run_amount: 0, day_amount: 0, currency: channel === "subscription" ? "subscription_units" : "USD",
    pricing_version: null, billing_principal: `${channel}:${provider}`, ...saved.budget, ...budgetEnv, ...session.budget });
  if (!budget.success) for (const issue of budget.error.issues) diagnostics.push({ field: `budget.${issue.path.join(".")}`, code: "INVALID_ROLE_BUDGET", message: issue.message });
  const safeBudget = budget.success ? budget.data : BudgetSchema.parse({ requests: 0, input_tokens: 0, output_tokens: 0, retries: 0, elapsed_ms: 0, concurrency: 0, max_hops: 0, max_neighbors: 0, run_amount: 0, day_amount: 0, currency: "USD", pricing_version: null, billing_principal: "blocked" });
  const settingsCheck = RoleSettingsSchema.safeParse({ provider, model, adapter, api, effort, retention, timeout_ms, output_tokens, context_tokens, temperature, base_url, strict_schema });
  if (!settingsCheck.success) for (const issue of settingsCheck.error.issues) diagnostics.push({ field: issue.path.join("."), code: "INVALID_EFFECTIVE_SETTING", message: issue.message });
  if (adapter.endsWith("-cli") && requestedApi !== "auto" && requestedApi !== "native_cli") diagnostics.push({ field: "api", code: "API_CLI_CONTRACT_MISMATCH", message: "CLI adapters use their native execution protocol; API continuation cannot be routed through them." });
  if (api !== "native_cli" && (provider === "openai" && !["responses", "chat_completions"].includes(api) || provider === "anthropic" && api !== "messages"
    || provider === "ollama" && api !== "local" || provider === "lmstudio" && api !== "chat_completions")) diagnostics.push({ field: "api", code: "PROVIDER_API_UNSUPPORTED", message: `${provider} cannot use ${api}.` });
  const effectiveModel = model.startsWith(`${adapter}/`) ? model.slice(adapter.length + 1) : model;
  let documented: ProviderCapability | null = null;
  const override = choose("capability", undefined, undefined);
  try { documented = adapter === `${provider}-api` ? providerCapability(provider, effectiveModel, override) : null; }
  catch { diagnostics.push({ field: "capability", code: "PROVIDER_CAPABILITY_MISMATCH", message: "Capability overrides must match the exact provider/model/API and carry named source/version evidence." }); }
  const capabilities: RoleAdapterCapabilities | undefined = input.capabilities ?? (documented ? {
    adapter, version: documented.version, model: effectiveModel,
    apis: documented.apis.map(value => value === "chat-completions" ? "chat_completions" : value === "anthropic-messages" ? "messages" : value === "ollama-chat" ? "local" : value),
    efforts: documented.efforts, retention: provider === "openai" ? ["store_false", "store_true"] : [], strict_schema: documented.strict_schema,
  } : undefined);
  const require = (field: string, code: string, message: string) => diagnostics.push({ field, code, message });
  try { if (api !== "native_cli") assertReasoningEffort(provider, effectiveModel, effort); }
  catch (failure) { require("effort", "EFFORT_UNSUPPORTED", String(failure)); }
  if (capabilities && (capabilities.adapter !== adapter || !capabilities.apis.includes(api) || capabilities.model !== effectiveModel)) require("adapter", "ADAPTER_CAPABILITY_MISMATCH", "Capability evidence does not establish this exact adapter/API/model combination.");
  if (effort && (!capabilities?.efforts || !capabilities.efforts.includes(effort))) require("effort", capabilities ? "EFFORT_UNSUPPORTED" : "CAPABILITY_REQUIRED", "Requested reasoning effort must be supported by this named adapter/model; it is never silently dropped.");
  if (strict_schema && !capabilities?.strict_schema) require("strict_schema", capabilities ? "STRICT_SCHEMA_UNSUPPORTED" : "CAPABILITY_REQUIRED", "Strict output guarantees need qualified adapter/model support.");
  let effectiveRetention: string | null = retention === "provider_default" ? null : retention;
  if (retention === "local_only" && (!local || api === "native_cli" || /^https?:\/\/(?!localhost(?=[:/]|$)|127\.0\.0\.1(?=[:/]|$)|\[::1\](?=[:/]|$))/.test(base_url))) require("retention", "LOCAL_ONLY_UNSATISFIED", "Local-only data cannot be sent to a remote endpoint or an opaque CLI provider.");
  if (retention === "zero_retention" && capabilities?.provider_retention_attested !== "zero_retention") {
    effectiveRetention = null; require("retention", "PROVIDER_RETENTION_UNATTESTED", "Request storage flags do not establish provider/account Zero Data Retention.");
  } else if (!["provider_default", "local_only"].includes(retention) && !(provider === "openai" && api !== "native_cli" && ["store_false", "store_true"].includes(retention)) && !capabilities?.retention.includes(retention)) {
    effectiveRetention = null; require("retention", "RETENTION_UNSUPPORTED", "This adapter cannot establish the requested retention control.");
  }
  if (channel === "api" && (safeBudget.run_amount > 0 || safeBudget.day_amount > 0) && !safeBudget.pricing_version) require("budget.pricing_version", "PRICING_REQUIRED", "A strict monetary allocation requires a named pricing version; unknown price never means free.");
  if (channel === "subscription" && safeBudget.currency !== "subscription_units") require("budget.currency", "BILLING_CHANNEL_MISMATCH", "Native CLI subscription units are independent from API money.");
  const fallbacks = choose("fallbacks", undefined, [])!;
  const policy = RolePolicySchema.parse({ schema: "dreamgraph.role_policy.v1", id: `role:${role}`, revision: input.revision ?? 0, role,
    provider: ProviderSchema.safeParse(provider).success ? provider : "none", model, adapter, api, effort, context_tokens: Number.isSafeInteger(context_tokens) && context_tokens > 0 ? context_tokens : 0,
    budget: safeBudget, retention: { requested: retention, effective: effectiveRetention, source: capabilities ? `${capabilities.adapter}@${capabilities.version}` : "request_policy; provider/account retention unknown" }, fallbacks });
  const documentedTemperature = modelTemperatureCapability(provider, effectiveModel, effort, adapter);
  // An adapter-wide statement cannot qualify an arbitrary model; explicit evidence is scoped to this model/API.
  const qualifiedTemperature = capabilities?.model === effectiveModel && capabilities.adapter === adapter && capabilities.apis.includes(api) && capabilities.temperature !== undefined && documentedTemperature.support === "unknown";
  const temperature_control: TemperatureCapability = qualifiedTemperature ? { support: capabilities.temperature ? "supported" : "unsupported", reason: "Qualified adapter/model temperature capability.", source: `${capabilities.adapter}@${capabilities.version}` } : documentedTemperature;
  const result: ResolvedRolePolicy = { policy, requested: { provider, model, adapter, api: requestedApi, effort, retention, temperature },
    effective: { provider, model: effectiveModel, adapter, api, effort, retention: effectiveRetention,
      output_tokens, context_tokens, timeout_ms, temperature: temperature_control.support === "supported" ? temperature : null, strict_schema },
    temperature_control, cognitive_instruction: cognitiveRoleInstruction(role), capability: documented,
    status: diagnostics.some(d => d.code !== "CAPABILITY_REQUIRED") ? "blocked" : diagnostics.length ? "capability_required" : "configured", diagnostics, origins,
    billing: { channel, principal: safeBudget.billing_principal, currency: safeBudget.currency, pricing_version: safeBudget.pricing_version },
    connection: { base_url, api_key_env }, fingerprint: "" };
  result.fingerprint = hash(stable(result)); return result;
}

const ProfilesSchema = z.object({ schema: z.literal("dreamgraph.role_profiles.v1"), revision: z.number().int().nonnegative(),
  roles: z.object(Object.fromEntries(MODEL_ROLES.map(role => [role, RoleSettingsSchema.optional()])) as Record<ModelRole, z.ZodOptional<typeof RoleSettingsSchema>>).strict(),
  previous: z.array(z.object({ revision: z.number().int().nonnegative(), roles: z.record(RoleSettingsSchema) }).strict()),
}).strict();
export type RoleProfiles = z.infer<typeof ProfilesSchema>;
export function readRoleProfiles(): Promise<RoleProfiles> {
  return withGraphRead(async () => {
    const state = await loadPublicationState();
    try {
      const body = await readFile(dataPath("role_profiles.json"), "utf8");
      if (state.stores["role_profiles.json"] && state.stores["role_profiles.json"].hash !== publicationContentHash(body)) throw new Error("UNPUBLISHED_ROLE_PROFILE_CHANGE");
      return ProfilesSchema.parse(JSON.parse(stripBom(body)));
    } catch (failure) {
      if ((failure as NodeJS.ErrnoException).code === "ENOENT" && !state.stores["role_profiles.json"]) return { schema: "dreamgraph.role_profiles.v1", revision: 0, roles: {}, previous: [] };
      throw new Error(`ROLE_PROFILES_UNAVAILABLE: ${String(failure)}`);
    }
  });
}
export async function inspectRolePolicies(legacy?: LlmConfig): Promise<ResolvedRolePolicy[]> {
  const saved = await readRoleProfiles();
  return MODEL_ROLES.map(role => resolveRolePolicy({ role, saved: saved.roles[role], revision: saved.revision, legacy }));
}

/** Capture once at job/candidate creation. Later configuration edits cannot mutate this evidence. */
export function snapshotRolePolicy(policy: ResolvedRolePolicy): Readonly<ResolvedRolePolicy> {
  const copy = structuredClone(policy);
  const freeze = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  };
  freeze(copy); return copy;
}
export async function saveRoleProfiles(input: { expected_revision: number; roles: RoleProfiles["roles"]; operation_id: string }): Promise<RoleProfiles> {
  return withGraphReconciliation(async () => {
    await recoverGraphPublication();
    const current = await readRoleProfiles();
    const next = ProfilesSchema.parse({ ...current, revision: current.revision + 1, roles: input.roles,
      previous: [...current.previous, { revision: current.revision, roles: current.roles }] });
    const committed = await commitGraphWrites({ writes: [{ file: "role_profiles.json", content: JSON.stringify(next, null, 2) }],
      actor: "role_configuration", operation_id: input.operation_id, cause: "role_policy", scope: ["role_profiles.json"],
      intent: { expected_revision: input.expected_revision, roles: input.roles }, result: { revision: next.revision },
      check_expected: async () => { if (current.revision !== input.expected_revision) throw new Error("ROLE_PROFILE_REVISION_CONFLICT"); } });
    return committed.replayed ? readRoleProfiles() : next;
  });
}
export async function restoreRoleProfiles(input: { revision: number; expected_revision: number; operation_id: string }): Promise<RoleProfiles> {
  const current = await readRoleProfiles();
  const previous = current.previous.find(entry => entry.revision === input.revision);
  if (!previous) throw new Error("ROLE_PROFILE_HISTORY_UNAVAILABLE");
  return saveRoleProfiles({ expected_revision: input.expected_revision, roles: previous.roles, operation_id: input.operation_id });
}
/** Explicit preview preserves selected models and settings; it grants no paid allocation. */
export function previewLegacyRoleMigration(env: Record<string, string | undefined>, legacy?: LlmConfig): {
  roles: RoleProfiles["roles"]; warnings: string[];
} {
  const roles: RoleProfiles["roles"] = {}, warnings = ["No provider calls or automatic model upgrades. Run/day allocations remain zero unless explicitly configured."];
  for (const role of MODEL_ROLES) {
    const resolved = resolveRolePolicy({ role, env, legacy });
    roles[role] = { provider: resolved.policy.provider as LlmProviderType, model: resolved.requested.model, adapter: resolved.requested.adapter,
      api: resolved.requested.api as RoleSettings["api"], effort: resolved.requested.effort, temperature: resolved.requested.temperature,
      output_tokens: resolved.effective.output_tokens, context_tokens: resolved.effective.context_tokens, timeout_ms: resolved.effective.timeout_ms,
      retention: resolved.requested.retention as RoleSettings["retention"], strict_schema: resolved.effective.strict_schema, ...(resolved.capability ? { capability: resolved.capability } : {}), budget: resolved.policy.budget, fallbacks: resolved.policy.fallbacks,
      ...(resolved.connection.api_key_env ? { api_key_env: resolved.connection.api_key_env } : {}), base_url: resolved.connection.base_url };
    for (const diagnostic of resolved.diagnostics) warnings.push(`${role}: ${diagnostic.code}: ${diagnostic.message}`);
  }
  return { roles, warnings };
}
