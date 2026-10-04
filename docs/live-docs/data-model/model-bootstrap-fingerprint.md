# Model Bootstrap Fingerprint

> This node represents the model-oriented form of bootstrap fingerprinting: a unique identity for an LLM configuration that allows the system to determine whether first-use bootstrap work has already been performed. In the neighborhood it connects configuration surfaces such as `llm_config`, `config`, and `configuration` to audit and guardrail structures like `bootstrap_event_log`, `bootstrap_fingerprint_history`, and `instance_bootstrap_guardrail`, indicating that it is the join key between effective model settings and bootstrap control. It exists to make model-specific initialization idempotent and traceable across instances and runs, though the exact canonicalization rules are not evidenced here.

**Table:** `N/A`  
**Storage:** N/A  

