import type { TokenUsage } from "./llm.js";
/** Missing metrics stay missing across multiple actual calls. Cache/reasoning are components. */
export function summarizeProviderUsage(calls: Array<TokenUsage | null | undefined>) {
  const reported = calls.filter((call): call is TokenUsage => !!call && Object.values(call).some(value => typeof value === "number"));
  const aggregate: TokenUsage = {};
  for (const field of ["inputTokens", "outputTokens", "totalTokens", "cachedInputTokens", "cacheCreationInputTokens", "reasoningTokens"] as const) {
    if (!calls.length || calls.some(call => call?.[field] === undefined)) continue;
    const total = calls.reduce((sum, call) => sum + call![field]!, 0);
    if (Number.isSafeInteger(total) && total >= 0) aggregate[field] = total;
  }
  return { usage: Object.keys(aggregate).length ? aggregate : undefined, usage_by_call: calls.map(call => call ? { ...call } : null),
    usage_provenance: reported.length === 0 ? "unavailable" as const : reported.length < calls.length ? "partial" as const : "provider_reported" as const };
}
