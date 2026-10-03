/** Actual core read port over disposable committed data; no model or plugin-private effect attestation. */
import { beforeEach, afterEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PluginManifestSchema } from "@dreamgraph/sdk";
import { createPluginGraphContext } from "../../src/plugins/graph-context.js";
import { commitGraphWrites, loadPublicationState } from "../../src/graph/publication.js";
import { getDataDir, setDataDirOverride } from "../../src/utils/paths.js";
import { releaseGraphWriter } from "../../src/graph/writer-lease.js";

let root: string, previous: string;
const manifest = () => PluginManifestSchema.parse({ id: "fixture.graph", version: "1.0.0", displayName: "Graph fixture", engine: { dreamgraph: ">=13.4.0" },
  main: "./index.js", intent: "Read canonical evidence", expectedEffects: ["read_internal_graph"], capabilities: ["resources:read"] });
beforeEach(async () => { previous = getDataDir(); root = await mkdtemp(join(tmpdir(), "dg-plugin-context-")); setDataDirOverride(root);
  await commitGraphWrites({ actor: "fixture", scope: ["features.json", "data_model.json"], writes: [
    { file: "features.json", content: JSON.stringify({ features: [{ id: "collision", name: "Payment", description: "A source-backed feature", source_repo: "fixture", source_files: ["payment.ts"] }] }) },
    { file: "data_model.json", content: JSON.stringify({ entities: [{ id: "collision", name: "Payment data", description: "Distinct data identity" }] }) },
  ] });
});
afterEach(async () => { await releaseGraphWriter(root); setDataDirOverride(previous); await rm(root, { recursive: true, force: true }); });

it("uses one canonical request/result owner, preserves identity and trust, and remains read-only/unattested", async () => {
  const before = await loadPublicationState(), port = createPluginGraphContext(manifest(), "fixture-instance", new AbortController().signal);
  const pack = await port.retrieve({ query: "Payment", depth: 0, token_budget: 5000 });
  expect(port.availability).toBe("available"); expect(pack.receipt).toMatchObject({ adapter: "plugin:fixture.graph", delivery: "unattested" });
  expect(new Set(pack.records.map(record => record.identity?.kind))).toEqual(new Set(["feature", "data_model"]));
  expect(pack.context_text).toContain('"assertion":"source_assertion"');
  pack.records[0].identity!.id = "caller-edited-copy";
  expect((await port.retrieve({ query: "Payment", depth: 0, token_budget: 5000 })).records.every(record => record.identity?.id === "collision")).toBe(true);
  expect((await loadPublicationState()).revision).toEqual(before.revision);
});
it("declines missing capability or effect instead of fabricating a legacy reader", async () => {
  for (const value of [{ ...manifest(), capabilities: ["events:read" as const] }, { ...manifest(), expectedEffects: ["read_events" as const] }]) {
    const port = createPluginGraphContext(value, "fixture-instance", new AbortController().signal);
    expect(port.availability).toBe("unavailable"); await expect(port.retrieve({ query: "Payment" })).rejects.toThrow("CAPABILITY_REQUIRED");
  }
});
it("rejects invalid controls and honors unload/caller cancellation without claiming private effects stopped", async () => {
  const unload = new AbortController(), port = createPluginGraphContext(manifest(), "fixture-instance", unload.signal);
  await expect(port.retrieve({ query: "Payment", unrecognized_control: true } as any)).rejects.toThrow();
  await expect(port.retrieve({ query: "Payment" }, { signal: AbortSignal.abort(new Error("caller cancelled")) })).rejects.toThrow("caller cancelled");
  unload.abort(new Error("plugin unloaded")); await expect(port.retrieve({ query: "Payment" })).rejects.toThrow("plugin unloaded");
});
