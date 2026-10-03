/** Actual compiled helper/job/provider/admission path; test-only fetch rejects every non-fixture request. */
import {afterEach,beforeEach,expect,it} from 'vitest';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,writeFile,readdir,realpath,rm} from 'node:fs/promises';
import {tmpdir,userInfo} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {completionPairFixture} from './helpers/completion-pair-fixture.js';
const run=promisify(execFile);
let directory:string,ledger:string,loader:string,env:NodeJS.ProcessEnv;
beforeEach(async()=>{
 directory=await mkdtemp(join(tmpdir(),'dg-evaluation-cli-'));ledger=join(directory,'ledger');loader=join(directory,'offline-fetch.mjs');
 env={...process.env,TEST_EVALUATION_SECRET:'synthetic-evaluation-secret',DREAMGRAPH_INSTANCE_UUID:'unrelated-installed-instance'};
 // The child cannot reach the network even if a production path accidentally dispatches.
 await writeFile(loader,`import {appendFile} from 'node:fs/promises';
globalThis.fetch=async(url,init)=>{
 if(String(url)!=='https://api.openai.com/v1/responses')throw new Error('FIXTURE_ONLY_NO_NETWORK');
 const body=JSON.parse(init.body);if(body.model!=='gpt-4.1'||body.store!==false||body.max_output_tokens!==100)throw new Error('FIXTURE_REQUEST_MISMATCH');
 await appendFile(${JSON.stringify(join(directory,'calls.jsonl'))},JSON.stringify({model:body.model,store:body.store})+'\\n');
 return Response.json({model:'gpt-4.1',status:'completed',output_text:'Declared offline answer',output:[],usage:{input_tokens:100,output_tokens:10,total_tokens:110}});
};`);
 await invoke('init');
 await writeFile(join(directory,'spec.json'),JSON.stringify(completionPairFixture()));
});
afterEach(async()=>{await rm(directory,{recursive:true,force:true,maxRetries:8,retryDelay:100});});
const invoke=(command:string,...flags:string[])=>run(process.execPath,['--import',pathToFileURL(loader).href,resolve('scripts/collect-agent-pair.mjs'),command,'--ledger-dir',ledger,...flags],{env,timeout:20000,maxBuffer:1024*1024});
const json=async(name:string)=>JSON.parse(await readFile(join(directory,name),'utf8'));
const preview=async()=>{await invoke('preview','--spec',join(directory,'spec.json'),'--out',join(directory,'preview.json'));return json('preview.json');};
const approve=async(digest:string,principal=userInfo().username)=>{
 await writeFile(join(directory,'approval.json'),JSON.stringify({digest,principal,expires_at:new Date(Date.now()+60000).toISOString()}));
};
const collect=(out:string)=>invoke('collect','--spec',join(directory,'spec.json'),'--approval',join(directory,'approval.json'),'--out',join(directory,out));
const noDispatch=async()=>expect(await readdir(directory)).not.toContain('calls.jsonl');
it('compiled preview has no dispatch/job/graph writes and refuses overwrite, live stores and in-ledger output',async()=>{
 const before=await readdir(ledger),value=await preview();expect(await readdir(ledger)).toEqual(before);await noDispatch();
 expect(value).toMatchObject({scope:'read_only_supplied_context_completion',model_requests:0,operator:userInfo().username});
 expect(value.ledger.instance_id).not.toBe('unrelated-installed-instance');expect(value.ledger.directory).toBe(await realpath(ledger));
 expect(JSON.stringify(value)).not.toContain('synthetic-evaluation-secret');expect(value.arms.every((arm:any)=>!('context' in arm))).toBe(true);
 await expect(invoke('preview','--spec',join(directory,'spec.json'),'--out',join(directory,'preview.json'))).rejects.toThrow('EEXIST');
 await expect(invoke('preview','--spec',join(directory,'spec.json'),'--out',join(ledger,'internal.json'))).rejects.toThrow('OUTSIDE_LEDGER');
 await writeFile(join(ledger,'features.json'),'[]');
 await expect(invoke('preview','--spec',join(directory,'spec.json'),'--out',join(directory,'live.json'))).rejects.toThrow('LIVE_GRAPH_REFUSED');
 await noDispatch();
});
it('compiled owner/context/expiry refusals preserve failure output without allocating or dispatching',async()=>{
 const value=await preview();await approve(value.digest,'different-operator');
 await expect(collect('foreign.json')).rejects.toThrow('ORIGINAL_OPERATOR_REQUIRED');
 expect(await json('foreign.json')).toMatchObject({schema:'dreamgraph.completion_pair_collection_failure.v1',reason:'EVALUATION_COLLECTION_FAILED'});
 await approve(value.digest);const changed=completionPairFixture();changed.task.prompt='A changed unapproved question';
 await writeFile(join(directory,'spec.json'),JSON.stringify(changed));
 await expect(collect('changed.json')).rejects.toThrow('DISCLOSURE_CHANGED');
 await writeFile(join(directory,'spec.json'),JSON.stringify(completionPairFixture()));
 await writeFile(join(directory,'approval.json'),JSON.stringify({digest:value.digest,principal:userInfo().username,expires_at:new Date(Date.now()-1).toISOString()}));
 await expect(collect('expired.json')).rejects.toThrow('APPROVAL_DEADLINE');
 expect(await readdir(ledger)).toEqual(['readonly-evaluation-ledger.json']);await noDispatch();
});
it('compiled collection and later original readback share exactly two fixture dispatches and retain unscored answers',async()=>{
 const value=await preview();await approve(value.digest);await collect('collected.json');
 const first=await json('collected.json');expect(first).toMatchObject({kind:'real_model',assessment_status:'pending_review',material_understanding_gain:null});
 expect(first.results).toHaveLength(2);expect(first.results.every((row:any)=>row.assessment===null&&row.mandatory_pass===null&&row.answer==='Declared offline answer')).toBe(true);
 await collect('replayed.json');expect(await json('replayed.json')).toEqual(first);
 await invoke('inspect','--job',first.job_id,'--out',join(directory,'inspected.json'));
 const inspection=await json('inspected.json');expect(inspection).toMatchObject({model_requests:0,job:{id:first.job_id,state:'succeeded'},result:first});
 expect((await readFile(join(directory,'calls.jsonl'),'utf8')).trim().split('\n')).toHaveLength(2);
 const state=JSON.parse(await readFile(join(ledger,'spend_ledger.json'),'utf8'));
 expect(Object.values(state.attempts).every((attempt:any)=>attempt.state==='settled'&&attempt.acknowledged===true)).toBe(true);
 expect(JSON.stringify(state)).not.toContain('synthetic-evaluation-secret');
});
