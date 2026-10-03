# DreamGraph v14.0.0 — Ashoka

Ashoka aligns DreamGraph's graph, agent context, execution, lifecycle, configuration and recovery subsystems for its first practical-testing release. All product surfaces and workspace packages share **14.0.0**; persisted and API schemas retain their independently negotiated majors.

- Canonical structured/paged graph contracts, scoped identity, provenance/trust classes, mutation currency and bounded agent context replace independent consumer interpretations.
- Durable operation receipts, writer fences, dirty/source reconciliation, bounded spend, cancellation and recovery align scans, enrichment, dreams, normalization, schedules and managed execution.
- Per-role provider policies support explicit modern OpenAI/Anthropic choices, Responses routing and capability-aware parameter omission. CLI-native execution, Autonomy and Verbosity retain adapter-specific semantics.
- Architect gains coherent current-versus-reported plan progress, legacy migration notices, useful context actions, exact slice navigation and a full-height plan review. Config, Schedules and operational Status/Health open as retained Architect tabs; their panes fill available space and preserve drafts. Open Explorer is a light-blue link to a separate browser tab. Configuration reads installed sibling templates correctly, and long or invalid legacy schedules keep a usable layout and require explicit repair. Explorer retains glass visuals and manual snapshots without polling/cache-triggered refresh or disappearing inspectors.
- Governed Computer Use normalizes native adapter capabilities and the API harness with explicit grants, session isolation, evidence, budgets and two-stage Stop/recovery guarantees.
- Reviewed legacy migration previews, exact backups, offline cutover and lost-reply replay preserve unknown history and refuse incompatible schemas or destructive rollback over new work.

## Upgrade

Run the existing `scripts/install.ps1 -Force` or `bash scripts/install.sh --force`, then restart instances and confirm health. The installer replaces the shared runtime and prompts for restart; it does not migrate graph data. Review Architect's legacy notice and the read-only `dg graph-upgrade <instance> preview` before any structural migration. Back up data/configuration and retain the previous package. An old scan alone does not establish a stale graph or justify paid rescanning.

See the [release/upgrade guide](docs/ashoka/release-14.0.0.md) for compatibility, supported commands, rollback limits, provider routes and runtime requirements. Immutable per-process installer staging is not included; the maintainer retained the existing shared-bin/restart workflow.

## Qualification and limitations

The [sealed system gate](docs/ashoka/slice-27-closure.json) passed 2,040 root tests, 546 compiled editor tests and eleven real Windows browser checks, with zero failures and two retired particle skips. Accepted Linux evidence is the completed WSL2 Ubuntu 24.04 / Node 20 installer and isolated-browser-worker pass. Further native Linux desktop, macOS and runtime qualification is deferred to field-feedback patches. Available Computer Use routes are explicitly listed; unavailable/default-disabled routes are not blanket platform support.

The [published GPT-4.1 pilot](docs/ashoka/benchmarks/2026-10-03-gpt-4.1/README.md) includes reproducible public requests/answers and preserves observed quality failures. It does **not** establish improved agent understanding, superiority, statistical usefulness or cost savings. Community runs should publish model/settings/provenance and actual provider usage. No paid calls occur in ordinary CI.

Exact release artifact hashes, package upgrade/restart/recovery results and remote CI status are recorded in the Slice 28 release evidence. These do not imply that the maintainer's original instance was converted.
