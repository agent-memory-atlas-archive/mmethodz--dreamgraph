/** One field catalogue for role policy, engine.env and later configuration UI. */
export const MODEL_ROLES = ["initial_scan", "enrichment", "dreamer", "normalizer", "architect", "computer_use"] as const;
export const ROLE_SETTING_FIELDS = {
  provider: "PROVIDER", model: "MODEL", adapter: "ADAPTER", api: "API", effort: "REASONING_EFFORT", base_url: "URL", api_key_env: "API_KEY_ENV",
  temperature: "TEMPERATURE", output_tokens: "MAX_TOKENS", context_tokens: "CONTEXT_TOKENS", timeout_ms: "TIMEOUT_MS", retention: "RETENTION", strict_schema: "STRICT_SCHEMA", fallbacks: "FALLBACKS", capability: "CAPABILITY",
} as const;
export const ROLE_BUDGET_FIELDS = {
  requests: "MAX_CALLS", input_tokens: "MAX_INPUT_TOKENS", output_tokens: "MAX_OUTPUT_TOKENS", reasoning_tokens: "MAX_REASONING_TOKENS", retries: "MAX_RETRIES", elapsed_ms: "MAX_ELAPSED_MS", concurrency: "CONCURRENCY", max_hops: "MAX_HOPS", max_neighbors: "MAX_NEIGHBORS", run_amount: "RUN_BUDGET", day_amount: "DAY_BUDGET",
} as const;
export const roleEnvKey = (role: typeof MODEL_ROLES[number], suffix: string): string => `DREAMGRAPH_LLM_${role.toUpperCase()}_${suffix}`;
export const ROLE_ENV_FIELDS = MODEL_ROLES.flatMap(role => [
  ...Object.entries(ROLE_SETTING_FIELDS).map(([field, suffix]) => ({ key: roleEnvKey(role, suffix), role, field, secret: false,
    description: field === "model" ? "Explicit model ID; no built-in maximum model generation or automatic upgrade."
      : field === "api" ? "auto | responses | chat_completions | messages | native_cli | local."
      : field === "retention" ? "provider_default | store_false | store_true | zero_retention | local_only. Account retention is independently attested."
      : field === "fallbacks" ? "JSON array of named provider/model/adapter fallbacks with an explicit approved boolean."
      : field === "capability" ? "JSON capability evidence for one exact provider/model, with named source/version; never inferred from a CLI identifier."
      : field === "api_key_env" ? "Name of the environment variable holding the provider secret; never put the secret here."
      : field === "temperature" ? "Requested sampling value. Unsupported/unqualified controls are omitted; cognitive role and configured reasoning remain intact."
      : `Independent ${role} ${field.replace(/_/g, " ")}.` })),
  ...Object.entries(ROLE_BUDGET_FIELDS).map(([field, suffix]) => ({ key: roleEnvKey(role, suffix), role, field, secret: false,
    description: `Finite ${role} ${field.replace(/_/g, " ")}. Run/day amounts default to zero; a template grants no paid allocation.` })),
  ...["PRICING_VERSION", "BILLING_PRINCIPAL", "BUDGET_CURRENCY"].map(suffix => ({ key: roleEnvKey(role, suffix), role, field: suffix.toLowerCase(), secret: false,
    description: "Named pricing/billing provenance. Native CLI subscription units remain separate from API money." })),
  { key: roleEnvKey(role, "API_KEY"), role, field: "api_key", secret: true, description: "Role-specific provider secret. Do not include in reports or model context." },
]);
