import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDataDir, setDataDirOverride } from "../src/utils/paths.js";
import { releaseGraphWriter } from "../src/graph/writer-lease.js";
import { STRATEGY_CATALOG, ACTIVE_STRATEGY_NAMES, STRATEGY_NAMES, allocateStrategyBudgets } from "../src/cognitive/strategy-catalog.js";
import { executeDreamStrategy, type StrategyContext } from "../src/cognitive/strategy-registry.js";
import { focusFactSnapshot, type FactEntity, type FactSnapshot } from "../src/cognitive/strategies/_shared.js";
import { schemaGrounding } from "../src/cognitive/strategies/schema-grounding.js";
import { engine } from "../src/cognitive/engine.js";
import type { DreamEdge, TensionSignal } from "../src/cognitive/types.js";

let fixtureDirectory: string, previousDirectory: string;
beforeEach(async () => {
  previousDirectory = getDataDir();
  fixtureDirectory = await mkdtemp(join(tmpdir(), "dg-strategy-registry-"));
  setDataDirOverride(fixtureDirectory);
});
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  await releaseGraphWriter(fixtureDirectory); setDataDirOverride(previousDirectory);
  await rm(fixtureDirectory, { recursive: true, force: true });
});
function entity(id: string, extra: Partial<FactEntity> = {}): FactEntity {
  return { id, type: "feature", name: id, description: "", domain: "", keywords: [], source_repo: "", source_files: [], tags: [],
    category: "", links: [], steps: [], key_fields: [], relationships: [], descriptionTokens: new Set(), ...extra };
}
function link(target: string, relationship = "reads", strength = "medium") {
  return { target, type: "feature", relationship, strength, description: "Observed source relationship" };
}
function snapshot(...items: FactEntity[]): FactSnapshot {
  const edges = items.flatMap(e => e.links.map(l => `${e.id}|${l.target}`));
  return { entities: new Map(items.map(e => [e.id, e])), edgeSet: new Set(edges), domains: new Set(items.map(e => e.domain).filter(Boolean)),
    sourceFileIndex: new Map(), degree: new Map(items.map(e => [e.id, edges.filter(key => key.split("|").includes(e.id)).length])) };
}
function seeded(seed = 57) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }
function tension(entityId = "a"): TensionSignal {
  return { id: "t", type: "missing_link", domain: "shared", entities: [entityId], description: "Observed missing dependency",
    urgency: .7, resolved: false, first_seen: "2026-01-01T00:00:00Z", last_seen: "2026-01-01T00:00:00Z", ttl: 5, attempted: 0 } as TensionSignal;
}
function edge(name: string, from = "a", to = "b"): DreamEdge {
  return { id: "fixture-edge", from, to, type: "hypothetical", relation: "possible_connection", reason: "Fixture source anchor", confidence: .4,
    origin: "rem", created_at: "2026-01-01T00:00:00Z", dream_cycle: 1, strategy: name, ttl: 5, decay_rate: .1,
    reinforcement_count: 0, last_reinforced_cycle: 1, status: "candidate", activation_score: 0, plausibility: 0, evidence_score: 0, contradiction_score: 0 } as DreamEdge;
}
const shared = () => snapshot(entity("a", { domain: "shared" }), entity("b", { domain: "shared" }));
const unrelated = () => snapshot(entity("astronomy"), entity("pottery"));
const structuralCases: Array<{ name: string; positive: () => FactSnapshot; negative: () => FactSnapshot; extra?: Partial<StrategyContext> }> = [
  { name: "gap_detection", positive: shared, negative: unrelated },
  { name: "weak_reinforcement", positive: () => snapshot(entity("a", { links: [link("b", "reads", "weak"), link("c")] }), entity("b", { links: [link("c")] }), entity("c")),
    negative: () => snapshot(entity("a", { links: [link("b")] }), entity("b")) },
  { name: "cross_domain", positive: () => snapshot(entity("a", { domain: "client", keywords: ["session", "owner"] }), entity("b", { domain: "server", keywords: ["session", "owner"] })), negative: shared },
  { name: "missing_abstraction", positive: () => snapshot(entity("a", { links: [link("b"), link("c")] }), entity("b"), entity("c")),
    negative: () => snapshot(entity("a", { links: [link("b"), link("b"), link("unknown"), link("a")] }), entity("b")) },
  { name: "symmetry_completion", positive: () => snapshot(entity("a", { links: [link("b")] }), entity("b")),
    negative: () => snapshot(entity("a", { links: [link("b", "unknown_semantics"), link("a")] }), entity("b")) },
  { name: "tension_directed", positive: shared, negative: unrelated, extra: { tensions: [tension()] } },
  { name: "orphan_bridging", positive: () => snapshot(entity("a", { domain: "shared", keywords: ["owner"] }), entity("b", { domain: "shared", keywords: ["owner"] })), negative: unrelated },
  { name: "pgo_wave", positive: () => snapshot(...["a", "b", "c", "d"].map(id => entity(id, { domain: id }))), negative: unrelated },
  { name: "schema_grounding", positive: () => snapshot(entity("users", { name: "Users", type: "data_model" }), entity("db", { type: "datastore", tables: [{ name: "users" }] as any })), negative: unrelated },
];
describe("actual active structural executors (not paid/model usefulness)", () => {
  for (const fixture of structuralCases) {
    it(`${fixture.name}: positive output is speculative, bounded and does not mutate the snapshot`, async () => {
      const input = fixture.positive(); const before = structuredClone(input);
      const result = await executeDreamStrategy(fixture.name, { snapshot: input, cycle: 1, budget: 7, random: seeded(), ...fixture.extra });
      expect(result.nodes.length + result.edges.length).toBeGreaterThan(0);
      expect(result.nodes.length + result.edges.length + (result.tensions_raised ?? 0)).toBeLessThanOrEqual(7);
      expect(input).toEqual(before); expect(result.edges.every(e => e.status === "candidate" && e.origin === "rem" && e.from !== e.to)).toBe(true);
    });
    it(`${fixture.name}: negative and empty snapshots do not create unsupported output`, async () => {
      for (const input of [fixture.negative(), snapshot()]) {
        const result = await executeDreamStrategy(fixture.name, { snapshot: input, cycle: 1, budget: 7, random: seeded(), ...fixture.extra });
        expect(result.nodes).toEqual([]); expect(result.edges).toEqual([]); expect(result.tensions_raised ?? 0).toBe(0);
      }
    });
    it(`${fixture.name}: zero and tiny combined budgets never overflow`, async () => {
      for (const budget of [0, 1, 2, 3]) {
        const result = await executeDreamStrategy(fixture.name, { snapshot: fixture.positive(), cycle: 1, budget, random: seeded(), ...fixture.extra });
        expect(result.nodes.length + result.edges.length + (result.tensions_raised ?? 0)).toBeLessThanOrEqual(budget);
      }
    });
  }
  it("PGO reproduces semantic output with the same random seed", async () => {
    const input = structuralCases.find(c => c.name === "pgo_wave")!.positive();
    const semantic = (edges: DreamEdge[]) => edges.map(({ id, created_at, ...rest }) => rest);
    const run = () => executeDreamStrategy("pgo_wave", { snapshot: input, cycle: 1, budget: 7, random: seeded() });
    expect(semantic((await run()).edges)).toEqual(semantic((await run()).edges));
  });
  it("zero schema budget has no tension side effect; shared names never pick an arbitrary datastore", async () => {
    const record = vi.spyOn(engine, "recordTension").mockResolvedValue({} as never);
    const input = snapshot(entity("users", { type: "data_model" }), entity("db", { type: "datastore", tables: [{ name: "users" }, { name: "unused" }] as any }),
      entity("db2", { type: "datastore", tables: [{ name: "users" }] as any }));
    const original = structuredClone(input);
    expect(await schemaGrounding(input, 1, 0)).toEqual({ edges: [], tensions_raised: 0 }); expect(record).not.toHaveBeenCalled();
    const result = await schemaGrounding(input, 1, 1); expect(result.edges).toEqual([]); expect(result.tensions_raised).toBe(1);
    expect(record).toHaveBeenCalledOnce(); expect(input).toEqual(original);
  });
  it("tension inputs retain their attempted/review state", async () => {
    const tensions = [tension()]; const before = structuredClone(tensions);
    await executeDreamStrategy("tension_directed", { snapshot: shared(), cycle: 1, budget: 1, tensions }); expect(tensions).toEqual(before);
  });
});
describe("LLM execution boundary fixtures (a response port, no model quality claim)", () => {
  it("executes valid original candidate output and rejects dangling, self, overflow and falsely validated output", async () => {
    const input = shared();
    expect((await executeDreamStrategy("llm_dream", { snapshot: input, cycle: 1, budget: 1, llm: async () => ({ nodes: [], edges: [edge("llm_dream")] }) })).edges).toHaveLength(1);
    for (const edges of [[edge("llm_dream", "a", "missing")], [edge("llm_dream", "a", "a")], [edge("llm_dream"), { ...edge("llm_dream"), id: "second" }], [{ ...edge("llm_dream"), status: "validated" }]]) {
      await expect(executeDreamStrategy("llm_dream", { snapshot: input, cycle: 1, budget: 1, llm: async () => ({ nodes: [], edges } as any) })).rejects.toThrow(/STRATEGY_/);
    }
  });
  it("empty/zero skip the provider; dependency failure remains observable", async () => {
    const llm = vi.fn(async () => ({ nodes: [], edges: [] }));
    for (const context of [{ snapshot: snapshot(), budget: 1 }, { snapshot: shared(), budget: 0 }]) {
      expect(await executeDreamStrategy("llm_dream", { ...context, cycle: 1, llm })).toEqual({ nodes: [], edges: [] });
    }
    expect(llm).not.toHaveBeenCalled();
    await expect(executeDreamStrategy("llm_dream", { snapshot: shared(), cycle: 1, budget: 1, llm: async () => { throw new Error("fixture_refusal"); } })).rejects.toThrow("fixture_refusal");
  });
});
describe("actual causal replay with historical input fixtures", () => {
  function history(positive: boolean) {
    const date = (day: number) => `2026-01-${String(day).padStart(2, "0")}T00:00:00Z`;
    vi.spyOn(engine, "assertState").mockImplementation(() => {});
    vi.spyOn(engine, "loadDreamHistory").mockResolvedValue({ sessions: Array.from({ length: 12 }, (_, i) => ({ cycle_number: i + 1, timestamp: date(i + 1) })) } as any);
    const signals = positive ? [["a", 1], ["b", 2], ["a", 10], ["b", 11]] : [["a", 1], ["b", 11]];
    vi.spyOn(engine, "loadTensions").mockResolvedValue({ signals: signals.map(([id, day], i) => ({ ...tension(String(id)), id: `t${i}`, first_seen: date(Number(day)) })), resolved_tensions: [] } as any);
  }
  it("repeated precedence yields a bounded hypothesis, not causal fact or seeded reinforcement", async () => {
    history(true); const input = shared(); const before = structuredClone(input);
    const result = await executeDreamStrategy("causal_replay", { snapshot: input, cycle: 12, budget: 1 });
    expect(result.edges).toHaveLength(1); expect(result.edges[0]).toMatchObject({ from: "a", to: "b", status: "candidate", reinforcement_count: 0 });
    expect(input).toEqual(before);
  });
  it("insufficient history and empty/zero scopes cannot produce a causal candidate", async () => {
    history(false);
    for (const context of [{ snapshot: shared(), budget: 4 }, { snapshot: snapshot(), budget: 1 }, { snapshot: shared(), budget: 0 }]) {
      expect((await executeDreamStrategy("causal_replay", { ...context, cycle: 1 })).edges).toEqual([]);
    }
  });
  it("history outside the requested scope is omitted explicitly", async () => {
    const result = await executeDreamStrategy("causal_replay", { snapshot: snapshot(entity("a")), cycle: 1, budget: 1, causal: async () => [edge("causal_replay")] });
    expect(result).toMatchObject({ edges: [], omitted_out_of_scope: 1 });
  });
});
describe("catalogue, allocation and explicit scope", () => {
  it("every advertised choice has an active executor, aggregate dispatch or explicit retirement", async () => {
    expect(ACTIVE_STRATEGY_NAMES).toHaveLength(11); expect(new Set(STRATEGY_NAMES).size).toBe(13);
    expect(STRATEGY_NAMES.filter(n => !["all", "reflective"].includes(n)).sort()).toEqual([...ACTIVE_STRATEGY_NAMES].sort());
    expect(STRATEGY_CATALOG.find(c => c.name === "reflective")?.status).toBe("retired");
    await expect(executeDreamStrategy("reflective", { snapshot: shared(), cycle: 1, budget: 0 })).rejects.toThrow("STRATEGY_RETIRED");
    await expect(executeDreamStrategy("typo", { snapshot: shared(), cycle: 1, budget: 1 })).rejects.toThrow("STRATEGY_UNKNOWN");
  });
  it("allocation preserves every total including zero/tiny budgets and disabled model fractions", () => {
    for (let total = 0; total <= 1000; total++) {
      const budgets = allocateStrategyBudgets(ACTIVE_STRATEGY_NAMES, total);
      expect(Object.values(budgets).reduce((a, b) => a + b, 0)).toBe(total);
      expect(Object.values(budgets).every(n => Number.isSafeInteger(n) && n >= 0)).toBe(true);
    }
    expect(allocateStrategyBudgets(["llm_dream"], 7)).toEqual({ llm_dream: 7 });
    const disabled = allocateStrategyBudgets(ACTIVE_STRATEGY_NAMES, 100, { llm: 0, pgo: 0 }); expect(disabled.llm_dream).toBe(0); expect(disabled.pgo_wave).toBe(0);
    for (const total of [-1, NaN, .5, 1001]) expect(() => allocateStrategyBudgets(ACTIVE_STRATEGY_NAMES, total)).toThrow("STRATEGY_BUDGET_INVALID");
    expect(() => allocateStrategyBudgets(ACTIVE_STRATEGY_NAMES, 3, { llm: .8, pgo: .3 })).toThrow("STRATEGY_FRACTIONS_INVALID");
  });
  it("unknown focus rejects rather than broadening; zero hops and duplicate roots remain exact", () => {
    const input = snapshot(entity("a", { links: [link("b")] }), entity("b"));
    expect([...focusFactSnapshot(input, ["a", "a"], 0).entities.keys()]).toEqual(["a"]);
    expect(focusFactSnapshot(input, [], 0).entities.size).toBe(0);
    expect(() => focusFactSnapshot(input, ["missing"], 2)).toThrow("DREAM_FOCUS_UNKNOWN");
    expect(() => focusFactSnapshot(input, ["a"], -1)).toThrow("DREAM_FOCUS_HOPS_INVALID");
  });
});
