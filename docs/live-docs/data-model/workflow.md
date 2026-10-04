# Workflow

> This node is the shared graph contract for workflow entities in DreamGraph, defined in the same `src/types/index.ts` schema layer that also shapes features, data models, links, lifecycle state, and enrichment metadata. It exists so concrete processes such as cognitive flows and other orchestrated system behaviors can be stored, linked, queried, and enriched consistently instead of each workflow inventing its own record format. Within the graph it depends on the broader `data_model` feature for structural semantics, is defined by `dreamgraph_src_types`, and is one of the node categories projected into consumer-facing transport types by `dreamgraph_explorer_src_types`. Scanner-side extraction contracts in `dreamgraph_src_scanner_types` also name workflow records as an emission target, showing that parser-discovered process entities are normalized into this shared workflow shape before downstream use.

**Table:** `workflow`  
**Storage:** json  

## Fields

| Field | Type | Description |
|-------|------|-------------|
| id | string | Unique identifier for the workflow. |
| name | string | Human-readable name of the workflow. |

