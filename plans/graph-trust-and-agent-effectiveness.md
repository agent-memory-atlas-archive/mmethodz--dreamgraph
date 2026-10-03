# DreamGraph v14.0.0 - Ashoka

Status: implementing
Owner: core/daemon owns canonical semantics; project maintainer is accountable; technical ownership is assigned per slice
Created: 2026-09-30
Plan revision: 7 — complete execution simulation, closed dependency/recovery handoffs and reconciliation-based graph currency; prior owner decisions retained
Release target: v14.0.0 - Ashoka — synchronized major overhaul across every shipped surface
Release qualification disposition (owner, 2026-10-03): practical Windows qualification plus the completed WSL2 Ubuntu 24.04 / Node 20 installer and isolated-browser-worker proof. Additional platforms, runtimes and native desktop backends are explicitly deferred beyond v14.0.0; see [the authoritative release scope](../docs/ashoka/v14-release-scope.md). Do not expand platform work unless an existing Ashoka acceptance criterion is currently failing because of it. Existing contract, recovery and release gates remain in force for advertised implementations.
Baseline: DreamGraph 13.4.0; audit commit 563d10c8109cbe3388cde71168bdcff149c96e0f plus recorded working-tree UI changes
Current review stance: Core/daemon ownership, bounded schema compatibility, task-based usefulness, explicit spend/retention/full-access controls and local-only defaults are resolved design direction. All original 13 nervous points retain their resolutions; revision 6 added NP14 for Computer Use, with concrete contracts and acceptance evidence. Implementation is authorized and underway; the current checkpoint below supersedes historical planning status. The schedule rebuild and CLI controls remain in scope; C14 remains within Slice 21, and revision 4 makes C15 graph-centered execution a release-wide invariant, with bounded reconciliation/digestion and paired usefulness evaluation. Revision 5 adds C16 contextual actions, a visible Nervous Points arrow and reliable selected-plan reveal to this same release. Revision 6 adds C17 Computer Use, F26, NP14 and dedicated Slice 31: Codex-native interaction for Codex CLI, DreamGraph harness for native API adapters, with cross-platform contracts and eight bounded work packages for GPT-6.1 Sol.

Revision 7 is the [full pre-implementation execution simulation](../docs/audits/2026-09-30-coverage/execution-simulation.md). It closes 21 cross-subsystem design gaps, revises 17 dependency sets without changing the 32 slice IDs, and assigns concrete entry/exit/recovery evidence to every slice. It distinguishes early contract fixtures from final integration gates; the simulation records planning evidence; actual implementation status is tracked below. [Machine trace](../docs/audits/2026-09-30-coverage/execution-simulation.json) and [static verification](../docs/audits/2026-09-30-coverage/execution-simulation-verification.json) record this pass.

## Purpose and evidence

This is the unified **v14.0.0 - Ashoka** release plan. All accumulated additions, contracts C01–C17, lifecycle/status work, graph-centered execution, model/adapter support, engine alignment, configuration/schedules and user-surface improvements belong to this one scope. Linked design specifications and audit artifacts are supporting appendices of this plan. Preserve the stable plan ID and all 32 slice IDs as further additions arrive; revision 6 preserves the previous 31 and appends Slice 31. The plan incorporates the owner’s continuing additions; implementation is underway under the explicit owner authorization.

Make DreamGraph dependable as an agent’s evolving architectural memory: complete retrievable graph evidence, trustworthy updates, bounded cognition, coherent user controls and measurable usefulness. Its accumulated relationships, provenance, decisions, constraints, history, workflows, capabilities, evidence, tensions, temporal/causal knowledge, human intent and verified consequences must materially improve the executing agent’s understanding beyond repeated source rereads. Graph utilization is a first-class execution invariant, not an optional indexing feature. Cover MCP authority, CLI, engine, dream strategies, normalizer, daemon, dashboard/configuration, 2D/3D Explorer, browser/VS Code Architect, analytics, SDK/host/plugins, model adapters and release/install behavior.

The authoritative baseline is the [audit report](../docs/audits/2026-09-30-coverage/report.md), [93-tool matrix](../docs/audits/2026-09-30-coverage/mcp-tool-matrix.md), [29-family alignment map](../docs/audits/2026-09-30-coverage/subsystem-alignment.md) and [verification evidence](../docs/audits/2026-09-30-coverage/verification.json). Findings F01–F23 form the original audit; the planning addendum adds F24 (schedules), F25 (CLI controls) and F26 (Computer Use integration boundaries). Evidence levels distinguish observed defects, source findings and unverified risks.

Existing bindings: ADR-002 (discipline/evidence), ADR-045 (semantic source anchors), ADR-097 (graph context reservation), ADR-123 (MCP manifest parity), ADR-203 (connected/daemon/deterministic routing). Reconcile proposed contract changes with these decisions; record new or superseding ADRs through the project’s authority. Do not assign accepted status to a proposed decision.

## Implementation authorization and checkpoint

The owner authorized full Ashoka implementation on 2026-09-30. **Thirty-one slices are verified: 0–27 and 29–31. Slice 28 is in progress, completing exact release qualification and publication.** The current checkpoint supersedes older aggregate counts and continuation instructions in historical log entries. Baseline revision 18 retains the 42 generated contracts, twelve task definitions, twenty-nine subsystem owners and eight vision excerpts.

[Slice 26 closure](../docs/ashoka/slice-26-closure.json) accepts converter/recovery behavior and an exact own-instance copy: reviewed conversion, original-receipt replay and byte-exact restoration. The original live graph was not migrated. Exact versioned package activation, existing-session compatibility and rollback limits belong to Slice 28.

[Slice 31 closure](../docs/ashoka/slice-31-release-scope-conformance.json) accepts the maintainer-fixed Windows/WSL scope. Practical Windows testing remains with the maintainer; the existing WSL2 Ubuntu 24.04 / Node 20 installer and isolated-browser evidence is sufficient Linux qualification. Additional runtimes, distributions, native desktop backends and platforms remain explicitly deferred. Do not reopen verified scope without concrete contradictory evidence.

The [Slice 27 closure](../docs/ashoka/slice-27-closure.json) accepts all 29 subsystem owners, 21 XS scenarios, contracts C01–C17, risks NP01–NP14, PL01–PL16 and the client/graph-class joins for the declared scope. The [sixteenth complete gate](../docs/ashoka/slice-27-offline-gate-sixteenth/result.json) passes 2,040 root tests across 183 files, 546 compiled editor tests and eleven actual browser checks, with zero failures and only two retired particle skips. The [timing record](../docs/ashoka/slice-27-timing-follow-up.md) preserves earlier failures and the approved C17 correction: one-second input release/action cancellation/control relinquishment and five-second confirmed owned-tree termination from the same request. Qualification measured 12.9095 ms release / 485.0984 ms termination / 2,863.0246 ms control loss. Intermediate stopping/input-released and recovery-required states are tested. The [scheduler/session-liveness correction](../docs/ashoka/slice-27-scheduler-stall.md) is included. No mandatory test was quarantined and platform scope is unchanged. XS19's exact package activation/recovery portion remains explicitly owned by Slice 28.

[Actual browser UI evidence](../docs/ashoka/ui-repairs-sixth/qualification.json) passes seven checks covering exact Slice 5 navigation, full-height plan review, scrolled-sidebar resizing, retained Inspector, manual/cache-event snapshot semantics, external updates and stable 3D rendering. Legacy plans retain explicit Markdown/log progress as a read-only **reported** projection; it does not fabricate canonical verification or a running lease. The maintainer confirmed the migration notice, old-scan distinction and correct **Execution: idle** during external Codex work.

The [published supplied-context pilot](../docs/ashoka/benchmarks/2026-10-03-gpt-4.1/README.md) completed all fourteen pairs / twenty-eight real Responses calls. It includes answer-quality failures and does not establish improved understanding, superiority or cost saving. The maintainer's practical-testing disposition permits release without those stronger claims; functional, authority and recovery correctness remain required. Do not repeat paid collection as a release prerequisite.

Slice 28 has synchronized product metadata to **14.0.0 — Ashoka**, completed the requested Architect operational-tab fixes and disposable package upgrade/recovery checks, and started clean-source release qualification. Tag, GitHub release and live website publication remain pending. GitHub Actions cannot start because of an account billing lock; remote CI is unavailable, not passing evidence. The Windows global daemon and original graph have not been installed/restarted or migrated by this pass. The accepted WSL scope is unchanged. The usage watch remains paused.

## Governance and execution rules

Historical component and admission checkpoints retain their original temporal scope in the implementation log. Current acceptance is summarized above; green component counts alone do not verify composed requirements or model understanding.

The owner authorized the complete implementation scope after revision 7. Paid scans, live-data migration and deployment retain their explicit scope/budget/cutover gates. The implementation session and reviewed foundation inventory are recorded below; prior audit sessions are historical. The own-instance daemon was offline initially and was started by the user later. Evidence and the draft plan were then registered in the correct DreamGraph instance through INGEST/AUDIT/PLAN, session `e211864f-0e9e-4beb-b198-4f8acc3348eb`. That audit-only session is completed; it did not approve implementation. The revision-1 native draft has 66 per-finding mappings for its 29 slices. Revision 2 preserves those slice IDs and appends Slices 29 and 30; its native registration/evidence is recorded separately in the log. Revision 3 preserves all 31 IDs and deepens Slice 21 with C14. Revision 4 retains them and adds C15 across retrieval, reconciliation, cognition, scheduling, adapters and evaluation; Revision 5 adds C16 within the existing owners and retains the Ashoka name; Revision 6 added C17 and Slice 31. Revision 7 performs the complete execution simulation and revises contracts/dependencies in files only; native revision-6 registration is historical, not a registration of revision 7. Establish a new implementation discipline session with the reviewed plan before risky changes; do not attach work to the unrelated web64-react instance.

Each slice starts with its dependencies verified, an identified implementation owner and reviewer, current semantic anchors and a bounded scope. Follow discipline INGEST/AUDIT/PLAN/EXECUTE/VERIFY as applicable. Record changed contracts, tests, risks and rollback evidence in the paired implementation log. A failed or inconclusive check stays partial/blocked; a prose claim does not mark it verified. Review identity/persistence, truth policy, model spending and authority changes before mutation. Verify the integrated result after each delivery wave.

The status fields below record actual implementation; all unstarted slices remain pending. The 29 original slice IDs are preserved; appended Slice 29 owns the schedule workspace and Slice 30 diagnoses/repairs CLI Autonomy and Verbosity using the existing authority and adapters. Slice 31 adds governed Computer Use through adapter-native execution, detailed in eight internal work packages; it does not renumber prior slices. Dependency and acceptance fields are human/governance contracts: the current Markdown parser recognizes slices/statuses but does not itself enforce this dependency DAG. C14 now distinguishes canonical authority from legacy reported progress. Preserve blocked reasons and original evidence in the log; an imported report is not an independent verification receipt. External Codex work correctly leaves DreamGraph runtime execution idle. Governed lifecycle transitions retain their own authority and recovery gates.

## System and operator responsibility

**DreamGraph guarantees system correctness under valid use. The user owns operating discipline outside that contract.** Valid use means a documented supported route/version, declared instance/project/scope and satisfied authority/configuration prerequisites. DreamGraph must enforce those prerequisites and correctly preserve identities, committed state, reconciliation, concurrency, budgets, lifecycle, evidence and truthful results; a bug cannot be dismissed as operator discipline. A failed worker, interrupted write, stale UI or invalid request must produce the specified recoverable/error state. The user chooses when to work outside DreamGraph, when substantial out-of-band changes warrant an inclusive scan, and which optional paid/cognitive workflows to run. Do not impose recurring scans, suspicion-driven warnings or extra approvals for work already authorized within that contract. Unsupported/out-of-scope activity has an explicit boundary; the product does not claim to have observed it.

**Old scan does not equal stale graph.** Managed MCP/Architect mutations keep affected knowledge current through reconciliation. Preserve current unaffected and reconciled knowledge even if only one full scan ever occurred. Freshness is relative to concrete evidence changes and committed scope coverage, not scan/enrichment age, raw Git dirty status or commits since scan. Known mismatches/withdrawals or unfinished reconciliation affect only their actual scope; missing history/mapping is separately unknown. Optional pending cognition does not make reconciled source facts stale. A missing old scan baseline may limit a scan operation, but does not invalidate later knowledge. The user chooses an inclusive scan after substantial work outside DreamGraph; do not infer such work from time alone. Explicit expiry for transient observations applies only to that evidence kind. See XS21 for the cross-surface regression specification.

Graph currency metadata is canonical: `last_graph_mutation_at` advances only with successful graph-changing commits and is exposed to MCP-aware agents and every UI, separately from `last_full_scan_at` and scoped `last_source_reconciliation_at`. These are activity/coverage evidence, never age-only stale-graph rules. C03 and the execution simulation specify atomic publication, retry/no-op and legacy behavior.

## Design Guardrails

- Preserve source facts, human assertions, hypotheses and validated insights as distinct provenance/trust classes. More model confidence is not more independent evidence.
- Reuse trust-state, evidence-ledger, lifecycle, coverage and provider modules. Prefer adapters and gradual migrations over another competing subsystem or a wholesale rewrite.
- An old full scan is not a stale graph. Managed MCP/Architect mutations and their reconciliation keep affected knowledge current; freshness uses actual evidence/change coverage, never scan age or commits-since-scan alone. Inclusive rescan is the user’s choice for substantial out-of-band changes.
- Every retrieval result states revision, completeness and uncertainty; every mutation has a durable commit/recovery contract; every background job has bounded ownership and spend.
- Full scans, enrichment, dreaming and normalization use independent user-selected profiles without changing evidence/completeness obligations. GPT-4.1/GPT-5.4 are examples or saved preferences, never permanent defaults or ceilings; context expansion and spend have separate limits.
- Keep OpenAI/Anthropic API capability metadata separate from CLI adapter identifiers. Explicit model overrides and supported Responses use must be visible and validated. Never silently increase model cost or weaken schema/evidence guarantees.
- No paid request in ordinary CI. Opt-in real-provider tests require declared credentials, data scope and reserved per-run/per-day allocations; unknown prices do not count as free. Retention is independent; scoped full access uses two human confirmations and retains finite limits.
- No unreviewed legacy graph rewrite. Require backup, delta preview, identity mapping and tested rollback. Respect active scans and multiple daemon clients.
- Preserve the current compact UI direction. UI improvements must clarify evidence, state and control as well as appearance. C16 adds four-to-six-item contextual menus backed by existing commands, keyboard/touch access, explicit nested disclosure arrows and ID-based plan reveal without background scroll jumps.
- Core/daemon projects plan lifecycle, effective slice status and current/running/next work once; every client consumes the same revision. Selected and suggested work is not active implementation; implemented is not verified.
- Every shipped project-execution path consumes task-relevant graph evidence and reconciles material changes. Known unreconciled regions remain visible until processed; bounded digestion must not become a full-graph default, an unbounded queue or surprise paid work.
- Computer Use follows the selected adapter: native CLI facilities or the DreamGraph API harness. Common scope, lease, stop, evidence, graph and lifecycle guarantees apply on every platform; raw pixels and UI text cannot become authority or automatically become facts.
- Measure useful initial understanding and task outcomes against matched source-only baselines. Shorter prompts, more injected nodes, reachable tools and generated prose are not evidence of success.

## Graph-centered execution invariant

The [owner request](../docs/audits/2026-09-30-coverage/owner-graph-execution-request.txt) and [C15 execution-loop design](../docs/audits/2026-09-30-coverage/graph-centered-execution.md) are part of this plan. The default loop is project reality → canonical graph → task-specific rich context → agent → committed changes → targeted reconciliation → bounded digestion → richer graph. No shipped project-execution surface may routinely bypass it; route-specific degraded behavior and external-client limitations must be explicit.

Prefer trustworthy graph knowledge that is current for the task scope before broad rereads; elapsed time since a full scan is not a reason to distrust it. Reserve mandatory ADR/evidence anchors and rank useful context within hard bounds. Verify against targeted source when needed. Every material change, including saved working-tree and knowledge-bearing docs/plan changes, leaves a durable reconciliation receipt or visible outstanding obligation. Debounced/idle targeted digestion coalesces affected regions under existing scheduler and spend controls. Optional pending digestion does not invalidate correct reconciled facts; it never hides stale dependent claims. Native CLI execution and API continuation retain their distinct transports.

Slice 25 owns closure across surfaces; Slices 3/4 own useful context and comparative evaluation, Slice 5 change/commit receipts, Slice 17 dirty generations and bounded digestion, and Slice 21 truthful implementation closure. GE01–GE16 and paired graph/source-only AT01–AT06 evidence gate release. Existing prompt rules are a starting point, not proof of enforcement or benefit.

## Computer Use invariant

**Use the best native capability available, and normalize the contract above it.**

The [capability/platform audit](../docs/audits/2026-09-30-coverage/computer-use-capabilities.md) and [C17 delivery design](../docs/audits/2026-09-30-coverage/computer-use.md) are appendices of this unified plan. Wants remain ambitious: browsers and native apps, vision plus structured interfaces, permitted autonomy, useful graph writeback and recovery. Musts are platform-neutral semantics, explicit scope/authority, graph/evidence/lifecycle correctness, session isolation, bounded spend, effective cancellation and adapter independence. The platform matrix states practical Windows/macOS/Linux/Wayland/X11/headless/remote constraints and remedies; no platform defines the common contract.

Codex CLI uses its own qualified Computer Use facilities; native API adapters use the DreamGraph harness. Preserve native CLI continuation and map semantic authority/outcome receipts, not provider API envelopes. Missing required native controls are explicit blockers, never grounds for a silent worker/model/host substitution. Slice 31 builds on existing owners and has eight bounded work packages for GPT-6.1 Sol, the owner's intended executor for the whole v14 plan; the product remains provider/model independent. CU01–CU24 are future acceptance requirements, not completed tests.

## Delivery groupings (not execution order)

| Wave | Slices | Exit review |
|---|---|---|
| Contract baseline | 0 | Owners, invariants, quality corpus and evidence approved |
| Reliable graph access and updates | 1–6 | Complete bounded retrieval and failure-safe persistence |
| Models, configuration and authority | 7–12 | User-controlled role/API policies, durable settings and isolated sessions |
| Cognitive subsystem alignment | 13–20 | Candidate-to-outcome traces preserve evidence, budget and trust |
| Governance and user surfaces | 21–25, 29–30 | Plan/health/UI/client projections agree |
| Governed Computer Use | 31, after 25 | Portable contracts/browser and qualified adapter/platform execution satisfy C17; explicit native support matrix |
| Own-graph migration and release | 26–28 | Recoverable refresh, whole-engine checks and synchronized release |

The topological levels in the execution simulation are the executable order. These groupings describe scope only. Dependencies below take precedence over group order; for example Slice 9 requires Slice 4 and Slice 6. Independent slices may proceed after owner review, but shared-contract changes need one integration owner. Do not begin all engine refactors at once. Numeric slice order is stable identity, not a strict execution order: Slices 29, 30 and 31 must pass before Slice 27 and release Slice 28; Slice 30 also precedes Slice 25 integration. Close one end-to-end task path before broadening each contract change.

## Implementation sequence

### Slice 0 — Establish the engine alignment contract

- status: verified
- Priority: P1
- Depends on: none
- Findings: F21, F18
- Owner: Core/daemon contract owner
- Contract and policy trace: C01,C02,C08,C14,C15,C16,C17; NP05,NP08,NP13; NP14; AT01–AT06

Assign an owner to every subsystem in the alignment map. Record current readers/writers and approved contracts for identity, revision, evidence, trust, job lifecycle, time, configuration, authority and C14 plan/slice lifecycle. Freeze the shared status vocabulary and transition invariants before consumers change. Reuse existing trust/evidence/lifecycle modules. Establish a labeled task corpus and review the proposed design before changing persistence.

**Acceptance and verification:** All 29 subsystem families have owners and producer/consumer obligations; disputed invariants are explicit; baseline fixtures and measurements are reproducible. The C15 owner matrix, matched baseline rubric and any ADR amendment are explicit before tuning; historical ADR paths are verified against current source. C16 ownership and shared command/target contracts are explicit before menu implementation. C17 common schemas contain no OS handles or API continuation assumptions; NP14 and the native-route ADR-217 amendment have owners.

**Review gate:** Maintainer architecture/evidence review before dependent changes; verify baseline artifacts.

**Rollback / recovery:** Documentation-only baseline; no migration.

**Implementation anchors:** `src/graph`, `src/types/index.ts`, `src/cognitive/types.ts`, `packages/sdk`, `packages/host`.

**Concrete work and evidence:**

1. Inventory persisted schema versions, semantic concepts, current writers and all 29 consumer families; resolve unknown historical versions explicitly.
2. Publish generated schema/SDK artifacts and conformance fixtures from the existing core contract; nominate maintainer review responsibilities for trust, persistence and authority.
3. Freeze the twelve task cases and record hashes, mandatory evidence, forbidden assertions and expected outcomes before implementation tuning.
4. Freeze the C15 execution-loop invariant, materiality/exception semantics and cross-surface owners; reconcile ADR-047/097/171/172/177/198/207/217/234/236/237 with current paths and required amendments.
5. Freeze C16 target/action identities, shared command availability and view-versus-mutation semantics; retain one compact action surface over existing authority rather than inventing another command system.
6. Freeze C17 semantic capability/session/target/observation/action/receipt contracts and platform-neutral invariants; keep CLI-native execution distinct from the DreamGraph native-API harness. Record the intended GPT-6.1 Sol implementation executor without constraining product model choice.
7. Apply the revision-7 execution handoff: Reviewed C01–C17 types, ADR applicability/amendment disposition, corpus labels and bounded measurement tolerances unblock 2; no claim of all-surface conformance. Required compound evidence: XS01, XS14, XS15.

**Execution handoff (revision 7):** Reviewed r6 definition, current source/accepted-ADR evidence and twelve task-case specifications; existing discipline only. Verify baseline schemas, applicability and fixtures only; C14 does not have to exist to govern these first slices. Use existing discipline and explicit reviewed IDs until Slice 21 imports the records. See [Slice 0 simulation](../docs/audits/2026-09-30-coverage/execution-simulation.md#s0) for affected records, consumers and compound evidence.

**Evidence packet:** Link the changed contract/schema, fixture or failure trace, command and actual result, relevant graph/config revision, limitations and reviewer decision in the implementation log. These checks are requirements, not completed test claims.


### Slice 1 — Make graph responses structured and pageable

- status: verified
- Priority: P1
- Depends on: Slice 0, Slice 2
- Findings: F01, F02, F16
- Owner: Core graph query/resource owner
- Contract and policy trace: C02,C03; NP03,NP04; AT02,AT04,AT06

Implement a shared URI resolver and versioned result/error envelope with schema, revision, completeness, omitted count and continuation cursor. Page collections and preserve machine-readable JSON; migrate capability URI semantics with a documented compatibility path.

**Acceptance and verification:** All 30 baseline resource URIs have defined query behavior; oversized results stay valid; paging yields exactly the requested revision without duplicates or missing middle records; invalid URI sets the agreed error signal.

**Review gate:** Reviewer checks the acceptance evidence and cross-subsystem contract impact before this slice is marked verified.

**Rollback / recovery:** Keep a documented legacy presentation adapter; never restore raw JSON clipping as the machine contract.

**Implementation anchors:** `src/resources/register.ts`, `src/tools/query-resource.ts`, `src/utils/tool-output.ts`.

**Concrete work and evidence:**

1. Inventory consumers of exhaustive JSON and the conflicting capability URI; define version negotiation and a current/previous contract matrix.
2. Implement scope/revision/completeness/uncertainty envelopes, cursor continuation and explicit expiry or revision-change errors; counts may be unknown.
3. Prove record-union correctness across pages and explicit failure for unsupported clients; preserve distinct empty, partial, stale and unavailable responses.
4. Apply the revision-7 execution handoff: All baseline resource families produce whole typed records, explicit empty/partial/unknown/errors and duplicate-free same-revision paging; 3/12 consume this contract. Required compound evidence: XS03, XS13, XS16.

**Execution handoff (revision 7):** Slice 2 typed snapshots/publication and Slice 0 family/version inventory exist. Follow the durable entry/exit, recovery and coexistence boundaries in the slice record. See [Slice 1 simulation](../docs/audits/2026-09-30-coverage/execution-simulation.md#s1) for affected records, consumers and compound evidence.

**Evidence packet:** Link the changed contract/schema, fixture or failure trace, command and actual result, relevant graph/config revision, limitations and reviewer decision in the implementation log. These checks are requirements, not completed test claims.


### Slice 2 — Unify graph identity and read snapshots

- status: verified
- Priority: P1
- Depends on: Slice 0
- Findings: F03, F17, F21
- Owner: Core graph/persistence owner
- Contract and policy trace: C01,C02,C03,C15; NP08,NP11,NP13; AT02,AT03,AT04

Define typed stable entity identities and a coherent revisioned snapshot adapter for canonical entities, inline fact links, validated insights, ADRs, UI and auxiliary entities. Specify collision handling and stale references without auto-merging unrelated entities.

**Acceptance and verification:** Exact-ID reads work for every canonical family; source facts remain distinct from dreams; snapshot consumers agree on identity and revision under concurrent updates. Task/coding, dreamer and normalizer projections preserve the same canonical identity, evidence and uncertainty despite different context selections.

**Review gate:** Reviewer checks the acceptance evidence and cross-subsystem contract impact before this slice is marked verified.

**Rollback / recovery:** Dual-read comparison before switching; retain original stores and reversible ID mapping.

**Implementation anchors:** `src/graph`, `src/types/index.ts`, `src/cognitive/strategies/_shared.ts`, `src/utils/cache.ts`, `src/tools/reconciliation-transaction.ts`, `src/utils/graph-reconciliation-barrier.ts`, `src/utils/mutex.ts`, `src/graph/store.ts`, `src/tools/scan-state.ts`.

**Concrete work and evidence:**

1. Map stable typed IDs independently of names and define provenance, validation state, confidence semantics and evidence ancestry.
2. Expose one revisioned read model for source facts, human assertions, speculative/validated knowledge and all entity/relationship families.
3. Compare old/new projections at the same scope/revision with semantic diffing; flag lossy adapters and keep migration separate from new reads.
4. Expose provenance-aware task/role projections and source/entity/evidence dependency indexes so changed scope and stale derived knowledge can be resolved at a committed revision.
5. Apply the revision-7 execution handoff: Fault-tested primitive plus same-revision golden projections; old scan with reconciled changes remains current. Unblocks 1/5/7 and supplies validators, not live migration. Required compound evidence: XS02, XS03, XS13, XS21.

6. Define canonical last_graph_mutation_at with graph revision/operation identity, separate full-scan and source-reconciliation coverage markers, null legacy values and revision-based ordering.

**Execution handoff (revision 7):** Slice 0 freezes identity, revision, ownership and physical-store compatibility decisions. Follow the durable entry/exit, recovery and coexistence boundaries in the slice record. See [Slice 2 simulation](../docs/audits/2026-09-30-coverage/execution-simulation.md#s2) for affected records, consumers and compound evidence.

**Evidence packet:** Link the changed contract/schema, fixture or failure trace, command and actual result, relevant graph/config revision, limitations and reviewer decision in the implementation log. These checks are requirements, not completed test claims.


### Slice 3 — Provide complete bounded agent retrieval

- status: verified
- Priority: P1
- Depends on: Slice 1, Slice 2
- Findings: F03, F04
- Owner: Core retrieval owner
- Contract and policy trace: C03,C08,C15,C17; NP01,NP03,NP04,NP05; NP14; AT02–AT04,AT06

Migrate RAG/preamble to the shared graph view. Preserve required ADR/evidence context, expose why entities were selected and what was omitted, and honor depth/type/domain/trust filters. Separate context and envelope budgets.

**Acceptance and verification:** Regression targets include the capability and dashboard UI misses; every fixture entity family and inline fact edge is retrievable; 100/500/2000 budgets do not overflow; metadata counts match emitted records. The retrieval portions of GE01–GE04 prove useful graph-first context against frozen later-consumer fixtures; Slices 25/31/27 must prove their integrated execution. Verify targeted source fallback, explicit omitted knowledge, insufficiency when mandatory anchors cannot fit, and revision-aware refresh through compression. GUI context fixtures are relevant and bounded; Slice 31 must additionally prove that actual expired observations cannot be used as live coordinates or silently reverified.

**Review gate:** Reviewer checks the acceptance evidence and cross-subsystem contract impact before this slice is marked verified.

**Rollback / recovery:** Feature-flag new retrieval and retain versioned old query API for comparison, with visible limitations.

**Implementation anchors:** `src/cognitive/graph-rag.ts`, `src/cognitive/register.ts`, `packages/token-economy/src/budget-coordinator.ts`.

**Concrete work and evidence:**

1. Use the shared read model and mandatory evidence reservation; return actual selection/omission reasons and any unknown counts.
2. Budget serialized context and metadata separately, including headings, provenance and continuation; enforce neighborhood cardinality independently of hops.
3. Test all graph types, relations, permissions, large hubs, tiny budgets and stale scopes; native API/CLI presentation can differ without changing meaning.
4. Build the C15 bounded task-context pack and receipt from task intent, canonical plan/slice, changed files, relationships, ADRs, evidence and history; rank optional expansion after mandatory anchors and refresh only relevant changed scope.
5. Include bounded UI/application/workflow evidence and previous verified interaction outcomes in C17 task context; preserve source kind, expiry and graph revision rather than reinjecting broad screenshot history.
6. Apply the revision-7 execution handoff: Real retrieval budgets/families pass using frozen inputs; GE01–04 retrieval portions pass now. Later client effects and native GUI freshness are mandatory integration evidence, not claimed here. Required compound evidence: XS01, XS07, XS13, XS21.

**Execution handoff (revision 7):** Slices 1/2 bounded snapshots and frozen task/plan/CU context fixtures; later lifecycle/CU producers are represented by contract doubles. GE01–GE04 and GUI-context assertions here cover the retrieval contract against frozen fixtures. Actual lifecycle/adapter execution and live GUI observation invalidation are mandatory in Slices 25/31/27. See [Slice 3 simulation](../docs/audits/2026-09-30-coverage/execution-simulation.md#s3) for affected records, consumers and compound evidence.

**Evidence packet:** Link the changed contract/schema, fixture or failure trace, command and actual result, relevant graph/config revision, limitations and reviewer decision in the implementation log. These checks are requirements, not completed test claims.


### Slice 4 — Index retrieval and evaluate agent usefulness

- status: verified
- Priority: P1
- Depends on: Slice 3
- Findings: F05, F19
- Owner: Retrieval/evaluation owner
- Contract and policy trace: C08,C15; NP02,NP05; AT01–AT06

Build revision-keyed indexes with precomputed statistics, Unicode and symbol support. Create evidence-labeled tasks for orientation, impact analysis, debugging, architecture decisions and unknown answers; compare CLI/API/Architect contexts.

**Acceptance and verification:** Agree measurable latency and quality baselines before tuning; all mandatory-evidence fixtures pass, unsupported questions abstain, and no quality regression is hidden by shorter output. Report p50/p95 across repeated real queries. The GE16 harness and rubric are fixed here; composed evidence in Slice 27 must record reviewed material understanding gains for established-instance architecture/history cases in both projects; no shorter-prompt/larger-graph proxy or synthetic result substitutes for paired task evidence.

**Review gate:** Reviewer checks the acceptance evidence and cross-subsystem contract impact before this slice is marked verified.

**Rollback / recovery:** Invalidate/rebuild index on revision mismatch; fall back to a correct bounded scan.

**Implementation anchors:** `src/cognitive/graph-rag.ts`, `scripts/benchmark-scan-mcp.mjs`, `scripts/benchmark-token-economy.mjs`.

**Concrete work and evidence:**

1. Freeze separate DreamGraph and web64-react evidence/task manifests and negative/distractor examples.
2. Add revision-keyed indexing and repeatable query instrumentation; preserve Unicode and symbol lookup.
3. Evaluate task outcomes, provenance, unsupported claims, abstention, latency and context cost; label synthetic and real measurements separately.
4. Build and verify the preregistered paired graph-assisted/source-only AT01–AT06 harness at matched model/source/resource settings; run final composed evaluations after Slice 25 in Slice 27; measure initial understanding, mandatory evidence, verified rereads avoided, total context, latency, unsupported/stale assertions and next-agent recovery, with construction cost separate.
5. Apply the revision-7 execution handoff: Index correctness and offline retrieval oracle pass; freeze full GE16/AT matched procedure. Final composed usefulness gains remain required after 25 at 27. Required compound evidence: XS01, XS14, XS16, XS21.

**Execution handoff (revision 7):** Slice 3 retrieval semantics plus independently reviewed DreamGraph/Web64 labels and matched evaluation protocol. Freeze and test the paired evaluation harness here; the release claim of improved agent understanding is made only from composed results after Slice 25 at Slice 27. Unfunded required model evaluation remains unverified. See [Slice 4 simulation](../docs/audits/2026-09-30-coverage/execution-simulation.md#s4) for affected records, consumers and compound evidence.

**Evidence packet:** Link the changed contract/schema, fixture or failure trace, command and actual result, relevant graph/config revision, limitations and reviewer decision in the implementation log. These checks are requirements, not completed test claims.


### Slice 5 — Commit enrichment and checkpoints coherently

- status: verified
- Priority: P1
- Depends on: Slice 0, Slice 2
- Findings: F06
- Owner: Core persistence/enrichment owner
- Contract and policy trace: C04,C15,C17; NP03,NP07,NP10; NP14; AT05,AT06

Replace stale whole-store commits with revision-aware entity deltas; coordinate graph mutation and checkpoint acknowledgment. Expose attempted/generated/committed/fallback/failed counts with one job ID.

**Acceptance and verification:** Injected failure at each store/checkpoint boundary cannot mark uncommitted nodes enriched; concurrent human edits survive; restart/resume is idempotent and reports partial completion accurately. GE06–GE08 distinguish source applied, reconciliation pending and graph committed, preserve renamed/deleted/unknown mappings, and recover lost replies/crashes without losing dirty scope or promoting generated prose. Lost-result/crash traces retain uncertain effects and recover receipts without repeating a consequential action.

**Review gate:** Reviewer checks the acceptance evidence and cross-subsystem contract impact before this slice is marked verified.

**Rollback / recovery:** Backup manifests and journal replay; no destructive migration until recovery tests pass.

**Implementation anchors:** `src/tools/enrich-parser-nodes.ts`, `src/tools/enrichment-state.ts`, `src/utils/atomic-write.ts`, `src/graph`, `src/tools/incremental-reconciliation.ts`, `src/tools/reconciliation-transaction.ts`, `src/utils/graph-reconciliation-barrier.ts`.

**Concrete work and evidence:**

1. Define operation identity, expected revision, commit receipt and recovery points for every store involved.
2. Commit deltas before success/checkpoint acknowledgment; retries with the same operation identity recover the committed result instead of duplicating it.
3. Inject disk failure and lost reply at each boundary, then restart/concurrent curation; expose recovery-required for non-atomic external effects.
4. Record material source/docs/config/plan changes, saved working-tree hashes and affected entities as durable obligations; reconcile targeted canonical deltas and invalidation/dirty admission through existing journaled revision/idempotency boundaries, recovering the source-write/graph-write gap.
5. Extend existing durable receipt and material-change obligations to C17 observations and GUI effects; distinguish action dispatched, outcome unknown, resulting state verified and graph reconciled. Never blindly retry an ambiguous external GUI mutation.
6. Apply the revision-7 execution handoff: Disk/reply/fence faults prove receipt recovery and retained obligations. Schemas permit later CU effects; actual GUI dispatch is deferred to 31. Required compound evidence: XS02, XS03, XS04, XS08, XS09, XS10.

7. Publish graph-mutation time atomically with actual graph deltas; failed/no-op writes and replay cannot advance it, and source-reconciliation coverage advances only at its own successful boundary.

**Execution handoff (revision 7):** Slice 2 durable publication primitive and typed scope/revision ports are verified. C17 effect schemas are tested with disposable external-effect doubles here; actual GUI effect/recovery qualification belongs to Slice 31. See [Slice 5 simulation](../docs/audits/2026-09-30-coverage/execution-simulation.md#s5) for affected records, consumers and compound evidence.

**Evidence packet:** Link the changed contract/schema, fixture or failure trace, command and actual result, relevant graph/config revision, limitations and reviewer decision in the implementation log. These checks are requirements, not completed test claims.


### Slice 6 — Bound scan and enrichment cost and recovery

- status: verified
- Priority: P1
- Depends on: Slice 5, Slice 7, Slice 8
- Findings: F07
- Owner: Enrichment/job admission owner
- Contract and policy trace: C05,C06,C15,C17; NP01,NP03,NP09; NP14; AT05,AT06

Add estimates and max calls/input/output/reasoning/retries/job budget controls to scan and standalone enrichment. Classify fallback causes in progress and final reports, preserve resumability, and allow cancel without losing committed work.

**Acceptance and verification:** Zero budget makes no provider request; retry/escalation counts remain within caps; max-hops 0/1/2/3 semantics are tested; UI/CLI agree on cumulative usage and remaining work. GE11 preserves useful committed work and visible remaining scope under zero/exhausted allocations, cancelled calls, bounded retries and concurrent workload reservations. CU13 admission fixtures stop at every configured bound; real CU route evidence in Slice 31 must also prove no silent escalation, unpriced paid work or lost reconciliation.

**Review gate:** Reviewer checks the acceptance evidence and cross-subsystem contract impact before this slice is marked verified.

**Rollback / recovery:** Persist previous policy; stop safely when cost/pricing is unknown under a strict monetary cap.

**Implementation anchors:** `src/tools/scan-project.ts`, `src/tools/enrich-parser-nodes.ts`, `src/tools/enrichment-state.ts`, `src/cognitive/llm-readiness.ts`.

**Concrete work and evidence:**

1. Preflight effective role/model/adapter/reasoning/hops, selected-neighbor/input/output/retry limits and job/day allocation.
2. Reserve parallel in-flight request costs before dispatch and checkpoint the effective config fingerprint; stop honestly with structural evidence retained.
3. Resume only eligible unfinished work under a named policy; distinguish re-enrichment from continuation and retain previous provenance. Preserve the existing automatic-dream completeness gate.
4. Apply independent limits to targeted reconciliation/enrichment/digestion, including high-degree one-hop regions; expose unsupported baseline and remaining debt without silently buying a whole-project scan or raising model strength.
5. Apply shared run/day admission to C17 model turns, images, input actions, time and retries; enforce worker/native-CLI limits and preserve unknown usage reservations. Keep subscription units separate from API money.
6. Apply the revision-7 execution handoff: Offline high-degree, parallel, cancel, retry and restart cases prove finite limits and resumability. CU model/image/action accounting is a fixture contract until 31. Required compound evidence: XS04, XS05, XS09, XS14.

**Execution handoff (revision 7):** Slices 5/7/8 provide durable job records, effective role policy and normalized call/usage capabilities. Prove admission with real persistence and fake provider/worker charges here; actual C17 input/image/native-route controls must pass in Slice 31. See [Slice 6 simulation](../docs/audits/2026-09-30-coverage/execution-simulation.md#s6) for affected records, consumers and compound evidence.

**Evidence packet:** Link the changed contract/schema, fixture or failure trace, command and actual result, relevant graph/config revision, limitations and reviewer decision in the implementation log. These checks are requirements, not completed test claims.


### Slice 7 — Define role-based model and lifecycle profiles

- status: verified
- Priority: P1
- Depends on: Slice 0, Slice 2
- Findings: F22, F07, F13
- Owner: Core configuration/provider-policy owner
- Contract and policy trace: C05,C06,C07,C17; NP01,NP06,NP09; NP14; AT03,AT06

Define independent initial_scan, enrichment, dreamer, normalizer and architect profiles. Include provider, model, API mode, reasoning effort, output/context limits, timeout, storage policy, allowed fallbacks and spend ceiling. Preserve existing settings through explicit migration.

**Acceptance and verification:** User can choose GPT-4.1 for an initial scan and GPT-5.4 for dreamer/normalizer, then select a supported newer model without a code-imposed ceiling. Profiles are suggestions, never automatic model upgrades; effective role resolution is inspectable. A profile shows requested versus effective capability/host/model and blocks unsupported privacy or cost requirements.

**Review gate:** Reviewer checks the acceptance evidence and cross-subsystem contract impact before this slice is marked verified.

**Rollback / recovery:** Retain prior per-role configuration; migration preview and revert are available.

**Implementation anchors:** `src/cognitive/llm.ts`, `src/config/config.ts`, `src/utils/engine-env.ts`.

**Concrete work and evidence:**

1. Create independently selectable initial-scan, enrichment, dreamer, normalizer and Architect role policies with explicit precedence.
2. Separate requested/resolved model, adapter capabilities, pricing policy and provider storage; treat GPT-4.1/GPT-5.4 as examples/saved preferences.
3. Expose invalid combinations as actionable errors and keep supported custom endpoints/models; snapshot effective config per job and candidate.
4. Add explicit Computer Use model/route and disclosure/retention policy to role profiles without coupling the implementation executor to runtime model choice; CLI-native and native-API billing/retention remain distinct.
5. Apply the revision-7 execution handoff: Policy resolver fixtures cover explicit user models/overrides, separate retention/pricing and no permanent GPT ceiling; 8/10 consume it. Required compound evidence: XS05, XS06, XS14.
6. Preserve every cognitive role through explicit instructions independently of sampling controls. Omit temperature for unsupported or unqualified provider/model/reasoning combinations; retain requested settings separately from effective controls. GPT-5.4 temperature requires explicit reasoning effort `none`; never lower/increase effort or change the model to recover a sampling control. API constraints do not define native CLI capabilities.

**Execution handoff (revision 7):** Slices 0/2 supply schema ownership, versioned records and compatible policy representation. Follow the durable entry/exit, recovery and coexistence boundaries in the slice record. See [Slice 7 simulation](../docs/audits/2026-09-30-coverage/execution-simulation.md#s7) for affected records, consumers and compound evidence.

**Evidence packet:** Link the changed contract/schema, fixture or failure trace, command and actual result, relevant graph/config revision, limitations and reviewer decision in the implementation log. These checks are requirements, not completed test claims.


### Slice 8 — Complete Responses and provider capability contracts

- status: verified
- Priority: P1
- Depends on: Slice 7
- Findings: F22, F26
- Owner: Provider/adapter owner
- Contract and policy trace: C05,C06,C15,C17; NP06,NP09; NP14; AT02,AT03,AT06

Extend existing adapters instead of duplicating them. Add explicit auto/responses/chat-completions policy, capability-sensitive reasoning/temperature/structured outputs, refusal/incomplete handling, abort propagation, usage accounting and state/storage controls. Validate OpenAI and Anthropic independently; keep Codex CLI model IDs separate from API capability assumptions.

**Acceptance and verification:** Offline request/response fixtures cover GPT-4.1, GPT-5.4, known newer models and an unknown user override; requested reasoning arrives on the wire; malformed/refused/incomplete output never becomes validated graph data; input/cached/output/reasoning usage is reported where supplied. Native CLI processes receive no API-specific continuation envelope; compression/continuation retains mandatory evidence or reports insufficiency and stale context explicitly. Provider support, CLI feature flags and initial-image attachments are not accepted as proof of an end-to-end Computer Use route.

**Review gate:** Reviewer checks the acceptance evidence and cross-subsystem contract impact before this slice is marked verified.

**Rollback / recovery:** Per-provider rollout switch with an explicit compatible fallback; never silently switch to a more expensive model or weaker output contract.

**Implementation anchors:** `src/cognitive/llm.ts`, `src/architect/cli-bridge.ts`, `extensions/vscode/src`.

**Concrete work and evidence:**

1. Build a capability contract with provenance/version and explicit overrides; model-name patterns alone are not capability evidence.
2. Extend current Responses/Chat/Anthropic paths and CLI adapters with effort, schema, incomplete/refusal, cancellation and real usage semantics.
3. Validate supported output locally; test explicit fallback approval and guarantees; distinguish API measured/estimated charge from unknown subscription consumption.
4. Deliver C15 semantic context/receipt anchors through adapter-native APIs, prompt files or MCP; bind optional continuation/cache state to evidence revisions and never make it the only project-memory copy.
5. Negotiate C17 image/tool/native-computer capabilities and versioned OpenAI/Anthropic schemas; native APIs call the DreamGraph harness, while CLI adapters prefer their own native Computer Use. Preserve each route’s native continuation and expose real integration gaps.
6. Apply the revision-7 execution handoff: Offline API/CLI fixtures pass. Real CU route control is explicitly unqualified until 31; no circular requirement that a worker already exists. Required compound evidence: XS04, XS10, XS14, XS17.

**Execution handoff (revision 7):** Slice 7 role policies and existing native API/CLI adapters, with source-verified capability/version records. Provider/CLI capability and image/tool transport fixtures are the exit here; Computer Use route control/telemetry is not qualified until Slice 31. See [Slice 8 simulation](../docs/audits/2026-09-30-coverage/execution-simulation.md#s8) for affected records, consumers and compound evidence.

**Evidence packet:** Link the changed contract/schema, fixture or failure trace, command and actual result, relevant graph/config revision, limitations and reviewer decision in the implementation log. These checks are requirements, not completed test claims.


### Slice 9 — Evaluate mature-graph model policies

- status: verified
- Priority: P1
- Depends on: Slice 4, Slice 6, Slice 8
- Findings: F10, F19, F22
- Owner: Cognitive evaluation owner
- Contract and policy trace: C05,C06,C08,C17; NP02,NP06,NP09,NP11; NP14; AT02,AT03,AT06

Use fixed source evidence to compare initial-scan economics and mature-graph dream/normalization quality. Separate creative candidate generation from skeptical evidence checking. Preserve route/prompt/model/schema versions on artifacts.

**Acceptance and verification:** Offline eval is mandatory; optional paid canaries require a stated cap. Report factual errors, useful novel candidates, independent validation, fallback/refusal, cost and latency. A frontier model cannot bypass truth gates. Skipped canaries stay unverified; no production account or live consequential system is used for qualification.

**Review gate:** Reviewer checks the acceptance evidence and cross-subsystem contract impact before this slice is marked verified.

**Rollback / recovery:** Pin the previous profile and prompt; canary candidates stay speculative until validated.

**Implementation anchors:** `src/cognitive/strategies/llm-dream.ts`, `src/cognitive/normalizer.ts`, `src/cognitive/calibration-evaluation.ts`.

**Concrete work and evidence:**

1. Compare fixed evidence/tasks across saved role profiles with frozen prompts/schema versions; include uncertainty, contradiction and genuinely novel hypotheses.
2. Measure unsupported promotion, missed contradictions, evidence accuracy and downstream utility alongside cost; repeated/model-consensus evidence shares ancestry.
3. Run deterministic fixtures by default; paid canaries require run/day reservations and independent retention/data consent; pin the old profile until acceptance.
4. Add optional C17 provider canaries over disposable UI fixtures, separately pinned and budgeted with declared screenshot/DOM disclosure and retention; require task outcome and usage evidence without paid default CI.
5. Apply the revision-7 execution handoff: Offline policy/evidence cases and evaluator reproducibility pass; future normalizer/agent/CU superiority is not asserted at this exit. Required compound evidence: XS01, XS05, XS14.

**Execution handoff (revision 7):** Slices 4/6/8 provide fixed task evaluator, bounded calls and capabilities; existing normalizer is a measured baseline, not the future truth gate. Evaluate the current normalizer as baseline and supply a reusable evaluator. The new normalizer is implemented in 15; composed profile/task evidence closes in 27 and actual CU canaries in 31/27. See [Slice 9 simulation](../docs/audits/2026-09-30-coverage/execution-simulation.md#s9) for affected records, consumers and compound evidence.

**Evidence packet:** Link the changed contract/schema, fixture or failure trace, command and actual result, relevant graph/config revision, limitations and reviewer decision in the implementation log. These checks are requirements, not completed test claims.


### Slice 10 — Validate and persist all configuration

- status: verified
- Priority: P1
- Depends on: Slice 0, Slice 2, Slice 7
- Findings: F12, F13
- Owner: Core configuration owner
- Contract and policy trace: C07,C17; NP04,NP09,NP12; configuration and template scenarios; NP14

Create shared schemas and an atomic persisted configuration authority for scheduler, events, narrative, model roles, retrieval and budgets. Define environment/instance/session precedence and redaction.

**Acceptance and verification:** NaN, infinities, negative rates and cross-field contradictions fail without mutation; save/restart/readback preserves valid settings; each UI shows requested, effective and source values. Templates cannot turn an old autonomy setting into a desktop grant, remove limits or silently enable remote workers.

**Review gate:** Reviewer checks the acceptance evidence and cross-subsystem contract impact before this slice is marked verified.

**Rollback / recovery:** Version configuration and keep a last-known-good file with reversible migrations.

**Implementation anchors:** `src/utils/engine-env.ts`, `src/server/dashboard.ts`, `src/cognitive/scheduler.ts`, `src/cognitive/event-router.ts`.

**Concrete work and evidence:**

1. Inventory all consumed/template/documented keys; define typed ranges, units, defaults, source precedence, secrets and hot-reload versus restart semantics.
2. Validate and persist an entire candidate config against an expected config revision; expose persisted/requested/effective values without leaking credentials.
3. Preview template diff and protected fields, back up then atomically apply; undo checks intervening changes and never resets graph or schedules implicitly.
4. Extend the validated setting inventory with C17 enablement, target/worker profiles, route controls, finite action/image/time limits and local/provider retention; upgrade defaults off, preserve secrets and avoid manual engine.env editing.
5. Apply the revision-7 execution handoff: Invalid keys/ranges, template previews, atomic disk failure and concurrent undo are tested; no implicit spend/remote/full-access enablement. Required compound evidence: XS06, XS18.

**Execution handoff (revision 7):** Slices 2/7 supply commit primitive, setting/policy schemas and effective-profile semantics. Follow the durable entry/exit, recovery and coexistence boundaries in the slice record. See [Slice 10 simulation](../docs/audits/2026-09-30-coverage/execution-simulation.md#s10) for affected records, consumers and compound evidence.

**Evidence packet:** Link the changed contract/schema, fixture or failure trace, command and actual result, relevant graph/config revision, limitations and reviewer decision in the implementation log. These checks are requirements, not completed test claims.


### Slice 11 — Isolate sessions and harden transport authority

- status: verified
- Priority: P1
- Depends on: Slice 0, Slice 5, Slice 6, Slice 7, Slice 10
- Findings: F14, F20, F26
- Owner: Daemon authority/session owner
- Contract and policy trace: C09,C17; NP03,NP04,NP09; NP14; AT01,AT05

Scope browser history, selected plan, provider continuations and cancellation by session/execution. Specify loopback binding and explicit authenticated remote mode; enforce origin/host and browser-mutation protections consistently.

**Acceptance and verification:** Two overlapping clients cannot stop, change or read each other’s private execution state; reconnect targets the right job; local legitimate workflows pass; untrusted origin and unauthorized remote mutations fail. C17 control-port fixtures reject cross-session control here; real CU04–CU07/CU10–CU12 cancellation outside the model loop is a mandatory Slice 31 gate, and unsupported native controls block activation.

**Review gate:** Reviewer checks the acceptance evidence and cross-subsystem contract impact before this slice is marked verified.

**Rollback / recovery:** Compatibility mode only with explicit documented trust boundaries; session migration is recoverable.

**Implementation anchors:** `src/index.ts`, `src/architect/routes.ts`, `src/server/dashboard.ts`, `src/discipline/session.ts`, `packages/host/src/watchdog.ts`.

**Concrete work and evidence:**

1. Default bind to loopback; define authenticated explicit remote mode and visible bind/auth status; reject unsupported unsafe combinations.
2. Scope selections/history/provider state/cancel controls by principal, session and execution; retain daemon-owned jobs across browser refresh.
3. Add a human-confirmed scoped full-access grant with two explicit confirmations, expiry and revocation; it never removes truth, commit, audit or configured cost limits.
4. Provide C17 authenticated worker/native-runtime bindings, session ownership, scope/grant expiry, cancel/pause and recovery. Physical input is arbitrated across daemon instances by interactive seat, not only by one daemon’s mutex.
5. Apply the revision-7 execution handoff: Real transport/session/cancel fixtures pass, including full-access finite double confirmation; CU worker/seat behavior is an obligation for 31, not a mocked support claim. Required compound evidence: XS04, XS06, XS07, XS17.

**Execution handoff (revision 7):** Slices 5/6/7/10 provide durable execution identity, budget and config; C14/C17 semantics exist as frozen ports. Freeze and exercise the C17 control/lease ports here; physical-seat arbitration and native-runtime stop are implemented and qualified in Slice 31. See [Slice 11 simulation](../docs/audits/2026-09-30-coverage/execution-simulation.md#s11) for affected records, consumers and compound evidence.

**Evidence packet:** Link the changed contract/schema, fixture or failure trace, command and actual result, relevant graph/config revision, limitations and reviewer decision in the implementation log. These checks are requirements, not completed test claims.


### Slice 12 — Align the complete MCP catalog and client contracts

- status: verified
- Priority: P1
- Depends on: Slice 1, Slice 5, Slice 8, Slice 10, Slice 11
- Findings: F16, F18
- Owner: Daemon MCP contract owner
- Contract and policy trace: C01,C02,C03,C04,C09,C15,C16,C17; NP04,NP05,NP06; NP14; AT01–AT06

Generate tool/resource manifests from registration, annotate effects and idempotency, normalize errors and cancellation, and enforce ADR-123 discipline parity. Exercise native HTTP/stdio where supported, daemon API and CLI bridges using isolated fixtures.

**Acceptance and verification:** Every baseline tool has success, invalid-input, unavailable-dependency and permission tests where applicable; writes use disposable data; schema/catalog/docs parity is automatic; structured results survive bridge conversion. GE05 covers machine-readable context/reconciliation receipts and honest external-client limits; tool descriptions alone cannot certify the loop. Context actions cannot rely on client labels, stale selection or arbitrary action URLs as authority; no duplicate public mutation API is added where an existing command suffices. Native CLI and API consumers share meaning and authority, not forced tool names or continuation envelopes.

**Review gate:** Reviewer checks the acceptance evidence and cross-subsystem contract impact before this slice is marked verified.

**Rollback / recovery:** Version contracts and advertise capabilities so older clients fail clearly rather than corrupting state.

**Implementation anchors:** `src/tools`, `src/resources/register.ts`, `src/cognitive/register.ts`, `src/discipline`.

**Concrete work and evidence:**

1. Generate catalogs/SDK schemas and classify effects, idempotency and authority from core; reconcile ADR-123 and existing tool names.
2. Conformance-test every tool’s input/result/error/continuation/permission contract with disposable state; avoid duplicating shared suites per transport.
3. Test native and bridge serialization, replay and version mismatch; retire legacy presentations only after the published sunset.
4. Audit existing tools/resources before extending bounded task-context begin/refresh/change/finish semantics; publish generated contracts/examples and distinguish daemon-enforced actions from unattested external MCP client behavior.
5. Expose/reuse versioned command descriptors and eligibility/reason metadata for C16 plan/slice/schedule/ADR/concern targets, including captured identity, relevant revision and existing confirmation/receipt semantics.
6. Publish C17 generated semantic contracts and scoped harness operations through the existing registry, while CLI-native tools retain their names and execution mechanism; normalize evidence/status without falsifying missing native telemetry.
7. Apply the revision-7 execution handoff: Baseline catalog parity and effect conformance pass now; each later feature registers/tests its contributions in its own slice and 27 closes the final catalog. Required compound evidence: XS03, XS07, XS10, XS13.

**Execution handoff (revision 7):** Slices 1/5/8/10/11 provide result, receipt, adapter/config and authority foundations. Close the existing baseline catalog now. Every later feature updates generated descriptors and adds conformance evidence in its own slice; the final complete catalog is gated in 27. See [Slice 12 simulation](../docs/audits/2026-09-30-coverage/execution-simulation.md#s12) for affected records, consumers and compound evidence.

**Evidence packet:** Link the changed contract/schema, fixture or failure trace, command and actual result, relevant graph/config revision, limitations and reviewer decision in the implementation log. These checks are requirements, not completed test claims.


### Slice 13 — Make the strategy registry executable and testable

- status: verified
- Priority: P1
- Depends on: Slice 0, Slice 2, Slice 5, Slice 6, Slice 12
- Findings: F08, F09, F18
- Owner: Dreamer strategy owner
- Contract and policy trace: C01,C05,C15; NP02,NP11,NP13; AT03

Unify strategy names, descriptions, dispatch, requirements and output budgets. Implement or explicitly retire reflective. Add seeded positive/negative fixtures for all structural strategies, LLM schema fixtures and causal replay.

**Acceptance and verification:** Every advertised choice produces an exercised execution path or explicit unsupported error; no input mutation, invalid endpoints, self-links or undocumented cap overflow; positive missing-abstraction and empty graphs are tested. Strategy admission respects the dirty scope, evidence/cause identity, canonical role semantics and independent bounds; unknown broader scope remains visible.

**Review gate:** Reviewer checks the acceptance evidence and cross-subsystem contract impact before this slice is marked verified.

**Rollback / recovery:** Strategy-level feature flags preserve stable strategies while a failed one is disabled visibly.

**Implementation anchors:** `src/cognitive/dreamer.ts`, `src/cognitive/strategies`, `src/cognitive/register.ts`.

**Concrete work and evidence:**

1. Unify advertisement/dispatch/requirements/budgets in the existing strategy mechanism; implement or explicitly retire reflective.
2. Add positive, negative, empty and seeded fixtures for all choices, including missing abstraction, symmetry counterexamples and causal replay.
3. Assert valid speculative outputs, preserved inputs/ancestry and bounded allocation; creative unproven ideas remain reviewable.
4. Define C15 affected-region and stage inputs for each strategy through the existing registry; do not run every strategy for every edit or impose a mandatory minimum-hop expansion.
5. Apply the revision-7 execution handoff: Every advertised strategy has bounded deterministic positive/negative/empty fixtures or explicit retirement; reflective disposition is recorded. No confidence-only factual promotion. Required compound evidence: XS09, XS11, XS14.

**Execution handoff (revision 7):** Slices 2/5/6/12 supply evidence snapshots, receipts, admitted work and registered strategy/action contracts. Follow the durable entry/exit, recovery and coexistence boundaries in the slice record. See [Slice 13 simulation](../docs/audits/2026-09-30-coverage/execution-simulation.md#s13) for affected records, consumers and compound evidence.

**Evidence packet:** Link the changed contract/schema, fixture or failure trace, command and actual result, relevant graph/config revision, limitations and reviewer decision in the implementation log. These checks are requirements, not completed test claims.


### Slice 14 — Measure and persist useful strategy yield

- status: verified
- Priority: P2
- Depends on: Slice 9, Slice 13, Slice 15
- Findings: F09, F10
- Owner: Dreamer adaptation owner
- Contract and policy trace: C05,C08,C15; NP02,NP05,NP11,NP13; AT03

Persist post-dedup novelty, evidence quality, validation outcomes, usefulness and cost by strategy/version. Bound exploration and eliminate zero-budget and rounding surprises.

**Acceptance and verification:** Duplicate floods do not increase utility scores; restart preserves learning; zero/tiny budgets and unfair ordering are covered; compare adaptive allocation with a fixed baseline on labeled traces. GE12 prevents self-triggering dream loops and repeated-evidence credit while preserving useful labeled exploration.

**Review gate:** Reviewer checks the acceptance evidence and cross-subsystem contract impact before this slice is marked verified.

**Rollback / recovery:** Resettable versioned portfolio statistics and a deterministic fixed-allocation fallback.

**Implementation anchors:** `src/cognitive/dreamer.ts`, `src/cognitive/metacognition.ts`.

**Concrete work and evidence:**

1. Persist versioned post-dedup yield and cost observations with evidence ancestry and restart behavior.
2. Allocate bounded exploitation/exploration without rewarding paraphrase floods, graph growth or confidence alone.
3. Test zero/tiny/parallel budgets and repeated restarts against a fixed-allocation baseline; keep novelty separate from factual promotion.
4. Measure targeted digestion by useful, evidence-backed incremental outcomes; coalesce equivalent candidates and bound feedback generations instead of rewarding model output volume or repeated rediscovery.
5. Apply the revision-7 execution handoff: Fixed-allocation comparisons and replays prove adaptive behavior without rewarding volume, confidence or self-corroboration; final task benefit at 27. Required compound evidence: XS05, XS11, XS15.

**Execution handoff (revision 7):** Slices 9/13/15 provide reproducible evaluator, actual candidate production and evidence-based validation outcomes. Follow the durable entry/exit, recovery and coexistence boundaries in the slice record. See [Slice 14 simulation](../docs/audits/2026-09-30-coverage/execution-simulation.md#s14) for affected records, consumers and compound evidence.

**Evidence packet:** Link the changed contract/schema, fixture or failure trace, command and actual result, relevant graph/config revision, limitations and reviewer decision in the implementation log. These checks are requirements, not completed test claims.


### Slice 15 — Calibrate normalization and evidence independence

- status: verified
- Priority: P1
- Depends on: Slice 2, Slice 5, Slice 9, Slice 13
- Findings: F10
- Owner: Normalizer/trust owner
- Contract and policy trace: C01,C04,C08,C15; NP02,NP11,NP13; AT03,AT06

Retain existing provenance gates while adding independent evidence attribution, contradiction handling and stale-source checks. Separate operational promotion rate from labeled precision/recall. Use model-assisted judgment as evidence, not authority.

**Acceptance and verification:** Correlated repeated suggestions cannot self-validate; fabricated clusters and stale references fail; positive supported relations pass; confidence calibration is measured and review decisions remain inspectable. GE08/GE12/GE13 require evidence-based validation/invalidation and no graph-to-model-to-graph laundering of the same unsupported claim.

**Review gate:** Reviewer checks the acceptance evidence and cross-subsystem contract impact before this slice is marked verified.

**Rollback / recovery:** Keep rejected/latent records reviewable; rollback thresholds without erasing evidence or undo history.

**Implementation anchors:** `src/cognitive/normalizer.ts`, `src/cognitive/evidence-ledger.ts`, `src/cognitive/trust-state.ts`, `src/cognitive/calibration-evaluation.ts`.

**Concrete work and evidence:**

1. Keep provenance and trust separate; explicitly define human assertion, source-backed observation, hypothesis, disputed and validated states.
2. Track independent evidence ancestry, revision/freshness and contradiction; on source withdrawal require re-evaluation without erasing history.
3. Test repeated circulation through dream/narrative/federation and model consensus cannot launder evidence; evaluate labeled accuracy independently of promotion rate.
4. Normalize affected candidates against current evidence/contradictions, retaining ancestry and stale/reopened dispositions; a stronger model or repeated generated claim cannot clear dirty verification debt by confidence alone.
5. Apply the revision-7 execution handoff: Labeled independent-evidence/cold-start/contradiction fixtures pass; scoped ADR-096 amendment is reviewed before changed promotion policy activates. Required compound evidence: XS11, XS14, XS15, XS21.

**Execution handoff (revision 7):** Slices 2/5/9/13 supply canonical evidence, receipts, evaluation baseline and real candidate schema. Follow the durable entry/exit, recovery and coexistence boundaries in the slice record. See [Slice 15 simulation](../docs/audits/2026-09-30-coverage/execution-simulation.md#s15) for affected records, consumers and compound evidence.

**Evidence packet:** Link the changed contract/schema, fixture or failure trace, command and actual result, relevant graph/config revision, limitations and reviewer decision in the implementation log. These checks are requirements, not completed test claims.


### Slice 16 — Align decay maintenance and human curation

- status: verified
- Priority: P1
- Depends on: Slice 5, Slice 15
- Findings: F17, F21
- Owner: Core maintenance/curation owner
- Contract and policy trace: C04,C10,C15; NP07,NP10,NP11; AT03,AT05,AT06

Define retention, TTL, reinforcement, tombstone and supersession behavior across candidates, validated insights, source facts and human decisions. Make maintenance jobs share revision/commit semantics.

**Acceptance and verification:** Reject then rediscover, delete then rescan, source rename, decay and human correction traces converge without resurrection, dangling links or loss of reviewed facts. C15 retrieval remains usable during pending digestion; unknown dependency impact is visible and completed task scaffolding does not dominate fresh context.

**Review gate:** Reviewer checks the acceptance evidence and cross-subsystem contract impact before this slice is marked verified.

**Rollback / recovery:** Dry-run maintenance and reversible archive/tombstone operations before deletion.

**Implementation anchors:** `src/cognitive/engine.ts`, `src/cognitive/graph-maintenance-state.ts`, `src/graph`.

**Concrete work and evidence:**

1. Define TTL, tombstone, rejection memory and source-deletion treatment by provenance/trust class.
2. Reuse revisioned commit/recovery for maintenance; retain human contributions and pending contradictions.
3. Test rejected rediscovery, rename/delete, revoked evidence and restart; archive before destructive retirement and expose loss/ambiguity.
4. Invalidate impacted derived knowledge on source/decision changes while preserving valid unrelated facts and human history; crystallize verified work before retiring obsolete operational plan graph noise.
5. Apply the revision-7 execution handoff: Rename/delete/reject/reopen and crash cases preserve history; time-sensitive observations have explicit kind-specific validity, distinct from full-scan age. Required compound evidence: XS02, XS11, XS15, XS21.

**Execution handoff (revision 7):** Slices 5/15 provide durable mutation and validated evidence semantics. Follow the durable entry/exit, recovery and coexistence boundaries in the slice record. See [Slice 16 simulation](../docs/audits/2026-09-30-coverage/execution-simulation.md#s16) for affected records, consumers and compound evidence.

**Evidence packet:** Link the changed contract/schema, fixture or failure trace, command and actual result, relevant graph/config revision, limitations and reviewer decision in the implementation log. These checks are requirements, not completed test claims.


### Slice 17 — Coordinate engine scheduling events and bootstrap

- status: verified
- Priority: P1
- Depends on: Slice 6, Slice 10, Slice 13, Slice 16
- Findings: F07, F21
- Owner: Core engine/scheduler owner
- Contract and policy trace: C04,C05,C11,C15,C17; NP01,NP03,NP04,NP13; scheduler and lifecycle traces; NP14

Integrate core cognitive states, manual jobs, scheduled dreams, targeted dreams, event routing and bootstrap under explicit ownership, concurrency, cancellation and budget rules. Define restart and event deduplication.

**Acceptance and verification:** Manual scan plus scheduled dream plus duplicate event storm stays within budget and concurrency limits; all errors restore a valid engine state; restart neither loses nor duplicates accepted work. GE09–GE13 prove edits coalesce, G+1 survives completion of G, no unbounded queue/full-graph fallback/self-trigger loop occurs, and optional unfunded cognition stays visibly pending without making valid source facts unusable. The CU21 graph-follow-up contract is exercised with typed effect fixtures here; Slice 31 proves the actual GUI route and that no background job acquires an unrelated interactive desktop.

**Review gate:** Reviewer checks the acceptance evidence and cross-subsystem contract impact before this slice is marked verified.

**Rollback / recovery:** Pause background producers and drain committed jobs; resume from the journal with previous policy.

**Implementation anchors:** `src/cognitive/engine.ts`, `src/cognitive/scheduler.ts`, `src/cognitive/event-router.ts`, `src/cognitive/bootstrap-driver.ts`, `src/cognitive/graph-maintenance-state.ts`, `src/cognitive/llm-readiness.ts`, `src/webhooks/worker.ts`, `src/webhooks/store.ts`.

**Concrete work and evidence:**

1. Centralize admission for manual/scheduled/event/targeted/bootstrap jobs with one owner, budget and cancellation contract.
2. Define durable state transitions, run leases, idempotent dispatch, missed/overlap policies and crash recovery; invalid action parameters block visibly instead of broadening to defaults.
3. Expose scheduler preview/validate/update/run/status APIs used by all surfaces; implement C11 semantics before the schedule workspace in Slice 29.
4. Implement the C15 durable affected-region ledger and staged digestion on existing maintenance/event/scheduler owners: coalesced generation markers, debounce/idle/max-age fairness, bounded overflow partitions, causal deduplication, budgets, stage receipts and restart recovery.
5. Reuse C15 dirty-generation/digestion admission for material Computer Use changes; coalesce outcomes and never trigger paid cognition on every screenshot. Scheduled GUI work requires the appropriate isolated environment and explicit finite grant.
6. Apply the revision-7 execution handoff: Offline SC01–13 core, generation and readiness fixtures pass; post-office intent maps to existing event/webhook delivery. No second scheduler/job authority. Required compound evidence: XS04, XS05, XS09, XS11, XS12, XS21.

**Execution handoff (revision 7):** Slices 6/10/13/16 supply admitted jobs, typed config, strategies and maintenance invalidation. Follow the durable entry/exit, recovery and coexistence boundaries in the slice record. See [Slice 17 simulation](../docs/audits/2026-09-30-coverage/execution-simulation.md#s17) for affected records, consumers and compound evidence.

**Evidence packet:** Link the changed contract/schema, fixture or failure trace, command and actual result, relevant graph/config revision, limitations and reviewer decision in the implementation log. These checks are requirements, not completed test claims.


### Slice 18 — Align temporal causal and federated evidence

- status: verified
- Priority: P2
- Depends on: Slice 2, Slice 15, Slice 16, Slice 17
- Findings: F10, F21
- Owner: Temporal/causal/federation owner
- Contract and policy trace: C01,C02,C04,C15; NP08,NP11,NP13; AT03,AT06

Specify observation/event time, causal-hypothesis status, duplicate history and foreign-origin trust. Test federation schema compatibility, origin retention, redaction, import deduplication and local validation.

**Acceptance and verification:** Out-of-order replay is stable; repeated imports do not inflate confidence; external hypotheses cannot enter local facts without evidence; correlation is labeled explicitly. Out-of-order or imported evidence participates in bounded dirty generations without granting foreign/generated assertions local factual authority.

**Review gate:** Reviewer checks the acceptance evidence and cross-subsystem contract impact before this slice is marked verified.

**Rollback / recovery:** Quarantine imports and keep versioned export manifests; disable causal/federated promotion independently.

**Implementation anchors:** `src/cognitive/temporal.ts`, `src/cognitive/causal.ts`, `src/cognitive/federation.ts`.

**Concrete work and evidence:**

1. Define event/observation times and foreign origin/schema/trust/redaction rules.
2. Make replay/import idempotent, retain shared ancestry and distinguish correlation from causal hypotheses.
3. Test out-of-order history, repeated imports, stale sources and unknown versions; local validation remains required for promotion.
4. Use C15 evidence dependency changes to re-evaluate only plausibly affected temporal/causal/federated knowledge, preserving origin, event time, stale markers and explicit unknown wider impact.
5. Apply the revision-7 execution handoff: Golden history/import/counterexample fixtures prove no causal certainty from correlation or independent support from repeated import. Required compound evidence: XS11, XS15.

**Execution handoff (revision 7):** Slices 2/15/16/17 provide canonical ancestry, invalidation and durable stage/event admission. Follow the durable entry/exit, recovery and coexistence boundaries in the slice record. See [Slice 18 simulation](../docs/audits/2026-09-30-coverage/execution-simulation.md#s18) for affected records, consumers and compound evidence.

**Evidence packet:** Link the changed contract/schema, fixture or failure trace, command and actual result, relevant graph/config revision, limitations and reviewer decision in the implementation log. These checks are requirements, not completed test claims.


### Slice 19 — Unify tension remediation and future review

- status: verified
- Priority: P1
- Depends on: Slice 15, Slice 17, Slice 18
- Findings: F11, F21
- Owner: Tension/intervention owner
- Contract and policy trace: C01,C04,C15; NP02,NP11,NP13; AT03,AT05,AT06

Connect adversarial detection, clustering/noise, resolution/reappearance, remediation candidates and adaptive future outcomes with stable IDs and explicit review/verification transitions.

**Acceptance and verification:** One risk has consistent state across all views; evidence change can reopen it; suggested or executed remediation alone never proves resolution; branch outcomes and human overrides remain traceable. GE13 shows relevant tensions reevaluated with evidence, while unrelated risks remain stable and unresolved tension can be an honest settled result.

**Review gate:** Reviewer checks the acceptance evidence and cross-subsystem contract impact before this slice is marked verified.

**Rollback / recovery:** Retain original risk and review history; supersede proposals instead of erasing them.

**Implementation anchors:** `src/cognitive/adversarial.ts`, `src/cognitive/tension-clustering.ts`, `src/cognitive/intervention.ts`.

**Concrete work and evidence:**

1. Use stable risk/branch IDs and distinguish noise, actionable tension, resolution proposal, action and verified outcome.
2. Preserve evidence changes, human overrides and reappearance reasons across remediation and adaptive futures.
3. Test contradictions and stale evidence reopen review correctly; execution success alone never resolves a risk.
4. Consume affected-region evidence changes to resolve or reopen relevant tensions through existing verification gates; a proposed remedy or completed digestion run is not proof of tension resolution.
5. Apply the revision-7 execution handoff: Compound contradiction/reopen/remediation cases prove outcome verification and correct bounded follow-up without source evidence laundering. Required compound evidence: XS09, XS11, XS15.

**Execution handoff (revision 7):** Slices 15/17/18 provide trust, admitted stages and temporal/causal ancestry. Follow the durable entry/exit, recovery and coexistence boundaries in the slice record. See [Slice 19 simulation](../docs/audits/2026-09-30-coverage/execution-simulation.md#s19) for affected records, consumers and compound evidence.

**Evidence packet:** Link the changed contract/schema, fixture or failure trace, command and actual result, relevant graph/config revision, limitations and reviewer decision in the implementation log. These checks are requirements, not completed test claims.


### Slice 20 — Make lifecycle narrative and lucid interaction consistent

- status: verified
- Priority: P2
- Depends on: Slice 11, Slice 16, Slice 19, Slice 21
- Findings: F21
- Owner: Narrative/lucid/lifecycle owner
- Contract and policy trace: C01,C03,C04,C15; NP04,NP11,NP13; AT01,AT03,AT06

Reuse trust/evidence/lifecycle projections for narrator, story, playback and lucid mode. Bind summaries to a revision and preserve human intent and uncertainty.

**Acceptance and verification:** The same candidate has the same trust and provenance in each surface; replay distinguishes history from current state; stale summaries warn; lucid session exit restores engine ownership correctly. GE13/GE15 recover durable outcomes without replaying a prior transcript or activating archived implementation instructions.

**Review gate:** Reviewer checks the acceptance evidence and cross-subsystem contract impact before this slice is marked verified.

**Rollback / recovery:** Expose raw evidence alongside prior summary and rebuild projections from durable events.

**Implementation anchors:** `src/cognitive/narrator.ts`, `src/cognitive/playback.ts`, `src/cognitive/lucid.ts`, `src/cognitive/lifecycle-visibility.ts`.

**Concrete work and evidence:**

1. Consume existing trust/evidence projections and bind summaries/playback to revision and time.
2. Preserve original evidence ancestry through narration and explicit human intent in lucid sessions; restore ownership on exit/failure.
3. Test historical/current distinction, stale summary disclosure and cross-client reconstruction without turning summarization into validation.
4. Refresh only affected narrative/lifecycle projections from committed evidence; retain verified consequences and human intent for the next agent, while permanent plan history stays in Markdown/logs under ADR-207.
5. Apply the revision-7 execution handoff: Replay/lucid/narration tests preserve temporal truth, per-session control and meaningful exploration; generated-doc re-ingestion retains origin. Required compound evidence: XS07, XS08, XS11, XS16.

**Execution handoff (revision 7):** Slices 11/16/19/21 supply scoped sessions, evidence lifecycle, tensions and authoritative plan state. Follow the durable entry/exit, recovery and coexistence boundaries in the slice record. See [Slice 20 simulation](../docs/audits/2026-09-30-coverage/execution-simulation.md#s20) for affected records, consumers and compound evidence.

**Evidence packet:** Link the changed contract/schema, fixture or failure trace, command and actual result, relevant graph/config revision, limitations and reviewer decision in the implementation log. These checks are requirements, not completed test claims.


### Slice 21 — Repair plan and discipline lifecycle projection

- status: verified
- Priority: P1
- Depends on: Slice 0, Slice 5, Slice 11, Slice 12
- Findings: F15, F21
- Owner: Plan/discipline authority owner
- Contract and policy trace: C01,C02,C04,C09,C12,C14,C15,C16,C17; NP03,NP04,NP05,NP08,NP12; NP14; AT01,AT05; PL01–PL16

Implement the [coherent lifecycle/status design](../docs/audits/2026-09-30-coverage/plan-lifecycle-status.md) as contract C14. Core/daemon owns one revisioned projection of plan lifecycle, effective slice states, explicit current ownership, actual running leases, dependency-aware next eligibility, progress and resume actions. Align every Architect panel, task memory, CLI/API/MCP, VS Code and relevant dashboard/analytics consumers. Separate selection, recommendations, audit activity, implementation and verified completion; no prose, raw-status regex or first-slice fallback authorizes or reports work.

**Acceptance and verification:** PL01–PL15 authority/local-UI cases pass with actual persisted transitions; PL16 core protocol conformance passes here and its full client matrix closes in Slice 25. The supplied draft/idle fixture has no current/running slice and an approval-gated Slice 0 recommendation. Implemented remains awaiting verification; blockers, failed checks, reopenings and final plan verification survive restart. The shared authority returns the same effective status/current/next for the same revision; actual adoption by every surface is required in Slice 25. Verified sidebar cards are muted and readable, running cards use restrained green with text/icon, and selection is visually separate. Unknown legacy evidence never becomes verified success. GE14 blocks slice closure when required reconciliation or derived acceptance is incomplete, without blocking closure merely for optional unfunded cognition. The command/reducer portions of UX02/UX03/UX11/UX12 reject stale or ambiguous targets and preserve lifecycle/evidence gates here; real shared menu interaction closes in Slice 25. CU11/CU22 typed effect fixtures preserve unfinished work and reconciliation here; real native interaction/restart evidence closes in Slice 31.

**Review gate:** Review C14 schema/transition and compatibility fixtures before cutover; review reconciliation deltas before migrating existing plans. Verify the shared authority and Architect behavior here, consumer conformance in Slice 25 and integrated evidence in Slice 27.

**Rollback / recovery:** Preserve original Markdown/logs and IDs with hashes; migrate through one writer with revision-bound preview and backups. Rebuild from typed committed history after crash. Roll back readers through supported adapters; never discard post-cutover transitions by restoring stale files.

**Implementation anchors:** `src/architect/plan-registry.ts`, `src/architect/routes.ts`, `src/discipline`, `src/cli`, `extensions/vscode/src`, `packages/sdk`.

**Concrete work and evidence:**

1. Inventory every plan status writer/reader and capture the supplied zero-checkpoint draft, raw-sidebar and future-review divergence fixtures; preserve stable plan/slice IDs.
2. Extend existing plan/discipline authority with typed revisioned transitions and one deterministic reducer; separate design approval, slice implementation/verification and execution leases under C14.
3. Implement dependency-aware next eligibility, current/running ownership, valid last-completed and unique-slice progress; preserve blockers, reopenings, accepted deferrals and final plan verification.
4. Add idempotent durable commands, conflict receipts, restart recovery and atomic snapshot/event convergence; selection and another client cannot steal or advance work.
5. Preview/reconcile legacy Markdown/log status with source hashes and backups; retain unknown evidence, migrate one writer and remove prose/ordinal inference through supported adapters.
6. Use effective projected states in every Architect panel, resume/task-memory and future-review path; dim verified cards accessibly, use restrained green only for running work, and preserve compact keyboard navigation.
7. Record actual PL01–PL16 and AT01/AT05 evidence; Slice 25 completes the consumer matrix and Slice 27 gates release. No CSS-only or label-only completion claim.
8. Bind C14 completion to material-change reconciliation receipts under C15; expose source/graph/digestion outcomes separately and allow optional bounded digestion to remain pending after reconciled verified work.
9. Supply C16 stable plan/slice/concern targets and state-appropriate commands. Replace text/index-based concern mutation with stable identity or a revision-bound source anchor, preserving distinct acknowledgement, mitigation and evidence-backed resolution.
10. Project C17 required-capability eligibility, lost-capability blockers, pause/stop/recovery and independently verified postconditions into C14 lifecycle; GUI success alone cannot complete a slice.
11. Apply the revision-7 execution handoff: PL01–16 authority and core UI fixtures pass; required reconciliation gates verification, optional cognition does not. Future CU consumers bind at 31, full surface matrix at 25. Required compound evidence: XS07, XS08, XS09, XS18.

**Execution handoff (revision 7):** Slices 5/11/12 provide receipt, session and command authority; earlier implementation history is imported from stable reviewed IDs and hashes. Verify lifecycle authority with contract doubles for not-yet-built CU consumers; real native-capability loss and GUI effects are integrated in 31. Full client matrix closes in 25. See [Slice 21 simulation](../docs/audits/2026-09-30-coverage/execution-simulation.md#s21) for affected records, consumers and compound evidence.

**Evidence packet:** Link the changed contract/schema, fixture or failure trace, command and actual result, relevant graph/config revision, limitations and reviewer decision in the implementation log. These checks are requirements, not completed test claims.


### Slice 22 — Align analytics health and observability

- status: verified
- Priority: P1
- Depends on: Slice 2, Slice 5, Slice 15, Slice 19, Slice 21
- Findings: F11, F19, F21
- Owner: Core metric definitions/analytics owner
- Contract and policy trace: C01,C03,C08,C15; NP05,NP08,NP12; AT03,AT06

Publish metric definitions and common revision/time/identity denominators for all 13 analytics modules, health, metacognition, lifecycle and dashboard. Separate integrity, freshness, coverage, readiness and workload. Trace job/model/graph revisions without secrets.

**Acceptance and verification:** Critical defects cannot be averaged into healthy; stale snapshots are labeled; golden graphs have known counts; TypeScript/Python results agree where definitions match; synthetic benchmarks cannot be reported as real performance. Context delivered is not labeled context understood; avoided rereads and improved outcomes require paired evidence, with graph-preparation cost and cold/warm effects stated.

**Review gate:** Reviewer checks the acceptance evidence and cross-subsystem contract impact before this slice is marked verified.

**Rollback / recovery:** Keep versioned metric names and historical data; never compare incompatible denominators silently.

**Implementation anchors:** `src/tools/graph-health.ts`, `src/cognitive/calibration-evaluation.ts`, `python/analytics`, `src/observability`, `python/analytics/loader.py`.

**Concrete work and evidence:**

1. Specify denominators, snapshot revision, unknown counts and freshness for all 13 analytics modules and health/weather summaries.
2. Generate shared schema artifacts and compare TypeScript/Python golden outputs without forcing identical presentation.
3. Separate structural/semantic coverage, evidence quality, workload and task usefulness; critical failures stay visible; synthetic measures stay labeled.
4. Publish C15 context utility, evidence use, justified source rereads, graph-sync lag, dirty age/coalescing, digestion cost and next-agent recovery metrics with comparable revisions and known measurement limits.
5. Apply the revision-7 execution handoff: All 13 analytics modules compare semantic goldens; XS21 proves one initial scan plus managed changes stays healthy/current while real scoped gaps remain visible. Required compound evidence: XS13, XS16, XS21.

6. Expose canonical graph-mutation/full-scan/source-reconciliation markers in MCP/health/API and every consumer; XS21 proves agents do not infer stale graph from scan age or hide scoped gaps behind an unrelated new mutation.

**Execution handoff (revision 7):** Slices 2/5/15/19/21 provide coherent graph/receipt/trust/risk/plan projections. Follow the durable entry/exit, recovery and coexistence boundaries in the slice record. See [Slice 22 simulation](../docs/audits/2026-09-30-coverage/execution-simulation.md#s22) for affected records, consumers and compound evidence.

**Evidence packet:** Link the changed contract/schema, fixture or failure trace, command and actual result, relevant graph/config revision, limitations and reviewer decision in the implementation log. These checks are requirements, not completed test claims.


### Slice 23 — Improve dashboard and configuration workflows

- status: verified
- Priority: P1
- Depends on: Slice 10, Slice 11, Slice 17, Slice 21, Slice 22, Slice 25, Slice 29
- Findings: F07, F11, F12, F13, F23
- Owner: Dashboard/configuration surface owner
- Contract and policy trace: C07,C09,C12,C14,C15,C16,C17; NP09,NP12; config/template/browser cases; NP14

Keep the current compact visual language while exposing effective role profiles, graph freshness, actionable debt, costs, job progress, fallback causes, cancellation and recovery. Add accessible field errors and saved/pending/restart-required distinctions. Expand configuration into compact, accessible tabs (models/roles, scanning/enrichment, cognition/truth, schedules/events, retrieval/budgets, repositories/integrations and advanced). Inventory all consumed/documented engine.env keys and expose each safely, with an explanation for intentionally read-only settings. Provide search, defaults, units, help and dependencies. Add reset/apply from the default, Ollama and LM Studio templates with a value diff, scope selection, preserved secrets/instance paths by default, atomic backup and undo. Refresh the daemon root page in the established visual language and add prominent Explorer navigation.

**Acceptance and verification:** Keyboard/browser tests cover configure, save, restart-readback, scan progress, cancel, retry and stale/error states; no secrets leak; status matches CLI/API. Any plan progress display uses C14 effective state and revision, never raw Markdown status or a local lifecycle inference. Every supported setting is mapped to a control or justified exception; normal configuration requires no file editing; template preview has no writes, apply preserves protected values, undo restores the prior config; root-page Explorer link resolves; tabs work by keyboard and retain validation errors. Template/apply/restart preserves dirty obligations and does not silently enable paid digestion; saved/effective limits and stale/pending regions are visible. Shared schedule/context actions retain keyboard/touch entry points and effective-state consistency; menus do not add duplicate confirmations or hidden paid work. Unavailable capabilities have specific remedies; configuration cannot bypass per-session grants or imply all OS backends are qualified.

**Review gate:** Reviewer checks the acceptance evidence and cross-subsystem contract impact before this slice is marked verified.

**Rollback / recovery:** UI changes consume versioned endpoints and preserve working setup workflows. Keep a timestamped pre-template configuration backup and do not reset graph data when resetting configuration.

**Implementation anchors:** `src/server/dashboard.ts`, `src/utils/engine-env.ts`, `templates/default/config/engine.env`.

**Concrete work and evidence:**

1. Implement compact searchable tabs from the setting inventory, with contextual explanation of effective values and restart requirements.
2. Add template preview/apply/reset/undo using the config authority and secret/path protection; expose budgets, routing, freshness and recovery without card clutter.
3. Refresh root navigation including Explorer; embed/link the dedicated schedule workspace owned by Slice 29 rather than recreating schedule policy in forms.
4. Expose compact C15 context/reconciliation/digestion indicators and schema-driven cadence/limit settings; show pending affected knowledge, effective role/model/budget and recovery without adding manual engine.env editing.
5. Use C16 shared action vocabulary and accessible compact menus where dashboard/configuration/schedule views overlap, consuming the same eligibility and failure reasons rather than implementing separate action semantics.
6. Expose C17 optional setup and diagnostics through compact configuration tabs: effective adapter/worker/host, permissions, finite limits, screenshots/privacy and template preview. Reuse native runtime settings where the CLI owns execution.
7. Apply the revision-7 execution handoff: Real browser workflow fixtures cover config/reset/search/keyboard/narrow layouts and shared menu/schedule integration; no duplicate schedule semantics. Required compound evidence: XS06, XS07, XS12, XS21.

**Execution handoff (revision 7):** Slices 10/11/17/21/22/25/29 provide real config, authority, lifecycle/health, shared actions and schedule workspace. Follow the durable entry/exit, recovery and coexistence boundaries in the slice record. See [Slice 23 simulation](../docs/audits/2026-09-30-coverage/execution-simulation.md#s23) for affected records, consumers and compound evidence.

**Evidence packet:** Link the changed contract/schema, fixture or failure trace, command and actual result, relevant graph/config revision, limitations and reviewer decision in the implementation log. These checks are requirements, not completed test claims.


### Slice 24 — Align Explorer and agent evidence navigation

- status: verified
- Priority: P2
- Depends on: Slice 3, Slice 12, Slice 20, Slice 22
- Findings: F03, F21
- Owner: Explorer surface owner
- Contract and policy trace: C01,C03,C12; NP08,NP12; AT02–AT04,AT06

Make 2D/3D inspectors consume the shared trust/revision/evidence model. Keep dense labels navigable, preserve selected short names and reduced-motion behavior, and connect graph selection to useful agent context and source evidence.

**Acceptance and verification:** A selected entity has matching identity, links, provenance and freshness in Explorer and RAG; dense hubs remain usable at zoom extremes; accessibility and bounded render/update work are measured.

**Review gate:** Reviewer checks the acceptance evidence and cross-subsystem contract impact before this slice is marked verified.

**Rollback / recovery:** Preserve existing visual controls and offer stable rendering fallback without changing graph semantics.

**Implementation anchors:** `src/explorer`, `explorer/src`.

**Concrete work and evidence:**

1. Consume canonical identity/trust/provenance/revision in both graph views and inspectors.
2. Keep dense labels, selected short names, reduced motion and bounded updates while linking to the same evidence the agent receives.
3. Test realistic dense graphs, long labels, narrow windows and reconnect/stale states; presentation never silently hides semantic omissions.
4. Apply the revision-7 execution handoff: Realistic dense graph, glass/edge/label accessibility and versioned mutation tests preserve polish and semantic navigation; source age is informational. Required compound evidence: XS07, XS13, XS16, XS21.

**Execution handoff (revision 7):** Slices 3/12/20/22 provide bounded graph/evidence, curated commands, narrative and health semantics. Follow the durable entry/exit, recovery and coexistence boundaries in the slice record. See [Slice 24 simulation](../docs/audits/2026-09-30-coverage/execution-simulation.md#s24) for affected records, consumers and compound evidence.

**Evidence packet:** Link the changed contract/schema, fixture or failure trace, command and actual result, relevant graph/config revision, limitations and reviewer decision in the implementation log. These checks are requirements, not completed test claims.


### Slice 25 — Align Architect VS Code CLI plugins and context budgets

- status: verified
- Priority: P1
- Depends on: Slice 3, Slice 5, Slice 8, Slice 12, Slice 17, Slice 21, Slice 22, Slice 24, Slice 29, Slice 30
- Findings: F04, F14, F16, F21, F22, F26
- Owner: Client/adapter integration owner
- Contract and policy trace: C01,C02,C03,C06,C09,C14,C15,C16,C17; NP04,NP06,NP08,NP13; NP14; AT01–AT06

Implement the [C16 Architect interaction design](../docs/audits/2026-09-30-coverage/architect-context-actions.md) within the existing compact shell. Run one governed task through browser Architect, VS Code, daemon tools, SDK/host plugins, native APIs and Codex CLI adapter. Preserve reserved graph evidence, source citations, tool call IDs, usage, stop/resume and role configuration.

**Acceptance and verification:** C14 consumers agree on identity, lifecycle, slice status, current/running/next eligibility and revision across Architect panels, CLI/API/MCP, VS Code, task memory and the existing dashboard/analytics plan projections; stale clients disclose their limits. The later Slice 23 dashboard makeover consumes those verified projections and is not a prerequisite for this exit. PL16 and AT01/AT05 are required. Equivalent task/evidence/plan state across clients; tool errors are not converted to successful prose; compression preserves required ADR/graph anchors; plugin/provider failure is isolated; no hidden paid escalation. GE01–GE15 exercise actual adapter hooks and shared semantics, including native CLI execution, graph-unavailable policy, omitted evidence and transcript-independent recovery; prompt strings or successful process exit alone do not pass. All twelve C16 UX cases pass. Selected plans are centered/revealed reliably without first-plan substitution or scroll stealing; Nervous Points has an explicit disclosure arrow; useful menus invoke the existing governed workflows with correct target identity and accessible input alternatives. No forcing API continuation onto CLI, broad plugin inheritance or silent executor substitution; consumers use the shared effective capability/status projection.

**Review gate:** Reviewer checks the acceptance evidence and cross-subsystem contract impact before this slice is marked verified.

**Rollback / recovery:** Capability negotiation and adapter-specific rollout switches with explicit unsupported-feature messages.

**Implementation anchors:** `src/architect`, `src/cli`, `extensions/vscode/src`, `packages/host`, `packages/sdk`, `packages/token-economy`, `src/architect/cli-mcp-bridge.ts`, `packages/host/src/loader.ts`, `packages/host/src/watchdog.ts`.

**Concrete work and evidence:**

1. Migrate each surface via canonical adapters and current/previous contract negotiation; document lossy or unsupported legacy paths.
2. Preserve required graph/ADR evidence under compression, while native API continuation and CLI execution keep their own mechanisms.
3. Run the six task families through each applicable client, including reconnect, stop, unsupported settings and plugin failure; compare semantics, not byte-identical prose.
4. Own C15 end-to-end conformance across browser/VS Code Architect, CLI/API/MCP, native APIs, CLI bridges and SDK/host/plugins: context receipt, guarded action, durable change reconciliation, bounded digestion and next-agent recovery, with honest external-client gaps.
5. Implement the C16 contextual action layer for plans, slices, nervous points/open questions, schedules, ADRs and relevant evidence/graph/run targets. Keep four to six useful actions, capture target/revision, reuse existing commands and preserve native text/editor menus; Ask Architect drafts editable context without sending.
6. Add an explicit right/down chevron to Nervous Points and nested foldouts, preserving native disclosure semantics and per-plan view state. Implement one ID-based selected-plan reveal for restoration/intentional selection and a compact Reveal selected plan control; preserve filters, center only the rail and ignore stale loads/background re-renders.
7. Verify UX01–UX12 in a real browser with fake daemon/executors, including 1,000 variable-height plans, filtering, asynchronous selection races, keyboard/touch/focus, viewport clipping and wrong-target mutation rejection.
8. Provide C17 cross-client semantic integration seams for Slice 31: native CLI Computer Use via supported permissions/events/control, native API via DreamGraph harness, typed observation receipts and graph writeback. Preserve CLI tool/image/continuation behavior and review the narrow ADR-217 extension.
9. Apply the revision-7 execution handoff: AT/GE/UX composed traces and eight-surface same-revision comparisons pass. C17 seams exist here; actual workers/native interactions and their controls remain 31 obligations. Required compound evidence: XS07, XS09, XS10, XS16, XS17, XS21.

**Execution handoff (revision 7):** Slices 3/5/8/12/17/21/22/24/29/30 are verified; all ordinary execution and action projections can now compose. Close ordinary connected execution routes now; provide C17 seams to Slice 31 without claiming native GUI qualification. Final all-route evidence remains mandatory in 27. See [Slice 25 simulation](../docs/audits/2026-09-30-coverage/execution-simulation.md#s25) for affected records, consumers and compound evidence.

**Evidence packet:** Link the changed contract/schema, fixture or failure trace, command and actual result, relevant graph/config revision, limitations and reviewer decision in the implementation log. These checks are requirements, not completed test claims.


### Slice 26 — Refresh the legacy DreamGraph graph safely

- status: verified
- Priority: P1
- Depends on: Slice 2, Slice 5, Slice 6, Slice 16, Slice 17, Slice 20, Slice 21, Slice 22, Slice 25
- Findings: F17
- Owner: Core migration/maintenance owner
- Contract and policy trace: C02,C04,C10,C15; NP07,NP10; AT05,AT06

Back up the own-instance data at a fenced, recorded revision, inventory collisions/dangling references and review a migration/delta preview. Repair identities with mappings, reconcile current repository evidence, preserve reviewed decisions and establish scan/enrichment ledgers.

**Closure (2026-10-03):** [Migration closure](../docs/ashoka/slice-26-closure.json) accepts the existing full-family converter/failure/recovery evidence and the exact own-instance snapshot copy: 35 data files/four configuration files, 217 reviewed row dispositions, verified backup, original-receipt replay and byte-exact restoration. Missing baselines and unresolved references remain explicit. The original revision-7 handoff assigns packaged activation to Slice 28; live operator adoption is not silently claimed by this implementation closure. See the [concrete rollout proposal](../docs/ashoka/slice-26-cutover-proposal.md). No original-instance mutation or paid reconstruction occurred.

**Acceptance and verification:** Before/after counts are explainable; targeted IDs resolve; no reviewed provenance is lost; rollback restores a usable graph; paid enrichment is separately capped and approved before running. Unknown legacy scope remains explicit, source and graph receipts retain identity, and post-cutover changes/debt cannot vanish through rollback.

**Review gate:** Reviewer checks the acceptance evidence and cross-subsystem contract impact before this slice is marked verified.

**Rollback / recovery:** Verified snapshot restore plus reversible identity/reconciliation manifests; never repair the unrelated web64-react graph by accident.

**Implementation anchors:** `src/graph`, `src/tools/scan-state.ts`, `src/tools/enrichment-state.ts`, `src/instance`.

**Concrete work and evidence:**

1. Inventory missing/ambiguous history, collisions and supported schema paths without inventing a baseline; separate migration, evidence reconstruction and re-enrichment.
2. Bind the preview/approval to input revision and scope; back up and test restoration, fence incompatible writers, stage and validate before cutover.
3. Test crash/cancel/stale-client/concurrent scan and disposition of post-cutover writes; resume separately capped enrichment only after structural migration is coherent.
4. Migrate legacy source baselines, unknown evidence mappings and dirty/reconciliation state through C15 preview/backup/recovery; seed bounded unresolved-region markers instead of pretending old plans/transcripts are fully reconciled.
5. Apply the revision-7 execution handoff: Disposable full-family crash/restart/post-cutover-write migration passes; optional CU assets/session defaults are installed disabled and qualified by 31/28. Required compound evidence: XS03, XS18, XS19, XS21.

**Execution handoff (revision 7):** Slices 2/5/6/16/17/20/21/22/25 supply composed contracts and family converters; exact migration inputs are reviewed. Follow the durable entry/exit, recovery and coexistence boundaries in the slice record. See [Slice 26 simulation](../docs/audits/2026-09-30-coverage/execution-simulation.md#s26) for affected records, consumers and compound evidence.

**Evidence packet:** Link the changed contract/schema, fixture or failure trace, command and actual result, relevant graph/config revision, limitations and reviewer decision in the implementation log. These checks are requirements, not completed test claims.


### Slice 27 — Add system lifecycle and recovery regression gates

- status: verified
- Priority: P1
- Depends on: Slice 12, Slice 14, Slice 17, Slice 18, Slice 19, Slice 20, Slice 21, Slice 22, Slice 23, Slice 24, Slice 25, Slice 26, Slice 29, Slice 30, Slice 31
- Findings: F18, F21
- Owner: Conformance/release verification owner
- Contract and policy trace: C01–C17; NP01–NP14; AT01–AT06 plus system traces

**Closure review, 2026-10-03:** [Sealed evidence](../docs/ashoka/slice-27-closure.json) reconciles the frozen obligations against the complete passing current-source gate and accepted dependency packets. The maintainer's [release disposition](../docs/ashoka/v14-release-scope.md) fixes Windows/accepted-WSL scope, publishes real-model quality failures without improvement claims, and explicitly separates one-second input release from five-second confirmed termination. Functional/lifecycle/recovery requirements pass; no model-quality failure is relabeled a pass. Exact synchronized package/asset-pinning/upgrade and remote release obligations remain Slice 28. Reviewer: executing agent; no independent paid review is claimed.

Add CI for build/root/extension/analytics/contract/browser tests, a subsystem coverage map and whole-engine traces. Test source change through scan, enrichment, dream, normalize, retrieve, review, restart and repair; inject provider, disk, client and plugin faults.

**Acceptance and verification:** All sixteen C14 lifecycle scenarios have actual recorded results, including cross-surface consistency and accessible sidebar status. Every subsystem family participates in at least one producer-consumer trace; no speculative fact promotion, lost update, budget overflow or cross-session control; coverage exclusions and skipped paid tests are explicit. Every managed, supported, connected project-execution path passes C15; external-client limits and degraded incidents have tested visible dispositions and cannot waive a shipped default integration. Release claims require paired understanding gains, not just retrieval counts. Every C16 target/action family, focus/disclosure path and selected-plan/filter/race scenario has actual evidence; no wrong-plan actions or inaccessible overflow controls are hidden by a visually correct screenshot. C17 musts cannot be waived; each advertised backend has scope/cancel/recovery/evidence proof, with honest reviewed support deferrals and no Windows-only architectural definition.

**Review gate:** Reviewer checks the acceptance evidence and cross-subsystem contract impact before this slice is marked verified.

**Rollback / recovery:** Keep deterministic offline gates separate from opt-in paid canaries; quarantine flaky tests with tracked owner and expiry.

**Implementation anchors:** `tests`, `extensions/vscode/src/test`, `python/analytics`, `.github/workflows`.

**Concrete work and evidence:**

1. Build requirements-to-evidence matrix for every contract, risk resolution, graph/relation class and client family; retain explicit unverified rows.
2. Run focused shared suites plus whole-engine traces and the twelve task cases; include schedule/template/full-access/restart failures and PL01–PL16 lifecycle/reconciliation/convergence cases.
3. Ordinary CI has zero paid calls; publish fixture hashes and exact results, with no aggregate percentage substituting for failed mandatory cases.
4. Add all GE01–GE16 closed-loop cases and matched graph/source task comparisons to the conformance gate; require actual source-to-graph-to-next-agent traces, concurrency/queue/budget failures and adapter-native paths.
5. Gate Ashoka on UX01–UX12 actual browser interaction evidence plus daemon command/race tests; static HTML strings and a stubbed scrollIntoView call do not prove menu, chevron or selected-plan navigation behavior.
6. Gate Computer Use on CU01–CU24 with deterministic fake providers, real portable-browser tests, named OS-worker qualification and explicit native-CLI route evidence. Keep platform/paid-canary gaps separate from passed tests.
7. Apply the revision-7 execution handoff: All mandatory feature/system obligations have actual accepted evidence; explicit supported-platform disposition is published. Ordinary CI spends zero; unrun required comparisons remain open. Required compound evidence: XS01, XS02, XS03, XS04, XS05, XS06, XS07, XS08, XS09, XS10, XS11, XS12, XS13, XS14, XS15, XS16, XS17, XS18, XS19, XS20, XS21.

**Execution handoff (revision 7):** All dependency slices, including ordinary integration, migration, schedules, CLI controls and CU, carry reviewed evidence hashes. Gate composed feature and migration behavior before packaging; Slice 28 then validates the exact versioned release/install assets and reopens affected evidence if packaging changes behavior. See [Slice 27 simulation](../docs/audits/2026-09-30-coverage/execution-simulation.md#s27) for affected records, consumers and compound evidence.

**Evidence packet:** Link the changed contract/schema, fixture or failure trace, command and actual result, relevant graph/config revision, limitations and reviewer decision in the implementation log. These checks are requirements, not completed test claims.


### Slice 28 — Publish verified contracts and synchronized release

- status: in_progress
- Priority: P1
- Depends on: Slice 27
- Findings: F18, F19, F21, F22
- Owner: Release/install owner
- Contract and policy trace: C02,C07,C11,C12,C14,C15,C16,C17; NP04,NP08,NP13; release acceptance; NP14

Update vision/guide/API/config/model/strategy docs with verified behavior and limitations. Release this overhaul as v14.0.0 - Ashoka, synchronizing CLI, engine, daemon/MCP authority, Architect, VS Code, Explorer, dashboard, analytics, SDK/host/token-economy packages and installers. Persisted/API schema majors remain independently versioned under C02. The source/package version bump occurs during implementation and release preparation, not this planning revision.

**Acceptance and verification:** All shipped product/package/runtime/installer surfaces report v14.0.0 consistently, while independent contract schemas advertise their actual supported majors. Version and contract manifests agree; the 13.4.0-to-14.0.0 upgrade/restart of existing sessions passes a disposable install test; documentation examples execute; all release claims link to real evidence; user-facing migration/rollback notes and schema sunsets are complete, including C14 lifecycle vocabulary, legacy reconciliation and supported client status mappings. No release claim that all agents use the graph, or that graph-assisted work is better, exceeds measured adapter coverage and paired task evidence. Release guidance reflects supported real commands and tested selection behavior, not proposed menus or unavailable actions. No blanket computer-control claim; default-disabled upgrades and runtime requirements are explicit, including portable-browser support and qualified native backends.

**Review gate:** Reviewer checks the acceptance evidence and cross-subsystem contract impact before this slice is marked verified.

**Rollback / recovery:** Package previous release and configuration/graph backups; document the tested downgrade limits.

**Implementation anchors:** `package.json`, `src/config/config.ts`, `scripts/install.ps1`, `README.md`, `guide`, `scripts/install.sh`.

**Concrete work and evidence:**

1. Publish compatibility matrices, migration/sunset and downgrade limits; derive product versions consistently without confusing them with schema majors.
2. Synchronize product/package/runtime/installer versions to v14.0.0, and update model/API/CLI distinctions, configuration/template/schedule instructions and evidence-linked claims across shipped surfaces. Verify the 13.4.0-to-14.0.0 upgrade separately from each schema migration.
3. Run disposable install/restart/restore tests and release only after Slice 27; no implementation release or version bump is made by this planning revision.
4. Publish C15 execution/receipt/dirty-state contracts, controls, source-verification policy, adapter limits, ADR amendments and honest paired benchmark results alongside synchronized v14 release and upgrade notes.
5. Document C16 context actions, keyboard/touch access, proposal-versus-commit behavior, Nervous Points disclosure and Reveal selected plan, with verified limits and consistent Ashoka naming.
6. Publish C17 native-CLI versus DreamGraph-harness routing, platform/remedy matrix, model/tool/worker versions, grants/privacy/budgets, recovery and supported install/upgrade/uninstall behavior. Include optional worker assets in synchronized v14.0.0 release metadata.
7. Apply the revision-7 execution handoff: Test exact packaged 13.4-to-14 install/restart/restore on disposable data after 27; artifact failure reopens 28, or the affected feature slice if behavior differs. No 27-to-28 acceptance cycle. Required compound evidence: XS18, XS19.

**Execution handoff (revision 7):** Slice 27 feature/system evidence is accepted; reviewed product/schema compatibility and install migration boundaries are fixed. Package and test after Slice 27. Keep version-pinned assets for running instances; installation and schema activation are distinct, and -Force cannot authorize destructive data conversion. See [Slice 28 simulation](../docs/audits/2026-09-30-coverage/execution-simulation.md#s28) for affected records, consumers and compound evidence.

**Evidence packet:** Link the changed contract/schema, fixture or failure trace, command and actual result, relevant graph/config revision, limitations and reviewer decision in the implementation log. These checks are requirements, not completed test claims.


### Slice 29 — Rebuild dashboard schedule management

- status: verified
- Priority: P1
- Depends on: Slice 10, Slice 11, Slice 17, Slice 21, Slice 22
- Findings: F24, F07, F12, F13, F21, F23
- Owner: Dashboard schedule surface owner; core scheduler remains authoritative
- Contract and policy trace: C04,C05,C07,C09,C11,C12,C15,C16; NP03,NP04,NP06,NP09,NP12

Rebuild schedule management as a complete compact workspace on the existing scheduler authority. Provide Schedules/Upcoming/Runs tabs, a searchable/filterable list and contextual definition/policy/history inspector. Support create, edit, duplicate, pause/resume, governed run now, active-run cancellation and archive with retained history. Use human units, explicit timezone, read-only next-occurrence preview, per-action validation, effective model/scope/budget and clear block/recovery reasons. Historical runs retain their actual configuration snapshots. Read [C11](../docs/audits/2026-09-30-coverage/plan-refinement.md#c11--rebuild-schedule-management-around-the-existing-scheduler) for precise trigger, missed/overlap, restart and interaction semantics.

**Acceptance and verification:** All C11 schedule cases pass through core and dashboard, with matching CLI/MCP state. Two clients cannot overwrite one another silently; previews make no paid requests; run-now cannot bypass guards; timezone/DST forecasts match actual due evaluation; edited/deleted definitions cannot rewrite past run provenance. Keyboard, dense/narrow layout and reconnect checks use realistic populated schedules. Pause versus cancel, edit/duplicate, restart and template operations retain dirty work and never turn a targeted run into whole-graph or unexpectedly paid cognition. The schedule menu acts on the captured schedule even after selection changes, preserves run history and pending digestion, and distinguishes pausing future dispatch from cancelling a running job.

**Review gate:** Review core schedule semantics and migrated legacy behavior first; verify the integrated workspace before Slice 27. No new scheduler authority is created.

**Rollback / recovery:** Version schedule definitions and snapshots, preserve old definitions/history and map existing UTC intent explicitly. Pause/fence dispatch during incompatible migration. Restore definitions only with a policy for newer runs/edits; never discard historical receipts.

**Implementation anchors:** `src/server/dashboard.ts`, `src/cognitive/scheduler.ts`, `src/cognitive/register.ts`, `src/cli/commands/schedule.ts`.

**Concrete work and evidence:**

1. Replace the append-only table/form flow with a compact schedules list plus inspector/editor and upcoming/runs tabs; support edit, duplicate, pause/resume and archive with retained history.
2. Use daemon validation and occurrence preview; support human units, explicit timezone, missed/overlap policy, scope/strategy/model/budget and full parameter diffs.
3. Make run-now enqueue a governed job, show queue/block/cancel/partial/recovery state, and snapshot the actual strategy/profile/revision into every run.
4. Test two-client edit conflicts, double click/lost reply, restart/missed run, DST, exhausted budgets, invalid configuration, keyboard/narrow layout and retained history after edit/archive.
5. Integrate C15 targeted digestion into Schedules/Upcoming/Runs with affected scope/generation, coalesced changes, pending stages, budget/blocked reasons and snapshot-based history; reuse core Slice 17 admission.
6. Expose C16 schedule menus through existing C11 edit/preview/run/pause/history workflows; retain one Pause/Resume row, revision-bound targets and normal budget admission. Keep cancellation, duplicate and archive in the relevant detail workflow.
7. Apply the revision-7 execution handoff: SC01–13 actual browser plus core integration shows edit/preview/run/pause/cancel distinctions and retained history. Shared menu rendering lands in 25 without making 29 depend on it. Required compound evidence: XS04, XS07, XS12.

**Execution handoff (revision 7):** Slices 10/11/17/21/22 provide validated settings, authority, scheduler truth, plan targets and historical metrics. Follow the durable entry/exit, recovery and coexistence boundaries in the slice record. See [Slice 29 simulation](../docs/audits/2026-09-30-coverage/execution-simulation.md#s29) for affected records, consumers and compound evidence.

**Evidence packet:** Persist schedule/config/graph revisions, occurrence preview, actual job/commit trace, budget reservations, browser evidence and failure/restart results; retain explicit limits.

### Slice 30 — Make CLI Autonomy and Verbosity effective

- status: verified
- Priority: P1
- Depends on: Slice 8, Slice 11, Slice 12, Slice 21
- Findings: F25, F14, F16, F22
- Owner: Architect orchestration and CLI bridge owner; daemon authority enforces allowed actions
- Contract and policy trace: C06,C09,C12,C13,C15,C17; NP04,NP06,NP09,NP12,NP13; NP14; AT01,AT02,AT05

Investigate and repair the reported weak effect of browser Architect Autonomy/Verbosity on CLI adapters. Preserve existing positive wiring, determine which settings are prompt guidance versus enforceable policy, and implement C13 through the current daemon/bridge/adapter mechanisms. Keep native CLI execution distinct from API-native continuation. Expose requested/effective mode, support level and actionable unsupported-setting feedback.

**Implementation anchors:** `src/architect/routes.ts`, `src/architect/cli-bridge.ts`, `src/architect/verbosity.ts`, `tests/architect-cli-bridge.test.ts`, `tests/architect-continuation.test.ts`, `tests/standalone-architect-routes.test.ts`, `extensions/vscode/src/autonomy.ts`.

**Concrete work and evidence:**

1. Reproduce each mode on a fixed task for Codex and Copilot with an instrumented fake CLI; trace the full selection-to-execution path and document the failed links. Verify actual supported options by installed CLI version before mapping controls.
2. Add explicit effective control policy to the existing bridge contract and enforce daemon-owned action/continuation boundaries. Manual, supervised and autonomous differ as C13 specifies without broadening previously granted authority.
3. Implement supported CLI output controls, prompt guidance and UI density as separate layers. Preserve required evidence and failure/staleness messages in concise mode; expose unsupported or prompt-only behavior honestly.
4. Test input transmission and actual tool/stop/continuation behavior, two-session isolation, request/persisted precedence, mid-job changes, restart, cancellation and fallback. Compare bounded real outputs only through an explicitly opted-in canary.
5. Verify C13 autonomy/verbosity under C15: all modes preserve mandatory graph anchors and change recording, concise output does not suppress uncertainty, and autonomous continuation stays within approved reconciliation/digestion scope.
6. Verify C13 controls on C17 native CLI interaction: autonomy stays within native grants, verbosity preserves mandatory evidence and stop reaches the real interaction runtime. Shell sandbox or MCP policy alone cannot be claimed to govern native Computer Use.
7. Apply the revision-7 execution handoff: Instrumented Codex/Copilot fixtures prove behavior, not just launch strings. Actual native-CU stop/grants tests close in 31, avoiding a circular dependency. Required compound evidence: XS01, XS04, XS07, XS10, XS17.

**Execution handoff (revision 7):** Slices 8/11/12/21 provide native adapter capabilities, scoped execution, effect commands and C14 continuation target. Close general CLI controls now. The C17 native interaction assertions in step 6 are mandatory integration obligations implemented/qualified in 31, not a circular entry gate here. See [Slice 30 simulation](../docs/audits/2026-09-30-coverage/execution-simulation.md#s30) for affected records, consumers and compound evidence.

**Evidence packet:** Redacted launch/config/prompt capture, adapter version, requested/effective support matrix, controlled tool actions and stop trace, browser result and any real-canary allocation/outcome. No paid test or implementation is claimed by this plan.

### Slice 31 — Deliver governed cross-platform Computer Use

- status: verified
- Priority: P1
- Depends on: Slice 3, Slice 5, Slice 6, Slice 8, Slice 10, Slice 11, Slice 12, Slice 17, Slice 21, Slice 25, Slice 30
- Findings: F26, F14, F15, F16, F21, F22
- Owner: Architect execution integration owner; platform backend maintainers, authority/privacy reviewer and conformance owner
- Contract and policy trace: C01,C02,C03,C04,C05,C06,C07,C09,C12,C13,C14,C15,C16,C17; NP03,NP04,NP06,NP09,NP11,NP12,NP13,NP14; AT01,AT02,AT05,AT06; CU01–CU24

Implement [C17](../docs/audits/2026-09-30-coverage/computer-use.md) using its capability/platform audit and eight-package execution packet. Codex CLI uses Codex-native Computer Use; native API adapters use the DreamGraph harness. Other CLI adapters negotiate their native mechanisms. Shared authority, evidence, graph and lifecycle semantics do not force shared transport or a Windows-defined architecture. A missing capability stays explicit; no silent model, route or host replacement.

**Accepted v14 scope (2026-10-03):** The maintainer fixed qualification at practical Windows plus the completed WSL2 Ubuntu24.04/Node20 installer and isolated browser results, and directed closure before26/27 and28. The [scope packet](../docs/ashoka/slice-31-release-scope-conformance.json) maps CU01–CU24 and XS17/20 to exact existing passing source-bound cases. CU16/17/18 native desktop backends are explicitly deferred and not advertised; unavailable native CLI/provider built-in routes remain refused without substitution. The unchanged C17 musts apply to the shipped browser/API/SDK/compiled companion implementation. The [closure review](../docs/ashoka/slice-31-native-review-closure.json), session039c09d0-5900-416b-9259-ca2a804fd974, accepts six source/contract matches, zero gaps/regressions. Practical physical Windows UI/VSCode qualification belongs to the maintainer; no fixture is represented as that result. This disposition supersedes the broader historical environment work below and permits Slice31 closure within the explicit release scope.

**Implementation anchors:** `src/architect/routes.ts`, `src/architect/native-tool-loop.ts`, `src/architect/cli-bridge.ts`, `src/architect/cli-mcp-bridge.ts`, `src/cognitive/llm.ts`, `src/tools/reconciliation-transaction.ts`, `packages/host`, `packages/sdk`, `extensions/vscode/src/architect-core`, `tests`.

**Concrete work and evidence:**

1. 31A: Freeze C17 platform-neutral schemas, native-CLI versus DreamGraph-harness routes, ADR amendments and fake worker/provider/CLI fixtures; prove requested/supported/permitted/effective capability negotiation.
2. 31B: Implement authenticated execution binding, scoped grants, cross-instance physical-seat leases, durable intent/outcome receipts, finite admission, local revocation and unknown-result recovery before enabling real input.
3. 31C: Deliver the isolated portable browser worker using a pinned supported runtime/browser, structured operations and scoped visual evidence; run the same disposable fixture on Windows, macOS and Linux.
4. 31D: Implement peer native-worker backends for Windows, macOS and Linux portal/accessibility with scoped X11 fallback; qualify permissions, scale/topology, human control, packaging and unsupported operations per environment.
   Owner disposition 2026-10-03: native desktop and additional environment qualification are deferred beyond v14.0.0. Preserve the shared contract and unavailable/default-disabled routes. The existing Windows and accepted WSL installer/browser evidence establish this release's environment scope; no new Linux/macOS/Docker qualification branch is required.
5. 31E: Connect native APIs to the DreamGraph harness and Codex CLI to its own native Computer Use facilities through supported capability/permission/event/stop seams. Preserve native CLI continuation; a bridge is an explicitly selected alternative only.
6. 31F: Integrate typed observations, verified postconditions, durable material-change reconciliation and bounded digestion with C15 and C14; preserve uncertainty, partial effects and the correct unfinished work.
7. 31G: Add compact Architect/VS Code status, target/host/effective mode, pause/stop, approval and observation inspection plus schema-driven dashboard setup; selection never grants control.
8. 31H: Produce CU01–CU24 conformance and named platform/adapter qualification, optional capped provider canaries, privacy/usage evidence and install/upgrade/recovery documentation for Slices 27/28.
9. Apply the revision-7 execution handoff: CU01–24 actual portable-browser and named platform/native-route evidence, plus XS17/20 recovery/graph-loop joins, unblock 27. Common contract is never weakened to a backend minimum. Required compound evidence: XS01, XS09, XS17, XS20.

**Execution handoff (revision 7):** Slices 3/5/6/8/10/11/12/17/21/25/30 provide graph, effect, budget, authority and adapter integration foundations. Follow the durable entry/exit, recovery and coexistence boundaries in the slice record. See [Slice 31 simulation](../docs/audits/2026-09-30-coverage/execution-simulation.md#s31) for affected records, consumers and compound evidence.

**Evidence packet:** Schema/source/config hashes; exact adapter/model/tool/worker and OS/compositor versions; sanitized operation/observation/receipt traces; stop latency, scope/permission, cost, graph and lifecycle cases; known unsupported operations and reviewed support limits. GPT-6.1 Sol executes bounded packages under the actual Slice 31 ID; no extra plan slice IDs are introduced for packages 31A–31H.

## System acceptance scenarios

Revision 7 adds the [XS01–XS21 compound walkthroughs](../docs/audits/2026-09-30-coverage/execution-simulation.md#compound-acceptance-walkthroughs), [SC01–SC13 schedule mappings](../docs/audits/2026-09-30-coverage/plan-refinement.md#schedule-evidence-ids-stable-refinement-mapping) and the [twelve-question closure report](../docs/audits/2026-09-30-coverage/execution-closure-report.md). These join existing scenarios, including one initial scan maintained through successful managed mutations, atomic graph activity timestamps and user-selected inclusive scans. They are future implementation evidence, not tests already passed.

C17 adds [CU01–CU24](../docs/audits/2026-09-30-coverage/computer-use.md#acceptance-matrix), including adapter-native routing and independent Windows/macOS/Linux qualification. All are specified, not executed by this planning update.

C16 adds [UX01–UX12](../docs/audits/2026-09-30-coverage/architect-context-actions.md#delivery-and-acceptance) for useful target-specific menus, captured-target authority, accessible disclosure and reliable selected-plan navigation among hundreds of plans. These are implementation requirements, not completed browser test claims.

C15 adds the sixteen [GE01–GE16 closed-loop scenarios](../docs/audits/2026-09-30-coverage/graph-centered-execution.md#acceptance-scenarios--required-not-yet-run), including paired graph-assisted/source-only evaluation on the frozen corpus. No benchmark superiority or runtime enforcement is claimed before that evidence exists.

The sixteen [C14 lifecycle scenarios](../docs/audits/2026-09-30-coverage/plan-lifecycle-status.md#acceptance-matrix--required-not-yet-run) additionally gate Slice 21 and final release: no phantom active slice, no implementation/verification conflation, accurate current/next after reopening, and shared status across clients. These are future test requirements.

1. New repository → full scan → partial provider failure → resume → agent retrieval: every eligible node has an honest semantic state; no uncommitted success, hidden spend or clipped JSON.
2. Established graph → source rename/delete → incremental reconcile → dream → normalization → human correction: facts remain traceable and current; rejected or removed knowledge does not silently return.
3. Two clients → two plans → overlapping jobs → cancel one → daemon restart: ownership, plan state, effective model policy and remaining work are consistent.
4. Scheduled cognition + targeted dream + duplicate runtime event + manual scan: one budget/concurrency policy governs all producers; failures leave a recoverable engine state.
5. External archetype + causal hypothesis + remediation proposal → review → action → verification: imported/speculative/advisory work never masquerades as a verified fact or resolved risk.
6. Same question in CLI, API, browser/VS Code Architect and Explorer: stable IDs, provenance, revision and required graph evidence agree despite different presentation and token budgets.
7. Initial-scan profile GPT-4.1 and mature-graph GPT-5.4 or newer user override: each role sends supported API parameters, preserves schema/evidence gates, reports usage and respects caps; no default upgrade occurs without user choice.

Use disposable graphs and provider fixtures first. Persist source revision, fixture hash, route/prompt/schema versions, commands, expected/actual outcomes and unresolved limits with each acceptance result. Statistical targets for relevance/latency/model quality must be agreed after the baseline corpus exists, not invented from this audit’s three timing samples.

## Resolved design decisions

The owner’s answers and attached 13-point proposal are incorporated in [revision-7 contracts and acceptance](../docs/audits/2026-09-30-coverage/plan-refinement.md). That specification is part of this plan and defines C01–C17, task cases AT01–AT06, schedule workflows, the [C14 plan lifecycle design](../docs/audits/2026-09-30-coverage/plan-lifecycle-status.md) with PL01–PL16, the [C15 execution-loop design](../docs/audits/2026-09-30-coverage/graph-centered-execution.md) with GE01–GE16, the [C16 contextual actions/navigation design](../docs/audits/2026-09-30-coverage/architect-context-actions.md) with UX01–UX12, and the [C17 Computer Use design](../docs/audits/2026-09-30-coverage/computer-use.md) with CU01–CU24, F26 and NP14, and the full resolution matrix. The original [proposal](../docs/audits/2026-09-30-coverage/owner-proposed-resolutions.txt) is preserved as evidence, not a claim of implemented guarantees.

| Decision | Resolution | Owning slices |
|---|---|---|
| System correctness and operating discipline | DreamGraph guarantees correct supported execution and honest recovery; user owns activity outside the contract and chooses inclusive scans for substantial out-of-band work | 0,2,5,11,22,25 |
| Graph currency | Reconciliation coverage plus canonical last_graph_mutation_at; independent full-scan/source-reconciliation markers; old scan does not equal stale graph | 2,3,5,16,17,22–26,27 |
| Shared graph meaning | Core/daemon owns canonical semantics and mutation authority; generated SDK/schema artifacts and adapters serve every consumer | 0,2,12,22,25 |
| Compatibility | Current + previous schema major, explicit forward migrations and sunset; product version remains separate; older/unknown stores have read-only diagnostics and controlled migration | 0,1,2,26,28 |
| Agent usefulness | Twelve baseline cases: six real task families separately for DreamGraph and web64-react, with reviewed provenance and failure criteria | 0,3,4,21,25,27 |
| Paid canaries and retention | No paid CI/default; finite run/day allocations reserve parallel calls/retries; retention and sent-data scope are independent | 6–10,17 |
| Full access | Two human confirmations of immutable scope/model/data/budget/retention/expiry terms; finite, revocable grant; no truth/commit/auth bypass | 10,11,23 |
| Remote access | Local-only by default; explicit authenticated remote mode with visible exposure and origin/session checks | 11,12,23 |
| CLI Autonomy / Verbosity | Diagnose actual control transmission and behavior, implement daemon/adapter enforcement and honest support levels, then verify observable differences | 30,25,27 |
| Graph-centered execution | Task-relevant graph context before/during work; durable reconciliation after material changes; bounded coalescing digestion and measured advantage over matched source-only baselines | 3,4,5,17,25,27 |
| Architect context actions and navigation | Compact target-specific menus over existing authority, visible nested disclosure arrows and reliable selected-plan reveal without filter loss or background scroll stealing | 12,21,25,29,27 |
| Computer Use | CLI-native capabilities for CLI adapters, DreamGraph harness for native APIs; one cross-platform authority/evidence/recovery contract with concrete platform remedies and eight-package delivery | 8,11,21,25,31,27,28 |
| Plan lifecycle and status | One daemon-owned revisioned projection; explicit transitions, current/running/next eligibility, verified completion and coherent compact sidebar styling under C14 | 21,25,27 |
| Schedule management | Dedicated Slice 29 rebuild on core scheduler APIs from Slice 17; editing, previews, truthful history, budgets and recovery are one workflow | 17,29,27 |

## Nervous Points

All 14 points have a policy disposition; the original thirteen plus NP14. Implementation risk is retained and tested; a resolved design question is not a resolved code defect.

| Point | Resolution contract | Primary slices |
|---|---|---|
| NP01 — Model profiles and enrichment completeness | C03,C05,C06 | 6,7,8,9 |
| NP02 — Strong models and useful speculation | C01,C08 | 9,14,15 |
| NP03 — Reads, commits and background work | C03,C04,C05,C15 | 1,3,5,6,17 |
| NP04 — Legacy clients and browser state | C02,C03,C09,C14,C15 | 1,11,12,21,25 |
| NP05 — Coverage versus demonstrated usefulness | C08,C15 | 0,4,22,27 |
| NP06 — API/CLI model and cost semantics | C06 | 7,8,25 |
| NP07 — Unknown legacy baselines | C02,C10 | 2,16,26 |
| NP08 — Shared identity and confidence meanings | C01,C02 | 0,2,12,22,25 |
| NP09 — Paid canaries and retention | C05,C06,C09 | 6,7,9,10,11 |
| NP10 — Controlled migration and cutover | C04,C10 | 5,16,26 |
| NP11 — Provenance, trust and shared ancestry | C01,C04,C15 | 2,15,16,18,19,20 |
| NP12 — Compact, understandable UI | C07,C11,C12,C14,C16 | 21,23,24,29 |
| NP13 — One living engine | C01,C15 | 0,13,17,18,19,20,25 |
| NP14 — Computer Use platform, authority and external-effect boundaries | C17,C09,C14,C15 | 8,11,21,25,31,27,28 |

## Bounded implementation inputs

Slice 0 inventories actual schema majors and assigns implementers/reviewers to the named owners; it also freezes reviewed task evidence for both projects. Paid budgets default to zero until numeric limits are chosen for a particular run/day; provider retention/capabilities are verified when configuring that profile. Release declares concrete schema identifiers and sunset according to C02. These inputs no longer reopen the ownership, compatibility, local-access or spending policy decisions.

## Risks

- Many independently implemented projections may depend on legacy IDs and confidence meanings. Add adapters and compare outputs before removing old behavior.
- A more capable dreamer can grow poor evidence faster; model upgrades must be evaluated against source-grounded truth criteria and cost.
- Legacy graphs may lack scan/checkpoint baselines. Dry-run repair and rollback are mandatory before data migration.
- Global percentage targets can encourage shallow tests. Require meaningful state/contract/failure coverage and publish exclusions.
- Existing clients may assume unbounded JSON or shared browser state. Version changes and test migration explicitly.

## Plan Asks

- Record the resolved policy direction and the slice’s concrete implementation scope/evidence before changing runtime behavior; do not re-ask the five answered design questions.
- Implementation authorization may cover a bounded slice, wave or multi-slice task. Honor its scope and explicit review gates without repeatedly asking about routine already-authorized work; this planning request itself does not authorize runtime implementation or production mutations.
- Preserve documentation and synchronized versions across every shipped surface at release; no version bump is required for these audit-only files.

## Completion criteria

All 32 slices have verified evidence; any reviewed deferral applies only to explicitly optional scope with impact/owner, never mandatory truth/authority/C15/C17 guarantees for an advertised route; C01–C17 and NP01–NP14 have requirement-to-evidence coverage; the twelve AT01–AT06 project cases, thirteen C11 schedule cases, twenty-one XS compound cases, sixteen C14 lifecycle cases and sixteen C15 execution-loop cases and twelve C16 interaction/navigation cases and twenty-four C17 Computer Use cases meet their mandatory criteria, with native platform support claims backed by actual qualification; paired evidence demonstrates material initial-understanding gains on established-instance architecture/history tasks in both projects; the system scenarios pass; no P1 integrity/trust/budget/authority regression remains hidden; the report’s gaps have closed or are documented accurately. Maintainer review, release/install smoke and rollback evidence are recorded. A merely green unit suite is insufficient.
