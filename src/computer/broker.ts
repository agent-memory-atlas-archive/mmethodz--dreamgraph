/** C17 executor within the existing C15 host and C05 job. This is not another agent or scheduler. */
import {createHash,randomUUID} from "node:crypto";
import {z} from "zod";
import {ComputerActionSchema,ComputerObservationSchema,ComputerReceiptSchema,ComputerTargetSchema,type ResourceBudget} from "../graph/contracts.js";
import {assertManagedContext,assertManagedPlanBinding,readManagedContext,refreshManagedContext} from "../graph/execution-context.js";
import {observeCommandSource} from "../graph/observed-command.js";
import {EngineJobs,withEngineJob} from "../cognitive/jobs.js";
import {currentJob,withinJob,withoutJobContext,type JobExecutionContext} from "../cognitive/job-context.js";
import {ComputerControlBindings} from "../server/computer-control.js";
import {getSessionContext,withSessionContext,type SessionContext} from "../server/session-context.js";
import {reserveExecutionAction,reviewExecutionAction} from "../server/execution-policy.js";
import {SessionAuthority} from "../server/session-authority.js";
import {negotiateComputerCapability} from "./capabilities.js";
import {ComputerLimitsSchema,type ComputerJournal} from "./journal-schema.js";
import {computerDigest,computerRegistrationDigest,prepareComputerAction,readComputerJournal,readyComputerJournal,recordComputerObservation,registerComputerJournal,settleComputerAction,stopComputerJournal,pauseComputerJournal,resumeComputerJournal} from "./journal.js";
import type {ComputerAction,ComputerWorkerObservation,ComputerWorkerPort} from "./worker-port.js";
import type {ResolvedRolePolicy} from "../config/role-policy.js";
const active=new Map<string,ComputerExecutionBroker>();
const key=(context:SessionContext,executionId:string,sessionId:string)=>computerDigest([context.directory,context.principal,context.session_id,executionId,sessionId]);
export interface ComputerSessionInput {
  id:string;execution_id:string;grant_id:string;target:z.infer<typeof ComputerTargetSchema>;
  settings:{enabled:boolean;route:"auto"|"native_cli"|"dreamgraph_harness"};
  adapter_kind:"native_api"|"native_cli";adapter:string;adapter_version:string;
  requested:ComputerAction["operation"][];limits:z.infer<typeof ComputerLimitsSchema>;
  /** Immutable operator/configured profile, never a model-inferred effect class. */
  profile:{hash:string;postconditions:string[];project_workspace?:string};
  budget:ResourceBudget;
  /** Trusted original pass binding, not a model- or HTTP-supplied policy. */
  model_policy?:Readonly<ResolvedRolePolicy>;
}
export class ComputerExecutionBroker {
  private controller=new AbortController();private controls:ComputerControlBindings;private jobs:EngineJobs;
  private signal!:AbortSignal;private bound?:{id:string;signal:AbortSignal;fence:number};
  private stopping?:Promise<void>;private inflight=false;private opened=false;
  private pausing?:Promise<void>;private resuming?:Promise<void>;private pauseRequested=false;
  private pauseFence?:number;private resumeFence?:number;
  private boundary?:{promise:Promise<void>;resolve:()=>void};private resumed?:{promise:Promise<void>;resolve:()=>void};
  private latest?:Awaited<ReturnType<ComputerExecutionBroker["observed"]>>;
  private removers:Array<()=>void>=[];
  private constructor(private context:SessionContext,private job:JobExecutionContext,private authority:SessionAuthority,
    private worker:ComputerWorkerPort,private input:ComputerSessionInput){this.controls=new ComputerControlBindings(authority);this.jobs=new EngineJobs(context.directory);}
  static async open(input:ComputerSessionInput,worker:ComputerWorkerPort,authority:SessionAuthority,allowDeclaredFixture=false){
    const context=getSessionContext(),job=currentJob();
    if(!context?.execution_policy||context.execution_policy.id!==input.execution_id||!job)throw new Error("COMPUTER_ORIGINAL_EXECUTION_JOB_REQUIRED");
    await assertManagedContext(input.execution_id);await job.assert_current();
    const limits=ComputerLimitsSchema.parse(input.limits),target=ComputerTargetSchema.parse(input.target),entry=await readManagedContext(input.execution_id);
    if(input.profile.hash!==worker.probe.profile_hash)throw new Error("COMPUTER_WORKER_PROFILE_PIN_REJECTED");
    const grant=await authority.assertGrant(context,input.grant_id,input.execution_id,target.id,"computer_observe");
    await authority.assertGrant(context,input.grant_id,input.execution_id,target.id,`computer_profile:${input.profile.hash}`);
    await authority.assertGrant(context,input.grant_id,input.execution_id,target.id,`computer_backend:${worker.qualification.source_hash}`);
    if(input.requested.some(operation=>operation!=="observe"))await authority.assertGrant(context,input.grant_id,input.execution_id,target.id,"computer_interact");
    if(authority.instance_id!==entry.instance_id||target.instance_id!==entry.instance_id||target.session_id!==context.session_id||target.host_id!==worker.probe.host_id
      ||Date.parse(limits.expires_at)>Date.parse(grant.expires_at)||Date.parse(limits.expires_at)>Date.parse(context.execution_policy.ceiling_at)
      ||Date.parse(limits.expires_at)>Date.now()+job.parent_admission.budget.elapsed_ms)throw new Error("COMPUTER_SESSION_SCOPE_DEADLINE_REJECTED");
    const capability=negotiateComputerCapability({...input.settings,selected_route:input.settings.route,adapter_kind:input.adapter_kind,
      adapter:input.adapter,adapter_version:input.adapter_version,requested:input.requested,probe:worker.probe,qualification:worker.qualification,allow_declared_fixture:allowDeclaredFixture});
    if(capability.route==="unavailable")throw new Error("COMPUTER_CAPABILITY_UNAVAILABLE: "+capability.reasons.join(","));
    const identity=key(context,input.execution_id,input.id),existing=active.get(identity);
    if(existing){if(computerDigest(existing.input)!==computerDigest(input))throw new Error("COMPUTER_SESSION_IDENTITY_CONFLICT");return existing;}
    if(active.size>=128)throw new Error("COMPUTER_SESSION_CAPACITY");
    const now=new Date().toISOString(),value:Omit<ComputerJournal,"intent_hash">={session:{schema:"dreamgraph.computer_session.v1",id:input.id,instance_id:entry.instance_id,
      session_id:context.session_id,execution_id:entry.id,job_id:job.id,owner:context.principal,host_id:worker.probe.host_id,target_ids:[target.id],grant_id:grant.id,
      capability_id:capability.id,fence:0,policy_revision:context.execution_policy.revision,state:"created",created_at:now,updated_at:now,terminal_reason:null},targets:[target],
      capability,profile_hash:input.profile.hash,worker_epoch:worker.probe.epoch,limits,stop_state:"not_requested",pause_state:"not_requested",observations:[],actions:[],usage:{actions:0,images:0,image_bytes:0,observation_bytes:0}};
    const registration=await registerComputerJournal(entry.id,{...value,intent_hash:computerRegistrationDigest(value)});
    if(registration.replayed)throw new Error("COMPUTER_ORIGINAL_WORKER_RECOVERY_REQUIRED");
    const broker=new ComputerExecutionBroker(context,job,authority,worker,structuredClone(input));active.set(identity,broker);
    broker.signal=AbortSignal.any([broker.controller.signal,job.signal,context.execution_policy.signal]);
    broker.removers.push(await authority.onGrantRevoked(async id=>{if(id===input.grant_id)await broker.stop("COMPUTER_GRANT_REVOKED");}));
    for(const signal of [job.signal,context.execution_policy.signal]){const abort=()=>{void broker.stop("COMPUTER_EXECUTION_CANCELLED").catch(()=>undefined);};
      signal.addEventListener("abort",abort,{once:true});broker.removers.push(()=>signal.removeEventListener("abort",abort));}
    try{
      await broker.jobs.beginExternalEffect(job.id,job.fence,{id:`computer-lifetime:${input.id}`,kind:"computer_lifetime",target:target.id,payload_hash:registration.journal.intent_hash});
      broker.opened=true;broker.signal.throwIfAborted();await worker.open(target,broker.signal);broker.signal.throwIfAborted();
      const ready=await readyComputerJournal(entry.id,input.id,worker.probe.epoch);
      broker.bound=await broker.controls.bind(context,{session:ready.session,target,capability:input.requested.some(operation=>operation!=="observe")?"computer_interact":"computer_observe",
        independently_stoppable:worker.probe.independent_stop,stop:()=>broker.stopPhysical()});
      broker.signal=AbortSignal.any([broker.signal,broker.bound.signal]);broker.signal.throwIfAborted();return broker;
    }catch(error){await broker.stop("COMPUTER_OPEN_FAILED");throw error;}
  }
  private bookkeeping<T>(work:()=>Promise<T>):Promise<T>{return withoutJobContext(()=>withSessionContext(this.context,work));}
  private async stopPhysical(){
    this.controller.abort(new Error("COMPUTER_LOCAL_STOP"));let timer:NodeJS.Timeout|undefined,releaseTimer:NodeJS.Timeout|undefined,inputReleased=false;
    const local=Promise.resolve().then(()=>this.worker.stop());
    const physical=Promise.race([local,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error("COMPUTER_LOCAL_STOP_TIMEOUT")),5000);})]);
    void physical.catch(()=>undefined);
    try{
      const released=await Promise.race([this.worker.releaseInput?this.worker.releaseInput():local,new Promise<never>((_,reject)=>{releaseTimer=setTimeout(()=>reject(new Error('COMPUTER_INPUT_RELEASE_TIMEOUT')),1000);})]);
      clearTimeout(releaseTimer);
      if(released.epoch!==this.worker.probe.epoch||!released.input_released)throw new Error('COMPUTER_INPUT_RELEASE_NOT_PROVED');
      inputReleased=true;
      await this.bookkeeping(()=>stopComputerJournal(this.input.execution_id,this.input.id,"requested","COMPUTER_INPUT_RELEASED_TERMINATION_PENDING"));
      const proof=await physical;
      if(proof.epoch!==this.worker.probe.epoch||!proof.input_released||!proof.terminated)throw new Error("COMPUTER_STOP_NOT_PROVED");
      await this.bookkeeping(async()=>{await stopComputerJournal(this.input.execution_id,this.input.id,"acknowledged","COMPUTER_STOP_ACKNOWLEDGED");
        if(this.opened)await this.jobs.settleExternalEffect(this.job.id,`computer-lifetime:${this.input.id}`,true,`computer-stop:${this.input.id}:${proof.epoch}`);});
    }catch(error){await this.bookkeeping(()=>stopComputerJournal(this.input.execution_id,this.input.id,"unknown",inputReleased?"COMPUTER_TERMINATION_UNCONFIRMED":"COMPUTER_INPUT_RELEASE_UNCONFIRMED"));throw error;}
    finally{clearTimeout(timer);clearTimeout(releaseTimer);}
  }
  async stop(reason="COMPUTER_OPERATOR_STOP"){
    if(!/^COMPUTER_[A-Z0-9_]{1,120}$/.test(reason))throw new Error("COMPUTER_STOP_REASON_INVALID");
    if(this.stopping)return this.stopping;
    // Revoke dispatch and start the independent local channel before any possibly blocked graph write.
    this.controller.abort(new Error(reason));const physical=this.bound?this.controls.stop(this.context,this.bound.id):this.stopPhysical();
    this.stopping=(async()=>{try{await physical;}finally{
      for(const remove of this.removers.splice(0))remove();
      const state=await this.bookkeeping(()=>readComputerJournal(this.input.execution_id,this.input.id));
      if(state.stop_state==="acknowledged")active.delete(key(this.context,this.input.execution_id,this.input.id));
    }})();return this.stopping;
  }
  private async admit(){this.signal.throwIfAborted();if(this.pauseRequested)throw new Error("COMPUTER_SESSION_PAUSED");await this.job.assert_current();await assertManagedContext(this.input.execution_id);
    await this.authority.assertGrant(this.context,this.input.grant_id,this.input.execution_id,this.input.target.id,"computer_observe");this.signal.throwIfAborted();}
  private async exclusive<T>(work:()=>Promise<T>){if(this.inflight)throw new Error("COMPUTER_ACTION_ALREADY_INFLIGHT");this.inflight=true;
    let resolve!:()=>void;const boundary={promise:new Promise<void>(done=>resolve=done),resolve:()=>resolve()};this.boundary=boundary;
    try{return await withSessionContext(this.context,()=>withinJob(this.job,work));}finally{this.inflight=false;boundary.resolve();if(this.boundary===boundary)this.boundary=undefined;}}
  private async observed(reply:ComputerWorkerObservation,proof?:{action_id:string;postcondition:string}){
    this.signal.throwIfAborted();const target=ComputerTargetSchema.parse(reply.target);
    if(reply.epoch!==this.worker.probe.epoch||target.id!==this.input.target.id||target.host_id!==this.input.target.host_id
      ||target.instance_id!==this.input.target.instance_id||target.session_id!==this.context.session_id||target.surface!==this.input.target.surface)
      throw new Error("COMPUTER_WORKER_OBSERVATION_OWNER_REJECTED");
    if(typeof reply.summary!=="string"||Buffer.byteLength(reply.summary,"utf8")>this.input.limits.observation_bytes)throw new Error("COMPUTER_OBSERVATION_BYTE_BOUND");
    const images=reply.image?1:0,imageBytes=reply.image?.bytes.byteLength??0;
    if(reply.image&&(!["image/png","image/jpeg"].includes(reply.image.mime_type)||!(reply.image.bytes instanceof Uint8Array)
      ||reply.image.content_hash!=="sha256:"+createHash("sha256").update(reply.image.bytes).digest("hex")))throw new Error("COMPUTER_IMAGE_PROVENANCE_REJECTED");
    const descriptor=ComputerObservationSchema.parse({schema:"dreamgraph.computer_observation.v1",id:`computer-observation:${randomUUID()}`,target_id:target.id,
      target_generation:target.generation,execution_id:this.input.execution_id,kind:proof?"postcondition":reply.kind,observed_at:reply.captured_at,
      expires_at:new Date(Math.min(Date.now()+20_000,Date.parse(this.input.limits.expires_at))).toISOString(),artifact_ref:null,content_hash:reply.content_hash,
      evidence_ids:proof?[computerDigest({action_id:proof.action_id,postcondition_hash:computerDigest(proof.postcondition)})]:[],verified:!!proof});
    const pixels=reply.image?ComputerObservationSchema.parse({...descriptor,id:`computer-pixels:${randomUUID()}`,kind:"pixels",content_hash:reply.image.content_hash,evidence_ids:[descriptor.id],verified:false}):undefined;
    await recordComputerObservation(this.input.execution_id,this.input.id,descriptor,{bytes:Buffer.byteLength(reply.summary,"utf8"),images,image_bytes:imageBytes},pixels);
    this.controls.updateObservedTarget(this.context,this.input.id,target);
    const value={observation:descriptor,summary:reply.summary,...(reply.image?{image:reply.image,image_observation:pixels}:{})};this.latest=value;return value;
  }
  observe(){return this.exclusive(async()=>{await this.admit();const journal=await readComputerJournal(this.input.execution_id,this.input.id);
    return this.observed(await this.worker.observe(journal.targets[0],this.signal));});}
  act(input:z.input<typeof ComputerActionSchema>){return this.exclusive(async()=>{
    const action=ComputerActionSchema.parse(input),prior=await readComputerJournal(this.input.execution_id,this.input.id);
    const replay=prior.actions.find(item=>item.id===action.id);
    if(replay){if(replay.action_hash!==computerDigest(action))throw new Error("COMPUTER_ACTION_IDENTITY_CONFLICT");return structuredClone(replay.receipt);}
    await this.admit();await this.authority.assertGrant(this.context,this.input.grant_id,this.input.execution_id,this.input.target.id,"computer_interact");
    if(!this.input.profile.postconditions.includes(action.postcondition))throw new Error("COMPUTER_POSTCONDITION_NOT_REVIEWED");
    await this.controls.assertInput(this.context,this.input.id,action.fence,action.target_generation);
    await reviewExecutionAction(this.context.execution_policy,"computer_action",action,this.signal);
    this.signal.throwIfAborted();const release=reserveExecutionAction(this.context.execution_policy,"computer_action",action);
    let dispatched=false,effect=false,sourceSettlementStarted=false,source:Awaited<ReturnType<typeof observeCommandSource>>|undefined;
    let receipt: z.infer<typeof ComputerReceiptSchema>|undefined,terminalReceipt:z.infer<typeof ComputerReceiptSchema>|undefined;
    try{
      await this.admit();const intent=await prepareComputerAction(this.input.execution_id,this.input.id,action);receipt=intent.receipt;
      if(intent.replayed)return receipt;
      await this.jobs.beginExternalEffect(this.job.id,this.job.fence,{id:action.id,kind:"computer_action",target:action.target_id,payload_hash:computerDigest(action)});effect=true;
      if(this.input.profile.project_workspace)source=await observeCommandSource({execution_id:this.input.execution_id,workspace:this.input.profile.project_workspace,before_intent:()=>this.admit()});
      // This dispatch alone owns the newly recorded source intent, as with scoped commands.
      // Re-running generic freshness after that intent would reject its deliberately unknown footprint.
      if(source){this.signal.throwIfAborted();await this.job.assert_current();await assertManagedPlanBinding(await readManagedContext(this.input.execution_id),this.signal);
        await this.authority.assertGrant(this.context,this.input.grant_id,this.input.execution_id,this.input.target.id,"computer_interact");}
      else await this.admit();
      await this.authority.assertGrant(this.context,this.input.grant_id,this.input.execution_id,this.input.target.id,"computer_interact");
      await this.controls.assertInput(this.context,this.input.id,action.fence,action.target_generation);
      if(this.pauseRequested)throw new Error("COMPUTER_SESSION_PAUSED");
      dispatched=true;const reply=await this.worker.act(action,this.signal);this.signal.throwIfAborted();
      const observed=await this.observed(reply.observation,reply.input_delivered&&reply.postcondition_met?{action_id:action.id,postcondition:action.postcondition}:undefined);
      const settled=ComputerReceiptSchema.parse({...receipt,state:!reply.input_delivered?"cancelled":reply.postcondition_met?"verified":"failed",
        observation_ids:reply.input_delivered&&reply.postcondition_met?[observed.observation.id]:[],observed_at:new Date().toISOString(),
        reason:!reply.input_delivered?"COMPUTER_INPUT_NOT_DELIVERED":reply.postcondition_met?null:"COMPUTER_POSTCONDITION_FAILED"});
      terminalReceipt=await settleComputerAction(this.input.execution_id,this.input.id,settled);
      await this.jobs.settleExternalEffect(this.job.id,action.id,true,computerDigest(settled));
      if(source){sourceSettlementStarted=true;await source.settle(true);}return settled;
    }catch(error){
      await this.bookkeeping(async()=>{if(receipt&&!terminalReceipt){const unknown={...receipt,state:dispatched?"unknown" as const:"cancelled" as const,
          reason:dispatched?"COMPUTER_EFFECT_UNKNOWN":"COMPUTER_INPUT_NOT_DISPATCHED",observed_at:new Date().toISOString()};
        await settleComputerAction(this.input.execution_id,this.input.id,unknown);
        const stored=(await this.jobs.inspect()).records.find(record=>record.job.id===this.job.id)?.external_effects.find(item=>item.id===action.id);
        if(effect||stored?.payload_hash===computerDigest(action))await this.jobs.settleExternalEffect(this.job.id,action.id,!dispatched,computerDigest(unknown));}
        if(source&&!sourceSettlementStarted)await source.settle(!dispatched);});throw error;
    }finally{release?.();}
  });}
  async status(){return this.bookkeeping(()=>readComputerJournal(this.input.execution_id,this.input.id));}
  get executionSignal(){return this.signal;}
  get pauseSupported(){return !!this.worker.pause&&!!this.worker.resume;}
  private originalOperator(){const context=getSessionContext();if(!context||context.execution_policy||key(context,this.input.execution_id,this.input.id)!==key(this.context,this.input.execution_id,this.input.id))throw new Error("COMPUTER_OPERATOR_SESSION_REQUIRED");}
  private async waitFor<T>(pending:Promise<T>,signal=this.signal):Promise<T>{signal.throwIfAborted();return new Promise((resolve,reject)=>{
    const abort=()=>reject(signal.reason??new Error("COMPUTER_EXECUTION_CANCELLED"));signal.addEventListener("abort",abort,{once:true});
    pending.then(resolve,reject).finally(()=>signal.removeEventListener("abort",abort));if(signal.aborted)abort();});}
  /** Native host waits here before another model call; elapsed/grant/job budgets continue during pause. */
  async awaitReady(){this.signal.throwIfAborted();if(this.pauseRequested&&this.resumed)await this.waitFor(this.resumed.promise);this.signal.throwIfAborted();}
  async pause(fence:number){this.originalOperator();if(!this.pauseSupported)throw new Error("COMPUTER_PAUSE_UNSUPPORTED");this.signal.throwIfAborted();
    const current=await this.status();if(this.pausing&&this.pauseFence===fence)return this.pausing;
    if(current.session.fence!==fence||this.pauseRequested||current.stop_state!=="not_requested")throw new Error("COMPUTER_CONTROL_FENCE_REJECTED");
    this.controls.pause(this.context,this.input.id);this.pauseFence=fence;
    this.pauseRequested=true;let resolve!:()=>void;this.resumed={promise:new Promise<void>(done=>resolve=done),resolve:()=>resolve()};this.latest=undefined;
    this.pausing=(async()=>{try{await this.bookkeeping(()=>pauseComputerJournal(this.input.execution_id,this.input.id,"requested"));
      if(this.boundary)await this.waitFor(this.boundary.promise);this.signal.throwIfAborted();
      // Draining an admitted atomic action uses its original deadline. Once the
      // boundary is reached, a responsive pause acknowledgement has its own cap.
      const timeout=new AbortController(),timer=setTimeout(()=>timeout.abort(new Error("COMPUTER_PAUSE_TIMEOUT")),1000);
      let proof:Awaited<ReturnType<NonNullable<ComputerWorkerPort["pause"]>>>;
      try{proof=await this.waitFor(this.worker.pause!(),AbortSignal.any([this.signal,timeout.signal]));}finally{clearTimeout(timer);}
      if(proof.epoch!==this.worker.probe.epoch||!proof.input_released||!proof.paused)throw new Error("COMPUTER_PAUSE_UNCONFIRMED");
      await this.bookkeeping(()=>pauseComputerJournal(this.input.execution_id,this.input.id,"acknowledged"));
    }catch(error){if(!this.signal.aborted){await this.bookkeeping(()=>pauseComputerJournal(this.input.execution_id,this.input.id,"unknown"));await this.stop("COMPUTER_PAUSE_UNKNOWN");}throw error;}})();return this.pausing;
  }
  async resume(fence:number){this.originalOperator();if(!this.pauseSupported)throw new Error("COMPUTER_RESUME_STATE_REJECTED");this.signal.throwIfAborted();const current=await this.status();
    if(this.resuming&&this.resumeFence===fence)return this.resuming;
    if(!this.pauseRequested&&this.resumeFence===fence&&current.session.fence===fence+1)return;
    if(!this.pauseRequested||!this.pausing||current.session.fence!==fence||current.pause_state!=="acknowledged")throw new Error("COMPUTER_CONTROL_FENCE_REJECTED");
    this.resumeFence=fence;
    this.resuming=(async()=>{try{await this.waitFor(this.pausing!);await this.job.assert_current();
      await this.authority.assertGrant(this.context,this.input.grant_id,this.input.execution_id,this.input.target.id,this.input.requested.some(op=>op!=="observe")?"computer_interact":"computer_observe");
      await this.bookkeeping(()=>refreshManagedContext(this.input.execution_id));const prior=await this.status(),observed=await this.waitFor(this.worker.resume!(prior.targets[0],this.signal));
      if(observed.epoch!==this.worker.probe.epoch||observed.target.generation<=prior.targets[0].generation)throw new Error("COMPUTER_RESUME_OBSERVATION_REJECTED");
      const ready=await this.bookkeeping(()=>resumeComputerJournal(this.input.execution_id,this.input.id,this.worker.probe.epoch));this.controls.resume(this.context,this.input.id,ready.session.fence);
      await this.observed(observed);this.pauseRequested=false;this.pausing=undefined;this.resumed?.resolve();this.resumed=undefined;
    }catch(error){await this.stop("COMPUTER_RESUME_FAILED");throw error;}finally{this.resuming=undefined;}})();return this.resuming;
  }
  /** Ephemeral original-session inspection. Never revive expired evidence into input coordinates. */
  inspectLatestObservation(){const context=getSessionContext();if(!context||key(context,this.input.execution_id,this.input.id)!==key(this.context,this.input.execution_id,this.input.id))throw new Error("COMPUTER_OBSERVATION_OWNER_REJECTED");
    return this.latest?structuredClone({...this.latest,expired:Date.parse(this.latest.observation.expires_at)<=Date.now()}):null;}
  /** Re-observe only the original independent stop channel; never reopen a worker or replay input. */
  async recoverStop(){const context=getSessionContext();if(!context||key(context,this.input.execution_id,this.input.id)!==key(this.context,this.input.execution_id,this.input.id))
      throw new Error("COMPUTER_STOP_RECOVERY_OWNER_REJECTED");
    await this.stopPhysical();active.delete(key(this.context,this.input.execution_id,this.input.id));
    const record=(await this.jobs.inspect()).records.find(item=>item.job.id===this.job.id);
    if(record?.work_settled)await this.jobs.reconcileSettled(this.job.id,record.job.fence);return this.status();}
}
export function activeComputerBroker(executionId:string,sessionId:string){const context=getSessionContext();if(!context)throw new Error("COMPUTER_OPERATOR_SESSION_REQUIRED");
  return active.get(key(context,executionId,sessionId));}
/** The caller's native agent runtime owns work; optional cognition keeps the same parent ledger. */
export async function withComputerSession<T>(input:ComputerSessionInput,worker:ComputerWorkerPort,authority:SessionAuthority,
  work:(broker:ComputerExecutionBroker)=>Promise<T>,options:{signal?:AbortSignal;allow_declared_fixture?:boolean}={}){
  const context=getSessionContext();if(!context?.execution_policy||context.execution_policy.id!==input.execution_id)throw new Error("COMPUTER_HOST_EXECUTION_REQUIRED");
  return withEngineJob({operation_id:`computer-session:${input.execution_id}:${input.id}`,action:"computer_session",owner:context.principal,
    scope:[`execution:${input.execution_id}`,input.target.id],session_id:context.session_id,execution_id:input.execution_id,lifetime:"session_bound",
    lanes:[`computer:${input.target.host_id}:${worker.probe.isolated?input.id:"physical-seat"}`],parameters:{computer_id:input.id,target_id:input.target.id,profile_hash:input.profile.hash,model_policy_fingerprint:input.model_policy?.fingerprint??null},
    role_policies:input.model_policy?{[input.model_policy.policy.role]:input.model_policy}:{},budget:input.budget,timeout_ms:Math.max(1,Math.min(input.budget.elapsed_ms,Date.parse(input.limits.expires_at)-Date.now())),
    authority:{id:context.execution_policy.id,revision:context.execution_policy.revision,scope:[input.target.id],expires_at:context.execution_policy.ceiling_at,autonomy:context.execution_policy.autonomy}},async()=>{
      const broker=await ComputerExecutionBroker.open(input,worker,authority,options.allow_declared_fixture);
      try{return await work(broker);}finally{await broker.stop("COMPUTER_TASK_BOUNDARY_STOP");}
    },options.signal);
}
