# Causal Model

> This node represents the causal inference model built from DreamGraph's own dream history and tension log, turning repeated temporal correlations into hypotheses about what changes tend to cause downstream failures. The source evidence shows it constructs a timeline of tension events from active and resolved tensions, maps real timestamps back to dream cycles, and then searches for entity pairs where tension in one entity consistently precedes tension in another within a lag window. It exists to move beyond structural adjacency into impact prediction, propagation hotspot detection, and the `causal_replay` dream strategy, while remaining read-only against the fact graph and writing only into dream space. In the neighborhood it is the reasoning substrate for `cognitive_causal`, depends on `cognitive_engine` history/tension persistence, and complements other cognitive models such as `adversarial_model` and broader `capability_cognitive_reasoning`.

**Table:** `causal_model`  
**Storage:** json  

## Fields

| Field | Type | Description |
|-------|------|-------------|
| id | string | Unique identifier for the causal model. |
| relationship | string | Description of the causal relationship being modeled. |

