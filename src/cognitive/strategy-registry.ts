/** Actual execution shares the pure strategy catalogue; all output remains speculative. */
import { STRATEGY_CATALOG } from "./strategy-catalog.js";
import { engine } from "./engine.js";
import { causalReplayDream } from "./causal.js";
import { gapDetection } from "./strategies/gap-detection.js";
import { weakReinforcement } from "./strategies/weak-reinforcement.js";
import { crossDomainBridging } from "./strategies/cross-domain-bridging.js";
import { missingAbstraction } from "./strategies/missing-abstraction.js";
import { symmetryCompletion } from "./strategies/symmetry-completion.js";
import { tensionDirected } from "./strategies/tension-directed.js";
import { pgoWaveDream } from "./strategies/pgo-wave.js";
import { llmDream } from "./strategies/llm-dream.js";
import { orphanBridging } from "./strategies/orphan-bridging.js";
import { schemaGrounding } from "./strategies/schema-grounding.js";
import type { FactSnapshot } from "./strategies/_shared.js";
import type { DreamEdge, DreamNode, TensionSignal } from "./types.js";
export interface StrategyOutput { nodes: DreamNode[]; edges: DreamEdge[]; tensions_raised?: number; omitted_out_of_scope?: number;
  admission?: import("./model-execution.js").ModelCallAdmission; }
export interface StrategyContext { snapshot: FactSnapshot; cycle: number; budget: number; random?: () => number;
  tensions?: TensionSignal[]; causal?: () => Promise<DreamEdge[]>; llm?: () => Promise<StrategyOutput>; }
export async function executeDreamStrategy(name: string, context: StrategyContext): Promise<StrategyOutput> {
  const definition = STRATEGY_CATALOG.find(entry => entry.name === name);
  if (!definition) throw new Error("STRATEGY_UNKNOWN");
  if (definition.status !== "active") throw new Error(`STRATEGY_RETIRED:${name}; use explicit reviewed observations, not an unimplemented dream executor`);
  const { cycle, budget } = context;
  if (!Number.isSafeInteger(budget) || budget < 0 || budget > 1000) throw new Error("STRATEGY_BUDGET_INVALID");
  if (!budget || !context.snapshot.entities.size) return { nodes: [], edges: [] };
  const snapshot = structuredClone(context.snapshot);
  let output: StrategyOutput;
  switch (name) {
    case "gap_detection": output = { nodes: [], edges: gapDetection(snapshot, cycle, budget) }; break;
    case "weak_reinforcement": output = { nodes: [], edges: weakReinforcement(snapshot, cycle, budget) }; break;
    case "cross_domain": output = { nodes: [], edges: crossDomainBridging(snapshot, cycle, budget) }; break;
    case "missing_abstraction": output = missingAbstraction(snapshot, cycle, budget); break;
    case "symmetry_completion": output = { nodes: [], edges: symmetryCompletion(snapshot, cycle, budget) }; break;
    case "tension_directed": output = { nodes: [], edges: tensionDirected(snapshot, structuredClone(context.tensions ?? await engine.getUnresolvedTensions()), cycle, budget) }; break;
    case "causal_replay": {
      const raw = context.causal ? await context.causal() : await causalReplayDream(cycle, budget);
      const scoped = raw.filter(edge => snapshot.entities.has(edge.from) && snapshot.entities.has(edge.to));
      output = { nodes: [], edges: scoped, omitted_out_of_scope: raw.length - scoped.length }; break;
    }
    case "pgo_wave": output = { nodes: [], edges: pgoWaveDream(snapshot, cycle, budget, context.random) }; break;
    case "llm_dream": output = context.llm ? await context.llm() : await llmDream(snapshot, cycle, budget); break;
    case "orphan_bridging": {
      const configured = process.env.DG_ORPHAN_BUDGET;
      const cap = configured === undefined ? 20 : Number(configured);
      if (!Number.isSafeInteger(cap) || cap < 0 || cap > 1000) throw new Error("ORPHAN_BUDGET_INVALID");
      output = { nodes: [], edges: orphanBridging(snapshot, cycle, Math.min(budget, cap)) }; break;
    }
    case "schema_grounding": output = { nodes: [], ...await schemaGrounding(snapshot, cycle, budget) }; break;
    default: throw new Error("STRATEGY_EXECUTOR_MISSING");
  }
  // Reject invalid speculative output rather than persisting dangling endpoints
  // or presenting an undocumented overflow as a successful strategy.
  if (output.nodes.length + output.edges.length + (output.tensions_raised ?? 0) > budget) throw new Error("STRATEGY_OUTPUT_BUDGET_EXCEEDED");
  const ids = new Set(snapshot.entities.keys());
  for (const node of output.nodes) {
    if (!node.id || ids.has(node.id) || node.status !== "candidate" || node.origin !== "rem" || !Number.isFinite(node.confidence) || node.confidence < 0 || node.confidence > 1) throw new Error("STRATEGY_NODE_INVALID");
    ids.add(node.id);
    node.strategy = name as DreamNode["strategy"];
  }
  const edgeIds = new Set<string>();
  for (const edge of output.edges) {
    if (!edge.id || edgeIds.has(edge.id) || !ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to || edge.status !== "candidate" || edge.origin !== "rem" || edge.strategy !== name || !Number.isFinite(edge.confidence) || edge.confidence < 0 || edge.confidence > 1) throw new Error("STRATEGY_EDGE_INVALID");
    edgeIds.add(edge.id);
  }
  return output;
}
