/** C13 execution-bound authority. Native output preferences never grant effects. */
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { AutonomySchema, VerbositySchema, ExecutionApprovalSchema } from "../graph/contracts.js";
export { ExecutionApprovalSchema } from "../graph/contracts.js";
import type { SessionContext } from "./session-context.js";
import { coreToolPolicy } from "./tool-policy.js";
import { ARCHITECT_PASS_MAX_MS } from "../config/request-bounds.js";

const stable = (v: unknown): string => v === null || typeof v !== "object" ? JSON.stringify(v)
  : Array.isArray(v) ? `[${v.map(stable).join(",")}]` : `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`;
export type ExecutionApproval = z.infer<typeof ExecutionApprovalSchema>;
export interface ExecutionPolicy {
  id: string; autonomy: z.infer<typeof AutonomySchema>; verbosity: z.infer<typeof VerbositySchema>;
  expires_at: string; scope: string[]; approved_actions: ExecutionApproval; effects_started: number;
  max_effects: number; effects_inflight: number; signal: AbortSignal; revision: string; context_id?: string;
  /**
   * Liveness model. expires_at is a rolling deadline: min(last_activity_at + idle_ms, ceiling_at).
   * Healthy executions renew it through real activity (worker calls, CLI output); a stale or dead
   * execution stops renewing and ends with EXECUTION_STALE. ceiling_at is the operator's finite,
   * non-extendable maximum and ends the execution with EXECUTION_CEILING_REACHED.
   */
  ceiling_at: string; idle_ms: number; last_activity_at: string;
  /** Record activity. Returns false when the execution is already closed/expired. Never extends ceiling_at. */
  renew: () => boolean;
  /** Operator-host rendezvous only. A proposal never issues its own approval. */
  request_review?: (tool: string, args: unknown, signal: AbortSignal) => Promise<void>;
}
const leases = new Map<string, { context: SessionContext; policy: ExecutionPolicy }>();
const digest = (v: unknown) => createHash("sha256").update(stable(v)).digest("hex");
/** Explicit reason an execution is no longer authorized (null while live). */
export function executionExpiry(policy: Pick<ExecutionPolicy, "expires_at" | "ceiling_at" | "signal">, now = Date.now()): "EXECUTION_CEILING_REACHED" | "EXECUTION_STALE" | "EXECUTION_POLICY_CLOSED" | null {
  if (policy.signal.aborted) { const reason = String((policy.signal.reason as Error | undefined)?.message ?? ""); return reason.startsWith("EXECUTION_CEILING_REACHED") ? "EXECUTION_CEILING_REACHED" : reason.startsWith("EXECUTION_STALE") ? "EXECUTION_STALE" : "EXECUTION_POLICY_CLOSED"; }
  if (Date.parse(policy.ceiling_at) <= now) return "EXECUTION_CEILING_REACHED";
  if (Date.parse(policy.expires_at) <= now) return "EXECUTION_STALE";
  return null;
}
/** Throws the explicit expiry code; keeps the historical EXECUTION_POLICY_EXPIRED prefix for existing consumers. */
export function assertExecutionLive(policy: ExecutionPolicy): void {
  const reason = executionExpiry(policy);
  if (reason === "EXECUTION_POLICY_CLOSED") policy.signal.throwIfAborted();
  if (reason) throw new Error(`EXECUTION_POLICY_EXPIRED: ${reason}`);
}
export function issueExecutionPolicy(context: SessionContext, input: { id: string; autonomy: unknown; verbosity: unknown;
  approvals?: unknown; timeout_ms: number; idle_ms?: number; signal: AbortSignal; context_id?: string }) {
  const autonomy = AutonomySchema.parse(input.autonomy), verbosity = VerbositySchema.parse(input.verbosity);
  if (input.context_id && input.context_id !== input.id) throw new Error("EXECUTION_CONTEXT_ID_MISMATCH");
  const approved_actions = structuredClone(ExecutionApprovalSchema.parse(input.approvals ?? []));
  if (Buffer.byteLength(JSON.stringify(approved_actions)) > 65536) throw new Error("EXECUTION_APPROVAL_BUDGET");
  const scope = [...new Set(approved_actions.map(a => a.scope_id))];
  if (autonomy !== "autonomous" && scope.length > 1) throw new Error("EXECUTION_CHECKPOINT_SCOPE_REQUIRED");
  if (!Number.isSafeInteger(input.timeout_ms) || input.timeout_ms < 1 || input.timeout_ms > ARCHITECT_PASS_MAX_MS) throw new Error("EXECUTION_TIMEOUT_INVALID");
  const idle_ms = input.idle_ms === undefined ? input.timeout_ms : input.idle_ms;
  if (!Number.isSafeInteger(idle_ms) || idle_ms < 1) throw new Error("EXECUTION_IDLE_TIMEOUT_INVALID");
  for (const [key, entry] of leases) if (entry.policy.signal.aborted || Date.parse(entry.policy.expires_at) <= Date.now()) leases.delete(key);
  if (leases.size >= 1024) throw new Error("EXECUTION_POLICY_CAPACITY");
  const revision = digest([context.principal, context.session_id, input.id, input.context_id ?? null, autonomy, verbosity, approved_actions]);
  const controller = new AbortController(), relayAbort = () => controller.abort(input.signal.reason);
  if (input.signal.aborted) relayAbort(); else input.signal.addEventListener("abort", relayAbort, { once: true });
  const started = Date.now(), ceiling = started + input.timeout_ms;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    if (expiry) clearTimeout(expiry);
    if (controller.signal.aborted) return;
    expiry = setTimeout(() => {
      const now = Date.now(), reason = executionExpiry(policy, now);
      if (reason === "EXECUTION_CEILING_REACHED") controller.abort(new Error(`EXECUTION_CEILING_REACHED: operator maximum of ${Math.round(input.timeout_ms / 60000)} min reached`));
      else if (reason === "EXECUTION_STALE") controller.abort(new Error(`EXECUTION_STALE: no activity for ${Math.round(idle_ms / 60000)} min`));
      else arm();
    }, Math.max(1, Date.parse(policy.expires_at) - Date.now()));
    expiry.unref();
  };
  const policy: ExecutionPolicy = { id: input.id, autonomy, verbosity, scope, approved_actions,
    expires_at: new Date(Math.min(started + idle_ms, ceiling)).toISOString(), ceiling_at: new Date(ceiling).toISOString(), idle_ms,
    last_activity_at: new Date(started).toISOString(), effects_started: 0,
    max_effects: autonomy === "manual" ? 1 : autonomy === "supervised" ? 32 : 128, signal: controller.signal, revision,
    effects_inflight: 0,
    renew: () => {
      const now = Date.now();
      if (controller.signal.aborted || now >= ceiling || now >= Date.parse(policy.expires_at)) return false;
      policy.last_activity_at = new Date(now).toISOString();
      // Rolling renewal only moves within the fixed ceiling.
      const next = Math.min(now + idle_ms, ceiling);
      if (next > Date.parse(policy.expires_at)) policy.expires_at = new Date(next).toISOString();
      return true;
    },
    ...(input.context_id ? { context_id: input.context_id } : {}) };
  arm();
  const bearer = `dgexec.${randomBytes(32).toString("base64url")}`, key = digest(bearer);
  leases.set(key, { context, policy });
  return { bearer, policy, close: () => { leases.delete(key); if (expiry) clearTimeout(expiry); input.signal.removeEventListener("abort", relayAbort); controller.abort(new Error("EXECUTION_POLICY_CLOSED")); }, projection: executionPolicyProjection(policy) };
}
export function authenticateExecutionPolicy(bearer: string, principal: string, directory: string): SessionContext {
  const entry = leases.get(digest(bearer));
  if (!entry || entry.context.principal !== principal || entry.context.directory !== directory
    || entry.policy.signal.aborted || Date.parse(entry.policy.expires_at) <= Date.now()) throw new Error("EXECUTION_POLICY_REJECTED");
  // Every authenticated worker call is evidence the execution is alive.
  entry.policy.renew();
  return { ...entry.context, execution_policy: entry.policy, saveEnvironment: undefined };
}
export function executionPolicyProjection(policy: ExecutionPolicy) {
  return { requested: { autonomy: policy.autonomy, verbosity: policy.verbosity }, effective: { autonomy: policy.autonomy, verbosity: policy.verbosity },
    support: "enforced" as const, mechanism: "execution-bound daemon tool fence; exact approved actions; native pass orchestration",
    scope: policy.scope, policy_revision: policy.revision, execution_id: policy.id, expires_at: policy.expires_at,
    ceiling_at: policy.ceiling_at, idle_ms: policy.idle_ms, last_activity_at: policy.last_activity_at, liveness: executionExpiry(policy) ?? "active",
    maximum_effects: policy.max_effects, approved_effects: policy.approved_actions.reduce((sum, action) => sum + action.calls, 0),
    context_execution_id: policy.context_id ?? null,
    reasons: policy.approved_actions.length ? [] : ["No approved effects; inspect/propose only. Authorize bounded actions through the operator request or governed client scope."],
    native_computer_use: "unqualified; separate native grant and stop qualification required" };
}
/** Prepare without mutating authority; publication of the exact review must precede activation. */
export function prepareExecutionApproval(policy: ExecutionPolicy, approval_id: string, input: unknown) {
  assertExecutionLive(policy);
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
    assertExecutionLive(policy);
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
  assertExecutionLive(policy);
  if (policy.approved_actions.some(action => action.tool === tool && digest(action.arguments) === digest(args ?? {}) && action.calls > 0)) return;
  if (policy.effects_started >= policy.max_effects) throw new Error("EXECUTION_ACTION_APPROVAL_REQUIRED: effect ceiling exhausted");
  if (policy.request_review) await policy.request_review(tool, args ?? {}, signal);
  signal.throwIfAborted();
}
export function assertExecutionAction(policy: ExecutionPolicy | undefined, tool: string, args: unknown): void {
  if (!policy) return;
  assertExecutionLive(policy);
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
