# Ashoka pre-implementation execution simulation — revision 7

Date: 2026-09-30. Status: planning closure, **not implemented or runtime-qualified**. This appendix refines the [unified plan](../../../plans/graph-trust-and-agent-effectiveness.md), C01–C17 and their existing owners; it creates no competing authority or new slice. The [compact closure report](execution-closure-report.md), [owner request](owner-execution-simulation-request.txt), [ADR evidence](execution-adr-evidence.json), [machine simulation](execution-simulation.json) and [verification record](execution-simulation-verification.json) provide the trace. GPT-6.1 Sol remains the intended implementation executor.

The simulation is a reasoned execution walk with repository evidence, not an execution of the future acceptance suite. Runtime tests, platform qualification and paired model evaluations remain pending. Current source hashes and the baseline plan/appendix hashes are in the machine record. No production data, ADR status, runtime source, installed version, provider setting or running job was changed by this pass. Native governance revision 6 remains historical; revision 7 is a file-backed draft under this request's read-only daemon restriction.

## System correctness and operating discipline

**DreamGraph guarantees system correctness under valid use. The user owns operating discipline outside that contract.** Valid use means a documented supported route/version, declared instance/project/scope and satisfied authority/configuration prerequisites. DreamGraph must enforce those prerequisites and correctly preserve identities, committed state, reconciliation, concurrency, budgets, lifecycle, evidence and truthful results; a bug cannot be dismissed as operator discipline. A failed worker, interrupted write, stale UI or invalid request must produce the specified recoverable/error state. The user chooses when to work outside DreamGraph, when substantial out-of-band changes warrant an inclusive scan, and which optional paid/cognitive workflows to run. Do not impose recurring scans, suspicion-driven warnings or extra approvals for work already authorized within that contract. Unsupported/out-of-scope activity has an explicit boundary; the product does not claim to have observed it.

## What the walk found and closed

Each correction below is incorporated into its owning contract and slices, not merely retained as an issue list. EC identifiers are planning/evidence mappings, not additional slices.

| ID | Loose end and repository evidence | Correction, owner and required evidence |
|---|---|---|
| EC01 | Acyclic declared dependencies concealed acceptance cycles: early model/session/CLI slices demanded Computer Use evidence from 31, which depends on them; retrieval evaluations demanded later lifecycle/adapter behavior. | Distinguish foundation exits from composed integration gates. Preserve mandatory final evidence in 25/27/31/28 and bind it to provider-slice evidence hashes. Correct the DAG and per-slice handoffs below. C01/C08/C14; Slice 0 and each named owner; XS01. |
| EC02 | `scan-state.ts` hashes source scan material; ordinary curation/dream/config writes do not thereby become a coherent graph commit revision. `reconciliation-transaction.ts` publishes scan state last and removes its journal; that is not a retained operation receipt. | Separate source baseline, graph/domain revision, publication sequence and process epoch. Extend the existing transaction/barrier with durable commit/receipt publication, without a wholesale database rewrite. C01–C04; 2 then 5; XS02/03. |
| EC03 | `mutex.ts` and the reconciliation barrier are process-local; read-to-write upgrades can wait on their own read, and barrier keys lowercase paths on all platforms. | One process owns an instance data directory; legacy processes must be quiescent before incompatible cutover. Fixed lock order, no lock across provider work, no read upgrade, platform-correct path identity. C04/C09; 2/5/11; XS02/04. |
| EC04 | `graph/store.ts::safe`, maintenance and scheduler loaders can collapse load failures to empty state. ADR-095 only justifies known optional bootstrap absence. | Registered optional absence is explicit empty-at-bootstrap; corrupt, inaccessible, required missing or newer data is unavailable/recovery-required. No empty-store writeback. C02/C03/C10; 1/2/17/26; XS03/13. |
| EC05 | A `Promise.race` timeout in scheduler leaves the action running; clearing an in-memory in-flight set can admit overlapping work. | Durable attempts, fencing and one terminal deadline owner; retain late-charge/effect accounting. Do not release conflict capacity until stopped or effects are fenced. C04/C05/C11, ADR-239; 5/6/11/17; XS04/05. |
| EC06 | `llm-readiness.ts` makes real completion calls; bootstrap reacts to readiness/fingerprint changes. Provider checks can bypass the presumed scan/dream budget boundary. | All provider dispatch, including readiness/bootstrap/narration/evaluation/plugin calls, passes the same admission seam. Unfunded probing is unknown/budget-blocked, not proof of readiness. C05/C06; 6/8/17; XS05/14. |
| EC07 | `engine.env`, startup `process.env`, mutable scheduler/event config and session settings have different persistence and precedence. | Define source precedence, revision-aware apply, pinned run policy and immediate restrictive revocation. Shared secrets are references, never copied into run snapshots. C07/C09; 7/10/11/23; XS06. |
| EC08 | Discipline has a process-wide `activeSession`; Architect also has global active execution state. Selected-plan settings can leak between clients. | Session-scoped command context, independently durable execution/attempt identity and plan grants; sessionless protected mutations fail. Project scope has no invented plan. C09/C14; 11/12/21; XS07/08. |
| EC09 | C14 requires C15 receipts while exporting a lifecycle change can itself trigger reconciliation; unbounded self-dependency would prevent verification. | Verification checks its declared material effects. Its own typed event and export obligation commit together; derived status export cannot require itself to be verified again. C04/C14/C15; 5/21; XS08/09. |
| EC10 | Managed shell/native editor/plugin effects are not fully described by prompts or a pre-write tool-name classifier; a filesystem change can precede graph recording. | Persist effect intent before controlled writes, observe after-state independently, use durable host outbox plus restart catch-up. Unobservable routes cannot claim managed C15 compliance. C15/C09; 5/12/25/30; XS09/10. |
| EC11 | Dirty work is described in the plan but maintenance state currently holds timestamps/heads; stage completion and generation advancement lacked an exact join rule. | Separate invalidation, reconciliation and optional cognition debt; stage receipts clear only covered generation/input fingerprints. Derived outputs carry root cause and cannot create infinite admission. C04/C05/C15; 5/13–20/17; XS09/11. |
| EC12 | Schedule runtime uses current mutable definitions, process-local claims and approximate due information. Trigger identity across DST/restart/edit was underspecified. | Immutable occurrence/run keys, one evaluator, snapshotted policy, explicit missed/overlap disposition and plugin-action version binding. C11; 17/29; XS05/11/12. |
| EC13 | Accepted ADR-096 relaxes cold-start evidence; ADR-098 auto-probes; ADR-203 prioritizes connected models; several older v2 ADRs conflict with current or proposed semantics. | Explicit applicability/amendment register below. Preserve the reviewed Ashoka direction; do not silently change accepted ADR status or import unrelated accepted records as project law. C01/C06/C08; 0/7/8/15/25; XS14/15. |
| EC14 | Python analytics directly unions JSON files; runtime metrics, graph coverage and lifecycle counts have different scopes/time bases. | Revisioned snapshot/export manifests and versioned denominators, never a mutable-directory read masquerading as a coherent snapshot. C01/C03/C08; 2/22/24/25; XS13/16. |
| EC15 | The host's in-process watchdog explicitly cannot interrupt synchronous plugin code. A trust gate is not effect confinement. | Qualify managed handlers through mediated effects and bounded execution; opaque legacy trusted handlers are visibly unattested and cannot satisfy managed execution gates. Hard-cancellable work uses an isolated worker boundary. C09/C15/C17; 11/12/25/31; XS10/17. |
| EC16 | Migration text concentrated on graph IDs; config, schedules, plans, plugin state, receipts and analytics history need a common cutover inventory. Installer currently replaces shared `dist` and reminds users to restart. | Full family migration matrix, writer fence, marker-based recovery and version-pinned executable assets. Installation and per-instance data activation are separate. C02/C10; 26/28; XS18/19. |
| EC17 | CLI Computer Use may expose aggregate native events rather than every API call/screenshot. A worker watchdog does not control an unqualified native CLI runtime. | Capability-specific conformance with explicit evidence granularity, enforceable native grants, exclusive input seat and native stop. Missing mandatory controls block that route; no silent backend change. C17; 31; XS17/20. |
| EC18 | UI summary/detail, SSE, cached prompts and old clients can answer from different revisions; one transport's success can hide incomplete delivery. | Common revision vector, epoch/gap reset, permission-bound cursors and atomic surface adoption. Distinguish display cache from authority. C02/C03/C12/C14/C16; 1/12/21–25/29; XS07/13/16. |
| EC19 | Source-only comparisons and full-client task runs could be declared complete at the early retrieval slice; paid/hardware qualification cannot be inferred from mocks. | Freeze rubric and fixtures early; run composed task and model evidence at final gates. Unknown pricing, absent hardware or withheld canary allocation remains a visible activation/release limit. C08; 0/4/9/25/27/31; XS01/14. |
| EC20 | Living cognition, external data/UI evidence, delivery/webhooks and historical plan artifacts can be flattened into a static index or recursively re-ingested as new evidence. | Preserve each cognitive owner and ancestry; scope external observations and generated exports; include delivery/replay and all 29 subsystem families in compound traces. C01/C15; 13–22/25; XS11/15/16. |
| EC21 | `graph-health.ts` treats old scan/enrichment timestamps and raw commits/working-tree changes since the scan as drift, even when managed mutations have reconciled them. | Freshness is evidence- and reconciliation-relative. Old scan does not equal stale graph; inclusive rescan after substantial out-of-band work is a user choice. Canonical last_graph_mutation_at is independent of last_full_scan_at and source-reconciliation coverage. C01/C03/C15/C12; 2/3/5/16/17/22–25/26; XS21. |

## Executable ordering and handoffs

The exact dependencies and deterministic topological order are in [execution-simulation.json](execution-simulation.json), generated from the revised Markdown/manifest. Numeric slice order remains identity, not dispatch order. All 32 existing IDs are retained.

**Foundation exit** means that slice's implemented contract passes its own real persistence/adapter checks against already available dependencies and defined test doubles for future consumers. It cannot claim that an unbuilt consumer passed. Each future consumer has an explicit integration obligation in the machine record and its owning slice. A foundation can be verified without a circular wait; release cannot pass with those obligations outstanding. Reopening a provider contract invalidates affected integration evidence by hash.

There are three major cut lines: 2/5 establish consistent publication and durable effects; 6/10/11/12 establish bounded admission and authority; 17/21 establish scheduling and plan execution over those primitives. Cognitive, user-surface and adapter consumers then join the same contracts. Slice 25 closes connected agent routes; 31 adds Computer Use on qualified adapter seams; 26 validates legacy conversion across the composed system; 27 closes system evidence; 28 packages and verifies the exact release artifacts.

Slice 0 is a schema/ownership/fixture baseline, not a live data migration. Before C14 exists, implementation uses the existing discipline workflow plus explicit stable slice IDs, dependency/evidence records and reviewed checkpoints in the paired log. Do not trust the old phantom-active projection. Slice 21 imports those records with their evidence; it does not require its own new lifecycle system to have existed before earlier slices could begin.

The per-slice records below inherit the common publication, failure, migration and authority rules in this appendix. Each additionally states its authoritative entry state, consumed contracts, stores, events, consumers, partial-success disposition, restart/concurrency handling, exit evidence and rollback boundary. This is a handoff specification, not function-level implementation pseudocode.

### Topological delivery levels

[0] → [2] → [1, 5, 7] → [3, 8, 10] → [4, 6] → [9, 11] → [12] → [13, 21] → [15, 30] → [14, 16] → [17] → [18] → [19] → [20, 22] → [24, 29] → [25] → [23, 26, 31] → [27] → [28]

Only siblings with independent affected resources may execute concurrently; each still requires its own accepted dependencies. All foundation/integration obligations remain mandatory in the release evidence ledger.

<a id="s0"></a>

### Execution record 0 — Establish the engine alignment contract

**Owner:** Core/daemon contract owner. **Verified predecessors:** none. **Contracts:** C01, C02, C08, C14, C15, C16, C17.

| Boundary | Required state and outcome |
|---|---|
| Authoritative entry | Reviewed r6 definition, current source/accepted-ADR evidence and twelve task-case specifications; existing discipline only. |
| Persisted boundary | Versioned schema inventory, owner/applicability register, fixture hashes and proposed ADR amendments in planning artifacts; no live conversion. |
| Events and dependent consumers | Generated contract fixtures go to every later slice; register producer/consumer and foundation/integration obligations before tuning. |
| Restart, concurrency and partial work | Concurrent definition edits require a new reviewed hash; missing labels remain unverified, never guessed. A restart reloads the baseline artifacts. |
| Durable exit | Reviewed C01–C17 types, ADR applicability/amendment disposition, corpus labels and bounded measurement tolerances unblock 2; no claim of all-surface conformance. |
| Rollback | Revert only the proposed baseline artifacts; accepted ADRs and operational data remain untouched. |

**Evidence:** XS01, XS14, XS15. Verify baseline schemas, applicability and fixtures only; C14 does not have to exist to govern these first slices. Use existing discipline and explicit reviewed IDs until Slice 21 imports the records.

<a id="s1"></a>

### Execution record 1 — Make graph responses structured and pageable

**Owner:** Core graph query/resource owner. **Verified predecessors:** 0, 2. **Contracts:** C02, C03.

| Boundary | Required state and outcome |
|---|---|
| Authoritative entry | Slice 2 typed snapshots/publication and Slice 0 family/version inventory exist. |
| Persisted boundary | URI/version adapter metadata and bounded snapshot/cursor state; read paths never initialize damaged graph stores. |
| Events and dependent consumers | Generated envelopes feed CLI/API/MCP, retrieval and old-client adapters; invalidation expires or refreshes snapshot handles. |
| Restart, concurrency and partial work | Concurrent writes preserve a pinned page union; permission change invalidates cursor. Restart may expire cursors explicitly; corrupt store is unavailable, optional bootstrap absence is identified. |
| Durable exit | All baseline resource families produce whole typed records, explicit empty/partial/unknown/errors and duplicate-free same-revision paging; 3/12 consume this contract. |
| Rollback | Retain a version-negotiated presentation adapter; never reintroduce clipped JSON or silently join new pages to an old snapshot. |

**Evidence:** XS03, XS13, XS16. Actual dependencies and this slice pass locally; subsequent consumers verify their own composed behavior and Slice 27 retains final mandatory gates.

<a id="s2"></a>

### Execution record 2 — Unify graph identity and read snapshots

**Owner:** Core graph/persistence owner. **Verified predecessors:** 0. **Contracts:** C01, C02, C03, C15.

| Boundary | Required state and outcome |
|---|---|
| Authoritative entry | Slice 0 freezes identity, revision, ownership and physical-store compatibility decisions. |
| Persisted boundary | Extend existing JSON journal/barrier with publication metadata, immutable snapshot view and typed-ID maps. Distinguish scan/source hashes from graph/domain revision and epoch. Define canonical last_graph_mutation_at with graph revision/operation identity, separate full-scan and source-reconciliation coverage markers, null legacy values and revision-based ordering. |
| Events and dependent consumers | Read-model ports serve every family, indexes and source/evidence dependencies; mutation owners adopt one publication primitive before business receipts in 5. |
| Restart, concurrency and partial work | Exclusive data-directory owner, sorted lock order, no read upgrade or provider wait; before-marker rollback, after-marker recovery. Concurrent curation/dream writes cannot reuse a scan hash as their commit identity. |
| Durable exit | Fault-tested primitive plus same-revision golden projections; old scan with reconciled changes remains current. Unblocks 1/5/7 and supplies validators, not live migration. |
| Rollback | Compare through adapters on disposable stores. Before cutover keep original bytes/maps; after new writes use forward recovery, never discard them with a stale backup. |

**Evidence:** XS02, XS03, XS13, XS21. Actual dependencies and this slice pass locally; subsequent consumers verify their own composed behavior and Slice 27 retains final mandatory gates.

<a id="s3"></a>

### Execution record 3 — Provide complete bounded agent retrieval

**Owner:** Core retrieval owner. **Verified predecessors:** 1, 2. **Contracts:** C03, C08, C15, C17.

| Boundary | Required state and outcome |
|---|---|
| Authoritative entry | Slices 1/2 bounded snapshots and frozen task/plan/CU context fixtures; later lifecycle/CU producers are represented by contract doubles. |
| Persisted boundary | Derived retrieval indexes and bounded context receipts reference canonical evidence, scope and revisions; no new truth store. |
| Events and dependent consumers | Task/role packs and omission/refresh metadata feed adapters and cognition; future C14 and C17 production bindings are closed in 25/31. |
| Restart, concurrency and partial work | Concurrent evidence change invalidates affected anchors; mandatory anchors that cannot fit produce insufficiency. Partial context never implies complete coverage; source-only fallback is scoped. |
| Durable exit | Real retrieval budgets/families pass using frozen inputs; GE01–04 retrieval portions pass now. Later client effects and native GUI freshness are mandatory integration evidence, not claimed here. |
| Rollback | Switch query projection via negotiated flag; preserve source evidence and receipt links; rebuild derived indexes without altering truth. |

**Evidence:** XS01, XS07, XS13, XS21. GE01–GE04 and GUI-context assertions here cover the retrieval contract against frozen fixtures. Actual lifecycle/adapter execution and live GUI observation invalidation are mandatory in Slices 25/31/27.

<a id="s4"></a>

### Execution record 4 — Index retrieval and evaluate agent usefulness

**Owner:** Retrieval/evaluation owner. **Verified predecessors:** 3. **Contracts:** C08, C15.

| Boundary | Required state and outcome |
|---|---|
| Authoritative entry | Slice 3 retrieval semantics plus independently reviewed DreamGraph/Web64 labels and matched evaluation protocol. |
| Persisted boundary | Revision-keyed index/statistics, fixture manifests and reproducible benchmark artifacts; evaluation records distinguish deterministic/local/paid measurements. |
| Events and dependent consumers | Metrics feed 9/22/27; paired task harness accepts the eventual client/normalizer implementations without requiring them at this exit. |
| Restart, concurrency and partial work | Stale/corrupt index falls back to bounded correct reads; concurrent writes select another snapshot. Missing canary allocation cannot silently select a paid model. |
| Durable exit | Index correctness and offline retrieval oracle pass; freeze full GE16/AT matched procedure. Final composed usefulness gains remain required after 25 at 27. |
| Rollback | Discard/rebuild only derived index; preserve baselines, negative results and preregistered rubric. |

**Evidence:** XS01, XS14, XS16, XS21. Freeze and test the paired evaluation harness here; the release claim of improved agent understanding is made only from composed results after Slice 25 at Slice 27. Unfunded required model evaluation remains unverified.

<a id="s5"></a>

### Execution record 5 — Commit enrichment and checkpoints coherently

**Owner:** Core persistence/enrichment owner. **Verified predecessors:** 0, 2. **Contracts:** C04, C15, C17.

| Boundary | Required state and outcome |
|---|---|
| Authoritative entry | Slice 2 durable publication primitive and typed scope/revision ports are verified. |
| Persisted boundary | Operation receipts, source-effect intent/outbox, job/attempt skeleton, enrichment checkpoints and dirty admission share the existing commit boundary; source files remain a separate effect boundary. Publish graph-mutation time atomically with actual graph deltas; failed/no-op writes and replay cannot advance it, and source-reconciliation coverage advances only at its own successful boundary. |
| Events and dependent consumers | Committed receipts/outbox drive reconciliation, cancellation admission, plan verification and later scheduler consumers; source_applied differs from graph_committed. |
| Restart, concurrency and partial work | Crash before/after source effect or marker, lost reply, stale revision and conflicting curation recover by identity/fingerprint. Partial batches acknowledge only committed members; retired keys cannot re-execute. |
| Durable exit | Disk/reply/fence faults prove receipt recovery and retained obligations. Schemas permit later CU effects; actual GUI dispatch is deferred to 31. |
| Rollback | Cancel leaves committed members and unknown external effects visible; reverse a canonical delta only through a new authorized compensating commit. |

**Evidence:** XS02, XS03, XS04, XS08, XS09, XS10, XS21. C17 effect schemas are tested with disposable external-effect doubles here; actual GUI effect/recovery qualification belongs to Slice 31.

<a id="s6"></a>

### Execution record 6 — Bound scan and enrichment cost and recovery

**Owner:** Enrichment/job admission owner. **Verified predecessors:** 5, 7, 8. **Contracts:** C05, C06, C15, C17.

| Boundary | Required state and outcome |
|---|---|
| Authoritative entry | Slices 5/7/8 provide durable job records, effective role policy and normalized call/usage capabilities. |
| Persisted boundary | Durable reservations, observed usage, call attempts, effective config fingerprints and bounded checkpoints under C04/C05. |
| Events and dependent consumers | One admission seam covers scan/enrichment and every provider helper, including readiness; scheduler and CU later reuse this same accounting. |
| Restart, concurrency and partial work | Parallel callers reserve before dispatch; exhausted budget preserves facts/partial enrichment. Late responses settle usage without cancelled mutation; midnight retains admission-day reservation; unknown price blocks. |
| Durable exit | Offline high-degree, parallel, cancel, retry and restart cases prove finite limits and resumability. CU model/image/action accounting is a fixture contract until 31. |
| Rollback | Policy rollback cannot erase spend/reservations or retroactively reclassify fallback as enrichment success. |

**Evidence:** XS04, XS05, XS09, XS14. Prove admission with real persistence and fake provider/worker charges here; actual C17 input/image/native-route controls must pass in Slice 31.

<a id="s7"></a>

### Execution record 7 — Define role-based model and lifecycle profiles

**Owner:** Core configuration/provider-policy owner. **Verified predecessors:** 0, 2. **Contracts:** C05, C06, C07, C17.

| Boundary | Required state and outcome |
|---|---|
| Authoritative entry | Slices 0/2 supply schema ownership, versioned records and compatible policy representation. |
| Persisted boundary | Saved role/profile and capability-policy records with immutable effective snapshots and opaque credential references; scan, enrichment, dreamer, normalizer, Architect/CU remain distinct roles. |
| Events and dependent consumers | Config/adapter/job consumers resolve the same requested/effective policy and documented precedence; connected session model does not override saved role authority. |
| Restart, concurrency and partial work | Concurrent saves require config revision; restart reconstructs provenance. Unsupported custom overrides block affected profile, not unrelated roles; no hidden model escalation. |
| Durable exit | Policy resolver fixtures cover explicit user models/overrides, separate retention/pricing and no permanent GPT ceiling; 8/10 consume it. |
| Rollback | Restore profile through revision-aware change; existing jobs keep their recorded policy and costs. |

**Evidence:** XS05, XS06, XS14. Actual dependencies and this slice pass locally; subsequent consumers verify their own composed behavior and Slice 27 retains final mandatory gates.

<a id="s8"></a>

### Execution record 8 — Complete Responses and provider capability contracts

**Owner:** Provider/adapter owner. **Verified predecessors:** 7. **Contracts:** C05, C06, C15, C17.

| Boundary | Required state and outcome |
|---|---|
| Authoritative entry | Slice 7 role policies and existing native API/CLI adapters, with source-verified capability/version records. |
| Persisted boundary | Capability negotiation/provenance and sanitized native invocation/result records; host state retains required context/receipts independent of provider caches. |
| Events and dependent consumers | Provider calls expose refusal/incomplete/cancel/usage through one semantic boundary; native CLI transport/continuation remains native under ADR-240. |
| Restart, concurrency and partial work | Unsupported parameter or route is explicit; fallback requires the declared policy and equal mandatory guarantees. Lost response retains unknown usage/effect; changing model invalidates relevant continuation only. |
| Durable exit | Offline API/CLI fixtures pass. Real CU route control is explicitly unqualified until 31; no circular requirement that a worker already exists. |
| Rollback | Pin last qualified adapter/profile; disclose unsupported combinations rather than weakening schema, retention or authority. |

**Evidence:** XS04, XS10, XS14, XS17. Provider/CLI capability and image/tool transport fixtures are the exit here; Computer Use route control/telemetry is not qualified until Slice 31.

<a id="s9"></a>

### Execution record 9 — Evaluate mature-graph model policies

**Owner:** Cognitive evaluation owner. **Verified predecessors:** 4, 6, 8. **Contracts:** C05, C06, C08, C17.

| Boundary | Required state and outcome |
|---|---|
| Authoritative entry | Slices 4/6/8 provide fixed task evaluator, bounded calls and capabilities; existing normalizer is a measured baseline, not the future truth gate. |
| Persisted boundary | Frozen profile comparisons and source/model/prompt/schema provenance; deterministic results separate from opt-in canary records. |
| Events and dependent consumers | Evaluation harness and baseline flow to 14/15; final new-normalizer/client/CU comparisons close in 27/31. |
| Restart, concurrency and partial work | Refusal, unknown price or missing allocation remains an unrun/partial cell; parallel measurements share reservations and cannot choose a more expensive fallback. |
| Durable exit | Offline policy/evidence cases and evaluator reproducibility pass; future normalizer/agent/CU superiority is not asserted at this exit. |
| Rollback | Keep previous qualified role default; retain unfavorable comparisons and acceptance labels. |

**Evidence:** XS01, XS05, XS14. Evaluate the current normalizer as baseline and supply a reusable evaluator. The new normalizer is implemented in 15; composed profile/task evidence closes in 27 and actual CU canaries in 31/27.

<a id="s10"></a>

### Execution record 10 — Validate and persist all configuration

**Owner:** Core configuration owner. **Verified predecessors:** 0, 2, 7. **Contracts:** C07, C17.

| Boundary | Required state and outcome |
|---|---|
| Authoritative entry | Slices 2/7 supply commit primitive, setting/policy schemas and effective-profile semantics. |
| Persisted boundary | Revisioned engine.env candidate, protected fields/secret references, backup and apply receipt; schedule definitions are not reset as a side effect. |
| Events and dependent consumers | Config changes publish apply/restart-required state to job/session/scheduler/UI consumers; templates use the same validated path. |
| Restart, concurrency and partial work | Deployment overrides outrank persisted values; conflicting edits/undo fail by revision. Partial hot apply reports persisted versus effective; running jobs pin policy, restrictive revoke takes effect immediately. |
| Durable exit | Invalid keys/ranges, template previews, atomic disk failure and concurrent undo are tested; no implicit spend/remote/full-access enablement. |
| Rollback | Revision-aware config restore retains subsequent edits or reports conflict; revalidation before activation. |

**Evidence:** XS06, XS18. Actual dependencies and this slice pass locally; subsequent consumers verify their own composed behavior and Slice 27 retains final mandatory gates.

<a id="s11"></a>

### Execution record 11 — Isolate sessions and harden transport authority

**Owner:** Daemon authority/session owner. **Verified predecessors:** 0, 5, 6, 7, 10. **Contracts:** C09, C17.

| Boundary | Required state and outcome |
|---|---|
| Authoritative entry | Slices 5/6/7/10 provide durable execution identity, budget and config; C14/C17 semantics exist as frozen ports. |
| Persisted boundary | Session/control identity, grants, execution fences and recovery records live under daemon authority; selections are session-private views. |
| Events and dependent consumers | Authenticated local/explicit remote requests carry principal/session/instance/execution scope into registry, bridge and later CU control. |
| Restart, concurrency and partial work | Two clients can attach explicitly without stealing state; reconnect reconstructs durable jobs. Sessionless protected mutation fails. Revoke/cancel fences dispatch; timeout keeps conflict ownership until stop/fencing. |
| Durable exit | Real transport/session/cancel fixtures pass, including full-access finite double confirmation; CU worker/seat behavior is an obligation for 31, not a mocked support claim. |
| Rollback | Disable affected transport/grant and drain jobs; preserve receipts, never re-enable global session authority as a compatibility shortcut. |

**Evidence:** XS04, XS06, XS07, XS17. Freeze and exercise the C17 control/lease ports here; physical-seat arbitration and native-runtime stop are implemented and qualified in Slice 31.

<a id="s12"></a>

### Execution record 12 — Align the complete MCP catalog and client contracts

**Owner:** Daemon MCP contract owner. **Verified predecessors:** 1, 5, 8, 10, 11. **Contracts:** C01, C02, C03, C04, C09, C15, C16, C17.

| Boundary | Required state and outcome |
|---|---|
| Authoritative entry | Slices 1/5/8/10/11 provide result, receipt, adapter/config and authority foundations. |
| Persisted boundary | Generated catalog/descriptors, family schemas, semantic effect classification and command target/version metadata; registration is derived from core owners. |
| Events and dependent consumers | MCP/API/SDK bridges consume identical scope/idempotency/availability semantics. Existing command equivalents are inventoried before adding begin/refresh/finish operations. |
| Restart, concurrency and partial work | Unknown versions or missing required session fail visibly; retries recover receipts. Native bridge discovery cache cannot retry an ambiguous mutation. Partial/unavailable results survive serialization. |
| Durable exit | Baseline catalog parity and effect conformance pass now; each later feature registers/tests its contributions in its own slice and 27 closes the final catalog. |
| Rollback | Preserve negotiated previous-major readers; remove unsafe mutations only with explicit upgrade-required disposition and documented sunset. |

**Evidence:** XS03, XS07, XS10, XS13. Close the existing baseline catalog now. Every later feature updates generated descriptors and adds conformance evidence in its own slice; the final complete catalog is gated in 27.

<a id="s13"></a>

### Execution record 13 — Make the strategy registry executable and testable

**Owner:** Dreamer strategy owner. **Verified predecessors:** 0, 2, 5, 6, 12. **Contracts:** C01, C05, C15.

| Boundary | Required state and outcome |
|---|---|
| Authoritative entry | Slices 2/5/6/12 supply evidence snapshots, receipts, admitted work and registered strategy/action contracts. |
| Persisted boundary | Existing strategy registry emits speculative candidates with source/ancestry/input revision and bounded attempt outcomes. |
| Events and dependent consumers | Dreamer/targeted context uses canonical projection; candidate commits and stage receipts feed normalization, yield and dirty scheduler. |
| Restart, concurrency and partial work | Empty/missing evidence retains honest hypotheses; late cancelled output cannot publish. Registry mismatch blocks action rather than falling back to a broader strategy. |
| Durable exit | Every advertised strategy has bounded deterministic positive/negative/empty fixtures or explicit retirement; reflective disposition is recorded. No confidence-only factual promotion. |
| Rollback | Disable one strategy with retained candidates/history; never erase other strategies or reset scheduler state. |

**Evidence:** XS09, XS11, XS14. Actual dependencies and this slice pass locally; subsequent consumers verify their own composed behavior and Slice 27 retains final mandatory gates.

<a id="s14"></a>

### Execution record 14 — Measure and persist useful strategy yield

**Owner:** Dreamer adaptation owner. **Verified predecessors:** 9, 13, 15. **Contracts:** C05, C08, C15.

| Boundary | Required state and outcome |
|---|---|
| Authoritative entry | Slices 9/13/15 provide reproducible evaluator, actual candidate production and evidence-based validation outcomes. |
| Persisted boundary | Versioned deduplicated yield, novelty, cost and evidence ancestry persist across restarts under existing metacognition. |
| Events and dependent consumers | Bounded allocation consumes useful verified outcomes plus separately labeled exploratory value; scheduler profile decisions retain cause/provenance. |
| Restart, concurrency and partial work | Concurrent results merge by attempt/candidate identity; repeated federation/narration cannot multiply yield. Tiny/zero allocations preserve evidence and do not reset on restart. |
| Durable exit | Fixed-allocation comparisons and replays prove adaptive behavior without rewarding volume, confidence or self-corroboration; final task benefit at 27. |
| Rollback | Return to bounded fixed allocation; preserve observations and reservations for re-evaluation. |

**Evidence:** XS05, XS11, XS15. Actual dependencies and this slice pass locally; subsequent consumers verify their own composed behavior and Slice 27 retains final mandatory gates.

<a id="s15"></a>

### Execution record 15 — Calibrate normalization and evidence independence

**Owner:** Normalizer/trust owner. **Verified predecessors:** 2, 5, 9, 13. **Contracts:** C01, C04, C08, C15.

| Boundary | Required state and outcome |
|---|---|
| Authoritative entry | Slices 2/5/9/13 supply canonical evidence, receipts, evaluation baseline and real candidate schema. |
| Persisted boundary | Existing evidence-ledger/trust-state records, validation decisions, contradictions and confidence semantics remain separate; retain rejected and superseded evidence. |
| Events and dependent consumers | Normalization commits publish evidence/claim changes to decay, temporal/causal, tension and context consumers. |
| Restart, concurrency and partial work | Revalidate relevant source/ancestry before promotion; repeated or revoked evidence cannot raise trust. Batch cancellation keeps committed decisions and remaining candidates; old scan age alone changes no truth. |
| Durable exit | Labeled independent-evidence/cold-start/contradiction fixtures pass; scoped ADR-096 amendment is reviewed before changed promotion policy activates. |
| Rollback | Version policy and re-evaluate affected claims; do not reinterpret old confidence numbers or erase prior decisions. |

**Evidence:** XS11, XS14, XS15, XS21. Actual dependencies and this slice pass locally; subsequent consumers verify their own composed behavior and Slice 27 retains final mandatory gates.

<a id="s16"></a>

### Execution record 16 — Align decay maintenance and human curation

**Owner:** Core maintenance/curation owner. **Verified predecessors:** 5, 15. **Contracts:** C04, C10, C15.

| Boundary | Required state and outcome |
|---|---|
| Authoritative entry | Slices 5/15 provide durable mutation and validated evidence semantics. |
| Persisted boundary | Tombstones, rejection memory, per-kind expiry and affected-claim invalidation remain in existing maintenance/lifecycle stores. |
| Events and dependent consumers | Canonical deltas notify dependent stage owners; human decisions/history and unaffected graph knowledge persist. |
| Restart, concurrency and partial work | Concurrent curation wins by explicit expected revisions, not last write; deletion/rename invalidates only supported dependency scope. Aged scan/old evidence without changed support is not an invalidation trigger. |
| Durable exit | Rename/delete/reject/reopen and crash cases preserve history; time-sensitive observations have explicit kind-specific validity, distinct from full-scan age. |
| Rollback | Restore archived evidence only with its original provenance and a new receipt; no resurrection of rejected claims as fresh facts. |

**Evidence:** XS02, XS11, XS15, XS21. Actual dependencies and this slice pass locally; subsequent consumers verify their own composed behavior and Slice 27 retains final mandatory gates.

<a id="s17"></a>

### Execution record 17 — Coordinate engine scheduling events and bootstrap

**Owner:** Core engine/scheduler owner. **Verified predecessors:** 6, 10, 13, 16. **Contracts:** C04, C05, C11, C15, C17.

| Boundary | Required state and outcome |
|---|---|
| Authoritative entry | Slices 6/10/13/16 supply admitted jobs, typed config, strategies and maintenance invalidation. |
| Persisted boundary | Existing scheduler/event/maintenance owners persist occurrence keys, leases, dirty generations, stage fingerprints, root causes and delivery outboxes. |
| Events and dependent consumers | One admission path for manual/scheduled/idle/cycle/bootstrap/targeted work; webhook delivery uses durable event identity, while telemetry does not recursively trigger cognition. |
| Restart, concurrency and partial work | Timeout cannot free an active effect lane; restart reconciles attempts. G completion clears only covered inputs, leaving G+1. Budget-blocked optional cognition leaves reconciled facts usable; provider fingerprint never grants spend. |
| Durable exit | Offline SC01–13 core, generation and readiness fixtures pass; post-office intent maps to existing event/webhook delivery. No second scheduler/job authority. |
| Rollback | Pause future admission, drain/fence attempts and preserve due/dirty/outbox cursors; no replay of all missed work or resetting day budgets. |

**Evidence:** XS04, XS05, XS09, XS11, XS12, XS21. Actual dependencies and this slice pass locally; subsequent consumers verify their own composed behavior and Slice 27 retains final mandatory gates. C17 graph-follow-up is exercised with typed effect fixtures here; actual CU21 route evidence is required in 31.

<a id="s18"></a>

### Execution record 18 — Align temporal causal and federated evidence

**Owner:** Temporal/causal/federation owner. **Verified predecessors:** 2, 15, 16, 17. **Contracts:** C01, C02, C04, C15.

| Boundary | Required state and outcome |
|---|---|
| Authoritative entry | Slices 2/15/16/17 provide canonical ancestry, invalidation and durable stage/event admission. |
| Persisted boundary | Temporal observations, causal hypotheses and federation origin/import keys retain event time, observation time and schema/policy provenance. |
| Events and dependent consumers | Affected dependencies schedule bounded re-evaluation; imported claims enter local evidence/trust rules rather than bypassing normalization. |
| Restart, concurrency and partial work | Replay/out-of-order/duplicate imports deduplicate by origin identity; missing ancestry remains unknown. Concurrent local source changes invalidate only affected claims, not whole graph age. |
| Durable exit | Golden history/import/counterexample fixtures prove no causal certainty from correlation or independent support from repeated import. |
| Rollback | Quarantine incompatible foreign records without deleting origin/history; compensate changes through local authority. |

**Evidence:** XS11, XS15. Actual dependencies and this slice pass locally; subsequent consumers verify their own composed behavior and Slice 27 retains final mandatory gates.

<a id="s19"></a>

### Execution record 19 — Unify tension remediation and future review

**Owner:** Tension/intervention owner. **Verified predecessors:** 15, 17, 18. **Contracts:** C01, C04, C15.

| Boundary | Required state and outcome |
|---|---|
| Authoritative entry | Slices 15/17/18 provide trust, admitted stages and temporal/causal ancestry. |
| Persisted boundary | Stable tension/branch/intervention IDs and proposal/action/outcome evidence; accepted human overrides retain rationale and scope. |
| Events and dependent consumers | Evidence changes reopen relevant risks; adaptive future review remains advisory and feeds plan review without becoming an approval engine. |
| Restart, concurrency and partial work | Successful action is not verified resolution; partial external effect stays unknown/recoverable. Conflicting human/agent edits require revision resolution and preserve both evidence trails. |
| Durable exit | Compound contradiction/reopen/remediation cases prove outcome verification and correct bounded follow-up without source evidence laundering. |
| Rollback | Retain risk history and restore only through reviewed transitions; executed external actions need compensation, not fictitious rollback. |

**Evidence:** XS09, XS11, XS15. Actual dependencies and this slice pass locally; subsequent consumers verify their own composed behavior and Slice 27 retains final mandatory gates.

<a id="s20"></a>

### Execution record 20 — Make lifecycle narrative and lucid interaction consistent

**Owner:** Narrative/lucid/lifecycle owner. **Verified predecessors:** 11, 16, 19, 21. **Contracts:** C01, C03, C04, C15.

| Boundary | Required state and outcome |
|---|---|
| Authoritative entry | Slices 11/16/19/21 supply scoped sessions, evidence lifecycle, tensions and authoritative plan state. |
| Persisted boundary | Narrative/playback/lucid session records reference immutable source/evidence/plan revisions; derived summaries do not become independent evidence. |
| Events and dependent consumers | Engine-mode/lucid leases and user answers feed canonical result history and bounded maintenance; C14 status is consumed, not inferred from narrative. |
| Restart, concurrency and partial work | Disconnect/restart exits or recovers lucid ownership explicitly; source change invalidates affected derived text. Partial narration does not overwrite durable human decisions or verified plan history. |
| Durable exit | Replay/lucid/narration tests preserve temporal truth, per-session control and meaningful exploration; generated-doc re-ingestion retains origin. |
| Rollback | Rebuild derived narrative/playback from retained evidence; preserve user contributions and actual effects. |

**Evidence:** XS07, XS08, XS11, XS16. Actual dependencies and this slice pass locally; subsequent consumers verify their own composed behavior and Slice 27 retains final mandatory gates.

<a id="s21"></a>

### Execution record 21 — Repair plan and discipline lifecycle projection

**Owner:** Plan/discipline authority owner. **Verified predecessors:** 0, 5, 11, 12. **Contracts:** C01, C02, C04, C09, C12, C14, C15, C16, C17.

| Boundary | Required state and outcome |
|---|---|
| Authoritative entry | Slices 5/11/12 provide receipt, session and command authority; earlier implementation history is imported from stable reviewed IDs and hashes. |
| Persisted boundary | One typed plan/definition/slice transition store plus export outbox; Markdown is portable authored definition/history, not a competing mutable status authority. |
| Events and dependent consumers | Atomic status snapshot/events serve list/header/sidebar/task memory/CLI/MCP; C16 commands use captured identity/revision; execution leases remain distinct. |
| Restart, concurrency and partial work | Concurrent selections cannot steal execution. Reopened definition/evidence invalidates affected approval. Verification checks material effects without recursively requiring its own status export to re-verify itself. |
| Durable exit | PL01–16 authority and core UI fixtures pass; required reconciliation gates verification, optional cognition does not. Future CU consumers bind at 31, full surface matrix at 25. |
| Rollback | Use reviewed import/export with hashes; failed export remains durable pending and blocks destructive archive. Do not fall back to prose-derived success. |

**Evidence:** XS07, XS08, XS09, XS18. Verify lifecycle authority with contract doubles for not-yet-built CU consumers; real native-capability loss and GUI effects are integrated in 31. Full client matrix closes in 25. PL01–15 authority/local-UI and PL16 core protocol are verified here; full PL16/client/menu adoption is 25 and actual CU11/CU22 is 31.

<a id="s22"></a>

### Execution record 22 — Align analytics health and observability

**Owner:** Core metric definitions/analytics owner. **Verified predecessors:** 2, 5, 15, 19, 21. **Contracts:** C01, C03, C08, C15.

| Boundary | Required state and outcome |
|---|---|
| Authoritative entry | Slices 2/5/15/19/21 provide coherent graph/receipt/trust/risk/plan projections. |
| Persisted boundary | Versioned metric definitions and immutable core export/API snapshot manifests, including denominator/scope/completeness and measurement windows. Expose canonical graph-mutation/full-scan/source-reconciliation markers in MCP/health/API and every consumer; XS21 proves agents do not infer stale graph from scan age or hide scoped gaps behind an unrelated new mutation. |
| Events and dependent consumers | Python modules, runtime metrics, health/weather and dashboards consume the same snapshot contracts and distinguish source, semantic and usefulness measures. |
| Restart, concurrency and partial work | Partial/unavailable families remain labeled; corrupt export never becomes empty success. Reconciled modifications since an old full scan are current; raw age/Git diff totals are not graph drift. |
| Durable exit | All 13 analytics modules compare semantic goldens; XS21 proves one initial scan plus managed changes stays healthy/current while real scoped gaps remain visible. |
| Rollback | Rebuild derived analytics from pinned exports; retain historical metric schema/version instead of rewriting past values. |

**Evidence:** XS13, XS16, XS21. Actual dependencies and this slice pass locally; subsequent consumers verify their own composed behavior and Slice 27 retains final mandatory gates.

<a id="s23"></a>

### Execution record 23 — Improve dashboard and configuration workflows

**Owner:** Dashboard/configuration surface owner. **Verified predecessors:** 10, 11, 17, 21, 22, 25, 29. **Contracts:** C07, C09, C12, C14, C15, C16, C17.

| Boundary | Required state and outcome |
|---|---|
| Authoritative entry | Slices 10/11/17/21/22/25/29 provide real config, authority, lifecycle/health, shared actions and schedule workspace. |
| Persisted boundary | UI view state only; settings/templates and contextual commands commit through their owning authorities. |
| Events and dependent consumers | Compact tabs and root links include Explorer; requested/effective/restart and graph-sync/digestion state use shared projections. |
| Restart, concurrency and partial work | Two-client config edits/undo conflict visibly; refresh never enables jobs or templates. Partial runtime apply stays visible; scan age alone cannot produce a stale-graph banner or compulsory scan prompt. |
| Durable exit | Real browser workflow fixtures cover config/reset/search/keyboard/narrow layouts and shared menu/schedule integration; no duplicate schedule semantics. |
| Rollback | Revert UI presentation independently of committed settings; retain authority-compatible controls and recovery access. |

**Evidence:** XS06, XS07, XS12, XS21. Actual dependencies and this slice pass locally; subsequent consumers verify their own composed behavior and Slice 27 retains final mandatory gates.

<a id="s24"></a>

### Execution record 24 — Align Explorer and agent evidence navigation

**Owner:** Explorer surface owner. **Verified predecessors:** 3, 12, 20, 22. **Contracts:** C01, C03, C12.

| Boundary | Required state and outcome |
|---|---|
| Authoritative entry | Slices 3/12/20/22 provide bounded graph/evidence, curated commands, narrative and health semantics. |
| Persisted boundary | Derived 2D/3D layouts and local view selection; canonical IDs, revision and trust arrive from core. |
| Events and dependent consumers | Inspector/evidence links and curated mutations share daemon receipts and exact context seen by agents. |
| Restart, concurrency and partial work | Dense/paged/reconnect views disclose missing scope and old display revision; selection or layout never mutates truth. Conflicting writes refresh canonical result. |
| Durable exit | Realistic dense graph, glass/edge/label accessibility and versioned mutation tests preserve polish and semantic navigation; source age is informational. |
| Rollback | Discard/rebuild layouts and retain old negotiated reader where lossless; canonical evidence never stored only in canvas state. |

**Evidence:** XS07, XS13, XS16, XS21. Actual dependencies and this slice pass locally; subsequent consumers verify their own composed behavior and Slice 27 retains final mandatory gates.

<a id="s25"></a>

### Execution record 25 — Align Architect VS Code CLI plugins and context budgets

**Owner:** Client/adapter integration owner. **Verified predecessors:** 3, 5, 8, 12, 17, 21, 22, 24, 29, 30. **Contracts:** C01, C02, C03, C06, C09, C14, C15, C16, C17.

| Boundary | Required state and outcome |
|---|---|
| Authoritative entry | Slices 3/5/8/12/17/21/22/24/29/30 are verified; all ordinary execution and action projections can now compose. |
| Persisted boundary | Host effect outboxes, context/operation receipts and session view caches point to daemon authority; native transcripts are not the sole memory. |
| Events and dependent consumers | Browser/VSCode/API/Codex/Copilot/CLI/MCP/SDK managed routes close C15; menus, chevrons and selected-plan reveal share target/action metadata. |
| Restart, concurrency and partial work | Shell/editor/plugin material effects require intent plus independent after-state observation. Missing mediation is explicitly unattested/blocked, never a green managed route; reconnect/lost transcript recovers obligations. |
| Durable exit | AT/GE/UX composed traces and eight-surface same-revision comparisons pass. C17 seams exist here; actual workers/native interactions and their controls remain 31 obligations. |
| Rollback | Disable a nonconforming route without changing authority or silently falling back; retain all effect/outcome evidence and visible obligations. |

**Evidence:** XS07, XS09, XS10, XS16, XS17, XS21. Close ordinary connected execution routes now; provide C17 seams to Slice 31 without claiming native GUI qualification. Final all-route evidence remains mandatory in 27. Existing dashboard semantic projections join here; the later Slice 23 presentation/configuration makeover consumes them and is not an entry dependency.

<a id="s26"></a>

### Execution record 26 — Refresh the legacy DreamGraph graph safely

**Owner:** Core migration/maintenance owner. **Verified predecessors:** 2, 5, 6, 16, 17, 20, 21, 22, 25. **Contracts:** C02, C04, C10, C15.

| Boundary | Required state and outcome |
|---|---|
| Authoritative entry | Slices 2/5/6/16/17/20/21/22/25 supply composed contracts and family converters; exact migration inputs are reviewed. |
| Persisted boundary | Migration manifest, backup/restore proof, staging/checksums, ID maps, receipts and active-format marker cover every U0–U8 family. |
| Events and dependent consumers | Versioned readers/clients see old or fully committed new state; grant, schedule and dirty recovery precedes resumed admission. |
| Restart, concurrency and partial work | Quiesce old binaries, then fence one writer. Disk full/cancel before marker keeps old data; after marker recover new. Unknown legacy reconciliation remains scoped unknown, not evidence all old knowledge is stale. |
| Durable exit | Disposable full-family crash/restart/post-cutover-write migration passes; optional CU assets/session defaults are installed disabled and qualified by 31/28. |
| Rollback | Before cutover restore predecessor; after new writes use tested forward repair/reconciliation preserving them. Failed rollback is recovery-required, never empty reinitialization. |

**Evidence:** XS03, XS18, XS19, XS21. Actual dependencies and this slice pass locally; subsequent consumers verify their own composed behavior and Slice 27 retains final mandatory gates.

<a id="s27"></a>

### Execution record 27 — Add system lifecycle and recovery regression gates

**Owner:** Conformance/release verification owner. **Verified predecessors:** 12, 14, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 29, 30, 31. **Contracts:** C01, C17.

| Boundary | Required state and outcome |
|---|---|
| Authoritative entry | All dependency slices, including ordinary integration, migration, schedules, CLI controls and CU, carry reviewed evidence hashes. |
| Persisted boundary | Requirements-to-evidence ledger records real commands/results, exclusions, fixture/runtime versions and review decisions. |
| Events and dependent consumers | AT/PL/GE/SC/UX/CU and XS compound cases compose across system; accepted artifacts feed exact release packaging in 28. |
| Restart, concurrency and partial work | Any failed mandatory truth/authority/commit/budget case blocks closure; mocks cannot qualify real workers or paid usefulness. Changed dependency hashes invalidate affected evidence. |
| Durable exit | All mandatory feature/system obligations have actual accepted evidence; explicit supported-platform disposition is published. Ordinary CI spends zero; unrun required comparisons remain open. |
| Rollback | Reopen failed/affected slices and retain evidence history; no percentage or manual green status waives mandatory guarantees. |

**Evidence:** XS01, XS02, XS03, XS04, XS05, XS06, XS07, XS08, XS09, XS10, XS11, XS12, XS13, XS14, XS15, XS16, XS17, XS18, XS19, XS20, XS21. Gate composed feature and migration behavior before packaging; Slice 28 then validates the exact versioned release/install assets and reopens affected evidence if packaging changes behavior.

<a id="s28"></a>

### Execution record 28 — Publish verified contracts and synchronized release

**Owner:** Release/install owner. **Verified predecessors:** 27. **Contracts:** C02, C07, C11, C12, C14, C15, C16, C17.

| Boundary | Required state and outcome |
|---|---|
| Authoritative entry | Slice 27 feature/system evidence is accepted; reviewed product/schema compatibility and install migration boundaries are fixed. |
| Persisted boundary | Versioned immutable release assets, package/version manifest, launcher pointer and per-instance activation/migration receipts. |
| Events and dependent consumers | All eight surfaces plus SDK/worker assets advertise synchronized v14.0.0 product and separately negotiated schema versions. |
| Restart, concurrency and partial work | Installing new binaries cannot overwrite running old assets; -Force is not migration consent. Restart chooses pinned compatible version; post-upgrade writes survive rollback or block it explicitly. |
| Durable exit | Test exact packaged 13.4-to-14 install/restart/restore on disposable data after 27; artifact failure reopens 28, or the affected feature slice if behavior differs. No 27-to-28 acceptance cycle. |
| Rollback | Repoint launcher only to schema-compatible pinned binaries; data rollback requires proven preservation of subsequent writes. Keep previous assets until instances no longer need them. |

**Evidence:** XS18, XS19. Package and test after Slice 27. Keep version-pinned assets for running instances; installation and schema activation are distinct, and -Force cannot authorize destructive data conversion.

<a id="s29"></a>

### Execution record 29 — Rebuild dashboard schedule management

**Owner:** Dashboard schedule surface owner; core scheduler remains authoritative. **Verified predecessors:** 10, 11, 17, 21, 22. **Contracts:** C04, C05, C07, C09, C11, C12, C15, C16.

| Boundary | Required state and outcome |
|---|---|
| Authoritative entry | Slices 10/11/17/21/22 provide validated settings, authority, scheduler truth, plan targets and historical metrics. |
| Persisted boundary | Only daemon schedule definitions/revisions and immutable run snapshots; UI draft/selection is local. |
| Events and dependent consumers | Schedules/Upcoming/Runs consume one occurrence evaluator and admission API; commands expose reusable target/eligibility descriptors to 25. |
| Restart, concurrency and partial work | Duplicate starts disabled; editing/archive retains run history. Two-client edit and double-click replay use revision/idempotency; DST/restart/overlap/budget results match core. |
| Durable exit | SC01–13 actual browser plus core integration shows edit/preview/run/pause/cancel distinctions and retained history. Shared menu rendering lands in 25 without making 29 depend on it. |
| Rollback | Revert presentation without deleting definitions/history; invalid schedules remain blocked rather than silently broadened. |

**Evidence:** XS04, XS07, XS12. Actual dependencies and this slice pass locally; subsequent consumers verify their own composed behavior and Slice 27 retains final mandatory gates.

<a id="s30"></a>

### Execution record 30 — Make CLI Autonomy and Verbosity effective

**Owner:** Architect orchestration and CLI bridge owner. **Verified predecessors:** 8, 11, 12, 21. **Contracts:** C06, C09, C12, C13, C15, C17.

| Boundary | Required state and outcome |
|---|---|
| Authoritative entry | Slices 8/11/12/21 provide native adapter capabilities, scoped execution, effect commands and C14 continuation target. |
| Persisted boundary | Effective control policy and sanitized invocation/stop traces pin session/execution/adapter version; legacy mode aliases are explicit. |
| Events and dependent consumers | Manual/supervised/autonomous boundaries plus verbosity presentation feed browser and extension; ADR-240 continuation respects approved task scope across intermediate slices. |
| Restart, concurrency and partial work | Concurrent session settings do not leak; restriction revokes immediately at admission, expansion needs authority. CLI exit and timeouts preserve actual tool/effect outcome, not fabricated task success. |
| Durable exit | Instrumented Codex/Copilot fixtures prove behavior, not just launch strings. Actual native-CU stop/grants tests close in 31, avoiding a circular dependency. |
| Rollback | Pin a supported native control mapping or expose unsupported behavior; never use a broad approval profile to simulate missing finer controls. |

**Evidence:** XS01, XS04, XS07, XS10, XS17. Close general CLI controls now. The C17 native interaction assertions in step 6 are mandatory integration obligations implemented/qualified in 31, not a circular entry gate here.

<a id="s31"></a>

### Execution record 31 — Deliver governed cross-platform Computer Use

**Owner:** Architect execution integration owner with platform maintainers and authority/privacy reviewer. **Verified predecessors:** 3, 5, 6, 8, 10, 11, 12, 17, 21, 25, 30. **Contracts:** C01, C02, C03, C04, C05, C06, C07, C09, C12, C13, C14, C15, C16, C17.

| Boundary | Required state and outcome |
|---|---|
| Authoritative entry | Slices 3/5/6/8/10/11/12/17/21/25/30 provide graph, effect, budget, authority and adapter integration foundations. |
| Persisted boundary | C17 sessions/targets/observations/actions, grants, seat leases, effect/verification receipts and scoped artifact retention use existing core authority. |
| Events and dependent consumers | 31A–H build common contract, authority, portable browser, peer OS backends, native-CLI/API routes, graph closure, UI and qualification in that order. |
| Restart, concurrency and partial work | Stale screen, permission loss, human takeover, cancellation or ambiguous external effect stops/reobserves under the same session. Missing mandatory native control blocks that route; no silent host/model/worker swap. |
| Durable exit | CU01–24 actual portable-browser and named platform/native-route evidence, plus XS17/20 recovery/graph-loop joins, unblock 27. Common contract is never weakened to a backend minimum. |
| Rollback | Revoke grants/leases and disable route while preserving receipts/unknown effects; do not replay ambiguous actions or promise undo of external effects. |

**Evidence:** XS01, XS09, XS17, XS20. Actual dependencies and this slice pass locally; subsequent consumers verify their own composed behavior and Slice 27 retains final mandatory gates.


## Shared state and publication rules

### Persistence boundary — existing owner, explicit commit point

Core persistence remains the owner. **Ashoka does not require replacing the canonical stores with a new database.** Extend the existing JSON store loaders, reconciliation journal, atomic writer and barrier behind a storage port; remove whole-store stale-write semantics. JSON is a physical encoding, not graph identity. A future sharded/database backend must satisfy the same conformance suite and receives its own reviewed physical migration; Sol need not select a database to execute this plan.

Slice 2 establishes typed identity, coherent read snapshots, graph/domain revisions and the publication primitive. Slice 5 extends that primitive with business-level effect/reconciliation/job/dirty receipts. Proposed metadata names (`commit_state`, `operation_receipts`, `effect_outbox`) describe records in the existing instance persistence boundary, not a second service or independently authoritative registry. Schema artifacts name their actual representation at Slice 0/2 entry. Domain owners keep their records; a shared transaction can update several domains atomically.

Distinguish: instance UUID; repository identity; source tree/content fingerprint; scan-baseline revision; monotonic publication sequence; graph revision; plan definition/state revision; configuration revision; execution/attempt ID; process/worker epoch. A dream or human correction advances graph revision even if source files and scan baseline did not change. A config save advances config revision without pretending a scan occurred. One read carries the relevant revision vector from a committed publication. Source hashes attest observed content, not a total ordering of graph mutations.

1. Acquire exclusive instance ownership before serving writes. A second process for the same resolved data directory must connect to the owner or refuse writes. Existing v13 processes must be stopped/drained before incompatible cutover; a new lock file cannot fence old code that ignores it. Multiple connections and separate instances remain supported.
2. Prepare outside the publication barrier. At commit, acquire logical resource locks in one documented sorted order, then the exclusive publication barrier; never upgrade a held read lock. Release and re-read/revalidate instead. No provider, plugin, browser or user wait occurs under these locks. Startup initialization/recovery cannot be hidden inside a read accessor.
3. Validate expected revisions, instance/actor/grant, payload digest, schema, input/evidence fingerprints and execution fence. Persist a prepared journal containing affected old/new bytes or verified content references, expected/new revision vector, operation identity and receipt/outbox records. Validate all paths before staging.
4. Replace the prepared stores and metadata using the existing atomic writer, invalidate affected caches, then durably publish a commit marker/revision. A scan baseline is one participating record; it is no longer the universal marker for all graph writes. Readers stay fenced until publication or full recovery. Receipt visibility and outbox visibility follow the same marker.
5. Before that marker, an interrupted transaction is uncommitted and restores its recorded predecessor while retaining recovery evidence. After it, recovery validates/finishes the committed generation and returns its receipt; it must never blindly restore the predecessor. Corrupt/ambiguous markers stop admission as recovery-required. Journal cleanup failure after a proven commit does not erase that commit.
6. Acknowledge committed only after that boundary. Notifications are hints emitted from the durable outbox; duplicate delivery is expected, consumers deduplicate by event/operation identity. Never acknowledge merely because generated text or some file replacements succeeded.

Use platform-correct canonical path identity, unique temporary names, same-volume atomic publication and fault-tested durability. State the qualified filesystem/process-crash guarantees; do not promise recovery from arbitrary hardware corruption. OS power-loss and network-share guarantees require separate evidence. Backups and integrity hashes remain necessary. Existing JSON atomic-write/barrier ADRs require an explicit scoped amendment for the new marker/retained-receipt semantics before cutover.

Paged reads pin one immutable logical snapshot or a materialized bounded snapshot export. Cursors bind schema, filter/scope, permission digest, revision and expiry. Restart may expire ephemeral snapshots explicitly; it may not silently continue at a new revision. Derived indexes/cache entries carry input and schema versions; corrupt/stale indexes are rebuilt or use a bounded correct scan. Index absence is not empty graph knowledge. Snapshot/export pinning and quotas prevent old readers from retaining unbounded history.

### Freshness is maintained knowledge, not scan recency

**An old scan does not equal a stale graph.** One initial inclusive scan may be sufficient indefinitely when subsequent project changes are made and reconciled through DreamGraph MCP or Architect. Preserve the current status of reconciled and unaffected knowledge regardless of the last full-scan date. Time since scan/enrichment, file mtime and commits since scan are historical diagnostics, never sufficient stale/unknown evidence, a health penalty, an automatic scan trigger or an agent instruction to reread the whole repository.

For each relevant scope, core compares known material changes and evidence dependencies with committed reconciliation coverage and current target hashes when an action requires them. Known mismatches/withdrawn evidence mark only affected claims stale; unfinished reconciliation is an explicit pending gap; missing mapping/history can be unknown for that scope. Optional pending dreaming/normalization is a separate state, not a stale source graph. Compare saved working-tree and untracked-file fingerprints with the latest applicable reconciliation receipt; an already-reconciled dirty Git worktree or new commit must not be counted as external drift again. A missing old scan baseline can limit an incremental-scan feature without negating later valid knowledge or forcing an inclusive scan.

Do not assume unseen out-of-band changes merely because DreamGraph was not recently scanning. When the user knows substantial work happened without DreamGraph, they choose an inclusive scan. A concrete detected external delta can offer targeted reconciliation, or a clearly scoped inclusive-scan option when coverage cannot be recovered; no automatic broad scan/enrichment and no claim that a read-only MCP call captured private external edits. Currentness is for managed/observed scope, not an attestation of every action in an unobserved external tool.

Explicit validity windows for transient GUI observations, external service measurements or time-dependent claims still apply to those evidence kinds. They must not be generalized into graph-wide age expiry. C07 preserves legacy age settings as clearly labeled scan-recency diagnostics or optional user reminders, inactive as truth/admission gates; migration never silently converts them into a rescan schedule. XS21/AT06 test these distinctions across all eight surfaces.

### Graph currency metadata

Persist **`last_graph_mutation_at`** with the graph revision and operation receipt at every successful canonical graph-changing commit, including managed MCP/Architect updates, curation and cognitive writes. Publish it atomically with that commit; failed/rolled-back attempts, reads, no-op saves and view/config-only changes do not advance it. A retry returns the original committed timestamp. Use UTC for display/audit and the monotonic revision for ordering, so clock skew cannot create a false freshness sequence.

Expose separate **`last_full_scan_at`** (last known completed inclusive scan) and **`last_source_reconciliation_at`** plus covered scope/revision (latest successful structural reconciliation). Preserve legacy `last_scan_at` semantics through the compatibility adapter; do not relabel an unknown scan kind as a full scan. Missing historical timestamps remain null/unknown, never fabricated from file mtime or migration time. An inclusive scan advances its marker only after its committed coverage boundary; partial scan progress is reported separately. A successful no-delta source reconciliation may advance its observation/coverage marker without pretending a graph mutation occurred.

MCP graph/context/health responses, API/CLI, SDK/Python exports and all eight surfaces consume the same metadata; UI can show compact “Graph updated …” and “Full scan …” with scope/operation detail available. MCP-aware prompts and recommendations must never conclude “Graph is stale” from full-scan age. Mutation time is useful activity evidence, not a blanket freshness certificate: a recent unrelated dream must not hide unresolved source changes elsewhere, and an old mutation time does not make unchanged knowledge stale. Freshness still follows scoped evidence and reconciliation coverage.

### Operations, jobs and cancellation

An operation is the idempotent semantic request. A job is accepted work; an execution is an admitted attempt under an owner/lease. A session is authenticated conversation/control context. A schedule occurrence is a trigger identity. A discipline session is governance history. None is a substitute for another, and none is identified by a display name or CLI session token.

Operation keys bind instance, actor/scope, operation epoch and payload digest. Same key/same digest returns the durable outcome; different digest conflicts. Initial receipt-retention default: 30 days for terminal unreferenced operations, configurable under C07. Pending/unknown effects, reservations, migrations and referenced verification evidence cannot be garbage-collected. Retiring an epoch leaves a compact durable rejection watermark; an expired key returns `receipt_expired/reconciliation_required`, never starts the action again. Archive/retention capacity exhaustion blocks new affected admission instead of discarding recovery evidence. No system promises that a GUI/external effect is exactly once.

Core job records land with Slice 5/6; Slice 17 schedules them rather than introducing another job store. State is accepted/queued, blocked, running, cancelling and terminal succeeded/partial/failed/cancelled, with independent recovery/unknown-effects fields. Cognitive AWAKE/REM/NORMALIZING/NIGHTMARE/LUCID/INGEST remains a separate engine-mode projection of admitted cognitive ownership, not the job or plan lifecycle. Initially one mutating cognitive execution per instance; unrelated reads and separately scoped client work remain concurrent.

Cancellation records intent and advances the execution fence before new dispatch. Each late operation checks the fence again at commit. An already-published effect remains committed; a late model response may settle usage and be retained as quarantined evidence but cannot autonomously publish a cancelled job's new mutation. Preserve one terminal cause under ADR-239, plus later effect/charge observations. A timeout alone does not free the resource for a conflicting worker: obtain stop acknowledgement, terminate the isolated worker, or keep it fenced/recovery-required. A human sees what ran, what committed and what remains unknown.

Every provider call, including readiness tests, automatic bootstrap, normalization, narration, future review and plugin/provider helpers, reserves before dispatch. C05 run/day accounting is per declared instance/billing-principal scope, not a promise to cap other daemons or unrelated account usage. If a budget is allocated across instances, give each a fixed child allocation whose sum fits the parent; do not let each independently assume the entire cap. One call charges the UTC admission day; it retains that reservation across midnight until settled, while new calls reserve the new day's capacity and the same run cap. Cancelling, changing credentials/profile, recreating a schedule or retrying cannot reset usage.

No configured paid allocation means no readiness completion call. Static configuration validity is `configured`, not `verified_ready`; a real readiness probe is a separately admitted minimal job. A provider/model fingerprint change marks role readiness stale and offers bounded re-enrichment; it does not itself authorize spending. Automatic dream readiness remains an independent evidence/completeness gate. Unknown price under a hard money cap is denied; subscription usage remains explicitly non-monetary unless verified.

### Configuration, sessions and plan authority

C07 precedence is: explicit deployment overrides/secret references; persisted instance configuration; schema defaults. Within fields explicitly allowed to vary, a session/task override derives its effective policy from that base and remains inside its authority/budget ceiling. A request cannot override identity, authentication, secret access or global limits. Display source and override scope. Dashboard saving an overridden field updates persisted intent and shows why it is not effective. External engine.env edits are revision-bound imports, with a persisted/effective mismatch until validated/reloaded or restarted; they cannot mutate in-flight job meaning retroactively.

Runs pin immutable effective model/API/policy/price/capability and config revision. A broader config change applies to a future attempt under fresh admission. Revocation, lower grants and emergency stop are live restrictive controls and take effect at the next admission/commit fence. Secrets are opaque references; historical records retain the old reference/fingerprint without retaining secret values. Template rollback is a new revision with conflict review, never copying stale state over a newer file.

Session-owned selection/transcript/view state is distinct from shared authorized project/plan state. A reconnect uses a validated session/resume binding and last event cursor; a new tab receives no right to another private execution merely by selecting the same plan. Authorized collaborators may deliberately attach to a shared execution. Protected commands require explicit instance/principal/session/execution/discipline context where applicable; a sessionless legacy API cannot guess the process-wide active session. Existing read-only calls can remain compatible.

C14 typed state is the operational authority. Markdown is the portable definition/history surface: import external edits by hash; export committed status/history through an idempotent outbox. Conflicting external edits create a proposal, not last-writer-wins replacement. A rename/reorder preserves the stored plan/slice IDs and mapping; ambiguous headings block import. Acceptance/authority/dependency edits invalidate affected approvals and dependent verification, while cosmetic edits retain valid evidence with a carry-forward record.

Verification is relative to the declared effect manifest and input revisions. Reconciliation required by that manifest must be committed. Optional paid cognition may remain pending. The verification event's own status projection/export is derived bookkeeping and is atomically recorded as an export obligation; it cannot recursively demand another implementation verification. Failed export remains visible/recoverable and prevents archival that would lose history, while it cannot falsely revoke already verified code. Project-scope work has nullable plan/slice IDs and never attaches itself to the currently selected plan.

## Concepts traced across the whole system

All rows use the publication/receipt/recovery rules above. `core` means the existing core/daemon semantic owner, even when accessed through SDK/MCP. Persisted names are record families; future schemas remain under their listed owner's boundary.

| Concept | Producer → sole semantic owner | Durable representation and authorized mutation | Event/read projection → adapters/surfaces → recovery |
|---|---|---|---|
| Graph identity | scanner, human curation, imports → core identity (2) | Typed instance/repository/entity/relationship ID, aliases, tombstones; governed upsert/map | ID-change receipt → all eight + SDK/Python; old IDs resolve or report ambiguity, never name-merge |
| Graph revision | every canonical writer → core publication (2/5) | Commit sequence, graph revision and last_graph_mutation_at independent of scan hash; scan/reconciliation markers retain separate scope | Revision/outbox and activity metadata → all machine/UI consumers; failed/no-op/replayed work cannot forge mutation time, marker reconstructs after crash |
| Snapshot | publication reader → core query (1/2) | Pinned revision/vector, scope and expiry; optional immutable export | Cursor/etag → API/MCP/CLI/SDK; expired cursor resets, no mixed pages |
| Source evidence | source scanner, runtime/DB observer, verifier → evidence owner (2/5) | Source identity/hash, semantic anchor, observation time, source kind and limits | Evidence change → retrieval/truth/UI; unavailable source stays unknown |
| Provenance | any producer → evidence owner (2/15) | Human/source/model/import origin and producing operation | Typed evidence view → every renderer; history cannot be overwritten by summary |
| Evidence ancestry | validators/dreams/narration/import → evidence ledger (15) | Parent evidence IDs and root cause; unknown ancestry explicit | Invalidation → trust/metrics; repeated ancestry never counts independently |
| Trust | normalizer, reviewed human decision → trust owner (15) | Hypothesis/disputed/validated/rejected plus evidence and policy version | Trust transition → all views; revocation reopens without erasing history |
| Confidence | model/scorer/calibration → trust/calibration owner (15/22) | Named score meaning/version, not a shared unlabeled float | Qualified score → UI/analytics; incomparable versions remain incomparable |
| Freshness | managed reconciliation and concrete changed evidence → evidence dependency owner (2/5/16) | Evidence fingerprints, covered scope and pending invalidation; scan age is historical metadata | Same current/stale/unknown meaning in all views; one initial scan remains current through managed updates; actual gaps prompt scoped recovery/user-selected scan |
| Plan identity | authored plan importer → plan authority (21) | Stable plan/slice IDs, definition hashes and source spans | Definition revision → all plan views; ambiguous import blocks affected commands |
| Slice lifecycle | authorized commands/verifier → C14 reducer (21) | Typed transition/checkpoint/evidence/waiver records | One projection → all views/prompts; restart replays typed facts, not prose |
| Current/next | assignments, leases, dependencies → C14 reducer (21) | Current ownership and approved definition; next is derived | Arrays/eligibility/reasons → clients; selection cannot create current work |
| Job | action admission → core job owner (5/6) | Job ID, pinned scope/policy, checkpoints and result receipts | Durable state → scheduler/control/status; no re-execution from missing UI event |
| Execution | dispatcher → daemon execution owner (11) | Attempt ID, lease/fence, terminal cause and late effects | Execution events → API/CLI/Architect; expired lease recovers before dispatch |
| Session | authenticated client attachment → daemon session owner (11) | Principal/project/session binding and scoped view/runtime state | Private/shared projection → browser/VS Code/CLI; explicit reattach, no singleton takeover |
| Cancellation | authorized user/deadline → execution owner (11) | Cancel intent, fence, stop result and remaining effects | Typed outcome → all controls; no new admission, reconcile already published work |
| Operation receipt | domain mutation → core commit owner (2/5) | Operation epoch/key/digest, commit revision and affected scope | Receipt lookup → every writer; lost reply resolves by key, retired key cannot retry |
| Reconciliation obligation | controlled effect intent/observed external delta → reconciler (5) | Before/after hashes, mapping gaps, host outbox and graph receipt | Source-applied/pending/committed → context/C14; restart scans unfinished intent |
| Dirty generation | evidence invalidation → maintenance owner (17) | Scope partition, generation, cause/input fingerprint and pending stages | Durable outbox → scheduler/retrieval; G completion cannot clear G+1 |
| Digestion | stage planner → existing scheduler/maintenance (17) | Per-stage attempt, covered inputs, result and remaining debt | Stage status → UI/next agent; optional blocked stage leaves facts usable |
| Scheduler | definition editor/clock/event → scheduler (17) | Definition revision, occurrence key, immutable run snapshot | Upcoming/runs → dashboard/CLI/MCP; durable claim prevents restart duplicates |
| Model role/profile | config/user request → core policy resolver (7/10) | Role policy with inheritance and validated overrides | Effective policy → provider/controllers/UI; in-flight copy immutable |
| Requested/effective model | resolver → same policy owner (7/8) | Separate requested and qualified actual route/model/effort | Provenance → all outputs/metrics; no retrospective substitution |
| Provider capability | versioned presets/probe/explicit override → adapter registry (8) | Capability evidence/version/expiry and prerequisites | Generated descriptor → every adapter/surface; unknown is unsupported for required features |
| Spend | provider admission/usage → core reservation owner (6) | Run/day reservation, price basis, charge/unknown settlement | Budget event → scheduler/UI; restart retains in-flight liabilities |
| Continuation | selected executor → API controller or native CLI adapter (8/30) | Adapter-private cache/session reference plus neutral task target | Neutral intent/result → controller; CLI never parses API continuation envelopes |
| Configuration revision | validated save/import/template → config authority (10) | Persisted revision, effective source overlay, secret refs | Config event → every consumer; restart re-resolves and exposes mismatch |
| Analytics denominators | canonical snapshot/evaluation → metrics owner (22) | Metric schema, population/filter/revision, time window and missing counts | TS/Python/report projections → surfaces; historical incompatible definitions not merged |
| Federation origin | peer export/import → federation owner (18) | Origin namespace, source artifact/evidence digest, import receipt and quarantine | Import event → local speculative view; replay dedup, local validation required |
| Temporal/causal state | observed events/hypotheses → temporal/causal owner (18) | Event time, observation time, sequence, hypotheses and evidence | Versioned temporal view → dream/tension/narrative; late events re-evaluate affected scope |
| Tension/remediation | adversarial detector/human/reviewer → tension owner (19) | Stable risk, branch, proposal, action and verified outcome | State change → Architect/Explorer/analytics; a remedy executed is not resolved |
| Narrative/lucid state | summaries/interactive inquiry → narrative/lucid owner (20) | Source revision/ancestry, human intent, session lease and outcome | Historical/current views → reader; exit/crash releases cognitive ownership |
| Computer Use state | API harness or native CLI → C17 execution owner (31) | Capability profile, target generation, grant, receipt granularity and effects | Semantic observations/status → Architect/C15; native handles expire, unknown effects are observed before retry |
| UI/datastore facts | UI parser, manual registry, DB inspector → existing registry/scanner (2/5) | Source kind and namespace, credential ref, schema fingerprint, observation time | Graph/readiness → Explorer/RAG/analytics; inaccessible DB is not dropped-empty schema |
| Delivery/post-office intent | committed events → existing event router/webhook service (17/25) | Durable outbox, delivery ID, retry/DLQ and consumer cursor | SDK/plugins/webhooks → external consumer; replay dedup, acknowledgement is not graph truth |

No module named post-office was found in current `src`, packages or extension sources. The requested intent maps to existing event routing/webhook delivery; it does not justify inventing another message authority. Preserve source and delivery ancestry, including when imported/derived documents later become scan inputs. Generated living docs and graph exports retain origin tags and cannot become independent corroboration of their own source graph.

## C15 route-by-route simulation

The same loop applies to all rows: controller constructs task request → core retrieval selects mandatory and ranked evidence at a revision → adapter acknowledges delivery → consequential actions revalidate authority/evidence → effect intent is durable before a controlled write → observed results reconcile through core publication → invalidation/dirty admission commits atomically → scheduler performs only funded relevant stages → next agent reads canonical receipts and fresh/limited knowledge. Compression preserves a compact mandatory anchor manifest and bounded refetch, not an unbounded neighborhood.

| Route | Concrete context/effect boundary | Staleness, failure and next-agent result |
|---|---|---|
| Browser Architect | `handleArchitectChat` controller uses C14 scope and C03 context; native tool loop or CLI bridge returns normalized results. Browser is a view. | Session reconnect reads the same execution; pending source effects cannot become completed slices; context refresh uses revision deltas. |
| VS Code Architect | Canonical `ChatPanel`/`ContextBuilder` and `architect-core` ports consume daemon contracts; extension host owns editor/transcript presentation and a durable host effect outbox. | No activation of quarantined architect-v2. Saved editor changes carry file hashes even without Git commit; refresh/human edits invalidate affected references. |
| Native API | Existing adapter owns provider envelopes, image/call IDs, refusal/incomplete/cancel; controller owns graph requirements and effects. | Optional provider continuation cannot be the only memory copy; losing it rebuilds a bounded pack from core. |
| Codex CLI | Host creates bounded prompt/config plus daemon MCP bridge; native CLI continuation stays private. Governed bridge effects, including `run_command`, require scoped effect intent and observation. | No reachable bridge means fail closed per ADR-217. Native Computer Use is separately qualified; bridge audit previews alone are not recovery receipts. |
| Copilot CLI | Same semantic host hooks through the existing distinct adapter and native event stream; do not reuse Codex flags or model rules. | Record actual support; CLI exit is not slice completion. Source/graph outcome survives transcript loss. |
| CLI/API/MCP managed commands | Authority derives scope and context obligations from effect metadata; read-only query results carry honest availability and receipt references. | Anonymous external agents are not attested. Protected commands cannot impersonate an active session; every accepted mutation still records its graph/effect receipt. |
| SDK/host/plugin managed execution | Existing host ports implement begin/context, governed effects and finish/reconcile; plugin contributions declare effects and support. | Conforming handlers use mediated writes; opaque in-process legacy plugins are visibly unattested, excluded from managed claims and blocked for tasks needing stronger guarantees. |
| Dreamer/targeted dreams | Scheduler creates role-specific context from affected region, tensions/history/ADRs; strategy registry emits speculative candidates with root cause. | Current evidence is rechecked before commit; no assertion or generation count proves validation. Required readiness remains, optional work may be budget-blocked. |
| Normalizer | Evidence/contradiction projection from same core snapshot, with ancestry and policy; local evidence rules own promotion. | Stale or repeated evidence cannot promote; cancellation retains committed decisions and remaining candidates. Next agent sees actual trust state. |
| Lucid/narrative/temporal/causal/adaptive work | Existing role owners request relevant evidence through core and publish only their allowed record classes. | Lucid lease exits safely; narration is derived; foreign/causal/AFE hypotheses remain advisory until separately verified. No recursive dream triggers from bookkeeping. |

A file watcher is a catch-up mechanism, not an assertion that every write was intercepted instantly. Controlled filesystem operations record intent first; shells declare their writable scope and are observed with before/after inventories, including untracked/renamed/deleted files. Unknown human/external edits are marked observed, never attributed to an agent without evidence. Buffer overflow persists a coarse dirty partition and reconciliation cursor; cannot acknowledge a dropped change as synchronized. Before a consequential patch, verify current target hashes even if the graph was fresh at initial retrieval.

The host outbox is bounded durable delivery of obligations, not a second graph. It is keyed by host/instance/execution/operation and drains idempotently to the daemon. Capacity exhaustion stops further managed effects. If mandatory authority cannot be established, mutation is blocked even if local outbox space exists. Generic sparse/Null-port behavior remains available only as explicitly unattested standalone operation; it cannot silently replace a shipped connected DreamGraph path. In a real outage, permitted targeted read-only source investigation reports degraded evidence and later refreshes; no connected managed path may treat that as normal completion of C15.

## Eight surfaces, one meaning

| Surface | Current divergence to remove | v14 source, cache and mutation contract |
|---|---|---|
| CLI | Direct command-specific formatting/settings and transport behavior | Generated schema/capability negotiation; current revision in machine output; commands return durable receipts, stream gaps re-read status |
| Browser Architect | Global selection/runtime and multiple lifecycle derivations | Session view state plus daemon C14/C13/C15 projections; same-revision summary/detail adoption; captured menu target, no optimistic verification |
| VS Code Architect | Local host graph/context/provider/autonomy implementations | Adapter over core semantics; host transcript/editor state stays local, operational plan/execution state stays daemon-owned; explicit standalone gap |
| Daemon | Per-module JSON state and process globals | Sole instance owner, shared commit/job/config/capability boundaries; recovery completes before readiness/admission |
| Explorer | Own snapshot/trust calculations and catch-all empty loaders | Core typed snapshot/etag, permission-filtered bounded graph, curated writes through existing mutation authority; stale visual state visibly stale |
| Dashboard | In-memory settings, schedule summaries and independent health labels | C07/C11/C14 and Slice 22 values, validated revision-bound commands, historical run snapshots; no UI-inferred readiness |
| Analytics Suite | Python reads mutable JSON with local defaults/unions | Core immutable export manifest or API snapshot; generated semantic schema and versioned denominator; read-only computation, no independent truth writer |
| MCP authority | Registry/classification/URI/result inconsistencies | Core-generated descriptors and stable family versions, shared resolver/errors/receipts; server is authority surface, not another graph implementation |

SDK/host plugins consume the same descriptors and scoped commands. Provider/CLI adapters translate native wire data only. A successful MCP delivery does not make arbitrary provider output authoritative; it must retain its evidence class and pass normal validation.

SSE is a bounded notification stream, not the durable event log. Each event identifies instance/epoch, commit/domain revision and sequence. Duplicate/old events are ignored; a gap/epoch change refetches one canonical snapshot. Old clients can read lossless negotiated projections; a client missing required state/authority semantics receives upgrade-required for mutations. Unknown, partial and unavailable stay distinct through every transport. Shared semantic agreement is checked at the same revision; independently refreshed clients may legitimately display different as-of revisions and must say so.

## Migration and rollback simulation

The new backend remains inactive until its compatibility and failure fixtures pass. Development writes only disposable v14 fixtures. Migration tooling belongs to Slice 26; earlier slices supply pure converters, validators and adapters for their records. Do not migrate a live instance opportunistically from a loader, package installation, a dashboard open or a schema mismatch.

| Phase | Durable state and permitted behavior | Failure/restart/rollback outcome |
|---|---|---|
| U0 inventory | v13.4 running data read-only; record instance, executable/config/source hashes, schema inventory and missing/unknown families | No mutation; unknown history remains unknown. Inspect known mismatches without inferring staleness from scan age. |
| U1 preview | Versioned migration manifest with exact conversions, ID map, unresolved scope, disk estimate, writer inventory and downgrade limits | Changed input invalidates preview; no migration without reviewed matching digest. |
| U2 fence/backup | Quiesce v13 scans/cognition/clients, verify process exit or safe drain, acquire exclusive instance owner; backup every included family and config, test restore on a copy | Failure releases no new writer; untouched instance can run old code after verifying no commit occurred. |
| U3 stage | Convert into separate staging directory on suitable storage; chunk cursors and checksums; old active stores remain intact/read-only | Resume exact matching stage or discard it; disk full/cancel cannot publish half a format. |
| U4 validate | Validate references/counts/trust/ancestry/source-state/receipt invariants and supported old/new reader outputs against staged manifest | Failed validation preserves artifacts and reasons; no reinterpretation of unknown legacy evidence as success. |
| U5 cutover | Revalidate fenced input, publish migration commit/active-format marker and receipt through core boundary | Before marker: old state. After marker: new committed state, finish recovery/validation; never guess by directory timestamps. |
| U6 restart | New pinned executable validates marker/schema, recovers journal/jobs/grants/outboxes before opening mutation admission | The supported launcher/owner fence prevents old binaries opening newly activated formats; do not assume unmodified v13 binaries themselves implement that protection. Incompatible clients get negotiated read/upgrade-required. Background paid work stays unadmitted until valid allocation/readiness. |
| U7 normal work | New writes append receipts/history at new revisions; original backup retained with provenance | Revert readers/config via adapters or forward repair. After new writes, restoring old backup is forbidden unless a tested reviewed reconciliation preserves those writes. |
| U8 failed recovery | Marker/stores disagree, rollback fails or evidence is corrupt | Instance recovery-required, writes fenced, explicit restore/forward-repair plan; no new empty graph or automatic full paid scan. |

| Family | Conversion and retained meaning | Unknown/compatibility treatment |
|---|---|---|
| Entity/relationship stores, UI, API, auxiliary and datastores | Typed ID/origin mappings, inline links and duplicate classification, human curation, semantic anchors | Ambiguous collisions quarantine aliases; unavailable datastore observation does not delete previously known schema |
| Scan/coverage/enrichment | Source hashes, scanner contract, scope/eligibility denominator, attempt and committed outcome | Missing baseline limits that scan operation only; retain later valid reconciled knowledge. Offer separately selected structural reconstruction when needed. Fallback never becomes historical LLM success |
| Evidence/trust/candidates/history | Preserve ancestry, review decisions, score meaning, contradictions, rejection/tombstones | No fabricated independent evidence or backdated verification; old thresholds retain their version |
| Plans/discipline/ADRs | Exact IDs and authored bytes, explicit checkpoints and approval/definition hashes; applicability inventory | Legacy prose is a claim, not typed success; imported or ambiguous ADR scope stays review-needed |
| Config/credentials/instance identity | Validated key migration, original effective values, deployment overrides, opaque secret references | Invalid/newer configs block affected activation; no template reset or new paid/full-access/remote grant |
| Schedules/bootstrap/event state | Definition IDs/revisions, old UTC intent, known runs, skipped/unknown claims and action versions | Active pre-upgrade attempts become recovery-required; no replay of missing occurrence history or model-fingerprint-triggered spend |
| Receipts/jobs/session/continuation | Known effects, reservations, durable scope and outstanding obligations | Old records lacking receipts stay unknown; all active leases/native handles expire, re-probe/re-authorize before resume |
| Dirty/digestion state | Preserve generation/stage/cause records where present; coarse unresolved markers otherwise | Timestamps/Git heads alone cannot establish clean working-tree state; no invented processed generation |
| Analytics/indexes/cache | Preserve raw history and denominator versions; rebuild indexes against canonical revision | Old report values remain historical; no silent conversion to new accuracy/readiness metrics |
| Federation/temporal/causal | Retain remote namespace, artifact hash, event and observation time, local validation | Duplicate imports deduplicate, unknown origin/time remains unknown; no relabeling foreign hypotheses as local facts |
| Plugin namespaced state and webhook delivery | Keep plugin/state schema revisions and event/operation/DLQ identity | Missing plugin blocks that action only; no re-send of unknown external effect; retained state survives unload |
| Computer Use | No implied historical desktop grant; retain any recognized observation/receipt metadata only | Upgrade default disabled, all old handles/leases invalid; native API/CLI capabilities qualified anew |

Installer work in Slice 28 stages versioned executable/assets and verifies manifests before switching launchers. Running daemons stay pinned to the files they loaded; no lazy import of a half-replaced shared `dist`. `install.ps1 -Force` may replace the installation candidate but cannot bypass instance data migration, review, or writer fencing. Restart each instance separately with reported executable/data schema versions. The Windows installer, Unix installer, CLI, daemon/MCP, browser/VS Code Architect, Explorer, dashboard, analytics, SDK/host/token-economy packages and optional worker artifacts derive the same product version. Schema versions remain independent.

## Compound acceptance walkthroughs

These are **specified outcomes, mentally simulated, not tests reported as passed**. XS references compose existing AT/PL/GE/UX/CU and schedule cases; they do not replace them. Schedule cases receive stable SC01–SC13 IDs in C11. Each implementation result must include fixture/source/schema/config hashes, route versions, fault boundary, expected/actual durable records and the independently read-back result.

| Case | Combined execution | Required deterministic outcome and evidence |
|---|---|---|
| XS01 | Early retrieval/adapter slice reaches its exit before C14/C17 consumers exist | Foundation fixture evidence closes only that slice's owned contract; integration obligations remain open in 25/27/31. Reopened provider hash invalidates dependent evidence. No circular prerequisite. AT01–06/PL06. |
| XS02 | Source scan snapshot + manual curation + dream commit + second process | One owner serializes deltas; every graph change advances graph revision independently of scan hash. Reader sees one committed snapshot; second writer denied. No shared-lock upgrade. AT05/GE04. |
| XS03 | Crash/disk-full before marker, after marker, during cleanup; lose reply and retry | Pre-marker predecessor restored or recovery-required; post-marker committed receipt recovered, never rolled back as uncommitted. Duplicate key returns same result; retired key refuses blind replay. AT05/PL11/GE07. |
| XS04 | Schedule times out while provider/plugin still runs; another schedule becomes due | Attempt fence rejects late new writes; running resource stays fenced until stopped. One timeout owner, late usage recorded, no overlapping mutator or duplicate terminal success. GE11/SC09/CU05. |
| XS05 | Readiness probe, scan and scheduled dream compete; cancel one across UTC midnight | All calls reserve before dispatch. Original-day liability and run cap survive restart/cancel; new-day calls need new allocation. Zero budget makes no paid probe. GE11/SC10. |
| XS06 | Two dashboard edits, template reset, external env edit and profile change during a run | Config CAS prevents overwrite; protected fields retained; in-flight policy immutable, live revocation restrictive. Effective/persisted/restart-required shown identically; no credentials in evidence. SC02/GE11/CU13. |
| XS07 | Two clients/two plans, stale menu, wrong session stop, browser refresh and SSE gap | Commands keep captured ID/revision/principal; wrong control rejected. Reattach snapshot/event watermark converges; selected plan never changes another execution. PL10/12/14/UX02/03/09. |
| XS08 | Edit slice acceptance while verifying; verification passes against old definition; export fails | Old result retained but cannot verify new definition without reviewed carry-forward. Typed current/blocked/next remains consistent. Export debt visible and idempotent, no recursive self-verification. PL04/07/13/GE14. |
| XS09 | Agent gets context, edits source, daemon crashes before reconcile; restart, due cognition, budget exhausted, second Architect connects | Intent/outbox recovers source hashes; structural reconciliation commits facts+invalidation+dirty G. Optional paid stages remain blocked. Required effect reconciliation keeps slice verifying until committed; then optional cognition alone does not block verification. Next agent sees current facts, stale derived claims and pending debt. GE07/10/11/14/15/PL11/SC08. |
| XS10 | CLI shell or native editor writes untracked files, plugin fails and transcript is deleted | Host observes declared writable scope, persists material-change receipts/unknowns and reconciles. Unmediated plugin cannot claim compliant completion. Next independent agent recovers actual effects, not just model prose. GE05/06/07/15/PL16. |
| XS11 | G runs, G+1 edit arrives, duplicate event, overlapping scheduled/targeted/lucid work | Stable cause/stage keys deduplicate; G only clears its coverage. New debt remains; engine-mode lease prevents conflicting cognition, unrelated reads continue. No self-trigger loop or paid full-graph fallback. GE09–13/SC06/09. |
| XS12 | DST repeated/skipped hour, definition edit/archive, missed run, plugin action upgrade | Same occurrence evaluator/key in preview and dispatch. At most declared occurrence policy; history uses old snapshot; new action version needs revalidation. Pause differs from cancel. SC01/05–09/11/12. |
| XS13 | Corrupt one graph store/index, optional datastore never configured, old client pages across restart | Required corrupt data unavailable; known optional absence explicitly empty; index rebuilt/bounded read. Cursor expires rather than mixing snapshots. Partial counts do not look complete/healthy. AT04/06/PL12. |
| XS14 | Strong model refuses; capability override wrong; old cold-start rule would promote weak evidence | No silent model/endpoint/retention escalation; deterministic result only if declared equivalent for that action, with changed limits explicit. Weak evidence remains hypothesis regardless of bootstrap/model. AT03/06/GE11/12/CU08/09. |
| XS15 | Federation replay carries a narrative of the same claim, unknown historical time and an unrelated accepted ADR | Origin/ancestry dedup retains one root; local validation and ADR applicability required. No confidence gain from circulation, no invented timestamp or unrelated rule takeover. AT03/GE12/13. |
| XS16 | Explorer, RAG, Dashboard, CLI/MCP and Python analytics inspect during mutation/history export | Same-revision semantic questions agree; older snapshots label as-of. Generated documents do not corroborate themselves; denominator/schema/time differ explicitly. AT02/03/04/06/PL16. |
| XS17 | Worker/plugin disappearance or native CLI lacks inner-action scope/stop while outer tool is available | Required route disabled/blocked with remedy; no fake per-action receipts or silent harness substitution. Host remains responsive; unknown external effects journaled, independent stop proven for advertised control. CU01/04–08/10/11/24. |
| XS18 | v13.4 conversion of all families, unknown baseline, disk-full/cancel/stale preview | U0–U8 has one active format; old history preserved; no stage published on failed validation, no paid reconstruction. Existing clients either negotiated read or explicit upgrade-required. AT05/06/PL13. |
| XS19 | Install new binaries while old daemon remains; cut over data, accept new work, request rollback | Running files stay pinned; incompatible writer refuses. After new receipts exist, only preserving forward repair/replay is valid; no old backup overwrite. Exact packaged version/install smoke in 28 follows feature gates in 27. |
| XS20 | Computer observation, moving target, permission revoke/stop, changed file, lost CLI result | Fresh target/generation checked; stale action rejected. Native execution retained, committed/unknown effects distinguished, C15 receipt and C14 verification applied. UI click or CLI exit cannot complete a slice. CU03–07/10–12/21–24. |

### XS21 — One initial scan, continuously maintained graph

Start from a full scan, advance the fake clock by months, then apply MCP/Architect source, plan, graph, rename/delete and saved-uncommitted changes with successful reconciliation. All eight surfaces and a fresh agent still report the covered facts current; raw commits-since-scan, dirty Git files, old scan/enrichment timestamps and a paused optional dream job cause no stale badge or full-scan recommendation. Unchanged evidence retains its status. Then interrupt one managed reconciliation: only that scope is pending/limited until its receipt commits. Introduce a detected external change and retain an unrelated valid region; offer scoped reconciliation without degrading the whole graph. Finally, let the user declare substantial changes outside DreamGraph and explicitly choose an inclusive scan. Missing historic baseline remains a scan capability limitation, not a retroactive rejection of later reconciled facts. Read last_graph_mutation_at through MCP/API and every surface, then inject failed/rolled-back, duplicate and no-op writes: its value advances only for actual committed graph changes. Commit an unrelated dream while another scope awaits source reconciliation; its newer timestamp does not clear the gap. Advance clock without changes and prove no age-based staleness. Preserve unknown legacy timestamps. Independently expire a transient GUI observation and prove that its kind-specific rule does not expire the source graph. Maps AT06, GE04/07/14, SC10, C01/C03/C12/C15 and Slices 2/3/16/17/22–26/27. Required future evidence; not executed here.

### Failure disposition index

Daemon/worker crash, partial write and disk failure use XS03/09/18; lost reply/duplicate request use XS03/07; stale client and concurrent human edit use XS02/07/08/10; browser refresh/disconnected Architect use XS07/09; provider timeout/refusal/capability mismatch use XS04/14; budget exhaustion/in-flight cancel use XS04/05/09; mid-job config change uses XS06; incompatible schema/client uses XS13/18/19; graph unavailable/stale/missing baseline/corrupt index uses XS09/13/18; plugin failure uses XS10/17; scheduler restart/duplicate events use XS11/12; federation replay uses XS15; Computer Use worker disappearance/stale observation uses XS17/20. Each references the durable state and recovery boundary above; none is specified merely as “retry”.

## ADR applicability and required amendments

The [read-only evidence](execution-adr-evidence.json) includes the accepted records themselves, including newly relevant ADR-238/239/240. Workspace generated ADR Markdown is not the authority. Stored accepted status is not proof that a generic/imported decision is about this product: ADR-016, for example, describes relational transactional storage while current canonical DreamGraph storage is JSON. Slice 0 records repository/entity scope, decision lineage, source anchors and conflicts; unrelated or ambiguous records remain visible but cannot silently constrain this release. This pass changes no stored status.

| Decision group | Disposition for implementation |
|---|---|
| 001/002/045/046/087/088/122/124/130/134/136/137/193/196/197/205/212–214/224–227/230/234/235 | Retain applicable lifecycle, evidence, snapshot/mutation, plugin trust, metrics and review boundaries. Implement new records through those owners; references to implementation in an ADR still require current source verification. |
| 010/013/014 | Retain semantic legacy IDs and explicit alias/supersession mapping; typed instance/kind identity resolves collisions without mass renaming by display text. Review extensions in Slice 2. |
| 095 | Narrow implementation to its actual optional/bootstrap absence intent. Missing required/corrupt/inaccessible state must be unavailable; record clarification rather than extending empty fallback to all errors. |
| 096 | Required proposed amendment in 15: cold-start can relax exploration/retention, not evidence independence or factual promotion. Preserve explicit exit policy/history; count/time cannot manufacture source evidence. |
| 097/129 | Preserve curated mandatory evidence and adaptive useful delivery. Clarify that operator/provider resource ceilings are real, explicit insufficiency is valid, and no ceiling permits clipped JSON or lost required anchors. Foundation fixtures in 3, final usefulness in 27. |
| 098/203 | Required proposed amendments in 6/7/8/17: readiness/fingerprint changes use admission; role-selected explicit provider/retention wins over implicit connected-model reuse; deterministic fallback is declared and cannot satisfy an unmet required LLM/vision/quality capability. |
| 145/148/149/150/152/155/163–178 | Reconcile historical v2 requirements under 192/211 before reusing them. No resurrection of quarantined code, fixed cloud ceiling, independent tool catalog, silent Null-port fallback or autonomous graph-write-on-every-read rule. Preserve useful pure ports and bounded autonomy via adapters. |
| 003/004/192/206/208/209/211/216/218/219 | Required scoped amendments in 11/21/25: session-owned selection/runtime; typed operational state rather than prose checkpoint inference; host-owned VS Code transcript/view state versus daemon execution authority. Preserve canonical ChatPanel and companion status; no frontend cutover is required. |
| 151/152/153/240 | C13 browser Manual/Supervised/Autonomous remains the canonical continuation policy. Existing VS Code cautious/conscientious/eager/autonomous names map through explicit profiles, not string equality or silent authority widening. Cautious→Manual, conscientious→Supervised, eager→Supervised with its explicit already-authorized within-task continuation, autonomous→Autonomous. Retain displayed legacy label and effective canonical policy/budgets. Review exact legacy carry-forward before activation; no automatic permission expansion. Intermediate completion never terminates a still-authorized autonomous target by itself. |
| 165/173/177/193/207 | Required proposed C15 amendment: incidental context telemetry may be best effort; material effects/receipts cannot be. Standalone sparse ports are unattested, not the connected default. Preserve permanent Markdown history and evidence ancestry, without self-triggering graph writes. |
| 217/238/239/240 | Preserve bridge authority, session-scoped discovery cache, bounded audit previews, typed timeout owners and native CLI continuation. C15 durable effect receipts are separate from lossy preview logs. C17 needs the narrow reviewed native Computer Use exception; it does not authorize native repository-shell bypass. |
| 236/237 | Required proposed amendment in 2/5: general publication marker/revisions and retained idempotency receipts extend scan-only publication; committed recovery rolls forward rather than restoring a predecessor after a proven commit. Preserve one writer/shared coherent readers and failure fencing. |

These are concrete proposed amendments with owners and evidence gates. The maintainer need only review the applicable scoped amendments at slice entry; no previously resolved Ashoka direction is reopened. If a reviewed binding ADR is found to require a different authority or incompatible behavior, the affected cutover blocks until that exact conflict is adjudicated. Do not use guessed applicability to silently repeal a decision.

## Closure assessment and deliberately bounded scope

Architecture closure is conditional on the specified entry reviews, not a claim of implementation. No unresolved choice between incompatible architectures is intentionally left to Sol: owners, publication/recovery model, execution identity, route obligations, migration stages and composed evidence gates are specified. Runtime engineering, library choice within those boundaries, fixtures and actual performance remain work for the executor.

Remaining execution inputs: assign people to the named ownership/review roles; approve scoped ADR amendments; freeze the two project fixture labels and measured tolerances before tuning; provide specific budgets/credentials only for opted-in model evidence; obtain actual platform/native-CLI qualification. None permits inventing unsupported control or claiming tests passed. If paid evaluation is not authorized and no suitable local model is available, the comparative release claim stays unverified and the relevant final gate stays open; implementation can proceed offline.

Deliberately deferred: a wholesale database replacement; broad untrusted-plugin sandbox platform; arbitrary generated-code Computer Use; personal-profile attachment and remote/cloud desktop workers until separately qualified; universal control of every OS/toolkit; transactional rollback of irreversible external effects. Keep existing trusted plugins available with honest scope, but do not count unattested work as compliant managed execution. Platform omissions require the explicit reviewed support disposition already defined in C17. No default shipped managed agent route may be waived out of C15 to obtain a green release.

The current v13.4 runtime can still disagree across surfaces and bypass parts of the planned loop; the plan never labels those defects fixed. In the specified v14 architecture, authoritative questions at the same revision have one answer, and managed material effects cannot close without reconciliation. External/unattested clients and physical/external effects have explicit limits. Upgrade and recovery have named states, including recovery-required when evidence is insufficient. The final report must distinguish this design closure from future conformance evidence.
