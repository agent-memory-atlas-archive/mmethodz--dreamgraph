/** Compiled editor state/DOM with declared ports. Root tests separately run the real daemon/browser/source/graph loop. */
import test from 'node:test';import assert from 'node:assert/strict';
const {JSDOM}=require('jsdom');
import {ComputerPassController,type ComputerPassPort,type ComputerPassView} from '../computer-pass.js';
import {computerPassMarkup,installComputerPass} from '../webview/computer-pass.js';
import type {NativeComputerPreparation,NativeComputerSetup,NativeComputerPassReply} from '../generated/computer-pass.js';
import type {ManagedExecutionSnapshot} from '../generated/graph-contracts.js';
const id='93110f83-ab61-4e1e-a77c-50e0c0b92d2a',executionId='execution:'+id;
const scope=()=>({instance_id:'instance',worker:'isolated_playwright',host:'declared',target_profile:'declared',origin:'https://fixture.example',path_prefix:'/',network:[],blocked_origins:[],visual:{enabled:false,region:null,mask_selectors:[]},redaction_rules:0,
 model:{role:'computer_use',provider:'openai',model:'declared',api:'responses',retention:{requested:'store_false',effective:'store_false',source:'explicit'},budget:{},policy_hash:'declared'},retention:'none',
 limits:{max_actions:1,max_images:0,max_image_bytes:0,expires_at:new Date(Date.now()+60000).toISOString()},postconditions:[],capability:{route:'dreamgraph_harness'}});
const preparation=()=>({...scope(),id,execution_id:executionId,target_id:'target',interact:false}) as unknown as NativeComputerPreparation;
const execution=(status='graph_committed',active=false)=>({schema:'dreamgraph.managed_execution.v1',execution_id:executionId,instance_id:'instance',status,record_revision:2,authority_active:active,
 graph_receipt_ids:[],state_receipt_ids:[],obligation_ids:[],delivery_attests:'host_transport_only'}) as unknown as ManagedExecutionSnapshot;
const reply=()=>({ok:true,schema:'dreamgraph.native_computer_pass.v1',execution_id:executionId,content:'Declared response',provider:'openai',model:'declared',execution:execution()}) as NativeComputerPassReply;
const request=()=>({computer_preparation_id:id,message:'Observe the named target',autonomy_mode:'supervised' as const,verbosity_mode:'concise' as const});
function harness(){let latest:ComputerPassView={status:'idle',dispatched:false,busy:false};const calls:string[]=[];
 const port={baseUrl:'http://fixture:1',async readComputerPassSetup(){calls.push('setup');return {...scope(),ok:true,available:true};},
  async prepareComputerPass(){calls.push('prepare');return preparation();},async confirmComputerPass(){calls.push('confirm');return {id,execution_id:executionId,grant_id:'grant',expires_at:new Date(Date.now()+60000).toISOString()};},
  async cancelComputerPass(){calls.push('cancel');return {id,execution_id:executionId,status:'cancelled',grant_revoked:true};},
  async runComputerPass(){calls.push('run');return reply();},async readExecution(){calls.push('read');return execution();},async readComputerStatus(){throw new Error('COMPUTER_SESSION_UNKNOWN');},
  async controlComputer(execution:string,computer:string,action:string){calls.push(action+':'+execution+':'+computer);return {session:{id,execution_id:executionId,instance_id:'instance',state:'stopped'}};}
 } as unknown as ComputerPassPort;
 const controller=new ComputerPassController(view=>latest=view,{},1);return {port,controller,calls,get latest(){return latest;}};
}
async function confirmed(h:ReturnType<typeof harness>){await h.controller.setup(h.port,'instance');await h.controller.prepare(h.port,'instance',{interact:false,duration_ms:30000});await h.controller.confirm(h.port,'instance',id);}
test('the explicit companion route stays quiet, reviews the named role and requires preparation/confirmation/start in order',async()=>{
 const h=harness();assert.deepEqual(h.calls,[]);await assert.rejects(h.controller.start(h.port,'instance',request()),/OWNER_CHANGED/);
 await confirmed(h);assert.deepEqual(h.calls,['setup','prepare','confirm']);assert.equal(h.latest.preparation?.model.role,'computer_use');assert.equal(h.controller.blocksContinuation,true);
 const result=await h.controller.start(h.port,'instance',request());assert.equal(result.execution_id,executionId);assert.equal(h.latest.status,'settled');assert.equal(h.controller.blocksContinuation,false);
 await assert.rejects(h.controller.start(h.port,'instance',request()),/ORIGINAL_CONFIRMATION/);assert.equal(h.calls.filter(call=>call==='run').length,1);h.controller.dispose();
});
test('an uncertain confirmation permits only the exact retry or cancellation, never a new preparation',async()=>{
 const h=harness();await h.controller.setup(h.port,'instance');await h.controller.prepare(h.port,'instance',{interact:false,duration_ms:30000});
 h.port.confirmComputerPass=async()=>{h.calls.push('confirm');throw new Error('declared lost reply');};await assert.rejects(h.controller.confirm(h.port,'instance',id),/lost reply/);
 assert.equal(h.latest.status,'unconfirmed');await assert.rejects(h.controller.prepare(h.port,'instance',{interact:true,duration_ms:30000}),/SCOPE_REVIEW/);
 await assert.rejects(h.controller.confirm(h.port,'instance','other'),/EXACT_CONFIRMATION/);await h.controller.cancel(h.port,'instance',id);assert.equal(h.latest.status,'settled');assert.equal(h.calls.includes('run'),false);h.controller.dispose();
});
test('cancellation bypasses a pending confirmation and a late reply cannot restore the revoked scope',async()=>{
 const h=harness();await h.controller.setup(h.port,'instance');await h.controller.prepare(h.port,'instance',{interact:false,duration_ms:30000});
 let release!:(value:Awaited<ReturnType<ComputerPassPort['confirmComputerPass']>>)=>void;h.port.confirmComputerPass=async()=>new Promise(done=>release=done);
 const confirmation=h.controller.confirm(h.port,'instance',id).catch(()=>undefined);await h.controller.cancel(h.port,'instance',id);
 release({id,execution_id:executionId,grant_id:'late',expires_at:new Date(Date.now()+60000).toISOString()});await confirmation;
 assert.equal(h.latest.status,'settled');assert.equal(h.latest.confirmation,undefined);await assert.rejects(h.controller.start(h.port,'instance',request()),/ORIGINAL_CONFIRMATION/);h.controller.dispose();
});
test('another endpoint/instance and a foreign preparation cannot obtain a confirmation',async()=>{
 const h=harness();await h.controller.setup(h.port,'instance');h.port.prepareComputerPass=async()=>({...preparation(),instance_id:'other'});
 await assert.rejects(h.controller.prepare(h.port,'instance',{interact:false,duration_ms:30000}),/INSTANCE_MISMATCH/);assert.equal(h.latest.preparation,undefined);
 await assert.rejects(h.controller.prepare({...h.port,baseUrl:'http://fixture:2'},'instance',{interact:false,duration_ms:30000}),/OWNER_CHANGED/);assert.equal(h.calls.includes('confirm'),false);h.controller.dispose();
});
test('Stop cancels the RPC wait independently and targets only the original worker; acknowledgement is not execution closure',async()=>{
 const h=harness();await confirmed(h);let started!:()=>void;const dispatched=new Promise<void>(done=>started=done);
 h.port.runComputerPass=async(_,execution,signal)=>new Promise((resolve,reject)=>{h.calls.push('run');started();signal!.addEventListener('abort',()=>reject(signal!.reason),{once:true});});
 const running=h.controller.start(h.port,'instance',request()).catch(error=>error);await dispatched;await h.controller.stop();assert.match(String(await running),/OPERATOR_STOP/);
 assert(h.calls.includes('stop:'+executionId+':'+id));assert.equal(h.latest.status,'unconfirmed');assert.equal(h.controller.blocksContinuation,true);
 await h.controller.inspect(h.port,'instance');assert.equal(h.latest.status,'settled');assert.equal(h.calls.filter(call=>call==='run').length,1);h.controller.dispose();
});
test('lost pass reply and source reconciliation debt retain the original ID and prohibit automatic retry',async()=>{
 const h=harness();await confirmed(h);h.port.runComputerPass=async()=>{h.calls.push('run');throw new Error('declared lost pass reply');};
 await assert.rejects(h.controller.start(h.port,'instance',request()),/lost pass reply/);assert.equal(h.latest.dispatched,true);await assert.rejects(h.controller.start(h.port,'instance',request()),/ORIGINAL_CONFIRMATION/);
 h.port.readExecution=async()=>execution('reconciliation_pending');await h.controller.inspect(h.port,'instance');assert.equal(h.latest.status,'unconfirmed');assert.equal(h.controller.blocksContinuation,true);
 assert.equal(h.calls.filter(call=>call==='run').length,1);h.controller.dispose();
});
test('an endpoint change during a pass aborts its wait and retains original recovery rather than retargeting Stop',async()=>{
 const h=harness();await confirmed(h);let started!:()=>void;const dispatched=new Promise<void>(done=>started=done);
 h.port.runComputerPass=async(_,execution,signal)=>new Promise((resolve,reject)=>{started();signal!.addEventListener('abort',()=>reject(signal!.reason),{once:true});});
 const running=h.controller.start(h.port,'instance',request()).catch(error=>error);await dispatched;(h.port as {baseUrl:string}).baseUrl='http://fixture:2';h.controller.ownerChanged();await running;
 await assert.rejects(h.controller.stop(),/OWNER_CHANGED/);assert.equal(h.calls.some(call=>call.startsWith('stop:')),false);assert.equal(h.latest.endpoint,'http://fixture:1');h.controller.dispose();
});
test('expired permission or model/adapter overrides cannot dispatch a pass',async()=>{
 const h=harness();await confirmed(h);await assert.rejects(h.controller.start(h.port,'instance',{...request(),model:'unreviewed'} as never),/unrecognized_keys|Unrecognized key/);
 h.port.confirmComputerPass=async()=>({id,execution_id:executionId,grant_id:'grant',expires_at:new Date(Date.now()-1000).toISOString()});
 const other=harness();other.port.confirmComputerPass=h.port.confirmComputerPass;await confirmed(other);await assert.rejects(other.controller.start(other.port,'instance',request()),/ORIGINAL_CONFIRMATION/);
 assert.equal(h.calls.includes('run'),false);h.controller.dispose();other.controller.dispose();
});
test('compiled compact pass UI is explicit, literal, quiet and leaves Stop enabled during outstanding reads',()=>{
 const dom=new JSDOM(computerPassMarkup),sent:unknown[]=[];installComputerPass(dom.window.document,dom.window as unknown as Window,value=>sent.push(value));assert.deepEqual(sent,[]);
 const button=(suffix:string)=>dom.window.document.getElementById('computer-pass-'+suffix) as HTMLButtonElement;
 button('setup').click();assert.deepEqual(sent.at(-1),{type:'computerPassSetup'});
 const prepared={...preparation(),host:'<img src=x onerror=alert(1)>'};dom.window.dispatchEvent(new dom.window.MessageEvent('message',{data:{type:'computerPassView',view:{status:'running',busy:true,dispatched:true,preparation:prepared}}}));
 assert.equal(button('stop').disabled,false);button('stop').click();assert.deepEqual(sent.at(-1),{type:'computerPassStop'});assert.equal(button('setup').disabled,true);
 assert.equal(dom.window.document.querySelector('img'),null);assert.match(dom.window.document.getElementById('computer-pass-scope')!.textContent!,/<img/);dom.window.close();
});
test('review polling waits for delivered C05 context and attaches only this preparation’s original C17 session',async()=>{
 const h=harness();let finish!:(value:NativeComputerPassReply)=>void,seen!:()=>void,reads=0,opened=0;
 const attached=new Promise<void>(done=>seen=done);h.port.runComputerPass=async()=>new Promise(done=>finish=done);
 h.port.readExecution=async()=>({...execution(reads++===0?'assembled':'running',true),pack:{receipt:{delivery:reads===1?'unattested':'delivered'}}}) as unknown as ManagedExecutionSnapshot;
 h.port.readComputerStatus=async()=>({session:{id,execution_id:executionId,instance_id:'instance'}}) as any;
 const tracked=new ComputerPassController(()=>{}, {authority:async value=>{assert.equal(value.status,'running');assert.equal(value.pack.receipt.delivery,'delivered');opened++;},
  session:(_,instance,execution,computer)=>{assert.equal(instance,'instance');assert.equal(execution,executionId);assert.equal(computer,id);seen();}},1);
 await tracked.setup(h.port,'instance');await tracked.prepare(h.port,'instance',{interact:false,duration_ms:30000});await tracked.confirm(h.port,'instance',id);
 const running=tracked.start(h.port,'instance',request());await attached;finish(reply());await running;assert.equal(opened,1);assert(reads>=2);tracked.dispose();h.controller.dispose();
});
test('an uncertain cancellation retains only cancellation retry, and an unclaimed lost start can be cancelled without replay',async()=>{
 const h=harness();await confirmed(h);h.port.cancelComputerPass=async()=>{throw new Error('lost cancellation');};await assert.rejects(h.controller.cancel(h.port,'instance',id),/lost cancellation/);
 await assert.rejects(h.controller.confirm(h.port,'instance',id),/EXACT_CONFIRMATION/);await assert.rejects(h.controller.start(h.port,'instance',request()),/ORIGINAL_CONFIRMATION/);h.controller.dispose();
 const other=harness();await confirmed(other);other.port.runComputerPass=async()=>{throw new Error('request never admitted');};await assert.rejects(other.controller.start(other.port,'instance',request()),/never admitted/);
 await other.controller.cancel(other.port,'instance',id);assert.equal(other.latest.status,'settled');assert.equal(other.calls.includes('cancel'),true);other.controller.dispose();
});
