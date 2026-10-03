/** Matched task evidence, never a graph-size/prompt-length claim of model superiority. */
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import type { TokenUsage } from "../cognitive/llm.js";
import {createLlmProviderForConfig,type LlmConfig} from "../cognitive/llm.js";
import {EngineJobs} from "../cognitive/jobs.js";
import {currentJob} from "../cognitive/job-context.js";
import {BudgetSchema} from "../graph/contracts.js";
import {resolveRolePolicy,snapshotRolePolicy,RoleSettingsSchema} from "../config/role-policy.js";
import {ModelPricingSchema,estimateCharge,allocationFloor} from "../config/model-pricing.js";
import {ProviderCapabilitySchema} from "../config/provider-capabilities.js";

const digest = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const MatchedExecutionSchema = z.object({
  provider: z.string().min(1), model: z.string().min(1), api: z.string().min(1), effort: z.string().nullable(),
  prompt_version: z.string().min(1), source_manifest_hash: z.string().min(1),
  /** Whole provider-request token ceilings, separate from supplied context text measurements. */
  input_tokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), output_tokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  /** Independent UTF-8 memory/transport ceilings; these are never token accounting. */
  context_bytes: z.number().int().positive(), output_bytes: z.number().int().positive(),
  max_calls: z.number().int().positive(), max_elapsed_ms: z.number().int().positive(),
  retention: z.string().min(1), currency: z.string().min(1), max_amount: z.number().nonnegative().finite(),
}).strict();
export type MatchedExecution = z.infer<typeof MatchedExecutionSchema>;
export interface EvaluationTask {
  id: string; project: string; prompt: string;
  required_outcomes: string[]; mandatory_evidence_ids: string[]; forbidden_assertions: string[];
}
export interface EvaluationArm {
  arm: "graph_assisted" | "source_only"; context: string; source_manifest_hash: string;
  construction_ms: number; context_bytes: number;
}
export interface EvaluationReply {
  content: string; usage?: TokenUsage; calls: number;
  source_reads: Array<{ source_id: string; content_hash: string; verified: boolean }>;
  outcome: "completed" | "refused" | "incomplete" | "unavailable";
}
export interface EvaluationAssessment {
  reviewer: string; evidence_ids: string[]; mandatory_outcomes: Record<string, boolean>;
  unsupported_assertions: string[]; stale_assertions: string[];
  understanding: { architecture: number; history: number; constraints: number; uncertainty: number };
  rationale: string;
}
const usageSchema = z.object(Object.fromEntries(["inputTokens", "outputTokens", "totalTokens", "cachedInputTokens", "cacheCreationInputTokens", "reasoningTokens"].map(field => [field, z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional()]))).strict();
const replySchema = z.object({ content: z.string(), calls: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  usage: usageSchema.optional(), source_reads: z.array(z.object({ source_id: z.string().min(1), content_hash: z.string().min(1), verified: z.boolean() }).strict()).max(1024),
  outcome: z.enum(["completed", "refused", "incomplete", "unavailable"]) }).strict();
const freezeCopy = <T>(value: T): T => {
  const copy = structuredClone(value);
  const freeze = (node: unknown): void => { if (!node || typeof node !== "object") return; Object.values(node).forEach(freeze); Object.freeze(node); };
  freeze(copy); return copy;
};
const assessmentSchema = z.object({
  reviewer: z.string().min(1), evidence_ids: z.array(z.string().min(1)), mandatory_outcomes: z.record(z.boolean()),
  unsupported_assertions: z.array(z.string()), stale_assertions: z.array(z.string()),
  understanding: z.object({ architecture: z.number().int().min(0).max(3), history: z.number().int().min(0).max(3),
    constraints: z.number().int().min(0).max(3), uncertainty: z.number().int().min(0).max(3) }).strict(), rationale: z.string().min(1),
}).strict();
export interface PairedEvaluator {
  /** This harness never creates a provider, requests credentials, or reserves paid work. */
  execute(input: { task: EvaluationTask; arm: EvaluationArm; execution: Readonly<MatchedExecution>; signal: AbortSignal }): Promise<EvaluationReply>;
  assess(input: { task: EvaluationTask; arm: EvaluationArm; reply: EvaluationReply; signal: AbortSignal }): Promise<EvaluationAssessment>;
}
export function percentile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  if (values.some(value => !Number.isFinite(value) || value < 0) || fraction < 0 || fraction > 1) throw new Error("INVALID_MEASUREMENT");
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)];
}
export class EvaluationCancellationError extends Error {
  readonly termination_status = "unconfirmed";
  constructor(readonly phase: "execution" | "assessment", readonly abort_reason: unknown) {
    super(`EVALUATION_CANCELLED:${phase}; underlying work termination unconfirmed`, { cause: abort_reason });
    this.name = "EvaluationCancellationError";
  }
}
/** Bounds waiting, not provider/process termination. The execution owner must confirm its stop. */
async function waitWithCancellation<T>(signal: AbortSignal, phase: "execution" | "assessment", work: () => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new EvaluationCancellationError(phase, signal.reason));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => { signal.throwIfAborted(); return work(); }).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
/** Equal resource/model/source conditions; arm ordering alternates to reduce systematic order bias. */
type PairInput={
  task: EvaluationTask; execution: MatchedExecution; arms: [EvaluationArm, EvaluationArm]; evaluator: PairedEvaluator;
  kind: "offline_fixture" | "real_model"; order: "graph_first" | "source_first"; signal?: AbortSignal;
};
export async function evaluatePairedTask(input:PairInput){
  if(input.kind==="real_model")throw new Error("REAL_MODEL_EVALUATION_REQUIRES_SLICE_6_27_ADMISSION");
  return evaluatePair(input);
}
/** Private shared harness; only the closed, admitted provider owner below can collect real answers. */
async function evaluatePair(input:PairInput,deferAssessment=false) {
  const task = freezeCopy(input.task), arms = freezeCopy(input.arms);
  const execution = Object.freeze(MatchedExecutionSchema.parse(input.execution));
  if (new Set(arms.map(arm => arm.arm)).size !== 2) throw new Error("PAIRED_ARMS_REQUIRED");
  for (const arm of arms) {
    if (arm.source_manifest_hash !== execution.source_manifest_hash) throw new Error("UNMATCHED_SOURCE_MANIFEST");
    if (!Number.isFinite(arm.construction_ms) || arm.construction_ms < 0 || !Number.isSafeInteger(arm.context_bytes)
      || arm.context_bytes < 0 || arm.context_bytes > execution.context_bytes) throw new Error("UNMATCHED_RESOURCE_BOUND");
    if (arm.context_bytes !== Buffer.byteLength(arm.context, "utf8")) throw new Error("UNVERIFIED_CONTEXT_BYTE_COUNT");
  }
  const ordered = [...arms].sort((a, b) => Number(a.arm !== (input.order === "graph_first" ? "graph_assisted" : "source_only")) - Number(b.arm !== (input.order === "graph_first" ? "graph_assisted" : "source_only")));
  const results = [];
  for (const arm of ordered) {
    input.signal?.throwIfAborted();
    const deadline = AbortSignal.timeout(execution.max_elapsed_ms);
    const signal = input.signal ? AbortSignal.any([input.signal, deadline]) : deadline;
    const started = performance.now();
    const reply = replySchema.parse(await waitWithCancellation(signal, "execution", () => input.evaluator.execute({ task, arm, execution, signal }))) as EvaluationReply;
    const latency_ms = performance.now() - started;
    signal.throwIfAborted();
    if (!Number.isSafeInteger(reply.calls) || reply.calls < 0 || reply.calls > execution.max_calls) throw new Error("EVALUATION_CALL_BOUND_EXCEEDED");
    if (reply.usage?.inputTokens !== undefined && reply.usage.inputTokens > execution.input_tokens
      || reply.usage?.outputTokens !== undefined && reply.usage.outputTokens > execution.output_tokens) throw new Error("EVALUATION_TOKEN_BOUND_EXCEEDED");
    if (Buffer.byteLength(reply.content, "utf8") > execution.output_bytes) throw new Error("EVALUATION_OUTPUT_BYTE_BOUND_EXCEEDED");
    const assessment = deferAssessment ? null : assessmentSchema.parse(await waitWithCancellation(signal, "assessment", () => input.evaluator.assess({ task, arm, reply: freezeCopy(reply), signal })));
    signal.throwIfAborted();
    const mandatory_pass = assessment===null ? null : reply.outcome === "completed" && task.required_outcomes.every(outcome => assessment.mandatory_outcomes[outcome] === true)
      && task.mandatory_evidence_ids.every(id => assessment.evidence_ids.includes(id))
      && !assessment.unsupported_assertions.length && !assessment.stale_assertions.length;
    results.push({ arm: arm.arm, context_hash: digest(arm.context), context_bytes: arm.context_bytes, context_tokens: null,
      context_token_measurement: "unavailable", construction_ms: arm.construction_ms,
      latency_ms, calls: reply.calls, usage: reply.usage ?? null, verified_source_reads: reply.source_reads.filter(read => read.verified),
      outcome: reply.outcome, assessment, assessment_status:assessment===null?"pending_review":"assessed", mandatory_pass, answer: reply.content, answer_hash: digest(reply.content) });
  }
  return { schema: "dreamgraph.paired_task_evaluation.v3", task_id: task.id, project: task.project,
    kind: input.kind, order: input.order, task_hash: digest(task), execution, execution_hash: digest(execution), results,
    material_understanding_gain: null,
    limitations: ["Material understanding gain requires a separate reviewed recovered constraint/relationship/history and improved decision; scores or fewer rereads alone do not establish it.",
      "Context UTF-8 bytes are measured exactly; context tokens remain unavailable without a qualified tokenizer. Provider usage describes the whole request and is separate from context byte ceilings.",
      "Cancellation bounds waiting and propagates to execution and assessment; underlying termination requires the execution owner's acknowledgment and is not inferred by this harness.",
      ...(input.kind === "offline_fixture" ? ["Executor and assessments are deterministic test doubles; this is harness evidence, not measured model or established-instance superiority."] : [])] };
}

const boundedText=z.string().max(4*1024*1024),name=z.string().min(1).max(1024);
const taskSchema=z.object({id:name,project:name,prompt:boundedText,required_outcomes:z.array(name).max(128),mandatory_evidence_ids:z.array(name).max(128),forbidden_assertions:z.array(name).max(128)}).strict();
const armSchema=z.object({arm:z.enum(["graph_assisted","source_only"]),context:boundedText,source_manifest_hash:name,
  construction_ms:z.number().finite().nonnegative(),context_bytes:z.number().int().nonnegative().max(4*1024*1024)}).strict();
export const CompletionPairSpecificationSchema=z.object({schema:z.literal("dreamgraph.completion_pair_specification.v1"),task:taskSchema,
  execution:MatchedExecutionSchema,arms:z.tuple([armSchema,armSchema]),order:z.enum(["graph_first","source_first"]),
  endpoint:z.string().url(),api_key_env:z.string().regex(/^[A-Z][A-Z0-9_]*$/),pricing:ModelPricingSchema,budget:BudgetSchema,
  capability:ProviderCapabilitySchema.optional(),
  local_results:z.literal("private_job_artifact"),scope:z.literal("read_only_supplied_context_completion"),
}).strict();
export type CompletionPairSpecification=z.infer<typeof CompletionPairSpecificationSchema>;
/** Pure exact-disclosure preview. No credentials, provider, job, reservation, network or graph write. */
export function previewCompletionPair(raw:unknown){
  const spec=freezeCopy(CompletionPairSpecificationSchema.parse(raw)),e=spec.execution,b=spec.budget,p=spec.pricing;
  if(e.max_calls!==1||b.requests!==2||b.concurrency!==1||b.retries!==0||b.max_hops!==0||b.max_neighbors!==0)throw new Error("EVALUATION_READ_ONLY_PAIR_LIMITS_REQUIRED");
  if(!["openai","anthropic"].includes(e.provider)||!(["responses","chat_completions","messages"].includes(e.api)))throw new Error("EVALUATION_NATIVE_API_REQUIRED");
  const endpoints:{[provider:string]:string}={openai:"https://api.openai.com/v1",anthropic:"https://api.anthropic.com/v1"};
  if(spec.endpoint!==endpoints[e.provider])throw new Error("EVALUATION_EXACT_PROVIDER_ENDPOINT_REQUIRED");
  if(b.run_amount<=0||b.day_amount<=0||b.run_amount>e.max_amount||b.currency!==e.currency||p.currency!==b.currency
    ||p.provider!==e.provider||p.model!==e.model||p.version!==b.pricing_version)throw new Error("EVALUATION_EXACT_PAID_ALLOCATION_REQUIRED");
  if(b.input_tokens<2*e.input_tokens||b.output_tokens<2*e.output_tokens||b.elapsed_ms<2*e.max_elapsed_ms)throw new Error("EVALUATION_MATCHED_PAIR_ALLOCATION_REQUIRED");
  if(estimateCharge(p,e.input_tokens,e.output_tokens)*2n>allocationFloor(b.run_amount)||b.day_amount<b.run_amount)throw new Error("EVALUATION_PAIR_CEILING_TOO_SMALL");
  if(new Set(spec.arms.map(arm=>arm.arm)).size!==2)throw new Error("PAIRED_ARMS_REQUIRED");
  for(const arm of spec.arms)if(arm.source_manifest_hash!==e.source_manifest_hash||arm.context_bytes!==Buffer.byteLength(arm.context,"utf8")||arm.context_bytes>e.context_bytes)throw new Error("EVALUATION_CONTEXT_DISCLOSURE_MISMATCH");
  const policy=snapshotRolePolicy(resolveRolePolicy({role:"architect",env:{},session:RoleSettingsSchema.parse({provider:e.provider,model:e.model,adapter:e.provider+"-api",api:e.api,
    effort:e.effort,retention:e.retention,base_url:spec.endpoint,api_key_env:spec.api_key_env,output_tokens:e.output_tokens,context_tokens:e.input_tokens,
    timeout_ms:e.max_elapsed_ms,temperature:.2,strict_schema:false,fallbacks:[],budget:b,...(spec.capability?{capability:spec.capability}:{})})}));
  if(policy.status!=="configured")throw new Error("EVALUATION_ROLE_POLICY_BLOCKED:"+policy.diagnostics.map(row=>row.code).join(","));
  const jobs=new EngineJobs(),ledger={instance_id:jobs.instance_id,directory:jobs.directory};
  return {schema:"dreamgraph.completion_pair_preview.v1" as const,digest:"sha256:"+digest({specification:spec,policy_fingerprint:policy.fingerprint,ledger}),specification:spec,policy,ledger,
    limitations:["Read-only completions over the exact supplied contexts; no tool/source-read or governed-mutation execution is attested.",
      "No task outcome or material-understanding gain is scored until a separate review binds both actual answer hashes to the frozen evidence.",
      "Request storage flags do not establish provider/account retention. Raw answers are retained in private job artifacts and may quote supplied context."]};
}
/** Internal operator-invoked owner. No arbitrary executor/assessor, CLI substitution or unadmitted model. */
export async function evaluateAuthorizedCompletionPair(input:{specification:unknown;approval:{digest:string;principal:string;expires_at:string};signal?:AbortSignal}){
  input.signal?.throwIfAborted();if(currentJob())throw new Error("EVALUATION_TOP_LEVEL_OPERATOR_REQUIRED");
  const preview=previewCompletionPair(input.specification),spec=preview.specification,e=spec.execution,approval=z.object({digest:z.string().regex(/^sha256:[a-f0-9]{64}$/),principal:name,expires_at:z.string().datetime({offset:true})}).strict().parse(input.approval);
  const remaining=Date.parse(approval.expires_at)-Date.now();
  if(approval.digest!==preview.digest)throw new Error("EVALUATION_APPROVED_DISCLOSURE_CHANGED");
  if(remaining<spec.budget.elapsed_ms||remaining>24*60*60*1000)throw new Error("EVALUATION_APPROVAL_DEADLINE");
  const key=process.env[spec.api_key_env];if(!key)throw new Error("EVALUATION_NAMED_CREDENTIAL_UNAVAILABLE");
  const jobs=new EngineJobs(),record=await jobs.accept({operation_id:"evaluation:"+approval.digest,action:"readonly_completion_pair",action_version:spec.schema,owner:approval.principal,
    scope:["evaluation:"+spec.task.id,"disclosure:"+approval.digest],parameters:{specification_digest:approval.digest,task_id:spec.task.id,scope:spec.scope},
    role_policies:{architect:preview.policy},budget:spec.budget,pricing:[spec.pricing],lanes:["evaluation:"+spec.budget.billing_principal],
    authority:{id:approval.digest,revision:approval.digest,scope:[spec.task.id],expires_at:approval.expires_at,autonomy:"read_only"}});
  return jobs.run(record.job.id,async context=>{
    const config:LlmConfig={provider:e.provider as "openai"|"anthropic",model:e.model,baseUrl:spec.endpoint,apiKey:key,temperature:.2,maxTokens:e.output_tokens,
      timeoutMs:e.max_elapsed_ms,admissionPolicy:preview.policy,...(e.api==="responses"?{api:"responses" as const}:e.api==="chat_completions"?{api:"chat-completions" as const}:{}),
      ...(e.effort?{reasoningEffort:e.effort}:{}),...(e.retention==="store_false"?{store:false}:e.retention==="store_true"?{store:true}:{}),...(spec.capability?{capability:spec.capability}:{})};
    const provider=createLlmProviderForConfig(config),completed:Array<{arm:EvaluationArm["arm"];reply:EvaluationReply;reported_model:string}>=[];
    const evaluator:PairedEvaluator={execute:async({task,arm,signal})=>{
      const answer=await provider.complete([{role:"system",content:"Answer only from the supplied frozen context. Distinguish evidence, inference and uncertainty; do not claim external reads, tool execution or mutations."},
        {role:"user",content:task.prompt+"\n\nSupplied context:\n"+arm.context}],{signal,cognitiveRole:"architect",admissionRunId:"evaluation-pair:"+record.job.id});
      const reply:EvaluationReply={content:answer.text,calls:answer.admission?.calls??0,usage:answer.usage,source_reads:[],outcome:answer.model===e.model?"completed":"incomplete"};
      completed.push({arm:arm.arm,reply,reported_model:answer.model});
      await jobs.checkpoint(context.id,context.fence,{schema:"dreamgraph.completion_pair_partial.v1",specification_digest:approval.digest,completed,assessment_status:"pending_review"});
      if(answer.model!==e.model)throw new Error("EVALUATION_REPORTED_MODEL_MISMATCH");
      return reply;
    },assess:async()=>{throw new Error("EVALUATION_INDEPENDENT_REVIEW_REQUIRED");}};
    const result=await evaluatePair({task:spec.task,execution:e,arms:spec.arms,evaluator,kind:"real_model",order:spec.order,signal:context.signal},true);
    return {...result,scope:spec.scope,job_id:record.job.id,specification_digest:approval.digest,policy_fingerprint:preview.policy.fingerprint,
      assessment_status:"pending_review",limitations:[...result.limitations,...preview.limitations]};
  },input.signal);
}
