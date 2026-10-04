# Utils

> This node is the CLI-side utility layer that lets DreamGraph commands manage daemon lifecycle state and make one-shot MCP calls into an already running daemon. In `daemon.ts` it defines the `ServerMeta` runtime contract and the file/process helpers around `runtime/server.json`, `runtime/server.lock`, and `logs/server.log`, including atomic metadata writes and an advisory start lock with stale-lock recovery so `dg start/stop/restart/status` can coordinate safely. In `mcp-call.ts` it provides a Streamable HTTP MCP client that connects to `http://127.0.0.1:${port}/mcp`, invokes a single tool such as scan or schedule with timeout-resetting progress callbacks, lists available tools, and always closes the client connection afterward. Together these utilities connect CLI command flows to instance-scoped daemon state, server-side tool execution, and cross-cutting concerns such as atomic file handling and runtime observability.

**Table:** `dreamgraph_src_cli_utils`  
**Storage:** unknown  

