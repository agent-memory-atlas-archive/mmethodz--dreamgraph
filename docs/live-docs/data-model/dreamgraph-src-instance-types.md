# Types

> This module is the authoritative type contract for DreamGraph instance identity, registry membership, project binding, policy profiles, and per-instance MCP configuration. It exists to keep instance-scoped state explicit and UUID-isolated so other subsystems can distinguish DreamGraph-owned metadata from the observed project and safely locate files such as instance manifests, registries, and config records. In the wider graph it underpins instance lifecycle flows like `instance_management` and related models such as `instance`, `registry`, and `instance_registry`, and it also supplies the instance-scope metadata reused by capabilities like `standalone-architect-instance-config-binding`.

**Table:** `N/A`  
**Storage:** N/A  

