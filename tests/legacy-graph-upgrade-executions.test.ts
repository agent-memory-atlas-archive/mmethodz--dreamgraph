import { describe, expect, it } from "vitest";
import { executionGraphResidue } from "../src/graph/legacy-upgrade.js";

// Only the fields the rule reads; real entries carry request/pack/etc.
const entry = (overrides: Record<string, unknown>) => ({
  id: "session:1", status: "no_change", effects: [], obligation_ids: [], source_gaps: [], computer_sessions: [],
  ...overrides,
}) as unknown as Parameters<typeof executionGraphResidue>[0];
const hostStopUnknown = { tool: "host_adapter_termination", outcome: "unknown", receipt_ids: [], state_receipt_ids: [], at: "2026-10-04T01:58:56.937Z" };

describe("which unsettled executions block an offline graph upgrade", () => {
  it("lets through settled runs, runs left running by a dead daemon, and runs whose only open item is the host's own unconfirmed CLI stop", () => {
    expect(executionGraphResidue(entry({}))).toBeNull();
    expect(executionGraphResidue(entry({ status: "running" }))).toBeNull();
    expect(executionGraphResidue(entry({ status: "recovery_required", effects: [hostStopUnknown] }))).toBeNull();
    expect(executionGraphResidue(entry({ status: "recovery_required", effects: [hostStopUnknown, { tool: "query_resource", outcome: "owner_returned", receipt_ids: [], state_receipt_ids: [] }] }))).toBeNull();
  });

  it("keeps blocking anything that still references graph, plan or source state", () => {
    expect(executionGraphResidue(entry({ status: "recovery_required", effects: [hostStopUnknown], obligation_ids: ["o1"] }))).toBe("change obligations");
    expect(executionGraphResidue(entry({ status: "recovery_required", effects: [{ ...hostStopUnknown, tool: "patch_file" }] }))).toBe("effects with unknown outcome");
    expect(executionGraphResidue(entry({ status: "recovery_required", effects: [{ tool: "enrich_seed_data", outcome: "owner_returned", receipt_ids: ["r1"], state_receipt_ids: [] }] }))).toBe("committed effects awaiting settlement");
    expect(executionGraphResidue(entry({ status: "running", plan_execution: {} }))).toBe("plan execution");
    expect(executionGraphResidue(entry({ status: "no_change", plan_closure: { effective_termination: "unconfirmed" } }))).toBe("plan execution");
    expect(executionGraphResidue(entry({ status: "work_pending", computer_sessions: [{}] }))).toBe("computer sessions");
    expect(executionGraphResidue(entry({ status: "reconciliation_pending" }))).toBe("reconciliation_pending");
  });
});
