/** Inherited private IPC only. Stop/heartbeat messages never queue behind browser operations. */
import {createHash} from "node:crypto";
import {performance} from "node:perf_hooks";
import {z} from "zod";
import {ComputerActionSchema,ComputerTargetSchema} from "../graph/contracts.js";
import {BrowserWorkerProfileSchema} from "./browser-profile.js";
import {BrowserComputerDriver} from "./browser-driver.js";
import {ownWindowsBrowserProcess} from './browser-process-owner.js';
const RequestSchema=z.object({protocol:z.literal("dreamgraph.computer_worker.v1"),nonce:z.string().regex(/^[a-f0-9]{64}$/),
  seq:z.number().int().min(1),id:z.string().min(1).max(128),operation:z.enum(["bootstrap","heartbeat","open","observe","act","pause","resume","stop"]),payload:z.unknown()}).strict();
let nonce:string|undefined,epoch:string|undefined,driver:BrowserComputerDriver|undefined,seq=0,busy=false,lastHeartbeat=performance.now(),stopping=false,localStopping=false;
const seen=new Set<string>(),controller=new AbortController();
const reply=(id:string,body:unknown,error?:string)=>{if(process.connected)process.send?.({protocol:"dreamgraph.computer_worker.v1",nonce,id,epoch,body,error});};
let stopWork:ReturnType<BrowserComputerDriver['stop']>|undefined;
let processOwner:ReturnType<typeof ownWindowsBrowserProcess>;
async function stop(){
  stopping=true;controller.abort(new Error("COMPUTER_WORKER_STOP"));
  if(!driver)return {epoch,input_released:true,terminated:true};
  if(!stopWork){
    const released=driver.releaseInput().then(proof=>{reply('input-released',proof);return proof;});
    // This private process owns one browser and never loads user callbacks.
    // Escalate only the originally launched browser tree. Windows uses the
    // captured child and asynchronous taskkill; other platforms retain the
    // pinned runtime's SIGTERM handler. Never search for PIDs or terminate the
    // worker before it can attest browser closure. Repetition also covers launch.
    const escalate=()=>{if(processOwner)processOwner.force();else process.emit('SIGTERM','SIGTERM');};
    // Release the actual input target within one second. Process-tree closure
    // has a separate five-second ceiling; a release receipt is not Stop complete.
    const first=setTimeout(escalate,50),second=setTimeout(escalate,100);
    // A failed release must not cancel physical containment or its escalation.
    void released.catch(()=>undefined);
    stopWork=driver.stop().then(async proof=>{
      await processOwner?.closed();return proof;
    }).finally(()=>{clearTimeout(first);clearTimeout(second);});
  }
  return stopWork;
}
async function localStop(reason:"disconnect"|"watchdog"){
  if(localStopping)return;localStopping=true;
  const started=performance.now(),heartbeat_age_ms=started-lastHeartbeat;
  try{
    const proof=await stop();
    if(process.connected)process.send?.({protocol:"dreamgraph.computer_worker.v1",nonce,epoch,id:"local-stop",body:{...proof,reason,heartbeat_age_ms,stop_elapsed_ms:performance.now()-started}},()=>process.exit(0));
    else process.exit(0);
  }catch{process.exit(1);}
}
process.on("disconnect",()=>{void localStop("disconnect");});
// Reserve time for an already in-flight heartbeat and the independent one-second
// browser release budget within the five-second control-loss ceiling.
// An explicit Stop already fenced input and began physical containment. Retain
// its authenticated peer for lost-receipt recovery while IPC is connected;
// disconnect still runs local containment. Do not race it with watchdog exit.
const watchdog=setInterval(()=>{if(!stopping&&!localStopping&&performance.now()-lastHeartbeat>2500)void localStop("watchdog");},100);watchdog.unref();
process.on("message",raw=>{void(async()=>{
  let id="invalid";
  try{
    if(Buffer.byteLength(JSON.stringify(raw))>1024*1024)throw new Error("COMPUTER_WORKER_MESSAGE_CAPACITY");
    const request=RequestSchema.parse(raw);id=request.id;
    if(request.operation==="bootstrap"){
      if(nonce)throw new Error("COMPUTER_WORKER_ALREADY_PAIRED");
      const payload=z.object({epoch:z.string().min(1).max(256),profile:BrowserWorkerProfileSchema}).strict().parse(request.payload);
      nonce=request.nonce;epoch=payload.epoch;processOwner=ownWindowsBrowserProcess(payload.profile.browser_executable);driver=new BrowserComputerDriver(payload.profile,epoch);
    }else if(!nonce||nonce!==request.nonce)throw new Error("COMPUTER_WORKER_PAIRING_REJECTED");
    if(request.seq<=seq||seen.has(id))throw new Error("COMPUTER_WORKER_REPLAY_REJECTED");seq=request.seq;
    if(request.operation==="heartbeat"){lastHeartbeat=performance.now();reply(id,{acknowledged:true});return;}
    if(seen.size>=256)throw new Error("COMPUTER_WORKER_RECEIPT_CAPACITY");seen.add(id);
    if(request.operation==="stop"){reply(id,await stop());return;}
    if(stopping)throw new Error("COMPUTER_WORKER_STOPPED");
    if(busy)throw new Error("COMPUTER_WORKER_ALREADY_INFLIGHT");busy=true;
    try{
      switch(request.operation){case "bootstrap":reply(id,{paired:true,epoch,nonce_hash:createHash("sha256").update(nonce!).digest("hex")});break;
        case "open":await driver!.open(ComputerTargetSchema.parse(request.payload),controller.signal);reply(id,{opened:true});break;
        case "observe":ComputerTargetSchema.parse(request.payload);reply(id,await driver!.observe(controller.signal));break;
        case "act":reply(id,await driver!.act(ComputerActionSchema.parse(request.payload),controller.signal));break;
        case "pause":reply(id,await driver!.pause());break;
        case "resume":reply(id,await driver!.resume(ComputerTargetSchema.parse(request.payload),controller.signal));break;}
    }finally{busy=false;}
  }catch(error){const code=error instanceof Error&&/^COMPUTER_[A-Z0-9_]{1,120}$/.test(error.message)?error.message:"COMPUTER_WORKER_OPERATION_FAILED";reply(id,null,code);}
})();});
