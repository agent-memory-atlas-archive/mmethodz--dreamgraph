/** Existing C15 publication owns C17 intent/recovery. No GUI action is replayed by a receipt read. */
import { z } from "zod";
import { ComputerActionSchema, ComputerObservationSchema, ComputerReceiptSchema } from "../graph/contracts.js";
import { mutateManagedComputer, readManagedContext } from "../graph/execution-context.js";
import { ComputerJournalSchema, type ComputerJournal } from "./journal-schema.js";
import {computerDigest} from "./digest.js";
export {computerDigest} from "./digest.js";
// Absent previous-format pause metadata means never paused; preserve its original sealed registration digest.
export const computerRegistrationDigest=(value:Omit<ComputerJournal,"intent_hash">)=>{const {pause_state,...legacy}=value;return computerDigest(pause_state&&pause_state!=="not_requested"?value:legacy);};
const owned=(sessions:ComputerJournal[],id:string)=>{const value=sessions.find(item=>item.session.id===id);if(!value)throw new Error("COMPUTER_SESSION_UNKNOWN");return value;};
const active=(value:ComputerJournal)=>{if(!["ready","running"].includes(value.session.state)||value.stop_state!=="not_requested")throw new Error("COMPUTER_SESSION_NOT_ACTIVE");
  if(Date.parse(value.limits.expires_at)<=Date.now())throw new Error("COMPUTER_SESSION_EXPIRED");};
export async function readComputerJournal(executionId:string,sessionId:string){return structuredClone(owned((await readManagedContext(executionId)).computer_sessions,sessionId));}
export async function registerComputerJournal(executionId:string,input:ComputerJournal){
  const value=ComputerJournalSchema.parse(input);
  const {intent_hash,...intent}=value;
  if(computerRegistrationDigest(intent)!==intent_hash)throw new Error("COMPUTER_REGISTRATION_DIGEST_REJECTED");
  return mutateManagedComputer(executionId,"register",(sessions,entry)=>{
    const existing=sessions.find(item=>item.session.id===value.session.id);
    if(existing){if(existing.intent_hash!==value.intent_hash)throw new Error("COMPUTER_SESSION_IDENTITY_CONFLICT");return {journal:structuredClone(existing),replayed:true};}
    if(entry.status!=="running"||entry.pack.receipt.delivery!=="delivered")throw new Error("COMPUTER_CONTEXT_NOT_DELIVERED");
    if(value.session.execution_id!==executionId||value.session.instance_id!==entry.instance_id||value.session.owner!==entry.principal
      ||value.session.session_id!==entry.session_id||value.session.capability_id!==value.capability.id)throw new Error("COMPUTER_SESSION_OWNER_MISMATCH");
    if(value.session.state!=="created"||value.session.fence!==0||value.stop_state!=="not_requested"||value.actions.length||value.observations.length
      ||Object.values(value.usage).some(n=>n!==0))throw new Error("COMPUTER_INITIAL_STATE_REQUIRED");
    if(value.targets.some(target=>target.instance_id!==entry.instance_id||target.session_id!==entry.session_id||target.host_id!==value.session.host_id
      ||!value.session.target_ids.includes(target.id))||new Set(value.targets.map(target=>target.id)).size!==value.targets.length
      ||value.targets.length!==value.session.target_ids.length)throw new Error("COMPUTER_TARGET_OWNER_MISMATCH");
    for(const target of value.targets)if(target.origin!==null){const url=new URL(target.origin);
      if(!["https:","http:"].includes(url.protocol)||target.origin!==url.origin)throw new Error("COMPUTER_TARGET_ORIGIN_REJECTED");}
    if(!value.capability.independent_stop||!value.capability.qualified_at||value.capability.route==="unavailable"||!value.capability.effective.length)
      throw new Error("COMPUTER_ROUTE_NOT_QUALIFIED");
    if(Date.parse(value.limits.expires_at)<=Date.now()||Date.parse(value.limits.expires_at)>Date.now()+300_000)throw new Error("COMPUTER_DEADLINE_INVALID");
    sessions.push(value);return {journal:structuredClone(value),replayed:false};
  });
}
export async function readyComputerJournal(executionId:string,sessionId:string,epoch:string){
  return mutateManagedComputer(executionId,"ready",sessions=>{const value=owned(sessions,sessionId);
    if(value.session.state!=="created"||value.worker_epoch!==epoch)throw new Error("COMPUTER_WORKER_EPOCH_REJECTED");
    value.session.state="ready";value.session.fence++;value.session.updated_at=new Date().toISOString();return structuredClone(value);
  });
}
export async function recordComputerObservation(executionId:string,sessionId:string,input:z.input<typeof ComputerObservationSchema>,usage:{bytes:number;images:number;image_bytes:number},relatedImage?:z.input<typeof ComputerObservationSchema>){
  const observation=ComputerObservationSchema.parse(input);
  const pixels=relatedImage?ComputerObservationSchema.parse(relatedImage):undefined;
  if(pixels&&(pixels.id===observation.id||pixels.kind!=="pixels"||pixels.verified||pixels.artifact_ref!==null||pixels.execution_id!==observation.execution_id
    ||pixels.target_id!==observation.target_id||pixels.target_generation!==observation.target_generation||pixels.observed_at!==observation.observed_at||pixels.expires_at!==observation.expires_at
    ||pixels.evidence_ids.length!==1||pixels.evidence_ids[0]!==observation.id||!/^sha256:[a-f0-9]{64}$/.test(pixels.content_hash)||usage.images!==1||usage.image_bytes<=0))throw new Error("COMPUTER_IMAGE_OBSERVATION_PAIR_REJECTED");
  if(!/^sha256:[a-f0-9]{64}$/.test(observation.content_hash))throw new Error("COMPUTER_OBSERVATION_HASH_REQUIRED");
  z.object({bytes:z.number().int().min(0).max(65536),images:z.number().int().min(0).max(1),image_bytes:z.number().int().min(0).max(100*1024*1024)}).strict().parse(usage);
  return mutateManagedComputer(executionId,"observation",sessions=>{const value=owned(sessions,sessionId);
    const lateProof=observation.kind==="postcondition"&&observation.verified&&["stopping","stopped","recovery_required"].includes(value.session.state);
    if(!lateProof)active(value);
    const target=value.targets.find(item=>item.id===observation.target_id);
    if(!target||observation.execution_id!==executionId||observation.target_generation<target.generation||observation.artifact_ref!==null)
      throw new Error("COMPUTER_OBSERVATION_TARGET_REJECTED");
    const observed=Date.parse(observation.observed_at),expires=Date.parse(observation.expires_at);
    if(observed>Date.now()+1000||observed<Date.now()-30_000||expires<=Date.now()||expires-observed>30_000||!lateProof&&expires>Date.parse(value.limits.expires_at))
      throw new Error("COMPUTER_OBSERVATION_EXPIRED");
    const prior=value.observations.find(item=>item.id===observation.id);
    if(prior){const priorPixels=pixels?value.observations.find(item=>item.id===pixels.id):undefined;
      if(computerDigest(prior)!==computerDigest(observation)||pixels&&(!priorPixels||computerDigest(priorPixels)!==computerDigest(pixels)))throw new Error("COMPUTER_OBSERVATION_IDENTITY_CONFLICT");return structuredClone(prior);}
    if(usage.bytes>value.limits.observation_bytes||value.usage.images+usage.images>value.limits.max_images
      ||value.usage.image_bytes+usage.image_bytes>value.limits.max_image_bytes||value.observations.length+(pixels?2:1)>128)throw new Error("COMPUTER_OBSERVATION_BUDGET");
    if(observation.kind==="interpretation"&&observation.verified)throw new Error("COMPUTER_INTERPRETATION_NOT_VERIFICATION");
    target.generation=observation.target_generation;value.observations.push(observation);
    if(pixels){if(value.observations.some(item=>item.id===pixels.id))throw new Error("COMPUTER_IMAGE_OBSERVATION_IDENTITY_CONFLICT");value.observations.push(pixels);}
    value.usage.images+=usage.images;value.usage.image_bytes+=usage.image_bytes;value.usage.observation_bytes+=usage.bytes;
    value.session.updated_at=new Date().toISOString();return structuredClone(observation);
  });
}
export async function prepareComputerAction(executionId:string,sessionId:string,input:z.input<typeof ComputerActionSchema>){
  const action=ComputerActionSchema.parse(input),digest=computerDigest(action);
  if(Buffer.byteLength(JSON.stringify(action),"utf8")>65536)throw new Error("COMPUTER_ACTION_BYTE_BOUND");
  return mutateManagedComputer(executionId,"intent",(sessions,entry)=>{const value=owned(sessions,sessionId);
    const prior=sessions.flatMap(item=>item.actions).find(item=>item.id===action.id);
    if(prior){if(prior.action_hash!==digest)throw new Error("COMPUTER_ACTION_IDENTITY_CONFLICT");return {receipt:structuredClone(prior.receipt),replayed:true};}
    active(value);if(entry.status!=="running")throw new Error("COMPUTER_CONTEXT_NOT_RUNNING");
    const target=value.targets.find(item=>item.id===action.target_id),observation=value.observations.find(item=>item.id===action.observation_id);
    if(action.execution_id!==executionId||action.grant_id!==value.session.grant_id||action.fence!==value.session.fence
      ||!target||target.generation!==action.target_generation||!observation||observation.target_id!==target.id
      ||observation.target_generation!==target.generation||Date.parse(observation.expires_at)<=Date.now()
      ||["interpretation","postcondition"].includes(observation.kind))throw new Error("COMPUTER_ACTION_PRECONDITION_REJECTED");
    if(!value.capability.effective.includes(action.operation))throw new Error("COMPUTER_OPERATION_UNAVAILABLE");
    if(value.usage.actions>=value.limits.max_actions||value.actions.length>=100)throw new Error("COMPUTER_ACTION_BUDGET");
    const now=new Date().toISOString(),receipt=ComputerReceiptSchema.parse({schema:"dreamgraph.computer_receipt.v1",id:`computer-receipt:${action.id}`,
      action_id:action.id,state:"dispatched",observed_at:now,observation_ids:[],change_obligation_ids:[],graph_receipt_id:null,reason:"COMPUTER_INTENT_RECORDED"});
    value.actions.push({id:action.id,action_hash:digest,operation:action.operation,postcondition_hash:computerDigest(action.postcondition),accepted_at:now,receipt});
    value.usage.actions++;value.session.state="running";value.session.updated_at=now;return {receipt:structuredClone(receipt),replayed:false};
  });
}
/** Late verified state may resolve an unknown outcome; it never admits another physical action. */
export async function settleComputerAction(executionId:string,sessionId:string,input:z.input<typeof ComputerReceiptSchema>){
  const receipt=ComputerReceiptSchema.parse(input);
  if(receipt.reason!==null&&!/^COMPUTER_[A-Z0-9_]{1,120}$/.test(receipt.reason))throw new Error("COMPUTER_RECEIPT_REASON_INVALID");
  return mutateManagedComputer(executionId,"receipt",sessions=>{const value=owned(sessions,sessionId),action=value.actions.find(item=>item.id===receipt.action_id);
    if(!action||receipt.id!==action.receipt.id||receipt.state==="dispatched")throw new Error("COMPUTER_RECEIPT_IDENTITY_REJECTED");
    if(["verified","failed","cancelled"].includes(action.receipt.state)){
      if(computerDigest(action.receipt)!==computerDigest(receipt))throw new Error("COMPUTER_TERMINAL_RECEIPT_IMMUTABLE");return structuredClone(action.receipt);
    }
    if(receipt.state==="verified"&&(!receipt.observation_ids.length||receipt.observation_ids.some(id=>{
      const observed=value.observations.find(item=>item.id===id);return !observed||!observed.verified||observed.kind!=="postcondition"
        ||Date.parse(observed.observed_at)<Date.parse(action.accepted_at)
        ||!observed.evidence_ids.includes(computerDigest({action_id:action.id,postcondition_hash:action.postcondition_hash}));
    })))throw new Error("COMPUTER_POSTCONDITION_PROOF_REQUIRED");
    if(receipt.graph_receipt_id!==null||receipt.change_obligation_ids.length)throw new Error("COMPUTER_MATERIAL_EFFECT_REQUIRES_OWNER_RECEIPT");
    action.receipt=receipt;value.session.updated_at=new Date().toISOString();return structuredClone(receipt);
  });
}
/** Stop intent is durable; its acknowledgement must come from the independent local worker channel. */
export async function stopComputerJournal(executionId:string,sessionId:string,state:"requested"|"acknowledged"|"unknown",reason:string){
  if(!/^COMPUTER_[A-Z0-9_]{1,120}$/.test(reason))throw new Error("COMPUTER_STOP_REASON_INVALID");
  return mutateManagedComputer(executionId,"stop",sessions=>{const value=owned(sessions,sessionId);
    if(value.stop_state==="acknowledged"&&state!=="acknowledged")throw new Error("COMPUTER_STOP_ACK_IMMUTABLE");
    if(value.stop_state==="not_requested"){value.session.fence++;value.stop_state="requested";value.session.state="stopping";}
    if(state!=="requested"){value.stop_state=state;value.session.state=state==="acknowledged"?"stopped":"recovery_required";}
    value.session.terminal_reason=reason;value.session.updated_at=new Date().toISOString();return structuredClone(value);
  });
}
export async function pauseComputerJournal(executionId:string,sessionId:string,state:"requested"|"acknowledged"|"unknown"){
 return mutateManagedComputer(executionId,"pause",sessions=>{const value=owned(sessions,sessionId);
  if(value.stop_state!=="not_requested"||!['ready','running','paused'].includes(value.session.state))throw new Error("COMPUTER_PAUSE_STATE_REJECTED");
  if(state==="requested"&&value.pause_state==="not_requested"){value.session.fence++;value.pause_state="requested";}
  else if(state==="acknowledged"){
   if(value.pause_state!=="requested"||value.actions.some(action=>['dispatched','unknown'].includes(action.receipt.state)))throw new Error("COMPUTER_PAUSE_BOUNDARY_UNRESOLVED");
   value.pause_state="acknowledged";value.session.state="paused";
  }else if(state==="unknown"){value.pause_state="unknown";value.session.state="recovery_required";value.session.terminal_reason="COMPUTER_PAUSE_UNKNOWN";}
  value.session.updated_at=new Date().toISOString();return structuredClone(value);
 });
}
export async function resumeComputerJournal(executionId:string,sessionId:string,epoch:string){
 return mutateManagedComputer(executionId,"resume",sessions=>{const value=owned(sessions,sessionId);
  if(value.worker_epoch!==epoch||value.session.state!=="paused"||value.pause_state!=="acknowledged"||value.stop_state!=="not_requested")throw new Error("COMPUTER_RESUME_STATE_REJECTED");
  if(Date.parse(value.limits.expires_at)<=Date.now())throw new Error("COMPUTER_SESSION_EXPIRED");
  value.pause_state="not_requested";value.session.state="ready";value.session.fence++;value.session.updated_at=new Date().toISOString();return structuredClone(value);
 });
}
