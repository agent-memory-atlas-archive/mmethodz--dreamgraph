export type CognitiveTrustState =
  | "source_assertion"
  | "human_assertion"
  | "disputed_claim"
  | "accepted_fact"
  | "validated_insight"
  | "advisory_candidate"
  | "latent_speculative_link"
  | "rejected_link"
  | "expired_artifact"
  | "human_reviewed_decision";

export interface CognitiveTrustDescriptor {
  state: CognitiveTrustState;
  label: string;
  authority: "source" | "daemon_validation" | "daemon_advisory" | "daemon_rejection" | "daemon_lifecycle" | "human_review";
  reviewable: boolean;
  implies_authority: boolean;
}

export type TrustStateDistribution = Record<CognitiveTrustState, number>;

export const TRUST_STATE_ORDER: readonly CognitiveTrustState[] = [
  "source_assertion", "human_assertion", "disputed_claim",
  "accepted_fact",
  "validated_insight",
  "advisory_candidate",
  "latent_speculative_link",
  "rejected_link",
  "expired_artifact",
  "human_reviewed_decision",
] as const;

const TRUST_DESCRIPTORS: Record<CognitiveTrustState, CognitiveTrustDescriptor> = {
  source_assertion: { state: "source_assertion", label: "Source-backed assertion", authority: "source", reviewable: true, implies_authority: false },
  human_assertion: { state: "human_assertion", label: "Human assertion", authority: "human_review", reviewable: true, implies_authority: false },
  disputed_claim: { state: "disputed_claim", label: "Disputed claim", authority: "daemon_validation", reviewable: true, implies_authority: false },
  accepted_fact: {
    state: "accepted_fact",
    label: "Accepted fact",
    authority: "source",
    reviewable: false,
    implies_authority: true,
  },
  validated_insight: {
    state: "validated_insight",
    label: "Validated insight",
    authority: "daemon_validation",
    reviewable: true,
    implies_authority: false,
  },
  advisory_candidate: {
    state: "advisory_candidate",
    label: "Advisory candidate",
    authority: "daemon_advisory",
    reviewable: true,
    implies_authority: false,
  },
  latent_speculative_link: {
    state: "latent_speculative_link",
    label: "Latent/speculative link",
    authority: "daemon_advisory",
    reviewable: true,
    implies_authority: false,
  },
  rejected_link: {
    state: "rejected_link",
    label: "Rejected link",
    authority: "daemon_rejection",
    reviewable: true,
    implies_authority: false,
  },
  expired_artifact: {
    state: "expired_artifact",
    label: "Expired artifact",
    authority: "daemon_lifecycle",
    reviewable: true,
    implies_authority: false,
  },
  human_reviewed_decision: {
    state: "human_reviewed_decision",
    label: "Human-reviewed decision",
    authority: "human_review",
    reviewable: true,
    implies_authority: true,
  },
};

export function emptyTrustStateDistribution(): TrustStateDistribution {
  return {
    source_assertion: 0, human_assertion: 0, disputed_claim: 0,
    accepted_fact: 0,
    validated_insight: 0,
    advisory_candidate: 0,
    latent_speculative_link: 0,
    rejected_link: 0,
    expired_artifact: 0,
    human_reviewed_decision: 0,
  };
}

export function describeCognitiveTrustState(state: CognitiveTrustState): CognitiveTrustDescriptor {
  return TRUST_DESCRIPTORS[state];
}

export function trustStateFromDreamStatus(status: string | null | undefined): CognitiveTrustState {
  switch (status) {
    case "validated":
      return "validated_insight";
    case "latent":
      return "latent_speculative_link";
    case "rejected":
      return "rejected_link";
    case "expired":
      return "expired_artifact";
    case "candidate":
    default:
      return "advisory_candidate";
  }
}

export function trustStateFromResolvedTension(): CognitiveTrustState {
  return "human_reviewed_decision";
}

export function addTrustStateCount(
  distribution: TrustStateDistribution,
  state: CognitiveTrustState,
  count = 1,
): TrustStateDistribution {
  distribution[state] += count;
  return distribution;
}
