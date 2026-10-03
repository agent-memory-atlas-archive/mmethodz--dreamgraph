/** Bind the composed gate and plan/computer joins to exact current sources, never full release approval. */
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {basename} from 'node:path';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=async path=>JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));
const directory='docs/ashoka/slice-27-offline-gate-fifth',gate=await json(directory+'/result.json'),root=await json(directory+'/root-tests.json');
assert.equal(gate.status,'passed');assert.equal(gate.steps.length,12);assert(gate.steps.every(step=>step.exit_code===0&&step.child_closed&&!step.failure));
assert.equal((await json('docs/ashoka/slice-27-offline-gate-fifth-exit.json')).exit_code,0);
assert.equal(root.success,true);assert.equal(root.numFailedTests,0);assert.equal(root.numPassedTests,2013);assert.equal(root.numPendingTests,2);assert.equal(root.testResults.length,179);
assert.equal(gate.editor.passed,546);assert.equal(gate.browser.checks,11);assert(gate.browser.stop_release_ms<=1000&&gate.browser.control_loss_stop_ms<=5000);
const source=await json(directory+'/source-inventory.json');assert.equal(source.hash,gate.source_hash);
for(const file of source.files)assert.equal(sha(await readFile(file.path)),file.sha256,file.path);
const cases=file=>{const suite=root.testResults.find(result=>basename(result.name)===file);assert(suite,file);assert(suite.assertionResults.every(test=>test.status==='passed'),file);
 return suite.assertionResults.map(test=>({name:test.fullName,status:test.status}));};
const joined=cases('computer-native-graph-loop.test.ts');assert.equal(joined.length,6);
const baseline=await json('tests/fixtures/ashoka/baseline.json');assert.equal(baseline.revision,18);assert.equal(baseline.contracts.length,42);
const paths=[...source.files.filter(file=>['src/architect/routes.ts','src/cognitive/role-qualification.ts','tests/computer-native-graph-loop.test.ts','tests/ashoka-system-gate.test.ts',
 'scripts/run-ashoka-system-checks.mjs','scripts/run-ashoka-editor-tests.mjs','scripts/ashoka-ci-browser.mjs','.github/workflows/ashoka.yml','package.json','vitest.config.ts'].includes(file.path)).map(file=>file.path),
 '.gitignore','docs/ashoka/system-gate.md','docs/ashoka/plan-computer-integration.md','docs/ashoka/record-27-offline.mjs','docs/ashoka/native-review-27.mjs','docs/architecture.md','tests/fixtures/ashoka/baseline.json'];
for(const name of await readdir(directory))paths.push(directory+'/'+name);
for(const name of await readdir('docs/ashoka'))if(/^slice-27-(?:offline-gate-(?:first|second|third|fourth|fifth)|editor-runner-second|gate-runner-focus-first|gate-configuration).*\.(?:log|json)$/.test(name))paths.push('docs/ashoka/'+name);
for(const failed of ['first','second','third','fourth'])for(const name of await readdir('docs/ashoka/slice-27-offline-gate-'+failed))paths.push('docs/ashoka/slice-27-offline-gate-'+failed+'/'+name);
for(const name of await readdir('docs/ashoka'))if(/^slice-31-plan-computer-focus-.*\.(?:log|json)$/.test(name))paths.push('docs/ashoka/'+name);
const artifacts=[];for(const path of [...new Set(paths)]){const bytes=await readFile(path);artifacts.push({path,bytes:bytes.length,sha256:sha(bytes)});}
const report={schema:'dreamgraph.ashoka.system_checkpoint.v1',recorded_at:new Date().toISOString(),status:'offline_system_checkpoint_slice27_in_progress',
 gate:{source_hash:gate.source_hash,platform:gate.platform,architecture:gate.architecture,node:gate.node,steps:gate.steps,root:gate.root,editor:gate.editor,browser:gate.browser},
 actual_plan_computer_joins:joined,offline_gate_acceptance:cases('ashoka-system-gate.test.ts'),
 assertions:{original_plan_scope:true,no_gui_implied_slice_verification:true,source_reconciliation_has_separate_receipt:true,stop_retains_unconfirmed_adapter_recovery:true,
  context_limit_preserves_reconciliation_debt:true,failed_role_revokes_own_health:true,no_model_escalation_or_limit_increase:true},
 failures:{retained:true,gate_first:'Configuration inventory source-line drift; regenerated and checked.',
  gate_second:'Compiled editor runner used repository cwd instead of extension cwd; fixed without excluding any test.',
  gate_third:'One Windows fixture ENOTEMPTY cleanup failure after graph/lifecycle assertions. Added actual async-handler drain and bounded filesystem retries; no production cancellation change.',
  gate_fourth:'One four-worker browser qualification failed with no bounded phase diagnostics in the earlier fixture. Its cause remains unproven. Added bounded diagnostics and one unchanged-host qualification shared across six separately scoped sessions; full suite now uses two workers. Production Stop bounds remain unchanged; no stress-load qualification is inferred.',
  earlier_plan_joins:'Missing matching plan ID, incorrect SDK method and insufficient positive-fixture context allocation. The unchanged smaller allocation remains an actual refusal/recovery case.'},
 evidence_scope:'Actual local Windows gate; compiled editor/DOM boundaries and deterministic provider replies declared. Browser/input/source/daemon/SDK/graph joins are actual. No paid inference or remote CI execution.',
 real_provider_requests:0,remote_ci_jobs_run:0,
 frozen:{revision:18,contracts:42,baseline_sha256:sha(await readFile('tests/fixtures/ashoka/baseline.json')),contract_source_sha256:baseline.contract_source_sha256},
 remaining:['Slice31 peer native workers, native CLI/provider built-ins, physical editor/platform and complete CU/XS qualification.',
  'Slice26 reviewed live graph cutover; Slice27 complete owner/compound evidence and actual paired usefulness; Slice28 synchronized14.0.0 packaging/install/release.'],
 product_version:'13.4.0',windows_global_changed:false,artifacts};
await writeFile('docs/ashoka/slice-27-offline-conformance.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:report.status,root:report.gate.root,editor:report.gate.editor,browser:report.gate.browser,hashes:artifacts.length}));
