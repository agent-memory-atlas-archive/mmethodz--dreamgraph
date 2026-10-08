/**
 * Anthropic prompt caching for the native tool loop (v14.0.2 follow-up): explicit cache breakpoints, and charges for
 * cache reads and writes (Anthropic bills writes above the input tariff).
 */
import { describe, expect, it } from "vitest";
import { withAnthropicPromptCache } from "../src/cognitive/llm.js";
import { estimateCharge, estimateUsageCharge, ModelPricingSchema } from "../src/config/model-pricing.js";

const mark = { type: "ephemeral" };

describe("Anthropic cache breakpoints", () => {
  it("marks the last tool, the system prompt and the last block of the latest message", () => {
    const body = withAnthropicPromptCache({
      tools: [{ name: "a" }, { name: "b" }],
      system: "SYSTEM",
      messages: [
        { role: "user", content: "task" },
        { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "b", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }, { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AAA" } }] },
      ],
    });
    expect(body.tools).toEqual([{ name: "a" }, { name: "b", cache_control: mark }]);
    expect(body.system).toEqual([{ type: "text", text: "SYSTEM", cache_control: mark }]);
    const messages = body.messages as Array<{ content: unknown }>;
    expect(messages[0].content).toBe("task");
    expect(messages[2].content).toEqual([{ type: "tool_result", tool_use_id: "t1", content: "ok" }, { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AAA" }, cache_control: mark }]);
    expect(JSON.stringify(body).split("cache_control").length - 1).toBe(3);
  });

  it("turns a string message into a marked text block and never marks thinking blocks", () => {
    const first = withAnthropicPromptCache({ messages: [{ role: "user", content: "only" }] });
    expect((first.messages as Array<{ content: unknown }>)[0].content).toEqual([{ type: "text", text: "only", cache_control: mark }]);
    const thinking = withAnthropicPromptCache({ messages: [{ role: "assistant", content: [{ type: "text", text: "a" }, { type: "thinking", thinking: "x", signature: "s" }] }] });
    expect((thinking.messages as Array<{ content: unknown }>)[0].content).toEqual([{ type: "text", text: "a", cache_control: mark }, { type: "thinking", thinking: "x", signature: "s" }]);
  });

  it("does not change the caller's raw assistant blocks", () => {
    const raw = [{ type: "text", text: "kept" }];
    withAnthropicPromptCache({ messages: [{ role: "assistant", content: raw }] });
    expect(raw).toEqual([{ type: "text", text: "kept" }]);
  });
});

describe("cache read and write charges", () => {
  // $5 input, $0.50 cache read, $6.25 cache write, $25 output per million tokens.
  const pricing = ModelPricingSchema.parse({ version: "test", provider: "anthropic", model: "claude-opus-5-5", currency: "USD", source: "test",
    input_per_million: 5, cached_input_per_million: 0.5, cache_write_input_per_million: 6.25, output_per_million: 25, output_includes_reasoning: true, input_includes_images: true });
  const nano = (usd: number) => String(BigInt(Math.round(usd * 1e9)));

  it("charges uncached input, cache reads, cache writes and output at their own tariffs", () => {
    // 1,000 uncached + 9,000 read + 2,000 written = 12,000 input tokens.
    expect(String(estimateUsageCharge(pricing, { inputTokens: 12_000, outputTokens: 1_000, cachedInputTokens: 9_000, cacheCreationInputTokens: 2_000 })))
      .toBe(nano(1_000 * 5e-6 + 9_000 * 0.5e-6 + 2_000 * 6.25e-6 + 1_000 * 25e-6));
  });

  it("reserves input at the highest input tariff, so a full cache write stays within the reservation", () => {
    const reserved = estimateCharge(pricing, 12_000, 1_000);
    expect(String(reserved)).toBe(nano(12_000 * 6.25e-6 + 1_000 * 25e-6));
    expect(estimateUsageCharge(pricing, { inputTokens: 12_000, outputTokens: 1_000, cacheCreationInputTokens: 12_000 }) <= reserved).toBe(true);
  });

  it("uses the input tariff when no cache tariffs are entered", () => {
    const plain = ModelPricingSchema.parse({ ...pricing, cached_input_per_million: undefined, cache_write_input_per_million: undefined });
    expect(String(estimateUsageCharge(plain, { inputTokens: 12_000, outputTokens: 1_000, cachedInputTokens: 9_000, cacheCreationInputTokens: 2_000 })))
      .toBe(String(estimateCharge(plain, 12_000, 1_000)));
  });
});
