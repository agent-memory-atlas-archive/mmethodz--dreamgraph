# DreamGraph current project state

Updated: 2026-10-04T10:12:59.509Z · Release: **v14.0.1 — Ashoka**

This is the durable reference for established behavior and subsequent maintainer confirmations. It complements the published release notes and sealed release evidence; it does not reopen completed Ashoka slices.

- **Architect operational tabs:** Configuration (Config), Schedules and Status are permanent tabs in the browser Architect. They belong to its normal workspace, follow the compact Web64 V2 UI direction, and fill the available space. Explorer remains a separate route opened through Architect's light blue link.
- **Configuration redesign:** The configuration pages were redesigned in plain language, with grouped settings, task limits and role/budget controls. Template preview/apply/undo, scoped Computer Use profile editing and exact-retry recovery remain available. Configuration edits use daemon-owned validation and revision checks; an uncertain save preserves later drafts.
- **Codex CLI Computer Use:** The adapter's Computer Use integration was fixed and the maintainer now confirms it is working in practical use through browser Architect. This is established functionality for the Codex CLI adapter, rather than merely an implemented but unproven route. Release/cancellation failures still require truthful recovery reporting. This confirmation does not extend field qualification to native API adapters, native desktop control or additional platforms.
- **Legacy graph upgrade:** The fixed `dg graph-upgrade <instance>` now completes on **all seven maintainer-tested instances**. This postrelease confirmation supersedes the six-instance count recorded in the original v14.0.1 notes. Historical revisions remain preserved; unresolved references are preserved and require separate repair. The command migrates graph storage and is separate from source reconciliation through `dg scan <instance> --incremental`. The request referred to `dg graph-update`; the actual CLI command is `dg graph-upgrade`.

The practical Computer Use result and seven-instance upgrade result are **maintainer-confirmed on 2026-10-04**. They are separate from the executing agent's automated release qualification and do not represent a new independent model benchmark.

References: [v14.0.1 release notes](../../RELEASE_NOTES_v14.0.1.md), [release verification](release-14.0.1-evidence.json), [configuration workspace](configuration-workspace.md), [Computer Use contract](computer-use.md), [legacy migration](legacy-upgrade.md).
