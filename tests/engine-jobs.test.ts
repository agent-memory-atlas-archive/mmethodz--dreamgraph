import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EngineJobs, withEngineJob } from "../src/cognitive/jobs.js";
import { ModelAdmission } from "../src/cognitive/model-admission.js";
import { currentJob, assertJobCurrent } from "../src/cognitive/job-context.js";
import { resolveRolePolicy } from "../src/config/role-policy.js";
import { commitGraphWrites } from "../src/graph/publication.js";
import { getRoleModelPolicy } from "../src/cognitive/llm.js";
import { setDataDirOverride, getDataDir } from "../src/utils/paths.js";
import { releaseGraphWriter } from "../src/graph/writer-lease.js";
import type { ResourceBudget } from "../src/graph/contracts.js";
let directory: string, previous: string, jobs: EngineJobs;
const budget = (overrides: Partial<ResourceBudget> = {}): ResourceBudget => ({ requests: 3, input_tokens: 100_000, output_tokens: 100_000,
  reasoning_tokens: 100_000, retries: 1, elapsed_ms: 10_000, concurrency: 1, max_hops: 2, max_neighbors: 40,
  run_amount: 0, day_amount: 0, currency: "USD", pricing_version: null, billing_principal: "operator", ...overrides });
const input = (operation_id: string, overrides: Record<string, unknown> = {}) => ({ operation_id, action: "fixture", owner: "test", scope: ["fixture"],
  role_policies: {}, budget: budget(), ...overrides });
beforeEach(async () => { previous = getDataDir(); directory = await mkdtemp(join(tmpdir(), "dg-jobs-")); setDataDirOverride(directory); jobs = new EngineJobs(directory); });
afterEach(async () => { vi.unstubAllEnvs(); await releaseGraphWriter(directory); setDataDirOverride(previous); await rm(directory, { recursive: true, force: true }); });
const until = async (work: () => Promise<boolean>) => { for (let i=0;i<100;i++) { if (await work()) return; await new Promise(resolve => setTimeout(resolve, 5)); } throw new Error("fixture did not settle"); };
it("durably accepts exact replay, preserves original result and rejects changed intent", async () => {
  const first = await jobs.accept(input("same", { parameters: { n: 1 } }));
  expect((await new EngineJobs(directory).accept(input("same", { parameters: { n: 1 } }))).job.id).toBe(first.job.id);
  await expect(jobs.accept(input("same", { parameters: { n: 2 } }))).rejects.toThrow("JOB_OPERATION_CONFLICT");
  let dispatches = 0;
  expect(await jobs.run(first.job.id, async () => ({ count: ++dispatches }))).toEqual({ count: 1 });
  expect(await new EngineJobs(directory).run(first.job.id, async () => ({ count: ++dispatches }))).toEqual({ count: 1 });
  expect(dispatches).toBe(1);
});
it("persists conflict ownership across clients and nested phases inherit one fence", async () => {
  const first = await jobs.accept(input("one")), second = await jobs.accept(input("two"));
  let release!: () => void, entered!: () => void; const ready = new Promise<void>(resolve => entered = resolve);
  const running = jobs.run(first.job.id, async () => { entered(); await new Promise<void>(resolve => release = resolve);
    return withEngineJob(input("nested"), async () => currentJob()!.id); });
  await ready;
  await expect(new EngineJobs(directory).run(second.job.id, async () => "never")).rejects.toThrow("JOB_CONFLICT_BLOCKED");
  release(); expect(await running).toBe(first.job.id); expect((await jobs.inspect()).records).toHaveLength(2);
  expect(await jobs.run(second.job.id, async () => "later")).toBe("later");
});
it("cancelling an undispatched blocked job confirms no work while retaining the running owner's unconfirmed termination",async()=>{
 const first=await jobs.accept(input("owner")),second=await jobs.accept(input("blocked-cancel"));let entered!:()=>void,release!:()=>void;
 const ready=new Promise<void>(resolve=>entered=resolve),running=jobs.run(first.job.id,async()=>{entered();await new Promise<void>(resolve=>release=resolve);return "late";});const stopped=expect(running).rejects.toThrow("JOB_TERMINATION_UNCONFIRMED");await ready;
 await expect(jobs.run(second.job.id,async()=>"must never run")).rejects.toThrow("JOB_CONFLICT_BLOCKED");
 const cancelled=await jobs.cancel(second.job.id,"operator_cancelled",{expected_fence:0,operation_id:"cancel-blocked"});expect(cancelled).toMatchObject({work_settled:true,lease:null,job:{state:"cancelled",unknown_effects:[]}});
 await expect(jobs.run(second.job.id,async()=>"never")).rejects.toThrow("JOB_NOT_DISPATCHABLE");
 const owner=await jobs.cancel(first.job.id);expect(owner.work_settled).toBe(false);expect(owner.job.unknown_effects).toContain("work_termination_unconfirmed");await stopped;release();await until(async()=>(await jobs.inspect()).records.find(row=>row.job.id===first.job.id)!.work_settled);
});
it("timeout rejects waiting but retains recovery ownership until noncooperative work really settles", async () => {
  const first = await jobs.accept(input("hang", { timeout_ms: 800 })); let release!: () => void, entered!: () => void;
  const ready = new Promise<void>(resolve => entered = resolve); let lateError = "";
  const result = jobs.run(first.job.id, async () => { entered(); await new Promise<void>(resolve => release = resolve);
    try { await commitGraphWrites({ writes: [{ file: "features.json", content: "[]" }] }); } catch (error) { lateError = String(error); }
    return "late"; });
  const stopped = expect(result).rejects.toThrow("JOB_TERMINATION_UNCONFIRMED"); await ready; await stopped;
  await until(async () => (await jobs.inspect()).records[0].job.state === "recovery_required");
  const second = await jobs.accept(input("blocked")); await expect(jobs.run(second.job.id, async () => "never")).rejects.toThrow("JOB_CONFLICT_BLOCKED");
  release(); await until(async () => (await jobs.inspect()).records[0].job.state === "cancelled");
  expect(lateError).toContain("JOB_DEADLINE"); await expect(readFile(join(directory,"features.json"))).rejects.toMatchObject({ code: "ENOENT" });
});
it("caller cancellation reaches cooperative action and fences its graph publication", async () => {
  const record = await jobs.accept(input("abort")); const controller = new AbortController(); let entered!: () => void;
  const ready = new Promise<void>(resolve => entered = resolve);
  const result = jobs.run(record.job.id, async context => { entered(); await new Promise<void>(resolve => context.signal.addEventListener("abort", () => resolve(), { once: true }));
    await assertJobCurrent(); return "should not publish"; }, controller.signal);
  const stopped = expect(result).rejects.toThrow("JOB_TERMINATION_UNCONFIRMED"); await ready; controller.abort(); await stopped;
  await until(async () => ["cancelled", "failed"].includes((await jobs.inspect()).records[0].job.state));
});
it("immutable role policy remains unchanged after environment edits and is private from caller mutation", async () => {
  const policy = resolveRolePolicy({ role: "dreamer", env: {}, session: { provider: "ollama", model: "first" } });
  const record = await jobs.accept(input("pin", { role_policies: { dreamer: policy } }));
  policy.effective.model = "caller-mutated"; vi.stubEnv("DG_ROLE_DREAMER_MODEL", "changed");
  expect(await jobs.run(record.job.id, async () => (await getRoleModelPolicy("dreamer")).effective.model)).toBe("first");
  expect((await jobs.inspect()).records[0].snapshot.role_policies).toHaveProperty("dreamer.effective.model", "first");
});
it("corrupt or unpublished job state fails closed instead of presenting an empty queue", async () => {
  await jobs.accept(input("accepted")); await writeFile(join(directory,"jobs.json"),"{}");
  await expect(jobs.inspect()).rejects.toThrow("JOB_STORE_UNAVAILABLE");
});
it("restart-like orphan lease becomes recovery-required and cannot be redispatched", async () => {
  const record = await jobs.accept(input("orphan")); const file = await jobs.inspect();
  const item = file.records[0]; item.job.state = "running"; item.job.fence = 1;
  item.lease = { process_id: "previous-process", acquired_at: item.job.created_at, expires_at: item.job.created_at };
  await commitGraphWrites({ actor: "fixture", writes: [{ file: "jobs.json", content: JSON.stringify(file) }] });
  expect(await jobs.recover()).toEqual([record.job.id]);
  await expect(jobs.run(record.job.id, async () => "duplicate")).rejects.toThrow("JOB_NOT_DISPATCHABLE");
  expect((await jobs.inspect()).records[0].job.unknown_effects).toContain("work_termination_unconfirmed");
});
it("child roles and fallbacks share one parent request and retry ceiling", async () => {
  const admission = new ModelAdmission(jobs.instance_id, directory);
  await admission.registerParentRun("parent", "frozen", budget({ requests: 1 }));
  const request = (id: string, role: string) => ({ id, run_id: role, parent_run_id: "parent", policy_fingerprint: role, budget: budget(), provider: "ollama", model: "local",
    channel: "local" as const, credential_reference: null, payload_hash: id, source_scope: [role], resources: { input_tokens: 1, output_tokens: 1, reasoning_tokens: 0, retry: false } });
  await admission.reserve(request("dream", "dreamer")); await admission.dispatch("dream"); await admission.settle("dream", { acknowledged: true, usage: { inputTokens: 1, outputTokens: 1 } });
  await expect(admission.reserve(request("normal", "normalizer"))).rejects.toThrow("ADMISSION_PARENT_REQUEST_LIMIT");
  expect(Object.keys((await admission.inspect()).attempts)).toEqual(["dream"]);
});
it("late provider liability survives cancellation and blocks the engine lane", async () => {
  const record = await jobs.accept(input("liability"));
  await expect(jobs.run(record.job.id, async context => {
    const admission = new ModelAdmission(jobs.instance_id, directory);
    await admission.reserve({ id: "uncertain", run_id: "child", parent_run_id: context.parent_admission.run_id, policy_fingerprint: "child", budget: budget(), provider: "ollama", model: "local",
      channel: "local", credential_reference: null, payload_hash: "payload", source_scope: ["fixture"], resources: { input_tokens: 1, output_tokens: 1, reasoning_tokens: 0, retry: false } });
    await admission.dispatch("uncertain"); await admission.settle("uncertain", { acknowledged: false }); return "work returned";
  })).rejects.toThrow("JOB_EFFECT_RECOVERY_REQUIRED");
  const saved = (await jobs.inspect()).records[0]; expect(saved.job.state).toBe("recovery_required"); expect(saved.job.unknown_effects).toEqual(["uncertain"]);
  const next = await jobs.accept(input("next")); await expect(jobs.run(next.job.id, async () => "never")).rejects.toThrow("JOB_CONFLICT_BLOCKED");
  const admission=new ModelAdmission(jobs.instance_id,directory);
  await admission.settle("uncertain",{acknowledged:true,usage:{inputTokens:1,outputTokens:1}});
  expect((await jobs.reconcileSettled(record.job.id,saved.job.fence)).job.state).toBe("succeeded");
  expect(await jobs.run(record.job.id,async()=>"duplicate")).toBe("work returned");
  expect(await jobs.run(next.job.id,async()=>"released after proof")).toBe("released after proof");
});

it("external dispatch is durable before transport and unknown sends hold the lane without replay",async()=>{
 const record=await jobs.accept(input("send"));let sent=0;
 await expect(jobs.run(record.job.id,async context=>{
  await jobs.beginExternalEffect(record.job.id,context.fence,{id:"http:1",kind:"http",target:"https://example.test",payload_hash:"body"});
  expect((await new EngineJobs(directory).inspect()).records[0].external_effects[0].state).toBe("dispatched");sent++;
  await jobs.settleExternalEffect(record.job.id,"http:1",false,"network response unavailable");return "uncertain";
 })).rejects.toThrow("JOB_EFFECT_RECOVERY_REQUIRED");
 await expect(jobs.run(record.job.id,async()=>{sent++;return "retry";})).rejects.toThrow("JOB_NOT_DISPATCHABLE");expect(sent).toBe(1);
 const saved=(await jobs.inspect()).records[0];expect(saved.job.unknown_effects).toEqual(["http:1"]);
 expect((await jobs.reconcileSettled(record.job.id,saved.job.fence)).job.state).toBe("recovery_required");
 await jobs.settleExternalEffect(record.job.id,"http:1",true,"receiver receipt: original delivery");
 expect((await jobs.reconcileSettled(record.job.id,saved.job.fence)).job.state).toBe("succeeded");
});

it("replay binds explicit authority, budget, deadline and lifetime without adopting new ambient defaults", async () => {
  const accepted = input("bound", { timeout_ms: 10000 });
  const first = await jobs.accept(accepted);
  for (const changed of [{ lifetime: "session_bound" }, { timeout_ms: 9000 }, { budget: budget({ requests: 2 }) },
    { authority: { id: "grant", revision: "1", scope: ["fixture"], expires_at: new Date(Date.now()+60000).toISOString(), autonomy: "manual" } }]) {
    await expect(jobs.accept({ ...accepted, ...changed })).rejects.toThrow("JOB_OPERATION_CONFLICT");
  }
  vi.stubEnv("DREAMGRAPH_LLM_PRICING", "changed ambient setting");
  expect((await jobs.accept(accepted)).job.id).toBe(first.job.id);
});

it("stale cancellation cannot abort running work and exact cancellation replay retains its original receipt", async () => {
  const record = await jobs.accept(input("cancel-cas"));
  let entered!:()=>void, release!:()=>void; const ready = new Promise<void>(resolve=>entered=resolve);
  let observed:AbortSignal;
  const running = jobs.run(record.job.id, async context=>{observed=context.signal;entered();await new Promise<void>(resolve=>release=resolve);return "done";});
  const stopped=expect(running).rejects.toThrow("JOB_TERMINATION_UNCONFIRMED");await ready;
  await expect(jobs.cancel(record.job.id,"operator_cancelled",{expected_fence:0,operation_id:"stale"})).rejects.toThrow("JOB_FENCE_CONFLICT");
  expect(observed!.aborted).toBe(false);
  const controls={expected_fence:1,operation_id:"stop"};const receipt=await jobs.cancel(record.job.id,"operator_cancelled",controls);await stopped;
  expect(observed!.aborted).toBe(true);release();await until(async()=>(await jobs.inspect()).records[0].job.state==="cancelled");
  expect(await jobs.cancel(record.job.id,"operator_cancelled",controls)).toEqual(receipt);
  await expect(jobs.cancel(record.job.id,"other",controls)).rejects.toThrow("JOB_CANCEL_OPERATION_CONFLICT");
});
