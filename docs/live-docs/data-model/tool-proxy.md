# Tool Proxy

> This node represents the discipline-side enforcement proxy that stands between a requested tool call and actual execution, rather than a generic transport wrapper. In the surrounding discipline runtime, it uses the shared discipline type system and active session/phase context to decide whether a tool invocation is allowed based on classification, phase permissions, file-write protection, and plan-entry requirements. It exists so tool use becomes auditable and mechanically governed inside DreamGraph's disciplined change model, working closely with `dreamgraph_src_discipline`, `state_machine`, `session_management`, and the schema contracts in `dreamgraph_src_discipline_types`. That makes it a key integration point between governed execution policy and the broader tool/plugin surfaces represented by `discipline_tools` and `plugin_tools`.

**Table:** `tool_proxy`  
**Storage:** memory  

## Fields

| Field | Type | Description |
|-------|------|-------------|
| id | string | Unique identifier for the tool proxy. |
| tool_id | string | Identifier for the tool being proxied. |
| status | string | Current status of the tool proxy. |

