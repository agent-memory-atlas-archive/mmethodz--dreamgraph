# Instance Scope

> The supplied evidence supports `instance_scope` as the cross-cutting abstraction that determines whether DreamGraph is operating in instance mode and, when active, binds runtime behavior to a specific instance boundary. The strongest grounded evidence comes from `src/instance/policies.ts`, which imports `getActiveScope` and `isInstanceMode` from lifecycle code and changes policy resolution based on whether an active `InstanceScope` exists, showing that scope is not just a test concept but a runtime selector for per-instance configuration. Neighbor cache further indicates the instance subsystem exposes `InstanceScope` and related lifecycle/scope APIs through the public `instance` barrel, and that per-instance files, registries, and config paths are modeled as UUID-isolated contracts. Taken together, this node represents the isolation and resolution context that ties policy loading, instance identity, and scoped data/config directories into one boundary mechanism across runtime and testing concerns.

**Table:** `N/A`  
**Storage:** N/A  

