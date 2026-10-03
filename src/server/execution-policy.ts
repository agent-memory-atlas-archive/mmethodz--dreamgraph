/** C13 execution-bound authority. Native output preferences never grant effects. */
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { AutonomySchema, VerbositySchema, ExecutionApprovalSchema } from "../graph/contracts.js";
export { ExecutionApprovalSchema } from "../graph/contracts.js";
import type { SessionContext } from "./session-context.js";
import { coreToolPolicy } from "./tool-policy.js";

const stable = (v: unknown): string => v === null || typeof v !== "object" ? JSON.stringify(v)
  : Array.isArray(v) ? `[${v.map(stable).join(",")}]` : `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`;
export type ExecutionApproval = z.infer<typeof ExecutionApprovalSchema>;
export interface ExecutionPolicy {
  id: string; autonomy: z.infer<typeof AutonomySchema>; verbosity: z.infer<typeof VerbositySchema>;
  expires_at: string; scope: string[]; approved_actions: ExecutionApproval; effects_started: number;
  max_effects: number; effects_inflight: number; signal: AbortSignal; revision: string; context_id?: string;
  /** Operator-host rendezvous only. A proposal never issues its own approval. */
  request_review?: (tool: string, args: unknown, signal: AbortSignal) => Promise<void>;
}
const leases = new Map<string, { context: SessionContext; policy: ExecutionPolicy }>();
const digest = (v: unknown) => createHash("sha256").update(stable(v)).digest("hex");
export function issueExecutionPolicy(context: SessionContext, input: { id: string; autonomy: unknown; verbosity: unknown;
  approvals?: unknown; timeout_ms: number; signal: AbortSignal; context_id?: string }) {
  const autonomy = AutonomySchema.parse(input.autonomy), verbosity = VerbositySchema.parse(input.verbosity);
  if (input.context_id && input.context_id !== input.id) throw new Error("EXECUTION_CONTEXT_ID_MISMATCH");
  const approved_actions = structuredClone(ExecutionApprovalSchema.parse(input.approvals ?? []));
  if (Buffer.byteLength(JSON.stringify(approved_actions)) > 65536) throw new Error("EXECUTION_APPROVAL_BUDGET");
  const scope = [...new Set(approved_actions.map(a => a.scope_id))];
  if (autonomy !== "autonomous" && scope.length > 1) throw new Error("EXECUTION_CHECKPOINT_SCOPE_REQUIRED");
  if (!Number.isSafeInteger(input.timeout_ms) || input.timeout_ms < 1 || input.timeout_ms > 300000) throw new Error("EXECUTION_TIMEOUT_INVALID");
  for (const [key, entry] of leases) if (entry.policy.signal.aborted || Date.parse(entry.policy.expires_at) <= Date.now()) leases.delete(key);
  if (leases.size >= 1024) throw new Error("EXECUTION_POLICY_CAPACITY");
  const revision = digest([context.principal, context.session_id, input.id, input.context_id ?? null, autonomy, verbosity, approved_actions]);
  const controller = new AbortController(), relayAbort = () => controller.abort(input.signal.reason);
  if (input.signal.aborted) relayAbort(); else input.signal.addEventListener("abort", relayAbort, { once: true });
  const expiry = setTimeout(() => controller.abort(new Error("EXECUTION_POLICY_EXPIRED")), input.timeout_ms); expiry.unref();
  const policy: ExecutionPolicy = { id: input.id, autonomy, verbosity, scope, approved_actions,
    expires_at: new Date(Date.now() + input.timeout_ms).toISOString(), effects_started: 0,
    max_effects: autonomy === "manual" ? 1 : autonomy === "supervised" ? 32 : 128, signal: controller.signal, revision,
    effects_inflight: 0,
    ...(input.context_id ? { context_id: input.context_id } : {}) };
  const bearer = `dgexec.${randomBytes(32).toString("base64url")}`, key = digest(bearer);
  leases.set(key, { context, policy });
  return { bearer, policy, close: () => { leases.delete(key); clearTimeout(expiry); input.signal.removeEventListener("abort", relayAbort); controller.abort(new Error("EXECUTION_POLICY_CLOSED")); }, projection: executionPolicyProjection(policy) };
}
export function authenticateExecutionPolicy(bearer: string, principal: string, directory: string): SessionContext {
  const entry = leases.get(digest(bearer));
  if (!entry || entry.context.principal !== principal || entry.context.directory !== directory
    || entry.policy.signal.aborted || Date.parse(entry.policy.expires_at) <= Date.now()) throw new Error("EXECUTION_POLICY_REJECTED");
  return { ...entry.context, execution_policy: entry.policy, saveEnvironment: undefined };
}
export function executionPolicyProjection(policy: ExecutionPolicy) {
  return { requested: { autonomy: policy.autonomy, verbosity: policy.verbosity }, effective: { autonomy: policy.autonomy, verbosity: policy.verbosity },
    support: "enforced" as const, mechanism: "execution-bound daemon tool fence; exact approved actions; native pass orchestration",
    scope: policy.scope, policy_revision: policy.revision, execution_id: policy.id, expires_at: policy.expires_at,
    maximum_effects: policy.max_effects, approved_effects: policy.approved_actions.reduce((sum, action) => sum + action.calls, 0),
    context_execution_id: policy.context_id ?? null,
    reasons: policy.approved_actions.length ? [] : ["No approved effects; inspect/propose only. Authorize bounded actions through the operator request or governed client scope."],
    native_computer_use: "unqualified; separate native grant and stop qualification required" };
}
/** Prepare without mutating authority; publication of the exact review must precede activation. */
export function prepareExecutionApproval(policy: ExecutionPolicy, approval_id: string, input: unknown) {
  policy.signal.throwIfAborted();
  if (Date.parse(policy.expires_at) <= Date.now()) throw new Error("EXECUTION_POLICY_EXPIRED");
  if (policy.effects_inflight) throw new Error("EXECUTION_APPROVAL_EFFECT_INFLIGHT");
  const actions = structuredClone(ExecutionApprovalSchema.min(1).parse(input));
  if (actions.some(action => coreToolPolicy(action.tool).read_only)) throw new Error("EXECUTION_APPROVAL_EFFECT_REQUIRED");
  const combined = [...policy.approved_actions.filter(action => action.calls > 0), ...actions];
  ExecutionApprovalSchema.parse(combined);
  if (Buffer.byteLength(JSON.stringify(combined), "utf8") > 65536) throw new Error("EXECUTION_APPROVAL_BUDGET");
  const scope = [...new Set([...policy.scope, ...actions.map(action => action.scope_id)])];
  if (policy.autonomy !== "autonomous" && scope.length > 1) throw new Error("EXECUTION_CHECKPOINT_SCOPE_REQUIRED");
  if (combined.reduce((sum, action) => sum + action.calls, 0) > policy.max_effects - policy.effects_started)
    throw new Error("EXECUTION_APPROVAL_EFFECT_ALLOWANCE_EXCEEDED");
  const revision = digest([policy.revision, approval_id, actions]);
  return { revision, activate: () => {
    policy.signal.throwIfAborted();
    if (Date.parse(policy.expires_at) <= Date.now()) throw new Error("EXECUTION_POLICY_EXPIRED");
    if (policy.effects_inflight) throw new Error("EXECUTION_APPROVAL_EFFECT_INFLIGHT");
    // No expiry extension, new worker, reset of consumed calls, or autonomy change.
    policy.approved_actions = combined; policy.scope = scope; policy.revision = revision;
  } };
}
/** Reserve an admitted action before dispatch. An uncertain outcome cannot consume the action twice. */
export async function reviewExecutionAction(policy: ExecutionPolicy | undefined, tool: string, args: unknown, requestSignal?: AbortSignal): Promise<void> {
  if (!policy || coreToolPolicy(tool).read_only) return;
  const signal = requestSignal ? AbortSignal.any([policy.signal, requestSignal]) : policy.signal;
  signal.throwIfAborted();
  if (Date.parse(policy.expires_at) <= Date.now()) throw new Error("EXECUTION_POLICY_EXPIRED");
  if (policy.approved_actions.some(action => action.tool === tool && digest(action.arguments) === digest(args ?? {}) && action.calls > 0)) return;
  if (policy.effects_started >= policy.max_effects) throw new Error("EXECUTION_ACTION_APPROVAL_REQUIRED: effect ceiling exhausted");
  if (policy.request_review) await policy.request_review(tool, args ?? {}, signal);
  signal.throwIfAborted();
}
export function assertExecutionAction(policy: ExecutionPolicy | undefined, tool: string, args: unknown): void {
  if (!policy) return;
  policy.signal.throwIfAborted();
  if (Date.parse(policy.expires_at) <= Date.now()) throw new Error("EXECUTION_POLICY_EXPIRED");
  if (coreToolPolicy(tool).read_only) return;
  const action = policy.approved_actions.find(a => a.tool === tool && digest(a.arguments) === digest(args ?? {}) && a.calls > 0);
  if (!action || policy.effects_started >= policy.max_effects) throw new Error("EXECUTION_ACTION_APPROVAL_REQUIRED");
  policy.effects_started++; action.calls--;
}
/** Keep review changes fenced for the complete asynchronous owner operation. */
export function reserveExecutionAction(policy: ExecutionPolicy | undefined, tool: string, args: unknown): (() => void) | undefined {
  assertExecutionAction(policy, tool, args);
  if (!policy || coreToolPolicy(tool).read_only) return;
  policy.effects_inflight++;
  let released = false;
  return () => { if (!released) { released = true; policy.effects_inflight--; } };
}
