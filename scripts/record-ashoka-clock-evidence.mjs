/** Monotonic original IPC watchdog and exact current WSL installation, zero model requests. */
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=async path=>JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));
const root=await json('docs/ashoka/slice-31-clock-root-second.json');
assert.equal(root.success,true);assert.equal(root.numPassedTests,2003);assert.equal(root.numFailedTests,0);assert.equal(root.numPendingTests,2);
const focus=await json('docs/ashoka/slice-31-clock-focus-third.json'),windows=await json('docs/ashoka/slice-31-clock-browser-focus.json'),linux=await json('docs/ashoka/slice-31-linux-evidence-focus-second.json');
for(const [value,count]of [[focus,5],[windows,15],[linux,12]]){assert.equal(value.success,true);assert.equal(value.numPassedTests,count);assert.equal(value.numFailedTests,0);}
for(const stem of ['clock-root-second','clock-focus-third','clock-browser-focus','linux-evidence-focus-second','wsl-clock-second-run'])
 assert.equal((await json('docs/ashoka/slice-31-'+stem+'-exit.json')).exit_code,0,stem);
const checks=await json('docs/ashoka/slice-31-clock-checks.json');assert.equal(checks.length,9);assert(checks.every(check=>check.exit_code===0));
const wslPath='docs/ashoka/slice-31-wsl-clock-second',installed=await json(wslPath+'/installation-proof.json'),browser=await json(wslPath+'/browser-qualification.json');
assert.equal(browser.schema,'dreamgraph.browser_runtime_qualification.v1');assert.equal(browser.evidence.model_requests,0);assert.equal(browser.evidence.platform,'linux');
assert.equal(browser.evidence.traces.length,11);assert.equal(browser.worker.qualification.evidence_scope,'actual_runtime');
assert(browser.worker.qualification.stop_release_ms<=1000);assert(browser.worker.qualification.control_loss_stop_ms<=5000);
const inventory=await json(wslPath+'/source-inventory.json');
for(const file of ['src/computer/browser-worker-entry.ts','src/computer/browser-harness.ts','src/computer/browser-driver.ts','src/computer/qualify-browser.ts','src/cli/commands/computer-use.ts']){
 const entry=inventory.files.find(item=>item.file===file);assert(entry,file);assert.equal(sha(await readFile(file)),entry.original_sha256,file);
}
const baselineBytes=await readFile('tests/fixtures/ashoka/baseline.json'),baseline=JSON.parse(baselineBytes);assert.equal(baseline.revision,18);assert.equal(baseline.contracts.length,42);
const paths=['src/computer/browser-worker-entry.ts','src/computer/browser-harness.ts','src/computer/qualify-browser.ts','src/cli/commands/computer-use.ts',
 'tests/computer-worker-clock.test.ts','tests/helpers/computer-frozen-clock-worker.mjs','tests/computer-qualification-failure.test.ts','tests/host-managed-execution.test.ts',
 'scripts/qualify-ashoka-wsl-browser.mjs','scripts/qualify-ashoka-native-review.mjs','scripts/record-ashoka-clock-evidence.mjs','docs/ashoka/native-review-31-clock.mjs',
 'tests/fixtures/ashoka/baseline.json','docs/ashoka/computer-use.md','docs/architecture.md',
 'docs/ashoka/slice-31-editor-evidence-editor-first.log','docs/ashoka/slice-31-editor-evidence-editor-first-exit.json'];
for(const name of await readdir('docs/ashoka'))if(/^slice-31-(?:clock|linux-evidence|wsl-clock).*\.(?:json|log)$/.test(name)&&!name.includes('conformance'))paths.push('docs/ashoka/'+name);
for(const directory of ['slice-31-wsl-clock','slice-31-wsl-clock-second'])for(const name of await readdir('docs/ashoka/'+directory))
 if(/\.(?:json|log)$/.test(name))paths.push('docs/ashoka/'+directory+'/'+name);
const artifacts=[];for(const path of [...new Set(paths)]){const bytes=await readFile(path);artifacts.push({path,bytes:bytes.length,sha256:sha(bytes)});}
const result={schema:'dreamgraph.ashoka.computer_checkpoint.v1',recorded_at:new Date().toISOString(),status:'monotonic_watchdog_qualified_slice31_in_progress',model_requests:0,
 root:{passed:2003,failed:0,skipped:2,files:178,max_workers:4,exit_code:0,elapsed_seconds:(Math.max(...root.testResults.map(test=>test.endTime))-root.startTime)/1000},
 focused:{clock_and_failure:5,windows_browser:15,linux_browser_evidence:12,failed:0},
 editor:{passed:529,failed:0,temporal:true,note:'Earlier compiled editor evidence; clock/diagnostic changes do not modify companion source.'},
 watchdog:{clock:'node.performance.now',heartbeat_threshold_ms:2500,check_interval_ms:100,responsive_stop_ceiling_ms:1000,control_loss_ceiling_ms:5000,absolute_grant_expiry:'unchanged'},
 wsl:{installation:installed,qualification:browser.worker.qualification,source_inventory_files:inventory.files.length,measured_checks:11,
  note:'Authorized Linux force install only. Qualification is limited to the exact isolated browser/runtime; no Windows deployment or Mint/macOS/native desktop/editor activation.'},
 failures:{retained:true,linux_initial_graph_loop:'Original watchdog report retained; subsequent monotonic-clock focus passed. Cause of the original missed heartbeats remains unproved.',
  initial_full_root:'2000 passed, one CLI positive fixture admission expired at300ms. Test-only allowance now2000ms remains shorter than its five-minute host lease; production limits unchanged.',
  first_current_wsl:'Installation succeeded but qualification reported an unknown worker reply. Its scope, source inventory and unqualified artifact remain retained. The later qualification ran after the heavy Windows suite completed; no stress-load guarantee inferred.'},
 scope:'Actual private IPC clock cases and exact current installed WSL browser. Qualified failure details are bounded codes only. Existing source/graph/browser evidence retains its original owner and offline-provider scope.',
 frozen:{revision:18,contracts:42,baseline_sha256:sha(baselineBytes),contract_source_sha256:baseline.contract_source_sha256},
 remaining:['Slice31 full editor execution, native workers/native CLI/provider integration and CU/XS joins.','Slice26 reviewed live cutover,27 actual paired usefulness,28 synchronized release. Product13.4.0; no Windows install/restart, live migration or paid inference.'],artifacts};
await writeFile('docs/ashoka/slice-31-clock-conformance.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:result.status,root:result.root,wsl_checks:11,hashes:artifacts.length,model_requests:0}));
