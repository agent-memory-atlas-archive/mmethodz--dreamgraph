/** Explicit operator-supplied tariffs; never fetched, inferred, or applied to CLI subscriptions. */
import { z } from "zod";
export const ModelPricingSchema = z.object({
  version: z.string().min(1), provider: z.string().min(1), model: z.string().min(1), currency: z.string().min(1),
  source: z.string().min(1), input_per_million: z.number().nonnegative().finite().max(1_000_000),
  output_per_million: z.number().nonnegative().finite().max(1_000_000),
  /** Optional tariff for provider-reported cached input (cache reads). Absent: cached input is charged at the input tariff. */
  cached_input_per_million: z.number().nonnegative().finite().max(1_000_000).optional(),
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
export function estimateCharge(pricing: ModelPricing, input: number, output: number): bigint {
  if (![input, output].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error("INVALID_CHARGE_COUNTS");
  const numerator = BigInt(input) * amountCeiling(pricing.input_per_million) + BigInt(output) * amountCeiling(pricing.output_per_million);
  return (numerator + 999_999n) / 1_000_000n;
}
/**
 * Settlement charge from provider-reported usage. Cached input (cache reads) uses the cached tariff when the operator
 * entered one; everything else, including cache writes, uses the input tariff. Reservations keep using estimateCharge
 * (no discount), so a cache miss can never exceed what was admitted.
 */
export function estimateUsageCharge(pricing: ModelPricing, usage: { inputTokens: number; outputTokens: number; cachedInputTokens?: number }): bigint {
  const cached = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens);
  if (pricing.cached_input_per_million === undefined || cached === 0) return estimateCharge(pricing, usage.inputTokens, usage.outputTokens);
  if (![usage.inputTokens, usage.outputTokens, cached].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error("INVALID_CHARGE_COUNTS");
  const numerator = BigInt(usage.inputTokens - cached) * amountCeiling(pricing.input_per_million)
    + BigInt(cached) * amountCeiling(pricing.cached_input_per_million) + BigInt(usage.outputTokens) * amountCeiling(pricing.output_per_million);
  return (numerator + 999_999n) / 1_000_000n;
}
