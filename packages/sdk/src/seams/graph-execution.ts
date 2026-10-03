import {z} from "zod";
import {ContextPackSchema,ManagedExecutionRequestSchema,ManagedExecutionSnapshotSchema,
  ManagedExecutionApprovalRequestSchema,type ManagedExecutionApprovalRequest,
  type ContextPack,type ManagedExecutionRequest,type ManagedExecutionSnapshot} from "../graph-contracts.js";
import {ManagedModelAdmissionRequestSchema,ManagedModelPermitSchema,ManagedModelSettlementSchema,ManagedModelOutcomeSchema,
  type ManagedModelAdmissionRequest,type ManagedModelSettlement,type ManagedModelPermit,type ManagedModelOutcome} from '../graph-contracts.js';
import {ComputerOperatorPageSchema,ComputerOperatorStatusSchema,verifyComputerEvidence,COMPUTER_EVIDENCE_MAX_RESPONSE_BYTES,type ComputerOperatorSnapshot} from './computer-control.js';
import {NativeComputerSetupSchema,NativeComputerPrepareRequestSchema,NativeComputerPreparationSchema,NativeComputerConfirmationSchema,NativeComputerCancellationSchema,
 NativeComputerPassRequestSchema,NativeComputerPassReplySchema,type NativeComputerPassRequest} from './computer-pass.js';

export interface HostExecutionLease { execution:ManagedExecutionSnapshot; workerBearer:string; controls:unknown }
export interface HostExecutionApproval { execution:ManagedExecutionSnapshot; approvalId:string; reviewPolicyRevision:string; controls:unknown; replayed:boolean; reviewActivated:boolean }
export interface HostExecutionReviews { execution_id:string; authority_active:boolean; review_enabled:boolean; requests:ManagedExecutionApprovalRequest[] }
/** Original-host accounting only. Not exposed in PluginContext or to an execution worker. */
export interface ModelAdmissionPort {
  admitModel(request:ManagedModelAdmissionRequest,signal?:AbortSignal):Promise<ManagedModelPermit>;
  settleModel(request:ManagedModelSettlement,signal?:AbortSignal):Promise<ManagedModelOutcome>;
  readModel(execution_id:string,request_id:string,signal?:AbortSignal):Promise<ManagedModelOutcome>;
  observeModelStop?(request:ManagedModelSettlement,signal?:AbortSignal):Promise<ManagedExecutionSnapshot>;
}
/** A host transport port. Delivery proves handoff, not model understanding or private effects. */
export interface GraphExecutionPort {
  begin(request:ManagedExecutionRequest,signal?:AbortSignal):Promise<HostExecutionLease>;
  read(execution_id:string,signal?:AbortSignal):Promise<ManagedExecutionSnapshot>;
  approve(request:ManagedExecutionApprovalRequest,signal?:AbortSignal):Promise<HostExecutionApproval>;
  openReviews(execution_id:string,signal?:AbortSignal):Promise<HostExecutionReviews>;
  readReviews(execution_id:string,signal?:AbortSignal):Promise<HostExecutionReviews>;
  declineReview(execution_id:string,approval_id:string,signal?:AbortSignal):Promise<{execution_id:string;approval_id:string;status:"declined"|"not_pending"}>;
  refresh(workerBearer:string,signal?:AbortSignal):Promise<{block:string;pack:ContextPack}>;
  deliver(workerBearer:string,receipt_id:string,block:string,signal?:AbortSignal):Promise<void>;
  finish(execution_id:string,outcome:"completed"|"cancelled"|"failed",work_termination:"confirmed"|"unconfirmed",signal?:AbortSignal):Promise<ManagedExecutionSnapshot>;
}
const leaseSchema=z.object({execution:ManagedExecutionSnapshotSchema,worker_bearer:z.string().regex(/^dgexec\.[A-Za-z0-9_-]{43}$/),controls:z.unknown()}).strict();
const refreshSchema=z.object({receipt_id:z.string(),block:z.string().max(65536),delivery:z.literal("unattested"),pack:ContextPackSchema,
  status:z.literal("running"),record_revision:z.number().int().nonnegative()}).strict();
const finishSchema=z.object({execution:ManagedExecutionSnapshotSchema,adapter_outcome:z.enum(["completed","cancelled","failed"]),work_termination:z.enum(["confirmed","unconfirmed"])}).strict();
const approvalSchema=z.object({execution:ManagedExecutionSnapshotSchema,approval_id:z.string(),review_policy_revision:z.string(),controls:z.unknown(),replayed:z.boolean(),review_activated:z.boolean()}).strict();
const reviewsSchema=z.object({execution_id:z.string(),authority_active:z.boolean(),review_enabled:z.boolean(),requests:z.array(ManagedExecutionApprovalRequestSchema).max(1)}).strict();
/** Portable fetch transport. Credentials stay in memory; no CLI/API continuation or provider assumptions. */
export class ManagedExecutionClient implements GraphExecutionPort, ModelAdmissionPort {
  private readonly base:string;
  private session?:string;
  private initialization?:Promise<void>;
  private readonly pending=new Set<AbortController>();
  private disposed=false;
  private readonly options:{baseUrl:string;authorization?:string;sessionBearer?:string;timeoutMs?:number;fetch?:typeof globalThis.fetch};
  constructor(options:{baseUrl:string;authorization?:string;sessionBearer?:string;timeoutMs?:number;fetch?:typeof globalThis.fetch}) {
    const url=new URL(options.baseUrl);
    if(!["http:","https:"].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error("EXECUTION_ENDPOINT_INVALID");
    this.base=url.toString().replace(/\/$/,"");
    if(options.timeoutMs!==undefined&&(!Number.isSafeInteger(options.timeoutMs)||options.timeoutMs<1||options.timeoutMs>300000))throw new Error("EXECUTION_REQUEST_TIMEOUT_INVALID");
    this.options={...options};
    if(options.sessionBearer){if(options.sessionBearer.startsWith('dgexec.')||options.sessionBearer.length>2048)throw new Error('EXECUTION_OPERATOR_SESSION_REQUIRED');this.session=options.sessionBearer;}
  }
  private async request(route:string,input?:unknown,signal?:AbortSignal,workerBearer?:string):Promise<unknown> {
    if(this.disposed)throw new Error("EXECUTION_CLIENT_DISPOSED");signal?.throwIfAborted();
    const controller=new AbortController();this.pending.add(controller);
    const timeout=setTimeout(()=>controller.abort(new Error("EXECUTION_REQUEST_TIMEOUT")),this.options.timeoutMs??(route==='/api/executions/v1/computer-pass'?300000:10000));
    try{
      const payload=input===undefined?undefined:JSON.stringify(input);
      const maximumBytes=route==='/api/executions/v1/model/admit'?16*1024*1024+65536:128*1024;
      if(payload && new TextEncoder().encode(payload).length>maximumBytes)throw new Error("EXECUTION_REQUEST_BYTE_BOUND");
      const response=await (this.options.fetch??globalThis.fetch)(this.base+route,{method:input===undefined?"GET":"POST",
        headers:{...(payload?{"Content-Type":"application/json"}:{}),...(this.options.authorization?{Authorization:`Bearer ${this.options.authorization}`} : {}),
          ...(workerBearer||this.session?{"X-DreamGraph-Session":workerBearer??this.session!}: {})},body:payload,
        signal:signal?AbortSignal.any([controller.signal,signal]):controller.signal});
      controller.signal.throwIfAborted();signal?.throwIfAborted();
      if(this.disposed)throw new Error("EXECUTION_CLIENT_DISPOSED");
      const session=response.headers.get("X-DreamGraph-Session");if(!workerBearer&&session&&!this.session)this.session=session;
      const chunks:Uint8Array[]=[];let size=0;
      if(response.body){const reader=response.body.getReader();try{for(;;){const next=await reader.read();if(next.done)break;size+=next.value.length;
        if(size>(route==='/api/executions/v1/computer-pass'?8*1024*1024:route.startsWith('/api/executions/v1/computer-evidence/')?COMPUTER_EVIDENCE_MAX_RESPONSE_BYTES:256*1024)){controller.abort();throw new Error("EXECUTION_RESPONSE_BYTE_BOUND");}chunks.push(next.value);}}finally{reader.releaseLock();}}
      const content=new Uint8Array(size);let offset=0;for(const chunk of chunks){content.set(chunk,offset);offset+=chunk.length;}
      controller.signal.throwIfAborted();signal?.throwIfAborted();
      if(this.disposed)throw new Error("EXECUTION_CLIENT_DISPOSED");
      const text=new TextDecoder("utf-8",{fatal:true}).decode(content);
      if(!response.ok)throw new Error(`EXECUTION_REQUEST_REJECTED: HTTP ${response.status}: ${text}`);
      return JSON.parse(text);
    }finally{clearTimeout(timeout);this.pending.delete(controller);}
  }
  private async initialize(signal?:AbortSignal) {
    if(this.disposed)throw new Error("EXECUTION_CLIENT_DISPOSED");
    signal?.throwIfAborted();
    if(!this.session){
      if(!this.initialization){this.initialization=this.request("/api/authority/v1/status").then(()=>{if(!this.session)throw new Error("EXECUTION_SESSION_UNAVAILABLE");});
        const pending=this.initialization;void pending.finally(()=>{if(this.initialization===pending)this.initialization=undefined;}).catch(()=>undefined);}
      // Cancels only this caller's wait; shared transport termination is not implied.
      await this.waitForInitialization(this.initialization,signal);
    }
    signal?.throwIfAborted();
    if(this.disposed)throw new Error("EXECUTION_CLIENT_DISPOSED");
  }
  private async waitForInitialization(pending:Promise<void>,signal?:AbortSignal) {
    if(!signal)return pending;
    signal.throwIfAborted();
    await new Promise<void>((resolve,reject)=>{
      const abort=()=>{signal.removeEventListener("abort",abort);reject(signal.reason??new Error("EXECUTION_SESSION_WAIT_CANCELLED"));};
      signal.addEventListener("abort",abort,{once:true});
      pending.then(resolve,reject).finally(()=>signal.removeEventListener("abort",abort));
      if(signal.aborted)abort();
    });
  }
  async begin(request:ManagedExecutionRequest,signal?:AbortSignal):Promise<HostExecutionLease> {
    const captured=JSON.parse(JSON.stringify(ManagedExecutionRequestSchema.parse(request)));
    await this.initialize(signal);const result=leaseSchema.parse(await this.request("/api/executions/v1/begin",captured,signal));
    if(captured.plan_execution && (!result.execution.plan_execution
      || JSON.stringify(result.execution.plan_execution.intent)!==JSON.stringify(captured.plan_execution)
      || !result.execution.plan_execution.state.leases.some(lease=>lease.execution_id===captured.id&&lease.state==="running")))
      throw new Error(`PLAN_EXECUTION_CONTRACT_NOT_ACKNOWLEDGED: ${captured.id}; inspect the original execution before recovery`);
    return {execution:result.execution,workerBearer:result.worker_bearer,controls:result.controls};
  }
  get baseUrl(){return this.base;}
  async readComputerPassSetup(signal?:AbortSignal){await this.initialize(signal);return NativeComputerSetupSchema.parse(await this.request('/api/executions/v1/computer-preparation/setup',undefined,signal));}
  async prepareComputerPass(input:{interact:boolean;duration_ms:number},signal?:AbortSignal){
    const captured=NativeComputerPrepareRequestSchema.parse(input);await this.initialize(signal);
    return NativeComputerPreparationSchema.parse(z.object({ok:z.literal(true),result:NativeComputerPreparationSchema}).strict().parse(
      await this.request('/api/executions/v1/computer-preparation/prepare',captured,signal)).result);
  }
  async confirmComputerPass(id:string,signal?:AbortSignal){
    const captured=z.string().uuid().parse(id);await this.initialize(signal);
    const result=z.object({ok:z.literal(true),result:NativeComputerConfirmationSchema}).strict().parse(
      await this.request('/api/executions/v1/computer-preparation/confirm',{id:captured,human_confirmed:true},signal)).result;
    if(result.id!==captured)throw new Error('COMPUTER_CONFIRMATION_REPLY_OWNER_MISMATCH');return result;
  }
  async runComputerPass(request:NativeComputerPassRequest,executionId:string,signal?:AbortSignal){
    const captured=NativeComputerPassRequestSchema.parse(structuredClone(request));await this.initialize(signal);
    const reply=NativeComputerPassReplySchema.parse(await this.request('/api/executions/v1/computer-pass',captured,signal));
    if(reply.execution_id!==executionId||reply.execution.execution_id!==executionId)throw new Error('COMPUTER_PASS_REPLY_OWNER_MISMATCH');return reply;
  }
  async cancelComputerPass(id:string,signal?:AbortSignal){const captured=z.string().uuid().parse(id);await this.initialize(signal);
    const result=z.object({ok:z.literal(true),result:NativeComputerCancellationSchema}).strict().parse(
      await this.request('/api/executions/v1/computer-preparation/cancel',{id:captured},signal)).result;
    if(result.id!==captured)throw new Error('COMPUTER_CANCELLATION_REPLY_OWNER_MISMATCH');return result;
  }
  async readComputerEvidence(executionId:string,id:string,signal?:AbortSignal){
    await this.initialize(signal);const evidence=await verifyComputerEvidence(await this.request('/api/executions/v1/computer-evidence/observation?'+new URLSearchParams({execution_id:executionId,id}),undefined,signal));
    signal?.throwIfAborted();if(this.disposed)throw new Error('EXECUTION_CLIENT_DISPOSED');
    if(evidence.execution_id!==executionId||evidence.computer_session_id!==id)throw new Error('COMPUTER_EVIDENCE_REPLY_OWNER_MISMATCH');return evidence;
  }
  async listComputerSessions(page?:{cursor:string;snapshot_hash:string},signal?:AbortSignal) {
    const query=new URLSearchParams({limit:'16',...page});await this.initialize(signal);
    return ComputerOperatorPageSchema.parse(await this.request('/api/executions/v1/computer/sessions?'+query,undefined,signal));
  }
  async readComputerStatus(executionId:string,id:string,signal?:AbortSignal):Promise<ComputerOperatorSnapshot> {
    await this.initialize(signal);const value=ComputerOperatorStatusSchema.parse(await this.request('/api/executions/v1/computer/status?'+new URLSearchParams({execution_id:executionId,id}),undefined,signal));
    if(value.session.execution_id!==executionId||value.session.id!==id)throw new Error('COMPUTER_CONTROL_REPLY_OWNER_MISMATCH');const {ok,...snapshot}=value;return snapshot;
  }
  async controlComputer(executionId:string,id:string,action:'pause'|'resume'|'stop'|'recover-stop',fence?:number,signal?:AbortSignal):Promise<ComputerOperatorSnapshot> {
    if(!['pause','resume','stop','recover-stop'].includes(action))throw new Error('COMPUTER_CONTROL_ACTION_INVALID');
    const input={execution_id:executionId,id,...(action==='pause'||action==='resume'?{fence}:{})};await this.initialize(signal);
    const value=ComputerOperatorStatusSchema.parse(await this.request('/api/executions/v1/computer/'+action,input,signal));
    if(value.session.execution_id!==executionId||value.session.id!==id)throw new Error('COMPUTER_CONTROL_REPLY_OWNER_MISMATCH');const {ok,...snapshot}=value;return snapshot;
  }
  async read(execution_id:string,signal?:AbortSignal) {
    await this.initialize(signal);return ManagedExecutionSnapshotSchema.parse(await this.request("/api/executions/v1/read",{execution_id},signal));
  }
  async approve(request:ManagedExecutionApprovalRequest,signal?:AbortSignal):Promise<HostExecutionApproval> {
    const reviewed=JSON.parse(JSON.stringify(ManagedExecutionApprovalRequestSchema.parse(request)));
    await this.initialize(signal);
    const result=approvalSchema.parse(await this.request("/api/executions/v1/approve",reviewed,signal));
    if(result.approval_id!==reviewed.approval_id||result.execution.execution_id!==reviewed.execution_id)throw new Error("EXECUTION_APPROVAL_ACKNOWLEDGEMENT_MISMATCH");
    return {execution:result.execution,approvalId:result.approval_id,reviewPolicyRevision:result.review_policy_revision,controls:result.controls,replayed:result.replayed,reviewActivated:result.review_activated};
  }
  private async reviews(execution_id:string,open:boolean,signal?:AbortSignal):Promise<HostExecutionReviews> {
    await this.initialize(signal);
    const result=reviewsSchema.parse(await this.request(`/api/executions/v1/reviews/${open?"open":"read"}`,{execution_id},signal));
    if(result.execution_id!==execution_id||result.requests.some(request=>request.execution_id!==execution_id))throw new Error("EXECUTION_REVIEW_IDENTITY_MISMATCH");
    return result;
  }
  openReviews(execution_id:string,signal?:AbortSignal) {return this.reviews(execution_id,true,signal);}
  readReviews(execution_id:string,signal?:AbortSignal) {return this.reviews(execution_id,false,signal);}
  async declineReview(execution_id:string,approval_id:string,signal?:AbortSignal) {
    await this.initialize(signal);
    const result=z.object({execution_id:z.string(),approval_id:z.string(),status:z.enum(["declined","not_pending"])}).strict().parse(await this.request("/api/executions/v1/reviews/decline",{execution_id,approval_id},signal));
    if(result.execution_id!==execution_id||result.approval_id!==approval_id)throw new Error("EXECUTION_REVIEW_IDENTITY_MISMATCH");
    return result;
  }
  async refresh(workerBearer:string,signal?:AbortSignal) {
    const result=refreshSchema.parse(await this.request("/api/architect/v1/execution/context/refresh",{},signal,workerBearer));
    if(new TextEncoder().encode(result.block).length>65536||result.pack.receipt.id!==result.receipt_id)throw new Error("EXECUTION_CONTEXT_RECEIPT_INVALID");
    return {block:result.block,pack:result.pack};
  }
  async deliver(workerBearer:string,receipt_id:string,block:string,signal?:AbortSignal) {
    const result=z.object({receipt_id:z.string(),delivery:z.literal("delivered")}).strict().parse(await this.request("/api/architect/v1/execution/context/deliver",{receipt_id,block},signal,workerBearer));
    if(result.receipt_id!==receipt_id)throw new Error("EXECUTION_DELIVERY_UNCONFIRMED");
  }
  async finish(execution_id:string,outcome:"completed"|"cancelled"|"failed",work_termination:"confirmed"|"unconfirmed",signal?:AbortSignal) {
    await this.initialize(signal);return finishSchema.parse(await this.request("/api/executions/v1/finish",{execution_id,outcome,work_termination},signal)).execution;
  }
  async admitModel(request:ManagedModelAdmissionRequest,signal?:AbortSignal) {
    const captured=ManagedModelAdmissionRequestSchema.parse(request);await this.initialize(signal);
    const permit=ManagedModelPermitSchema.parse(await this.request('/api/executions/v1/model/admit',captured,signal));
    if(permit.execution_id!==captured.execution_id||permit.request_id!==captured.request_id)throw new Error('MODEL_ADMISSION_IDENTITY_MISMATCH');
    return permit;
  }
  async settleModel(request:ManagedModelSettlement,signal?:AbortSignal) {
    const captured=ManagedModelSettlementSchema.parse(request);await this.initialize(signal);
    const result=ManagedModelOutcomeSchema.parse(await this.request('/api/executions/v1/model/settle',captured,signal));
    if(result.execution_id!==captured.execution_id||result.request_id!==captured.request_id||result.settlement?.attempt_id!==captured.attempt_id)throw new Error('MODEL_SETTLEMENT_IDENTITY_MISMATCH');
    return result;
  }
  async readModel(execution_id:string,request_id:string,signal?:AbortSignal) {
    await this.initialize(signal);
    const result=ManagedModelOutcomeSchema.parse(await this.request('/api/executions/v1/model/read',{execution_id,request_id},signal));
    if(result.execution_id!==execution_id||result.request_id!==request_id)throw new Error('MODEL_OUTCOME_IDENTITY_MISMATCH');
    return result;
  }
  async observeModelStop(request:ManagedModelSettlement,signal?:AbortSignal) {
    const captured=ManagedModelSettlementSchema.parse(copy(request));await this.initialize(signal);
    const result=ManagedExecutionSnapshotSchema.parse(await this.request('/api/executions/v1/model/observe-stop',captured,signal));
    if(result.execution_id!==captured.execution_id||result.authority_active)throw new Error('NATIVE_STOP_RECOVERY_IDENTITY_MISMATCH');
    return result;
  }
  /** Cancels transport waits. It does not assert provider/process termination or daemon rollback. */
  dispose() {this.disposed=true;for(const controller of this.pending)controller.abort(new Error("EXECUTION_CLIENT_DISPOSED"));this.session=undefined;}
}

export interface ExecutionContextHandoff {
  block:string;
  pack:ContextPack;
  /** Initial controls only. Later exact reviews remain enforced by the daemon. */
  initialControls:unknown;
}
export interface ExecutionContextAcknowledgement { receiptId:string; block:string }
/** Trusted adapter input. Never put workerBearer in prompts or PluginContext. */
export interface ExecutionWorker { executionId:string; instanceId:string; workerBearer:string; signal:AbortSignal }
/** Native harness attestation, not inferred from promise settlement or successful prose. */
export interface ExecutionWorkerResult<T> { result:T; workTermination:"confirmed"|"unconfirmed" }
/** Explicit trusted-host observation; callback settlement is not provider termination evidence. */
export interface ExecutionModelResult<T> extends ExecutionWorkerResult<T> {
  usage?:NonNullable<ManagedModelSettlement['usage']>;
  acknowledged:boolean;
}
export interface ExecutionModelWorker extends ExecutionWorker { permit:ManagedModelPermit; request:ManagedModelAdmissionRequest }
type ExecutionOutcome="completed"|"cancelled"|"failed";
type PassPhase="created"|"admitting"|"ready"|"preparing"|"executing"|"uncertain"|"closing"|"closed";
const acknowledgementSchema=z.object({receiptId:z.string(),block:z.string()}).strict();
const copy=<T>(value:T):T=>JSON.parse(JSON.stringify(value));

/**
 * Portable host lifecycle around a native adapter, not a model/CLI protocol.
 * Construct before admission so a lost reply retains the original ID for inspection/closure.
 * Cancellation bounds waiting; it cannot attest ignored signals or private effects stopped.
 */
export class ManagedGraphPass {
  private readonly port:Pick<GraphExecutionPort,"begin"|"read"|"refresh"|"deliver"|"finish">;
  private readonly request:ReturnType<typeof ManagedExecutionRequestSchema.parse>;
  private readonly deadline=new AbortController();
  readonly signal:AbortSignal;
  private timer?:ReturnType<typeof setTimeout>;
  private phase:PassPhase="created";
  private lease?:HostExecutionLease;
  private snapshot?:ManagedExecutionSnapshot;
  private closedSnapshot?:ManagedExecutionSnapshot;
  private instanceId?:string;
  private prepared=false;
  private delivered=false;
  private dispatched=false;
  private pendingWork=0;
  private unknown=false;
  private closure?:{outcome:ExecutionOutcome;termination:"confirmed"|"unconfirmed"};
  private finishing?:Promise<ManagedExecutionSnapshot>;
  private readonly expectedInstanceId?:string;
  private readonly controlTimeoutMs:number;
  private readonly models?:ModelAdmissionPort;
  private pendingModel?:{requestId:string;permit?:ManagedModelPermit;report?:ManagedModelSettlement};
  constructor(port:GraphExecutionPort,request:ManagedExecutionRequest,options:{signal?:AbortSignal;expectedInstanceId?:string;controlTimeoutMs?:number}={}) {
    this.request=copy(ManagedExecutionRequestSchema.parse(request));
    if(new TextEncoder().encode(JSON.stringify(this.request)).length>128*1024)throw new Error("EXECUTION_REQUEST_BYTE_BOUND");
    this.expectedInstanceId=options.expectedInstanceId;
    this.controlTimeoutMs=options.controlTimeoutMs??10000;
    if(!Number.isSafeInteger(this.controlTimeoutMs)||this.controlTimeoutMs<1||this.controlTimeoutMs>30000)throw new Error("EXECUTION_CONTROL_TIMEOUT_INVALID");
    // Capture function identities too: a later host rebinding cannot replace this pass's port.
    this.port={begin:port.begin.bind(port),read:port.read.bind(port),refresh:port.refresh.bind(port),deliver:port.deliver.bind(port),finish:port.finish.bind(port)};
    const modelPort=port as GraphExecutionPort & Partial<ModelAdmissionPort>;
    if(typeof modelPort.admitModel==='function'&&typeof modelPort.settleModel==='function'&&typeof modelPort.readModel==='function')
      this.models={admitModel:modelPort.admitModel.bind(port),settleModel:modelPort.settleModel.bind(port),readModel:modelPort.readModel.bind(port),
        ...(typeof modelPort.observeModelStop==='function'?{observeModelStop:modelPort.observeModelStop.bind(port)}:{})};
    this.signal=options.signal?AbortSignal.any([options.signal,this.deadline.signal]):this.deadline.signal;
  }
  get executionId(){return this.request.id;}
  get state(){return this.phase;}
  get lastSnapshot(){return this.snapshot?copy(this.snapshot):undefined;}
  get workTermination():"confirmed"|"unconfirmed"{return this.unknown||this.pendingWork>0||this.pendingModel?"unconfirmed":"confirmed";}
  get modelRequestId(){return this.pendingModel?.requestId;}
  private validateSnapshot(value:ManagedExecutionSnapshot){
    const snapshot=ManagedExecutionSnapshotSchema.parse(value),instance=this.instanceId??this.expectedInstanceId;
    if(snapshot.execution_id!==this.executionId||instance&&snapshot.instance_id!==instance
      ||snapshot.pack.instance_id!==snapshot.instance_id||snapshot.pack.receipt.instance_id!==snapshot.instance_id
      ||snapshot.pack.receipt.execution_id!==this.executionId)throw new Error("EXECUTION_PASS_IDENTITY_MISMATCH");
    this.instanceId=snapshot.instance_id;return snapshot;
  }
  private assertReady(){
    this.signal.throwIfAborted();
    if(this.phase!=="ready"||this.unknown||!this.lease)throw new Error("EXECUTION_PASS_NOT_READY: inspect or close the original execution; do not repeat work");
  }
  /** A noncooperative callback stays counted until it actually settles, even after wait rejection. */
  private wait<T>(work:()=>Promise<T>,signal:AbortSignal,adapterWork=false,workerWork=false):Promise<T>{
    signal.throwIfAborted();
    return new Promise<T>((resolve,reject)=>{
      let started=false;
      const abort=()=>{signal.removeEventListener("abort",abort);reject(signal.reason??new Error("EXECUTION_WAIT_CANCELLED_TERMINATION_UNCONFIRMED"));};
      signal.addEventListener("abort",abort,{once:true});
      const operation=Promise.resolve().then(()=>{
        signal.throwIfAborted();if(adapterWork){started=true;this.pendingWork++;if(workerWork)this.dispatched=true;}
        return work();
      });
      operation.then(value=>{if(signal.aborted)abort();else resolve(value);},reject)
        .finally(()=>signal.removeEventListener("abort",abort));
      if(adapterWork)void operation.finally(()=>{if(started)this.pendingWork--;}).catch(()=>undefined);
      if(signal.aborted)abort();
    });
  }
  async begin():Promise<ManagedExecutionSnapshot>{
    if(this.phase!=="created")throw new Error("EXECUTION_PASS_ALREADY_STARTED: retain the original ID");
    this.signal.throwIfAborted();this.phase="admitting";
    this.timer=setTimeout(()=>this.deadline.abort(new Error("EXECUTION_PASS_DEADLINE")),this.request.timeout_ms);
    try{
      const lease=await this.wait(()=>this.port.begin(copy(this.request),this.signal),this.signal);
      const execution=this.validateSnapshot(lease.execution);
      if(!execution.authority_active||execution.status!=="assembled"||!/^(dgexec\.[A-Za-z0-9_-]{43})$/.test(lease.workerBearer))throw new Error("EXECUTION_PASS_ADMISSION_INVALID");
      this.lease={execution,workerBearer:lease.workerBearer,controls:copy(lease.controls??null)};
      this.snapshot=execution;this.phase="ready";return copy(execution);
    }catch(error){this.phase="uncertain";throw error;}
  }
  /** Whole handoff must acknowledge its exact receipt/block before any adapter dispatch. */
  async prepare(handoff:(context:ExecutionContextHandoff,signal:AbortSignal)=>Promise<ExecutionContextAcknowledgement>):Promise<void>{
    this.assertReady();if(this.prepared)throw new Error("EXECUTION_PASS_CONTEXT_ALREADY_PREPARED");this.phase="preparing";
    try{
      const lease=this.lease!;
      const context=this.delivered?await this.wait(()=>this.port.refresh(lease.workerBearer,this.signal),this.signal)
          :{block:lease.execution.block,pack:lease.execution.pack};
      const pack=ContextPackSchema.parse(context.pack);
      if(pack.instance_id!==lease.execution.instance_id||pack.receipt.instance_id!==pack.instance_id
        ||pack.receipt.execution_id!==this.executionId||new TextEncoder().encode(context.block).length>65536)throw new Error("EXECUTION_PASS_CONTEXT_INVALID");
      const acknowledged=acknowledgementSchema.parse(await this.wait(()=>handoff({block:context.block,pack:copy(pack),initialControls:copy(lease.controls)},this.signal),this.signal,true));
      if(acknowledged.receiptId!==pack.receipt.id||acknowledged.block!==context.block)throw new Error("EXECUTION_PASS_HANDOFF_MISMATCH: required evidence was not clipped");
      await this.wait(()=>this.port.deliver(lease.workerBearer,pack.receipt.id,context.block,this.signal),this.signal);
      this.signal.throwIfAborted();if(this.state!=="preparing")throw new Error("EXECUTION_PASS_CLOSED_DURING_HANDOFF");
      this.prepared=true;this.delivered=true;this.phase="ready";
    }catch(error){this.unknown=this.unknown||this.pendingWork>0;if(this.state!=="closing"&&this.state!=="closed")this.phase="uncertain";throw error;}
  }
  /** Each native request/continuation needs a new prepare. Returns its whole literal result. */
  async run<T>(work:(worker:ExecutionWorker)=>Promise<ExecutionWorkerResult<T>>):Promise<T>{
    this.assertReady();if(!this.prepared)throw new Error("EXECUTION_PASS_CONTEXT_NOT_DELIVERED");
    this.prepared=false;this.phase="executing";
    try{
      const lease=this.lease!,result=await this.wait(()=>work({executionId:this.executionId,instanceId:lease.execution.instance_id,workerBearer:lease.workerBearer,signal:this.signal}),this.signal,true,true);
      if(!result||!["confirmed","unconfirmed"].includes(result.workTermination))throw new Error("EXECUTION_PASS_TERMINATION_ATTESTATION_REQUIRED");
      this.signal.throwIfAborted();if(this.state!=="executing")throw new Error("EXECUTION_PASS_CLOSED_DURING_WORK");
      if(result.workTermination==="unconfirmed"){this.unknown=true;this.phase="uncertain";}else this.phase="ready";
      return result.result;
    }catch(error){this.unknown=this.unknown||this.dispatched;if(this.state!=="closing"&&this.state!=="closed")this.phase="uncertain";throw error;}
  }
  /** One native model request under the same graph pass and cumulative spend ledger. */
  async runModel<T>(input:Omit<ManagedModelAdmissionRequest,'execution_id'>,
    work:(worker:ExecutionModelWorker)=>Promise<ExecutionModelResult<T>>):Promise<T>{
    this.assertReady();if(!this.prepared)throw new Error('EXECUTION_PASS_CONTEXT_NOT_DELIVERED');
    if(!this.models)throw new Error('EXECUTION_MODEL_PORT_REQUIRED');
    if(this.pendingModel)throw new Error('EXECUTION_MODEL_RECOVERY_REQUIRED');
    const request=copy(ManagedModelAdmissionRequestSchema.parse({...input,execution_id:this.executionId}));
    const pending={requestId:request.request_id} as NonNullable<ManagedGraphPass['pendingModel']>;
    this.pendingModel=pending;this.prepared=false;this.phase='executing';
    try{
      try{pending.permit=ManagedModelPermitSchema.parse(await this.wait(()=>this.models!.admitModel(request,this.signal),this.signal));
        if(pending.permit.execution_id!==this.executionId||pending.permit.request_id!==pending.requestId)throw new Error('EXECUTION_MODEL_PERMIT_IDENTITY_MISMATCH');
      }catch(error){
        // Only a durable refusal with no permit proves this logical request could not launch.
        const observed=await this.control(signal=>this.models!.readModel(this.executionId,pending.requestId,signal)).catch(()=>undefined);
        if(observed?.execution_id===this.executionId&&observed.request_id===pending.requestId&&observed.state==='refused'&&observed.permit===null){
          this.pendingModel=undefined;this.phase='ready';
        }throw error;
      }
      const permit=pending.permit,signal=AbortSignal.any([this.signal,AbortSignal.timeout(Math.max(1,Date.parse(permit.expires_at)-Date.now()))]);
      const result=await this.wait(()=>work({executionId:this.executionId,instanceId:this.lease!.execution.instance_id,
        workerBearer:this.lease!.workerBearer,permit:copy(permit),request:copy(request),signal}),signal,true,true);
      if(!result||!['confirmed','unconfirmed'].includes(result.workTermination)||typeof result.acknowledged!=='boolean')
        throw new Error('EXECUTION_MODEL_OBSERVATION_REQUIRED');
      pending.report=ManagedModelSettlementSchema.parse({execution_id:this.executionId,request_id:pending.requestId,attempt_id:permit.attempt_id,
        usage:result.usage??null,acknowledged:result.acknowledged,work_termination:result.workTermination});
      const outcome=await this.publishModelReport(pending.report);
      signal.throwIfAborted();if(this.state!=='executing')throw new Error('EXECUTION_PASS_CLOSED_DURING_MODEL_REPORT');
      if(outcome.state!=='host_reported'||result.workTermination!=='confirmed'){this.unknown=true;this.phase='uncertain';}
      else{this.pendingModel=undefined;this.phase='ready';}
      return result.result;
    }catch(error){
      if(this.pendingModel){this.unknown=true;
        if(pending.permit&&!pending.report){
          pending.report={execution_id:this.executionId,request_id:pending.requestId,attempt_id:pending.permit.attempt_id,
            usage:null,acknowledged:false,work_termination:'unconfirmed'};
          await this.publishModelReport(pending.report).catch(()=>undefined);
        }
        if(this.state!=='closing'&&this.state!=='closed')this.phase='uncertain';
      }
      throw new Error(`EXECUTION_MODEL_REQUEST_FAILED: retain ${this.executionId}/${pending.requestId}; ${String(error)}; never redispatch`,{cause:error});
    }
  }
  private async publishModelReport(report:ManagedModelSettlement){
    const result=ManagedModelOutcomeSchema.parse(await this.control(signal=>this.models!.settleModel(copy(report),signal)));
    if(result.execution_id!==this.executionId||result.request_id!==report.request_id||result.settlement?.attempt_id!==report.attempt_id)
      throw new Error('EXECUTION_MODEL_REPORT_IDENTITY_MISMATCH');
    return result;
  }
  /** Original-ID inspection does not recover a launchable permit or renew authority. */
  async inspectModel(signal?:AbortSignal):Promise<ManagedModelOutcome>{
    if(!this.models||!this.pendingModel)throw new Error('EXECUTION_MODEL_REQUEST_NOT_PENDING');
    const id=this.pendingModel.requestId,result=ManagedModelOutcomeSchema.parse(await this.control(signal=>this.models!.readModel(this.executionId,id,signal),signal));
    if(result.execution_id!==this.executionId||result.request_id!==id)throw new Error('EXECUTION_MODEL_REPORT_IDENTITY_MISMATCH');return result;
  }
  /** Replays only the exact first report; cannot strengthen termination or launch more work. */
  async retryModelReport():Promise<ManagedModelOutcome>{
    if(!this.pendingModel?.report)throw new Error('EXECUTION_MODEL_REPORT_NOT_CAPTURED');
    return this.publishModelReport(this.pendingModel.report);
  }
  /** Independent original worker observation after cancellation. Never upgrades the first report or permits another dispatch. */
  async observeModelStop(observation:Pick<ExecutionModelResult<unknown>,'usage'|'acknowledged'|'workTermination'>):Promise<ManagedExecutionSnapshot>{
    const pending=this.pendingModel;
    if(!this.models?.observeModelStop||!pending?.permit||!this.closure)throw new Error('EXECUTION_NATIVE_STOP_RECOVERY_UNAVAILABLE');
    const report=ManagedModelSettlementSchema.parse({execution_id:this.executionId,request_id:pending.requestId,attempt_id:pending.permit.attempt_id,
      usage:observation.usage??null,acknowledged:observation.acknowledged,work_termination:observation.workTermination});
    const result=ManagedExecutionSnapshotSchema.parse(await this.control(signal=>this.models!.observeModelStop!(copy(report),signal)));
    if(result.execution_id!==this.executionId||result.authority_active)throw new Error('NATIVE_STOP_RECOVERY_IDENTITY_MISMATCH');
    this.closedSnapshot=result;return copy(result);
  }
  /** Requests cancellation only. Explicit finish/inspection still uses the original host/ID. */
  cancel(reason:unknown=new Error("EXECUTION_PASS_CANCELLED")){this.deadline.abort(reason);}
  private async control<T>(work:(signal:AbortSignal)=>Promise<T>,parent?:AbortSignal):Promise<T>{
    const deadline=new AbortController(),timer=setTimeout(()=>deadline.abort(new Error("EXECUTION_CONTROL_TIMEOUT")),this.controlTimeoutMs);
    const signal=parent?AbortSignal.any([parent,deadline.signal]):deadline.signal;
    try{return await this.wait(()=>work(signal),signal);}finally{clearTimeout(timer);}
  }
  /** Read-only recovery. It never redispatches, renews authority or strengthens termination. */
  async inspect(signal?:AbortSignal):Promise<ManagedExecutionSnapshot>{
    if(this.phase==="created")throw new Error("EXECUTION_PASS_NOT_STARTED");
    const snapshot=this.validateSnapshot(await this.control(signal=>this.port.read(this.executionId,signal),signal));
    if(this.snapshot&&(snapshot.record_revision<this.snapshot.record_revision
      ||this.closedSnapshot&&!this.closedSnapshot.authority_active&&snapshot.authority_active))throw new Error("EXECUTION_PASS_INSPECTION_STALE");
    this.snapshot=snapshot;return copy(snapshot);
  }
  /** Exact closure retry only. A lost reply cannot cause a new pass or stronger termination claim. */
  async finish(outcome:ExecutionOutcome,signal?:AbortSignal):Promise<ManagedExecutionSnapshot>{
    if(this.phase==="created"||this.phase==="admitting")throw new Error("EXECUTION_PASS_ADMISSION_UNSETTLED");
    if(this.closure&&this.closure.outcome!==outcome)throw new Error("EXECUTION_PASS_CLOSURE_CHANGED");
    if(this.phase==="closed")return copy(this.closedSnapshot!);
    if(!this.closure){this.deadline.abort(new Error("EXECUTION_PASS_CLOSING"));this.closure={outcome,termination:this.workTermination};}
    if(this.timer)clearTimeout(this.timer);this.phase="closing";
    if(!this.finishing){const captured=this.closure;
      this.finishing=this.control(signal=>this.port.finish(this.executionId,captured.outcome,captured.termination,signal),signal).then(value=>{
        const snapshot=this.validateSnapshot(value);if(snapshot.authority_active)throw new Error("EXECUTION_PASS_CLOSURE_UNCONFIRMED");
        this.snapshot=snapshot;this.closedSnapshot=snapshot;this.phase="closed";return snapshot;
      });
    }
    try{return copy(await this.finishing);}catch(error){this.phase="uncertain";throw error;}finally{this.finishing=undefined;}
  }
}
