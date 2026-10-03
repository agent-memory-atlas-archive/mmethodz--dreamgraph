/** Seal actual WSL installer/browser evidence; never infer native desktop or release readiness. */
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {computerDigest} from '../dist/computer/digest.js';
const base='docs/ashoka/slice-31-wsl-third',sha=body=>createHash('sha256').update(body).digest('hex');
const json=async path=>JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));
const install=await json(base+'/installation-proof.json'),browser=await json(base+'/browser-qualification.json');
assert.equal(install.platform,'linux');assert.equal(install.architecture,'x64');assert.match(install.kernel,/microsoft.*WSL2/i);
assert.equal(install.master,'/home/mmethodz/.dreamgraph');assert.equal(install.runtime_version,'1.62.1');assert.equal(install.model_requests,0);
assert.equal(browser.evidence.model_requests,0);assert.equal(browser.evidence.traces.length,11);assert.equal(browser.worker.qualification.evidence_scope,'actual_runtime');
assert.equal(browser.worker.qualification.artifact_hash,computerDigest(browser.evidence));assert.equal(install.browser_artifact_hash,browser.worker.qualification.artifact_hash);
assert(browser.worker.qualification.stop_release_ms<=1000&&browser.worker.qualification.control_loss_stop_ms<=5000);
assert.equal(install.workspaces.length,3);assert.equal((await json('docs/ashoka/slice-31-wsl-dependencies-retry-result.json')).exit_code,0);
assert.equal((await json('docs/ashoka/slice-31-wsl-workspace-test-exit.json')).exit_code,0);
const test=await json('docs/ashoka/slice-31-wsl-workspace-test.json');assert.equal(test.success,true);assert.equal(test.numFailedTests,0);
const inventory=await json(base+'/source-inventory.json');assert.equal(inventory.aggregate_sha256,sha(JSON.stringify(inventory.files)));
const reviewHelperUpdates=[];
for(const file of inventory.files){const current=sha(await readFile(file.file));if(current!==file.original_sha256){
 assert.equal(file.file,'scripts/qualify-ashoka-native-review.mjs','Current build source differs from the actual Linux build: '+file.file);
 reviewHelperUpdates.push({file:file.file,staged_original_sha256:file.original_sha256,current_sha256:current,scope:'Review runner only; added the bounded -wsl helper after qualification. Not imported by the installed runtime or used by install.sh.'});
}}
const baselineBytes=await readFile('tests/fixtures/ashoka/baseline.json'),baseline=JSON.parse(baselineBytes.toString('utf8'));
assert.equal(baseline.revision,18);assert.equal(baseline.contracts.length,42);
const paths=['scripts/install.sh','scripts/install.ps1','scripts/workspace-artifacts.mjs','scripts/qualify-ashoka-wsl-browser.mjs','scripts/record-ashoka-wsl-evidence.mjs',
 'src/computer/browser-driver.ts','src/computer/browser-harness.ts','src/computer/qualify-browser.ts','src/cli/commands/computer-use.ts','package.json',
 'tests/fixtures/ashoka/baseline.json','tests/workspace-installation.test.ts','guide/02-installation.md','INSTALL.md','docs/architecture.md','docs/ashoka/computer-use.md',
 'docs/ashoka/native-review-31-wsl.mjs','scripts/qualify-ashoka-native-review.mjs',
 base+'/run-scope.json',base+'/source-inventory.json',base+'/installation-proof.json',base+'/browser-qualification.json',base+'/installer-browser.log',
 'docs/ashoka/slice-31-wsl-first/failure.json','docs/ashoka/slice-31-wsl-first/installer-browser.log',
 'docs/ashoka/slice-31-wsl-second/failure.json','docs/ashoka/slice-31-wsl-second/installer-browser.log',
 'docs/ashoka/slice-31-wsl-browser-dependencies.log','docs/ashoka/slice-31-wsl-dependencies-retry-result.json',
 'docs/ashoka/slice-31-wsl-workspace-test.json','docs/ashoka/slice-31-wsl-workspace-test.log','docs/ashoka/slice-31-wsl-workspace-test-exit.json',
 'docs/ashoka/slice-31-wsl-diagnostic.log','docs/ashoka/slice-31-wsl-diagnostic-second.log','docs/ashoka/slice-31-wsl-diagnostic-second-exit.json',
 'docs/ashoka/slice-31-wsl-architecture.log','docs/ashoka/slice-31-wsl-generated-checks.log','docs/ashoka/slice-31-wsl-generated-checks-second.log','docs/ashoka/slice-31-wsl-config-regeneration.log'];
const artifacts=[];for(const path of paths){const body=await readFile(path);artifacts.push({path,bytes:body.length,sha256:sha(body)});}
const packet={schema:'dreamgraph.ashoka.computer_checkpoint.v1',recorded_at:new Date().toISOString(),status:'wsl_installer_browser_qualified_slice31_in_progress',
 frozen:{revision:baseline.revision,contracts:baseline.contracts.length,baseline_sha256:sha(baselineBytes),contract_source_sha256:baseline.contract_source_sha256},
 authorization:'Owner explicitly accepted installer/browser-worker proof for WSL and authorized --force replacement of the unused Linux test bed. Windows global installation and daemon remain untouched.',
 install,browser,source:{files:inventory.files.length,inventory_sha256:sha(await readFile(base+'/source-inventory.json')),current_build_source_bytes_matched:true,post_qualification_review_helper_updates:reviewHelperUpdates,shell_line_endings:'LF'},
 packaging_test:{passed:test.numPassedTests,failed:0,exit_code:0},
 retained_failures:['First actual install succeeded, but the downloaded Chromium could not load missing Linux libraries (first libnspr4).',
  'The runtime dependency helper initially refused the existing unattended-upgrade package lock; bounded retries left that updater intact and succeeded on attempt7.',
  'An early worker attempt timed out during dependency setup, and the first sandboxed diagnostic exceeded the control-loss ceiling. Both remain unqualified evidence.',
  'After dependencies settled, the diagnostic passed and a fresh uninstrumented --force installation independently passed all eleven measured subchecks. Deadlines and Chromium sandbox remained unchanged.'],
 scope:'Ubuntu24.04.4/WSL2 x64/Node20.20.2/Chromium151.0.7922.34/Playwright1.62.1: real source build, same-version dependency refresh, installed workspace/daemon imports and isolated browser. No native desktop, Mint GUI, macOS, native CLI Computer Use or VS Code activation claim.',
 remaining:['Slice31 native workers/provider-native/CLI seams, forced-crash readback, complete editor execution and CU/XS joins.',
  'Slice26 reviewed live cutover, Slice27 actual paired usefulness and Slice28 synchronized release. Version13.4.0; no Windows global install/restart or paid inference.'],artifacts};
await writeFile('docs/ashoka/slice-31-wsl-conformance.json',JSON.stringify(packet,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:packet.status,source_files:packet.source.files,hashes:artifacts.length,checks:browser.evidence.traces.length,
 stop_ms:browser.worker.qualification.stop_release_ms,control_loss_ms:browser.worker.qualification.control_loss_stop_ms,model_requests:0}));
