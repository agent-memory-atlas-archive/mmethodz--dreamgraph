# DreamGraph v14.0.1 — Ashoka

The first field patch for Ashoka. It makes every known legacy graph upgrade without losing history, brings Codex CLI Computer Use to a working, self-cleaning state in the browser Architect, and gives validation counts a single meaning across every surface.

## Legacy graph upgrade

`dg graph-upgrade <instance>` now completes on all six maintainer instances tested (dreamgraph, web64-react, jouna, devtoys, weather, fieldlog), with zero records lost and every earlier row kept as history.

- **Config receipts:** the config scan skips the daemon's own engine.env receipt store (`config/.engine-config`). Before, it stopped every instance that had been edited from the Config page with `GRAPH_UPGRADE_CONFIG_LINK_OR_KIND`. Any other unexpected entry still stops the upgrade, and the error now names it.
- **Re-assessed rows:** when the same row was assessed or validated more than once and the order is recorded (`validated_at`, or `normalization_cycle` then `validated_at`), the newest stays active. Older revisions are kept byte-exact in `legacy_conflicts` with `disposition: "superseded"`. Rows with no recorded order still block, or can be kept with `--preserve-conflicts`.
- **Story chapters:** chapters without an id (the legacy narrator kept `chapter_number` at 101 once the chapter cap was reached) get the v14 narrator's content id.
- **Re-dreams that reused an id:** some legacy dreams were dreamed again in a later cycle under an existing dream id. When the later dream was never assessed, it keeps its content and gets its own id, `<id>~c<cycle>`; the first dream keeps the id.
- **Unfinished Architect runs:** a run left unsettled no longer blocks the upgrade if it holds no graph state. This covers runs orphaned by a daemon restart and runs whose only open item is an unconfirmed CLI stop. Runs that hold change obligations, plan state, computer sessions, committed effects or unknown effects still block, and the error lists each one.
- **Stores that open for the first time:** stores that legacy duplicates had made unreadable now load. Record and diagnostic counts can rise because existing data becomes visible; references are not repaired.

## Computer Use (Codex CLI)

- **Codex CLI only:** the Codex adapter drives `codex exec` with the bundled Computer Use runtime. The Codex desktop app does not need to be running. A grant (instance policy `allow`, *Allow for next message*, or *Allow once and run again*) gives full control for that run.
- **Tab release:** DreamGraph attempts turn-end cleanup for recorded Codex browser tabs when a run ends, including timeout, cancellation and failure paths. It confirms release only when the controlled tabs are gone or the turn-end reply succeeds; a failed or missing reply leaves the run recovery-required, even if a `.cua-release.log` was written. Confirmed release clears the cursor and "debugging this browser" banner so the tab can be used again.
- **Start-up retry:** an initial browser call can fail with "Unable to load browser request-header policy" while the Computer Use process starts. These calls are now retried within a bound.
- **Accurate run status:** a failed CLI run is no longer recorded as an unknown stop when its adapter process termination is confirmed. A natural child close proves the owned adapter process ended; a confirmed tree kill covers the owned process tree. Unconfirmed tab release remains recovery-required.
- **Grant handling:** the request appears in the Computer Use bar and in the chat reply. The VS Code extension passes the grant to the Codex provider. The automatic retry loop is capped. Concurrency slots held by dead daemons are released after a restart.

## Architect, configuration and schedules

- **Configuration:** the Config pages were rebuilt in plain language. The daemon re-applies engine.env edits without a restart. *Time limit per task* (`DREAMGRAPH_ARCHITECT_PASS_TIMEOUT_MS`, 1–240 minutes, default 30) can be raised for Computer Use work.
- **Schedules:** the Schedules workspace was rebuilt, with compact rows, a live next-run preview and a table of recent runs. This has not yet been tested on a live instance.
- **Budgets:** variance halts now apply only to paid API billing. Paid halts can be reviewed and resumed under Config → Budgets & limits.
- **Leases and errors:** execution leases are rolling, and stale ones end. Execution requests accept the whole-pass time limit. Admission and Architect errors are shown in plain language instead of raw JSON.
- **Chat and model:** a visible Clear chat button clears the transcript only; the graph is untouched. The Codex default model is `gpt-6.1-sol`.

## Explorer and status

- **Session recovery:** opening Explorer with an expired session cookie now starts a new session instead of `SESSION_BEARER_REJECTED`. API calls, WebSocket upgrades and headers still fail closed.
- **Large graphs:** a diagnostic code that occurs more than 20 times is collapsed into one counted line, so large upgraded graphs no longer hit `EXPLORER_SNAPSHOT_BYTE_LIMIT`.
- **One definition of validation counts:** the Status board, `dg status` and Explorer use the same figures:
  - each dream is counted once, by its latest assessment, as validated, rejected or latent;
  - the validation rate is validated ÷ decided;
  - assessment rows and the promoted edge store are reported separately.

  In `dg status --json`, `cognitive.validation_pipeline` adds the reconciled counts; the legacy raw-count fields remain available for compatibility and are deprecated.
- **Latent edges:** Explorer has a `latent` edge kind for anything not rejected that is waiting for proof: latent candidates, and promoted edges that have no current evidence. These edges are dashed and muted, and never use the green validated channel. The Inspector section *Rendered connections by kind* counts what is drawn; pipeline counts are shown separately.

## Upgrade

1. Run `scripts/install.ps1 -Force` or `bash scripts/install.sh --force`.
2. Stop each legacy instance.
3. Run `dg graph-upgrade <instance>`. Each upgrade saves a verified backup and a full review under `~/.dreamgraph/graph-upgrade-reviews`, and can be reversed with the reviewed restore.
4. Restart the instance and confirm health.

## Known limitations

- **Desktop Computer Use:** desktop-surface approvals ("Computer Use was not approved to use Google Chrome") are unresolved.
- **Native dialogs:** native page dialogs and Save/Save As pickers block browser control, so the operator has to answer them.
- **Unsettled CLI runs:** there is no operator command yet to settle a Codex CLI run left `recovery_required` or `running`. It no longer blocks upgrades.
- **Node and edge counts:** `dg status` *Graph Nodes/Edges* and Explorer *Nodes/Connections* still count different sets.
- **Unresolved references:** legacy missing, ambiguous and type-mismatched references stay unresolved. Many are validated-edge endpoints whose id is shared by a feature and a data model. Fixing them needs a separate, reviewed step.
- **Native API adapters:** Computer Use through the native API adapters (DreamGraph harness) is not yet field-tested.
