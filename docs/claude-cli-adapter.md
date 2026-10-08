# Claude CLI adapter for Architect

Implementation status: **enabled for the Windows profile below; source ready for release handoff**. This is subsequent work on the v14.0.2 baseline, not a released v14.0.2 feature. Conversation, authority and browser/upload qualification used real Claude. The additional Save run exposed Chrome's separate file-type warning and premature no-change settlement; both are now corrected and verified through the shared backend without another model run. No installation or daemon restart was performed by qualification.

## Installation and authentication

Use the unmodified official Claude Code native installer. DreamGraph recommends Git for Windows. In PowerShell:

```powershell
irm https://claude.ai/install.ps1 | iex
& "$HOME/.local/bin/claude.exe" --version
```

The default native executable is `%USERPROFILE%\.local\bin\claude.exe`. DreamGraph discovers the executable on PATH and then in that location, including when the daemon has an older PATH. An optional absolute `DREAMGRAPH_ARCHITECT_CLAUDE_CLI_BINARY` override takes precedence; an invalid override fails without fallback.

Use a **separate PowerShell window** for the dedicated DreamGraph login:

```powershell
$env:CLAUDE_CONFIG_DIR = Join-Path $HOME ".dreamgraph/claude-cli/config"
& "$HOME/.local/bin/claude.exe" auth login
& "$HOME/.local/bin/claude.exe" auth status --json
```

Complete the official browser login with a Pro or Max subscription. DreamGraph checks official auth status; it never reads, copies or exports subscription tokens. Do not put API credentials into this profile. No API fallback, custom OAuth flow or token entry field is provided.

The live-tested baseline is **Windows / Claude Code 2.1.293 / no explicit reasoning effort**. Stable numeric CLI releases at or above 2.1.293 are accepted when the per-launch profile and stream checks pass; there is no exact-version lock. Automatic updates therefore do not disable the adapter merely because the version changed. The actual probed version must match startup, and each successful pass records it as `profile_verified_at_launch` alongside the live-tested baseline. A changed or unverifiable boundary/output format fails closed and requires investigation/requalification; a newer version is not described as independently live-tested. Live evidence used `claude-sonnet-5`; it is not a model allowlist. Sonnet, Opus, Fable and other Claude models use the same CLI/graph/Computer Use contract. Select a full model ID supported by your installed CLI and account; startup must report that exact ID. Explicit effort is now model-validated from documented CLI support and covered by offline argv/admission tests; the recorded live runs remain Default-effort evidence. Additional account profiles and platforms remain separately qualified. The maintainer's observed account was Max. This does not promise unlimited subscription use or support for every future CLI version.

## Architect configuration

Config → Architect contains the Claude engine, model and optional executable path. Select the full Claude model ID from the dropdown, or use Other to enter a custom ID (for example `claude-sonnet-5`, `claude-opus-5-5` or `claude-fable-5-1`, subject to CLI/account availability). Clear any previous explicit reasoning effort with Default; unsupported effort is refused rather than ignored. The setup check reports binary/auth/profile state without running inference. A successful check confirms the CLI/login profile without inference; model availability is confirmed on dispatch. An older/unparseable version, malformed model ID, unsupported explicit effort, incompatible managed policy or login fails with its reason. The setup check alone does not attest the tool catalogue; that is verified from the actual launch stream before the effect gate opens. Installation and authentication remain distinct from qualification.

Each pass uses a fresh CLI process. DreamGraph supplies the current request and the retained conversation belonging to the authenticated session and selected plan/project scope. It never uses native `--resume` or `--continue`. Historical claims are context, not approval or proof. Missing/corrupt history requires review; oversized retained context is refused without silently clipping it into a successful pass.

## Reasoning effort

Advanced runtime controls and Config → Architect share model and effort choices. Codex includes Max. Claude CLI accepts low, medium, high, xhigh and max on Opus/Sonnet/Haiku 5.5, Fable 5/5.1, Mythos 5/5.1, Opus 5/4.8/4.7 and Sonnet 5. Opus/Sonnet 4.6 and Mythos preview exclude xhigh. Unknown model IDs remain usable with Default; explicit effort requires a named capability record.

DreamGraph passes `--effort <level>`, excludes `CLAUDE_CODE_EFFORT_LEVEL` from the child environment, and refuses unsupported combinations before launch. `ultracode` is rejected because it enables orchestration rather than selecting effort. Switching models preserves an incompatible selection visibly until the user chooses a supported level or Default. Choosing Default clears the explicit override; native CLI/API defaults remain route-specific.

Claude Code documents medium defaults for the 5.5 models, high for most other current models and xhigh for Opus 4.7. API defaults differ (for example Sonnet 5.5 and Opus 4.7 use high). No guessed default is sent. Organization-side caps can still lower CLI effort; the requested argv value is not independent evidence of server-effective effort. Existing profile/auth/authority checks remain required.

Native Anthropic requests use `output_config.effort` with adaptive thinking for these reasoning models, never a fixed `budget_tokens` field. Opus 5.5 stays adaptive even with Default. Regression tests cover both completions and native tool turns, without new paid inference.

Sources checked 2026-10-08: [Claude Code model configuration](https://code.claude.com/docs/en/model-config), [CLI reference](https://code.claude.com/docs/en/cli-reference), [Anthropic API effort](https://platform.claude.com/docs/en/build-with-claude/effort).

## Authority and limits

Only the execution-bound DreamGraph MCP server is connected. Native tools, agents, skills, hooks, extra MCP servers, Claude Chrome, plugin installation and session persistence are disabled by the qualified launch profile. Relevant Windows managed-policy presence is refused, not overridden. The environment excludes ambient API credentials and runtime injection settings.

The MCP effect gate stays closed until the exact init profile, model, version, server and tool catalogue validate. Calls queued before revocation are checked again before dispatch. A terminal result revokes further calls. This is a controlled configuration boundary, **not an operating-system sandbox**; init validation also cannot prove that zero provider inference occurred before init.

DreamGraph still owns scope, approved arguments, manual/supervised/autonomous limits, receipts, required graph context, reconciliation and continuation. All mutations go through its tools. The CLI cannot promote its own answer into canonical plan verification. Missing authority stops an effect; it does not authorize another route.

Calls and approvals remain within the host's finite deadline. The initial profile caps each CLI pass at twelve turns and disables automatic retries. Subscription runs retain finite non-money budgets. Claude's `total_cost_usd` is diagnostic/list-price information, not evidence that an API account was charged; measured input/cache/output token components remain separate from UTF-8 byte limits.

## Computer Use

Claude uses DreamGraph's existing `browser_*` MCP tools. There is no additional backend and no Claude-native or Codex fallback. Native Anthropic API Computer Use remains a separate existing route.

1. Run `dg browser setup` if the browser native host has not been registered.
2. Open Chrome's extensions page, enable Developer mode, and load the DreamGraph browser extension folder unpacked. Config → Computer Use shows the installed extension path and connection state.
3. Connect the extension to the DreamGraph browser host and verify that Config → Computer Use reports it connected.
4. Choose Allow, Ask every time, or Deny. With Ask, approve only the intended message. A missing grant cannot be replaced by a model's assertion that approval exists.

The existing extension and host provide screenshots, browser actions, file choosers and Windows native file dialogs. The real Claude run observed two screenshots, clicked a fixture control, completed a file chooser upload, verified the page and released control. A later, explicitly authorized Claude native Save run targeted a scanner-tracked `.js` file in a disposable project. It failed: the first dialog call reported done, the page never confirmed completion, and the file was absent. A second model-issued dialog call reported not_found. Both graph observations prematurely settled as unchanged despite the unresolved picker outcome. The Chrome-warning handler and settlement correction below now have independent live shared-backend evidence; the original failed Claude run is retained, not reclassified as a pass. Browser release was confirmed. No additional model run was attempted. Native Open still relies on shared-backend evidence. An explicit `cua-runtime` backend preference is unsupported for Claude; Auto still requires the DreamGraph extension.

## Stop and recovery

The host revokes the tool gate and uses bounded Windows process-tree termination. It separately observes the registered MCP proxy's exit. Parent exit, successful prose, an audit file, or cancelling a wait alone is insufficient proof that all work ended.

Unconfirmed termination exposes the retained process identities and managed recovery state. Browser detach or pending-save reconciliation failure is not reported as successful release. Inspect original owner receipts before retrying any uncertain mutation; never repeat it merely because its reply was lost.

## Evidence and release handoff

See [G0 evidence](qualification/claude-cli/g0-windows-2.1.293.json) and the governed plan `plans/claude-cli-adapter.md`. Offline fixtures cover protocol failure, tool gating, proxy exit, selected-conversation isolation, browser route/evidence, configuration persistence and existing adapter regressions. Shared managed-execution tests provide the existing authority/recovery baseline.

[Qualification evidence](qualification/claude-cli/qualification.json) records A02 (approved source edit with durable receipts and enforced refusal), A07 (selected-conversation follow-up) and A12 (screenshots, click, file chooser and release). On 2026-10-08 the user authorized proceeding with the additional bounded checks: three additional runs completed, with twelve-turn limits, four-minute conversation deadlines and a ten-minute CU deadline. The first harness assertion expected bare tool names; the actual edit succeeded and its evidence was retained without replay. The follow-up used that recorded answer in a declared disposable transcript fixture. Daemon refusal was independently injected at the real owner boundary; it was not inferred from the model's refusal alone.

The post-review enabled-source regression run passed 149 tests across 15 files, with the live harness explicitly skipped in ordinary CI. Live runs are opt-in through `tests/claude-cli-live.test.ts`; `DG_CLAUDE_LIVE_CASE=preflight` performs no inference. New live runs require their own bounded allowance. Published evidence excludes raw credentials, unrelated browser-tab listings and screenshot data.

Release handoff: assign the next release version separately, include these implementation/setup notes and qualification evidence, perform the established packaging/version/release workflow, then install and restart the desired instances. After installation, select Claude CLI in Config → Architect, select your desired full Claude model ID, choose Default reasoning effort, and run the official-profile check. Opus/Fable and other CLI-supported models are selectable through the same contract; Sonnet is the live-tested model, not a product restriction. Newer CLI versions must pass launch validation; additional platforms remain explicitly unqualified. No new platform qualification or redesign is required for this handoff. Ask/request-only, ungranted execution refusal, wrong-execution refusal and protected-page tests are named explicitly in qualification.json; they are offline boundary evidence, not live Claude grant-dialog demonstrations.

Official interface references: [CLI reference](https://code.claude.com/docs/en/cli-reference), [settings](https://code.claude.com/docs/en/settings), [environment controls](https://code.claude.com/docs/en/env-vars), [managed settings](https://code.claude.com/docs/en/managed-settings). Recheck these and run the qualification gates when the launch boundary or required output format changes.


## Chrome file-type Save confirmation (2026-10-08)

Chrome can show a second warning after the Windows Save picker for executable source formats such as `.js`. This is browser-owned UI, not a JavaScript `confirm()` or the Windows file picker. The shared `browser_file_dialog` flow now handles that second stage through a distinct Chrome Views/UI Automation helper. It requires a pending Save, the controlled tab's current origin, the matching filename/extension, a unique browser-owned dialog and a recognized Save/Don't save pair. It invokes Save, never a generic Enter (Chrome's default may be Don't save). English and Finnish pairs are supported; Finnish was verified live. Unknown languages, mismatches and ambiguity remain explicit `needs_confirmation`.

An unresolved tracked-source Save now keeps its observation open, reuses it across retries, and records a later stable write. Unchanged bytes alone no longer prove no effect. Release still detaches/closes the browser connection but reports recovery-required if the save observation remains unresolved.

The opt-in `DG_NATIVE_SAVE_LIVE=1 npx vitest run tests/browser-native-save-live.test.ts` check passed on the real Chrome/extension: a deliberately wrong origin pressed nothing; the correct Finnish Save confirmation completed automatically; the exact JavaScript bytes, one source obligation, intent/observed commit receipts, page completion and release were verified. The obligation remains `reconciliation_pending`; this does not claim completed semantic reconciliation. The test uses checkout desktop helpers alongside the installed extension; host/client ownership and origin routing are covered by offline tests. Focused regression: 32 tests across five files passed; server build passed.

The original failed Claude run is retained in qualification.json, including the later discovery that its requested file appeared after the warning was answered. No further model inference was used. The corrected shared backend was exercised directly; the entire Claude-to-Save chain was not rerun. These are distinct evidence scopes, not a rewritten successful Claude transcript.
