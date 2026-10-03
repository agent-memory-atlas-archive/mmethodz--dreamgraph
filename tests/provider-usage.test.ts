import { describe, expect, it } from "vitest";
import { summarizeProviderUsage } from "../src/cognitive/provider-usage.js";
describe("actual multi-call usage", () => {
  it("totals reported calls without adding cache/reasoning components twice", () => {
    expect(summarizeProviderUsage([{ inputTokens: 100, outputTokens: 40, totalTokens: 140, cachedInputTokens: 80, reasoningTokens: 30 }, { inputTokens: 200, outputTokens: 60, totalTokens: 260, cachedInputTokens: 150, reasoningTokens: 40 }])).toMatchObject({ usage: { inputTokens: 300, outputTokens: 100, totalTokens: 400, cachedInputTokens: 230, reasoningTokens: 70 }, usage_provenance: "provider_reported" });
  });
  it("never reports a whole-pass zero or complete total when a call is unknown", () => {
    const result = summarizeProviderUsage([{ inputTokens: 10, outputTokens: 5 }, undefined]);
    expect(result.usage).toBeUndefined(); expect(result.usage_provenance).toBe("partial"); expect(result.usage_by_call).toEqual([{ inputTokens: 10, outputTokens: 5 }, null]);
    expect(summarizeProviderUsage([undefined, {}])).toMatchObject({ usage: undefined, usage_provenance: "unavailable" });
  });
  it("retains independent known metrics and refuses arithmetic overflow", () => {
    expect(summarizeProviderUsage([{ inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 1 }, { inputTokens: 1, outputTokens: 2 }]).usage).toEqual({ outputTokens: 3 });
  });
});
