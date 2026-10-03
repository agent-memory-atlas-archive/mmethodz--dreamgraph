/** Reconcile accepted migration mechanisms with the exact own-instance copy proof. No instance writes. */
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=async path=>JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));
const prior=await read('docs/ashoka/slice-26-conformance.json');
const copy=await read('docs/ashoka/slice-26-conflict-proposal.json');
assert.equal(copy.original_instance_changed,false);assert.equal(copy.model_requests,0);
assert.deepEqual(copy.copy_proof.blockers,[]);
for(const key of ['replay_same_receipt','all_backup_bytes_verified','all_changed_families_restored_exactly'])assert.equal(copy.copy_proof[key],true,key);
assert.equal(copy.counts.resolutions,217);assert.equal(copy.counts.archived_active_rows,127);assert.equal(copy.counts.story_identity_mappings,90);
const current=['src/graph/legacy-upgrade.ts','src/cli/commands/graph-upgrade.ts','tests/legacy-graph-upgrade.test.ts','tests/graph-upgrade-notice.test.ts'];
for(const path of current){const artifact=prior.artifacts.find(item=>item.path===path);assert(artifact,path);assert.equal(sha(await readFile(path)),artifact.sha256,path);}
const paths=[...current,'docs/ashoka/slice-26-conformance.json','docs/ashoka/slice-26-health-conformance.json',
 'docs/ashoka/slice-26-live-preview-oct03.json','docs/ashoka/slice-26-conflict-proposal.json','docs/ashoka/slice-26-conflict-resolutions-proposed.json',
 'docs/ashoka/slice-26-conflict-proposal-first.exit.json','docs/audits/2026-09-30-coverage/plan-refinement.md'];
const artifacts=[];for(const path of paths){const bytes=await readFile(path);artifacts.push({path,bytes:bytes.length,sha256:sha(bytes)});}
const packet={schema:'dreamgraph.ashoka.migration_closure.v1',recorded_at:new Date().toISOString(),slice:26,status:'verified',
 decision:'Accept existing converter/recovery criteria using full-family failures and the exact original-instance snapshot copy. Packaged activation remains Slice28/operator rollout, as the original revision7 handoff specifies.',
 scope:'Migration implementation and recovery; no assertion that the running original instance has been converted.',
 criteria:[
  {criterion:'Explainable before/after identities and counts; no provenance loss',evidence:'slice-26-conflict-proposal.json',result:'Three repaired families become readable. 127 ambiguous active rows are archived with every original version in the verified backup; 90 chapters receive stable distinct identities. No confidence or array-order winner and no fact promotion.'},
  {criterion:'Fenced exact preview, stale/concurrent/unfinished-work refusal',evidence:'slice-26-conformance.json and unchanged legacy-graph-upgrade tests',result:'Passed physical second-writer exclusion, source/config revision checks, exact row choices, unknown-schema refusal, unpublished input and unsettled job refusal.'},
  {criterion:'Crash/cancel/restore/retry preserve one publication and later work',evidence:'slice-26-conformance.json plus own-instance copy proof',result:'Actual killed writer before/after publication recovers; lost-result replay returns the original receipt. Byte-exact copy restoration passed; post-cutover source debt, history, settings and unrelated writes survive reviewed restore.'},
  {criterion:'Legacy uncertainty and migration notification remain explicit',evidence:'slice-26-conformance.json, slice-26-health-conformance.json and own-instance copy proof',result:'Unknown scan/enrichment baselines and unresolved references remain visible; no age-only staleness or fabricated lifecycle verification. Actual Architect notice, legacy progress and 92-plan navigation are qualified.'}
 ],
 own_snapshot:{instance_id:copy.instance_id,preview_digest:copy.original_digest,revision:copy.original_revision,counts:copy.counts,
  before:{entities:copy.before.entities,relationships:copy.before.relationships},after:{entities:copy.after.entities,relationships:copy.after.relationships},
  interpretation:'Count growth reflects restored visibility of previously rejected duplicate families. Legacy validated-kind rows are not newly verified facts. Remaining endpoint/baseline uncertainty is not hidden.'},
 rollout:['Fresh exact preview and explicit row disposition are required before any original-instance mutation. The prepared proposal is not approval for changed bytes.',
  'The original running instance stays unchanged. Slice28 verifies packaged activation on disposable data; maintainer chooses live adoption during practical testing.',
  'No paid reconstruction or enrichment is required to establish structural migration correctness. Optional later enrichment uses the existing finite admission.'],
 review:{reviewer:'executing agent under maintainer closure direction, 2026-10-03',result:'accepted',independent_model_review:false},
 real_provider_requests:0,original_instance_changed:false,artifacts};
await writeFile('docs/ashoka/slice-26-closure.json',JSON.stringify(packet,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({slice:26,status:packet.status,artifacts:artifacts.length,original_instance_changed:false}));
