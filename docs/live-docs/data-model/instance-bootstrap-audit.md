# Instance Bootstrap Audit

> This node represents the per-instance forensic record of bootstrap attempts, outcomes, and associated configuration identity, giving DreamGraph a way to review and reproduce how a specific instance initialized its cognitive or LLM stack. In the neighborhood it sits downstream of fingerprint concepts such as `bootstrap_fingerprint_log`, `llm_bootstrap_fingerprint_history`, and `model_bootstrap_fingerprint`, and upstream of guardrail and integrity concerns like `instance_bootstrap_guardrail` and `federated_bootstrap_integrity`. It exists to make bootstrap behavior accountable at the instance boundary rather than only globally, but the exact record schema and retention policy are not evidenced here.

**Table:** `N/A`  
**Storage:** N/A  

