import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDataDir, setDataDirOverride } from "../src/utils/paths.js";
import { startSession, completeSession, transitionPhase, recordToolCall, getActiveSession, loadSession } from "../src/discipline/session.js";
import { createDeltaTable, validateAndCreatePlan } from "../src/discipline/artifacts.js";
import { currentApprovedPlan } from "../src/discipline/approval.js";
import type { PlanItem } from "../src/discipline/types.js";
let root: string, old: string;
beforeEach(async () => { old = getDataDir(); root = await mkdtemp(join(tmpdir(), "dg-approval-")); setDataDirOverride(root);
  await startSession({ type: "modification", description: "Current approval fixture", target_scope: ["fixture.ts"] });
  await recordToolCall("read_source_code", {}, "Read actual fixture source", 0); await recordToolCall("get_workflow", {}, "Read fixture workflow", 0);
  expect((await transitionPhase("audit")).success).toBe(true);
});
afterEach(async () => { if (getActiveSession()) await completeSession("abandoned"); setDataDirOverride(old); await rm(root, { recursive: true, force: true }); });
function item(delta = "D1"): PlanItem { return { id: "P1", priority: 1, delta_entry_id: delta, action: "modify", target_file: "fixture.ts", change_description: "Repair the fixture contract",
  source_truth_mapping: { source_type: "source_file", source_identifier: "fixture.ts", what_it_requires: "Reviewed fixture" }, risk: { level: "low", breaking_changes: [], regressions: [], dependencies: [] },
  verification_criteria: [{ tool: "read_source_code", expected_result: "Fixture repaired", check_description: "Read and test fixture" }], execution_status: "pending" }; }
async function delta(id = "D1", status: "confirmed_gap" | "not_yet_verified" = "confirmed_gap") {
  return createDeltaTable({ sources: [{ type: "source_file", identifier: "fixture.ts", tool_call_id: "read" }], entries: [{ id, description: "Source-confirmed fixture discrepancy", severity: "major", status,
    source_ref: { type: "source_file", identifier: "fixture.ts", tool_call_id: "read" }, target_ref: { file_path: "fixture.ts", tool_call_id: "read" }, evidence: [] }] });
}
it("latest complete delta and fresh approved content admit execution; restart preserves binding", async () => {
  await delta(); expect((await transitionPhase("plan")).success).toBe(true);
  expect((await transitionPhase("execute")).success).toBe(false);
  expect((await validateAndCreatePlan({ description: "Reviewed fixture plan", items: [item()], auto_approve: true })).success).toBe(true);
  const session = getActiveSession()!; await loadSession(session.id, true);
  expect(currentApprovedPlan(getActiveSession()!)).not.toBeNull(); expect((await transitionPhase("execute")).success).toBe(true);
});
it("failed new submission cannot reuse a historical approval after a PLAN loopback", async () => {
  await delta(); await transitionPhase("plan"); await validateAndCreatePlan({ description: "Old fixture plan", items: [item()], auto_approve: true }); await transitionPhase("execute");
  await transitionPhase("verify"); await recordToolCall("read_source_code", {}, "Re-read physical fixture", 0);
  expect((await transitionPhase("plan", "New implementation scope")).success).toBe(true);
  expect((await validateAndCreatePlan({ description: "Invalid new wave", items: [{ ...item(), verification_criteria: [] }], auto_approve: true })).success).toBe(false);
  const session = getActiveSession()!; await loadSession(session.id, true);
  expect(currentApprovedPlan(getActiveSession()!)).toBeNull(); expect((await transitionPhase("execute")).reason).toContain("CURRENT_APPROVAL_REQUIRED");
});
it("changed plan bytes or latest delta revoke admission; historical gaps do not contaminate a new wave", async () => {
  await delta(); await transitionPhase("plan"); await validateAndCreatePlan({ description: "Fixture plan", items: [item()], auto_approve: true });
  getActiveSession()!.artifacts.plans.at(-1)!.items[0].target_file = "other.ts";
  expect((await transitionPhase("execute")).success).toBe(false);
  await delta("D2"); expect((await validateAndCreatePlan({ description: "Second reviewed wave", items: [item("D2")], auto_approve: true })).success).toBe(true);
  expect(currentApprovedPlan(getActiveSession()!)).not.toBeNull();
  await delta("D3"); expect(currentApprovedPlan(getActiveSession()!)).toBeNull();
});
it("unresolved latest delta blocks planning and legacy unbound approvals are not silently trusted", async () => {
  await delta("D1", "not_yet_verified"); expect((await transitionPhase("plan")).reason).toContain("DELTA_INCOMPLETE");
  await delta(); await transitionPhase("plan"); await validateAndCreatePlan({ description: "Fixture plan", items: [item()], auto_approve: true });
  delete getActiveSession()!.artifacts.plans.at(-1)!.approval_binding;
  expect((await transitionPhase("execute")).success).toBe(false);
});
