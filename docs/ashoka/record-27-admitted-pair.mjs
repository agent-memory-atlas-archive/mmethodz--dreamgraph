/** Exact offline admitted-collection checkpoint. No real-model usefulness or whole-slice acceptance. */
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=async path=>JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));
const directory='docs/ashoka/slice-27-offline-gate-sixth',gate=await json(directory+'/result.json'),root=await json(directory+'/root-tests.json');
assert.equal(gate.status,'passed');assert.equal(gate.steps.length,12);assert(gate.steps.every(step=>step.exit_code===0&&step.child_closed&&!step.failure));
assert.equal((await json('docs/ashoka/slice-27-offline-gate-sixth-exit.json')).exit_code,0);
assert.equal(root.success,true);assert.equal(root.numFailedTests,0);assert.equal(root.numPassedTests,2022);assert.equal(root.numPendingTests,2);assert.equal(root.testResults.length,181);
assert.equal(gate.editor.passed,546);assert.equal(gate.browser.checks,11);assert(gate.browser.stop_release_ms<=1000&&gate.browser.control_loss_stop_ms<=5000);
const source=await json(directory+'/source-inventory.json');assert.equal(source.hash,gate.source_hash);
for(const file of source.files)assert.equal(sha(await readFile(file.path)),file.sha256,file.path);
const cases=file=>{const suite=root.testResults.find(result=>result.name.replaceAll('\\','/').endsWith('/'+file));assert(suite,file);
 assert(suite.assertionResults.every(test=>test.status==='passed'),file);return suite.assertionResults.map(test=>({name:test.fullName,status:test.status}));};
const provider=cases('admitted-agent-evaluation.test.ts'),cli=cases('admitted-agent-evaluation-cli.test.ts');assert.equal(provider.length,6);assert.equal(cli.length,3);
const focus=await json('docs/ashoka/slice-27-admitted-pair-focus-fourth.json');assert.equal(focus.success,true);assert.equal(focus.numPassedTests,47);assert.equal(focus.numFailedTests,0);
const baseline=await json('tests/fixtures/ashoka/baseline.json');assert.equal(baseline.revision,18);assert.equal(baseline.contracts.length,42);
const paths=['src/evaluation/agent-usefulness.ts','src/cognitive/jobs.ts','src/cognitive/job-context.ts','src/cognitive/model-admission.ts','src/cognitive/llm.ts',
 'src/config/role-policy.ts','src/config/model-pricing.ts','src/config/provider-capabilities.ts','scripts/collect-agent-pair.mjs',
 'tests/admitted-agent-evaluation.test.ts','tests/admitted-agent-evaluation-cli.test.ts','tests/helpers/completion-pair-fixture.ts','tests/agent-usefulness.test.ts',
 'tests/engine-jobs.test.ts','tests/model-admission.test.ts','dist/evaluation/agent-usefulness.js','dist/cognitive/jobs.js',
 'docs/ashoka/admitted-agent-evaluation.md','docs/ashoka/record-27-admitted-pair.mjs','docs/ashoka/native-review-27-provider.mjs',
 'docs/ashoka/system-coverage.md','docs/ashoka/record-27-owner-map.mjs','docs/ashoka/slice-27-owner-evidence-map.json',
 'docs/ashoka/slice-27-owner-map-second.log','docs/ashoka/slice-27-owner-map-second-exit.json',
 'docs/ashoka/agent-evaluation-protocol.json','docs/architecture.md','docs/README.md','docs/workflows.md','docs/cognitive-engine.md','README.md','tests/fixtures/ashoka/baseline.json'];
for(const name of await readdir(directory))paths.push(directory+'/'+name);
for(const name of await readdir('docs/ashoka'))if(/^slice-27-(?:admitted-pair-(?:focus|build|docs)-|offline-gate-sixth).*\.(?:log|json)$/.test(name))paths.push('docs/ashoka/'+name);
const artifacts=[];for(const path of [...new Set(paths)]){const bytes=await readFile(path);artifacts.push({path,bytes:bytes.length,sha256:sha(bytes)});}
const report={schema:'dreamgraph.ashoka.admitted_pair_checkpoint.v1',recorded_at:new Date().toISOString(),status:'offline_admitted_collection_checkpoint_slice27_in_progress',
 gate:{source_hash:gate.source_hash,platform:gate.platform,architecture:gate.architecture,node:gate.node,steps:gate.steps,root:gate.root,editor:gate.editor,browser:gate.browser},
 actual_provider_admission_fixtures:provider,actual_compiled_helper_fixtures:cli,focused:{passed:47,failed:0,files:5},
 assertions:{ordinary_callbacks_refuse_real_model:true,preview_no_provider_or_job_write:true,original_operator_and_physical_ledger_digest:true,
  immutable_explicit_tariff_in_original_job:true,one_shared_parent_run_and_daily_ledger:true,no_retry_or_model_escalation:true,
  partial_answer_preserved_on_failure:true,reported_model_mismatch_retained:true,successful_replay_no_redispatch:true,
  cancellation_retains_unknown_liability:true,read_only_context_scope:true,unreviewed_answers_not_scored:true},
 failures:{retained:true,focus_first:'Whitespace-only JSON reformatting did not corrupt canonical content; fixture now changes the retained answer and verifies refusal.',
  focus_third:'Windows temporary logical8.3 path differs from physical realpath; the approval correctly bound the physical ledger. Fixed the assertion, not the physical identity rule.'},
 evidence_scope:'Actual compiled operator, durable job/admission/provider code with intercepted official HTTP and synthetic tariffs/replies. Full local offline gate and isolated browser are actual. No model-quality claim.',
 real_provider_requests:0,remote_ci_jobs_run:0,
 frozen:{revision:18,contracts:42,baseline_sha256:sha(await readFile('tests/fixtures/ashoka/baseline.json')),contract_source_sha256:baseline.contract_source_sha256},
 remaining:['Exact disclosed human allocation/retention approval before any real provider collection. No actual answers or usefulness gain are claimed.',
  'Full frozen twelve AT project tasks, GE16 established-instance understanding, required owner/compound evidence, Slice31 platform/native routes and Slice26 live cutover.',
  'Slice28 synchronized14.0.0 packaging/install/release only after complete feature acceptance.'],
 product_version:'13.4.0',windows_global_changed:false,artifacts};
await writeFile('docs/ashoka/slice-27-admitted-pair-conformance.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:report.status,root:report.gate.root,editor:report.gate.editor,browser:report.gate.browser,hashes:artifacts.length}));
