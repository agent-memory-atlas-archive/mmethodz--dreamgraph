/** Actual C15 source/publication/production enrichment+dream+normalization+retrieval owners; only provider replies are declared offline fixtures. */
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {installOfflineAdmissionFixtures} from './helpers/offline-admission.js';
import {getDataDir,setDataDirOverride} from '../src/utils/paths.js';
import {config} from '../src/config/config.js';
import {releaseGraphWriter} from '../src/graph/writer-lease.js';
import {commitGraphWrites,loadPublicationState,findOperationReceipt} from '../src/graph/publication.js';
import {loadCanonicalGraph} from '../src/graph/read-model.js';
import {buildContextPack} from '../src/graph/context-pack.js';
import {managedSourceEffect,prepareChangeReconciliation,readChangeObligations,readDirtyPartitions} from '../src/graph/change-obligations.js';
import {withGraphReconciliation} from '../src/utils/graph-reconciliation-barrier.js';
import {runDirtyDigestion} from '../src/cognitive/digestion.js';
import {engine} from '../src/cognitive/engine.js';
import {EngineJobs} from '../src/cognitive/jobs.js';
import {loadGraphMaintenanceState} from '../src/cognitive/graph-maintenance-state.js';
import {readNormalizationResult} from '../src/cognitive/normalization-results.js';
installOfflineAdmissionFixtures({directory:false});
let root:string,data:string,source:string,previous:string,repos:typeof config.repos;
const before='export function applyWidget() { return saveWidget(); }\nexport function saveWidget() { return 1; }\n';
const after=before.replace('return 1','return 2');
const facts=()=>['a','b'].map((id,index)=>({id,name:index===0?'Apply Widget':'Save Widget',description:'Parser fixture',domain:'widgets',source_repo:'fixture',source_files:['source.ts'],keywords:['widget'],tags:['widget'],links:[]}));
beforeEach(async()=>{
 previous=getDataDir();repos=config.repos;root=await mkdtemp(join(tmpdir(),'dg-system-digestion-'));data=join(root,'data');source=join(root,'source.ts');
 await mkdir(data);await writeFile(source,before);setDataDirOverride(data);config.repos={fixture:root};
 for(const role of ['ENRICHMENT','DREAMER','NORMALIZER'])for(const [field,value]of Object.entries({PROVIDER:'openai',MODEL:'gpt-4.1',API:'responses',API_KEY:'synthetic-fixture',RETENTION:'store_false',MAX_CALLS:'12',MAX_HOPS:'0'}))vi.stubEnv('DREAMGRAPH_LLM_'+role+'_'+field,value);
 vi.stubEnv('DG_NORMALIZER_LLM_THRESHOLD','0.01'); // Exercise configured semantic review for these deliberately weak fixture hypotheses.
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2020-01-01T00:00:00Z'));
 try{await commitGraphWrites({actor:'declared_structural_fixture',writes:[{file:'features.json',content:JSON.stringify(facts())}],source_reconciliation:{revision:'fixture-full-scan',scope:['source:fixture/source.ts'],full:true}});}
 finally{vi.useRealTimers();}
});
afterEach(async()=>{
 vi.useRealTimers();if(engine.getState()!=='awake')await engine.interrupt();vi.unstubAllGlobals();vi.unstubAllEnvs();
 await releaseGraphWriter(data);setDataDirOverride(previous);config.repos=repos;await rm(root,{recursive:true,force:true,maxRetries:8,retryDelay:100});
});
const enrich=()=>({results:facts().map(node=>({id:node.id,
 description:node.name+' coordinates the evidenced widget responsibility through the supplied function and preserves the explicitly observed source flow and return value.',
 intent:'Preserve the observed widget implementation and its bounded source responsibility.',purpose:'domain-entity',tags:['widget','enriched'],feature_anchors:[],relations:[],confidence:.8}))});
const installProvider=(refuse=false)=>{
 const calls:Array<{schema:string;model:string}>=[];
 vi.stubGlobal('fetch',vi.fn(async(url,init)=>{
  if(String(url)==='https://api.openai.com/v1/models'&&!init?.body)return Response.json({data:[{id:'gpt-4.1'}]}); // Declared availability fixture; no model dispatch.
  if(String(url)!=='https://api.openai.com/v1/responses')throw new Error('DECLARED_FIXTURE_ONLY_NO_NETWORK');
  const body=JSON.parse(init.body),schema=body.text?.format?.name;calls.push({schema,model:body.model});
  if(refuse)return Response.json({model:'gpt-4.1',status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'Declared offline refusal'}]}],usage:{input_tokens:100,output_tokens:5,total_tokens:105}});
  let result;
  if(schema==='dreamgraph_node_enrichment_batch')result=enrich();
  else if(schema==='dream_response')result={edges:[{from:'a',to:'b',relation:'possible_call',reason:'One supplied source suggests applyWidget calls saveWidget; not independent corroboration.',confidence:.6,type:'hypothetical',source_evidence:'export function applyWidget() { return saveWidget(); }'}],new_nodes:[]};
  else if(schema==='semantic_validation'){
   const prompt=body.input.map((message:any)=>typeof message.content==='string'?message.content:message.content.map((part:any)=>part.text??'').join('\n')).join('\n');
   const ids=[...prompt.matchAll(/^ID: (.+)$/gm)].map(match=>match[1]);if(!ids.length)throw new Error('DECLARED_SEMANTIC_FIXTURE_REQUIRES_ACTUAL_EDGE_IDS');
   result={evaluations:ids.map(edge_id=>({edge_id,semantic_relevance:.95,reasoning:'Declared same-fixture model agreement; plausibility is not independent source corroboration.'}))};
  }
  else throw new Error('UNDECLARED_PROVIDER_SCHEMA:'+schema);
  return Response.json({model:'gpt-4.1',status:'completed',output_text:JSON.stringify(result),output:[],usage:{input_tokens:100,output_tokens:100,total_tokens:200}});
 }));return calls;
};
async function changed(){
 const obligation=await managedSourceEffect({operation_id:'managed-widget-change',changes:[{file:source,content:after}],apply:()=>writeFile(source,after)});
 expect((await readDirtyPartitions()).partitions[0].state).toBe('awaiting_reconciliation');
 await runDirtyDigestion({debounce_ms:0}); // Production refuses optional stages before required source reconciliation.
 await withGraphReconciliation(async()=>{const writes=await prepareChangeReconciliation([obligation.id],'widget-reconciliation');
  await commitGraphWrites({actor:'declared_structural_reconciliation',operation_id:'widget-reconciliation',writes,source_reconciliation:{revision:'widget-reconciliation',scope:['source:fixture/source.ts'],full:false}});
 });return obligation;
}
it('production stages share original bounded jobs, preserve source truth and supply current next-agent context after one old full scan',async()=>{
 const calls=installProvider();const obligation=await changed();expect(calls).toHaveLength(0);
 await runDirtyDigestion({debounce_ms:0,limit:1});
 let partition=(await readDirtyPartitions()).partitions[0];expect(partition,JSON.stringify(await loadGraphMaintenanceState())).toMatchObject({state:'ready',pending_stages:['digestion'],running_generation:null});
 await runDirtyDigestion({debounce_ms:0,limit:1});partition=(await readDirtyPartitions()).partitions[0];
 expect(partition,JSON.stringify(await loadGraphMaintenanceState())).toMatchObject({state:'settled',pending_stages:[],running_generation:null});expect(engine.getState()).toBe('awake');
 const maintenance=(await loadGraphMaintenanceState()).digestion as any;expect(maintenance.records.map((row:any)=>row.stage)).toEqual(['enrichment','digestion']);expect(maintenance.records.every((row:any)=>row.state==='complete'&&row.receipt_ids.length>0)).toBe(true);
 const jobs=(await new EngineJobs().inspect()).records;expect(jobs.map(row=>row.action)).toEqual(['dirty_enrichment','dirty_digestion']);expect(jobs.every(row=>row.job.state==='succeeded'&&row.work_settled===true)).toBe(true);
 expect(calls.some(row=>row.schema==='dreamgraph_node_enrichment_batch')).toBe(true);expect(calls.some(row=>row.schema==='dream_response')).toBe(true);expect(calls.some(row=>row.schema==='semantic_validation')).toBe(true);
 const ledger=JSON.parse(await readFile(join(data,'spend_ledger.json'),'utf8'));expect(Object.values(ledger.attempts).every((row:any)=>row.state==='settled'&&row.acknowledged)).toBe(true);
 expect(Object.values(ledger.attempts).every((row:any)=>jobs.some(job=>ledger.runs[row.run_id].parent_run_id==='job:'+job.job.id))).toBe(true);
 const canonical=await loadCanonicalGraph(new EngineJobs().instance_id);expect(canonical.relationships.filter(row=>row.kind==='validated')).toHaveLength(0); // One fixture source/model judgment is not independent evidence.
 const normalizerReceipt=await findOperationReceipt(maintenance.records.find((row:any)=>row.stage==='digestion').receipt_ids[0],'normalizer');expect(normalizerReceipt).not.toBeNull();
 expect(await readNormalizationResult(normalizerReceipt!)).toMatchObject({processed:3,validated:0});
 expect(await readFile(join(data,'candidate_edges.json'),'utf8')).toContain('Declared same-fixture model agreement');
 const pack=buildContextPack(canonical,{query:'Widget',depth:0,token_budget:10000});expect(pack.context_text).toContain('preserves the explicitly observed source flow and return value');expect(pack.state.freshness).toBe('current');
 expect(canonical.entities.filter(node=>node.identity.kind==='feature').every(node=>node.evidence.some(ref=>ref.origin==='source')&&node.evidence.some(ref=>ref.origin==='model'&&ref.validation==='hypothesis'))).toBe(true);
 expect((await loadPublicationState()).currency.last_full_scan_at).toBe('2020-01-01T00:00:00.000Z');expect((await readChangeObligations()).entries.find(row=>row.id===obligation.id)?.state).toBe('graph_committed');
 const requestCount=calls.length;await runDirtyDigestion({debounce_ms:0});expect(calls).toHaveLength(requestCount);
},30000);
it('a real production enrichment refusal preserves measured spend, explicit optional partial debt and current reconciled source without automatic retry',async()=>{
 const calls=installProvider(true);await changed();await runDirtyDigestion({debounce_ms:0,limit:1});
 const partition=(await readDirtyPartitions()).partitions[0];expect(partition).toMatchObject({state:'partial',pending_stages:['enrichment','digestion'],running_generation:null});
 const maintenance=(await loadGraphMaintenanceState()).digestion as any;expect(maintenance.records[0]).toMatchObject({stage:'enrichment',state:'partial',reason:'semantic_fallbacks_remain'});
 const pack=buildContextPack(await loadCanonicalGraph(new EngineJobs().instance_id),{query:'Widget',depth:0,token_budget:10000});expect(pack.state.freshness).toBe('current');expect(pack.context_text).not.toContain('source-grounded semantic description');
 const ledger=JSON.parse(await readFile(join(data,'spend_ledger.json'),'utf8'));expect(calls).toHaveLength(1);expect(Object.values(ledger.attempts)[0]).toMatchObject({state:'settled',acknowledged:true,usage:{inputTokens:100,outputTokens:5}});
 await runDirtyDigestion({debounce_ms:0});expect(calls).toHaveLength(1);expect(engine.getState()).toBe('awake');
},30000);
