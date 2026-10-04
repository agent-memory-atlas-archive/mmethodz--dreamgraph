# Registry

> This node is the master instance registry persistence layer in `src/instance/registry.ts`, responsible for managing the global `instances.json` index under the DreamGraph master directory rather than holding arbitrary configuration state. It exists so DreamGraph can discover, register, update, list, and remove UUID-scoped instances consistently across runs, while keeping DreamGraph-owned metadata separate from observed project files and resolving the master directory from `DREAMGRAPH_MASTER_DIR` or the user's home directory. The module works by loading or self-initializing the registry file, validating its schema version and structure, repairing BOM corruption when possible, and writing updates atomically under a shared file lock to avoid concurrent corruption. In the wider instance flow it is the lower-level persistence substrate beneath `instance_registry`, operates on contracts defined by `dreamgraph_src_instance` and `dreamgraph_src_instance_types`, and is used by lifecycle-oriented flows such as `instance_management` and the grounded `instance_registry_management` workflow.

**Table:** `registry`  
**Storage:** json  

## Fields

| Field | Type | Description |
|-------|------|-------------|
| instance_id | string | Unique identifier for the registered instance. |
| config | object | Configuration settings associated with the instance. |

