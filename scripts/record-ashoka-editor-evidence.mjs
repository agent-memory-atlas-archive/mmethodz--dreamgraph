/** Original owner on-demand pixel inspection with actual browser/native graph-loop evidence. */
import {readFile,writeFile,readdir} from 'node:fs/promises';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
const sha=value=>createHash('sha256').update(value).digest('hex'),json=async path=>JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));
const root=await json('docs/ashoka/slice-31-editor-evidence-root-first.json'),focus=await json('docs/ashoka/slice-31-editor-evidence-focus-second.json');
assert.equal(root.success,true);assert.equal(root.numPassedTests,1999);assert.equal(root.numFailedTests,0);assert.equal(root.numPendingTests,2);assert.equal(focus.success,true);assert.equal(focus.numPassedTests,10);
for(const stem of ['build-first','editor-build-second','editor-first','focus-second','root-first'])assert.equal((await json('docs/ashoka/slice-31-editor-evidence-'+stem+'-exit.json')).exit_code,0,stem);
const editor=await readFile('docs/ashoka/slice-31-editor-evidence-editor-first.log','utf8');assert.match(editor,/pass 529/);assert.match(editor,/fail 0/);assert.match(editor,/cancelled 0/);
const baselineBytes=await readFile('tests/fixtures/ashoka/baseline.json'),baseline=JSON.parse(baselineBytes);assert.equal(baseline.revision,18);assert.equal(baseline.contracts.length,42);
const paths=['src/computer/http.ts','src/computer/broker.ts','src/computer/browser-driver.ts','src/computer/worker-port.ts','src/computer/journal.ts','src/server/managed-execution.ts',
 'packages/sdk/src/seams/computer-control.ts','packages/sdk/src/seams/graph-execution.ts','extensions/vscode/src/daemon-client.ts','extensions/vscode/src/computer-control.ts',
 'extensions/vscode/src/webview/computer-control.ts','extensions/vscode/src/chat-panel.ts','extensions/vscode/src/test/computer-control.test.ts','extensions/vscode/src/test/daemon-computer-control.test.ts',
 'tests/computer-evidence.test.ts','tests/computer-native-operator.test.ts','tests/computer-native-graph-loop.test.ts','tests/fixtures/ashoka/baseline.json',
 'scripts/record-ashoka-editor-evidence.mjs','scripts/qualify-ashoka-native-review.mjs','docs/ashoka/native-review-31-evidence.mjs','docs/ashoka/computer-use.md','docs/architecture.md'];
for(const name of await readdir('docs/ashoka'))if(/^slice-31-editor-evidence-.*\.(json|log)$/.test(name)&&!name.includes('conformance'))paths.push('docs/ashoka/'+name);
const artifacts=[];for(const path of paths){const bytes=await readFile(path);artifacts.push({path,bytes:bytes.length,sha256:sha(bytes)});}
const result={schema:'dreamgraph.ashoka.computer_checkpoint.v1',recorded_at:new Date().toISOString(),status:'original_editor_evidence_qualified_slice31_in_progress',
 root:{passed:1999,failed:0,skipped:2,files:176,max_workers:4,exit_code:0,elapsed_seconds:(Math.max(...root.testResults.map(t=>t.endTime))-root.startTime)/1000},
 focused:{passed:10,failed:0},editor:{passed:529,failed:0,skipped:0,exit_code:0},model_requests:0,
 scope:'Actual Windows browser/native API graph loop produces scoped PNGs read through the real original-owner SDK HTTP port. Readback changes neither publication nor usage, and pause clears capture. Actual compiled editor transport verifies linked C17 descriptors and SHA256 bytes; controller/DOM fixtures fence foreign/late/expired evidence and keep Stop independent. No physical VS Code host activation, editor-started CU, provider understanding or desktop qualification inferred.',
 evidence_bounds:{raw_image_bytes:1048576,response_bytes:2097152,reads_capture:false,writes_graph:false,grants:false},
 frozen:{revision:18,contracts:42,baseline_sha256:sha(baselineBytes),contract_source_sha256:baseline.contract_source_sha256},
 remaining:['Slice31 native workers, native CLI/provider built-ins, complete editor execution and CU/XS joins.',
 'Slice26 reviewed live cutover,27 actual paired usefulness,28 synchronized release; version13.4.0. Windows global unchanged; no live migration or paid inference.'],artifacts};
await writeFile('docs/ashoka/slice-31-editor-evidence-conformance.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:result.status,root:result.root,editor:529,hashes:artifacts.length,model_requests:0}));
