import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";

import { ownerAlive } from "../src/cognitive/model-admission.js";

describe("admission concurrency slots belong to a live owning process", () => {
  it("treats the current process as a live owner", () => {
    expect(ownerAlive(process.pid)).toBe(true);
  });

  it("releases slots of a process that no longer exists (daemon restart or crash)", () => {
    const exited = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" });
    expect(ownerAlive(Number(exited.stdout))).toBe(false);
  });

  it("treats attempts written before owner tracking as orphaned", () => {
    expect(ownerAlive(undefined)).toBe(false);
  });
});
