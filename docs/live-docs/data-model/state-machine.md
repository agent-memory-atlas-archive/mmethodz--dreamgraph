# State Machine

> This node is the discipline-specific phase transition engine for DreamGraph's five-phase execution model, not a generic application state manager. The source defines the ordered phases `ingest → audit → plan → execute → verify`, encodes explicit transition rules with human-readable guard requirements, and only permits loopbacks from `verify` back to `plan` or `execute` when justified. It exists to make disciplined work auditable and mechanically enforceable by giving session and tool-governance code a single place to validate next-phase moves, enumerate allowed targets, and check phase-based tool permissions. In the broader discipline runtime it relies on phase definitions from `dreamgraph_src_discipline_types`, supports the enforcement behavior described by `dreamgraph_src_discipline`, and underpins governance/session-oriented neighbors such as `capability_disciplined_change_governance` and `session_workflow_manager`.

**Table:** `state_machine`  
**Storage:** memory  

## Fields

| Field | Type | Description |
|-------|------|-------------|
| current_state | string | The current state of the entity managed by the state machine. |
| transitions | array | List of possible transitions from the current state. |

