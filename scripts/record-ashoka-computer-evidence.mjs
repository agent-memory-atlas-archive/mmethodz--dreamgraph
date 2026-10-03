/** Record a scoped checkpoint; this cannot qualify every CU case, OS or release. */
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {browserWorkerSourceHash} from '../dist/computer/browser-harness.js';
import {computerDigest} from '../dist/computer/digest.js';
const read=async path=>JSON.parse((await fs.readFile(path,'utf8')).replace(/^\uFEFF/,''));
const checkpoint=process.argv[2]??'foundation';assert(['foundation','controls'].includes(checkpoint),'Unknown checkpoint');
const controls=checkpoint==='controls',rootPath=controls?'docs/ashoka/slice-31-controls-root-tests':'docs/ashoka/slice-31-foundation-root-tests-fifth';
const browserPath=controls?'docs/ashoka/slice-31-installed-browser-qualification-controls':'docs/ashoka/slice-31-installed-browser-qualification-fourth';
const editorPath=controls?'docs/ashoka/slice-31-controls-editor':'docs/ashoka/slice-31-editor';
const editorTests=controls?editorPath+'-tests-second':editorPath+'-tests';
const root=await read(rootPath+'.json');
assert.equal(root.success,true);assert.equal(root.numFailedTests,0);
assert.equal((await read(rootPath+'-exit.json')).exit_code,0);
const browser=await read(browserPath+'.json');
assert.equal(browser.schema,'dreamgraph.browser_runtime_qualification.v1');assert.equal(browser.evidence.model_requests,0);
assert.equal(browser.worker.qualification.evidence_scope,'actual_runtime');
assert.equal(browser.worker.qualification.source_hash,await browserWorkerSourceHash());
assert.equal(browser.worker.qualification.artifact_hash,computerDigest(browser.evidence));
assert.equal(browser.evidence.traces.length,controls?11:10);
const baselineBytes=await fs.readFile('tests/fixtures/ashoka/baseline.json'),baseline=JSON.parse(baselineBytes);
const previous=await read('docs/ashoka/baselines/'+baseline.previous_sha256+'.json');
for(const field of ['owners','cases','evidence'])assert.deepEqual(baseline[field],previous[field],field+' stays frozen');
const tests=root.testResults.filter(file=>/computer-(broker|browser-worker|browser-registry|journal|capabilities|seat|use-ui)\.test|session-authority\.test|configuration-http\.test|architect-managed-context\.test/.test(file.name)
 ||controls&&/computer-(configuration|native-graph-loop)\.test|configuration-workspace\.test|engine-configuration\.test|host-managed-execution\.test|model-execution\.test/.test(file.name))
 .flatMap(file=>file.assertionResults.map(test=>({file:file.name.split(/[\\/]/).at(-1),name:test.fullName,status:test.status})));
assert(tests.length>60);assert(tests.every(test=>test.status==='passed'));
const files=['src/computer/broker.ts','src/computer/browser-driver.ts','src/computer/browser-harness.ts','src/computer/browser-profile.ts',
 'src/computer/browser-worker-entry.ts','src/computer/browser-registry.ts','src/computer/capabilities.ts','src/computer/digest.ts','src/computer/http.ts',
 'src/computer/journal.ts','src/computer/journal-schema.ts','src/computer/native-tools.ts','src/computer/physical-seat.ts','src/computer/qualify-browser.ts','src/computer/worker-port.ts',
 'src/server/computer-control.ts','src/server/session-authority.ts','src/server/http-authority.ts','src/server/managed-execution.ts','src/graph/execution-context.ts',
 'src/architect/computer-use-ui.ts','src/architect/native-tool-loop.ts','src/architect/routes.ts','src/cli/commands/computer-use.ts','src/cli/dg.ts',
 'src/graph/contracts.ts','src/cognitive/jobs.ts','src/cognitive/provider-images.ts','package.json','package-lock.json','tests/fixtures/ashoka/baseline.json',
 'tests/computer-broker.test.ts','tests/computer-browser-worker.test.ts','tests/computer-browser-registry.test.ts','tests/computer-capabilities.test.ts','tests/computer-journal.test.ts',
 'tests/computer-seat.test.ts','tests/computer-use-ui.test.ts','tests/host-managed-execution.test.ts','docs/ashoka/computer-use.md',
 rootPath+'.json',rootPath+'.log',rootPath+'-exit.json',browserPath+'.json',browserPath+'.log',
 controls?'docs/ashoka/slice-31-controls-build.log':'docs/ashoka/slice-31-build-twenty-second.log',
 controls?'docs/ashoka/slice-31-controls-generated-checks.log':'docs/ashoka/slice-31-generated-checks.log',
 editorPath+'-build.log',editorTests+'.log',editorTests+'-exit.json'];
if(controls)files.push('src/computer/configuration.ts','src/config/engine-configuration.ts','src/instance/identity.ts','src/cognitive/model-execution.ts',
 'src/server/host-model-admission.ts','src/server/configuration-workspace.ts','tests/computer-configuration.test.ts','tests/computer-native-graph-loop.test.ts',
 'tests/configuration-workspace.test.ts','docs/ashoka/model-admission.md','docs/ashoka/slice-31-native-pause-focus-first.log',
 'docs/ashoka/slice-31-native-pause-focus-second.log','docs/ashoka/slice-31-native-graph-loop-eighth.log','docs/ashoka/slice-31-profile-configuration-third.log',
 'scripts/record-ashoka-computer-evidence.mjs','docs/ashoka/native-review-31.mjs','docs/ashoka/slice-31-controls-editor-tests.log','docs/ashoka/slice-31-controls-editor-tests-exit.json');
const artifacts=[];for(const path of files){const bytes=await fs.readFile(path);artifacts.push({path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
assert.equal((await read(editorTests+'-exit.json')).exit_code,0);
const result={schema:'dreamgraph.ashoka.computer_checkpoint.v1',recorded_at:new Date().toISOString(),status:controls?'original_host_browser_controls_qualified_slice31_in_progress':'original_host_browser_foundation_qualified_slice31_in_progress',
 root:{passed:root.numPassedTests,failed:0,skipped:root.numPendingTests,files:root.testResults.length,exit_code:0},
 frozen:{revision:baseline.revision,contracts:baseline.contracts.length,baseline_sha256:createHash('sha256').update(baselineBytes).digest('hex'),contract_source_sha256:baseline.contract_source_sha256},
 scope:{physical:'Actual isolated Windows Chrome/process and compiled local qualification command; exact runtime and measured subchecks below.',
  core:'Actual execution, grant, job, publication and journal owners. Some executor/provider/UI/registration tests are declared doubles, not OS/model qualification.',
  native_api:controls?'Actual Chrome/native provider HTTP with declared deterministic replies proves original pause/resume, GUI source debt, separately approved graph reconciliation and next-pass current context. Paid-model understanding and provider-native/CLI joins remain open.':'Custom computer tools are integrated into the original Architect loop; whole real-worker/provider-HTTP and provider-native/CLI adapter joins remain open.'},
 tests,browser,
 joins:{XS01:'Original execution/job/finite grant/profile pins; no competing runtime or job database.',XS09:'Exact supervised action review and metadata-only traces; private image/structural descriptors are distinct.',
  XS17:'Intent before real input, unknown reply, identical retry without redispatch; stopped worker and unresolved external effect stay separate.',
  XS20:controls?'Composed real browser/provider HTTP fixture: finite original scope pauses/resumes, actual GUI source write becomes debt, separate graph owner commits it, and the next original pass receives current evidence. Provider replies are declared fixtures, not model understanding or full CU/XS qualification.':'Foundation only: actual GUI evidence is distinct from source reconciliation, graph receipt and plan verification; full task/graph loop remains open.'},
 retained_failures:['Initial source loader/Windows typings/route placement failures; invalid navigation fixture and grant identity reuse.',
  'Root attempts one/two/three/four and focused stop failure traces remain. Fixture startup/expiry bounds were corrected while real expiry/recovery assertions stay; the fifth complete run uses two workers to bound local CPU contention.',
  'The first generated-check run found configuration inventory drift after source additions; regeneration preserved all 308 typed entries and the final six checks pass.',
  'Serial request disposal delayed browser stop; lost stop reply discarded recovery peer; watchdog success exit could mask closure rejection. Production fixes are covered.',
  'The disconnect assertion incorrectly required one second; C17 specifies five seconds for severed control channels. Explicit responsive stop remains one second.',
  'Qualification attempts one/two/three remain unqualified: missing canonical fixture repository, expected unknown-job recovery and cleanup masking an earlier failure.'],
 remaining:['Full Slice31A–H: peer native workers and actual macOS/Linux qualification; native CLI permissions/events/stop and provider-native tool mapping.',
  ...(controls?['Installed activation/uninstall and scope re-grant; forced-crash unknown-effect readback, VS Code controls and actual provider model understanding.']:
   ['Dedicated computer model-role execution choice; integrated setup/dashboard profiles, installed activation/uninstall and scope re-grant.',
    'Whole real-worker/native-provider-HTTP/source-to-graph-to-next-agent joins, forced-crash unknown-effect recovery, pause/reconnect and VS Code controls.']),
  'Full CU01–CU24/XS conformance, live Slice26 reviewed cutover, paired model understanding, Slice27 and synchronized release Slice28.'],artifacts};
if(controls)result.retained_failures.push('The first profile tests failed teardown of uncreated directories and then foreign execution-owner errors returned 500; corrected cleanup and explicit denial classification preserve all authority guards.',
 'The initial composed loop exposed task-scope and advertised-tool fixture errors; explicit independent GUI/scan review and actual listed tool selection repaired the declared fixture.',
 'The new qualification attempted to resume after a denied redirect invalidated the document. Pause/resume now runs before confinement attacks; no scope check was relaxed.',
 'The first paused-expiry fixture expired during startup rather than while paused. The finite three-second case explicitly proves the paused boundary before original expiry; one-second pause acknowledgement remains unchanged.');
if(controls){const editorLog=await fs.readFile(editorTests+'.log','utf8'),counts=Object.fromEntries([...editorLog.matchAll(/^# (tests|pass|fail|skipped) (\d+)$/gm)].map(match=>[match[1],Number(match[2])]));
 assert(counts.tests>500&&counts.fail===0&&counts.pass===counts.tests-counts.skipped,'Complete compiled editor gate');result.editor={...counts,exit_code:0};
 result.retained_failures.push('The first current editor test invocation ran from the root directory, causing relative source-file assertions to fail. The complete second invocation uses the extension directory; no editor/source assertion was weakened.');}
await fs.writeFile(controls?'docs/ashoka/slice-31-controls-conformance.json':'docs/ashoka/slice-31-conformance.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:result.status,root:result.root,affected_tests:tests.length,measured_runtime_checks:browser.evidence.traces.length,hashes:artifacts.length}));
