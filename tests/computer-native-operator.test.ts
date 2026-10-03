/** Real authority/HTTP/SDK and durable records; descriptor registration is a declared fixture, not a worker qualification. */
import {afterEach,beforeEach,expect,it} from 'vitest';
import {createServer,type Server} from 'node:http';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {DaemonHttpAuthority} from '../src/server/http-authority.js';
import {withSessionContext} from '../src/server/session-context.js';
import {handleManagedExecutionApi,beginHostExecution,endHostExecution} from '../src/server/managed-execution.js';
import {deliverManagedContext} from '../src/graph/execution-context.js';
import {registerComputerJournal,computerRegistrationDigest,computerDigest} from '../src/computer/journal.js';
import type {ComputerJournal} from '../src/computer/journal-schema.js';
import {getDataDir,setDataDirOverride} from '../src/utils/paths.js';
import {releaseGraphWriter} from '../src/graph/writer-lease.js';
import {ManagedExecutionClient} from '../packages/sdk/src/seams/graph-execution.js';
import {config} from '../src/config/config.js';
let root:string,previous:string,server:Server,base:string,authority:DaemonHttpAuthority,original:Awaited<ReturnType<DaemonHttpAuthority['sessions']['create']>>;
let client:ManagedExecutionClient,foreign:ManagedExecutionClient,workerBearer:string,priorRepos:Record<string,string>;
const own=<T>(work:()=>T)=>withSessionContext(original.context,work);
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'dg-native-operator-'));await mkdir(join(root,'data'));previous=getDataDir();setDataDirOverride(join(root,'data'));priorRepos={...config.repos};config.repos={fixture:root};
 authority=new DaemonHttpAuthority(0,{});original=await authority.sessions.create(authority.policy.principal);
 await own(async()=>{const lease=await beginHostExecution({id:'original',adapter:'declared-native-host',query:'Inspect fixture',timeout_ms:30000});workerBearer=lease.worker_bearer;
  await deliverManagedContext('original',lease.execution.block);const now=new Date().toISOString(),instance=lease.execution.instance_id;
  const value:Omit<ComputerJournal,'intent_hash'>={session:{schema:'dreamgraph.computer_session.v1',id:'computer',instance_id:instance,session_id:original.context.session_id,execution_id:'original',job_id:'declared-job',owner:original.context.principal,
   host_id:'declared-worker-host',target_ids:['target'],grant_id:'declared-grant',capability_id:'declared-capability',fence:0,policy_revision:'declared-policy',state:'created',created_at:now,updated_at:now,terminal_reason:null},
   targets:[{schema:'dreamgraph.computer_target.v1',id:'target',instance_id:instance,session_id:original.context.session_id,host_id:'declared-worker-host',surface:'browser',generation:1,origin:'https://fixture.example',application:null}],
   capability:{schema:'dreamgraph.computer_capability.v1',id:'declared-capability',adapter:'declared-native-host',adapter_version:'1',backend_version:'declared-fixture',route:'dreamgraph_harness',requested:['observe'],supported:['observe'],permitted:['observe'],effective:['observe'],
    evidence_granularity:'action',independent_stop:true,reasons:['DECLARED_DESCRIPTOR_ONLY'],qualified_at:now},profile_hash:computerDigest('profile'),worker_epoch:'declared-epoch',
   limits:{max_actions:1,max_images:0,max_image_bytes:0,observation_bytes:1000,expires_at:new Date(Date.now()+20000).toISOString()},stop_state:'not_requested',pause_state:'not_requested',observations:[],actions:[],usage:{actions:0,images:0,image_bytes:0,observation_bytes:0}};
  await registerComputerJournal('original',{...value,intent_hash:computerRegistrationDigest(value)});
 });
 server=createServer(async(req,res)=>{try{const context=await authority.authorize(req,res);if(!context)return;await withSessionContext(context,async()=>{
  if(await authority.handle(req,res,context)||await handleManagedExecutionApi(req,res,new URL(req.url!,'http://local').pathname))return;res.statusCode=404;res.end();});
 }catch(error){res.statusCode=500;res.end(String(error));}});await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));base='http://127.0.0.1:'+(server.address() as {port:number}).port;
 client=new ManagedExecutionClient({baseUrl:base,sessionBearer:original.bearer});foreign=new ManagedExecutionClient({baseUrl:base});
});
afterEach(async()=>{client.dispose();foreign.dispose();await own(()=>endHostExecution({execution_id:'original',outcome:'cancelled',work_termination:'confirmed'})).catch(()=>{});
 server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));await releaseGraphWriter(join(root,'data'));setDataDirOverride(previous);config.repos=priorRepos;await rm(root,{recursive:true,force:true});});
it('native SDK reads only its original owner and publishes neither input nor a new grant',async()=>{const before=await readFile(join(root,'data/publication_state.json'),'utf8'),page=await client.listComputerSessions();
 expect(page.total).toBe(1);expect(page.sessions[0].session.id).toBe('computer');expect(page.sessions[0].worker_available).toBe(false);expect(page.sessions[0]).not.toHaveProperty('journal');
 expect(page.sessions[0]).not.toHaveProperty('observations');expect(page.sessions[0]).not.toHaveProperty('actions');expect(await readFile(join(root,'data/publication_state.json'),'utf8')).toBe(before);
 expect((await client.readComputerStatus('original','computer')).session.id).toBe('computer');expect((await foreign.listComputerSessions()).sessions).toEqual([]);
 await expect(foreign.readComputerStatus('original','computer')).rejects.toThrow('HTTP 400');});
it('real execution workers and browser cookies/origins cannot use the native operator port',async()=>{const path=base+'/api/executions/v1/computer/sessions';
 expect((await fetch(path,{headers:{'X-DreamGraph-Session':workerBearer}})).status).toBe(403);
 for(const headers of [{Origin:base},{Cookie:'dg_session='+original.bearer},{'Sec-Fetch-Site':'same-origin'}])expect((await fetch(path,{headers:{'X-DreamGraph-Session':original.bearer,...headers}})).status).toBe(403);
});
it('the native seam exposes no preparation, confirmation, images, configuration or physical dispatch',async()=>{for(const route of ['prepare','confirm','profiles/apply','observation','act','start']){
 const response=await fetch(base+'/api/executions/v1/computer/'+route,{method:'POST',headers:{'X-DreamGraph-Session':original.bearer,'Content-Type':'application/json'},body:'{}'});expect(response.status).toBe(404);
 }expect((await authority.sessions.ownGrants(original.context)).length).toBe(0);});
it('missing original workers cannot be substituted for pause/resume/stop recovery',async()=>{for(const action of ['pause','resume','stop','recover-stop'] as const)
 await expect(client.controlComputer('original','computer',action,1)).rejects.toThrow('COMPUTER_ORIGINAL_WORKER_UNAVAILABLE');
 expect((await client.readComputerStatus('original','computer')).session.state).toBe('created');});
it('the separate evidence read returns only the original unavailable session without capture, grants or publication',async()=>{
 const before=await readFile(join(root,'data/publication_state.json'),'utf8'),grants=await authority.sessions.ownGrants(original.context);
 expect(await client.readComputerEvidence('original','computer')).toMatchObject({schema:'dreamgraph.computer_evidence.v1',execution_id:'original',computer_session_id:'computer',worker_available:false,observation:null});
 expect(await readFile(join(root,'data/publication_state.json'),'utf8')).toBe(before);expect(await authority.sessions.ownGrants(original.context)).toEqual(grants);
 await expect(foreign.readComputerEvidence('original','computer')).rejects.toThrow('HTTP 400');
});
it('ephemeral evidence refuses worker/cookie/origin credentials, writes and other routes',async()=>{
 const url=base+'/api/executions/v1/computer-evidence/observation?execution_id=original&id=computer';
 for(const headers of [{'X-DreamGraph-Session':workerBearer},{'X-DreamGraph-Session':original.bearer,Origin:base},{'X-DreamGraph-Session':original.bearer,Cookie:'untrusted=1'}])expect((await fetch(url,{headers})).status).toBe(403);
 expect((await fetch(url,{method:'POST',headers:{'X-DreamGraph-Session':original.bearer}})).status).toBe(405);
 expect((await fetch(base+'/api/executions/v1/computer-evidence/act',{headers:{'X-DreamGraph-Session':original.bearer}})).status).toBe(404);
});
it('new preparation and pass ports remain private and refuse model, adapter and continuation overrides',async()=>{
 for(const route of ['computer-preparation/setup','computer-preparation/prepare','computer-preparation/confirm','computer-preparation/cancel','computer-pass']){
  for(const headers of [{'X-DreamGraph-Session':workerBearer},{'X-DreamGraph-Session':original.bearer,Origin:base},{'X-DreamGraph-Session':original.bearer,Cookie:'untrusted=1'},{'X-DreamGraph-Session':original.bearer,'Sec-Fetch-Site':'same-origin'}]){
   const reply=await fetch(base+'/api/executions/v1/'+route,{method:route.endsWith('/setup')?'GET':'POST',headers:{...headers,'Content-Type':'application/json'},body:route.endsWith('/setup')?undefined:'{}'});expect(reply.status).toBe(403);
  }
 }
 const headers={'X-DreamGraph-Session':original.bearer,'Content-Type':'application/json'};
 for(const override of [{model:'other'},{adapter:'codex-cli'},{model_role:'architect'},{continuation_token:'untrusted'}]){
  const response=await fetch(base+'/api/executions/v1/computer-preparation/prepare',{method:'POST',headers,body:JSON.stringify({interact:false,duration_ms:1000,...override})});expect(response.status).toBe(400);
 }
 expect((await authority.sessions.ownGrants(original.context)).length).toBe(0);
});
