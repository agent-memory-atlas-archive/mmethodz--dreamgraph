/** Exact native SDK/companion API checkpoint; fixture providers do not prove model understanding. */
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=async path=>JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));
const root=await json('docs/ashoka/slice-31-native-pass-root-second.json'),focus=await json('docs/ashoka/slice-31-native-pass-focus-seventh.json');
for(const [result,expected]of [[root,2006],[focus,10]]){assert.equal(result.success,true);assert.equal(result.numPassedTests,expected);assert.equal(result.numFailedTests,0);}
assert.equal(root.numPendingTests,2);
for(const stem of ['root-second','focus-seventh','editor-full-first','editor-focus-third','editor-build-fifth'])assert.equal((await json('docs/ashoka/slice-31-native-pass-'+stem+'-exit.json')).exit_code,0,stem);
const editor=await readFile('docs/ashoka/slice-31-native-pass-editor-full-first.log','utf8'),compiled=await readFile('docs/ashoka/slice-31-native-pass-editor-focus-third.log','utf8');
assert.match(editor,/tests 546/);assert.match(editor,/pass 546/);assert.match(editor,/fail 0/);assert.match(compiled,/pass 41/);assert.match(compiled,/fail 0/);
const checks=await json('docs/ashoka/slice-31-native-pass-checks-final.json');assert.equal(checks.length,9);assert(checks.every(check=>check.exit_code===0));
const wslPath='docs/ashoka/slice-31-wsl-native-pass-second',installed=await json(wslPath+'/installation-proof.json'),browser=await json(wslPath+'/browser-qualification.json'),inventory=await json(wslPath+'/source-inventory.json');
assert.equal((await json('docs/ashoka/slice-31-wsl-native-pass-second-run-exit.json')).exit_code,0);
assert.equal(browser.evidence.platform,'linux');assert.equal(browser.evidence.model_requests,0);assert.equal(browser.evidence.traces.length,11);assert.equal(browser.worker.qualification.evidence_scope,'actual_runtime');
assert(browser.worker.qualification.stop_release_ms<=1000);assert(browser.worker.qualification.control_loss_stop_ms<=5000);
assert.equal(installed.native_sdk_contract.role,'computer_use');assert.equal(installed.native_sdk_contract.control_methods.length,5);
const sources=['src/computer/native-pass-schema.ts','src/computer/browser-registry.ts','src/computer/http.ts','src/architect/routes.ts','src/server/managed-execution.ts',
 'src/computer/browser-worker-entry.ts','packages/sdk/src/seams/computer-pass.ts','packages/sdk/src/seams/graph-execution.ts','packages/sdk/package.json',
 'scripts/generate-graph-contracts.mjs','scripts/qualify-ashoka-wsl-browser.mjs'];
for(const path of sources){const entry=inventory.files.find(item=>item.file===path);assert(entry,path);assert.equal(sha(await readFile(path)),entry.original_sha256,path);}
const baselineBytes=await readFile('tests/fixtures/ashoka/baseline.json'),baseline=JSON.parse(baselineBytes);assert.equal(baseline.revision,18);assert.equal(baseline.contracts.length,42);
const paths=[...sources,'extensions/vscode/src/generated/computer-pass.ts','extensions/vscode/src/daemon-client.ts','extensions/vscode/src/computer-pass.ts',
 'extensions/vscode/src/computer-control.ts','extensions/vscode/src/webview/computer-pass.ts','extensions/vscode/src/webview/computer-control.ts','extensions/vscode/src/chat-panel.ts',
 'extensions/vscode/src/test/computer-pass.test.ts','extensions/vscode/src/test/daemon-computer-control.test.ts','extensions/vscode/src/test/agent-tool-result-handoff.test.ts',
 'tests/computer-native-graph-loop.test.ts','tests/computer-native-operator.test.ts','scripts/record-ashoka-native-pass-evidence.mjs','scripts/qualify-ashoka-native-review.mjs',
 'docs/ashoka/native-review-31-pass.mjs','docs/ashoka/computer-use.md','docs/architecture.md','tests/fixtures/ashoka/baseline.json'];
for(const name of await readdir('docs/ashoka'))if(/^slice-31-(?:native-pass|wsl-native-pass).*\.(?:json|log)$/.test(name)&&!name.includes('conformance'))paths.push('docs/ashoka/'+name);
for(const directory of ['slice-31-wsl-native-pass','slice-31-wsl-native-pass-second'])for(const name of await readdir('docs/ashoka/'+directory))if(/\.(?:json|log)$/.test(name))paths.push('docs/ashoka/'+directory+'/'+name);
const artifacts=[];for(const path of [...new Set(paths)]){const bytes=await readFile(path);artifacts.push({path,bytes:bytes.length,sha256:sha(bytes)});}
const result={schema:'dreamgraph.ashoka.computer_checkpoint.v1',recorded_at:new Date().toISOString(),status:'native_editor_api_integrated_slice31_in_progress',model_requests:0,
 root:{passed:root.numPassedTests,failed:0,skipped:root.numPendingTests,files:root.testResults.length,max_workers:4,exit_code:0,elapsed_seconds:(Math.max(...root.testResults.map(test=>test.endTime))-root.startTime)/1000},
 focused:{actual_windows_sdk_browser_graph_stop:10,compiled_editor_control_transport_chat_dom:41,failed:0},editor:{passed:546,failed:0,exit_code:0},
 transport:{preparation:'/api/executions/v1/computer-preparation/',pass:'/api/executions/v1/computer-pass',role:'computer_use',selection:'Explicit daemon native API; ordinary editor model/CLI is unchanged',
  authority:'Original private native owner only; worker/cookie/browser-origin context cannot grant or start',contract:'Core-generated private DTOs above canonical C17/C05/C14',preparation_capacity:{global:128,owner_unused:4,insertion_rechecked:true}},
 stop:{worker:'Acknowledged original physical Stop',authority:'Revoked',agent_outcome:'recovery_required',reason:'Original API adapter termination remains unconfirmed; physical Stop and aborted RPC wait do not attest all work termination',source_write:false,input_replay:false},
 wsl:{installation:installed,qualification:browser.worker.qualification,source_inventory_files:inventory.files.length,measured_checks:11,
  note:'Authorized separate Linux force install. Actual installed browser and SDK export/schema readback only; no daemon pass, physical VS Code, native desktop/CLI/Mint/macOS qualification inferred.'},
 failures:{retained:true,first_sdk:'C07 retention is structured, not a string; DTO now reuses canonical RolePolicy retention.',
  first_stop:'Authority revocation was read before durable closure; test now waits for both rather than treating revocation as completion.',second_stop:'Actual acknowledged browser Stop retains unconfirmed adapter termination. Test now requires recovery_required and its original unknown effect instead of expecting state_committed.',
  concurrency:'Actual five-way native preparation admission proves exactly four accepted, one capacity refusal and no grant/model/input. Admission is rechecked after awaited setup reads.'},
 scope:'Actual Windows private SDK/API browser source/graph/Stop plus compiled controller, native transport, ChatPanel and DOM. Provider answers are declared deterministic local fixtures, not real model understanding; model_requests counts real providers only.',
 frozen:{revision:18,contracts:42,baseline_sha256:sha(baselineBytes),contract_source_sha256:baseline.contract_source_sha256},
 remaining:['Full native workers/native CLI/provider built-ins, physical VS Code/platform qualification, C14/CU/XS joins.',
 'Slice26 reviewed live cutover,27 actual paired usefulness/system gate,28 synchronized release. Version13.4.0; no Windows install/restart, live migration or paid inference.'],artifacts};
await writeFile('docs/ashoka/slice-31-native-pass-conformance.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:result.status,root:result.root,editor:result.editor,wsl_checks:11,hashes:artifacts.length,real_model_requests:0}));
