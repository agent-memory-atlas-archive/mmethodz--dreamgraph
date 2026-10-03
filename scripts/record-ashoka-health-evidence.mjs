/** Seal the transport/navigation repair checkpoint; no live mutation or release approval. */
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {browserWorkerSourceHash} from '../dist/computer/browser-harness.js';
import {computerDigest} from '../dist/computer/digest.js';
const read=async path=>JSON.parse((await fs.readFile(path,'utf8')).replace(/^\uFEFF/,''));
const rootPath='docs/ashoka/slice-26-health-root-tests-second',root=await read(rootPath+'.json');
assert.equal(root.success,true);assert.equal(root.numFailedTests,0);
assert.equal((await read(rootPath+'-exit.json')).exit_code,0);
const navigation=await read('docs/ashoka/browser-26-health-second/qualification.json');
assert.equal(navigation.success,true);assert.deepEqual(navigation.errors,[]);assert.equal(navigation.checks.length,8);
assert.equal(navigation.health_probes.count,528);assert.equal(navigation.health_probes.unchanged_authority,true);assert.equal(navigation.health_probes.unchanged_publication,true);
const browser=await read('docs/ashoka/slice-26-health-browser-qualification.json');
assert.equal(browser.schema,'dreamgraph.browser_runtime_qualification.v1');assert.equal(browser.evidence.model_requests,0);
assert.equal(browser.worker.qualification.evidence_scope,'actual_runtime');assert.equal(browser.evidence.traces.length,11);
assert.equal(browser.worker.qualification.source_hash,await browserWorkerSourceHash());
assert.equal(browser.worker.qualification.artifact_hash,computerDigest(browser.evidence));
const baselineBytes=await fs.readFile('tests/fixtures/ashoka/baseline.json'),baseline=JSON.parse(baselineBytes);
const previous=await read('docs/ashoka/baselines/'+baseline.previous_sha256+'.json');
for(const field of ['owners','cases','evidence'])assert.deepEqual(baseline[field],previous[field],field+' remains frozen');
const tests=root.testResults.filter(file=>/http-health-authority|http-instance-isolation|daemon-transport-isolation|computer-browser-worker|computer-native-graph-loop|publication-read-cache|architect-plan-authority|plan-context-integration|onboarding-readiness/.test(file.name))
 .flatMap(file=>file.assertionResults.map(test=>({file:file.name.split(/[\\/]/).at(-1),name:test.fullName,status:test.status})));
assert(tests.length>30);assert(tests.every(test=>test.status==='passed'));
const files=['src/server/http-authority.ts','src/server/http-policy.ts','src/server/session-authority.ts','src/index.ts',
 'src/computer/browser-harness.ts','src/computer/browser-worker-entry.ts','src/computer/browser-driver.ts','src/computer/qualify-browser.ts',
 'src/graph/publication.ts','src/architect/plan-registry.ts','src/architect/onboarding-readiness.ts',
 'tests/http-health-authority.test.ts','tests/daemon-transport-isolation.test.ts','tests/computer-native-graph-loop.test.ts','tests/computer-browser-worker.test.ts',
 'tests/fixtures/ashoka/baseline.json','scripts/qualify-ashoka-navigation.mjs','scripts/record-ashoka-health-evidence.mjs','docs/ashoka/native-review-26-health.mjs',
 'scripts/qualify-ashoka-native-review.mjs','docs/ashoka/session-authority.md','docs/ashoka/legacy-upgrade.md','docs/ashoka/computer-use.md','README.md','docs/architecture.md',
 rootPath+'.json',rootPath+'.log',rootPath+'-exit.json','docs/ashoka/slice-26-health-root-tests.json','docs/ashoka/slice-26-health-root-tests.log',
 'docs/ashoka/slice-26-health-root-tests-exit.json','docs/ashoka/slice-26-health-build-second.log','docs/ashoka/slice-26-health-generated-checks-second.log',
 'docs/ashoka/slice-26-health-browser-focus-second.log','docs/ashoka/slice-26-health-focus-first.log','docs/ashoka/slice-26-health-browser-qualification.json',
 'docs/ashoka/slice-26-health-browser-qualification.log','docs/ashoka/slice-26-health-live-observation.json','docs/ashoka/slice-26-live-preview-current.log',
 'docs/ashoka/browser-26-health/qualification.json','docs/ashoka/slice-26-health-navigation.log',
 'docs/ashoka/browser-26-health-second/qualification.json','docs/ashoka/browser-26-health-second/architect.png','docs/ashoka/slice-26-health-navigation-second.log'];
const artifacts=[];for(const path of files){const bytes=await fs.readFile(path);artifacts.push({path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
const evidence={schema:'dreamgraph.ashoka.transport_navigation_checkpoint.v1',recorded_at:new Date().toISOString(),status:'transport_navigation_qualified_live_cutover_pending',
 root:{passed:root.numPassedTests,failed:0,skipped:root.numPendingTests,files:root.testResults.length,exit_code:0},
 frozen:{revision:baseline.revision,contracts:baseline.contracts.length,baseline_sha256:createHash('sha256').update(baselineBytes).digest('hex'),contract_source_sha256:baseline.contract_source_sha256},
 live_observation:await read('docs/ashoka/slice-26-health-live-observation.json'),navigation,browser,tests,
 scope:'Actual source daemon/session/publication integration, disposable compiled Windows Chrome/CLI and source graph/receipt scale. Health liveness neither creates authority nor attests graph recovery. Installed users and grants remain untouched.',
 joins:{XS01:'Health host/origin/remote authentication and execution-bearer restrictions remain; no competing identity owner or bypass to graph operations.',
  XS18:'Disposable compiled navigation/legacy notices and reviewed CLI apply/replay/restore pass; original live migration is not authorized by these checks.',
  XS20:'Actual browser/native declared-provider loop retains pause, source debt, separate graph receipt and current next-agent evidence; no paid-model understanding claim.'},
 retained_failures:['Installed authority had 512 twelve-hour sessions and zero grants; repeated GET /health logged SESSION_CAPACITY. Read-only metadata and original expiries are recorded without secrets or eviction.',
  'First current full root failed early isolated worker pairing at its five-second cold-start bound. Pairing now has a finite fifteen-second module-loading window before any browser launch; one-second Stop/pause and five-second control loss remain unchanged. Phase diagnostics expose future timeout location.',
  'First refreshed browser fixture passed health and list checks but its broad current-slice locator matched both reported in-progress slices26/31. The final fixture explicitly selects Slice26; no product status, evidence or assertion of a running lease was weakened.',
  'A read-only live graph preview refused a pending publication journal. It did not recover, rewrite or migrate active data; transient writer activity is not a claim of persistent corruption.'],
 remaining:['Unexpired probe-created identities are not retroactively evicted. Existing users can retain their owner or let original expiry reclaim slots after installing/restarting the source repair.',
  'Full Slice26 reviewed own-instance conflict dispositions, coherent cutover/fence, verified backup and U0–U8 gates remain open.',
  'Full Slice31 native/platform/provider/CLI/editor/forced-crash qualification, Slice27 actual model usefulness and Slice28 synchronized release remain open. Product13.4.0; no global install/restart or paid inference.'],artifacts};
await fs.writeFile('docs/ashoka/slice-26-health-conformance.json',JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:evidence.status,root:evidence.root,affected_tests:tests.length,hashes:artifacts.length,navigation_ms:navigation.plans_visible_ms,selection_ms:navigation.selected_plan_visible_ms,health_probes:navigation.health_probes}));
