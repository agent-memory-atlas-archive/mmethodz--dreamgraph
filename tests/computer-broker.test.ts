/** Real host, grant, job and publication owners. Physical executor is an explicitly declared synthetic port. */
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {mkdtemp,readFile,rm,writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {config} from "../src/config/config.js";
import {getDataDir,setDataDirOverride} from "../src/utils/paths.js";
import {releaseGraphWriter} from "../src/graph/writer-lease.js";
import {commitGraphWrites} from "../src/graph/publication.js";
import {beginHostExecution,approveHostExecution,endHostExecution,withHostExecution} from "../src/server/managed-execution.js";
import {deliverManagedContext,readManagedContext,finishManagedContext,managedContextPrompt} from "../src/graph/execution-context.js";
import {SessionAuthority} from "../src/server/session-authority.js";
import {withSessionContext,type SessionContext} from "../src/server/session-context.js";
import {EngineJobs} from "../src/cognitive/jobs.js";
import {withComputerSession,type ComputerSessionInput,activeComputerBroker} from "../src/computer/broker.js";
import {computerDigest,readComputerJournal} from "../src/computer/journal.js";
import type {ComputerQualification,ComputerWorkerProbe} from "../src/computer/capabilities.js";
import type {ComputerAction,ComputerTarget,ComputerWorkerPort} from "../src/computer/worker-port.js";
import {callComputerNativeTool,computerNativeTools,nativePromptTextBytes} from "../src/computer/native-tools.js";
let root:string,previous:string,repos:Record<string,string>,owner:SessionContext,authority:SessionAuthority,input:ComputerSessionInput;
let actions:number,stops:number,opens:number,generation:number,worker:ComputerWorkerPort,value:string;
let actHook:((action:ComputerAction,signal:AbortSignal)=>Promise<void>)|undefined,stopHook:(()=>Promise<void>)|undefined;
const within=<T>(work:()=>T)=>withSessionContext(owner,work);
const observation=(target:ComputerTarget)=>({epoch:"fixture-worker-epoch",target:{...target,generation},kind:"dom" as const,summary:"Filtered local fixture state",content_hash:computerDigest(value),captured_at:new Date().toISOString()});
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),"dg-computer-broker-"));previous=getDataDir();repos={...config.repos};config.repos={fixture:root};setDataDirOverride(join(root,"data"));
 await writeFile(join(root,"source.ts"),"export const controlled = true;\n");await commitGraphWrites({actor:"fixture",scope:["features.json"],writes:[{file:"features.json",content:JSON.stringify({features:[{id:"ui",name:"Controlled UI",source_repo:"fixture",source_files:["source.ts"]}]})}]});
 authority=new SessionAuthority("legacy",join(root,"data"));owner=(await authority.create("operator")).context;
 await within(async()=>{const host=await beginHostExecution({id:"execution",adapter:"native_api",query:"Controlled UI",autonomy:"supervised",timeout_ms:15000});await deliverManagedContext("execution",host.execution.block);});
 const entry=await within(()=>readManagedContext("execution"));
 authority=new SessionAuthority(entry.instance_id,join(root,"data"));
 const challenge=await authority.beginFullAccess(owner,{execution_id:"execution",scope:["target"],capabilities:["computer_observe","computer_interact",`computer_profile:${computerDigest("reviewed-fixture")}`,`computer_backend:${computerDigest("fixture")}`],duration_ms:15000,human_confirmed:true});
 const grant=await authority.confirmFullAccess(owner,{...challenge,human_confirmed:true});
 const qualification:ComputerQualification={schema:"dreamgraph.computer_qualification.v1",backend:"declared-fixture",backend_version:"1",platform:process.platform as "win32",architecture:process.arch,
  source_hash:computerDigest("fixture"),protocol_hash:computerDigest("dreamgraph.computer_worker.v1"),qualified_at:new Date().toISOString(),evidence_scope:"declared_fixture",scope_negative_passed:true,privacy_passed:true,bounded_actions_passed:true,stop_release_ms:1,control_loss_stop_ms:1,cases:["CU04","CU05","CU10","CU20","CU24"],artifact_hash:computerDigest("fixture")};
 const probe:ComputerWorkerProbe={protocol:"dreamgraph.computer_worker.v1",backend:"declared-fixture",backend_version:"1",adapter:"native_api",adapter_version:"1",platform:process.platform as "win32",architecture:process.arch,
  host_id:"fixture-host",epoch:"fixture-worker-epoch",route:"dreamgraph_harness",profile_hash:computerDigest("reviewed-fixture"),supported:["observe","type","click"],permitted:["observe","type","click"],evidence_granularity:"action",isolated:true,scope_enforced:true,bounded_actions:true,privacy_enforced:true,independent_stop:true,physical_seat:"not_used",qualification_hash:computerDigest(qualification),reasons:[]};
 input={id:"computer",execution_id:"execution",grant_id:grant.id,target:{schema:"dreamgraph.computer_target.v1",id:"target",instance_id:entry.instance_id,session_id:owner.session_id,host_id:"fixture-host",surface:"browser",generation:1,origin:"https://fixture.example",application:null},
  settings:{enabled:true,route:"auto"},adapter_kind:"native_api",adapter:"native_api",adapter_version:"1",requested:["observe","type","click"],limits:{max_actions:5,max_images:0,max_image_bytes:0,observation_bytes:2048,expires_at:new Date(Date.now()+10000).toISOString()},
  profile:{hash:computerDigest("reviewed-fixture"),postconditions:["value-equals"]},budget:{requests:0,input_tokens:0,output_tokens:0,reasoning_tokens:0,retries:0,elapsed_ms:10000,concurrency:1,max_hops:0,max_neighbors:0,run_amount:0,day_amount:0,currency:"USD",pricing_version:null,billing_principal:"operator"}};
 actions=0;stops=0;opens=0;generation=1;value="";actHook=undefined;stopHook=undefined;
 worker={probe,qualification,open:async(_target,signal)=>{signal.throwIfAborted();opens++;},observe:async(target,signal)=>{signal.throwIfAborted();return observation(target);},
  act:async(action,signal)=>{actions++;await actHook?.(action,signal);signal.throwIfAborted();value=action.parameters.text??"clicked";return {input_delivered:true,postcondition_met:true,observation:observation(input.target)};},
  stop:async()=>{stops++;await stopHook?.();return {epoch:probe.epoch,input_released:true,terminated:true};}};
});
afterEach(async()=>{await within(()=>endHostExecution({execution_id:"execution",outcome:"cancelled",work_termination:"unconfirmed"})).catch(()=>{});
 await releaseGraphWriter(join(root,"data"));setDataDirOverride(previous);config.repos=repos;await rm(root,{recursive:true,force:true});});
const run=<T>(work:Parameters<typeof withComputerSession<T>>[3],settings:Partial<ComputerSessionInput>={})=>within(()=>withHostExecution("execution",()=>withComputerSession({...input,...settings},worker,authority,work,{allow_declared_fixture:true})));
async function approved(action:ComputerAction){await within(async()=>{const entry=await readManagedContext("execution");await approveHostExecution({execution_id:"execution",approval_id:"review:"+action.id,
 expected_record_revision:entry.record_revision,context_receipt_id:entry.pack.receipt.id,approved_actions:[{tool:"computer_action",arguments:action,scope_id:"target",calls:1}]});});}
const action=(observation_id:string,id="action"):ComputerAction=>({schema:"dreamgraph.computer_action.v1",id,execution_id:"execution",target_id:"target",target_generation:generation,observation_id,
 grant_id:input.grant_id,operation:"type",parameters:{text:"SYNTHETIC_PRIVATE_Å日本語"},postcondition:"value-equals",fence:1});
it("single original host/job owns scoped dispatch, independent postcondition and replay",async()=>{
 await run(async broker=>{const observed=await broker.observe(),intent=action(observed.observation.id);await approved(intent);
  const receipt=await broker.act(intent);expect(receipt.state).toBe("verified");expect(await broker.act(intent)).toEqual(receipt);expect(actions).toBe(1);
  expect((await broker.status()).usage.actions).toBe(1);});
 expect(opens).toBe(1);expect(stops).toBe(1);const records=(await new EngineJobs(join(root,"data")).inspect()).records;
 expect(records).toHaveLength(1);expect(records[0]).toMatchObject({work_settled:true,job:{state:"succeeded",execution_id:"execution",unknown_effects:[]}});
 expect(records[0].external_effects.every(effect=>effect.state==="acknowledged")).toBe(true);
 const disk=await readFile(join(root,"data/execution_contexts.json"),"utf8");expect(disk).not.toContain("SYNTHETIC_PRIVATE");expect(disk).not.toContain("日本語");
 expect((await within(()=>finishManagedContext("execution"))).status).toBe("state_committed");
});
function pausable(){worker.pause=async()=>({epoch:worker.probe.epoch,input_released:true,paused:true});worker.resume=async target=>{generation++;return observation(target);};}
async function delivered(){const entry=await readManagedContext("execution");await deliverManagedContext("execution",managedContextPrompt(entry));}
it("pause fences input and model continuation; resume preserves finite original authority and requires fresh graph/target evidence",async()=>{
 pausable();await run(async broker=>{const observed=await broker.observe(),old=action(observed.observation.id,"old-reference");await approved(old);const initial=await broker.status();
  await within(()=>broker.pause(initial.session.fence));expect((await broker.status()).session.state).toBe("paused");expect(broker.inspectLatestObservation()).toBeNull();
  let continued=false;const pending=broker.awaitReady().then(()=>{continued=true;});await new Promise(done=>setTimeout(done,20));expect(continued).toBe(false);await expect(broker.act(old)).rejects.toThrow("PAUSED");
  const paused=await broker.status();await within(()=>broker.resume(paused.session.fence));await pending;const resumed=await broker.status();expect(resumed.limits).toEqual(initial.limits);expect(resumed.usage.actions).toBe(0);expect(resumed.session.job_id).toBe(initial.session.job_id);
  await expect(broker.act(old)).rejects.toThrow("NOT_DELIVERED");await delivered();await expect(broker.act(old)).rejects.toThrow("FENCE_REJECTED");
  const fresh=await broker.observe(),intent={...action(fresh.observation.id),fence:resumed.session.fence};await approved(intent);expect((await broker.act(intent)).state).toBe("verified");expect(actions).toBe(1);
  // Exact lost resume acknowledgement is readback; it cannot replay capture or replenish actions.
  await within(()=>broker.resume(paused.session.fence));expect((await broker.status()).usage.actions).toBe(1);
  await within(()=>broker.pause(resumed.session.fence));await expect(within(()=>broker.resume(paused.session.fence))).rejects.toThrow("FENCE_REJECTED");
 });expect(stops).toBe(1);
});
it("pause drains an already delivered atomic operation to its observed receipt while independent Stop remains separate",async()=>{
 pausable();let release!:()=>void,dispatched!:()=>void;const boundary=new Promise<void>(done=>release=done),started=new Promise<void>(done=>dispatched=done);
 actHook=async()=>{dispatched();await boundary;};await run(async broker=>{const observed=await broker.observe(),intent=action(observed.observation.id);await approved(intent);const acting=broker.act(intent);await started;
  let acknowledged=false;const paused=within(()=>broker.pause(1)).then(()=>{acknowledged=true;});await new Promise(done=>setTimeout(done,30));expect(acknowledged).toBe(false);expect((await broker.status()).pause_state).toBe("requested");
  release();expect((await acting).state).toBe("verified");await paused;expect((await broker.status()).session.state).toBe("paused");expect(actions).toBe(1);
 });
});
it("Stop breaks a paused model wait without renewing a grant or turning unresolved work into a completed task",async()=>{
 pausable();await run(async broker=>{await within(()=>broker.pause(1));const stopped=expect(broker.awaitReady()).rejects.toThrow("COMPUTER_");await within(()=>broker.stop());await stopped;
  await expect(within(()=>broker.resume(2))).rejects.toThrow("COMPUTER_");expect(actions).toBe(0);expect((await broker.status()).stop_state).toBe("acknowledged");});
});
it("pause and resume require the original human owner; lost acknowledgement retries cannot pause or capture twice",async()=>{
 pausable();let pauses=0,resumes=0;const pause=worker.pause!,resume=worker.resume!;
 worker.pause=async()=>{pauses++;return pause();};worker.resume=async(target,signal)=>{resumes++;return resume(target,signal);};
 await run(async broker=>{
  await expect(broker.pause(1)).rejects.toThrow("OPERATOR_SESSION_REQUIRED");
  const foreign={...owner,session_id:"different-browser-session"};
  await expect(withSessionContext(foreign,()=>broker.pause(1))).rejects.toThrow("OPERATOR_SESSION_REQUIRED");
  await within(()=>broker.pause(1));await within(()=>broker.pause(1));expect(pauses).toBe(1);
  await expect(withSessionContext(foreign,()=>broker.resume(2))).rejects.toThrow("OPERATOR_SESSION_REQUIRED");
  await expect(within(()=>broker.resume(1))).rejects.toThrow("FENCE_REJECTED");
  await within(()=>broker.resume(2));await within(()=>broker.resume(2));expect(resumes).toBe(1);expect(actions).toBe(0);
 });expect(stops).toBe(1);
});
it("an unresponsive pause acknowledgement times out, records uncertainty and uses independent Stop",async()=>{
 pausable();worker.pause=()=>new Promise(()=>{});
 await expect(run(broker=>within(()=>broker.pause(1)))).rejects.toThrow("COMPUTER_PAUSE_TIMEOUT");
 const state=await within(()=>readComputerJournal("execution","computer"));
 expect(state.pause_state).toBe("unknown");expect(state.stop_state).toBe("acknowledged");expect(state.session.state).toBe("stopped");expect(actions).toBe(0);expect(stops).toBe(1);
});
it("the original deadline expires during pause; waiting cannot renew authority or leave a running worker",async()=>{
 pausable();let paused=false;const expires_at=new Date(Date.now()+3000).toISOString();
 await expect(run(async broker=>{await within(()=>broker.pause(1));paused=true;await broker.awaitReady();},
  {limits:{...input.limits,expires_at}})).rejects.toThrow();
 // C05 may reject the caller wait before the underlying finally/Stop settles.
 // Observe that original acknowledgement; a rejected wait is not termination.
 await vi.waitFor(async()=>{const record=(await new EngineJobs(join(root,"data")).inspect()).records[0];
  expect(record.work_settled).toBe(true);},{timeout:5000,interval:20});
 expect(paused).toBe(true);const state=await within(()=>readComputerJournal("execution","computer"));expect(state.limits.expires_at).toBe(expires_at);
 expect(state.stop_state).toBe("acknowledged");expect(state.session.state).toBe("stopped");expect(actions).toBe(0);expect(stops).toBe(1);
});
it("native custom tools preserve scoped fresh observations and keep literal arguments out of preview metadata",async()=>{
 await run(async broker=>{expect((await computerNativeTools(broker)).map(tool=>tool.name)).toEqual(["computer_observe","computer_action"]);
  const observed=await callComputerNativeTool(broker,"computer_observe",{}),intent=action(JSON.parse(observed.text).observation.id);await approved(intent);
  const result=await callComputerNativeTool(broker,"computer_action",intent);expect(JSON.parse(result.text).receipt.state).toBe("verified");
  expect(result.preview).not.toContain("SYNTHETIC_PRIVATE");expect(result.preview).not.toContain("Å日本語");
  await expect(callComputerNativeTool(broker,"computer_observe",{target_id:"other"})).rejects.toThrow("ARGUMENTS_REJECTED");});
 const images=[{role:"user",content:[{type:"image",mimeType:"image/png",dataBase64:Buffer.alloc(128*1024).toString("base64")}]}];
 expect(Buffer.byteLength(JSON.stringify(images))).toBeGreaterThan(128*1024);expect(nativePromptTextBytes(images)).toBeLessThan(1024);
});
it("ephemeral image bytes are hash checked and atomically recorded as distinct pixel/DOM descriptors",async()=>{
 const bytes=Buffer.from("declared filtered frame"),content_hash="sha256:"+createHash("sha256").update(bytes).digest("hex");
 worker.observe=async target=>({...observation(target),image:{mime_type:"image/png",bytes,content_hash}});
 await run(async broker=>{const observed=await broker.observe(),state=await broker.status();expect(observed.image_observation).toMatchObject({kind:"pixels",verified:false,evidence_ids:[observed.observation.id],content_hash});
  expect(state.observations.map(item=>item.kind)).toEqual(["dom","pixels"]);expect(state.usage).toMatchObject({images:1,image_bytes:bytes.length});
  await expect(broker.observe()).rejects.toThrow("BUDGET");expect((await broker.status()).observations).toHaveLength(2);
 },{limits:{...input.limits,max_images:1,max_image_bytes:1024}});
 expect(await readFile(join(root,"data/execution_contexts.json"),"utf8")).not.toContain("declared filtered frame");
});
it("an executor cannot pair arbitrary image bytes with a forged digest",async()=>{
 worker.observe=async target=>({...observation(target),image:{mime_type:"image/png",bytes:Buffer.from("bad"),content_hash:computerDigest("wrong")}});
 await run(async broker=>{await expect(broker.observe()).rejects.toThrow("PROVENANCE_REJECTED");expect((await broker.status()).observations).toEqual([]);});
});
it("full-access scope does not replace exact action approval; target changes remain fenced",async()=>{
 await run(async broker=>{const observed=await broker.observe(),intent=action(observed.observation.id);
  await expect(broker.act(intent)).rejects.toThrow("ACTION_APPROVAL_REQUIRED");expect(actions).toBe(0);
  await approved(intent);generation++;await broker.observe();await expect(broker.act(intent)).rejects.toThrow("FENCE_REJECTED");expect(actions).toBe(0);});
});
it("grant revocation stops without a model roundtrip and prevents later physical dispatch",async()=>{
 await run(async broker=>{await broker.observe();await new SessionAuthority(authority.instance_id,join(root,"data")).revoke(owner,input.grant_id);
  await expect(broker.observe()).rejects.toThrow("COMPUTER_");expect(stops).toBe(1);expect((await broker.status()).stop_state).toBe("acknowledged");});
 expect(actions).toBe(0);
});
it("lost reply after input has one durable unknown receipt and is never replayed",async()=>{
 actHook=async()=>{throw new Error("declared result lost after physical delivery");};
 await expect(run(async broker=>{const observed=await broker.observe(),intent=action(observed.observation.id);await approved(intent);
  await expect(broker.act(intent)).rejects.toThrow("result lost");const receipt=await broker.act(intent);expect(receipt.state).toBe("unknown");expect(actions).toBe(1);
 })).rejects.toThrow("JOB_EFFECT_RECOVERY_REQUIRED");
 const jobs=await new EngineJobs(join(root,"data")).inspect();expect(jobs.records[0].job.state).toBe("recovery_required");
 expect((await within(()=>finishManagedContext("execution"))).status).toBe("recovery_required");
});
it("failed independent termination retains the original worker for stop-only recovery",async()=>{
 stopHook=async()=>{throw new Error("declared worker stop unavailable");};
 await expect(run(async broker=>{await broker.observe();})).rejects.toThrow("JOB_EFFECT_RECOVERY_REQUIRED");
 const original=within(()=>activeComputerBroker("execution","computer"));expect(original).toBeDefined();
 expect((await within(()=>readComputerJournal("execution","computer"))).stop_state).toBe("unknown");
 stopHook=undefined;await within(()=>original!.recoverStop());expect(stops).toBe(2);expect(opens).toBe(1);expect(actions).toBe(0);
 expect((await new EngineJobs(join(root,"data")).inspect()).records[0].job.state).toBe("succeeded");
});
it("released input stays stopping with an unsettled lifetime until the original worker terminates",async()=>{
 let terminate!:()=>void;stopHook=()=>new Promise<void>(done=>terminate=done);
 worker.releaseInput=async()=>({epoch:worker.probe.epoch,input_released:true});
 await run(async broker=>{
  let complete=false;const stopped=broker.stop().then(()=>{complete=true;});
  try{
   await vi.waitFor(async()=>expect((await broker.status()).session.terminal_reason).toBe('COMPUTER_INPUT_RELEASED_TERMINATION_PENDING'));
   expect((await broker.status())).toMatchObject({stop_state:'requested',session:{state:'stopping'}});expect(complete).toBe(false);
   await expect(broker.observe()).rejects.toThrow('COMPUTER_');
   const record=(await new EngineJobs(join(root,'data')).inspect()).records[0];
   expect(record.external_effects.find(effect=>effect.id==='computer-lifetime:computer')?.state).not.toBe('acknowledged');
  }finally{terminate();await stopped;}
  expect((await broker.status())).toMatchObject({stop_state:'acknowledged',session:{state:'stopped'}});
 });
});
it("five seconds without termination proof preserves recovery after confirmed input release",async()=>{
 stopHook=()=>new Promise(()=>{});worker.releaseInput=async()=>({epoch:worker.probe.epoch,input_released:true});
 await expect(run(async()=>{})).rejects.toThrow('JOB_EFFECT_RECOVERY_REQUIRED');
 await vi.waitFor(async()=>expect(await within(()=>readComputerJournal('execution','computer'))).toMatchObject({stop_state:'unknown',session:{state:'recovery_required',terminal_reason:'COMPUTER_TERMINATION_UNCONFIRMED'}}));
 const original=within(()=>activeComputerBroker('execution','computer'));expect(original).toBeDefined();
 stopHook=undefined;await within(()=>original!.recoverStop());expect(opens).toBe(1);expect(actions).toBe(0);
},15000);
it("one second without input-release proof cannot be reported as a stopped session",async()=>{
 stopHook=()=>new Promise(()=>{});worker.releaseInput=()=>new Promise(()=>{});
 await expect(run(async()=>{})).rejects.toThrow('JOB_EFFECT_RECOVERY_REQUIRED');
 expect(await within(()=>readComputerJournal('execution','computer'))).toMatchObject({stop_state:'unknown',session:{state:'recovery_required',terminal_reason:'COMPUTER_INPUT_RELEASE_UNCONFIRMED'}});
 stopHook=undefined;worker.releaseInput=async()=>({epoch:worker.probe.epoch,input_released:true});
 await within(()=>activeComputerBroker('execution','computer')!.recoverStop());
});
it("material source change stays reconciliation pending even though the GUI postcondition passed",async()=>{
 actHook=async()=>{await writeFile(join(root,"source.ts"),"export const controlled = false;\n");};
 await run(async broker=>{const observed=await broker.observe(),intent=action(observed.observation.id);await approved(intent);expect((await broker.act(intent)).state).toBe("verified");},{profile:{...input.profile,project_workspace:root}});
 expect((await within(()=>finishManagedContext("execution"))).status).toBe("reconciliation_pending");
});
it("wrong-session and unqualified routes cannot open even a declared worker",async()=>{
 await expect(run(async()=>{}, {requested:["native_task"]})).rejects.toThrow("CAPABILITY_UNAVAILABLE");expect(opens).toBe(0);
 const foreign={...owner,session_id:"other"};await expect(withSessionContext(foreign,()=>withHostExecution("execution",async()=>{}))).rejects.toThrow("AUTHORITY_UNAVAILABLE");
});
it.each(["profile","backend"])("a reviewed %s cannot be replaced by the worker",async pin=>{
 if(pin==="profile")worker.probe={...worker.probe,profile_hash:computerDigest("different profile")};
 else worker.qualification={...worker.qualification,source_hash:computerDigest("different source")};
 await expect(run(async()=>{})).rejects.toThrow(pin==="profile"?"PROFILE_PIN_REJECTED":"GRANT_SCOPE_REJECTED");expect(opens).toBe(0);
});
it("observation-only operator approval cannot authorize interaction even with an exact action approval",async()=>{
 const grant=await authority.grantScopedComputer(owner,{operation_id:"observe-only",execution_id:input.execution_id,target_id:input.target.id,
  profile_hash:input.profile.hash,backend_source_hash:worker.qualification.source_hash,interact:false,duration_ms:15000,human_confirmed:true});
 input={...input,grant_id:grant.id};
 await run(async broker=>{const observed=await broker.observe(),intent=action(observed.observation.id);await approved(intent);
  await expect(broker.act(intent)).rejects.toThrow("GRANT_SCOPE_REJECTED");expect(actions).toBe(0);},{requested:["observe"]});
 await expect(run(async()=>{},{id:"another-computer"})).rejects.toThrow("GRANT_SCOPE_REJECTED");expect(opens).toBe(1);
});
