/** Read-only bounded real-model pilot preparation. No provider construction, key read or instance mutation. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import {withDataDirectory} from '../../dist/utils/paths.js';
import {loadCanonicalGraph} from '../../dist/graph/read-model.js';
import {buildContextPack} from '../../dist/graph/context-pack.js';
import {retrievalFixture} from '../../tests/helpers/ashoka-retrieval.ts';
const directory=resolve(process.argv[2]);assert(process.argv[2]);
await mkdir(directory,{recursive:false});
const protocolBytes=await readFile('docs/ashoka/agent-evaluation-protocol.json'),protocol=JSON.parse(protocolBytes);
const hash=value=>'sha256:'+createHash('sha256').update(value).digest('hex');
const save=async(name,value)=>writeFile(join(directory,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
const tasks=[],states=[];
const sourceContext=project=>protocol.source_evidence.filter(row=>row.project===project).map(row=>JSON.stringify({id:row.id,file:row.file,source_sha256:row.source_sha256,excerpt_sha256:row.excerpt_sha256,excerpt:row.excerpt})).join('\n');
for(const original of protocol.task_labels){
 const task=Object.fromEntries(['id','project','prompt','required_outcomes','mandatory_evidence_ids','forbidden_assertions'].map(key=>[key,original[key]]));
 const started=performance.now();let graph,source;
 if(['AT02','AT04'].includes(original.family)){
  const snapshot=retrievalFixture(original.project,protocol.source_evidence,300);
  const pack=buildContextPack(snapshot,{query:original.prompt,token_budget:10000,depth:0,mandatory_evidence_ids:original.mandatory_evidence_ids},new Date(protocol.frozen_at));
  graph=pack.context_text+'\nRetrieval limits: '+JSON.stringify({state:pack.state,omissions:pack.omissions});source=sourceContext(original.project);
 }else{
  // Identical controls: do not manufacture a graph advantage by leaking expected labels.
  source=graph='Declared disposable contract input (not a live graph):\n'+JSON.stringify(original.input);
 }
 tasks.push({task,source,graph,manifest:hash(protocolBytes),construction_ms:performance.now()-started,
  scope:['AT02','AT04'].includes(original.family)?'frozen_source_retrieval':'identical_contract_input_control',
  limitation:original.family==='AT05'?'Read-only mutation/recovery reasoning; actual governed effects are qualified by the existing core integration tests. This model is not given mutation tools.':null});
}
const master='C:/Users/Mika Jussila/.dreamgraph',registry=JSON.parse(await readFile(join(master,'instances.json'),'utf8'));
for(const project of ['dreamgraph','web64-react']){
 const instance=registry.instances.find(row=>row.name===project);assert(instance);
 const prompt=project==='dreamgraph'
  ?'Explain the scan, graph publication and next-agent retrieval boundaries in DreamGraph. Identify one relevant recorded decision or historical constraint if the supplied evidence supports it, explain its effect on the next implementation decision, and distinguish source evidence, graph claims and missing information.'
  :'Explain the Web64 compile-artifact, runtime handoff and emulator speed-policy boundaries. Identify one relevant recorded decision or historical constraint if the supplied evidence supports it, explain its effect on the next implementation decision, and distinguish source evidence, graph claims and missing information.';
 const started=performance.now();
 const snapshot=await withDataDirectory(join(master,instance.uuid,'data'),()=>loadCanonicalGraph(instance.uuid));
 const pack=buildContextPack(snapshot,{query:prompt,token_budget:8500,depth:1,max_neighbors:3,max_records:16},new Date());
 const source=sourceContext(project),graph=source+'\nEstablished instance context (limited, not guaranteed complete):\n'+pack.context_text+'\nState: '+JSON.stringify({availability:pack.state.availability,completeness:pack.state.completeness,freshness:pack.state.freshness});
 const state={project,instance_id:instance.uuid,revision:snapshot.revision,currency:snapshot.currency,graph_state:pack.state,
  selected:pack.records,omissions:pack.omissions,source_note:'Both arms receive the same frozen source excerpts. The assisted arm additionally receives the actual established-instance core context, including its limitations. This is not a fresh source audit.'};
 await save(project+'-graph-context.json',{...state,context_text:pack.context_text});states.push(state);
 tasks.push({task:{id:project+':GE16-pilot',project,prompt,required_outcomes:['correct_boundary','provenance','uncertainty','decision_rationale'],mandatory_evidence_ids:[],forbidden_assertions:['invented project history','graph hypothesis presented as source fact','unperformed mutation claimed']},
  source,graph,manifest:hash(JSON.stringify({protocol:hash(protocolBytes),state,graph_context_hash:hash(pack.context_text)})),construction_ms:performance.now()-started,scope:'established_graph_plus_frozen_source',limitation:'One exploratory pair, not a repeated/statistically significant performance claim.'});
}
const model='gpt-4.1-2025-04-14',pricingVersion='openai-gpt41-reviewed-2026-10-03';
const runs=[];
for(const [index,value]of tasks.entries()){
 for(const context of [value.source,value.graph]){assert(Buffer.byteLength(context)<=24000,'Context requires a deliberate smaller whole-record selection');assert(!/sk-(?:proj-)?[A-Za-z0-9_-]{25,}/.test(context),'Credential-like text refused');}
 const spec={schema:'dreamgraph.completion_pair_specification.v1',task:value.task,scope:'read_only_supplied_context_completion',local_results:'private_job_artifact',
  execution:{provider:'openai',model,api:'responses',effort:null,prompt_version:'ashoka.bounded-real-pilot.v1',source_manifest_hash:value.manifest,input_tokens:32768,output_tokens:1600,context_bytes:24000,output_bytes:16000,max_calls:1,max_elapsed_ms:60000,retention:'store_false',currency:'USD',max_amount:.16},
  arms:[{arm:'graph_assisted',context:value.graph},{arm:'source_only',context:value.source}].map(arm=>({...arm,context_bytes:Buffer.byteLength(arm.context),construction_ms:value.construction_ms,source_manifest_hash:value.manifest})),
  order:index%2?'graph_first':'source_first',endpoint:'https://api.openai.com/v1',api_key_env:'ASHOKA_EVALUATION_API_KEY',
  pricing:{version:pricingVersion,provider:'openai',model,currency:'USD',source:'https://developers.openai.com/api/docs/models/gpt-4.1 (official page read 2026-10-03)',input_per_million:2,output_per_million:8,output_includes_reasoning:true,input_includes_images:true},
  budget:{requests:2,input_tokens:65536,output_tokens:3200,reasoning_tokens:0,retries:0,elapsed_ms:120000,concurrency:1,max_hops:0,max_neighbors:0,run_amount:.16,day_amount:2.5,currency:'USD',pricing_version:pricingVersion,billing_principal:'maintainer-ashoka-pilot-2026-10-03'}};
 const file=String(index+1).padStart(2,'0')+'-'+value.task.id.replaceAll(':','-')+'.json';await save(file,spec);
 runs.push({file,task_id:value.task.id,scope:value.scope,limitation:value.limitation,arms:spec.arms.map(({arm,context_bytes})=>({arm,context_bytes})),sha256:hash(JSON.stringify(spec))});
}
const manifest={schema:'dreamgraph.ashoka.real_pilot_manifest.v1',created_at:new Date().toISOString(),model,provider:'openai',api:'responses',retention:'store_false; provider account retention is not changed or attested',
 paid_calls_max:28,total_reservation_ceiling_usd:2.24,shared_day_cap_usd:2.5,retries:0,escalation:false,graph_writes:false,
 scope:'12 frozen task pairs plus two established-instance exploratory pairs; read-only completions, one run per arm, alternating order. Expected labels are not sent.',
 source_protocol_sha256:hash(protocolBytes),runs,model_requests:0,review_required_before_collection:true};
await save('manifest.json',manifest);
console.log(JSON.stringify({directory,model,calls_max:28,reservation_ceiling_usd:2.24,day_cap_usd:2.5,runs:runs.length,model_requests:0}));
