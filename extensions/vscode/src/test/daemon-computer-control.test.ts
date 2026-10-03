/** Compiled editor transport with declared HTTP descriptors; not worker/OS qualification. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {DaemonClient} from '../daemon-client.js';
const snapshot=()=>{const now=new Date().toISOString();return {
 session:{schema:'dreamgraph.computer_session.v1',id:'computer',instance_id:'instance',session_id:'owner',execution_id:'execution',job_id:'job',owner:'principal',host_id:'host',
  target_ids:['target'],grant_id:'grant',capability_id:'capability',fence:1,policy_revision:'policy',state:'ready',created_at:now,updated_at:now,terminal_reason:null},
 targets:[{schema:'dreamgraph.computer_target.v1',id:'target',instance_id:'instance',session_id:'owner',host_id:'host',surface:'browser',generation:1,origin:'https://fixture.example',application:null}],
 capability:{schema:'dreamgraph.computer_capability.v1',id:'capability',adapter:'declared',adapter_version:'1',backend_version:'declared-http',route:'dreamgraph_harness',
  requested:['observe'],supported:['observe'],permitted:['observe'],effective:['observe'],evidence_granularity:'action',independent_stop:true,reasons:[],qualified_at:now},
 worker_available:true,pause_supported:true,limits:{max_actions:2,max_images:0,max_image_bytes:0,observation_bytes:1000,expires_at:new Date(Date.now()+30000).toISOString()},
 usage:{actions:0,images:0,image_bytes:0,observation_bytes:0},last_receipt:null};};
const page=()=>({ok:true,sessions:[snapshot()],total:1,next_cursor:null,snapshot_hash:'sha256:'+'a'.repeat(64),history_scope:'active_execution_store'});
async function fixture(context:{after:(fn:()=>Promise<void>)=>void},handle?:(req:IncomingMessage,res:ServerResponse)=>void){
 const requests:Array<{url:string;headers:IncomingMessage['headers'];body:string}>=[];
 const server=createServer(async(req,res)=>{const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
  requests.push({url:req.url!,headers:req.headers,body:Buffer.concat(chunks).toString('utf8')});
  if(req.url==='/api/authority/v1/status'){res.setHeader('X-DreamGraph-Session','declared-original-owner');res.end('{}');return;}
  if(handle){handle(req,res);return;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url?.includes('/sessions?')?page():{ok:true,...snapshot()}));});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const port=(server.address() as {port:number}).port,client=new DaemonClient({host:'127.0.0.1',port,timeoutMs:3000});
 context.after(async()=>{client.dispose();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});return {client,port,requests};
}
test('compiled native inspection and controls keep the private original owner without browser metadata',async t=>{const h=await fixture(t);await h.client.listComputerSessions();
 await h.client.readComputerStatus('execution','computer');await h.client.controlComputer('execution','computer','pause',1);
 assert.equal(h.requests.filter(row=>row.url==='/api/authority/v1/status').length,1);
 const controls=h.requests.filter(row=>row.url.startsWith('/api/executions/v1/computer/'));assert.equal(controls.length,3);
 for(const row of controls){assert.equal(row.headers['x-dreamgraph-session'],'declared-original-owner');assert.equal(row.headers.origin,undefined);assert.equal(row.headers.cookie,undefined);assert.equal(row.headers['sec-fetch-site'],undefined);}
 assert.deepEqual(JSON.parse(controls[2].body),{execution_id:'execution',id:'computer',fence:1});
});
test('endpoint switch during asynchronous schema loading refuses before a new authority request',async t=>{const original=await fixture(t),next=await fixture(t);await original.client.listComputerSessions();const count=original.requests.length;
 const stopped=original.client.controlComputer('execution','computer','stop');original.client.updateEndpoint('127.0.0.1',next.port);
 await assert.rejects(stopped,/DAEMON_ENDPOINT_CHANGED/);assert.equal(original.requests.length,count);assert.equal(next.requests.length,0);
});
test('Stop does not wait for an inspection body, and cancellation preserves an unknown read',async t=>{let ready!:()=>void;const headersReady=new Promise<void>(resolve=>ready=resolve);
 const h=await fixture(t,(req,res)=>{if(req.url?.includes('/status?')){res.writeHead(200,{'Content-Type':'application/json'});res.write('{');ready();return;}
  const value=snapshot();value.session.state='stopped';res.end(JSON.stringify({ok:true,...value}));});
 const controller=new AbortController(),read=h.client.readComputerStatus('execution','computer',controller.signal).then(()=>null,error=>error);
 await headersReady;const stopped=await h.client.controlComputer('execution','computer','stop');assert.equal(stopped.session.state,'stopped');controller.abort(new Error('declared read cancellation'));
 assert.match(String(await read),/declared read cancellation/);assert.equal(h.requests.filter(row=>row.url.endsWith('/stop')).length,1);
});
test('oversize operator responses refuse during bounded body consumption',async t=>{const h=await fixture(t,(_,res)=>{res.end(' '.repeat(256*1024+1));});
 await assert.rejects(h.client.listComputerSessions(),/DAEMON_RESPONSE_BYTE_LIMIT/);
});
test('wrong original execution identity cannot become an acknowledged control',async t=>{const h=await fixture(t,(_,res)=>{const value=snapshot();value.session.execution_id='foreign';res.end(JSON.stringify({ok:true,...value}));});
 await assert.rejects(h.client.controlComputer('execution','computer','stop'),/COMPUTER_CONTROL_REPLY_OWNER_MISMATCH/);
});
const evidence=()=>{const now=new Date().toISOString(),literal=Buffer.from('declared image bytes'),hash='sha256:'+createHash('sha256').update(literal).digest('hex');
 const observation={schema:'dreamgraph.computer_observation.v1',id:'dom',target_id:'target',target_generation:1,execution_id:'execution',kind:'dom',observed_at:now,expires_at:new Date(Date.now()+20000).toISOString(),artifact_ref:null,content_hash:hash,evidence_ids:[],verified:false};
 return {ok:true,schema:'dreamgraph.computer_evidence.v1',instance_id:'instance',execution_id:'execution',computer_session_id:'computer',fence:1,worker_available:true,
  observation:{observation,summary:'Literal untrusted evidence',expired:false,image_observation:{...observation,id:'pixels',kind:'pixels',evidence_ids:['dom']},image:{mime_type:'image/png',content_hash:hash,data_base64:literal.toString('base64')}}};};
test('compiled explicit evidence read verifies original linked image bytes and sends no browser metadata or write',async t=>{
 const h=await fixture(t,(_,res)=>res.end(JSON.stringify(evidence())));const result=await h.client.readComputerEvidence('execution','computer');assert(result.observation?.image);
 const request=h.requests.find(row=>row.url.startsWith('/api/executions/v1/computer-evidence/'))!;assert.equal(request.body,'');assert.equal(request.headers['x-dreamgraph-session'],'declared-original-owner');assert.equal(request.headers.origin,undefined);
});
test('compiled evidence refuses altered pixels and an endpoint switch before authority/schema loading',async t=>{
 const h=await fixture(t,(_,res)=>{const value=evidence();value.observation.image.data_base64=Buffer.from('altered').toString('base64');res.end(JSON.stringify(value));});await assert.rejects(h.client.readComputerEvidence('execution','computer'),/HASH_MISMATCH/);
 const next=await fixture(t),count=h.requests.length,read=h.client.readComputerEvidence('execution','computer');h.client.updateEndpoint('127.0.0.1',next.port);
 await assert.rejects(read,/DAEMON_ENDPOINT_CHANGED/);assert.equal(h.requests.length,count);assert.equal(next.requests.length,0);
});
test('Stop remains independent of a pending bounded evidence response and unknown read',async t=>{let ready!:()=>void;const pending=new Promise<void>(done=>ready=done);
 const h=await fixture(t,(req,res)=>{if(req.url?.includes('/computer-evidence/')){res.writeHead(200);res.write('{');ready();return;}const value=snapshot();value.session.state='stopped';res.end(JSON.stringify({ok:true,...value}));});
 const controller=new AbortController(),read=h.client.readComputerEvidence('execution','computer',controller.signal).then(()=>null,error=>error);await pending;
 assert.equal((await h.client.controlComputer('execution','computer','stop')).session.state,'stopped');controller.abort(new Error('declared evidence cancellation'));assert.match(String(await read),/evidence cancellation/);
});
const nativeId='93110f83-ab61-4e1e-a77c-50e0c0b92d2a';
const nativeScope=()=>({instance_id:'instance',worker:'isolated_playwright',host:'host',target_profile:'declared',origin:'https://fixture.example',path_prefix:'/',
 network:[{origin:'https://fixture.example',path_prefix:'/',methods:['GET'],allow_query:false}],blocked_origins:[],visual:{enabled:false,region:null,mask_selectors:[]},redaction_rules:0,
 model:{role:'computer_use',provider:'openai',model:'declared',api:'responses',retention:{requested:'store_false',effective:'store_false',source:'explicit'},policy_hash:'declared',
 budget:{requests:1,input_tokens:1000,output_tokens:500,reasoning_tokens:0,retries:0,elapsed_ms:30000,concurrency:1,max_hops:1,max_neighbors:10,run_amount:0,day_amount:0,currency:'USD',pricing_version:'offline',billing_principal:'declared'}},
 retention:'none',limits:{max_actions:1,max_images:0,max_image_bytes:0,expires_at:new Date(Date.now()+30000).toISOString()},postconditions:[],capability:snapshot().capability});
test('compiled setup/preparation/confirmation/cancellation preserve C07 retention and private original ownership',async t=>{
 const h=await fixture(t,(req,res)=>{const value=req.url?.endsWith('/setup')?{ok:true,available:true,...nativeScope()}:
  {ok:true,result:req.url?.endsWith('/prepare')?{...nativeScope(),id:nativeId,execution_id:'execution',target_id:'target',interact:false}:
   req.url?.endsWith('/confirm')?{id:nativeId,execution_id:'execution',grant_id:'grant',expires_at:new Date(Date.now()+30000).toISOString()}:{id:nativeId,execution_id:'execution',status:'cancelled',grant_revoked:true}};
  res.end(JSON.stringify(value));});
 const setup=await h.client.readComputerPassSetup();assert('model' in setup);assert.deepEqual(setup.model.retention,{requested:'store_false',effective:'store_false',source:'explicit'});
 const prepared=await h.client.prepareComputerPass({interact:false,duration_ms:30000});assert.equal(prepared.model.role,'computer_use');
 await h.client.confirmComputerPass(nativeId);assert.equal((await h.client.cancelComputerPass(nativeId)).status,'cancelled');
 for(const request of h.requests.filter(row=>row.url.startsWith('/api/executions/v1/computer-preparation/'))){assert.equal(request.headers['x-dreamgraph-session'],'declared-original-owner');assert.equal(request.headers.origin,undefined);assert.equal(request.headers.cookie,undefined);}
 assert.deepEqual(JSON.parse(h.requests.find(row=>row.url.endsWith('/prepare'))!.body),{interact:false,duration_ms:30000});
 assert.deepEqual(JSON.parse(h.requests.find(row=>row.url.endsWith('/cancel'))!.body),{id:nativeId});
});
test('compiled pass refuses model/adapter overrides and a changed endpoint before any new dispatch',async t=>{
 const h=await fixture(t),next=await fixture(t),request={computer_preparation_id:nativeId,message:'Inspect',autonomy_mode:'supervised' as const,verbosity_mode:'concise' as const};
 await assert.rejects(h.client.runComputerPass({...request,adapter:'codex-cli'} as never,'execution'),/Unrecognized key/);assert.equal(h.requests.length,0);
 const pending=h.client.prepareComputerPass({interact:false,duration_ms:30000});h.client.updateEndpoint('127.0.0.1',next.port);
 await assert.rejects(pending,/DAEMON_ENDPOINT_CHANGED/);assert.equal(h.requests.length,0);assert.equal(next.requests.length,0);
});
test('compiled preparation reads share the bounded image-free operator response ceiling',async t=>{
 const h=await fixture(t,(_,res)=>res.end(' '.repeat(256*1024+1)));await assert.rejects(h.client.readComputerPassSetup(),/DAEMON_RESPONSE_BYTE_LIMIT/);
});
test('compiled Stop stays independent of a pending pass reply and the aborted wait does not claim model/worker termination',async t=>{
 let ready!:()=>void;const arrived=new Promise<void>(done=>ready=done);const h=await fixture(t,(req,res)=>{
  if(req.url==='/api/executions/v1/computer-pass'){res.writeHead(200,{'Content-Type':'application/json'});res.write('{');ready();return;}
  const value=snapshot();value.session.state='stopped';res.end(JSON.stringify({ok:true,...value}));});
 const controller=new AbortController(),running=h.client.runComputerPass({computer_preparation_id:nativeId,message:'Inspect',autonomy_mode:'supervised',verbosity_mode:'concise'},'execution',controller.signal).catch(error=>error);
 await arrived;assert.equal((await h.client.controlComputer('execution','computer','stop')).session.state,'stopped');controller.abort(new Error('declared original RPC wait stop'));
 assert.match(String(await running),/RPC wait stop/);assert.equal(h.requests.filter(row=>row.url==='/api/executions/v1/computer-pass').length,1);
});
