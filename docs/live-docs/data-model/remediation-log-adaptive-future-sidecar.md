# Remediation Log Adaptive Future Sidecar

> This node represents the bounded persistence sidecar that stores Adaptive Future Engine remediation metadata alongside intervention outputs without retaining raw prompts or secret-bearing diagnostics. In `src/cognitive/intervention.ts`, the intervention engine defines capped retention for future signals, future outcomes, and candidate runs, showing that this sidecar exists to keep remediation ranking evidence compact, durable, and auditable rather than becoming an unbounded transcript store. It participates directly in the `cognitive_intervention` flow by recording selected source/fallback behavior, validation failures, and future-signal references for remediation planning, and it is semantically tied to both `remediation_evidence_bundle` as upstream evidence input and `feature_adaptive_future_engine` as the advisory ranking layer whose metadata it preserves.

**Table:** `N/A`  
**Storage:** file-backed JSON/JSONL sidecar files  

## Fields

| Field | Type | Description |
|-------|------|-------------|
| MAX_REMEDIATION_FUTURE_SIGNALS | unknown |  |
| MAX_REMEDIATION_FUTURE_OUTCOMES | unknown |  |
| MAX_REMEDIATION_CANDIDATE_RUNS | unknown |  |
| selected_source | unknown |  |
| fallback_used | unknown |  |
| fallback_reason | unknown |  |
| future_fit_score | unknown |  |
| future_signal_ids | unknown |  |

## Relationships

| Target | Type | Description |
|--------|------|-------------|
| feature_adaptive_future_engine | references | - |
| workflow_adaptive_future_engine_slice_rollout | references | - |

