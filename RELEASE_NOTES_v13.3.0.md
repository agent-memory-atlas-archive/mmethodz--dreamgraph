# DreamGraph v13.3.0 - Current Model Support

DreamGraph v13.3.0 updates hosted model support across the cognitive engine, standalone Architect, VS Code architect, and Codex CLI adapter.

## Changes

- Add GPT-6.1 Sol, GPT-6 Astra/Sol/Luna, and GPT-5.6 API models to the engine and both Architect selectors. Codex CLI also offers the GPT-6 models, with the existing `xhigh` reasoning policy and explicit override support.
- Add Claude Opus/Sonnet 5.5 and Fable/Mythos 5.1 to all three selectors. Mythos requires restricted account access. Opus/Sonnet 5 remain selectable alongside previous compatible models.
- Route GPT-5.5/5.6/6 native calls through Responses, preserving JSON/schema options and opaque reasoning items through tool turns. GPT-6 Architect models accept image attachments.
- Omit unsupported Claude sampling parameters and preserve signed assistant thinking blocks through native tool turns. Newer bound-thinking models allow API-side drops after context changes, with count-only diagnostics.
- Replace the engine's retired Sonnet 4 fallback with Sonnet 5.5. Retain explicit model choices and the governed Opus 4.7 VS Code Architect default. OpenAI/Codex selector fallback starts with GPT-6.1 Sol.
- Align root, SDK, host, token economy, CLI, standalone Architect, VS Code architect, daemon, Explorer, Dashboard, analytics suite, and daemon-exposed MCP authority to 13.3.0. Analytics gains `--version` and reads the root package version; MCP bridge identities use the synchronized CLI/extension version. Explorer displays its package version in the header.

## Compatibility

No graph-state migration is required. Model availability still depends on provider account access and, for Codex, the installed CLI. Native reasoning replay stays behind provider adapters; CLI execution and continuation ownership retain the v13.2 behavior.

The latest Claude thinking signatures bind to prior context. Architect can rebuild or compact that context, so it uses the documented `drop_block` policy with the required beta header. A dropped block is logged by count and the model continues without that earlier reasoning. See [Anthropic migration notes](docs/anthropic-opus-4-7.md) and [LLM setup](docs/setup-llm.md).

## Verification

Request-level regressions cover current model routing, JSON/schema preservation, omitted sampling parameters, signed/encrypted reasoning replay, provider switching, Codex reasoning overrides, and model-selector coverage. Validation uses mocked provider responses; live model/account access is not certified by these checks.

- Root suite: 859 passed, 2 skipped across 93 test files.
- VS Code source suite: 482 passed, including real MCP bridge forwarding checks.
- Root/Explorer and VS Code builds passed; Explorer retains its existing bundle-size warning.
- CLI and analytics dispatcher/all 13 analyzers report 13.3.0. An in-memory MCP handshake verifies matching initialization, instructions, and `system://capabilities` versions.
