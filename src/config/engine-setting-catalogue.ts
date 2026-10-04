import { resolveHttpPolicy } from "../server/http-policy.js";
/** Configuration ownership, types and apply semantics. Unknown imported keys survive. */
import { z } from "zod";
import { SchedulerSettingsSchema, EventSettingsSchema, NarrativeSettingsSchema, ComputerUseSettingsSchema, DEFAULT_COMPUTER_USE_SETTINGS, FederationSettingsSchema } from "./engine-settings.js";
import { RoleSettingsSchema, ProviderSchema, ApiSchema } from "./role-settings.js";
import { MODEL_ROLES, ROLE_ENV_FIELDS, ROLE_SETTING_FIELDS, ROLE_BUDGET_FIELDS, roleEnvKey } from "./role-env-fields.js";
import { ModelPricingCatalogueSchema } from "./model-pricing.js";
import { BudgetSchema } from "../graph/contracts.js";

export interface EngineSetting { key: string; owner: string; unit: string; apply: "live" | "next_execution" | "restart" | "read_only"; secret: boolean; protected: boolean; description: string; schema: z.ZodTypeAny; decode: (value: string) => unknown; }
const entries = new Map<string, EngineSetting>();
const string = z.string().max(16384), integer = z.number().finite().int().min(0).max(Number.MAX_SAFE_INTEGER), positive = integer.min(1), fraction = z.number().finite().min(0).max(1), ms = integer.max(86_400_000);
const boolean = z.boolean(), decodeBoolean = (value: string) => value === "true" ? true : value === "false" ? false : value;
function add(keys: string[], schema: z.ZodTypeAny, options: Partial<Omit<EngineSetting, "key" | "schema">> = {}) {
  for (const key of keys) entries.set(key, { key, schema, owner: "core", unit: "value", apply: "restart", secret: false, protected: false,
    description: key.toLowerCase().replace(/_/g, " "), decode: schema === boolean ? decodeBoolean : schema instanceof z.ZodNumber ? Number : value => value, ...options });
}
add(["DREAMGRAPH_INSTANCE_UUID", "DREAMGRAPH_MASTER_DIR", "DREAMGRAPH_DATA_DIR", "DREAMGRAPH_WORKSPACE_ROOT", "DREAMGRAPH_BIN_DIR", "DREAMGRAPH_AUDIT_PATH", "DREAMGRAPH_BRIDGE_AUDIT_DIR"], string, { protected: true, unit: "identity/path", apply: "read_only", description: "Instance/launcher-owned path or identity; move or attach through the instance lifecycle, not configuration edits." });
add(["DREAMGRAPH_HTTP_BIND"], z.string().min(1).max(512), { protected: true, owner: "daemon authority", description: "Loopback by default. Non-loopback requires explicit remote enablement, token and allowed hosts." });
add(["DREAMGRAPH_REMOTE_ENABLED"], boolean, { protected: true, owner: "daemon authority" });
add(["DREAMGRAPH_REMOTE_TOKEN"], z.string().max(16384).refine(value => !value || value.trim().length >= 32), { protected: true, secret: true, owner: "daemon authority" });
add(["DREAMGRAPH_HTTP_ALLOWED_HOSTS", "DREAMGRAPH_HTTP_ALLOWED_ORIGINS"], z.array(z.string().min(1).max(512)).max(32), { protected: true, decode: JSON.parse, owner: "daemon authority" });
add(["DREAMGRAPH_REPOS"], z.record(z.string().min(1)), { protected: true, unit: "repository map", decode: JSON.parse });
add(["DREAMGRAPH_LLM_API_KEY", "DATABASE_URL"], string, { protected: true, secret: true, apply: "next_execution" });
add(["DREAMGRAPH_LLM_PROVIDER"], ProviderSchema, { apply: "next_execution", owner: "model policy" });
add(["DREAMGRAPH_LLM_API"], ApiSchema, { apply: "next_execution", owner: "model policy" });
add(["DREAMGRAPH_LLM_MODEL", "DREAMGRAPH_LLM_URL", "DREAMGRAPH_LLM_REASONING_EFFORT"], string, { apply: "next_execution", owner: "model policy" });
add(["DREAMGRAPH_LLM_PRICING"], ModelPricingCatalogueSchema, { decode: JSON.parse, protected: true, owner: "model admission", apply: "next_execution", description: "Exact versioned operator tariffs. API dispatch requires a matching tariff and nonzero role run/day allocations; subscriptions are unmeasured separately." });
add(["DREAMGRAPH_LLM_RETENTION"], RoleSettingsSchema.shape.retention, { protected: true, apply: "next_execution" });
add(["DREAMGRAPH_LLM_TEMPERATURE"], z.number().finite().min(0).max(2), { decode: Number, apply: "next_execution" });
add(["DREAMGRAPH_LLM_MAX_TOKENS", "DREAMGRAPH_LLM_CONTEXT_TOKENS"], positive, { unit: "tokens", apply: "next_execution" });
add(["DREAMGRAPH_LLM_TIMEOUT_MS", "DREAMGRAPH_LLM_READINESS_INTERVAL_MS", "DREAMGRAPH_BRIDGE_HEALTH_TIMEOUT_MS", "DREAMGRAPH_RUNTIME_TIMEOUT", "DG_DREAM_TIMEOUT_MS", "DG_DB_STATEMENT_TIMEOUT", "DG_DB_CONNECTION_TIMEOUT", "DG_DB_IDLE_TIMEOUT", "DG_DB_OPERATION_TIMEOUT", "DG_DB_SCAN_TIMEOUT_MS"], ms.min(1), { unit: "milliseconds" });
entries.set("DG_DB_CONNECTION_TIMEOUT", { ...entries.get("DG_DB_CONNECTION_TIMEOUT")!, schema: ms });
add(["DG_DB_MAX_CONNECTIONS"], positive.max(1000), { unit: "connections" });
add(["DREAMGRAPH_DEBUG", "DREAMGRAPH_METRICS_ENABLED", "DREAMGRAPH_ENABLE_RUNTIME_METRICS", "DREAMGRAPH_ENABLE_DOOM", "DREAMGRAPH_ARCHITECT_PREAMBLE_COMPILER", "DREAMGRAPH_ARCHITECT_TOKEN_ECONOMY", "DG_FETCH_PLUGIN_BLACKLIST"], boolean);
add(["DG_ALLOW_INPROCESS_PLUGINS", "DREAMGRAPH_AUTO_APPLY_RESOLUTION_PLANS"], boolean, { protected: true });
add(["DREAMGRAPH_ARCHITECT_SELECTED_PLAN_ID", "DREAMGRAPH_ARCHITECT_CODEX_CLI_BINARY", "DREAMGRAPH_ARCHITECT_COPILOT_CLI_BINARY", "DREAMGRAPH_ARCHITECT_PROMPT_PROFILE", "DREAMGRAPH_ARCHITECT_STORY_VISIBILITY", "DREAMGRAPH_ARCHITECT_VERBOSITY_MODE"], string, { owner: "architect", apply: "next_execution" });
add(["DREAMGRAPH_ARCHITECT_AUTONOMY_MODE"], string, { owner: "architect", protected: true, apply: "next_execution", description: "Architect reasoning policy; never a Computer Use grant." });
add(["DREAMGRAPH_ARCHITECT_PASS_TIMEOUT_MS"], ms.min(60_000), { owner: "architect", unit: "milliseconds", apply: "next_execution", description: "Finite maximum for one whole Architect pass (all tool calls), separate from the per-request model timeout. Never extended by activity. Default 30 minutes." });
add(["DREAMGRAPH_ARCHITECT_PASS_IDLE_MS"], ms.min(60_000), { owner: "architect", unit: "milliseconds", apply: "next_execution", description: "A pass with no activity (worker tool calls or CLI output) for this long is treated as stale and stopped. Default 15 minutes." });
add(["DREAMGRAPH_ARCHITECT_TOKEN_ECONOMY_SOFT_TARGET", "DREAMGRAPH_ARCHITECT_TOKEN_ECONOMY_TRANSPORT_CEILING"], positive, { unit: "tokens", apply: "next_execution" });
add(["DREAMGRAPH_ARCHITECT_TOKEN_ECONOMY_DEBT_CARRY_FRACTION"], fraction, { unit: "fraction", apply: "next_execution" });
add(["DREAMGRAPH_SEMANTIC_CACHE_MIN_CONFIDENCE", "DREAMGRAPH_SEMANTIC_CACHE_MIN_COVERAGE", "DG_PROMOTION_CONFIDENCE", "DG_PROMOTION_PLAUSIBILITY", "DG_PROMOTION_EVIDENCE", "DG_RETENTION_PLAUSIBILITY", "DG_MAX_CONTRADICTION", "DG_DECAY_RATE", "DG_TENSION_URGENCY_DECAY", "DG_TENSION_MIN_URGENCY", "DG_LLM_BUDGET", "DG_PGO_BUDGET", "DG_NORMALIZER_LLM_THRESHOLD", "DG_BOOTSTRAP_RELAXED_CONFIDENCE"], fraction, { unit: "fraction" });
add(["DG_PROMOTION_EVIDENCE_COUNT", "DG_DECAY_TTL", "DG_MEMORY_TTL_CYCLES", "DG_MAX_ACTIVE_TENSIONS", "DG_TENSION_TTL", "DG_BARREN_THRESHOLD", "DG_PROBE_INTERVAL", "DG_STRATEGY_HISTORY", "DG_NORMALIZER_BATCH_SIZE", "DG_BOOTSTRAP_MAX_CYCLES", "DG_BOOTSTRAP_MIN_ENTITIES", "DG_BOOTSTRAP_MIN_VALIDATED_EDGES", "DREAMGRAPH_ENRICHMENT_BATCH_SIZE", "DREAMGRAPH_MAJOR_REPOSITORY_CHANGE_FILES", "DREAMGRAPH_MAJOR_GRAPH_CHANGE_NODES"], positive, { unit: "count" });
add(["DG_ORPHAN_BUDGET"], integer, { unit: "edges per cycle" });
add(["DREAMGRAPH_GRAPH_STALE_HOURS", "DREAMGRAPH_ENRICHMENT_STALE_HOURS", "DG_BOOTSTRAP_MAX_HOURS"], z.number().finite().min(0).max(87600), { decode: Number, unit: "hours", description: "Recency diagnostic/timeout; an old scan alone does not establish stale graph evidence." });
add(["DREAMGRAPH_RUNTIME_TYPE", "DREAMGRAPH_RUNTIME_ENDPOINT", "DREAMGRAPH_HOST_MCP_URL", "DREAMGRAPH_BRIDGE_SERVER_NAME", "DG_GRAPH_CONTEXT_REPRESENTATION"], string);
add(["DREAMGRAPH_EVENTS"], EventSettingsSchema.partial(), { decode: JSON.parse, owner: "events", apply: "live" });
add(["DREAMGRAPH_SCHEDULER"], SchedulerSettingsSchema.partial(), { decode: JSON.parse, owner: "scheduler", apply: "live" });
// Cross-field validation is applied after defaults are merged below.
add(["DREAMGRAPH_NARRATIVE"], z.object({ narrative_interval: positive, digest_interval: positive, max_chapters: positive, auto_narrate: boolean }).strict().partial(), { decode: JSON.parse, owner: "narrative", apply: "live" });
add(["DREAMGRAPH_COMPUTER_USE_POLICY"], z.enum(["allow", "ask", "deny"]), { owner: "computer use", apply: "next_execution",
  description: "Whether the local Architect may operate this computer (browser/apps): allow, ask every time, or deny. The daemon is loopback-only, so this is the local operator's decision." });
add(["DREAMGRAPH_COMPUTER_USE"], ComputerUseSettingsSchema, { decode: JSON.parse, owner: "computer use", protected: true, apply: "next_execution" });
const componentAliases = {
  DG_SCHEDULER_ENABLED: ["scheduler", "enabled"], DG_SCHEDULER_TICK: ["scheduler", "tick_interval_ms"], DG_SCHEDULER_MAX_RUNS_HR: ["scheduler", "max_runs_per_hour"], DG_SCHEDULER_COOLDOWN: ["scheduler", "global_cooldown_ms"], DG_SCHEDULER_NIGHTMARE_COOLDOWN: ["scheduler", "nightmare_cooldown_ms"], DG_SCHEDULER_MAX_HISTORY: ["scheduler", "max_history"], DG_SCHEDULER_MAX_ERROR_STREAK: ["scheduler", "max_error_streak"], DG_SCHEDULER_EXEC_TIMEOUT: ["scheduler", "execution_timeout_ms"],
  DG_EVENT_TENSION_THRESHOLD: ["events", "tension_threshold"], DG_EVENT_ERROR_THRESHOLD: ["events", "runtime_error_threshold"], DG_EVENT_COOLDOWN: ["events", "cooldown_ms"], DG_EVENT_MAX_CYCLES_HR: ["events", "max_auto_cycles_per_hour"],
  DG_NARRATIVE_INTERVAL: ["narrative", "narrative_interval"], DG_NARRATIVE_DIGEST_INTERVAL: ["narrative", "digest_interval"], DG_NARRATIVE_MAX_CHAPTERS: ["narrative", "max_chapters"], DG_NARRATIVE_AUTO: ["narrative", "auto_narrate"],
} as const;
export function componentSettingAlias(key: string): { key: string; property: string } | null {
  const alias = (componentAliases as Record<string, readonly [string, string]>)[key];
  return alias ? { key: `DREAMGRAPH_${alias[0].toUpperCase()}`, property: alias[1] } : null;
}
const componentDefaults = {
  scheduler: { enabled: true, tick_interval_ms: 30000, max_runs_per_hour: 30, global_cooldown_ms: 10000, nightmare_cooldown_ms: 300000, max_history: 500, max_error_streak: 3, execution_timeout_ms: 600000 },
  events: { tension_threshold: 0.8, runtime_error_threshold: 0.05, cooldown_ms: 60000, max_auto_cycles_per_hour: 10 },
  narrative: { narrative_interval: 10, digest_interval: 50, max_chapters: 100, auto_narrate: true },
};
const componentSchemas = { scheduler: SchedulerSettingsSchema, events: EventSettingsSchema, narrative: NarrativeSettingsSchema };
for (const [key, [component, field]] of Object.entries(componentAliases)) {
  const schema = component === "scheduler" ? SchedulerSettingsSchema.shape[field as keyof typeof SchedulerSettingsSchema.shape]
    : component === "events" ? EventSettingsSchema.shape[field as keyof typeof EventSettingsSchema.shape] : NarrativeSettingsSchema.innerType().shape[field as keyof ReturnType<typeof NarrativeSettingsSchema.innerType>["shape"]];
  add([key], schema, { owner: component, unit: field.endsWith("_ms") ? "milliseconds" : "value", apply: "live", decode: schema instanceof z.ZodBoolean ? decodeBoolean : Number });
}
for (const entry of ROLE_ENV_FIELDS) {
  const field = entry.field;
  const setting = (RoleSettingsSchema.shape as Record<string, z.ZodTypeAny>)[field];
  const budget = (BudgetSchema.shape as Record<string, z.ZodTypeAny>)[field];
  const schema = entry.secret ? string : setting ?? budget ?? string;
  const numeric = Object.keys(ROLE_BUDGET_FIELDS).includes(field) || ["temperature", "output_tokens", "context_tokens", "timeout_ms"].includes(field);
  add([entry.key], schema, { owner: `role:${entry.role}`, description: entry.description, secret: entry.secret, protected: entry.secret || ["fallbacks", "retention", "api_key_env"].includes(field) || numeric && !["temperature", "output_tokens", "context_tokens", "timeout_ms"].includes(field), apply: "next_execution",
    unit: field.endsWith("_tokens") ? "tokens" : field.endsWith("_ms") ? "milliseconds" : ["run_amount", "day_amount"].includes(field) ? "configured currency" : field === "max_hops" ? "hops" : field === "requests" ? "requests" : field === "concurrency" ? "parallel requests" : "value",
    decode: numeric ? Number : field === "strict_schema" ? decodeBoolean : ["capability", "fallbacks"].includes(field) ? JSON.parse : value => value });
}
add(["DREAMGRAPH_RUN_ID", "DREAMGRAPH_CANCELLED", "DG_DAEMON", "DREAMGRAPH_TOOLS", "DREAMGRAPH_EXPLORER", "DREAMGRAPH_SDK_ROADMAP"], string, { protected: true, apply: "read_only", description: "Runtime/launcher-owned value; not an editable engine setting." });
add(["DREAMGRAPH_FEDERATION"], FederationSettingsSchema, {owner:"federation",protected:true,apply:"next_execution",decode:JSON.parse,
  description:"Versioned foreign-hypothesis sharing policy and stable origin namespace; malformed settings fail closed. Template reset preserves this policy. Unredacted export is unsupported."});
add(["DREAMGRAPH_BRIDGE_SESSION_BEARER"], string, { secret: true, protected: true, apply: "read_only", owner: "Architect bridge", description: "Ephemeral authenticated session bearer forwarded only to the owned local MCP bridge; never an editable engine setting or prompt field." });
add(["DREAMGRAPH_BRIDGE_COMPUTER_USE_REQUESTABLE"], z.enum(["0", "1"]), { protected: true, apply: "read_only", owner: "Architect bridge", description: "Pass-local authority signal: 1 means instance policy permits requesting Computer Use approval for this execution. It is set by the daemon, not an operator grant or editable engine setting." });
add(["DREAMGRAPH_CODEX_CUA_TRANSPORT"], z.enum(["stdio", "daemon-http"]), { protected: true, apply: "read_only", owner: "Codex CLI Computer Use runtime", description: "Internal process transport switch. Default is verified stdio; daemon-http is an explicit experimental opt-in and never grants Computer Use or changes instance policy." });
add(["DREAMGRAPH_EXPLORER_PROXY", "DREAMGRAPH_CTX_FETCH_TIMEOUT_MS", "DREAMGRAPH_URL", "DREAMGRAPH_TOKEN_ECONOMY", "DREAMGRAPH_TOKEN_ECONOMY_BENCHMARK_COMMAND", "DREAMGRAPH_BENCH_ITERATIONS", "DREAMGRAPH_TOOL_ARGS"], string, { protected: true, apply: "read_only", owner: "client/build utilities", description: "Consumed by a client, development server or explicit utility process. Set on that process; daemon engine.env cannot configure it." });

export function engineSettingCatalogue(): EngineSetting[] { return [...entries.values()].sort((a, b) => a.key.localeCompare(b.key)); }
export function engineSetting(key: string): EngineSetting | undefined { return entries.get(key); }
export function resolveComponentSettings(component: keyof typeof componentSchemas, values: Record<string, string | undefined>) {
  const merged: Record<string, unknown> = { ...componentDefaults[component] };
  const raw = values[`DREAMGRAPH_${component.toUpperCase()}`];
  if (raw) Object.assign(merged, JSON.parse(raw));
  for (const [key, [owner, field]] of Object.entries(componentAliases)) if (owner === component && values[key] !== undefined && values[key] !== "") merged[field] = entries.get(key)!.decode(values[key]!);
  return componentSchemas[component].parse(merged);
}
export function validateEngineEnvValues(values: Record<string, string>, changedKeys?: string[]): string[] {
  resolveHttpPolicy(8100, values);
  const diagnostics: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    const entry = entries.get(key);
    if (!entry) { if (changedKeys?.includes(key)) throw new Error(`CONFIG_UNKNOWN_KEY: ${key}`); diagnostics.push(`UNKNOWN_IMPORTED_KEY: ${key}`); continue; }
    if (changedKeys?.includes(key) && entry.apply === "read_only") throw new Error(`CONFIG_READ_ONLY: ${key}`);
    if (value === "" && entry.schema instanceof z.ZodOptional) continue;
    try { entry.schema.parse(entry.decode(value)); } catch { throw new Error(`CONFIG_INVALID_SETTING: ${key}`); }
  }
  for (const component of ["scheduler", "events", "narrative"] as const) {
    try { resolveComponentSettings(component, values); } catch { throw new Error(`CONFIG_INVALID_COMPONENT: ${component}`); }
  }
  for (const role of MODEL_ROLES) {
    const model = values[roleEnvKey(role, "MODEL")], provider = values[roleEnvKey(role, "PROVIDER")] ?? values.DREAMGRAPH_LLM_PROVIDER;
    const capability = values[roleEnvKey(role, "CAPABILITY")];
    if (capability) { const record = JSON.parse(capability); if (record.model !== model || record.provider !== provider) throw new Error(`CONFIG_CAPABILITY_SCOPE_MISMATCH: ${role}`); }
  }
  return diagnostics;
}
export type ComputerUsePolicy = "allow" | "ask" | "deny";
/** Local operator policy. Unset or invalid values fall back to asking. */
export function computerUsePolicy(values: Record<string, string | undefined> = process.env): ComputerUsePolicy {
  const value = values.DREAMGRAPH_COMPUTER_USE_POLICY?.trim().toLowerCase();
  return value === "allow" || value === "deny" ? value : "ask";
}
export function computerUseSettings(values: Record<string, string | undefined>) { return values.DREAMGRAPH_COMPUTER_USE ? ComputerUseSettingsSchema.parse(JSON.parse(values.DREAMGRAPH_COMPUTER_USE)) : DEFAULT_COMPUTER_USE_SETTINGS; }
export function engineEnvNumber(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return fallback;
  const entry = entries.get(key);
  if (!entry) throw new Error(`CONFIG_UNREGISTERED_NUMBER: ${key}`);
  try { return entry.schema.parse(Number(raw)) as number; } catch { throw new Error(`CONFIG_INVALID_SETTING: ${key}`); }
}
