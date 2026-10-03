/** Operational strategy diagnostics and versioned portfolio; promotion volume is not accuracy.
 * The independent evaluation harness owns labeled calibration. Without its reviewed
 * labels this analysis cannot weaken truth gates, even when auto_apply is requested.
 */
import { readMetaDocument, emptyPortfolio, strategyScore, type StrategyPortfolio } from "./strategy-portfolio.js";
import { ACTIVE_STRATEGY_NAMES } from "./strategy-catalog.js";
import { nodeClaim } from "./normalization-publication.js";
import { getActiveScope } from "../instance/index.js";
import { loadCanonicalGraph, type CanonicalGraphRead } from "../graph/read-model.js";
import { withGraphRead, withGraphReconciliation } from "../utils/graph-reconciliation-barrier.js";
import { atomicWriteFile } from "../utils/atomic-write.js";
import { engine } from "./engine.js";
import { logger } from "../utils/logger.js";
import { dataPath } from "../utils/paths.js";
import {
  ALL_DREAM_STRATEGIES_NON_ALL,
  DEFAULT_TENSION_CONFIG,
} from "./types.js";
import type {
  DreamStrategy,
  DreamHistoryEntry,
  ValidationResult,
  ValidatedEdge,
  TensionSignal,
  ResolvedTension,
  TensionDomain,
  PromotionConfig,
  StrategyMetrics,
  CalibrationBucket,
  ThresholdRecommendation,
  DomainDecayProfile,
  MetaLogEntry,
  MetaLogFile,
} from "./types.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const metaLogPath = () => dataPath("meta_log.json");

// ---------------------------------------------------------------------------
// Safety Guards
// ---------------------------------------------------------------------------

const GUARDS = {
  promotion_confidence: { min: 0.55, max: 0.90 },
  promotion_plausibility: { min: 0.30, max: 0.80 },
  promotion_evidence: { min: 0.25, max: 0.80 },
  promotion_evidence_count: { min: 1, max: 5 },
  retention_plausibility: { min: 0.20, max: 0.60 },
  max_contradiction: { min: 0.15, max: 0.50 },
} as const;

const DECAY_GUARDS = {
  ttl: { min: 5, max: 60 },
  urgency_decay: { min: 0.005, max: 0.10 },
} as const;

/** Minimum confidence on a recommendation before auto_apply will act on it. */
const AUTO_APPLY_MIN_CONFIDENCE = 0.6;

/** Independent labeled accuracy is not inferred from graph promotion volume. */
export function computePortfolioMetrics(portfolio: StrategyPortfolio, graph: CanonicalGraphRead | null): StrategyMetrics[] {
  const supported = new Set<string>();
  if (graph) {
    for (const edge of graph.relationships) if (edge.kind === "validated" && edge.assertion_class === "validated_insight") supported.add(`edge:${edge.payload.id}`);
    for (const dream of graph.entities.filter(e => e.identity.kind === "dream_node")) {
      const claim = nodeClaim(dream.payload as unknown as import("./types.js").DreamNode, graph.instance_id);
      if (claim?.type !== "node") continue;
      const identity = claim.identity;
      if (graph.entities.some(node => node.identity.id === identity.id && node.identity.kind === identity.kind && node.identity.repository_id === identity.repository_id && node.payload.origin === "rem" && node.assertion_class === "validated_insight")) supported.add(`node:${dream.identity.id}`);
    }
  }
  return ACTIVE_STRATEGY_NAMES.map(strategy => {
    const runs = portfolio.observations.filter(o => o.strategy === strategy);
    const claims = new Map<string, boolean>();
    for (const run of runs) for (let i = 0; i < run.claim_keys.length; i++) claims.set(run.claim_keys[i], (claims.get(run.claim_keys[i]) ?? false) || supported.has(run.artifact_ids[i]));
    const total = claims.size, validated = [...claims.values()].filter(Boolean).length;
    let barren = 0; for (const run of [...runs].reverse()) { if (run.status !== "completed") continue; if (run.novel) break; barren++; }
    return { strategy, total_generated: total, total_validated: validated, precision: null,
      operational_promotion_rate: total ? validated / total : 0, evidence_state: graph ? "current" : "unavailable",
      tensions_resolved: null, recall: null, avg_validation_lag: null, consecutive_zero_yield: barren,
      recommended_weight: strategyScore(portfolio, strategy, runs.at(-1)?.input_hash ?? "unobserved") };
  });
}

/**
 * Compute per-domain optimal decay rates from tension history. Resolution
 * time uses the timestamp delta (ms) converted to an approximate cycle
 * count via a default cadence assumption â€” better than the previous
 * `initialTtl - r.original.ttl` arithmetic, which always evaluated to 0
 * because TTL is reset on resolution.
 */
function computeDomainDecayProfiles(
  activeTensions: TensionSignal[],
  resolvedTensions: ResolvedTension[],
): DomainDecayProfile[] {
  const domains = new Set<TensionDomain>();
  for (const t of activeTensions) domains.add(t.domain);
  for (const r of resolvedTensions) domains.add(r.original.domain);

  // Estimate one cycle â‰ˆ 60 seconds. This is intentionally rough; the
  // result is only used to suggest TTL multipliers, not to gate behavior.
  const MS_PER_CYCLE = 60_000;
  const initialTtl = DEFAULT_TENSION_CONFIG.default_tension_ttl;

  return [...domains].map((domain): DomainDecayProfile => {
    const domainResolved = resolvedTensions.filter(
      (r) => r.original.domain === domain,
    );

    const resolutionCycles = domainResolved
      .map((r) => {
        const startMs = new Date(r.original.first_seen).getTime();
        const endMs = new Date(r.resolved_at).getTime();
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
        return Math.max(0, (endMs - startMs) / MS_PER_CYCLE);
      })
      .filter((v): v is number => v !== null);

    const avgResolution =
      resolutionCycles.length > 0
        ? resolutionCycles.reduce((a, b) => a + b, 0) /
          resolutionCycles.length
        : initialTtl;

    const falsePositives = domainResolved.filter(
      (r) => r.resolution_type === "false_positive",
    ).length;
    const fpRate =
      domainResolved.length > 0
        ? falsePositives / domainResolved.length
        : 0;

    const recommendedTtl = Math.round(
      Math.max(
        DECAY_GUARDS.ttl.min,
        Math.min(DECAY_GUARDS.ttl.max, avgResolution * 1.5),
      ),
    );

    const recommendedDecay =
      fpRate > 0.5
        ? Math.min(
            DECAY_GUARDS.urgency_decay.max,
            DEFAULT_TENSION_CONFIG.tension_urgency_decay * 1.5,
          )
        : fpRate < 0.2
          ? Math.max(
              DECAY_GUARDS.urgency_decay.min,
              DEFAULT_TENSION_CONFIG.tension_urgency_decay * 0.7,
            )
          : DEFAULT_TENSION_CONFIG.tension_urgency_decay;

    return {
      domain,
      avg_resolution_cycles: Math.round(avgResolution * 10) / 10,
      false_positive_rate: Math.round(fpRate * 1000) / 1000,
      recommended_ttl: recommendedTtl,
      recommended_urgency_decay: Math.round(recommendedDecay * 10000) / 10000,
      current_ttl: initialTtl,
      current_decay: DEFAULT_TENSION_CONFIG.tension_urgency_decay,
    };
  });
}

// ---------------------------------------------------------------------------
// Meta Log I/O
// ---------------------------------------------------------------------------

const loadMetaLog = readMetaDocument;
async function appendMetaEntry(entry: MetaLogEntry): Promise<void> {
  await withGraphReconciliation(async () => {
    const doc = await readMetaDocument();
    doc.entries.push(entry); doc.entries = doc.entries.slice(-100);
    doc.metadata.total_entries = doc.entries.length; doc.metadata.schema_version = "1.2.0";
    doc.metadata.last_analysis = entry.timestamp;
    await atomicWriteFile(metaLogPath(), JSON.stringify(doc, null, 2));
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run metacognitive analysis and optionally auto-apply recommendations.
 *
 * @param windowSize Number of recent dream cycles to analyze (default 50).
 * @param autoApply  If true, apply recommended thresholds via in-memory
 *                   engine overrides. Overrides reset on restart.
 * @returns The analysis entry (also appended to meta_log.json).
 */
export async function runMetacognitiveAnalysis(
  windowSize: number = 50,
  autoApply: boolean = false,
): Promise<MetaLogEntry> {
  logger.info(
    `Metacognitive analysis: window=${windowSize}, auto_apply=${autoApply}`,
  );

  if (!Number.isSafeInteger(windowSize) || windowSize < 1 || windowSize > 2000) throw new Error("META_WINDOW_INVALID");
  const { history, tensions, graph, portfolio } = await withGraphRead(async () => ({
    history: await engine.loadDreamHistory(), tensions: await engine.loadTensions(),
    graph: await loadCanonicalGraph(getActiveScope()?.uuid ?? "legacy"), portfolio: (await readMetaDocument()).portfolio ?? emptyPortfolio(),
  }));
  const sessions = history.sessions.slice(-windowSize);
  const cycleWindow: [number, number] = sessions.length ? [sessions[0].cycle_number, sessions.at(-1)!.cycle_number] : [0, 0];
  const activeTensions = tensions.signals, resolvedTensions = tensions.resolved_tensions ?? [];
  const effectiveConfig = await engine.getEffectivePromotionConfig();
  const scopedPortfolio = { ...portfolio, observations: portfolio.observations.slice(-windowSize * ACTIVE_STRATEGY_NAMES.length) };
  const strategyMetrics = computePortfolioMetrics(scopedPortfolio, graph.state.availability === "available" ? graph : null);
  // Promotions are operational dispositions, not reference labels for confidence calibration.
  const calibrationBuckets: CalibrationBucket[] = [];
  const thresholdRecommendations: ThresholdRecommendation[] = [];

  // 3. Domain decay profiles
  const domainDecayProfiles = computeDomainDecayProfiles(
    activeTensions,
    resolvedTensions,
  );

  // Auto-apply
  const actionsTaken: MetaLogEntry["actions_taken"] = [];
  if (autoApply) {
    for (const rec of thresholdRecommendations) {
      if (rec.confidence < AUTO_APPLY_MIN_CONFIDENCE) continue;
      const guard = GUARDS[rec.parameter];
      if (!guard) continue;
      const clamped = Math.max(
        guard.min,
        Math.min(guard.max, rec.recommended_value),
      );
      const before = effectiveConfig[rec.parameter];
      // Avoid no-op writes
      if (Math.abs((before as number) - clamped) < 1e-6) continue;

      try {
        engine.setPromotionOverride(
          rec.parameter,
          clamped as PromotionConfig[typeof rec.parameter],
        );
        actionsTaken.push({
          type: "threshold_adjustment",
          parameter: rec.parameter,
          old_value: before as number,
          new_value: clamped,
          basis: rec.basis,
        });
        logger.info(
          `Metacognitive auto-tune: ${rec.parameter} ${before} -> ${clamped} (${rec.basis})`,
        );
      } catch (err) {
        logger.warn(
          `Metacognitive auto-tune failed for ${rec.parameter}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }

  const overallHealth = graph.state.availability !== "available" ? "graph evidence unavailable; accuracy unmeasured"
    : `Operational novelty and current corroboration observed; labeled accuracy unmeasured. ${portfolio.reviews.length} explicit usefulness reviews.`;

  const entry: MetaLogEntry = {
    graph_revision: graph.revision.graph_revision,graph_currency:graph.currency,graph_state:graph.state,metric_definition_version:"2.0.0", portfolio_revision: portfolio.revision,
    calibration_status: "independent_labels_unavailable",
    id: `meta_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    cycle_window: cycleWindow,
    window_size: sessions.length,
    effective_config: effectiveConfig,
    strategy_metrics: strategyMetrics,
    threshold_recommendations: thresholdRecommendations,
    domain_decay_profiles: domainDecayProfiles,
    calibration_buckets: calibrationBuckets,
    actions_taken: actionsTaken,
    overall_health: overallHealth,
  };

  await appendMetaEntry(entry);

  logger.info(
    `Metacognitive analysis complete: ${strategyMetrics.length} strategies, ` +
      `${thresholdRecommendations.length} recommendations, ` +
      `${actionsTaken.length} actions taken`,
  );

  return entry;
}

/** Load the full meta log file for resource serving. */
export async function getMetaLog(): Promise<MetaLogFile> {
  return loadMetaLog();
}
