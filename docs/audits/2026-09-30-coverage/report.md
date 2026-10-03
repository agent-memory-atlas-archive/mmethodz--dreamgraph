# DreamGraph coverage, correctness and engine alignment audit

Date: 2026-09-30  
Version: 13.4.0  
Baseline commit: `563d10c8109cbe3388cde71168bdcff149c96e0f` plus existing uncommitted Architect UI/documentation changes.  
Outcome: audit and proposed plan; no product fixes, graph repair, paid model evaluation or daemon restart performed.

## Assessment

DreamGraph has substantial working infrastructure and a strong test foundation, but the highest priority is aligning its subsystems around trustworthy, complete and affordable graph use. The immediate defects are at the boundaries: graph data can become invalid JSON, retrieval omits entire entity families, enrichment acknowledgment can precede durable success, and configuration/session projections do not always match their underlying authority.

The project should improve those boundaries before increasing autonomous graph growth. More candidates, larger models and attractive graph views do not by themselves establish that an agent receives the right evidence or that the evidence stays correct. Existing evidence ledgers, trust states, lifecycle projections, provenance gates, scan ledgers and provider adapters should be extended and connected, not replaced with another parallel subsystem.

The [governed improvement plan](../../../plans/graph-trust-and-agent-effectiveness.md) contains 29 implementation slices with dependencies, acceptance evidence and rollback requirements. It remains **draft**: this audit is not an implementation approval or a claim that those slices are complete.

## Vision used as the audit standard

The [README](../../../README.md) describes governed architectural cognition grounded in code, ADRs, workflows, tests, runtime evidence and human review. [What is DreamGraph](../../../guide/01-what-is-dreamgraph.md) describes persistent memory and separate fact/dream layers. The [cognitive engine description](../../cognitive-engine.md) requires speculation to stay separate from fact, with evidence-backed promotion, decay and visible tensions. [Architect reporting](../../architect-reporting.md) emphasizes understandable evidence and recovery.

This audit translates those goals into observable obligations: agents can retrieve all relevant entity families; facts have provenance and freshness; updates are durable and preserve review; speculative confidence is not confused with empirical truth; spending and background activity are bounded; users can understand, correct, stop and resume the system. ADR-002, ADR-045, ADR-097, ADR-123 and ADR-203 provide existing governance, semantic-anchor, context, catalog and routing constraints. Proposed decisions must go through the existing process rather than being marked accepted by this report.

## What was run and what the numbers mean

| Check | Result | Scope and limitation |
|---|---|---|
| Root Vitest with V8 source coverage | 97 files; 911 passed, 2 skipped | Repository test suite; not all runtime paths |
| Root Vitest after restoring lockfile dependencies | 97 files; 911 passed, 2 skipped | Confirms temporary instrumentation did not remain necessary |
| VS Code extension tests | 482 passed | Node tests from the extension working directory; browser/IDE manual flows separate |
| Root production build | Passed | Includes server/packages and Explorer bundle; large-chunk warning remains |
| Extension production build | Passed | Isolation lint, webview, TypeScript, extension, bridge and vendor build |
| Live MCP discovery | 93 tools, 30 resources | Running web64-react daemon, version 13.4.0 |
| Focused live MCP/resource probes | 12 completed | Read-only; reproduced JSON/URI/budget defects; not 93 end-to-end tool tests |
| Offline own-instance RAG probes | 3 completed | Stored DreamGraph data, no daemon or provider call |
| Structural strategy boundary probes | 18 completed | Nine strategies on empty/populated fixtures; not quality/precision evaluation |
| Python analytics | 13 modules exited 0 with JSON | Legacy own-instance snapshot; smoke tests, not independent metric oracles |
| Invalid dashboard configuration probe | Reproduced | Isolated child/server, no live settings changed |
| Existing benchmark scripts | Executed; synthetic limitations found | Not real cost or transport performance evidence |

Root instrumented coverage is **41.10% lines/statements, 66.79% functions, 67.48% branches** (32,157/78,235 lines). Do not call this total project coverage: extension tests run separately, inline browser templates affect line accounting, and package imports can resolve built JavaScript instead of instrumented TypeScript. In particular, zero source attribution for token-economy does not prove its behavior is wholly untested. Branch percentages on import-only files are also misleading.

Strengths include scanner coverage (89.67% lines / 96.84% functions), existing enrichment recovery tests, extensive Architect and extension tests, explicit provenance checks, and model/provider abstraction. Weak areas include cognitive execution (26.05% lines), tools (34.89%), CLI (13.30%), daemon server (25.52%), discipline source (0%) and directly exercised strategy functions (0% in the root run). See the [per-file coverage](coverage-summary.json), [complete tool matrix](mcp-tool-matrix.md), [inventory](inventory.json), and [verification record](verification.json).

The own DreamGraph instance was offline at the start, so the historical analytics/RAG baseline uses its August 21 stores and the initial live behavior probes used the already running **web64-react** daemon. The user subsequently started DreamGraph on port 8010; MCP discovery confirmed the correct repository and version 13.4.0, and its Architect registry discovered this plan. These two evidence populations are never combined into one quality score. No full paid scan, live dreaming/normalization, destructive graph tool, database mutation, global install or live repair was run. The later governance registration persisted only an audit session, delta evidence and an unapproved draft plan. A complete behavioral certification would require the isolated and opt-in tests listed in the plan; this report explicitly identifies those gaps.

## Findings

Priority P1 means correctness, trust, cost control or governance work that should precede expansion; P2 means a material improvement sequenced after its dependencies. Reproduced findings have observed outputs. Source-confirmed findings identify concrete control flow; concurrency and security impact remain unexercised where stated. Design gaps are proposals, not proven failures.

### F01 — Large graph resources cease to be JSON

**P1 · Reproduced.** system://features and query_resource returned clipped, invalid JSON. The resource still advertises application/json and the tool reports isError=false. Raw head/tail clipping discards the middle without a cursor. Agents cannot reliably reconstruct the graph or distinguish a complete response.

Evidence anchors: [`src/utils/tool-output.ts`](../../../src/utils/tool-output.ts), [`src/resources/register.ts`](../../../src/resources/register.ts), [`src/tools/query-resource.ts`](../../../src/tools/query-resource.ts).

Recommended outcome: Replace JSON clipping with bounded structured pages, continuation cursors, stable ordering and explicit completeness. Keep optional human previews separate from machine data.

### F02 — The same resource URI has two meanings

**P1 · Reproduced.** Reading system://capabilities returns the runtime capability summary; query_resource maps it to capability entities in capabilities.json. An advertised dream://status resource is rejected by query_resource with INVALID_URI, again without MCP isError=true. The generic query surface does not implement the advertised resource contract.

Evidence anchors: [`src/resources/register.ts`](../../../src/resources/register.ts), [`src/tools/query-resource.ts`](../../../src/tools/query-resource.ts).

Recommended outcome: Use one URI resolver/catalog for resources, tools and client help. Version or alias the conflicting capability URI and distinguish invalid requests from a valid empty result.

### F03 — Agent retrieval sees only part of the graph

**P1 · Reproduced + source.** graph-rag loads features, workflows and data_model; it does not index capabilities, datastores, UI or auxiliary entities as first-class retrieval targets. Traversal uses validated_edges rather than the complete set of source-backed inline links. On the stored DreamGraph graph an exact feature ID was retrieved; existing capability_codebase_architecture_memory and dashboard_view IDs returned no entities. A richer Explorer does not establish richer agent access.

Evidence anchors: [`src/cognitive/graph-rag.ts`](../../../src/cognitive/graph-rag.ts), [`src/cognitive/strategies/_shared.ts`](../../../src/cognitive/strategies/_shared.ts), [`src/explorer`](../../../src/explorer).

Recommended outcome: Introduce a shared typed, revisioned graph read model with all canonical entity families, fact links, separately labeled validated insights, ADR bindings and provenance. Migrate consumers through adapters rather than rewriting the entire engine.

### F04 — Retrieval exceeds its stated budget

**P1 · Reproduced + source.** Requested context budgets of 100, 500 and 2000 returned reported token counts of 132, 535 and 2039 on the live graph. Headers, separators and truncation notices are added outside section allocations; partial-section counts can count a header as an edge. The full result envelope is larger again.

Evidence anchors: [`src/cognitive/graph-rag.ts`](../../../src/cognitive/graph-rag.ts).

Recommended outcome: Define context-versus-envelope budgeting explicitly, account for every emitted field and report omitted counts accurately. Never slice a fact or provenance record into an unidentifiable fragment.

### F05 — Retrieval needs an index and a quality oracle

**P2 · Measured + source.** Three live retrievals took approximately 2.9–3.1 seconds; offline exact-ID probes took 2.4–2.9 seconds. These are single-machine observations, not latency percentiles. queryTfIdf repeatedly computes document frequency and builds the index per request; tokenization removes non-ASCII text. No grounded recall/answer-quality score was established by this audit.

Evidence anchors: [`src/cognitive/graph-rag.ts`](../../../src/cognitive/graph-rag.ts).

Recommended outcome: Cache indexes by graph revision, precompute document frequencies, preserve Unicode/symbol lookup and evaluate relevant evidence recall, abstention, provenance, latency and tokens on a labeled task set.

### F06 — Enrichment completion is ahead of durable graph success

**P1 · Source-confirmed ordering; concurrency risk untested.** recordEnrichmentOutcome and total_enriched advance before batch store writes. Store-write exceptions append errors, but execution proceeds to checkpoint persistence and a progress message saying persisted. An interruption can therefore leave enriched checkpoint entries without their graph update. Full-store replacement from an earlier snapshot also creates a lost-update risk with intervening curation; atomic file replacement alone does not protect the entire read/modify/write operation.

Evidence anchors: [`src/tools/enrich-parser-nodes.ts`](../../../src/tools/enrich-parser-nodes.ts), [`src/tools/enrichment-state.ts`](../../../src/tools/enrichment-state.ts), [`src/utils/atomic-write.ts`](../../../src/utils/atomic-write.ts), [`src/graph`](../../../src/graph).

Recommended outcome: Commit entity deltas against a graph revision, advance checkpoint success only after durable commit, and fault-inject write failure, cancellation, restart and concurrent curation. Distinguish attempted, generated, committed, fallback and failed counts.

### F07 — Enrichment cost is not an end-to-end job contract

**P1 · Gap; existing protections acknowledged.** Max hops, node/batch limits, caches, typed failure states and retryable fallback handling already exist. They do not establish a job-wide spend ceiling or make fallback quality and cumulative consumption clear to the operator. Reducing hops controls context breadth but does not guarantee bounded calls, reasoning or recovery cost. This audit did not run another paid scan.

Evidence anchors: [`src/tools/enrich-parser-nodes.ts`](../../../src/tools/enrich-parser-nodes.ts), [`src/tools/enrichment-state.ts`](../../../src/tools/enrichment-state.ts), [`src/tools/scan-project.ts`](../../../src/tools/scan-project.ts), [`src/cognitive/llm.ts`](../../../src/cognitive/llm.ts).

Recommended outcome: Add preflight estimates, input/output/reasoning limits, call/retry and job caps, effective route disclosure, cancellation/resume, cause-grouped fallback reporting and budget-aware escalation. Unknown pricing must remain unknown rather than zero.

### F08 — reflective is accepted but has no dream execution branch

**P1 · Source-confirmed.** The dream_cycle strategy schema accepts reflective. dreamer has no corresponding execution branch and excludes it from allStrategies. Selecting a documented strategy should not silently produce an empty strategy run while appearing successful.

Evidence anchors: [`src/cognitive/register.ts`](../../../src/cognitive/register.ts), [`src/cognitive/dreamer.ts`](../../../src/cognitive/dreamer.ts).

Recommended outcome: Implement a bounded, evidence-backed reflective strategy or reject/retire it explicitly. Derive advertised strategy choices and execution dispatch from one registry.

### F09 — Strategy adaptation rewards generation before usefulness

**P2 · Source-confirmed.** Strategy history lives in a process-local Map; yield is recorded before deduplication. This can reward repeated candidates instead of novel, validated and useful evidence, and resets across restart. Number(env) || default prevents explicit zero budget fractions. Per-kind node/edge limits and rounding also need a documented total-budget contract.

Evidence anchors: [`src/cognitive/dreamer.ts`](../../../src/cognitive/dreamer.ts).

Recommended outcome: Persist per-strategy observations after deduplication, measure novelty, cost, independent validation and downstream utility, reserve bounded exploration, and enforce deterministic allocation including zero and tiny budgets.

### F10 — Promotion confidence is not measured factual accuracy

**P1 · Design/evaluation gap.** The normalizer already has evidence-count gates, endpoint checks and provenance protections; these must be retained. Structural similarity, shared repository, recurrence and keywords can nevertheless be correlated signals rather than independent truth. Metacognition names operational ratios precision/recall without a labeled factual ground truth. Existing trust-state and evidence-ledger modules are useful foundations, not missing features.

Evidence anchors: [`src/cognitive/normalizer.ts`](../../../src/cognitive/normalizer.ts), [`src/cognitive/metacognition.ts`](../../../src/cognitive/metacognition.ts), [`src/cognitive/evidence-ledger.ts`](../../../src/cognitive/evidence-ledger.ts), [`src/cognitive/trust-state.ts`](../../../src/cognitive/trust-state.ts), [`src/cognitive/calibration-evaluation.ts`](../../../src/cognitive/calibration-evaluation.ts).

Recommended outcome: Separate operational yield from evaluated accuracy, track evidence independence and source freshness, calibrate on labeled positive/negative cases, and preserve uncertainty and explicit human review across every projection.

### F11 — Healthy can conceal critical graph debt

**P1 · Reproduced.** The live health result reported healthy (0.7115) while listing critical unenriched debt: 132 of 413 eligible entities remained unenriched. It also reported 156 orphan features, 169 disconnected clusters and 663 machine-name leakage observations. Historical DreamGraph analytics called cognitive load calm despite 18,680 pending candidates. A status must explain workload, freshness and usefulness separately.

Evidence anchors: [`src/tools/graph-health.ts`](../../../src/tools/graph-health.ts), [`python/analytics/cognitive_load.py`](../../../python/analytics/cognitive_load.py), [`src/server/dashboard.ts`](../../../src/server/dashboard.ts).

Recommended outcome: Make critical integrity/readiness failures visible independently of a weighted score. Use common, revision-bound denominators and explicit stale/unknown states throughout CLI, analytics, dashboard and Architect.

### F12 — Dashboard accepts invalid event settings

**P1 · Reproduced in isolated process.** Submitting a nonnumeric tension threshold and negative rate/cooldown values returned HTTP 303 to /config?saved=events. The in-memory threshold became NaN; negative values were retained. This was reproduced in an isolated server, not the user daemon.

Evidence anchors: [`src/server/dashboard.ts`](../../../src/server/dashboard.ts), [`src/cognitive/event-router.ts`](../../../src/cognitive/event-router.ts).

Recommended outcome: Validate a complete candidate configuration against a shared finite/range/cross-field schema, reject atomically with field errors, and never display saved after invalid input.

### F13 — Configuration persistence differs by section

**P1 · Source-confirmed.** Dashboard LLM changes have an environment persistence path, while scheduler/event/narrative update functions merge process-local values. A common saved UI does not communicate the difference or establish restart durability.

Evidence anchors: [`src/server/dashboard.ts`](../../../src/server/dashboard.ts), [`src/cognitive/scheduler.ts`](../../../src/cognitive/scheduler.ts), [`src/cognitive/event-router.ts`](../../../src/cognitive/event-router.ts), [`src/cognitive/narrator.ts`](../../../src/cognitive/narrator.ts).

Recommended outcome: Define authoritative persisted configuration with precedence, revisions and restart behavior. Show requested/effective/source values and verify save/restart/readback across every section and client.

### F14 — Architect execution ownership is broader than an MCP session

**P1 · Source-confirmed shared state; overlap not exercised.** The daemon supports multiple MCP clients, each with its own server/transport. Browser Architect nevertheless has a module-global active session ID and active execution control; selected-plan state also uses process environment. Chat can replace the active control used by stop. Concurrent browser/chat ownership needs explicit testing and isolation; this is not a claim that the daemon only supports one connection.

Evidence anchors: [`src/index.ts`](../../../src/index.ts), [`src/architect/routes.ts`](../../../src/architect/routes.ts).

Recommended outcome: Bind plan selection, history, cancellation, tool continuation and provider state to session and execution IDs. Test two overlapping clients, reconnect and cancellation without paying for models.

### F15 — Plan projection can lose blocked/verifying intent

**P1 · Source-confirmed.** derivePlanLifecycle handles archived, superseded, completed and several ready/draft states, but does not preserve blocked or verifying. Once an implementation checkpoint exists, incomplete work projects as implementing. Audit entries with generic recorded status also count as implementation checkpoints.

Evidence anchors: [`src/architect/plan-registry.ts`](../../../src/architect/plan-registry.ts).

Recommended outcome: Define and test legal lifecycle transitions and audit-only checkpoints. Preserve blocked/verification gates across browser, extension, daemon actions and restart; do not infer completion solely from optimistic prose.

### F16 — MCP contracts lack consistent machine guidance

**P2 · Inventory + reproduced error contract.** All 93 live tools were located in source; none advertises MCP annotations. Error bodies and resource semantics vary. There are 52 tool names with no literal references in the inspected test files, which is a discovery signal only and not proof of no indirect testing.

Evidence anchors: [`src/tools`](../../../src/tools), [`src/cognitive/register.ts`](../../../src/cognitive/register.ts), [`src/discipline`](../../../src/discipline), [`src/resources/register.ts`](../../../src/resources/register.ts).

Recommended outcome: Generate a versioned catalog with schemas, side effects, read/write and idempotency hints, budgets and error taxonomy. Test every registered callback through transport with isolated fixtures and require discipline-manifest parity.

### F17 — DreamGraph own graph needs a governed integrity refresh

**P1 · Historical data reproduced.** The DreamGraph instance was offline, with canonical stores last modified August 21, about 39 days before this audit. Its analytics found 615 degree-zero entities among 1,076 unique IDs and 237 dangling links. Twenty-three IDs collide across canonical stores. scan_state.json and enrichment_state.json were absent. These observations describe this legacy snapshot, not the current scanner output or every managed project.

Evidence anchors: [`python/analytics/orphan_pressure.py`](../../../python/analytics/orphan_pressure.py), [`src/tools/scan-state.ts`](../../../src/tools/scan-state.ts), [`src/graph`](../../../src/graph), [`src/tools/graph-health.ts`](../../../src/tools/graph-health.ts).

Recommended outcome: Create a backup and dry-run repair/migration report, disambiguate typed identities, preserve curation and provenance, establish a baseline, and reconcile incrementally with rollback and explicit cost approval before paid enrichment.

### F18 — Passing tests leave important execution paths uncovered

**P1 · Measured coverage limitation.** Root coverage reports zero executed strategy functions in all ten strategy implementation modules, zero query-resource source coverage and zero cognitive registration source coverage. Supplemental strategy probes help only with boundary invariants. The repository has CodeQL but no ordinary build/test workflow. Browser interaction, multi-session races and provider-backed quality were not comprehensively exercised.

Evidence anchors: [`vitest.config.ts`](../../../vitest.config.ts), [`.github/workflows/codeql.yml`](../../../.github/workflows/codeql.yml), [`tests`](../../../tests), [`extensions/vscode/src/test`](../../../extensions/vscode/src/test).

Recommended outcome: Establish meaningful contract, state-machine, fault-injection, provider, transport and browser coverage with explicit exclusions and per-area gates. Preserve fast deterministic tests; do not make a global percentage a substitute for behavior.

### F19 — Benchmark labels exceed what the default workload measures

**P1 · Source-confirmed benchmark limitation.** benchmark-scan-mcp measures synthetic stringify/hash work under transport labels rather than actual MCP transports. The token-economy benchmark simulates tokens, duration and outputs by default; dryRun=false does not establish a real provider run. These fixtures can test reporting but cannot substantiate real transport speed or credit savings.

Evidence anchors: [`scripts/benchmark-scan-mcp.mjs`](../../../scripts/benchmark-scan-mcp.mjs), [`scripts/benchmark-token-economy.mjs`](../../../scripts/benchmark-token-economy.mjs).

Recommended outcome: Label synthetic fixtures explicitly; add real isolated transport and opt-in provider runners, measured usage, task-quality checks, environment manifests and uncertainty. Prohibit release claims drawn from simulated results.

### F20 — HTTP trust boundaries need an explicit local/remote policy

**P1 · Source-confirmed exposure; exploit not attempted.** The daemon listens without an explicit bind host and applies wildcard CORS to MCP routes. Mutable dashboard routes do not establish a common authentication/origin boundary. A localhost URL in logs does not itself restrict network binding. Actual reachability depends on the host firewall and environment; no exploit or external access was attempted.

Evidence anchors: [`src/index.ts`](../../../src/index.ts), [`src/server/dashboard.ts`](../../../src/server/dashboard.ts), [`src/architect/routes.ts`](../../../src/architect/routes.ts).

Recommended outcome: Specify loopback defaults and opt-in authenticated remote access, trusted hosts/origins, session ownership, CSRF protection for browser mutations and permission parity across transports.

### F21 — Subsystem projections need a shared semantic contract

**P1 · Alignment gap; foundations exist.** Graph RAG, strategy snapshots, Explorer, analytics, health, narrative, lifecycle visibility, evidence ledger, calibration and remediation all reconstruct different views. Existing trust and lifecycle modules already solve parts of this; duplicating them would increase divergence. Counting candidates, historical transitions, unique entities and review outcomes interchangeably obscures what the engine actually knows.

Evidence anchors: [`src/cognitive`](../../../src/cognitive), [`src/graph`](../../../src/graph), [`src/explorer`](../../../src/explorer), [`python/analytics`](../../../python/analytics), [`src/architect`](../../../src/architect).

Recommended outcome: Adopt shared identity, revision, evidence, trust, time, configuration and job contracts, then test whole lifecycle traces across consumers. Add an ownership/transition matrix before more autonomous behavior.

### F22 — Modern-model support exists but is not a complete role policy

**P1 · Source-confirmed; request added by user.** llm.ts already routes GPT-5.5/5.6/6/6.1 patterns to Responses. The next broad GPT decimal rule matches gpt-5.4 as chat-completions with supportsReasoningEffort=false. LlmCompletionOptions has no reasoning effort or explicit API override, and the shared Responses completion request sends no reasoning configuration and records only output token usage. This limits dreamer/normalizer control and spend accounting even when the model is selectable.

Evidence anchors: [`src/cognitive/llm.ts`](../../../src/cognitive/llm.ts), [`src/cognitive/strategies/llm-dream.ts`](../../../src/cognitive/strategies/llm-dream.ts), [`src/cognitive/normalizer.ts`](../../../src/cognitive/normalizer.ts), [`src/server/dashboard.ts`](../../../src/server/dashboard.ts).

Recommended outcome: Extend existing adapters with explicit per-role API/model/reasoning/storage/budget configuration, a capability registry and controlled unknown-model overrides. Keep initial-scan and mature-graph policies separate; verify GPT-4.1, GPT-5.4 and user-selected newer models without a hardcoded frontier ceiling.

### F23 — Dashboard navigation and engine.env coverage need expansion

**P2 · Source and live landing-page confirmation; requested expansion.** The root page links to Architect, status, schedules, config, docs and health but contains no Explorer entry. Configuration exposes selected controls rather than a systematic engine.env editor/template workflow. The user explicitly requests more complete settings, minimal manual editing, tabs, template reset and a refreshed landing page.

Evidence anchors: [`src/server/dashboard.ts`](../../../src/server/dashboard.ts), [`src/utils/engine-env.ts`](../../../src/utils/engine-env.ts), [`templates/default/config/engine.env`](../../../templates/default/config/engine.env), [`templates/ollama/config/engine.env`](../../../templates/ollama/config/engine.env), [`templates/lmstudio/config/engine.env`](../../../templates/lmstudio/config/engine.env).

Recommended outcome: Inventory every supported environment setting against a typed UI control or an explicit advanced/read-only reason. Add grouped tabs, search, template preview/diff/apply, secret-preserving reset, backup/undo, restart indicators and an Explorer entry on the root page.

## Dream strategies: coverage and alignment

The strategy layer has eleven dispatch choices in `all`, plus the separately advertised reflective choice. The table separates boundary checks from evidence of usefulness. Pipeline promotion rates are not factual precision.

| Strategy | Audit execution | Required alignment |
|---|---|---|
| gap_detection | Empty/populated boundary probes | Missing relation is a hypothesis, not proof of a gap |
| weak_reinforcement | Empty/populated boundary probes | Repeated source is not independent evidence |
| cross_domain | Empty/populated boundary probes | Domain bridge needs source/provenance and negative examples |
| missing_abstraction | Empty/populated probes produced no positive abstraction | Add a positive sparse-cluster fixture and check speculative hub provenance |
| symmetry_completion | Empty/populated boundary probes | Directed relations must not be assumed symmetric |
| tension_directed | Empty/populated boundary probes | Link candidate to actionable tension and verify resolution separately |
| pgo_wave | One unseeded populated smoke plus empty probe | Seeded distribution tests, novelty and capped exploration |
| orphan_bridging | Empty/populated boundary probes | Correct isolation may be intentional; avoid forced links |
| schema_grounding | Matching-schema fixture and empty probe | Real schema provenance; conflicting/missing schema remains explicit |
| llm_dream | Source review and existing tests; no paid run | Role policy, refusal/schema/budget, evidence labels and evaluated novelty |
| causal_replay | Dispatch/source review; no standalone live cycle | Time ordering, confounders, replay deduplication and uncertainty |
| reflective | Advertised but no dispatch branch found | Implement or reject explicitly |

All 18 supplemental cases preserved input entities and satisfied their checked endpoint/self-link/per-kind bounds. They do **not** prove all strategy branches, schema side effects, meaningful novelty or factual accuracy. Historical own-instance normalization rejected all 41,921 abstraction-origin and all 2,024 weak-origin candidates in that snapshot. That is a strong reason to investigate usefulness and rejection causes, not evidence that the current algorithms can never succeed.

## Whole-engine alignment

The [subsystem map](subsystem-alignment.md) covers 29 families, including all cognitive modules, auxiliary graph producers, clients, plugins, analytics and release surfaces. Its central contract is:

`source evidence → revisioned graph → speculative candidate → evidence review → validated insight → bounded agent context → user action → verified outcome`

Each arrow needs an owner, a durable state transition, a revision/evidence reference and a failure behavior. Source facts and validated insights retain distinct provenance. Graph writes, background schedules, provider calls and user sessions must not become competing authorities.

High-value integration traces are: source rename/deletion while enrichment is running; a reviewed relation rediscovered by a dream; provider failure during normalization; event storms during a manual scan; two Architect clients with different plans; import of foreign hypotheses; intervention proposal versus verified outcome; and a restarted daemon serving the same graph revision through CLI, MCP, Explorer and analytics. The current audit maps these obligations; it does not claim all these traces were executed.

## Models for different stages of graph maturity

The user’s intended starting profile is GPT-4.1 for a full initial scan and models up to GPT-5.4 for dreamer/normalizer on an established, expanding graph. Treat this as a configurable preference to evaluate, not a proven cost optimum or a permanent maximum. Initial scanning, semantic enrichment, creative dreaming, skeptical normalization and interactive Architect should have independent policies. A newer frontier model should be selectable when the user wants it and its API contract is supported, without silently upgrading existing workloads.

Existing Responses support is a foundation. Complete the role controls and capability dispatch rather than adding a second provider stack. Official [GPT-5.4 documentation](https://developers.openai.com/api/docs/models/gpt-5.4) identifies it as a reasoning model with configurable effort and support for Responses and Chat Completions. The official [Responses migration guide](https://developers.openai.com/api/docs/guides/migrate-to-responses) requires typed output handling, appropriate structured-output/tool schemas and deliberate state management. Both were fetched on 2026-09-30. No account-specific model availability or provider price was verified.

Acceptance should cover API selection, reasoning effort, schemas, incomplete/refused responses, cancellation, storage policy and actual input/cached/output/reasoning usage. Multi-turn clients also need preserved tool IDs and response items. A better model may improve candidates; it must never weaken factual promotion gates. Paid model comparisons belong behind an explicit per-run cost cap, with offline fixtures as the default regression path.

## Delivery and evidence discipline

Start with contracts and response correctness, then shared graph identity/retrieval, durable updates, configuration/session ownership and model policies. Align cognitive producers and consumers before tuning autonomous throughput. Refresh the legacy own graph only after the migration and recovery safeguards exist. Finish with whole-engine regression gates and a synchronized release across all products.

Implementation evidence belongs in the paired plan log: slice ID, graph/code/config revision, test command and outcome, review decision, known limits and rollback. Registration used the correct DreamGraph project, not web64-react. Discipline session `e211864f-0e9e-4beb-b198-4f8acc3348eb` accepted 23 finding entries and a DRAFT native plan containing 66 per-finding mappings for the 29 Markdown slices. The audit-only session was completed to release the singleton discipline slot; the implementation plan remains unapproved and all slices pending. The native [delta payload](discipline-delta.json) and [plan payload](discipline-plan.json) preserve this representation. The daemon Architect registry also discovered the Markdown plan. The delta’s 0% parity is calculated over selected defects/gaps, not the whole project; it is not an overall product score.

Reproduction notes and sanitized measurements are in [verification.json](verification.json). Local raw traces remain under `.codex/audit-run/`; those contain environment-specific graph details and are deliberately not copied wholesale into project documentation. The durable inventory, coverage and matrices provide the auditable baseline without exposing unrelated source content.

## Planning addendum — revision 2 — 2026-09-30

The owner resolved the five design questions and supplied 13 nervous-point policies. See [resolved contracts and task acceptance](plan-refinement.md), [machine-readable traceability](plan-refinement.json), and the updated [31-slice plan](../../../plans/graph-trust-and-agent-effectiveness.md). These refine the proposed work; they do not change the original test/coverage measurements or claim product fixes.

### F24 — Schedule management needs a complete workflow rebuild

**P1 · Owner requirement and source-confirmed workflow gaps.** `renderSchedules`/`handleSchedulePost` in `src/server/dashboard.ts` provide create/toggle/run/delete but no schedule editing flow, expose raw millisecond inputs and derive historical strategy labels from the current schedule. `src/cognitive/scheduler.ts` leaves cron next-run projection null and `parseScheduleParams` falls back to defaults for invalid action parameters. No live schedule was modified or run to make these observations. Refactoring these behaviors requires named semantics and migration, not an assertion that the UI alone is broken.

Slice 17 owns scheduler admission, validation, occurrence/recovery semantics; new Slice 29 owns the complete dashboard workflow. C11 defines editing/duplication, previews, timezone/DST, missed/overlap policies, run snapshots, cancellation, budgets, history and browser acceptance. Final system verification depends on both. The original 23-finding native audit remains historical; revision-2 registration includes F24 and the resolved policy evidence separately.

### F25 — CLI Autonomy and Verbosity need behavioral investigation and repair

**P1 · User-reported behavior, partial source evidence; root cause not yet reproduced.** The shared route already uses autonomy for continuation, and the bridge carries verbosity through prompt/environment and Codex configuration. `RunArchitectCliBridgeInput` lacks an explicit autonomy parameter, and child launch/approval setup does not visibly distinguish modes. These facts do not prove all settings are ignored. Trace and test browser selection, effective runtime, prompt/arguments/configuration, tool authority, continuation and rendered output separately for Codex and Copilot. New Slice 30 and C13 specify diagnosis, host-enforced autonomy semantics, honest support levels and evidence-preserving verbosity behavior. The refined plan now has 31 slices; the original audit snapshot and measurements remain unchanged.

## Lifecycle/status follow-up — revision 3 — 2026-09-30

**F15 extended · User screenshots, source findings and read-only projection reproduction.** The current plan projects `draft`, `idle`, 31 pending slices and zero checkpoints, yet assigns the same pending Slice 0 to current, active and next. `buildOperationalState` falls back to the next candidate for active/current. The right sidebar consumes raw slice statuses while the header consumes operational state; existing completed-card CSS cannot correct that disagreement. The future-review path independently picks a first/current slice and uses raw-status regexes for next. Historical completion unions, implemented/verified conflation and prose-based next/completion selection also need replacement; these are source observations, not new exhaustive behavioral tests.

The [C14 lifecycle/status design](plan-lifecycle-status.md) specifies one daemon-owned projection, typed transitions and verification, current/running/next eligibility, stable IDs, dependency-aware queueing, revision/idempotency/concurrency, restart/reconnect, legacy reconciliation and accessible sidebar presentation. It expands Slice 21, preserves all 31 IDs, and adds PL01–PL16 acceptance scenarios plus cross-client/release obligations in Slices 25/27. Completed cards will be muted and actual running cards restrained green with text/icon; selected and suggested work remains distinct. No runtime repair is claimed by this document update; original coverage/test measurements remain unchanged.

## Graph execution-loop follow-up — revision 4 — 2026-09-30

The [owner request](owner-graph-execution-request.txt) makes graph utilization a first-class execution invariant. [C15](graph-centered-execution.md) now binds task-specific graph context, adapter-native delivery, mandatory evidence, material-change reconciliation and bounded affected-region digestion into one release obligation. This extends existing retrieval/update/alignment findings rather than claiming a newly proved absence of all graph integration.

**Evidence: read-only live probes and focused source inspection, not an end-to-end effectiveness evaluation.** [Probe summary](graph-execution-probe.json) records accepted graph-context/recorder/reconciliation ADRs and a health report with stale/incomplete semantics and no scan revision. The bounded RAG call reported 1,419 tokens against a 1,400 request and returned largely structural fallback descriptions; it does not establish sufficient project understanding. Browser/CLI prompt builders already instruct graph grounding, write-back and a targeted dream with minimum two hops. Existing event routing, maintenance state, incremental reconciliation and journal/barrier code provide foundations. Prompt instructions and those modules do not by themselves prove receipts, dirty-generation coalescing, all-surface participation or comparative usefulness.

C15 preserves native CLI execution, optional API continuation and shared graph semantics; it requires explicit treatment of legacy ADRs, best-effort incidental recording versus durable material changes, generic sparse ports versus connected authority, and stricter managed-CLI failure rules. Blanket minimum-hop/automatic dream instructions must become bounded policy-driven affected-scope admission. The sixteen GE01–GE16 scenarios and matched graph-assisted/source-only AT corpus comparisons are required future evidence. No model benchmark, paid cognition, scan, live scheduler change or product implementation was run for this refinement. Prior audit coverage measurements remain historical.

## Architect interaction follow-up — revision 5 — 2026-09-30

The owner requested compact, useful context menus for plans, slices, nervous points, schedules and ADRs; a visible Nervous Points expansion arrow; and automatic positioning of the selected plan in a large plan browser. [C16](architect-context-actions.md) makes these part of the unified Ashoka scope, expanding existing slices without changing their identities.

**Evidence: user report plus focused source findings; full browser reproduction remains pending.** `src/architect/routes.ts` has no shell contextmenu handler, while ADR proposal editing and scheduler action templates already exist. A `focusPlanButtonInRail` helper already centers during loadPlan/loadPlans; filter handlers rebuild through renderPlanTree without reveal, and requested selection is resolved through visible rows. Do not claim centering code is wholly missing. Custom chevrons style the outer accordion only; Nervous Points is a nested living-plan-foldout with flex summary styling and no explicit custom arrow. The design requires browser confirmation across filters, restoration, async loads, dense/long plan lists and nested disclosure states.

Menus reuse real command identities and existing governance with captured target/revision; selection, proposal and committed state remain separate. UX01–UX12 require keyboard/touch/focus/clipping tests and actual scrolling behavior, not only static HTML strings. Source findings extend F14/F15/F23 and whole-surface alignment obligations; no new product implementation, paid model call or live schedule mutation was performed for this planning addition.

## Computer Use investigation — revision 6 — 2026-09-30

### F26 — Computer Use requires adapter-native execution and shared authority/evidence boundaries

**Evidence level: repository/installed-CLI observations plus current official documentation; live GUI/model qualification not performed.** The [capability and platform audit](computer-use-capabilities.md) traces current intent/session/adapter/tools/results/lifecycle/graph seams. Native API tool results are string-based and non-text MCP blocks are JSON-serialized; Responses parsing currently recognizes function calls rather than computer calls. CLI proxy results pass through but raw arguments/result prefixes can enter audit logs. Execution controls advertise stop for CLI only, with pause/resume false; existing shared-state defects remain prerequisites. No Computer Use worker/browser automation dependency was found in this checkout.

Codex CLI 0.159.2 exposes Computer Use/browser feature flags, but they do not establish availability or enforcement inside DreamGraph's isolated run. Copilot CLI 1.0.56 has MCP/attachment support; Claude Code is absent from PATH. Official provider capabilities and native desktop/browser routes are documented separately from unverified DreamGraph integration. Native APIs use DreamGraph's harness; Codex uses Codex-native Computer Use per explicit owner direction. Native permissions/events/stop and scoped ADR-217 extension must be qualified; no API continuation is forced onto CLI, no silent bridge substitute and no app-private protocol dependency.

C17 separates wants, musts and platform realities, with Windows/macOS/Linux remedies, evidence/privacy/cost/recovery rules and CU01–CU24. Dedicated Slice 31 contains eight bounded packages for GPT-6.1 Sol, preserving the previous 31 IDs. It depends on the existing graph/provider/authority/lifecycle/client foundations and precedes Slice 27. NP14 records physical-input, platform-scope, disclosure and unknown-external-effect risks. All 32 slices remain pending; no runtime changes, images/input, paid tests, live scans or daemon restarts were performed for this refinement. See [design](computer-use.md), [read-only probe](computer-use-graph-probe.json) and [machine evidence](computer-use-evidence.json).

## Pre-implementation execution simulation — revision 7 — 2026-09-30

The [execution simulation](execution-simulation.md) walks all 32 pending slices in dependency order against source and current read-only accepted-ADR evidence, including ADR-238/239/240. It closes 21 design gaps EC01–EC21 within the existing C01–C17 owners, changes 17 dependency sets, maps 35 concepts and all eight surfaces, and adds 21 compound XS scenarios plus stable IDs for the 13 existing schedule cases. It does not implement those changes or execute the future runtime acceptance suite.

Material findings include hidden acceptance cycles; scan hashes mistaken for general commit revisions; no retained operation receipt after journal cleanup; process-local locks/read upgrades; corrupt-load-to-empty fallbacks; timeout without worker stop; readiness calls outside budget admission; shared session selection; plan-verification/export self-dependency; unobserved managed shell/editor/plugin effects; dirty-generation joins; mutable schedule-history semantics; ADR applicability conflicts; Python snapshot drift; and missing migration/install boundaries. The owning contracts and per-slice handoffs now specify publication, identity, fencing, recovery, integration gates and full-family U0–U8 migration. Proposed ADR amendments remain unaccepted until normal implementation review.

**Correction to freshness interpretation:** `src/tools/graph-health.ts` currently uses scan/enrichment age and commits/working-tree changes since the scan in staleness recommendations. A historical probe reporting those labels is not proof that its graph is stale. One initial full scan can remain sufficient when MCP/Architect mutations keep the graph reconciled. Health, retrieval and every client must use actual affected evidence and latest reconciliation coverage; an already-reconciled dirty Git tree is not new drift. Missing scan baseline metadata limits that operation, not all later graph knowledge. This deepens F11 and scopes F17 repair: repair demonstrated collisions/missing mappings, do not rescan merely because a scan is old. XS21 specifies the regression and user-selected inclusive-scan boundary.

**DreamGraph guarantees system correctness under valid use. The user owns operating discipline outside that contract.** Valid use means a documented supported route/version, declared instance/project/scope and satisfied authority/configuration prerequisites. DreamGraph must enforce those prerequisites and correctly preserve identities, committed state, reconciliation, concurrency, budgets, lifecycle, evidence and truthful results; a bug cannot be dismissed as operator discipline. A failed worker, interrupted write, stale UI or invalid request must produce the specified recoverable/error state. The user chooses when to work outside DreamGraph, when substantial out-of-band changes warrant an inclusive scan, and which optional paid/cognitive workflows to run. Do not impose recurring scans, suspicion-driven warnings or extra approvals for work already authorized within that contract. Unsupported/out-of-scope activity has an explicit boundary; the product does not claim to have observed it.

Existing runtime defects and unverified qualification remain honest implementation work. Static plan/parser/DAG/link/hash checks are reported in [the verification record](execution-simulation-verification.json). Real AT/PL/GE/SC/UX/CU/XS acceptance, paired usefulness, platform/native-CLI control and exact release packaging remain future gates. Native revision-6 plan registration is historical; revision 7 is a file-backed draft because this pass permits only read-only daemon inspection. All 32 slices are still pending, and no source behavior, production data, package version or accepted ADR changed.

The owner also requested a last-graph-mutation record. C03 and Slices 2/5/22 now require atomic `last_graph_mutation_at` beside graph revision, distinct inclusive-scan and scoped source-reconciliation markers, exposed to MCP-aware tools and every surface. XS21 covers replay/no-op/failure, unchanged old knowledge and a newer unrelated mutation that must not mask a real gap.

The [compact closure report](execution-closure-report.md) answers all twelve requested closure questions and distinguishes design closure, execution inputs and still-unverified runtime guarantees.
