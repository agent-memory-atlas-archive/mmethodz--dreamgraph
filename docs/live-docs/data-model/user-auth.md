# User Authentication

> This node is best evidenced as the instance-auth result object used by Explorer request guards rather than a general user account record. In `src/explorer/auth.ts`, `requireInstanceAuth(req, res)` validates the `X-DreamGraph-Instance` header against the active scope from `getActiveScope()` and returns an `AuthSuccess` object carrying `actor_uuid` and `legacy` when the request is allowed. That object feeds mutation authorization and audit attribution for Explorer write paths, including legacy-mode fallback where calls are allowed but tagged as `"legacy"`, so this node participates in the Explorer security and audit flow alongside `dreamgraph_src_explorer`, `instance_scoping`, and `audit_log`.

**Table:** `user_auth`  
**Storage:** json  

## Fields

| Field | Type | Description |
|-------|------|-------------|
| user_id | string | Unique identifier for the user. |
| roles | array | Roles assigned to the user. |

