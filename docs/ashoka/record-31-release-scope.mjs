/** Review the existing C17 proof against the maintainer's fixed v14 release scope; no new runtime qualification. */
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=async path=>JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));
const gateDirectory='docs/ashoka/slice-27-offline-gate-sixth',wslDirectory='docs/ashoka/slice-27-wsl-admitted-collection-first';
const gate=await read(gateDirectory+'/result.json'),root=await read(gateDirectory+'/root-tests.json'),inventory=await read(gateDirectory+'/source-inventory.json');
assert.equal(gate.status,'passed');assert.equal(gate.source_hash,inventory.hash);assert.equal(root.numFailedTests,0);assert.equal(gate.editor.passed,546);
const wsl=await read(wslDirectory+'/installation-proof.json'),wslSources=await read(wslDirectory+'/source-inventory.json');
assert.equal(wsl.platform,'linux');assert.equal(wsl.node,'20.20.2');assert.equal(wsl.model_requests,0);assert.equal(wsl.cli_output.measured_checks,11);
assert(wsl.cli_output.stop_release_ms<=1000&&wsl.cli_output.control_loss_stop_ms<=5000);assert.equal(wslSources.files.length,484);
const browser=await read(gateDirectory+'/browser-qualification.json');
assert.equal(browser.worker.qualification.evidence_scope,'actual_runtime');assert.equal(browser.evidence.model_requests,0);assert.equal(browser.evidence.traces.length,11);
const artifacts=new Map();
async function bind(path){if(artifacts.has(path))return;const bytes=await readFile(path);artifacts.set(path,{path,bytes:bytes.length,sha256:sha(bytes)});}
function evidence(files){return files.map(name=>{
 const path='tests/'+name+'.test.ts',source=inventory.files.find(item=>item.path===path),suite=root.testResults.find(item=>item.name.replaceAll('\\','/').endsWith('/'+path));
 assert(source&&suite,path);assert(suite.assertionResults.length>0&&suite.assertionResults.every(item=>item.status==='passed'),path);
 return {source:path,sha256:source.sha256,report:gateDirectory+'/root-tests.json',cases:suite.assertionResults.map(item=>item.fullName)};
});}
const rows=[
 ['CU01',['computer-capabilities','computer-journal'],'Core contracts negotiate requested/supported/permitted/effective operations, reject incompatible probes and never infer product support from a declared fixture.'],
 ['CU02',['computer-browser-worker','computer-native-graph-loop'],'Actual isolated browser Unicode/checked/activate/scroll/readback; Windows and accepted WSL browser scope. No native-app claim.'],
 ['CU03',['computer-browser-worker','computer-journal','computer-broker'],'Actual moved/covered target and generation rejection, plus original journal/precondition and fresh resume fences.'],
 ['CU04',['computer-browser-worker','computer-native-operator','computer-broker'],'Actual origin/path/method/frame/popup confinement and original private-owner scope; foreign/worker/browser credentials cannot self-grant.'],
 ['CU05',['computer-browser-worker','computer-broker','computer-native-graph-loop','computer-worker-clock'],'Actual independent browser Stop and severed-channel containment; model/pause/queued boundary fixtures preserve unknown adapter termination and forbid later input.'],
 ['CU06',['computer-seat','computer-capabilities','computer-journal'],'Real seat-helper process lifetime and cross-daemon ownership; shipped browser contexts are isolated. No claim of a native desktop input backend.'],
 ['CU07',['computer-journal','computer-use-ui','computer-broker'],'Actual original-owner bounded HTTP reconnect and worker pause/resume; compiled UI rejects late/foreign selections and never renews permission. UI race fixtures are declared.'],
 ['CU08',['computer-capabilities','computer-browser-registry','provider-images','provider-outcome'],'Unsupported model/tool/image/retention/runtime or native CLI stays unavailable with no silent text-only/model/harness substitution.'],
 ['CU09',['provider-outcome','provider-images','computer-journal','model-execution'],'Closed provider transcripts preserve refusal/incomplete/unknown-tool/output usage and original action identities; fixtures make no real provider request.'],
 ['CU10',['computer-peer-crash','computer-journal','computer-broker'],'Actual source write and peer death, original fresh-daemon readback and lost-reply/idempotency tests retain unknown outcome and forbid consequential replay.'],
 ['CU11',['computer-peer-crash','computer-native-graph-loop','plan-workflow'],'Actual peer loss/original-owner restart and selected-plan Stop retain correct C05/C14 recovery, unfinished slice and no verification receipt.'],
 ['CU12',['computer-broker','computer-browser-registry','computer-browser-worker'],'Exact human scope/action approval, expiry/revocation, no UI self-grant; credential controls are refused by the shipped browser worker.'],
 ['CU13',['computer-journal','computer-native-graph-loop','model-admission','model-execution'],'Finite actions/images/bytes/requests/time, shared original role allocation, measured usage and unknown liabilities. Actual plan-bound limit refuses further continuation without increasing production defaults.'],
 ['CU14',['computer-browser-worker'],'Actual deceptive/disabled/covered/credential and frame/popup fixture; independent target verification or explicit refusal before input. Native overlapping-window behavior is not advertised.'],
 ['CU15',['computer-browser-worker','computer-journal'],'Shipped structured browser references reject changed layout/generation and re-observe; no arbitrary coordinates, monitor topology or native DPI claim. Those unsupported native operations are deferred.'],
 ['CU16',['computer-capabilities','computer-browser-registry'],'Native Windows desktop worker is not advertised or enabled. Unqualified runtime/input/seat refuses. Practical Windows daemon/browser qualification remains in the maintainer scope.'],
 ['CU17',['computer-capabilities','computer-browser-registry'],'macOS native worker and permission/Retina qualification are maintainer-deferred beyond v14; no supported route or permission workaround is claimed.'],
 ['CU18',['computer-capabilities','computer-browser-registry'],'Native Linux portal/AT-SPI/X11 and additional compositor/distro qualification are maintainer-deferred beyond v14; accepted WSL isolated browser does not imply desktop control.'],
 ['CU19',['computer-browser-registry','computer-browser-worker','computer-configuration'],'Actual WSL headless installer/browser host evidence, exact executable/runtime/target pins, origin isolation and unsupported personal-profile/native route refusal. No implicit client-desktop access.'],
 ['CU20',['computer-browser-worker','computer-evidence','computer-native-operator','provider-images','host-managed-execution'],'Actual scoped masked PNG with original-owner SHA validation, synthetic secret negatives and private image readback; ordinary audit/chat/control metadata carries no raw pixels.'],
 ['CU21',['computer-native-graph-loop','computer-broker'],'Actual GUI source effect, independently reviewed structural reconciliation, original committed graph receipt and current next-agent context. A GUI receipt is not graph truth.'],
 ['CU22',['computer-journal','computer-evidence','computer-native-graph-loop','plan-authority'],'Wrong/expired/model-interpreted evidence, unknown Stop and pending material effects cannot verify the slice. Actual plan-bound success still requires independent C14 verification.'],
 ['CU23',['computer-use-ui','computer-native-operator','computer-native-graph-loop','computer-configuration'],'Compact compiled browser/editor controls and actual original-owner SDK/worker pause/Stop/recovery joins. Full compiled editor suite passes. Physical Windows UI/VS Code operation is maintainer practical qualification, not inferred from compiled tests.'],
 ['CU24',['computer-capabilities','computer-browser-registry','computer-configuration','host-managed-execution'],'Native CLI defaults deny unqualified computer access; API uses explicitly selected qualified harness. Changed role/source/profile/version refuses stale authority. No flags-only native qualification or silent substitution.'],
];
assert.equal(rows.length,24);
const contract=await readFile('docs/audits/2026-09-30-coverage/computer-use.md','utf8');
const definitions=new Map([...contract.matchAll(/^\| (CU\d{2}) \| (.+?) \| (.+?) \|\r?$/gm)].map(match=>[match[1],{criterion:match[2],original_evidence_requirement:match[3]}]));
assert.equal(definitions.size,24);
const cases=rows.map(([id,files,review])=>({id,...definitions.get(id),disposition:['CU16','CU17','CU18'].includes(id)?'maintainer_deferred_native_backend_not_advertised':'verified_advertised_v14_scope',review,evidence:evidence(files)}));
// Only claim the reviewed C17 source/consumer boundary; a later unrelated test addition cannot re-seal the entire old gate.
const reviewed=inventory.files.filter(item=>/^src\/(computer|architect|cognitive|graph|server|config)\//.test(item.path)||/^packages\/(sdk|host|token-economy)\//.test(item.path)||/^extensions\/vscode\/src\//.test(item.path));
for(const item of reviewed){assert.equal(sha(await readFile(item.path)),item.sha256,item.path);await bind(item.path);}
for(const row of cases)for(const entry of row.evidence){assert.equal(sha(await readFile(entry.source)),entry.sha256,entry.source);await bind(entry.source);}
for(const path of [gateDirectory+'/result.json',gateDirectory+'/source-inventory.json',gateDirectory+'/root-tests.json',gateDirectory+'/editor-tests.log',gateDirectory+'/browser-qualification.json',
 wslDirectory+'/installation-proof.json',wslDirectory+'/source-inventory.json',wslDirectory+'/browser-qualification.json',
 'docs/ashoka/slice-31-native-pass-conformance.json','docs/ashoka/slice-31-recovery-conformance.json','docs/ashoka/slice-31-native-cli-conformance.json',
 'docs/ashoka/slice-31-provider-output-conformance.json','docs/ashoka/slice-31-codex-native-metadata-second.json',
 'docs/ashoka/v14-release-scope.md','docs/ashoka/record-31-release-scope.mjs','docs/audits/2026-09-30-coverage/computer-use.md',
 'tests/fixtures/ashoka/baseline.json'])await bind(path);
const packet={schema:'dreamgraph.ashoka.computer_release_scope.v1',recorded_at:new Date().toISOString(),status:'review_ready_for_v14_scope',slice:31,
 release_scope:'Practical maintainer Windows qualification plus completed WSL2 Ubuntu24.04/Node20 installer and isolated browser proof; additional environments/native desktops explicitly deferred by maintainer 2026-10-03.',
 gate:{report:gateDirectory+'/result.json',source_hash:gate.source_hash,root:gate.root,editor:gate.editor,browser:gate.browser,temporal_scope:'Existing gate and unchanged reviewed C17 sources; not a new whole-root run.'},
 linux:{proof:wslDirectory+'/installation-proof.json',source_files:wslSources.files.length,source_hash:wslSources.aggregate_sha256,node:wsl.node,measured_checks:11,stop_release_ms:wsl.cli_output.stop_release_ms,control_loss_stop_ms:wsl.cli_output.control_loss_stop_ms,accepted_by:'Human maintainer, 2026-10-03'},
 cases,joined_evidence:{XS17:['computer-capabilities','computer-peer-crash','computer-native-operator'].map(name=>evidence([name])[0]),XS20:evidence(['computer-native-graph-loop','computer-broker','computer-journal'])},
 deferrals:[{owner:'Slice31 platform backend maintainers',scope:'Native Windows/macOS/Linux desktop workers and additional environments',reason:'Maintainer-approved v14 scope; unqualified backends stay disabled',follow_up:'Post14.0.0 patches based on field feedback; no new qualification branch during v14'},
 {owner:'Slice31 adapter integration maintainers',scope:'Native CLI/provider built-in computer controls lacking qualified mandatory controls',reason:'No native permission/event/independent-stop conformance; route refused with no silent substitute',follow_up:'Qualify original native controls before advertising; no mandatory C17 control is waived'}],
 limitations:['Provider replies and compiled UI hosts are declared fixtures, not paid model or physical VS Code proof.','Practical Windows maintainer qualification is not represented as an automated test result.','No live graph conversion, Slice27 understanding verdict, synchronized version bump or Slice28 opening.'],
 real_provider_requests:0,new_environments_qualified:0,windows_global_changed:false,artifacts:[...artifacts.values()]};
await writeFile('docs/ashoka/slice-31-release-scope-conformance.json',JSON.stringify(packet,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:packet.status,cases:cases.length,verified_advertised_scope:cases.filter(row=>row.disposition==='verified_advertised_v14_scope').length,reviewed_native_deferrals:3,hashes:packet.artifacts.length,real_provider_requests:0,new_environments_qualified:0}));
