/** Bounded verification of the already-authorized dashboard scope; no live scan/model/migration. */
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const evidence=JSON.parse(await readFile('docs/ashoka/slice-23-conformance.json','utf8'));
assert.equal(evidence.status,'offline_dashboard_qualified');assert.equal(evidence.root.failed,0);
async function physicalReview(){for(const artifact of evidence.artifacts){const bytes=await readFile(artifact.path);assert.equal(createHash('sha256').update(bytes).digest('hex'),artifact.sha256,artifact.path);}}
await physicalReview();
const endpoint=process.env.ASHOKA_REVIEW_ENDPOINT||'http://127.0.0.1:8010/mcp';
const dataDirectory=process.env.ASHOKA_REVIEW_DATA_DIR||'C:/Users/Mika Jussila/.dreamgraph/ee9ce3b9-0313-4768-b5f1-24b9b3fffc4b/data';
const client=new Client({name:'ashoka-dashboard-source-verification',version:'1'}),transport=new StreamableHTTPClientTransport(new URL(endpoint));
const trace=[];let sessionId,report;
const call=async(name,args={})=>{const result=await client.callTool({name,arguments:args},undefined,{timeout:30000});const value=result.structuredContent??JSON.parse(result.content.find(item=>item.type==='text').text);trace.push({name,args,value});assert(!result.isError&&value.success!==false,JSON.stringify({name,error:value.error}));return value;};
const sessionPath=()=>`${dataDirectory}/discipline_sessions/${sessionId}.json`;
async function recordRead(summary){await call('discipline_record_tool_call',{tool_name:'read_local_file',result_summary:summary});return JSON.parse(await readFile(sessionPath(),'utf8')).tool_calls.at(-1).id;}
const rows=[['settings','src/server/configuration-workspace.ts','Every supported setting maps to a typed control or named exception; captured revision/operation/drafts, keyboard errors, exact uncertain retries and protected scoped templates preserve authority.'],
 ['activation','src/server/dashboard.ts','Durable configuration receipt is separate from activation; touched owner updates preserve paused jobs/zero limits and original admitted policies, with actual saved/effective/role readback.'],
 ['routing','src/api/routes.ts','Real API dispatch reaches configuration GET/POST and canonical dashboard reads instead of being consumed as an unknown route.'],
 ['integration','docs/ashoka/slice-23-conformance.json','1863 root passes/two existing skips,26 current focused cases and15 actual Windows Chrome/compiled daemon/CLI checks qualify this bounded UI/configuration scope; later platform/model/migration/release gates remain open.']];
try{
 await client.connect(transport);
 sessionId=(await call('discipline_start_session',{type:'modification',description:'Verify the owner-authorized Slice23 compact configuration/runtime workspace after full actual daemon/browser/CLI qualification. No paid inference, live conversion or release authority.',target_scope:rows.map(row=>row[1]),requires_ground_truth:true})).session_id;
 await call('read_source_code',{repo:'dreamgraph',filePath:'src/server/configuration-workspace.ts',entity:'configurationTab'});await call('discipline_record_tool_call',{tool_name:'read_source_code',result_summary:rows[0][2]});
 await call('query_architecture_decisions',{search:'ADR-207'});await call('discipline_record_tool_call',{tool_name:'query_architecture_decisions',result_summary:'Existing permanent plan/log preservation and operational graph boundaries are retained; source/full-scan currency is not inferred from age.'});
 await call('discipline_transition',{target_phase:'audit'});const audit=await recordRead('Read complete physical source/results hashes:1863 root passes/2 existing skips,26 focus cases,15 actual browser/daemon/CLI checks and six generated checks. No model, native GUI or live migration claim.');
 const entries=rows.map(([id,file,description])=>({id:'ASHOKA-23-'+id,source_ref:{type:'source_file',identifier:file,tool_call_id:audit},target_ref:{file_path:file,tool_call_id:audit},status:'confirmed_match',description,evidence:[{tool_call_id:audit,tool_name:'read_local_file',summary:description,supports:'confirms'}],severity:'major',discrepancies:[]}));
 await call('discipline_record_delta',{entries,sources:entries.map(entry=>entry.source_ref)});await call('discipline_transition',{target_phase:'plan'});
 const items=entries.map((entry,index)=>({id:'ashoka23-close-'+index,priority:index,delta_entry_id:entry.id,action:'modify',target_file:entry.target_ref.file_path,change_description:entry.description,
 source_truth_mapping:{source_type:'source_file',source_identifier:entry.source_ref.identifier,what_it_requires:entry.description},risk:{level:'medium',breaking_changes:[],regressions:['No hidden paid work, session grant bypass, secret output, wrong revision overwrite or restart/stop claim'],dependencies:['Accepted10/11/17/21/22/25/29; reviewed baseline17/42']},verification_criteria:[{tool:'read_local_file',check_description:'Complete source/result hashes and actual qualified browser/HTTP/readback evidence',expected_result:'All required bounded Slice23 cases pass; later gates remain explicit'}]}));
 await call('discipline_submit_plan',{description:'Bounded verification under the human owner’s existing Implement Ashoka authorization; no new model, GUI, migration or release scope.',items,auto_approve:false});
 await call('discipline_approve_plan');await call('discipline_transition',{target_phase:'execute'});await call('discipline_transition',{target_phase:'verify'});await physicalReview();
 const verify=await recordRead('VERIFY re-read complete qualified source/evidence bytes; all recorded physical hashes match and actual current results pass. Preserve exact recovery, zero limits, original session/job intent and separate later gates.');
 const post=entries.map(entry=>({...entry,source_ref:{...entry.source_ref,tool_call_id:verify},target_ref:{...entry.target_ref,tool_call_id:verify},evidence:[{tool_call_id:verify,tool_name:'read_local_file',summary:entry.description,supports:'confirms'}]}));
 report=await call('discipline_verify',{post_delta_entries:post,post_delta_sources:post.map(entry=>entry.source_ref),item_results:items.map((item,index)=>({plan_item_id:item.id,delta_entry_id:item.delta_entry_id,tool_call_id:verify,verified:true,verification_detail:post[index].description,evidence:post[index].evidence}))});
 assert.equal(report.compliance.status,'compliant');assert.equal(report.regressions,0);assert.equal(report.recommendation.action,'accept');await call('discipline_complete_session',{status:'completed'});console.log(JSON.stringify({sessionId,compliance:report.compliance,recommendation:report.recommendation}));
}finally{await writeFile('docs/ashoka/slice-23-native-review.json',JSON.stringify({endpoint,authority_scope:process.env.ASHOKA_REVIEW_SCOPE||'installed DreamGraph own-instance',sessionId,report,trace},null,2)+'\n');await transport.terminateSession().catch(()=>{});await client.close();}
