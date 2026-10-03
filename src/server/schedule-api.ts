/** Shared JSON schedule/job ports. The outer HTTP authority authenticates the request. */
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { getSessionContext } from "./session-context.js";
import { getScheduleSnapshot, getSchedules, createSchedule, updateSchedule, deleteSchedule, runScheduleNow, previewSchedule, duplicateSchedule, enqueueScheduleNow } from "../cognitive/scheduler.js";
import {scheduleDraftPreview,scheduleWorkspaceSnapshot,scheduleActionDescriptors} from "./schedule-workspace-contract.js";
import { EngineJobs } from "../cognitive/jobs.js";
const command=z.object({operation_id:z.string().min(1).max(256),expected_revision:z.number().int().min(0),action:z.enum(["update","archive","run_now","enqueue","duplicate","cancel_job"]),
 target_id:z.string().min(1),updates:z.record(z.unknown()).optional(),preview_digest:z.string().optional()}).strict();
const reply=(res:ServerResponse,status:number,value:unknown)=>{res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});res.end(JSON.stringify(value));};
async function body(req:IncomingMessage):Promise<unknown>{const chunks:Buffer[]=[];let bytes=0;for await(const chunk of req){const buffer=Buffer.from(chunk);bytes+=buffer.length;if(bytes>65536)throw new Error("SCHEDULE_REQUEST_BYTE_LIMIT");chunks.push(buffer);}return JSON.parse(Buffer.concat(chunks).toString("utf8"));}
export async function handleScheduleApi(req:IncomingMessage,res:ServerResponse,pathname:string):Promise<boolean>{
 if(!pathname.startsWith("/api/schedules/v2")&&!pathname.startsWith("/api/jobs/v1"))return false;
 try{
  if(req.method==="GET"&&pathname==="/api/schedules/v2"){reply(res,200,new URL(req.url!,"http://localhost").searchParams.get("workspace")==="1"?await scheduleWorkspaceSnapshot():await getScheduleSnapshot());return true;}
  if(req.method==="GET"&&pathname==="/api/schedules/v2/actions"){reply(res,200,{actions:scheduleActionDescriptors()});return true;}
  if(req.method==="POST"&&pathname==="/api/schedules/v2/validate"){
   const input=z.object({draft:z.record(z.unknown()),target_id:z.string().optional(),expected_revision:z.number().int().nonnegative().optional(),cycle:z.number().int().nonnegative().optional()}).strict().parse(await body(req));
   const original=input.target_id?(await getSchedules()).find(s=>s.id===input.target_id):undefined;
   if(input.target_id&&!original)throw new Error("SCHEDULE_NOT_FOUND");
   if(original&&original.definition_revision!==input.expected_revision)throw new Error("SCHEDULE_REVISION_CONFLICT");
   const allowed=new Set(["name","action","parameters","trigger_type","interval_ms","cron","cycle_interval","idle_ms","max_runs","timezone","fold_policy","missed_policy","overlap_policy"]);
   if(Object.keys(input.draft).some(key=>!allowed.has(key)))throw new Error("SCHEDULE_IMMUTABLE_FIELD");
   reply(res,200,await scheduleDraftPreview(input.draft,original,input.cycle));return true;
  }
  if(req.method==="GET"&&pathname==="/api/schedules/v2/preview"){
   const url=new URL(req.url!,"http://localhost"),schedule=(await getSchedules()).find(s=>s.id===url.searchParams.get("id"));if(!schedule)throw new Error("SCHEDULE_NOT_FOUND");
   const cycle=url.searchParams.has("cycle")?Number(url.searchParams.get("cycle")):undefined,snapshot=await getScheduleSnapshot();
   const occurrences=previewSchedule(schedule,Date.now(),8,{cycle,last_activity_at:snapshot.last_activity_at});
   reply(res,200,{schema:"dreamgraph.schedule_preview.v2",definition_revision:schedule.definition_revision,
    occurrences,search_horizon_days:32,context_required:schedule.trigger_type==="after_cycles"&&cycle===undefined?["cycle"]:[],
    complete:occurrences.length===8||schedule.trigger_type==="on_idle"});return true;
  }
  if(req.method==="GET"&&pathname==="/api/jobs/v1"){
   const snapshot=await new EngineJobs().inspect(),owner=getSessionContext();
   let records=snapshot.records.filter(r=>r.job.lifetime!=="session_bound"||owner&&r.job.session_id===owner.session_id&&r.job.owner===owner.principal);
   const url=new URL(req.url!,"http://localhost"),offset=Number(url.searchParams.get("offset")??0),limit=Number(url.searchParams.get("limit")??50);
   if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error("JOB_PAGE_INVALID");
   const state=url.searchParams.get("state")??"all",order=url.searchParams.get("order")??"original";
   if(!["all","active"].includes(state)||!["original","recent"].includes(order))throw new Error("JOB_PAGE_INVALID");
   if(state==="active")records=records.filter(r=>!["cancelled","succeeded","failed","partial"].includes(r.job.state));
   if(order==="recent")records=records.slice().reverse();
   reply(res,200,{schema:"dreamgraph.job_page.v1",revision:snapshot.revision,total:records.length,offset,records:records.slice(offset,offset+limit),
    next_offset:offset+limit<records.length?offset+limit:null});return true;
  }
  if(req.method==="POST"&&pathname==="/api/schedules/v2/create"){
   const input=z.object({operation_id:z.string().min(1),name:z.string(),action:z.enum(["dream_cycle","nightmare_cycle","metacognitive_analysis","dispatch_cognitive_event","narrative_chapter","federation_export","graph_maintenance"]),
    parameters:z.record(z.unknown()).optional(),trigger_type:z.enum(["interval","cron_like","after_cycles","on_idle"]),interval_ms:z.number().optional(),cron:z.string().optional(),cycle_interval:z.number().optional(),idle_ms:z.number().optional(),
    timezone:z.string().optional(),fold_policy:z.enum(["once","both"]).optional(),missed_policy:z.enum(["skip","catch_up_once"]).optional(),max_runs:z.number().nullable().optional(),enabled:z.boolean().optional()}).strict().parse(await body(req));
   if(input.enabled===true)throw new Error("SCHEDULE_ENABLE_PREVIEW_REQUIRED");
   reply(res,200,{ok:true,schedule:await createSchedule({...input,enabled:false})});return true;
  }
  if(req.method==="POST"&&pathname==="/api/schedules/v2/commands"){
   const input=command.parse(await body(req));let result:unknown;
   if(input.action==="update"){
    if(input.updates?.enabled===true&&!input.preview_digest)throw new Error("SCHEDULE_ENABLE_PREVIEW_REQUIRED");
    result=await updateSchedule(input.target_id,input.updates??{},{...input,reviewed_policy_digest:input.preview_digest});if(!result)throw new Error("SCHEDULE_NOT_FOUND");
   }
   else if(input.action==="archive")result=await deleteSchedule(input.target_id,input);
   else if(input.action==="run_now")result=await runScheduleNow(input.target_id,input);
   else if(input.action==="enqueue"){if(!input.preview_digest)throw new Error("SCHEDULE_RUN_PREVIEW_REQUIRED");result=await enqueueScheduleNow(input.target_id,{...input,reviewed_policy_digest:input.preview_digest});}
   else if(input.action==="duplicate")result=await duplicateSchedule(input.target_id,input);
   else{
    const jobs=new EngineJobs(),record=(await jobs.inspect()).records.find(r=>r.job.id===input.target_id),owner=getSessionContext();
    if(!record||record.job.lifetime==="session_bound"&&(!owner||record.job.session_id!==owner.session_id||record.job.owner!==owner.principal))throw new Error("JOB_OWNER_MISMATCH");
    result=await jobs.cancel(input.target_id,"operator_cancelled",{expected_fence:input.expected_revision,operation_id:input.operation_id,
      session_id:owner?.session_id,owner:owner?.principal});
   }
   reply(res,input.action==="enqueue"?202:200,{ok:true,result});return true;
  }
  reply(res,404,{ok:false,error:"SCHEDULE_ROUTE_NOT_FOUND"});
 }catch(error){reply(res,409,{ok:false,error:error instanceof Error?error.message:String(error),fields:error instanceof z.ZodError?error.issues.map(issue=>({field:issue.path.join("."),message:issue.message})):(error as {fields?:unknown})?.fields??[]});}
 return true;
}
