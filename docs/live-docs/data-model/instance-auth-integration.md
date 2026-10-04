# Instance Authentication Integration

> This node has one strong grounded anchor in the supplied auth helper evidence and a broader neighborhood of instance-auth, audit, protocol, and orchestration concepts. It is best understood as the integration model that ties instance header validation, active-scope resolution, legacy-mode handling, and downstream audit/security consumers into one reusable authentication concern. In practice, that integration is exemplified by `requireInstanceAuth(req, res)` in `src/explorer/auth.ts`, which reads `X-DreamGraph-Instance`, compares it to the active scope, and returns actor context for protected mutation flows, linking this node to `instance_auth_module`, `instance_scoping`, `audit_log`, and `security_audit_gateway`.

**Table:** `N/A`  
**Storage:** N/A  

