# Adversarial Model

> This node represents the security-analysis snapshot and threat-reporting model used during DreamGraph's NIGHTMARE state, where the system tries to break assumptions instead of finding helpful connections. The source evidence shows that adversarial reasoning builds a `SecurityEntity` view over features, workflows, and data models, annotating each with signals such as auth references, RLS references, validation references, input acceptance, data storage, and graph links so strategies can detect privilege escalation, data leaks, injection surfaces, missing validation, and broken access control. It exists to produce threat reports and scored threat tensions without modifying project files or the fact graph, making it a bounded analysis model rather than a mutation path. In the neighborhood it is the data substrate for `cognitive_adversarial`, runs under `cognitive_engine`'s NIGHTMARE lifecycle, and parallels `causal_model` as another read-only derived reasoning model over graph entities.

**Table:** `adversarial_model`  
**Storage:** memory  

## Fields

| Field | Type | Description |
|-------|------|-------------|
| id | string | Unique identifier for the adversarial model. |
| scenarios | array | List of scenarios defined in the model. |
| responses | array | Expected responses to adversarial scenarios. |

