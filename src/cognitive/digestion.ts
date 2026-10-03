/** C15 staged affected-region execution. Unknown scope is pending, never the whole graph. */
import { createHash } from "node:crypto";
import { z } from "zod";
import { readDirtyPartitions, readChangeObligations, DirtyFileSchema } from "../graph/change-obligations.js";
import { loadCanonicalGraph } from "../graph/read-model.js";
import { graphIdentityKey, type GraphIdentity } from "../graph/contracts.js";
import { commitGraphWrites, recoverGraphPublication } from "../graph/publication.js";
import { withGraphRead, withGraphReconciliation } from "../utils/graph-reconciliation-barrier.js";
import { getDataDir, withDataDirectory } from "../utils/paths.js";
import { EngineJobs, type EngineJobRecord } from "./jobs.js";
import { withinJob, withoutJobContext, type JobExecutionContext } from "./job-context.js";
import { loadGraphMaintenanceState } from "./graph-maintenance-state.js";
import { engine } from "./engine.js";
import { dream } from "./dreamer.js";
import { normalize } from "./normalizer.js";
import { enrichParserNodesProgrammatic } from "../tools/enrich-parser-nodes.js";

const id=z.string().min(1),count=z.number().int().nonnegative(),utc=z.string().datetime({offset:true});
export const DigestionLedgerSchema=z.object({schema:z.literal("dreamgraph.digestion.v1"),records:z.array(z.object({
 id,partition_id:id,generation:count,input_fingerprint:id,stage:z.enum(["enrichment","digestion"]),job_id:id,
 root_cause_ids:z.array(id).max(256),entity_scope:z.array(z.object({instance_id:id,repository_id:id,kind:z.string(),id}).strict()).max(100),
 state:z.enum(["queued","running","complete","partial","budget_blocked","failed","recovery_required"]),created_at:utc,updated_at:utc,
 receipt_ids:z.array(id).max(1000),reason:z.string().nullable(),
 }).strict()).max(10000)}).strict();
type StageRecord=z.infer<typeof DigestionLedgerSchema>["records"][number];
export interface DirtyStageOutcome {state:"complete"|"partial"|"budget_blocked";receipt_ids:string[];reason?:string;}
export interface DirtyStagePorts {enrichment:(record:Readonly<StageRecord>,signal:AbortSignal)=>Promise<DirtyStageOutcome>;
 digestion:(record:Readonly<StageRecord>,signal:AbortSignal)=>Promise<DirtyStageOutcome>;}
const digest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const ledger=(state:Awaited<ReturnType<typeof loadGraphMaintenanceState>>)=>DigestionLedgerSchema.parse(state.digestion??{schema:"dreamgraph.digestion.v1",records:[]});

async function publish(partitions:Awaited<ReturnType<typeof readDirtyPartitions>>,state:Awaited<ReturnType<typeof loadGraphMaintenanceState>>):Promise<void>{
 await commitGraphWrites({actor:"digestion",scope:["dirty_partitions.json","graph_maintenance.json"],cause:"dirty_stage_state",writes:[
  {file:"dirty_partitions.json",content:JSON.stringify(DirtyFileSchema.parse(partitions))},{file:"graph_maintenance.json",content:JSON.stringify(state)}]});
}
async function generationCurrent(record:StageRecord):Promise<void>{
 await withGraphRead(async()=>{const partition=(await readDirtyPartitions()).partitions.find(p=>p.id===record.partition_id);
  if(!partition||partition.generation!==record.generation||partition.input_fingerprint!==record.input_fingerprint||partition.running_generation!==record.generation
   ||partition.pending_stages.includes("reconciliation"))throw new Error("DIRTY_GENERATION_SUPERSEDED");});
}
async function affectedEntities(partition:Awaited<ReturnType<typeof readDirtyPartitions>>["partitions"][number],instance:string):Promise<Array<GraphIdentity&{repository_id:string}>>{
 const graph=await loadCanonicalGraph(instance),obligations=await readChangeObligations();
 // Coarse partitions retain the full unsettled generation window even when compacted
 // root IDs omit already reconciled writes. Never silently drop their affected region.
 const repository=partition.id.slice("overflow:".length);
 const scopes=partition.id.startsWith("overflow:")?obligations.entries.filter(e=>e.state!=="failed"&&Date.parse(e.created_at)>=Date.parse(partition.first_changed_at)
  &&e.scope.some(scope=>scope.startsWith(`source:${repository}/`))).flatMap(e=>e.scope.filter(scope=>scope.startsWith(`source:${repository}/`))):partition.scope;
 const wanted=new Set<string>();
 for(const scope of scopes){if(graph.by_identity.has(scope)){wanted.add(scope);continue;}if(!scope.startsWith("source:"))throw new Error("DIRTY_SCOPE_UNKNOWN");const [repo,...parts]=scope.slice(7).split("/").map(decodeURIComponent);
  const dependents=graph.source_dependents.get(`${repo}/${parts.join("/")}`);if(!dependents?.size)throw new Error("DIRTY_SCOPE_UNMAPPED");for(const key of dependents)wanted.add(key);}
 const entities=graph.entities.filter(e=>wanted.has(graphIdentityKey(e.identity))&&e.identity.repository_id&&["feature","workflow","data_model","capability","datastore","ui_element","auxiliary"].includes(e.identity.kind)).map(e=>e.identity as GraphIdentity&{repository_id:string});
 if(!entities.length||entities.length>100)throw new Error("DIRTY_SCOPE_BOUND_EXCEEDED");
 // Existing dream focus uses legacy IDs. Refuse ambiguous IDs rather than widening scope.
 for(const identity of entities)if(graph.entities.filter(e=>e.identity.id===identity.id&&["feature","workflow","data_model","capability","datastore","ui_element","auxiliary"].includes(e.identity.kind)).length!==1)throw new Error("DIRTY_SCOPE_ID_AMBIGUOUS");
 return entities;
}
async function claim(partition_id:string,now:number):Promise<StageRecord|null>{
 return withoutJobContext(()=>withGraphReconciliation(async()=>{
  await recoverGraphPublication();const partitions=await readDirtyPartitions(),partition=partitions.partitions.find(p=>p.id===partition_id)!;
  if(partition.pending_stages.includes("reconciliation")||!partition.pending_stages.length)return null;
  const stage=partition.pending_stages.includes("enrichment")?"enrichment":"digestion";
  const maintenance=await loadGraphMaintenanceState(),state=ledger(maintenance);maintenance.digestion=state;
  const prior=state.records.filter(r=>r.partition_id===partition.id&&r.generation===partition.generation&&r.stage===stage).at(-1);
  const roles=stage==="enrichment"?["enrichment"] as const:["dreamer","normalizer"] as const;
  const {getRoleModelPolicy}=await import("./llm.js");
  const policyFingerprint=digest([await Promise.all(roles.map(role=>getRoleModelPolicy(role).then(p=>p.fingerprint))),process.env.DREAMGRAPH_LLM_PRICING??"[]"]);
  if(prior){
   if(prior.job_id==="not_admitted")return null;
   const priorJob=(await new EngineJobs().inspect()).records.find(j=>j.job.id===prior.job_id)!;
   const priorFingerprint=digest([roles.map(role=>(priorJob.snapshot.role_policies[role] as {fingerprint:string}).fingerprint),priorJob.snapshot.pricing]);
   if(prior.state!=="budget_blocked"||priorFingerprint===policyFingerprint)return ["complete","failed","partial"].includes(prior.state)?null:prior;
   await new EngineJobs().cancel(prior.job_id,"unfunded_configuration_superseded");
  }
  const jobs=new EngineJobs();let scope:Array<GraphIdentity&{repository_id:string}>;
  try{scope=await affectedEntities(partition,jobs.instance_id);}catch(error){
   const reason=error instanceof Error?error.message:String(error),recordId=digest({partition:partition.id,generation:partition.generation,stage,scope_failure:true});
   if(!state.records.some(r=>r.id===recordId)){const at=new Date(now).toISOString();state.records.push({id:recordId,partition_id:partition.id,generation:partition.generation,
    input_fingerprint:partition.input_fingerprint,stage,job_id:"not_admitted",root_cause_ids:partition.root_cause_ids,entity_scope:[],state:"partial",created_at:at,updated_at:at,receipt_ids:[],reason});}
   partition.state="partial";await publish(partitions,maintenance);return null;
  }
  if(partition.running_generation!==null)return null;
  const recordId=digest({partition:partition.id,generation:partition.generation,stage,fingerprint:partition.input_fingerprint,policyFingerprint});
  const job=await jobs.accept({operation_id:`dirty:${recordId}`,action:`dirty_${stage}`,owner:"digestion",scope:partition.scope,
   roles:stage==="enrichment"?["enrichment"]:["dreamer","normalizer"],parameters:{partition_id:partition.id,generation:partition.generation,stage,input_fingerprint:partition.input_fingerprint,entity_scope:scope}});
  const at=new Date(now).toISOString(),record:StageRecord={id:recordId,partition_id:partition.id,generation:partition.generation,input_fingerprint:partition.input_fingerprint,
   stage,job_id:job.job.id,root_cause_ids:[...partition.root_cause_ids],entity_scope:scope,state:"queued",created_at:at,updated_at:at,receipt_ids:[],reason:null};
  state.records.push(record);partition.running_generation=partition.generation;partition.state="queued";await publish(partitions,maintenance);return record;
 }));
}
async function finish(record:StageRecord,outcome:DirtyStageOutcome|{state:"failed"|"recovery_required"|"queued";receipt_ids:string[];reason:string}):Promise<void>{
 await withoutJobContext(()=>withGraphReconciliation(async()=>{
  await recoverGraphPublication();const partitions=await readDirtyPartitions(),maintenance=await loadGraphMaintenanceState(),state=ledger(maintenance);
  const current=state.records.find(r=>r.id===record.id)!;Object.assign(current,{...outcome,reason:outcome.reason??null,updated_at:new Date().toISOString()});maintenance.digestion=state;
  const partition=partitions.partitions.find(p=>p.id===record.partition_id)!;
  // Finishing G may acknowledge G; it cannot settle, drop roots or clear stages of G+1.
  if(partition.running_generation===record.generation&&!["recovery_required","queued"].includes(outcome.state))partition.running_generation=null;
  if(partition.generation===record.generation&&partition.input_fingerprint===record.input_fingerprint){
   if(outcome.state==="complete"){partition.pending_stages=partition.pending_stages.filter(stage=>stage!==record.stage);partition.state=partition.pending_stages.length?"ready":"settled";}
   else partition.state=outcome.state==="recovery_required"?"running":outcome.state;
  }
  partition.stage_receipt_ids=[...new Set([...partition.stage_receipt_ids,...outcome.receipt_ids])];await publish(partitions,maintenance);
 }));
}
const funded=(job:EngineJobRecord,roles:string[])=>roles.every(role=>{const policy=job.snapshot.role_policies[role] as JobExecutionContext["role_policies"]["dreamer"];
 return policy?.status==="configured"&&policy.policy.provider!=="none"&&(policy.billing.channel!=="api"||policy.policy.budget.run_amount>0&&policy.policy.budget.day_amount>0);});
const productionPorts:DirtyStagePorts={
 enrichment:async(record,signal)=>{const result=await enrichParserNodesProgrammatic({target:"all",entityScope:record.entity_scope,maxNodes:100,batchSize:10,force:true,
  contextHops:0,relationContextSize:20,featureContextSize:10,scheduleStabilization:false,signal});
  if(!result.success)return {state:"partial",receipt_ids:[],reason:result.error.message};
  return {state:result.data.stopped_reason?"budget_blocked":result.data.semantic_coverage.fallback_nodes||result.data.errors.length?"partial":"complete",
   receipt_ids:result.data.publication.receipt_ids,reason:result.data.stopped_reason??(result.data.semantic_coverage.fallback_nodes?"semantic_fallbacks_remain":undefined)};},
 digestion:async(record,signal)=>{const ids=record.entity_scope.map(identity=>identity.id);if(engine.getState()!=="awake")throw new Error("ENGINE_CONFLICT");
  try{engine.enterRem();await dream("all",24,{entity_ids:ids,hops:0,reason:`Managed source generation ${record.generation}`});engine.enterNormalizing();
   const result=await normalize(undefined,undefined,{operation_id:`dirty-normalize:${record.id}`,signal,entity_ids:ids});
   await engine.processRecheckWindows(ids);engine.wake();return {state:"complete",receipt_ids:[result.operation_receipt!.operation_id]};
  }finally{if(engine.getState()!=="awake")await withoutJobContext(()=>engine.interrupt());}}
};
/** Bounded fairness: debounce fresh edits, process the oldest age first; no scan of unknown scope. */
export async function runDirtyDigestion(options:{now?:number;limit?:number;debounce_ms?:number;max_age_ms?:number;ports?:DirtyStagePorts}={}):Promise<StageRecord[]>{
 const now=options.now??Date.now(),limit=options.limit??4,debounce=options.debounce_ms??5000,maxAge=options.max_age_ms??60000;
 if(!Number.isSafeInteger(limit)||limit<1||limit>16||debounce<0||maxAge<debounce)throw new Error("DIRTY_RUN_POLICY_INVALID");
 const directory=getDataDir();return withDataDirectory(directory,async()=>{
  const partitions=(await readDirtyPartitions()).partitions.filter(p=>p.pending_stages.length&&!p.pending_stages.includes("reconciliation")&&
   (now-Date.parse(p.last_changed_at)>=debounce||now-Date.parse(p.first_changed_at)>=maxAge)).sort((a,b)=>Date.parse(a.first_changed_at)-Date.parse(b.first_changed_at)).slice(0,limit);
  const output:StageRecord[]=[];
  for(const partition of partitions){const record=await claim(partition.id,now);if(!record)continue;
   const jobs=new EngineJobs(),job=(await jobs.inspect()).records.find(j=>j.job.id===record.job_id)!;
   if(!options.ports&&!funded(job,record.stage==="enrichment"?["enrichment"]:["dreamer","normalizer"])){await jobs.cancel(record.job_id,"optional_cognition_unfunded_or_unconfigured");await finish(record,{state:"budget_blocked",receipt_ids:[],reason:"optional_cognition_unfunded_or_unconfigured"});continue;}
   try{const result=await jobs.run(record.job_id,async context=>withinJob({...context,assert_current:async()=>{await context.assert_current();await generationCurrent(record);}},()=>{
     context.signal.throwIfAborted();return (options.ports??productionPorts)[record.stage](record,context.signal);
    }));await finish(record,result);}
   catch(error){const current=(await jobs.inspect()).records.find(j=>j.job.id===record.job_id)!;
    await finish(record,{state:current.job.state==="recovery_required"?"recovery_required":current.job.state==="blocked"?"queued":"failed",receipt_ids:current.job.receipt_ids,reason:String(error)});}
   output.push(record);
  }return output;
 });
}
