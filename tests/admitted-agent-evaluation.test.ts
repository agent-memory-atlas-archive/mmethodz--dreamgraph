/** Actual durable job/admission/provider code, intercepted official HTTP; zero real-provider requests. */
import {afterEach,expect,it,vi} from 'vitest';
import {readFile,writeFile} from 'node:fs/promises';
import {previewCompletionPair,evaluateAuthorizedCompletionPair,type CompletionPairSpecification} from '../src/evaluation/agent-usefulness.js';
import {EngineJobs} from '../src/cognitive/jobs.js';
import {getDataDir,withDataDirectory} from '../src/utils/paths.js';
import {installOfflineAdmissionFixtures} from './helpers/offline-admission.js';
import {completionPairFixture as spec} from './helpers/completion-pair-fixture.js';
installOfflineAdmissionFixtures();
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
const approval=(value:CompletionPairSpecification)=>({digest:previewCompletionPair(value).digest,principal:'declared-operator',expires_at:new Date(Date.now()+60000).toISOString()});
const ledger=async()=>JSON.parse(await readFile(getDataDir()+'/spend_ledger.json','utf8'));
const response=(model='gpt-4.1',text='Source-grounded fixture answer')=>Response.json({model,status:'completed',output_text:text,usage:{input_tokens:100,output_tokens:10,total_tokens:110},output:[]});
it('pure disclosure preview creates no job/provider/reservation and pins exact policy, contexts, prices and retention',async()=>{
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);const value=spec(),first=previewCompletionPair(value);
 expect(first.policy.policy.retention).toMatchObject({requested:'store_false',effective:'store_false'});expect(first.policy.policy.fallbacks).toEqual([]);
 expect((await new EngineJobs().inspect()).records).toEqual([]);expect(fetch).not.toHaveBeenCalled();
 expect(withDataDirectory(getDataDir()+'/other',()=>previewCompletionPair(value)).digest).not.toBe(first.digest);
 for(const changed of [{...value,arms:[{...value.arms[0],context:'other',context_bytes:5},value.arms[1]]},
  {...value,pricing:{...value.pricing,source:'different reviewed tariff'}},
  {...value,execution:{...value.execution,retention:'store_true'}}])expect(previewCompletionPair(changed).digest).not.toBe(first.digest);
});
it('refuses unfunded/unpriced/mismatched/expanded routes and malformed disclosure before any dispatch',async()=>{
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
 const changes=[{budget:{...spec().budget,run_amount:0}},{pricing:{...spec().pricing,version:'unapproved'}},{endpoint:'https://unapproved.invalid/v1'},
  {execution:{...spec().execution,api:'native_cli'}},{budget:{...spec().budget,retries:1}},
  {arms:[{...spec().arms[0],context_bytes:99},spec().arms[1]]},{execution:{...spec().execution,retention:'zero_retention'}}];
 for(const patch of changes)expect(()=>previewCompletionPair({...spec(),...patch})).toThrow();
 const value=spec(),approved=approval(value);vi.stubEnv('TEST_EVALUATION_SECRET','synthetic-secret');
 await expect(evaluateAuthorizedCompletionPair({specification:{...value,task:{...value.task,prompt:'changed question'}},approval:approved})).rejects.toThrow('DISCLOSURE_CHANGED');
 await expect(evaluateAuthorizedCompletionPair({specification:value,approval:{...approved,expires_at:new Date(Date.now()-1).toISOString()}})).rejects.toThrow('APPROVAL_DEADLINE');
 expect(fetch).not.toHaveBeenCalled();expect((await new EngineJobs().inspect()).records).toEqual([]);
});
it('collects exact native answers through one shared job/day ledger, checkpoints both, and never scores unreviewed understanding',async()=>{
 const value=spec(),approved=approval(value);vi.stubEnv('TEST_EVALUATION_SECRET','synthetic-secret');vi.stubEnv('DREAMGRAPH_LLM_PRICING','[]');
 const fetch=vi.fn(async(_url,init)=>{const body=JSON.parse(init.body);expect(body).toMatchObject({model:'gpt-4.1',store:false,max_output_tokens:100});return response();});vi.stubGlobal('fetch',fetch);
 const result=await evaluateAuthorizedCompletionPair({specification:value,approval:approved});
 expect(fetch).toHaveBeenCalledTimes(2);expect(result.kind).toBe('real_model');expect(result.scope).toBe('read_only_supplied_context_completion');
 expect(result.results.map(row=>row.arm)).toEqual(['source_only','graph_assisted']);expect(result.results.every(row=>row.assessment===null&&row.mandatory_pass===null)).toBe(true);
 expect(result.results.every(row=>row.verified_source_reads.length===0&&row.context_tokens===null)).toBe(true);expect(result.material_understanding_gain).toBeNull();
 const jobs=new EngineJobs(),original=(await jobs.inspect()).records[0];expect(original.job.state).toBe('succeeded');expect(JSON.parse(original.snapshot.pricing)).toEqual([value.pricing]);
 const state=await ledger(),attempts=Object.values(state.attempts) as any[];expect(attempts).toHaveLength(2);expect(attempts.every(row=>row.state==='settled'&&row.policy_fingerprint===result.policy_fingerprint)).toBe(true);
 expect(new Set(attempts.map(row=>state.runs[row.run_id].parent_run_id))).toEqual(new Set(['job:'+result.job_id]));
 expect(await evaluateAuthorizedCompletionPair({specification:value,approval:approved})).toEqual(result);expect(fetch).toHaveBeenCalledTimes(2);
 expect(JSON.stringify(await jobs.inspect())).not.toContain('synthetic-secret');expect(JSON.stringify(state)).not.toContain('synthetic-secret');
});
it('preserves the first answer on second-arm refusal and cannot replay the failed original job',async()=>{
 const value=spec(),approved=approval(value);vi.stubEnv('TEST_EVALUATION_SECRET','synthetic-secret');let calls=0;
 const fetch=vi.fn(async()=>++calls===1?response():Response.json({status:'completed',model:'gpt-4.1',output:[{type:'message',content:[{type:'refusal',refusal:'declared refusal'}]}],usage:{input_tokens:80,output_tokens:3}}));vi.stubGlobal('fetch',fetch);
 await expect(evaluateAuthorizedCompletionPair({specification:value,approval:approved})).rejects.toThrow('PROVIDER_REFUSAL');
 const jobs=new EngineJobs(),original=(await jobs.inspect()).records[0];expect(original.job.state).toBe('failed');
 const retained=await jobs.readResultArtifact(original.job.id) as any;expect(retained).toMatchObject({assessment_status:'pending_review',completed:[{arm:'source_only',reported_model:'gpt-4.1'}]});
 expect(retained.completed).toHaveLength(1);expect(retained.completed[0].reply.content).toBe('Source-grounded fixture answer');
 await expect(evaluateAuthorizedCompletionPair({specification:value,approval:approved})).rejects.toThrow('JOB_NOT_DISPATCHABLE');expect(fetch).toHaveBeenCalledTimes(2);
 const attempts=Object.values((await ledger()).attempts) as any[];expect(attempts[1].usage).toMatchObject({inputTokens:80,outputTokens:3});
});
it('reported-model mismatch retains observed provenance and stops before the other arm',async()=>{
 const value=spec();vi.stubEnv('TEST_EVALUATION_SECRET','synthetic-secret');const fetch=vi.fn(async()=>response('unapproved-model'));vi.stubGlobal('fetch',fetch);
 await expect(evaluateAuthorizedCompletionPair({specification:value,approval:approval(value)})).rejects.toThrow('REPORTED_MODEL_MISMATCH');expect(fetch).toHaveBeenCalledOnce();
 const jobs=new EngineJobs(),row=(await jobs.inspect()).records[0],partial=await jobs.readResultArtifact(row.job.id) as any;
 expect(partial.completed[0]).toMatchObject({reported_model:'unapproved-model',reply:{outcome:'incomplete'}});expect(row.job.state).toBe('failed');
 const body=JSON.parse(await readFile(getDataDir()+'/'+row.result_artifact!.file,'utf8'));body.result.completed[0].reply.content='unpublished changed answer';
 await writeFile(getDataDir()+'/'+row.result_artifact!.file,JSON.stringify(body));
 await expect(jobs.readResultArtifact(row.job.id)).rejects.toThrow('ARTIFACT_UNAVAILABLE');
});
it('abort reaches the owned provider, preserves unknown liability and never starts the second arm',async()=>{
 const value=spec(),controller=new AbortController();vi.stubEnv('TEST_EVALUATION_SECRET','synthetic-secret');let started!:()=>void;const ready=new Promise<void>(done=>started=done);
 const fetch=vi.fn((_url,init)=>new Promise<Response>((_done,reject)=>{init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true});started();}));vi.stubGlobal('fetch',fetch);
 const run=evaluateAuthorizedCompletionPair({specification:value,approval:approval(value),signal:controller.signal}),failure=expect(run).rejects.toThrow();await ready;controller.abort(new Error('declared operator Stop'));await failure;
 const until=Date.now()+5000;let state=await ledger();while(Object.values(state.attempts).some((row:any)=>row.state==='dispatched')&&Date.now()<until){await new Promise(done=>setTimeout(done,20));state=await ledger();}
 expect(fetch).toHaveBeenCalledOnce();expect(Object.values(state.attempts)[0]).toMatchObject({state:'uncertain',acknowledged:false,usage:null});
 const jobs=new EngineJobs();let row=(await jobs.inspect()).records[0];while(!row.work_settled&&Date.now()<until){await new Promise(done=>setTimeout(done,20));row=(await jobs.inspect()).records[0];}
 expect(row.job.state).toBe('recovery_required');expect(row.job.unknown_effects.length).toBeGreaterThan(0);
});
