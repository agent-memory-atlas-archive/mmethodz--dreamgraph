/** Optional pinned portable worker, private child peer and ephemeral profile. No local socket or public worker API. */
import {fork,type ChildProcess,type ForkOptions} from "node:child_process";
import {createHash,randomBytes,randomUUID} from "node:crypto";
import {mkdtemp,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve,sep} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {createRequire} from "node:module";
import {once} from "node:events";
import {z} from "zod";
import {ComputerTargetSchema} from "../graph/contracts.js";
import {BrowserWorkerProfileSchema,type BrowserWorkerProfile} from "./browser-profile.js";
import {ComputerQualificationSchema,type ComputerQualification,type ComputerWorkerProbe} from "./capabilities.js";
import {computerDigest} from "./digest.js";
import type {ComputerAction,ComputerTarget,ComputerWorkerObservation,ComputerWorkerPort} from "./worker-port.js";
const ObservationSchema=z.object({epoch:z.string(),target:ComputerTargetSchema,kind:z.enum(["dom","accessibility","pixels","api_state"]),summary:z.string().max(65536),
  content_hash:z.string().regex(/^sha256:[a-f0-9]{64}$/),captured_at:z.string().datetime({offset:true}),
  image:z.object({mime_type:z.enum(["image/png","image/jpeg"]),bytes:z.instanceof(Uint8Array),content_hash:z.string().regex(/^sha256:[a-f0-9]{64}$/)}).strict().optional()}).strict();
const LocalStopSchema=z.object({epoch:z.string(),input_released:z.literal(true),terminated:z.literal(true),reason:z.enum(["disconnect","watchdog"]),
  heartbeat_age_ms:z.number().finite().min(0),stop_elapsed_ms:z.number().finite().min(0)}).strict();
export async function browserWorkerSourceHash(){
  const extension=import.meta.url.endsWith(".ts")?"ts":"js",names=["browser-harness","browser-driver","browser-profile","browser-worker-entry","browser-process-owner","capabilities","digest"];
  const hash=createHash("sha256");for(const name of names){hash.update(name);const body=await readFile(new URL(`./${name}.${extension}`,import.meta.url));if(body.length>512*1024)throw new Error("COMPUTER_WORKER_SOURCE_CAPACITY");hash.update(body);}
  hash.update(await readFile(new URL(`../graph/contracts.${extension}`,import.meta.url)));return "sha256:"+hash.digest("hex");
}
export class BrowserHarnessWorker implements ComputerWorkerPort {
  readonly probe:ComputerWorkerProbe;readonly qualification:ComputerQualification;
  private child!:ChildProcess;private directory!:string;private seq=0;private nonce=randomBytes(32).toString("hex");
  private pending=new Map<string,{resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:NodeJS.Timeout}>();
  private heartbeat?:NodeJS.Timeout;private stopping?:Promise<{epoch:string;input_released:boolean;terminated:boolean}>;
  private inputFenced=false;
  private inputReleased?:{epoch:string;input_released:true};
  private releasing?:Promise<{epoch:string;input_released:true}>;
  private releaseWaiter?:{resolve:(value:{epoch:string;input_released:true})=>void;reject:(error:unknown)=>void;timer:NodeJS.Timeout};
  private localStop?:z.infer<typeof LocalStopSchema>;
  private cleanup?:Promise<void>;
  private clean(){return this.cleanup??=this.directory?rm(this.directory,{recursive:true,force:true}):Promise.resolve();}
  private constructor(private profile:BrowserWorkerProfile,binding:{adapter:string;adapter_version:string;host_id:string},qualification:ComputerQualification){
    this.qualification=ComputerQualificationSchema.parse(qualification);
    this.probe={protocol:"dreamgraph.computer_worker.v1",backend:"isolated_playwright",backend_version:`playwright-core@1.62.1/chromium@${profile.browser_version}/node@${process.versions.node}`,
      ...binding,platform:process.platform as "win32"|"darwin"|"linux",architecture:process.arch,epoch:randomUUID(),route:"dreamgraph_harness",profile_hash:computerDigest(profile),
      supported:["observe",...(profile.navigation?["navigate" as const]:[]),...new Set(profile.elements.flatMap(element=>element.operations))],permitted:["observe",...(profile.navigation?["navigate" as const]:[]),...new Set(profile.elements.flatMap(element=>element.operations))],
      evidence_granularity:"action",isolated:true,scope_enforced:true,bounded_actions:true,privacy_enforced:true,independent_stop:true,physical_seat:"not_used",
      qualification_hash:computerDigest(qualification),reasons:[]};
  }
  static async create(profileInput:BrowserWorkerProfile,binding:{adapter:string;adapter_version:string;host_id:string},qualification:ComputerQualification){
    const profile=BrowserWorkerProfileSchema.parse(profileInput),value=new BrowserHarnessWorker(profile,binding,qualification);
    if(qualification.source_hash!==await browserWorkerSourceHash())throw new Error("COMPUTER_BROWSER_SOURCE_QUALIFICATION_MISMATCH");
    const directory=await mkdtemp(join(tmpdir(),"dg-computer-worker-"));
    if(!resolve(directory).startsWith(resolve(tmpdir())+sep))throw new Error("COMPUTER_WORKER_TEMP_SCOPE_REJECTED");value.directory=directory;
    try{
      const environment:NodeJS.ProcessEnv={};for(const name of ["PATH","SystemRoot","WINDIR","TMP","TEMP","USERPROFILE","HOME","XDG_RUNTIME_DIR"])if(process.env[name])environment[name]=process.env[name];
      const source=import.meta.url.endsWith(".ts");
      const forkOptions:ForkOptions&{windowsHide:boolean}={execArgv:source?["--import",pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href]:[],cwd:directory,env:environment,
        stdio:["ignore","ignore","ignore","ipc"],serialization:"advanced",windowsHide:true};
      value.child=fork(fileURLToPath(new URL(source?"./browser-worker-entry.ts":"./browser-worker-entry.js",import.meta.url)),[],forkOptions);
      value.child.on("message",raw=>value.receive(raw));value.child.once("exit",()=>value.failed("COMPUTER_WORKER_EXITED"));value.child.once("error",()=>value.failed("COMPUTER_WORKER_START_FAILED"));
      // Pairing loads the isolated worker's modules before it can open a browser.
      // Allow a finite cold-start window on contended hosts; this is not the
      // action, independent Stop or control-loss acknowledgement budget.
      await value.request("bootstrap",{epoch:value.probe.epoch,profile},15000);
      value.heartbeat=setInterval(()=>{void value.request("heartbeat",null,2000).catch(()=>{void value.stop().catch(()=>{});});},1000);value.heartbeat.unref();return value;
    }catch(error){await value.stop().catch(()=>{});throw error;}
  }
  private failed(code:string){for(const {reject,timer}of this.pending.values()){clearTimeout(timer);reject(new Error(code));}this.pending.clear();}
  private receive(input:unknown){
    if(!input||typeof input!=="object")return;const raw=input as Record<string,unknown>;
    if(raw.protocol!=="dreamgraph.computer_worker.v1"||raw.nonce!==this.nonce||raw.epoch!==this.probe.epoch||typeof raw.id!=="string")return;
    if(raw.id==='input-released'){
      const proof=z.object({epoch:z.string(),input_released:z.literal(true)}).strict().safeParse(raw.body);
      if(proof.success&&proof.data.epoch===this.probe.epoch)this.acceptInputRelease(proof.data);
      return;
    }
    if(raw.id==="local-stop"){
      const proof=LocalStopSchema.safeParse(raw.body);if(proof.success&&proof.data.epoch===this.probe.epoch){this.localStop=proof.data;this.inputFenced=true;}
      return;
    }
    const pending=this.pending.get(raw.id);if(!pending)return;this.pending.delete(raw.id);clearTimeout(pending.timer);
    if(raw.error!==undefined){const code=typeof raw.error==="string"&&/^COMPUTER_[A-Z0-9_]{1,120}$/.test(raw.error)?raw.error:"COMPUTER_WORKER_OPERATION_FAILED";pending.reject(new Error(code));}
    else pending.resolve(raw.body);
  }
  private request(operation:string,payload:unknown,timeout:number):Promise<unknown>{
    if(!this.child?.connected||this.pending.size>=8)return Promise.reject(new Error("COMPUTER_WORKER_CHANNEL_UNAVAILABLE"));
    const message={protocol:"dreamgraph.computer_worker.v1",nonce:this.nonce,seq:++this.seq,id:randomUUID(),operation,payload};
    if(Buffer.byteLength(JSON.stringify(message))>1024*1024)return Promise.reject(new Error("COMPUTER_WORKER_MESSAGE_CAPACITY"));
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(message.id);reject(new Error("COMPUTER_WORKER_REPLY_UNKNOWN",{cause:{phase:operation}}));},timeout);
      this.pending.set(message.id,{resolve,reject,timer});this.child.send(message,error=>{if(error){this.pending.delete(message.id);clearTimeout(timer);reject(new Error("COMPUTER_WORKER_SEND_UNKNOWN"));}});});
  }
  private async bound<T>(signal:AbortSignal,work:()=>Promise<T>):Promise<T>{
    if(this.inputFenced)throw new Error("COMPUTER_WORKER_INPUT_FENCED");
    signal.throwIfAborted();const abort=()=>{void this.stop().catch(()=>{});};signal.addEventListener("abort",abort,{once:true});
    try{const value=await work();signal.throwIfAborted();return value;}finally{signal.removeEventListener("abort",abort);}
  }
  async open(target:ComputerTarget,signal:AbortSignal){await this.bound(signal,async()=>{const result=await this.request("open",target,20000);z.object({opened:z.literal(true)}).strict().parse(result);});}
  async observe(target:ComputerTarget,signal:AbortSignal):Promise<ComputerWorkerObservation>{return this.bound(signal,async()=>this.observation(await this.request("observe",target,this.profile.action_timeout_ms+500)));}
  async act(action:ComputerAction,signal:AbortSignal){return this.bound(signal,async()=>{const result=z.object({input_delivered:z.boolean(),postcondition_met:z.boolean(),observation:ObservationSchema}).strict().parse(await this.request("act",action,this.profile.action_timeout_ms+500));
    return {...result,observation:this.observation(result.observation)};});}
  async pause(){if(this.inputFenced)throw new Error("COMPUTER_WORKER_INPUT_FENCED");const proof=z.object({epoch:z.string(),input_released:z.literal(true),paused:z.literal(true)}).strict().parse(await this.request("pause",null,900));
    if(proof.epoch!==this.probe.epoch)throw new Error("COMPUTER_WORKER_PAUSE_UNCONFIRMED");return proof;}
  async resume(target:ComputerTarget,signal:AbortSignal){return this.bound(signal,async()=>this.observation(await this.request("resume",target,this.profile.action_timeout_ms+500)));}
  private observation(raw:unknown){const value=ObservationSchema.parse(raw);
    if(value.epoch!==this.probe.epoch||Buffer.byteLength(value.summary)>this.profile.observation_bytes||value.image&&value.image.bytes.byteLength>this.profile.images.max_bytes)throw new Error("COMPUTER_WORKER_OBSERVATION_CAPACITY");
    if(value.image&&"sha256:"+createHash("sha256").update(value.image.bytes).digest("hex")!==value.image.content_hash)throw new Error("COMPUTER_WORKER_IMAGE_HASH_REJECTED");return value;}
  private acceptInputRelease(proof:{epoch:string;input_released:true}){
    this.inputFenced=true;this.inputReleased=proof;
    if(this.releaseWaiter){clearTimeout(this.releaseWaiter.timer);this.releaseWaiter.resolve(proof);this.releaseWaiter=undefined;}
  }
  releaseInput(){
    if(this.inputReleased)return Promise.resolve(this.inputReleased);
    if(!this.releasing)this.releasing=new Promise<{epoch:string;input_released:true}>((resolve,reject)=>{
      const fail=(error:unknown)=>{if(this.releaseWaiter!==waiter)return;clearTimeout(waiter.timer);this.releaseWaiter=undefined;this.releasing=undefined;reject(error);};
      const waiter={resolve,reject,timer:setTimeout(()=>fail(new Error('COMPUTER_WORKER_INPUT_RELEASE_UNKNOWN')),900)};this.releaseWaiter=waiter;
      void this.stop().then(proof=>{if(proof.input_released)this.acceptInputRelease({epoch:proof.epoch,input_released:true});},fail);
    });
    return this.releasing;
  }
  stop(){
    this.inputFenced=true;
    if(!this.stopping)this.stopping=(async()=>{clearInterval(this.heartbeat);
      try{
        const proof=this.localStop??z.object({epoch:z.string(),input_released:z.boolean(),terminated:z.boolean()}).strict().parse(await this.request("stop",null,4800));
        if(proof.epoch!==this.probe.epoch||!proof.input_released||!proof.terminated)throw new Error("COMPUTER_WORKER_STOP_UNCONFIRMED");
        await this.exit();
        // Receipt latency measures termination, not deletion of an empty private
        // working directory. Cleanup cannot delay the independent stop channel.
        void this.clean().catch(()=>undefined);
        return proof;
      }catch(error){
        // A missing acknowledgement is not proof that Chromium stopped. Keep
        // the original authenticated peer available for stop-only recovery.
        // Its local watchdog still fences work; never reopen or send new input.
        if(this.child?.exitCode!==null||this.child?.signalCode!==null){
          void this.clean().catch(()=>undefined);
        }
        this.stopping=undefined;throw error;
      }
    })();return this.stopping;
  }
  /** Destructive local qualification only; no model/HTTP port exposes this hook. */
  async qualifyControlLoss(mode:"disconnect"|"watchdog"){
    this.inputFenced=true;clearInterval(this.heartbeat);const start=performance.now();
    const exited=once(this.child,"exit");if(mode==="disconnect")this.child.disconnect();
    let timer:NodeJS.Timeout|undefined;
    try{
      const [code,signal]=await Promise.race([exited,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error("COMPUTER_CONTROL_LOSS_UNCONFIRMED")),5200);})]);
      const elapsed_ms=performance.now()-start;
      if(code!==0||signal||elapsed_ms>5000)throw new Error("COMPUTER_CONTROL_LOSS_UNQUALIFIED");
      if(this.directory)await rm(this.directory,{recursive:true,force:true});
      return {elapsed_ms,local_stop:this.localStop??null,proof:"original_child_exited_after_local_browser_closure" as const};
    }finally{clearTimeout(timer);}
  }
  private async exit(){if(this.child&&this.child.exitCode===null&&this.child.signalCode===null){const exited=once(this.child,"exit");this.child.kill("SIGKILL");await exited;}
    this.failed("COMPUTER_WORKER_STOPPED");}
}
