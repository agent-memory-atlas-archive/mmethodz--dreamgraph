# Instance Registry

> This node represents the instance-tracking registry model used by DreamGraph's instance subsystem to discover and manage isolated instances rather than a generic application registry. High-confidence instance type cache shows the underlying schema layer provides stable contracts for registry files such as `<masterDir>/instances.json`, while the public `instance` barrel exposes registry operations alongside lifecycle and policy APIs. It exists so instance management can create, load, register, and find UUID-scoped instances consistently, keeping DreamGraph-owned metadata separate from observed project files. In the neighborhood it works with `registry` as the lower-level registry structure, supports `instance_management` lifecycle flows, and sits adjacent to policy and cognitive configuration because instance records carry policy profile and related scope metadata.

**Table:** `instance_registry`  
**Storage:** json  

## Fields

| Field | Type | Description |
|-------|------|-------------|
| instance_id | string | Unique identifier for the instance. |
| status | string | Current status of the instance. |

