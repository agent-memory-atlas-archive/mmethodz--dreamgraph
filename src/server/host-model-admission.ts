import { cliModelEfforts } from "../config/architect-model-controls.js";
/** Original-host inference permits. Native transport/secrets stay in the editor/SDK. */
import { createHash } from "node:crypto";
import { ManagedModelAdmissionRequestSchema, ManagedModelPermitSchema, ManagedModelSettlementSchema,
  ManagedModelOutcomeSchema, type ManagedModelPermit, type ManagedModelOutcome, type ManagedModelSettlement } from "../graph/contracts.js";
import { ModelExecution } from "../cognitive/model-execution.js";
import { ModelAdmission, ModelAdmissionError } from "../cognitive/model-admission.js";
import { readRoleProfiles, resolveRolePolicy, snapshotRolePolicy, type RoleSettings } from "../config/role-policy.js";
import { getDataDir } from "../utils/paths.js";
import { sessionEnvironment, sessionNamespace } from "./session-context.js";
import { assertProviderRequest } from "../config/provider-capabilities.js";
import { modelTemperatureCapability } from "../config/model-temperature.js";
import { readManagedContext, recordManagedModelReport } from "../graph/execution-context.js";
import {directoryInstanceId} from "../instance/identity.js";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const hostModelRunId = (executionId: string) => `host-model:${hash(sessionNamespace()+":"+executionId)}`;
const attemptId = (runId: string, requestId: string) => `${runId}:${hash(requestId)}`;
let retainedBytes = 0;
const MAX_RETAINED_BYTES = 16 * 1024 * 1024;
type Settlement = ReturnType<typeof ManagedModelSettlementSchema.parse>;
type Pending = { outcome: ManagedModelOutcome; done: Promise<void>; resolve?: (value: Settlement) => void; settlementHash?: string };
const safeError = (error: unknown) => error instanceof ModelAdmissionError ? error.code : "HOST_MODEL_ADMISSION_UNCONFIRMED";

/** One immutable native binding/run joins the instance's existing durable spend ledger. */
export class HostModelAdmission {
  private readonly requests = new Map<string, Pending>();
  private readonly stop = new AbortController();
  private binding?: string;
  private model?: Promise<{ execution: ModelExecution; policy: ReturnType<typeof snapshotRolePolicy> }>;
  private interrupted = false;
  private runStartedAt?: number;
  readonly runId: string;
  readonly directory = getDataDir();
  readonly instanceId = process.env.DREAMGRAPH_INSTANCE_UUID || directoryInstanceId(this.directory);
  constructor(readonly executionId: string, private readonly expiresAt: string, private readonly parentSignal: AbortSignal) {
    this.runId = hostModelRunId(executionId);
  }
  get uncertain() { return this.interrupted || [...this.requests.values()].some(value => ["admitting", "awaiting_host", "unknown"].includes(value.outcome.state)); }
  close() { this.stop.abort(new Error("HOST_MODEL_AUTHORITY_CLOSED")); }
  /** Wait only for our local admission-ledger settlement. This does not acknowledge remote/native termination. */
  async waitClosed() { await Promise.all([...this.requests.values()].map(value => value.done)); }
  private bind(input: ReturnType<typeof ManagedModelAdmissionRequestSchema.parse>) {
    const identity = JSON.stringify(input.binding);
    if (this.binding !== undefined && this.binding !== identity) throw new Error("HOST_MODEL_BINDING_CHANGED");
    this.binding = identity;
    this.runStartedAt ??= Date.now();
    return this.model ??= (async () => {
      const binding=input.binding, profiles=await readRoleProfiles(), native=binding.adapter !== "native_api";
      if (native !== (binding.api === "native_cli")) throw new Error("HOST_MODEL_API_ADAPTER_MISMATCH");
      if (!native && binding.provider === "none") throw new Error("HOST_MODEL_API_PROVIDER_REQUIRED");
      if (binding.adapter === "codex-cli" && !["openai", "none"].includes(binding.provider)) throw new Error("HOST_MODEL_PROVIDER_ADAPTER_MISMATCH");
      const session: RoleSettings = { provider: binding.provider, model: binding.model,
        adapter: native ? binding.adapter : `${binding.provider}-api`, api: binding.api,
        base_url: binding.base_url, effort: binding.effort, retention: binding.retention, strict_schema: binding.strict_schema,
        output_tokens: binding.output_tokens,
        api_key_env: "HOST_NATIVE_CREDENTIAL" };
      const policy=snapshotRolePolicy(resolveRolePolicy({ role:"architect",env:sessionEnvironment(),saved:profiles.roles.architect,
        revision:profiles.revision,session,...(native?{capabilities:{adapter:binding.adapter,version:"dreamgraph.native_cli_invocation.v1",model:binding.model,
          apis:["native_cli"],efforts:cliModelEfforts(binding.adapter,binding.model),retention:[],strict_schema:false}}:{}) }));
      if(policy.status!=="configured")throw new ModelAdmissionError("ADMISSION_ROLE_POLICY_BLOCKED",this.runId);
      const config={provider:binding.provider,model:binding.model,baseUrl:binding.base_url,apiKey:"",temperature:policy.effective.temperature??.2,
        maxTokens:binding.output_tokens,timeoutMs:policy.effective.timeout_ms};
      return {policy,execution:new ModelExecution(config,"architect",policy,this.runId)};
    })();
  }
  async admit(raw: unknown): Promise<ManagedModelPermit> {
    const input=ManagedModelAdmissionRequestSchema.parse(raw);
    if(input.execution_id!==this.executionId)throw new Error("HOST_MODEL_EXECUTION_MISMATCH");
    this.stop.signal.throwIfAborted();this.parentSignal.throwIfAborted();
    if(this.interrupted)throw new Error("HOST_MODEL_OUTCOME_UNCONFIRMED");
    if(this.requests.has(input.request_id))throw new Error("HOST_MODEL_REDISPATCH_FORBIDDEN: inspect the original request");
    if(this.requests.size>=128)throw new Error("HOST_MODEL_REQUEST_CAPACITY");
    const bytes=Buffer.byteLength(input.payload,"utf8");
    if(bytes>8*1024*1024||retainedBytes+bytes>MAX_RETAINED_BYTES)throw new Error("HOST_MODEL_REQUEST_BYTE_BOUND");
    if(input.output_tokens>input.binding.output_tokens)throw new Error("HOST_MODEL_OUTPUT_BINDING_MISMATCH");
    this.validateWire(input);
    // Retain the logical request before any asynchronous read/admission can yield.
    const outcome:ManagedModelOutcome={execution_id:this.executionId,request_id:input.request_id,permit:null,state:"admitting",settlement:null,error:null,report_attests:"trusted_host_observation_only"};
    const pending:Pending={outcome,done:Promise.resolve()};this.requests.set(input.request_id,pending);retainedBytes+=bytes;
    let allow!: (permit:ManagedModelPermit)=>void,refuse!: (error:unknown)=>void;
    const permission=new Promise<ManagedModelPermit>((resolve,reject)=>{allow=resolve;refuse=reject;});
    pending.done=(async()=>{
      const {execution,policy}=await this.bind(input);
      const expiresAt=Math.min(Date.parse(this.expiresAt),Date.now()+policy.effective.timeout_ms,this.runStartedAt!+policy.policy.budget.elapsed_ms);
      const signal=AbortSignal.any([this.parentSignal,this.stop.signal,AbortSignal.timeout(Math.max(1,expiresAt-Date.now()))]);
      await execution.request({provider:input.binding.provider,model:policy.effective.model,payload:input.payload,output_tokens:input.output_tokens,
        signal,retry:input.retry,attempt_id:attemptId(this.runId,input.request_id)},async(callSignal,attempt)=>{
        const permit=ManagedModelPermitSchema.parse({execution_id:this.executionId,request_id:input.request_id,...attempt,policy_fingerprint:policy.fingerprint,
          expires_at:new Date(expiresAt).toISOString(),billing_channel:policy.billing.channel,input_token_allowance:bytes+2048,output_token_allowance:input.output_tokens,attests:"possible_dispatch_liability_only"});
        outcome.permit=permit;outcome.state="awaiting_host";
        // An authorization reply can be lost after durable dispatch; it is never executable twice.
        return new Promise<{result:null;usage?:NonNullable<Settlement["usage"]>;acknowledged:boolean}>((resolve,reject)=>{
          const abort=()=>{callSignal.removeEventListener("abort",abort);reject(callSignal.reason);};
          pending.resolve=value=>{callSignal.removeEventListener("abort",abort);resolve({result:null,...(value.usage?{usage:value.usage}:{}),acknowledged:value.acknowledged&&value.work_termination==="confirmed"});};
          callSignal.addEventListener("abort",abort,{once:true});allow(permit);if(callSignal.aborted)abort();
        });
      });
      outcome.state=outcome.settlement?.work_termination==="confirmed"?"host_reported":"unknown";
      if(outcome.state==="unknown")this.interrupted=true;
    })().catch(error=>{
      outcome.error=safeError(error);outcome.state=outcome.permit?"unknown":"refused";
      if(outcome.permit)this.interrupted=true;refuse(error);
    }).finally(()=>{retainedBytes-=bytes;pending.resolve=undefined;});
    return permission;
  }
  private validateWire(input: ReturnType<typeof ManagedModelAdmissionRequestSchema.parse>) {
    const binding=input.binding;if(binding.adapter!=="native_api")return;
    if(binding.provider==="none")throw new Error("HOST_MODEL_API_PROVIDER_REQUIRED");
    let body:any;try{body=JSON.parse(input.payload);}catch{throw new Error("HOST_MODEL_JSON_REQUIRED");}
    if(!body||typeof body!=="object"||Array.isArray(body)||body.model!==binding.model)throw new Error("HOST_MODEL_WIRE_MODEL_MISMATCH");
    const output=body.max_output_tokens??body.max_completion_tokens??body.max_tokens??body.options?.num_predict;
    if(output!==input.output_tokens)throw new Error("HOST_MODEL_WIRE_OUTPUT_MISMATCH");
    const effort=body.reasoning?.effort??body.reasoning_effort??body.output_config?.effort??null;
    if(effort!==binding.effort)throw new Error("HOST_MODEL_WIRE_EFFORT_MISMATCH");
    if(binding.retention==="store_false"&&body.store!==false||binding.retention==="store_true"&&body.store!==true)throw new Error("HOST_MODEL_WIRE_RETENTION_MISMATCH");
    const strict=body.response_format?.json_schema?.strict===true||body.text?.format?.strict===true||body.output_config?.format?.type==="json_schema";
    if(strict!==binding.strict_schema)throw new Error("HOST_MODEL_WIRE_SCHEMA_MISMATCH");
    const api=binding.api==="chat_completions"?"chat-completions":binding.api==="messages"?"anthropic-messages":binding.api==="local"?"ollama-chat":binding.api;
    assertProviderRequest(binding.provider,binding.model,api,binding.effort??undefined,strict,!!body.tools?.length);
    if(body.temperature!==undefined&&modelTemperatureCapability(binding.provider,binding.model,binding.effort).support!=="supported")throw new Error("HOST_MODEL_TEMPERATURE_UNSUPPORTED");
  }
  read(requestId:string):ManagedModelOutcome {
    const pending=this.requests.get(requestId);if(!pending)throw new Error("HOST_MODEL_REQUEST_UNKNOWN");
    return ManagedModelOutcomeSchema.parse(structuredClone(pending.outcome));
  }
  async settle(raw:unknown):Promise<ManagedModelOutcome> {
    const input=ManagedModelSettlementSchema.parse(raw),pending=this.requests.get(input.request_id);
    if(input.execution_id!==this.executionId||!pending?.outcome.permit||input.attempt_id!==pending.outcome.permit.attempt_id)throw new Error("HOST_MODEL_SETTLEMENT_IDENTITY_MISMATCH");
    const fingerprint=hash(JSON.stringify(input));
    if(pending.settlementHash&&pending.settlementHash!==fingerprint)throw new Error("HOST_MODEL_SETTLEMENT_CHANGED");
    await recordManagedModelReport(input);
    if(!pending.settlementHash){pending.settlementHash=fingerprint;pending.outcome.settlement=input;
      if(pending.resolve)pending.resolve(input);
      else await new ModelAdmission(this.instanceId,this.directory).settle(input.attempt_id,{...(input.usage?{usage:input.usage}:{}),acknowledged:input.acknowledged&&input.work_termination==="confirmed"});
    }
    await pending.done;
    // A report racing cancellation may arrive after the waiting callback rejected.
    // Retain its observed usage, but never erase the interrupted run's uncertainty.
    if(pending.outcome.state==="unknown")await new ModelAdmission(this.instanceId,this.directory).settle(input.attempt_id,
      {...(input.usage?{usage:input.usage}:{}),acknowledged:input.acknowledged&&input.work_termination==="confirmed"});
    return this.read(input.request_id);
  }
}

/** Memory/authority loss never reconstructs a launchable permit, even when the ledger survives. */
export async function readRecoveredHostModel(executionId:string,requestId:string):Promise<ManagedModelOutcome> {
  const directory=getDataDir(),instance=process.env.DREAMGRAPH_INSTANCE_UUID||directoryInstanceId(directory);
  const ledger=await new ModelAdmission(instance,directory).inspect(),attempt=ledger.attempts[attemptId(hostModelRunId(executionId),requestId)];
  if(!attempt)throw new Error("HOST_MODEL_REQUEST_UNKNOWN");
  const first=(await readManagedContext(executionId)).model_reports.find(report=>report.request_id===requestId&&report.attempt_id===attempt.id)??null;
  const released=attempt.state==="released",reported=first?.acknowledged&&first.work_termination==="confirmed"&&!released;
  return ManagedModelOutcomeSchema.parse({execution_id:executionId,request_id:requestId,permit:null,state:released?"refused":reported?"host_reported":"unknown",
    settlement:first,
    error:reported?null:`HOST_MODEL_MEMORY_UNAVAILABLE: preserve durable ${attempt.id} and the original report; no redispatch`,report_attests:"trusted_host_observation_only"});
}
/** A separately observed native stop can settle original liability, never reserve or reconstruct a permit. */
export async function originalHostStopLedger(raw:unknown) {
  const report=ManagedModelSettlementSchema.parse(structuredClone(raw));
  if(!report.acknowledged||report.work_termination!=="confirmed")throw new Error("INDEPENDENT_NATIVE_STOP_OBSERVATION_REQUIRED");
  const directory=getDataDir(),instance=process.env.DREAMGRAPH_INSTANCE_UUID||directoryInstanceId(directory);
  const admission=new ModelAdmission(instance,directory),ledger=await admission.inspect(),runId=hostModelRunId(report.execution_id);
  const attempt=ledger.attempts[attemptId(runId,report.request_id)];
  if(!attempt||attempt.id!==report.attempt_id||attempt.run_id!==runId||["reserved","released"].includes(attempt.state))
    throw new Error("NATIVE_STOP_ORIGINAL_ATTEMPT_REQUIRED");
  return {report,admission,runId};
}
