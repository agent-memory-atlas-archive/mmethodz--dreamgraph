# Cognitive

> This node represents the cognitive source surface centered here on the dreamer/LLM portion of DreamGraph, where REM-phase speculation is routed and bounded rather than written directly into the fact graph. The `dreamer.ts` evidence shows this area owns the public `dream()` orchestration entrypoint, adaptive strategy selection, per-strategy yield tracking, focus-scoped fact snapshots, and persistence of speculative output through the cognitive engine into `dream_graph.json` only. It exists to let DreamGraph generate hypotheses from a portfolio of strategies while preserving safety boundaries: the fact graph is read-only during dreaming, user-facing output is forbidden, and execution is constrained by engine REM state and configurable skip/probe heuristics. In the wider neighborhood it composes `dreamer`, depends on `cognitive_engine` for state and persistence boundaries, works with `dreamgraph_src_cognitive_strategies` as its strategy portfolio, and sits adjacent to LLM configuration concerns represented by `llm_config` and `cognitive_llm`.

**Table:** `dreamgraph_src_cognitive`  
**Storage:** unknown  

