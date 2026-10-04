# Graph Enrichment Script

> `enrichment_script` represents the `scripts/enrich-graph.mjs` file that reads DreamGraph graph data files, adds semantic annotations, and writes the enriched results back. The source shows it loads `features.json`, `workflows.json`, and `data_model.json`, defines helper constructors for graph links and nested references, and then applies domain labels, keywords, and cross-links so the cognitive engine can build a FactSnapshot, dream speculative connections, normalize dreams, and detect tensions. It exists as the concrete file-backed mechanism behind the broader `graph_enrichment` and `graph_enrichment_process` workflows, and it operates within the `dreamgraph_scripts` script surface rather than as a generic abstract model. Its link helper also aligns it with richer edge concepts such as `enriched_cross_link` and `enrichment_cross_linker`, because the script explicitly constructs relationship objects with target, type, relationship, description, strength, and optional metadata.

**Table:** `enrichment_script`  
**Storage:** file-system  

## Fields

| Field | Type | Description |
|-------|------|-------------|
| script_name | string | The name of the enrichment script. |
| description | string | Description of the script's purpose and functionality. |

