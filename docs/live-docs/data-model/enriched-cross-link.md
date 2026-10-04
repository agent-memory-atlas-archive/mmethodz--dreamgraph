# Enriched Graph Cross-Link

> This node represents the structured relationship object produced during graph enrichment when entities are connected with explicit target, type, relationship, description, strength, and optional metadata. Reused cache evidence from `enrichment_script` shows that enrichment does not merely tag entities; it constructs link records through a helper that can also carry `meta`, while `entity_link_cross_metadata` explains that these links can encode richer semantics such as direction, API-route hints, table names, and related references. In the broader flow, these enriched links are created by the enrichment script, feed graph-wide enrichment processes, and provide the relationship substrate later used for fact snapshot assembly and downstream cognitive reasoning. Because no direct first-class type definition for `enriched_cross_link` is supplied, this node is best treated as the concrete enriched-edge concept evidenced by the script and neighboring link-metadata schema abstractions.

**Table:** `N/A`  
**Storage:** N/A  

