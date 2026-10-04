# Cognitive Engine

> This node is the stateful core of DreamGraph cognition, enforcing the boundaries between AWAKE, REM, NORMALIZING, and NIGHTMARE while owning dream-space persistence, interruption handling, decay, tension tracking, and history. The source evidence makes clear that it is designed as a safety boundary as much as an execution engine: the fact graph is never modified by the cognitive system, REM output is isolated to `dream_graph.json`, only normalization can promote edges to `validated_edges.json`, and interrupted REM work is quarantined. It exists to let multiple cognitive modules reason over the graph without contaminating validated facts, while still preserving memory through reinforcement tracking and policy-driven tuning. In the neighborhood it underpins `dreamer`, `cognitive_adversarial`, `cognitive_causal`, and `cognitive_intervention`, reads active tuning from the instance subsystem, and serves as the execution backbone for broader `cognitive_workflows` and `capability_cognitive_reasoning`.

**Table:** `cognitive_engine`  
**Storage:** memory  

## Fields

| Field | Type | Description |
|-------|------|-------------|
| id | string | Unique identifier for the cognitive engine instance. |
| status | string | Current operational status of the cognitive engine. |

