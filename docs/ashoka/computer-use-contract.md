# Computer Use — one Architect contract, per-adapter backends (v14.0.2)

Status: accepted by the maintainer on 2026-10-04; updated 2026-10-07 (Codex CLI uses DreamGraph's backend). Supersedes the closed DreamGraph harness as the API-engine route.

## Rule

**Computer Use is an Architect capability, not an adapter feature the user has to understand.** Ashoka's foundational rule: the user-facing contract is the same for every adapter. The operator never prepares targets, profiles or scopes per task. Once Computer Use is granted for a pass, the Architect uses it naturally inside its tool loop, exactly as it does on Codex CLI. Adapters differ only in the backend that executes the actions.

**Codex CLI (maintainer decision, 2026-10-07):** Codex CLI already reaches everything else through DreamGraph's MCP tools, so its Computer Use goes through DreamGraph's own backend too: when the extension is connected, a granted Codex run gets the `browser_*` tools over the DreamGraph MCP bridge and Codex's own Computer Use is not wired into that run. Codex's own Computer Use (`codex-computer-use.ts`, `codex-cua-release.ts`, unchanged) remains the fallback when DreamGraph's browser is not available.

## Architect-facing contract (identical for every adapter)

Allow / Ask / Deny → prepare → execute → observe → stop/recover → evidence → graph reconciliation. *Prepare* is automatic (backend detection and session start); the operator never prepares targets.

1. **Policy** — per instance, Config → Computer Use: `allow` · `ask` · `deny`.
2. **Grant per pass**
   - `allow`: every pass is granted.
   - `ask`: the executor gets `request_computer_use`. Calling it ends the pass; the Computer Use bar shows *Allow once and run again* / *Not now*. *Allow for next message* pre-approves the next message.
   - `deny`: Computer Use is not offered.
3. **Scope once granted** — full control for that pass: any site, the user's already-open browser tabs, and the desktop where the backend supports it. No per-target setup.
4. **Executor guidance** — same rules on every engine: take over already-open tabs/windows, answer dialogs, keep result pages open, retry transient runtime errors, never read or edit project source through Computer Use (repository work goes through DreamGraph MCP tools). A file the page itself saves where the user asked (for example into the project folder) is fine; see *Files* below.
5. **Lifecycle** — the session starts at the first Computer Use call. The user sees the backend's indicator (cursor/banner in the browser). The session is released when the pass ends, hits the ceiling, is cancelled or crashes (run-once release).
6. **Evidence** — Computer Use calls appear in the tool trace with readable titles; the route reports `computer_use_session`, `computer_use_transcript` and `computer_use_cleanup_log`. The Pass Report's *Tool Trace* and *Graph / Plan Updates* come from what the host observed (every call; completed graph writes), with the model's own lines after them (`withHostObservedPassEvidence`, routes.ts).
7. **Budgets** — Computer Use calls run inside the pass's model admission and pass ceiling. Images count toward the request allocation. The required prompt (chat history, managed context, guidance) keeps its 128 KiB bound; the cumulative tool-loop conversation preserves retrieved results verbatim, including earlier investigation evidence. Context pressure does not replace results with stubs or compress them before insertion. Unchanged conversation prefixes remain available for provider prompt caching. A genuine role/provider context limit is reported explicitly; it is not worked around by silently discarding evidence. Expired Computer Use images remain subject to observation validity rules.
8. **Failure semantics** — a failed Computer Use call is part of the process (modify and retry). A missing backend is reported before dispatch with a plain reason.
9. **Authority** — the pass's Computer Use grant authorizes the browser actions: `browser_*` tools have tool-policy effect `computer_use` and are not execution-reviewed per call; they take no graph writer and record no managed effect (`tool-boundary.ts`). Outside an execution holding a browser session they return `COMPUTER_USE_NOT_GRANTED`. Governed DreamGraph tools keep their own **Action approvals** control, independent of Computer Use and autonomy. **Ask for every action** reviews each mutation/command. **Auto accept — DreamGraph actions** records exact approvals for registered DreamGraph effects (including destructive actions) and scoped commands before dispatch; it does not grant provider-native tools, unknown extensions, new scope or Computer Use. **Auto accept this task** on a pending review applies only to that live execution. Scope checks, source observation, cancellation and graph reconciliation remain enforced. Under **Standard**, in **Autonomous** mode graph writes and project source edits (`graph_write`, `source_write`) are approved by the operator's standing policy through the same `approveHostExecution` path as a click (recorded the same way; a failure leaves the request for the operator); commands, unqualified tools, external/runtime writes, discipline session changes and destructive tools (`delete_file`, `rename_file`, `clear_dreams`, `delete_schedule`, `init_graph`, `bootstrap_instance`) still ask. `DREAMGRAPH_AUTONOMOUS_AUTO_APPROVE=0` turns this off.
10. **Required tools** — work done through Computer Use (an action and an observation) satisfies the source-change, reading, verification and graph-health obligations a prompt implies; graph grounding and graph recording stay required (`computerUseEvidence`, tool-selection.ts). Field finding (2026-10-05): without this, the model ran graph_health_report, a no-op patch_file and a blocked run_command after the task was already done.

## Backends

| Adapter | Backend | Status |
|---|---|---|
| Codex CLI | `dreamgraph-browser` through the DreamGraph MCP bridge (`src/computer/execution-browser.ts`: a browser session per execution, `browser_*` tools on the daemon's MCP server) | v14.0.2 (2026-10-07; live run pending) |
| Codex CLI, fallback | Native: Codex's own Computer Use (`cua_repl` injected into the isolated CODEX_HOME), release via a new-turn bind + `turn_ended`; told to keep off DreamGraph's own pages (named in its instructions) | Proven, unchanged |
| OpenAI API, Anthropic API (native tool loop) | DreamGraph harness, backend `dreamgraph-browser`: DreamGraph's own Chrome extension + native browser host + controller in the daemon; provider-neutral `browser_*` tools; dialogs handled by the backend | v14.0.2 stage 2 (field-tested 2026-10-05: Web64 proof run, see Acceptance) |
| OpenAI / Anthropic API, fallback | DreamGraph harness, backend `cua-runtime`: DreamGraph hosts the Computer Use runtime installed with the Codex app (`cua_repl`) | v14.0.2 stage 1 (field-tested once with OpenAI; dialog flaw) |
| Copilot CLI / other CLIs | Their native Computer Use where available and qualified | Later |
| Future Gemini / Antigravity | Native route once qualified | Later |
| Any other adapter | — | Reports *Computer Use unavailable* |

Backend choice is automatic: `dreamgraph-browser` when the extension is connected; otherwise Codex CLI uses its own Computer Use and API engines use `cua-runtime` when discovered, else *Computer Use unavailable* with both reasons. `DREAMGRAPH_COMPUTER_USE_BACKEND` = `auto` (default) | `dreamgraph-browser` (required; no fallback) | `cua-runtime` (Codex's own Computer Use for Codex CLI, the runtime for API engines) pins one (`src/computer/computer-use-backend.ts`).

### Stage 1 — `cua-runtime` in the API tool loop

- Discovery reuses the Codex plugin discovery (read-only): newest `unified-computer-use` `.mcp.json` under `~/.codex/plugins/cache`. The runtime files come from the Codex app install; the app does not need to be running.
- Per granted pass DreamGraph spawns `cua_repl` (stdio MCP), surfaces `browser`. Session id and turn id are DreamGraph-minted UUIDs carried in `_meta["x-codex-turn-metadata"]` on every call. A browser-session approval file is written for that session id only (same content as the Codex grant).
- The runtime's own tools (from `tools/list`, minus `turn_ended`) are advertised to the model with their own descriptions; the runtime is self-documenting (`cua.getState()`, `agent.documentation.get(...)`). Image results are forwarded as image blocks; only the latest image is retained in the conversation.
- The first browser call in a fresh runtime fails with *request-header policy* (asynchronous flag load); DreamGraph retries it transparently (up to 3× at 2 s).
- Release: `turn_ended` for the pass turn, then the verified new-turn bind + `turn_ended` for any tab ids still recorded, then process exit. Logged next to the transcript.
- The native tool loop's iteration cap is raised for granted passes (Computer Use is sequential); the pass ceiling and budgets remain the bounds.

Known constraints: requires the Codex app's runtime files; the runtime's terms of use for non-Codex hosts and non-OpenAI models are the maintainer's call; runtime version drift is recorded in evidence.

### Stage 2 — `dreamgraph-browser` (built)

Chrome extension ⇄ native messaging ⇄ DreamGraph browser host ⇄ local socket ⇄ daemon (`src/computer/browser-bridge/`).

- **Extension** (`browser-extension/`, Manifest V3, permissions `debugger`, `tabs`, `nativeMessaging`, `alarms`, fixed key → id `aakildkcmiknihocanjgiainbhgbengl`): a thin relay. It keeps one `chrome.debugger` attachment per controlled tab for the whole run and the open dialog of each tab. Chrome shows its "started debugging this browser" bar while a run controls a tab; **Cancel** there takes control back (`BROWSER_CONTROL_CANCELLED_BY_USER`, the model must not retake the tab). If the host goes away, the extension detaches everything.
- **Host** (`host.ts`, started by Chrome as native messaging host `io.dreamgraph.browser`): one per Chrome profile, serving every instance over a per-user local socket (Windows named pipe, POSIX socket 0600 in `~/.dreamgraph/run`), token from `~/.dreamgraph/run/browser-hosts/<pid>.json`. A tab belongs to one daemon connection at a time (`BROWSER_TAB_IN_USE`); when that connection closes — normal end, cancel, ceiling or daemon crash — the host detaches its tabs.
- **Controller** (`controller.ts`, in the daemon): DreamGraph's isolated world per page (element refs that page scripts cannot see), actions in CSS pixels, screenshots as JPEG (≤ 1600 px wide), release at pass end. Log: `%TEMP%/dreamgraph-codex-transcripts/<session>.browser.log` → route `computer_use_cleanup_log`.
- **Tools** (`tools.ts`, same for every provider): `browser_tabs` (list/select/open/close; already-open tabs are fine), `browser_snapshot`, `browser_screenshot`, `browser_click`, `browser_type`, `browser_press_key`, `browser_hover`, `browser_drag`, `browser_scroll`, `browser_navigate`, `browser_dialog`, `browser_file_chooser`, `browser_wait`, and `browser_evaluate` (page JavaScript, the escape hatch Mika chose).
- **Setup:** the installers copy the extension to `~/.dreamgraph/bin/browser-extension` and run `dg browser setup` (writes the host launcher and manifest to `~/.dreamgraph/browser/`, registers it for Chrome, Edge, Chromium and Brave: HKCU registry on Windows, NativeMessagingHosts folders elsewhere). The user loads the extension once (chrome://extensions → Developer mode → Load unpacked). `dg browser status` and Config → Computer Use → *Browser for Computer Use* show whether it is connected. Chrome Web Store listing later.

**Dialogs are handled by the backend, not left to the model's diligence.** Field finding (2026-10-04, Web64 *New file*): a `window.prompt` blocked the page; the runtime reported *"click interrupted by JavaScript prompt"*, but every later call hung on page-bound CDP commands (`Emulation.setFocusEmulationEnabled`, `Input.dispatchMouseEvent`) and `tab.getJsDialog()` answered *no open dialog* while the prompt was showing; the operator had to click OK. The Codex app has the same flaw.

Verified on Chromium 141 (probe): while a dialog is open every page-bound command blocks (`Input.dispatchMouseEvent` for the click that opened it does not return); `Page.handleJavaScriptDialog` on the attachment that saw it answers it at once; **a new attachment can neither see nor answer a dialog that opened before it** (`Page.enable` blocks, `handleJavaScriptDialog` → *No dialog is showing*). Hence the rules:

- The attachment is never dropped during a run; dialog state lives with the attachment holder (extension) and in the controller, from `Page.javascriptDialogOpening/Closed`.
- An action that opens a dialog returns at once with the dialog (type, message, default value); every result reports an open dialog until it is answered.
- While a dialog is open only `browser_dialog` is accepted; everything else is refused with `DIALOG_OPEN` and nothing is sent to the page.
- A timed-out command is classified: a dialog the extension saw → reported; otherwise `TAB_UNRESPONSIVE` (e.g. a dialog that was already open before DreamGraph took the tab).
- `beforeunload` ("leave page?") is handled the same way. File inputs are intercepted (`Page.setInterceptFileChooserDialog`), so the OS picker never opens; `browser_file_chooser` sets the files.
- **OS file dialogs** (File System Access `showSaveFilePicker` / `showOpenFilePicker` / `showDirectoryPicker`, e.g. Web64 *Save*): a page hook (main world, via `Runtime.addBinding`, which needs `Runtime.enable`) reports the picker as `FILE DIALOG OPEN` with its suggested name and types, input is held (`FILE_DIALOG_OPEN`) until it is answered, and `browser_file_dialog` (full path, no path for a save, or cancel; `overwrite` for an existing file) answers it on the desktop through the browser host (`file-dialog.ts`, Windows PowerShell with a small Win32 helper). Afterwards the hook reports what the page received. Finding (Chromium 141): `Page.setInterceptFileChooserDialog` also aborts these pickers ("Intercepted by Page.setInterceptFileChooserDialog()"), so the hook holds the picker call (≤ 3 s) until the controller has switched interception off for it, and switches it back on afterwards. macOS/Linux report *unsupported* until their desktop helper exists. `dg browser selftest` checks prompt, confirm and the OS save dialog on the user's machine without a model (passed on Finnish Windows, 2026-10-05).
- **Windows Save dialog, language-neutral** (field findings 2026-10-05, Finnish Windows):
  - UI Automation does not expose the dialog's bottom panel. The script uses Win32 controls with fixed ids: the file name field is the Edit inside the combo box of control **1148**, Save is **1**, Cancel **2** (sent as WM_COMMAND to the button's parent). Nothing is matched by visible text.
  - The folder view's items carry automation ids "0", "1", "2"… (the button ids) and editable names (`System.ItemNameDisplay`): setting a value there renames a file. Nothing in the folder view is ever used.
  - The dialog takes the file name only from real keyboard input (WM_SETTEXT/WM_CHAR show the text, but Save uses its own default name). The script focuses the field, verifies that the dialog is in front and the field focused, types the path as Unicode key events (any keyboard layout) re-checking focus as it types, reads it back, and only then sends Save.
  - On Save the dialog creates and deletes a test file at the path, so a file check right after Save proves nothing; the page hook's received name is the evidence.
  - Overwrite confirmation: answered by button id (6 Yes / 7 No, or a task dialog), No unless `overwrite`.
- **Files:**
  - **Blocked folders:** Chrome refuses sites access to system folders (AppData including Temp, Program Files, Windows, `~/.ssh`, `~/.gnupg`) with its own page; such paths are refused before the dialog is touched (`chromeBlockedLocation`).
  - **Default save folder:** a save without a user-named location goes to the instance's `<master>/<uuid>/runtime/temp/<suggested name>` (`-2`, `-3` … when taken); the session guidance also gives the project root for "save it in the project". Open and folder dialogs need a path.
  - **Graph-bound saves:** a save of a file the project scanner tracks (`isScannerTrackedFile`: code and auxiliary files outside generated folders) inside a configured repository is a source change made by the browser. It is recorded in the change-obligation ledger like any source effect: an observed intent before the dialog is answered, the observed hash once the page has written the file → `reconciliation_pending`. It is refused when no managed execution can record it. Application artifacts such as a `.web64proj` get no source obligation; their graph record is a feature or evidence entry.
- **DreamGraph's own pages are never operated.** Field finding (2026-10-04, Codex CLI run): the agent navigated the Architect tab itself to Config and back; the page reloaded mid-pass, the chat came back empty and the header showed *unbound*. `dreamgraph-browser` refuses tabs, `open` and `navigate` for the loopback ports of every running instance (`<master>/<uuid>/runtime/server.json`) with `BROWSER_TAB_PROTECTED`, and marks them in `browser_tabs list`. The Architect page now also survives a reload during a pass: chat history restores the plan conversation (it read the project conversation before), a running pass is shown and replaced by its answer when it ends, and the project label is no longer cleared by updates that carry no project scope.

Tests (no model): `tests/computer-use-browser-files.test.ts` (blocked folders, default save folder, graph-bound saves), `tests/execution-browser.test.ts` (schemas, execution binding), `tests/computer-use-required-tools.test.ts`, `tests/scanner-tracked-file.test.ts`, `tests/computer-use-governance.test.ts` (Autonomous approvals, Pass Report evidence, Codex instructions), `tests/browser-controller.test.ts` (dialog rules with a scripted transport), `tests/browser-host.test.ts` (host ⇄ daemon, token, tab ownership, detach on disconnect, user cancel), `tests/browser-bridge-protocol.test.ts`, `tests/browser-chromium.test.ts` (real Chromium when available: prompt from a click, code editor typing, confirm, canvas drawing, file chooser, leave-page). Also verified here end to end with the real extension and host loaded in Chromium.

Desktop helper (Windows UI Automation + the existing exclusive input seat) follows. Same contract, same UI.

## Retirement of the closed harness

The operator-prepared harness (Harness… drawer, Prepare/Allow, worker/target profiles in Config, `computer_preparation_id`) is retired once stage 1 is verified: UI, routes and configuration panels are removed; reusable journal/evidence pieces stay where the new backends use them. Documentation and the user guide describe only the common contract.

## Slices

1. **Contract** — common grant decision for Codex and API engines in the Architect UI (*Allow for next message*, *Allow once and run again*); daemon grant for API passes; `request_computer_use` on the API engine uses the common request box. Codex path untouched.
2. **`cua-runtime` backend** — `src/computer/cua-runtime.ts` (discover, spawn, tools, call with retry and images, release) + native tool loop integration + granted guidance + iteration cap.
3. **Evidence parity** — transcript/cleanup log paths in the route; readable trace titles; Pass Report tool trace and graph updates from the host trace (v14.0.2).
4. **Retire the closed harness** — UI, routes, Config profiles; docs and user guide.
5. **`dreamgraph-browser` backend** — built 2026-10-04 (extension, host, controller, tools, setup, tests); Windows file dialogs and selftest 2026-10-05; live API run passed 2026-10-05; Codex CLI route 2026-10-07.

Acceptance (stage 1): the bounded Web64 IDE test prompt on the API engine (gpt-6.1-sol) with policy `allow` operates the already-open local IDE tab with no setup beyond the policy, and the tab is released at pass end.

Acceptance (stage 2, passed 2026-10-05, OpenAI gpt-6.1-sol, about $0.40): the native API tool loop selected the existing Web64 IDE tab, wrote the HELLO WORLD program, answered the OS Save dialog with the requested project-root path (`hello-world.web64proj`), built (49 bytes, 0 diagnostics) and ran it, recorded the result as a feature, and released Computer Use. Follow-ups found in that run are fixed in v14.0.2 (approval clicks in Autonomous mode, busywork after success, empty Pass Report sections).
