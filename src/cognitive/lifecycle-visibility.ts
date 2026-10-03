import type { DreamHistoryEntry, RemediationPlan, ResolvedTension } from "./types.js";

export type CognitiveLifecycleArtifactKind = "future" | "tension" | "insight" | "narrative";
export type CognitiveLifecycleAuthority = "daemon" | "human" | "system" | "collaborative";

export interface CognitiveLifecycleTransition {
  artifact_id: string;
  artifact_kind: CognitiveLifecycleArtifactKind;
  prior_state: string;
  new_state: string;
  changed_at: string | null;
  source: string;
  authority: CognitiveLifecycleAuthority;
  triggering_evidence: string[];
  superseding_artifact: string | null;
  remaining_uncertainty: string | null;
}

export interface CognitiveLifecycleProjection {
  projection?: import("./projection-context.js").CognitiveProjectionContext;
  interpretation:"historical_transitions";
  generated_at: string;
  transitions: CognitiveLifecycleTransition[];
}

function tensionAuthority(resolved: ResolvedTension): CognitiveLifecycleAuthority {
  if (resolved.resolved_by === "human") return "human";
  if (resolved.resolved_by === "system") return "system";
  return "daemon";
}

function tensionNewState(resolved: ResolvedTension): string {
  if (resolved.resolution_state === "expired_unverified" || resolved.resolution_type === "expired_unverified") return "expired_unverified";
  if (resolved.resolution_type === "wont_fix") return "retired";
  if (resolved.resolution_type === "false_positive") return "rejected";
  return "resolved";
}

export function transitionFromResolvedTension(resolved: ResolvedTension): CognitiveLifecycleTransition {
  const newState = tensionNewState(resolved);
  return {
    artifact_id: resolved.tension_id,
    artifact_kind: "tension",
    prior_state: resolved.original.resolved ? "resolved" : "unresolved",
    new_state: newState,
    changed_at: resolved.resolved_at,
    source: "tension_log.resolved_tensions",
    authority: tensionAuthority(resolved),
    triggering_evidence: [
      resolved.evidence ?? `${resolved.resolution_type} resolution`,
      `entities:${resolved.original.entities.join(",")}`,
    ],
    superseding_artifact: null,
    remaining_uncertainty: resolved.resolution_state === "verified" ? "Verified at recorded time; current proof can change or reopen review." : "Disposition or expiry is not independent source verification; inspect the retained rationale and original record.",
  };
}

export function transitionFromSupersededFuture(plan: RemediationPlan): CognitiveLifecycleTransition | null {
  if (!plan.superseded_by) return null;
  return {
    artifact_id: plan.id,
    artifact_kind: "future",
    prior_state: "active",
    new_state: "superseded",
    changed_at: null,
    source: "remediation_plans.history",
    authority: "daemon",
    triggering_evidence: [
      plan.adaptive_future_review?.summary ?? "Newer remediation plan superseded this future.",
      ...((plan.adaptive_future_review?.evidence_anchor_ids ?? [plan.tension_id]) ?? []).slice(0, 5),
    ],
    superseding_artifact: plan.superseded_by,
    remaining_uncertainty: plan.adaptive_future_review
      ? null
      : "Supersession is recorded, but no detailed review summary was attached. Its transition time is unavailable; generation time is not supersession time.",
  };
}

export function transitionsFromDreamHistorySession(session: DreamHistoryEntry): CognitiveLifecycleTransition[] {
  const transitions: CognitiveLifecycleTransition[] = [];
  if (session.tensions_expired > 0) {
    transitions.push({
      artifact_id: `${session.session_id}:expired-tensions`,
      artifact_kind: "insight",
      prior_state: "active",
      new_state: "expired",
      changed_at: session.timestamp,
      source: "dream_history.sessions.tensions_expired",
      authority: "daemon",
      triggering_evidence: [`${session.tensions_expired} tension insight(s) expired during cycle ${session.cycle_number}.`],
      superseding_artifact: null,
      remaining_uncertainty: "Dream history records counts, not every expired artifact identity.",
    });
  }
  if (session.decayed_nodes > 0 || session.decayed_edges > 0) {
    transitions.push({
      artifact_id: `${session.session_id}:narrative-decay`,
      artifact_kind: "narrative",
      prior_state: "active",
      new_state: "decayed",
      changed_at: session.timestamp,
      source: "dream_history.sessions.decayed_artifacts",
      authority: "daemon",
      triggering_evidence: [`${session.decayed_nodes} node(s) and ${session.decayed_edges} edge(s) decayed during cycle ${session.cycle_number}.`],
      superseding_artifact: null,
      remaining_uncertainty: "Decay is retention activity, not proof of reduced usefulness or expiry. Original historical context remains inspectable.",
    });
  }
  return transitions;
}

export function buildCognitiveLifecycleProjection(input: {
  resolvedTensions?: ResolvedTension[];
  remediationHistory?: RemediationPlan[];
  dreamHistory?: DreamHistoryEntry[];
  generatedAt?: string;
  projection?: import("./projection-context.js").CognitiveProjectionContext;
}): CognitiveLifecycleProjection {
  return {
    interpretation:"historical_transitions",projection:input.projection,
    generated_at: input.generatedAt ?? new Date().toISOString(),
    transitions: [
      ...(input.resolvedTensions ?? []).flatMap(resolved=>[transitionFromResolvedTension(resolved),...(resolved.reopened_at?[{
        artifact_id:resolved.tension_id,artifact_kind:"tension" as const,prior_state:tensionNewState(resolved),new_state:"reopened",changed_at:resolved.reopened_at,
        source:"tension_log.resolved_tensions.reopened_at",authority:"daemon" as const,triggering_evidence:[resolved.reappearance_reason??"Current evidence requires renewed review"],
        superseding_artifact:null,remaining_uncertainty:"Prior closure is retained as history; it does not resolve the reopened current risk.",
      }]:[])]),
      ...(input.remediationHistory ?? []).map(transitionFromSupersededFuture).filter((entry): entry is CognitiveLifecycleTransition => entry != null),
      ...(input.dreamHistory ?? []).flatMap(transitionsFromDreamHistorySession),
    ].sort((left, right) => String(right.changed_at ?? "").localeCompare(String(left.changed_at ?? "")) || left.artifact_id.localeCompare(right.artifact_id)),
  };
}
