# Archetypes

> This node defines the SDK seam for archetype providers, a plugin-facing contract that lets a plugin register either an inline archetype bundle or a lazy `fetch()` function returning the current bundle. It exists to let the host pull archetype data through existing federation flows without embedding polling or provider-specific transport logic into the seam itself. The contract includes individual archetype records, bundle metadata such as source and version, and provider registration metadata like stable ids, optional URLs, and polling hints. That makes it part of the shipped plugin SDK surface and adjacent to host/plugin integration features such as `feature_plugin_sdk`, `feature_architect_plugin_tabs`, and the broader SDK package `dreamgraph_packages_sdk`.

**Table:** `dreamgraph_packages_sdk_src_seams_archetypes`  
**Storage:** unknown  

