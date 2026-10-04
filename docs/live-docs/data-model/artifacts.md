# Artifacts

> This node represents the discipline artifact generation and attachment model centered in `src/discipline/artifacts.ts`, not a generic file inventory. Neighbor evidence shows it is responsible for producing structured disciplinary outputs, validating evidence-bearing entries, computing parity summaries, and attaching the resulting artifacts to the active session so work remains auditable and reviewable. Within the broader discipline runtime it operates as a core companion to `dreamgraph_src_discipline`, feeds the derived `discipline_artifact_workflow`, and depends on shared phase and artifact contracts from `dreamgraph_src_discipline_types` while participating in the same governed execution context used by `session_management` and `state_machine`. Its role is therefore to make discipline outputs explicit, structured, and session-bound rather than leaving audit evidence implicit in tool activity alone.

**Table:** `artifacts`  
**Storage:** file-system  

## Fields

| Field | Type | Description |
|-------|------|-------------|
| artifact_id | string | Unique identifier for the artifact. |
| location | string | File system path where the artifact is stored. |

