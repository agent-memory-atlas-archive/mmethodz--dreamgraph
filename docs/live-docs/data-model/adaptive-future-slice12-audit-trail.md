# Adaptive Future Slice 12 Audit Trail

> This node is the shared audit metadata scaffold for Adaptive Future Engine Slice 12, defining how candidate futures are normalized, scored, selected, rejected, and annotated across multiple task classes. The scaffold source defines task classes, anchor kinds, route and fallback enums, score factors, candidate audit records, and a builder that sorts candidates and marks the selected one, while `enrich_parser_nodes` and `solidify_cognitive_insight` both import it as graph-tool and cognitive-workflow consumers. It exists to make advisory future comparison compact, deterministic, and reusable across tools without turning the audit layer into an enforcement state machine, and it is directly tied to `feature_adaptive_future_engine` and the rollout workflow that introduced Slice 12.

**Table:** `N/A`  
**Storage:** N/A  

## Fields

| Field | Type | Description |
|-------|------|-------------|
| audit_version | unknown |  |
| task_class | unknown |  |
| selected_candidate_id | unknown |  |
| rejected_candidate_ids | unknown |  |
| candidates | unknown |  |
| score_factors | unknown |  |
| anchors | unknown |  |
| objections | unknown |  |
| validation_failures | unknown |  |
| route | unknown |  |
| fallback | unknown |  |
| notes | unknown |  |

## Relationships

| Target | Type | Description |
|--------|------|-------------|
| feature_adaptive_future_engine | references | - |
| workflow_adaptive_future_engine_slice_rollout | references | - |

