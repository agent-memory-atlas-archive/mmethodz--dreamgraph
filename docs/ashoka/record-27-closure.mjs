/** Reconcile actual accepted boundaries; never convert model replies or file links into execution proof. */
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {CANONICAL_FAMILIES} from '../../dist/graph/read-model.js';
import {GraphKindSchema,GraphRelationshipSchema,AssertionClassSchema} from '../../dist/graph/contracts.js';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const hashes=new Map();
async function bytes(path){const value=await readFile(path);hashes.set(path,sha(value));return value;}
const read=async path=>JSON.parse((await bytes(path)).toString('utf8').replace(/^\uFEFF/,''));
const gatePath='docs/ashoka/slice-27-offline-gate-sixteenth',gate=await read(gatePath+'/result.json'),root=await read(gatePath+'/root-tests.json'),inventory=await read(gatePath+'/source-inventory.json');
assert.equal(gate.status,'passed');assert.equal(gate.source_hash,inventory.hash);assert.equal(root.numFailedTests,0);
await bytes(gatePath+'/browser-qualification.json');
for(const step of gate.steps)await bytes(gatePath+'/'+step.name+'.log');
const allowedAfterGate=[];const changed=[];
for(const file of inventory.files){const actual=sha(await readFile(file.path));if(actual!==file.sha256){assert(allowedAfterGate.includes(file.path),'Unexpected post-gate source change: '+file.path);changed.push({path:file.path,gate_sha256:file.sha256,current_sha256:actual,reason:'Narrow unrun GitHub matrix to the already agreed Windows/Ubuntu24.04 runtimes; no product behavior change.'});}}
const baseline=await read('tests/fixtures/ashoka/baseline.json'),old=await read('docs/ashoka/slice-27-owner-evidence-map.json');
assert.equal(baseline.revision,18);assert.equal(baseline.owners.length,29);assert.equal(baseline.contracts.length,42);
assert.deepEqual(old.owners.map(row=>row.family),baseline.owners.map(row=>row.family));
assert.deepEqual(old.compound.map(row=>row.id),Array.from({length:21},(_,i)=>'XS'+String(i+1).padStart(2,'0')));
const accepted25=await read('docs/ashoka/slice-25-conformance.json'),accepted31=await read('docs/ashoka/slice-31-release-scope-conformance.json');
const migration=await read('docs/ashoka/slice-26-closure.json');assert.equal(migration.status,'verified');
const schedules=await read('docs/ashoka/wave-24-29-verification.json');
const pilotPath='docs/ashoka/benchmarks/2026-10-03-gpt-4.1/results.json',pilot=await read(pilotPath);assert.equal(pilot.totals.calls,28);
await bytes('docs/ashoka/v14-release-scope.md');await bytes('docs/ashoka/slice-23-conformance.json');
await bytes('docs/ashoka/slice-31-native-review-closure.json');await bytes('docs/ashoka/slice-27-production-digestion-sixth.json');
function suite(file){const path=file.startsWith('tests/')?file:'tests/'+file;const result=root.testResults.find(s=>s.name.replaceAll('\\','/').endsWith('/'+path));assert(result,path);assert(result.assertionResults.every(c=>c.status==='passed'),path);return result;}
async function evidence(files){return Promise.all([...new Set(files)].map(async file=>{const path=file.startsWith('tests/')?file:'tests/'+file;const result=suite(path);const digest=sha(await bytes(path));assert.equal(digest,inventory.files.find(f=>f.path===path)?.sha256,path);return {source:path,sha256:digest,report:gatePath+'/root-tests.json',cases:result.assertionResults.map(c=>c.fullName)};}));}
const ownerReviews=[
 'Actual HTTP/MCP owners, wrong-project requests and independent client cancellation share the same authority boundary.',
 'Actual publication, immutable readers, kernel writer exclusion and crash/replay tests cover shared graph writes independently of scan identity.',
 'Full/incremental scanner and native/UI inputs converge through actual core publication while curation survives; controlled filesystem/datastore fixtures are declared.',
 'Coverage and deletion/baseline cases feed the same canonical reader and bounded retrieval; missing baseline remains unknown.',
 'Fallback/commit/checkpoint cancellation uses actual publication. Production digestion adds real enrichment/dream/normalize owners with intercepted provider replies.',
 'Role routing, immutable model capability and admission tests refuse unsupported/escalated routes; actual pilot separately proves the selected Responses transport.',
 'Job lane ownership, bootstrap and dirty stages cover thrown/cancelled/noncooperative work and restart; unknown termination remains fenced.',
 'Every registered strategy runs under bounded seeds/budgets; portfolio attribution survives normalization/curation without becoming truth precision.',
 'Promotion uses actual independent evidence groups and source applicability, never circulated model confidence. Failed raw-model classification does not change these rules.',
 'Canonical context/resource/Explorer projections retain typed trust and ancestry; C14 browser/API/editor/SDK comparisons retain the same authority fields.',
 'Calibration and thirteen actual Python consumers retain denominator/unknown semantics; operational yield and context delivery are not measured understanding.',
 'Actual curation/expiry/tombstones plus subsequent candidate generation retain rejection and prevent automatic factual resurrection.',
 'Risk closure/reappearance compares changed evidence; temporal readings and speculative hypotheses remain separate and durable.',
 'Remediation/adaptive proposals stay advisory; actual plan integration requires independent effect/reconciliation/verification receipts.',
 'Out-of-order histories, one-root effects and malformed/unknown times retain correlation and uncertainty without fabricated causality.',
 'Actual event intake and immutable schedule occurrences join shared jobs/admission; duplicates, overlap, late completion and UTC-day liability remain bounded.',
 'Instance bootstrap and targeted strategy registry share existing jobs/lane ownership and distinguish empty/new/mature bounded eligibility.',
 'Actual import/replay/export preserves foreign root identity, sharing policy and local validation requirements; no reinforcement from circulation.',
 'Lucid actions persist human attribution and exit-state ownership while source change/CAS prevents stale acceptance.',
 'Current and historical narratives, retained chapters and playback retain revision/provenance; generated text cannot corroborate itself.',
 'Actual preamble/context/SDK/native graph joins deliver mandatory anchors or visible insufficiency. Model understanding is separately failed/partial in the published pilot.',
 'Catalog and actual resource/tool/bridge transports validate advertised input/output/error and bounded whole-record semantics.',
 'Actual CLI bridge process/tool fences and SDK/native API ports preserve control/errors/provenance; fixture worker replies are not provider-specific understanding proof.',
 'Actual durable plan authority, transition reducer, receipts and all-surface browser/client packet cover blocked/implemented/verified/recovery states.',
 'Configuration CAS/template/protected-field tests and actual browser/server packet cover validation, persisted/effective distinctions and restart.',
 'Canonical selection/retrieval joins plus accepted dense real 2D/3D browser navigation. Unsupported plan render families are disclosed.',
 'Actual Python/core same-revision exports and webhook retries retain counts, unknown domains and immutable original causes.',
 'Actual host/plugin/SDK joins retain reserved context, exact effects and failure isolation; uncontrolled adapters report noncompliant/unknown completion.',
 'Existing installation/build/start-health contracts pass here; exact synchronized binaries, running asset pinning and disposable packaged upgrade are expressly owned by Slice28.'
];assert.equal(ownerReviews.length,29);
const owners=[];for(const [i,row]of old.owners.entries())owners.push({family:row.family,obligation:baseline.owners[i].producer_consumer_obligation,check:baseline.owners[i].integration_check,
 status:i===28?'feature_gate_accepted_packaged_gate_owned_by_28':'accepted_for_declared_scope',review:ownerReviews[i],evidence:await evidence(row.component_evidence.map(e=>e.source))});
const xsReviews=[
 'Earlier foundation receipts keep temporal scope; current C14/C15/C17 integration and source-hash verification now join the owned boundaries. Paid understanding claims remain withheld.',
 'Publication and curation paths share the physical single-writer owner; actual concurrent writer/crash cases and independent mutation/source/full-scan revision assertions compose at that boundary.',
 'Actual pre/post-marker and interrupted rollback/cleanup cases retain original receipts and refuse retired keys; source-change intent recovery does not invent a commit.',
 'Actual job/schedule tests retain timeout ownership, mutator lane and late usage for a noncooperative handler. A due occurrence cannot start an overlapping mutator.',
 'All role routes call the same tested atomic admission owner. Parallel calls, zero allocations, restarted unknown liabilities and original UTC admission day are exercised; trigger tests retain original causal IDs.',
 'Actual config HTTP/browser CAS, protected reset and external edit checks join immutable job policy snapshots; credential output stays redacted and revocation cannot broaden a run.',
 'Two actual clients retain owner/captured target; actual browser menus/detail races and C14 event-gap refetch compose with independent cancellation. Refresh cannot change another execution.',
 'Changed acceptance invalidates old/downstream proof and owned-scope changes refuse; old receipts remain history. Actual export failure debt/retry is separate from authoritative transition success.',
 'Actual source intents/publication, fresh-peer crash recovery, original C05 job/dirty generation and C14 reconciliation gating share durable IDs. The production digestion test proves next-agent current facts with optional unfunded debt. These are multiple joined-boundary traces, not a claimed single monolithic run.',
 'Actual SDK/host writable-scope observation, tracked/untracked changes, exact effects and plugin failure preserve durable debt outside transcript memory; unsupported paths cannot claim managed completion.',
 'Actual G/G+1 coalescing and duplicate cause/stage tests retain new debt, prevent paid all-graph fallback and serialize with existing cognitive lane.',
 'Actual same evaluator handles preview/dispatch DST gap/fold keys, immutable old definitions/action versions and history. Browser pause/cancel/archive semantics share the core authority.',
 'Actual corrupt/oversized/optional resource and pinned cursor tests refuse fabricated complete data; physical instance/expiry mismatch prevents cross-revision paging; retrieval index rebuild remains bounded.',
 'Actual capability/refusal tests retain original endpoint/model/retention; normalization rejects weak/shared evidence even during bootstrap. Provider strength cannot override provenance.',
 'Actual temporal/federated replay keeps one original root, unknown times and superseded history; advisory narrative/ADR applicability stays separate from factual validation.',
 'Actual all-thirteen Python modules/core snapshot comparisons, immutable exports and seven-family semantics compose with canonical RAG/Explorer and eight plan consumers; as-of/unknown/denominator differences stay visible.',
 'Accepted Slice31 worker death/peer restart and unavailable native-route evidence supplies the advertised route control boundaries. No new backend qualification.',
 'Accepted Slice26 full-family faults and exact own-instance copy prove conversion/replay/restoration without original-instance activation or paid reconstruction.',
 'Feature-side incompatible format/restore-conflict/new-write preservation is accepted from26. The original scenario explicitly assigns exact running-asset pinning/install smoke to28; this row does not claim that packaging has passed.',
 'Accepted Slice31 actual browser/SDK/source/graph/plan joins retain target generation, revoked grant, independent Stop and unknown termination. Neither click nor CLI exit verifies a slice.',
 'Actual graph currency, old full-scan/reconciled scope, mutation/no-op/rollback, unchanged-region and optional-debt cases join next-agent context and canonical consumers. GUI observation expiry remains kind-specific. Maintainer confirms the installed notice and external-Codex idle execution distinction.'
];assert.equal(xsReviews.length,21);
const compound=[];for(const [i,row]of old.compound.entries()){const files=row.component_evidence.map(e=>e.source);if(['XS09','XS21'].includes(row.id))files.push('system-digestion-integration.test.ts');if(row.id==='XS08')files.push('architect-plan-authority.test.ts');if(['XS04','XS12'].includes(row.id))files.push('scheduler-session-liveness.test.ts');compound.push({id:row.id,trigger:row.trigger,required_outcome:row.required_outcome,status:row.id==='XS19'?'feature_gate_accepted_packaged_gate_owned_by_28':'accepted_composed_boundary_evidence',review:xsReviews[i],evidence:await evidence(files)});}
const contractFiles=[
 ['graph-read-model.test.ts','client-context-integration.test.ts'],['graph-publication.test.ts','graph-read-model.test.ts'],['context-pack.test.ts','resource-query.test.ts'],['change-obligations.test.ts','tools/enrichment-publication.test.ts'],
 ['engine-jobs.test.ts','system-digestion-integration.test.ts'],['model-admission.test.ts'],['role-provider.test.ts','model-execution.test.ts'],['normalization-evidence.test.ts','cognitive-policy-evaluation.test.ts'],['session-authority.test.ts','http-session-isolation.test.ts'],['engine-configuration.test.ts','configuration-http.test.ts'],['scheduler-authority.test.ts','schedule-http.test.ts'],['explorer-snapshot.test.ts','analytics-observability.test.ts'],['graph-read-model.test.ts','legacy-graph-upgrade.test.ts'],['plan-authority.test.ts','plan-workflow.test.ts'],['system-digestion-integration.test.ts','host-managed-execution.test.ts'],['standalone-architect-routes.test.ts','architect-plan-authority.test.ts'],['computer-native-graph-loop.test.ts','computer-peer-crash.test.ts']
];
// Use the actual frozen contract headings, not independently renamed semantics.
const refinement=(await bytes('docs/audits/2026-09-30-coverage/plan-refinement.md')).toString();
const contracts=[];for(const [i,files]of contractFiles.entries()){const id='C'+String(i+1).padStart(2,'0');contracts.push({id,status:'accepted_for_declared_scope',evidence:await evidence(files),consumer_join:i===13?'slice-25-conformance.json#c14':i===15?'slice-25-conformance.json#ux':i===16?'slice-31-release-scope-conformance.json#cases':null});}
contracts[16].evidence.push(...await evidence(['computer-broker.test.ts','computer-browser-worker.test.ts','computer-use-ui.test.ts','ashoka-system-gate.test.ts']));
await bytes('docs/audits/2026-09-30-coverage/computer-use.md');await bytes('docs/ashoka/computer-use.md');
const plan=(await readFile('plans/graph-trust-and-agent-effectiveness.md','utf8'));
const risks=[...plan.matchAll(/^\| (NP\d{2}) — (.+?) \| ([^|]+) \| ([^|]+) \|\r?$/gm)].map(m=>({id:m[1],description:m[2],contracts:m[3].split(',').map(s=>s.trim()),owner_slices:m[4].trim(),status:'covered_by_referenced_contract_evidence'}));assert.equal(risks.length,14);
const pl=[];for(let i=1;i<=16;i++){const id='PL'+String(i).padStart(2,'0'),matches=[];for(const result of root.testResults)for(const test of result.assertionResults)if(test.fullName.includes(id)&&test.status==='passed')matches.push({source:result.name.replaceAll('\\','/').split('/tests/')[1],case:test.fullName});assert(matches.length||id==='PL15',id);pl.push({id,status:'accepted',core_cases:matches,surface_evidence:'slice-25-conformance.json#c14',accessibility:id==='PL15'?'Accepted actual browser/sidebar/keyboard/reduced-motion evidence and explicit textual state in plan-consumers packet; no physical high-contrast platform claim.':null});}
const ge={};for(const [id,cases]of Object.entries(accepted25.ge)){ge[id]=cases.map(item=>({...item,file:item.file==='graph-context-port.test.ts'?'plugins/graph-context-port.test.ts':item.file}));for(const item of ge[id])assert(suite(item.file).assertionResults.some(c=>c.fullName===item.name),id+': '+item.name);}
const screenshot='C:/Users/MIKAJU~1/AppData/Local/Temp/codex-clipboard-7d99e27b-aa79-42dd-b17c-c2dfaff178d4.png';
const maintainer={date:'2026-10-03',kind:'human_report_and_attached_screenshot',screenshot_sha256:sha(await readFile(screenshot)),observations:['Installed Architect displays legacy-format migration review notice and says full-scan date does not determine graph freshness.','Slice27 current/in-progress;26/31 verified;28 pending.','Execution idle correctly reflects external Codex work, not a running DreamGraph Architect execution.'],limits:'Confirms visible installed behavior only; no migration, automated job, physical editor or performance proof is inferred.'};
const uiPath='docs/ashoka/ui-repairs-sixth/qualification.json',ui=await read(uiPath);assert.equal(ui.success,true);assert.equal(ui.checks.length,7);assert.equal(ui.errors.length,0);
await bytes('scripts/qualify-ashoka-ui-repairs.mjs');await bytes('docs/ashoka/ui-repairs-sixth/architect-slice5-resize.png');await bytes('docs/ashoka/ui-repairs-sixth/explorer-stable-inspector.png');
await bytes('docs/ashoka/slice-27-offline-gate-ninth/result.json');await bytes('docs/ashoka/slice-27-ui-sdk-timeout-reproduction.log');
await bytes('docs/ashoka/slice-27-offline-gate-tenth/result.json');await bytes('docs/ashoka/slice-27-offline-gate-tenth/root-tests.json');
await bytes('docs/ashoka/slice-27-tenth-failure-reproduction.json');await bytes('docs/ashoka/slice-27-tenth-failure-reproduction.log');
await bytes('docs/ashoka/slice-27-offline-gate-eleventh/result.json');await bytes('docs/ashoka/slice-27-offline-gate-eleventh/root-tests.json');
await bytes('docs/ashoka/slice-27-stop-native-core-debug-2.log');await bytes('docs/ashoka/slice-27-stop-traced-root.log');
await bytes('docs/ashoka/slice-27-stop-escalation-first.json');await bytes('docs/ashoka/slice-27-forced-stop-debug.log');
await bytes('docs/ashoka/slice-27-stop-escalation-second.json');await bytes('docs/ashoka/slice-27-stop-escalation-second.log');
await bytes('docs/ashoka/slice-27-offline-gate-twelfth/result.json');await bytes('docs/ashoka/slice-27-offline-gate-twelfth/root-tests.json');
await bytes('docs/ashoka/slice-27-pause-diagnostic-first.json');await bytes('docs/ashoka/slice-27-pause-diagnostic-first.log');
for(let i=1;i<=5;i++){await bytes(`docs/ashoka/slice-27-pause-repeat-${i}.json`);await bytes(`docs/ashoka/slice-27-pause-repeat-${i}.log`);}
await bytes('docs/ashoka/slice-27-timing-follow-up.md');
await bytes('docs/ashoka/slice-27-offline-gate-thirteenth/result.json');
await bytes('docs/ashoka/slice-27-offline-gate-fourteenth/result.json');await bytes('docs/ashoka/slice-27-offline-gate-fourteenth/root-tests.json');await bytes('docs/ashoka/slice-27-offline-gate-fourteenth/root-tests.log');
await bytes('docs/ashoka/slice-27-stop-phase-trace.json');await bytes('docs/ashoka/slice-27-stop-phase-trace.log');
await bytes('docs/ashoka/slice-27-stop-reserved-budget.json');await bytes('docs/ashoka/slice-27-stop-reserved-budget.log');
await bytes('docs/ashoka/slice-27-offline-gate-fifteenth/result.json');await bytes('docs/ashoka/slice-27-offline-gate-fifteenth/root-tests.json');await bytes('docs/ashoka/slice-27-offline-gate-fifteenth/root-tests.log');
for(const name of ['async-stop-focused','async-stop-owned-focused','two-phase-stop-focused','two-phase-stop-focused-second']){
 await bytes(`docs/ashoka/slice-27-${name}.json`);await bytes(`docs/ashoka/slice-27-${name}.log`);
}
await bytes('docs/ashoka/slice-27-scheduler-stall.md');
await bytes('docs/ashoka/slice-27-scheduler-stall-fix-first.json');await bytes('docs/ashoka/slice-27-scheduler-stall-fix-first.log');
await bytes('docs/ashoka/slice-27-scheduler-liveness-first.json');await bytes('docs/ashoka/slice-27-scheduler-liveness-first.log');
await bytes('docs/ashoka/record-27-closure.mjs');
const report={schema:'dreamgraph.ashoka.system_closure.v1',recorded_at:new Date().toISOString(),slice:27,status:'verified_for_maintainer_practical_testing_scope',
 review:{reviewer:'executing_agent',method:'Reconciled original frozen obligations, actual named passing cases and accepted browser/recovery packets at shared producer/consumer boundaries. Not an independent paid model review or a claim that every fault was injected into one giant execution.',decision:'Accept functional/system recovery gate under the explicit maintainer platform and benchmark-claim dispositions. Preserve failed pilot and exact packaged gate in28.'},
 baseline:{revision:18,contracts:42,owners:29,generated_contract_names:baseline.contracts},gate:{path:gatePath+'/result.json',source_hash:gate.source_hash,root:gate.root,editor:gate.editor,browser:gate.browser},post_gate_changes:changed,
 owners,compound,contracts,risks,lifecycle:pl,graph_classes:{families:CANONICAL_FAMILIES,kinds:GraphKindSchema.options,relationships:GraphRelationshipSchema.shape.kind.options,assertions:AssertionClassSchema.options,evidence:await evidence(['graph-read-model.test.ts','normalization-evidence.test.ts','plan-context-integration.test.ts'])},
 clients:{families:['native MCP','CLI/bridge','HTTP API','browser Architect','VS Code companion','plugin/portable SDK','2D/3D Explorer','dashboard','Python analytics'],evidence:['slice-25-conformance.json','slice-23-conformance.json','wave-24-29-verification.json','slice-31-release-scope-conformance.json'],limits:'Compiled editor/client execution and actual browser/server traces, not a claim of physical VS Code activation. Explorer declares non-rendered plan/slice kinds.'},
 scenarios:{GE01_GE15:ge,GE16:{status:'pilot_completed_gain_not_established',evidence:pilotPath,release_disposition:'Publish failure/limitations under maintainer practical-testing direction and prior explicit benchmark deferral; no gain/superiority claim. Stronger model/task qualification remains post-release.'},UX:accepted25.ux,SC:schedules.schedule_cases,CU:accepted31.cases,AT:{cases:pilot.runs.filter(r=>!r.task_id.includes('GE16')),functional_evidence:'slice-25-conformance.json#task_families',limits:'Real answer quality is not all passing. Read-only AT05 does not execute mutations; functional receipt/recovery proof is separate.'}},
 maintainer,ui_regressions:{evidence:uiPath,checks:ui.checks,browser:ui.browser,initial_detail_ms:ui.initial_detail_ms,tests:await evidence(['explorer-canonical-navigation.test.ts','explorer-mutations.test.ts','architect-plan-authority.test.ts']),limits:'Disposable 1201-node graph, not the installed live graph. Controlled delayed HTTP detail response and injected dream-complete event exercise the UI boundary without claiming an actual dream execution. Original failed layout check, generated-inventory drift and simultaneous-build/browser attempt are preserved.'},scheduler_liveness:{diagnosis:'slice-27-scheduler-stall.md',focused:'slice-27-scheduler-stall-fix-first.json',established_ledger_http:'slice-27-scheduler-liveness-first.json',evidence:await evidence(['scheduler-authority.test.ts','scheduler-session-liveness.test.ts']),limits:'Synthetic 20000-receipt/39-inactive-schedule fixture; original installed daemon not upgraded or restarted.'},remaining_release_gate:{slice:28,status:'pending_not_started',scope:'Synchronized versions/docs, exact packaged installation/activation/restore and running-asset pinning, release workflow including website. Sol6.1 requested for this stage.'},
 stop_contract:{authority:'Explicit maintainer decision 2026-10-03; docs/audits/2026-09-30-coverage/computer-use.md',input_release_bound_ms:1000,termination_bound_ms:5000,control_loss_bound_ms:5000,origin:'All responsive Stop bounds measured from the same request.',intermediate:'stopping / input released / termination pending; computer lifetime remains unsettled',unconfirmed:'recovery_required / termination unconfirmed; original stop-only recovery retained',evidence:await evidence(['computer-broker.test.ts','computer-browser-worker.test.ts','computer-use-ui.test.ts','ashoka-system-gate.test.ts'])},
 limitations:['No measured general understanding gain or model correctness guarantee. Original real-pilot failures retained; no relabeling as functional passes.','Ordinary CI spends zero. Local complete gate passed; remote GitHub workflow not run. Matrix narrowed to existing Windows/Ubuntu runtimes only.','The final root gate uses one worker. The maintainer explicitly replaced the accidental one-second whole-process requirement with one-second input release and five-second confirmed owned-tree termination. Actual input-target closure and original browser/helper termination are separate proof; no case is quarantined. Failed timing runs and the lost-receipt/watchdog correction are retained in slice-27-timing-follow-up.md.','The twelfth full gate had one unclassified pause/resume reply timeout. It remains a failed historical run; later focused passes do not diagnose it. Operation-specific diagnostics and the bounded runtime-maintainer follow-up preserve this reliability observation.','31 accepted practical Windows/WSL scope remains closed. Current Windows worker repair is recorded against concrete contrary evidence; no additional platform/runtime/native backend qualification.','26 original graph not migrated; exact original-instance adoption requires its reviewed operator rollout.','Two retired particle tests are explicitly skipped; no additional hidden skips.'],
 artifacts:[...hashes].map(([path,sha256])=>({path,sha256}))};
await writeFile('docs/ashoka/slice-27-closure.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:report.status,owners:owners.length,compound:compound.length,contracts:contracts.length,risks:risks.length,PL:pl.length,release_slice:28,release_status:'pending'}));
