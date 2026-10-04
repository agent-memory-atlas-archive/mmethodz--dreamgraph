# LLM Configuration

> This node is the LLM configuration contract used to determine how DreamGraph routes model-backed cognitive and Architect requests, including provider/model selection and fallback behavior. Reusing the high-confidence cached Architect route-selection projection, the supplied evidence shows that the broader LLM configuration surface in `src/cognitive/llm.ts` defines shared, dreamer, normalizer, and architect-specific configuration with fallback sources, while sanitized projections expose effective provider, model, temperature, max tokens, base URL, and fallback order without leaking secrets. It exists so daemon-owned code remains the authority for model routing while both cognitive workflows and UI consumers can reason about readiness and deterministic fallback consistently. In the neighborhood it underpins `cognitive_llm` and `capability_llm_dreaming`, is managed by `llm_provider`, and is specialized by `architect-llm-config-route-selection` for standalone Architect surfaces.

**Table:** `llm_config`  
**Storage:** json  

## Fields

| Field | Type | Description |
|-------|------|-------------|
| model | string | The name of the language model being configured. |
| parameters | object | Parameters that define the model's behavior. |

