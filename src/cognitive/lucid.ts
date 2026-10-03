/** Human exploration uses the existing job lease; durable intent is never independent source proof. */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { engine } from "./engine.js";
import { EngineJobs } from "./jobs.js";
import { withinJob, withoutJobContext, type JobExecutionContext } from "./job-context.js";
import { readCognitiveStore } from "./cognitive-store.js";
import { captureCognitiveProjection, projectionCurrentness } from "./projection-context.js";
import { riskDigest } from "./risk-lifecycle.js";
import { sessionNamespace, getSessionContext } from "../server/session-context.js";
import { withGraphRead, withGraphReconciliation } from "../utils/graph-reconciliation-barrier.js";
import { commitGraphWrites } from "../graph/publication.js";
import { prepareEvidenceGeneration } from "../graph/change-obligations.js";
import { graphIdentityKey } from "../graph/contracts.js";
import { curationSuppressions, emptyCuration } from "./curation.js";
import { loadGraphMaintenanceState } from "./graph-maintenance-state.js";
import { dreamClaimKey } from "./strategy-portfolio.js";
import { normalizationClaimKey } from "./normalization-evidence.js";
import type { DreamEdge, LucidAction, LucidFindings, LucidLogFile, LucidResult, LucidSignal, ValidatedEdge } from "./types.js";
const FILE="lucid_log.json",processId=randomUUID(),LIFETIME=600000;
type Active=NonNullable<LucidLogFile["active"]>;
interface Live {context:JobExecutionContext;release:()=>void;done:Promise<unknown>}
const live=new Map<string,Live>(),factual=new Set(["feature","workflow","data_model","capability","datastore","auxiliary","ui_element"]);
const empty=():LucidLogFile=>({metadata:{description:"Human exploration and retained intent; acceptance is not source verification",schema_version:"1.0.0",total_sessions:0,last_session:null},sessions:[],active:null});
async function load():Promise<LucidLogFile>{
 const log=await readCognitiveStore(FILE,empty(),["sessions"]);
 if(log.sessions.length>10000||Buffer.byteLength(JSON.stringify(log))>16777216)throw new Error("LUCID_HISTORY_CAPACITY");
 const a=log.active;if(a&&(!a.id||!a.owner||!a.job_id||!Number.isSafeInteger(a.revision)||!Number.isFinite(Date.parse(a.expires_at))||!Array.isArray(a.actions)||!Array.isArray(a.accepted)||!a.findings||!a.operations))throw new Error("LUCID_LEASE_INVALID");return log;
}
async function publish(log:LucidLogFile,writes:Array<{file:string;content:string}>=[]){
 log.metadata.total_sessions=log.sessions.length;log.metadata.last_session=log.sessions.at(-1)?.timestamp??null;
 const body=JSON.stringify(log,null,2);if(log.sessions.length>10000||Buffer.byteLength(body)>16777216)throw new Error("LUCID_HISTORY_CAPACITY");
 return commitGraphWrites({actor:"lucid",scope:[FILE],writes:[{file:FILE,content:body},...writes]});
}
async function close(id:string,termination:NonNullable<LucidResult["termination"]>):Promise<LucidResult|null>{
 return withoutJobContext(()=>withGraphReconciliation(async()=>{const log=await load(),a=log.active;
  if(a?.id!==id)return log.sessions.find(s=>s.session_id===id)??null;
  const result:LucidResult={session_id:a.id,owner:a.owner,job_id:a.job_id,result_revision:a.revision,termination,hypothesis:a.findings.hypothesis,findings:a.findings,actions_taken:a.actions,edges_accepted:a.accepted,contradictions_dismissed:a.dismissed,session_duration_ms:Math.max(0,Date.now()-Date.parse(a.started_at)),timestamp:new Date().toISOString()};
  log.sessions.push(result);log.active=null;await publish(log);return result;
 }));
}
export async function recoverLucidSession():Promise<boolean>{
 const log=await load(),a=log.active;if(!a)return false;
 const jobs=new EngineJobs(),record=(await jobs.inspect()).records.find(r=>r.job.id===a.job_id);
 if(a.process_id===processId&&live.has(a.job_id)&&record?.job.state==="running"&&Date.parse(a.expires_at)>Date.now())return false;
 await close(a.id,a.process_id!==processId?"restart_recovery":"expired");
 if(record&&["queued","running","blocked"].includes(record.job.state))await jobs.cancel(a.job_id,"lucid_recovery");
 live.get(a.job_id)?.release();if(engine.getState()==="lucid")withoutJobContext(()=>engine.wakeFromLucid());return true;
}
async function owned():Promise<{active:Active;handle:Live}>{
 const log=await load();if(!log.active)throw new Error("LUCID_SESSION_UNAVAILABLE");
 if(log.active.owner!==sessionNamespace())throw new Error("LUCID_SESSION_OWNER_REJECTED");
 if(await recoverLucidSession())throw new Error("LUCID_SESSION_RECOVERED");
 const handle=live.get(log.active.job_id)!;await handle.context.assert_current();handle.context.signal.throwIfAborted();return {active:log.active,handle};
}
async function explore(text:string,id:string,depth:number,extra:string[]=[]):Promise<LucidFindings>{return withGraphRead(async()=>{
 z.string().min(1).max(16000).parse(text);const {context,graph}=await captureCognitiveProjection(),dream=await engine.loadDreamGraph(),tensions=await engine.loadTensions();
 const mentioned=(value:string)=>new RegExp(`(?<![\\p{L}\\p{N}_])${value.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}(?![\\p{L}\\p{N}_])`,"iu").test(text);
 const facts=graph.entities.filter(e=>factual.has(e.identity.kind)),matches=facts.filter(e=>mentioned(e.identity.id)||mentioned(e.label));
 for(const e of matches)if(facts.filter(other=>other.identity.id===e.identity.id).length!==1)throw new Error("LUCID_ENTITY_ID_AMBIGUOUS");
 const entities=[...new Set([...matches.map(e=>e.identity.id),...extra])];if(entities.length>100)throw new Error("LUCID_ENTITY_SCOPE_BOUND");
 const relation=/depend|requires|needs|uses/i.test(text)?"depends_on":/conflict|contradict/i.test(text)?"conflicts_with":/cause|trigger/i.test(text)?"causes":"related_to";
 const supporting:LucidSignal[]=[],contradictions:LucidSignal[]=[],keys=new Set(entities);
 for(const edge of graph.relationships.filter(e=>e.kind==="validated"&&e.source&&e.target&&(keys.has(e.source.id)||keys.has(e.target.id)))){
  const signal:LucidSignal={id:`ls_${riskDigest(edge.id)}`,type:"supporting",source:"fact_graph",assertion_class:edge.assertion_class,evidence_refs:edge.evidence,description:`${edge.source!.id} → ${edge.target!.id} (${edge.relation}); ${edge.assertion_class}`,confidence:edge.confidence??0,entities:[edge.source!.id,edge.target!.id],evidence:"Canonical current applicability and original ancestry; no new source witness"};
  if(["validated_insight","human_assertion"].includes(edge.assertion_class))supporting.push(signal);else contradictions.push({...signal,type:"contradicting"});
 }
 const suggested:DreamEdge[]=[],visited=new Set(entities);let frontier=new Set(entities);
 for(let hop=0;hop<depth;hop++){const next=new Set<string>();for(const edge of dream.edges){if(edge.interrupted||["rejected","expired"].includes(edge.status)||edge.confidence<0.3)continue;
  if(frontier.has(edge.from)||frontier.has(edge.to)){if(!suggested.some(e=>e.id===edge.id))suggested.push(edge);for(const eid of [edge.from,edge.to])if(!visited.has(eid))next.add(eid);}}
  for(const eid of next)visited.add(eid);frontier=next;if(!next.size)break;
 }
 for(const edge of suggested.filter(e=>keys.has(e.from)||keys.has(e.to))){const signal:LucidSignal={id:`ls_${riskDigest(["dream",edge.id])}`,type:edge.contradiction_score>0.3?"contradicting":"supporting",source:"dream_graph",assertion_class:"hypothesis",description:edge.reason,confidence:edge.confidence,entities:[edge.from,edge.to],evidence:"Speculative context; confidence and repetition are not independent corroboration"};(signal.type==="supporting"?supporting:contradictions).push(signal);}
 const related=tensions.signals.filter(t=>!t.resolved&&t.entities.some(e=>keys.has(e)));
 return {session_id:id,projection:context,hypothesis:{id:`lh_${id}`,raw_text:text,parsed_entities:entities,parsed_relationship:relation,created_at:new Date().toISOString()},supporting_signals:supporting.slice(0,100),contradictions:contradictions.slice(0,100),related_tensions:related.slice(0,100),suggested_connections:suggested.slice(0,100),truncated:Math.max(supporting.length,contradictions.length,related.length,suggested.length)>100,exploration_depth:depth,confidence_assessment:`Exploration: ${supporting.length} contextual signals, ${contradictions.length} contested/unproven signals. Human assertions and speculation do not verify this hypothesis. Snapshot completeness: ${context.state.completeness}.`};
});}
export async function startLucidDream(hypothesisText:string):Promise<LucidFindings>{
 await recoverLucidSession();const id=randomUUID(),owner=sessionNamespace(),findings=await explore(hypothesisText,id,2),jobs=new EngineJobs(),session=getSessionContext();
 const accepted=await jobs.accept({operation_id:`lucid:${id}`,action:"lucid_session",owner,session_id:session?.session_id??"internal",lifetime:"session_bound",scope:[FILE],lanes:["engine"],role_policies:{},budget:{requests:0,input_tokens:0,output_tokens:0,reasoning_tokens:0,retries:0,elapsed_ms:LIFETIME,concurrency:1,max_hops:3,max_neighbors:100,run_amount:0,day_amount:0,currency:"USD",pricing_version:null,billing_principal:owner}});
 let ready!:(c:JobExecutionContext)=>void,failed!:(error:unknown)=>void,release!:()=>void;
 const readyPromise=new Promise<JobExecutionContext>((resolve,reject)=>{ready=resolve;failed=reject;}),stop=new Promise<void>(resolve=>{release=resolve;});
 const done=jobs.run(accepted.job.id,async context=>{let entered=false;
  try{engine.enterLucid();entered=true;ready(context);const abort=()=>release();context.signal.addEventListener("abort",abort,{once:true});try{await stop;}finally{context.signal.removeEventListener("abort",abort);}if(context.signal.aborted)await close(id,"cancelled");return {session_id:id,settled:true};}
  finally{withoutJobContext(()=>{if(entered&&engine.getState()==="lucid")engine.wakeFromLucid();live.delete(accepted.job.id);});}
 });
 done.catch(failed);let context:JobExecutionContext;
 try{context=await readyPromise;}catch(error){await jobs.cancel(accepted.job.id,"lucid_start_failed");await done.catch(()=>undefined);throw error;}
 live.set(accepted.job.id,{context,release,done});
 try{return await withinJob(context,()=>withGraphReconciliation(async()=>{const log=await load();if(log.active)throw new Error("LUCID_SESSION_BUSY");if(await projectionCurrentness(findings.projection)!=="current")throw new Error("LUCID_FINDINGS_SUPERSEDED");findings.revision=0;log.active={id,owner,job_id:accepted.job.id,process_id:processId,revision:0,expires_at:new Date(Date.now()+LIFETIME).toISOString(),findings,actions:[],accepted:[],dismissed:[],started_at:new Date().toISOString(),operations:{}};await publish(log);return structuredClone(findings);}));}
 catch(error){release();await done.catch(()=>undefined);throw error;}
}
export async function handleLucidAction(action:LucidAction):Promise<LucidFindings>{
 z.enum(["accept","dismiss","refine","dig_deeper"]).parse(action.type);z.string().min(1).max(2048).parse(action.target_id);
 const {active,handle}=await owned(),hash=riskDigest({type:action.type,target_id:action.target_id,reason:action.reason,refinement:action.refinement}),operation=action.operation_id??hash;
 if(active.operations[operation]){if(active.operations[operation].hash!==hash)throw new Error("LUCID_OPERATION_CONFLICT");return structuredClone(active.operations[operation].findings);}
 if(action.expected_revision!==undefined&&action.expected_revision!==active.revision)throw new Error("LUCID_REVISION_CONFLICT");
 if(["accept","dismiss"].includes(action.type)&&!action.reason?.trim())throw new Error("LUCID_HUMAN_REASON_REQUIRED");
 let replacement:LucidFindings|undefined;
 if(action.type==="refine")replacement=await explore(action.refinement??"",active.id,2);
 if(action.type==="dig_deeper"){const target=[...active.findings.supporting_signals,...active.findings.contradictions].find(s=>s.id===action.target_id),edge=active.findings.suggested_connections.find(e=>e.id===action.target_id);if(!target&&!edge)throw new Error("LUCID_TARGET_UNAVAILABLE");replacement=await explore(active.findings.hypothesis.raw_text,active.id,3,target?.entities??[edge!.from,edge!.to]);}
 return withinJob(handle.context,()=>withGraphReconciliation(async()=>{const log=await load(),a=log.active;
  if(!a||a.id!==active.id||a.owner!==sessionNamespace())throw new Error("LUCID_SESSION_OWNER_REJECTED");if(a.revision!==active.revision)throw new Error("LUCID_REVISION_CONFLICT");
  if(await projectionCurrentness(replacement?.projection??a.findings.projection)!=="current")throw new Error("LUCID_FINDINGS_SUPERSEDED");
  const writes:Array<{file:string;content:string}>=[];if(replacement)a.findings=replacement;
  if(action.type==="dismiss"){const signal=a.findings.contradictions.find(s=>s.id===action.target_id);if(!signal)throw new Error("LUCID_TARGET_UNAVAILABLE");a.dismissed.push({signal:structuredClone(signal),human_reason:action.reason!});a.findings.contradictions=a.findings.contradictions.filter(s=>s.id!==action.target_id);}
  if(action.type==="accept"){
   const dream=a.findings.suggested_connections.find(e=>e.id===action.target_id),signal=a.findings.supporting_signals.find(s=>s.id===action.target_id);if(!dream&&!signal)throw new Error("LUCID_TARGET_UNAVAILABLE");
   const from=dream?.from??signal!.entities[0],to=dream?.to??signal!.entities[1],relation=dream?.relation??a.findings.hypothesis.parsed_relationship,snapshot=await captureCognitiveProjection();
   const endpoint=(id:string,side:"from"|"to")=>{const rows=snapshot.graph.entities.filter(e=>factual.has(e.identity.kind)&&e.identity.id===id&&(!dream?.[`${side}_kind`]||e.identity.kind===dream[`${side}_kind`])&&(!dream?.[`${side}_repository_id`]||e.identity.repository_id===dream[`${side}_repository_id`]));if(rows.length!==1)throw new Error("LUCID_ACCEPT_ENDPOINT_UNAVAILABLE");return rows[0].identity;};
   const source=endpoint(from,"from"),target=endpoint(to,"to"),claim={type:"edge" as const,from:source,to:target,relation},suppressed=curationSuppressions((await loadGraphMaintenanceState()).curation??emptyCuration());
   if(suppressed.has(normalizationClaimKey(claim))||dream&&suppressed.has(dreamClaimKey(dream)))throw new Error("LUCID_ACCEPT_REQUIRES_EXPLICIT_REOPEN");
   const edge:ValidatedEdge={id:`ve_lucid_${riskDigest([a.id,operation])}`,from,to,from_kind:source.kind,to_kind:target.kind,from_repository_id:source.repository_id,to_repository_id:target.repository_id,type:dream?.type==="workflow"?"workflow":dream?.type==="data_model"?"data_model":"feature",relation,description:action.reason!,confidence:dream?.confidence??signal!.confidence,plausibility:dream?.plausibility??0,evidence_score:0,origin:"rem",status:"validated",human_asserted:true,human_actor:getSessionContext()?.principal??"internal_human",human_reason:action.reason,evidence_summary:"Explicit human assertion; no independent source verification",evidence_count:0,reinforcement_count:0,dream_cycle:engine.getCurrentDreamCycle(),normalization_cycle:0,validated_at:new Date().toISOString()};
   const validated=await engine.loadValidatedEdges();validated.edges.push(edge);validated.metadata.total_validated=validated.edges.length;
   writes.push({file:"validated_edges.json",content:JSON.stringify(validated,null,2)},...await prepareEvidenceGeneration({id:`lucid:${a.id}`,scope:[graphIdentityKey(source),graphIdentityKey(target)],fingerprint:riskDigest(edge)}));a.accepted.push(edge);
  }
  a.actions.push(structuredClone(action));a.revision++;a.findings.revision=a.revision;if(Object.keys(a.operations).length>=1000||a.actions.length>1000)throw new Error("LUCID_ACTION_CAPACITY");
  a.operations[operation]={hash,findings:structuredClone(a.findings)};await publish(log,writes);return structuredClone(a.operations[operation].findings);
 }));
}
export async function wakeFromLucid():Promise<LucidResult>{const {active,handle}=await owned(),result=await close(active.id,"completed");handle.release();await handle.done;if(!result)throw new Error("LUCID_RESULT_UNAVAILABLE");return result;}
export async function cancelLucidSession(reason="session_disconnected"):Promise<void>{const log=await load();if(!log.active||log.active.owner!==sessionNamespace())return;const a=log.active;await new EngineJobs().cancel(a.job_id,reason);await close(a.id,"cancelled");live.get(a.job_id)?.release();}
export async function getLucidLog():Promise<LucidLogFile>{return withGraphRead(async()=>{const log=await load();if(log.active?.owner!==sessionNamespace())log.active=null;return log;});}
/** Memory hint only. Every action checks the durable owner and job fence. */
export function hasActiveSession():boolean{return [...live.values()].some(h=>!h.context.signal.aborted);}
