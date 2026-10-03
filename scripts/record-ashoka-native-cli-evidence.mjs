/** Actual metadata/ordinary-pass policy and fresh-daemon recovery; never native CLI input qualification. */
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const sha=value=>createHash('sha256').update(value).digest('hex');
const json=async path=>JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));
const root=await json('docs/ashoka/slice-31-native-cli-root-tests-first.json'),focus=await json('docs/ashoka/slice-31-native-cli-focus-first.json');
const metadata=await json('docs/ashoka/slice-31-codex-native-metadata-second.json');
assert.equal(root.success,true);assert.equal(root.numFailedTests,0);assert.equal(root.numPassedTests,1985);assert.equal(root.numPendingTests,2);
assert.equal(focus.success,true);assert.equal(focus.numPassedTests,69);assert.equal(metadata.model_requests,0);assert.equal(metadata.threads,0);assert.equal(metadata.native_input,0);assert.equal(metadata.qualified,false);
assert.equal(metadata.version,'0.159.0');assert.equal(metadata.default_app_access,'deny');
for(const feature of ['computer_use','browser_use','browser_use_external','browser_use_full_cdp_access','in_app_browser'])assert.equal(metadata.isolated_features[feature].enabled,false);
for(const stem of ['slice-31-native-cli-root-tests-first','slice-31-native-cli-focus-first','slice-31-native-cli-editor-build-second','slice-31-native-cli-editor-tests-third',
 'slice-31-codex-native-metadata-second','slice-31-daemon-restart-focus-third','slice-31-daemon-restart-linux-first'])assert.equal((await json('docs/ashoka/'+stem+'-exit.json')).exit_code,0,stem);
const editorLog=await readFile('docs/ashoka/slice-31-native-cli-editor-tests-third.log','utf8');
assert.match(editorLog,/tests 522/);assert.match(editorLog,/pass 522/);assert.match(editorLog,/fail 0/);assert.match(editorLog,/cancelled 0/);
for(const path of ['docs/ashoka/slice-31-daemon-restart-focus-third.json','docs/ashoka/slice-31-daemon-restart-linux-first.json']){
 const result=await json(path);assert.equal(result.success,true);assert.equal(result.numPassedTests,1);
}
const baselineBytes=await readFile('tests/fixtures/ashoka/baseline.json'),baseline=JSON.parse(baselineBytes.toString('utf8'));assert.equal(baseline.revision,18);assert.equal(baseline.contracts.length,42);
const paths=['src/architect/cli-bridge.ts','src/computer/browser-registry.ts','src/computer/http.ts','src/computer/broker.ts','src/computer/journal.ts',
 'src/server/managed-execution.ts','src/server/session-authority.ts','src/graph/execution-context.ts','src/graph/change-obligations.ts',
 'extensions/vscode/src/architect-core/adapters/codex-cli/argv.ts','extensions/vscode/src/architect-core/adapters/codex-cli/mcp-config.ts',
 'extensions/vscode/src/test/codex-cli-adapter.test.ts','tests/architect-cli-bridge.test.ts','tests/standalone-architect-routes.test.ts',
 'tests/computer-peer-crash.test.ts','tests/helpers/computer-restart.ts','tests/helpers/browser-process-tree.ts','tests/fixtures/ashoka/baseline.json',
 'scripts/qualify-ashoka-codex-computer-policy.mjs','scripts/record-ashoka-native-cli-evidence.mjs','scripts/qualify-ashoka-native-review.mjs',
 'docs/ashoka/native-review-31-cli.mjs','docs/ashoka/computer-use.md','docs/architecture.md',
 'docs/ashoka/slice-31-wsl-conformance.json','docs/ashoka/slice-31-recovery-conformance.json'];
for(const name of await readdir('docs/ashoka'))if(/^(?:slice-31-native-cli-|slice-31-codex-native-metadata|slice-31-daemon-restart-).*\.(?:json|log)$/.test(name)&&!name.includes('conformance'))paths.push('docs/ashoka/'+name);
const artifacts=[];for(const path of paths){const bytes=await readFile(path);artifacts.push({path,bytes:bytes.length,sha256:sha(bytes)});}
const result={schema:'dreamgraph.ashoka.computer_checkpoint.v1',recorded_at:new Date().toISOString(),status:'native_cli_policy_restart_qualified_slice31_in_progress',
 root:{passed:1985,failed:0,skipped:2,files:175,exit_code:0,max_workers:4,elapsed_seconds:(Math.max(...root.testResults.map(t=>t.endTime))-root.startTime)/1000},
 editor:{passed:522,failed:0,skipped:0,exit_code:0,scope:'Actual compiled adapter and editor fixtures; no physical VS Code activation or editor-started CU claim.'},
 focused:{passed:69,failed:0},metadata,
 restart:{windows:'Chrome153.0.8010.50/Node25.2.1/Playwright1.62.1',linux:'Ubuntu24.04.4/WSL2 x64/Chromium151.0.7922.34/Node20.20.2/Playwright1.62.1',
  scope:'Real peer death/source write followed by an actual fresh daemon over its disposable named instance. Original owner sees unknown receipts and unavailable worker; controls refuse replacement, foreign owner is isolated and no grant/source-debt byte changes occur. Not every daemon/process crash point.'},
 frozen:{revision:18,contracts:42,baseline_sha256:sha(baselineBytes),contract_source_sha256:baseline.contract_source_sha256},
 retained_failures:['First restart fixture used a legacy rather than named instance identity; scope admission refused before input.',
  'Second restart fixture incorrectly expected an unbound native request to have operator authority; the real403 denial was correct.',
  'First Codex metadata proof passed config checks but failed Windows temporary-directory cleanup. The second fresh run passed bounded cleanup.',
  'First two compiled editor invocations ran from the repository root and failed extension-relative source-file reads. The third ran from the extension directory and passed522 tests.'],
 remaining:['Slice31 native workers, native CLI permission/event/control and provider built-ins, complete editor execution and CU/XS joins.',
  'Slice26 reviewed live cutover,27 actual paired usefulness,28 synchronized release. No Windows global installation/restart, paid inference or live migration; version13.4.0.'],artifacts};
await writeFile('docs/ashoka/slice-31-native-cli-conformance.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:result.status,root:result.root,editor:522,hashes:artifacts.length,native_qualified:false,model_requests:0}));
