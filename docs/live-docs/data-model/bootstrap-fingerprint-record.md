# Bootstrap Fingerprint Record

> This node represents the persisted record for a single effective bootstrap configuration identity and its associated initialization state, tying provider/model-style settings to the fact that bootstrap work was attempted or completed. In the neighborhood it is narrower than `registry_bootstrap_diary` or `llm_bootstrap_lineage`, and closer to the concrete identity-and-outcome pairing used by `bootstrap_fingerprint_registry`, `bootstrap_guardrail`, `instance_bootstrap_guardrail`, and `bootstrap_run_audit`. It exists to make once-per-configuration bootstrap enforcement durable and reviewable, though the exact stored fields beyond fingerprinted configuration and orchestration state are only indirectly evidenced here.

**Table:** `N/A`  
**Storage:** N/A  

