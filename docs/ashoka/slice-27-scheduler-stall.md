# Installed-daemon stall and bounded scheduler correction

The maintainer reported that the installed daemon remained running but browser pages were inaccessible on 2026-10-03. This was investigated before Slice 27 closure. The live installation was an earlier build; the affected compiled scheduler and publication modules were nevertheless byte-identical to the current pre-correction build:

- `scheduler.js`: SHA-256 `51af631313c7cee2b3d25b8f5b33bb1292a4d15d3aec3b0a63a519a6561e63b9`.
- `publication.js`: SHA-256 `313b5d4bb5aedd65ffef7eecfb9c492d990fb0334b48a96c6b5b70b99f78b2a5`.

Read-only diagnosis found the correct listener on port 8010. Stateless `/health` returned 200 in 245.589 ms and reported one MCP transport session. The separate durable authority store contained 168 unexpired browser identities against a limit of 512, with no grants or challenges. This was not session-capacity exhaustion. Browser entry requests exceeded three seconds; a second root-page request exceeded 20 seconds. These were client observation limits, not measured eventual completion times.

The publication file was approximately 22 MB. One captured state contained 19,925 receipts: 19,187 scheduler receipts, 704 authority receipts and 34 legacy-internal receipts. Recent scheduler commits continued every few seconds while the persisted tick cursor remained at 07:23:56 UTC, more than an hour behind observation. The registry had 39 schedules, mostly disabled/exhausted, and one occurrence. No secret, session bearer, raw project graph or private schedule content is published here.

Source inspection identified three interacting problems in the current code: automatic dispatch considered inactive schedules; every mutation callback published a new revision even when it returned an unchanged rejection/replay; and interval callbacks could accumulate while prior ticks waited for the shared writer or engine. This explains a growing write queue and ledger, while the stateless health route remains responsive. The observed host CPU load was substantial; this is not an assertion that it caused an earlier unrelated browser-worker timeout.

The correction preserves the existing scheduler, occurrence identities and publication authority:

- Automatic dispatch excludes paused, exhausted, disabled and archived definitions. Manual dispatch retains its existing guarded behavior.
- Identical scheduler state produces no new revision or publication receipt. Real cursor changes and accepted state transitions still commit through the existing writer.
- Timer wake-ups coalesce while one automatic tick is active, including across configuration restarts. Stopping invalidates callbacks still waiting for startup recovery. Accepted jobs keep their existing owner and cancellation/recovery rules.

[Focused verification](slice-27-scheduler-stall-fix-first.json) passed 26 scheduler, HTTP, dashboard and production-digestion checks. New regressions cover 39 inactive legacy definitions, unchanged tick/replay byte preservation, held-tick coalescing and stop during startup recovery. [Established-ledger HTTP verification](slice-27-scheduler-liveness-first.json) used 20,000 synthetic receipts and 39 inactive schedules. Browser admission and authenticated reuse completed in 3,755.491 ms while timer wake-ups continued; only two publications occurred (one tick and one session). This is a bounded synthetic integration result, not a measurement of the live graph after upgrade.

The [fourteenth complete gate](slice-27-offline-gate-fourteenth/result.json) passed the scheduler and browser-admission regressions, but failed two separate browser shutdown cases. The [fifteenth gate](slice-27-offline-gate-fifteenth/result.json) also failed unrelated timing checks. Neither closes Slice 27. The earlier thirteenth gate passed but predates the scheduler correction; final current-source acceptance is recorded in [the Slice 27 closure packet](slice-27-closure.json). No live store was directly edited, receipt history deleted, session forcibly evicted, installed daemon restarted or global installation replaced during diagnosis. Browser probes used ordinary GET authorization, which may allocate a session. The maintainer's force-install and restart are required before the running instance receives the correction; packaging/release remains Slice 28.
