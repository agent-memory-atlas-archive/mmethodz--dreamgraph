# Utils

> This node represents DreamGraph's lightweight runtime instrumentation module in `src/utils/metrics.ts`, which maintains an in-memory metrics state for tool calls, REST requests, symbol lookups, file-read hotspots, and dream-cycle outcomes. It exists to give the system self-observability without external dependencies, while still allowing snapshots to be persisted to disk via `atomicWriteFile` and consumed by downstream readers such as the `ops://metrics` resource, the `query_runtime_metrics` tool, and metacognitive analysis. The module works by exposing focused recording functions like `recordToolCall`, `recordRestRequest`, `recordSymbolLookup`, `recordFileRead`, and `recordDreamOutcome`, all of which update singleton counters and timestamps that roll up into a `MetricsSnapshot`. In the broader graph it underpins `dreamgraph_src_observability`, realizes the cross-cutting `runtime_metrics_observability` and `rest_metrics_instrumentation` concerns, and is operationally reused by flows that analyze runtime behavior such as `runtime_metrics_analysis`.

**Table:** `dreamgraph_src_utils`  
**Storage:** unknown  

