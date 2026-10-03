import { describe, expect, it, vi } from "vitest";
import { ProviderOutcomeError } from "../src/cognitive/provider-outcome.js";
import { runArchitectNativeToolLoop } from "../src/architect/native-tool-loop.js";

describe("Architect failed attempt usage", () => {
  it("retains provider usage on refusal without accepting partial content", async () => {
    const usage = { inputTokens: 100, outputTokens: 7, cachedInputTokens: 40 };
    const failure = new ProviderOutcomeError("PROVIDER_REFUSAL", "openai", "gpt-5.4", "refusal", usage);
    const onUsage = vi.fn();
    await expect(runArchitectNativeToolLoop({
      req: { headers: {} } as any, config: { provider: "none", model: "gpt-5.4" } as any,
      provider: { name: "openai", isAvailable: async () => true, complete: async () => { throw failure; } },
      messages: [{ role: "user", content: "Inspect the project" }], userMessage: "Inspect the project", onUsage,
    })).rejects.toBe(failure);
    expect(onUsage).toHaveBeenCalledExactlyOnceWith(usage);
  });

  it("reports unknown usage for transport failure instead of zero", async () => {
    const onUsage = vi.fn();
    await expect(runArchitectNativeToolLoop({
      req: { headers: {} } as any, config: { provider: "none", model: "custom" } as any,
      provider: { name: "custom", isAvailable: async () => true, complete: async () => { throw new Error("lost response"); } },
      messages: [], userMessage: "Inspect", onUsage,
    })).rejects.toThrow("lost response");
    expect(onUsage).toHaveBeenCalledExactlyOnceWith(undefined);
  });
});
