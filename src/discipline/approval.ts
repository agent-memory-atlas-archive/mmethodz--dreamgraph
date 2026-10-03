/** Persisted, content-bound approval; historical approval never admits a new wave. */
import { createHash } from "node:crypto";
import type { ImplementationPlan, TaskSession } from "./types.js";
function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  return "{" + Object.keys(value).sort().filter(key => (value as any)[key] !== undefined).map(key => JSON.stringify(key) + ":" + stable((value as any)[key])).join(",") + "}";
}
export const approvalHash = (value: unknown) => "sha256:" + createHash("sha256").update(stable(value)).digest("hex");
export function planContentHash(plan: ImplementationPlan): string {
  return approvalHash({ session_id: plan.session_id, instance_uuid: plan.instance_uuid, description: plan.description,
    items: plan.items.map(({ execution_status, ...definition }) => definition) });
}
export function bindPlanApproval(session: TaskSession, plan: ImplementationPlan): NonNullable<ImplementationPlan["approval_binding"]> {
  const delta = session.artifacts.delta_tables.at(-1);
  if (!delta || delta.entries.some(entry => entry.status === "not_yet_verified")) throw new Error("DISCIPLINE_DELTA_INCOMPLETE");
  return { generation: session.approval_generation ?? 0, delta_hash: approvalHash(delta), content_hash: planContentHash(plan) };
}
export function currentApprovedPlan(session: TaskSession): ImplementationPlan | null {
  const plan = session.artifacts.plans.at(-1), delta = session.artifacts.delta_tables.at(-1);
  if (!plan || !delta || !["approved", "in_progress"].includes(plan.status) || !plan.approved_at || !plan.approval_binding) return null;
  if (delta.entries.some(entry => entry.status === "not_yet_verified") || plan.approval_binding.generation !== (session.approval_generation ?? 0)
    || plan.approval_binding.delta_hash !== approvalHash(delta) || plan.approval_binding.content_hash !== planContentHash(plan)) return null;
  return plan;
}
export function disciplineArtifactGate(session: TaskSession, target: string): string | null {
  if (target === "plan") {
    const delta = session.artifacts.delta_tables.at(-1);
    if (!delta || delta.entries.some(entry => entry.status === "not_yet_verified")) return "DISCIPLINE_DELTA_INCOMPLETE: the latest audit must be complete before planning";
  }
  if (target === "execute" && !currentApprovedPlan(session)) return "DISCIPLINE_CURRENT_APPROVAL_REQUIRED: approve the latest plan in this planning generation against the latest complete delta and unchanged content";
  return null;
}
