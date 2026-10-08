import { expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertCliAdmissionGate } from "../src/architect/cli-admission-gate.js";
it("keeps discovery separate from tool admission; wrong, absent, oversized or revoked gates refuse", async () => {
  const root = await mkdtemp(join(tmpdir(), "dg-claude-gate-"));
  const path = join(root, "gate"), token = randomBytes(32).toString("hex");
  const env = { DREAMGRAPH_BRIDGE_ADMISSION_PATH: path, DREAMGRAPH_BRIDGE_ADMISSION_TOKEN: token };
  try {
    await expect(assertCliAdmissionGate({})).resolves.toBeUndefined(); // Existing adapters unchanged.
    await expect(assertCliAdmissionGate(env)).rejects.toThrow("NOT_READY");
    await writeFile(path, token + "x");
    await expect(assertCliAdmissionGate(env)).rejects.toThrow("NOT_READY");
    await writeFile(path, randomBytes(32).toString("hex"));
    await expect(assertCliAdmissionGate(env)).rejects.toThrow("NOT_READY");
    await writeFile(path, token); await expect(assertCliAdmissionGate(env)).resolves.toBeUndefined();
    await unlink(path); await expect(assertCliAdmissionGate(env)).rejects.toThrow("NOT_READY");
    await expect(assertCliAdmissionGate({ ...env, DREAMGRAPH_BRIDGE_ADMISSION_TOKEN: "" })).rejects.toThrow("INVALID");
  } finally { await rm(root, { recursive: true, force: true }); }
});
