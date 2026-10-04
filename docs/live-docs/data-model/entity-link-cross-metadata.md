# Entity Link Cross-Metadata

> This node represents the conceptual rich-edge metadata layer implied by DreamGraph's core graph schema, where links can carry directionality, API-route hints, table names, and `see_also` references in addition to simple source-target relationships. The strongest available evidence comes from `dreamgraph_src_types` and its alias `dreamgraph_src_types_index`, which define `LinkRef`, `LinkMeta`, and `GraphLink` as the concrete basis for cross-link semantics across graph entities. It exists to explain how enrichment and graph consumers can attach more meaning to edges than plain adjacency, but the evidence boundary does not show a separately shipped first-class model with this exact name. As a result, it is best treated as an abstraction derived from the shared types layer and closely overlapping the unresolved `cross_link_metadata` concept and enrichment-oriented link patterns such as `enrichment_cross_link` and `enriched_cross_link`.

**Table:** `N/A`  
**Storage:** N/A  

