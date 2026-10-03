/** Host control for an adapter which remains in the editor/SDK process. No provider is substituted. */
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { ManagedExecutionRequestSchema, ManagedExecutionSnapshotSchema, ManagedExecutionApprovalRequestSchema, type ManagedExecutionApprovalRequest } from "../graph/contracts.js";
import { beginManagedContext, readManagedContext, finishManagedContext, recordManagedEffect, recordManagedApproval, assertManagedContext, managedContextPrompt,
  reassembleManagedPlanContext, recordManagedPlanClosure, recordManagedNativeStop, recordManagedNativeStopRecovery, recordManagedPlanStopRecovery, assertManagedPlanBinding, type ManagedExecutionContext } from "../graph/execution-context.js";
import { getSessionContext, withSessionContext, type SessionContext } from "./session-context.js";
import { issueExecutionPolicy, prepareExecutionApproval, executionPolicyProjection } from "./execution-policy.js";
import { withGraphReconciliation } from "../utils/graph-reconciliation-barrier.js";
import { approvalHash } from "../discipline/approval.js";
import { HostModelAdmission, readRecoveredHostModel, originalHostStopLedger } from "./host-model-admission.js";
import { ManagedModelAdmissionRequestSchema, ManagedModelSettlementSchema } from "../graph/contracts.js";
import { captureArchitectPlanRuntimeSource } from "../architect/plan-registry.js";
import { PlanRuntimeLease, preparePlanRuntimeClosure, applyPlanRuntimeClosure, checkPlanRuntimeSource } from "../discipline/plan-runtime.js";
import { readPlanAuthority } from "../discipline/plan-authority.js";

type Lease = ReturnType<typeof issueExecutionPolicy>;
type PendingReview = { request: ManagedExecutionApprovalRequest; settle: (error?: unknown) => void };
type HostLease = {owner:SessionContext;lease:Lease;timer:ReturnType<typeof setTimeout>;activeApprovals:Set<string>;pendingReviews:Map<string,PendingReview>;reviewCount:number;model?:HostModelAdmission};
const leases = new Map<string,HostLease>();
const key = (owner:SessionContext,id:string) => JSON.stringify([owner.directory,owner.principal,owner.session_id,id]);
const owner = () => { const context=getSessionContext(); if(!context || context.execution_policy) throw new Error("HOST_EXECUTION_CONTROL_REQUIRED"); return context; };
async function snapshot(entry:ManagedExecutionContext,context:SessionContext) {
  const live=leases.get(key(context,entry.id));
  const plan = entry.plan_execution ? await readPlanAuthority(entry.plan_execution.scope) : null;
  if(entry.plan_execution && !plan)throw new Error("PLAN_NOT_IMPORTED");
  const planLease=plan?.state.leases.find(item=>item.execution_id===entry.id);
  return ManagedExecutionSnapshotSchema.parse({schema:"dreamgraph.managed_execution.v1",execution_id:entry.id,instance_id:entry.instance_id,
    status:entry.status,record_revision:entry.record_revision,pack:entry.pack,block:managedContextPrompt(entry),
    graph_receipt_ids:[...new Set(entry.effects.flatMap(effect=>effect.receipt_ids))],state_receipt_ids:[...new Set(entry.effects.flatMap(effect=>effect.state_receipt_ids))],
    obligation_ids:entry.obligation_ids,authority_active:!!live&&!live.lease.policy.signal.aborted&&Date.parse(live.lease.policy.expires_at)>Date.now()
      &&(!entry.plan_execution || !entry.plan_closure && planLease?.state==="running" && Date.parse(planLease.expires_at)>Date.now()),
    delivery_attests:"host_transport_only",...(entry.plan_execution?{plan_execution:{intent:entry.plan_execution,state:plan!.state}}:{})});
}
function close(context:SessionContext,id:string) {
  const binding=key(context,id), live=leases.get(binding); if(!live)return;
  leases.delete(binding); clearTimeout(live.timer); live.model?.close(); live.lease.close();
}
/** Ephemeral proposal: exact arguments are visible only to the original host, never persisted as evidence. */
async function requestHostReview(context:SessionContext,id:string,tool:string,args:unknown,signal:AbortSignal):Promise<void> {
  const argumentsCopy=JSON.parse(JSON.stringify(args));
  if(Buffer.byteLength(JSON.stringify(argumentsCopy),"utf8")>60000)throw new Error("EXECUTION_REVIEW_ARGUMENT_BYTE_BOUND");
  signal.throwIfAborted();
  return withSessionContext(context,async()=>{
    const live=leases.get(key(context,id));if(!live)throw new Error("HOST_EXECUTION_AUTHORITY_UNAVAILABLE");
    if(live.pendingReviews.size || live.reviewCount>=128)throw new Error("EXECUTION_REVIEW_CAPACITY");
    const checkpoint=await readManagedContext(id);
    if(checkpoint.status!=="running"||checkpoint.pack.receipt.delivery!=="delivered")throw new Error("EXECUTION_APPROVAL_CONTEXT_NOT_DELIVERED");
    const repair=tool==="scan_project"&&argumentsCopy.mode==="incremental"&&argumentsCopy.enrich!==true&&argumentsCopy.dry_run!==true;
    await assertManagedContext(id,{repair_source:repair});
    signal.throwIfAborted();
    // Recheck after asynchronous reads; concurrent proposals cannot exceed the one-review bound.
    if(leases.get(key(context,id))!==live||live.pendingReviews.size)throw new Error("EXECUTION_REVIEW_CAPACITY");
    const request=ManagedExecutionApprovalRequestSchema.parse({execution_id:id,approval_id:randomUUID(),expected_record_revision:checkpoint.record_revision,
      context_receipt_id:checkpoint.pack.receipt.id,approved_actions:[{tool,arguments:argumentsCopy,scope_id:live.lease.policy.scope[0]??`execution:${id}`,calls:1}]});
    if(Buffer.byteLength(JSON.stringify(request),"utf8")>65536)throw new Error("EXECUTION_APPROVAL_BUDGET");
    live.reviewCount++;
    return new Promise<void>((resolve,reject)=>{
      let settled=false;
      const abort=()=>settle(signal.reason??new Error("EXECUTION_REVIEW_CANCELLED"));
      const settle=(error?:unknown)=>{if(settled)return;settled=true;signal.removeEventListener("abort",abort);live.pendingReviews.delete(request.approval_id);error===undefined?resolve():reject(error);};
      live.pendingReviews.set(request.approval_id,{request,settle});signal.addEventListener("abort",abort,{once:true});
      if(signal.aborted)abort();
    });
  });
}
export async function readHostExecutionReviews(id:string) {
  const context=owner(),entry=await readManagedContext(id),live=leases.get(key(context,id));
  const active=(await snapshot(entry,context)).authority_active;
  return {execution_id:id,authority_active:active,review_enabled:!!live?.lease.policy.request_review,requests:active&&live?structuredClone([...live.pendingReviews.values()].map(review=>review.request)):[]};
}
export async function enableHostExecutionReviews(id:string) {
  const context=owner();await readManagedContext(id);
  const live=leases.get(key(context,id));if(!live)throw new Error("HOST_EXECUTION_AUTHORITY_UNAVAILABLE");
  live.lease.policy.signal.throwIfAborted();
  if(Date.parse(live.lease.policy.expires_at)<=Date.now())throw new Error("EXECUTION_POLICY_EXPIRED");
  live.lease.policy.request_review=(tool,args,signal)=>requestHostReview(context,id,tool,args,signal);
  return readHostExecutionReviews(id);
}
export async function declineHostExecutionReview(input:unknown) {
  const context=owner(),request=z.object({execution_id:z.string().min(1).max(1024),approval_id:z.string().min(1).max(1024)}).strict().parse(input);
  await readManagedContext(request.execution_id);
  const pending=leases.get(key(context,request.execution_id))?.pendingReviews.get(request.approval_id);
  pending?.settle(new Error("EXECUTION_REVIEW_OPERATOR_DECLINED"));
  return {execution_id:request.execution_id,approval_id:request.approval_id,status:pending?"declined":"not_pending"};
}
export async function beginHostExecution(input:unknown,signal?:AbortSignal,operatorReviewEnabled=false) {
  const context=owner(),request=ManagedExecutionRequestSchema.parse(structuredClone(input));
  signal?.throwIfAborted();
  if(leases.size>=512)throw new Error("HOST_EXECUTION_CAPACITY");
  const intent=request.plan_execution;
  if(intent && (request.plan_id && request.plan_id!==intent.scope.id || request.slice_id && request.slice_id!==intent.slice_id
    || (intent.kind==="final_verification") !== (intent.slice_id===null)))throw new Error("PLAN_RUNTIME_TASK_SCOPE_REQUIRED");
  if(intent){request.plan_id=intent.scope.id;if(intent.slice_id!==null)request.slice_id=intent.slice_id;}
  // Validate approval/controls before persisting assembly. A lost reply cannot reissue this ID.
  const lease=issueExecutionPolicy(context,{id:request.id,context_id:request.id,autonomy:request.autonomy,verbosity:request.verbosity,
    timeout_ms:request.timeout_ms,approvals:request.approved_actions,signal:signal??new AbortController().signal});
  try {
    const entry=await withGraphReconciliation(async()=>{
      const source=intent?await captureArchitectPlanRuntimeSource(intent,lease.policy.signal):undefined;
      const assembled=await beginManagedContext({...request,...(source?{plan_source:source}:{})});
      if(!intent)return assembled;
      if(!assembled.pack.mandatory_satisfied || assembled.pack.state.availability==="unavailable")throw new Error("PLAN_EXECUTION_CONTEXT_INSUFFICIENT");
      if(intent.scope.instance_id!==assembled.instance_id)throw new Error("PLAN_RUNTIME_INSTANCE_SCOPE_REJECTED");
      await PlanRuntimeLease.admit({...intent,execution_id:request.id,timeout_ms:Math.max(1,Date.parse(lease.policy.expires_at)-Date.now())},
        {signal:lease.policy.signal,check_sources:checkSignal=>checkPlanRuntimeSource(source!,checkSignal)});
      lease.policy.signal.throwIfAborted();
      return reassembleManagedPlanContext(request.id);
    });
    const timer=setTimeout(()=>close(context,request.id),Math.max(1,Date.parse(lease.policy.expires_at)-Date.now()));timer.unref();
    leases.set(key(context,request.id),{owner:context,lease,timer,activeApprovals:new Set(),pendingReviews:new Map(),reviewCount:0});
    if(operatorReviewEnabled)lease.policy.request_review=(tool,args,signal)=>requestHostReview(context,request.id,tool,args,signal);
    return {execution:await snapshot(entry,context),worker_bearer:lease.bearer,controls:lease.projection};
  } catch(error){close(context,request.id);lease.close();throw error;}
}
export async function readHostExecution(id:string) { const context=owner();return snapshot(await readManagedContext(id),context); }
/** The native host remains the transport owner; workers/models cannot reserve or report usage. */
export async function admitHostModel(input:unknown) {
  const context=owner(),request=ManagedModelAdmissionRequestSchema.parse(input),live=leases.get(key(context,request.execution_id));
  if(!live)throw new Error("HOST_EXECUTION_AUTHORITY_UNAVAILABLE");
  live.lease.policy.signal.throwIfAborted();
  // Reasoning may use refreshed, explicitly named debt from this pass's known source edits.
  // Effect dispatch retains its separate strict action admission; unknown/foreign debt still refuses.
  await assertManagedContext(request.execution_id, { repair_source: true });
  const entry=await readManagedContext(request.execution_id);
  if(entry.pack.receipt.delivery!=="delivered")throw new Error("HOST_MODEL_CONTEXT_NOT_DELIVERED");
  const block=managedContextPrompt(entry);
  if(!request.payload.includes(block)&&!request.payload.includes(JSON.stringify(block).slice(1,-1)))throw new Error("HOST_MODEL_REQUIRED_CONTEXT_MISSING");
  if(leases.get(key(context,request.execution_id))!==live)throw new Error("HOST_EXECUTION_AUTHORITY_UNAVAILABLE");
  live.model??=new HostModelAdmission(request.execution_id,live.lease.policy.expires_at,live.lease.policy.signal);
  return live.model.admit(request);
}
export async function settleHostModel(input:unknown) {
  const context=owner(),request=ManagedModelSettlementSchema.parse(structuredClone(input));
  await readManagedContext(request.execution_id);
  const live=leases.get(key(context,request.execution_id));if(!live?.model){
    const original=await readRecoveredHostModel(request.execution_id,request.request_id);
    if(!original.settlement)throw new Error("HOST_MODEL_AUTHORITY_UNAVAILABLE: inspect the original request");
    if(approvalHash(original.settlement)!==approvalHash(request))throw new Error("HOST_MODEL_SETTLEMENT_CHANGED");
    return original;
  }
  return live.model.settle(input);
}
export async function readHostModel(input:unknown) {
  const context=owner(),request=z.object({execution_id:z.string().min(1).max(1024),request_id:z.string().min(1).max(1024)}).strict().parse(input);
  await readManagedContext(request.execution_id);
  const live=leases.get(key(context,request.execution_id));
  return live?.model?live.model.read(request.request_id):readRecoveredHostModel(request.execution_id,request.request_id);
}
/** Original native host supplies independent stop evidence; the first finish and report stay immutable. */
export async function observeHostModelStop(input:unknown) {
  const context=owner();
  return withGraphReconciliation(async()=>{
    const {report,admission,runId}=await originalHostStopLedger(input);
    let entry=await readManagedContext(report.execution_id); // Original principal and session, including after restart.
    if(leases.has(key(context,entry.id)))throw new Error("NATIVE_STOP_REQUIRES_CLOSED_AUTHORITY");
    entry=await recordManagedNativeStop(report);
    await admission.settle(report.attempt_id,{...(report.usage?{usage:report.usage}:{}),acknowledged:true});
    const ledger=await admission.inspect(),attempts=Object.values(ledger.attempts).filter(attempt=>attempt.run_id===runId||ledger.runs[attempt.run_id]?.parent_run_id===runId);
    if(attempts.length&&attempts.every(attempt=>attempt.state==="released"||attempt.acknowledged&&!['reserved','dispatched'].includes(attempt.state))){
      if(entry.plan_execution&&!entry.plan_stop_recovery){
        const command=await preparePlanRuntimeClosure({...entry.plan_execution,execution_id:entry.id,timeout_ms:1},
          {outcome:entry.plan_closure!.command!.command.outcome,work_termination:"confirmed",reason:"Independent original native-host stop observation; no implementation or verification claim"},"observed-stop");
        entry=await recordManagedPlanStopRecovery(entry.id,command);
      }
      if(entry.plan_stop_recovery)await applyPlanRuntimeClosure(entry.plan_stop_recovery);
      await recordManagedNativeStopRecovery(entry.id,runId,attempts.map(attempt=>attempt.id));
    }
    return snapshot(await finishManagedContext(entry.id),context);
  });
}
/** Original-host control, never a model tool. Exact retry cannot replenish consumed actions. */
export async function approveHostExecution(input: unknown) {
  const context = owner(), request = ManagedExecutionApprovalRequestSchema.parse(input);
  if (Buffer.byteLength(JSON.stringify(request), "utf8") > 65536) throw new Error("EXECUTION_APPROVAL_BUDGET");
  const live = leases.get(key(context, request.execution_id));
  if (!live) throw new Error("HOST_EXECUTION_AUTHORITY_UNAVAILABLE");
  live.lease.policy.signal.throwIfAborted();
  if (Date.parse(live.lease.policy.expires_at) <= Date.now()) throw new Error("EXECUTION_POLICY_EXPIRED");
  if (live.lease.policy.effects_inflight) throw new Error("EXECUTION_APPROVAL_EFFECT_INFLIGHT");
  const pending=live.pendingReviews.get(request.approval_id);
  if(pending&&approvalHash(pending.request)!==approvalHash(request))throw new Error("EXECUTION_REVIEW_REQUEST_CHANGED");
  return withGraphReconciliation(async () => {
    live.lease.policy.signal.throwIfAborted();
    const current = await readManagedContext(request.execution_id);
    const prior = current.approval_reviews.find(review => review.id === request.approval_id);
    if (prior) {
      // Validate the exact original payload even on a historical acknowledgement retry.
      await recordManagedApproval(request, prior.policy_revision);
      if (live.activeApprovals.has(request.approval_id)) { pending?.settle(); return {
        execution: await snapshot(current, context), approval_id: prior.id, review_policy_revision: prior.policy_revision,
        controls: executionPolicyProjection(live.lease.policy), replayed: true, review_activated: true,
      }; }
      // Review publication may have succeeded before activation was interrupted.
      // It can recover only that unchanged checkpoint under the same live lease.
      if (current.record_revision !== prior.reviewed_record_revision + 1) throw new Error("EXECUTION_APPROVAL_RECOVERY_CONTEXT_CHANGED");
    }
    const prepared = prepareExecutionApproval(live.lease.policy, request.approval_id, request.approved_actions);
    if (prior && prepared.revision !== prior.policy_revision) throw new Error("EXECUTION_APPROVAL_RECOVERY_POLICY_CHANGED");
    if (current.pack.receipt.id !== request.context_receipt_id) throw new Error("EXECUTION_APPROVAL_CONTEXT_CHANGED");
    const repair = request.approved_actions.every(action => action.tool === "scan_project" && action.arguments.mode === "incremental"
      && action.arguments.enrich !== true && action.arguments.dry_run !== true);
    await assertManagedContext(request.execution_id, { repair_source: repair });
    const recorded = await recordManagedApproval(request, prepared.revision);
    prepared.activate(); live.activeApprovals.add(request.approval_id); pending?.settle();
    return { execution: await snapshot(recorded.entry, context), approval_id: recorded.review.id, review_policy_revision: recorded.review.policy_revision,
      controls: executionPolicyProjection(live.lease.policy), replayed: recorded.replayed, review_activated: true };
  });
}
export async function endHostExecution(input:unknown) {
  const context=owner(),request=z.object({execution_id:z.string().min(1).max(1024),outcome:z.enum(["completed","cancelled","failed"]),
    work_termination:z.enum(["confirmed","unconfirmed"]).default("unconfirmed")}).strict().parse(input);
  // Validate ownership before revoking the worker. Revocation is durable-effect admission, not rollback.
  const closing=await withGraphReconciliation(async()=>{
    let entry=await readManagedContext(request.execution_id);
    const live=leases.get(key(context,entry.id)), modelUncertain=live?.model?.uncertain;
    if(entry.plan_closure && (entry.plan_closure.requested_outcome!==request.outcome || entry.plan_closure.requested_termination!==request.work_termination))
      throw new Error("PLAN_RUNTIME_CLOSURE_DISPOSITION_CHANGED");
    const computerUncertain=entry.computer_sessions.some(item=>item.stop_state!=="acknowledged"||item.actions.some(action=>["dispatched","unknown"].includes(action.receipt.state)));
    let effectiveTermination=entry.plan_closure?.effective_termination ?? (request.work_termination==="unconfirmed"||modelUncertain||computerUncertain
      || entry.plan_execution && (!live || live.lease.policy.effects_inflight>0) ? "unconfirmed" : "confirmed");
    // Revoke new effect/model admission before capturing the first durable close intent.
    close(context,entry.id);
    if(entry.plan_execution){
      if(!entry.plan_closure){
        const plan=await readPlanAuthority(entry.plan_execution.scope);
        const zeroDispatch=!!plan && !plan.state.leases.some(item=>item.execution_id===entry.id) && entry.status==="assembled"
          && entry.pack.receipt.delivery==="unattested" && !entry.effects.length;
        if(zeroDispatch)effectiveTermination="confirmed";
        const command=zeroDispatch?null:await preparePlanRuntimeClosure({...entry.plan_execution,execution_id:entry.id,timeout_ms:1},
          {outcome:request.outcome,work_termination:effectiveTermination,reason:"Original managed host closure; completion does not attest implementation or verification"});
        entry=await recordManagedPlanClosure(entry.id,{requested_outcome:request.outcome,requested_termination:request.work_termination,
          effective_termination:effectiveTermination,command});
      }
    }
    return {entry,effectiveTermination,model:live?.model};
  });
  // The model's local ledger writer must be allowed to acquire the barrier after revocation.
  // Awaiting it inside that writer would deadlock; returning before it settles races a durable accounting read.
  await closing.model?.waitClosed();
  return withGraphReconciliation(async()=>{
    const entry=await readManagedContext(request.execution_id);
    if(entry.plan_closure?.command)await applyPlanRuntimeClosure(entry.plan_closure.command);
    if(closing.effectiveTermination==="unconfirmed" && ["assembled","running"].includes(entry.status))
      await recordManagedEffect(entry.id,{tool:"host_adapter_termination",outcome:"unknown",receipt_ids:[]});
    const finished=await finishManagedContext(entry.id);
    return {execution:await snapshot(finished,context),adapter_outcome:request.outcome,work_termination:closing.effectiveTermination};
  });
}
/** Mediate a core effect using the original lease; SDK hosts never mint their own approval. */
export async function withHostExecution<T>(id:string,work:()=>Promise<T>):Promise<T> {
  const context=owner(),live=leases.get(key(context,id));
  if(!live)throw new Error("HOST_EXECUTION_AUTHORITY_UNAVAILABLE");
  live.lease.policy.signal.throwIfAborted();
  await assertManagedPlanBinding(await readManagedContext(id),live.lease.policy.signal);
  live.lease.policy.signal.throwIfAborted();
  return withSessionContext({...context,execution_policy:live.lease.policy},work);
}
async function body(req:IncomingMessage,maximumBytes=128*1024) {
  const chunks:Buffer[]=[];let bytes=0;for await(const chunk of req){const next=Buffer.from(chunk);bytes+=next.length;if(bytes>maximumBytes)throw new Error("HOST_EXECUTION_BODY_BOUND");chunks.push(next);}
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export async function handleManagedExecutionApi(req:IncomingMessage,res:ServerResponse,pathname:string):Promise<boolean> {
  if(!pathname.startsWith("/api/executions/v1/"))return false;
  if(pathname==='/api/executions/v1/computer-pass')return (await import('../architect/routes.js')).handleArchitectRoute(req,res,pathname);
  if(pathname.startsWith("/api/executions/v1/computer/")||pathname.startsWith("/api/executions/v1/computer-evidence/")||pathname.startsWith('/api/executions/v1/computer-preparation/'))return (await import("../computer/http.js")).handleComputerHttp(req,res,pathname);
  const json=(status:number,value:unknown)=>{res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});res.end(JSON.stringify(value));};
  try {
    let result:unknown;
    if(req.method==="POST"&&pathname==="/api/executions/v1/begin")result=await beginHostExecution(await body(req));
    else if(req.method==="POST"&&pathname==="/api/executions/v1/model/admit")result=await admitHostModel(await body(req,16*1024*1024+65536));
    else if(req.method==="POST"&&pathname==="/api/executions/v1/model/settle")result=await settleHostModel(await body(req));
    else if(req.method==="POST"&&pathname==="/api/executions/v1/model/read")result=await readHostModel(await body(req));
    else if(req.method==="POST"&&pathname==="/api/executions/v1/model/observe-stop")result=await observeHostModelStop(await body(req));
    else if(req.method==="POST"&&pathname==="/api/executions/v1/approve")result=await approveHostExecution(await body(req));
    else if(req.method==="POST"&&pathname==="/api/executions/v1/finish")result=await endHostExecution(await body(req));
    else if(req.method==="POST"&&pathname==="/api/executions/v1/reviews/decline")result=await declineHostExecutionReview(await body(req));
    else if(req.method==="POST"&&pathname==="/api/executions/v1/reviews/read"){
      const input=z.object({execution_id:z.string().min(1).max(1024)}).strict().parse(await body(req));result=await readHostExecutionReviews(input.execution_id);
    }
    else if(req.method==="POST"&&pathname==="/api/executions/v1/reviews/open"){
      const input=z.object({execution_id:z.string().min(1).max(1024)}).strict().parse(await body(req));result=await enableHostExecutionReviews(input.execution_id);
    }
    else if(req.method==="POST"&&pathname==="/api/executions/v1/read"){
      const input=z.object({execution_id:z.string().min(1).max(1024)}).strict().parse(await body(req));result=await readHostExecution(input.execution_id);
    }else{json(404,{error:"HOST_EXECUTION_ROUTE_NOT_FOUND"});return true;}
    json(200,result);
  }catch(error){json(error instanceof z.ZodError?400:409,{error:"HOST_EXECUTION_REJECTED",message:String(error)});}
  return true;
}
