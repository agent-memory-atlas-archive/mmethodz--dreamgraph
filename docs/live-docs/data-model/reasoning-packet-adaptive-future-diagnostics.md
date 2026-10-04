# Reasoning Packet Adaptive Future Diagnostics

> This node represents structured VS Code Architect runtime diagnostics that expose bounded context and graph metadata for inspection instead of raw prompt storage. The `ContextInspector` logs an `EditorContextEnvelope` with intent confidence, active file and selection anchors, environment context, and graph context including related features, workflows, ADRs, UI patterns, active tensions, and cognitive state, which matches the role of a reasoning packet used for transparency and debugging. It exists to make Architect context assembly inspectable and auditable in the extension, and it sits adjacent to `feature_adaptive_future_engine` because the same bounded diagnostic style carries model-layer, evidence-anchor, and fallback-oriented metadata rather than free-form transcripts.

**Table:** `N/A`  
**Storage:** N/A  

## Fields

| Field | Type | Description |
|-------|------|-------------|
| taskPreamble.budgetDecision | unknown |  |
| taskPreamble.evidenceAnchors | unknown |  |
| taskPreamble.omittedContextReasons | unknown |  |
| taskPreamble.validationFailures | unknown |  |
| taskPreamble.selectedModelLayer | unknown |  |
| adaptiveFutureJudgment.state | unknown |  |
| adaptiveFutureJudgment.futureObjections | unknown |  |

## Relationships

| Target | Type | Description |
|--------|------|-------------|
| feature_adaptive_future_engine | belongs_to | - |
| workflow_adaptive_future_engine_slice_rollout | inspected_by | - |

