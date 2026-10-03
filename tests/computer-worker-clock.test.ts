/** Original private IPC watchdog; no browser/model/input and no physical runtime qualification claim. */
import {it,expect} from 'vitest';
import {fork} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {once} from 'node:events';
it.each([0,4102444800000])('the real IPC worker detects control loss even with wall time frozen at %s',async wall=>{
 const child=fork(fileURLToPath(new URL('./helpers/computer-frozen-clock-worker.mjs',import.meta.url)),
  [fileURLToPath(new URL('../src/computer/browser-worker-entry.ts',import.meta.url)),String(wall)],
  {execArgv:['--import',pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href],windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});
 const nonce=randomBytes(32).toString('hex'),epoch='declared-clock-epoch';let sequence=0;const replies=new Map<string,(value:any)=>void>();
 let resolveLoss!:(value:any)=>void;const loss=new Promise<any>(done=>resolveLoss=done),exited=once(child,'exit');
 child.on('message',(raw:any)=>{if(raw.nonce!==nonce||raw.epoch!==epoch)return;if(raw.id==='local-stop')resolveLoss(raw.body);else replies.get(raw.id)?.(raw.body);});
 const call=(operation:string,payload:unknown)=>new Promise<any>((resolve,reject)=>{const id='clock:'+ ++sequence,timer=setTimeout(()=>reject(new Error('CLOCK_FIXTURE_REPLY_TIMEOUT')),15000);
  replies.set(id,value=>{clearTimeout(timer);replies.delete(id);resolve(value);});child.send({protocol:'dreamgraph.computer_worker.v1',nonce,seq:sequence,id,operation,payload});});
 let heartbeat:NodeJS.Timeout|undefined;
 try{
  await call('bootstrap',{epoch,profile:{schema:'dreamgraph.browser_worker_profile.v1',id:'clock-fixture',browser_executable:process.execPath,browser_version:'0.0.0.0',runtime_version:'1.62.1',
   initial_url:'http://127.0.0.1:1/fixture',main_origin:'http://127.0.0.1:1',main_path_prefix:'/fixture',network:[{origin:'http://127.0.0.1:1',path_prefix:'/fixture',methods:['GET'],allow_query:false}],blocked_origins:[],
   elements:[{id:'fixture',selector:'main',read_text:false,read_value:false,operations:[]}],postconditions:[{id:'fixture',kind:'visible',selector:'main'}],observation_bytes:1024,action_timeout_ms:1000,max_actions:1,expires_at:'2099-01-01T00:00:00Z',
   images:{enabled:false,region:null,mask_selectors:[],max_bytes:0,max_count:0,total_bytes:0},redactions:[]}});
  heartbeat=setInterval(()=>{void call('heartbeat',null).catch(()=>undefined);},500);
  await new Promise(done=>setTimeout(done,2800));expect(child.exitCode).toBeNull();clearInterval(heartbeat);heartbeat=undefined;
  const start=performance.now();const proof=await Promise.race([loss,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('CONTROL_LOSS_NOT_CONFIRMED')),5000);timer.unref();})]);
  expect(performance.now()-start).toBeLessThan(5000);expect(proof).toMatchObject({reason:'watchdog',input_released:true,terminated:true});
  expect(proof.heartbeat_age_ms).toBeGreaterThanOrEqual(2500);expect(proof.heartbeat_age_ms).toBeLessThan(5000);await exited;
 }finally{if(heartbeat)clearInterval(heartbeat);if(child.exitCode===null){child.kill();await exited;}}
},25000);
