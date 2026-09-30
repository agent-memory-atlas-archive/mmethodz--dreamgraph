import { afterEach, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { getDataDir, setDataDirOverride } from "../src/utils/paths.js";
import { GraphOperationBusyError, withGraphOperation } from "../src/utils/graph-operation.js";

const originalDirectory = getDataDir();
afterEach(() => setDataDirOverride(originalDirectory));

describe("graph operation ownership", () => {
  it.each(["scan", "enrichment"] as const)("rejects separate requests while a %s owns the instance", async (kind) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const running = withGraphOperation(kind, () => gate);
    try {
      await expect(withGraphOperation("scan", async () => "unexpected")).rejects.toBeInstanceOf(GraphOperationBusyError);
      await expect(withGraphOperation("enrichment", async () => "unexpected")).rejects.toThrow(/already running/);
    } finally {
      release();
      await running;
    }
    expect(await withGraphOperation("scan", async () => "released")).toBe("released");
  });

  it("allows the owning scan's enrichment and recursive incremental retry", async () => {
    const result = await withGraphOperation("scan", () =>
      withGraphOperation("scan", () => withGraphOperation("enrichment", async () => "nested")));
    expect(result).toBe("nested");
  });

  it("releases ownership after failure", async () => {
    await expect(withGraphOperation("scan", async () => { throw new Error("failed"); })).rejects.toThrow("failed");
    expect(await withGraphOperation("enrichment", async () => "released")).toBe("released");
  });

  it("keeps ownership scoped to each instance data directory", async () => {
    let release!: () => void;
    const running = withGraphOperation("scan", () => new Promise<void>((resolve) => { release = resolve; }));
    try {
      setDataDirOverride(resolve(originalDirectory, "another-instance"));
      expect(await withGraphOperation("enrichment", async () => "independent")).toBe("independent");
    } finally {
      release();
      await running;
    }
  });
});
