/** Explicit operator-supplied tariffs; never fetched, inferred, or applied to CLI subscriptions. */
import { z } from "zod";
export const ModelPricingSchema = z.object({
  version: z.string().min(1), provider: z.string().min(1), model: z.string().min(1), currency: z.string().min(1),
  source: z.string().min(1), input_per_million: z.number().nonnegative().finite().max(1_000_000),
  output_per_million: z.number().nonnegative().finite().max(1_000_000),
  /** Optional tariff for provider-reported cached input (cache reads). Absent: cached input is charged at the input tariff. */
  cached_input_per_million: z.number().nonnegative().finite().max(1_000_000).optional(),
  /** Optional tariff for provider-reported cache writes (Anthropic charges them above the input tariff). Absent: input tariff. */
  cache_write_input_per_million: z.number().nonnegative().finite().max(1_000_000).optional(),
  /** Output tariff includes billed reasoning; input tariff includes un-discounted image/input tokens. */
  output_includes_reasoning: z.literal(true), input_includes_images: z.literal(true),
}).strict();
export const ModelPricingCatalogueSchema = z.array(ModelPricingSchema).max(128).superRefine((records, context) => {
  const seen = new Set<string>();
  for (const [index, record] of records.entries()) {
    const key = `${record.version}:${record.provider}:${record.model}:${record.currency}`;
    if (seen.has(key)) context.addIssue({ code: z.ZodIssueCode.custom, path: [index], message: "Duplicate exact tariff identity" });
    seen.add(key);
  }
});
export type ModelPricing = z.infer<typeof ModelPricingSchema>;
const NANO = 1_000_000_000n;
export function amountCeiling(value: number): bigint {
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER / 1e9) throw new Error("AMOUNT_OUT_OF_RANGE");
  return BigInt(Math.ceil(value * Number(NANO)));
}
export function allocationFloor(value: number): bigint {
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER / 1e9) throw new Error("AMOUNT_OUT_OF_RANGE");
  return BigInt(Math.floor(value * Number(NANO)));
}
/** Reservation: every input token at the highest input tariff (a cache write can cost more than plain input). */
export function estimateCharge(pricing: ModelPricing, input: number, output: number): bigint {
  if (![input, output].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error("INVALID_CHARGE_COUNTS");
  const inputTariff = Math.max(pricing.input_per_million, pricing.cache_write_input_per_million ?? 0);
  const numerator = BigInt(input) * amountCeiling(inputTariff) + BigInt(output) * amountCeiling(pricing.output_per_million);
  return (numerator + 999_999n) / 1_000_000n;
}
/**
 * Settlement charge from provider-reported usage. Cache reads use the cached tariff and cache writes the cache-write
 * tariff when the operator entered them; everything else uses the input tariff. Reservations use estimateCharge
 * (highest input tariff, no discount), so neither a cache miss nor a cache write can exceed what was admitted.
 */
export function estimateUsageCharge(pricing: ModelPricing, usage: { inputTokens: number; outputTokens: number; cachedInputTokens?: number; cacheCreationInputTokens?: number }): bigint {
  const cached = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens);
  const written = Math.min(usage.cacheCreationInputTokens ?? 0, usage.inputTokens - cached);
  if (![usage.inputTokens, usage.outputTokens, cached, written].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error("INVALID_CHARGE_COUNTS");
  const numerator = BigInt(usage.inputTokens - cached - written) * amountCeiling(pricing.input_per_million)
    + BigInt(cached) * amountCeiling(pricing.cached_input_per_million ?? pricing.input_per_million)
    + BigInt(written) * amountCeiling(pricing.cache_write_input_per_million ?? pricing.input_per_million)
    + BigInt(usage.outputTokens) * amountCeiling(pricing.output_per_million);
  return (numerator + 999_999n) / 1_000_000n;
}
