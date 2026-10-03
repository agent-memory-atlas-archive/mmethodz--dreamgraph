import { buildCandidateEvidenceLedger, buildValidatedEdgeEvidenceLedger, type EvidenceLedger } from "./evidence-ledger.js";
import { describeCognitiveTrustState, trustStateFromDreamStatus, type CognitiveTrustDescriptor } from "./trust-state.js";
import type {
  CandidateEdgesFile,
  DreamGraphFile,
  DreamHistoryEntry,
  DreamHistoryFile,
  TensionFile,
  ValidatedEdgesFile,
  ValidationResult,
} from "./types.js";

export type DreamPlaybackRejectionReason =
  | "duplicate_edge"
  | "insufficient_evidence"
  | "unknown_entity"
  | "adr_conflict"
  | "lifecycle_mismatch"
  | "expired_speculation"
  | "other";

export interface DreamPlaybackFrame {
  stage: "seed" | "hypotheses" | "validation" | "promotions_rejections" | "tensions_story_delta";
  label: string;
  summary: string;
  count: number;
}

export interface DreamPlayback {
  projection?: import("./projection-context.js").CognitiveProjectionContext;
  interpretation:"historical_projection";
  source: "existing_cognitive_store_projection";
  cycle_id: string | null;
  cycle_number: number | null;
  timestamp: string | null;
  strategy: string | null;
  frames: DreamPlaybackFrame[];
  rejected_by_reason: Record<DreamPlaybackRejectionReason, number>;
  hypothesis_trust: Array<{ id: string; status: string; trust: CognitiveTrustDescriptor; evidence_ledger: EvidenceLedger }>;
  promoted_edges: Array<{ id: string; from: string; to: string; relation: string; confidence: number; trust: CognitiveTrustDescriptor; evidence_ledger: EvidenceLedger }>;
  tension_ids: string[];
  before_understanding: string;
  after_understanding: string;
}

function rejectionReason(result: ValidationResult): DreamPlaybackRejectionReason {
  const text = `${result.reason_code} ${result.reason}`.toLowerCase();
  if (/duplicate|already exists/.test(text)) return "duplicate_edge";
  if (/evidence|confidence|promotion gate|ground/.test(text)) return "insufficient_evidence";
  if (/unknown|missing entit|not found/.test(text)) return "unknown_entity";
  if (/adr|decision|guard rail|conflict/.test(text)) return "adr_conflict";
  if (/lifecycle|state mismatch|phase mismatch/.test(text)) return "lifecycle_mismatch";
  if (/expired|decay|ttl/.test(text)) return "expired_speculation";
  return "other";
}

function emptyRejections(): Record<DreamPlaybackRejectionReason, number> {
  return {
    duplicate_edge: 0,
    insufficient_evidence: 0,
    unknown_entity: 0,
    adr_conflict: 0,
    lifecycle_mismatch: 0,
    expired_speculation: 0,
    other: 0,
  };
}

export function buildDreamPlayback(input: {
  history: DreamHistoryFile;
  dreamGraph: DreamGraphFile;
  candidates: CandidateEdgesFile;
  validated: ValidatedEdgesFile;
  tensions: TensionFile;
  cycleNumber?: number;
  currentGraph?: import("../graph/read-model.js").CanonicalGraphRead;
  projection?: import("./projection-context.js").CognitiveProjectionContext;
}): DreamPlayback {
  const sessions = [...input.history.sessions].sort((left, right) => right.cycle_number - left.cycle_number || right.timestamp.localeCompare(left.timestamp));
  const session: DreamHistoryEntry | undefined = input.cycleNumber == null
    ? sessions[0]
    : sessions.find((candidate) => candidate.cycle_number === input.cycleNumber);

  if (!session) {
    return {
      source: "existing_cognitive_store_projection",
      interpretation:"historical_projection",projection:input.projection,
      cycle_id: null,
      cycle_number: null,
      timestamp: null,
      strategy: null,
      frames: [],
      rejected_by_reason: emptyRejections(),
      hypothesis_trust: [],
      promoted_edges: [],
      tension_ids: [],
      before_understanding: "No recorded dream cycle is available.",
      after_understanding: "No cognitive delta can be projected yet.",
    };
  }

  const candidates = input.candidates.results.filter((result) => result.normalization_cycle === session.cycle_number);
  const rejected = candidates.filter((result) => result.status === "rejected");
  const rejectedByReason = emptyRejections();
  for (const result of rejected) rejectedByReason[rejectionReason(result)] += 1;

  const hypothesisTrust = candidates.map((result) => {
    const current=input.currentGraph?.entities.find(e=>e.identity.kind==="candidate"&&e.payload.dream_id===result.dream_id&&e.payload.dream_type===result.dream_type);
    const trust = describeCognitiveTrustState(current?.assertion_class==="validated_insight"?"validated_insight":result.status==="validated"?"advisory_candidate":trustStateFromDreamStatus(result.status));
    return {
      id: result.dream_id,
      status: result.status,
      trust,
      evidence_ledger: buildCandidateEvidenceLedger({ result:{...result,...(current?{evidence_assessment:current.payload.current_evidence_assessment as ValidationResult["evidence_assessment"]}: {})}, trust }),
    };
  });
  const promotedEdges = input.validated.edges
    .filter((edge) => edge.normalization_cycle === session.cycle_number)
    .map((edge) => {
      const current=input.currentGraph?.entities.find(e=>e.identity.kind==="validated"&&e.identity.id===edge.id);
      const trust = describeCognitiveTrustState(current?.assertion_class==="validated_insight"?"validated_insight":current?.assertion_class==="human_assertion"?"human_assertion":"advisory_candidate");
      return {
        id: edge.id,
        from: edge.from,
        to: edge.to,
        relation: edge.relation,
        confidence: edge.confidence,
        trust,
        evidence_ledger: buildValidatedEdgeEvidenceLedger({ edge:{...edge,...(current?{evidence_assessment:current.payload.current_evidence_assessment as typeof edge.evidence_assessment}: {})}, trust }),
      };
    });
  const tensionIds = input.tensions.signals
    .filter((tension) => tension.first_seen === session.timestamp || tension.last_seen === session.timestamp)
    .map((tension) => tension.id)
    .sort();
  const generated = session.generated_edges + session.generated_nodes;
  const normalization = session.normalization;

  return {
    source: "existing_cognitive_store_projection",
    interpretation:"historical_projection",projection:input.projection,
    cycle_id: session.session_id,
    cycle_number: session.cycle_number,
    timestamp: session.timestamp,
    strategy: session.strategy,
    frames: [
      { stage: "seed", label: "Seed", summary: `Strategy ${session.strategy} started from the existing cognitive store.`, count: 1 },
      { stage: "hypotheses", label: "Hypotheses", summary: `${generated} artifacts generated; ${session.duplicates_merged} duplicate observations (not independent support).`, count: generated },
      { stage: "validation", label: "Validation", summary: `${normalization?.validated ?? 0} validated, ${normalization?.latent ?? 0} latent, ${normalization?.rejected ?? 0} rejected.`, count: candidates.length },
      { stage: "promotions_rejections", label: "Promotions and rejections", summary: `${promotedEdges.length} promoted edges and ${rejected.length} grouped rejections.`, count: promotedEdges.length + rejected.length },
      { stage: "tensions_story_delta", label: "Tensions and story delta", summary: `${session.tension_signals_created} tensions created; ${session.tension_signals_resolved} resolved; ${session.tensions_expired} expired.`, count: session.tension_signals_created + session.tension_signals_resolved + session.tensions_expired },
    ],
    rejected_by_reason: rejectedByReason,
    hypothesis_trust: hypothesisTrust,
    promoted_edges: promotedEdges,
    tension_ids: tensionIds,
    before_understanding: `The exact pre-cycle graph is unavailable without its immutable snapshot; current counts cannot reconstruct it.`,
    after_understanding: `After cycle ${session.cycle_number}, ${promotedEdges.length} edges were promoted and ${rejected.length} hypotheses were rejected.`,
  };
}
