/** Surface descriptions and previews consume core schemas and admission policy. No dispatch or writes. */
import {z} from "zod";
import {ScheduleActionParameterSchemas,scheduleRoles,schedulePolicyDigest,validateScheduleDraft,getScheduleSnapshot,previewSchedule} from "../cognitive/scheduler.js";
import {getRoleModelPolicy} from "../cognitive/llm.js";
import {EngineJobs} from "../cognitive/jobs.js";
import {readDirtyPartitions} from "../graph/change-obligations.js";
import {loadCanonicalGraph} from "../graph/read-model.js";
import {getActiveScope} from "../instance/index.js";
import {withGraphRead} from "../utils/graph-reconciliation-barrier.js";
import type {DreamSchedule,ScheduleAction} from "../cognitive/types.js";

export interface ScheduleField{type:string;required:boolean;default?:unknown;options?:string[];minimum?:number;maximum?:number;internal?:boolean;}
function field(schema:z.ZodTypeAny):ScheduleField{
 const required=!schema.isOptional(),value=schema.safeParse(undefined),type=schema._def.typeName;
 if(type==="ZodDefault"||type==="ZodOptional")return {...field(schema._def.innerType),required,...(value.success&&value.data!==undefined?{default:value.data}:{})};
 if(type==="ZodEnum")return {type:"enum",required,options:schema._def.values};
 if(type==="ZodLiteral")return {type:"enum",required,options:[schema._def.value]};
 if(type==="ZodNumber"){const checks=schema._def.checks as Array<{kind:string;value:number}>;return {type:"number",required,minimum:checks.find(c=>c.kind==="min")?.value,maximum:checks.find(c=>c.kind==="max")?.value};}
 if(type==="ZodArray")return {type:"string_array",required};
 if(type==="ZodString")return {type:"string",required};
 if(type==="ZodBoolean")return {type:"boolean",required};
 if(type==="ZodRecord")return {type:"json",required};
 throw new Error(`SCHEDULE_PARAMETER_DESCRIPTION_UNSUPPORTED:${type}`);
}
export function scheduleActionDescriptors(){
 return Object.entries(ScheduleActionParameterSchemas).map(([action,schema])=>({action,action_version:"dreamgraph.schedule.actions.v2",
  fields:Object.fromEntries(Object.entries(schema.shape).map(([name,schema])=>[name,{...field(schema),internal:name.startsWith("maintenance_")}]))}));
}
const editable=(schedule:DreamSchedule)=>Object.fromEntries(["name","action","parameters","trigger_type","interval_ms","cron","cycle_interval","idle_ms","max_runs","timezone","fold_policy","missed_policy","overlap_policy"].filter(key=>(schedule as unknown as Record<string,unknown>)[key]!==undefined).map(key=>[key,(schedule as unknown as Record<string,unknown>)[key]]));
export async function scheduleDraftPreview(input:Record<string,unknown>,original?:DreamSchedule,cycle?:number){
 const schedule=validateScheduleDraft({...original,...input}),policies=await Promise.all(scheduleRoles(schedule.action).map(async(role)=>{
  const policy=await getRoleModelPolicy(role);return {role,requested:policy.requested,effective:policy.effective,status:policy.status,
   diagnostics:policy.diagnostics,fingerprint:policy.fingerprint,budget:policy.policy.budget,retention:policy.policy.retention,billing:policy.billing};
 }));
 const snapshot=await getScheduleSnapshot(),modelCalls=["dream_cycle","nightmare_cycle","dispatch_cognitive_event"].includes(schedule.action);
 const now=Date.now(),occurrences=previewSchedule(schedule,now,5,{cycle,last_activity_at:snapshot.last_activity_at});
 const digest=schedulePolicyDigest(schedule,policies.map(p=>p.fingerprint));
 return {schema:"dreamgraph.schedule_draft_preview.v1",definition:editable(schedule),definition_revision:original?.definition_revision??null,
  preview_digest:digest,generated_at:new Date(now).toISOString(),occurrences,search_horizon_days:32,complete:occurrences.length===5,
  context_required:schedule.trigger_type==="after_cycles"&&cycle===undefined?["future_cycle_activity"]:schedule.trigger_type==="on_idle"?["future_user_activity"]:[],
  model_calls_possible:modelCalls,effective_policies:policies,estimated_actual_cost:null,cost_note:"Displayed allocations are hard caps; unknown actual price/cost is not zero. Policy is frozen on admission.",
  scheduler_enabled:snapshot.config.enabled,overlap_policy:"queue_one",missed_policy:schedule.missed_policy};
}

export async function scheduleWorkspaceSnapshot(){
 return withGraphRead(async()=>{
  const snapshot=await getScheduleSnapshot(),jobs=await new EngineJobs().inspect(),graph=await loadCanonicalGraph(getActiveScope()?.uuid??"legacy");
  const jobIds=new Set(snapshot.occurrences.map(row=>row.occurrence.job_id));
  const records=jobs.records.filter(record=>jobIds.has(record.job.id));
  const dirty=await readDirtyPartitions();
  return {...snapshot,action_descriptors:scheduleActionDescriptors(),occurrence_total:snapshot.occurrences.length,
   occurrences:snapshot.occurrences.slice(-200),job_records:records.slice(-200),job_total:records.length,
   graph:{revision:graph.revision,currency:graph.currency,state:graph.state},dirty_regions:dirty.partitions,
   dirty_generations:dirty.partitions.map(partition=>({id:partition.id,generation:partition.generation}))};
 });
}

export function draftFromFields(fields:Record<string,unknown>,action:ScheduleAction){
 return ScheduleActionParameterSchemas[action].parse(fields);
}
