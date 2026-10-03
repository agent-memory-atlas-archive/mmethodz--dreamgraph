/** Standalone operator qualification: real disposable browser/process, zero model requests. */
import {createServer,type Server} from "node:http";
import {mkdir,mkdtemp,readFile,realpath,rm,stat,writeFile} from "node:fs/promises";
import {hostname,tmpdir} from "node:os";
import {isAbsolute,join,resolve,sep} from "node:path";
import {performance} from "node:perf_hooks";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {BrowserHarnessWorker,browserWorkerSourceHash} from "./browser-harness.js";
import {BrowserWorkerProfileSchema,type BrowserWorkerProfile} from "./browser-profile.js";
import {ComputerQualificationSchema,type ComputerQualification} from "./capabilities.js";
import {computerDigest} from "./digest.js";
import {withComputerSession} from "./broker.js";
import type {ComputerAction,ComputerTarget,ComputerWorkerObservation,ComputerWorkerPort} from "./worker-port.js";
import {SessionAuthority} from "../server/session-authority.js";
import {withSessionContext} from "../server/session-context.js";
import {beginHostExecution,approveHostExecution,endHostExecution,withHostExecution} from "../server/managed-execution.js";
import {deliverManagedContext,readManagedContext} from "../graph/execution-context.js";
import {commitGraphWrites} from "../graph/publication.js";
import {releaseGraphWriter} from "../graph/writer-lease.js";
import {config} from "../config/config.js";
let qualifying=false;
const InputSchema=z.object({browser_executable:z.string().max(4096).refine(isAbsolute),browser_version:z.string().min(1).max(256),
  worker_id:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/)}).strict();
const sleep=(ms:number)=>new Promise<void>(done=>setTimeout(done,ms));
const assert=(condition:unknown,reason:string)=>{if(!condition)throw new Error("COMPUTER_QUALIFICATION_"+reason);};
const listen=async(server:Server)=>{await new Promise<void>(done=>server.listen(0,"127.0.0.1",done));return "http://127.0.0.1:"+(server.address() as {port:number}).port;};
const Budget={requests:0,input_tokens:0,output_tokens:0,reasoning_tokens:0,retries:0,elapsed_ms:30000,concurrency:1,
  max_hops:0,max_neighbors:0,run_amount:0,day_amount:0,currency:"USD",pricing_version:null,billing_principal:"offline:computer-qualification"};
const QualificationFailureDetailsSchema=z.object({schema:z.literal("dreamgraph.browser_qualification_failure_details.v1"),
  completed_checks:z.array(z.string().regex(/^BW\d{2}[A-Z]?$/)).max(24),
  worker_phase:z.enum(["bootstrap","open","observe","act","pause","resume","stop"]).nullable()}).strict();
/** Only bounded diagnostic codes cross the CLI failure boundary, never a worker payload. */
export function browserQualificationFailureDetails(error:unknown){
  const parsed=QualificationFailureDetailsSchema.safeParse(error instanceof Error?error.cause:undefined);
  return parsed.success?parsed.data:undefined;
}
export async function qualifyBrowserRuntime(input:unknown,signal:AbortSignal){
  const request=InputSchema.parse(input);signal.throwIfAborted();if(qualifying)throw new Error("COMPUTER_QUALIFICATION_ALREADY_RUNNING");qualifying=true;
  let directory:string|undefined,fixture:Server|undefined,forbidden:Server|undefined,dataCreated=false;
  const workers:BrowserHarnessWorker[]=[],priorRepos={...config.repos};
  const cancel=()=>{for(const value of workers)void value.stop().catch(()=>undefined);};signal.addEventListener("abort",cancel,{once:true});
  const traces:Array<{id:string;requirements:string[];evidence:Record<string,unknown>}>=[];
  const record=(id:string,requirements:string[],evidence:Record<string,unknown>)=>{signal.throwIfAborted();traces.push({id,requirements,evidence});};
  try{
    const executable=await realpath(request.browser_executable);assert((await stat(executable)).isFile(),"EXECUTABLE_NOT_FILE");
    directory=await mkdtemp(join(tmpdir(),"dg-browser-qualification-"));
    assert(resolve(directory).startsWith(resolve(tmpdir())+sep),"TEMP_SCOPE");
    let forbiddenVisits=0,posts=0,ticks=0;
    forbidden=createServer((_req,res)=>{forbiddenVisits++;res.end("Forbidden qualification authority");});const other=await listen(forbidden);
    fixture=createServer((req,res)=>{
      if(req.url==="/fixture/tick"){ticks++;res.end("tick");return;}
      if(req.url==="/fixture/submit"){posts++;res.end("unexpected submit");return;}
      if(req.url==="/fixture/redirect"){res.writeHead(302,{Location:other+"/admin"});res.end();return;}
      if(req.url==="/fixture/slow"){const timer=setTimeout(()=>res.end("late fixture"),10000);req.on("close",()=>clearTimeout(timer));return;}
      res.setHeader("Content-Type","text/html");res.end(`<!doctype html><main id="app"><input id="name" aria-label="Name"><input id="secret" type="password" value="SYNTHETIC_QUALIFICATION_SECRET"><span id="private">SYNTHETIC_QUALIFICATION_SECRET</span><button id="apply" onclick="document.querySelector('#status').textContent='Saved'">Apply</button><button id="move" onclick="document.querySelector('#apply').style.marginLeft='90px'">Move</button><button id="disabled" disabled>Disabled</button><button id="post" onclick="fetch('/fixture/submit',{method:'POST',body:'synthetic'})">Submit</button><button id="spoof" onclick="fetch('${other}/admin',{method:'POST',body:'synthetic'})">Spoof</button><a id="redirect" href="/fixture/redirect">Redirect</a><button id="popup" onclick="window.open('${other}/admin')">Popup</button><button id="frame" onclick="const f=document.createElement('iframe');f.src='${other}/frame';document.body.append(f)">Frame</button><output id="status">Ready</output></main><script>setInterval(()=>fetch('/fixture/tick').catch(()=>{}),100)</script>`);
    });const origin=await listen(fixture),source_hash=await browserWorkerSourceHash();
    const qualification:ComputerQualification={schema:"dreamgraph.computer_qualification.v1",backend:"isolated_playwright",
      backend_version:`playwright-core@1.62.1/chromium@${request.browser_version}/node@${process.versions.node}`,platform:process.platform as "win32"|"darwin"|"linux",architecture:process.arch,
      source_hash,protocol_hash:computerDigest("dreamgraph.computer_worker.v1"),qualified_at:new Date().toISOString(),evidence_scope:"declared_fixture",
      scope_negative_passed:true,privacy_passed:true,bounded_actions_passed:true,stop_release_ms:0,control_loss_stop_ms:0,
      cases:["CU04","CU05","CU10","CU20","CU24"],artifact_hash:computerDigest("Bootstrap metadata for the controlled qualification fixture only")};
    const profile=BrowserWorkerProfileSchema.parse({schema:"dreamgraph.browser_worker_profile.v1",id:"qualification-fixture",browser_executable:executable,browser_version:request.browser_version,runtime_version:"1.62.1",
      initial_url:origin+"/fixture",main_origin:origin,main_path_prefix:"/fixture",network:[{origin,path_prefix:"/fixture",methods:["GET","HEAD"],allow_query:false}],blocked_origins:[other],
      elements:[{id:"name",selector:"#name",read_text:false,read_value:true,operations:["type"]},{id:"secret",selector:"#secret",read_text:false,read_value:true,operations:["type"]},
        ...["private","apply","move","disabled","post","spoof","redirect","popup","frame","status"].map(id=>({id,selector:"#"+id,read_text:true,read_value:false,operations:id==="status"||id==="private"?[]:["click"]}))],
      postconditions:[{id:"typed",selector:"#name",kind:"value_equals_input"},{id:"saved",selector:"#status",kind:"text_equals",expected:"Saved"},{id:"visible",selector:"#status",kind:"visible"}],
      observation_bytes:16384,action_timeout_ms:2000,max_actions:20,expires_at:new Date(Date.now()+120000).toISOString(),
      images:{enabled:false,region:null,mask_selectors:[],max_bytes:0,max_count:0,total_bytes:0},redactions:["SYNTHETIC_QUALIFICATION_SECRET"]});
    const target:ComputerTarget={schema:"dreamgraph.computer_target.v1",id:"qualification-target",instance_id:"qualification",session_id:"qualification",host_id:hostname(),surface:"browser",generation:1,origin,application:null};
    const make=async(changes:Partial<BrowserWorkerProfile>={})=>{signal.throwIfAborted();const value=await BrowserHarnessWorker.create({...profile,...changes},
      {adapter:"native_api_tool_loop",adapter_version:"1",host_id:target.host_id},qualification);workers.push(value);return value;};
    const reference=(observed:ComputerWorkerObservation,label:string)=>{const found=JSON.parse(observed.summary).elements.find((item:{label:string;text:string})=>item.label===label||item.text===label);assert(found,"CONTROL_MISSING");return found.ref as string;};
    const action=(observed:ComputerWorkerObservation,label:string,operation:ComputerAction["operation"],postcondition:string,parameters:ComputerAction["parameters"]={}):ComputerAction=>({schema:"dreamgraph.computer_action.v1",id:"qualification-action:"+randomUUID(),execution_id:"qualification",target_id:observed.target.id,target_generation:observed.target.generation,
      observation_id:"qualification-observation",grant_id:"qualification-grant",operation,parameters:{locator:reference(observed,label),...parameters},postcondition,fence:1});
    const first=await make();await first.open(target,signal);let observed=await first.observe(target,signal);
    assert(!observed.summary.includes("SYNTHETIC_QUALIFICATION_SECRET"),"SECRET_DISCLOSED");
    const typed=await first.act(action(observed,"Name","type","typed",{text:"Å日本語"}),signal);assert(typed.postcondition_met,"UNICODE_READBACK");
    record("BW01",["CU02","CU20"],{unicode_postcondition:true,filtered_structural_observation:true});
    observed=typed.observation;const stale=action(observed,"Apply","click","saved"),moved=await first.act(action(observed,"Move","click","visible"),signal);
    assert(moved.observation.target.generation>observed.target.generation,"GENERATION_NOT_CHANGED");
    let staleRejected=false;try{await first.act(stale,signal);}catch(error){staleRejected=String(error).includes("STALE");}assert(staleRejected,"STALE_REFERENCE_ACCEPTED");
    record("BW02",["CU03","CU14"],{stale_reference_rejected:true});
    // Resume must observe a still-authorized target. The subsequent redirect
    // attack can invalidate that document, which must remain refused.
    const pauseProof=await first.pause();assert(pauseProof.input_released&&pauseProof.paused&&pauseProof.epoch===first.probe.epoch,"PAUSE_RELEASE");
    let pausedRefused=false;try{await first.observe(target,signal);}catch(error){pausedRefused=String(error).includes("PAUSED");}assert(pausedRefused,"PAUSED_OBSERVATION_ACCEPTED");
    const resumed=await first.resume(observed.target,signal);assert(resumed.epoch===first.probe.epoch&&resumed.target.generation>observed.target.generation,"RESUME_TARGET_GENERATION");
    record("BW03A",["CU03","CU12"],{original_peer_pause:true,fresh_resume_observation:true,no_input_during_pause:true});
    for(const label of ["Disabled","Submit","Spoof","Popup","Frame","Redirect"]){
      observed=await first.observe(target,signal);try{await first.act(action(observed,label,"click","visible"),signal);}catch(error){assert(String(error).includes("COMPUTER_"),"UNCLASSIFIED_SCOPE_FAILURE");}
    }
    await sleep(150);assert(forbiddenVisits===0&&posts===0,"FORBIDDEN_NETWORK_REACHED");
    record("BW03",["CU04","CU14"],{forbidden_requests:forbiddenVisits,forbidden_posts:posts});
    const beforeStop=performance.now(),released=await first.releaseInput(),stop_release_ms=performance.now()-beforeStop;
    const stopped=await first.stop(),termination_ms=performance.now()-beforeStop;
    assert(released.input_released&&stop_release_ms<=1000,"STOP_LATENCY");
    assert(stopped.terminated&&termination_ms<=5000,'STOP_TERMINATION_LATENCY');record("BW04",["CU05"],{stop_release_ms,termination_ms});
    const bounded=await make({max_actions:1,images:{enabled:true,region:"#app",mask_selectors:["#private"],max_bytes:1024*1024,max_count:1,total_bytes:1024*1024}});
    await bounded.open(target,signal);observed=await bounded.observe(target,signal);assert(observed.image?.content_hash&&observed.image.bytes.length>0,"IMAGE_MISSING");
    let refused=false;try{await bounded.act(action(observed,"Name","type","typed",{text:"never entered"}),signal);}catch(error){refused=String(error).includes("RESERVATION_EXHAUSTED");}
    assert(refused,"IMAGE_LIMIT_BYPASSED");await bounded.stop();record("BW05",["CU13","CU20"],{finite_image_reservation:true,frame_hash_verified:true});
    const actionBounded=await make({max_actions:1});await actionBounded.open(target,signal);observed=await actionBounded.observe(target,signal);
    const allowed=await actionBounded.act(action(observed,"Name","type","typed",{text:"one admitted input"}),signal);let actionRefused=false;
    try{await actionBounded.act(action(allowed.observation,"Name","type","typed",{text:"never entered"}),signal);}catch(error){actionRefused=String(error).includes("ACTION_CAPACITY");}
    assert(actionRefused,"ACTION_LIMIT_BYPASSED");await actionBounded.stop();record("BW05A",["CU13"],{finite_action_limit:true});
    let control_loss_stop_ms=0;
    for(const mode of ["disconnect","watchdog"] as const){const value=await make();await value.open(target,signal);await value.observe(target,signal);
      const proof=await value.qualifyControlLoss(mode);assert(proof.elapsed_ms<=5000,"CONTROL_LOSS_STOP_LATENCY");
      control_loss_stop_ms=Math.max(control_loss_stop_ms,proof.elapsed_ms);const stoppedTicks=ticks;await sleep(350);assert(ticks===stoppedTicks,"BROWSER_ACTIVITY_AFTER_STOP");
      record(mode==="disconnect"?"BW06":"BW07",["CU05","CU11"],{mode,...proof,browser_requests_quiescent:true});}
    const data=join(directory,"data");await mkdir(data);dataCreated=true;await writeFile(join(directory,"source.ts"),"export const qualification = true;\n");
    // This entry point is a standalone CLI, never a daemon request. Reuse the
    // canonical repository map as instance startup does, then restore it.
    for(const key of Object.keys(config.repos))delete config.repos[key];config.repos.qualification=directory;
    const initialAuthority=new SessionAuthority("legacy",data),owner=(await initialAuthority.create("offline-qualification")).context;
    Object.assign(owner.environment,{DREAMGRAPH_REPOS:JSON.stringify({qualification:directory})});
    await withSessionContext(owner,async()=>{
      await commitGraphWrites({actor:"offline-qualification",scope:["features.json"],writes:[{file:"features.json",content:JSON.stringify({features:[{id:"qualification",name:"Qualification fixture",source_repo:"qualification",source_files:["source.ts"]}]})}]});
      const execution_id="browser-qualification:"+randomUUID(),host=await beginHostExecution({id:execution_id,adapter:"native_api_tool_loop",query:"Qualification fixture",autonomy:"supervised",timeout_ms:30000});
      await deliverManagedContext(execution_id,host.execution.block);const entry=await readManagedContext(execution_id),authority=new SessionAuthority(entry.instance_id,data);
      const boundTarget={...target,instance_id:entry.instance_id,session_id:owner.session_id},boundProfile={...profile,expires_at:new Date(Date.now()+20000).toISOString()},value=await make(boundProfile);let delivered=0;
      const port:ComputerWorkerPort={probe:value.probe,qualification:value.qualification,open:value.open.bind(value),observe:value.observe.bind(value),releaseInput:value.releaseInput.bind(value),stop:value.stop.bind(value),
        act:async(intent,abort)=>{delivered++;await value.act(intent,abort);throw new Error("COMPUTER_DECLARED_LOST_ACTION_REPLY");}};
      const grant=await authority.grantScopedComputer(owner,{operation_id:"qualification-grant",execution_id,target_id:boundTarget.id,profile_hash:computerDigest(boundProfile),backend_source_hash:source_hash,interact:true,duration_ms:30000,human_confirmed:true});
      let lostReplyChecked=false;
      try{await withHostExecution(execution_id,()=>withComputerSession({id:"qualification-computer",execution_id,grant_id:grant.id,target:boundTarget,settings:{enabled:true,route:"auto"},adapter_kind:"native_api",adapter:"native_api_tool_loop",adapter_version:"1",
        requested:value.probe.supported,limits:{max_actions:20,max_images:0,max_image_bytes:0,observation_bytes:16384,expires_at:boundProfile.expires_at},profile:{hash:computerDigest(boundProfile),postconditions:["typed","saved","visible"]},budget:Budget},port,authority,async broker=>{
          const seen=await broker.observe(),intent={...action({...seen,epoch:value.probe.epoch,target:boundTarget,kind:"dom",content_hash:seen.observation.content_hash,captured_at:seen.observation.observed_at},"Name","type","typed",{text:"actual lost reply"}),execution_id,
            observation_id:seen.observation.id,grant_id:grant.id};
          await withSessionContext(owner,async()=>{const current=await readManagedContext(execution_id);await approveHostExecution({execution_id,approval_id:"qualification-exact-action",expected_record_revision:current.record_revision,context_receipt_id:current.pack.receipt.id,
            approved_actions:[{tool:"computer_action",arguments:intent,scope_id:boundTarget.id,calls:1}]});});
          let unknown=false;try{await broker.act(intent);}catch(error){unknown=String(error).includes("LOST_ACTION_REPLY");}assert(unknown,"LOST_REPLY_NOT_UNKNOWN");
          const receipt=await broker.act(intent);assert(receipt.state==="unknown"&&delivered===1,"UNKNOWN_ACTION_REPLAYED");
          const actual=await value.observe(boundTarget,signal);assert(actual.summary.includes("actual lost reply"),"PHYSICAL_EFFECT_NOT_OBSERVED");
          lostReplyChecked=true;
          record("BW08",["CU10","CU22","CU24"],{actual_input_deliveries:delivered,durable_outcome:receipt.state,exact_retry_no_input:true,route:port.probe.route});
        },{signal,allow_declared_fixture:true}));}
      catch(error){if(!lostReplyChecked||!String(error).includes("JOB_EFFECT_RECOVERY_REQUIRED"))throw error;}
      finally{await endHostExecution({execution_id,outcome:"cancelled",work_termination:"confirmed"});}
      const closed=await readManagedContext(execution_id);assert(closed.status==="recovery_required","UNKNOWN_EFFECT_FALSE_CLOSURE");
      record("BW09",["CU10","CU22"],{execution_status:closed.status,unknown_action_retained:true});
      const journal=await readFile(join(data,"execution_contexts.json"),"utf8");assert(!journal.includes("actual lost reply")&&!journal.includes("SYNTHETIC_QUALIFICATION_SECRET"),"JOURNAL_PRIVATE_CONTENT");
    });
    const evidence={schema:"dreamgraph.browser_runtime_evidence.v1",recorded_at:new Date().toISOString(),source_hash,platform:process.platform,architecture:process.arch,node:process.versions.node,
      browser_version:request.browser_version,runtime_version:"1.62.1",model_requests:0,provider_scope:"none",traces,
      support_scope:"This installed isolated browser/runtime only. CU IDs map to measured subchecks, not full CU acceptance, other operating systems, native desktops or CLI adapters."};
    const qualified=ComputerQualificationSchema.parse({...qualification,evidence_scope:"actual_runtime",qualified_at:evidence.recorded_at,stop_release_ms,control_loss_stop_ms,artifact_hash:computerDigest(evidence)});
    return {schema:"dreamgraph.browser_runtime_qualification.v1",evidence,worker:{schema:"dreamgraph.browser_install.v1",id:request.worker_id,browser_executable:executable,browser_version:request.browser_version,runtime_version:"1.62.1",qualification:qualified}};
  }catch(error){
    const reason=error instanceof Error&&/^[A-Z][A-Z0-9_]{0,127}$/.test(error.message)?error.message:"COMPUTER_QUALIFICATION_FAILED";
    const cause=error instanceof Error?error.cause:undefined;
    const phase=z.enum(["bootstrap","open","observe","act","pause","resume","stop"]).safeParse(
      cause&&typeof cause==="object"&&"phase" in cause?cause.phase:undefined);
    throw new Error(reason,{cause:QualificationFailureDetailsSchema.parse({schema:"dreamgraph.browser_qualification_failure_details.v1",
      completed_checks:traces.map(trace=>trace.id),worker_phase:phase.success?phase.data:null})});
  }finally{
    signal.removeEventListener("abort",cancel);
    for(const value of workers)await value.stop().catch(()=>undefined);
    for(const server of [fixture,forbidden])if(server){server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}
    for(const key of Object.keys(config.repos))delete config.repos[key];Object.assign(config.repos,priorRepos);
    if(directory){if(dataCreated)await releaseGraphWriter(join(directory,"data"));await rm(directory,{recursive:true,force:true});}
    qualifying=false;
  }
}
