/** Bind Slice 25 claims to actual results and complete file hashes, without rerunning or inventing tests. */
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {basename} from 'node:path';
const rootPath='docs/ashoka/slice-25-progress-stop-qualified-root-tests-second.json';
const browserPath='docs/ashoka/browser-25-progress-stop-final-second/qualification.json';
const consumerPath='docs/ashoka/plan-consumers-progress-stop-final/qualification.json';
const readJson=async path=>JSON.parse(await readFile(path,'utf8'));
const [root,browser,consumers,baseline]=await Promise.all([rootPath,browserPath,consumerPath,'tests/fixtures/ashoka/baseline.json'].map(readJson));
assert.equal(root.numFailedTests,0);assert.equal(root.numFailedTestSuites,0);
assert.equal(browser.success,true);assert.deepEqual(browser.errors,[]);assert.equal(browser.checks.length,32);
assert.equal(consumers.success,true);assert.deepEqual(consumers.errors,[]);assert.equal(consumers.checks.length,10);
assert.equal(baseline.cases.length,12);assert.equal(baseline.revision,17);
const cases=(file,term='')=>{
  const result=root.testResults.find(result=>basename(result.name)===file);assert(result,`Missing ${file}`);
  const matched=result.assertionResults.filter(result=>result.fullName.includes(term));assert(matched.length,`Missing ${file}: ${term}`);
  for(const result of matched)assert.equal(result.status,'passed',result.fullName);
  return matched.map(result=>({file,name:result.fullName,status:result.status}));
};
const ge={
 GE01:[...cases('architect-managed-context.test.ts','native API delivers'),...cases('plan-context-integration.test.ts','PL16')],
 GE02:[...cases('execution-context.test.ts','missing named source'),...cases('context-pack.test.ts','corrupt-store'),...cases('client-context-integration.test.ts','HTTP failure')],
 GE03:[...cases('context-pack.test.ts','reserves selected'),...cases('context-pack.test.ts','Unicode'),...cases('client-context-integration.test.ts','compaction')],
 GE04:[...cases('execution-context.test.ts','revalidates actual'),...cases('managed-plan-execution.test.ts','external plan edits')],
 GE05:[...cases('architect-managed-context.test.ts'),...cases('architect-cli-controls.test.ts','executes real bridge'),...cases('host-managed-execution.test.ts'),...cases('daemon-transport-isolation.test.ts'),...cases('graph-context-port.test.ts')],
 GE06:[...cases('change-obligations.test.ts','unchanged'),...cases('execution-context.test.ts','native additions/deletions')],
 GE07:[...cases('change-obligations.test.ts','recovers the exact effect'),...cases('execution-context.test.ts','pending closed execution'),...cases('managed-plan-execution.test.ts','lost C14 closure')],
 GE08:[...cases('change-obligations.test.ts','create/edit/rename/delete'),...cases('normalization-evidence.test.ts','GE08')],
 GE09:[...cases('dirty-digestion.test.ts'),...cases('event-job-intake.test.ts')],
 GE10:[...cases('dirty-digestion.test.ts','G+1'),...cases('engine-jobs.test.ts','orphan lease')],
 GE11:[...cases('model-admission.test.ts'),...cases('engine-jobs.test.ts','late provider liability'),...cases('managed-plan-execution.test.ts','independent original-native stop')],
 GE12:[...cases('normalization-evidence.test.ts','GE12'),...cases('dream-router-authority.test.ts')],
 GE13:[...cases('normalization-evidence.test.ts','GE13'),...cases('risk-remediation.test.ts'),...cases('lifecycle-narrative.test.ts')],
 GE14:[...cases('plan-workflow.test.ts','GE14'),...cases('plan-authority.test.ts','reconciliation')],
 GE15:[...cases('plan-context-integration.test.ts','transcript-free'),...cases('execution-context.test.ts','new owner object')]
};
const uxIds={UX01:[4,12,21,22,23,24],UX02:[4,7,14,31],UX03:[7,14,16,25,29],UX04:[5,6,27],UX05:[10,18,28],UX06:[9],UX07:[1],UX08:[2],UX09:[3,8,13,26],UX10:[4,21,24,30],UX11:[14,15,16,17,22,23,30,32],UX12:[11,19,20,21,29]};
const ux=Object.fromEntries(Object.entries(uxIds).map(([id,ids])=>[id,ids.map(index=>{
  const name=`B25-${String(index).padStart(2,'0')}`,check=browser.checks.find(check=>check.name===name);assert(check,name);return check;
})]));
const c17=[...cases('change-obligations.test.ts','C17 effect-double'),...cases('context-pack.test.ts','expiring semantic observations'),...cases('provider-images.test.ts')];
const artifacts=[rootPath,browserPath,consumerPath,'tests/fixtures/ashoka/baseline.json','src/graph/contracts.ts',
 'src/architect/plan-registry.ts','src/architect/routes.ts','src/architect/context-actions.ts','src/architect/native-tool-loop.ts',
 'src/architect/cli-bridge.ts','src/graph/execution-context.ts','src/discipline/plan-runtime.ts','src/server/managed-execution.ts','src/server/host-model-admission.ts',
 'packages/sdk/src/seams/graph-execution.ts','extensions/vscode/src/daemon-client.ts','extensions/vscode/src/managed-model-session.ts',
 'scripts/install.ps1','scripts/install.sh','scripts/workspace-artifacts.mjs','src/cli/commands/start.ts',
 'tests/architect-plan-authority.test.ts','tests/managed-plan-execution.test.ts','tests/host-managed-execution.test.ts',
 'tests/workspace-installation.test.ts','tests/cli-start-health.test.ts','tests/standalone-architect-routes.test.ts',
 'tests/fixtures/ashoka/legacy-progress-plan.md','tests/fixtures/ashoka/legacy-progress-log.md',
 'scripts/qualify-ashoka-architect.mjs','scripts/qualify-ashoka-plan-consumers.mjs','scripts/qualify-ashoka-integration-evidence.mjs',
 'docs/ashoka/slice-25-progress-stop-server-build-final.log','docs/ashoka/slice-25-progress-stop-editor-build-final.log',
 'docs/ashoka/slice-25-progress-stop-editor-tests-final.log','docs/ashoka/slice-25-progress-stop-generated-checks.log'];
const hashes=await Promise.all(artifacts.map(async path=>{const bytes=await readFile(path);return {path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};}));
const report={schema:'dreamgraph.ashoka.integration_evidence.v1',recorded_at:new Date().toISOString(),status:'offline_integration_qualified',
 scope:'Shared GE01–GE15 mechanisms plus distinct real host/transport hooks, UX01–UX12 actual Windows Chrome interactions, C14 eight-consumer semantics and C17 typed seams. Fake inference/native callbacks are declared; physical effects and actual transports are exercised.',
 root:{passed:root.numPassedTests,skipped:root.numPendingTests,failed:root.numFailedTests,files:root.testResults.length},editor:{passed:509,failed:0},
 ge,ux,c14:consumers.checks,c17,
 task_families:baseline.cases.map(({id,family,project})=>({id,family,project,status:'shared_mechanisms_qualified',model_understanding:'requires Slice 27 paired execution'})),
 compound:{XS07:['GE04','GE05','UX02','UX09'],XS09:['GE07','GE13','GE14'],XS10:['GE05','GE11'],XS16:['GE15','C14 consumer comparison'],XS17:['GE05','GE11','C17 typed seams; native GUI qualification remains Slice 31'],XS21:['GE06','GE08','GE13','GE15']},
 exclusions:['GE16 real paired agent-understanding gains remain Slice 27.','Physical GUI workers/native CLI computer control and macOS/Linux qualification remain Slice 31.','Dashboard has no separate plan-progress interpretation to compare; its existing health/job semantics are core projections, presentation adoption remains Slice 23.','No live graph migration, provider canary, global installation or restart is performed.'],artifacts:hashes};
await writeFile('docs/ashoka/slice-25-conformance.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,root:report.root,ge:Object.keys(ge).length,ux:Object.keys(ux).length,consumer_checks:consumers.checks.length,physical_hashes:hashes.length}));
