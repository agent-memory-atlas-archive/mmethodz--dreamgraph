# DreamGraph legacy graph: reviewed migration proof and rollout proposal

Slice 26's migration implementation is verified against full-family fixtures and an exact copy of the existing DreamGraph instance. The original revision-7 handoff assigns disposable converter/recovery proof to Slice 26 and packaged activation to Slice 28. The running original instance has **not** been migrated.

The [actual copy proof](slice-26-conflict-proposal.json) covers instance `ee9ce3b9-0313-4768-b5f1-24b9b3fffc4b`, preview digest `sha256:cea3377d87ab697d0e9f343229e1730da9bdf12e720fa1f9252ad1d3d75ad545`, publication sequence 17391. It copied and verified 35 data files and four configuration files, totaling 122,011,335 bytes. Apply, exact retry, backup-byte verification and restoration of every changed family passed.

| Family | Proposed disposition |
|---|---|
| `candidate_edges.json` | Archive all 124 conflicting assessment rows from active use; preserve every original version in the exact backup. Do not choose by confidence, time or array order. |
| `validated_edges.json` | Archive all three conflicting rows with their original bytes preserved; applicability remains unresolved. |
| `system_story.json` | Give all 90 conflicting chapters deterministic content-derived IDs; preserve chapter numbers, prose, times and provenance. Ambiguous old references remain explicit. |

The [217 exact row choices](slice-26-conflict-resolutions-proposed.json) cover 61 conflict groups. Canonical visibility changes from 7,515 entities / 2,655 relationships to 79,689 / 9,575 because previously rejected families become readable. This is recovered visibility, not newly discovered knowledge. A legacy `validated` kind is not proof of factual verification. Missing scan/enrichment baselines and unresolved endpoints remain explicit.

For live adoption, stop only this instance after its current work settles, generate a fresh preview with the proposed row choices, review its exact digest and changed-byte scope, and use `dg graph-upgrade` with the exclusive writer fence and verified backup. Changed inputs require a new preview. Start the qualified packaged runtime and verify the original receipt and migration notice. Do not run old incompatible writers against an activated format. The existing CLI refuses apply/restore while the named daemon PID is alive.

No live repair, full scan, model call, automatic C14 progress import or change to another instance is authorized by this proof file. The maintainer's rollout decision remains separate from the accepted migration implementation. [Closure record](slice-26-closure.json).
