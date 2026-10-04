# Cognitive Tuning

> This node represents the shared tuning contract that governs how DreamGraph's cognitive lifecycle behaves, especially promotion, decay, retention, and related thresholds used across dreaming and normalization. Reusing the high-confidence cognitive types cache, the underlying `src/cognitive/types.ts` surface defines default decay and promotion settings from environment variables and serves as the common policy layer for runtime components such as strategy execution, intervention, and workflow control. It exists so cognitive behavior can be adjusted consistently rather than hard-coded separately in each module, and the instance type layer shows that policy profiles can carry per-profile `cognitive_tuning` overrides. In the neighborhood it configures `cognitive_engine`, is consumed by `cognitive_workflows` and `cognitive_intervention`, and is tied to instance/policy management through `dreamgraph_src_instance` and `policy_profile`-style configuration flows.

**Table:** `cognitive_tuning`  
**Storage:** json  

## Fields

| Field | Type | Description |
|-------|------|-------------|
| tuning_id | string | Unique identifier for the tuning configuration. |
| parameters | object | The parameters used for cognitive tuning. |

