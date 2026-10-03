import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelAdmission, type AdmissionRequest } from "../src/cognitive/model-admission.js";
import { BudgetSchema } from "../src/graph/contracts.js";
import { estimateCharge, type ModelPricing } from "../src/config/model-pricing.js";
import { releaseGraphWriter } from "../src/graph/writer-lease.js";
import * as publication from "../src/graph/publication.js";
import { withDataDirectory } from "../src/utils/paths.js";
import { loadJsonData } from "../src/utils/cache.js";

let root: string;
const pricing: ModelPricing = { provider: "openai", model: "fixture", currency: "USD", version: "fixture-price.v1", source: "frozen fixture tariff",
  input_per_million: 10, output_per_million: 10, output_includes_reasoning: true, input_includes_images: true };
function request(id: string, updates: Partial<AdmissionRequest> = {}): AdmissionRequest {
  return { id, run_id: "run", policy_fingerprint: "policy:1", provider: "openai", model: "fixture", channel: "api",
    credential_reference: "DREAMGRAPH_LLM_API_KEY", payload_hash: `payload:${id}`, source_scope: ["repo/file.ts"],
    budget: BudgetSchema.parse({ requests: 5, input_tokens: 1000, output_tokens: 1000, reasoning_tokens: 500, retries: 1, concurrency: 2,
      elapsed_ms: 86_400_000, max_hops: 2, max_neighbors: 40, run_amount: .02, day_amount: .02, currency: "USD",
      billing_principal: "fixture-account", pricing_version: pricing.version }),
    resources: { input_tokens: 100, output_tokens: 100, reasoning_tokens: 50, retry: false }, pricing, ...updates };
}
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "dg-admission-")); });
afterEach(async () => { vi.restoreAllMocks(); await releaseGraphWriter(root); await rm(root, { recursive: true, force: true }); });

describe("durable model admission", () => {
  it("admits no paid zero allocation or unpriced request and never creates a run record", async () => {
    const service = new ModelAdmission("i", root), input = request("a");
    await expect(service.reserve({ ...input, budget: { ...input.budget, run_amount: 0 } })).rejects.toThrow("ZERO_PAID");
    await expect(service.reserve({ ...input, pricing: null })).rejects.toThrow("EXACT_PRICING");
    expect((await service.inspect()).attempts).toEqual({});
  });
  it("reserves parallel calls atomically across separate service objects and enforces the daily pool", async () => {
    const a = new ModelAdmission("i", root), b = new ModelAdmission("i", root);
    const input = request("a"), budget = { ...input.budget, day_amount: .003, concurrency: 5 };
    const results = await Promise.allSettled([a.reserve({ ...input, budget }), b.reserve(request("b", { run_id: "another", budget }))]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    expect(Object.values((await a.inspect()).attempts)).toHaveLength(1);
  });
  it("binds identity and immutable run policy and cannot dispatch a lost/uncertain request twice", async () => {
    const service = new ModelAdmission("i", root);
    const reserved = await service.reserve(request("a"));
    expect(await service.reserve(request("a"))).toEqual(reserved);
    await expect(service.reserve(request("a", { payload_hash: "different" }))).rejects.toThrow("IDENTITY_CONFLICT");
    await expect(service.reserve(request("b", { policy_fingerprint: "new" }))).rejects.toThrow("RUN_POLICY_CHANGED");
    await service.dispatch("a");
    const restarted = new ModelAdmission("i", root);
    await expect(restarted.dispatch("a")).rejects.toThrow("REDISPATCH_FORBIDDEN");
    const unknown = await restarted.settle("a", { acknowledged: false });
    expect(unknown.usage).toBeNull(); expect(unknown.accounted_nanounits).toBe(reserved.reserved_nanounits);
    await expect(restarted.release("a")).rejects.toThrow("REQUIRES_NO_DISPATCH");
  });
  it("retains unknown usage liabilities and conflict slots across restart", async () => {
    const input = request("a"), budget = { ...input.budget, concurrency: 1 };
    const service = new ModelAdmission("i", root);
    await service.reserve({ ...input, budget }); await service.dispatch("a"); await service.settle("a", { acknowledged: false });
    const restarted = new ModelAdmission("i", root);
    await expect(restarted.reserve(request("b", { run_id: "next", budget }))).rejects.toThrow("CONCURRENCY_LIMIT");
    await restarted.settle("a", { acknowledged: true });
    await restarted.reserve(request("b", { budget }));
    expect((await restarted.inspect()).attempts.a.accounted_nanounits).toBe("2000000");
  });
  it("uses actual input/output without double billing cache/reasoning and releases only unused charge", async () => {
    const service = new ModelAdmission("i", root);
    await service.reserve(request("a")); await service.dispatch("a");
    const settled = await service.settle("a", { acknowledged: true, usage: { inputTokens: 60, outputTokens: 40, cachedInputTokens: 20, reasoningTokens: 30 } });
    expect(settled.state).toBe("settled"); expect(settled.accounted_nanounits).toBe("1000000");
    expect(settled.charge_source).toBe("provider_usage_estimate");
    expect(await service.settle("a", { acknowledged: true, usage: settled.usage! })).toEqual(settled);
    expect(estimateCharge(pricing, 60, 40)).toBe(1_000_000n);
  });
  it("halts new admission on measured variance and never claims invoice control", async () => {
    const service = new ModelAdmission("i", root);
    await service.reserve(request("a")); await service.dispatch("a");
    const settled = await service.settle("a", { acknowledged: true, usage: { inputTokens: 120, outputTokens: 120, reasoningTokens: 60 } });
    expect(settled.variance).toContain("estimated_charge_exceeded_reservation");
    await expect(service.reserve(request("b", { run_id: "next" }))).rejects.toThrow("VARIANCE_REQUIRES_REVIEW");
  });
  it("retains the UTC admission day over midnight and keeps the original run cap", async () => {
    let now = new Date("2026-09-30T23:59:59Z"); const service = new ModelAdmission("i", root, () => now);
    const input = request("a"), budget = { ...input.budget, run_amount: .003, day_amount: .002 };
    await service.reserve({ ...input, budget }); await service.dispatch("a");
    now = new Date("2026-10-01T00:00:01Z"); await service.settle("a", { acknowledged: true });
    expect((await service.inspect()).attempts.a.day).toBe("2026-09-30");
    await expect(service.reserve(request("b", { budget }))).rejects.toThrow("RUN_AMOUNT_LIMIT");
    expect((await service.reserve(request("c", { run_id: "next", budget }))).day).toBe("2026-10-01");
  });
  it("bounds reasoning, elapsed time and cancellation separately", async () => {
    let now = new Date("2026-09-30T20:00:00Z"); const service = new ModelAdmission("i", root, () => now);
    const input = request("a"), budget = { ...input.budget, reasoning_tokens: 50, elapsed_ms: 1000 };
    await service.reserve({ ...input, budget }); await service.dispatch("a"); await service.settle("a", { acknowledged: true });
    await expect(service.reserve(request("b", { budget }))).rejects.toThrow("REASONING_TOKENS_LIMIT");
    now = new Date("2026-09-30T20:00:01Z");
    await expect(service.reserve(request("c", { budget }))).rejects.toThrow("RUN_DEADLINE");
    expect(await service.cancel("run")).toEqual([]);
    await expect(service.reserve(request("d", { budget }))).rejects.toThrow("RUN_CANCELLED");
  });
  it("recovers a lost reserve reply from publication without forgetting its budget", async () => {
    const service = new ModelAdmission("i", root);
    const commit = publication.commitGraphWrites;
    const spy = vi.spyOn(publication, "commitGraphWrites").mockImplementationOnce(async input => { await commit(input); throw new Error("reply lost"); });
    await expect(service.reserve(request("a"))).rejects.toThrow("reply lost"); spy.mockRestore();
    const restarted = new ModelAdmission("i", root), previous = await restarted.reserve(request("a"));
    expect(previous.state).toBe("reserved"); await restarted.dispatch("a");
    expect(Object.keys((await restarted.inspect()).attempts)).toEqual(["a"]);
  });
  it("pins distinct physical roots and detects external ledger corruption", async () => {
    const other = await mkdtemp(join(tmpdir(), "dg-admission-other-"));
    try {
      const a = new ModelAdmission("i", root), b = new ModelAdmission("other", other);
      await Promise.all([a.reserve(request("a")), b.reserve(request("b"))]);
      expect(Object.keys((await a.inspect()).attempts)).toEqual(["a"]);
      expect(Object.keys((await b.inspect()).attempts)).toEqual(["b"]);
      expect(await withDataDirectory(other, () => loadJsonData<any>("spend_ledger.json"))).toMatchObject({ instance_id: "other" });
      const state = await withDataDirectory(root, () => publication.loadPublicationState());
      expect(state.currency.last_graph_mutation_at).toBeNull();
      const ledger = JSON.parse(await readFile(join(root, "spend_ledger.json"), "utf8")); ledger.revision++;
      await writeFile(join(root, "spend_ledger.json"), JSON.stringify(ledger));
      await expect(a.inspect()).rejects.toThrow("UNPUBLISHED_ADMISSION_CHANGE");
    } finally { await releaseGraphWriter(other); await rm(other, { recursive: true, force: true }); }
  });
  it.each(["requests", "retries", "input_tokens", "output_tokens"] as const)("independently rejects the %s limit before reservation", async field => {
    const input = request("a"), budget = { ...input.budget, [field]: field === "requests" ? 1 : field === "retries" ? 0 : 100 };
    const service = new ModelAdmission("i", root);
    await service.reserve({ ...input, budget }); await service.dispatch("a"); await service.settle("a", { acknowledged: true });
    await expect(service.reserve(request("b", { budget, resources: { ...input.resources, retry: field === "retries" } }))).rejects.toThrow(
      field === "requests" ? "REQUEST_LIMIT" : field === "retries" ? "RETRY_LIMIT" : `${field.toUpperCase()}_LIMIT`);
    expect(Object.keys((await service.inspect()).attempts)).toEqual(["a"]);
  });
  it("does not redispatch after a lost dispatch reply or release earlier observed usage", async () => {
    const service = new ModelAdmission("i", root); await service.reserve(request("a"));
    const commit = publication.commitGraphWrites;
    const spy = vi.spyOn(publication, "commitGraphWrites").mockImplementationOnce(async input => { await commit(input); throw new Error("dispatch reply lost"); });
    await expect(service.dispatch("a")).rejects.toThrow("dispatch reply lost"); spy.mockRestore();
    const restarted = new ModelAdmission("i", root);
    await expect(restarted.dispatch("a")).rejects.toThrow("REDISPATCH_FORBIDDEN");
    await restarted.settle("a", { acknowledged: true, usage: { outputTokens: 80 } });
    await expect(restarted.settle("a", { acknowledged: true, usage: { outputTokens: 20 } })).rejects.toThrow("USAGE_REGRESSION");
    expect((await restarted.inspect()).attempts.a.usage!.outputTokens).toBe(80);
  });
  it("shares the principal daily cap across credential aliases and rejects regressed dispatch clocks", async () => {
    let now = new Date("2026-09-30T20:00:00Z"); const service = new ModelAdmission("i", root, () => now), input = request("a");
    const budget = { ...input.budget, day_amount: .003 };
    await service.reserve({ ...input, budget });
    await expect(service.reserve(request("b", { run_id: "another", budget, credential_reference: "OTHER_NAME_SAME_ACCOUNT" }))).rejects.toThrow("DAY_AMOUNT_LIMIT");
    now = new Date("2026-09-30T19:59:59Z"); await expect(service.dispatch("a")).rejects.toThrow("CLOCK_REGRESSION");
    expect((await service.inspect()).attempts.a.state).toBe("reserved");
  });

});
