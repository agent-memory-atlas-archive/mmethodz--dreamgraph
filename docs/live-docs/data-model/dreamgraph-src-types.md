# Types

> This node is the shared graph schema layer for DreamGraph entities and enrichment metadata, defining the base resource shape, rich graph links, lifecycle status, and the additive semantic fields written by enrichment passes. It exists so features, workflows, data models, capabilities, datastores, and UI elements can all participate in a common typed graph with reusable cross-link metadata and backward-compatible enrichment fields. The file also makes explicit that parser-discovered entities start structurally complete but semantically thin, and that enrichment writes optional intent, purpose, confidence, and semantic-cache provenance back onto those entities. As a result it underpins higher-level nodes like `data_model`, `feature`, and `workflow`, and provides the contract that graph enrichment and explorer-facing consumers can rely on.

**Table:** `dreamgraph_src_types`  
**Storage:** unknown  

