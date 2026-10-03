/** Record complete bytes of actual qualified results; does not dispatch model or graph work. */
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=JSON.parse(await readFile('docs/ashoka/slice-23-qualified-root-tests-second.json','utf8'));
const browser=JSON.parse(await readFile('docs/ashoka/browser-23-final/qualification.json','utf8'));
const baseline=JSON.parse(await readFile('tests/fixtures/ashoka/baseline.json','utf8'));
assert(root.success);assert.equal(root.numFailedTests,0);assert(browser.success);assert.equal(browser.errors.length,0);assert.equal(browser.checks.length,15);
assert.equal(baseline.owners.length,29);assert.equal(baseline.cases.length,12);assert.equal(baseline.evidence.length,8);
const tests=root.testResults.flatMap(file=>file.assertionResults.map(test=>({file:file.name.replaceAll('\\','/').split('/tests/').at(-1),name:test.fullName,status:test.status})));
const named=tests.filter(test=>['configuration-workspace.test.ts','schedule-workspace.test.ts','client-context-integration.test.ts'].includes(test.file));
assert.equal(named.length,26);assert(named.every(test=>test.status==='passed'));
const paths=['src/server/configuration-workspace.ts','src/server/runtime-workspace.ts','src/server/dashboard.ts','src/api/routes.ts','src/config/engine-setting-catalogue.ts','src/config/engine-configuration.ts','src/cognitive/llm.ts',
 'tests/configuration-workspace.test.ts','tests/latest-model-support.test.ts','tests/host-managed-execution.test.ts','scripts/qualify-ashoka-configuration.mjs',
 'docs/ashoka/configuration-workspace.md','docs/ashoka/configuration.md','docs/ashoka/slice-23-qualified-root-tests-second.json','docs/ashoka/slice-23-qualified-root-tests-second.log',
 'docs/ashoka/slice-23-build-fifth.log','docs/ashoka/slice-23-focused-seventh.log','docs/ashoka/browser-23-final/qualification.json','docs/ashoka/browser-23-final/root.png','docs/ashoka/browser-23-final/configuration.png','docs/ashoka/browser-23-final/configuration-narrow.png',
 ...['contracts','providers','baseline','mcp','metrics','configuration'].map(name=>'docs/ashoka/slice-23-'+name+'-check.log'),'tests/fixtures/ashoka/baseline.json','src/graph/contracts.ts'];
const artifacts=[];for(const path of paths){const bytes=await readFile(path);artifacts.push({path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
const evidence={schema:'dreamgraph.ashoka.dashboard_evidence.v1',recorded_at:new Date().toISOString(),status:'offline_dashboard_qualified',
 scope:'Actual compiled daemon/CLI and Windows Chrome on disposable instance; complete catalogue, settings CAS/activation/template/undo, canonical graph currency and scoped jobs. Queued scan producer is explicitly declared; no inference, live migration, global install or platform Computer Use claim.',
 root:{passed:root.numPassedTests,failed:root.numFailedTests,skipped:root.numPendingTests,files:root.testResults.length},
 focused:named,browser:{version:browser.browser,checks:browser.checks,errors:browser.errors},baseline:{revision:baseline.revision,contracts:baseline.contracts.length,owners:baseline.owners.length,cases:baseline.cases.length,evidence:baseline.evidence.length,contract_source_sha256:baseline.contract_source_sha256},
 compound:{XS06:'Actual zero/alias/model activation plus unchanged original job admission and shared tests.',XS07:'Scoped protected template preview/apply/undo and separate saved/effective activation; actual restart readback.',XS12:'Actual keyboard tabs, retained validation, narrow/forced-colors and shared schedule workspace.',XS21:'Canonical mutation/full-scan/reconciliation/debt are separate; no scan-age staleness or hidden scan request.'},
 limits:['Queued scan fixture qualifies authoritative job state/cancel, not dispatched scan or numerical substep progress.','Provider, native GUI, other-platform and paired model-understanding evidence remain owning Slice31/27 gates.','Product remains13.4.0 until Slice28. The existing509 editor cases are unchanged; actual editor/client HTTP integration participates in the current root run.'],artifacts};
await writeFile('docs/ashoka/slice-23-conformance.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({status:evidence.status,root:evidence.root,focused:named.length,browser:browser.checks.length,artifacts:artifacts.length}));
