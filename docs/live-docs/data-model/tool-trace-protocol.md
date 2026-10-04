# Tool Trace Protocol

> This node represents the client-facing contract for reporting tool execution traces to interactive surfaces, especially the VS Code webview/chat layer. Neighbor evidence shows that the concrete trace shape includes a tool name, summarized arguments, affected files, duration, completion status, and optional provenance, making it a reusable protocol rather than a one-off UI helper. It exists to carry operational tool activity across the extension or webview boundary in a stable, interpretable form, linking chat-visible diagnostics in `dreamgraph_extensions_vscode_src_chat_panel` with broader contract abstractions such as `client_facing_data_contract` and UI-facing trace models like `webview_trace_contract`. Evidence is indirect from neighboring enriched nodes rather than direct source excerpts for this node, so the semantics should be treated as a high-likelihood abstraction over those concrete contracts.

**Table:** `N/A`  
**Storage:** N/A  

