# Discipline

> This node represents the discipline execution support layer that turns DreamGraph's phase-based governance model into concrete runtime behavior: it generates auditable artifacts such as delta tables and enforces tool permissions against the active session phase. The artifact generator validates evidence-bearing entries, computes parity summaries, and attaches structured outputs to the active session, while the tool proxy checks classification, phase permissions, file-write protection, and plan-entry requirements before allowing or blocking a call. Together these files exist to make disciplinary execution evidence-based and reviewable rather than relying on informal agent behavior. They therefore sit at the center of relations among `discipline_tools`, `session_management`, `state_machine`, and the higher-level governance capability `capability_disciplined_change_governance`.

**Table:** `dreamgraph_src_discipline`  
**Storage:** unknown  

