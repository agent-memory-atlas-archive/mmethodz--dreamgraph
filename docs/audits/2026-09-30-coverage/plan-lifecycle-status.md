# Coherent plan lifecycle and status management — v14.0.0 - Ashoka

Date: 2026-09-30  
Status: proposed implementation contract C14; runtime fixes are pending.  
Owner: core/daemon plan and discipline authority.  
Delivery: expand existing Slice 21; consumer integration in Slice 25; release regression gate in Slice 27. Preserve all 32 current slice identities in the [canonical plan](../../../plans/graph-trust-and-agent-effectiveness.md).

## Problem and observed evidence

The supplied Architect screenshots show a draft, idle plan with no completed slice, while both Active and Next point to pending Slice 0. The sidebar shows pending statuses independently of the summary. A read-only call to the existing built `loadPlanDetail` reproduced the first inconsistency for this plan: 31 pending slices at that earlier revision, zero checkpoints, `draft`, `idle`, and the same Slice 0 ID in current, active and next. This is a baseline defect, not a test of the proposed fix.

Source inspection explains several independent causes:

| Existing path | Problem to address |
|---|---|
| `buildOperationalState` in [plan-registry.ts](../../../src/architect/plan-registry.ts) | Falls back from latest implementation to next pending slice when assigning active/current, even before execution begins. |
| `derivePlanLifecycle` | Does not preserve blocked/verifying; any implementation checkpoint can force implementing, while raw completed status can bypass evidence checks. |
| `isImplementationCheckpoint` / `isCompletedCheckpoint` | Generic recorded activity counts as implementation; implemented and verified are both treated as completed. |
| `checkpointCompletedSliceIds` | Unions historical completion claims, including ordinal ranges and prose mentions; a later reopening cannot reliably revoke completion. |
| `findNextSliceFromResume` | Uses a prose resume hint or document order, without dependency or approval eligibility. |
| Slice sidebar in [routes.ts](../../../src/architect/routes.ts) | Reads raw `registry.slices[].status`; the summary reads operational state. Existing completed styling therefore need not receive the effective status. |
| `buildArchitectFutureReviewProjection` in routes | Independently falls back to the first slice and finds next using a raw-status regex. |

The current completed style already dims the whole card to opacity 0.56. Replace that treatment with readable muted colors when implementing this contract; adding another CSS rule alone would leave the underlying drift unresolved. These source findings extend F15. Other client behavior still needs the conformance tests below.

## One owner, one projection

Extend the existing plan registry and discipline persistence. Core owns a versioned plan definition, typed transition/checkpoint records and a deterministic status reducer. Every read surface consumes its resulting `PlanStatusProjection`; no browser, CLI, prompt builder, analytics module or extension infers lifecycle independently from headings, prose, counts or process exit.

Markdown remains the portable, human-editable plan definition and the paired log remains inspectable evidence. Preserve the recognized `### Slice N — Title` headings and existing slice IDs. Add explicit IDs/metadata through the supported parser when needed; renaming or moving a heading must not change identity after import. Files edited outside DreamGraph are proposed definition changes, ingested with a content hash and reconciliation, not a second live authority. Exported status text is a projection, not an alternate writer. Retain original bytes and source spans for legacy reconciliation.

Persist typed transitions through the existing discipline/plan authority and its commit mechanism, using operation IDs, actor/session, instance/project/plan IDs, expected definition/state revisions, exact slice IDs, reason, evidence references and monotonically assigned event sequence. Timestamps are for display, not ordering concurrent transitions. Identify audit, design review, implementation, verification and release events explicitly. An audit session completing does not complete a plan or slice. A discipline session may cover several slices; a slice may have several sessions. Record that relationship rather than equating either identity or status.

The reducer has no LLM/prose interpretation and cannot write during a read. Rebuild it deterministically from committed state/history. Use the existing persistence journal/transaction boundary under C04 for the typed event and its materialized projection; publish a revision only after durable commit. A missing receipt, corrupt projection or interrupted migration returns recovery-required/unknown with provenance rather than a fabricated pending or complete state. This is not a new scheduler, general event platform or parallel status database.

## Separate the meanings currently called active

| Field or concept | Canonical meaning |
|---|---|
| Selected plan/slice | This client's inspection or chat focus. It is session-owned view state and never starts work or changes implementation status. |
| Plan lifecycle | Explicit governed stage: draft, planning, reviewed, implementation_ready, implementing, verifying, blocked, completed, archived or superseded. |
| Current slices | Work explicitly begun and still owned by the plan workflow, including paused, blocked, implemented-awaiting-verification and verifying work. A suggested future slice is not current. |
| Active/running slices | Slices with a live admitted implementation or verification execution lease. Every entry names execution ID and owner; planning/chat/review-only jobs do not create active implementation slices. |
| Next slice | First unstarted candidate from the dependency-aware queue, excluding all current/active/resolved slices. Includes eligibility and gate reasons; recommendation does not grant permission to start. |
| Last completed slice | Most recent still-valid verified slice by committed verification sequence, not highest ordinal or most recent mention. Reopening removes it from current completion and retains its historical event. |
| Resume action | Typed continuation such as resume current, resolve blocker, verify implementation, review plan, start eligible candidate or recover interrupted execution. Prose explains this decision; it does not override it. |
| Phase | Explicit plan phase/group membership, separate from discipline INGEST/AUDIT/PLAN/EXECUTE/VERIFY and cognitive engine state. Do not derive it from a slice number or a title containing Level N. |

Expose arrays for current and running work. A legacy scalar current field is the sole current slice, or an explicitly assigned primary current slice; otherwise null with a multiple-current reason. A scalar active field is populated only when exactly one slice is running. Clients that cannot represent parallel work receive an explicit compatibility limitation. Never pick the latest global session arbitrarily.

Default to one implementation/verification execution per plan and at most one mutating lease per slice. Multiple daemon connections and independent plans remain supported. Concurrent slices require explicit approved parallel scopes and the existing write/resource guards; a second tab does not confer that approval. Current work may accumulate after an explicit pause/switch, with its ownership and reasons preserved. Selection and cancellation remain scoped to the correct client/execution under C09.

## Lifecycle and transitions

Plan lifecycle records design/execution stage; job state records whether a process is running, cancelling, failed, timed out, cancelled or recovering. An idle plan may still be implementing because it has unfinished work. A failed job does not erase committed progress, approve a slice or complete the plan. Report the last attempt separately from current activity.

| Command/event | Preconditions | Result |
|---|---|---|
| Begin planning / submit review | Named plan revision and actor | draft → planning; recorded review → reviewed. Reading or chatting alone does not advance either. |
| Approve implementation scope | Reviewed definition, explicit scope/owner and required gates | reviewed → implementation_ready; store approval against the scope and definition digest. Existing owner authorization remains valid within that unchanged scope. |
| Start slice | Valid approval, satisfied dependencies, no conflicting lease; expected revisions match | Slice pending → in_progress; lifecycle → implementing; current gains slice; active gains it only when execution is admitted. |
| Pause / cancel attempt | Scoped owned execution; cancellation and committed effects reconciled | Active clears after the lease ends; current work and evidence remain. Last attempt is paused/cancelled; slice does not become verified or vanish. |
| Block / unblock | Typed reason, scope and resolution evidence | Slice → blocked with saved prior state. Plan → blocked only for an explicit plan-wide gate or when all remaining approved paths are blocked; retain underlying stage. Clear the specific gate before returning to that stage. |
| Record implementation | Durable change receipt/evidence | Slice in_progress → implemented, visibly awaiting verification. Exit code zero and assistant prose cannot do this alone. |
| Begin / finish slice verification | Acceptance criteria and implementation/evidence revisions fixed | implemented → verifying → verified on recorded passing evidence and required review. Failure → in_progress or blocked with failed verification retained; never verified. |
| Begin final plan verification | Every required slice resolved by verified evidence or a specifically accepted deferral | Lifecycle → verifying. This is a separate gate; all slices being verified does not automatically complete the plan. |
| Complete plan | Current definition accepted, valid required evidence/deferrals, final integration/release checks and required review passed, no active or recovery work | verifying → completed; current/active/next clear. Only a typed accepted completion can produce this state. |
| Reopen / revise scope | Authorized change with reason, affected definition/evidence hashes and expected revisions | Verified slice loses effective completion; plan completion is revoked. Return to implementing if revised work remains authorized, otherwise planning. Mark affected downstream verification stale pending impact review. |
| Archive / supersede | No live or unreconciled executions; explicit reason and successor for supersession | Read-only terminal presentation; retain prior lifecycle, evidence and links. Refuse or drain/cancel explicitly before transition; never hide a running job. |

Slice workflow values are `pending`, `in_progress`, `blocked`, `implemented`, `verifying`, `verified` and `deferred`. Readiness, verification freshness and job outcome are independent fields. A cancelled attempt is not a cancelled implementation; permanently removing scope requires a reviewed definition change or deferral. `deferred` names owner, reason, impact and the specific acceptance/dependency waiver; it is not colored or counted as completed. A deferral without an accepted waiver leaves release and affected dependencies unsatisfied.

Plan-wide blockers are evaluated by the reducer using explicit gates and remaining approved paths. A blocked branch cannot mask an independent running branch: show implementing plus the blocked count when useful authorized work remains. A plan can retain lifecycle blocked while a narrowly scoped diagnostic job runs; it cannot silently resume implementation through the gate. Archived/superseded and accepted completion take precedence only after their invariants are met; otherwise surface a reconciliation conflict. Progress counters never choose lifecycle.

Approved scope is bound to content hashes, not every cosmetic edit or a blanket whole-plan permission. Editorial changes preserve approval; acceptance, dependency, authority or scope changes invalidate affected approvals until reviewed. Retain valid unaffected evidence with an explicit carry-forward mapping. Reopening a dependency makes dependent verification stale until reviewed; it must not silently erase historical work or claim that all downstream code needs rewriting.

## Choosing current, next and progress

Current is set by start/resume/assignment events and cleared by verified completion, accepted deferral or an explicit release of ownership. Merely selecting another card leaves it unchanged. Beginning final plan verification can have no current slice; its execution is plan-scoped and is shown as such.

Validate dependency IDs and cycles on definition ingestion. A missing or ambiguous dependency blocks affected work with a diagnostic. Calculate the next candidate from unresolved, unstarted slices whose dependencies have valid verified outcomes or explicit accepted dependency waivers. Exclude current work even when paused/blocked. Order by explicit approved queue priority, then stable declared order, then ID. Resuming current work is a separate recommended action. Do not advance numerically past unfinished prerequisites or use a resume-note regex. In this plan, release Slice 28 depends transitively on Slices 29 and 30 despite its lower number.

Return both candidate and eligibility: a draft may suggest Slice 0 but must say `awaiting_implementation_approval`, `can_start: false`. If the current plan lease is occupied, a dependency-ready next candidate says `awaiting_plan_capacity`. If no candidate exists, return null and a reason such as dependencies_blocked, all_remaining_work_current, final_verification_required, completed or reconciliation_required. A blocked next candidate never looks ready. Start requests revalidate admission at commit time; a preview is not a reservation.

Progress uses unique slice identities, never checkpoint count. Show verified/required, implemented-awaiting-verification, current, blocked and accepted-deferred separately. Phase headings are not implementation slices. Include denominator/definition revision; scope expansion may legitimately reduce completion percentage. Last completed is a valid verification, not a deferral. Unknown history is excluded from verified counts and displayed separately.

For the supplied draft screenshot the required projection is:

```json
{
  "lifecycle": "draft",
  "execution": "idle",
  "current_slice_ids": [],
  "active_slice_ids": [],
  "last_completed_slice_id": null,
  "next_slice_id": "slice-0-establish-the-engine-alignment-contract",
  "next_eligibility": { "can_start": false, "reasons": ["awaiting_implementation_approval"] },
  "progress": { "verified": 0, "required": 31 },
  "resume_action": "review_plan"
}
```

This is the target contract example, not current daemon output. The compact UI says “Current: none”, “Running: none”, “Next: Slice 0 · awaiting approval”; it never calls that candidate active.

## Versioned read/write and client convergence

Generate schema/SDK artifacts for the shared projection under C01/C02. Include instance/project/plan identity, schema version, definition revision/digest, state revision, event sequence, source/reconciliation status, as-of time and freshness. The projection contains lifecycle and reason, underlying blocked stage, execution summary and attempts, slice records with effective state/reason/verification/evidence, current/active/next references, phase memberships, progress, resume action and permitted next actions with gate reasons. Every referenced status is a view of that same slice record, not a copy reconstructed from Markdown.

Use a compact summary and a detailed/paged view from the same reducer/revision. Do not ship full history on every list read. Core computes the complete totals and selection decisions before paging. A detail cursor, event stream and summary carry revisions so clients cannot combine rows from different states. Retain C03 scope/permission/freshness semantics and protect sensitive evidence references.

Commands carry an idempotency key and expected definition/state revisions. Commit validates transition, admission and evidence once; success returns the durable receipt and resulting projection revision. Duplicate identical calls return the prior result; conflicts return current revision and a reviewable difference. Do not overwrite another session's selected plan, scope, lease or last checkpoint. A browser may show “saving”, but cannot locally announce completed/verified before the receipt.

Publish committed updates through existing daemon events. On reconnect fetch the authoritative snapshot, then resume events with a revision/sequence watermark; duplicates and older events are ignored, gaps trigger refetch, epoch change triggers a fresh snapshot. Apply plan summary, header and slice list atomically for the selected revision. If a newer summary arrives before detail, show refreshing/stale detail rather than contradictory definitive labels. Disconnected views disclose their as-of revision and cannot authorize transitions from cache.

Consumers: Architect left plan list and filters, header chips, right slices, Living Plan panel, pulse, adaptive future review, resume text, chat/tool context and task memory; daemon/API/MCP reads and governed actions; CLI; VS Code Architect; dashboard and analytics wherever they expose plan progress. Shared vocabulary and semantic fields are mandatory; presentation may differ. Living-plan hypotheses and cognitive lifecycle remain separate concepts and cannot overwrite implementation status. Remove first-slice fallbacks and client regex status inference after negotiated adapters are in place.

Slice 21 consumes durable receipts/session/command authority from 5/11/12. Before 21 exists, stable reviewed IDs and evidence in the existing discipline/log govern implementation; import that history without inventing typed verification. Commit typed status plus a durable Markdown export obligation together. Verification checks the declared material project effects; its own status event/export bookkeeping cannot require itself to be verified recursively. Failed export remains visible/retryable and blocks destructive archive until history is safe. External definition changes use hashes, reviewed import and affected approval/evidence invalidation. Optional digestion stays separate; shared state means same answer at the same revision, not identical UI timing.

## Compact Architect treatment

| State | Right-sidebar slice treatment |
|---|---|
| Verified, evidence current | Dimmed surface/border and muted readable title; check icon and “Verified”. Avoid whole-card opacity that also makes links unreadable. |
| Running implementation/verification | Restrained green left edge and lightly tinted background; “Running” or “Verifying” text with activity icon. Show the execution owner in details. |
| Current but paused / awaiting verification | Small “Current” marker plus exact state; neutral styling, no green running signal. |
| Blocked / failed verification / recovery needed | Amber or error accent with explicit reason and next recovery action; never a completed checkmark. |
| Pending / next candidate | Neutral; “Next · ready” or “Next · awaiting …” from eligibility. Suggested next is not green. |
| Accepted deferral / unknown legacy status | Explicit “Deferred” / “Needs reconciliation”, visually distinct from verified completion. |

Selection has a separate outline/focus treatment, so a selected completed card remains visibly completed and a selected pending card does not look active. Keep title and one short status line; move redundant full heading paths and evidence detail into expand/inspect. Provide compact All / Open / Completed filters with counts, preserve stable order and scroll, and a “Jump to current” action. Do not hide completed slices by default or automatically jump the list on every event. All actual running slices get the activity treatment if parallel work is authorized.

Status must remain understandable without color. Keyboard focus, accessible names, contrast on muted text, reduced motion and high-contrast modes are required. Avoid permanent animation, bright green whole-card fills and extra vertical padding. A count change and selection update should not flood screen-reader announcements. Failed saves and stale/reconnecting state remain visible without discarding context.

## Legacy reconciliation and rollout

1. Inventory every producer/consumer and capture fixtures from pending, active, completed, blocked, reopened and ambiguous real plan/log pairs. Preserve source files, IDs and hashes. The v14 plan itself is the zero-checkpoint draft fixture.
2. Introduce the typed state contract and reducer in the existing authority with offline transition fixtures. Classify legacy `implemented` as awaiting verification; `completed` is a historical claim until evidence is reconciled. Unknown status and prose ranges do not become verified facts. Explicit verification records can be imported with their evidence and declared limits.
3. Run a read-only shadow projection comparing every field against legacy output; classify expected corrections versus regressions. Present reconciliation proposals for contradictory declarations/history and required human decisions. Do not “repair” all pending Markdown labels from inferred success.
4. Commit reviewed migration per plan with backups, expected hashes, typed provenance and an idempotent receipt. External editor changes during migration produce a conflict. Keep unknown/ambiguous plans readable with transitions blocked only for the affected scope.
5. Switch all consumers to the versioned projection, including future-review/prompt paths; instrument projection mismatches and stale clients. Publish prior-major mapping limitations. There is one writer throughout cutover.
6. Rebuild after restart and prove equivalence. Roll back readers through the supported adapter; after new transitions, do not restore an old file and discard them. Use tested forward repair or journal-aware reconciliation under C10. Remove legacy inference only after the compatibility window and conformance evidence permit it.

Use U0–U8 for definition, checkpoint, discipline/session and export migration. Preserve authored bytes and unknown old claims; missing verification is not completed implementation. Definition/import/export events carry lineage to avoid re-ingesting them as independent evidence. Scan recency never reopens a verified slice: reopen only from relevant changed acceptance/evidence, explicit owner action or actual unresolved material-effect obligations.

## Acceptance matrix — required, not yet run

| Case | Fixture/action | Mandatory result |
|---|---|---|
| PL01 | Supplied 31-slice historical draft and current 32-slice draft, both pending with zero checkpoints | No current/active work; next Slice 0 is approval-gated; every surface agrees on draft/idle. |
| PL02 | Audit-only session, plan review and generic prose log entries | No implementation start, completion count or running slice manufactured. |
| PL03 | Approve bounded scope, start, pause, resume, cancel attempt | Valid typed transitions; current survives interruption, running follows lease, cancellation preserves committed evidence. |
| PL04 | Implemented, verification running, verification failure, later accepted pass | Implemented is not verified; failure retains reason; only passing accepted evidence dims/checks completion. |
| PL05 | Block one branch, block whole plan, unblock with valid evidence | Correct stage/underlying stage and reasons; independent authorized work stays usable; no skipped blocker. |
| PL06 | Non-numeric dependency order, missing dependency, cycle and false resume hint | Deterministic eligible queue; errors block affected work; Slice 28 cannot outrun 29/30/31 or any dependency closure; use the actual DAG. |
| PL07 | Earlier verified slice reopened; negative prose says “Slice 3 not completed” | Completion is revoked where appropriate; downstream evidence is stale; prose does not mutate status. |
| PL08 | Every slice resolved, final verification fails/passes; accepted deferral | Separate plan verification/review gate; no automatic completion; waived scope stays distinct with impact. |
| PL09 | Archive/supersede with active job, then after quiescence; reopen completed plan | Reject unsafe terminal transition; preserve history/successor; reopening invalidates completion correctly. |
| PL10 | Two clients, other project, identical/different idempotency payload, revision conflict | Scoped ownership; no cross-plan writes or duplicate transition; useful conflict/receipt; no lost update. |
| PL11 | Crash before/after commit, lost reply, restart with expired running lease | One durable outcome; reconcile actual execution before idle/recovery; no ghost green running card. |
| PL12 | SSE duplicate/out-of-order/gap, reconnect, paged detail, old cached prompt | Consistent revision or visibly stale state; atomic client update; refetch without false completion. |
| PL13 | Heading rename/reorder, external Markdown edit, unknown/ranged legacy checkpoints | Stable IDs, explicit reconciliation/approval impact, no accidental success or erased history. |
| PL14 | Permitted parallel slices, stale owner, selected slice differs from current | Accurate arrays/primary semantics; single-writer leases; selection cannot steal work or change progress. |
| PL15 | Dense sidebar with all states, long titles, keyboard/high contrast/reduced motion | Muted verified and restrained green running cards remain readable and navigable; compact layout and no color-only meaning. |
| PL16 | Same transitions read through browser/API/MCP/CLI/VS Code/task memory | Same IDs, lifecycle, effective slice states, next gates and revision; repeat AT01 and AT05 on both project fixtures. |

Use deterministic offline reducers, a fake executor/clock and disposable persisted state; no paid model is needed. UI tests must assert actual transitions and revision convergence in addition to styles. Exercise command rejection and crash recovery, not just rendered strings. Attach source/fixture hashes, actual results and unresolved limitations to Slice 21's checkpoint; Slice 25 owns the full consumer matrix and Slice 27 enforces the release gate. The 12 AT01–AT06 project cases remain separate from these 16 lifecycle scenarios.
