# Instance Authentication Context

> This node is strongly grounded by `src/explorer/auth.ts`, where the authenticated result of instance validation is explicitly modeled as `AuthSuccess` with `actor_uuid` and `legacy`. `requireInstanceAuth(req, res)` constructs that context from the `X-DreamGraph-Instance` header and the active scope returned by `getActiveScope()`, returning either the active instance UUID, a legacy fallback actor, or `null` after writing a 401/403 response. The node therefore represents the reusable authenticated instance context passed into protected Explorer mutation flows and audit attribution, closely matching neighboring concepts such as `instance_auth_actor_context`, `authentication_context_resolution`, `instance_scoping`, and `api_route_security_layer`.

**Table:** `N/A`  
**Storage:** N/A  

