import { buildCognitiveLifecycleProjection } from "./lifecycle-visibility.js";
import { buildTensionClusters } from "./tension-clustering.js";
import { emptyTrustStateDistribution, addTrustStateCount, trustStateFromDreamStatus, type TrustStateDistribution } from "./trust-state.js";
import type { CandidateEdgesFile, DreamGraphFile, DreamHistoryFile, TensionFile, ValidatedEdgesFile } from "./types.js";

export interface CognitiveCalibrationEvaluation {
  generated_at: string;
  labeled_accuracy: ReturnType<typeof evaluateLabeledNormalization> | null;
  assessment_basis: "current_canonical" | "recorded_only";
  history: { normalization_results: number; promotions: number; expired_events:number;decayed_events:number };
  snapshot: {revision:import("../graph/read-model.js").CanonicalGraphRead["revision"]|null;currency:import("../graph/read-model.js").CanonicalGraphRead["currency"]|null;state:import("../graph/read-model.js").CanonicalGraphRead["state"]|null};
  metrics: {
    trust_state_distribution: TrustStateDistribution;
    evidence_completeness: {
      candidates_with_evidence: number;
      candidates_total: number;
      promoted_edges_with_evidence: number;
      promoted_edges_total: number;
    };
    stale_expired_artifact_rate: number|null;
    uncertainty_labeling: {
      latent_candidates: number;
      rejected_candidates: number;
      unresolved_tensions: number;
    };
    lifecycle_transition_explainability: {
      explained_transitions: number;
      transitions_total: number;
    };
    operator_review_outcomes: {
      human_reviewed_tensions: number;
      system_reviewed_tensions: number;
      superseded_futures: number;
    };
    speculative_reviewability: {
      latent_candidates_reviewable: number;
      rejected_candidates_reviewable: number;
    };
  };
  interpretation: string;
}

function ratio(numerator: number, denominator: number): number|null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 1000;
}

export function buildCalibrationEvaluation(input: {
  candidates: CandidateEdgesFile;
  validated: ValidatedEdgesFile;
  tensions: TensionFile;
  dreamGraph: DreamGraphFile;
  history: DreamHistoryFile;
  generatedAt?: string;
  reviewedLabels?: Parameters<typeof evaluateLabeledNormalization>[0];
  currentGraph?: import("../graph/read-model.js").CanonicalGraphRead;
}): CognitiveCalibrationEvaluation {
  const distribution = emptyTrustStateDistribution();
  const latest = input.currentGraph?input.currentGraph.entities.filter(e=>e.identity.kind==="candidate"&&e.payload.dream_type).map(e=>({...e.payload,evidence_assessment:e.payload.current_evidence_assessment} as unknown as CandidateEdgesFile["results"][number])):[...new Map([...input.candidates.results].sort((a,b)=>a.normalization_cycle-b.normalization_cycle).map(r => [`${r.dream_type}:${r.dream_id}`, r])).values()];
  for (const result of latest) {
    // Historical validation labels never imply current applicability.
    addTrustStateCount(distribution, result.evidence_assessment?.state === "disputed" ? "disputed_claim" : trustStateFromDreamStatus(result.status === "validated" ? "latent" : result.status));
  }
  const currentValidated = input.currentGraph?.relationships.filter(r => r.kind === "validated" && r.assertion_class === "validated_insight") ?? [];
  addTrustStateCount(distribution, "validated_insight", currentValidated.length);
  addTrustStateCount(distribution, "latent_speculative_link", input.dreamGraph.edges.filter((edge) => edge.status === "latent").length);
  addTrustStateCount(distribution, "expired_artifact", [...input.dreamGraph.edges,...input.dreamGraph.nodes].filter(row=>row.status==="expired").length);
  addTrustStateCount(distribution, "human_reviewed_decision", input.tensions.resolved_tensions.filter((entry) => entry.resolved_by === "human").length);

  const clusters = buildTensionClusters(input.tensions.signals);
  const lifecycle = buildCognitiveLifecycleProjection({ resolvedTensions: input.tensions.resolved_tensions, dreamHistory: input.history.sessions });
  const explainedTransitions = lifecycle.transitions.filter((transition) => transition.triggering_evidence.length > 0 && transition.source.length > 0).length;
  const candidateEvidence = latest.filter(result => (result.evidence_assessment?.independent_roots.length ?? 0) > 0).length;
  const promotedEvidence = currentValidated.length;
  const expiredCount = distribution.expired_artifact;
  const totalArtifacts = latest.length + input.validated.edges.length + input.dreamGraph.edges.length + input.dreamGraph.nodes.length;

  return {
    generated_at: input.generatedAt ?? new Date().toISOString(),
    labeled_accuracy: input.reviewedLabels ? evaluateLabeledNormalization(input.reviewedLabels) : null,
    assessment_basis: input.currentGraph ? "current_canonical" : "recorded_only",
    snapshot:{revision:input.currentGraph?.revision??null,currency:input.currentGraph?.currency??null,state:input.currentGraph?.state??null},
    history: { normalization_results: input.candidates.results.length, promotions: input.validated.edges.length,expired_events:input.history.sessions.reduce((sum,s)=>sum+s.tensions_expired,0),decayed_events:input.history.sessions.reduce((sum,s)=>sum+s.decayed_edges+s.decayed_nodes,0) },
    metrics: {
      trust_state_distribution: distribution,
      evidence_completeness: {
        candidates_with_evidence: candidateEvidence,
        candidates_total: latest.length,
        promoted_edges_with_evidence: promotedEvidence,
        promoted_edges_total: input.validated.edges.length,
      },
      stale_expired_artifact_rate: ratio(expiredCount, totalArtifacts),
      uncertainty_labeling: {
        latent_candidates: latest.filter((result) => result.status === "latent").length,
        rejected_candidates: latest.filter((result) => result.status === "rejected").length,
        unresolved_tensions: input.tensions.signals.filter((signal) => !signal.resolved).length,
      },
      lifecycle_transition_explainability: {
        explained_transitions: explainedTransitions,
        transitions_total: lifecycle.transitions.length,
      },
      operator_review_outcomes: {
        human_reviewed_tensions: input.tensions.resolved_tensions.filter((entry) => entry.resolved_by === "human").length,
        system_reviewed_tensions: input.tensions.resolved_tensions.filter((entry) => entry.resolved_by === "system").length,
        superseded_futures: 0,
      },
      speculative_reviewability: {
        latent_candidates_reviewable: distribution.latent_speculative_link,
        rejected_candidates_reviewable: distribution.rejected_link,
      },
    },
    interpretation: clusters.some((cluster) => cluster.inspectable_noise)
      ? "Calibration preserves inspectable uncertainty while separating actionable tension clusters from noise categories."
      : "Calibration currently has little recorded noise pressure; uncertainty remains visible through trust-state distribution.",
  };
}

/** Accuracy requires independent reviewed labels. Promotion volume is never the oracle. */
export function evaluateLabeledNormalization(input: {
  review_id: string; cases: Array<{ id: string; supported: boolean; promoted: boolean; confidence: number }>;
}) {
  if (!input.review_id || !input.cases.length || input.cases.length > 10000) throw new Error("CALIBRATION_REVIEWED_LABELS_REQUIRED");
  const ids = new Set<string>();
  let tp = 0, fp = 0, fn = 0, tn = 0, squaredError = 0;
  const bins = Array.from({ length: 10 }, (_, i) => ({ lower: i / 10, upper: (i + 1) / 10, count: 0, confidence_sum: 0, supported: 0 }));
  for (const row of input.cases) {
    if (!row.id || ids.has(row.id) || typeof row.supported !== "boolean" || typeof row.promoted !== "boolean" || !Number.isFinite(row.confidence) || row.confidence < 0 || row.confidence > 1) throw new Error("CALIBRATION_LABEL_INVALID");
    ids.add(row.id);
    if (row.promoted && row.supported) tp++; else if (row.promoted) fp++; else if (row.supported) fn++; else tn++;
    squaredError += (row.confidence - Number(row.supported)) ** 2;
    const bin = bins[Math.min(9, Math.floor(row.confidence * 10))]; bin.count++; bin.confidence_sum += row.confidence; bin.supported += Number(row.supported);
  }
  return { review_id: input.review_id, labeled_cases: input.cases.length, confusion: { tp, fp, fn, tn },
    precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null,
    brier_score: squaredError / input.cases.length,
    bins: bins.map(bin => ({ lower: bin.lower, upper: bin.upper, count: bin.count,
      mean_confidence: bin.count ? bin.confidence_sum / bin.count : null, supported_fraction: bin.count ? bin.supported / bin.count : null })) };
}
