# Architect LLM Configuration Route Selection

> This node is the sanitized configuration projection that exposes how standalone Architect chat will route model requests without leaking secrets. The LLM provider source defines shared, dreamer, normalizer, and architect-specific configuration plus fallback sources, the default `engine.env` template documents Architect provider/model fallback order and per-instance overrides, and the standalone Architect routes use that information to surface provider/model readiness and deterministic fallback reasons in the browser. It exists so the daemon can remain the authority for route selection while the browser and related UI elements display the effective provider, model, temperature, max tokens, and fallback behavior consistently across chat, runtime status, and configuration updates.

**Table:** `N/A`  
**Storage:** N/A  

## Fields

| Field | Type | Description |
|-------|------|-------------|
| provider | unknown |  |
| provider_source | unknown |  |
| model | unknown |  |
| model_source | unknown |  |
| fallback_order | unknown |  |
| temperature | unknown |  |
| max_tokens | unknown |  |
| base_url | unknown |  |

## Relationships

| Target | Type | Description |
|--------|------|-------------|
| standalone-architect-project-bound-chat-shell | used_by | - |

