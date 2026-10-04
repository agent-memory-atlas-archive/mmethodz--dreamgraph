# Feature

> This node is the shared graph contract for DreamGraph feature entities: records that represent named product or system capabilities and carry the common metadata, links, and enrichment fields defined in `src/types/index.ts`. It exists so concrete features such as `data_model`, `data_enrichment`, `heatmap_feature`, and `data_store` can all be stored and related in one consistent schema rather than each inventing their own shape. Through the same core types layer as `workflow` and other entity categories, a feature can participate in graph links, semantic enrichment, and downstream projections like `dreamgraph_explorer_src_types`. The nearby configuration evidence also shows that feature records are expected to be consumed by runtime and startup paths alongside broader application configuration, not just by static documentation tooling.

**Table:** `feature`  
**Storage:** json  

## Fields

| Field | Type | Description |
|-------|------|-------------|
| id | string | Unique identifier for the feature. |
| name | string | Human-readable name of the feature. |

