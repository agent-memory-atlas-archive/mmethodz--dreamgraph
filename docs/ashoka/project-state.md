# DreamGraph current project state

Updated: 2026-10-07 · Release: **v14.0.2 — Ashoka**

This is the durable reference for established behavior and subsequent maintainer confirmations. It complements the published release notes and sealed release evidence; it does not reopen completed Ashoka slices.

- **Architect operational tabs:** Configuration (Config), Schedules and Status are permanent tabs in the browser Architect. They belong to its normal workspace, follow the compact Web64 V2 UI direction, and fill the available space. Explorer remains a separate route opened through Architect's light blue link.
- **Configuration redesign:** The configuration pages were redesigned in plain language, with grouped settings, task limits and role/budget controls. Template preview/apply/undo, scoped Computer Use profile editing and exact-retry recovery remain available. Configuration edits use daemon-owned validation and revision checks; an uncertain save preserves later drafts.
- **Codex CLI Computer Use:** The adapter's Computer Use integration was fixed and the maintainer now confirms it is working in practical use through browser Architect. This is established functionality for the Codex CLI adapter, rather than merely an implemented but unproven route. Release/cancellation failures still require truthful recovery reporting. That 2026-10-04 confirmation covered the Codex CUA integration in v14.0.1. The v14.0.2 route now uses DreamGraph’s browser backend through the MCP bridge when connected, with CUA fallback; it must not inherit an independent field-test claim merely from the older route.
- **Legacy graph upgrade:** The fixed `dg graph-upgrade <instance>` now completes on **all seven maintainer-tested instances**. This postrelease confirmation supersedes the six-instance count recorded in the original v14.0.1 notes. Historical revisions remain preserved; unresolved references are preserved and require separate repair. The command migrates graph storage and is separate from source reconciliation through `dg scan <instance> --incremental`. The request referred to `dg graph-update`; the actual CLI command is `dg graph-upgrade`.

The practical Computer Use result and seven-instance upgrade result are **maintainer-confirmed on 2026-10-04**. They are separate from the executing agent's automated release qualification and do not represent a new independent model benchmark.

References: [v14.0.1 release notes](../../RELEASE_NOTES_v14.0.1.md), [release verification](release-14.0.1-evidence.json), [configuration workspace](configuration-workspace.md), [Computer Use contract](computer-use.md), [legacy migration](legacy-upgrade.md).

The [2026-10-04 implementation review](../audits/2026-10-04-v14.0.1-review/report.md) preserves this baseline and records five targeted findings for subsequent corrective work, including isolated reproductions and a 54-test focused verification. It does not reopen completed Ashoka slices or expand platform qualification.

## v14.0.2 baseline

- Codex CLI and native OpenAI/Anthropic API routes share DreamGraph’s browser extension/native-host backend when connected. Windows Save/Open dialogs are handled by that backend; Linux/macOS native dialogs remain operator actions. See the [current contract](computer-use-contract.md) for dated API field evidence and route limits.
- Browser setup is now documented end to end: [install, connect and grant a task](../../guide/17-computer-use.md). Config, Schedules and Status remain permanent Architect tabs.
- The already-applied cost fixes preserve stable managed context, compact accumulated transcript context and calibrate estimates against reported provider usage. The release does not reverse `cost-fixes.patch`. The release notes’ Web64 cost comparison is a maintainer observation, not a matched multi-model benchmark.
- [v14.0.2 release notes](../../RELEASE_NOTES_v14.0.2.md) are the release summary. The seven-instance migration confirmation above remains the established field baseline.

## v14.0.2 publication verification

Published tag [v14.0.2](https://github.com/mmethodz/dreamgraph/releases/tag/v14.0.2) and synchronized the [public website](https://dreamgraph.nofs.ai/). The [sealed release evidence](release-14.0.2-evidence.json) records 2198 root test passes, 546 editor test passes, 11 isolated-browser checks and 15 packaged upgrade/recovery checks. Remote CI availability is reported separately in that evidence.

- **Browser upload field check:** DreamGraph's own backend opened Hostinger's standard file input, uploaded the website source ZIP through `browser_file_chooser`, and the deployment completed. Public build and documentation bytes matched the committed website archive. This proves the file-input path on this site; it does not establish the Windows OS Open-dialog path or a new model-driven Codex CLI run.
- **Admission isolation:** Job admission now snapshots saved role profiles under the job's pinned instance and one coherent graph read. Regression cases proved and then eliminated both foreign-instance model selection and interference from a foreign pending publication journal.
- **Release reconciliation:** Unchanged graph context retains its receipt for caching; a real graph change replaces it. Selected-plan history is intentional. Strict SDK/editor setup schemas now accept bounded backend-route metadata; the retired native-conformance diagnostic is shown only for `codex-native`.
- **Budget provenance:** The `apiMoney` filter in `src/config/role-policy.ts` was a pre-existing working-tree change, with no author attribution. It was not introduced by `cost-fixes.patch`. Paired tests retain paid-API monetary budgets and exclude those halts from CLI subscription runs. The already-applied patch was preserved.
