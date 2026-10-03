/** Frozen source-labelled evaluator. No provider, credentials, graph writes or promotion. */
import { performance } from "node:perf_hooks";
import { z } from "zod";
import { cognitiveHash } from "../cognitive/cognitive-provenance.js";
import type { ResolvedRolePolicy } from "../config/role-policy.js";
import type { TokenUsage } from "../cognitive/llm.js";

export const CognitiveCaseSchema = z.object({ id: z.string().min(1), version: z.string().min(1),
  stage: z.enum(["initial_scan", "mature_graph", "computer_use"]),
  sources: z.array(z.object({ id: z.string().min(1), content: z.string(), ancestry_id: z.string().min(1),
    supports: z.array(z.string().min(1)), contradicts: z.array(z.string().min(1)) }).strict()).max(128),
  known_claims: z.array(z.string().min(1)), required_contradictions: z.array(z.string().min(1)),
  required_abstentions: z.array(z.string().min(1)), prompt_version: z.string().min(1), schema_version: z.string().min(1),
}).strict();
export type CognitiveCase = z.infer<typeof CognitiveCaseSchema>;
const metric = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const CognitiveReplySchema = z.object({ outcome: z.enum(["completed", "refused", "incomplete", "unavailable"]),
  original_output: z.string().max(1_048_576), calls: metric, latency_ms: z.number().finite().nonnegative(),
  usage: z.object(Object.fromEntries(["inputTokens", "outputTokens", "totalTokens", "reasoningTokens", "cachedInputTokens", "cacheCreationInputTokens"].map(key => [key, metric.optional()]))).strict().optional(),
  candidates: z.array(z.object({ id: z.string().min(1), claim: z.string().min(1), cited_source_ids: z.array(z.string().min(1)),
    outcome: z.enum(["hypothesis", "validated", "rejected", "abstained"]), novel: z.boolean() }).strict()).max(1024),
  contradictions: z.array(z.string().min(1)), abstentions: z.array(z.string().min(1)),
}).strict();
export type CognitiveReply = z.infer<typeof CognitiveReplySchema>;
const copyFrozen = <T>(value: T): T => {
  const copy = structuredClone(value);
  const freeze = (v: unknown): void => { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } };
  freeze(copy); return copy;
};

/** Exact reviewed claim labels form the oracle; model wording/consensus does not. */
export function assessCognitiveReply(caseInput: CognitiveCase, replyInput: CognitiveReply) {
  const task = CognitiveCaseSchema.parse(caseInput), reply = CognitiveReplySchema.parse(replyInput);
  if (new Set(task.sources.map(s => s.id)).size !== task.sources.length) throw new Error("DUPLICATE_EVIDENCE_ID");
  if (new Set(reply.candidates.map(s => s.id)).size !== reply.candidates.length) throw new Error("DUPLICATE_CANDIDATE_ID");
  const sources = new Map(task.sources.map(source => [source.id, source]));
  const candidates = reply.candidates.map(candidate => {
    const cited = [...new Set(candidate.cited_source_ids)], unknown = cited.filter(id => !sources.has(id));
    const supported = cited.filter(id => sources.get(id)?.supports.includes(candidate.claim));
    // Contradictions are checked against ALL supplied evidence, not only the model's chosen citations.
    const contradictory = task.sources.filter(source => source.contradicts.includes(candidate.claim)).map(source => source.id);
    const independent = new Set(supported.map(id => sources.get(id)!.ancestry_id)).size;
    const grounded = supported.length > 0 && !unknown.length && !contradictory.length;
    return { ...candidate, unknown_citations: unknown, supporting_source_ids: supported,
      contradictory_source_ids: contradictory, independent_source_count: independent,
      unsupported_promotion: candidate.outcome === "validated" && (!grounded || independent < 2),
      factual_error: ["hypothesis", "validated"].includes(candidate.outcome) && (!grounded || contradictory.length > 0),
      useful_novel_candidate: grounded && candidate.outcome === "hypothesis" && candidate.novel && !task.known_claims.includes(candidate.claim) };
  });
  return { schema: "dreamgraph.cognitive_assessment.v1", case_id: task.id, case_hash: cognitiveHash(task),
    source_manifest_hash: cognitiveHash(task.sources), original_output: reply.original_output, output_hash: cognitiveHash(reply.original_output),
    outcome: reply.outcome, calls: reply.calls, latency_ms: reply.latency_ms, usage: reply.usage as TokenUsage | undefined ?? null,
    cost: null, charge_status: "not_measured", candidates,
    factual_errors: candidates.filter(c => c.factual_error).length,
    useful_novel_candidates: candidates.filter(c => c.useful_novel_candidate).length,
    unsupported_promotions: candidates.filter(c => c.unsupported_promotion).length,
    missed_contradictions: task.required_contradictions.filter(claim => !reply.contradictions.includes(claim)),
    missed_abstentions: task.required_abstentions.filter(claim => !reply.abstentions.includes(claim)),
    limitations: ["Fixed source-labelled oracle; no model superiority or production promotion is established.", "Repeated/model-consensus ancestry is one source, never independent corroboration."] };
}

export async function evaluateCognitivePolicies(input: {
  task: CognitiveCase; policies: Readonly<ResolvedRolePolicy>[]; kind: "offline_fixture" | "paid_canary";
  execute: (input: { task: Readonly<CognitiveCase>; policy: Readonly<ResolvedRolePolicy>; signal: AbortSignal }) => Promise<CognitiveReply>;
  signal?: AbortSignal;
}) {
  if (input.kind !== "offline_fixture") throw new Error("PAID_CANARY_REQUIRES_SEPARATE_DATA_RETENTION_CONSENT_AND_SUPERVISED_ADMISSION");
  const task = copyFrozen(CognitiveCaseSchema.parse(input.task)), policies = copyFrozen(input.policies);
  if (!policies.length || policies.length > 32) throw new Error("BOUNDED_POLICY_COMPARISON_REQUIRED");
  const results = [];
  for (const policy of policies) {
    input.signal?.throwIfAborted();
    if (policy.status !== "configured") throw new Error("EVALUATION_POLICY_BLOCKED");
    const deadline = AbortSignal.timeout(Math.min(policy.effective.timeout_ms, policy.policy.budget.elapsed_ms));
    const signal = input.signal ? AbortSignal.any([input.signal, deadline]) : deadline;
    const start = performance.now();
    const reply = await new Promise<CognitiveReply>((resolve, reject) => {
      const abort = () => reject(signal.reason); signal.addEventListener("abort", abort, { once: true });
      Promise.resolve().then(() => { signal.throwIfAborted(); return input.execute({ task, policy, signal }); })
        .then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
    signal.throwIfAborted();
    const checked = CognitiveReplySchema.parse(reply);
    if (checked.calls > policy.policy.budget.requests || (checked.usage?.inputTokens ?? 0) > policy.policy.budget.input_tokens
      || (checked.usage?.outputTokens ?? 0) > policy.policy.budget.output_tokens
      || (checked.usage?.reasoningTokens ?? 0) > policy.policy.budget.reasoning_tokens) throw new Error("EVALUATION_RESOURCE_LIMIT");
    results.push({ policy_fingerprint: policy.fingerprint, role: policy.policy.role, provider: policy.effective.provider,
      model: policy.effective.model, adapter: policy.effective.adapter, api: policy.effective.api, effort: policy.effective.effort,
      retention: policy.effective.retention, prompt_version: task.prompt_version, schema_version: task.schema_version,
      construction_and_fixture_ms: performance.now() - start, assessment: assessCognitiveReply(task, checked) });
  }
  return { schema: "dreamgraph.cognitive_policy_evaluation.v1", kind: input.kind, stage: task.stage,
    task_hash: cognitiveHash(task), results, model_gain: null, paid_canaries: "not_run", actual_computer_use: "unqualified" };
}
