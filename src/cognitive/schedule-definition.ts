/** One evaluator for preview and dispatch; named zones never depend on host local time. */
import { z } from "zod";
import type { DreamSchedule } from "./types.js";
export const SCHEDULE_ACTION_VERSION = "dreamgraph.schedule.actions.v2";
/** Bootstrap and the scheduler share one canonical empty encoding; this does not migrate legacy data. */
export function emptyScheduleDocument() {
  return { metadata: { description: "Durable schedule definitions, occurrences and original history", schema_version: "2.0.0",
    total_schedules: 0, total_executions: 0, last_tick: null, revision: 0 }, schedules: [], executions: [],
    occurrences: [], definition_history: [], operation_receipts: {} };
}
export const SchedulePolicySchema = z.object({ timezone: z.string().min(1).default("UTC"), fold_policy: z.enum(["once", "both"]).default("once"),
  missed_policy: z.enum(["skip", "catch_up_once"]).default("skip"), overlap_policy: z.literal("queue_one").default("queue_one") }).strict();
export type SchedulePolicy = z.infer<typeof SchedulePolicySchema>;
export interface OccurrenceProposal { planned_at: string | null; trigger_cursor: string; missed: boolean; }
function fieldError(code:string,field:string):never{throw Object.assign(new Error(code),{fields:[{field,message:code}]});}
function cronField(field: string, min: number, max: number): Set<number> {
  const values = new Set<number>();
  for (const item of field.split(",")) {
    if (!/^(\*|\d+(-\d+)?)(\/\d+)?$/.test(item)) throw new Error("SCHEDULE_INVALID_CRON");
    const [range, stride] = item.split("/"), step = stride === undefined ? 1 : Number(stride);
    if (!Number.isSafeInteger(step) || step < 1 || step > max - min + 1) throw new Error("SCHEDULE_INVALID_CRON");
    const [start, end] = range === "*" ? [min, max] : range.includes("-") ? range.split("-").map(Number) : [Number(range), stride ? max : Number(range)];
    if (start < min || end > max || start > end) throw new Error("SCHEDULE_INVALID_CRON");
    for (let value = start; value <= end; value += step) values.add(value);
  }
  return values;
}
export function compileCron(cron: string): Set<number>[] {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error("SCHEDULE_INVALID_CRON");
  return fields.map((field, index) => cronField(field, [0,0,1,1,0][index], [59,23,31,12,6][index]));
}
export function validateScheduleTiming(schedule: DreamSchedule): SchedulePolicy {
  const policy = SchedulePolicySchema.parse({ timezone: schedule.timezone ?? "UTC", fold_policy: schedule.fold_policy ?? "once",
    missed_policy: schedule.missed_policy ?? "skip", overlap_policy: schedule.overlap_policy ?? "queue_one" });
  try { new Intl.DateTimeFormat("en-US", { timeZone: policy.timezone }).format(new Date(0)); } catch { fieldError("SCHEDULE_INVALID_TIMEZONE","timezone"); }
  const positive = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
  if (schedule.trigger_type === "interval" && !positive(schedule.interval_ms)
    || schedule.trigger_type === "after_cycles" && !positive(schedule.cycle_interval)
    || schedule.trigger_type === "on_idle" && !positive(schedule.idle_ms)) fieldError("SCHEDULE_INVALID_TRIGGER",schedule.trigger_type==="interval"?"interval_ms":schedule.trigger_type==="on_idle"?"idle_ms":"cycle_interval");
  if (schedule.trigger_type === "cron_like") {try{compileCron(schedule.cron ?? "");}catch{fieldError("SCHEDULE_INVALID_CRON","cron");}}
  if (!schedule.name.trim() || schedule.name.length > 300) fieldError("SCHEDULE_INVALID_DEFINITION","name");
  if (schedule.max_runs !== null && (!Number.isSafeInteger(schedule.max_runs)||schedule.max_runs<0)) fieldError("SCHEDULE_INVALID_DEFINITION","max_runs");
  return policy;
}
const formatters=new Map<string,Intl.DateTimeFormat>();
function wallTime(now: number, timezone: string): { values: number[]; cursor: string } {
  let formatter=formatters.get(timezone);if(!formatter){formatter=new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    weekday: "short", hourCycle: "h23" });if(formatters.size>=64)formatters.delete(formatters.keys().next().value!);formatters.set(timezone,formatter);}
  const parts = formatter.formatToParts(new Date(now));
  const field = (name: string) => parts.find(part => part.type === name)!.value;
  return { values: [Number(field("minute")), Number(field("hour")), Number(field("day")), Number(field("month")), ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(field("weekday"))],
    cursor: `${field("year")}-${field("month")}-${field("day")}T${field("hour")}:${field("minute")}` };
}
function cronProposal(schedule: DreamSchedule, now: number, prepared?:{policy:SchedulePolicy;fields:Set<number>[]}): OccurrenceProposal | null {
  const policy = prepared?.policy??validateScheduleTiming(schedule), fields = prepared?.fields??compileCron(schedule.cron!), wall = wallTime(now, policy.timezone);
  if (!fields.every((field, index) => field.has(wall.values[index]))) return null;
  const minute = Math.floor(now / 60_000) * 60_000;
  return { planned_at: new Date(minute).toISOString(), trigger_cursor: `cron:${wall.cursor}:${policy.timezone}${policy.fold_policy === "both" ? `:${minute}` : ""}`, missed: false };
}
export function evaluateSchedule(schedule: DreamSchedule, now: number, context: { cycle?: number; last_activity_at: string; last_tick?: string | null }): OccurrenceProposal | null {
  validateScheduleTiming(schedule);
  if (schedule.trigger_type === "interval") {
    const anchor = Date.parse(schedule.created_at), interval = schedule.interval_ms!, slot = Math.floor((now - anchor) / interval);
    if (slot < 1) return null;
    const planned = anchor + slot * interval, missed = now - planned > 60_000;
    return { planned_at: new Date(planned).toISOString(), trigger_cursor: `interval:${slot}`, missed };
  }
  if (schedule.trigger_type === "cron_like") {
    const prepared = { policy: validateScheduleTiming(schedule), fields: compileCron(schedule.cron!) };
    const current = cronProposal(schedule, now, prepared);
    if (current) return current;
    // At most the latest missed occurrence. No backfill storm after a long outage.
    const lower = Math.max(Date.parse(context.last_tick ?? schedule.created_at), Date.parse(schedule.updated_at), now - 32 * 86400000);
    for (let minute = Math.floor(now / 60000) * 60000 - 60000; minute > lower; minute -= 60000) {
      const proposal = cronProposal(schedule, minute, prepared);
      if (proposal) return { ...proposal, missed: true };
    }
    return null;
  }
  if (schedule.trigger_type === "after_cycles") {
    if (context.cycle === undefined || context.cycle < schedule.cycle_interval!) return null;
    const slot = Math.floor(context.cycle / schedule.cycle_interval!);
    return { planned_at: null, trigger_cursor: `cycle:${slot}`, missed: context.cycle % schedule.cycle_interval! !== 0 };
  }
  const activity = Date.parse(context.last_activity_at);
  if (now - activity < schedule.idle_ms!) return null;
  return { planned_at: new Date(activity + schedule.idle_ms!).toISOString(), trigger_cursor: `idle:${context.last_activity_at}`, missed: false };
}
/** Bounded preview uses the same evaluator. Nonexistent DST wall times naturally have no slot. */
export function previewSchedule(schedule: DreamSchedule, now = Date.now(), limit = 8, context?:{cycle?:number;last_activity_at?:string}): OccurrenceProposal[] {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 32) throw new Error("SCHEDULE_PREVIEW_LIMIT");
  validateScheduleTiming(schedule);
  if(schedule.trigger_type==="after_cycles"){
    if(context?.cycle===undefined)return [];
    if(!Number.isSafeInteger(context.cycle)||context.cycle<0)throw new Error("SCHEDULE_CYCLE_CONTEXT_INVALID");
    const first=Math.floor(context.cycle/schedule.cycle_interval!)+1;
    return Array.from({length:limit},(_,index)=>({planned_at:null,trigger_cursor:`cycle:${first+index}`,missed:false}));
  }
  if(schedule.trigger_type==="on_idle"){
    if(!context?.last_activity_at)return [];
    const activity=Date.parse(context.last_activity_at);if(!Number.isFinite(activity))throw new Error("SCHEDULE_ACTIVITY_CONTEXT_INVALID");
    return [{planned_at:new Date(activity+schedule.idle_ms!).toISOString(),trigger_cursor:`idle:${context.last_activity_at}`,missed:false}];
  }
  const result: OccurrenceProposal[] = [], seen = new Set<string>();
  if (schedule.trigger_type === "interval") {
    const anchor = Date.parse(schedule.created_at), first = Math.max(1, Math.floor((now-anchor)/schedule.interval_ms!) + 1);
    for (let n=first;n<first+limit;n++) result.push({ planned_at: new Date(anchor+n*schedule.interval_ms!).toISOString(), trigger_cursor: `interval:${n}`, missed: false });
  } else {
    const start = Math.floor(now/60_000)*60_000 + 60_000;
    const prepared={policy:validateScheduleTiming(schedule),fields:compileCron(schedule.cron!)};
    for (let minute=start; minute<start+32*24*60*60_000 && result.length<limit; minute+=60_000) {
      const slot = cronProposal(schedule,minute,prepared); if (!slot || seen.has(slot.trigger_cursor)) continue;
      seen.add(slot.trigger_cursor); result.push(slot);
    }
  }
  return result;
}
