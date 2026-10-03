/** Pure C14 reducer. Markdown/log prose and clock age never infer completion. */
import { z } from "zod";
import { PlanDefinitionSchema, PlanStateV2Schema, type PlanDefinition, type PlanWorkflowState } from "../graph/contracts.js";
import { approvalHash } from "./approval.js";
export type PlanActor = { id: string; instance_id: string; project_id: string; kind: "operator" | "agent" | "runtime";
  /** Trusted producer resolves an existing authorization; never accepted from a request body. */
  review_grant?: { plan_id: string; definition_hash: string; slice_ids: string[] };
};
const id = z.string().min(1).max(1000), ids = z.array(id).max(2000), requiredIds = ids.min(1);
export const PlanEndExecutionCommandSchema = z.object({ type: z.literal("end_execution"), lease_id: id, execution_id: id,
  generation: z.number().int().min(1), outcome: z.enum(["paused", "cancelled", "failed", "timed_out", "completed"]),
  reason: id, stop_acknowledged: z.boolean() }).strict();
export const PlanCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("begin_planning") }).strict(),
  z.object({ type: z.literal("review_plan"), review_id: id }).strict(),
  z.object({ type: z.literal("approve_scope"), approval_id: id, owner: id, scope: requiredIds, parallel_limit: z.number().int().min(1).max(8) }).strict(),
  z.object({ type: z.literal("start_slice"), slice_id: id }).strict(),
  z.object({ type: z.literal("resume_slice"), slice_id: id }).strict(),
  z.object({ type: z.literal("set_primary"), slice_id: id.nullable() }).strict(),
  z.object({ type: z.literal("admit_execution"), slice_id: id.nullable(), lease_id: id, execution_id: id,
    kind: z.enum(["implementation", "verification", "final_verification"]), expires_at: z.string().datetime(), generation: z.number().int().min(1) }).strict(),
  PlanEndExecutionCommandSchema,
  z.object({ type: z.literal("block"), slice_id: id.nullable(), reason: id }).strict(),
  z.object({ type: z.literal("unblock"), slice_id: id.nullable(), reason: id, evidence_ids: requiredIds }).strict(),
  z.object({ type: z.literal("record_implementation"), slice_id: id, receipt_ids: ids, effect_obligation_ids: ids,
    required_stages: z.array(z.enum(["reconciliation", "enrichment", "digestion"])).max(3), evidence_ids: requiredIds,
    reviewed_no_change_id: id.optional() }).strict(),
  z.object({ type: z.literal("begin_verification"), slice_id: id }).strict(),
  z.object({ type: z.literal("finish_verification"), slice_id: id, implementation_revision: z.number().int().min(0), acceptance_hash: id,
    passed: z.boolean(), evidence_ids: requiredIds, review_id: id, reason: id }).strict(),
  z.object({ type: z.literal("defer_slice"), slice_id: id, reason: id, impact: id, review_id: id, dependency_waiver: z.boolean() }).strict(),
  z.object({ type: z.literal("reopen_slice"), slice_id: id, reason: id }).strict(),
  z.object({ type: z.literal("begin_final_verification") }).strict(),
  z.object({ type: z.literal("finish_final_verification"), passed: z.boolean(), evidence_ids: requiredIds, review_id: id }).strict(),
  z.object({ type: z.literal("complete_plan"), review_id: id }).strict(),
  z.object({ type: z.literal("archive_plan"), reason: id }).strict(),
  z.object({ type: z.literal("supersede_plan"), reason: id, successor_id: id }).strict(),
  z.object({ type: z.literal("reconcile_definition"), definition: PlanDefinitionSchema, review_id: id,
    carry_forward_slice_ids: ids, source_hash: id, log_hash: id.nullable() }).strict(),
]);
export type PlanCommand = z.infer<typeof PlanCommandSchema>;
export interface PlanTransitionContext {
  actor: PlanActor; now: string;
  /** Receipts and closure checks are resolved by the durable authority, not callers' prose. */
  implementation_receipts_valid?: boolean;
  closure_allowed?: boolean;
}
export function planDefinitionDigest(definition: PlanDefinition): string {
  return approvalHash({ id: definition.id, instance_id: definition.instance_id, project_id: definition.project_id, phase: definition.phase,
    slices: [...definition.slices].sort((a, b) => a.id.localeCompare(b.id)).map(({ id, priority, depends_on, acceptance_hash, required }) => ({ id, priority,
      depends_on: [...depends_on].sort(), acceptance_hash, required })) });
}
function requireCondition(condition: unknown, code: string): asserts condition { if (!condition) throw new Error(code); }
export function initialPlanState(definition: PlanDefinition, now: string): PlanWorkflowState {
  requireCondition(definition.definition_hash === planDefinitionDigest(definition), "PLAN_DEFINITION_HASH_INVALID");
  const state: PlanWorkflowState = { schema: "dreamgraph.plan_state.v2", id: definition.id, instance_id: definition.instance_id, project_id: definition.project_id,
    revision: 0, event_sequence: 0, definition_hash: definition.definition_hash, definition, lifecycle: "draft", underlying_lifecycle: null,
    primary_current_slice_id: null, current_slice_ids: [], running_slice_ids: [], next_slice_ids: [], last_verified_slice_id: null, plan_blockers: [], successor_id: null,
    approval: null, leases: [], slices: definition.slices.map(slice => ({ id: slice.id, status: "pending", prior_status: null, depends_on: slice.depends_on,
      evidence_ids: [], blockers: [], owner: null, implementation_revision: null, implementation_receipt_ids: [], effect_obligation_ids: [], required_stages: [],
      verification: null, deferral: null, last_attempt: null })), final_verification: null,
    reconciliation: { state: "current", reasons: [] }, updated_at: now };
  return refreshPlanDerivedFields(PlanStateV2Schema.parse(state));
}
export function dependencyDiagnostics(definition: PlanDefinition): Map<string, string[]> {
  const byId = new Map(definition.slices.map(slice => [slice.id, slice]));
  requireCondition(byId.size === definition.slices.length, "PLAN_SLICE_ID_AMBIGUOUS");
  requireCondition(definition.slices.reduce((sum, slice) => sum + slice.depends_on.length, 0) <= 20_000, "PLAN_DEPENDENCY_LIMIT");
  const result = new Map<string, string[]>(), visiting = new Set<string>();
  for (const root of definition.slices) {
    if (result.has(root.id)) continue;
    const stack: Array<{ id: string; index: number; reasons: Set<string> }> = [{ id: root.id, index: 0, reasons: new Set() }];
    visiting.add(root.id);
    while (stack.length) {
      const frame = stack[stack.length - 1], dependencies = byId.get(frame.id)!.depends_on;
      if (frame.index < dependencies.length) {
        const dep = dependencies[frame.index++];
        if (!byId.has(dep)) frame.reasons.add(`missing_dependency:${dep}`);
        else if (result.has(dep)) for (const reason of result.get(dep)!) frame.reasons.add(reason);
        else if (visiting.has(dep)) frame.reasons.add(`dependency_cycle:${dep}`);
        else { visiting.add(dep); stack.push({ id: dep, index: 0, reasons: new Set() }); }
      } else {
        const reasons = [...frame.reasons]; result.set(frame.id, reasons); visiting.delete(frame.id); stack.pop();
        if (stack.length) for (const reason of reasons) stack[stack.length - 1].reasons.add(reason);
      }
    }
  }
  return result;
}
function resolved(slice: PlanWorkflowState["slices"][number]): boolean {
  return slice.status === "verified" && slice.verification?.fresh === true || slice.status === "deferred" && slice.deferral?.dependency_waiver === true;
}
export function planQueue(state: PlanWorkflowState): Array<{ id: string; can_start: boolean; reasons: string[] }> {
  const errors = dependencyDiagnostics(state.definition), byId = new Map(state.slices.map(slice => [slice.id, slice]));
  return state.definition.slices.filter(def => byId.get(def.id)?.status === "pending")
    .sort((a, b) => a.priority - b.priority || a.order - b.order || a.id.localeCompare(b.id))
    .map(def => {
      const reasons = [...(errors.get(def.id) ?? [])];
      for (const dependency of def.depends_on) if (!byId.get(dependency) || !resolved(byId.get(dependency)!)) reasons.push(`dependency_unresolved:${dependency}`);
      if (!state.approval || state.approval.definition_hash !== state.definition_hash || !state.approval.scope.includes(def.id)) reasons.push("awaiting_implementation_approval");
      if (state.plan_blockers.length) reasons.push("plan_blocked");
      if (state.reconciliation.state !== "current") reasons.push("reconciliation_required");
      if (state.leases.length >= (state.approval?.parallel_limit ?? 1)) reasons.push("awaiting_plan_capacity");
      if (["completed", "archived", "superseded", "verifying"].includes(state.lifecycle)) reasons.push("plan_lifecycle_gate");
      return { id: def.id, can_start: reasons.length === 0, reasons };
    });
}
export function refreshPlanDerivedFields(state: PlanWorkflowState): PlanWorkflowState {
  state.current_slice_ids = [...new Set(state.current_slice_ids)].filter(id => state.slices.some(s => s.id === id && !["verified", "deferred"].includes(s.status)));
  state.running_slice_ids = state.leases.filter(lease => lease.state === "running" && lease.slice_id).map(lease => lease.slice_id!);
  state.next_slice_ids = ["completed", "archived", "superseded"].includes(state.lifecycle) ? [] : planQueue(state).filter(item => !item.reasons.some(reason => /^(?:dependency_|missing_dependency:)/.test(reason))).map(item => item.id);
  state.last_verified_slice_id = [...state.slices].filter(s => s.status === "verified" && s.verification?.fresh).sort((a, b) => b.verification!.sequence - a.verification!.sequence)[0]?.id ?? null;
  if (state.primary_current_slice_id && !state.current_slice_ids.includes(state.primary_current_slice_id)) state.primary_current_slice_id = null;
  return state;
}
/** Pure read: expired leases become visible recovery debt, never ghost running work. */
export function projectPlanState(original: PlanWorkflowState, now: string) {
  requireCondition(Number.isFinite(Date.parse(now)), "PLAN_CLOCK_INVALID");
  const state = structuredClone(original);
  for (const lease of state.leases) if (Date.parse(lease.expires_at) <= Date.parse(now)) lease.state = "recovery_required";
  refreshPlanDerivedFields(state);
  const queue = planQueue(state), next = queue.find(item => state.next_slice_ids.includes(item.id)) ?? null;
  const current = state.current_slice_ids.length === 1 ? state.current_slice_ids[0] : state.primary_current_slice_id;
  const running = state.running_slice_ids.length === 1 ? state.running_slice_ids[0] : null;
  const verified = state.slices.filter(slice => slice.status === "verified" && slice.verification?.fresh).length;
  const unresolved = state.definition.slices.filter(def => def.required && !resolved(state.slices.find(slice => slice.id === def.id)!));
  const resume = ["completed", "archived", "superseded"].includes(state.lifecycle) ? state.lifecycle
    : state.reconciliation.state !== "current" || state.leases.some(l => l.state === "recovery_required") ? "recover_execution"
    : state.plan_blockers.length ? "resolve_blocker" : state.current_slice_ids.some(id => state.slices.find(s => s.id === id)?.status === "implemented") ? "verify_implementation"
    : state.current_slice_ids.length ? "resume_current" : !state.approval ? "review_plan" : next?.can_start ? "start_eligible_slice"
    : !unresolved.length && state.lifecycle !== "completed" ? "final_verification_required" : "await_dependencies";
  return { state, as_of: now, current_slice_id: current, running_slice_id: running, next_slice: next,
    execution: state.reconciliation.state === "recovery_required" || state.leases.some(l => l.state === "recovery_required") ? "recovery_required" : state.leases.length ? "running" : "idle",
    current_reason: state.current_slice_ids.length > 1 && !current ? "multiple_current_slices" : null,
    progress: { required: state.definition.slices.filter(s => s.required).length, verified,
      implemented: state.slices.filter(s => ["implemented", "verifying"].includes(s.status)).length,
      current: state.current_slice_ids.length, blocked: state.slices.filter(s => s.status === "blocked").length,
      deferred: state.slices.filter(s => s.status === "deferred").length }, resume_action: resume };
}
export function reducePlanCommand(original: PlanWorkflowState, raw: unknown, context: PlanTransitionContext): PlanWorkflowState {
  const command = PlanCommandSchema.parse(raw), state = structuredClone(original), { actor, now } = context;
  requireCondition(actor.instance_id === state.instance_id && actor.project_id === state.project_id, "PLAN_SCOPE_REJECTED");
  requireCondition(Number.isFinite(Date.parse(now)), "PLAN_CLOCK_INVALID");
  const operator = () => {
    const grant = actor.review_grant;
    const scope = "slice_id" in command && command.slice_id ? [command.slice_id]
      : command.type === "approve_scope" ? command.scope : state.definition.slices.map(s => s.id);
    requireCondition(actor.kind === "operator" || grant?.plan_id === state.id && grant.definition_hash === state.definition_hash
      && scope.every(id => grant.slice_ids.includes(id)), "PLAN_OPERATOR_REVIEW_REQUIRED");
  };
  const quiescent = () => requireCondition(state.leases.length === 0, "PLAN_EXECUTION_OR_RECOVERY_PENDING");
  const lookup = (id: string) => { const slice = state.slices.find(s => s.id === id); requireCondition(slice, "PLAN_SLICE_UNKNOWN"); return slice; };
  const owned = (id: string) => { const slice = lookup(id); requireCondition(slice.owner && (slice.owner === actor.id || actor.kind === "operator" || actor.kind === "runtime" && slice.owner === state.approval?.owner), "PLAN_SLICE_OWNER_REJECTED"); return slice; };
  const approved = (id: string) => requireCondition(state.approval?.definition_hash === state.definition_hash && state.approval.scope.includes(id)
    && !state.plan_blockers.length && state.reconciliation.state === "current", "PLAN_SCOPE_APPROVAL_REQUIRED");
  requireCondition(!["archived", "superseded"].includes(state.lifecycle), "PLAN_TERMINAL_READ_ONLY");
  if (state.lifecycle === "completed") requireCondition(command.type === "reopen_slice" || command.type === "archive_plan" || command.type === "supersede_plan" || command.type === "reconcile_definition", "PLAN_COMPLETED_READ_ONLY");
  switch (command.type) {
    case "begin_planning": operator(); quiescent(); requireCondition(["draft", "planning"].includes(state.lifecycle), "PLAN_STAGE_INVALID"); state.lifecycle = "planning"; break;
    case "review_plan": operator(); quiescent(); requireCondition(["draft", "planning", "reviewed"].includes(state.lifecycle), "PLAN_STAGE_INVALID"); state.lifecycle = "reviewed"; break;
    case "approve_scope": operator(); quiescent(); requireCondition(["reviewed", "implementation_ready", "implementing"].includes(state.lifecycle), "PLAN_REVIEW_REQUIRED");
      command.scope.forEach(lookup); state.approval = { id: command.approval_id, owner: command.owner, definition_hash: state.definition_hash,
        scope: [...new Set(command.scope)], parallel_limit: command.parallel_limit, approved_at: now }; state.lifecycle = state.current_slice_ids.length ? "implementing" : "implementation_ready"; break;
    case "start_slice": {
      approved(command.slice_id); requireCondition(actor.id === state.approval!.owner, "PLAN_SLICE_OWNER_REJECTED");
      const next = planQueue(state).find(item => item.id === command.slice_id); requireCondition(next?.can_start, "PLAN_SLICE_NOT_ELIGIBLE");
      const slice = lookup(command.slice_id); slice.status = "in_progress"; slice.owner = actor.id; state.current_slice_ids.push(slice.id); state.lifecycle = "implementing"; break;
    }
    case "resume_slice": {
      approved(command.slice_id); const slice = owned(command.slice_id); requireCondition(!["pending", "verified", "deferred", "blocked"].includes(slice.status), "PLAN_SLICE_RESUME_INVALID");
      if (!state.current_slice_ids.includes(slice.id)) state.current_slice_ids.push(slice.id); state.lifecycle = "implementing"; break;
    }
    case "set_primary": if (command.slice_id) { owned(command.slice_id); requireCondition(state.current_slice_ids.includes(command.slice_id), "PLAN_PRIMARY_NOT_CURRENT"); } state.primary_current_slice_id = command.slice_id; break;
    case "admit_execution": {
      requireCondition(actor.kind === "runtime", "PLAN_RUNTIME_ADMISSION_REQUIRED"); requireCondition(state.reconciliation.state === "current", "PLAN_RECONCILIATION_REQUIRED");
      requireCondition(Date.parse(command.expires_at) > Date.parse(now) && Date.parse(command.expires_at) - Date.parse(now) <= 86_400_000, "PLAN_LEASE_INVALID");
      requireCondition(!state.leases.some(l => l.id === command.lease_id || l.execution_id === command.execution_id || l.slice_id === command.slice_id), "PLAN_LEASE_CONFLICT");
      requireCondition(state.leases.length < (state.approval?.parallel_limit ?? 1), "PLAN_CAPACITY_EXHAUSTED");
      if (command.slice_id) { approved(command.slice_id); const slice = lookup(command.slice_id);
        requireCondition(state.current_slice_ids.includes(slice.id) && slice.owner === state.approval?.owner, "PLAN_SLICE_NOT_CURRENT");
        requireCondition(command.kind === "implementation" && slice.status === "in_progress" || command.kind === "verification" && slice.status === "verifying", "PLAN_EXECUTION_STAGE_INVALID");
      } else requireCondition(command.kind === "final_verification" && state.lifecycle === "verifying", "PLAN_FINAL_VERIFICATION_REQUIRED");
      state.leases.push({ id: command.lease_id, slice_id: command.slice_id, owner: state.approval?.owner ?? actor.id, execution_id: command.execution_id,
        kind: command.kind, expires_at: command.expires_at, state: "running", generation: command.generation }); break;
    }
    case "end_execution": {
      const lease = state.leases.find(l => l.id === command.lease_id); requireCondition(lease && lease.execution_id === command.execution_id && lease.generation === command.generation, "PLAN_EXECUTION_FENCE_REJECTED");
      requireCondition(actor.id === lease.owner || actor.kind === "runtime", "PLAN_EXECUTION_OWNER_REJECTED");
      if (!command.stop_acknowledged) { lease.state = "recovery_required"; break; }
      state.leases = state.leases.filter(l => l !== lease);
      if (lease.slice_id) lookup(lease.slice_id).last_attempt = { execution_id: lease.execution_id, outcome: command.outcome, reason: command.reason };
      break;
    }
    case "block": {
      if (!command.slice_id) { operator(); state.plan_blockers.push(command.reason); if (state.lifecycle !== "blocked") state.underlying_lifecycle = state.lifecycle; state.lifecycle = "blocked"; }
      else { const slice = owned(command.slice_id); if (slice.status !== "blocked") slice.prior_status = slice.status; slice.status = "blocked"; slice.blockers.push(command.reason); }
      break;
    }
    case "unblock": {
      if (!command.slice_id) { operator(); state.plan_blockers = state.plan_blockers.filter(reason => reason !== command.reason); if (!state.plan_blockers.length) { state.lifecycle = state.underlying_lifecycle ?? "planning"; state.underlying_lifecycle = null; } }
      else { const slice = owned(command.slice_id); requireCondition(slice.status === "blocked", "PLAN_SLICE_NOT_BLOCKED"); slice.blockers = slice.blockers.filter(reason => reason !== command.reason);
        slice.evidence_ids.push(...command.evidence_ids); if (!slice.blockers.length) { slice.status = slice.prior_status ?? "in_progress"; slice.prior_status = null; } }
      break;
    }
    case "record_implementation": {
      approved(command.slice_id); const slice = owned(command.slice_id); requireCondition(slice.status === "in_progress", "PLAN_IMPLEMENTATION_STAGE_INVALID");
      requireCondition(!state.leases.some(l => l.slice_id === slice.id), "PLAN_EXECUTION_OR_RECOVERY_PENDING");
      requireCondition(context.implementation_receipts_valid === true, "PLAN_IMPLEMENTATION_RECEIPT_REQUIRED");
      slice.status = "implemented"; slice.implementation_revision = state.revision + 1; slice.implementation_receipt_ids = command.receipt_ids;
      slice.effect_obligation_ids = command.effect_obligation_ids; slice.required_stages = [...new Set(command.required_stages)]; slice.evidence_ids = [...new Set([...slice.evidence_ids, ...command.evidence_ids])]; break;
    }
    case "begin_verification": { approved(command.slice_id); const slice = owned(command.slice_id); requireCondition(slice.status === "implemented", "PLAN_IMPLEMENTATION_REQUIRED");
      requireCondition(slice.depends_on.every(id => resolved(lookup(id))), "PLAN_DEPENDENCIES_UNRESOLVED"); slice.status = "verifying"; break; }
    case "finish_verification": {
      const slice = owned(command.slice_id); requireCondition(slice.status === "verifying", "PLAN_VERIFICATION_STAGE_INVALID");
      requireCondition(!state.leases.some(l => l.slice_id === slice.id), "PLAN_EXECUTION_OR_RECOVERY_PENDING");
      const definition = state.definition.slices.find(s => s.id === slice.id)!;
      requireCondition(command.acceptance_hash === definition.acceptance_hash && command.implementation_revision === slice.implementation_revision, "PLAN_VERIFICATION_REVISION_CONFLICT");
      if (!command.passed) { slice.status = "implemented"; slice.last_attempt = { execution_id: "verification", outcome: "failed", reason: command.reason }; break; }
      approved(slice.id); requireCondition(slice.depends_on.every(id => resolved(lookup(id))), "PLAN_DEPENDENCIES_UNRESOLVED");
      operator(); requireCondition(context.closure_allowed === true, "PLAN_REQUIRED_RECONCILIATION_PENDING");
      slice.status = "verified"; slice.verification = { acceptance_hash: command.acceptance_hash, implementation_revision: command.implementation_revision,
        evidence_ids: command.evidence_ids, review_id: command.review_id, sequence: state.event_sequence + 1, fresh: true }; break;
    }
    case "defer_slice": {
      operator(); quiescent(); const slice = lookup(command.slice_id); requireCondition(slice.status !== "verified", "PLAN_ALREADY_VERIFIED");
      slice.status = "deferred"; slice.deferral = { reason: command.reason, owner: actor.id, impact: command.impact, review_id: command.review_id, dependency_waiver: command.dependency_waiver }; break;
    }
    case "reopen_slice": {
      operator(); quiescent(); const slice = lookup(command.slice_id); requireCondition(["verified", "deferred"].includes(slice.status), "PLAN_REOPEN_STAGE_INVALID");
      slice.status = "in_progress"; slice.owner = state.approval?.owner ?? actor.id; slice.deferral = null; if (slice.verification) slice.verification.fresh = false;
      state.current_slice_ids.push(slice.id); const affected = new Set([slice.id]); let changed = true;
      while (changed) { changed = false; for (const candidate of state.slices) if (!affected.has(candidate.id) && candidate.depends_on.some(id => affected.has(id))) { affected.add(candidate.id); changed = true; } }
      for (const candidate of state.slices) if (affected.has(candidate.id) && candidate.verification) { candidate.verification.fresh = false; if (candidate.status === "verified") candidate.status = "implemented"; }
      state.final_verification = null; state.lifecycle = state.approval ? "implementing" : "planning"; break;
    }
    case "begin_final_verification": operator(); quiescent(); requireCondition(state.definition.slices.every(def => !def.required || resolved(lookup(def.id))), "PLAN_REQUIRED_SLICES_UNRESOLVED");
      requireCondition(state.reconciliation.state === "current" && !state.plan_blockers.length, "PLAN_RECONCILIATION_REQUIRED"); state.lifecycle = "verifying"; state.final_verification = null; break;
    case "finish_final_verification": operator(); quiescent(); requireCondition(state.lifecycle === "verifying", "PLAN_FINAL_VERIFICATION_REQUIRED");
      state.final_verification = { definition_hash: state.definition_hash, evidence_ids: command.evidence_ids, review_id: command.review_id, passed: command.passed, sequence: state.event_sequence + 1 }; break;
    case "complete_plan": operator(); quiescent(); requireCondition(state.lifecycle === "verifying" && state.final_verification?.passed && state.final_verification.definition_hash === state.definition_hash
      && state.definition.slices.every(def => !def.required || resolved(lookup(def.id))) && !state.plan_blockers.length && state.reconciliation.state === "current", "PLAN_FINAL_ACCEPTANCE_REQUIRED");
      requireCondition(context.closure_allowed === true, "PLAN_REQUIRED_RECONCILIATION_PENDING"); state.lifecycle = "completed"; state.current_slice_ids = []; break;
    case "archive_plan": case "supersede_plan": operator(); quiescent(); requireCondition(context.closure_allowed === true, "PLAN_REQUIRED_RECONCILIATION_PENDING"); state.underlying_lifecycle = state.lifecycle; state.lifecycle = command.type === "archive_plan" ? "archived" : "superseded";
      state.successor_id = command.type === "supersede_plan" ? command.successor_id : null; break;
    case "reconcile_definition": {
      operator(); quiescent(); const definition = command.definition;
      requireCondition(definition.id === state.id && definition.instance_id === state.instance_id && definition.project_id === state.project_id
        && definition.revision === state.definition.revision + 1 && definition.source_hash === command.source_hash && definition.log_hash === command.log_hash, "PLAN_DEFINITION_REVISION_CONFLICT");
      dependencyDiagnostics(definition); const oldDefinition = state.definition;
      for (const carry of command.carry_forward_slice_ids) {
        const old = oldDefinition.slices.find(s => s.id === carry), fresh = definition.slices.find(s => s.id === carry);
        requireCondition(old && fresh && old.acceptance_hash === fresh.acceptance_hash && approvalHash([...old.depends_on].sort()) === approvalHash([...fresh.depends_on].sort()), "PLAN_CARRY_FORWARD_CHANGED_SCOPE");
      }
      const unchanged = oldDefinition.definition_hash === definition.definition_hash;
      const freshState = initialPlanState(definition, now), carry = new Set(unchanged ? oldDefinition.slices.map(s => s.id) : command.carry_forward_slice_ids);
      const changedIds = new Set(oldDefinition.slices.filter(old => !carry.has(old.id)).map(old => old.id));
      // Never drop an unfinished owned branch or its obligations during definition review.
      for (const current of state.current_slice_ids) requireCondition(carry.has(current), "PLAN_CURRENT_SCOPE_REVIEW_REQUIRED");
      for (const old of state.slices) if (!definition.slices.some(s => s.id === old.id)) {
        requireCondition(!old.effect_obligation_ids.length && !old.implementation_receipt_ids.length && old.status === "pending", "PLAN_REMOVAL_HISTORY_REVIEW_REQUIRED");
      }
      let expanded = true;
      while (expanded) { expanded = false; for (const entry of definition.slices) if (!changedIds.has(entry.id) && entry.depends_on.some(id => changedIds.has(id))) { changedIds.add(entry.id); expanded = true; } }
      state.slices = freshState.slices.map(slice => {
        const previous = state.slices.find(old => old.id === slice.id);
        if (!previous) return slice;
        if (!carry.has(slice.id)) return { ...previous, depends_on: slice.depends_on,
          status: previous.implementation_revision === null ? "pending" : "implemented",
          verification: previous.verification ? { ...previous.verification, fresh: false } : null };
        const result = { ...previous, depends_on: slice.depends_on };
        if (changedIds.has(slice.id) && result.verification) {
          result.verification = { ...result.verification, fresh: false };
          if (result.status === "verified") result.status = "implemented";
        }
        return result;
      });
      state.definition = definition; state.definition_hash = definition.definition_hash;
      if (!unchanged) {
        if (state.approval) {
          const preserved = state.approval.scope.filter(id => carry.has(id) && !changedIds.has(id));
          state.approval = preserved.length ? { ...state.approval, definition_hash: definition.definition_hash, scope: preserved } : null;
        }
        state.final_verification = null;
        state.lifecycle = state.current_slice_ids.length ? "implementing" : state.approval ? "implementation_ready" : "planning";
      }
      state.reconciliation = { state: "current", reasons: [] }; break;
    }
  }
  state.revision++; state.event_sequence++; state.updated_at = now;
  return PlanStateV2Schema.parse(refreshPlanDerivedFields(state));
}
