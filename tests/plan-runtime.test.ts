/** Physical C14 publication/transport-owner bridge; no provider or native GUI claims. */
import { beforeEach, afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDataDir, setDataDirOverride } from "../src/utils/paths.js";
import { releaseGraphWriter } from "../src/graph/writer-lease.js";
import { importPlanAuthority, applyPlanCommand, readPlanAuthority, bytesHash } from "../src/discipline/plan-authority.js";
import { planDefinitionDigest } from "../src/discipline/plan-workflow.js";
import { PlanRuntimeLease, inspectPlanRuntime, PlanRuntimeAdmissionError } from "../src/discipline/plan-runtime.js";
import { withSessionContext, type SessionContext } from "../src/server/session-context.js";
import { loadPublicationState } from "../src/graph/publication.js";
import { issueExecutionPolicy } from "../src/server/execution-policy.js";
import type { PlanDefinition } from "../src/graph/contracts.js";
let directory: string, previous: string, host: SessionContext;
const scope = { instance_id: "instance", project_id: "project", id: "plan" };
const actor = { id: "operator", instance_id: scope.instance_id, project_id: scope.project_id, kind: "operator" as const };
const markdown = "# Native plan\n\n### Slice 0 - Work\n";
const view = () => readPlanAuthority(scope);
beforeEach(async () => {
  previous = getDataDir(); directory = await mkdtemp(join(tmpdir(), "dg-plan-runtime-")); setDataDirOverride(directory);
  host = { principal: actor.id, session_id: "original-host", directory, channel: "browser", environment: {}, continuation_key: "fixture" };
  await writeFile(join(directory, "source.md"), markdown);
  const definition: PlanDefinition = { ...scope, revision: 1, definition_hash: "pending", source_hash: bytesHash(markdown), log_hash: null,
    title: "Native plan", phase: null, slices: [{ id: "work", title: "Work", order: 0, priority: 1, required: true, depends_on: [], acceptance_hash: "acceptance" }] };
  definition.definition_hash = planDefinitionDigest(definition);
  await importPlanAuthority({ actor, definition, markdown, log_markdown: null, review_id: "import", operation_id: "import" });
  for (const command of [{ type: "review_plan", review_id: "review" }, { type: "approve_scope", approval_id: "approval", owner: actor.id, scope: ["work"], parallel_limit: 1 }, { type: "start_slice", slice_id: "work" }]) {
    const current = (await view())!;
    await applyPlanCommand({ actor, plan_id: scope.id, operation_id: command.type, expected_revision: current.state.revision, expected_definition_hash: current.state.definition_hash, command });
  }
});
afterEach(async () => { await releaseGraphWriter(directory); setDataDirOverride(previous); await rm(directory, { recursive: true, force: true }); });
async function request() {
  const current = (await view())!;
  return { scope: { ...scope }, execution_id: "original-native-work", slice_id: "work", kind: "implementation" as const,
    expected_revision: current.state.revision, expected_definition_hash: current.state.definition_hash, approval_id: "approval", timeout_ms: 300000 };
}
async function checkSources() { if (await readFile(join(directory, "source.md"), "utf8") !== markdown) throw new Error("SOURCE_CHANGED"); }
const inHost = <T>(work: () => Promise<T>) => withSessionContext(host, work);
const completed = { outcome: "completed" as const, reason: "Native owner acknowledged its work ended", work_termination: "confirmed" as const };

it("native termination closes only the execution lease, leaving current implementation and verification evidence unchanged", async () => {
  const input = await request(), port = await inHost(() => PlanRuntimeLease.admit(input, { check_sources: checkSources }));
  input.scope.id = "changed-selection"; input.execution_id = "another-execution";
  expect((await view())!.state.running_slice_ids).toEqual(["work"]);
  expect((await inHost(() => port.inspect())).lease).toMatchObject({ execution_id: "original-native-work", owner: actor.id });
  await inHost(() => port.finish(completed));
  const current = (await view())!;
  expect(current.state.running_slice_ids).toEqual([]); expect(current.state.current_slice_ids).toEqual(["work"]);
  expect(current.state.slices[0]).toMatchObject({ status: "in_progress", implementation_receipt_ids: [], verification: null,
    last_attempt: { execution_id: "original-native-work", outcome: "completed" } });
  expect(current.progress.verified).toBe(0);
});

it("a cancelled wait cannot release running ownership or upgrade an uncertain stop on retry", async () => {
  const port = await inHost(async () => PlanRuntimeLease.admit(await request(), { check_sources: checkSources }));
  await inHost(() => port.finish({ outcome: "cancelled", reason: "Wait aborted; native work not acknowledged", work_termination: "unconfirmed" }));
  expect((await view())!).toMatchObject({ execution: "recovery_required", state: { current_slice_ids: ["work"], running_slice_ids: [] } });
  expect((await inHost(() => inspectPlanRuntime(scope, port.executionId))).lease).toMatchObject({ id: port.leaseId, state: "recovery_required" });
  await expect(inHost(() => port.finish({ outcome: "cancelled", reason: "Wait aborted; native work not acknowledged", work_termination: "confirmed" }))).rejects.toThrow("CLOSURE_DISPOSITION_CHANGED");
  await expect(inHost(async () => PlanRuntimeLease.admit(await request(), { check_sources: checkSources }))).rejects.toThrow("EXECUTION_REQUIRES_RECOVERY");
});

it("a source-fence failure cannot publish running ownership and stale approvals/owners cannot admit work", async () => {
  const input = await request(), before = await loadPublicationState();
  await writeFile(join(directory, "source.md"), "Outside edit");
  await expect(inHost(() => PlanRuntimeLease.admit(input, { check_sources: checkSources }))).rejects.toBeInstanceOf(PlanRuntimeAdmissionError);
  expect((await view())!.state.leases).toEqual([]); expect((await loadPublicationState()).revision).toEqual(before.revision);
  await expect(inHost(() => PlanRuntimeLease.admit({ ...input, approval_id: "old-approval" }, { check_sources: checkSources }))).rejects.toThrow("APPROVAL_OWNER_REJECTED");
  await expect(withSessionContext({ ...host, principal: "foreign" }, () => PlanRuntimeLease.admit(input, { check_sources: checkSources }))).rejects.toThrow("APPROVAL_OWNER_REJECTED");
});

it("workers and changed host/session/physical-directory cannot acquire or close the original plan lease", async () => {
  const input = await request(), worker = issueExecutionPolicy(host, { id: "worker", autonomy: "manual", verbosity: "balanced", timeout_ms: 10000, signal: new AbortController().signal });
  try { await expect(withSessionContext({ ...host, execution_policy: worker.policy }, () => PlanRuntimeLease.admit(input, { check_sources: checkSources }))).rejects.toThrow("HOST_CONTROL_REQUIRED"); }
  finally { worker.close(); }
  const port = await inHost(() => PlanRuntimeLease.admit(input, { check_sources: checkSources }));
  for (const changed of [{ ...host, session_id: "other" }, { ...host, principal: "foreign" }, { ...host, directory: join(directory, "other") }])
    await expect(withSessionContext(changed, () => port.finish(completed))).rejects.toThrow("ORIGINAL_HOST_REQUIRED");
  expect((await view())!.state.leases).toHaveLength(1);
});

it("lost admission acknowledgement retains the original durable lease and inspection never admits a replacement", async () => {
  const input = await request();
  await expect(inHost(() => PlanRuntimeLease.admit(input, { check_sources: checkSources, fault_inject: step => { if (step === "before_journal_remove") throw new Error("reply lost"); } }))).rejects.toThrow("ADMISSION_UNCONFIRMED");
  const before = await readFile(join(directory, "plan_state.json"), "utf8");
  const recovered = await inHost(() => inspectPlanRuntime(scope, input.execution_id));
  expect(recovered.lease).toMatchObject({ execution_id: input.execution_id, state: "running" });
  expect(await readFile(join(directory, "plan_state.json"), "utf8")).toBe(before);
  await expect(inHost(async () => PlanRuntimeLease.admit(await request(), { check_sources: checkSources }))).rejects.toThrow("EXECUTION_REQUIRES_RECOVERY");
});

it("lost close acknowledgement retries exactly once with the original disposition and journal receipt", async () => {
  let failClose = false;
  const port = await inHost(async () => PlanRuntimeLease.admit(await request(), { check_sources: checkSources,
    fault_inject: step => { if (failClose && step === "before_journal_remove") { failClose = false; throw new Error("close reply lost"); } } }));
  failClose = true; await expect(inHost(() => port.finish(completed))).rejects.toThrow("close reply lost");
  const current = (await view())!, sequence = current.state.event_sequence;
  expect(current.state.leases).toEqual([]);
  await expect(inHost(() => port.finish({ ...completed, outcome: "failed" }))).rejects.toThrow("CLOSURE_DISPOSITION_CHANGED");
  const recovered = await inHost(() => port.finish(completed)); expect(recovered.replayed).toBe(true);
  expect((await view())!.state.event_sequence).toBe(sequence);
});

it("concurrent same closure calls share one publication; a competing disposition cannot overwrite recovery intent", async () => {
  const port = await inHost(async () => PlanRuntimeLease.admit(await request(), { check_sources: checkSources }));
  const before = (await view())!.state.event_sequence;
  const results = await inHost(() => Promise.allSettled([port.finish(completed), port.finish(completed), port.finish({ ...completed, outcome: "failed" })]));
  expect(results.map(result => result.status)).toEqual(["fulfilled", "fulfilled", "rejected"]);
  expect((await view())!.state.event_sequence).toBe(before + 1);
  expect((await view())!.state.slices[0].last_attempt).toMatchObject({ outcome: "completed" });
});

it("already cancelled admission does not read sources or publish a running plan lease", async () => {
  const controller = new AbortController(); controller.abort(new Error("operator_stop"));
  const before = await loadPublicationState(); let reads = 0;
  await expect(inHost(async () => PlanRuntimeLease.admit(await request(), { signal: controller.signal, check_sources: async () => { reads++; } }))).rejects.toThrow("operator_stop");
  expect(reads).toBe(0); expect((await loadPublicationState()).revision).toEqual(before.revision); expect((await view())!.state.leases).toEqual([]);
});

it("source checking retains the original callback and cancellation signal despite caller-option mutation", async () => {
  const controller = new AbortController(), input = await request(); let entered!: () => void, release!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; }), delayed = new Promise<void>(resolve => { release = resolve; });
  let originalReads = 0, replacementReads = 0;
  const options = { signal: controller.signal, check_sources: async () => { originalReads++; entered(); await delayed; await checkSources(); } };
  const pending = inHost(() => PlanRuntimeLease.admit(input, options));
  await ready; options.check_sources = async () => { replacementReads++; }; options.signal = new AbortController().signal;
  controller.abort(new Error("original_stop")); release();
  await expect(pending).rejects.toBeInstanceOf(PlanRuntimeAdmissionError);
  expect(originalReads).toBe(1); expect(replacementReads).toBe(0); expect((await view())!.state.leases).toEqual([]);
});

it("a noncooperative source checker receives cancellation, remains running, and cannot admit work after its wait rejects", async () => {
  const controller = new AbortController(); let release!: () => void, running = false, observed: AbortSignal | undefined;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  const pending = inHost(async () => PlanRuntimeLease.admit(await request(), { signal: controller.signal, check_sources: async signal => {
    observed = signal; running = true; controller.abort(new Error("operator_stop")); await delayed; running = false;
  } }));
  await expect(pending).rejects.toBeInstanceOf(PlanRuntimeAdmissionError);
  expect(observed?.aborted).toBe(true); expect(running).toBe(true); expect((await view())!.state.leases).toEqual([]);
  release(); await Promise.resolve(); await Promise.resolve();
  expect(running).toBe(false); expect((await view())!.state.leases).toEqual([]);
});
