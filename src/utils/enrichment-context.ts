export const DEFAULT_ENRICHMENT_CONTEXT_HOPS = 3;
export const MAX_ENRICHMENT_CONTEXT_HOPS = 6;

/** Validate before any provider calls; zero explicitly omits graph neighbors. */
export function parseEnrichmentContextHops(
  value: unknown = DEFAULT_ENRICHMENT_CONTEXT_HOPS,
  label = "context_hops",
): number {
  const hops = typeof value === "number" ? value
    : typeof value === "string" && value.trim() ? Number(value) : NaN;
  if (!Number.isInteger(hops) || hops < 0 || hops > MAX_ENRICHMENT_CONTEXT_HOPS) {
    throw new Error(`Invalid ${label}: '${String(value)}'. Use an integer from 0 to ${MAX_ENRICHMENT_CONTEXT_HOPS}.`);
  }
  return hops;
}
