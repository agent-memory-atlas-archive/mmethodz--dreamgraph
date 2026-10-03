/**
 * DreamGraph Cognitive Dreamer — REM dream router.
 *
 * The dreamer analyzes the Fact Graph and generates speculative nodes
 * and edges via a portfolio of strategies. ALL output goes to
 * `dream_graph.json` via the cognitive engine; the dreamer NEVER
 * modifies the Fact Graph and NEVER produces user-facing output.
 *
 * After F-06 split, individual strategies live under `./strategies/`
 * and this file owns:
 *  - Persistent reviewed allocation with rotating bounded exploration
 *  - Per-strategy yield tracking
 *  - The public `dream()` router that orchestrates strategies, applies
 *    budget allocation, and persists with deduplication
 *
 * Advertisement and the eleven active executors share strategy-catalog.ts.
 * Historical reflective requests fail explicitly; they never become "all".
 */

import { logger } from "../utils/logger.js";
import { randomUUID } from "node:crypto";
import { readMetaDocument, emptyPortfolio, snapshotLearningHash, allocatePortfolioBudgets, checkPortfolioCapacity,
  appendPortfolioObservations, candidateAttribution, strategyCharge, strategyVersion, dreamClaimKey,
  portfolioSetting, type StrategyObservation } from "./strategy-portfolio.js";
import { engine } from "./engine.js";
import { executeDreamStrategy } from "./strategy-registry.js";
import { ACTIVE_STRATEGY_NAMES, STRATEGY_CATALOG, allocateStrategyBudgets } from "./strategy-catalog.js";
import type { DreamNode, DreamEdge, DreamStrategy } from "./types.js";

import { buildFactSnapshot, focusFactSnapshot, type FactSnapshot } from "./strategies/_shared.js";
// ---------------------------------------------------------------------------
// Public API — Dream Cycle
// ---------------------------------------------------------------------------

export interface DreamResult {
  nodes: DreamNode[];
  edges: DreamEdge[];
  duplicates_merged: number;
  /** Per-strategy yield for this cycle (adaptive selection tracking) */
  strategy_yields: Record<string, number>;
  /** Strategies that were skipped this cycle due to adaptive selection */
  skipped_strategies: string[];
  focus_entities: string[];
  strategy_outcomes?: Record<string, { status: "completed" | "failed" | "skipped"; budget: number; generated: number; persisted?: number; novel?: number; omitted_out_of_scope?: number; reason?: string }>;
}

export interface DreamFocus {
  entity_ids: string[];
  hops?: number;
  reason?: string;
}

/** Validate requests before a cycle changes state or applies decay. */
export async function prepareDream(strategy: DreamStrategy, maxDreams: number, focus?: DreamFocus): Promise<FactSnapshot> {
  if (strategy !== "all" && !ACTIVE_STRATEGY_NAMES.includes(strategy as any)) {
    throw new Error(STRATEGY_CATALOG.some(item => item.name === strategy) ? "STRATEGY_RETIRED: reflective has no autonomous executor" : "STRATEGY_UNKNOWN");
  }
  if (!Number.isSafeInteger(maxDreams) || maxDreams < 0 || maxDreams > 1000) throw new Error("STRATEGY_BUDGET_INVALID");
  if (new Set(focus?.entity_ids ?? []).size > 100) throw new Error("DREAM_FOCUS_LIMIT");
  const hops = focus?.hops ?? 2;
  if (!Number.isInteger(hops) || hops < 0 || hops > 4) throw new Error("DREAM_FOCUS_HOPS_INVALID");
  // Validate all fractions even when no model will be called.
  allocateStrategyBudgets(ACTIVE_STRATEGY_NAMES, maxDreams, strategyFractions());
  portfolioSetting("DG_BARREN_THRESHOLD", 3); portfolioSetting("DG_PROBE_INTERVAL", 6); portfolioSetting("DG_STRATEGY_HISTORY", 12);
  const fullSnapshot = await buildFactSnapshot();
  const focusIds = [...new Set(focus?.entity_ids ?? [])];
  if (focusIds.some(id => !fullSnapshot.entities.has(id))) throw new Error("DREAM_FOCUS_UNKNOWN; targeted scope was not broadened");
  return focusIds.length ? focusFactSnapshot(fullSnapshot, focusIds, hops) : fullSnapshot;
}

function strategyFractions() {
  return { llm: process.env.DG_LLM_BUDGET === undefined ? 0.35 : Number(process.env.DG_LLM_BUDGET),
    pgo: process.env.DG_PGO_BUDGET === undefined ? 0.15 : Number(process.env.DG_PGO_BUDGET) };
}

/**
 * Execute a dream cycle using the specified strategy.
 *
 * PRECONDITION: Engine must be in REM state.
 * The caller (cognitive register) handles state transitions.
 *
 * Enhanced with:
 * - Deduplication (duplicate suppression) instead of raw append
 * - Persistent reviewed utility and post-dedup novelty remain separate;
 *   barren runs reduce allocation without suppressing exploration.
 */
export async function dream(
  strategy: DreamStrategy = "all",
  maxDreams: number = 100,
  focus?: DreamFocus,
): Promise<DreamResult> {
  const snapshot = await prepareDream(strategy, maxDreams, focus);
  engine.assertState("rem", "dream");

  const focusIds = [...new Set(focus?.entity_ids ?? [])];
  if (maxDreams === 0) return { nodes: [], edges: [], duplicates_merged: 0, strategy_yields: {}, skipped_strategies: [], focus_entities: focusIds, strategy_outcomes: {} };

  const portfolio = (await readMetaDocument()).portfolio ?? emptyPortfolio();
  checkPortfolioCapacity(portfolio, maxDreams);
  const inputHash = snapshotLearningHash(snapshot), operationId = `dream:${randomUUID()}`;
  const observations: StrategyObservation[] = [];
  const cycle = engine.nextDreamCycle();
  logger.info(
    `REM dream cycle #${cycle} starting (strategy: ${strategy}, max: ${maxDreams})`,
  );

  logger.debug(
    `Fact snapshot: ${snapshot.entities.size} entities, ${snapshot.edgeSet.size} edges, ${snapshot.domains.size} domains` +
      (focusIds.length > 0 ? `; targeted around ${focusIds.length} changed entities (${focus?.reason ?? "unspecified"})` : ""),
  );

  let allNodes: DreamNode[] = [];
  let allEdges: DreamEdge[] = [];
  const strategyYields: Record<string, number> = {};
  const skippedStrategies: string[] = [];

  const allStrategies = [...ACTIVE_STRATEGY_NAMES] as DreamStrategy[];
  const strategiesToRun = strategy === "all" ? allStrategies : [strategy];
  const allocations = allocatePortfolioBudgets(portfolio, strategiesToRun, maxDreams, inputHash, strategyFractions());
  const strategyOutcomes: NonNullable<DreamResult["strategy_outcomes"]> = {};
  for (const name of strategiesToRun) {
    const budget = allocations[name];
    if (!budget) { strategyYields[name] = 0; strategyOutcomes[name] = { status: "skipped", budget: 0, generated: 0, reason: "zero_candidate_allocation" }; continue; }
    const started = performance.now();
    let rows: Array<DreamNode | DreamEdge> = [], failureAttempts: string[] = [];
    try {
      const result = await executeDreamStrategy(name, { snapshot, cycle, budget });
      failureAttempts = result.admission?.attempt_ids ?? [];
      rows = [...result.nodes, ...result.edges];
      allNodes.push(...result.nodes); allEdges.push(...result.edges);
      strategyYields[name] = result.nodes.length + result.edges.length;
      strategyOutcomes[name] = { status: "completed", budget, generated: result.nodes.length + result.edges.length + (result.tensions_raised ?? 0), ...(result.omitted_out_of_scope ? { omitted_out_of_scope: result.omitted_out_of_scope } : {}) };
    } catch (error) {
      failureAttempts = (error as { admission?: { attempt_ids?: string[] } })?.admission?.attempt_ids ?? [];
      strategyYields[name] = 0;
      strategyOutcomes[name] = { status: "failed", budget, generated: 0, reason: error instanceof Error ? error.message : "Strategy dependency failed" };
      logger.warn(`Dream strategy ${name}: ${strategyOutcomes[name].reason}`);
    }
    const attribution = candidateAttribution(rows);
    const attemptIds = [...new Set([...attribution.attempt_ids, ...failureAttempts])];
    const charge = await strategyCharge(attemptIds);
    observations.push({ id: `${operationId}:${name}`, strategy: name, version: strategyVersion(name), input_hash: inputHash,
      cycle, status: strategyOutcomes[name].status as "completed" | "failed", budget, generated: rows.length,
      persisted: 0, novel: 0, claim_keys: [], artifact_ids: [], ancestry: attribution.ancestry, elapsed_ms: performance.now() - started,
      attempt_ids: attemptIds, ...charge, ...(strategyOutcomes[name].reason ? { reason: strategyOutcomes[name].reason!.slice(0,4096) } : {}),
      recorded_at: new Date().toISOString() });
  }

  // Cap total output
  if (allNodes.length + allEdges.length > maxDreams) throw new Error("DREAM_COMBINED_OUTPUT_LIMIT");

  // The writer re-reads both stores; graph novelty and learning cannot commit separately.
  const dedup = await engine.publishDreamCandidates(allNodes, allEdges, { snapshot, operation_id: operationId,
    prepare_writes: async result => {
      const doc = await readMetaDocument();
      for (const observation of observations) {
        const rows = [...result.nodes, ...result.edges].filter(row => row.strategy === observation.strategy);
        observation.persisted = rows.length; observation.claim_keys = rows.map(row => dreamClaimKey(row, snapshot));
        observation.artifact_ids = rows.map(row => `${"from" in row ? "edge" : "node"}:${row.id}`);
        strategyYields[observation.strategy] = rows.length;
      }
      doc.portfolio = appendPortfolioObservations(doc.portfolio ?? emptyPortfolio(), observations);
      for (const observation of doc.portfolio.observations.filter(o => o.id.startsWith(operationId + ":")))
        Object.assign(strategyOutcomes[observation.strategy], { persisted: observation.persisted, novel: observation.novel });
      return [{ file: "meta_log.json", content: JSON.stringify(doc, null, 2) }];
    } });
  allNodes = dedup.nodes; allEdges = dedup.edges;
  const totalMerged = dedup.merged;

  logger.info(
    `REM dream cycle #${cycle} complete: ${allNodes.length} nodes, ${allEdges.length} edges ` +
      `(${totalMerged} duplicates suppressed; speculative output remains untrusted)` +
      (skippedStrategies.length > 0 ? ` [skipped: ${skippedStrategies.join(", ")}]` : ""),
  );

  return {
    nodes: allNodes,
    edges: allEdges,
    duplicates_merged: totalMerged,
    strategy_yields: strategyYields,
    skipped_strategies: skippedStrategies,
    focus_entities: focusIds,
    strategy_outcomes: strategyOutcomes,
  };
}
