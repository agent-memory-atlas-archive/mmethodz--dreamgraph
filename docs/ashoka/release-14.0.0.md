# DreamGraph v14.0.0 — Ashoka release and upgrade guide

Ashoka is the first practical-testing release of the unified graph, execution and recovery overhaul. CLI, engine/daemon and MCP authority, browser Architect, VS Code Architect, Explorer, dashboard, analytics and SDK/host/token-economy packages share product version **14.0.0**. Schema and protocol majors are independently versioned; installing a product major does not migrate stored data.

## Install and restart

From the checked-out release, use the established installer:

```powershell
.\scripts\install.ps1 -Force
dg --version
dg restart <instance>
dg status <instance>
```

For the accepted WSL2 Linux test bed:

```bash
bash scripts/install.sh --force
dg --version
dg restart <instance>
dg status <instance>
```

The installer replaces the shared `~/.dreamgraph/bin/` runtime and reminds the operator to restart existing instances. It does not restart them or convert their graph. Already running instances are expected to continue until the operator restarts them; the release does not implement immutable per-process binary directories. The maintainer explicitly retained this established workflow instead of installer staging. Confirm actual HTTP health after restart; a failed health check is a failed start, even if a PID was allocated. Existing 13.4 clients must reconnect after restart; runtime transport sessions are not a promise of indefinitely resumable sockets. Durable graph, plan, history and authority records remain on disk.

Back up instance data and configuration and retain the previous source/package before upgrading. Review the legacy notice in Architect. Run `dg graph-upgrade <instance> preview --out <new-review.json>` for a read-only structural preview. Follow [the reviewed migration procedure](legacy-upgrade.md) for exact approval, verified backup, offline writer exclusion, apply and lost-reply recovery. Installation with `-Force` is not migration consent. Missing historical scan/enrichment baselines remain unknown. **An old full scan does not imply a stale graph:** inspect tracked mutations, source reconciliation, dirty partitions and concrete gaps.

## Compatibility and recovery

| Boundary | v14 behavior |
|---|---|
| Product packages and runtime identity | Synchronized 14.0.0; generated SDK/MCP/provider/configuration artifacts derive from authoritative source. |
| Persisted families and negotiated contracts | Current plus documented previous major where supported. Unknown/future schemas refuse activation; clients must consume advertised schema capabilities. See [canonical contracts](foundation.md) and [migration policy](legacy-upgrade.md). |
| Plan lifecycle | Canonical current/running/next/completed state is separate from compatibility progress reported by legacy logs. Reported verification is visibly labelled; external Codex work does not fabricate an Architect execution lease. See [plan authority](plan-authority.md). |
| Pre-cutover recovery | Preserve the verified backup and exact review/operation IDs. Restore only unchanged migrated families through a separately reviewed operation. |
| Post-cutover writes | Never overwrite new receipts, graph changes or configuration with an old full backup. Changed migrated families require forward repair or reviewed replay; schema-incompatible downgrade is refused. |
| Shared runtime rollback | Stop the affected instance, reinstall the previous compatible package and confirm health. Only use old binaries against compatible data. Binary replacement does not authorize data rollback. |

Previous-schema support is a bounded compatibility window, not perpetual acceptance. A later major may sunset its predecessor with an explicit migration and release notice. No calendar sunset for a supported major is invented by this release.

## Working surfaces and provider choices

Config, Schedules and operational Status/Health are retained Architect tabs that fill the available pane and preserve drafts while switching. Open Explorer is a light-blue link to its separate browser tab. Standalone routes remain available. Configuration reads source/npm templates or globally installed sibling templates; invalid legacy schedules remain visible for explicit repair, with bounded row/menu layout. The dashboard exposes catalogued engine settings, protected template resets, validation, exact revision save/undo and the rebuilt schedule workspace. Schedule selection, next-run state, manual dispatch and cancellation use the same authority as engine execution. See [configuration](configuration.md), [workspace](configuration-workspace.md) and [schedules](schedule-workspace.md).

Use per-role policies for scan/enrichment, dreamer and normalizer. GPT-4.1 remains an economical initial-scan preference; modern supported OpenAI or Anthropic models are selectable for established-graph work without silent escalation. OpenAI Responses versus Chat Completions is explicit capability evidence, not inferred from a CLI adapter name. Unsupported temperature is omitted while preserving the cognitive role. CLI adapters own their native continuation semantics; they do not receive API continuation assumptions. [Provider routes](providers.md), [role policies](role-policies.md) and [CLI controls](cli-controls.md) document effective settings and unavailable controls.

Architect context menus offer bounded actions on plans, slices, ADRs and schedules, with keyboard/touch access and availability/proposal-versus-commit distinctions. Nervous Points have a disclosure arrow; Reveal selected plan centers the selection. Clicking a slice opens its exact review heading; review fills available height and the scrolled right rail remains resizable. [Command authority](client-integration.md) and [UI proof](ui-repairs-sixth/qualification.json) describe actual limits.

Explorer keeps a manual review snapshot. Cache invalidation is filterable live telemetry and never refreshes the graph. Explicit external snapshots and dream completion can refresh it. Inspector content survives refresh; unchanged snapshots preserve the 3D scene. Older retained snapshots may authorize a mutation only when the target and direct dependencies still match. Changed or unknown/unretained inputs refuse under the writer boundary.

## Computer Use and qualification

Prefer the adapter's best available native capability and normalize its contract above it; native API routes use the DreamGraph harness. Computer Use is explicitly granted, session isolated, evidence producing, cancellable and budget bounded. Default-disabled backends must not be advertised as usable merely because a model is selectable.

The accepted release evidence is Windows maintainer practical qualification plus WSL2 Ubuntu 24.04 / Node 20 installer and isolated-browser-worker qualification. Native Linux desktop, macOS and additional runtimes/distros are deferred field-feedback work. [The route/platform matrix](v14-release-scope.md) and [Computer Use contract](computer-use.md) identify available routes and remedies. C17 requires input release/action cancellation/control relinquishment within one second and confirmed owned process-tree termination within five seconds of the same Stop request. Show stopping/input-released while waiting; unconfirmed termination remains recovery-required, never Stop complete.

## Evidence and honest limits

[Slice 27](slice-27-closure.json) seals the functional/system evidence: 2,040 root tests, 546 compiled editor tests and eleven actual Windows browser checks, zero failures and two explicitly retired particle skips. These are controlled environment results, not universal latency or support guarantees. The original instance was not migrated by those tests. [Slice 28](slice-28-release-evidence.json) separately records exact release packaging, the clean-source offline gate and publication.

GitHub Actions refused the release matrix and CodeQL jobs before execution because the account was locked by a billing issue. Remote CI is unavailable and is not reported as passing. No billing change or purchase was made. This does not add qualification environments beyond the accepted Windows and WSL2 scope.

[The public GPT-4.1 pilot](benchmarks/2026-10-03-gpt-4.1/README.md) preserves 14 pairs / 28 calls and quality failures, including lifecycle omissions, trust confusion, invented readbacks and age-only staleness. **No measured agent-understanding improvement, superiority or cost-saving claim is made.** Public requests and answers enable community reproduction; private contexts, replies, credentials, approval and spend ledger remain private. Ordinary CI makes no paid calls. Practical testing and community model/configuration comparisons inform patches.
