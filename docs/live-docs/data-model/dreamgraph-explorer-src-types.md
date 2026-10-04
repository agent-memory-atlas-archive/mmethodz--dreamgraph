# Types

> This node defines the Explorer client's wire contracts for graph snapshots, node/edge records, search and stats responses, and trust/tension views that mirror the daemon's snapshot envelope. It exists to keep the browser-side explorer in lockstep with server-side graph serialization, including versioned snapshots, typed node categories, edge kinds, and cognitive trust descriptors for active or resolved tensions. The file shows that Explorer is not inventing its own graph semantics; instead it projects daemon-produced graph state into stable transport shapes for visualization and querying. That makes it a consumer-facing companion to the core graph schema in `dreamgraph_src_types`, while also bridging instance-scoped snapshot identity and cognitive trust state into the UI layer.

**Table:** `N/A`  
**Storage:** N/A  

