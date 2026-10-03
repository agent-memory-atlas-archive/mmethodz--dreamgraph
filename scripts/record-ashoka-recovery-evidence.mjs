/** Seal real peer-death evidence without upgrading an unknown effect or acknowledging Stop. */
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=async path=>JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));
const root=await json('docs/ashoka/slice-31-peer-crash-root-tests-second.json');
const focus=await json('docs/ashoka/slice-31-peer-crash-focus-fourth.json');
const linux=await json('docs/ashoka/slice-31-peer-crash-linux-test-second.json');
for(const [name,result] of [['root',root],['focus',focus],['linux',linux]]){
 assert.equal(result.success,true,name);assert.equal(result.numFailedTests,0,name);
 assert(result.testResults.some(file=>file.assertionResults.some(test=>test.title.includes('real source write followed by peer death')&&test.status==='passed')),name);
}
assert.equal(root.numPassedTests,1982);assert.equal(root.numPendingTests,2);assert.equal(root.testResults.length,175);
assert.equal(focus.numPassedTests,17);assert.equal(linux.numPassedTests,1);
for(const stem of ['root-tests-second','focus-fourth','linux-test-second'])assert.equal((await json('docs/ashoka/slice-31-peer-crash-'+stem+'-exit.json')).exit_code,0,stem);
const baselineBytes=await readFile('tests/fixtures/ashoka/baseline.json'),baseline=JSON.parse(baselineBytes.toString('utf8'));
assert.equal(baseline.revision,18);assert.equal(baseline.contracts.length,42);
const wsl=await json('docs/ashoka/slice-31-wsl-conformance.json');
const editor=await json('docs/ashoka/slice-31-editor-control-conformance.json');
const workerFiles=['browser-driver.ts','browser-harness.ts','browser-peer.ts','browser-profile.ts','qualify-browser.ts','worker-port.ts','digest.ts'];
// Pin the physically qualified worker bytes against the previous checkpoint, not an inferred platform capability.
const unchanged=[];
for(const artifact of wsl.artifacts.filter(a=>workerFiles.some(name=>a.path==='src/computer/'+name))){
 assert.equal(sha(await readFile(artifact.path)),artifact.sha256,artifact.path);unchanged.push(artifact.path);
}
assert(unchanged.includes('src/computer/browser-driver.ts')&&unchanged.includes('src/computer/browser-harness.ts'));
const paths=[
 'scripts/record-ashoka-recovery-evidence.mjs','scripts/qualify-ashoka-native-review.mjs','docs/ashoka/native-review-31-recovery.mjs',
 'tests/computer-peer-crash.test.ts','tests/helpers/browser-process-tree.ts','tests/computer-browser-worker.test.ts','tests/architect-managed-context.test.ts',
 'src/computer/browser-harness.ts','src/computer/browser-driver.ts','src/computer/broker.ts','src/computer/journal.ts',
 'src/graph/change-obligations.ts','src/graph/execution-context.ts','src/server/managed-execution.ts','src/cognitive/jobs.ts',
 'tests/fixtures/ashoka/baseline.json','docs/ashoka/slice-31-wsl-conformance.json','docs/ashoka/slice-31-editor-control-conformance.json',
 'docs/ashoka/slice-31-wsl-third/installation-proof.json','docs/ashoka/slice-31-wsl-third/browser-qualification.json',
 'docs/ashoka/computer-use.md','docs/architecture.md'];
for(const name of await readdir('docs/ashoka'))if(/^slice-31-peer-crash-.*\.(json|log)$/.test(name))paths.push('docs/ashoka/'+name);
const artifacts=[];for(const path of paths){const bytes=await readFile(path);artifacts.push({path,bytes:bytes.length,sha256:sha(bytes)});}
const packet={schema:'dreamgraph.ashoka.computer_checkpoint.v1',recorded_at:new Date().toISOString(),status:'peer_death_recovery_qualified_slice31_in_progress',
 root:{passed:root.numPassedTests,failed:0,skipped:root.numPendingTests,files:root.testResults.length,exit_code:0,max_workers:4,
  elapsed_seconds:(Math.max(...root.testResults.map(t=>t.endTime))-root.startTime)/1000},
 focused:{passed:17,failed:0,exit_code:0},linux:{passed:1,failed:0,exit_code:0,
  platform:'Ubuntu24.04.4/WSL2 x64/Node20.20.2/Chromium151.0.7922.34/Playwright1.62.1'},
 windows:{platform:'Windows x64/Node25.2.1/Chrome153.0.8010.50/Playwright1.62.1',real_source_write_and_peer_death:true},
 frozen:{revision:18,contracts:42,baseline_sha256:sha(baselineBytes),contract_source_sha256:baseline.contract_source_sha256},
 previous_qualification:{wsl_artifact:wsl.install.browser_artifact_hash,unchanged_worker_files:unchanged,editor_passes:editor.editor.pass,
  scope:'Historical installed worker and compiled editor evidence; no new editor activation, native desktop or provider qualification.'},
 scope:'Actual isolated browser performs one disposable source write; the original IPC peer is forcibly killed before its action acknowledgement. Actual C17/C05/C15 stores retain unknown action and Stop, pending source debt and recovery-required execution. Original retries deliver no further input. Known original process identities end, but their absence is neither action verification nor an authenticated Stop receipt. Admission/provider pricing are declared offline fixtures; no model calls.',
 retained_failures:['Initial mechanical admission and ledger assertions failed and were corrected to the real contracts.',
  'First WSL test failed during worker opening before entering the broker body; its cause remains unqualified. The unchanged production runtime subsequently passed.',
  'Default-concurrency root run failed four cases: one finite ten-second model fixture deadline and three worker unknown replies. Phase/cause of the latter is not proven. Final bounded four-worker regression passed.',
  'Only the multi-step test deadline became30 seconds. Pending-navigation Stop now waits for the actual target request instead of a700ms delay. Production Stop, control-loss, action and grant limits are unchanged.'],
 remaining:['Fresh daemon restart/readback, native worker backends, native CLI/provider seams, complete editor execution and full CU/XS joins remain Slice31 work.',
  'Live migration, paid usefulness and synchronized release remain Slices26/27/28. Version13.4.0; no Windows global installation/restart.'],artifacts};
await writeFile('docs/ashoka/slice-31-recovery-conformance.json',JSON.stringify(packet,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:packet.status,root:packet.root,linux:packet.linux.passed,hashes:artifacts.length}));
