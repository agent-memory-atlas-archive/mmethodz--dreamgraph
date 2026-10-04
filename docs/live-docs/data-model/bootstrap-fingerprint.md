# Bootstrap Fingerprint

> This node represents the canonical configuration identity used to decide whether a cognitive or LLM bootstrap path has already been executed, typically by keying provider/model/endpoint-like settings into a stable fingerprint. In the neighborhood it is the shared identifier behind `bootstrap_fingerprint_log`, `bootstrap_fingerprint_history`, and multiple guardrail and lifecycle concepts, linking configuration state to append-only audit records and once-per-fingerprint bootstrap behavior. It exists to separate configuration identity from the logs and workflows that consume it, but the exact normalized fields included in the fingerprint are only indirectly evidenced here.

**Table:** `N/A`  
**Storage:** N/A  

