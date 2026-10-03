/** Actual SDK/HTTP/session/writer/C14 integration. Providers and native GUI are not qualified here. */
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonHttpAuthority } from "../src/server/http-authority.js";
import { withSessionContext, type SessionContext } from "../src/server/session-context.js";
import { handleManagedExecutionApi, endHostExecution, withHostExecution } from "../src/server/managed-execution.js";
import { executionContextTransport, readManagedContext, assertManagedContext, recordManagedEffect } from "../src/graph/execution-context.js";
import { ManagedExecutionClient, ManagedGraphPass } from "../packages/sdk/src/seams/graph-execution.js";
import { compiledEditor } from "./helpers/compiled-editor.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { getDataDir, setDataDirOverride } from "../src/utils/paths.js";
import { releaseGraphWriter } from "../src/graph/writer-lease.js";
import { commitGraphWrites, loadPublicationState } from "../src/graph/publication.js";
import { previewArchitectPlanAuthority, reviewArchitectPlanDefinition } from "../src/architect/plan-registry.js";
import { handleArchitectRoute } from "../src/architect/routes.js";
import { applyPlanCommand, readPlanAuthority } from "../src/discipline/plan-authority.js";
import * as runtime from "../src/discipline/plan-runtime.js";
import * as lifecycle from "../src/instance/lifecycle.js";
import type { ManagedExecutionRequest, ManagedModelAdmissionRequest, PlanExecutionIntent } from "../src/graph/contracts.js";

let root: string, old: string, host: SessionContext, client: ManagedExecutionClient, server: Server, url: string;
let intent: PlanExecutionIntent;
const markdown = "# Native execution\n\n### Slice 0 - Work\n\n- id: work\n\nAcceptance: observable source and verification.\n";
const inHost = <T>(work: () => Promise<T>) => withSessionContext(host, work);
const view = () => readPlanAuthority(intent.scope);
const request = (id: string, extras: Partial<ManagedExecutionRequest> = {}) => ({ id, adapter: "sdk/native", query: "Execute the reviewed work",
  plan_execution: intent, timeout_ms: 300000, token_budget: 10000, ...extras });
beforeEach(async () => {
  old = getDataDir(); root = await mkdtemp(join(tmpdir(), "dg-managed-plan-"));
  await mkdir(join(root, "data")); await mkdir(join(root, "plans")); setDataDirOverride(join(root, "data"));
  await writeFile(join(root, "plans/fixture.md"), markdown);
  vi.spyOn(lifecycle, "getActiveScope").mockReturnValue({ uuid: "fixture-instance", projectRoot: root } as any);
  await commitGraphWrites({ actor: "offline-fixture", scope: ["features.json"], writes: [{ file: "features.json", content: JSON.stringify({ features: [{ id: "f", name: "Fixture" }] }) }] });
  const authority = new DaemonHttpAuthority(1, {});
  server = createServer((req, res) => { void (async () => {
    const context = await authority.authorize(req, res); if (!context) return;
    if (!context.execution_policy) host ??= context;
    await withSessionContext(context, async () => {
      if (await authority.handle(req, res, context)) return;
      const pathname = new URL(req.url!, "http://local").pathname;
      if (pathname === "/api/architect/v1/chat") { await handleArchitectRoute(req, res, pathname); return; }
      if (pathname.startsWith("/api/architect/v1/execution/context/")) {
        const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
        try { const result = await executionContextTransport(pathname.endsWith("deliver") ? "deliver" : "refresh", JSON.parse(Buffer.concat(chunks).toString("utf8")));
          res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(result)); }
        catch (error) { res.writeHead(409); res.end(JSON.stringify({ error: String(error) })); } return;
      }
      if (!await handleManagedExecutionApi(req, res, pathname)) { res.writeHead(404); res.end(); }
    });
  })().catch(error => { if (!res.headersSent) res.writeHead(500); res.end(String(error)); }); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as any).port}`; client = new ManagedExecutionClient({ baseUrl: url });
  const read = await client.begin({ id: "initialize-owner", adapter: "sdk/native", query: "Fixture" });
  await client.finish(read.execution.execution_id, "completed", "confirmed");
  const preview = await previewArchitectPlanAuthority("fixture");
  const actor = { id: host.principal, kind: "operator" as const, instance_id: preview.scope.instance_id, project_id: preview.scope.project_id };
  await inHost(() => reviewArchitectPlanDefinition({ plan_id: "fixture", operation_id: "import", preview_hash: preview.preview_hash, review_id: "import-review", actor }));
  for (const command of [{ type: "review_plan", review_id: "design-review" }, { type: "approve_scope", approval_id: "approved", owner: host.principal, scope: ["work"], parallel_limit: 1 }, { type: "start_slice", slice_id: "work" }]) {
    const current = (await readPlanAuthority(preview.scope))!;
    await applyPlanCommand({ actor, plan_id: preview.scope.id, operation_id: command.type, expected_revision: current.state.revision,
      expected_definition_hash: current.state.definition_hash, command });
  }
  const current = (await readPlanAuthority(preview.scope))!;
  intent = { scope: preview.scope, kind: "implementation", slice_id: "work", expected_revision: current.state.revision,
    expected_definition_hash: current.state.definition_hash, approval_id: "approved" };
});
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  try { const entries = JSON.parse(await readFile(join(root, "data/execution_contexts.json"), "utf8")).entries;
    for (const entry of entries) if (["assembled", "running"].includes(entry.status))
      await inHost(() => endHostExecution({ execution_id: entry.id, outcome: "cancelled", work_termination: "unconfirmed" })).catch(() => undefined); }
  finally { client.dispose(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    await releaseGraphWriter(join(root, "data")); setDataDirOverride(old); host = undefined as any; await rm(root, { recursive: true, force: true }); }
});

it("selection alone stays read-only, while explicit execution injects the post-admission canonical running projection", async () => {
  const selected = await client.begin({ id: "selected-only", adapter: "sdk/native", query: "Read plan", plan_id: intent.scope.id, slice_id: intent.slice_id! });
  expect(selected.execution.plan_execution).toBeUndefined(); expect((await view())!.state.running_slice_ids).toEqual([]);
  await client.finish("selected-only", "completed", "confirmed");
  const run = await client.begin(request("native-work"));
  expect(run.execution.plan_execution).toMatchObject({ intent, state: { running_slice_ids: ["work"], current_slice_ids: ["work"] } });
  expect(run.execution.block).toContain('"running_slice_ids":["work"]');
  const saved = await inHost(() => readManagedContext("native-work"));
  expect(saved.plan_source?.physical_path).toBe(await (await import("node:fs/promises")).realpath(join(root, "plans/fixture.md")));
  expect(run.execution.block).not.toContain("physical_path"); expect(run.execution.block).not.toContain("plan-close-intent");
  await client.deliver(run.workerBearer, run.execution.pack.receipt.id, run.execution.block);
  await inHost(() => assertManagedContext("native-work"));
  const closed = await client.finish("native-work", "completed", "confirmed");
  expect(closed).toMatchObject({ status: "no_change", authority_active: false, plan_execution: { state: { running_slice_ids: [], current_slice_ids: ["work"] } } });
  expect((await view())!.state.slices[0]).toMatchObject({ status: "in_progress", implementation_receipt_ids: [], verification: null, last_attempt: { outcome: "completed" } });
  expect((await view())!.progress.verified).toBe(0);
});

it("refuses foreign project, selection mismatch, changed source semantics and stale approval before returning native authority", async () => {
  const before = (await view())!.state.event_sequence;
  await expect(client.begin(request("foreign", { plan_execution: { ...intent, scope: { ...intent.scope, project_id: "other-project" } } }))).rejects.toThrow("PROJECT_SCOPE_REJECTED");
  await expect(client.begin(request("mismatch", { plan_id: "another-selection" }))).rejects.toThrow("TASK_SCOPE_REQUIRED");
  await expect(client.begin(request("old-approval", { plan_execution: { ...intent, approval_id: "old" } }))).rejects.toThrow("APPROVAL_OWNER_REJECTED");
  await writeFile(join(root, "plans/fixture.md"), markdown + "\n### Slice 1 - New work\n\n- id: added\n");
  await expect(client.begin(request("source-change"))).rejects.toThrow("DEFINITION_RECONCILIATION_REQUIRED");
  expect((await view())!.state.event_sequence).toBe(before); expect((await view())!.state.leases).toEqual([]);
});

it("external plan edits block delivery and worker/model dispatch; source restoration cannot renew a closed pass", async () => {
  const run = await client.begin(request("source-fenced"));
  await writeFile(join(root, "plans/fixture.md"), markdown + "\nExternal change\n");
  await expect(client.deliver(run.workerBearer, run.execution.pack.receipt.id, run.execution.block)).rejects.toThrow("SOURCE_CHANGED");
  let calls = 0;
  await expect(inHost(() => withHostExecution("source-fenced", async () => { calls++; }))).rejects.toThrow("SOURCE_CHANGED");
  await expect(client.admitModel(modelRequest("source-fenced", run.execution.block))).rejects.toThrow(/NOT_DELIVERED|SOURCE_CHANGED/);
  expect(calls).toBe(0);
  await client.finish("source-fenced", "failed", "confirmed");
  await writeFile(join(root, "plans/fixture.md"), markdown);
  await expect(client.begin(request("source-fenced"))).rejects.toThrow(/REVISION_CONFLICT|ID_ALREADY_USED/);
  expect((await view())!.state.leases).toEqual([]);
});

function offlineModelAllocation() {
  for (const [suffix, value] of Object.entries({ RUN_BUDGET: "10", DAY_BUDGET: "10", PRICING_VERSION: "plan-host.offline.v1", BUDGET_CURRENCY: "USD",
    BILLING_PRINCIPAL: "offline:plan-host", CONTEXT_TOKENS: "65536", MAX_CALLS: "4", MAX_RETRIES: "0" })) vi.stubEnv("DREAMGRAPH_LLM_ARCHITECT_" + suffix, value);
  vi.stubEnv("DREAMGRAPH_LLM_PRICING", JSON.stringify([{ provider: "openai", model: "gpt-4.1", currency: "USD", version: "plan-host.offline.v1",
    source: "Synthetic plan-host fixture; no provider request or price", input_per_million: 1, output_per_million: 1, input_includes_images: true, output_includes_reasoning: true }]));
}
function modelRequest(execution_id: string, block: string): ManagedModelAdmissionRequest {
  return { execution_id, request_id: execution_id + ":native-model", binding: { provider: "openai", model: "gpt-4.1", adapter: "native_api", api: "chat_completions",
    base_url: "https://offline.invalid/v1", output_tokens: 100 }, output_tokens: 100,
    payload: JSON.stringify({ model: "gpt-4.1", max_tokens: 100, messages: [{ role: "user", content: block }] }) };
}
it("a real pending native model permit cannot be reported as confirmed plan termination", async () => {
  offlineModelAllocation(); const run = await client.begin(request("model-pending"));
  await client.deliver(run.workerBearer, run.execution.pack.receipt.id, run.execution.block);
  const permit = await client.admitModel(modelRequest("model-pending", run.execution.block)); expect(permit.attests).toBe("possible_dispatch_liability_only");
  const closed = await client.finish("model-pending", "completed", "confirmed");
  expect(closed).toMatchObject({ status: "recovery_required", plan_execution: { state: { leases: [{ state: "recovery_required" }] } } });
  expect((await inHost(() => readManagedContext("model-pending"))).plan_closure).toMatchObject({ requested_termination: "confirmed", effective_termination: "unconfirmed" });
  const sequence = (await view())!.state.event_sequence;
  await client.finish("model-pending", "completed", "confirmed"); expect((await view())!.state.event_sequence).toBe(sequence);
});

it("the SDK native model callback uses the delivered running plan and original spend permit but cannot mark the slice implemented", async () => {
  offlineModelAllocation(); const pass = new ManagedGraphPass(client, request("native-model-callback")); let payload = "", invocations = 0;
  try {
    await pass.begin(); await pass.prepare(async context => { payload = context.block; return { receiptId: context.pack.receipt.id, block: context.block }; });
    const model = modelRequest(pass.executionId, payload), { execution_id: _, ...input } = model;
    const answer = await pass.runModel(input, async worker => {
      invocations++; expect(worker.request.payload).toContain('running_slice_ids');
      expect((await view())!.state.running_slice_ids).toEqual(["work"]);
      const ledger = JSON.parse(await readFile(join(root, "data/spend_ledger.json"), "utf8")); expect(ledger.attempts[worker.permit.attempt_id]).toBeDefined();
      return { result: "Declared offline native reply", workTermination: "confirmed", acknowledged: true, usage: { inputTokens: 100, outputTokens: 10 } };
    });
    expect(answer).toBe("Declared offline native reply"); expect(invocations).toBe(1);
    const closed = await pass.finish("completed"); expect(closed.plan_execution?.state.running_slice_ids).toEqual([]);
    expect((await view())!.state.slices[0]).toMatchObject({ status: "in_progress", implementation_receipt_ids: [], verification: null });
  } finally { await pass.finish("cancelled").catch(() => undefined); }
});

it("unconfirmed termination remains recovery on exact retry and cannot be strengthened through another public finish", async () => {
  const run = await client.begin(request("uncertain")); await client.deliver(run.workerBearer, run.execution.pack.receipt.id, run.execution.block);
  const closed = await client.finish("uncertain", "cancelled", "unconfirmed");
  expect(closed).toMatchObject({ status: "recovery_required", authority_active: false, plan_execution: { state: { running_slice_ids: [], leases: [{ state: "recovery_required" }] } } });
  const sequence = (await view())!.state.event_sequence;
  await client.finish("uncertain", "cancelled", "unconfirmed"); expect((await view())!.state.event_sequence).toBe(sequence);
  await expect(client.finish("uncertain", "cancelled", "confirmed")).rejects.toThrow("CLOSURE_DISPOSITION_CHANGED");
  expect((await inHost(() => readManagedContext("uncertain"))).plan_closure?.effective_termination).toBe("unconfirmed");
});

it("independent original-native stop observations release only stopped ownership, preserve first closure, and require every outstanding model attempt", async () => {
  offlineModelAllocation();vi.stubEnv("DREAMGRAPH_LLM_ARCHITECT_CONCURRENCY","2");const run=await client.begin(request("independent-stop"));
  await client.deliver(run.workerBearer,run.execution.pack.receipt.id,run.execution.block);
  const first=modelRequest("independent-stop",run.execution.block),second={...first,request_id:"another-native-call"};
  const a=await client.admitModel(first),b=await client.admitModel(second);
  await client.finish("independent-stop","cancelled","unconfirmed");
  const original=structuredClone((await inHost(()=>readManagedContext("independent-stop"))).plan_closure);
  const observation=(permit:typeof a)=>({execution_id:permit.execution_id,request_id:permit.request_id,attempt_id:permit.attempt_id,
    usage:{inputTokens:100,outputTokens:10},acknowledged:true,work_termination:"confirmed" as const});
  const partial=await client.observeModelStop(observation(a));expect(partial.status).toBe("recovery_required");
  expect((await view())!.state.leases).toHaveLength(1);
  const complete=await client.observeModelStop(observation(b));
  expect(complete).toMatchObject({status:"no_change",authority_active:false,plan_execution:{state:{leases:[],current_slice_ids:["work"]}}});
  const saved=await inHost(()=>readManagedContext("independent-stop"));expect(saved.plan_closure).toEqual(original);
  expect(saved.native_stop_observations).toHaveLength(2);expect(saved.effects[0].outcome).toBe("unknown");
  expect((await view())!.state.slices[0]).toMatchObject({status:"in_progress",verification:null,implementation_receipt_ids:[]});
  const sequence=(await view())!.state.event_sequence;
  await client.observeModelStop(observation(b));await client.finish("independent-stop","cancelled","unconfirmed");
  expect((await view())!.state.event_sequence).toBe(sequence);
  await expect(client.finish("independent-stop","cancelled","confirmed")).rejects.toThrow("CLOSURE_DISPOSITION_CHANGED");
  await expect(client.observeModelStop({...observation(b),usage:{inputTokens:100,outputTokens:20}})).rejects.toThrow("OBSERVATION_CHANGED");
  await expect(inHost(()=>withHostExecution("independent-stop",async()=>undefined))).rejects.toThrow("AUTHORITY_UNAVAILABLE");
});

it("native stop recovery refuses live authority, unconfirmed and forged attempts, foreign hosts and workers", async () => {
  offlineModelAllocation();const run=await client.begin(request("stop-identity"));
  await client.deliver(run.workerBearer,run.execution.pack.receipt.id,run.execution.block);
  const permit=await client.admitModel(modelRequest("stop-identity",run.execution.block));
  const observation={execution_id:permit.execution_id,request_id:permit.request_id,attempt_id:permit.attempt_id,usage:null,acknowledged:true,work_termination:"confirmed" as const};
  await expect(client.observeModelStop(observation)).rejects.toThrow("REQUIRES_CLOSED_AUTHORITY");
  await inHost(() => recordManagedEffect("stop-identity", { tool: "edit_file", outcome: "unknown", receipt_ids: [] }));
  await client.finish("stop-identity","cancelled","unconfirmed");
  await expect(client.observeModelStop({...observation,work_termination:"unconfirmed"})).rejects.toThrow("INDEPENDENT_NATIVE_STOP_OBSERVATION_REQUIRED");
  await expect(client.observeModelStop({...observation,attempt_id:"another-pass-attempt"})).rejects.toThrow("ORIGINAL_ATTEMPT_REQUIRED");
  const foreign=new ManagedExecutionClient({baseUrl:url});try{await expect(foreign.observeModelStop(observation)).rejects.toThrow();}finally{foreign.dispose();}
  const worker=await fetch(url+"/api/executions/v1/model/observe-stop",{method:"POST",headers:{"Content-Type":"application/json","X-DreamGraph-Session":run.workerBearer},body:JSON.stringify(observation)});
  expect(worker.ok).toBe(false);expect((await view())!.state.leases).toHaveLength(1);
  const recovered = await client.observeModelStop(observation); // A stopped model cannot clear unrelated source uncertainty.
  expect(recovered.status).toBe("recovery_required"); expect((await view())!.state.leases).toHaveLength(0);
  const ledger=JSON.parse(await readFile(join(root,"data/spend_ledger.json"),"utf8"));
  expect(ledger.attempts[permit.attempt_id]).toMatchObject({state:"uncertain",acknowledged:true,usage:null});
});

it("a committed independent stop with a lost reply replays its saved command without changing the first outcome or issuing more work", async () => {
  offlineModelAllocation();const run=await client.begin(request("stop-lost-reply"));
  await client.deliver(run.workerBearer,run.execution.pack.receipt.id,run.execution.block);
  const permit=await client.admitModel(modelRequest("stop-lost-reply",run.execution.block));
  await client.finish("stop-lost-reply","cancelled","unconfirmed");
  const observation={execution_id:permit.execution_id,request_id:permit.request_id,attempt_id:permit.attempt_id,
    usage:{inputTokens:100,outputTokens:10},acknowledged:true,work_termination:"confirmed" as const};
  const apply=runtime.applyPlanRuntimeClosure;
  const lost=vi.spyOn(runtime,"applyPlanRuntimeClosure").mockImplementationOnce(async command=>{await apply(command);throw new Error("independent stop committed reply lost");});
  await expect(client.observeModelStop(observation)).rejects.toThrow("committed reply lost");lost.mockRestore();
  const sequence=(await view())!.state.event_sequence;
  expect((await inHost(()=>readManagedContext("stop-lost-reply"))).plan_stop_recovery).toBeDefined();
  expect((await client.observeModelStop(observation)).status).toBe("no_change");expect((await view())!.state.event_sequence).toBe(sequence);
});

it("the original SDK native worker can report a separately observed stop after its cancelled wait without renewing the pass", async () => {
  offlineModelAllocation();const stop=new AbortController(),pass=new ManagedGraphPass(client,request("sdk-observed-stop"),{signal:stop.signal});
  await pass.begin();let block="";await pass.prepare(async context=>{block=context.block;return{receiptId:context.pack.receipt.id,block};});
  const {execution_id:_,...input}=modelRequest(pass.executionId,block);
  let release!: (value:any)=>void,entered!:()=>void;
  const ready=new Promise<void>(resolve=>{entered=resolve;});
  const originalWork=new Promise<any>(resolve=>{release=resolve;});let terminated=false;
  const waiting=pass.runModel(input,async()=>{entered();const answer=await originalWork;terminated=true;return answer;});
  const failed=expect(waiting).rejects.toThrow("never redispatch");await ready;stop.abort(new Error("operator cancelled"));await failed;
  expect(terminated).toBe(false);expect((await pass.finish("cancelled")).status).toBe("recovery_required");
  release({result:"Original offline worker stopped",usage:{inputTokens:100,outputTokens:10},acknowledged:true,workTermination:"confirmed"});
  const observed=await originalWork;const recovered=await pass.observeModelStop(observed);
  expect(recovered).toMatchObject({status:"no_change",authority_active:false});expect((await view())!.state.leases).toEqual([]);
  await expect(pass.prepare(async()=>({receiptId:"new",block:"new"}))).rejects.toThrow();
  expect((await inHost(()=>readManagedContext(pass.executionId))).plan_closure?.effective_termination).toBe("unconfirmed");
});
it("native stop recovery also closes the original context-only SDK pass without manufacturing plan ownership", async () => {
  offlineModelAllocation();
  const contextRequest = { ...request("context-only-stop") }; delete contextRequest.plan_execution;
  const run = await client.begin(contextRequest); await client.deliver(run.workerBearer, run.execution.pack.receipt.id, run.execution.block);
  const permit = await client.admitModel(modelRequest("context-only-stop", run.execution.block));
  const first = { execution_id: permit.execution_id, request_id: permit.request_id, attempt_id: permit.attempt_id, usage: null, acknowledged: false, work_termination: "unconfirmed" as const };
  await client.settleModel(first); expect((await client.finish("context-only-stop", "cancelled", "unconfirmed")).status).toBe("recovery_required");
  const stopped = { ...first, acknowledged: true, work_termination: "confirmed" as const };
  const recovered = await client.observeModelStop(stopped); expect(recovered).toMatchObject({ status: "no_change", authority_active: false }); expect(recovered.plan_execution).toBeUndefined();
  const entry = await inHost(() => readManagedContext("context-only-stop"));
  expect(entry.plan_closure).toBeUndefined(); expect(entry.plan_stop_recovery).toBeUndefined(); expect(entry.native_stop_recovery?.attempt_ids).toEqual([permit.attempt_id]);
  expect(entry.effects).toContainEqual(expect.objectContaining({ tool: "host_adapter_termination", outcome: "unknown" }));
  const sequence = (await view())!.state.event_sequence; await client.observeModelStop(stopped); expect((await view())!.state.event_sequence).toBe(sequence);
  await expect(client.admitModel({ ...modelRequest("context-only-stop", run.execution.block), request_id: "new-work" })).rejects.toThrow("AUTHORITY_UNAVAILABLE");
});
it("the actual compiled editor model session retains the original stop identity after its first immutable settlement", async () => {
  offlineModelAllocation(); const { DaemonClient: EditorClient, ManagedModelSession } = compiledEditor();
  const port = new EditorClient({ host: "127.0.0.1", port: Number(new URL(url).port) });
  try {
    const run = await port.beginExecution(request("editor-observed-stop")); await port.deliverExecution(run.workerBearer, run.execution.pack.receipt.id, run.execution.block);
    const models = new ManagedModelSession(port, "editor-observed-stop", port.baseUrl);
    const model = modelRequest("editor-observed-stop", run.execution.block), ticket = await models.admit(model.binding, model.payload, model.output_tokens);
    await models.settle(ticket, undefined, "unconfirmed", false); await port.finishExecution("editor-observed-stop", "cancelled", "unconfirmed");
    const first = (await port.readModel("editor-observed-stop", ticket.permit.request_id)).settlement;
    await expect(models.observeStop({ ...ticket }, { acknowledged: true, workTermination: "confirmed" })).rejects.toThrow("ORIGINAL_TICKET_REQUIRED");
    await expect(models.observeStop(ticket, { acknowledged: false, workTermination: "confirmed" })).rejects.toThrow("INDEPENDENT_NATIVE_STOP");
    expect(await models.observeStop(ticket, { acknowledged: true, workTermination: "confirmed" })).toMatchObject({ status: "no_change", authority_active: false });
    expect((await port.readModel("editor-observed-stop", ticket.permit.request_id)).settlement).toEqual(first); expect((await view())!.state.leases).toHaveLength(0);
    await expect(models.admit(model.binding, model.payload, model.output_tokens)).rejects.toThrow("RECOVERY_REQUIRED");
  } finally { port.dispose(); }
});

it("rejected admission can close only a durably undelivered context with no lease or effects", async () => {
  const sequence = (await view())!.state.event_sequence;
  await expect(client.begin(request("refused-before-dispatch", { plan_execution: { ...intent, kind: "verification" } }))).rejects.toThrow("PLAN_EXECUTION_STAGE_INVALID");
  const saved = await inHost(() => readManagedContext("refused-before-dispatch"));
  expect(saved).toMatchObject({ status: "assembled", effects: [], pack: { receipt: { delivery: "unattested" } } });
  const closed = await client.finish("refused-before-dispatch", "failed", "unconfirmed");
  expect(closed).toMatchObject({ status: "no_change", authority_active: false });
  expect((await inHost(() => readManagedContext("refused-before-dispatch"))).plan_closure).toMatchObject({
    requested_termination: "unconfirmed", effective_termination: "confirmed", command: null });
  await client.finish("refused-before-dispatch", "failed", "unconfirmed");
  await expect(client.finish("refused-before-dispatch", "completed", "confirmed")).rejects.toThrow("CLOSURE_DISPOSITION_CHANGED");
  expect((await view())!.state.event_sequence).toBe(sequence); expect((await view())!.state.leases).toEqual([]);
});

it("lost C14 closure acknowledgment replays the persisted original command after host revocation without another event", async () => {
  const run = await client.begin(request("lost-close")); await client.deliver(run.workerBearer, run.execution.pack.receipt.id, run.execution.block);
  const original = runtime.applyPlanRuntimeClosure;
  const lose = vi.spyOn(runtime, "applyPlanRuntimeClosure").mockImplementationOnce(async input => { await original(input); throw new Error("committed close reply lost"); });
  await expect(client.finish("lost-close", "completed", "confirmed")).rejects.toThrow("committed close reply lost"); lose.mockRestore();
  const saved = await inHost(() => readManagedContext("lost-close")), sequence = (await view())!.state.event_sequence;
  expect(saved.plan_closure).toMatchObject({ effective_termination: "confirmed", command: { command: { stop_acknowledged: true } } });
  expect((await client.read("lost-close")).authority_active).toBe(false);
  const recovered = await client.finish("lost-close", "completed", "confirmed"); expect(recovered.status).toBe("no_change");
  expect((await view())!.state.event_sequence).toBe(sequence);
  expect((await inHost(() => readManagedContext("lost-close"))).plan_closure).toEqual(saved.plan_closure);
});

it("finite authority expiry leaves canonical recovery and a later claimed confirmed stop cannot erase missing live observation", async () => {
  // Allow bounded admission to finish, then await the actual immutable lease
  // expiry. A short pre-admission wall-clock guess can expire before handoff.
  const run=await client.begin(request("expired", { timeout_ms: 5000 }));
  const expiry=run.execution.plan_execution!.state.leases.find(lease=>lease.execution_id==='expired')!.expires_at;
  expect(Date.parse(expiry)).toBeGreaterThan(Date.now());
  await new Promise(resolve => setTimeout(resolve, Math.max(1,Date.parse(expiry)-Date.now()+100)));
  const expired = await client.read("expired"); expect(expired).toMatchObject({ authority_active: false, plan_execution: { state: { running_slice_ids: [], leases: [{ state: "recovery_required" }] } } });
  const closed = await client.finish("expired", "completed", "confirmed");
  expect(closed.status).toBe("recovery_required"); expect((await view())!.state.leases[0].state).toBe("recovery_required");
});

it("a fresh compiled daemon process recovers the saved closure without live launch authority or another C14 event", async () => {
  const run = await client.begin(request("restart-close")); await client.deliver(run.workerBearer, run.execution.pack.receipt.id, run.execution.block);
  const original = runtime.applyPlanRuntimeClosure;
  const lose = vi.spyOn(runtime, "applyPlanRuntimeClosure").mockImplementationOnce(async input => { await original(input); throw new Error("committed reply lost before host context closure"); });
  await expect(client.finish("restart-close", "completed", "confirmed")).rejects.toThrow("committed reply lost"); lose.mockRestore();
  const sequence = (await view())!.state.event_sequence;
  await releaseGraphWriter(join(root, "data"));
  const frame = Buffer.from(JSON.stringify({ ...host, environment: {} })).toString("base64");
  const moduleUrl = (file: string) => JSON.stringify(pathToFileURL(join(process.cwd(), "dist", file)).href);
  const script = `import {withSessionContext} from ${moduleUrl("server/session-context.js")};
    import {setDataDirOverride} from ${moduleUrl("utils/paths.js")};
    import {readHostExecution,endHostExecution,withHostExecution} from ${moduleUrl("server/managed-execution.js")};
    import {releaseGraphWriter} from ${moduleUrl("graph/writer-lease.js")};
    const host=JSON.parse(Buffer.from(process.argv[1],'base64').toString('utf8'));setDataDirOverride(host.directory);
    await withSessionContext(host,async()=>{
      const before=await readHostExecution('restart-close');let nativeCalls=0,refusal;
      try{await withHostExecution('restart-close',async()=>{nativeCalls++;});}catch(error){refusal=String(error);}
      const recovered=await endHostExecution({execution_id:'restart-close',outcome:'completed',work_termination:'confirmed'});
      console.log(JSON.stringify({beforeActive:before.authority_active,afterActive:recovered.execution.authority_active,status:recovered.execution.status,
        nativeCalls,refusal,sequence:recovered.execution.plan_execution.state.event_sequence}));
    });await releaseGraphWriter(host.directory);`;
  const result = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", script, frame], { timeout: 15000, maxBuffer: 1024 * 1024 });
  expect(JSON.parse(result.stdout.trim())).toEqual({ beforeActive: false, afterActive: false, status: "no_change", nativeCalls: 0,
    refusal: "Error: HOST_EXECUTION_AUTHORITY_UNAVAILABLE", sequence });
  expect((await view())!.state.event_sequence).toBe(sequence);
});

it("actual compiled editor and SDK native passes preserve explicit purpose and close canonical ownership without claiming verification", async () => {
  const fixture = compiledEditor(), editor = new fixture.DaemonClient({ host: "127.0.0.1", port: Number(new URL(url).port), timeoutMs: 10000 });
  let pass: any;
  try {
    pass = await fixture.ManagedNativePass.begin(editor, request("compiled-editor-plan"));
    const prepared = await pass.prepare([{ role: "user", content: "Inspect reviewed work" }], [], [], pass.signal);
    expect(prepared.messages.at(-1).content).toContain('"running_slice_ids":["work"]');
    expect((await editor.readExecution(pass.executionId)).plan_execution.intent).toEqual(intent);
    expect((await pass.finish("completed")).plan_execution.state.running_slice_ids).toEqual([]);
  } finally { await pass?.finish("cancelled").catch(() => undefined); editor.dispose(); }
  const current = (await view())!; intent = { ...intent, expected_revision: current.state.revision };
  const sdk = new ManagedGraphPass(client, request("sdk-plan"));
  try {
    await sdk.begin(); await sdk.prepare(async context => ({ receiptId: context.pack.receipt.id, block: context.block }));
    expect((await client.read("sdk-plan")).plan_execution?.state.running_slice_ids).toEqual(["work"]);
    expect((await sdk.finish("completed")).plan_execution?.state.running_slice_ids).toEqual([]);
  } finally { await sdk.finish("cancelled").catch(() => undefined); }
  expect((await view())!.progress.verified).toBe(0);
});

it("foreign hosts and execution workers cannot request C14 closure or another implementation lease", async () => {
  const run = await client.begin(request("owned")), foreign = new ManagedExecutionClient({ baseUrl: url });
  try { await expect(foreign.finish("owned", "completed", "confirmed")).rejects.toThrow("OWNER_MISMATCH"); }
  finally { foreign.dispose(); }
  const response = await fetch(url + "/api/executions/v1/finish", { method: "POST", headers: { "Content-Type": "application/json", "X-DreamGraph-Session": run.workerBearer },
    body: JSON.stringify({ execution_id: "owned", outcome: "completed", work_termination: "confirmed" }) });
  expect(response.status).toBe(403); expect((await view())!.state.leases).toHaveLength(1);
  await client.finish("owned", "completed", "confirmed");
});

it("browser chat refuses forged purpose, unrelated selection, fallback and continuation before a native task can start", async () => {
  const before = (await view())!.state.event_sequence;
  for (const extra of [{ plan_execution: { ...intent, actor: { kind: "runtime" } } }, { plan_id: "unrelated" },
    { adapter: "deterministic_fallback" }, { continuation_token: "another-pass" }]) {
    const response = await fetch(url + "/api/architect/v1/chat", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Perform reviewed work", scope: "plan", plan_id: "fixture", adapter: "native_api_tool_loop", plan_execution: intent, ...extra }) });
    expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ error: "plan_execution_invalid" });
  }
  expect((await view())!.state.event_sequence).toBe(before); expect((await view())!.state.leases).toEqual([]);
});
