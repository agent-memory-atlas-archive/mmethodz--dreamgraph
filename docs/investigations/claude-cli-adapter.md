# Claude CLI adapter — feasibility investigation

Date: 2026-10-07
Baseline: DreamGraph v14.0.2 source and maintainer-reported practical results
Disposition: sufficient documented interface to prepare a governed implementation; not yet a qualified adapter
Implementation plan: [Claude CLI adapter](../../plans/claude-cli-adapter.md)

## Conclusion

Add a `claude-cli` Architect adapter that launches the unmodified official Claude Code executable and connects it to the existing DreamGraph MCP bridge. The documented noninteractive interface, machine output, structured final results and MCP transport are sufficient for this design. No custom subscription OAuth client, Agent SDK embedding or new Computer Use backend is needed.

The most important qualification is the conversation contract: Claude supplies reasoning and proposals; DreamGraph owns task scope, current graph context, approval, effects, continuation and verification. Every mutation must use DreamGraph tools, matching the Codex CLI adapter: no native shell, editing, direct API or alternate browser fallback. Successful JSON parsing or a working browser demonstration alone cannot qualify the adapter.

Computer Use already works through Anthropic's native API tool loop, and the maintainer reports that Codex CLI has proven the DreamGraph browser MCP path. These establish reusable infrastructure, not proof that a Claude CLI invocation has passed. The new route must receive the same execution-bound `browser_*` tools, image results, grants and release handling.

No Claude executable resolved through this session's PATH. No Claude login, model request, subscription consumption or live Claude browser test was performed in this investigation.

## Documented interface and its limits

| Need | Published interface | DreamGraph consequence |
| --- | --- | --- |
| Scriptable execution | `claude -p` | Launch a real local CLI process. |
| Final machine output | `--output-format json` | Parse a result envelope, not terminal prose. |
| Progress | `stream-json`, `--verbose`, `--include-partial-messages` | Incremental Architect updates. |
| Structured answer | `--json-schema` | Validate final data locally too. |
| Private tool connection | `--mcp-config`, `--strict-mcp-config` | Supply the existing DreamGraph proxy. |
| Native tool restriction | `--tools ""` | Keep repository operations on DreamGraph MCP. |
| Browser route | `--no-chrome` | Avoid a second browser authority. |
| Bounds and model choice | `--max-turns`, `--model`, `--effort` | Qualify actual version/model support. |
| Session identity | `--session-id`, `--resume`, `--no-session-persistence` | Choose explicit ownership, never “latest session.” |

These are documented options, not a tested launch recipe. Help output is incomplete, so absence from help is not conclusive incompatibility. The dollar ceiling is based on an estimate, not a guaranteed invoice cap. [CLI reference](https://code.claude.com/docs/en/cli-reference)

Programmatic runs can report errors on stdout and exit unsuccessfully. SIGTERM can leave an unfinished turn without a final result. Default print-mode startup can execute discovered hooks without an interactive trust prompt. Bare mode avoids much discovery but does not use subscription login; it is therefore unsuitable for the intended subscription profile. [Programmatic execution](https://code.claude.com/docs/en/headless)

Streaming has partial events, completed assistant blocks and a terminal result. Accumulating every representation would duplicate content. The adapter must normalize and deduplicate them while retaining actual bridge tool evidence separately. SDK event documentation informs the parser design; real CLI fixtures must establish its exact wire format. [Streaming output](https://code.claude.com/docs/en/agent-sdk/streaming-output)

Structured output follows tool work and can fail validation/retry limits. It is answer formatting, not evidence that a mutation committed or a slice was verified. Treat the terminal structured result as untrusted input to DreamGraph's existing completion validator. [Structured outputs](https://code.claude.com/docs/en/agent-sdk/structured-outputs)

MCP supports inline image results, so the existing screenshot response has a documented model-visible path. Oversized results can instead be persisted by Claude Code; a file reference is insufficient when native file tools are disabled. Keep graph results paged and screenshots bounded, and qualify actual image delivery without granting native Read or Bash. [MCP support](https://code.claude.com/docs/en/mcp)

## Subscription integration and supported boundaries

Anthropic explicitly permits products to run unmodified Claude Code under the stated Commercial Terms and conditions, including end users signing in to that binary with their own subscription. Built-in authentication choices must remain intact. Developers may not collect or intermediate Claude.ai credentials, resell usage, or present their own Claude.ai login flow. This supports the proposed official-CLI boundary; it does not authorize turning subscription tokens into a DreamGraph API credential. [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)

Authentication remains owned by Claude Code. Use its official login and status commands; DreamGraph stores configuration and sanitized status, not OAuth tokens. API credentials, Console login and cloud credentials can select a different billing path. A running CLI process is therefore not sufficient evidence of subscription billing. A separately authenticated official configuration directory is available when isolation is needed; do not copy credential files into scratch homes. [Authentication](https://code.claude.com/docs/en/authentication)

The help article's June 15 update pauses the proposed Agent SDK billing change and states that `claude -p` still draws from subscription limits. Its older credit table is explicitly historical. Record the observation date and actual account mode; do not promise permanent pricing, unlimited use or a particular allowance. [Current billing notice](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)

### Practical room within the published rules

DreamGraph can host a user-initiated official CLI process, provide scoped MCP tools and context, render its output, and let the user authenticate directly with Anthropic. It can make that experience useful without becoming an unofficial subscription API.

Do not extract refresh tokens, impersonate Claude Code in direct HTTP requests, create a replacement OAuth callback, pool accounts, silently switch billing or work around subscription limits. Native Anthropic API support remains the separate supported route for API workloads. If published policy changes, reassess the affected login/hosting profile rather than invent a workaround.

## Source findings and bounded changes

| Existing component | Finding | Required adapter work |
| --- | --- | --- |
| `src/architect/cli-bridge.ts` | Only Codex/Copilot are implemented; invocation and usage selection contain binary branches. | Add an explicit Claude implementation, discovery, parser and provenance. Do not let Claude fall into Copilot branches. |
| `src/architect/cli-mcp-bridge.ts` | Existing stdio-to-daemon proxy preserves MCP content, audits calls and carries managed context. | Reuse it; qualify Claude's tool catalog and result handling. |
| `src/server/execution-policy.ts` | Effects are scoped to approved arguments/call counts and finite autonomy ceilings. | Preserve these checks for every Claude effect. |
| `src/server/managed-execution.ts`, `src/graph/execution-context.ts` | Host execution and graph receipts already exist. | Reuse admission, context refresh, closure and recovery. |
| `src/computer/execution-browser.ts` | Browser tools locate the session by execution identity and return text/images. | Reuse unchanged unless adapter qualification reveals a concrete defect. |
| `src/architect/cli-bridge.ts` | Browser opening, prompt mode and requestability are Codex-gated. | Admit Claude to the DreamGraph-browser branch; leave Codex-native fallback exclusive to Codex. |
| `src/computer/computer-use-backend.ts` | `plannedComputerUseRoute` otherwise reports unavailable. | Advertise Claude's actual DreamGraph route and missing-extension reason. |
| `src/architect/routes.ts`, `computer-use-ui.ts` | Adapter dispatch and grant UI also enumerate existing adapters. | Wire the new adapter and shared grant capability through these call sites. |
| `src/config/role-policy.ts` | Native CLI currently implies subscription billing. | Establish the actual Claude auth/billing profile before applying that classification. |

The two substantive Computer Use changes are the ones identified by the maintainer: browser-session admission and planned-route reporting. Associated adapter registration, request flags and UI predicates must agree with them; that is integration wiring, not a new backend project.

## Conversation and authority design

1. DreamGraph admits a bounded task and supplies current user intent, selected project/plan/slice, effective autonomy, relevant graph/ADR evidence, receipt identity, limitations and approved effects.
2. Claude inspects this context and retrieves missing evidence through MCP. A selected plan alone never grants implementation authority. Repository-specific conclusions identify their supporting sources and distinguish facts, hypotheses and unresolved information.
3. Every mutation goes through a DreamGraph tool and the existing daemon policy: source, graph, plans, ADRs, configuration, schedules and browser operations. A missing tool or approval means stop. Claude's own permission mode, successful schema output or “continue” request cannot widen scope. Browser access does not authorize repository changes through a browser, dialog, editor or terminal. Effect records and receipts establish the graph binding; pending reconciliation remains pending rather than being reported complete.
4. Tool results retain commit receipts and uncertainty. Refresh required graph context after relevant operations; unchanged context may keep the same receipt. Ordinary browser clicks must not generate unnecessary graph refreshes. Observation-only browser evidence is not promoted to verified project fact automatically.
5. DreamGraph decides whether the task can continue. Manual mode returns after its one specifically approved effect; supervised mode stops at the approved checkpoint; autonomous mode stays within the approved task and finite bounds. None means unrestricted execution.
6. The final answer separates work proposed, attempted, committed and verified, and reports blockers honestly. A CLI success result cannot mark the plan complete. Cancellation revokes further actions immediately; completion waits for applicable termination/release proof.

This is enforceable effect governance plus behavioral qualification. It is not a claim that a host can prove a model understood every supplied fact or will never make an incorrect assertion.

## Remaining qualification risks

- **Configuration and permissions:** tool preapproval is not effect authorization. In particular, noninteractive permission modes can deny MCP tools marked as requiring user interaction even when otherwise allowed. Test the real DreamGraph annotations and approval round trip. Never resolve incompatibility by bypassing permissions. [Permissions](https://code.claude.com/docs/en/permissions)
- **Startup hooks:** disable unintended hooks/config discovery using supported settings, with explicit respect for managed policy. Managed hooks can require administrator configuration; do not claim tool restriction alone isolates startup. Keep any new isolation work bounded to this adapter. [Hooks](https://code.claude.com/docs/en/hooks)
- **Conversation ownership:** start with one fresh Claude process/session per DreamGraph pass, reconstructing the selected conversation from DreamGraph. Native resume is deferred, so remembered approval cannot outlive a lease or cross an instance.
- **Cancellation:** distinguish process exit, released browser control, stopped owned workers and unknown remote billing. Retain recovery-required state where proof is missing.
- **Reporting:** distinguish installed, authenticated, MCP-ready and qualified states. The adapter must not appear fully ready solely because a binary exists.

## 2026-10-07 — Opus review reconciliation

The maintainer supplied an Opus 5.5 review. Its main correction is accepted: qualification must test a fixed launch profile, not merely discover some profile that produces an answer. The plan now pins tool/server restrictions, settings and hook isolation, explicit permission mode, no persistence/Chrome route, controlled scratch cwd and version checks. Empty setting-source behavior remains a binary qualification requirement because the CLI reference does not specify that empty case. [CLI reference](https://code.claude.com/docs/en/cli-reference)

Dedicated official CLI login and an allowlisted child environment replace the earlier looser “do not inject an API key” wording. This matters because print mode uses a present API key without the interactive confirmation. Every launch checks the same configuration's sanitized auth status; the initial profile requires claude.ai authentication. No credential file is opened by DreamGraph. [Authentication precedence](https://code.claude.com/docs/en/authentication)

The fixed profile disables cloud connectors, auto memory and automatic updating, and also checks CLAUDE.md discovery separately. Automatic-update suppression is not proof against manual replacement, so executable/profile changes invalidate qualification. Tool timeouts and idle timeouts are separate, transport-dependent controls; the plan now checks them across the entire bridge path instead of assuming one short universal default. [Official environment-variable reference](https://code.claude.com/docs/ko/env-vars)

Explicit dontAsk mode is accepted, subject to the existing qualification of interaction-required MCP annotations. A server allow rule cannot override those restrictions. Managed hooks remain a prelaunch conflict; an init message is too late to undo one. [Permissions](https://code.claude.com/docs/en/permissions), [hooks](https://code.claude.com/docs/en/hooks)

### Corrections to the review's stronger claims

- **Startup ordering:** official examples expose tools, servers, plugins and permission mode in init, but do not establish a host acknowledgment barrier before inference. The plan therefore combines preflight with a closed MCP effect gate until startup validation. It does not promise zero model usage or prevention of earlier startup effects from reading that event. [Official init example](https://platform.claude.com/cookbook/claude-agent-sdk-07-hosting-the-agent)
- **Hash evidence:** pre/post project manifests detect net file changes. They cannot prove that a write was never restored or that no external effect occurred. Qualification additionally uses controlled write-event fixtures and actual owner/backend receipts; it does not claim arbitrary whole-machine coverage.
- **Scope and release:** shared authority fixtures should exercise Codex too, without prescribing Claude flags to other adapters or reopening their architecture. The release remains unassigned: the review suggested 14.0.3 conditionally, while the maintainer has not yet selected it.

### Confirmed source gap and added acceptance

Current `normalizeArchitectToolName` in `src/architect/tool-selection.ts` strips the colon and dotted forms but not `mcp__dreamgraph__`. `withHostObservedPassEvidence` already strips the double-underscore prefix. Computer Use classification also receives raw names, and the examined tests cover bare/colon forms. This is a concrete adapter integration gap, now included in Slices 1/4 and matrix A18; no runtime fix is claimed in this planning pass.

The revised plan has 18 authority cases, including startup drift, approval-timeout races and prefixed evidence. It requires complete disposable-project change manifests and graph-bound operation reconciliation. The CU canary receives a ten-minute bound while retaining the original three-run cap. `total_cost_usd` is explicitly diagnostic estimated cost, never a charged-spend ledger entry. All seven implementation slices remain pending.

## Evidence and next step

Focused graph retrieval returned accepted ADR-006, ADR-193, ADR-201 and ADR-217; ADR-216's repository mirror was also read. They support real tool execution, provider-neutral authority, CLI/MCP isolation and daemon-owned runtime identity. A broad health response exceeded its output limit, so no whole-graph health verdict is inferred. Focused retrieval and current source inspection supplied the relevant evidence; no scan or maintenance was initiated.

Existing worktree edits in cognition, model admission/pricing, configuration and Anthropic prompt-cache tests were left untouched. They are not attributed to this investigation.

The [governed plan](../../plans/claude-cli-adapter.md) makes authority conformance a prerequisite to public enablement. All implementation slices start pending. Next is a bounded official-CLI protocol/configuration probe, followed by the adapter and its graph-authority tests. Windows is the practical first qualification target; existing WSL infrastructure may be reused without opening additional platform projects.
