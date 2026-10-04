# Graph Enrichment Metadata

> This node is the aggregate semantic annotation layer added during graph enrichment, covering the domains, keywords, cross-links, and optional link metadata written onto graph entities and their relationships. The strongest supplied evidence comes indirectly from `enrichment_script`, which states that enrichment adds domain labels, keywords, and cross-links to `features.json`, `workflows.json`, and `data_model.json`, and from `entity_link_cross_metadata`, which shows those links can carry richer metadata such as direction, API routes, tables, and related references. It exists to make the graph more useful for downstream reasoning rather than just storage, feeding processes like `fact_snapshot_assembly`, broader `graph_enrichment_process`, and cognitive consumers that operate on enriched graph structure. Because no direct source excerpt names a first-class `graph_enrichment_metadata` type, this record remains an evidence-bounded abstraction over the metadata produced by the enrichment pipeline.

**Table:** `N/A`  
**Storage:** N/A  

