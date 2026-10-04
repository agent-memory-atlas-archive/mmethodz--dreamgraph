# Schema Grounding

> This node represents a persistence-aware cognitive strategy that grounds graph entities against scanned datastore schema evidence rather than free speculation. The strategy only runs when datastore table evidence exists, then proposes `stored_in` edges from `data_model` entities to matching datastores, proposes `shares_state_with` links between higher-level entities in different repos that resolve to the same datastore, and raises `missing_link` tensions for scanned tables with no corresponding data model. It exists to convert live database scan evidence into graph structure while preserving an important boundary: data models do not inherently require persistence, so lack of a table match is not treated as a defect. Within the cognitive subsystem it is a concrete strategy under `dreamgraph_src_cognitive_strategies`, and it depends on the broader cognitive lifecycle/decay concepts defined in `dreamgraph_src_cognitive_types`.

**Table:** `dreamgraph_src_cognitive_strategies_schema_grounding`  
**Storage:** unknown  

