# Instance

> This node represents the instance architecture barrel that re-exports the primitives needed to create, discover, scope, configure, and bootstrap isolated DreamGraph instances. The `src/instance/index.ts` evidence shows it is not a single runtime object implementation; instead it exposes instance types, scope enforcement, registry operations, lifecycle functions, policy loading/switching, cognitive tuning access, and bootstrap helpers from the instance subsystem. It exists so other parts of the system can depend on one stable entrypoint for instance identity and lifecycle behavior, including per-instance policy and cognitive tuning resolution. In the neighborhood it directly supports `instance_management`, `instance_registry`, and `registry`, and it also connects instance state to cognitive behavior through `getActiveCognitiveTuning` and to standalone Architect through instance bootstrap/binding flows.

**Table:** `instance`  
**Storage:** memory  

## Fields

| Field | Type | Description |
|-------|------|-------------|
| id | string | Unique identifier for the instance. |
| status | string | Current status of the instance (active, inactive, etc.). |

