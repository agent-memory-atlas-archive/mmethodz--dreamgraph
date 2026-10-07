/** Durable engine ownership in the registered jobs.json store. */
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { BudgetSchema, JobSchema, type CanonicalJob, type ResourceBudget } from "../graph/contracts.js";
import { commitGraphWrites, loadPublicationState, publicationContentHash, recoverGraphPublication } from "../graph/publication.js";
import { withGraphRead, withGraphReconciliation } from "../utils/graph-reconciliation-barrier.js";
import { getDataDir, dataPath, withDataDirectory } from "../utils/paths.js";
import { stripBom } from "../utils/read-json.js";
import { MODEL_ROLES, snapshotRolePolicy, type ModelRole, type ResolvedRolePolicy } from "../config/role-policy.js";
import { currentJob, withinJob, withoutJobContext, assertJobCurrent, type JobExecutionContext } from "./job-context.js";
import { ModelAdmission } from "./model-admission.js";
import {directoryInstanceId} from "../instance/identity.js";
import {ModelPricingCatalogueSchema,type ModelPricing} from "../config/model-pricing.js";

const id = z.string().min(1).max(1024), time = z.string().datetime({ offset: true });
const RecordSchema = z.object({ job: JobSchema, intent_hash: id, action: id, action_version: id,
  parameters: z.record(z.unknown()), lanes: z.array(id).min(1).max(64),
  snapshot: z.object({ role_policies: z.record(z.unknown()), budget: BudgetSchema, pricing: z.string() }).strict(),
  accepted_process_id: id.default("legacy_unknown"),
  authority: z.object({ id, revision:id, scope:z.array(id), expires_at:time, autonomy:z.string() }).strict().nullable().default(null),
  lease: z.object({ process_id: id, acquired_at: time, expires_at: time }).strict().nullable(),
  result: z.unknown().nullable(), error: z.string().nullable(),
  result_artifact: z.object({ file: id, hash: id }).strict().nullable().default(null),
  work_settled: z.boolean().default(false),
  external_effects: z.array(z.object({ id, kind:id, target:id, payload_hash:id,
    state:z.enum(["dispatched","acknowledged","unknown"]), receipt:z.string().nullable() }).strict()).max(100).default([]),
}).strict();
const FileSchema = z.object({ schema: z.literal("dreamgraph.jobs.v1"), instance_id: id,
  revision: z.number().int().nonnegative(), records: z.array(RecordSchema).max(100_000),
  cancel_receipts: z.record(z.object({ intent_hash: id, result: RecordSchema }).strict()).default({}) }).strict();
export const EngineJobsStoreSchema = FileSchema;
export type EngineJobRecord = z.infer<typeof RecordSchema>;
const FILE = "jobs.json", processId = randomUUID();
const controllers = new Map<string, { controller: AbortController; fence: number }>();
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable((value as Record<string, unknown>)[key])])) : value;
const hash = (value: unknown) => "sha256:" + createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
const terminal = new Set<CanonicalJob["state"]>(["cancelled", "succeeded", "failed", "partial"]);
export class EngineJobError extends Error {
  constructor(readonly code: string, readonly job_id: string, readonly state?: CanonicalJob["state"]) { super(`${code}: ${job_id}`); }
}

export interface EngineJobInput {
  operation_id: string; action: string; action_version?: string; owner: string; scope: string[];
  parameters?: Record<string, unknown>; lanes?: string[]; timeout_ms?: number;
  session_id?: string; execution_id?: string; lifetime?: CanonicalJob["lifetime"];
  role_policies?: Partial<Record<ModelRole, Readonly<ResolvedRolePolicy>>>; budget?: ResourceBudget;
  /** Trusted internal exact tariffs, pinned with the approved run; no ambient pricing substitution. */
  pricing?: ModelPricing[];
  roles?: ModelRole[];
  authority?: EngineJobRecord["authority"];
}

/** Every service pins physical storage; changing the selected instance cannot redirect a job. */
export class EngineJobs {
  readonly instance_id: string;
  constructor(readonly directory = getDataDir(), private readonly clock = () => new Date()) {
    this.instance_id = process.env.DREAMGRAPH_INSTANCE_UUID || directoryInstanceId(directory);
  }
  private scope<T>(work: () => T): T { return withDataDirectory(this.directory, work); }
  private key(job_id: string): string { return `${this.directory}:${job_id}`; }
  private async load(): Promise<z.infer<typeof FileSchema>> {
    const state = await loadPublicationState();
    try {
      const body = await readFile(dataPath(FILE), "utf8");
      if (state.stores[FILE] && state.stores[FILE].hash !== publicationContentHash(body)) throw new Error("UNPUBLISHED_JOB_CHANGE");
      const file = FileSchema.parse(JSON.parse(stripBom(body)));
      if (file.instance_id !== this.instance_id) throw new Error("JOB_INSTANCE_MISMATCH");
      return file;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && !state.stores[FILE]) return {
        schema: "dreamgraph.jobs.v1", instance_id: this.instance_id, revision: 0, records: [], cancel_receipts: {} };
      throw new EngineJobError(`JOB_STORE_UNAVAILABLE (${String(error)})`, "unbound");
    }
  }
  private async save(file: z.infer<typeof FileSchema>, extraWrites: Array<{file:string;content:string}> = []): Promise<void> {
    file.revision++;
    const body = JSON.stringify(FileSchema.parse(file));
    if (Buffer.byteLength(body) > 16 * 1024 * 1024) throw new EngineJobError("JOB_CAPACITY_REQUIRES_ARCHIVE", "unbound");
    await commitGraphWrites({ actor: "engine_jobs", scope: [FILE], writes: [{ file: FILE, content: body }, ...extraWrites], cause: "job_state" });
  }
  private mutate<T>(work: (file: z.infer<typeof FileSchema>) => Promise<T>, extraWrites: Array<{file:string;content:string}> = []): Promise<T> {
    return this.scope(() => withoutJobContext(() => withGraphReconciliation(async () => {
      await recoverGraphPublication(); const file = await this.load(); const result = await work(file); await this.save(file, extraWrites); return result;
    })));
  }
  inspect(): Promise<z.infer<typeof FileSchema>> { return this.scope(() => withGraphRead(() => this.load())); }
  async cancelOwnedRunning(cause="daemon_shutdown"):Promise<void>{
    const ids=(await this.inspect()).records.filter(record=>record.lease?.process_id===processId&&!terminal.has(record.job.state)).map(record=>record.job.id);
    for(const job_id of ids)await this.cancel(job_id,cause);
  }
  async accept(input: EngineJobInput): Promise<EngineJobRecord> {
    id.parse(input.operation_id); id.parse(input.action); id.parse(input.owner);
    const parameters = structuredClone(input.parameters ?? {}), lanes = [...new Set(input.lanes ?? ["engine"])].sort();
    z.array(id).min(1).max(64).parse(lanes); z.array(id).max(1024).parse(input.scope);
    // Bind explicit caller choices, while excluding later changes to ambient defaults.
    const intent_hash = hash({ ...input, parameters, lanes, action_version: input.action_version ?? "dreamgraph.action.v1",
      lifetime: input.lifetime ?? "daemon_durable", session_id: input.session_id ?? null, execution_id: input.execution_id ?? null });
    const replay = (await this.inspect()).records.find(record => record.job.operation_id === input.operation_id && record.job.owner === input.owner);
    if (replay) {
      if (replay.intent_hash !== intent_hash) throw new EngineJobError("JOB_OPERATION_CONFLICT", replay.job.id);
      return structuredClone(replay);
    }
    const policies: Partial<Record<ModelRole, Readonly<ResolvedRolePolicy>>> = {};
    if (input.role_policies) for (const role of MODEL_ROLES) {
      const policy = input.role_policies[role]; if (policy) policies[role] = snapshotRolePolicy(policy);
    } else {
      const { getRoleModelPolicy } = await import("./llm.js");
      await this.scope(() => withGraphRead(async () => {
        for (const role of MODEL_ROLES) policies[role] = snapshotRolePolicy(await getRoleModelPolicy(role));
      }));
    }
    const budgets = Object.entries(policies).filter(([role]) => !input.roles || input.roles.includes(role as ModelRole)).map(([,value]) => value!.policy.budget);
    const base = input.budget ?? budgets[0];
    if (!base) throw new EngineJobError("JOB_RESOURCE_POLICY_REQUIRED", input.operation_id);
    // The parent is an intersection, never a fresh allowance for each child/role/fallback.
    const budget = BudgetSchema.parse(input.budget ?? Object.fromEntries(Object.entries(base).map(([key, value]) => [key,
      typeof value === "number" ? Math.min(...budgets.map(candidate => candidate[key as keyof ResourceBudget] as number)) : value])));
    const timeout = Math.min(input.timeout_ms ?? budget.elapsed_ms,input.authority?Date.parse(input.authority.expires_at)-this.clock().getTime():budget.elapsed_ms);
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > budget.elapsed_ms) throw new EngineJobError("JOB_INVALID_DEADLINE", input.operation_id);
    budget.elapsed_ms = timeout;
    const snapshot = { role_policies: policies, budget, pricing: input.pricing
      ? JSON.stringify(ModelPricingCatalogueSchema.parse(input.pricing)) : process.env.DREAMGRAPH_LLM_PRICING ?? "[]" };
    return this.mutate(async file => {
      const existing = file.records.find(record => record.job.operation_id === input.operation_id && record.job.owner === input.owner);
      if (existing) {
        if (existing.intent_hash !== intent_hash) throw new EngineJobError("JOB_OPERATION_CONFLICT", existing.job.id);
        return structuredClone(existing);
      }
      const now = this.clock().toISOString(), publication = await loadPublicationState();
      const record: EngineJobRecord = RecordSchema.parse({ intent_hash, action: input.action,
        action_version: input.action_version ?? "dreamgraph.action.v1", parameters, lanes, snapshot, accepted_process_id:processId,authority:input.authority??null,lease: null, result: null, error: null,
        job: { schema: "dreamgraph.job.v1", id: randomUUID(), operation_id: input.operation_id, instance_id: this.instance_id,
          owner: input.owner, session_id: input.session_id ?? null, execution_id: input.execution_id ?? null,
          state: "queued", fence: 0, config_revision: hash(snapshot), input_revision: publication.revision,
          scope: input.scope, lifetime: input.lifetime ?? "daemon_durable", created_at: now, updated_at: now,
          cancel_requested_at: null, terminal_cause: null, receipt_ids: [], unknown_effects: [] } });
      // Active queue is bounded; never erase accepted work/history to make room.
      if (file.records.filter(record => !terminal.has(record.job.state)).length >= 1024) throw new EngineJobError("JOB_QUEUE_CAPACITY", record.job.id);
      file.records.push(record); return structuredClone(record);
    });
  }
  async assertCurrent(job_id: string, fence: number): Promise<void> {
    await this.scope(() => withGraphRead(async () => {
      const record = (await this.load()).records.find(record => record.job.id === job_id);
      if (!record || record.job.state !== "running" || record.job.fence !== fence || record.job.cancel_requested_at
        || record.lease?.process_id !== processId || Date.parse(record.lease.expires_at) <= this.clock().getTime()) {
        throw new EngineJobError("JOB_FENCE_REVOKED", job_id, record?.job.state);
      }
    }));
  }
  /** Persist external dispatch before transport; uncertain sends are never blindly replayed. */
  async beginExternalEffect(job_id:string,fence:number,effect:{id:string;kind:string;target:string;payload_hash:string}):Promise<void>{
    await this.mutate(async file=>{
      await this.assertCurrent(job_id,fence);const record=file.records.find(r=>r.job.id===job_id)!;
      if(record.external_effects.some(e=>e.id===effect.id))throw new EngineJobError("JOB_EXTERNAL_EFFECT_ALREADY_DISPATCHED",job_id);
      record.external_effects.push({...effect,state:"dispatched",receipt:null});
    });
  }
  /** Late transport acknowledgement is bookkeeping, not permission for another effect. */
  async settleExternalEffect(job_id:string,effect_id:string,acknowledged:boolean,receipt:string):Promise<void>{
    await this.mutate(async file=>{
      const record=file.records.find(r=>r.job.id===job_id),effect=record?.external_effects.find(e=>e.id===effect_id);
      if(!effect)throw new EngineJobError("JOB_EXTERNAL_EFFECT_UNKNOWN",job_id);
      if(effect.state==="acknowledged"&&(!acknowledged||effect.receipt!==receipt))throw new EngineJobError("JOB_EXTERNAL_ACK_CONFLICT",job_id);
      effect.state=acknowledged?"acknowledged":"unknown";effect.receipt=receipt;
    });
  }
  /** Only an actually settled local action can release a recovered lane after late effect proof. */
  async reconcileSettled(job_id:string,expected_fence:number):Promise<EngineJobRecord>{
    return this.mutate(async file=>{
      const record=file.records.find(r=>r.job.id===job_id);if(!record)throw new EngineJobError("JOB_UNKNOWN",job_id);
      if(record.job.fence!==expected_fence)throw new EngineJobError("JOB_FENCE_CONFLICT",job_id);
      if(!record.work_settled)throw new EngineJobError("JOB_TERMINATION_UNCONFIRMED",job_id);
      const unknown=await this.unknownEffects(record);
      record.job.unknown_effects=unknown;
      if(!unknown.length&&record.job.state==="recovery_required"){
        record.lease=null;record.job.state=record.job.cancel_requested_at?"cancelled":record.error?"failed":"succeeded";
        record.job.updated_at=this.clock().toISOString();
      }
      return structuredClone(record);
    });
  }
  private async unknownEffects(record:EngineJobRecord):Promise<string[]>{
    const admission=await new ModelAdmission(this.instance_id,this.directory).inspect(),job_id=record.job.id;
    const unknown=Object.values(admission.attempts).filter(attempt=>(attempt.run_id===`job:${job_id}`
      ||admission.runs[attempt.run_id]?.parent_run_id===`job:${job_id}`)&&!attempt.acknowledged&&attempt.state!=="released").map(attempt=>attempt.id);
    const {readChangeObligations}=await import("../graph/change-obligations.js");
    unknown.push(...(await readChangeObligations()).entries.filter(entry=>entry.execution_id===job_id&&["intent","unknown"].includes(entry.state)).map(entry=>entry.id));
    unknown.push(...record.external_effects.filter(e=>e.state!=="acknowledged").map(e=>e.id));return [...new Set(unknown)];
  }
  async cancel(job_id: string, cause = "operator_cancelled", controls?: {
    expected_fence: number; operation_id: string; session_id?: string; owner?: string;
  }): Promise<EngineJobRecord> {
    const result = await this.mutate(async file => {
      const intent_hash = hash({ job_id, cause, controls }), key = controls?.operation_id;
      if (key && file.cancel_receipts[key]) {
        if (file.cancel_receipts[key].intent_hash !== intent_hash) throw new EngineJobError("JOB_CANCEL_OPERATION_CONFLICT", job_id);
        return structuredClone(file.cancel_receipts[key].result);
      }
      const record = file.records.find(record => record.job.id === job_id);
      if (!record) throw new EngineJobError("JOB_UNKNOWN", job_id);
      if (controls) {
        if (!Number.isSafeInteger(controls.expected_fence) || controls.expected_fence < 0 || record.job.fence !== controls.expected_fence)
          throw new EngineJobError("JOB_FENCE_CONFLICT", job_id);
        if (record.job.lifetime === "session_bound" && (record.job.session_id !== controls.session_id || record.job.owner !== controls.owner))
          throw new EngineJobError("JOB_OWNER_MISMATCH", job_id);
        id.parse(controls.operation_id);
      }
      if (terminal.has(record.job.state)) {
        if (key) file.cancel_receipts[key] = { intent_hash, result: structuredClone(record) };
        return structuredClone(record);
      }
      const undispatched=["queued","blocked"].includes(record.job.state)&&record.job.fence===0&&!record.lease&&record.external_effects.length===0;
      record.job.cancel_requested_at ??= this.clock().toISOString(); record.job.updated_at = this.clock().toISOString();
      record.job.fence++; record.job.terminal_cause = cause;
      if (record.lease) { record.job.state = "recovery_required"; record.job.unknown_effects = [...new Set([...record.job.unknown_effects, "work_termination_unconfirmed"])]; }
      else {record.job.state = "cancelled";if(undispatched)record.work_settled=true;}
      const admission = new ModelAdmission(this.instance_id, this.directory);
      if ((await admission.inspect()).runs[`job:${job_id}`]) record.job.unknown_effects.push(...await admission.cancel(`job:${job_id}`));
      record.job.unknown_effects = [...new Set(record.job.unknown_effects)];
      if (key) file.cancel_receipts[key] = { intent_hash, result: structuredClone(record) };
      return structuredClone(record);
    });
    // The durable CAS/fence succeeds before any externally requested local abort.
    controllers.get(this.key(job_id))?.controller.abort(new EngineJobError(cause, job_id, "cancelling"));
    return result;
  }
  /** A restart never redispatches a previously running effect or releases its conflict lane. */
  async recover(): Promise<string[]> {
    if(!(await this.inspect()).records.length)return [];
    return this.mutate(async file => {
      const recovered: string[] = [];
      for (const record of file.records) {
        if(record.job.state==="recovery_required"&&record.work_settled){
          const unknown=await this.unknownEffects(record);record.job.unknown_effects=unknown;
          if(!unknown.length){record.lease=null;record.job.state=record.job.cancel_requested_at?"cancelled":record.error?"failed":"succeeded";record.job.updated_at=this.clock().toISOString();}
          recovered.push(record.job.id);continue;
        }
        if(record.job.lifetime==="session_bound"&&record.accepted_process_id!==processId&&!record.lease&&!terminal.has(record.job.state)){
          record.job.state="cancelled";record.job.fence++;record.job.terminal_cause="restart_session_authority_unavailable";record.job.updated_at=this.clock().toISOString();recovered.push(record.job.id);continue;
        }
        if (!record.lease || record.lease.process_id === processId && controllers.has(this.key(record.job.id))) continue;
        if (terminal.has(record.job.state)) continue;
        record.job.fence++; record.job.state = "recovery_required";
        record.job.updated_at = this.clock().toISOString(); record.job.terminal_cause = "restart_termination_unconfirmed";
        record.job.unknown_effects = [...new Set([...record.job.unknown_effects, "work_termination_unconfirmed"])]; recovered.push(record.job.id);
      }
      return recovered;
    });
  }
  async run<T>(job_id: string, work: (context: JobExecutionContext, record: EngineJobRecord) => Promise<T>, signal?: AbortSignal): Promise<T> {
    const record = await this.mutate(async file => {
      const record = file.records.find(record => record.job.id === job_id);
      if (!record) throw new EngineJobError("JOB_UNKNOWN", job_id);
      if (record.job.state === "succeeded") return structuredClone(record);
      if (!["queued", "blocked"].includes(record.job.state) || record.job.cancel_requested_at) throw new EngineJobError("JOB_NOT_DISPATCHABLE", job_id, record.job.state);
      if(record.authority&&Date.parse(record.authority.expires_at)<=this.clock().getTime())throw new EngineJobError("JOB_AUTHORITY_EXPIRED",job_id);
      if (file.records.some(other => other.job.id !== job_id && other.lease && !terminal.has(other.job.state)
        && other.lanes.some(lane => record.lanes.includes(lane)))) {
        record.job.state = "blocked"; record.job.terminal_cause = "conflicting_job"; return structuredClone(record);
      }
      const now = this.clock(), timeout = record.snapshot.budget.elapsed_ms;
      record.job.state = "running"; record.job.fence++; record.job.updated_at = now.toISOString(); record.job.terminal_cause = null;
      record.lease = { process_id: processId, acquired_at: now.toISOString(), expires_at: new Date(now.getTime() + timeout).toISOString() };
      return structuredClone(record);
    });
    if (record.job.state === "succeeded") {
      if (!record.result_artifact) return structuredClone(record.result) as T;
      return this.scope(() => withGraphRead(async () => {
        const body = await readFile(dataPath(record.result_artifact!.file), "utf8"), publication = await loadPublicationState();
        if (hash(JSON.parse(body)) !== record.result_artifact!.hash || publication.stores[record.result_artifact!.file]?.hash !== publicationContentHash(body)) throw new EngineJobError("JOB_RESULT_ARTIFACT_UNAVAILABLE", job_id);
        const original=JSON.parse(body); if(original.job_id!==job_id)throw new EngineJobError("JOB_RESULT_ARTIFACT_MISMATCH",job_id);return original.result as T;
      }));
    }
    if (record.job.state === "blocked") throw new EngineJobError("JOB_CONFLICT_BLOCKED", job_id, "blocked");
    const controller = new AbortController(), fence = record.job.fence;
    controllers.set(this.key(job_id), { controller, fence });
    const context: JobExecutionContext = { id: job_id, fence, directory: this.directory, signal: controller.signal,
      role_policies: record.snapshot.role_policies as JobExecutionContext["role_policies"],
      pricing: record.snapshot.pricing,
      parent_admission: { run_id: `job:${job_id}`, fingerprint: record.job.config_revision, budget: record.snapshot.budget },
      assert_current: () => this.assertCurrent(job_id, fence) };
    const admission = new ModelAdmission(this.instance_id, this.directory);
    const stop = () => { controller.abort(signal?.reason); void this.cancel(job_id, "caller_cancelled").catch(() => undefined); };
    signal?.addEventListener("abort", stop, { once: true });
    const timer = setTimeout(() => { controller.abort(new EngineJobError("JOB_DEADLINE", job_id)); void this.cancel(job_id, "JOB_DEADLINE").catch(() => undefined); },
      Math.max(1, Date.parse(record.lease!.expires_at) - this.clock().getTime())); timer.unref();
    if (signal?.aborted) stop();
    const promise = this.scope(() => withinJob(context, async () => {
      try {
        await admission.registerParentRun(context.parent_admission.run_id, context.parent_admission.fingerprint, context.parent_admission.budget);
        await assertJobCurrent(); const result = await work(context, structuredClone(record)); await assertJobCurrent();
        const encoded = JSON.stringify(result ?? null);
        if (encoded === undefined || Buffer.byteLength(encoded) > 8*1024*1024) throw new EngineJobError("JOB_RESULT_BYTE_LIMIT", job_id);
        const finished = await this.finish(job_id, fence, { result: JSON.parse(encoded), error: null });
        if (finished.job.state === "recovery_required") throw new EngineJobError("JOB_EFFECT_RECOVERY_REQUIRED", job_id, finished.job.state);
        return result;
      } catch (error) {
        if (!(error instanceof EngineJobError && error.code === "JOB_EFFECT_RECOVERY_REQUIRED"))
          await this.finish(job_id, fence, { result: null, error: error instanceof Error ? error.message : String(error) });
        throw error;
      } finally {
        clearTimeout(timer); signal?.removeEventListener("abort", stop); controllers.delete(this.key(job_id));
      }
    }));
    // Returning on abort does not imply that the promise terminated. finish owns that acknowledgement.
    return new Promise<T>((resolve, reject) => {
      const abort = () => reject(new EngineJobError("JOB_TERMINATION_UNCONFIRMED", job_id, "recovery_required"));
      controller.signal.addEventListener("abort", abort, { once: true });
      promise.then(resolve, reject).finally(() => controller.signal.removeEventListener("abort", abort));
      if (controller.signal.aborted) abort();
    });
  }
  /** Retain completed partial work in the existing private job artifact, without implying success. */
  async checkpoint(job_id:string,fence:number,result:unknown):Promise<{file:string;hash:string}>{
    const original={schema:"dreamgraph.job_result.v1",job_id,result},body=JSON.stringify(original);
    if(Buffer.byteLength(body)>8*1024*1024)throw new EngineJobError("JOB_RESULT_BYTE_LIMIT",job_id);
    const artifact={file:`job-result-${hash(original).slice(7)}.json`,hash:hash(original)};
    await this.mutate(async file=>{await this.assertCurrent(job_id,fence);const record=file.records.find(row=>row.job.id===job_id)!;
      record.result=null;record.result_artifact=artifact;
    },[{file:artifact.file,content:body}]);return artifact;
  }
  async readResultArtifact(job_id:string):Promise<unknown>{
    return this.scope(()=>withGraphRead(async()=>{const record=(await this.load()).records.find(row=>row.job.id===job_id);
      if(!record)throw new EngineJobError("JOB_UNKNOWN",job_id);if(!record.result_artifact)return structuredClone(record.result);
      const body=await readFile(dataPath(record.result_artifact.file),"utf8"),state=await loadPublicationState(),value=JSON.parse(body);
      if(value.job_id!==job_id||hash(value)!==record.result_artifact.hash||state.stores[record.result_artifact.file]?.hash!==publicationContentHash(body))throw new EngineJobError("JOB_RESULT_ARTIFACT_UNAVAILABLE",job_id);
      return value.result;
    }));
  }
  private async finish(job_id: string, fence: number, outcome: { result: unknown; error: string | null }): Promise<EngineJobRecord> {
    const original={schema:"dreamgraph.job_result.v1",job_id,result:outcome.result};
    const body=JSON.stringify(original), artifact=Buffer.byteLength(body)>65_536?{file:`job-result-${hash(original).slice(7)}.json`,hash:hash(original)}:null;
    return this.mutate(async file => {
      const record = file.records.find(record => record.job.id === job_id)!;
      const unknown = await this.unknownEffects(record); record.work_settled = true;
      record.job.unknown_effects = unknown;
      record.job.receipt_ids=Object.values((await loadPublicationState()).receipts).filter(receipt=>receipt.scope.includes(`job:${job_id}`)).map(receipt=>receipt.operation_id);
      record.job.updated_at = this.clock().toISOString(); record.lease = null;
      // An error after a checkpoint keeps that exact partial result for review, never automatic replay.
      const retained=outcome.error!==null&&record.result_artifact ? record.result_artifact : artifact;
      record.result = retained ? null : outcome.result; record.result_artifact = retained; record.error = outcome.error;
      if (unknown.length) { record.job.state = "recovery_required"; record.lease = { process_id: processId, acquired_at: record.job.created_at, expires_at: record.job.updated_at }; }
      else if (record.job.cancel_requested_at || record.job.fence !== fence) record.job.state = "cancelled";
      else { record.job.state = outcome.error ? "failed" : "succeeded"; record.error = outcome.error; record.job.terminal_cause = outcome.error; }
      return structuredClone(record);
    }, artifact?[{file:artifact.file,content:body}]:[]);
  }
}

/** Nested scan/enrichment/cognitive stages share the parent's fence and budget. */
export async function withEngineJob<T>(input: EngineJobInput, work: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  const parent = currentJob();
  if (parent) { await assertJobCurrent(); return work(signal ? AbortSignal.any([parent.signal, signal]) : parent.signal); }
  const jobs = new EngineJobs(), record = await jobs.accept(input);
  return jobs.run(record.job.id, context => work(context.signal), signal);
}
