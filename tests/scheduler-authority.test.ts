import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSchedule, updateSchedule, deleteSchedule, runScheduleNow, getScheduleSnapshot, getScheduleHistory, getSchedulerConfig, updateSchedulerConfig, stopScheduler,
  getSchedules, validateSchedule, tickSchedules, startScheduler } from "../src/cognitive/scheduler.js";
import * as digestion from "../src/cognitive/digestion.js";
import { evaluateSchedule, previewSchedule } from "../src/cognitive/schedule-definition.js";
import { EngineJobs } from "../src/cognitive/jobs.js";
import { commitGraphWrites, loadPublicationState } from "../src/graph/publication.js";
import { getDataDir, setDataDirOverride } from "../src/utils/paths.js";
import { releaseGraphWriter } from "../src/graph/writer-lease.js";
import { DATA_STUBS } from "../src/instance/types.js";
let directory:string,previous:string,config:ReturnType<typeof getSchedulerConfig>;
beforeEach(async()=>{previous=getDataDir();directory=await mkdtemp(join(tmpdir(),"dg-schedule-"));setDataDirOverride(directory);config=getSchedulerConfig();
 stopScheduler();updateSchedulerConfig({enabled:false,global_cooldown_ms:0,nightmare_cooldown_ms:0,max_runs_per_hour:30,execution_timeout_ms:10000});});
afterEach(async()=>{stopScheduler();vi.useRealTimers();vi.restoreAllMocks();updateSchedulerConfig({...config,enabled:false});await releaseGraphWriter(directory);setDataDirOverride(previous);await rm(directory,{recursive:true,force:true});});
const create=(overrides:Record<string,unknown>={})=>createSchedule({name:"Maintenance",action:"graph_maintenance",trigger_type:"interval",interval_ms:60000,...overrides});
it("new-instance fallback and shipped template are readable canonical empty schedules without a migration or job",async()=>{
 const template=JSON.parse(await readFile(new URL("../templates/default/schedules.json",import.meta.url),"utf8"));
 for(const document of [DATA_STUBS["schedules.json"],template]) {
  await commitGraphWrites({actor:"bootstrap-fixture",writes:[{file:"schedules.json",content:JSON.stringify(document)}]});
  const before=await readFile(join(directory,"schedules.json"),"utf8");
  expect(await getSchedules()).toEqual([]);expect(await getScheduleHistory()).toEqual([]);
  expect(await readFile(join(directory,"schedules.json"),"utf8")).toBe(before);
  expect((await new EngineJobs().inspect()).records).toEqual([]);
 }
 expect(await create()).toMatchObject({enabled:false,definition_revision:1});
});
it("creation is disabled and reads/preview/enable never dispatch a job",async()=>{
 const schedule=await create();expect(schedule).toMatchObject({enabled:false,status:"paused",definition_revision:1,timezone:"UTC"});
 await getScheduleSnapshot();previewSchedule(schedule);await updateSchedule(schedule.id,{enabled:true},{expected_revision:1,operation_id:"enable"});
 expect((await new EngineJobs().inspect()).records).toHaveLength(0);await expect(readFile(join(directory,"jobs.json"))).rejects.toMatchObject({code:"ENOENT"});
});
it("strict invalid parameters and cron do not broaden into action defaults",async()=>{
 for(const parameters of [{max_dreams:-1},{strategy:"reflective"},{focus_hops:99},{extra:"ignored?"}])await expect(create({action:"dream_cycle",parameters})).rejects.toThrow();
 for(const cron of ["0 0 * *","0 0 * * * junk","0junk 0 * * *","*/0 * * * *","61 * * * *"])await expect(create({trigger_type:"cron_like",cron})).rejects.toThrow("SCHEDULE_INVALID_CRON");
 expect(await getSchedules()).toEqual([]);expect((await new EngineJobs().inspect()).records).toEqual([]);
});
it("two-client definition CAS and lost edit reply preserve the original receipt",async()=>{
 const schedule=await create();const changed=await updateSchedule(schedule.id,{name:"Changed"},{expected_revision:1,operation_id:"edit"});
 await expect(updateSchedule(schedule.id,{name:"Other"},{expected_revision:1,operation_id:"other"})).rejects.toThrow("SCHEDULE_REVISION_CONFLICT");
 await updateSchedule(schedule.id,{name:"Latest"},{expected_revision:2,operation_id:"later"});
 expect(await updateSchedule(schedule.id,{name:"Changed"},{expected_revision:1,operation_id:"edit"})).toEqual(changed);
 await expect(updateSchedule(schedule.id,{name:"Changed again"},{expected_revision:1,operation_id:"edit"})).rejects.toThrow("SCHEDULE_OPERATION_CONFLICT");
 expect((await getSchedules())[0].name).toBe("Latest");
});
it("manual lost reply replays one immutable occurrence even after definition edit and archive",async()=>{
 const schedule=await create();const first=await runScheduleNow(schedule.id,{operation_id:"run",expected_revision:1});
 expect(first).toMatchObject({success:true,definition_revision:1,action_version:"dreamgraph.schedule.actions.v2",parameters:{}});
 await updateSchedule(schedule.id,{name:"New name"},{expected_revision:1,operation_id:"edit"});
 await deleteSchedule(schedule.id,{expected_revision:2,operation_id:"archive"});
 const beforeReplay=await readFile(join(directory,"publication_state.json"),"utf8");
 expect(await runScheduleNow(schedule.id,{operation_id:"run",expected_revision:1})).toEqual(first);
 expect(await readFile(join(directory,"publication_state.json"),"utf8")).toBe(beforeReplay);
 expect((await getScheduleHistory(schedule.id))).toHaveLength(1);expect((await new EngineJobs().inspect()).records).toHaveLength(1);
 const file=JSON.parse(await readFile(join(directory,"schedules.json"),"utf8"));expect(file.definition_history.map((s:{name:string})=>s.name)).toEqual(["Maintenance","New name"]);
});

it("inactive legacy schedules and repeated ticks do not manufacture publication receipts",async()=>{
 const seed=await create(),file=JSON.parse(await readFile(join(directory,"schedules.json"),"utf8"));
 file.schedules=Array.from({length:39},(_,i)=>({...seed,id:`legacy-${i}`,created_at:"2026-01-01T00:00:00.000Z",status:i%2?"exhausted":"paused",enabled:false,run_count:i%2?3:0,max_runs:i%2?3:null}));
 await commitGraphWrites({actor:"legacy-fixture",writes:[{file:"schedules.json",content:JSON.stringify(file)}]});
 startScheduler({enabled:true});stopScheduler(); // Keep enabled policy, with no automatic callbacks.
 const before=await loadPublicationState(),now=Date.parse("2026-10-03T09:00:00Z");
 await tickSchedules(now);
 const after=await loadPublicationState();
 expect(after.revision.publication_sequence-before.revision.publication_sequence).toBe(1); // One durable tick cursor.
 expect((await getSchedules()).map(s=>s.last_skip_reason)).toEqual(file.schedules.map((s:any)=>s.last_skip_reason));
 const saved=await readFile(join(directory,"publication_state.json"),"utf8");
 await tickSchedules(now);expect(await readFile(join(directory,"publication_state.json"),"utf8")).toBe(saved);
 expect((await new EngineJobs().inspect()).records).toHaveLength(0);
});

it("automatic timer coalesces wake-ups while a tick is in flight instead of queueing writers",async()=>{
 let release!:()=>void;const held=new Promise<void>(done=>release=done);
 const run=vi.spyOn(digestion,"runDirtyDigestion").mockImplementation(async()=>{await held;return [];});
 vi.useFakeTimers({toFake:["setInterval","clearInterval"]});
 try{
  startScheduler({enabled:true,tick_interval_ms:100});
  await vi.waitFor(()=>expect(run).toHaveBeenCalledTimes(1),{timeout:3000});
  await vi.advanceTimersByTimeAsync(1000);
  await new Promise(done=>setTimeout(done,250));
  expect(run).toHaveBeenCalledTimes(1);
 }finally{stopScheduler();release();await new Promise(done=>setTimeout(done,250));}
 expect(run).toHaveBeenCalledTimes(1);
});

it("stopping during recovery invalidates the already scheduled first tick",async()=>{
 let release!:(ids:string[])=>void;const held=new Promise<string[]>(done=>release=done);
 vi.spyOn(EngineJobs.prototype,"recover").mockReturnValue(held);
 const run=vi.spyOn(digestion,"runDirtyDigestion").mockResolvedValue([]);
 vi.useFakeTimers({toFake:["setInterval","clearInterval"]});
 startScheduler({enabled:true,tick_interval_ms:100});await vi.advanceTimersByTimeAsync(500);stopScheduler();release([]);
 await new Promise(done=>setTimeout(done,250));
 expect(run).not.toHaveBeenCalled();
 await expect(readFile(join(directory,"publication_state.json"))).rejects.toMatchObject({code:"ENOENT"});
});
it("pause changes future admission and retains completed original definition history",async()=>{
 const schedule=await create({enabled:true,parameters:{}});await runScheduleNow(schedule.id,{operation_id:"run",expected_revision:1});
 await updateSchedule(schedule.id,{enabled:false},{expected_revision:1,operation_id:"pause"});await tickSchedules(Date.now()+3600000);
 expect((await new EngineJobs().inspect()).records).toHaveLength(1);expect((await getScheduleHistory())[0].parameters).toEqual({});
});
it("preview and dispatch use identical named-zone DST gap/fold identities",async()=>{
 const schedule=await create({trigger_type:"cron_like",cron:"30 3 * * *",timezone:"Europe/Helsinki"});
 const spring=previewSchedule(schedule,Date.parse("2026-03-28T22:00:00Z"),1);expect(spring[0].planned_at).toBe("2026-03-30T00:30:00.000Z");
 const at=Date.parse("2026-10-24T22:00:00Z"),once=previewSchedule(schedule,at,2),both=previewSchedule({...schedule,fold_policy:"both"},at,2);
 expect(once.map(o=>o.planned_at)).toEqual(["2026-10-25T00:30:00.000Z","2026-10-26T01:30:00.000Z"]);
 expect(both.map(o=>o.planned_at)).toEqual(["2026-10-25T00:30:00.000Z","2026-10-25T01:30:00.000Z"]);
 expect(evaluateSchedule(schedule,Date.parse(once[0].planned_at!),{last_activity_at:schedule.created_at})).toEqual(once[0]);
 expect(evaluateSchedule(schedule,Date.parse(both[1].planned_at!),{last_activity_at:schedule.created_at})?.trigger_cursor).toBe(once[0].trigger_cursor);
});
it("zero dreams stay zero and excessive allocations are rejected before engine work",async()=>{
 const schedule=await create({action:"dream_cycle",parameters:{max_dreams:0,focus_hops:0}});
 const result=await runScheduleNow(schedule.id,{operation_id:"zero",expected_revision:1});expect(result.result_summary).toContain("zero allocation");
 await expect(create({action:"dream_cycle",parameters:{max_dreams:10001}})).rejects.toThrow();
});
it("malformed or changed persisted state fails closed rather than returning an empty registry",async()=>{
 await create();await commitGraphWrites({actor:"fixture",writes:[{file:"schedules.json",content:'{"metadata":{},"schedules":"wrong","executions":[]}' }]});
 await expect(getSchedules()).rejects.toThrow("SCHEDULE_STORE_UNAVAILABLE");
});
it("cycle and idle cursors remain deterministic across repeated evaluation",async()=>{
 const cycle=await create({trigger_type:"after_cycles",cycle_interval:3});
 expect(evaluateSchedule(cycle,Date.now(),{cycle:6,last_activity_at:cycle.created_at})?.trigger_cursor).toBe("cycle:2");
 expect(previewSchedule(cycle,Date.now(),1,{cycle:5})[0].trigger_cursor).toBe("cycle:2");
 expect(previewSchedule(cycle,Date.now(),1)).toEqual([]);
 const idle=await create({trigger_type:"on_idle",idle_ms:60000});const activity="2026-10-01T00:00:00Z";
 const one=evaluateSchedule(idle,Date.parse(activity)+61000,{last_activity_at:activity}),two=evaluateSchedule(idle,Date.parse(activity)+120000,{last_activity_at:activity});expect(one).toEqual(two);
 expect(previewSchedule(idle,Date.parse(activity),8,{last_activity_at:activity})).toEqual([one]);
});

it("missed cron chooses only the latest bounded occurrence and archive retries are payload-bound",async()=>{
 const original=await create({trigger_type:"cron_like",cron:"0 * * * *",missed_policy:"catch_up_once"});
 const schedule={...original,created_at:"2026-09-01T00:00:00Z",updated_at:"2026-09-01T00:00:00Z"};
 const now=Date.parse("2026-10-01T05:10:00Z");
 expect(evaluateSchedule(schedule,now,{last_activity_at:schedule.created_at,last_tick:"2026-09-30T05:10:00Z"})).toMatchObject({planned_at:"2026-10-01T05:00:00.000Z",missed:true});
 expect(evaluateSchedule(schedule,now,{last_activity_at:schedule.created_at,last_tick:"2026-10-01T05:05:00Z"})).toBeNull();
 const controls={expected_revision:1,operation_id:"archive"};expect(await deleteSchedule(original.id,controls)).toBe(true);
 expect(await deleteSchedule(original.id,controls)).toBe(true);
 await expect(deleteSchedule(original.id,{...controls,expected_revision:2})).rejects.toThrow("SCHEDULE_OPERATION_CONFLICT");
 await expect(deleteSchedule(original.id,{expected_revision:1,operation_id:"different"})).rejects.toThrow("SCHEDULE_REVISION_CONFLICT");
});
