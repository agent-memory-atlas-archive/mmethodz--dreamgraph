# LLM Bootstrap Fingerprint

> This node represents the LLM-specific bootstrap identity used to key readiness, one-time initialization, and forensic history for provider/model/endpoint combinations in the cognitive subsystem. In the neighborhood it is the focal data model behind `llm_bootstrap_lifecycle`, `llm_bootstrap_fingerprint_history`, `bootstrap_fingerprint_registry`, and several guardrail features, tying effective LLM configuration to both audit logs and duplicate-bootstrap prevention. It exists to make LLM startup behavior deterministic and reviewable across instances and federation scenarios, though the exact field set and hashing/serialization rules are not evidenced here.

**Table:** `N/A`  
**Storage:** N/A  

