# Chat Panel

> This node captures the extracted pure support layer behind the VS Code chat panel: stateless helpers for rendering-safe payload summaries, verdict derivation from tool traces, secret redaction, and request timeout/recovery behavior. The helpers exist to keep the main `chat-panel.ts` focused on webview lifecycle, streaming orchestration, and persistence while making deterministic logic directly testable without instantiating the full panel. Its behavior is tightly coupled to Architect turn execution because it classifies tool outcomes, truncates oversized payloads for UI safety, and builds retry prompts and abort signals when LLM requests stall. That makes it a supporting contract/utility layer for both the broader `dreamgraph_extensions_vscode_src` runtime and the autonomy/chat workflows that surface tool evidence to users.

**Table:** `dreamgraph_extensions_vscode_src_chat_panel`  
**Storage:** unknown  

