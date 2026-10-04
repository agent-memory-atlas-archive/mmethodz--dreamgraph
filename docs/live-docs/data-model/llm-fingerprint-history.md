# LLM Fingerprint History

> This node represents the persisted append-only history of observed LLM configuration identities and the bootstrap actions associated with them, preserving a forensic trail of provider/model/endpoint combinations over time. Reusing the high-confidence semantics of `llm_bootstrap_fingerprint`, it is the historical counterpart to that identity key and sits near `bootstrap_event_log`, `instance_bootstrap_audit`, `llm_bootstrap_lineage`, and `llm_bootstrap_fingerprint_history`, indicating it records concrete observations while those neighboring nodes summarize lifecycle, instance scope, or duplicate-prevention state. It exists to let DreamGraph explain how effective LLM routing and startup behavior evolved, and to support audit, guardrail, and orchestration decisions without relying only on current configuration.

**Table:** `N/A`  
**Storage:** N/A  

