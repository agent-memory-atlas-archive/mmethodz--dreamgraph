# Src

> This node represents the typed core contract layer for the DreamGraph VS Code extension sources that orchestrate Architect model calls, autonomy continuation, command routing, context assembly, and daemon-facing state. The cited files show it defining provider/model capabilities and response shapes for Architect LLM calls, a strict structured continuation envelope for autonomy, and pass-analysis heuristics that decide whether the extension should continue automatically after a turn. It exists so the extension can keep chat execution, autonomy policy, and typed message/state handling consistent across host logic and webview-adjacent flows rather than embedding ad hoc JSON and provider-specific behavior everywhere. In practice it connects the broader `dreamgraph_extensions_vscode` feature to specialized flows like `workflow_vscode_autonomy_continuation_loop`, while also supplying contracts consumed by neighboring nodes such as `dreamgraph_extensions_vscode_src_autonomy_contract` and the chat-panel support layer in `dreamgraph_extensions_vscode_src_chat_panel`.

**Table:** `dreamgraph_extensions_vscode_src`  
**Storage:** unknown  

