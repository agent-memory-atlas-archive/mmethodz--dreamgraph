# Architect LLM Capabilities

> This node represents the structured capability surface of an Architect-facing LLM provider, describing what kinds of interactions the provider can support in orchestrated prompt and response flows. In the neighborhood it bridges provider/configuration concerns such as `architect_llm_provider`, `architect_provider_interface`, and `architect_llm_config` with client-facing transport contracts like `structured_conversation_attachment`, `webview_chat_contract`, and `webview_trace_contract`, implying that capability flags influence both prompt assembly and what attachment-rich interactions can be rendered safely. It exists to let orchestration layers choose compatible request formats and UI affordances per provider, but the exact capability fields are not evidenced here beyond examples like text or image attachment handling.

**Table:** `N/A`  
**Storage:** N/A  

