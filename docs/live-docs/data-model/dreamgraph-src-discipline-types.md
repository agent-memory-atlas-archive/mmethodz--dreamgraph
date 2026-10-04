# Types

> This node defines the type system for DreamGraph's disciplinary execution model: the five ordered phases, tool classes and protection levels, phase permissions, data protection tiers, and the manifest schema that wrappers use to enforce behavior. It exists to turn discipline from prose policy into machine-readable contracts that can classify tools, restrict writes, require audit trails, and serialize the rules that govern phase transitions and mandatory tool usage. The file makes clear that wrappers read the generated `discipline://manifest` resource on startup to build phase-to-tool maps, enforce data protection, and manage the state machine. That makes it the schema foundation beneath runtime nodes such as `dreamgraph_src_discipline`, `discipline_tools`, `state_machine`, and the governance capability `capability_disciplined_change_governance`.

**Table:** `N/A`  
**Storage:** N/A  

