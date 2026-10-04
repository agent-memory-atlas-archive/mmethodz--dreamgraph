# Tool Trace Payload

> This node represents the concrete payload instance or message shape used to carry summarized tool execution details such as tool name, argument summary, affected files, duration, and status. In the surrounding neighborhood it is best understood as the serialized or UI-ready form of the broader `tool_trace_protocol`, feeding chat and webview trace surfaces rather than a persistence model by itself. It exists so execution evidence can be attached to conversational or diagnostic outputs in a compact, user-consumable structure, with especially strong alignment to the `ToolTraceEntry` shape described by `dreamgraph_extensions_vscode_src_chat_panel` and to richer wrappers like `webview_trace_contract`. Because no direct source excerpt is supplied for this node, the distinction between payload and protocol is inferred from neighboring contract nodes and should be treated as moderately confident.

**Table:** `N/A`  
**Storage:** N/A  

