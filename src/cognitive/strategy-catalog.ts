/** Pure strategy authority shared by advertisement, dispatch and allocation. */
export const STRATEGY_NAMES = ["gap_detection", "weak_reinforcement", "cross_domain", "missing_abstraction", "symmetry_completion", "tension_directed", "reflective", "causal_replay", "pgo_wave", "llm_dream", "orphan_bridging", "schema_grounding", "all"] as const;
export type StrategyName = typeof STRATEGY_NAMES[number];
export const STRATEGY_CATALOG = [
  { name: "llm_dream", description: "Grounded model-generated hypotheses", requirements: ["fact_snapshot", "admitted_dreamer_role"], status: "active", weight: 0.35 },
  { name: "pgo_wave", description: "Seedable stochastic divergence across observed entities", requirements: ["fact_snapshot", "four_entities"], status: "active", weight: 0.15 },
  { name: "gap_detection", description: "Missing links between entities with shared evidence", requirements: ["fact_snapshot"], status: "active", weight: 1 },
  { name: "weak_reinforcement", description: "Review weak existing relationships", requirements: ["fact_snapshot"], status: "active", weight: 1 },
  { name: "cross_domain", description: "Suggest bounded links across observed domains", requirements: ["fact_snapshot"], status: "active", weight: 1 },
  { name: "missing_abstraction", description: "Propose speculative hubs for sparse clusters", requirements: ["fact_snapshot"], status: "active", weight: 1 },
  { name: "symmetry_completion", description: "Suggest defined inverse relationships; unknown inverses stay unsupported", requirements: ["fact_snapshot"], status: "active", weight: 1 },
  { name: "tension_directed", description: "Suggest relationships within unresolved tension scope", requirements: ["fact_snapshot", "scoped_tensions"], status: "active", weight: 1 },
  { name: "causal_replay", description: "Replay tension history into speculative causal candidates", requirements: ["fact_snapshot", "tension_history"], status: "active", weight: 1 },
  { name: "orphan_bridging", description: "Attach isolated entities to plausible observed neighbors", requirements: ["fact_snapshot"], status: "active", weight: 1 },
  { name: "schema_grounding", description: "Scanned table evidence supports persistence hypotheses and bounded shadow-table tensions", requirements: ["fact_snapshot", "scanned_datastore_tables"], status: "active", weight: 1 },
  { name: "reflective", description: "Retired: no autonomous executor. Agent observations use explicit reviewed graph mutation commands", requirements: ["human_review"], status: "retired", weight: 0 },
] as const;
export const ACTIVE_STRATEGY_NAMES = STRATEGY_CATALOG.filter(item => item.status === "active").map(item => item.name);
export const STRATEGY_DESCRIPTION = STRATEGY_CATALOG.map(item => `${item.name}: ${item.description}.`).join(" ") + " all: run admitted active strategies within one combined candidate budget.";
export function allocateStrategyBudgets(names: readonly string[], total: number, fractions = { llm: 0.35, pgo: 0.15 }): Record<string, number> {
  if (!Number.isSafeInteger(total) || total < 0 || total > 1000) throw new Error("STRATEGY_BUDGET_INVALID");
  if (![fractions.llm, fractions.pgo].every(n => Number.isFinite(n) && n >= 0 && n <= 1) || fractions.llm + fractions.pgo > 1) throw new Error("STRATEGY_FRACTIONS_INVALID");
  if (new Set(names).size !== names.length || names.some(name => !ACTIVE_STRATEGY_NAMES.includes(name as any))) throw new Error("STRATEGY_SELECTION_INVALID");
  if (!names.length) return {};
  if (names.length === 1) return { [names[0]]: total };
  const other = names.filter(name => !["llm_dream", "pgo_wave"].includes(name));
  const llm = names.includes("llm_dream") ? fractions.llm : 0, pgo = names.includes("pgo_wave") ? fractions.pgo : 0;
  const raw = names.map(name => ({ name, weight: name === "llm_dream" ? llm : name === "pgo_wave" ? pgo : (1 - llm - pgo) / Math.max(1, other.length) }));
  const sum = raw.reduce((sum, entry) => sum + entry.weight, 0);
  if (sum === 0) return Object.fromEntries(names.map(name => [name, 0]));
  const allocations = raw.map(entry => { const exact = total * entry.weight / sum; return { ...entry, exact, count: Math.floor(exact) }; });
  let remaining = total - allocations.reduce((sum, entry) => sum + entry.count, 0);
  for (const entry of [...allocations].sort((a, b) => (b.exact - b.count) - (a.exact - a.count) || names.indexOf(a.name) - names.indexOf(b.name))) {
    if (remaining === 0) break; if (entry.weight === 0) continue; entry.count++; remaining--;
  }
  return Object.fromEntries(allocations.map(entry => [entry.name, entry.count]));
}
