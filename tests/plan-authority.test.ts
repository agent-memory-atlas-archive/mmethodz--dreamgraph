import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDataDir, setDataDirOverride } from "../src/utils/paths.js";
import { releaseGraphWriter } from "../src/graph/writer-lease.js";
import { commitGraphWrites, loadPublicationState } from "../src/graph/publication.js";
import { importPlanAuthority, applyPlanCommand, readPlanAuthority, replayPlanHistory, bytesHash } from "../src/discipline/plan-authority.js";
import { planDefinitionDigest, type PlanActor } from "../src/discipline/plan-workflow.js";
import type { PlanDefinition } from "../src/graph/contracts.js";
let root: string, old: string, operation: number;
const now = "2026-10-01T00:00:00Z", markdown = "# Plan\n\n### Slice 0 - Work\n\n- status: pending\n", log = "### audit\nSlice 0 not completed.\n";
const actor: PlanActor = { id: "owner", instance_id: "fixture", project_id: "project", kind: "operator" };
const scope = { instance_id: actor.instance_id, project_id: actor.project_id, id: "plan" };
function definition(): PlanDefinition {
  const def: PlanDefinition = { ...scope, revision: 1, definition_hash: "placeholder", source_hash: bytesHash(markdown), log_hash: bytesHash(log), title: "Plan", phase: null,
    slices: [{ id: "slice-0-work", title: "Work", order: 0, priority: 1, depends_on: [], acceptance_hash: "acceptance:work", required: true }] };
  def.definition_hash = planDefinitionDigest(def); return def;
}
beforeEach(async () => { old = getDataDir(); root = await mkdtemp(join(tmpdir(), "dg-plan-authority-")); setDataDirOverride(root); operation = 0; });
afterEach(async () => { await releaseGraphWriter(root); setDataDirOverride(old); await rm(root, { recursive: true, force: true }); });
async function imported() {
  return importPlanAuthority({ actor, definition: definition(), markdown, log_markdown: log, review_id: "import-review", operation_id: "import", now });
}
async function command(command: unknown, extras: Record<string, unknown> = {}) {
  const view = await readPlanAuthority(scope, now);
  return applyPlanCommand({ actor, plan_id: scope.id, operation_id: `command-${++operation}`, expected_revision: view!.state.revision, expected_definition_hash: view!.state.definition_hash, command, now, ...extras });
}
async function started() {
  await imported(); await command({ type: "review_plan", review_id: "review" });
  await command({ type: "approve_scope", approval_id: "approval", owner: actor.id, scope: ["slice-0-work"], parallel_limit: 1 });
  await command({ type: "start_slice", slice_id: "slice-0-work" });
}
it("PL01/PL02/PL13: import preserves original bytes, prose is not completion, and repeated reads do not write", async () => {
  await imported(); const before = await readFile(join(root, "plan_state.json"), "utf8"); const view = await readPlanAuthority(scope, now);
  expect(view).toMatchObject({ source: "typed_plan_authority", current_slice_id: null, running_slice_id: null, progress: { verified: 0 }, state: { lifecycle: "draft" } });
  expect(await readFile(join(root, "plan_state.json"), "utf8")).toBe(before);
  const file = JSON.parse(before); const record = Object.values(file.records)[0] as any; expect(record.backups[0]).toMatchObject({ markdown, log_markdown: log });
  expect(await replayPlanHistory(scope)).toEqual(view!.state);
});
it("PL10: lost replies replay one receipt; changed payload and concurrent revision lose without a second effect", async () => {
  await imported(); const request = { actor, plan_id: scope.id, operation_id: "review", expected_revision: 0, expected_definition_hash: definition().definition_hash,
    command: { type: "review_plan", review_id: "review" }, now };
  const first = await applyPlanCommand(request), retry = await applyPlanCommand(request); expect(retry.replayed).toBe(true); expect(retry.receipt.transaction_id).toBe(first.receipt.transaction_id);
  await expect(applyPlanCommand({ ...request, command: { type: "begin_planning" } })).rejects.toThrow("OPERATION_IDENTITY_CONFLICT");
  await expect(applyPlanCommand({ ...request, operation_id: "concurrent" })).rejects.toThrow("PLAN_STATE_REVISION_CONFLICT");
  expect((await readPlanAuthority(scope, now))!.state.event_sequence).toBe(1);
});
it("PL10/PL14: another project cannot read or mutate the existing authority, and an agent cannot self-approve", async () => {
  await imported(); expect(await readPlanAuthority({ ...scope, project_id: "other" }, now)).toBeNull();
  await expect(command({ type: "review_plan", review_id: "claim" }, { actor: { ...actor, kind: "agent" } })).rejects.toThrow("PLAN_OPERATOR_REVIEW_REQUIRED");
  await expect(command({ type: "begin_planning" }, { actor: { ...actor, project_id: "other" } })).rejects.toThrow("PLAN_NOT_IMPORTED");
});
it("PL11: a fault before store replacement rolls back; fault after publication retains exactly one accepted transition", async () => {
  await imported(); const request = { actor, plan_id: scope.id, operation_id: "review", expected_revision: 0, expected_definition_hash: definition().definition_hash,
    command: { type: "review_plan", review_id: "review" }, now };
  await expect(applyPlanCommand({ ...request, fault_inject: step => { if (step === "before_replace:0:plan_state.json") throw new Error("fixture interruption"); } })).rejects.toThrow("fixture interruption");
  expect((await readPlanAuthority(scope, now))!.state.revision).toBe(0);
  await expect(applyPlanCommand({ ...request, fault_inject: step => { if (step === "before_journal_remove") throw new Error("reply lost"); } })).rejects.toThrow("reply lost");
  expect((await readPlanAuthority(scope, now))!.state.lifecycle).toBe("reviewed");
  expect((await applyPlanCommand(request)).replayed).toBe(true); expect((await replayPlanHistory(scope)).revision).toBe(1);
});
it("PL04/GE14: a status receipt cannot count as implementation; an actual graph commit can, and accepted verification survives replay", async () => {
  await started(); await expect(command({ type: "record_implementation", slice_id: "slice-0-work", receipt_ids: ["import"], effect_obligation_ids: [], required_stages: [], evidence_ids: ["claim"] })).rejects.toThrow("PLAN_IMPLEMENTATION_RECEIPT_REQUIRED");
  await commitGraphWrites({ writes: [{ file: "features.json", content: JSON.stringify([{ id: "fixture", source_repo: "fixture" }]) }], actor: "fixture-source", operation_id: "graph-change", scope: ["fixture"], cause: "fixture_change" });
  await command({ type: "record_implementation", slice_id: "slice-0-work", receipt_ids: ["graph-change"], effect_obligation_ids: [], required_stages: [], evidence_ids: ["fixture-source"] });
  expect((await readPlanAuthority(scope, now))!.progress.verified).toBe(0); await command({ type: "begin_verification", slice_id: "slice-0-work" });
  const implemented = (await readPlanAuthority(scope, now))!.state.slices[0].implementation_revision!;
  await command({ type: "finish_verification", slice_id: "slice-0-work", implementation_revision: implemented, acceptance_hash: "acceptance:work", passed: true, evidence_ids: ["fixture-checks"], review_id: "accepted-review", reason: "Pass" });
  const replay = await replayPlanHistory(scope); expect(replay.slices[0].status).toBe("verified"); expect(replay.lifecycle).toBe("implementing");
});
it("GE14/CU22 effect contract: reconciliation must finish; optional unfunded digestion can remain pending", async () => {
  await started(); const obligation = { schema: "dreamgraph.change_obligation.v1", id: "effect", instance_id: "fixture", execution_id: "job", operation_id: "effect-operation", actor: "owner", scope: ["fixture-source"],
    state: "reconciliation_pending", before_hashes: { fixture: "before" }, after_hashes: { fixture: "after" }, graph_receipt_id: null, created_at: now, updated_at: now };
  const dirty = { schema: "dreamgraph.dirty_partitions.v1", partitions: [{ schema: "dreamgraph.dirty_partition.v1", id: "fixture-source", scope: ["fixture-source"], generation: 1, running_generation: null, root_cause_ids: ["effect"],
    input_fingerprint: "fingerprint", pending_stages: ["reconciliation", "digestion"], state: "awaiting_reconciliation", first_changed_at: now, last_changed_at: now, stage_receipt_ids: [] }] };
  await commitGraphWrites({ writes: [{ file: "change_obligations.json", content: JSON.stringify({ schema: "dreamgraph.change_obligations.v1", entries: [obligation] }) }, { file: "dirty_partitions.json", content: JSON.stringify(dirty) }] });
  await command({ type: "record_implementation", slice_id: "slice-0-work", receipt_ids: [], effect_obligation_ids: ["effect"], required_stages: ["reconciliation"], evidence_ids: ["effect-evidence"] });
  await command({ type: "begin_verification", slice_id: "slice-0-work" }); const implemented = (await readPlanAuthority(scope, now))!.state.slices[0].implementation_revision!;
  const verification = { type: "finish_verification", slice_id: "slice-0-work", implementation_revision: implemented, acceptance_hash: "acceptance:work", passed: true, evidence_ids: ["checks"], review_id: "review", reason: "Pass" };
  await expect(command(verification)).rejects.toThrow("PLAN_REQUIRED_RECONCILIATION_PENDING");
  obligation.state = "graph_committed"; obligation.graph_receipt_id = "real-reconciliation" as any; dirty.partitions[0].pending_stages = ["digestion"]; dirty.partitions[0].state = "budget_blocked";
  await commitGraphWrites({ writes: [{ file: "change_obligations.json", content: JSON.stringify({ schema: "dreamgraph.change_obligations.v1", entries: [obligation] }) }, { file: "dirty_partitions.json", content: JSON.stringify(dirty) }] });
  await expect(command(verification)).rejects.toThrow("PLAN_REQUIRED_RECONCILIATION_PENDING");
  await commitGraphWrites({ writes: [], actor: "source_reconciliation", operation_id: "real-reconciliation", source_reconciliation: { revision: "fixture-source-revision", scope: ["fixture-source"], full: false } });
  await command(verification); expect((await readPlanAuthority(scope, now))!.state.slices[0].status).toBe("verified");
});
it("PL11: restart reads expire an admitted execution into recovery; metadata transitions do not invent graph currency", async () => {
  await started(); await command({ type: "admit_execution", slice_id: "slice-0-work", lease_id: "lease", execution_id: "job", kind: "implementation", expires_at: "2026-10-01T00:01:00Z", generation: 1 }, { actor: { ...actor, kind: "runtime" } });
  await releaseGraphWriter(root);
  expect(await readPlanAuthority(scope, "2026-10-01T00:02:00Z")).toMatchObject({ running_slice_id: null, current_slice_id: "slice-0-work", execution: "recovery_required" });
  expect((await loadPublicationState()).currency.last_graph_mutation_at).toBeNull();
});
