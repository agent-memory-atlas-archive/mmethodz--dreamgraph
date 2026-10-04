# API Surface

> This node represents the extension-facing REST contract implemented in `src/api/routes.ts`, where DreamGraph exposes traditional HTTP endpoints rather than MCP tools. The source evidence names concrete routes for instance identity, graph-context enrichment, combined validation, and orchestration capability negotiation, so this surface exists to define what external HTTP clients can ask the daemon for and what boundary they cross. It participates in request handling by pairing route definitions with JSON parsing, JSON/error response helpers, load-time validation, and instance/engine/config access used by handlers such as the instance endpoint. In the neighborhood, it is the data contract described by `api_routes`, serves the extension/daemon seam captured by `extension_daemon_boundary`, and overlaps with `graph_context_contract` for the graph-context and validation payload shapes.

**Table:** `api_surface`  
**Storage:** json  

## Fields

| Field | Type | Description |
|-------|------|-------------|
| endpoint | string | The URL path for the API endpoint. |
| method | string | HTTP method used for the API endpoint (GET, POST, etc.). |

