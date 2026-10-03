/** Actual compiled provider parsing/admission; no built-in Computer Use or model understanding claim. */
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const sha=value=>createHash('sha256').update(value).digest('hex');
const json=async path=>JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));
const root=await json('docs/ashoka/slice-31-provider-output-root-second.json'),focus=await json('docs/ashoka/slice-31-provider-output-focus-third.json');
assert.equal(root.success,true);assert.equal(root.numPassedTests,1994);assert.equal(root.numFailedTests,0);assert.equal(root.numPendingTests,2);
assert.equal(focus.success,true);assert.equal(focus.numPassedTests,182);
for(const stem of ['build-first','editor-build-second','editor-third','focus-third','lease-focus','root-second'])assert.equal((await json('docs/ashoka/slice-31-provider-output-'+stem+'-exit.json')).exit_code,0,stem);
const editor=await readFile('docs/ashoka/slice-31-provider-output-editor-third.log','utf8');assert.match(editor,/pass 522/);assert.match(editor,/fail 0/);assert.match(editor,/cancelled 0/);
const bytes=await readFile('tests/fixtures/ashoka/baseline.json'),baseline=JSON.parse(bytes);assert.equal(baseline.revision,18);assert.equal(baseline.contracts.length,42);
const paths=['src/cognitive/provider-outcome.ts','src/cognitive/llm.ts','extensions/vscode/src/architect-llm.ts','extensions/vscode/src/generated/provider-outcome.ts',
 'tests/provider-outcome.test.ts','tests/host-managed-execution.test.ts','tests/plan-context-integration.test.ts','tests/fixtures/ashoka/baseline.json',
 'scripts/generate-provider-contracts.mjs','scripts/record-ashoka-provider-output-evidence.mjs','scripts/qualify-ashoka-native-review.mjs','docs/ashoka/native-review-31-provider.mjs','docs/ashoka/computer-use.md','docs/architecture.md'];
for(const name of await readdir('docs/ashoka'))if(/^slice-31-provider-output-.*\.(json|log)$/.test(name)&&!name.includes('conformance'))paths.push('docs/ashoka/'+name);
const artifacts=[];for(const path of paths){const value=await readFile(path);artifacts.push({path,bytes:value.length,sha256:sha(value)});}
const result={schema:'dreamgraph.ashoka.computer_checkpoint.v1',recorded_at:new Date().toISOString(),status:'unmapped_provider_output_qualified_slice31_in_progress',
 root:{passed:1994,failed:0,skipped:2,files:175,max_workers:4,exit_code:0,elapsed_seconds:(Math.max(...root.testResults.map(t=>t.endTime))-root.startTime)/1000},
 focused:{passed:182,failed:0},editor:{passed:522,failed:0,skipped:0,exit_code:0},model_requests:0,native_input:0,
 scope:'Core and actual compiled editor native API parsing refuse unmapped native tool/image output or incomplete calls. Real declared admission/settlement preserves known usage, acknowledges failed work and logs no raw secret. No fallback/retry/native dispatch, provider built-in qualification or real-model understanding is inferred.',
 frozen:{revision:18,contracts:42,baseline_sha256:sha(bytes),contract_source_sha256:baseline.contract_source_sha256},
 retained_failures:['Second focused run exposed missing compiled Anthropic native-tool validation. Correct path was rebuilt and third run passed.',
  'First full root run passed1993 and failed one fixed-date/real-clock lease test at the UTC date boundary. Date-only deterministic time now exercises the same running-to-expired durable projection without changing production lease limits. Six focused lease cases and the second full root run pass.'],
 remaining:['Slice31 native workers, native CLI control/provider built-in integration, complete editor execution and CU/XS joins.',
  'Slice26 reviewed live cutover,27 actual paired usefulness,28 synchronized release; version13.4.0. Windows global unchanged, no paid inference or live migration.'],artifacts};
await writeFile('docs/ashoka/slice-31-provider-output-conformance.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:result.status,root:result.root,editor:522,hashes:artifacts.length,model_requests:0}));
