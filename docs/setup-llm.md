# LLM Setup Guide

This guide provides the correct DreamGraph LLM setup for the daemon-side cognitive engine, standalone browser Architect, and VS Code architect.

## 1. Daemon-side engine configuration

DreamGraph reads per-instance engine settings from:

```text
~/.dreamgraph/<instance-uuid>/config/engine.env
```

These values are loaded into `process.env` at startup and override global environment variables for that instance.

### Supported core variables

```bash
DREAMGRAPH_LLM_PROVIDER=openai
DREAMGRAPH_LLM_URL=https://api.openai.com/v1
DREAMGRAPH_LLM_API_KEY=your-api-key-here
```

### Local providers (Ollama and LM Studio)

DreamGraph supports two local-inference servers as peer options. Pick the one
you already use — there is no preferred choice.

**Ollama** (default):

```bash
DREAMGRAPH_LLM_PROVIDER=ollama
DREAMGRAPH_LLM_URL=http://localhost:11434
DREAMGRAPH_LLM_MODEL=qwen3:8b
```

**LM Studio** (OpenAI-compatible server):

```bash
DREAMGRAPH_LLM_PROVIDER=lmstudio
DREAMGRAPH_LLM_URL=http://localhost:1234/v1
DREAMGRAPH_LLM_API_KEY=lm-studio        # ignored by LM Studio; any non-empty value works
DREAMGRAPH_LLM_MODEL=<model-id-from-LM-Studio-UI>
```

LM Studio notes:

- Default port `1234` (configurable in LM Studio's *Developer* / *Server* tab).
- `DREAMGRAPH_LLM_MODEL` must match the loaded-model id shown in LM Studio's
  UI — often a long file-path-shaped string. Copy it verbatim.
- The first request after a model load is slow (cold load). If you hit a
  cycle timeout on the very first dream, raise `DG_DREAM_TIMEOUT_MS`.
- LM Studio uses the same OpenAI dialect as the `openai` provider, so the
  Dreamer / Normalizer split below works the same way.

### Dreamer / Normalizer split configuration

DreamGraph also supports separate settings for the two main cognitive LLM roles:

- **Dreamer**: creative hypothesis generation
- **Normalizer**: validation / truth filtering

Example:

```bash
DREAMGRAPH_LLM_PROVIDER=openai
DREAMGRAPH_LLM_URL=https://api.openai.com/v1
DREAMGRAPH_LLM_API_KEY=your-api-key-here
DREAMGRAPH_LLM_DREAMER_MODEL=gpt-4o-mini
DREAMGRAPH_LLM_DREAMER_TEMPERATURE=0.9
DREAMGRAPH_LLM_DREAMER_MAX_TOKENS=10240
DREAMGRAPH_LLM_NORMALIZER_MODEL=gpt-5.4-nano
DREAMGRAPH_LLM_NORMALIZER_TEMPERATURE=0.1
DREAMGRAPH_LLM_NORMALIZER_MAX_TOKENS=4096
```

Notes:

- `DREAMGRAPH_LLM_MODEL`, `DREAMGRAPH_LLM_TEMPERATURE`, and `DREAMGRAPH_LLM_MAX_TOKENS` act as base defaults.
- `DREAMGRAPH_LLM_DREAMER_*` overrides apply only to the Dreamer.
- `DREAMGRAPH_LLM_NORMALIZER_*` overrides apply only to the Normalizer.
- If no Normalizer temperature is set, DreamGraph defaults it to `0.1`.

### Instance templates

New instances seed `config/engine.env` from the selected template when available:

1. `~/.dreamgraph/templates/<template>/config/engine.env`
2. repository `templates/<template>/config/engine.env`
3. built-in fallback scaffold

`dg init` defaults to `--template default`.

You can create your own presets by copying:

```text
~/.dreamgraph/templates/default/
```

to something like:

```text
~/.dreamgraph/templates/openai/
~/.dreamgraph/templates/anthropic/
```

and then running:

```bash
dg init my-project --template openai
```

## 2. VS Code architect configuration

The VS Code extension uses separate settings from the daemon.

Configure via:

- `dreamgraph.architect.provider`
- `dreamgraph.architect.model`
- `dreamgraph.architect.baseUrl` (when needed)
- `DreamGraph: Set Architect API Key` command for secrets

Important:

- daemon-side `engine.env` controls DreamGraph's internal cognitive engine and standalone browser Architect rollout switches
- VS Code architect settings control the editor chat agent
- they are related but separate configuration surfaces

### Standalone Architect token economy

Standalone browser Architect uses per-instance `engine.env` switches for token economy rollout safety and benchmarking:

```bash
DREAMGRAPH_ARCHITECT_PREAMBLE_COMPILER=true
DREAMGRAPH_ARCHITECT_TOKEN_ECONOMY=true
DREAMGRAPH_ARCHITECT_TOKEN_ECONOMY_SOFT_TARGET=16384
```

`DREAMGRAPH_ARCHITECT_TOKEN_ECONOMY=false` requests full-context mode for that instance. Leave `DREAMGRAPH_ARCHITECT_PREAMBLE_COMPILER=true` when you only want to benchmark economy on/off; set it to `false` to disable preamble compilation entirely.

## 3. Current OpenAI models / Responses API notes

The engine, standalone Architect, and VS Code architect support `gpt-6.1-sol`, `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`, the GPT-5.6 family, and GPT-5.5 through Responses. See [OpenAI model guidance](https://developers.openai.com/api/docs/guides/latest-model).

For current OpenAI Architect calls, DreamGraph uses:

- Responses-style `input` instead of Chat Completions `messages`
- Responses function-tool definitions
- `function_call` / `function_call_output` replay for tool interactions
- `reasoning.effort` via `dreamgraph.architect.openai.reasoningEffort`
- `text.verbosity` via `dreamgraph.architect.openai.verbosity`

Native tool loops replay encrypted reasoning with `store: false`; the knowledge graph remains the source of persistent project memory. Engine JSON/schema options are sent as Responses `text.format`. Sampling temperature is omitted for these models. Existing API keys, URLs, and explicit role-specific model settings continue to apply.

Codex CLI selectors include the GPT-6 models and default GPT-5.6/GPT-6 to `xhigh` unless a CLI config override is supplied. Access depends on your installed CLI and account; see [Codex models](https://learn.chatgpt.com/docs/models).

## 4. Installer behavior

The install scripts bootstrap required build tooling automatically on fresh machines, including the TypeScript compiler via npm install when needed.

VS Code is optional:

- if VS Code is present in PATH, the installer builds and installs the extension
- if VS Code is not present, the installer skips extension build/install
- CLI, MCP server, and dashboard installation still succeed without VS Code

## 5. Current Claude models and the Architect default

Engine and Architect selectors include Opus 5.5, Sonnet 5.5, Fable 5.1, and restricted-access Mythos 5.1. The engine defaults to `claude-sonnet-5-5` when no model is set; the VS Code Architect default remains `claude-opus-4-7`. Current Claude requests omit sampling temperature and retain signed thinking blocks in tool history. See the [Claude model catalog](https://platform.claude.com/docs/en/models/overview).

If using Anthropic in the Architect, also see:

- [anthropic-opus-4-7.md](./anthropic-opus-4-7.md)

Key Anthropic extension settings:

- `dreamgraph.architect.anthropic.effort`
- `dreamgraph.architect.anthropic.adaptiveThinking`
- `dreamgraph.architect.anthropic.showThinkingSummary`

## 6. Common setup mistakes

### Wrong variable prefix

Do **not** use outdated `DG_LLM_*` names for engine configuration.

Use:

- `DREAMGRAPH_LLM_PROVIDER`
- `DREAMGRAPH_LLM_URL`
- `DREAMGRAPH_LLM_API_KEY`
- `DREAMGRAPH_LLM_MODEL`
- `DREAMGRAPH_LLM_DREAMER_*`
- `DREAMGRAPH_LLM_NORMALIZER_*`

### Confusing daemon config with extension config

These are different:

- `engine.env` configures the daemon's cognitive engine
- VS Code settings configure the Architect chat provider/model

### Expecting `.vscode/settings.json` to mirror all UI changes

Some Architect UI changes may persist to VS Code user settings rather than workspace settings.

## 7. Quick verification checklist

- `engine.env` exists under the correct instance `config/` directory
- variables use the `DREAMGRAPH_LLM_*` prefix
- provider, URL, and API key are present for cloud providers
- Dreamer and Normalizer overrides are set only when needed
- VS Code architect provider/model are configured separately
- after changes, restart the daemon if needed
<!-- CONTINUATION TEST SLICE 8 -->
