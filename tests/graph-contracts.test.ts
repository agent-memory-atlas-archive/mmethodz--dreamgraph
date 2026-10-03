import { describe, expect, it } from "vitest";
import {
  CANONICAL_CONTRACTS, ComputerActionSchema, ComputerTargetSchema,
  GraphCurrencySchema, GraphIdentitySchema, OperationReceiptSchema,
  classifySchemaMajor, graphIdentityKey,
} from "../src/graph/contracts.js";

describe("Ashoka canonical contract foundation", () => {
  it("namespaces colliding legacy IDs without changing their identity", () => {
    const first = { instance_id: "instance", kind: "feature" as const, id: "Public" };
    expect(graphIdentityKey(first)).not.toBe(graphIdentityKey({ ...first, kind: "capability" }));
    expect(graphIdentityKey(first)).not.toBe(graphIdentityKey({ ...first, instance_id: "another" }));
    expect(GraphIdentitySchema.parse(first).id).toBe("Public");
    expect(graphIdentityKey({ ...first, id: "x/y" })).toBe("instance/feature/x%2Fy");
  });
  it("does not fabricate unknown legacy currency timestamps", () => {
    expect(GraphCurrencySchema.parse({ last_graph_mutation_at: null, last_full_scan_at: null,
      last_source_reconciliation_at: null, source_reconciliation_scope: [], source_reconciliation_revision: null,
    }).last_graph_mutation_at).toBeNull();
    expect(GraphCurrencySchema.safeParse({ last_graph_mutation_at: "yesterday" }).success).toBe(false);
  });
  it("keeps product and independent schema majors separate", () => {
    expect(classifySchemaMajor("1.0.0", 2)).toBe("previous");
    expect(classifySchemaMajor("2.0.0", 2)).toBe("current");
    expect(classifySchemaMajor("3.0.0", 2)).toBe("newer");
    expect(classifySchemaMajor("unversioned", 2)).toBe("unknown");
    expect(classifySchemaMajor("0.9.0", 2)).toBe("migration_required");
    expect(classifySchemaMajor("14.0.0", 1)).toBe("newer");
  });
  it("rejects OS handles and API continuation envelopes in shared CU targets/actions", () => {
    const target = { schema: "dreamgraph.computer_target.v1", id: "t", instance_id: "i",
      session_id: "s", host_id: "h", surface: "desktop", generation: 1, origin: null, application: "editor" };
    expect(ComputerTargetSchema.safeParse(target).success).toBe(true);
    expect(ComputerTargetSchema.safeParse({ ...target, hwnd: 1234 }).success).toBe(false);
    expect(ComputerTargetSchema.safeParse({ ...target, api_continuation: {} }).success).toBe(false);
    const action={schema:"dreamgraph.computer_action.v1",id:"a",execution_id:"e",target_id:"t",
      target_generation:1,observation_id:"o",grant_id:"g",operation:"click",parameters:{x:2,y:3},postcondition:"p",fence:1};
    expect(ComputerActionSchema.safeParse(action).success).toBe(true);
    expect(ComputerActionSchema.safeParse({...action,parameters:{raw_native_handle:{hwnd:1}}}).success).toBe(false);
    expect(ComputerActionSchema.safeParse({...action,parameters:{hwnd:1}}).success).toBe(false);
    expect(ComputerActionSchema.safeParse({...action,parameters:{previous_response_id:"resp_private"}}).success).toBe(false);
  });
  it("requires a durable revision/currency boundary in receipts", () => {
    expect(OperationReceiptSchema.safeParse({ operation_id: "looks successful", outcome: "committed" }).success).toBe(false);
    expect(Object.keys(CANONICAL_CONTRACTS)).toContain("operation_receipt");
  });
});
