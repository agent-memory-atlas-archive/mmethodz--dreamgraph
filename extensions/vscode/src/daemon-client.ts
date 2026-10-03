/**
 * DreamGraph Daemon HTTP Client — Layer 3.
 *
 * Pure HTTP client for the daemon's REST API. No VS Code dependencies.
 * Handles /health, /api/instance, /api/graph-context, and /api/validate.
 *
 * @see TDD §1.2 (Layer 3), §1.4 (Communication Protocol), §2.4 (Health)
 */

import type {
  DaemonHealthResponse,
  DaemonInstanceResponse,
} from "./types.js";
import { ContextPackSchema, ContextQuerySchema, ManagedExecutionRequestSchema, ManagedExecutionSnapshotSchema,
  ManagedExecutionApprovalRequestSchema, type ManagedExecutionApprovalRequest,
  type ContextPack, type ContextQuery, type ManagedExecutionRequest, type ManagedExecutionSnapshot } from "./generated/graph-contracts.js";
import {z} from "zod/v3";
import type {ComputerOperatorSnapshot} from '@dreamgraph/sdk/seams/computer-control' with {"resolution-mode":"import"};
import {ManagedModelAdmissionRequestSchema,ManagedModelPermitSchema,ManagedModelSettlementSchema,ManagedModelOutcomeSchema,
  type ManagedModelAdmissionRequest,type ManagedModelSettlement,type ManagedModelPermit,type ManagedModelOutcome} from './generated/graph-contracts.js';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export interface DaemonClientOptions {
  host: string;
  port: number;
  /** Request timeout in ms (default: 5000) */
  timeoutMs?: number;
  /** Authenticated remote authority; kept in memory and never printed or put in a URL. */
  bearer?: string;
}

export interface GraphContextRequest {
  file_path?: string;
  feature_ids?: string[];
  include_adrs?: boolean;
  include_ui?: boolean;
  include_api_surface?: boolean;
  include_tensions?: boolean;
}

export interface GraphContextResponse {
  features: Array<{ id: string; name: string; description?: string; relevance?: number }>;
  workflows: Array<{ id: string; name: string; relevance?: number }>;
  adrs: Array<{ id: string; title: string; status: string; summary?: string; relevance?: number }>;
  ui_elements: Array<{ id: string; name: string; element_type: string; relevance?: number }>;
  api_surface: object | null;
  tensions: Array<{
    id: string;
    description?: string;
    summary?: string;
    severity?: string;
    urgency?: number;
    relevance?: number;
  }>;
  cognitive_state?: string;
}

/* ------------------------------------------------------------------ */
/*  Client                                                            */
/* ------------------------------------------------------------------ */

export class DaemonClient {
  private _host: string;
  private _port: number;
  private _timeoutMs: number;
  private readonly _abortControllers = new Set<AbortController>();
  private readonly _bearer?: string;
  private _sessionBearer?: string;
  private _sessionHandshake?: Promise<void>;
  private _endpointGeneration = 0;
  private _disposed = false;

  constructor(options: DaemonClientOptions) {
    this._host = options.host;
    this._port = options.port;
    this._timeoutMs = options.timeoutMs ?? 5000;
    this._bearer = options.bearer;
  }

  /* ---- Configuration ---- */

  get baseUrl(): string {
    return `http://${this._host}:${this._port}`;
  }

  get port(): number {
    return this._port;
  }

  updateEndpoint(host: string, port: number): void {
    if (this._host === host && this._port === port) return;
    for (const controller of this._abortControllers) controller.abort(new Error("DAEMON_ENDPOINT_CHANGED"));
    this._sessionBearer = undefined; this._sessionHandshake = undefined; this._endpointGeneration++;
    this._host = host;
    this._port = port;
  }

  /* ---- Health ---- */

  /**
   * Probe `GET /health` (Accept: application/json).
   * Returns the health response + latency, or null on failure.
   */
  async getHealth(): Promise<{
    response: DaemonHealthResponse;
    latencyMs: number;
  } | null> {
    const start = Date.now();
    try {
      const res = await this._fetch("/health", {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return null;
      const body = (await res.json()) as DaemonHealthResponse;
      return { response: body, latencyMs: Date.now() - start };
    } catch {
      return null;
    }
  }

  /**
   * Quick boolean check — is the daemon responsive?
   */
  async isAvailable(): Promise<boolean> {
    const result = await this.getHealth();
    return result !== null;
  }

  /* ---- Instance ---- */

  /**
   * Fetch full instance details from `GET /api/instance`.
   */
  async getInstance(): Promise<DaemonInstanceResponse | null> {
    try {
      const res = await this._fetch("/api/instance");
      if (!res.ok) return null;
      return (await res.json()) as DaemonInstanceResponse;
    } catch {
      return null;
    }
  }

  /* ---- Graph Context ---- */

  /** Canonical bounded context. Errors remain errors; this cannot attest model consumption. */
  async getContextPack(request: ContextQuery, signal?:AbortSignal):Promise<ContextPack> {
    const response = await this._fetch("/api/context/v1", {method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify(ContextQuerySchema.parse({...request,adapter:"vscode"})),signal});
    const body = await response.json();
    if (!response.ok) throw new Error(`CONTEXT_UNAVAILABLE: HTTP ${response.status}: ${JSON.stringify(body)}`);
    return ContextPackSchema.parse(body);
  }

  /** Preserve the authenticated owner across requests; native fetch has no browser cookie jar. */
  private async _ensureSession(signal?:AbortSignal):Promise<void> {
    const generation = this._endpointGeneration;
    if (this._disposed) throw new Error('DAEMON_CLIENT_DISPOSED');
    signal?.throwIfAborted();
    if (!this._sessionBearer) {
      if (!this._sessionHandshake) {
        const generation=this._endpointGeneration;
        this._sessionHandshake=(async()=>{
          const result=await this._fetch("/api/authority/v1/status");
          if (!result.ok || !this._sessionBearer || generation !== this._endpointGeneration) throw new Error("DAEMON_SESSION_UNAVAILABLE");
        })();
        const handshake=this._sessionHandshake;
        void handshake.finally(()=>{if(this._sessionHandshake===handshake)this._sessionHandshake=undefined;}).catch(()=>undefined);
      }
      // A caller may stop waiting without cancelling another caller's shared handshake.
      await this._waitForSession(this._sessionHandshake, signal);
    }
    signal?.throwIfAborted();
    if (this._disposed) throw new Error('DAEMON_CLIENT_DISPOSED');
    if (generation !== this._endpointGeneration) throw new Error('DAEMON_ENDPOINT_CHANGED');
  }
  private async _waitForSession(handshake:Promise<void>,signal?:AbortSignal):Promise<void> {
    if (!signal) return handshake;
    signal.throwIfAborted();
    await new Promise<void>((resolve,reject)=>{
      const abort=()=>{signal.removeEventListener('abort',abort);reject(signal.reason ?? new Error('DAEMON_SESSION_WAIT_CANCELLED'));};
      signal.addEventListener('abort',abort,{once:true});
      handshake.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
      if (signal.aborted) abort();
    });
  }
  private async _hostRequest(route:string,input:unknown,signal?:AbortSignal):Promise<Response> {
    const generation=this._endpointGeneration,body=JSON.stringify(input);
    await this._ensureSession(signal);
    if(generation!==this._endpointGeneration)throw new Error('DAEMON_ENDPOINT_CHANGED');
    return this._fetch(route,{method:'POST',headers:{'Content-Type':'application/json'},body,signal});
  }
  private async _computerRequest(route:string,input:unknown|undefined,signal?:AbortSignal,generation=this._endpointGeneration):Promise<unknown> {
    if(generation!==this._endpointGeneration)throw new Error('DAEMON_ENDPOINT_CHANGED');
    await this._ensureSession(signal);
    if(generation!==this._endpointGeneration)throw new Error('DAEMON_ENDPOINT_CHANGED');
    const response=await this._fetch('/api/executions/v1/computer/'+route,{...(input===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}),signal});
    const text=await response.text();if(Buffer.byteLength(text,'utf8')>256*1024)throw new Error('COMPUTER_CONTROL_RESPONSE_BYTE_BOUND');
    if(generation!==this._endpointGeneration)throw new Error('DAEMON_ENDPOINT_CHANGED');
    if(!response.ok)throw new Error(`COMPUTER_OPERATOR_REQUEST_REJECTED: HTTP ${response.status}: ${text}`);return JSON.parse(text);
  }
  async listComputerSessions(page?:{cursor:string;snapshot_hash:string},signal?:AbortSignal) {
    const generation=this._endpointGeneration,route='sessions?'+new URLSearchParams({limit:'16',...page});
    const {ComputerOperatorPageSchema}=await import('@dreamgraph/sdk/seams/computer-control');
    return ComputerOperatorPageSchema.parse(await this._computerRequest(route,undefined,signal,generation));
  }
  private async _computerPassRequest(route:string,input:unknown|undefined,signal?:AbortSignal){
    const generation=this._endpointGeneration;await this._ensureSession(signal);
    if(generation!==this._endpointGeneration)throw new Error('DAEMON_ENDPOINT_CHANGED');
    const response=await this._fetch('/api/executions/v1/'+route,{...(input===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}),signal},route==='computer-pass'?300000:15000);
    if(generation!==this._endpointGeneration)throw new Error('DAEMON_ENDPOINT_CHANGED');signal?.throwIfAborted();
    if(!response.ok)throw new Error(`COMPUTER_PASS_REQUEST_REJECTED: HTTP ${response.status}`);const body=await response.json();
    if(generation!==this._endpointGeneration)throw new Error('DAEMON_ENDPOINT_CHANGED');if(this._disposed)throw new Error('DAEMON_CLIENT_DISPOSED');signal?.throwIfAborted();return body;
  }
  async readComputerPassSetup(signal?:AbortSignal){const generation=this._endpointGeneration;
    const {NativeComputerSetupSchema}=await import('./generated/computer-pass.js');
    if(generation!==this._endpointGeneration)throw new Error('DAEMON_ENDPOINT_CHANGED');
    return NativeComputerSetupSchema.parse(await this._computerPassRequest('computer-preparation/setup',undefined,signal));
  }
  async prepareComputerPass(input:{interact:boolean;duration_ms:number},signal?:AbortSignal){const generation=this._endpointGeneration;
    const {NativeComputerPrepareRequestSchema,NativeComputerPreparationSchema}=await import('./generated/computer-pass.js');
    if(generation!==this._endpointGeneration)throw new Error('DAEMON_ENDPOINT_CHANGED');
    const captured=NativeComputerPrepareRequestSchema.parse(input),reply=await this._computerPassRequest('computer-preparation/prepare',captured,signal) as {ok?:boolean;result?:unknown};
    if(reply.ok!==true)throw new Error('COMPUTER_PREPARATION_REPLY_REJECTED');return NativeComputerPreparationSchema.parse(reply.result);
  }
  async confirmComputerPass(id:string,signal?:AbortSignal){const generation=this._endpointGeneration;
    const {NativeComputerConfirmationSchema}=await import('./generated/computer-pass.js');
    if(generation!==this._endpointGeneration)throw new Error('DAEMON_ENDPOINT_CHANGED');
    id=NativeComputerConfirmationSchema.shape.id.parse(id);
    const reply=await this._computerPassRequest('computer-preparation/confirm',{id,human_confirmed:true},signal) as {ok?:boolean;result?:unknown};
    if(reply.ok!==true)throw new Error('COMPUTER_CONFIRMATION_REPLY_REJECTED');const result=NativeComputerConfirmationSchema.parse(reply.result);
    if(result.id!==id)throw new Error('COMPUTER_CONFIRMATION_REPLY_OWNER_MISMATCH');return result;
  }
  async runComputerPass(request:import('./generated/computer-pass.js').NativeComputerPassRequest,executionId:string,signal?:AbortSignal){const generation=this._endpointGeneration;
    const {NativeComputerPassRequestSchema,NativeComputerPassReplySchema}=await import('./generated/computer-pass.js');
    if(generation!==this._endpointGeneration)throw new Error('DAEMON_ENDPOINT_CHANGED');const captured=NativeComputerPassRequestSchema.parse(structuredClone(request));
    const reply=NativeComputerPassReplySchema.parse(await this._computerPassRequest('computer-pass',captured,signal));
    if(reply.execution_id!==executionId||reply.execution.execution_id!==executionId)throw new Error('COMPUTER_PASS_REPLY_OWNER_MISMATCH');return reply;
  }
  async cancelComputerPass(id:string,signal?:AbortSignal){const generation=this._endpointGeneration;
    const {NativeComputerCancellationSchema}=await import('./generated/computer-pass.js');
    if(generation!==this._endpointGeneration)throw new Error('DAEMON_ENDPOINT_CHANGED');id=NativeComputerCancellationSchema.shape.id.parse(id);
    const reply=await this._computerPassRequest('computer-preparation/cancel',{id},signal) as {ok?:boolean;result?:unknown};
    if(reply.ok!==true)throw new Error('COMPUTER_CANCELLATION_REPLY_REJECTED');const result=NativeComputerCancellationSchema.parse(reply.result);
    if(result.id!==id)throw new Error('COMPUTER_CANCELLATION_REPLY_OWNER_MISMATCH');return result;
  }
  async readComputerStatus(executionId:string,id:string,signal?:AbortSignal):Promise<ComputerOperatorSnapshot> {
    const generation=this._endpointGeneration,route='status?'+new URLSearchParams({execution_id:executionId,id});
    const {ComputerOperatorStatusSchema}=await import('@dreamgraph/sdk/seams/computer-control');
    const result=ComputerOperatorStatusSchema.parse(await this._computerRequest(route,undefined,signal,generation));
    if(result.session.execution_id!==executionId||result.session.id!==id)throw new Error('COMPUTER_CONTROL_REPLY_OWNER_MISMATCH');const {ok,...snapshot}=result;return snapshot;
  }
  async readComputerEvidence(executionId:string,id:string,signal?:AbortSignal){
    const generation=this._endpointGeneration;
    const {verifyComputerEvidence,COMPUTER_EVIDENCE_MAX_RESPONSE_BYTES}=await import('@dreamgraph/sdk/seams/computer-control');
    if(generation!==this._endpointGeneration)throw new Error('DAEMON_ENDPOINT_CHANGED');
    await this._ensureSession(signal);if(generation!==this._endpointGeneration)throw new Error('DAEMON_ENDPOINT_CHANGED');
    const response=await this._fetch('/api/executions/v1/computer-evidence/observation?'+new URLSearchParams({execution_id:executionId,id}),{signal});
    const text=await response.text();if(Buffer.byteLength(text,'utf8')>COMPUTER_EVIDENCE_MAX_RESPONSE_BYTES)throw new Error('COMPUTER_EVIDENCE_RESPONSE_BYTE_BOUND');
    if(!response.ok)throw new Error(`COMPUTER_EVIDENCE_REQUEST_REJECTED: HTTP ${response.status}`);
    const evidence=await verifyComputerEvidence(JSON.parse(text));signal?.throwIfAborted();
    if(this._disposed)throw new Error('DAEMON_CLIENT_DISPOSED');if(generation!==this._endpointGeneration)throw new Error('DAEMON_ENDPOINT_CHANGED');
    if(evidence.execution_id!==executionId||evidence.computer_session_id!==id)throw new Error('COMPUTER_EVIDENCE_REPLY_OWNER_MISMATCH');return evidence;
  }
  async controlComputer(executionId:string,id:string,action:'pause'|'resume'|'stop'|'recover-stop',fence?:number,signal?:AbortSignal):Promise<ComputerOperatorSnapshot> {
    if(!['pause','resume','stop','recover-stop'].includes(action))throw new Error('COMPUTER_CONTROL_ACTION_INVALID');
    const generation=this._endpointGeneration,input={execution_id:executionId,id,...(action==='pause'||action==='resume'?{fence}:{})};
    const {ComputerOperatorStatusSchema}=await import('@dreamgraph/sdk/seams/computer-control');
    const result=ComputerOperatorStatusSchema.parse(await this._computerRequest(action,input,signal,generation));
    if(result.session.execution_id!==executionId||result.session.id!==id)throw new Error('COMPUTER_CONTROL_REPLY_OWNER_MISMATCH');const {ok,...snapshot}=result;return snapshot;
  }
  /** This controls authority only. Provider/CLI execution remains in this host. Never persist the bearer. */
  async beginExecution(request:ManagedExecutionRequest,signal?:AbortSignal):Promise<{execution:ManagedExecutionSnapshot;workerBearer:string;controls:unknown}> {
    // Capture exact operator scope before session initialization can yield.
    const captured=JSON.parse(JSON.stringify(ManagedExecutionRequestSchema.parse(request)));
    const response=await this._hostRequest('/api/executions/v1/begin',captured,signal);
    const body=await response.json();if(!response.ok)throw new Error(`MANAGED_EXECUTION_UNAVAILABLE: HTTP ${response.status}: ${JSON.stringify(body)}`);
    const result=z.object({execution:ManagedExecutionSnapshotSchema,worker_bearer:z.string().regex(/^dgexec\.[A-Za-z0-9_-]{43}$/),controls:z.unknown()}).strict().parse(body);
    if(captured.plan_execution && (!result.execution.plan_execution
      || JSON.stringify(result.execution.plan_execution.intent)!==JSON.stringify(captured.plan_execution)
      || !result.execution.plan_execution.state.leases.some(lease=>lease.execution_id===captured.id&&lease.state==="running")))
      throw new Error(`PLAN_EXECUTION_CONTRACT_NOT_ACKNOWLEDGED: ${captured.id}; inspect the original execution before recovery`);
    return {execution:result.execution,workerBearer:result.worker_bearer,controls:result.controls};
  }
  async readExecution(execution_id:string,signal?:AbortSignal):Promise<ManagedExecutionSnapshot> {
    const response=await this._hostRequest('/api/executions/v1/read',{execution_id},signal);
    const body=await response.json();if(!response.ok)throw new Error(`MANAGED_EXECUTION_UNAVAILABLE: HTTP ${response.status}: ${JSON.stringify(body)}`);
    return ManagedExecutionSnapshotSchema.parse(body);
  }
  async approveExecution(request:ManagedExecutionApprovalRequest,signal?:AbortSignal) {
    // Freeze the reviewed JSON before an asynchronous session handshake.
    const reviewed=JSON.parse(JSON.stringify(ManagedExecutionApprovalRequestSchema.parse(request)));
    const response=await this._hostRequest('/api/executions/v1/approve',reviewed,signal);
    const body=await response.json();if(!response.ok)throw new Error(`MANAGED_APPROVAL_UNAVAILABLE: HTTP ${response.status}: ${JSON.stringify(body)}`);
    const result=z.object({execution:ManagedExecutionSnapshotSchema,approval_id:z.string(),review_policy_revision:z.string(),controls:z.unknown(),replayed:z.boolean(),review_activated:z.boolean()}).strict().parse(body);
    if(result.approval_id!==reviewed.approval_id||result.execution.execution_id!==reviewed.execution_id)throw new Error("MANAGED_APPROVAL_ACKNOWLEDGEMENT_MISMATCH");
    return {execution:result.execution,approvalId:result.approval_id,reviewPolicyRevision:result.review_policy_revision,controls:result.controls,replayed:result.replayed,reviewActivated:result.review_activated};
  }
  private async _executionReviews(execution_id:string,open:boolean,signal?:AbortSignal) {
    const response=await this._hostRequest(`/api/executions/v1/reviews/${open?'open':'read'}`,{execution_id},signal);
    const body=await response.json();if(!response.ok)throw new Error(`MANAGED_REVIEWS_UNAVAILABLE: HTTP ${response.status}: ${JSON.stringify(body)}`);
    const result=z.object({execution_id:z.string(),authority_active:z.boolean(),review_enabled:z.boolean(),requests:z.array(ManagedExecutionApprovalRequestSchema).max(1)}).strict().parse(body);
    if(result.execution_id!==execution_id||result.requests.some(request=>request.execution_id!==execution_id))throw new Error('MANAGED_REVIEW_IDENTITY_MISMATCH');
    return result;
  }
  openExecutionReviews(execution_id:string,signal?:AbortSignal) {return this._executionReviews(execution_id,true,signal);}
  readExecutionReviews(execution_id:string,signal?:AbortSignal) {return this._executionReviews(execution_id,false,signal);}
  async declineExecutionReview(execution_id:string,approval_id:string,signal?:AbortSignal) {
    const response=await this._hostRequest('/api/executions/v1/reviews/decline',{execution_id,approval_id},signal);
    const body=await response.json();if(!response.ok)throw new Error(`MANAGED_REVIEW_DECLINE_UNAVAILABLE: HTTP ${response.status}: ${JSON.stringify(body)}`);
    const result=z.object({execution_id:z.string(),approval_id:z.string(),status:z.enum(['declined','not_pending'])}).strict().parse(body);
    if(result.execution_id!==execution_id||result.approval_id!==approval_id)throw new Error('MANAGED_REVIEW_IDENTITY_MISMATCH');
    return result;
  }
  async finishExecution(execution_id:string,outcome:"completed"|"cancelled"|"failed",work_termination:"confirmed"|"unconfirmed",signal?:AbortSignal):Promise<ManagedExecutionSnapshot> {
    const response=await this._hostRequest('/api/executions/v1/finish',{execution_id,outcome,work_termination},signal);
    const body=await response.json();if(!response.ok)throw new Error(`MANAGED_EXECUTION_UNAVAILABLE: HTTP ${response.status}: ${JSON.stringify(body)}`);
    return z.object({execution:ManagedExecutionSnapshotSchema,adapter_outcome:z.enum(["completed","cancelled","failed"]),work_termination:z.enum(["confirmed","unconfirmed"])}).strict().parse(body).execution;
  }
  async admitModel(request:ManagedModelAdmissionRequest,signal?:AbortSignal):Promise<ManagedModelPermit> {
    const captured=ManagedModelAdmissionRequestSchema.parse(request);
    const response=await this._hostRequest('/api/executions/v1/model/admit',captured,signal),body=await response.json();
    if(!response.ok)throw new Error(`MODEL_ADMISSION_UNAVAILABLE: HTTP ${response.status}: ${JSON.stringify(body)}`);
    const permit=ManagedModelPermitSchema.parse(body);
    if(permit.execution_id!==captured.execution_id||permit.request_id!==captured.request_id)throw new Error('MODEL_ADMISSION_IDENTITY_MISMATCH');
    return permit;
  }
  async settleModel(request:ManagedModelSettlement,signal?:AbortSignal):Promise<ManagedModelOutcome> {
    const captured=ManagedModelSettlementSchema.parse(request);
    const response=await this._hostRequest('/api/executions/v1/model/settle',captured,signal),body=await response.json();
    if(!response.ok)throw new Error(`MODEL_SETTLEMENT_UNCONFIRMED: HTTP ${response.status}: ${JSON.stringify(body)}`);
    const result=ManagedModelOutcomeSchema.parse(body);
    if(result.execution_id!==captured.execution_id||result.request_id!==captured.request_id||result.settlement?.attempt_id!==captured.attempt_id)throw new Error('MODEL_SETTLEMENT_IDENTITY_MISMATCH');
    return result;
  }
  async readModel(execution_id:string,request_id:string,signal?:AbortSignal):Promise<ManagedModelOutcome> {
    const response=await this._hostRequest('/api/executions/v1/model/read',{execution_id,request_id},signal),body=await response.json();
    if(!response.ok)throw new Error(`MODEL_OUTCOME_UNAVAILABLE: HTTP ${response.status}: ${JSON.stringify(body)}`);
    const result=ManagedModelOutcomeSchema.parse(body);
    if(result.execution_id!==execution_id||result.request_id!==request_id)throw new Error('MODEL_OUTCOME_IDENTITY_MISMATCH');
    return result;
  }
  async observeModelStop(request:ManagedModelSettlement,signal?:AbortSignal):Promise<ManagedExecutionSnapshot> {
    const captured=ManagedModelSettlementSchema.parse(structuredClone(request));
    const response=await this._hostRequest('/api/executions/v1/model/observe-stop',captured,signal),body=await response.json();
    if(!response.ok)throw new Error(`NATIVE_STOP_RECOVERY_UNCONFIRMED: HTTP ${response.status}: ${JSON.stringify(body)}`);
    const result=ManagedExecutionSnapshotSchema.parse(body);
    if(result.execution_id!==captured.execution_id||result.authority_active)throw new Error('NATIVE_STOP_RECOVERY_IDENTITY_MISMATCH');
    return result;
  }
  async refreshExecution(workerBearer:string,signal?:AbortSignal):Promise<{block:string;pack:ContextPack}> {
    const response=await this._fetch("/api/architect/v1/execution/context/refresh",{method:"POST",headers:{"Content-Type":"application/json","X-DreamGraph-Session":workerBearer},body:"{}",signal});
    const body=await response.json();if(!response.ok)throw new Error(`MANAGED_CONTEXT_UNAVAILABLE: HTTP ${response.status}: ${JSON.stringify(body)}`);
    const result=z.object({receipt_id:z.string(),block:z.string().max(65536),delivery:z.literal("unattested"),pack:ContextPackSchema,
      status:z.literal("running"),record_revision:z.number().int().nonnegative()}).strict().parse(body);
    if(Buffer.byteLength(result.block)>65536)throw new Error("MANAGED_CONTEXT_BLOCK_INVALID");
    if(result.pack.receipt.id!==result.receipt_id)throw new Error("MANAGED_CONTEXT_RECEIPT_MISMATCH");
    return {block:result.block,pack:result.pack};
  }
  async deliverExecution(workerBearer:string,receipt_id:string,block:string,signal?:AbortSignal):Promise<void> {
    const response=await this._fetch("/api/architect/v1/execution/context/deliver",{method:"POST",headers:{"Content-Type":"application/json","X-DreamGraph-Session":workerBearer},body:JSON.stringify({receipt_id,block}),signal});
    const body=await response.json();if(!response.ok)throw new Error("MANAGED_CONTEXT_DELIVERY_UNCONFIRMED");
    const result=z.object({receipt_id:z.string(),delivery:z.literal("delivered")}).strict().parse(body);
    if(result.receipt_id!==receipt_id)throw new Error("MANAGED_CONTEXT_DELIVERY_UNCONFIRMED");
  }
  /** Model-driven commands run at the daemon's execution fence, never in the editor shell. */
  async executeCommand(workerBearer:string,execution_id:string,args:Record<string,unknown>,signal?:AbortSignal):Promise<unknown> {
    const payload=JSON.stringify(args);
    if(Buffer.byteLength(payload,'utf8')>65536)throw new Error('MANAGED_COMMAND_REQUEST_BYTE_BOUND');
    const response=await this._fetch('/api/architect/v1/execution/command',{method:'POST',headers:{'Content-Type':'application/json','X-DreamGraph-Session':workerBearer},body:payload,signal},310000);
    const result=await response.json();
    if(response.ok && result.execution_id!==execution_id)throw new Error('MANAGED_COMMAND_EXECUTION_MISMATCH');
    return {content:[{type:'text',text:JSON.stringify(result)}],...(!response.ok||result.timedOut||result.exitCode!==0?{isError:true}:{})};
  }

  /**
   * Fetch graph-side enrichment for a file/feature set.
   * `POST /api/graph-context`
   */
  async getGraphContext(
    request: GraphContextRequest,
  ): Promise<GraphContextResponse | null> {
    try {
      const res = await this._fetch("/api/graph-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      if (!res.ok) return null;
      return (await res.json()) as GraphContextResponse;
    } catch {
      return null;
    }
  }

  /* ---- Validate ---- */

  /**
   * Run combined validation (ADR + UI + API surface).
   * `POST /api/validate`
   */
  async validate(body: {
    file_path: string;
    content?: string;
  }): Promise<{ ok: boolean; violations: unknown[] } | null> {
    try {
      const res = await this._fetch("/api/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) return null;
      return (await res.json()) as { ok: boolean; violations: unknown[] };
    } catch {
      return null;
    }
  }

  /* ---- Lifecycle ---- */

  /**
   * Cancel any in-flight requests (used on dispose).
   */
  dispose(): void {
    this._disposed = true;
    this._sessionBearer = undefined;
    for (const controller of this._abortControllers) controller.abort();
  }

  /* ---- Internal ---- */

  private async _fetch(
    path: string,
    init?: RequestInit,
    timeoutMs = this._timeoutMs,
  ): Promise<Response> {
    if (this._disposed) throw new Error('DAEMON_CLIENT_DISPOSED');
    const generation=this._endpointGeneration,base=this.baseUrl;
    const controller = new AbortController();
    this._abortControllers.add(controller);
    const timeoutId = setTimeout(() => controller.abort(new Error("DAEMON_REQUEST_TIMEOUT")), timeoutMs);

    try {
      const response = await fetch(`${base}${path}`, {
        ...init,
        headers: {...(this._bearer ? {Authorization:`Bearer ${this._bearer}`} : {}),...(this._sessionBearer ? {"X-DreamGraph-Session":this._sessionBearer} : {}),...init?.headers},
        signal: init?.signal ? AbortSignal.any([init.signal,controller.signal]) : controller.signal,
      });
      controller.signal.throwIfAborted(); init?.signal?.throwIfAborted();
      if (generation !== this._endpointGeneration) throw new Error('DAEMON_ENDPOINT_CHANGED');
      const session=response.headers.get("X-DreamGraph-Session");
      if (session && generation===this._endpointGeneration && !this._sessionBearer) this._sessionBearer=session;
      // Timeout/disposal authority covers body consumption, not only response headers.
      if (!response.body) return response;
      const reader = response.body.getReader(), chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        for (;;) {
          const next = await reader.read(); if (next.done) break;
          bytes += next.value.byteLength;
          const responseLimit=path.startsWith('/api/executions/v1/computer-evidence/')?2*1024*1024:
            path.startsWith('/api/executions/v1/computer/')||path.startsWith('/api/executions/v1/computer-preparation/')?256*1024:8*1024*1024;
          if (bytes > responseLimit) { controller.abort(); throw new Error("DAEMON_RESPONSE_BYTE_LIMIT"); }
          chunks.push(next.value);
        }
      } finally { reader.releaseLock(); }
      controller.signal.throwIfAborted(); init?.signal?.throwIfAborted();
      if (generation !== this._endpointGeneration) throw new Error('DAEMON_ENDPOINT_CHANGED');
      return new Response(Buffer.concat(chunks), { status:response.status,statusText:response.statusText,headers:response.headers });
    } finally {
      clearTimeout(timeoutId);
      this._abortControllers.delete(controller);
    }
  }
}
