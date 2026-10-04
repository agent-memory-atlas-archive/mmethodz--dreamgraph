# LLM Provider

> This node represents the low-level provider/adapter layer that actually issues model and embedding requests against OpenAI-compatible backends, while leaving higher-order orchestration outside the adapter itself. In the supplied neighborhood, `llm_config` defines the effective provider, model, fallback order, and related routing settings that configure this layer, and `architect-llm-config-route-selection` is a sanitized Architect-specific projection of that same routing surface. It exists to give DreamGraph's cognitive and Architect paths a reusable execution primitive for model access, while keeping daemon-owned policy, fallback, and workflow behavior in surrounding components such as `cognitive_llm`, `cognitive_engine`, and the wrapper identified as `management_hub`.

**Table:** ``  
**Storage:** unknown  

## Relationships

| Target | Type | Description |
|--------|------|-------------|
| management_hub | wrapped_by | - |
| llm_config | configured_by | - |

