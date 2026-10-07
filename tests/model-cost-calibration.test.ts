import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelAdmission } from "../src/cognitive/model-admission.js";
import { calibratedInputAllocation } from "../src/cognitive/model-execution.js";
import { BudgetSchema } from "../src/graph/contracts.js";
import { estimateCharge, estimateUsageCharge, ModelPricingSchema, type ModelPricing } from "../src/config/model-pricing.js";
import { releaseGraphWriter } from "../src/graph/writer-lease.js";

const pricing: ModelPricing = { provider: "openai", model: "fixture", currency: "USD", version: "fixture-price.v1", source: "frozen fixture tariff",
  input_per_million: 10, output_per_million: 10, output_includes_reasoning: true, input_includes_images: true };
const cachedPricing: ModelPricing = { ...pricing, cached_input_per_million: 1 };

describe("cached input tariff", () => {
  it("is optional and charges cached input at the full input tariff when absent", () => {
    expect(ModelPricingSchema.parse(pricing)).toEqual(pricing);
    expect(ModelPricingSchema.parse(cachedPricing).cached_input_per_million).toBe(1);
    expect(() => ModelPricingSchema.parse({ ...pricing, cached_input_per_million: -1 })).toThrow();
    expect(estimateUsageCharge(pricing, { inputTokens: 1000, outputTokens: 100, cachedInputTokens: 900 })).toBe(estimateCharge(pricing, 1000, 100));
  });

  it("charges provider-reported cache reads at the cached tariff and never more than the cached count reported", () => {
    // 100 uncached × $10/M + 900 cached × $1/M + 100 output × $10/M = $0.0029
    expect(estimateUsageCharge(cachedPricing, { inputTokens: 1000, outputTokens: 100, cachedInputTokens: 900 })).toBe(2_900_000n);
    expect(estimateUsageCharge(cachedPricing, { inputTokens: 1000, outputTokens: 100 })).toBe(estimateCharge(cachedPricing, 1000, 100));
    expect(estimateUsageCharge(cachedPricing, { inputTokens: 100, outputTokens: 0, cachedInputTokens: 500 })).toBe(100_000n);
  });

  describe("settlement", () => {
    let root: string;
    beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "dg-cached-tariff-")); });
    afterEach(async () => { await releaseGraphWriter(root); await rm(root, { recursive: true, force: true }); });
    it("accounts cache reads at the cached tariff while the reservation stays undiscounted", async () => {
      const service = new ModelAdmission("i", root);
      const budget = BudgetSchema.parse({ requests: 5, input_tokens: 10_000, output_tokens: 1000, reasoning_tokens: 0, retries: 1, concurrency: 2,
        elapsed_ms: 86_400_000, max_hops: 2, max_neighbors: 40, run_amount: 1, day_amount: 1, currency: "USD",
        billing_principal: "fixture-account", pricing_version: pricing.version });
      const reserved = await service.reserve({ id: "a", run_id: "run", policy_fingerprint: "policy:1", provider: "openai", model: "fixture", channel: "api",
        credential_reference: "DREAMGRAPH_LLM_API_KEY", payload_hash: "payload:a", source_scope: ["repo/file.ts"], budget,
        resources: { input_tokens: 1000, output_tokens: 100, reasoning_tokens: 0, retry: false }, pricing: cachedPricing });
      expect(reserved.reserved_nanounits).toBe(String(estimateCharge(cachedPricing, 1000, 100)));
      await service.dispatch("a");
      const settled = await service.settle("a", { acknowledged: true, usage: { inputTokens: 1000, outputTokens: 100, cachedInputTokens: 900 } });
      expect(settled.accounted_nanounits).toBe("2900000");
      expect(settled.variance).toEqual([]);
    });
  });
});

describe("calibrated input allocation", () => {
  const request = (items: string[], instructions = "system ".repeat(200)) => JSON.stringify({ model: "m", input: items, tools: [], instructions });

  it("counts UTF-8 bytes when the run has no measured request yet", () => {
    const payload = request(["hello"]);
    expect(calibratedInputAllocation(undefined, payload)).toBe(Buffer.byteLength(payload));
  });

  it("counts the shared prefix and suffix by the reported tokens and only the new bytes by size", () => {
    const first = request(["a".repeat(4000)]), second = request(["a".repeat(4000), "new tool result"]);
    const allocation = calibratedInputAllocation({ payload: first, input_tokens: 1200 }, second);
    expect(allocation).toBe(1200 + Buffer.byteLength(',"new tool result"'));
    expect(allocation).toBeLessThan(Buffer.byteLength(second));
  });

  it("does not subtract removed content and never exceeds the byte count", () => {
    const first = request(["image".repeat(2000), "b"]), second = request(["b"]);
    expect(calibratedInputAllocation({ payload: first, input_tokens: 3000 }, second)).toBe(Buffer.byteLength(second));
    expect(calibratedInputAllocation({ payload: first, input_tokens: 10 }, second)).toBe(10);
  });

  it("ignores an invalid measurement", () => {
    const payload = request(["x"]);
    expect(calibratedInputAllocation({ payload, input_tokens: -1 }, payload)).toBe(Buffer.byteLength(payload));
  });
});
