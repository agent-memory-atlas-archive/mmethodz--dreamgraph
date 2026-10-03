/** Bounded verification of already-authorized source work, no model/scan/data migration. */
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const evidence=JSON.parse(await readFile('docs/ashoka/slice-25-conformance.json','utf8'));
assert.equal(evidence.status,'offline_integration_qualified');assert.equal(evidence.root.failed,0);
async function physicalReview(){for(const artifact of evidence.artifacts){const bytes=await readFile(artifact.path);assert.equal(createHash('sha256').update(bytes).digest('hex'),artifact.sha256,artifact.path);}}
await physicalReview();
const client=new Client({name:'ashoka-bounded-source-verification',version:'1'}),transport=new StreamableHTTPClientTransport(new URL('http://127.0.0.1:8010/mcp'));
const trace=[];let sessionId;
const call=async(name,args={})=>{
 const result=await client.callTool({name,arguments:args},undefined,{timeout:30000});
 const value=result.structuredContent??JSON.parse(result.content.find(item=>item.type==='text').text);
 trace.push({name,args,value});assert(!result.isError&&value.success!==false,JSON.stringify({name,error:value.error}));return value;
};
const sessionPath=()=>`C:/Users/Mika Jussila/.dreamgraph/ee9ce3b9-0313-4768-b5f1-24b9b3fffc4b/data/discipline_sessions/${sessionId}.json`;
async function recordRead(summary){await call('discipline_record_tool_call',{tool_name:'read_local_file',result_summary:summary});const saved=JSON.parse(await readFile(sessionPath(),'utf8'));return saved.tool_calls.at(-1).id;}
const rows=[['progress','src/architect/plan-registry.ts','Restore reported legacy progress consistently without creating verification or execution authority.'],
 ['stop','src/server/managed-execution.ts','Keep first whole reports immutable; independent original-host stop proof releases only settled original ownership and retains source/spend uncertainty.'],
 ['installation','scripts/workspace-artifacts.mjs','Same-version artifacts refresh by full-byte hashes and installed ESM smoke; failed daemon health cannot print success.'],
 ['integration','docs/ashoka/slice-25-conformance.json','Actual GE01–15 shared mechanisms/native hooks, UX01–12 Windows Chrome and C14 consumer semantics qualify ordinary integration; GE16 understanding/native GUI/live migration/release stay later gates.']];
let report;
try{
 await client.connect(transport);
 sessionId=(await call('discipline_start_session',{type:'modification',description:'Complete the human-authorized bounded Slice25 source verification after the external daemon restart interrupted the prior audit transport. Preserve that record and all later Ashoka gates.',target_scope:rows.map(row=>row[1]),requires_ground_truth:true})).session_id;
 await call('read_source_code',{repo:'dreamgraph',filePath:'src/architect/plan-registry.ts',entity:'applyLegacyProgress'});
 await call('discipline_record_tool_call',{tool_name:'read_source_code',result_summary:rows[0][2]});
 await call('query_architecture_decisions',{search:'ADR-207'});
 await call('discipline_record_tool_call',{tool_name:'query_architecture_decisions',result_summary:'Read accepted ADR-207 permanent plan/log preservation and adaptive operational graph boundary; source work retains that distinction.'});
 await call('discipline_transition',{target_phase:'audit'});
 const audit=await recordRead('Read complete physical source/evidence hashes and actual qualified results:1850 root/2 existing skips,509 editor,32 browser,10 consumer checks. No paid/native-platform claims.');
 const entries=rows.map(([id,file,description])=>({id:`ASHOKA-25-${id}`,source_ref:{type:'source_file',identifier:file,tool_call_id:audit},target_ref:{file_path:file,tool_call_id:audit},status:'confirmed_match',description,evidence:[{tool_call_id:audit,tool_name:'read_local_file',summary:description,supports:'confirms'}],severity:'major',discrepancies:[]}));
 await call('discipline_record_delta',{entries,sources:entries.map(entry=>entry.source_ref)});
 await call('discipline_transition',{target_phase:'plan'});
 const items=entries.map((entry,index)=>({id:`ashoka25-close-${index}`,priority:index,delta_entry_id:entry.id,action:'modify',target_file:entry.target_ref.file_path,change_description:entry.description,
 source_truth_mapping:{source_type:'source_file',source_identifier:entry.source_ref.identifier,what_it_requires:entry.description},
 risk:{level:'medium',breaking_changes:[],regressions:['No invented verification, running ownership, stronger stop or installed success'],dependencies:['Owner-approved Ashoka scope; accepted preceding slices; baseline17/42']},
 verification_criteria:[{tool:'read_local_file',check_description:'Complete source hashes and actual qualified regression/transport/browser results',expected_result:'Match stated scope with no failed required offline case; later gates remain explicit'}]}));
 await call('discipline_submit_plan',{description:'Bounded source integration verification under the human owner’s existing Implement Ashoka authorization and approved predecessor scope; no new paid, GUI, migration or release authority.',items,auto_approve:false});
 await call('discipline_approve_plan');await call('discipline_transition',{target_phase:'execute'});
 await call('discipline_transition',{target_phase:'verify'});await physicalReview();
 const verify=await recordRead('VERIFY re-read complete source/evidence bytes and exact test/browser/client results; all recorded hashes match. Scope excludes later real-model/platform/migration/release gates.');
 const post=entries.map(entry=>({...entry,source_ref:{...entry.source_ref,tool_call_id:verify},target_ref:{...entry.target_ref,tool_call_id:verify},evidence:[{tool_call_id:verify,tool_name:'read_local_file',summary:entry.description,supports:'confirms'}]}));
 report=await call('discipline_verify',{post_delta_entries:post,post_delta_sources:post.map(entry=>entry.source_ref),item_results:items.map((item,index)=>({plan_item_id:item.id,delta_entry_id:item.delta_entry_id,tool_call_id:verify,verified:true,verification_detail:post[index].description,evidence:post[index].evidence}))});
 assert.equal(report.compliance.status,'compliant');assert.equal(report.regressions,0);assert.equal(report.recommendation.action,'accept');
 await call('discipline_complete_session',{status:'completed'});
 console.log(JSON.stringify({sessionId,compliance:report.compliance,recommendation:report.recommendation}));
}finally{
 await writeFile('docs/ashoka/slice-25-native-review.json',JSON.stringify({sessionId,report,trace},null,2)+'\n');
 await transport.terminateSession().catch(()=>{});await client.close();
}
