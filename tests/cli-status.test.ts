import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { cmdStatus, gatherDataStats } from "../src/cli/commands/status.js";

const tempDirs: string[] = [];

async function fixtureDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dg-status-"));
  tempDirs.push(dir);
  return dir;
}

async function writeJson(dir: string, file: string, value: unknown): Promise<void> {
  await writeFile(join(dir, file), JSON.stringify(value), "utf-8");
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("dg status data stats", () => {
  it("reports the deduplicated Explorer-visible graph node count", async () => {
    const dir = await fixtureDir();
    await writeJson(dir, "features.json", [{ id: "feature-1" }, { id: "feature-2" }]);
    await writeJson(dir, "workflows.json", { workflows: [{ id: "workflow-1" }, { id: "feature-1" }] });
    await writeJson(dir, "data_model.json", [{ id: "model-1", storage: "unknown" }]);
    await writeJson(dir, "capabilities.json", [{ id: "capability-1" }]);
    await writeJson(dir, "datastores.json", [{ id: "store-1" }, { id: "unknown" }, { id: "stub", _schema: true }]);
    await writeJson(dir, "dream_graph.json", {
      nodes: [{ id: "model-1" }, { id: "dream-1" }],
      edges: [{ from: "feature-1", to: "feature-2" }, { from: "dream-1", to: "model-1" }],
    });
    await writeJson(dir, "tension_log.json", { signals: [{ id: "tension-1" }] });
    await writeJson(dir, "ui_registry.json", {
      elements: [
        { id: "ui-1", name: "Panel", source_repo: "dreamgraph" },
        { id: "ui-unscoped", name: "Draft" },
      ],
    });

    const stats = await gatherDataStats(dir);

    expect(stats.graphNodes).toBe(10);
    expect(stats.graphEdges).toBe(2);
    expect(stats.tensions).toBe(1);
    expect(stats.uiElements).toBe(2);
  });

  it("keeps the v14 raw-count JSON keys while adding the distinct-dream validation pipeline", async () => {
    const master = await fixtureDir(), uuid = "11111111-1111-4111-8111-111111111111", name = "status-json-fixture";
    const root = join(master, uuid), data = join(root, "data");
    await mkdir(data, { recursive: true });
    const timestamp = "2026-10-04T00:00:00.000Z";
    await writeJson(master, "instances.json", { schema_version: "1.0.0", instances: [{
      uuid, name, project_root: null, mode: "passive", status: "active", created_at: timestamp, last_active_at: timestamp,
    }] });
    await writeJson(root, "instance.json", { uuid, name, project_root: null, mode: "passive", policy_profile: "balanced",
      version: "14.0.0", transport: { type: "http" }, created_at: timestamp, last_active_at: timestamp,
      total_dream_cycles: 0, total_tool_calls: 0 });
    await writeJson(data, "candidate_edges.json", { results: [
      { dream_type: "edge", dream_id: "one", normalization_cycle: 1, status: "latent", validated_at: timestamp },
      { dream_type: "edge", dream_id: "one", normalization_cycle: 2, status: "validated", validated_at: timestamp },
      { dream_type: "node", dream_id: "two", normalization_cycle: 1, status: "rejected", validated_at: timestamp },
    ] });
    await writeJson(data, "validated_edges.json", { edges: [{ id: "one" }] });
    const printed = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await cmdStatus([name], { "master-dir": master, json: true } as Parameters<typeof cmdStatus>[1]);
      const result = JSON.parse(String(printed.mock.calls.at(-1)?.[0]));
      expect(result.cognitive.candidate_edges).toBe(3);
      expect(result.cognitive.validated_edges).toBe(1);
      expect(result.cognitive.validation_pipeline).toMatchObject({ assessed: 2, validated: 1, rejected: 1,
        latent: 0, assessment_rows: 3, promoted_edges: 1, validation_rate: 0.5 });
    } finally { printed.mockRestore(); }
  });
});
