# Solidify Insight Candidate Classification

> This node is the strict advisory classification contract used by `solidify_cognitive_insight` before any speculative insight can become a durable graph mutation. The source defines a closed JSON schema with target type, source and target ids, evidence anchors, confidence, rationale, risks, required validation, ADR guard-rail review, and contradictions, while the tests show that duplicates, unknown ids, contradictions, and guard-rail bypass language are rejected. It exists to separate model suggestion from fact mutation: the tool may classify a possible durable target, but engine validation and fallback policy decide whether the result is accepted, surfaced as no-op/rejected, or handled deterministically.

**Table:** `N/A`  
**Storage:** N/A  

## Fields

| Field | Type | Description |
|-------|------|-------------|
| target_type | feature | workflow | data_model_relation | adr_candidate | noop | rejected | Validated advisory durable target classification. |
| source_ids | string[] | Existing graph ids grounding the candidate. |
| target_ids | string[] | Existing graph ids affected by relation candidates. |
| evidence_anchors | string[] | Repo-owned source anchors or existing graph ids cited as evidence. |
| confidence | number | Candidate confidence between 0 and 1. |
| risks | string[] | Risks surfaced before mutation. |
| required_validation | string[] | Validation work required before durable fact promotion. |
| adr_guard_rail_review | string[] | Accepted ADR guard-rail review evidence. |
| contradictions | string[] | Contradictions that force rejection when present. |
| planning_metadata | object | Route layer, provider/model provenance, token counters, validation errors, and fallback reason. |

## Relationships

| Target | Type | Description |
|--------|------|-------------|
| feature_adaptive_future_engine | produced_by | - |
| workflow_adaptive_future_engine_slice_rollout | used_by | - |

