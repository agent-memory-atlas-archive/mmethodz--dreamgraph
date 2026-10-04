# Types

> This node is the core type contract for DreamGraph's cognitive dreaming system, defining cognitive states, dream strategies, normalization outcomes, speculative edge lifecycle, and the promotion/decay thresholds that govern memory retention. It exists to make the cognitive engine's behavior explicit and tunable: strategies can be enumerated centrally, dream artifacts can move through candidate/latent/validated/rejected/expired states, and promotion/retention thresholds can be configured consistently. The file also exposes default decay and promotion settings derived from environment variables, making it the shared policy surface for runtime components such as strategy execution, normalization, intervention, and tuning. As a result it underpins nodes like `cognitive_tuning`, `cognitive_workflows`, and concrete strategies such as `dreamgraph_src_cognitive_strategies_schema_grounding`.

**Table:** `N/A`  
**Storage:** N/A  

