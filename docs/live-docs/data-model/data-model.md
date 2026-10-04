# Data Model

> This node is the shared graph contract for DreamGraph data-model entities, defined by the core schema in `src/types/index.ts` and used as the structural foundation for features, workflows, links, and enrichment metadata. It exists so parser-discovered and tool-generated entities can be stored in one consistent graph shape, then progressively enriched with semantic fields such as intent, purpose, confidence, and provenance without breaking downstream consumers. In practice it is realized by `dreamgraph_src_types`, consumed by neighboring entity schemas like `feature` and `workflow`, and fed by scanner and tooling paths such as `dreamgraph_src_scanner_types`, `dreamgraph_src_tools_native_data_model`, and `dreamgraph_src_tools_sanitize_entity`. It also supports higher-level reasoning and persistence flows by giving modules like `cognitive_workflows`, `data_store`, and `dreamgraph_src_cognitive_strategies_schema_grounding` a stable entity structure to query, ground, and store.

**Table:** `data_model`  
**Storage:** json  

## Fields

| Field | Type | Description |
|-------|------|-------------|
| id | string | Unique identifier for the data model. |
| schema | object | Schema defining the structure of the data. |

