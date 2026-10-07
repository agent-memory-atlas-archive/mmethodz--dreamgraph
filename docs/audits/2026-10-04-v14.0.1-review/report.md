# DreamGraph v14.0.1 implementation review

Reviewed 2026-10-04. Release source: `v14.0.1` / `4ee3d5ee6f2cf8bd5231b43dfd92fbc73c915725`. Working baseline: `d7b212f`, which adds the field-confirmed project state. Scope: implementation, release evidence and the seven supplied Architect screenshots. This review changes no product behavior.

## Assessment

**v14.0.1 is a credible practical baseline. Keep it, and make the next patch address specific reliability gaps rather than another overhaul.** The configuration redesign is a substantial usability improvement. Codex CLI Computer Use, including normal termination, is established by maintainer testing. Migration now works across all seven tested instances. These conclusions stand alongside the defects below: successful normal operation and incomplete failure handling can both be true.

The highest priorities are truthful Computer Use release confirmation and dependable bounded graph retrieval. Configuration persistence itself is supported by evidence; its UI can nevertheless misreport a failed readback or activation and can discard an unsaved repository draft. These are narrow, reproducible corrections.

### Established baseline

| Area | What is established | Qualification boundary |
| --- | --- | --- |
| Architect workspace | Config, Schedules and Status are permanent tabs; Explorer opens separately through a light blue link. | Preserve this workspace structure and Web64 V2 direction. |
| Configuration | Organized, plain-language controls; persistent instance settings; daemon validation, revision checks, template recovery and undo. | Persistence does not imply every success/error message is accurate. See F3–F4. |
| Computer Use | The Codex CLI adapter works in practical use and releases browser control on the tested normal path. | This does not qualify every error response, native desktop surface, API adapter or platform. See F1. |
| Migration | `dg graph-upgrade` completed on seven maintainer-tested instances. Historical rows are retained. | Structural migration deliberately preserves unresolved references; it does not prove all relations are semantically correct. |
| Release | v14.0.1 versions, packages, GitHub assets and owned website were synchronized and verified. | Remote CI/CodeQL did not run because of the recorded GitHub billing lock. |

The [current project state](../../ashoka/project-state.md) is the source for the seven-instance confirmation. The original [release notes](../../../RELEASE_NOTES_v14.0.1.md) record six; the later confirmation supersedes that count without rewriting sealed historical evidence.

## Findings

Priority P1 means address promptly in the next corrective patch; P2 means a concrete reliability or usability defect. Neither label reopens a verified Ashoka slice or demands new platform qualification.

### F1 — P1: An unavailable browser can be falsely reported as released

**Reproduced against the release source with a local fake Computer Use server.** A tool response with `isError: true` and text `Browser connection unavailable` produces:

```text
tab outcome: gone
turn_ended: skipped
reported release confirmed: true
```

The `GONE` expression includes generic words such as `unavailable`, `missing` and `stale`. Any matching non-retryable error becomes `gone`; an all-gone result is accepted without a turn-end reply. The CLI bridge then records `browser_release_confirmed`. A transport or permission failure is not proof that the controlled tab ceased to exist.

Sources: [error classification](../../../src/architect/codex-cua-release.ts#L73), [confirmation predicate](../../../src/architect/codex-cua-release.ts#L45), [CLI consumption](../../../src/architect/cli-bridge.ts#L284).

**Correction:** recognize explicit, target-specific absence evidence. Unknown runtime, connection, authorization and lookup failures must leave release unconfirmed. Preserve the proven bind-and-turn-end cleanup path. Retain the existing distinction between input release and confirmed process termination; do not collapse either into “Stop complete.”

**Regression evidence:** connection unavailable, permission missing, wrong browser/session, no response and malformed response remain unconfirmed; an explicit missing target and a successful turn-end reply retain their intended behavior. The present tests cover a rejected Stop hook but not the generic-error classification.

### F2 — P1: Large diagnostic metadata still blocks agent graph reads

**Observed on the live MCP connection; the relevant source behavior is present in v14.0.1.** These read-only requests returned:

| Request | Result |
| --- | --- |
| `graph_health_report({})` | `OUTPUT_LIMIT_EXCEEDED` |
| `query_resource`, `system://features`, filter `id: standalone_architect`, v1, `max_bytes: 65536` | `ENVELOPE_BUDGET_TOO_SMALL` |
| Same filtered request, explicit legacy contract | Success: one feature record |

The source gathers diagnostics for the resource family before applying the record filter, then includes all those reasons in every page envelope. Metadata can exhaust the budget before any record is selected. **65,536 bytes is already the schema maximum**, so the error's advice to increase the budget is unusable here. Narrowing the record filter does not narrow these reasons.

Sources: [query limit](../../../src/resources/resolver.ts#L71), [family diagnostics](../../../src/resources/resolver.ts#L183), [filter and page construction](../../../src/resources/resolver.ts#L206), [health response containing canonical state](../../../src/tools/graph-health.ts#L463). Explorer has its own [diagnostic compaction](../../../src/graph/snapshot.ts#L408); that fix does not cover these agent routes.

**Correction:** provide a bounded diagnostic summary, counts and a way to retrieve the complete details separately. Scope applicable reasons with the selected records while retaining necessary global warnings. Give graph health a usable bounded summary. Preserve provenance and completeness; do not silently clip records or hide diagnostic loss.

**Regression evidence:** a migrated graph with thousands of diagnostics must support one-feature retrieval, a complete paged traversal and a small health summary at the documented limits. An explicit legacy read remains a compatibility escape hatch, not the final agent contract.

The connector still advertises v13.4.0 in its tool descriptions, and this review did not restart it or establish its exact process commit. Accordingly, the live result is labeled operational evidence rather than an exact-tag daemon test. The resolver defect is independently visible in the reviewed source. See [captured requests and results](mcp-observations.json).

### F3 — P2: Configuration can show success after failed readback or activation

**Two isolated UI probes reproduced this.** A failed Reload request ends with green `Reloaded from engine.env.`. A save receipt accompanied by `activation.status: restart_required` ends with green `Saved 1 setting. Changes apply to new work right away.` when the receipt's static restart-key list is empty.

`load()` catches its error without returning failure or rejecting. Callers overwrite its message with success. Separately, `save()` checks `receipt.restart_required` but ignores the distinct runtime `activation` result. The server deliberately separates the durable save from activation, rolls runtime settings back on activation failure, and reports that outcome.

Sources: [load/save/retry/undo](../../../src/server/configuration-workspace.ts#L777), [Reload handler](../../../src/server/configuration-workspace.ts#L851), [activation failure handling](../../../src/server/dashboard.ts#L108), [apply response](../../../src/server/dashboard.ts#L835).

**Correction:** preserve three explicit outcomes: saved, activated and read back. Propagate load failure; display “Saved; activation unconfirmed—restart/read back” when appropriate. Apply the same handling to exact retry, undo and template operations. A successful durable save must not be relabeled “not saved” merely because its follow-up read failed.

**Regression evidence:** committed save plus activation failure; committed save plus lost readback; failed Reload; recovered receipt without repeated activation. The banner, effective values and available recovery action must agree.

### F4 — P2: Reload silently discards repository-only drafts

**Reproduced in the rendered Config workspace.** Edit a repository name without changing an engine setting, then press Reload. The result changes from `1 unsaved change` to `No unsaved changes`, restores the old name and invokes zero confirmation dialogs.

The Reload guard checks `Object.keys(D).length`, while repository edits are tracked separately by `repoDirty`. The handler then clears `repos` and `repoDirty`. The general unload guard already knows about both draft classes.

Source: [draft count and Reload/unload guards](../../../src/server/configuration-workspace.ts#L770).

**Correction:** use a shared draft-state check for explicit reload/navigation and preserve drafts unless discard is confirmed. Keep this separate from safe ordinary Architect tab switching, which retains the iframe workspace.

**Regression evidence:** repository-only edits, mixed setting/repository edits and a cancelled discard confirmation. Audit Computer Use profile drafts using the same principle without combining their separate save protocol.

### F5 — P2: Config capability status disagrees with Codex execution

**Reproduced at policy resolution and visible in screenshot 2.** For `codex-cli`, `gpt-6.1-sol`, effort `xhigh`, the inspection-style policy reports `capability_required`. With the exact adapter/model capability shape supplied by `nativeCliModelExecution`, the policy is `configured` with no diagnostics.

The `/api/config/v1/roles` inspection omits the CLI capability evidence that execution supplies. The UI therefore warns about a configuration the actual adapter can use. This is a status projection inconsistency, not evidence that the maintainer's working Codex route is broken.

Sources: [role inspection](../../../src/server/dashboard.ts#L821), [effort/capability checks](../../../src/config/role-policy.ts#L136), [native CLI policy construction](../../../src/cognitive/model-execution.ts#L157), [status rendering](../../../src/server/configuration-workspace.ts#L306).

**Correction:** inspection and execution should consume the same adapter capability resolver, with requested, configured and successfully probed states distinguished. Do not make a paid request just to render Config. Where capability is genuinely unknown, say so without inventing an execution failure or silently dropping effort.

**Regression evidence:** matching inspection/admission status for Codex and Copilot configurations, including unsupported effort and missing capability cases.

## Comments and inconsistencies

### Preserve what improved

- **Configuration information design:** task-oriented pages, units, explanations, advanced disclosure and a persistent save bar make engine settings usable. Keep the raw inventory as an advanced escape hatch. This is a better foundation than another control framework rewrite.
- **Permanent operational tabs:** mounting the existing workspaces in retained iframes preserves their owners and drafts while putting them where users work. The origin/source checks on workspace navigation are useful. Keep this implementation unless a concrete integration problem warrants changing it.
- **Migration semantics:** the implementation distinguishes recorded later revisions from unordered conflicts, preserves older rows, verifies backups and retains reviewed restore. It does not guess missing endpoints. The focused history/recovery tests passed.
- **Instance isolation:** scoped cookies address the real multiple-port browser problem. Fresh document navigation can recover a stale cookie without making invalid API credentials valid. Retain that distinction.
- **Validation counts:** a shared latest-assessment pipeline is a worthwhile correction. Preserve separate labels for unique dreams, assessment rows, promoted edges and currently rendered connections rather than forcing unlike quantities to match.

### Model controls should explain their actual effect

The Models page always renders a Creativity slider, while the policy resolver deliberately omits temperature for unsupported or unqualified model/adapter combinations. The roles inspection also omits `temperature_control` from its response. A visible adjustable control can therefore imply an effect it does not have. This repeats, in a smaller form, the earlier Autonomy/Verbosity concern.

Expose the existing support decision and reason: disable or annotate temperature when omitted, show the effective value when supported, and preserve cognitive role instructions regardless. Similarly, effort help says “others ignore it,” whereas the policy can refuse unsupported requested effort. Describe the actual behavior. Sources: [role card](../../../src/server/configuration-workspace.ts#L331), [temperature policy](../../../src/config/model-temperature.ts#L19), [role response](../../../src/server/dashboard.ts#L825). This review did not make new claims about current provider APIs or run paid model probes.

### Fix contradictory explanatory copy

| Surface | Inconsistency | Suggested wording/behavior |
| --- | --- | --- |
| Computer Use configuration | Says DreamGraph “only listens on this machine,” but explicit authenticated remote mode exists. | Derive the statement from effective HTTP policy; loopback is the default, not a universal guarantee. |
| Missing Codex runtime error | Instructs users to keep the desktop app running; release notes correctly say that is unnecessary for the working CLI route. | Explain the required installed runtime/plugin and discovered failure, without adding an app-running requirement. |
| Role status | `none · model via codex-cli` looks like “no provider,” even though CLI routing is intentional. | Lead with the adapter/subscription route; keep the internal provider identifier in details. |

Sources: [Computer Use copy](../../../src/server/configuration-workspace.ts#L541), [HTTP policy](../../../src/server/http-policy.ts#L13), [runtime error](../../../src/architect/cli-bridge.ts#L634).

### Make status useful without weakening its meaning

The right rail's `completed (reported)`, `Verified: 0`, `Reported complete: 32` and `review_required` can all be correct together. They distinguish imported implementation history from daemon-governed lifecycle evidence. **Do not relabel external Codex work as a running DreamGraph execution or silently turn reported progress into verified progress.** Offer one clear optional “Review recorded progress” entry and reduce repeated warnings once acknowledged.

Likewise, `Weather: Blocked` / cognitive not-ready need not mean the Codex CLI route is unusable. Label which role or subsystem is blocked. For graph currency, put the concrete pending obligation or source change next to “stale.” A recent mutation is useful activity evidence but does not itself settle every obligation; an old full scan does not establish staleness. The current [canonical read model](../../../src/graph/read-model.ts) explicitly derives source currency from change obligations. The screenshot alone does not prove that its stale flag is wrong.

The screenshots show v14.0.0 chrome. Repository package metadata and release evidence are v14.0.1. This could be an older running build; it is not sufficient evidence of a failed version bump. Show running version/build and instance identity in a compact About/status area. The historical plan title “DreamGraph v14.0.0 - Ashoka” can remain unchanged.

### UI finishing work

The supplied desktop views are organized and substantially clearer. Retain their compact typography, blue links, grouped controls and available-height layout. Further refinements should be small:

- Keep effective-setting or error feedback near the relevant control, with the save bar summarizing pending work.
- Prefer one vertically scrolling content area; avoid a second independent scroll area inside an individual settings card.
- Check the existing UI at a narrower window and increased browser zoom so forms still fill the center without clipping actions. Screenshots at one desktop size do not establish this behavior either way.
- For schedules, retain the human-readable preview and make the timezone, next run, latest result and pause reason easy to compare. A rendered creation form is not proof of a completed scheduled dispatch.

These are suggestions, not additional v14.0.0 qualification requirements. Explorer needs no redesign for this review.

## What's next

| Order | Bounded work | Completion evidence |
| --- | --- | --- |
| 1 | Fix F1's cleanup classification and F2's agent response limits. | Error-path release proofs; usable bounded health and filtered/paged reads on a diagnostics-heavy migrated fixture. |
| 2 | Fix F3–F5 and make model-control effects explicit. | Save/activation/readback remain distinct; drafts survive; Config and adapter admission agree. |
| 3 | Add an operator recovery path for unsettled CLI runs, already documented as a limitation. | Inspect effects, ownership, outstanding graph/plan obligations and release evidence before settlement. Never mark an uncertain run successful merely to clear a badge. |
| 4 | Collect a small real-instance schedule lifecycle record using existing environments. | Create/preview, dispatch, pause, cancel, restart/readback and recent-run visibility agree; use a disposable, non-paid action where possible. Existing automated schedule tests remain valid. |
| 5 | Add a reviewed unresolved-reference repair workflow and clearer graph/status explanations. | Dry preview, typed identity mapping, backup/recovery and before/after counts; no arbitrary endpoint selection. Keep migration separate from semantic repair and source reconciliation. |
| 6 | Grow community evaluation and regression evidence from field use. | Versioned fixtures, model/adapter provenance, matched tasks and measured outcomes. Fix remote CI availability administratively and rerun it when available; do not count unstarted jobs as passed. |

I would scope the next corrective release around orders 1–2, then select orders 3–5 from actual maintainer/user friction. Native API Computer Use, native desktop/dialog work and additional platform qualification remain explicitly deferred unless separately requested. The existing accepted Windows/WSL2 release scope is sufficient; this review introduces no new environment gate.

## Evidence and limits

- Reviewed the patch's changed areas in configuration, schedules, CLI Computer Use/cleanup, migration, session handling, model admission, graph projections and release records. This is a targeted implementation review, not a claim that every v14 subsystem was independently revalidated.
- Concurrent working-tree edits to native API context allocations, failure reporting/termination and their budget tests appeared during the review. They are untouched and excluded from this release assessment. The 54-test run is a focused working-checkout check, not another sealed clean-tag qualification; the prior release gate remains the clean-source evidence.
- Re-ran **54 existing tests across six focused files: 54 passed, 0 failed, 0 skipped**. See [test summary](targeted-tests.json). These cover configuration, schedule UI, release handling, migration history/execution blockers and session authority.
- Ran **five isolated review probes** against source: cleanup classification, failed Reload, activation-warning handling, repository drafts and CLI capability projection. See [observations](probes.json) and [reproduction script](reproduce.mjs). They demonstrate defects/inconsistencies and are **not additional passing acceptance tests**.
- Captured [live MCP read results](mcp-observations.json); the explicit legacy query returned one matching feature. No claim that every graph retrieval route fails.
- Existing sealed [release evidence](../../ashoka/release-14.0.1-evidence.json): root **2,127 passed**, **2 retired particle skips**, **197 files**; editor **546 passed**; **11 isolated-browser-worker checks**; package-upgrade qualification with **14 recorded checks**. Those are prior release results, not reruns performed by this review.
- Maintainer evidence establishes practical Codex CLI Computer Use and seven successful instance migrations. This review performed no live upgrade, install, restart, real browser-control operation, paid canary or new platform qualification. It does not claim measured agent-understanding improvement.

To repeat the isolated probes from the repository root:

```powershell
node --import tsx docs/audits/2026-10-04-v14.0.1-review/reproduce.mjs
```

The script imports the current working source and prints observations. After fixes, its output should change; convert the relevant cases into permanent behavioral regression tests with the corrective patch.
