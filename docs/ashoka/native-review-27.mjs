/** Actual disposable discipline protocol over the bounded offline checkpoint; no paid reviewer or release acceptance. */
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const packet='docs/ashoka/slice-27-offline-conformance.json',evidence=JSON.parse(await readFile(packet,'utf8'));
assert.equal(evidence.status,'offline_system_checkpoint_slice27_in_progress');assert.equal(evidence.gate.root.failed,0);assert.equal(evidence.gate.editor.passed,546);
assert.equal(evidence.real_provider_requests,0);assert.equal(evidence.remote_ci_jobs_run,0);
const endpoint=process.env.ASHOKA_REVIEW_ENDPOINT,dataDirectory=process.env.ASHOKA_REVIEW_DATA_DIR;
assert(endpoint&&dataDirectory&&process.env.ASHOKA_REVIEW_SCOPE,'Explicit disposable authority required.');
async function physicalReview(){for(const artifact of evidence.artifacts){const bytes=await readFile(artifact.path);assert.equal(createHash('sha256').update(bytes).digest('hex'),artifact.sha256,artifact.path);}}
await physicalReview();
const client=new Client({name:'ashoka-offline-system-source-review',version:'1'}),transport=new StreamableHTTPClientTransport(new URL(endpoint));
const trace=[];let sessionId,report;
const call=async(name,args={})=>{const result=await client.callTool({name,arguments:args},undefined,{timeout:30000});const value=result.structuredContent??JSON.parse(result.content.find(item=>item.type==='text').text);
 trace.push({name,args,value});assert(!result.isError&&value.success!==false,JSON.stringify({name,error:value.error}));return value;};
async function recordRead(summary){await call('discipline_record_tool_call',{tool_name:'read_local_file',result_summary:summary});return JSON.parse(await readFile(`${dataDirectory}/discipline_sessions/${sessionId}.json`,'utf8')).tool_calls.at(-1).id;}
const rows=[
 ['gate','scripts/run-ashoka-system-checks.mjs','The full offline gate builds all three consumers, checks generated contracts/configuration/baseline, runs every root and compiled editor case, then actual isolated browser qualification sequentially. Source hashes and exact discovered files are checked; unknown termination, skipped editor cases or missing cases refuse. Failed steps retain partial logs and actual child outcome. No paid canary, global restart or release is authorized.'],
 ['role','src/architect/routes.ts','Native success/failure updates the actually bound model role. A Computer Use request cannot qualify or invalidate Architect readiness. Ordinary Architect behavior is preserved.'],
 ['joins','tests/computer-native-graph-loop.test.ts','Six actual native API/SDK/browser/source/graph cases include the original canonical plan scope, separate graph reconciliation, no GUI-implied slice verification, independent Stop recovery and context-allocation refusal. Correct refusal retains source debt, unfinished C14 state and unknown adapter termination without retry/escalation. Fixture HTTP handler settlement and bounded Windows cleanup retries do not attest production termination.'],
 ['evidence',packet,'The local Windows complete gate, compiled editor and actual browser/SDK/graph joins have exact accepted results and hashes. Provider replies are declared fixtures; remote CI has not run. Peer native desktops, native CLI/provider computer facilities, physical VS Code, live migration, complete owner/compound evidence, real understanding comparisons and synchronized release remain open. Slice27/31 stay in progress.']
];
try{
 await client.connect(transport);sessionId=(await call('discipline_start_session',{type:'modification',description:'Verify only the complete local offline gate and original plan-bound Computer Use/context/role-health joins. No full slice, paid-model, remote-CI, platform, live-migration or release approval.',target_scope:rows.map(row=>row[1]),requires_ground_truth:true})).session_id;
 await call('read_source_code',{repo:'dreamgraph',filePath:'src/architect/routes.ts',entity:'handleArchitectChatRequest'});await call('discipline_record_tool_call',{tool_name:'read_source_code',result_summary:rows[1][2]});
 await call('query_architecture_decisions',{search:'ADR-207'});await call('discipline_record_tool_call',{tool_name:'query_architecture_decisions',result_summary:'Preserve canonical original authority and independent C14 verification. Actual GUI/source/graph outcomes and offline gate acceptance cannot waive unknown work or mandatory model/platform/release evidence.'});
 await call('discipline_transition',{target_phase:'audit'});const audit=await recordRead(`Read all${evidence.artifacts.length} full hashes and actual complete local gate outcomes. Retain explicit fixture, platform, model, live and release limits.`);
 const entries=rows.map(([id,file,description])=>({id:'ASHOKA-27-OFFLINE-'+id,source_ref:{type:'source_file',identifier:file,tool_call_id:audit},target_ref:{file_path:file,tool_call_id:audit},status:'confirmed_match',description,evidence:[{tool_call_id:audit,tool_name:'read_local_file',summary:description,supports:'confirms'}],severity:'major',discrepancies:[]}));
 await call('discipline_record_delta',{entries,sources:entries.map(entry=>entry.source_ref)});await call('discipline_transition',{target_phase:'plan'});
 const items=entries.map((entry,index)=>({id:'ashoka27-offline-'+index,priority:index,delta_entry_id:entry.id,action:'modify',target_file:entry.target_ref.file_path,change_description:entry.description,
  source_truth_mapping:{source_type:'source_file',source_identifier:entry.source_ref.identifier,what_it_requires:entry.description},risk:{level:'medium',breaking_changes:[],regressions:['No false verification, hidden missing test, unknown termination success or model/role escalation'],dependencies:['Original C14/C15/C17 and frozen baseline18/42']},
  verification_criteria:[{tool:'read_local_file',check_description:'Full physical hashes, complete local gate and plan/GUI/source/graph/refusal outcomes',expected_result:'Bounded offline checkpoint passes; whole Slice27/31 and paid/live/platform/release gates remain open'}]}));
 await call('discipline_submit_plan',{description:'Bounded offline system gate and plan-bound Computer Use/role-health source checkpoint. Excludes full slice closure, paid inference, remote CI, native desktops, physical editor, live migration and release.',items,auto_approve:false});
 await call('discipline_approve_plan');await call('discipline_transition',{target_phase:'execute'});await call('discipline_transition',{target_phase:'verify'});await physicalReview();
 const verify=await recordRead(`Re-read all${evidence.artifacts.length} full source/result hashes and accepted complete local results. Preserve retained failures and all open whole-release obligations.`);
 const post=entries.map(entry=>({...entry,source_ref:{...entry.source_ref,tool_call_id:verify},target_ref:{...entry.target_ref,tool_call_id:verify},evidence:[{tool_call_id:verify,tool_name:'read_local_file',summary:entry.description,supports:'confirms'}]}));
 report=await call('discipline_verify',{post_delta_entries:post,post_delta_sources:post.map(entry=>entry.source_ref),item_results:items.map((item,index)=>({plan_item_id:item.id,delta_entry_id:item.delta_entry_id,tool_call_id:verify,verified:true,verification_detail:post[index].description,evidence:post[index].evidence}))});
 assert.equal(report.compliance.status,'compliant');assert.equal(report.regressions,0);assert.equal(report.recommendation.action,'accept');await call('discipline_complete_session',{status:'completed'});
 console.log(JSON.stringify({sessionId,compliance:report.compliance,recommendation:report.recommendation}));
}finally{try{await writeFile('docs/ashoka/slice-27-native-review-offline.json',JSON.stringify({endpoint,authority_scope:process.env.ASHOKA_REVIEW_SCOPE,sessionId,report,trace},null,2)+'\n',{flag:'wx'});}finally{await transport.terminateSession().catch(()=>{});await client.close();}}
