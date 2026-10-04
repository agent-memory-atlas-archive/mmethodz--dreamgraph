# Graph Context Contract

> This node represents the shared payload contract implied by the REST API's graph-context and validation endpoints, covering requests for graph-side enrichment plus related validation results and optional inclusion of API, UI, or ADR-derived facts. Its purpose is to give extension-facing clients a stable schema for asking the daemon to assemble graph reasoning context while preserving the documented boundary that the extension owns editor context and the daemon returns graph facts. In the neighborhood it sits between `api_surface` and broader client-boundary abstractions such as `client_facing_data_contract` and `extension_daemon_boundary`, and it likely feeds orchestration around graph context assembly rather than storing graph data itself. Evidence is partly indirect because this node is inferred from neighboring contract models and the route inventory rather than a directly excerpted type definition here.

**Table:** `N/A`<br>
**Storage:** N/A<br>
