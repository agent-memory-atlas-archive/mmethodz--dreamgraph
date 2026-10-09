# Architect CLI controls

Slice 30 is verified for its dependency handoff. The source-confirmed missing link was that the native bridge accepted verbosity but no explicit autonomy policy, while both adapters used one approval profile and a bridge-local command could bypass daemon admission.

C13 now binds each child to an opaque execution bearer, authenticated session, exact approved action arguments, approved scope IDs, immutable mode/output policy, finite effect count, timeout and cancellation signal. Manual admits at most one approved effect; Supervised admits one checkpoint scope with a finite cap; Autonomous admits authorized task scopes until an existing continuation/resource/governance gate. No approved effects means inspect/propose only. Effect arguments cannot be widened by model prose. Actions are reserved before dispatch; uncertain results cannot silently consume the same grant again. Persistent MCP connections cannot switch policy identities. Execution credentials cannot invoke unrelated browser control ports or mint broader approvals.

`approved_actions` is an operator/control-port request field containing exact tool, arguments, scope ID and bounded call count. It is not a model-issued permission. Browser/CLI/plugin integration with durable C14 task approvals and restart jobs remains the explicit 17/25 integration gate; supplying raw action JSON is not the planned end-user approval experience.

Codex native execution remains ephemeral with a read-only scratch sandbox; MCP effects are governed by the daemon. Copilot requires native noninteractive tool approval but native shell/write and built-in MCPs are disabled; governed effects still go through the same daemon fence. Installed `--version` and read-only help flags are qualified before dispatch; missing options block rather than fall back. These are native launch/perimeter controls, not a claim of OS containment or qualified Computer Use.

Verbosity has separate layers: optional Codex `model_verbosity` configuration, explicit prompt guidance for both adapters, and existing compact/expanded UI traces. Provider output density is not guaranteed. Concise retains graph/ADR anchors, provenance, scoped currency/completeness, failures and reconciliation obligations. Raw machine results are not clipped to mimic concise presentation. Copilot native output-density control is reported unsupported while prompt guidance remains available.

The verified local help sources on 2026-10-01 are Codex 0.159.2 and Copilot 1.0.56. Official Codex documentation: [CLI reference](https://learn.chatgpt.com/docs/developer-commands?surface=cli) and [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference). The optional GPT Responses verbosity field is not universal CLI/model behavior.

Native Computer Use grants, independent stop and platform capability qualification remain Slice 31. No paid CLI/model canary has run. Instrumented executable/MCP/stop fixtures pass, including the same fixed task under all three modes for both adapters. Manual permits one effect; Supervised permits two effects in one checkpoint and rejects the next; Autonomous admits the explicitly approved next checkpoint and still rejects outside scope. These are actual disposable native executable/bridge runs, not paid model outputs. Full wave review is pending.

The native17-item handoff is accepted after stable133files/1499root passes,488extension passes and generated/build checks. [Evidence](wave-15-30-tests.json), [review](wave-15-30-verification.json). The explicit later composition/qualification limits remain; this is not the completed v14 release.

## Action approvals — October 2026 update

Architect's Advanced runtime controls now separate action approval from autonomy. The choice is saved in this browser for this instance and captured for each submitted pass:

- **Standard — ask for commands** preserves existing autonomous approval of graph/source edits and reviews commands and other effects.
- **Ask for every action** disables that standing edit approval.
- **Auto accept — DreamGraph actions** lets the original operator authorize registered DreamGraph mutations and scoped commands without repeated clicks. The daemon still journals each exact action before dispatch and enforces graph context, scope, cancellation and existing effect/deadline limits. Unknown extensions are not automatically authorized.
- **Auto accept this task** on a pending review changes only that live execution. It does not change subsequent-task defaults.

This is shared by Claude CLI, Codex CLI, Copilot CLI and native API execution. It never enables a CLI's own repository mutation tools. Computer Use permission remains a separate control.

Browser approvals use a compact acknowledgement rather than echoing the context pack. Lost replies can be checked using the original approval ID and argument hash, including while the approved action is running; acknowledgement recovery does not reissue the effect. Existing SDK/editor review response contracts remain unchanged.

Managed commands observe files using streamed hashes and the scanner's repository-root .gitignore rules, including negations. Ignored/generated/secret material is excluded from this declared observation scope. Pre-dispatch hashing is cancellable. Concurrent file changes are still refused, and source changes still produce reconciliation obligations. A successful command does not claim external-effect verification or graph reconciliation.

Pass Reports present the summary, work and blockers in framed sections, with counts, safe links and code formatting. Tool/evidence/raw sections are collapsible and materialize their contents when opened. This presentation does not compact the model's accumulated investigation context.

### Pass-report reconciliation status

New pass reports retain a daemon-supplied execution identity. The compact Graph reconciliation row reads current source-change obligations and committed publication receipts, independently of the model narrative and the execution's historical finish status. It checks when the report is displayed; Check status refreshes the read-only result and shows the last successful check time. The daemon reconciles its recorded source changes before a confirmed run closes and during context refresh before dependent actions. It also settles known source dependencies before initial context delivery. This uses exact file scopes and hashes, existing structural reconciliation and atomic publication; it does not call `scan_project`, walk the repository, or invoke paid enrichment. External edits continue through the existing detection/reconciliation mechanisms. If source bytes changed unexpectedly, termination is unconfirmed, or publication fails, the report retains Pending or Recovery required with the daemon error. Confirmed requires recorded reconciliation evidence; unknown effects remain recovery-required and failed reads show Unavailable. Optional enrichment and dreaming remain separate. Older reports without a recorded execution identity cannot infer status from an obligation ID mentioned in model prose.
