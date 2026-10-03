# DreamGraph Workflows

Engine configuration uses the compact searchable `/config` workspace. Select a category, edit typed fields and save against the displayed content revision; errors retain drafts. Preview a protected template diff before applying it; Apply and Undo stage saved intent. Run the displayed instance CLI restart command, then Read back to verify effective values. A lost acknowledgement retries the original operation, without issuing another save. Root/Status show canonical graph mutation/reconciliation and scoped execution history through the existing authorities. See [configuration workspace](ashoka/configuration-workspace.md).

The exact-action review port reads a delivered execution checkpoint, captures its receipt and revision, and submits a stable approval ID plus exact bounded actions under the original host session. It persists the review before activation. After a lost acknowledgement, reuse the same ID/payload; a conflict requires a fresh review. Consumed calls and the original expiry remain unchanged. A model/worker cannot invoke approval issuance. The foundation is qualified by actual HTTP/core tests; browser adoption has partial offline/browser qualification and editor adoption remains open.

Ordinary browser API/CLI lease adoption is qualified at the declared offline scope: assemble through the original host port, acknowledge whole context, dispatch under that worker scope and close through the host owner before reporting graph closure. Dispatched failures/cancellation retain unknown termination; pre-dispatch refusal is distinct. Native CLI checkpoints retain the five-minute bound. Editor review UI and local effects remain Slice 25 gates.

The browser action-review panel passes the 18-case composed Windows Chrome qualification with declared authority/executor doubles; this is partial GE/UX coverage. An explicitly enabled review channel queues an exact canonical tool request before dispatch and outside the writer. The operator sees complete arguments, scope, receipt, revision and call count, then approves once or declines. Lost acknowledgements keep the original ID/payload and pause continuation. SDK/editor host transports expose bounded queue open/read/decline controls, which worker credentials cannot access. Queue memory is ephemeral; approved review hashes remain durable. API and CLI Stop request cancellation without claiming rollback or confirmed termination.

Editor native CLI checkpoint (Ashoka Slice25): capture the selected instance, assemble a unique daemon-owned execution, serialize the original Codex/Copilot prompt, append the whole current canonical pack and effective controls, refuse an oversized request, acknowledge exact host delivery, then launch the selected CLI with the same execution-bound bridge credential. Close the checkpoint before any automatic continuation; unconfirmed process descendants or journal intent retain recovery and halt continuation. Editor CLI checkpoints now open an exact operator review channel before launch; its UI/controller integration is under qualification. Effects require the captured daemon proposal and acknowledgement; autonomy and verbosity do not grant writes. Native API/local editor and SDK/plugin loop closure remain open. See [client integration](ashoka/client-integration.md).

Ashoka Slice25 in-progress client workflow: a managed browser API/CLI pass assembles canonical task context, preserves whole mandatory evidence and records host delivery before dispatch. Exact approved effects revalidate affected context through the daemon fence. Source tools retain their existing execution-bound reconciliation obligations; closure reports pending/unknown effects separately from implementation verification. External `/api/context/v1` reads remain unattested. Context menus draft questions without sending, and Reveal centers only the selected plan rail. See [client integration](ashoka/client-integration.md) for supported foundations and remaining qualification.

The [C14 workflow](ashoka/plan-authority.md), under implementation, reviews a content-bound definition, approves explicit scope, starts owned work, admits a finite execution lease, records committed implementation, verifies its acceptance/reconciliation and performs separate final plan verification. Same-operation retries recover the receipt; expired/unknown workers retain recovery debt. Selecting a card never changes lifecycle.

Strategy execution uses the [shared catalogue](ashoka/strategies.md): validate the named executor, explicit focus and integer fractions before changing cognitive state; allocate one combined candidate budget; dispatch isolated snapshots; validate speculative output; remap retained node identities during deduplication. Zero budget skips decay, normalization and inference. A retired or unknown strategy never defaults to `all`. Model admission and factual promotion retain their separate gates.

MCP execution follows the [shared result and session contract](ashoka/mcp-contract.md): discover all bounded tool pages, retain an owned connection for a pass, validate the original request/version/discipline scope, dispatch the owner once, retain its structured result/provenance, then close the transport. Cancellation or an uncertain mutation must be resolved through the owner receipt; neither prompt omission nor reconnect authorizes an automatic retry. Current generated inventory is 93 core tools and 31 resource URIs.

> Operational workflows, including the Ashoka publication boundary under implementation.

## Ashoka graph publication and recovery

1. The daemon resolves the physical instance, acquires its kernel writer lease and recovers any pending journal before hydration/admission.
2. A writer builds its intended delta from a committed revision. Publication checks operation replay identity first, then expected graph/store/source revisions; conflicts require rereading and reconciling the delta.
3. The authority records before/after images in the durable journal, replaces domain files and publishes `publication_state.json` last. Receipt, currency, revisions and outbox share that boundary.
4. Reads require a stable before/after publication stamp and fail closed during recovery. Readers never initialize or repair state.
5. Before-marker failure rolls back; after-marker failure rolls forward. A retry after a lost reply returns the same durable receipt and does not duplicate the effect.

See [foundation status](ashoka/foundation.md) for pending writer/consumer adoption, outbox retention and cross-platform qualification. Full-scan age is not a stale-graph rule; managed reconciliation and concrete evidence gaps determine scoped currency.

## Ashoka bounded task context

1. Read one committed canonical snapshot and request task filters, selected plan/slice, evidence anchors and changed paths.
2. Reserve required whole evidence, then expand under independent hop/neighbor/record limits. Keep typed identity, truth class and provenance together.
3. Enforce text and metadata budgets separately. Required context that cannot fit is insufficient; follow named anchors or targeted source fallback instead of assuming complete context.
4. Bind assembly to a revisioned receipt. Adapter delivery remains unattested until actual acknowledgement. Expiring UI observations are semantic history, never coordinates for a later action.
5. Refresh when relevant graph/effect scope changes; do not use scan age as a freshness rule. Reconciliation clears concrete source debt before optional cognition.

See [retrieval contract and pending integration](ashoka/retrieval.md). Legacy comparison is explicit and does not support the new scope/receipt controls.

---

## 1. Dream Cycle (`dream_cycle_flow`)

**The core cognitive loop.** AWAKE → REM → NORMALIZING → AWAKE.

**Trigger:** `dream_cycle` tool  
**Actors:** cognitive_engine, dreamer, normalizer  
**Source:** [src/cognitive/dreamer.ts](../src/cognitive/dreamer.ts), [src/cognitive/normalizer.ts](../src/cognitive/normalizer.ts), [src/cognitive/engine.ts](../src/cognitive/engine.ts)

| Step | Name | Description |
|------|------|-------------|
| 1 | Pre-flight checks | Assert AWAKE state. Load dream graph from disk. |
| 2 | Transition to REM | AWAKE → REM. Fact graph loaded as grounding dataset. |
| 3 | Strategy selection | Select from 10 strategies (incl. LLM dream + PGO wave). Budget: LLM 35%, PGO wave 15%, structural 50% — distributed adaptively. Strategies with 3+ zero-yield cycles are benched, probed every 6th cycle. LLM dream and PGO wave are never benched. |
| 4 | Speculative generation | Each strategy generates DreamEdges with initial TTL=8, strategy-specific confidence. Deduplication applied. Edges matching reinforcement memory inherit accumulated count. Max dreams capped (default 20). |
| 5 | Dream persistence | New edges appended to `dream_graph.json`. Duplicates get `reinforcement_count++` instead of duplication. |
| 6 | Transition to NORMALIZING | REM → NORMALIZING (if `auto_normalize=true`). |
| 7 | Three-outcome classification | Split scoring: plausibility × evidence − contradiction. Promotion gate: confidence ≥ 0.62, plausibility ≥ 0.45, evidence ≥ 0.40, evidence_count ≥ 2, contradiction ≤ 0.3. |
| 8 | Outcome dispatch | Validated → `validated_edges.json` (relation cleaned). Latent → stays in dream graph. Rejected → removed. All logged to `candidate_edges.json`. |
| 9 | Dream decay | TTL−=1, confidence−=0.05. Edges at TTL=0 or confidence <0.35 expire. Reinforcement memory preserved 30 cycles post-death. |
| 10 | Return to AWAKE | NORMALIZING → AWAKE. History entry appended. v5.1 hooks fire: `maybeAutoNarrate()`, `checkTensionThresholds()`. |

**Output:** `{ dreams_generated, promoted, latent, rejected, expired, tensions_created, tensions_resolved }`

---

## 2. Nightmare Cycle (`nightmare_cycle_flow`)

**Adversarial security scan.** AWAKE → NIGHTMARE → AWAKE.

**Trigger:** `nightmare_cycle` tool  
**Actors:** cognitive_engine, adversarial_dreamer  
**Source:** [src/cognitive/adversarial.ts](../src/cognitive/adversarial.ts)

| Step | Name | Description |
|------|------|-------------|
| 1 | Pre-flight checks | Assert AWAKE. Load fact graph for security entity construction. |
| 2 | Transition to NIGHTMARE | AWAKE → NIGHTMARE. |
| 3 | Security entity construction | Build SecurityEntity per feature via regex: `has_auth_refs`, `has_rls_refs`, `has_validation_refs`, `accepts_input`, `stores_data`. |
| 4 | Strategy execution | Five strategies run: privilege_escalation (CWE-269), data_leak_path (CWE-200), injection_surface (CWE-20), missing_validation (CWE-20), broken_access_control (CWE-862). |
| 5 | Threat edge generation | ThreatEdges with severity, CWE IDs, blast radius. |
| 6 | Persistence | Threats → `threat_log.json`. Critical/high → tension signals. |
| 7 | Return to AWAKE | NIGHTMARE → AWAKE. |

**Output:** `{ threats_found, by_severity, by_strategy, new_tensions_created }`

---

## 3. Normalization Pipeline (`normalization_flow`)

**The three-outcome classifier** — evaluating a single dream edge.

**Trigger:** Step 7 of dream cycle, or `normalize_dreams` tool  
**Source:** [src/cognitive/normalizer.ts](../src/cognitive/normalizer.ts)

| Step | Name | Description |
|------|------|-------------|
| 1 | Load grounding data | Features, workflows, data model → lookup tables. |
| 2 | Plausibility scoring | Entity existence, domain coherence, keyword overlap, repo match. → 0.0–1.0 |
| 3 | Evidence scoring | Count independent sources: features (+1), data model (+1), workflows (+1), multi-feature (+0.5). → evidence_count + score |
| 4 | Contradiction scoring | Check conflicts with existing fact-graph links. → 0.0–1.0 |
| 5 | Combined confidence | `plausibility × evidence − contradiction` |
| 6 | Promotion gate | All 5 thresholds must pass for validated. Partial pass → latent. Fail → rejected. |
| 7 | Outcome recording | Validated: cleaned relation → `validated_edges.json`. Latent: scores attached, stays in dream graph. Rejected: removed. |

---

## 4. Tension Lifecycle (`tension_lifecycle_flow`)

**From creation to resolution or expiry.**

**Trigger:** Normalization rejection, adversarial scan, insight injection, federation import  
**Source:** [src/cognitive/engine.ts](../src/cognitive/engine.ts)

| Step | Name | Description |
|------|------|-------------|
| 1 | Creation | UUID assigned. Type, urgency, entities, domain (inferred by keyword heuristic from 11 domains). |
| 2 | Active cap enforcement | >200 active → lowest-urgency auto-archived. Prevents cognitive overload while allowing rich autonomous exploration. |
| 3 | Per-cycle decay | urgency −= 0.01, TTL −= 1. At zero → expired. |
| 4 | Goal-directed dreaming | Highest-urgency tensions read by `tension_directed` strategy. |
| 5 | Resolution (happy path) | `resolve_tension(id, type, authority)`. Types: `confirmed_fixed`, `false_positive`, `wont_fix`. |
| 6 | Expiry (timeout path) | TTL=0 or urgency=0 → auto-expires. Archived for historical analysis. |

---

## 5. Edge Promotion (`edge_promotion_flow`)

**The 5-state lifecycle of a dream edge.**

```
candidate → [normalization] → validated (promoted)
                             → latent (speculative memory)
                             → rejected (discarded)
                                 ↓ (decay)
                             → expired (TTL death, reinforcement memory survives)
```

| Step | Name | Description |
|------|------|-------------|
| 1 | Generation | Strategy creates edge: TTL=8, status=candidate. Inherits reinforcement memory if same key existed before. |
| 2 | Evaluation | Normalizer scores plausibility, evidence, contradiction. |
| 3 | Validated | All 5 thresholds pass. Relation cleaned, copied to `validated_edges.json`. |
| 4 | Latent | Partial pass. Stays in dream graph with scores. Can be re-evaluated. |
| 5 | Rejected | Hard fail. Removed. If confidence ≥ 0.3, creates a tension. |
| 6 | Expired | TTL decay death. Reinforcement memory preserved 30 cycles. |

---

## 6. Federation (`federation_flow`)

**Cross-project pattern sharing.**

**Trigger:** `export_dream_archetypes` / `import_dream_archetypes`  
**Source:** [src/cognitive/federation.ts](../src/cognitive/federation.ts)

| Step | Name | Description |
|------|------|-------------|
| 1 | Export: read validated | Load `validated_edges.json`. Group by pattern type. |
| 2 | Export: anonymize | Replace entity names with generic roles: `service_entity`, `data_store_entity`, `ui_component`, `auth_component`, `api_endpoint`. |
| 3 | Export: classify | Map to pattern type: `security_pattern`, `structural_gap`, `cross_domain_bridge`, `tension_resolution`, etc. |
| 4 | Export: persist | Write to `dream_archetypes.json`. |
| 5 | Import: load | Read foreign archetypes. Validate structure. |
| 6 | Import: create tensions | Each imported archetype → tension: *"Does this pattern hold locally?"* → triggers `tension_directed` dreaming. |

---

## 7. Interruption Protocol (`interruption_protocol_flow`)

**Emergency abort with data safety.**

**Trigger:** Tool call during active REM/NORMALIZING/NIGHTMARE, or `engine.interrupt()`  
**Source:** [src/cognitive/engine.ts](../src/cognitive/engine.ts)

| Step | Name | Description |
|------|------|-------------|
| 1 | Trigger | Tool call during non-AWAKE state. |
| 2 | Dream quarantine | Uncommitted edges flagged. NOT written to dream graph. |
| 3 | State rollback | Force transition to AWAKE. Partial results discarded. |
| 4 | Persistence checkpoint | Committed data saved. History entry notes interruption. |
| 5 | Notification | Returns `{ interrupted_state, quarantined_count, cycle }`. |

---

## 8. Living Documentation Export (`living_docs_flow`)

**Knowledge graph → structured Markdown.**

**Trigger:** `export_living_docs` tool  
**Source:** [src/tools/living-docs-exporter.ts](../src/tools/living-docs-exporter.ts)

| Step | Name | Description |
|------|------|-------------|
| 1 | Load knowledge graph | All fact graph files + optional ADR, UI registry. |
| 2 | Section generation | 8 generators: features, data_model, workflows, architecture, ui_registry, cognitive_status, api_reference, index. |
| 3 | Framework adaptation | Docusaurus (sidebars.js, MDX), Nextra (meta.json), MkDocs (mkdocs.yml), Plain (standard MD). |
| 4 | Enrichment | Optional Mermaid diagrams, cognitive health section. |
| 5 | Output | Stateless and idempotent structured Markdown. |

---

## 9. Insight Solidification (`insight_solidification_flow`)

**Manual injection into cognitive memory.**

**Trigger:** `solidify_cognitive_insight` tool  
**Source:** [src/tools/solidify-insight.ts](../src/tools/solidify-insight.ts)

| Step | Name | Description |
|------|------|-------------|
| 1 | Validate | Check insight type (EDGE/TENSION/ENTITY) and required fields. |
| 2 | Brief REM entry | AWAKE → REM (state guard compliance). |
| 3 | Create | EDGE: strategy=reflective, TTL=12, specified confidence. TENSION: via `engine.recordTension()`. ENTITY: node with hypothetical=true. |
| 4 | Return to AWAKE | REM → AWAKE. No normalization triggered (pre-validated by agent). |

---

## 10. Schedule Execution Flow (`schedule_execution_flow`)

**Policy-driven temporal orchestration of cognitive actions.**

**Trigger:** Scheduler tick loop (every 30s), `run_schedule_now` tool, or hook (`notifyCycleComplete`, `recordActivity`)  
**Source:** [src/cognitive/scheduler.ts](../src/cognitive/scheduler.ts)

| Step | Name | Description |
|------|------|-------------|
| 1 | Tick | Scheduler wakes every `tick_interval_ms` (default 30s). Checks each enabled schedule. |
| 2 | Trigger evaluation | For each schedule, check trigger condition: `interval` (elapsed time), `cron_like` (hour/minute/day-of-week match), `after_cycles` (cycle count since last run), `on_idle` (time since last activity). |
| 3 | Safety check | Verify: (a) not already executing, (b) cooldown elapsed since last run, (c) hourly rate limit not exceeded, (d) error streak < pause limit. |
| 4 | Execute action | Call internal engine function: `dream_cycle`, `nightmare_cycle`, `normalize_dreams`, `metacognitive_analysis`, `get_causal_insights`, `get_temporal_insights`, or `export_dream_archetypes`. |
| 5 | Record result | Append execution record: timestamp, success/failure, duration_ms, result summary. Update `run_count`, `last_run_at`, `next_run_at`. |
| 6 | Error handling | On failure: increment `error_streak`. If streak ≥ 3, auto-pause schedule (status: `paused`). On success: reset `error_streak` to 0. |
| 7 | Completion check | If `run_count` ≥ `max_runs`, set status to `completed` and disable schedule. |
| 8 | Persist | Write updated schedule state to `data/schedules.json`. |

---

## 11. Global Install (`global_install_flow`)

**Cross-platform install from source to `~/.dreamgraph/bin/`.**

**Trigger:** `scripts/install.ps1` (Windows) or `scripts/install.sh` (macOS/Linux)  
**Source:** [scripts/install.ps1](../scripts/install.ps1), [scripts/install.sh](../scripts/install.sh)

| Step | Name | Description |
|------|------|-------------|
| 1 | Build | Run `npm run build` to compile TypeScript to `dist/`. |
| 2 | Create bin dir | Ensure `~/.dreamgraph/bin/` exists. |
| 3 | Clean node_modules | Remove existing `~/.dreamgraph/bin/node_modules/` to avoid stale deps. |
| 4 | Copy dist | Mirror `dist/` into `~/.dreamgraph/bin/dist/`. |
| 5 | Copy package files | Copy `package.json` and `package-lock.json` for npm install. |
| 6 | Install production deps | Run `npm install --omit=dev` inside `~/.dreamgraph/bin/`. |
| 7 | Write version.json | Stamp `{ version, builtAt, sourceDir }`. |
| 8 | Create shims | Platform-specific: `.ps1` shim on Windows, symlink on POSIX, both pointing to `dist/cli/dg.js`. |

---

## 12. Daemon Start (`daemon_start_flow`)

**Start a DreamGraph daemon process for an instance.**

**Trigger:** `dg start [instance]` CLI command  
**Source:** [src/cli/commands/start.ts](../src/cli/commands/start.ts)

| Step | Name | Description |
|------|------|-------------|
| 1 | Resolve instance | Look up instance directory from name/UUID. Load `instance.json`. |
| 2 | Check already running | Read PID from metadata; verify process alive. Abort if already running. |
| 3 | Read transport | Read `transport` from `instance.json` (default: `http`). |
| 4 | Parse flags | Check `--foreground`, `--port`, `--verbose`. |
| 5 | Guard stdio | If transport is `stdio` and `--foreground` not set, throw error with 3 suggested alternatives. |
| 6 | Port collision check | If HTTP, verify port is free; auto-increment if occupied. |
| 7 | Spawn daemon | Fork `node dist/index.js` detached with env vars, stdout/stderr → log files. |
| 8 | Write metadata | Write PID, port, transport, startedAt to instance metadata. |
| 9 | Health check | Poll HTTP endpoint (up to 15 s). Confirm server is responsive. |

---

## 13. Daemon Stop (`daemon_stop_flow`)

**Gracefully stop a running DreamGraph daemon.**

**Trigger:** `dg stop [instance]` CLI command  
**Source:** [src/cli/commands/stop.ts](../src/cli/commands/stop.ts)

| Step | Name | Description |
|------|------|-------------|
| 1 | Resolve PID | Load instance metadata, read daemon PID. |
| 2 | Validate ownership | Confirm PID belongs to a DreamGraph process. |
| 3 | Send signal | Send SIGTERM (POSIX) or `taskkill` (Windows). |
| 4 | Wait for exit | Poll process status up to timeout (default 10 s). |
| 5 | Verify shutdown | Check process is gone. Server logs "Shutdown complete" with 200 ms flush. |
| 6 | Clean metadata | Remove PID and port from instance metadata files. |

---

## 14. Dashboard Request Lifecycle (`dashboard_request_flow`)

**Handle an incoming HTTP request to the web dashboard.**

**Trigger:** Browser navigates to any dashboard route (GET) or submits a form (POST)  
**Source:** [src/server/dashboard.ts](../src/server/dashboard.ts)

### GET Request (Page Render)

| Step | Name | Description |
|------|------|-------------|
| 1 | Route match | `handleDashboardRoute()` matches URL pathname to a known page (`/`, `/status`, `/schedules`, `/config`, `/docs`, `/health`). |
| 2 | Gather data | Page renderer reads live state: cognitive engine status, schedules, config values, knowledge graph data. |
| 3 | Render HTML | Server-side renders full HTML page with inlined CSS, navigation bar, and page-specific content. |
| 4 | Respond | Returns `200 text/html` (or `application/json` for `/health` with JSON Accept header). |

### POST Request (Form Action)

| Step | Name | Description |
|------|------|-------------|
| 1 | Parse body | Read URL-encoded form body or JSON body. |
| 2 | Dispatch action | Route to handler based on path: `/config` → `handleConfigPost()`, `/schedules` → `handleSchedulePost()`, `/config/test-db` → `handleTestDbPost()`. |
| 3 | Execute mutation | Apply the requested change: update LLM/scheduler/narrative config, toggle/create/delete schedule, or test DB connection. |
| 4 | Redirect (PRG) | For form POSTs, return `303 See Other` redirecting back to the originating page. For `/config/test-db`, return JSON response directly. |

---

## 15. Project Bootstrap via `dg scan` (`bootstrap_flow`)

**Onboarding for new instances.** Triggered by the user running `dg scan <instance>` after configuring LLM settings.

**Trigger:** `dg scan` → `scan_project` MCP tool (Phases 1–5)
**Guard:** ADR discovery and follow-up scheduling only run when seed data is populated and LLM is available
**Source:** [src/tools/scan-project.ts](../src/tools/scan-project.ts), [src/instance/bootstrap.ts](../src/instance/bootstrap.ts)

| Step | Phase | Description |
|------|-------|-------------|
| 1 | Phase 1 — File scan | Discover directory structure, read key source files, classify by type. |
| 2 | Phase 2 — LLM enrichment | If an LLM is configured, generate rich semantic descriptions for features, workflows, and data model entities. Falls back to structural-only analysis otherwise. |
| 2.6 | Phase 2.6 — Native data-model bridge | When `data_model` is in `targets`, run the native polyglot scanner (`src/scanner/`) over discovered C/C++/Rust/Java files and merge results into `data_model.json`. |
| 2.7 | Phase 2.7 — Native UI scanner (v10.3) | When `ui` is in `targets`, extract React/Vue/Svelte/Blazor/WPF components from `.tsx/.jsx/.vue/.svelte/.razor/.xaml` files and merge scanner-origin `SemanticElement` entries into `ui_registry.json` via `applyScannerUiElements`. Never overwrites entries with `source_kind` of `manual`, `sdk`, `user_guidance`, or `generated`; preserves enrichment fields on existing scanner entries across re-scans. |
| 3 | Phase 3 — Auto-dream | Trigger a full dream cycle (`strategy="all"`) to generate initial speculative edges and validate them against the newly populated fact graph. |
| 4 | Phase 4 — ADR discovery | Build an LLM prompt from discovered entities to identify implicit architectural decisions. Each discovered ADR is recorded via `recordADR()` with `decided_by: "system"`. |
| 5 | Phase 5 — Schedule follow-ups | Five dream cycles are scheduled at 5-minute intervals to allow the knowledge graph to grow and stabilize. |

**Important:** The daemon does NOT auto-scan on startup. The user must configure LLM settings first (via dashboard at `/config` or by editing `engine.env`), then run `dg scan <instance>`.

**Output:** Log messages and CLI output indicating each phase's completion. The instance is ready for interactive use after the scan completes.

---

## 15b. Autonomous Parser-Node Enrichment (`parser_node_enrichment_flow`)

**Purpose:** Convert hundreds of structurally-discovered but semantically-thin parser nodes (from `scan_project` native extractors) into rich, intent-bearing graph entities — in one tool call, autonomously.

**Trigger:** `enrich_parser_nodes` MCP tool, typically once after `scan_project` completes.
**Source:** [src/tools/enrich-parser-nodes.ts](../src/tools/enrich-parser-nodes.ts)

| Step | Description |
|------|-------------|
| 1 | Short-circuit with `LLM_UNAVAILABLE` if no provider is configured (no writes occur). |
| 2 | Load `features.json` and `data_model.json` (per `target` arg: `data_model` \| `features` \| `both`). |
| 3 | Filter eligible: `provenance.scanner === "native"` AND (`force` OR `enrichment.enriched !== true`); cap by `max_nodes`. |
| 4 | Bucket eligible nodes by `repo::domain` so each LLM call sees coherent context. |
| 5 | For each bucket, chunk into batches of `batch_size`; pick up to `feature_context_size` sibling features as anchor candidates. |
| 6 | Call the dreamer LLM with strict JSON schema; parse `results[]` per node. |
| 7 | Merge per-node: preserve original `description` into `description_raw`, write `intent` / `purpose` / `tags` / `enrichment{...}`, append validated `feature_anchors` as weak `GraphLink`s. |
| 8 | Atomically persist after every batch (crash-safe) and invalidate cache. Continue on per-batch errors; record them in `errors[]`. |

**Output:** `{ files_processed, total_eligible, total_enriched, total_skipped, batches_run, llm_calls, tokens_used, feature_anchors_written, errors, dry_run }`.

**Architect guidance:** call once with defaults; do not loop. See [tools-reference.md](tools-reference.md#enrich_parser_nodes).

---

## 16. Explorer Curated Mutation (`explorer_mutation_flow`)

**Purpose**: Operator-driven promotion, rejection, or tension resolution applied through the Explorer SPA with optimistic concurrency, mandatory rationale, and a permanent audit trail.

**Steps**:
1. Operator opens the Explorer (`/explorer/`) via the VS Code statusbar quick-pick or directly in the browser.
2. SPA fetches `GET /explorer/api/snapshot` ? receives `{ instance_uuid, etag, ... }`.
3. Operator selects the Tensions or Candidates tab in the right rail. Each row is enriched (endpoints, names, descriptions) and exposes Inspect chips that jump to the Inspector tab.
4. Operator chooses an action � Resolve / Promote / Reject � and a form opens with a `reason` textarea.
5. (Optional) Operator clicks **Suggest** ? SPA `POST /explorer/api/reason-suggest` with `{ intent, subject }`. The Dreamer LLM (`gpt-5.4-nano`) drafts a reason; operator edits as needed.
6. Operator submits the form. SPA `POST /explorer/mutations/<intent>` with headers `X-DreamGraph-Instance: <uuid>` + `If-Match: <etag>` and body `{ <id>, reason }`.
7. Daemon validates the etag. On mismatch ? **HTTP 412**; SPA refetches the snapshot, surfaces a conflict banner, and the operator can retry against the fresh state.
8. On success the daemon applies the mutation (resolve tension / promote candidate / reject candidate), appends a row to `explorer_audit_log.jsonl` with `{ ts, intent, subject, reason, actor, etag_before, etag_after }`, and emits `cache.invalidated` + `snapshot.changed` over `/explorer/events`.
9. SPA receives the SSE, refetches the snapshot, and the affected row disappears from the pending pool. Inspector reflects the new graph state.
10. Subsequent dream cycles see the new validated/resolved state and reason about the graph going forward.

**Concurrency contract**:
- The etag is a content hash of the snapshot. Any concurrent dream cycle, mutation, or schedule that modifies the graph rotates the etag.
- Stale etag ? 412; never silent overwrite.
- Mutations are serialized through the data-file mutex.

---

## 17. Connect a Shared Database (`shared_database_flow`)

**Purpose**: Make a project's primary datastore a first-class graph hub so multi-repo features and workflows visibly orbit around the shared state they touch.

**Steps**:

| Step | Phase | Description |
|------|-------|-------------|
| 1 | Configure | Set `DATABASE_URL` in the instance's `config/engine.env` and restart the daemon. |
| 2 | Auto-seed | On boot, `src/instance/datastore-bootstrap.ts` writes a `datastore:primary` stub into `data/datastores.json` if no real datastore is registered yet. |
| 3 | Sync schema | Click **Sync schema** on the dashboard Datastores card (or call the `scan_database` MCP tool). The daemon introspects via `query_db_schema`, applies denylist filters (`pg_*`, `_prisma_migrations`, junction tables with no FKs and < 3 columns), and writes `tables[]` + `last_scanned_at` back to `datastores.json`. |
| 4 | (Optional) Materialize entities | Run `scan_database({ create_missing: true })` to upsert stub `data_model` entries for any kept table that has no representation. New entries get `id: data_model:db.<schema>.<table>`, `status: introspected`, and a `stored_in` link to the datastore. |
| 5 | Ground the graph | Run a dream cycle with `strategy: schema_grounding`. Stage 1 proposes `stored_in` edges (exact name match conf 0.85, fuzzy 0.55). Stage 2 proposes `shares_state_with` edges between top-level entities in different repos that touch the same datastore. |
| 6 | Surface gaps | The same strategy raises `phantom_entity` tensions (data_models with no resolvable table) and `shadow_table` tensions (tables nothing claims). `dg curate --targets datastores` lists both. |
| 7 | Curate | Address each finding: enrich the `storage` field, run `scan_database({ create_missing: true })`, or add stub entities via `enrich_seed_data`. |

**Inert when unconfigured**: with no `DATABASE_URL`, the dashboard card renders a `NOT CONFIGURED` pill, no auto-seed runs, `schema_grounding` returns `[]` immediately, and the `orphan_bridging` hub-bias bonus is `0` � zero impact on non-DB instances.

<!-- CONTINUATION TEST SLICE 3 -->

### Ashoka configuration save and recovery

For editor agent tool calls, retain the whole MCP owner result before review or compression. A daemon error preserves its literal receipts; a later host failure records a separate error alongside that result. Under budget pressure, omission retains embedded MCP JSON receipts and refuses a budget too small for mandatory anchors. Cancellation aborts the actual request, while effect/termination outcomes still require their owner acknowledgement. UI convenience queries may project text, but that projection is not the agent execution port. Client qualification is pending.

Read `/api/config/v1` and retain its revision. Submit a bounded complete-candidate patch to `/api/config/v1/apply` with that expected revision and a stable operation ID. Inspect the committed receipt and actual effective values; an enforced deployment override or staged restart field can differ from saved intent. Retry an uncertain reply with the same payload/ID. A conflict requires rereading; never overwrite blindly. Template preview has no writes, apply preserves protected values, and undo requires the exact applied revision. See [configuration details](ashoka/configuration.md); future UI and transport qualification remains owning-slice work.

### Session-bound execution and cognitive policy checks

1. Start the daemon on its default loopback interface, or explicitly configure authenticated remote mode and exact hosts/origins. The visible authority status reports the applied boundary.
2. Retain the browser cookie (or native HTTP session header) to resume private selection/preferences/history. MCP transports retain separate sampling/discipline identity; unknown or foreign bindings fail explicitly.
3. Run/stop an Architect pass within its session. Controls resolve the actual active adapter, so a request-selected CLI pass can be cancelled. A different session cannot stop it. Durable restart attachment is the later job-supervisor handoff.
4. For scoped full access, make two separate finite browser confirmations; revocation/expiry fences the Computer Use control port outside the model loop. Native worker/seat behavior must be qualified separately.
5. Inspect [cognitive attribution](ashoka/cognitive-policy-evaluation.md) and run the offline evaluator before policy tuning. Preserve contrary/failure/unknown outputs and the existing normalizer baseline. A named fixture profile does not measure that model, and evaluation mode cannot admit paid canaries.


Ashoka claim validation reads a coherent canonical snapshot and the claim-evidence ledger, resolves exact claim ancestry and current source proof, and keeps generated agreement separate from source corroboration. The qualified publication path must commit candidates, dream status, promotion and evidence together. See [claim evidence](ashoka/normalization-evidence.md); Slice 15 integration is in progress.

Architect native CLI passes obtain an execution-bound daemon policy, qualify installed read-only help, preserve mandatory graph context, dispatch exact approved effects, and return actual command/tool/stop outcomes. General native Computer Use remains separately qualified.

The isolated browser has a separate operator qualification workflow: `dg computer-use qualify --browser-executable <absolute-path> --browser-version <exact-version> --worker-id <id> --out <new-file>`. It exercises disposable local fixtures and durable unknown-action receipts without inference or instance changes. Its source/runtime-bound result does not grant control. Configure a reviewed worker/target separately, then prepare and explicitly confirm a finite scope in Architect. See [Computer Use setup and current limits](ashoka/computer-use.md).

The configuration dashboard's Computer Use tab edits named worker/target profiles through the existing C07 revisioned save and backup authority. Import the exact local qualification, review the closed target profile, save and select those names in engine settings. Architect explicitly prepares either its selected model or the configured Computer Use role and confirms the original finite scope. Its on-demand session drawer reconnects to the owner's original sessions. Pause fences new input and model continuation; Resume refreshes graph and target evidence under the unchanged grant, deadline and budget. Stop stays independently available throughout. These source workflows require installation/restart and do not qualify unsupported native adapters or platforms.

Ashoka Slice 14 [persistent strategy learning](ashoka/strategy-learning.md) stores post-dedup observations and reviewed usefulness in existing `meta_log.json`, with atomic dream/learning publication and explicit fixed-allocation recovery. Source owners include `src/cognitive/strategy-portfolio.ts` and `src/cognitive/dream-deduplication.ts`; repeated generation is neither evidence nor labeled accuracy. Qualification is pending.

Ashoka Slice 16 [curation and retention](ashoka/curation-retention.md) adds append-only dispositions to existing `graph_maintenance.json` and reversible hash-bound archives. The source owner is `src/cognitive/curation.ts`. Reject/retire/reopen, dream decay and quarantine share the graph publication writer; human acceptance remains a human assertion and assessment history is preserved. `mutate_validated_edge` now requires `reason` and `expected_revision` and accepts `operation_id`/`dry_run`; retarget creates a proposal requiring revalidation. Qualification is pending.

## Durable job admission and cancellation (Slice 17, implementation in progress)

1. Accept a payload-bound operation under the existing publication writer; freeze role policies, tariff references, shared parent resources and physical instance storage.
2. Claim conflict lanes durably before dispatch. Nested phases share the same fence and parent allocation.
3. Reserve child inference against both role and parent ceilings before provider dispatch.
4. On cancellation, abort the propagated signal and revoke publication authority. Record termination and effects as unconfirmed until their actual acknowledgement; retain original provider settlement.
5. Recover running jobs as recovery-required without repeating their effects. Scheduler and dirty-stage adoption and qualification remain pending.

For schedule changes, fetch a definition revision, submit it with a stable operation ID, and reuse that identity after an uncertain reply. Create disabled, preview the named-zone occurrences, then explicitly enable. Pause changes future admission; cancellation is an explicit job command and neither erases history nor claims rollback. Dirty-region reconciliation precedes optional enrichment/digestion; verified managed-edit chains can coalesce. Debounce and age fairness select bounded scopes; an unmapped scope remains pending. Metadata-only readiness and event recommendations never silently start paid cognition.

For outbound webhooks, inspect the durable job after interrupted delivery. An unknown response is not a safe retry: obtain the original receiver acknowledgement before releasing its lane. Receivers deduplicate the stable X-DreamGraph-Delivery value. Pausing a subscription or schedule affects future admission; cancellation is a separate fenced operation. Job recovery happens even with scheduling disabled. Manual re-enrichment uses the configured enrichment hop ceiling and shared parent allocation.

### Ashoka temporal observation and foreign import

A tension publication commits actual readings and correlation hypotheses together. Validated local insights export as redacted v2 manifests. Import validates schema/hash/origin, records a payload-bound receipt and either quarantines original bytes or adds speculative records without confidence inflation. Known target changes reuse scoped dirty generations; unknown foreign mappings remain partial and dispatch nothing. Independent local source evidence remains mandatory for normalization.

### Ashoka proposal and evidence review (Slice 19, in progress)

Record a risk and retain its revision; review a concrete proposal before applying it. Action outcomes remain separate from verified resolution. Supply a human disposition rationale or an exact connection verification claim backed by current independent normalization. Affected-region digestion rechecks stored proof and preserves unresolved risk as an honest completed maintenance result. Reappearance keeps the original disposition/history; TTL retirement cannot become a false-positive verdict. Remediation drafting persists advisory selections with durable receipts; corrupt context or failed persistence reports failure.


Ashoka Slice20 is in progress: narrative/playback/lifecycle views consume a revision-bound derived source context and separate historical counts from current proof. Story history is retained in archived_chapters/archived_digests; missing/corrupt published history fails closed. Lucid exploration has a finite session-owned existing engine job lease and durable lucid_log.json intent/actions/recovery. Human acceptance records a rationale and human_assertion with zero independent roots, never inflated confidence or source verification. No source/provider/user wait occurs under the writer. Qualification is pending; see docs/ashoka/lifecycle-narrative.md.

Editor native pass (under qualification): admit the captured instance through `ManagedNativePass`, enable original-host exact review, append the whole current pack after history omission, acknowledge delivery, then call the native provider. Every continuation refreshes/replaces that pack. Model source/graph calls use the owned MCP worker; commands use the daemon's scoped command owner. No local read/write fallback can bypass missing authority. Close the original execution before reporting success/continuing; unknown waits and incomplete source reconciliation remain distinct. Run Command/Run Build palette actions capture the selected authority before prompting and dispatch through the same operator owner. Whole result/closure is retained in the output channel; exit zero does not settle graph debt. Instance changes or missing authority refuse with no local fallback or retry. Palette integration is under qualification.

The native editor waits for unresolved operator acknowledgement before another model request or successful closure. A failed/cancelled round refuses fresh dispatch until its original outcome closes. Known reconciliation debt is reported as pending, distinct from an unconfirmed closure. Explicit message actions now capture their original host/instance and use the same worker lease, without a model request. Changed-file reviews carry a captured ID; Keep checks current bytes, while Undo uses original daemon create/delete with the exact reviewed hash. Source restoration remains separate from graph reconciliation. Lost admission/closure replies preserve the original execution for Check outcome; inspection can retry that same closure without repeating a source action or strengthening termination evidence. Stop cancels the owned wait and discards queued review clicks. These routes have composed qualification in progress, not full Slice 25 acceptance.

Approval review's Check outcome is read-only: it does not retry closure or strengthen termination evidence. Both Architect surfaces inspect the original execution. A known inactive closure can release an unconfirmed acknowledgement while preserving literal receipts; an active/recovery_required/work_pending result cannot. Once authority is revoked, the historical approval stays disabled. This additional expiry/inspection path is under qualification; it must not be confused with operator Undo's captured closure retry.

During editor/SDK execution admission, the host captures exact approved arguments before an asynchronous session handshake. A stopped caller can leave that wait without cancelling other callers sharing it. An endpoint change refuses the original queued request rather than directing it to the new instance; disposal cannot adopt late credentials. This is distinct from execution cancellation: underlying provider/process termination still requires its owner acknowledgement.
The daemon applies the shared tool boundary once per original MCP wire call, before SDK argument stripping. Legacy `.tool` and modern `.registerTool` callbacks retain session/metrics but do not consume a second allowance. The boundary owns permission, schema/version checks, exact approval, effect observation and result normalization. This correction is under qualification against a real entry-point process; it preserves the failed duplicate-fence trace and does not increase an execution's permitted calls.
Plugin contributed handlers receive the original request/execution/lifecycle cancellation signal. Unregister/unload cancels their own contribution rather than redirecting a late call to a replacement plugin. Complete MCP results retain literal media/receipts/error flags; legacy strings/objects keep a text wrapper. Invalid or oversized results are refused whole. A callback returning after cancellation is reported separately from requested cancellation and does not attest private effect rollback/termination. This path is under qualification; plugins remain trusted in-process code, not an OS sandbox.

SDK native execution uses `ManagedGraphPass` over the captured `GraphExecutionPort`: construct/retain the original request ID, begin, hand off and acknowledge the whole canonical checkpoint, then run the native adapter through its existing effect/spend owners. Each continuation prepares refreshed context. The adapter returns its full literal result and explicit owned-work termination evidence; settling a promise cannot confirm private work stopped. Close the original execution and expose its actual reconciliation/receipt state. Lost replies permit original-ID inspection or exact closure retry, never repeated admission/effects or stronger termination. Cancellation and the total pass deadline end waiting while retaining noncooperative work uncertainty. Host credentials are passed outside prompts and never injected into `PluginContext`. These SDK lifecycle paths are under qualification; full Slice25 GE/UX/spend acceptance remains open.

Architect contextual actions retain the object captured when the menu opens. Concern/slice reviews add editable drafts without sending; ADR edits remain proposals bound to their original plan view. Source-only references remain unattested rather than becoming graph IDs. Schedule edit/preview/run/history actions open the existing v2 workspace with the captured ID/definition revision. Missing or changed definitions show an inspection/refusal state without selecting another schedule, editing it or enqueueing work. Normal C11 run/enable preview and admission still apply; Pause retains the captured owner command and changes future dispatch only. Unlinked schedules retain null plan/slice bindings instead of borrowing the selected plan. This expanded action-family integration is under qualification in Slice25.

Native-host inference admission (under implementation): hand off the full current graph checkpoint, retain a logical request ID and pin the native model/adapter/wire contract, then request one original-host permit against the shared ledger before dispatch. Provider credentials and streaming remain native. Report actual optional usage and owned-work termination separately; lost permit acknowledgement cannot authorize a retry, and read-only recovery never launches work. Pricing/run/day limits still come from the daemon's configured Architect role, not model output or a worker. Pending permits prevent a host from closing as settled merely by claiming its callback completed. Client adoption is still required.

An explicit native plan task additionally supplies `plan_execution` to the original managed host. The daemon resolves its reviewed C14 scope against the attached physical project, captures and checks the original plan source, persists the task intent, admits finite execution ownership and assembles the post-admission graph checkpoint before handoff. Selecting a plan or asking about a slice remains context-only. Browser native API/CLI entry points and editor/SDK host requests carry the same intent; workers cannot issue it. Changed source identity/content, stale approval or missing required context refuse dispatch. Closing revokes new work, persists the first C14 close intent and settles local admission accounting outside the graph writer before completing the original close. Cancellation and accounting settlement do not prove remote work stopped. An unconfirmed stop retains recovery; a lost reply replays the original saved command without new native authority. Native completion never marks implementation or verification passed.

Native Computer Use inspection: open the editor drawer, discover sessions owned by the captured native connection and select an original session. Read its target, interaction host, route, expiry, usage and last receipt before a control. Pause/resume use the current original fence; Stop uses the independent original channel and can bypass a pending read or pause wait. Changed endpoints, instances or page snapshots refuse instead of switching targets. An unconfirmed control retains the original identity for readback; missing workers remain recovery. Selection grants no authority, and the inspection port cannot prepare, confirm or start work. Full editor Computer Use execution and pixel inspection remain integration work; see [the current checkpoint](ashoka/computer-use.md).

Read-only matched answer collection: initialize a separate fixed evaluation ledger, freeze both source/graph contexts, preview the exact model/retention/tariff/run/day disclosure, obtain explicit original-operator approval, then collect through the core job/provider admission. Inspect original partial answers after failure; no failed-job redispatch, automatic scoring or live graph mutation occurs. See [admitted agent evaluation](ashoka/admitted-agent-evaluation.md) for the bounded workspace helper and remaining full task/understanding acceptance.
