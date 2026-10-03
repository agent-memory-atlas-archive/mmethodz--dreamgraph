# Reviewed graph upgrades and responsive plan navigation

This is the source implementation of Slice 26. Live migration and release qualification remain separate gates. The installed daemon does not adopt source changes until installation and restart.

Architect checks legacy graph formats with bounded prefix reads and offers the exact instance's `dg graph-upgrade` command in a compact disclosure. It does not run a migration, source scan or model request. A format notice is not a freshness verdict. An old full scan or project-map timestamp does not establish a stale graph; concrete source gaps, unsettled reconciliation and unavailable evidence are reported by the canonical currency owner. Unreadable setup maps invite inspection instead of an automatic scan.

## Review, apply and restore

The operator workflow is independent of `dg migrate`, which creates an instance from the old flat layout:

```powershell
dg graph-upgrade dreamgraph preview --out ./graph-upgrade-review.json
# Review all input hashes, changes, counts, unresolved references and blockers.
# Resolve conflicting rows explicitly; the resolutions file contains the exact
# file, collection, index, row_hash, action, new_id where needed, and reason.
dg graph-upgrade dreamgraph preview --resolutions ./resolutions.json --out ./graph-upgrade-resolved.json
# Stop/drain this instance explicitly, then regenerate its final matching preview.
dg graph-upgrade dreamgraph apply --preview ./graph-upgrade-resolved.json --reviewed-digest sha256:<reviewed-digest> --review-id <review-id> --operation-id <operation-id>
dg graph-upgrade dreamgraph restore-preview --original-operation <operation-id> --out ./graph-restore-review.json
dg graph-upgrade dreamgraph restore --preview ./graph-restore-review.json --reviewed-digest sha256:<restore-digest> --review-id <restore-review-id> --operation-id <restore-operation-id>
```

Preview is read-only. Output must be a new file outside instance storage; protected paths and existing files are refused. A changing publication, unpublished store, unfinished job, unconfirmed external effect, active plan lease or another process's physical writer prevents cutover. No command silently stops a daemon or cancels work. Changed input/configuration invalidates approval. After an uncertain reply, reuse the exact preview, review and operation IDs to recover the original receipt.

Known current and previous family schemas retain their original encoding and trust classes. Missing IDs receive deterministic physical mappings; exact duplicates remain in the original backup. Conflicting assertions and assessment-cycle duplicates block until a row-bound operator decision; confidence or recency cannot choose a winner. Source, human, dream, validation, decision, foreign-instance and historical identities retain their meaning. Unknown schemas, invalid encoding and newly introduced cross-collection collisions refuse activation. C14 plan/slice authority and recorded progress stay under their existing owner.

Before publication the CLI saves and verifies the exact bytes of **all root data JSON stores and root instance configuration files**, including unknown extension/history stores, into `data/.graph-upgrades/<backup-id>/`. Opaque configuration content is not placed in the review preview. This is an instance-private recovery backup, not a backup of repository files, arbitrary subdirectories, logs or screenshot artifacts; those are unchanged by this structural operation. Size/link/capacity checks are explicit. Staging uses a separate temporary directory and the real canonical reader. One existing journal/receipt owner publishes the reviewed graph changes and migration record.

Restore has a new, separately reviewed preview and advances publication revision. It restores only migrated families whose current bytes still match that migration. It preserves newer unrelated work, receipts, currency, dirty generations, settings, grants and spend. Config backup supports operator recovery; ordinary graph restore does not overwrite later configuration. A changed migrated family requires forward repair or reviewed reconciliation rather than erasing new work. Backup corruption prevents restore. The old publication/receipt history is never rewound.

Missing historical scan/enrichment baselines stay unknown. Structural repair seeds bounded unresolved markers; source reconstruction and optional paid enrichment are distinct, separately admitted operations. This tool does not fabricate scan times, source coverage, verified plans or model evidence. Installation with `-Force` cannot approve migration.

## Navigation repair

Plan navigation used to parse the entire publication receipt history on repeated reads and match every catalogue entry against every slice of every plan. The daemon now shares immutable validated publication and C14 roots by strong physical-file stamps, revalidates rewrites/replacements, preserves read fences and returns private mutable copies only to writers. C14 lease expiry is projected afresh. Graph catalogues are keyed by physical instance and file stamps. List summaries skip per-slice anchor work; selected detail still supplies those anchors. Absent ASCII IDs use a substring prefilter before the unchanged token-boundary match.

The read-only source benchmark at 92 real plans observed roughly 42.8 seconds for the initial list and 2.6 seconds after these changes, with selected detail falling from 0.83 to 0.23 seconds. Publication observations were taken at different revisions while the installed instance continued writing, so this is an observed scale comparison, not a controlled identical-snapshot ratio or a claim about the currently installed daemon. Exact captures and actual compiled Chrome/CLI checks are in the Slice 26 evidence packet. Cached data cannot hide a journal, changed file, missing publication or another physical instance.

## Qualification boundary

A second installed-daemon failure exhausted all 512 session slots because cookie-less health probes each created a twelve-hour identity. `GET /health` now checks transport liveness without creating a conversation or publishing graph data. Host/origin restrictions and remote authentication still apply; this response does not attest graph currency or recovery. New conversation admission returns a bounded 503 with `Retry-After` when capacity or publication recovery prevents admission. Existing identities and their grants are preserved; reuse a valid session or let original expiries reclaim capacity. See [session authority](session-authority.md) for the operating contract. Installing the repair stops new probe-created sessions; it does not retroactively evict existing sessions.

Disposable tests exercise full-family identities, provenance/unknowns, explicit conflict choices, real writer exclusion, killed-writer rollback/roll-forward, stale previews, configuration changes, cancellation, backup corruption, exact-byte restore and post-cutover work preservation. Actual compiled CLI and Chrome checks cover notice/navigation and apply/replay/restore. They do not authorize live graph repair or qualify paid source reconstruction, native desktop control, other operating systems or the final v14 release. The own-instance inventory explicitly records a changing publication and cannot serve as a live cutover approval.
