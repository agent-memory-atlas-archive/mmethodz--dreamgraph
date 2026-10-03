import { describe, expect, it } from "vitest";
import { initialPlanState, dependencyDiagnostics, planDefinitionDigest, projectPlanState, reducePlanCommand, type PlanCommand, type PlanActor } from "../src/discipline/plan-workflow.js";
import { planEventDecision } from "../src/discipline/plan-authority.js";
import { PlanStateSchema, type PlanDefinition } from "../src/graph/contracts.js";
const now = "2026-10-01T00:00:00Z";
const actor: PlanActor = { id: "owner", instance_id: "fixture", project_id: "project", kind: "operator" };
function definition(count = 4): PlanDefinition {
  const names = count === 4 ? ["release", "a", "b", "c"] : Array.from({ length: count }, (_, i) => `slice-${i}`);
  const result: PlanDefinition = { id: "plan", instance_id: "fixture", project_id: "project", revision: 1, definition_hash: "pending", source_hash: "sha256:fixture", log_hash: null,
    title: "Fixture plan", phase: null, slices: names.map((id, order) => ({ id, title: id, order, priority: 1, depends_on: id === "release" ? ["b", "c"] : id === "b" ? ["a"] : [], acceptance_hash: `acceptance:${id}`, required: true })) };
  result.definition_hash = planDefinitionDigest(result); return result;
}
function harness(def = definition()) {
  let state = initialPlanState(def, now);
  return { get state() { return state; }, view: (time = now) => projectPlanState(state, time),
    step: (command: PlanCommand, options: { actor?: PlanActor; closure_allowed?: boolean; implementation_receipts_valid?: boolean } = {}) => {
      state = reducePlanCommand(state, command, { actor, now, closure_allowed: true, implementation_receipts_valid: true, ...options }); return state;
    },
    approve() { this.step({ type: "review_plan", review_id: "review" }); this.step({ type: "approve_scope", approval_id: "approval", owner: "owner", scope: def.slices.map(s => s.id), parallel_limit: 2 }); },
    implement(id: string) { this.step({ type: "start_slice", slice_id: id }); this.step({ type: "record_implementation", slice_id: id, receipt_ids: ["fixture-change"], effect_obligation_ids: [], required_stages: [], evidence_ids: ["source"] }); },
    finish(id: string, passed = true) {
      this.step({ type: "begin_verification", slice_id: id }); const slice = state.slices.find(s => s.id === id)!;
      this.step({ type: "finish_verification", slice_id: id, implementation_revision: slice.implementation_revision!, acceptance_hash: state.definition.slices.find(s => s.id === id)!.acceptance_hash,
        passed, evidence_ids: ["checks"], review_id: "accepted-review", reason: passed ? "Checks passed" : "Failure retained" });
    },
  };
}
describe("C14 pure transition contract (receipt truth is qualified separately by the durable authority)", () => {
  it("PL01/PL02: 31- and 32-slice drafts have no current/running work, and reads manufacture no activity", () => {
    for (const count of [31, 32]) {
      const h = harness(definition(count)), before = structuredClone(h.state), view = h.view();
      expect(view).toMatchObject({ current_slice_id: null, running_slice_id: null, execution: "idle", next_slice: { id: "slice-0", can_start: false, reasons: ["awaiting_implementation_approval"] }, progress: { verified: 0, required: count } });
      expect(h.state).toEqual(before); expect(() => h.step({ type: "start_slice", slice_id: "slice-0" })).toThrow("PLAN_SCOPE_APPROVAL_REQUIRED");
    }
  });
  it("PL03/PL14: explicit current ownership differs from an admitted running lease; cancellation retains unfinished work", () => {
    const h = harness(); h.approve(); h.step({ type: "start_slice", slice_id: "a" }); expect(h.view().running_slice_id).toBeNull();
    h.step({ type: "admit_execution", slice_id: "a", lease_id: "lease", execution_id: "job", kind: "implementation", generation: 1, expires_at: "2026-10-01T00:01:00Z" }, { actor: { ...actor, id: "supervisor", kind: "runtime" } });
    expect(h.view()).toMatchObject({ current_slice_id: "a", running_slice_id: "a", execution: "running" });
    h.step({ type: "end_execution", lease_id: "lease", execution_id: "job", generation: 1, outcome: "cancelled", reason: "Owner cancelled", stop_acknowledged: true });
    expect(h.view()).toMatchObject({ current_slice_id: "a", running_slice_id: null, execution: "idle" }); expect(h.state.slices.find(s => s.id === "a")?.status).toBe("in_progress");
  });
  it("PL04: implemented is not verified, failure persists and a passing accepted review is required", () => {
    const h = harness(); h.approve(); h.implement("a"); expect(h.view().progress).toMatchObject({ verified: 0, implemented: 1 }); h.finish("a", false);
    expect(h.state.slices.find(s => s.id === "a")).toMatchObject({ status: "implemented", last_attempt: { outcome: "failed" } });
    h.finish("a"); expect(h.view()).toMatchObject({ current_slice_id: null, progress: { verified: 1 }, state: { last_verified_slice_id: "a" } });
  });
  it("PL05: independent blocked branch preserves other work; a plan gate retains its underlying stage", () => {
    const h = harness(); h.approve(); h.step({ type: "start_slice", slice_id: "a" }); h.step({ type: "block", slice_id: "a", reason: "Dependency unavailable" });
    expect(h.view().next_slice?.id).toBe("c"); expect(h.state.lifecycle).toBe("implementing");
    h.step({ type: "block", slice_id: null, reason: "Global review" }); expect(h.state).toMatchObject({ lifecycle: "blocked", underlying_lifecycle: "implementing" });
    expect(() => h.step({ type: "start_slice", slice_id: "c" })).toThrow("PLAN_SCOPE_APPROVAL_REQUIRED");
    h.step({ type: "unblock", slice_id: null, reason: "Global review", evidence_ids: ["resolved"] }); expect(h.state.lifecycle).toBe("implementing");
  });
  it("PL06: release cannot outrun dependencies despite its first document position; missing/cyclic branches stay blocked", () => {
    const h = harness(); h.approve(); expect(h.view().next_slice?.id).toBe("a"); expect(() => h.step({ type: "start_slice", slice_id: "release" })).toThrow("PLAN_SLICE_NOT_ELIGIBLE");
    const def = definition(); def.slices[1].depends_on = ["missing"]; def.slices[2].depends_on = ["release"]; def.definition_hash = planDefinitionDigest(def);
    const invalid = harness(def); invalid.approve(); expect(invalid.view().next_slice?.id).toBe("c");
  });
  it("PL07: reopening revokes effective completion and downstream verification while keeping history", () => {
    const h = harness(); h.approve(); h.implement("a"); h.finish("a"); h.implement("b"); h.finish("b");
    h.step({ type: "reopen_slice", slice_id: "a", reason: "Acceptance changed" }); expect(h.view().progress.verified).toBe(0);
    expect(h.state.slices.find(s => s.id === "b")).toMatchObject({ status: "implemented", verification: { fresh: false } }); expect(h.state.last_verified_slice_id).toBeNull();
    expect(() => h.step({ type: "begin_verification", slice_id: "b" })).toThrow("PLAN_DEPENDENCIES_UNRESOLVED");
  });
  it("PL08/PL09: all verified slices do not complete the plan; final review is separate and reopening revokes completion", () => {
    const h = harness(); h.approve(); for (const id of ["a", "b", "c", "release"]) { h.implement(id); h.finish(id); }
    expect(h.state.lifecycle).toBe("implementing"); expect(h.view().resume_action).toBe("final_verification_required");
    h.step({ type: "begin_final_verification" }); h.step({ type: "finish_final_verification", passed: false, evidence_ids: ["failure"], review_id: "review" });
    expect(() => h.step({ type: "complete_plan", review_id: "review" })).toThrow("PLAN_FINAL_ACCEPTANCE_REQUIRED");
    h.step({ type: "finish_final_verification", passed: true, evidence_ids: ["integration"], review_id: "review" }); h.step({ type: "complete_plan", review_id: "release-review" });
    expect(h.view()).toMatchObject({ next_slice: null, resume_action: "completed", current_slice_id: null });
    h.step({ type: "reopen_slice", slice_id: "a", reason: "New required work" }); expect(h.state.lifecycle).toBe("implementing"); expect(h.state.final_verification).toBeNull();
  });
  it("PL08: reviewed deferral stays distinct and only an explicit waiver satisfies dependencies", () => {
    const h = harness(); h.approve(); h.step({ type: "defer_slice", slice_id: "a", reason: "Out of release scope", impact: "Dependent behavior unavailable", review_id: "review", dependency_waiver: false });
    expect(() => h.step({ type: "start_slice", slice_id: "b" })).toThrow("PLAN_SLICE_NOT_ELIGIBLE"); expect(h.view().progress).toMatchObject({ verified: 0, deferred: 1 });
  });
  it("PL09/PL11/CU11: expiry or unknown stop leaves recovery debt and prevents archive", () => {
    const h = harness(); h.approve(); h.step({ type: "start_slice", slice_id: "a" });
    h.step({ type: "admit_execution", slice_id: "a", lease_id: "lease", execution_id: "job", kind: "implementation", generation: 1, expires_at: "2026-10-01T00:01:00Z" }, { actor: { ...actor, kind: "runtime" } });
    expect(h.view("2026-10-01T00:02:00Z")).toMatchObject({ running_slice_id: null, execution: "recovery_required", current_slice_id: "a" });
    expect(() => h.step({ type: "archive_plan", reason: "Hide work" })).toThrow("PLAN_EXECUTION_OR_RECOVERY_PENDING");
    h.step({ type: "end_execution", lease_id: "lease", execution_id: "job", generation: 1, outcome: "cancelled", reason: "Stop unknown", stop_acknowledged: false });
    expect(h.view().execution).toBe("recovery_required"); expect(h.state.current_slice_ids).toEqual(["a"]);
  });
  it("PL10/PL14: foreign project/owner and stale lease fences fail; multiple current is explicit", () => {
    const h = harness(); h.approve(); h.step({ type: "start_slice", slice_id: "a" }); h.step({ type: "start_slice", slice_id: "c" });
    expect(h.view()).toMatchObject({ current_slice_id: null, current_reason: "multiple_current_slices" }); h.step({ type: "set_primary", slice_id: "a" }); expect(h.view().current_slice_id).toBe("a");
    expect(() => h.step({ type: "resume_slice", slice_id: "a" }, { actor: { ...actor, id: "other-client", kind: "agent" } })).toThrow("PLAN_SLICE_OWNER_REJECTED");
    expect(() => h.step({ type: "begin_planning" }, { actor: { ...actor, project_id: "other" } })).toThrow("PLAN_SCOPE_REJECTED");
  });
  it("PL12/PL16 protocol: duplicates/out-of-order cannot replace current state, gaps and epochs require a refetch", () => {
    const current = { epoch: "e", revision: 3, sequence: 3 };
    expect(planEventDecision(current, { ...current })).toBe("ignore"); expect(planEventDecision(current, { epoch: "e", revision: 2, sequence: 2 })).toBe("ignore");
    expect(planEventDecision(current, { epoch: "e", revision: 4, sequence: 4 })).toBe("apply"); expect(planEventDecision(current, { epoch: "e", revision: 5, sequence: 5 })).toBe("refetch");
    expect(planEventDecision(current, { epoch: "other", revision: 4, sequence: 4 })).toBe("refetch");
  });
  it("PL13: cosmetic heading rename/reorder preserves stable identity, approval and evidence", () => {
    const h = harness(); h.approve(); h.implement("a"); h.finish("a"); const def = structuredClone(h.state.definition); def.revision++; def.title = "New title"; def.source_hash = "sha256:new";
    def.slices.reverse(); def.slices.forEach((slice, order) => { slice.title = `Renamed ${slice.id}`; slice.order = order; }); expect(planDefinitionDigest(def)).toBe(def.definition_hash);
    h.step({ type: "reconcile_definition", definition: def, source_hash: def.source_hash, log_hash: null, review_id: "cosmetic-review", carry_forward_slice_ids: [] });
    expect(h.state.slices.find(s => s.id === "a")).toMatchObject({ status: "verified", verification: { fresh: true } }); expect(h.state.approval).not.toBeNull();
  });
  it("GE14/CU22: closure cannot waive required reconciliation; a false receipt cannot mark implementation", () => {
    const h = harness(); h.approve(); h.step({ type: "start_slice", slice_id: "a" });
    expect(() => h.step({ type: "record_implementation", slice_id: "a", receipt_ids: ["prose"], effect_obligation_ids: [], required_stages: [], evidence_ids: ["claim"] }, { implementation_receipts_valid: false })).toThrow("PLAN_IMPLEMENTATION_RECEIPT_REQUIRED");
    h.step({ type: "record_implementation", slice_id: "a", receipt_ids: ["real"], effect_obligation_ids: ["source-effect"], required_stages: ["reconciliation"], evidence_ids: ["source"] }); h.step({ type: "begin_verification", slice_id: "a" });
    expect(() => h.step({ type: "finish_verification", slice_id: "a", implementation_revision: h.state.slices.find(s => s.id === "a")!.implementation_revision!, acceptance_hash: "acceptance:a", passed: true, evidence_ids: ["checks"], review_id: "review", reason: "Pass" }, { closure_allowed: false })).toThrow("PLAN_REQUIRED_RECONCILIATION_PENDING");
  });
  it("previous-major plan records remain readable without becoming current approval", () => {
    expect(PlanStateSchema.safeParse({ schema: "dreamgraph.plan_state.v1", id: "old", instance_id: "fixture", revision: 1, definition_hash: "legacy", lifecycle: "approved", underlying_lifecycle: null,
      current_slice_ids: [], running_slice_ids: [], next_slice_ids: [], last_verified_slice_id: null, slices: [], updated_at: now }).success).toBe(true);
  });
});

describe("C14 definition review and delegated authority", () => {
  it("preserves unaffected approvals and proof, invalidates downstream proof, and refuses to drop owned work", () => {
    const h = harness(); h.approve(); h.implement("a"); h.finish("a"); h.implement("b"); h.finish("b"); h.implement("c"); h.finish("c");
    const def = structuredClone(h.state.definition); def.revision++; def.slices.find(s => s.id === "a")!.acceptance_hash = "changed";
    def.definition_hash = planDefinitionDigest(def);
    h.step({ type: "reconcile_definition", definition: def, review_id: "review-change", carry_forward_slice_ids: ["b", "c", "release"], source_hash: def.source_hash, log_hash: def.log_hash });
    expect(h.state.slices.find(s => s.id === "a")).toMatchObject({ status: "implemented", verification: { fresh: false }, implementation_receipt_ids: ["fixture-change"] });
    expect(h.state.slices.find(s => s.id === "b")).toMatchObject({ status: "implemented", verification: { fresh: false } });
    expect(h.state.slices.find(s => s.id === "c")).toMatchObject({ status: "verified", verification: { fresh: true } });
    expect(h.state.approval?.scope).toEqual(["c"]); expect(h.view().progress.verified).toBe(1);
    const owned = harness(); owned.approve(); owned.step({ type: "start_slice", slice_id: "a" });
    expect(() => owned.step({ type: "reconcile_definition", definition: def, review_id: "review-change", carry_forward_slice_ids: ["b", "c", "release"], source_hash: def.source_hash, log_hash: def.log_hash })).toThrow("PLAN_CURRENT_SCOPE_REVIEW_REQUIRED");
  });
  it("accepts an existing trusted delegated review without granting an agent self-approval", () => {
    const h = harness(), delegated: PlanActor = { ...actor, kind: "agent", review_grant: { plan_id: "plan", definition_hash: h.state.definition_hash, slice_ids: h.state.slices.map(s => s.id) } };
    h.step({ type: "review_plan", review_id: "delegated-review" }, { actor: delegated });
    h.step({ type: "approve_scope", approval_id: "existing-owner-authorization", scope: ["a"], owner: actor.id, parallel_limit: 1 }, { actor: delegated });
    expect(h.state.lifecycle).toBe("implementation_ready");
    expect(() => h.step({ type: "approve_scope", approval_id: "bad", scope: ["c"], owner: actor.id, parallel_limit: 1 }, { actor: { ...delegated, review_grant: { ...delegated.review_grant!, slice_ids: ["a"] } } })).toThrow("PLAN_OPERATOR_REVIEW_REQUIRED");
  });
});

it("bounds a 2,000-slice dependency chain without recursive stack overflow", () => {
  const def = definition(2000); for (let i = 0; i < def.slices.length - 1; i++) def.slices[i].depends_on = [def.slices[i + 1].id];
  expect(dependencyDiagnostics(def).get("slice-0")).toEqual([]);
  def.slices[1999].depends_on = ["slice-0"];
  expect(dependencyDiagnostics(def).get("slice-0")?.[0]).toMatch(/^dependency_cycle:/);
});
