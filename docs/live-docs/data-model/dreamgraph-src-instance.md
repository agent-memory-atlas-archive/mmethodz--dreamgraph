# Instance

> This node is the canonical type contract for DreamGraph instance identity, registry, project binding, policy profiles, and per-instance MCP configuration. It exists to keep each instance UUID-isolated, explicitly separate DreamGraph's own state from the observed project, and provide stable schemas for files such as `<masterDir>/<uuid>/instance.json`, `<masterDir>/instances.json`, and per-instance policy/config files. The types show how an instance carries mode, policy profile, transport, lifecycle counters, and optional fork lineage, while the registry and project-binding structures support discovery and safe scoping across the rest of the system. That makes it foundational to `instance_management`, `registry`, `instance_registry`, and policy-related behavior reused by other subsystems such as standalone Architect instance binding.

**Table:** `dreamgraph_src_instance`  
**Storage:** unknown  

