# Client-facing Data Contract

> This node represents the family of versioned payload shapes that DreamGraph exposes across client-visible boundaries, especially between extension or webview surfaces and daemon-owned graph reasoning. The supplied neighborhood shows that these contracts are not a single UI type but a cross-cutting layer spanning chat payloads, tool trace payloads, graph-context requests, snapshot compatibility, and extension-facing REST boundaries. It exists to keep externally consumed data stable and interpretable as information moves between `extension_daemon_boundary`, `extension_graph_contract`, `graph_context_contract`, and the various webview trace/chat protocol models. Evidence is indirect from neighboring modeled contracts rather than direct source excerpts for this node, so its semantics are best treated as an umbrella abstraction over those concrete contracts.

**Table:** `N/A`  
**Storage:** N/A  

