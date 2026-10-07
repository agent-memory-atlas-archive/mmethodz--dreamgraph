# DreamGraph v14.0.2 — Ashoka

DreamGraph now has its own Computer Use. The Architect operates your Chrome through DreamGraph's browser extension on every engine (the native API tool loop and Codex CLI), and it handles what stopped earlier runs: page dialogs and the operating system's Save dialog. Model runs are also much cheaper.

## Computer Use: DreamGraph's own browser

- **One backend for every engine.** A DreamGraph Chrome extension, a native browser host and a controller in the daemon. The model gets the same `browser_*` tools on every engine. It reads pages as element lists with refs, clicks and types by ref, and takes screenshots when it needs to see a canvas or layout.
  - **API engines (OpenAI, Anthropic):** DreamGraph's browser when the extension is connected, else the Codex Computer Use runtime.
  - **Codex CLI:** DreamGraph's browser through the DreamGraph MCP bridge, like every other DreamGraph tool. Codex's own Computer Use is only the fallback when the extension is not connected. In that fallback, Codex's instructions name DreamGraph's own pages as off limits.
  - `DREAMGRAPH_COMPUTER_USE_BACKEND` = `auto` (default) · `dreamgraph-browser` (required) · `cua-runtime` (the other route).
- **Existing tabs:** the Architect takes over a tab you already have open (for example a local IDE) instead of opening a new one.
- **Page dialogs:** `alert`, `confirm`, `prompt` and "leave page?" are reported as soon as they open. The model answers them, and a blocked page can no longer hang the run.
- **The operating system's Save/Open dialog** (File System Access pickers, e.g. Web64 *Save*): DreamGraph detects the dialog, fills in the path and presses Save itself, in any Windows language. It never touches the dialog's file list. It answers an overwrite question only when told to overwrite.
  - **Blocked folders:** Chrome blocks sites from system folders (AppData including Temp, Program Files, Windows). Such paths are refused up front with a plain reason.
  - **No location given:** the file goes to the instance's `runtime/temp` folder under the name the page suggested.
  - **Platforms:** Windows only for now. macOS and Linux report the dialog as unsupported.
- **Saves stay graph-bound:** when the page saves a source file the project scanner tracks into the project, DreamGraph records it for graph reconciliation like any governed source change. The save is refused if it cannot be recorded. An application's own file, such as a `.web64proj`, is described in the graph as a feature instead.
- **DreamGraph's own pages are protected:** the Architect, Config and Explorer tabs are never operated. In earlier runs the agent navigated the Architect tab itself, which emptied the chat and showed *unbound*.
- **You stay in control:** while a tab is controlled, Chrome shows its "started debugging this browser" bar. **Cancel** there takes the tab back for good in that run.
- **Setup:** the installer registers the browser host. Load the extension once from `~/.dreamgraph/bin/browser-extension` (chrome://extensions → Developer mode → Load unpacked).
  - `dg browser status` shows the connection.
  - `dg browser selftest` checks a prompt, a confirm and a real Save dialog without any model.

## Architect runs

- **Autonomous mode works without clicks for ordinary changes.** Graph writes and project source edits are approved by your standing Autonomous choice, recorded exactly like a click.
  - **Still ask:** commands, unclassified tools, external and runtime writes, discipline changes, and destructive operations (delete, rename, clearing dreams or schedules, re-initialising the graph).
  - **Turn off:** `DREAMGRAPH_AUTONOMOUS_AUTO_APPROVE=0`.
  - **Earlier modes:** Manual and Supervised are unchanged.
- **No busywork after the task is done:** when the work was done and checked through Computer Use, that counts for the source-change and verification requirements. Graph grounding and the graph record are still required. Before, the model ran a health report, a no-op patch and a blocked command after finishing.
- **Pass Report:** *Tool Trace* and *Graph / Plan Updates* now list what the daemon actually saw (every call, every completed graph write), followed by the model's own notes.
- **Long runs:**
  - The 128 KiB bound now applies only to the required prompt (history, managed context, guidance).
  - Older tool results are compacted instead of failing the run (`NATIVE_REQUIRED_PROMPT_BYTE_BOUND` no longer stops long Computer Use passes).
- **Page reloads during a pass:** the chat history comes back for the selected plan, a running pass is shown, and the project label no longer flips to *unbound*.

## Lower model cost

- **Prompt caching works across a run.** DreamGraph's managed context stays byte-identical between tool-loop calls unless the graph or its state really changes, so the provider can serve the repeated part from its prompt cache.
- **Compaction is rare:** the transcript is compacted from 80 % of the context allocation down to 60 % in one go, so the prompt changes seldom.
- **Accurate reservations:** within a run, admission uses the input tokens the provider reported for the part of the request already measured. Only new bytes are estimated.
- **Cached-input price:** an optional cached-input price (Config → model prices) charges cache reads at their real rate.
- **Field result:** the Web64 proof run (22 tool calls, OpenAI) cost about $0.40. An earlier comparable run stopped at its $3.72 run limit after 20 calls.

## Upgrade

1. Run `scripts/install.ps1 -Force` or `bash scripts/install.sh --force`, then restart running instances.
2. Load the extension (first time), or reload it with ↻ on `chrome://extensions`.
3. Optional: `dg browser selftest`.

## Known limitations

- **Platform for OS dialogs:** the Save/Open dialog is handled on Windows only. macOS and Linux report it as unsupported, and the operator answers it.
- **Codex fallback:** the protection of DreamGraph's own pages is an instruction to Codex, not a hard block. DreamGraph's own backend blocks them.
- **Copilot CLI:** no Computer Use yet.
- **Extension install:** the extension is loaded unpacked; a Chrome Web Store listing is planned.
- **Discipline sessions:** browser actions are authorized by the Computer Use grant and are not checked against a discipline session's phase.
- **Graph-bound saves:** the source-file rule follows the project scanner's file types and skipped folders, but not `.gitignore`.
- **Approval provenance:** an approval given by Autonomous mode is recorded like a click and is not yet marked as automatic.

## Browser installation and connection guide

Follow [Computer Use: install and connect](guide/17-computer-use.md) for Developer mode, Load unpacked, native-host registration, connection troubleshooting and Architect permissions. The installer prints the extension folder; the popup must say **Connected to DreamGraph**. After upgrading, restart the instance and reload the extension. The downloadable extension ZIP must be extracted before loading.
