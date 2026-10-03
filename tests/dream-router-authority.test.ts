import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { engine } from "../src/cognitive/engine.js";
import { dream, prepareDream } from "../src/cognitive/dreamer.js";
import { buildFactSnapshot } from "../src/cognitive/strategies/_shared.js";
import { registerCognitiveTools } from "../src/cognitive/register.js";
import { setDataDirOverride, getDataDir } from "../src/utils/paths.js";
import { releaseGraphWriter } from "../src/graph/writer-lease.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
let directory: string, prior: string;
const facts = [
  { id: "a", name: "Owner", source_repo: "fixture", description: "Fixture source owner", links: ["b", "c"].map(target => ({ target, type: "feature", relationship: "reads", strength: "medium" })) },
  { id: "b", name: "Consumer B", source_repo: "fixture", description: "Fixture B", links: [] },
  { id: "c", name: "Consumer C", source_repo: "fixture", description: "Fixture C", links: [] },
];
beforeEach(async () => {
  prior = getDataDir(); directory = await mkdtemp(join(tmpdir(), "dg-strategy-authority-")); setDataDirOverride(directory);
  for (const name of ["features.json", "workflows.json", "data_model.json"]) await writeFile(join(directory, name), JSON.stringify(name === "features.json" ? facts : []));
  if (engine.getState() !== "awake") await engine.interrupt();
});
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs(); if (engine.getState() !== "awake") await engine.interrupt();
  await releaseGraphWriter(directory); setDataDirOverride(prior); await rm(directory, { recursive: true, force: true });
});
function tool() {
  const handlers = new Map<string, Function>();
  registerCognitiveTools({ tool: (name: string, _description: string, _schema: unknown, handler: Function) => handlers.set(name, handler) } as unknown as McpServer);
  return handlers.get("dream_cycle")!;
}
it("rejects retired/unknown focused requests before decay or cycle mutation", async () => {
  const cycle = engine.getCurrentDreamCycle(); const decay = vi.spyOn(engine, "applyDecay");
  const invoke = tool();
  for (const args of [{ strategy: "reflective" }, { focus_entities: ["absent"], max_dreams: 10 }]) {
    const result = await invoke(args); expect(JSON.parse(result.content[0].text).success).toBe(false);
  }
  expect(decay).not.toHaveBeenCalled(); expect(engine.getCurrentDreamCycle()).toBe(cycle); expect(engine.getState()).toBe("awake");
});
it("zero MCP budget does not decay, normalize, invoke providers or interrupt another state", async () => {
  engine.enterRem(); const cycle = engine.getCurrentDreamCycle(); const decay = vi.spyOn(engine, "applyDecay");
  const result = JSON.parse((await tool()({ max_dreams: 0 })).content[0].text);
  expect(result).toMatchObject({ success: true, data: { execution_status: "skipped_zero_budget", state_transitions: [], dreams_generated: { nodes: 0, edges: 0 } } });
  expect(decay).not.toHaveBeenCalled(); expect(engine.getCurrentDreamCycle()).toBe(cycle); expect(engine.getState()).toBe("rem");
});
it("actual two-cycle deduplication remaps generated hub edges to the persisted node identity", async () => {
  engine.enterRem(); const before = await readFile(join(directory, "features.json"), "utf8");
  const first = await dream("missing_abstraction", 3); expect(first.nodes).toHaveLength(1); expect(first.edges).toHaveLength(2);
  const second = await dream("missing_abstraction", 3); expect(second.nodes).toEqual([]); expect(second.duplicates_merged).toBe(3);
  const persisted = await engine.loadDreamGraph(); const ids = new Set([...facts.map(e => e.id), ...persisted.nodes.map(e => e.id)]);
  expect(persisted.nodes).toHaveLength(1); expect(persisted.edges).toHaveLength(2);
  expect(persisted.edges.every(e => ids.has(e.from) && ids.has(e.to) && e.from !== e.to)).toBe(true);
  expect(await readFile(join(directory, "features.json"), "utf8")).toBe(before);
});
it("invalid fractions and unknown scope leave the cycle unchanged; duplicate roots accept zero hops", async () => {
  const cycle = engine.getCurrentDreamCycle(); engine.enterRem();
  vi.stubEnv("DG_LLM_BUDGET", "garbage"); await expect(dream("all", 10)).rejects.toThrow("STRATEGY_FRACTIONS_INVALID");
  vi.unstubAllEnvs(); await expect(dream("gap_detection", 1, { entity_ids: ["absent"] })).rejects.toThrow("DREAM_FOCUS_UNKNOWN");
  expect(engine.getCurrentDreamCycle()).toBe(cycle);
  const scope = await prepareDream("gap_detection", 1, { entity_ids: ["a", "a"], hops: 0 }); expect([...scope.entities.keys()]).toEqual(["a"]);
});
it("legacy snapshot identity collision fails visibly and out-of-view links are explicitly omitted", async () => {
  await writeFile(join(directory, "workflows.json"), JSON.stringify([{ ...facts[0], steps: [] }]));
  await expect(buildFactSnapshot()).rejects.toThrow("STRATEGY_SNAPSHOT_IDENTITY_AMBIGUOUS");
  await writeFile(join(directory, "workflows.json"), "[]");
  await writeFile(join(directory, "features.json"), JSON.stringify([{ ...facts[0], links: [{ target: "external-capability", type: "capability", relationship: "reads", strength: "weak" }] }]));
  const result = await buildFactSnapshot(); expect(result.scope?.omitted_external_links).toBe(1); expect(result.edgeSet.size).toBe(0); expect(result.entities.get("a")?.links).toEqual([]);
});
