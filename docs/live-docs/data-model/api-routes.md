# API Routes

> This node represents the concrete REST route contract implemented in `src/api/routes.ts` that exposes DreamGraph's extension-facing HTTP endpoints, including instance identity/state, graph-context enrichment, validation, and orchestration capability negotiation. It exists to give external clients a stable set of daemon-owned operations while preserving the documented boundary that editor context stays with the extension and the daemon returns graph facts and operational reasoning only. In operation it sits as the route-definition layer beneath `api_surface`, relies on `rest_api_route_handler` behavior such as JSON parsing and JSON/error responses, and includes specialized handling aligned with `api_instance_route_handler` for the `/api/instance` endpoint. The route set also participates in request/response workflows used by `user_interactions` and depends on validated load-time data access patterns reflected by `data_loading_process` for some responses.

**Table:** `api_routes`  
**Storage:** memory  

