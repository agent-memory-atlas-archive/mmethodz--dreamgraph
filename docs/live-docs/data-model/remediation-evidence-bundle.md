# Remediation Evidence Bundle

> This node is the evidence contract that scopes what remediation drafting and future-fit ranking are allowed to use when `cognitive_intervention` generates candidate plans. The test evidence shows bundles carrying graph entities, source anchors, ADR guard rails, allowed action classes, deterministic short-circuit metadata, and verification obligations, and the intervention module imports the same contract to validate and score candidate futures. It exists to keep Adaptive Future Engine remediation advisory behavior evidence-bounded: only known anchors may be cited, verification paths must be grounded, and learning or future-signal harvesting stays constrained to the supplied bundle rather than arbitrary repo context.

**Table:** `N/A`  
**Storage:** typescript:src/cognitive/types.ts  

## Fields

| Field | Type | Description |
|-------|------|-------------|
| evidence_anchors | EvidenceAnchor[] | Allowed anchor set for candidate validation and scoped learning-hook admission. |
| learning_hooks | LearningHook[] | undefined | Optional accepted, edited, rejected, overridden, reverted, explicit preference, recurring pattern, and drift evidence used for future-fit scoring after hard validation. |
| verification_obligations | VerificationStep[] | Required verification obligations carried from evidence bundle to candidate validation and deterministic fallback outcomes. |

## Relationships

| Target | Type | Description |
|--------|------|-------------|
| remediation_log_adaptive_future_sidecar | feeds | - |
| feature_adaptive_future_engine | supports | - |

