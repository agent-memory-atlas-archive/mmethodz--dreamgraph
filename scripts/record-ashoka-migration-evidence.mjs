/** Record actual frozen results; never qualifies a live instance or calls a model. */
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const read=async path=>JSON.parse((await fs.readFile(path,'utf8')).replace(/^\uFEFF/,''));
const root=await read('docs/ashoka/slice-26-qualified-root-tests-third.json');
assert.equal(root.success,true);assert.equal(root.numFailedTests,0);
assert.equal((await read('docs/ashoka/slice-26-qualified-root-tests-third-exit.json')).exit_code,0);
const browser=await read('docs/ashoka/browser-26-final/qualification.json');assert.equal(browser.success,true);assert.deepEqual(browser.errors,[]);
const baselineBytes=await fs.readFile('tests/fixtures/ashoka/baseline.json'),baseline=JSON.parse(baselineBytes);
const previous=await read('docs/ashoka/baselines/'+baseline.previous_sha256+'.json');
for(const field of ['owners','cases','evidence'])assert.deepEqual(baseline[field],previous[field],field+' must remain frozen');
const tests=root.testResults.filter(file=>/legacy-graph-upgrade|graph-upgrade-notice|publication-read-cache|onboarding-readiness|architect-plan-authority|plan-context-integration|plan-authority/.test(file.name))
  .flatMap(file=>file.assertionResults.map(test=>({file:file.name.split(/[\\/]/).at(-1),name:test.fullName,status:test.status})));
assert(tests.every(test=>test.status==='passed'));
const files=['src/graph/legacy-upgrade.ts','src/graph/upgrade-notice.ts','src/graph/publication.ts','src/graph/read-model.ts','src/graph/writer-lease.ts',
 'src/graph/store-registry.ts','src/graph/change-obligations.ts','src/graph/execution-context.ts','src/cognitive/jobs.ts','src/discipline/plan-authority.ts',
 'src/architect/plan-registry.ts','src/architect/onboarding-readiness.ts','src/architect/routes.ts','src/cli/dg.ts','src/cli/commands/graph-upgrade.ts',
 'tests/legacy-graph-upgrade.test.ts','tests/graph-upgrade-notice.test.ts','tests/publication-read-cache.test.ts','tests/onboarding-readiness.test.ts',
 'tests/latest-model-support.test.ts','tests/standalone-architect-routes.test.ts','tests/fixtures/ashoka/baseline.json','scripts/qualify-ashoka-navigation.mjs',
 'scripts/benchmark-architect-navigation.mjs','docs/ashoka/legacy-upgrade.md','docs/ashoka/browser-26-final/qualification.json','docs/ashoka/browser-26-final/architect.png',
 'docs/ashoka/slice-26-qualified-root-tests-third.json','docs/ashoka/slice-26-qualified-root-tests-third.log','docs/ashoka/slice-26-qualified-root-tests-third-exit.json',
 'docs/ashoka/slice-26-focused-recovery.log','docs/ashoka/slice-26-focused-fourth.log','docs/ashoka/slice-26-build-fifth.log',
 'docs/ashoka/slice-26-generated-checks.log','docs/ashoka/slice-26-generated-repair.log','docs/ashoka/slice-26-live-inventory.json',
 'docs/ashoka/navigation-before.json','docs/ashoka/navigation-after-catalogue-prefilter.json'];
const artifacts=[];for(const path of files){const bytes=await fs.readFile(path);artifacts.push({path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
const result={schema:'dreamgraph.ashoka.migration_evidence.v1',recorded_at:new Date().toISOString(),status:'offline_migration_qualified_live_cutover_pending',
 scope:'Actual physical kernel/writer/crash recovery, compiled CLI, Windows Chrome, source/fixture graph-family migration and navigation. Original own-instance inventory is unfenced and changing; it is not an approved live preview.',
 root:{passed:root.numPassedTests,failed:root.numFailedTests,skipped:root.numPendingTests,files:root.testResults.length,exit_code:0},
 frozen:{revision:baseline.revision,contracts:baseline.contracts.length,baseline_sha256:createHash('sha256').update(baselineBytes).digest('hex'),contract_source_sha256:baseline.contract_source_sha256,preserved_cases:12,preserved_owners:29,preserved_excerpts:8},
 tests,browser,benchmarks:{before:await read('docs/ashoka/navigation-before.json'),after:await read('docs/ashoka/navigation-after-catalogue-prefilter.json'),same_snapshot:false},
 joins:{XS01:'physical writer exclusion, exact snapshot/configuration preview and published read fences',XS18:'whole-family disposable conversion, original byte backup, actual child crash/restart, unknown baselines and post-cutover restore',XS21:'one publication receipt and exact operation replay; graph currency and later source debt survive restore'},
 remaining:['Own-instance live fence/backup/cutover and exact conflict dispositions require a current source-bound reviewed preview; installed daemon is not stopped by this qualification.',
 'No paid reconstruction, full rescan/enrichment, physical desktop input, other OS or final release claim.',
 'Original first/second regression failures, changing-publication/capacity observations and earlier browser/fixture failures are retained; final root process exit and no-unhandled-error run are required.'],artifacts};
await fs.writeFile('docs/ashoka/slice-26-conformance.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,root:result.root,tests:tests.length,browser_checks:browser.checks.length,hashes:artifacts.length}));
