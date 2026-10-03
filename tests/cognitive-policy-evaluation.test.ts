import { describe, it, expect, vi } from "vitest";
import { assessCognitiveReply, evaluateCognitivePolicies, type CognitiveCase, type CognitiveReply } from "../src/evaluation/cognitive-policy.js";
import { resolveRolePolicy } from "../src/config/role-policy.js";
import { cognitiveProvenance } from "../src/cognitive/cognitive-provenance.js";

const task: CognitiveCase = { id: "fixed:mature:boundary", version: "1", stage: "mature_graph", prompt_version: "fixture:1", schema_version: "fixture:1",
  known_claims: ["known"], required_contradictions: ["unsafe"], required_abstentions: ["unknown"], sources: [
    { id: "source", ancestry_id: "source:1", content: "Observed boundary", supports: ["novel", "known"], contradicts: ["unsafe"] },
    { id: "summary", ancestry_id: "source:1", content: "Model repeats source", supports: ["novel"], contradicts: [] },
    { id: "independent", ancestry_id: "source:2", content: "Independent consequence", supports: ["novel"], contradicts: [] }] };
const reply: CognitiveReply = { outcome: "completed", original_output: "Retained original", calls: 1, latency_ms: 3, candidates: [], contradictions: ["unsafe"], abstentions: ["unknown"] };
const policy = () => resolveRolePolicy({ role: "dreamer", env: { DREAMGRAPH_LLM_PROVIDER: "openai", DREAMGRAPH_LLM_MODEL: "gpt-5.4" } });
describe("mature graph evidence policy evaluation", () => {
  it("counts model consensus as one ancestry and detects unsupported promotion despite confidence", () => {
    const r = assessCognitiveReply(task, { ...reply, candidates: [
      { id: "repeated", claim: "novel", cited_source_ids: ["source", "summary"], outcome: "validated", novel: true },
      { id: "independent", claim: "novel", cited_source_ids: ["source", "independent"], outcome: "validated", novel: true }] });
    expect(r.unsupported_promotions).toBe(1); expect(r.candidates.map(c => c.independent_source_count)).toEqual([1, 2]);
    expect(r.cost).toBeNull(); expect(r.usage).toBeNull(); expect(r.original_output).toBe(reply.original_output);
  });
  it("checks unchosen contradictory sources, unknown citations, novel candidates and justified abstentions", () => {
    const r = assessCognitiveReply(task, { ...reply, contradictions: [], abstentions: [], candidates: [
      { id: "creative", claim: "novel", cited_source_ids: ["source"], outcome: "hypothesis", novel: true },
      { id: "fabricated", claim: "unsafe", cited_source_ids: ["summary", "imaginary"], outcome: "validated", novel: true }] });
    expect(r.useful_novel_candidates).toBe(1); expect(r.factual_errors).toBe(1); expect(r.unsupported_promotions).toBe(1);
    expect(r.missed_contradictions).toEqual(["unsafe"]); expect(r.missed_abstentions).toEqual(["unknown"]);
    expect(r.candidates[1].contradictory_source_ids).toEqual(["source"]);
  });
  it("freezes task/policy labels, preserves refusal and leaves model gain unmeasured", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    try {
      const r = await evaluateCognitivePolicies({ task, policies: [policy()], kind: "offline_fixture", execute: async input => {
        expect(Object.isFrozen(input.task.sources[0])).toBe(true); expect(Object.isFrozen(input.policy.policy.budget)).toBe(true);
        return { ...reply, outcome: "refused", original_output: "Refusal" };
      } });
      expect(r.results[0].assessment.outcome).toBe("refused"); expect(r.model_gain).toBeNull(); expect(r.paid_canaries).toBe("not_run");
      expect(fetch).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it("never enables paid/provider Computer Use canaries from evaluation mode alone", async () => {
    const execute = vi.fn(); await expect(evaluateCognitivePolicies({ task, policies: [policy()], kind: "paid_canary", execute }))
      .rejects.toThrow("SEPARATE_DATA_RETENTION_CONSENT"); expect(execute).not.toHaveBeenCalled();
  });
  it("rejects malformed measurements and terminates the harness deadline", async () => {
    expect(() => assessCognitiveReply(task, { ...reply, calls: -1 })).toThrow();
    const p = policy(); p.effective.timeout_ms = 5;
    await expect(evaluateCognitivePolicies({ task, policies: [p], kind: "offline_fixture", execute: () => new Promise(() => {}) })).rejects.toThrow();
  });
  it("retains exact source/prompt/schema/route hashes while changing models cannot change evidence class", () => {
    const input = { role: "dreamer" as const, prompt_version: "fixture:1", schema_version: "fixture:1", messages: [{ role: "user" as const, content: "source context" }],
      output_schema: { type: "object" }, source_context: task.sources, source_ids: ["source"], policy: policy(), elapsed_ms: 3,
      response: { text: "hypothesis", model: "reported-model", usage: { inputTokens: 6 }, outputContract: { api: "responses" as const, mode: "native_strict" as const, capabilityVersion: "fixture:1" } } };
    const first = cognitiveProvenance(input), second = cognitiveProvenance({ ...input, messages: [{ role: "user", content: "changed" }] });
    expect(first.prompt_hash).not.toBe(second.prompt_hash); expect(first.source_manifest_hash).toBe(second.source_manifest_hash);
    expect(first.reported_model).toBe("reported-model"); expect(first.independence).toBe("model_assessment_not_independent_evidence");
    expect(first).not.toHaveProperty("apiKey");
  });
});
