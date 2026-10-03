/** Seal the original native operator/editor checkpoint, without full Slice31 or release qualification. */
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {browserWorkerSourceHash} from '../dist/computer/browser-harness.js';
import {computerDigest} from '../dist/computer/digest.js';
const read=async path=>JSON.parse((await fs.readFile(path,'utf8')).replace(/^\uFEFF/,''));
const rootPath='docs/ashoka/slice-31-editor-control-root-tests-second',editorPath='docs/ashoka/slice-31-editor-control-editor-tests';
const root=await read(rootPath+'.json');assert.equal(root.success,true);assert.equal(root.numFailedTests,0);assert.equal(root.numFailedTestSuites,0);
assert.equal((await read(rootPath+'-exit.json')).exit_code,0);
const editorLog=await fs.readFile(editorPath+'.log','utf8'),counts=Object.fromEntries([...editorLog.matchAll(/^(?:# |ℹ )(tests|pass|fail|skipped) (\d+)\r?$/gm)].map(match=>[match[1],Number(match[2])]));
assert(counts.tests>=521&&counts.fail===0&&counts.pass===counts.tests&&counts.skipped===0,'Complete compiled editor gate');assert.equal((await read(editorPath+'-exit.json')).exit_code,0);
const browserPath='docs/ashoka/slice-26-health-browser-qualification',browser=await read(browserPath+'.json');
assert.equal(browser.schema,'dreamgraph.browser_runtime_qualification.v1');assert.equal(browser.evidence.model_requests,0);assert.equal(browser.evidence.traces.length,11);
assert.equal(browser.worker.qualification.evidence_scope,'actual_runtime');assert.equal(browser.worker.qualification.source_hash,await browserWorkerSourceHash());
assert.equal(browser.worker.qualification.artifact_hash,computerDigest(browser.evidence));
const baselineBytes=await fs.readFile('tests/fixtures/ashoka/baseline.json'),baseline=JSON.parse(baselineBytes),previous=await read('docs/ashoka/baselines/'+baseline.previous_sha256+'.json');
for(const field of ['owners','cases','evidence'])assert.deepEqual(baseline[field],previous[field],field+' remains frozen');
const tests=root.testResults.filter(file=>/computer-|session-authority|configuration-http|configuration-workspace|architect-managed-context|host-managed-execution|model-execution/.test(file.name))
 .flatMap(file=>file.assertionResults.map(test=>({file:file.name.split(/[\\/]/).at(-1),name:test.fullName,status:test.status})));
assert(tests.length>200);assert(tests.every(test=>test.status==='passed'));
const files=['src/computer/broker.ts','src/computer/browser-driver.ts','src/computer/browser-harness.ts','src/computer/browser-profile.ts','src/computer/browser-worker-entry.ts',
 'src/computer/browser-registry.ts','src/computer/capabilities.ts','src/computer/configuration.ts','src/computer/digest.ts','src/computer/http.ts','src/computer/journal.ts',
 'src/computer/journal-schema.ts','src/computer/native-tools.ts','src/computer/physical-seat.ts','src/computer/qualify-browser.ts','src/computer/worker-port.ts',
 'src/server/computer-control.ts','src/server/session-authority.ts','src/server/http-authority.ts','src/server/managed-execution.ts','src/graph/execution-context.ts',
 'src/graph/contracts.ts','src/architect/native-tool-loop.ts','src/cognitive/jobs.ts','packages/sdk/src/seams/computer-control.ts','packages/sdk/src/seams/graph-execution.ts',
 'packages/sdk/src/index.ts','packages/sdk/src/graph-contracts.ts','packages/sdk/package.json','extensions/vscode/src/computer-control.ts','extensions/vscode/src/daemon-client.ts',
 'extensions/vscode/src/chat-panel.ts','extensions/vscode/src/webview/computer-control.ts','extensions/vscode/src/generated/graph-contracts.ts',
 'extensions/vscode/src/test/computer-control.test.ts','extensions/vscode/src/test/daemon-computer-control.test.ts','extensions/vscode/package.json','extensions/vscode/package-lock.json',
 'tests/computer-native-operator.test.ts','tests/computer-native-graph-loop.test.ts','tests/computer-broker.test.ts','tests/computer-browser-worker.test.ts','tests/computer-journal.test.ts','tests/managed-plan-execution.test.ts',
 'tests/fixtures/ashoka/baseline.json','scripts/record-ashoka-editor-computer-evidence.mjs','scripts/qualify-ashoka-native-review.mjs','docs/ashoka/native-review-31-editor.mjs',
 'README.md','docs/architecture.md','docs/workflows.md','docs/ashoka/computer-use.md','docs/ashoka/session-authority.md','extensions/vscode/README.md',
 rootPath+'.json',rootPath+'.log',rootPath+'-exit.json',editorPath+'.log',editorPath+'-exit.json',browserPath+'.json',browserPath+'.log',
 'docs/ashoka/slice-31-editor-control-server-build-first.log','docs/ashoka/slice-31-editor-control-server-build-fourth.log',
 'docs/ashoka/slice-31-editor-control-editor-build-first.log','docs/ashoka/slice-31-editor-control-editor-build-third.log',
 'docs/ashoka/slice-31-editor-control-focus-first.log','docs/ashoka/slice-31-editor-control-native-focus-second.log','docs/ashoka/slice-31-editor-control-editor-focus-second.log',
 'docs/ashoka/slice-31-editor-control-root-tests.json','docs/ashoka/slice-31-editor-control-root-tests.log','docs/ashoka/slice-31-editor-control-root-tests-exit.json',
 'docs/ashoka/slice-31-editor-control-expiry-focus-second.log',
 'docs/ashoka/slice-31-editor-control-doc-regeneration.log','docs/ashoka/slice-31-editor-control-generated-checks.log'];
const artifacts=[];for(const path of files){const bytes=await fs.readFile(path);artifacts.push({path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
const evidence={schema:'dreamgraph.ashoka.computer_checkpoint.v1',recorded_at:new Date().toISOString(),status:'native_operator_editor_controls_qualified_slice31_in_progress',
 root:{passed:root.numPassedTests,failed:0,skipped:root.numPendingTests,files:root.testResults.length,exit_code:0},editor:{...counts,exit_code:0},
 frozen:{revision:baseline.revision,contracts:baseline.contracts.length,baseline_sha256:createHash('sha256').update(baselineBytes).digest('hex'),contract_source_sha256:baseline.contract_source_sha256},
 scope:{native_operator:'Actual daemon authority, durable execution/journal and portable SDK HTTP. The real Windows browser/provider-HTTP fixture now controls its original pass through that SDK port.',
  editor:'Actual compiled controller, on-demand DOM and editor HTTP transport. Operator ports/HTTP descriptors are declared fixtures, not a real VS Code GUI or editor-started computer pass.',
  physical:'The unchanged exact worker source retains eleven measured compiled Windows Chrome/Node/Playwright subchecks from the health checkpoint. Other OS/native desktop/provider-native/CLI routes are not qualified.'},
 tests,browser,joins:{XS01:'One original native owner; execution workers and browser metadata cannot reach the native control port. No new store, runtime or grants.',
  XS09:'Metadata-only scope/host/route/limits/usage/receipt and literal on-demand rendering. No startup reads, confirmation, credentials, pixels or action arguments.',
  XS17:'Original worker only; missing workers cannot be replaced. Endpoint/instance/selection/page changes fence control, independent Stop bypasses pending waits, and lost replies retain original readback.',
  XS20:'Actual Chrome/provider HTTP with declared deterministic replies proves SDK pause/resume, real GUI source debt, separate approved graph commit and current next-pass context; no paid-model understanding.'},
 retained_failures:['Initial server build passed a condensed list journal into a full-journal projection type; corrected the projection to its actual required fields without changing list scope.',
  'Initial compiled editor build exposed CommonJS/ESM and jsdom typing boundaries. The SDK seam uses lazy supported ESM import and explicit type resolution; the declared DOM fixture uses its local Node loader.',
  'Initial missing-worker test supplied invalid fence0 and hit request validation first. Valid fence1 reaches the same original-worker refusal with no substituted worker or changed grant.',
  'Source inspection found an endpoint-switch race across lazy schema loading. The captured generation now fences that boundary before any new authority request; the compiled HTTP regression proves no retargeted Stop.',
  'The first full root confused C05 caller-wait cancellation with completed original worker shutdown and used a1200ms C14 lease that could expire before admission. The original shutdown acknowledgement is now observed separately; the finite expiry case waits for the actual admitted five-second lease. Production expiry, one-second Stop/pause and five-second control-loss bounds are unchanged.'],
 remaining:['Full editor Computer Use pass startup/preparation, approvals and observation/pixel integration; the drawer is inspection/control only.',
  'Peer native workers and named macOS/Linux physical evidence; provider-native/native CLI events/permission/independent Stop and forced-crash recovery.',
  'Full CU01–CU24/XS qualification, live reviewed Slice26 cutover, actual paired usefulness Slice27 and synchronized release Slice28. Product13.4.0; no global install/restart or paid inference.'],artifacts};
await fs.writeFile('docs/ashoka/slice-31-editor-control-conformance.json',JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:evidence.status,root:evidence.root,editor:evidence.editor,affected_tests:tests.length,hashes:artifacts.length}));
