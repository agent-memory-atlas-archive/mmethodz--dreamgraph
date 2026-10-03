/** Internal native-host/job port. A plan context selection never admits implementation. */
import { z } from "zod";
import { ARCHITECT_PASS_MAX_MS } from "../config/request-bounds.js";
import { approvalHash } from "./approval.js";
import { applyPlanCommand, readPlanAuthority } from "./plan-authority.js";
import { getSessionContext, withSessionContext, type SessionContext } from "../server/session-context.js";
import type { PlanActor } from "./plan-workflow.js";
import { PlanEndExecutionCommandSchema } from "./plan-workflow.js";
import { PlanExecutionIntentSchema } from "../graph/contracts.js";
import { readFile, realpath, stat } from "node:fs/promises";
import { bytesHash } from "./plan-authority.js";

const id = z.string().min(1).max(1000);
const RequestSchema = PlanExecutionIntentSchema.extend({
  execution_id: id,
  timeout_ms: z.number().int().min(1).max(ARCHITECT_PASS_MAX_MS),
}).strict();
export const PlanRuntimeFinishSchema = z.object({
  outcome: z.enum(["paused", "cancelled", "failed", "timed_out", "completed"]), reason: id,
  work_termination: z.enum(["confirmed", "unconfirmed"]),
}).strict();
export type PlanRuntimeRequest = z.input<typeof RequestSchema>;
export type PlanRuntimeFinish = z.input<typeof PlanRuntimeFinishSchema>;
/** Private persisted first intent; neither model tools nor the public finish body can supply this command. */
export const PlanRuntimeClosureSchema = z.object({
  scope: PlanExecutionIntentSchema.shape.scope, execution_id: id, principal: id, session_id: id, directory: id,
  operation_id: id, expected_revision: z.number().int().nonnegative(), expected_definition_hash: id,
  command: PlanEndExecutionCommandSchema,
}).strict();
export type PlanRuntimeClosure = z.infer<typeof PlanRuntimeClosureSchema>;
/** Private host-captured source identity, never an adapter-supplied file authority. */
export const PlanRuntimeSourceSchema = z.object({ path: id, physical_path: id, content_hash: id }).strict();
export type PlanRuntimeSource = z.infer<typeof PlanRuntimeSourceSchema>;
export async function checkPlanRuntimeSource(input: PlanRuntimeSource, signal?: AbortSignal) {
  const source = PlanRuntimeSourceSchema.parse(input); signal?.throwIfAborted();
  if (await realpath(source.path) !== source.physical_path) throw new Error("PLAN_RUNTIME_SOURCE_IDENTITY_CHANGED");
  const before = await stat(source.physical_path);
  if (!before.isFile() || before.size > 8 * 1024 * 1024) throw new Error("PLAN_RUNTIME_SOURCE_BYTE_BOUND");
  const bytes = await readFile(source.physical_path), after = await stat(source.physical_path); signal?.throwIfAborted();
  if (before.size !== bytes.length || after.size !== before.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
    || before.ino !== after.ino || bytesHash(bytes.toString("utf8")) !== source.content_hash) throw new Error("PLAN_RUNTIME_SOURCE_CHANGED");
  if (await realpath(source.path) !== source.physical_path) throw new Error("PLAN_RUNTIME_SOURCE_IDENTITY_CHANGED");
  signal?.throwIfAborted();
}
type CommandInput = Parameters<typeof applyPlanCommand>[0];
type Options = { check_sources: (signal: AbortSignal) => Promise<void>; signal?: AbortSignal; fault_inject?: CommandInput["fault_inject"] };

const runtimeLeaseId = (scope: PlanRuntimeRequest["scope"], executionId: string) => `plan-runtime:${approvalHash([scope, executionId])}`;
const runtimeOperation = (owner: SessionContext, scope: PlanRuntimeRequest["scope"], executionId: string, stage: string) =>
  `plan-runtime:${approvalHash([owner.principal, owner.session_id, scope, executionId, stage])}`;

/** Capture once, persist before publication, and replay these exact bytes after acknowledgement loss. */
export async function preparePlanRuntimeClosure(input: PlanRuntimeRequest, finish: PlanRuntimeFinish, stage: "finish" | "observed-stop" = "finish"): Promise<PlanRuntimeClosure> {
  const request = RequestSchema.parse(structuredClone(input)), disposition = PlanRuntimeFinishSchema.parse(structuredClone(finish)), owner = hostOwner();
  const view = await readPlanAuthority(request.scope);
  if (!view) throw new Error("PLAN_NOT_IMPORTED");
  const lease = view.state.leases.find(item => item.id === runtimeLeaseId(request.scope, request.execution_id));
  if (!lease || lease.owner !== owner.principal || lease.execution_id !== request.execution_id || lease.generation !== request.expected_revision + 1)
    throw new Error("PLAN_EXECUTION_FENCE_REJECTED");
  if (stage === "observed-stop" && (lease.state !== "recovery_required" || disposition.work_termination !== "confirmed"))
    throw new Error("PLAN_RUNTIME_INDEPENDENT_STOP_REQUIRED");
  return PlanRuntimeClosureSchema.parse({ scope: request.scope, execution_id: request.execution_id,
    principal: owner.principal, session_id: owner.session_id, directory: owner.directory,
    operation_id: runtimeOperation(owner, request.scope, request.execution_id, stage),
    expected_revision: view.state.revision, expected_definition_hash: view.state.definition_hash,
    command: { type: "end_execution", lease_id: lease.id, execution_id: request.execution_id, generation: lease.generation,
      outcome: disposition.outcome, reason: disposition.reason, stop_acknowledged: disposition.work_termination === "confirmed" } });
}
/** Recovery closes original ownership only; it cannot create a live host, worker or native invocation. */
export async function applyPlanRuntimeClosure(input: PlanRuntimeClosure, fault_inject?: CommandInput["fault_inject"]) {
  const closing = PlanRuntimeClosureSchema.parse(structuredClone(input)), owner = hostOwner();
  if (closing.principal !== owner.principal || closing.session_id !== owner.session_id || closing.directory !== owner.directory)
    throw new Error("PLAN_RUNTIME_ORIGINAL_HOST_REQUIRED");
  if (!["finish", "observed-stop"].some(stage => closing.operation_id === runtimeOperation(owner, closing.scope, closing.execution_id, stage))
    || closing.command.lease_id !== runtimeLeaseId(closing.scope, closing.execution_id) || closing.command.execution_id !== closing.execution_id)
    throw new Error("PLAN_EXECUTION_FENCE_REJECTED");
  return applyPlanCommand({ actor: { id: owner.principal, kind: "runtime", instance_id: closing.scope.instance_id, project_id: closing.scope.project_id },
    plan_id: closing.scope.id, operation_id: closing.operation_id, expected_revision: closing.expected_revision,
    expected_definition_hash: closing.expected_definition_hash, command: closing.command, fault_inject });
}

/** Exact retry is acknowledgement recovery only; this receipt cannot grant another native launch. */
export class PlanRuntimeAdmissionError extends Error {
  constructor(readonly execution_id: string, readonly lease_id: string, cause: unknown) {
    super(`PLAN_RUNTIME_ADMISSION_UNCONFIRMED: ${execution_id}; ${cause instanceof Error ? cause.message : String(cause)}; inspect the original plan execution`, { cause });
    this.name = "PlanRuntimeAdmissionError";
  }
}
function hostOwner(): SessionContext {
  const context = getSessionContext();
  if (!context || context.execution_policy) throw new Error("PLAN_RUNTIME_HOST_CONTROL_REQUIRED");
  return { ...context, environment: { ...context.environment } };
}
/** Bounds the read-only source-check wait; an abort does not prove its callback terminated. */
function checkWithCancellation(signal: AbortSignal, check: Options["check_sources"]): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const cancelled = () => reject(new Error("PLAN_RUNTIME_SOURCE_WAIT_CANCELLED: underlying read termination unconfirmed", { cause: signal.reason }));
    signal.addEventListener("abort", cancelled, { once: true });
    Promise.resolve().then(() => { signal.throwIfAborted(); return check(signal); }).then(() => {
      if (signal.aborted) cancelled(); else resolve();
    }, reject).finally(() => signal.removeEventListener("abort", cancelled));
  });
}

/**
 * A producer supplies its reviewed, explicit task purpose and original source fence.
 * This port records historical execution ownership, never an implementation/verification result.
 * Providers, worker tools and PluginContext do not receive it.
 */
export class PlanRuntimeLease {
  readonly leaseId: string;
  readonly executionId: string;
  readonly signal: AbortSignal;
  private readonly actor: PlanActor;
  private readonly generation: number;
  private readonly expiresAt: string;
  private admission?: Awaited<ReturnType<typeof applyPlanCommand>>;
  private closing?: CommandInput;
  private closureHash?: string;
  private closeResult?: Awaited<ReturnType<typeof applyPlanCommand>>;
  private finishing?: Promise<Awaited<ReturnType<typeof applyPlanCommand>>>;
  private constructor(private readonly request: z.infer<typeof RequestSchema>, private readonly owner: SessionContext,
    private readonly options: Options) {
    this.executionId = request.execution_id;
    this.leaseId = runtimeLeaseId(request.scope, request.execution_id);
    this.actor = { id: owner.principal, kind: "runtime", instance_id: request.scope.instance_id, project_id: request.scope.project_id };
    this.generation = request.expected_revision + 1;
    this.expiresAt = new Date(Date.now() + request.timeout_ms).toISOString();
    const deadline = AbortSignal.timeout(request.timeout_ms);
    this.signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  }
  static async admit(input: PlanRuntimeRequest, options: Options): Promise<PlanRuntimeLease> {
    const request = RequestSchema.parse(structuredClone(input)), owner = hostOwner();
    if (typeof options?.check_sources !== "function") throw new Error("PLAN_RUNTIME_SOURCE_FENCE_REQUIRED");
    const port = new PlanRuntimeLease(request, owner, { check_sources: options.check_sources, signal: options.signal, fault_inject: options.fault_inject });
    port.signal.throwIfAborted();
    await port.inOwner(async () => {
      const view = await readPlanAuthority(request.scope);
      if (!view) throw new Error("PLAN_NOT_IMPORTED");
      if (view.state.revision !== request.expected_revision || view.state.definition_hash !== request.expected_definition_hash)
        throw new Error("PLAN_STATE_REVISION_CONFLICT");
      if (view.state.approval?.id !== request.approval_id || view.state.approval.owner !== owner.principal)
        throw new Error("PLAN_RUNTIME_APPROVAL_OWNER_REJECTED");
      if (view.state.leases.some(lease => lease.execution_id === request.execution_id))
        throw new Error("PLAN_RUNTIME_EXECUTION_REQUIRES_RECOVERY");
      if (request.kind === "final_verification" ? request.slice_id !== null : request.slice_id === null)
        throw new Error("PLAN_RUNTIME_TASK_SCOPE_REQUIRED");
      const checkSources = async () => {
        port.signal.throwIfAborted();
        await checkWithCancellation(port.signal, port.options.check_sources);
        port.signal.throwIfAborted();
      };
      try {
        port.admission = await applyPlanCommand({ actor: port.actor, plan_id: request.scope.id,
          operation_id: port.operation("admit"), expected_revision: request.expected_revision,
          expected_definition_hash: request.expected_definition_hash,
          command: { type: "admit_execution", slice_id: request.slice_id, lease_id: port.leaseId,
            execution_id: request.execution_id, kind: request.kind, generation: port.generation, expires_at: port.expiresAt },
          check_sources: checkSources, fault_inject: port.options.fault_inject });
        if (port.admission.replayed) throw new Error("PLAN_RUNTIME_EXECUTION_REQUIRES_RECOVERY");
      } catch (error) { throw new PlanRuntimeAdmissionError(request.execution_id, port.leaseId, error); }
    });
    return port;
  }
  get deadline(): string { return this.expiresAt; }
  get admissionReceipt() { return this.admission ? structuredClone(this.admission.receipt) : null; }
  private operation(stage: string) { return `plan-runtime:${approvalHash([this.owner.principal, this.owner.session_id, this.request.scope, this.executionId, stage])}`; }
  private inOwner<T>(work: () => Promise<T>): Promise<T> {
    const current = hostOwner();
    if (current.principal !== this.owner.principal || current.session_id !== this.owner.session_id || current.directory !== this.owner.directory)
      throw new Error("PLAN_RUNTIME_ORIGINAL_HOST_REQUIRED");
    return withSessionContext(this.owner, work);
  }
  async inspect() {
    return this.inOwner(async () => {
      const view = await readPlanAuthority(this.request.scope);
      if (!view) throw new Error("PLAN_NOT_IMPORTED");
      return { projection: view, lease: view.state.leases.find(lease => lease.id === this.leaseId) ?? null };
    });
  }
  /** Stop acknowledgement comes from the native work owner, never a rejected wait or model prose. */
  async finish(input: PlanRuntimeFinish) {
    const disposition = PlanRuntimeFinishSchema.parse(structuredClone(input)), digest = approvalHash(disposition);
    // Validate even an in-memory replay against the original transport owner.
    await this.inOwner(async () => undefined);
    if (this.closureHash && this.closureHash !== digest) throw new Error("PLAN_RUNTIME_CLOSURE_DISPOSITION_CHANGED");
    this.closureHash ??= digest;
    if (this.finishing) return structuredClone(await this.finishing);
    const task = this.inOwner(async () => {
      if (this.closureHash && this.closureHash !== digest) throw new Error("PLAN_RUNTIME_CLOSURE_DISPOSITION_CHANGED");
      if (this.closeResult) return structuredClone(this.closeResult);
      if (!this.closing) {
        const view = await readPlanAuthority(this.request.scope);
        if (!view) throw new Error("PLAN_NOT_IMPORTED");
        const lease = view.state.leases.find(lease => lease.id === this.leaseId);
        if (!lease || lease.execution_id !== this.executionId || lease.generation !== this.generation)
          throw new Error("PLAN_EXECUTION_FENCE_REJECTED");
        this.closing = { actor: this.actor, plan_id: this.request.scope.id, operation_id: this.operation("finish"),
          expected_revision: view.state.revision, expected_definition_hash: view.state.definition_hash,
          command: { type: "end_execution", lease_id: this.leaseId, execution_id: this.executionId,
            generation: this.generation, outcome: disposition.outcome, reason: disposition.reason,
            stop_acknowledged: disposition.work_termination === "confirmed" }, fault_inject: this.options.fault_inject };
      }
      // Terminating original work remains possible after source changes; no new dispatch is authorized.
      this.closeResult = await applyPlanCommand(this.closing);
      return structuredClone(this.closeResult);
    });
    this.finishing = task;
    try { return await task; } finally { if (this.finishing === task) this.finishing = undefined; }
  }
}

/** Restart/uncertain-admission inspection has no launch, renewal or completion authority. */
export async function inspectPlanRuntime(scope: PlanRuntimeRequest["scope"], executionId: string) {
  const owner = hostOwner(), capturedScope = RequestSchema.shape.scope.parse(structuredClone(scope));
  id.parse(executionId);
  const view = await readPlanAuthority(capturedScope);
  if (!view) throw new Error("PLAN_NOT_IMPORTED");
  const lease = view.state.leases.find(lease => lease.execution_id === executionId);
  const lastAttempt = view.state.slices.map(slice => slice.last_attempt).find(attempt => attempt?.execution_id === executionId) ?? null;
  if ((lease?.owner ?? view.state.approval?.owner) !== owner.principal) throw new Error("PLAN_RUNTIME_APPROVAL_OWNER_REJECTED");
  return { projection: view, lease: lease ?? null, last_attempt: lastAttempt };
}
