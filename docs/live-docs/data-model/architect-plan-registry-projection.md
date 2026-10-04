# Architect Plan Registry Projection

> This node is the read-only projection layer that turns markdown implementation plans and append-only implementation logs into structured Architect records for daemon-served APIs. The `plan-registry.ts` source defines semantic anchors, slices, checkpoints, operational state, task-memory binding, evidence links, and summary/detail shapes, while the standalone migration plan states that plans are first-class working objects and that `/api/architect/v1` should project markdown plans into structured registry records and daemon-governed operational plan-state envelopes. It exists so `standalone-architect` can navigate, inspect, and resume plan execution through governed projections rather than raw markdown parsing in the browser, and it directly feeds `standalone-architect-api-v1`, plan lifecycle UI, and plan-bound chat flows.

**Table:** `N/A`  
**Storage:** markdown projection + implementation log projection  

## Fields

| Field | Type | Description |
|-------|------|-------------|
| id | unknown |  |
| title | unknown |  |
| sourcePath | unknown |  |
| adr_bindings | unknown |  |
| graph_bindings | unknown |  |
| slices | unknown |  |
| checkpoints | unknown |  |
| resume_state | unknown |  |
| operational_state | unknown |  |
| task_memory_binding | unknown |  |

## Relationships

| Target | Type | Description |
|--------|------|-------------|
| standalone-architect | references | - |
| standalone-architect-api-v1 | references | - |

