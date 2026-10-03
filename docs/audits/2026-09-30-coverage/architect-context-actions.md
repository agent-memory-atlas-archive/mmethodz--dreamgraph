# Architect contextual actions and selected-plan navigation — v14.0.0 - Ashoka

Date: 2026-09-30  
Status: proposed contract C16, part of the [unified Ashoka plan](../../../plans/graph-trust-and-agent-effectiveness.md); implementation is pending.  
Owner: Slice 25's Architect/client integration owner. Slice 21 supplies lifecycle and stable target identity; Slice 29 supplies scheduler workflows; Slice 27 gates release.

## Intent and existing behavior

Make actions available where the user encounters an object: a plan, slice, concern, schedule, ADR or evidence reference. Menus should help the user inspect, understand, navigate and take the next valid action without filling the interface with permanent buttons. Keep the established compact charcoal workbench and C14 state styling.

Source review of [Architect routes](../../../src/architect/routes.ts) found no browser-shell `contextmenu` handler. ADR cards already offer governed proposal editing, and schedules already receive daemon-produced action templates. These are foundations to reuse, not reasons to introduce another mutation path.

`focusPlanButtonInRail` already calls `scrollIntoView({ block: 'center', inline: 'nearest' })` during `loadPlan` and initial `loadPlans`. Filter handlers call `renderPlanTree(activePlanId)` without revealing the rebuilt selected row. Filtering can remove that row, and `loadPlans` only resolves requested selection through visible results. This explains plausible failure paths; the full runtime cause of the user's scrolling problem still requires browser reproduction. Do not claim centering is entirely absent or solved by adding a duplicate helper.

The custom arrow selectors target `.architect-right-accordion > summary`. Nested `.living-plan-foldout > summary` uses flex layout without an explicit custom arrow; Nervous Points is one such nested foldout. The reported invisible affordance is consistent with this source, but cross-browser rendering remains to be tested.

## A small, coherent action surface

Use one shared contextual-action resolver and existing command dispatch. Describe actions with stable command ID, label, target kind/identity, group/order, availability/reason, optional shortcut, and whether they navigate, draft a request or submit a governed operation. Canonical mutation eligibility comes from daemon/C14/C11 state; local helpers add view/copy actions. A label or menu is never a new authority.

Ordinarily show four to six actionable rows, with at most two subtle separators. Six is the default ceiling, including any overflow entry; short menus are preferable when fewer actions apply. No cascading submenus in the initial implementation. An uncommon operation lives in the existing detail/editor workflow, reachable by Open/Inspect, rather than being repeated on every object. Do not build a general plugin menu platform for this slice.

| Target | Default useful menu, ordered by task | State-specific behavior / detail workflow |
|---|---|---|
| Plan | Open plan; Reveal current slice; Open implementation log; Ask Architect about this plan; Copy reference; Archive… | No current slice shows a concise reason. Open does not toggle selection off. Archive uses the existing lifecycle/active-execution gate and retained history; no delete-plan shortcut. |
| Slice | Open slice; Dependencies & blockers; Show affected graph; Continue / Review…; Ask Architect about this slice; Copy reference | The fourth row is one state-appropriate action from C14: Continue, Resolve blocker…, Review implementation…, or Review verification…; completed work offers evidence review, with Reopen inside the governed review workflow. Never a blind Mark done action. |
| Nervous point / open question | Inspect evidence; Find related slices; Ask Architect about this concern; Review concern…; Copy reference | Review can link evidence, propose a bounded follow-up or record a resolution with rationale. Acknowledged, mitigated and resolved are distinct; concerns are not automatically graph tensions or facts. If no links exist, offer scoped investigation rather than invented relationships. |
| Schedule | Edit schedule…; Preview upcoming runs; Run now…; Pause / Resume; View run history; Copy reference | Pause/Resume is a single row for the current definition. Run uses normal C11 scope/readiness/budget admission. Cancel an active execution, Duplicate and Archive remain in the run/detail editor. Pause never cancels implicitly; duplicate remains disabled until enabled through C11. |
| ADR | Open decision; Show affected graph; Propose change…; Ask Architect about this decision; Copy reference | Reuse existing proposal editor and status/history display. Editing an accepted ADR opens a proposal, not an immediate overwrite. Superseding/deprecating remains a reviewed decision workflow. |
| Graph binding / evidence / checkpoint / run | Open or Inspect; Show related evidence where applicable; Ask Architect about this item; Copy reference | Use the same small pattern, retaining source/graph revision and provenance. A failed run may expose Retry… in details; a checkpoint cannot be converted to verification with a menu click. |

This is a prioritized action catalog, not a requirement to display empty or irrelevant items. Hide unrelated actions; keep a likely action disabled when its reason helps the user understand a gate, such as “Awaiting verification” or “Daemon disconnected”. Labels name the actual result. “Ask Architect” inserts an editable prompt and typed target chip into the composer, preserves existing draft text, and requires the normal send action. Opening a menu must not send a model request, schedule cognition or silently expand scope.

Copy reference uses the existing/versioned canonical plan/entity/ADR reference and navigable link where supported, with identity/revision available to the receiving client. Do not invent a URL route that does not resolve. Clicking the primary card or link remains the fast normal path; menus are an additional entry point and are never the sole way to reach a critical command. Preserve context menus owned by embedded editors/terminals and the browser's text, input and ordinary-link actions.

## Correct target, existing governance

Capture a target descriptor when opening the menu: instance/project, kind, stable ID, plan/slice IDs where applicable, relevant definition/state revision and source anchor. Right-clicking a plan or slice does not select it, change chat scope or start it. Commands act on the captured target, even if another plan is selected; they must not read a later mutable global `activePlanId`. Labels and any action preview show the actual target. Selecting/opening another plan is itself an explicit navigation command.

The existing `buildScheduleActionTemplates` supplies `phase-6-afe-and-scheduler-integration` when a schedule has no linked slice. C16 integration must preserve an honest unlinked state and request an explicit binding only if the chosen operation requires one; do not pass that placeholder as the target of new menus. Source presence establishes the fallback, not proof that every current schedule operation is misrouted.

Nervous points currently project as text. Slice 21 must supply stable concern identity or a plan-revision-bound source-section/content anchor. Do not use visible array index, truncated title or free-text equality as mutation identity. Renames/reorders retain identity where possible; ambiguous legacy anchors remain inspectable but status-changing actions require reconciliation. A concern resolution updates the authored plan/evidence through existing authority and records what supports it; hiding/collapsing the item is not resolution.

Menu availability is a snapshot. On command invocation, the daemon checks current permissions, revision, target existence and action eligibility; reuse C04/C09/C11/C14 receipts and idempotency. A stale menu yields a specific refresh/conflict response, not a mutation against a replacement target. Close or invalidate the menu if its target disappears or relevant state changes. Double activation cannot duplicate an operation. Return committed status and refresh the affected views from the same revision.

Reuse the command's existing preview/review/confirmation requirements. Inspect, copy, navigation and composer drafting do not need an extra confirmation. A context-menu entry adds no blanket approval and no duplicate confirmation flow. Archive, run-now, reopening and decision proposals retain their existing gates. C13 autonomy/verbosity and C15 graph-context/reconciliation obligations also apply to work initiated from a menu.

Keep basic copy and already-loaded inspection usable offline, with as-of state visible. Mutation availability explains connection/authority limits. Show errors next to the originating object or existing status area and preserve the user's draft, selection and scroll. Do not optimistically mark a slice verified, resolve a concern or hide an archived plan before a committed outcome.

Menu eligibility carries captured instance/target/definition/state revision, command identity and reason from the owner, with permission rechecked at invocation. Shared rendering cannot accept a status inferred from a different revision. Slice 29 provides schedule commands before 25 renders shared menus; 23 consumes that implementation instead of creating an implicit 25↔29 cycle. Selection/reveal/disclosure are view actions, not new plan authority or graph invalidation.

## Interaction and visual treatment

Support right-click on the object surface, the keyboard Context Menu key or Shift+F10 on a focused object, and a small overflow button visible on hover/focus and always discoverable on touch/coarse pointers. The overflow button names its target accessibly and is a sibling of other buttons, not an invalid nested button. It must not trigger the card's selection/deselection handler.

Use a compact anchored popup: charcoal surface, fine border, restrained shadow, readable labels, short disabled reasons and consistent small icons. Desktop rows are approximately 24–28 pixels; coarse-pointer rows can be larger without changing the desktop density. Keep the complete command label when space permits; long target names can live in a concise heading with full accessible text/details. Green remains a running-state cue under C14, not a generic menu selection color.

Clamp or flip the popup inside the visible viewport/scroll boundary; portals prevent clipping by sidebar overflow. Handle browser zoom, narrow windows, long labels and bottom-edge invocation. Only one custom menu is open. Escape/outside click closes it; arrow keys, Home/End and typeahead navigate; Tab closes it and continues normal focus order. Restore focus to the invoking object when appropriate, with a fallback if it was removed. Do not trap focus as if this were a modal or steal focus from an unrelated open dialog. Preserve readable disabled states, high-contrast behavior, reduced motion and screen-reader semantics.

## Visible Nervous Points disclosure

Give Nervous Points and the neighboring Open Questions foldout an explicit, consistent chevron: right when collapsed, down when expanded. Apply it to nested foldouts as well as outer accordions, hiding the native marker only when its replacement is present so there are no duplicate or missing indicators. Keep count and label aligned; the arrow should not add a large indentation or vertical padding.

Retain native `details`/`summary` keyboard behavior and accessible expanded state, or an equivalently correct disclosure implementation. The whole summary row toggles; a separate overflow control must not toggle as a side effect. Remember foldout openness per client/plan across ordinary re-renders, without treating that UI preference as graph state. In either state, the user can tell that the section expands.

## Find the selected plan without fighting the scroll

Center the selected plan in the plan-browser rail on initial selection restoration, an explicit new selection/deep link, and explicit reveal after opening the collapsed rail. Wait until the matching row is mounted and its group is visible. Scroll only the rail's scroll container; leave page, chat, editor and right-sidebar positions unchanged. Clamp near list ends when exact centering is impossible. Prefer no animation on initial restoration and honor reduced-motion preferences.

Add one compact “Reveal selected plan” control beside the plan-browser search/filter area, with an accessible label and disabled/no-selection state. It reuses the same ID-based reveal behavior and never starts or changes the current implementation slice. It is distinct from C14's “Jump to current” within the slice list.

Selection belongs to the session and is independent of filtering. Filtering, group rebuilding or paging must not silently clear it or choose the first visible plan. When filters hide the selected plan, show a compact “Selected plan is outside filters” indication. Explicit Reveal temporarily includes one clearly labeled selected-plan row outside the filtered result set and centers it, preserving the user's filters; remove that exception when it matches naturally, selection changes or the user dismisses it. Do not duplicate the selected row or miscount filtered results. Expanding an existing collapsed ancestor is a view-only action.

Automatic centering runs once for a genuine selection/restore intent. Ordinary status events, action completion, background refresh, typing filters and unrelated renders preserve scroll; users browsing other plans must not be snapped back. Guard asynchronous loads/reveals with current selection and render generation. An old request or stale DOM node cannot pull the rail to the previously selected plan. Restore through the stable plan ID after rename/reorder, never a remembered pixel offset or row index.

Test with hundreds and at least 1,000 variable-height plans, long titles and rapid selection/filter updates. Preserve a logical scroll anchor across incidental updates. If paging or virtualization is present/needed, resolve the selected ID to its page/index before scrolling and verify after mount with bounded retries; do not fetch/render unlimited pages in a loop. No selection shows Project Scope honestly; a removed/inaccessible selected plan shows that condition without switching to another plan or leaking restricted details. Initial restoration must not move keyboard focus out of the composer.

## Delivery and acceptance

Slice 25 owns the shared menu/view-action layer and selected-plan reveal, extending the current shell rather than creating another UI framework. Slice 21 supplies target identity, lifecycle actions and concern reconciliation; Slice 12 supplies shared command metadata/contracts; Slice 29 supplies the scheduler editor/action integration. Slice 23 adopts the shared behavior where configuration/schedule surfaces overlap. Slice 27 verifies the following scenarios; Slice 28 documents the supported actions and navigation behavior. Dependencies take precedence over numeric slice order.

| Case | Scenario | Required outcome |
|---|---|---|
| UX01 | Plans/slices/concerns/schedules/ADRs and evidence targets | Relevant four-to-six-row menus use real commands; no empty universal menu or accidental model execution. |
| UX02 | Right-click a nonselected plan while another is selected; selection changes with menu open | Captured target/revision wins or becomes stale; no implicit selection, deselection, cross-plan mutation or wrong-target ask. |
| UX03 | Lifecycle/schedule/permission changes; deleted target; double activation; network loss | Fresh authority check, idempotent receipt, useful conflict/error; no optimistic verified/resolved state. |
| UX04 | Mouse, keyboard, touch, ordinary links/text and embedded editor menus | All commands discoverable without right-click; correct focus/navigation; native selection/copy/editor behavior preserved. |
| UX05 | Narrow viewport, zoom, bottom/right edges, long labels, high contrast/reduced motion | Popup stays visible/readable; no overflow clipping, focus loss or oversized desktop padding. |
| UX06 | Nervous Points/Open Questions collapsed/expanded and refreshed on two plans | Visible right/down chevron, correct accessible state, no duplicate marker, count alignment and per-plan view-state retention. |
| UX07 | Restore/deep-link/select a plan among 1,000 variable-height entries | Correct ID centered or edge-clamped after mounting; unrelated scroll/focus untouched; repeated renders do not re-center. |
| UX08 | Selected plan hidden by filters/group/page, then Reveal | Selection and filters retained; one labeled exception row or correct mounted group; no first-plan substitution or duplicate count. |
| UX09 | Rapid A→B selection, delayed A response, rename/reorder and background status updates while browsing | B remains selected; stale work cannot scroll back to A; logical scroll anchor survives unrelated updates. |
| UX10 | Ask from a concern/slice with an existing composer draft | Draft preserved with explicit editable target reference; no send/spend before normal submit; C15 evidence scope retained. |
| UX11 | Continue/Review, Run now/Pause, ADR proposal and concern resolution | Existing C14/C11 governance and C13/C15 execution behavior apply; proposal, acknowledgement and verified result remain distinct. |
| UX12 | Missing/stale nervous-point identity, offline view, removed selected plan and reconnect | Honest unavailable/reconciliation states; safe copy/inspection remains; no fabricated identity, lost draft or wrong-plan mutation. |

These are future implementation requirements. Use a real browser harness for scrolling, keyboard/menu/disclosure behavior and focus, with a fake daemon/executor for state races and no paid model calls. DOM string assertions and calling `scrollIntoView` in a stub cannot alone prove the reported issues fixed. Preserve all existing primary workflows and record the actual outcomes in the unified plan's implementation log.

Revision-7 ordering: Slice 12 descriptors → Slice 21 lifecycle targets and Slice 17/29 schedule commands → Slice 30 controls/24 evidence views → Slice 25 shared action rendering → Slice 23 dashboard reuse → Slice 27 composed evidence. A command descriptor is not a new mutation authority. XS07/12/16 exercise selection races, immutable run history and same-revision surface agreement; no background reveal/selection change changes graph freshness.
