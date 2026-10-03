/** Pure state updates over the existing tension owner; suggestions never supply factual proof. */
import { createHash } from "node:crypto";
import { z } from "zod";
import { loadCanonicalGraph } from "../graph/read-model.js";
import { getActiveScope } from "../instance/index.js";
import { graphIdentityKey } from "../graph/contracts.js";
import { NormalizationClaimSchema, normalizationClaimKey, type NormalizationClaim } from "./normalization-evidence.js";
import type { TensionFile,TensionSignal,TensionConfig,RiskLifecycleEvent,ResolvedTension } from "./types.js";

const stable=(value:unknown):string=>value===null||typeof value!=="object"?(JSON.stringify(value)??"null"):Array.isArray(value)?`[${value.map(stable).join(",")}]`:
  `{${Object.keys(value).filter(k=>(value as Record<string,unknown>)[k]!==undefined).sort().map(k=>JSON.stringify(k)+":"+stable((value as Record<string,unknown>)[k])).join(",")}}`;
export const riskDigest=(value:unknown)=>createHash("sha256").update(stable(value)).digest("hex");
export type RiskObservation=Pick<TensionSignal,"type"|"entities"|"description"|"urgency">&{domain?:TensionSignal["domain"];risk_key?:string;observation_fingerprint?:string};
export const riskKey=(signal:RiskObservation)=>signal.risk_key??riskDigest([signal.type,signal.domain??"general",[...new Set(signal.entities)].sort(),signal.description.trim()]);
export function riskEvent(signal:TensionSignal,kind:RiskLifecycleEvent["kind"],reason:string,details?:Record<string,unknown>,at=new Date().toISOString()):void {
  signal.revision=(signal.revision??0)+1;
  (signal.lifecycle_history??=[]).push({id:riskDigest([signal.id,signal.revision,kind,reason,details]),revision:signal.revision,at,kind,reason,details});
  if(signal.lifecycle_history.length>10000)throw new Error("RISK_HISTORY_CAPACITY_REQUIRES_ARCHIVE");
}
export function observeRisk(data:TensionFile,input:RiskObservation,policy:TensionConfig,now=new Date().toISOString()):{signal:TensionSignal;changed:boolean;created:boolean} {
  if(!input.entities.length||input.entities.length>256||!input.description.trim()||!Number.isFinite(input.urgency)||input.urgency<0||input.urgency>1)throw new Error("RISK_OBSERVATION_INVALID");
  const key=riskKey(input),fingerprint=input.observation_fingerprint??riskDigest([input.type,input.domain??"general",[...new Set(input.entities)].sort(),input.description.trim(),input.urgency]);
  const existing=data.signals.find(s=>(s.risk_key??riskKey(s))===key);
  if(existing){
    if(existing.observation_fingerprint===fingerprint)return {signal:existing,changed:false,created:false};
    existing.risk_key=key;existing.observation_fingerprint=fingerprint;existing.occurrences++;existing.last_seen=now;existing.urgency=input.urgency;
    existing.ttl=policy.default_tension_ttl;existing.lifecycle="review_required";riskEvent(existing,"observed","Material observation changed; review required",{fingerprint},now);
    return {signal:existing,changed:true,created:false};
  }
  const archived=[...(data.resolved_tensions??[])].reverse().find(r=>(r.original.risk_key??riskKey(r.original))===key);
  if(archived&&!archived.reopened_at&&archived.original.observation_fingerprint===fingerprint&&archived.resolution_type!=="expired_unverified")
    return {signal:{...archived.original,resolved:true},changed:false,created:false};
  if(data.signals.filter(s=>!s.resolved).length>=policy.max_active_tensions)throw new Error("RISK_ACTIVE_CAPACITY_REQUIRES_REVIEW");
  const signal:TensionSignal=archived?{...structuredClone(archived.original),resolved:false,attempted:false,last_seen:now,ttl:policy.default_tension_ttl,
    urgency:input.urgency,observation_fingerprint:fingerprint,risk_key:key,lifecycle:"review_required"}:
    {id:`tension_${riskDigest(key)}`,risk_key:key,revision:0,type:input.type,domain:input.domain??"general",entities:[...new Set(input.entities)].sort(),description:input.description,
     occurrences:1,urgency:input.urgency,first_seen:now,last_seen:now,attempted:false,resolved:false,ttl:policy.default_tension_ttl,observation_fingerprint:fingerprint,lifecycle:"open"};
  if(archived){archived.reopened_at=now;archived.reappearance_reason="Re-observed risk with changed evidence or unverified expiry";delete signal.resolution_candidate;}
  riskEvent(signal,archived?"reopened":"observed",archived?archived.reappearance_reason!:"First risk observation",{fingerprint},now);data.signals.push(signal);
  return {signal,changed:true,created:!archived};
}
export function riskRevision(signal:TensionSignal,expected?:number):void {
  if(expected!==undefined&&expected!==(signal.revision??0))throw new Error("RISK_REVISION_CONFLICT");
}
/** Only the exact declared bridge predicate can close a connection risk automatically. */
export async function verifyRiskClaim(signal:TensionSignal,raw:unknown):Promise<NonNullable<ResolvedTension["verification"]>> {
  const claim=NormalizationClaimSchema.parse(raw);
  if(claim.type!=="edge"||!["missing_link","weak_connection"].includes(signal.type)||signal.entities.length!==2
    ||new Set([claim.from.id,claim.to.id]).size!==2||![claim.from.id,claim.to.id].every(id=>signal.entities.includes(id)))throw new Error("RISK_VERIFICATION_SCOPE_MISMATCH");
  const graph=await loadCanonicalGraph(getActiveScope()?.uuid??"legacy");
  const wanted=normalizationClaimKey(claim);
  const match=graph.relationships.find(edge=>edge.assertion_class==="validated_insight"&&edge.source&&edge.target&&
    graphIdentityKey(edge.source)===graphIdentityKey(claim.from)&&graphIdentityKey(edge.target)===graphIdentityKey(claim.to)&&edge.relation===claim.relation);
  const proof=match?.payload.current_evidence_assessment as {claim?:NormalizationClaim;state?:string;independent_roots?:string[]}|undefined;
  if(!proof?.claim||normalizationClaimKey(proof.claim)!==wanted||proof.state!=="supported"||!proof.independent_roots||proof.independent_roots.length<2)
    throw new Error("RISK_CURRENT_INDEPENDENT_VERIFICATION_REQUIRED");
  return {claim,evidence_digest:riskDigest(proof),independent_roots:[...proof.independent_roots],checked_at:new Date().toISOString()};
}
export const RiskCommandSchema=z.object({expected_revision:z.number().int().nonnegative().optional(),verification_claim:NormalizationClaimSchema.optional()}).strict();
