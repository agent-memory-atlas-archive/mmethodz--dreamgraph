import { currentJob,withoutJobContext } from "./job-context.js";
import { observeRisk,riskEvent,riskRevision,riskDigest,verifyRiskClaim,type RiskObservation } from "./risk-lifecycle.js";
/**
 * DreamGraph Cognitive Engine — State machine and persistence.
 *
 * The engine manages the four cognitive states (AWAKE, REM, NORMALIZING, NIGHTMARE)
 * and enforces strict boundaries between them. It handles state transitions,
 * interruption protocol, dream graph I/O, and state introspection.
 *
 * State machine transitions:
 *   AWAKE → REM → NORMALIZING → AWAKE  (normal dream cycle)
 *   AWAKE → NIGHTMARE → AWAKE           (adversarial scan)
 *
 * Enhanced with:
 * - Dream decay: edges/nodes lose confidence and TTL each cycle
 * - Tension tracking: records what the system struggles with
 * - Dream history: audit trail of every cycle
 * - Strict promotion gate reporting
 *
 * Safety guarantees:
 * - FACT GRAPH is never modified by the cognitive system
 * - REM output is isolated to dream_graph.json
 * - Only normalization can promote edges to validated_edges.json
 * - Interrupted REM cycles quarantine in-progress data
 */

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as appConfig } from "../config/config.js";
import { logger } from "../utils/logger.js";
import { dataPath } from "../utils/paths.js";
import { loadJsonArray, invalidateCache } from "../utils/cache.js";
import { loadIndexableUIElements } from "../utils/ui-index.js";
import { getActiveCognitiveTuning } from "../instance/index.js";
import { atomicWriteFile } from "../utils/atomic-write.js";
import { withFileLock } from "../utils/mutex.js";
import { withGraphReconciliation } from "../utils/graph-reconciliation-barrier.js";
import { commitGraphWrites } from "../graph/publication.js";
import { readCognitiveStore } from "./cognitive-store.js";
import { deduplicateDreamCandidates } from "./dream-deduplication.js";
import { curateGraph, curationSuppressions, emptyCuration, decayArchiveWrites } from "./curation.js";
import { loadGraphMaintenanceState } from "./graph-maintenance-state.js";
import { loadPublicationState } from "../graph/publication.js";
import type { FactSnapshot } from "./strategies/_shared.js";
import { graphEventBus } from "../graph/events.js";
import { getLlmReadinessStatus } from "./llm-readiness.js";
import {
  buildTensionPlanContext,
  proposeResolutionCandidateFromPlan,
  type TensionPlanContext,
} from "./intervention.js";
import { executeEnrichSeedData } from "../tools/enrich-seed-data.js";
import type {
  CognitiveStateName,
  CognitiveState,
  DreamGraphFile,
  CandidateEdgesFile,
  ValidatedEdgesFile,
  DreamNode,
  DreamEdge,
  ValidationResult,
  ValidatedEdge,
  DecayConfig,
  TensionSignal,
  TensionFile,
  TensionDomain,
  TensionResolutionType,
  TensionResolutionAuthority,
  TensionResolutionStrategy,
  TensionResolutionCandidate,
  ResolvedTension,
  TensionConfig,
  DreamHistoryEntry,
  DreamHistoryFile,
  PromotionConfig,
  BootstrapState,
  BootstrapExitReason,
  BootstrapStatus,
} from "./types.js";
import type { Feature, Workflow, DataModelEntity, ResourceIndex, IndexEntry } from "../types/index.js";
import { DEFAULT_DECAY, DEFAULT_PROMOTION, DEFAULT_TENSION_CONFIG } from "./types.js";
import { validationPipelineCounts } from "./validation-pipeline.js";

// ---------------------------------------------------------------------------
// Path resolution (lazy — resolved at call time for instance mode support)
// ---------------------------------------------------------------------------

const dreamGraphPath     = () => dataPath("dream_graph.json");
const candidateEdgesPath = () => dataPath("candidate_edges.json");
const validatedEdgesPath = () => dataPath("validated_edges.json");
const tensionPath        = () => dataPath("tension_log.json");
const historyPath        = () => dataPath("dream_history.json");

// ---------------------------------------------------------------------------
// Cognitive Engine (Singleton)
// ---------------------------------------------------------------------------

interface ProvenanceCarrier {
  id?: string;
  source_repo?: unknown;
  source_files?: unknown;
  provenance_kind?: unknown;
  derived_from_node_ids?: unknown;
  human_asserted?: unknown;
  inspiration?: unknown;
}

interface SourceLessFactQuarantineResult {
  quarantined_nodes: number;
  quarantined_validated_edges: number;
  quarantined_candidate_results: number;
  quarantined_dream_nodes: number;
  quarantined_dream_edges: number;
  quarantined_active_tensions: number;
  quarantined_resolved_tensions: number;
  affected_node_ids: string[];
  quarantine_file: string;
  timestamp: string;
}

class CognitiveEngine {
  private state: CognitiveStateName = "awake";
  private lastStateChange: string = new Date().toISOString();
  private totalDreamCycles = 0;
  private totalNormalizationCycles = 0;
  private lastDreamCycle: string | null = null;
  private lastNormalization: string | null = null;
  private decayConfig: DecayConfig = { ...DEFAULT_DECAY };
  private tensionConfig: TensionConfig = { ...DEFAULT_TENSION_CONFIG };

  /**
   * In-memory promotion-config overrides applied on top of the policy
   * profile's `cognitive_tuning`. Set by metacognitive auto-tuning. Resets
   * on restart by design — auto-tuning never persists to disk.
   */
  private promotionOverrides: Partial<PromotionConfig> = {};

  /**
   * Reinforcement memory — edge fingerprints survive expiry.
   * When an edge decays away, its reinforcement count and peak confidence
   * are stored here. When the same edge is re-generated, it inherits this
   * history so evidence actually accumulates across incarnations.
   * Memory entries expire after 30 cycles of inactivity.
   */

  // -------------------------------------------------------------------------
  // Cold-start bootstrap state — ADR-096
  // -------------------------------------------------------------------------
  // On a fresh instance the strict promotion gate is unreachable because
  // entity-existence is required as evidence but no entities exist yet.
  // Cold-start mode relaxes the gate until the dual exit condition trips:
  //   (A) entity-count threshold reached
  //   (B) bootstrap window elapsed (cycles or wall-clock)
  // exit_reason MUST be populated on every exit (ADR-096 guard rail).
  // -------------------------------------------------------------------------
  private bootstrapState: BootstrapState = "cold_start";
  private bootstrapStartedAt: string | null = null;
  private bootstrapExitedAt: string | null = null;
  private bootstrapExitReason: BootstrapExitReason | null = null;
  /** Dream cycle counter snapshot at the moment cold-start began. */
  private bootstrapStartCycle = 0;

  /**
   * Tunable cold-start floors. Overridable via env for testing/telemetry tuning.
   * ADR-096 guard rails: relaxed floor MUST NOT exceed 0.50 confidence;
   * window MUST NOT exceed 24h.
   */
  private static readonly BOOTSTRAP_MIN_ENTITIES =
    Number(process.env.DG_BOOTSTRAP_MIN_ENTITIES) || 50;
  private static readonly BOOTSTRAP_MIN_VALIDATED_EDGES =
    Number(process.env.DG_BOOTSTRAP_MIN_VALIDATED_EDGES) || 10;
  private static readonly BOOTSTRAP_MAX_CYCLES =
    Number(process.env.DG_BOOTSTRAP_MAX_CYCLES) || 20;
  private static readonly BOOTSTRAP_MAX_HOURS = Math.min(
    Number(process.env.DG_BOOTSTRAP_MAX_HOURS) || 24,
    24 // ADR-096 guard rail: never exceed 24h
  );
  /** ADR-096 guard rail: relaxed confidence floor MUST NOT exceed 0.50. */
  private static readonly BOOTSTRAP_RELAXED_CONFIDENCE = Math.min(
    Number(process.env.DG_BOOTSTRAP_RELAXED_CONFIDENCE) || 0.5,
    0.5
  );

  /**
   * Hydrate counters from the persisted dream graph.
   * Called once at startup so the engine doesn't restart counting from 0
   * after a server restart.
   */
  async hydrate(): Promise<void> {
    try {
      const graph = await this.loadDreamGraph();
      if (graph.metadata.total_cycles > 0) {
        this.totalDreamCycles = graph.metadata.total_cycles;
        this.lastDreamCycle = graph.metadata.last_dream_cycle;
      }
      if (graph.metadata.total_normalization_cycles > 0) {
        this.totalNormalizationCycles = graph.metadata.total_normalization_cycles;
        this.lastNormalization = graph.metadata.last_normalization;
      }
      // ADR-096: hydrate cold-start bootstrap state.
      // Default is "cold_start" if metadata is silent (i.e. instance pre-dates this field).
      this.bootstrapState = graph.metadata.bootstrap_state ?? "cold_start";
      this.bootstrapStartedAt = graph.metadata.bootstrap_started_at ?? null;
      this.bootstrapExitedAt = graph.metadata.bootstrap_exited_at ?? null;
      this.bootstrapExitReason = graph.metadata.bootstrap_exit_reason ?? null;
      // If a mature instance is being upgraded (has cycles + validated edges already),
      // graduate it on hydrate so it doesn't unnecessarily re-enter cold-start.
      if (
        this.bootstrapState === "cold_start" &&
        this.bootstrapStartedAt === null &&
        this.totalNormalizationCycles >= CognitiveEngine.BOOTSTRAP_MAX_CYCLES
      ) {
        this.bootstrapState = "graduated";
        this.bootstrapExitedAt = new Date().toISOString();
        this.bootstrapExitReason = "window";
        logger.info(
          `Cognitive hydrate: graduating mature instance (${this.totalNormalizationCycles} normalization cycles) out of cold-start (exit_reason=window)`
        );
      }
      if (this.totalDreamCycles > 0 || this.totalNormalizationCycles > 0) {
        logger.info(
          `Cognitive engine hydrated: ${this.totalDreamCycles} dream cycles, ${this.totalNormalizationCycles} normalization cycles, bootstrap=${this.bootstrapState}`
        );
      }
    } catch (err) {
      // Fresh start — no graph yet (file missing is OK, parse error is not)
      if (existsSync(dreamGraphPath())) {
        logger.warn(`Cognitive hydrate: dream_graph.json exists but failed to parse — possible corruption: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  // -------------------------------------------------------------------------
  // State Machine
  // -------------------------------------------------------------------------

  /** Get current cognitive state name */
  getState(): CognitiveStateName {
    return this.state;
  }

  /** Assert that the engine is in a specific state */
  assertState(expected: CognitiveStateName, operation: string): void {
    currentJob()?.signal.throwIfAborted();
    if (this.state !== expected) {
      throw new Error(
        `COGNITIVE VIOLATION: "${operation}" requires state "${expected}" but current state is "${this.state}". ` +
          `State boundaries must be respected.`
      );
    }
  }

  /** Transition: AWAKE → REM */
  enterRem(): void {
    this.assertState("awake", "enterRem");
    this.state = "rem";
    this.lastStateChange = new Date().toISOString();
    logger.info("Cognitive state: AWAKE → REM (dreaming begins)");
  }

  /**
   * Apply cognitive tuning from the active policy profile.
   * Must be called after state transitions to sync decay/promotion config.
   * Safe to call multiple times — idempotent.
   */
  async applyCognitiveTuning(): Promise<void> {
    const tuning = await getActiveCognitiveTuning();
    this.decayConfig = {
      ttl: tuning.decay_ttl,
      decay_rate: tuning.decay_rate,
    };
    logger.debug(
      `Cognitive tuning applied: ttl=${tuning.decay_ttl}, decay_rate=${tuning.decay_rate}, ` +
      `promotion_confidence=${tuning.promotion_confidence}, evidence_count=${tuning.promotion_evidence_count}`
    );
  }

  /** Transition: REM → NORMALIZING */
  enterNormalizing(): void {
    this.assertState("rem", "enterNormalizing");
    this.state = "normalizing";
    this.lastStateChange = new Date().toISOString();
    logger.info("Cognitive state: REM → NORMALIZING (validation begins)");
  }

  /** Transition: NORMALIZING → AWAKE (natural wake) */
  wake(): void {
    this.assertState("normalizing", "wake");
    this.state = "awake";
    this.lastStateChange = new Date().toISOString();
    logger.info("Cognitive state: NORMALIZING → AWAKE (natural wake cycle complete)");
  }

  /** Transition: AWAKE → NIGHTMARE (adversarial dreaming) */
  enterNightmare(): void {
    this.assertState("awake", "enterNightmare");
    this.state = "nightmare";
    this.lastStateChange = new Date().toISOString();
    logger.info("Cognitive state: AWAKE → NIGHTMARE (adversarial scan begins)");
  }

  /** Transition: NIGHTMARE → AWAKE (adversarial scan complete) */
  wakeFromNightmare(): void {
    this.assertState("nightmare", "wakeFromNightmare");
    this.state = "awake";
    this.lastStateChange = new Date().toISOString();
    logger.info("Cognitive state: NIGHTMARE → AWAKE (adversarial scan complete)");
  }

  /** Transition: AWAKE → LUCID (interactive exploration) */
  enterLucid(): void {
    this.assertState("awake", "enterLucid");
    this.state = "lucid";
    this.lastStateChange = new Date().toISOString();
    logger.info("Cognitive state: AWAKE → LUCID (interactive exploration begins)");
  }

  /** Transition: LUCID → AWAKE (exploration complete) */
  wakeFromLucid(): void {
    this.assertState("lucid", "wakeFromLucid");
    this.state = "awake";
    this.lastStateChange = new Date().toISOString();
    logger.info("Cognitive state: LUCID → AWAKE (interactive exploration complete)");
  }

  /**
   * INTERRUPTION HANDLER
   *
   * If external input arrives during REM:
   * 1. Immediately stop REM processing
   * 2. Quarantine in-progress dream data
   * 3. Fast-normalize: mark unfinished items as interrupted
   * 4. Reset to AWAKE
   */
  async interrupt(): Promise<void> {
    if (this.state === "awake") return; // Already awake, nothing to do

    const previousState = this.state;
    logger.warn(`INTERRUPTION: Forcing wake from "${previousState}" state`);

    // Quarantine any in-progress dream data
    if (previousState === "rem" || previousState === "nightmare" || previousState === "lucid") {
      await this.quarantineDreams();
    }

    // Force to awake
    this.state = "awake";
    this.lastStateChange = new Date().toISOString();
    logger.info(`Cognitive state: ${previousState} → AWAKE (interrupted)`);
  }

  /** Mark all non-completed dream items as interrupted */
  private async quarantineDreams(): Promise<void> {
    try {
      const dreamGraph = await this.loadDreamGraph();
      let quarantined = 0;

      for (const edge of dreamGraph.edges) {
        if (edge.dream_cycle === this.totalDreamCycles && !edge.interrupted) {
          edge.interrupted = true;
          quarantined++;
        }
      }

      for (const node of dreamGraph.nodes) {
        if (node.dream_cycle === this.totalDreamCycles && !node.interrupted) {
          node.interrupted = true;
          quarantined++;
        }
      }

      if (quarantined > 0) {
        await this.saveDreamGraph(dreamGraph);
        logger.warn(`Quarantined ${quarantined} in-progress dream items`);
      }
    } catch {
      logger.error("Failed to quarantine dreams during interruption");
    }
  }

  // -------------------------------------------------------------------------
  // Cycle Tracking
  // -------------------------------------------------------------------------

  /** Increment dream cycle counter and return the new cycle number */
  nextDreamCycle(): number {
    this.totalDreamCycles++;
    this.lastDreamCycle = new Date().toISOString();
    return this.totalDreamCycles;
  }

  /** Increment normalization cycle counter */
  nextNormalizationCycle(): number {
    this.totalNormalizationCycles++;
    this.lastNormalization = new Date().toISOString();
    return this.totalNormalizationCycles;
  }

  /** Get current dream cycle number (without incrementing) */
  getCurrentDreamCycle(): number {
    return this.totalDreamCycles;
  }

  /** Get current normalization cycle number */
  getCurrentNormalizationCycle(): number {
    return this.totalNormalizationCycles;
  }

  // -------------------------------------------------------------------------
  // Cold-start bootstrap API — ADR-096
  // -------------------------------------------------------------------------

  /** Whether the engine is currently in cold-start bootstrap mode. */
  isColdStart(): boolean {
    return this.bootstrapState === "cold_start";
  }

  /**
   * Stamp the cold-start start timestamp the first time normalization runs
   * during cold-start. Idempotent: subsequent calls are no-ops.
   */
  markBootstrapStart(): void {
    if (this.bootstrapState !== "cold_start") return;
    if (this.bootstrapStartedAt !== null) return;
    this.bootstrapStartedAt = new Date().toISOString();
    this.bootstrapStartCycle = this.totalNormalizationCycles;
    logger.info(
      `Cold-start bootstrap started at ${this.bootstrapStartedAt} (cycle ${this.bootstrapStartCycle}); ` +
        `relaxed promotion gate active until exit (entities≥${CognitiveEngine.BOOTSTRAP_MIN_ENTITIES} & validated_edges≥${CognitiveEngine.BOOTSTRAP_MIN_VALIDATED_EDGES}, OR ${CognitiveEngine.BOOTSTRAP_MAX_CYCLES} cycles, OR ${CognitiveEngine.BOOTSTRAP_MAX_HOURS}h, whichever first)`
    );
  }

  /**
   * Evaluate the dual-condition exit (ADR-096). Pure function — does not
   * mutate engine state. Returns null if cold-start should continue, or
   * the exit reason if it should graduate.
   *
   * Dual condition (whichever fires first):
   *   (A) entity-count threshold reached
   *   (B) bootstrap window elapsed (cycles or wall-clock)
   */
  evaluateBootstrapExit(
    entityCount: number,
    validatedEdgeCount: number
  ): BootstrapExitReason | null {
    if (this.bootstrapState !== "cold_start") return null;
    // Defensive: if start was never marked, don't graduate yet.
    if (this.bootstrapStartedAt === null) return null;

    // Condition A — quality-based (entity-count + validated edges).
    if (
      entityCount >= CognitiveEngine.BOOTSTRAP_MIN_ENTITIES &&
      validatedEdgeCount >= CognitiveEngine.BOOTSTRAP_MIN_VALIDATED_EDGES
    ) {
      return "size";
    }

    // Condition B — window-based (cycles OR wall-clock).
    const cyclesInBootstrap = this.totalNormalizationCycles - this.bootstrapStartCycle;
    if (cyclesInBootstrap >= CognitiveEngine.BOOTSTRAP_MAX_CYCLES) return "window";
    const startedMs = Date.parse(this.bootstrapStartedAt);
    if (Number.isFinite(startedMs)) {
      const ageHours = (Date.now() - startedMs) / 3_600_000;
      if (ageHours >= CognitiveEngine.BOOTSTRAP_MAX_HOURS) return "window";
    }
    return null;
  }

  /**
   * Graduate from cold-start bootstrap. Records the exit timestamp and
   * reason in engine state and persists via the next saveDreamGraph().
   * exit_reason MUST be populated (ADR-096 guard rail).
   */
  async graduateBootstrap(reason: BootstrapExitReason): Promise<void> {
    if (this.bootstrapState !== "cold_start") return;
    this.bootstrapState = "graduated";
    this.bootstrapExitedAt = new Date().toISOString();
    this.bootstrapExitReason = reason;
    const cyclesInBootstrap =
      this.totalNormalizationCycles - this.bootstrapStartCycle;
    logger.info(
      `Cold-start bootstrap exited at ${this.bootstrapExitedAt} (exit_reason=${reason}, cycles_in_bootstrap=${cyclesInBootstrap}); ` +
        `strict promotion gate now active`
    );
    // Persist immediately by rewriting the dream graph (saveDreamGraph syncs
    // bootstrap fields). Caller may also save shortly after — that's fine,
    // saveDreamGraph is idempotent.
    try {
      const graph = await this.loadDreamGraph();
      await this.saveDreamGraph(graph);
    } catch (err) {
      logger.warn(
        `graduateBootstrap: failed to persist exit (will retry on next save): ${err instanceof Error ? err.message : err}`
      );
    }
  }

  /** Build the bootstrap status surfaced via cognitive_status. */
  getBootstrapStatus(): BootstrapStatus {
    let ageSeconds: number | null = null;
    if (this.bootstrapStartedAt) {
      const startedMs = Date.parse(this.bootstrapStartedAt);
      const endedMs = this.bootstrapExitedAt
        ? Date.parse(this.bootstrapExitedAt)
        : Date.now();
      if (Number.isFinite(startedMs) && Number.isFinite(endedMs)) {
        ageSeconds = Math.max(0, Math.round((endedMs - startedMs) / 1000));
      }
    }
    return {
      state: this.bootstrapState,
      started_at: this.bootstrapStartedAt,
      exited_at: this.bootstrapExitedAt,
      exit_reason: this.bootstrapExitReason,
      age_seconds: ageSeconds,
      cycles_in_bootstrap:
        this.bootstrapStartedAt === null
          ? 0
          : this.totalNormalizationCycles - this.bootstrapStartCycle,
      thresholds: {
        min_entities: CognitiveEngine.BOOTSTRAP_MIN_ENTITIES,
        min_validated_edges: CognitiveEngine.BOOTSTRAP_MIN_VALIDATED_EDGES,
        max_cycles: CognitiveEngine.BOOTSTRAP_MAX_CYCLES,
        max_hours: CognitiveEngine.BOOTSTRAP_MAX_HOURS,
        relaxed_confidence_floor:
          CognitiveEngine.BOOTSTRAP_RELAXED_CONFIDENCE,
      },
    };
  }

  /** Relaxed confidence floor in effect during cold-start (ADR-096). */
  getBootstrapRelaxedConfidenceFloor(): number {
    return CognitiveEngine.BOOTSTRAP_RELAXED_CONFIDENCE;
  }

  /** Get current decay config */
  getDecayConfig(): DecayConfig {
    return { ...this.decayConfig };
  }

  /** Get current tension config */
  getTensionConfig(): TensionConfig {
    return { ...this.tensionConfig };
  }

  /**
   * Resolve the effective `PromotionConfig`: policy-profile tuning merged
   * with any in-memory overrides set by metacognitive auto-tuning.
   */
  async getEffectivePromotionConfig(): Promise<PromotionConfig> {
    const tuning = await getActiveCognitiveTuning();
    const base: PromotionConfig = {
      promotion_confidence: tuning.promotion_confidence,
      promotion_plausibility: tuning.promotion_plausibility,
      promotion_evidence: tuning.promotion_evidence,
      promotion_evidence_count: tuning.promotion_evidence_count,
      retention_plausibility: tuning.retention_plausibility,
      max_contradiction: tuning.max_contradiction,
    };
    return { ...base, ...this.promotionOverrides };
  }

  /**
   * Read the currently active overrides (shallow copy). Empty object means
   * the engine is running with pure policy-profile tuning.
   */
  getPromotionOverrides(): Partial<PromotionConfig> {
    return { ...this.promotionOverrides };
  }

  /**
   * Apply a single in-memory override to the active promotion config.
   * Used by metacognitive auto-tuning. Caller is expected to clamp to
   * safe guard rails before calling.
   */
  setPromotionOverride<K extends keyof PromotionConfig>(
    parameter: K,
    value: PromotionConfig[K],
  ): void {
    this.promotionOverrides[parameter] = value;
    logger.info(`Promotion override set: ${String(parameter)} = ${value}`);
  }

  /** Drop all in-memory promotion overrides. */
  clearPromotionOverrides(): void {
    this.promotionOverrides = {};
    logger.info("Promotion overrides cleared — reverting to policy-profile tuning");
  }

  // -------------------------------------------------------------------------
  // File I/O — Dream Graph
  // -------------------------------------------------------------------------

  async loadDreamGraph(): Promise<DreamGraphFile> {
    return readCognitiveStore("dream_graph.json", this.emptyDreamGraphFile(), ["nodes", "edges"]);
  }

  private emptyDreamGraphFile(): DreamGraphFile {
    return {
      metadata: {
        description: "Dream Graph — REM-generated speculative nodes and edges. UNTRUSTED.",
        schema_version: "1.0.0",
        last_dream_cycle: null,
        total_cycles: this.totalDreamCycles,
        last_normalization: null,
        total_normalization_cycles: this.totalNormalizationCycles,
        created_at: new Date().toISOString(),
        bootstrap_state: this.bootstrapState,
        bootstrap_started_at: this.bootstrapStartedAt,
        bootstrap_exited_at: this.bootstrapExitedAt,
        bootstrap_exit_reason: this.bootstrapExitReason,
      },
      nodes: [],
      edges: [],
    };
  }

  async saveDreamGraph(data: DreamGraphFile): Promise<void> {
    // Always sync both lifecycle counters into metadata before persisting
    data.metadata.total_cycles = this.totalDreamCycles;
    data.metadata.total_normalization_cycles = this.totalNormalizationCycles;
    if (this.lastNormalization) data.metadata.last_normalization = this.lastNormalization;
    // ADR-096: persist cold-start bootstrap state alongside cycle counters.
    data.metadata.bootstrap_state = this.bootstrapState;
    data.metadata.bootstrap_started_at = this.bootstrapStartedAt;
    data.metadata.bootstrap_exited_at = this.bootstrapExitedAt;
    data.metadata.bootstrap_exit_reason = this.bootstrapExitReason;
    await withFileLock("dream_graph.json", async () => {
      await atomicWriteFile(dreamGraphPath(), JSON.stringify(data, null, 2));
    });
    logger.debug("Dream graph saved to disk");
  }

  async appendDreamNodes(nodes: DreamNode[]): Promise<void> {
    this.assertState("rem", "appendDreamNodes");
    const graph = await this.loadDreamGraph();
    graph.nodes.push(...nodes);
    graph.metadata.last_dream_cycle = new Date().toISOString();
    graph.metadata.total_cycles = this.totalDreamCycles;
    await this.saveDreamGraph(graph);
  }

  async appendDreamEdges(edges: DreamEdge[]): Promise<void> {
    this.assertState("rem", "appendDreamEdges");
    const graph = await this.loadDreamGraph();
    graph.edges.push(...edges);
    graph.metadata.last_dream_cycle = new Date().toISOString();
    graph.metadata.total_cycles = this.totalDreamCycles;
    await this.saveDreamGraph(graph);
  }

  // -------------------------------------------------------------------------
  // Dream Decay — edges/nodes lose confidence each cycle
  // -------------------------------------------------------------------------

  /**
   * Apply decay to all dream edges and nodes.
   * - Confidence reduced by decay_rate
   * - TTL decremented by 1
   * - Items with TTL <= 0 OR confidence <= 0 are removed (expired)
   * - Expired speculation is archived atomically for inspection;
   *   rediscovery never inherits confidence or evidence credit.
   *
   * Returns { decayedEdges, decayedNodes } = count of removed items.
   * Must be called during REM, before new dreams are appended.
   */
  async applyDecay(): Promise<{ decayedEdges: number; decayedNodes: number }> {
    this.assertState("rem", "applyDecay");
    return withGraphReconciliation(async () => {
      this.assertState("rem", "applyDecay");
      const graph = await this.loadDreamGraph(), currentCycle = this.totalDreamCycles;
      const tensionIds = new Set((await this.getUnresolvedTensions()).flatMap(t => t.entities));
      const expiredNodes: DreamNode[] = [], expiredEdges: DreamEdge[] = [];
      const decay = (row: DreamNode | DreamEdge): boolean => {
        // Corroborated/human history has evidence validity, never speculative TTL validity.
        if (row.status === "validated" || "promoted_at" in row && row.promoted_at || "from" in row && row.meta?.human_assertion) return false;
        if (row.status !== "rejected" && row.last_reinforced_cycle === currentCycle) return false;
        const relevant = "from" in row ? tensionIds.has(row.from) || tensionIds.has(row.to) : row.inspiration.some(id => tensionIds.has(id));
        const factor = row.status === "rejected" ? 2 : relevant ? .5 : 1;
        row.ttl = (row.ttl ?? this.decayConfig.ttl) - factor;
        row.confidence = Math.max(0, Math.round((row.confidence - (row.decay_rate ?? this.decayConfig.decay_rate) * factor) * 100) / 100);
        return row.ttl <= 0 || row.confidence <= 0;
      };
      // Archive original rows before changing TTL/confidence, preserving the inspection/undo record.
      graph.nodes = graph.nodes.filter(row => { const original = structuredClone(row); if (!decay(row)) return true; expiredNodes.push(original); return false; });
      const expiredIds = new Set(expiredNodes.map(n => n.id));
      graph.edges = graph.edges.filter(row => {
        const original = structuredClone(row);
        if (!expiredIds.has(row.from) && !expiredIds.has(row.to) && !decay(row)) return true;
        expiredEdges.push(original); return false;
      });
      const writes = expiredNodes.length || expiredEdges.length ? await decayArchiveWrites(expiredNodes, expiredEdges, currentCycle) : [];
      writes.push({ file: "dream_graph.json", content: JSON.stringify(graph, null, 2) });
      await commitGraphWrites({ writes, actor: "dream_decay", cause: "dream_decay",
        result: { decayedEdges: expiredEdges.length, decayedNodes: expiredNodes.length } });
      return { decayedEdges: expiredEdges.length, decayedNodes: expiredNodes.length };
    });
  }

  // -------------------------------------------------------------------------
  // Duplicate Suppression — rediscovery grants no confidence/evidence credit
  // -------------------------------------------------------------------------

  /**
   * Check for a similar existing edge and reinforce it instead of appending.
   * Similarity: same from/to (either direction) AND same relation prefix.
   *
   * **Enhanced**: New edges that match a reinforcement memory entry
   * inherit the accumulated reinforcement count and get a confidence
   * boost — evidence finally survives across edge incarnations.
   *
   * Returns the list of truly new edges (not duplicates).
   * Duplicates get their existing counterpart reinforced.
   */
  /** One publication contains both post-dedup candidates and their learning observations. */
  async publishDreamCandidates(nodes: DreamNode[], edges: DreamEdge[], options: {
    snapshot?: FactSnapshot;
    prepare_writes?: (result: ReturnType<typeof deduplicateDreamCandidates>) => Promise<Array<{ file: string; content: string }>>;
    operation_id?: string;
  } = {}) {
    this.assertState("rem", "publishDreamCandidates");
    return withGraphReconciliation(async () => {
      this.assertState("rem", "publishDreamCandidates");
      const graph = await this.loadDreamGraph();
      const suppressed = curationSuppressions((await loadGraphMaintenanceState()).curation ?? emptyCuration());
      const result = deduplicateDreamCandidates(graph, nodes, edges, options.snapshot, suppressed);
      graph.metadata.last_dream_cycle = new Date().toISOString();
      graph.metadata.total_cycles = this.totalDreamCycles;
      const writes = await options.prepare_writes?.(result) ?? [];
      writes.push({ file: "dream_graph.json", content: JSON.stringify(graph, null, 2) });
      await commitGraphWrites({ writes, actor: "dreamer", operation_id: options.operation_id,
        intent: { nodes, edges, cycle: this.totalDreamCycles }, cause: "dream_candidates",
        result: { node_ids: result.nodes.map(n => n.id), edge_ids: result.edges.map(e => e.id), merged: result.merged } });
      return result;
    });
  }
  async deduplicateAndAppendEdges(edges: DreamEdge[]): Promise<{ appended: DreamEdge[]; merged: number }> {
    const result = await this.publishDreamCandidates([], edges);
    return { appended: result.edges, merged: result.merged };
  }
  async deduplicateAndAppendNodes(nodes: DreamNode[]): Promise<{ appended: DreamNode[]; merged: number; id_mapping: Record<string, string | null> }> {
    const result = await this.publishDreamCandidates(nodes, []);
    return { appended: result.nodes, merged: result.merged, id_mapping: result.id_mapping };
  }

  // -------------------------------------------------------------------------
  // File I/O — Candidate Edges (normalization results)
  // -------------------------------------------------------------------------

  async loadCandidateEdges(): Promise<CandidateEdgesFile> {
    return readCognitiveStore("candidate_edges.json", this.emptyCandidateEdgesFile(), ["results"]);
  }

  private emptyCandidateEdgesFile(): CandidateEdgesFile {
    return {
      metadata: {
        description: "Normalization results — validation judgments on dream artifacts.",
        schema_version: "1.0.0",
        last_normalization: null,
        total_cycles: this.totalNormalizationCycles,
        created_at: new Date().toISOString(),
      },
      results: [],
    };
  }

  async saveCandidateEdges(data: CandidateEdgesFile): Promise<void> {
    await withFileLock("candidate_edges.json", async () => {
      await atomicWriteFile(candidateEdgesPath(), JSON.stringify(data, null, 2));
    });
    logger.debug("Candidate edges saved to disk");
  }

  async appendValidationResults(results: ValidationResult[]): Promise<void> {
    this.assertState("normalizing", "appendValidationResults");
    const candidates = await this.loadCandidateEdges();
    candidates.results.push(...results);
    candidates.metadata.last_normalization = new Date().toISOString();
    candidates.metadata.total_cycles = this.totalNormalizationCycles;
    await this.saveCandidateEdges(candidates);
    // Phase 3 / Slice 2: emit one event per latent candidate so the
    // Explorer can pulse the affected dream edge.
    const latent = results.filter((r) => r.status === "latent");
    for (const r of latent) {
      graphEventBus.emit("candidate.added", {
        affected_ids: [r.dream_id],
        payload: {
          dream_id: r.dream_id,
          dream_type: r.dream_type,
          confidence: r.confidence,
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // File I/O — Validated Edges (promoted dreams)
  // -------------------------------------------------------------------------

  async loadValidatedEdges(): Promise<ValidatedEdgesFile> {
    return readCognitiveStore("validated_edges.json", this.emptyValidatedEdgesFile(), ["edges"]);
  }

  private emptyValidatedEdgesFile(): ValidatedEdgesFile {
    return {
      metadata: {
        description: "Validated edges — dream-originated connections that passed normalization.",
        schema_version: "1.0.0",
        last_validation: null,
        total_validated: 0,
        created_at: new Date().toISOString(),
      },
      edges: [],
    };
  }

  async saveValidatedEdges(data: ValidatedEdgesFile): Promise<void> {
    await withFileLock("validated_edges.json", async () => {
      await atomicWriteFile(validatedEdgesPath(), JSON.stringify(data, null, 2));
    });
    logger.debug("Validated edges saved to disk");
  }

  /** Compatibility entry point: qualification and coherent publication belong to normalize(). */
  async promoteEdges(_edges: ValidatedEdge[]): Promise<void> {
    this.assertState("normalizing", "promoteEdges");
    throw new Error("NORMALIZATION_PUBLICATION_REQUIRED: direct promotion cannot bypass claim evidence and the C04 transaction; use normalize()");
  }

  private stringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim().length > 0) : [];
  }

  async promoteNodesToFactGraph(_nodes: DreamNode[]): Promise<{ promoted: number; skipped: number }> {
    this.assertState("normalizing", "promoteNodesToFactGraph");
    throw new Error("NORMALIZATION_PUBLICATION_REQUIRED: direct entity promotion cannot turn model provenance into facts; use normalize()");
  }

  /** Get the N most recently validated edges (for LLM dream context). */
  async getRecentValidatedEdges(n: number = 10): Promise<ValidatedEdge[]> {
    const validated = await this.loadValidatedEdges();
    return validated.edges
      .sort((a, b) => (b.validated_at ?? "").localeCompare(a.validated_at ?? ""))
      .slice(0, n);
  }

  // -------------------------------------------------------------------------
  // File I/O — Tension Log
  // -------------------------------------------------------------------------

  async loadTensions(): Promise<TensionFile> {
    const data=await readCognitiveStore("tension_log.json",this.emptyTensionFile(),["signals"],["resolved_tensions"]);
    data.metadata.revision??=0;return data;
  }

  private async persistTensions(data:TensionFile,additionalWrites:Array<{file:string;content:string}>=[]):Promise<void> {
    data.metadata.total_signals=data.signals.length;data.metadata.total_resolved=data.resolved_tensions?.length??0;
    data.metadata.last_updated=new Date().toISOString();data.metadata.revision=(data.metadata.revision??0)+1;
    const writes=await this.prepareTimeEvidence(data,(await this.loadDreamHistory()).sessions);
    const content=JSON.stringify(data,null,2);if(Buffer.byteLength(content)>16*1024*1024)throw new Error("RISK_STORE_CAPACITY_REQUIRES_ARCHIVE");
    await commitGraphWrites({actor:"tension_observation",cause:"tension_observation",writes:[{file:"tension_log.json",content},...writes,...additionalWrites]});
  }
  async saveTensions(data:TensionFile,additionalWrites:Array<{file:string;content:string}>=[]):Promise<void> {
    await withGraphReconciliation(()=>withFileLock("tension_log.json",async()=>{
      const current=await this.loadTensions();
      if((data.metadata.revision??0)!==current.metadata.revision)throw new Error("TENSION_REVISION_CONFLICT");
      await this.persistTensions(data,additionalWrites);
    }));
  }
  private async mutateTensions<T>(change:(data:TensionFile)=>Promise<{result:T;changed:boolean}>|{result:T;changed:boolean}):Promise<T> {
    return withGraphReconciliation(()=>withFileLock("tension_log.json",async()=>{
      const data=await this.loadTensions(),outcome=await change(data);if(outcome.changed)await this.persistTensions(data);return outcome.result;
    }));
  }
  /** Policy snapshot for the existing threat/tension compound publication. */
  riskPolicy():TensionConfig{return {...this.tensionConfig};}

  /** Called under the common writer; event/observation time and affected generations share the source publication. */
  private async prepareTimeEvidence(data:TensionFile,sessions:DreamHistoryEntry[]):Promise<Array<{file:string;content:string}>> {
      const { prepareTemporalObservations } = await import("./temporal-evidence.js");
      const { prepareCausalHypotheses } = await import("./causal.js");
      const temporal = await prepareTemporalObservations(data);
      const causal = await prepareCausalHypotheses(data, sessions);
      let affected: Array<{file:string;content:string}> = [];
      if (temporal.length || causal.length) {
        const { loadCanonicalGraph } = await import("../graph/read-model.js");
        const { graphIdentityKey } = await import("../graph/contracts.js");
        const { prepareEvidenceGeneration } = await import("../graph/change-obligations.js");
        const { timeDigest, loadTemporalObservations, readEvidenceStore } = await import("./temporal-evidence.js");
        const graph = await loadCanonicalGraph(process.env.DREAMGRAPH_INSTANCE_UUID || "legacy");
        const previousEvents=new Set((await loadTemporalObservations()).events.map(e=>e.id));
        const changedEntities=temporal.flatMap(w=>(JSON.parse(w.content).events as Array<{id:string;entities:string[]}>).filter(e=>!previousEvents.has(e.id)).flatMap(e=>e.entities));
        if(causal.length){
          const oldCausal=await readEvidenceStore("causal_graph.json") as {hypotheses?:Array<{id:string;cause_entity:string;effect_entity:string;applicability:string}>}|null;
          const previous={hypotheses:oldCausal?.hypotheses?.filter(h=>h.applicability==="current")};
          const next=(JSON.parse(causal[0].content).hypotheses as Array<{id:string;cause_entity:string;effect_entity:string;applicability:string}>).filter(h=>h.applicability==="current");
          const oldIds=new Set(previous?.hypotheses?.map(h=>h.id)),newIds=new Set(next.map(h=>h.id));
          for(const hypothesis of [...next.filter(h=>!oldIds.has(h.id)),...(previous?.hypotheses??[]).filter(h=>!newIds.has(h.id))])changedEntities.push(hypothesis.cause_entity,hypothesis.effect_entity);
        }
        const ids=[...new Set(changedEntities)];
        const scope: string[] = []; let unknown = false;
        for (const id of ids) {
          const matches = graph.entities.filter(e=>e.identity.id===id&&e.identity.repository_id&&["feature","workflow","data_model","capability","datastore","ui_element","auxiliary"].includes(e.identity.kind));
          if(matches.length!==1)unknown=true;else scope.push(graphIdentityKey(matches[0].identity));
        }
        if(ids.length)affected = await prepareEvidenceGeneration({id:"temporal:tension_observations",scope:scope.length&&scope.length<=100?scope:["temporal:impact_unknown"],
          fingerprint:timeDigest([temporal,causal]),unknown_impact:unknown||scope.length>100||!scope.length});
      }
      return [...temporal,...causal,...affected];
  }

  /**
   * Record a tension signal. If a similar tension already exists,
   * increment its occurrence count and urgency.
   * New: assigns domain group and TTL for decay.
   */
  async recordTension(signal:RiskObservation):Promise<TensionSignal> {
    const outcome=await this.mutateTensions(data=>{
      const observation=observeRisk(data,{...signal,domain:signal.domain??this.inferTensionDomain(signal.entities,signal.description)},this.tensionConfig);
      return {result:observation,changed:observation.changed};
    });
    if(outcome.changed)graphEventBus.emit("tension.created",{affected_ids:[outcome.signal.id,...outcome.signal.entities],payload:{tension_id:outcome.signal.id,type:outcome.signal.type,domain:outcome.signal.domain,urgency:outcome.signal.urgency}});
    return outcome.signal;
  }

  /**
   * Resolve a tension with full authority and reason tracking.
   * Moves the tension to resolved_tensions archive instead of deleting.
   * Sets urgency to 0 and marks resolved so it stops driving dreams.
   */
  async resolveTension(tensionId:string,resolvedBy:TensionResolutionAuthority="system",resolutionType:TensionResolutionType="confirmed_fixed",
    evidence?:string,recheckTtl?:number,options:{expected_revision?:number;verification_claim?:import("./normalization-evidence.js").NormalizationClaim}={}):Promise<ResolvedTension|null> {
    const resolved=await this.mutateTensions(async data=>{
      const index=data.signals.findIndex(s=>s.id===tensionId);if(index<0)return {result:null,changed:false};
      const signal=data.signals[index];riskRevision(signal,options.expected_revision);
      if(!evidence?.trim())throw new Error("RISK_RESOLUTION_RATIONALE_REQUIRED");
      if(resolutionType==="expired_unverified")throw new Error("RISK_EXPIRY_IS_INTERNAL_ONLY");
      let verification:ResolvedTension["verification"];
      if(resolvedBy==="system"){
        if(resolutionType!=="confirmed_fixed")throw new Error("RISK_HUMAN_DISPOSITION_REQUIRED");
        verification=await verifyRiskClaim(signal,options.verification_claim??signal.resolution_candidate?.verification_claim);
      }
      const now=new Date().toISOString();riskEvent(signal,"resolved",evidence,{authority:resolvedBy,type:resolutionType,verification},now);
      const archive:ResolvedTension={id:`${signal.id}@resolution:${signal.lifecycle_history!.at(-1)!.id}`,tension_id:tensionId,resolved_at:now,resolved_by:resolvedBy,resolution_type:resolutionType,evidence,
        recheck_ttl:recheckTtl,original:structuredClone(signal),resolution_state:verification?"verified":"human_disposition",verification};
      (data.resolved_tensions??=[]).push(archive);data.signals.splice(index,1);return {result:archive,changed:true};
    });
    if(resolved)graphEventBus.emit("tension.resolved",{affected_ids:[tensionId,...resolved.original.entities],payload:{tension_id:tensionId,resolved_by:resolvedBy,resolution_type:resolutionType}});
    return resolved;
  }

  /** TTL retires attention, never verifies a fix or false positive. */
  async applyTensionDecay():Promise<{expired:number;decayed:number}> {
    return this.mutateTensions(data=>{
      let expired=0,decayed=0;const survivors:TensionSignal[]=[];
      for(const signal of data.signals){if(signal.resolved)continue;
        signal.ttl=(signal.ttl??this.tensionConfig.default_tension_ttl)-1;
        signal.urgency=Math.round(Math.max(signal.urgency-this.tensionConfig.tension_urgency_decay,0)*100)/100;
        if(signal.ttl<=0||signal.urgency<this.tensionConfig.min_urgency_threshold){
          const now=new Date().toISOString();riskEvent(signal,"expired","Attention expired without verification",undefined,now);
          (data.resolved_tensions??=[]).push({id:`${signal.id}@resolution:${signal.lifecycle_history!.at(-1)!.id}`,tension_id:signal.id,resolved_at:now,resolved_by:"system",resolution_type:"expired_unverified",
            resolution_state:"expired_unverified",evidence:"TTL/urgency attention policy; risk correctness unverified",original:structuredClone(signal)});expired++;
        }else{survivors.push(signal);decayed++;}
      }
      data.signals=survivors;return {result:{expired,decayed},changed:expired+decayed>0};
    });
  }

  /** Recheck only stored verification predicates; overlapping entities are not contradictory proof. */
  async processRecheckWindows(affectedEntityIds?:string[]):Promise<number> {
    const outcome=await this.mutateTensions(async data=>{
      let reactivated=0,changed=false;const affected=affectedEntityIds?new Set(affectedEntityIds):null;
      const reopened:TensionSignal[]=[];
      const archived=(data.resolved_tensions??[]).filter(r=>!r.reopened_at&&(!affected||r.original.entities.some(id=>affected.has(id))));
      if(archived.length>1000)throw new Error("RISK_REVIEW_SCOPE_BOUND");
      for(const prior of archived){
        let reason:string|undefined;
        if(prior.verification){try{await verifyRiskClaim(prior.original,prior.verification.claim);}catch(error){reason=`Current resolution evidence requires review: ${String(error)}`;}}
        if(reason&&!data.signals.some(s=>s.id===prior.tension_id)){
          if(data.signals.length>=this.tensionConfig.max_active_tensions)throw new Error("RISK_ACTIVE_CAPACITY_REQUIRES_REVIEW");
          const now=new Date().toISOString(),signal={...structuredClone(prior.original),resolved:false,attempted:false,lifecycle:"review_required" as const,last_seen:now,ttl:this.tensionConfig.default_tension_ttl};
          delete signal.resolution_candidate;riskEvent(signal,"reopened",reason,{previous_resolution:prior.resolution_type},now);
          prior.reopened_at=now;prior.reappearance_reason=reason;data.signals.push(signal);reopened.push(signal);reactivated++;changed=true;
        }
        if(prior.recheck_ttl!==undefined&&prior.recheck_ttl>0){prior.recheck_ttl--;changed=true;}
      }
      return {result:{reactivated,reopened},changed};
    });
    for(const signal of outcome.reopened)graphEventBus.emit("tension.created",{affected_ids:[signal.id,...signal.entities],payload:{tension_id:signal.id,type:signal.type,domain:signal.domain,urgency:signal.urgency,reopened:true}});
    return outcome.reactivated;
  }

  /** Get unresolved tensions sorted by urgency, capped at max_active_tensions */
  async getUnresolvedTensions(): Promise<TensionSignal[]> {
    const tensions = await this.loadTensions();
    return tensions.signals
      .filter((s) => !s.resolved)
      .sort((a, b) => b.urgency - a.urgency)
      .slice(0, this.tensionConfig.max_active_tensions);
  }

  /** Get resolved tensions archive */
  async getResolvedTensions(): Promise<ResolvedTension[]> {
    const tensions = await this.loadTensions();
    return tensions.resolved_tensions ?? [];
  }

  /** Get tension stats grouped by domain */
  async getTensionsByDomain(): Promise<Record<string, { count: number; avg_urgency: number }>> {
    const tensions = await this.loadTensions();
    const groups: Record<string, { count: number; total_urgency: number }> = {};

    for (const s of tensions.signals) {
      if (s.resolved) continue;
      const d = s.domain ?? "general";
      if (!groups[d]) groups[d] = { count: 0, total_urgency: 0 };
      groups[d].count++;
      groups[d].total_urgency += s.urgency;
    }

    const result: Record<string, { count: number; avg_urgency: number }> = {};
    for (const [domain, stats] of Object.entries(groups)) {
      result[domain] = {
        count: stats.count,
        avg_urgency: Math.round((stats.total_urgency / stats.count) * 100) / 100,
      };
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Tension Resolution Lifecycle (Phase 4 #8)
  //
  // A two-phase pipeline that lets the system *propose* a fix for an open
  // tension and then *validate* whether the fix actually landed.
  //
  //   1. proposeTensionResolution  → stamps a candidate on the tension.
  //   2. runTensionResolverCycle   → bulk proposer (heuristic or injected LLM).
  //   3. validateResolutionCandidates → after the validation_window expires:
  //        - verifies an exact declared connection predicate using current
  //          independently supported canonical normalization,
  //        - otherwise retains the proposal and requests explicit review;
  //          timeout/wont_fix/action success cannot prove a disposition.
  //   4. getResolutionPipelineStats surfaces queue depth for cognitive_status.
  // -------------------------------------------------------------------------

  /** Stamp a resolution candidate onto an open tension (idempotent — overwrites). */
  async proposeTensionResolution(tensionId:string,candidate:Omit<TensionResolutionCandidate,"proposed_at">&{proposed_at?:string},expectedRevision?:number):Promise<TensionSignal|null> {
    return this.mutateTensions(data=>{
      const signal=data.signals.find(s=>s.id===tensionId&&!s.resolved);if(!signal)return {result:null,changed:false};riskRevision(signal,expectedRevision);
      if(!candidate.rationale?.trim()||!Number.isSafeInteger(candidate.validation_window)||candidate.validation_window<1||candidate.validation_window>100)throw new Error("RISK_PROPOSAL_INVALID");
      const intent={strategy:candidate.strategy,rationale:candidate.rationale,source:candidate.source,proposed_action:candidate.proposed_action,verification_claim:candidate.verification_claim};
      const id=riskDigest([tensionId,signal.observation_fingerprint,intent]);if(signal.resolution_candidate?.id===id)return {result:signal,changed:false};
      const proposal={...candidate,id,proposed_at:candidate.proposed_at??new Date().toISOString()};
      signal.proposal_history??=[];
      if(!signal.proposal_history.some(prior=>prior.id===id))signal.proposal_history.push(structuredClone(proposal));
      if(signal.proposal_history.length>1000)throw new Error("RISK_PROPOSAL_CAPACITY_REQUIRES_ARCHIVE");
      signal.resolution_candidate=proposal;signal.lifecycle="proposed";riskEvent(signal,"proposed",candidate.rationale,{proposal_id:id});return {result:signal,changed:true};
    });
  }

  async recordTensionAction(tensionId:string,proposalId:string,outcome:{state:"completed"|"failed"|"unknown";receipt_ids:string[];reason:string}):Promise<void> {
    const job=currentJob();
    if(job){const {EngineJobs}=await import("./jobs.js");
      // The legacy executor has no effect receipt bound to this intent. Even a
      // completed tool response cannot release the job's recovery ownership.
      await withoutJobContext(()=>new EngineJobs(job.directory).settleExternalEffect(job.id,`risk-action:${riskDigest([tensionId,proposalId])}`,false,`risk-outcome:${riskDigest(outcome)}`));}
    await this.mutateTensions(data=>{
      const signal=data.signals.find(s=>s.id===tensionId);if(!signal)throw new Error("RISK_ACTION_TARGET_UNAVAILABLE");
      const fingerprint=riskDigest([proposalId,outcome]);if(signal.lifecycle_history?.some(e=>e.kind==="action"&&e.details?.fingerprint===fingerprint))return {result:undefined,changed:false};
      if(!signal.proposal_history?.some(p=>p.id===proposalId))throw new Error("RISK_ACTION_PROPOSAL_UNAVAILABLE");
      riskEvent(signal,"action",outcome.reason,{proposal_id:proposalId,...outcome,fingerprint});signal.lifecycle="review_required";return {result:undefined,changed:true};
    });
  }

  /** Persist before dispatch; a lost result cannot authorize redispatch of this proposal. */
  async beginTensionAction(tensionId:string,proposalId:string):Promise<boolean> {
    return this.mutateTensions(async data=>{
      const signal=data.signals.find(s=>s.id===tensionId);if(!signal||signal.resolution_candidate?.id!==proposalId)throw new Error("RISK_ACTION_PROPOSAL_CHANGED");
      if(signal.lifecycle_history?.some(event=>event.kind==="action"&&event.details?.proposal_id===proposalId))return {result:false,changed:false};
      const job=currentJob();if(job){const {EngineJobs}=await import("./jobs.js");
        await new EngineJobs(job.directory).beginExternalEffect(job.id,job.fence,{id:`risk-action:${riskDigest([tensionId,proposalId])}`,kind:"risk_remediation",target:tensionId,payload_hash:riskDigest(signal.resolution_candidate.proposed_action)});}
      riskEvent(signal,"action","Action intent committed; result not yet known",{proposal_id:proposalId,state:"intent",receipt_ids:[]});return {result:true,changed:true};
    });
  }

  /**
   * Heuristic candidate generator. Maps tension type → a sensible default
   * strategy + rationale. Used when no LLM proposer is supplied.
   */
  private heuristicCandidate(sig: TensionSignal): Omit<TensionResolutionCandidate, "proposed_at"> {
    const window = 3;
    switch (sig.type) {
      case "missing_link":
        return {
          strategy: "merge",
          rationale: `Entities ${sig.entities.slice(0, 2).join(" / ")} repeatedly co-occur without a graph link — propose a direct edge or identity merge.`,
          validation_window: window,
          source: "heuristic",
        };
      case "weak_connection":
        return {
          strategy: "mediator",
          rationale: `Connection between ${sig.entities.slice(0, 2).join(" / ")} is weak — look for a third entity sitting on the bridge.`,
          validation_window: window,
          source: "heuristic",
        };
      case "ungrounded_dream":
        return {
          strategy: "wont_fix",
          rationale: `Dream remains ungrounded after ${sig.occurrences} observation(s); accept as speculative and close.`,
          validation_window: window,
          source: "heuristic",
        };
      case "hard_query":
        return {
          strategy: "reframe",
          rationale: `Query repeatedly fails to land — the question or expected schema may need restating.`,
          validation_window: window,
          source: "heuristic",
        };
      case "code_insight":
      default:
        return {
          strategy: "split",
          rationale: `Code-level signal suggests ${sig.entities[0] ?? "this entity"} is doing too much; consider splitting responsibilities.`,
          validation_window: window,
          source: "heuristic",
        };
    }
  }

  /**
   * Bulk proposer pass. Picks the top-N most urgent open tensions that don't
   * already carry a candidate and stamps one on each.
   *
   * v8.2.6 — the heuristic path now defers to the intervention engine
   * (`proposeResolutionCandidateFromPlan`) so each candidate carries a
   * concrete `proposed_action` (an `enrich_seed_data` payload or a
   * `resolve_tension` call) instead of a strategy keyword. When
   * `DREAMGRAPH_AUTO_APPLY_RESOLUTION_PLANS=1` is set, `graph_enrichment`
   * payloads are executed immediately so the next dream cycle can observe
   * the new edge and the validation pass can confirm it.
   */
  async runTensionResolverCycle(opts?: {
    maxSamples?: number;
    proposer?: (sig: TensionSignal) => Promise<Omit<TensionResolutionCandidate, "proposed_at"> | null> | Omit<TensionResolutionCandidate, "proposed_at"> | null;
  }): Promise<{ proposed: number; skipped: number; auto_applied: number }> {
    const maxSamples = Math.max(1, opts?.maxSamples ?? 5);
    const tensions = await this.loadTensions();
    const candidates = tensions.signals
      .filter((s) => !s.resolved && !s.resolution_candidate && !s.attempted)
      .sort((a, b) => b.urgency - a.urgency)
      .slice(0, maxSamples);

    if (candidates.length === 0) return { proposed: 0, skipped: 0, auto_applied: 0 };

    // Build the per-cycle planner context once (loads data_model + dream_graph).
    let planCtx: TensionPlanContext | null = null;
    try {
      planCtx = await buildTensionPlanContext();
    } catch (err) {
      logger.warn(
        `runTensionResolverCycle: failed to build plan context — falling back to keyword heuristic. ` +
        `Error: ${err instanceof Error ? err.message : err}`
      );
    }

    const autoApply = process.env.DREAMGRAPH_AUTO_APPLY_RESOLUTION_PLANS === "1"
      || process.env.DREAMGRAPH_AUTO_APPLY_RESOLUTION_PLANS === "true";

    let proposed = 0;
    let skipped = 0;
    let auto_applied = 0;
    for (const sig of candidates) {
      let candidate: Omit<TensionResolutionCandidate, "proposed_at"> | null = null;
      if (opts?.proposer) {
        try {
          candidate = await opts.proposer(sig);
        } catch (err) {
          logger.warn(
            `runTensionResolverCycle: proposer threw for ${sig.id} — falling back to heuristic. ` +
            `Error: ${err instanceof Error ? err.message : err}`
          );
        }
      }
      if (!candidate && planCtx) {
        try {
          candidate = proposeResolutionCandidateFromPlan(sig, planCtx);
        } catch (err) {
          logger.warn(
            `runTensionResolverCycle: intervention bridge threw for ${sig.id} — falling back to keyword heuristic. ` +
            `Error: ${err instanceof Error ? err.message : err}`
          );
        }
      }
      if (!candidate) candidate = this.heuristicCandidate(sig);
      if (!candidate) { skipped++; continue; }
      const stamped=await this.proposeTensionResolution(sig.id,candidate,sig.revision??0);
      if(!stamped){skipped++;continue;}
      proposed++;

      // Auto-apply: execute graph_enrichment payloads immediately.
      if (
        autoApply &&
        candidate.proposed_action &&
        "tool" in candidate.proposed_action &&
        candidate.proposed_action.tool === "enrich_seed_data"
      ) {
        if(!await this.beginTensionAction(sig.id,stamped.resolution_candidate!.id!)){skipped++;continue;}
        try {
          const action = candidate.proposed_action;
          const result = await executeEnrichSeedData({
            target: action.target,
            entries: action.entries,
            mode: action.mode,
          });
          if (result.success) {
            await this.recordTensionAction(sig.id,stamped.resolution_candidate!.id!,{state:"unknown",receipt_ids:[],reason:"Tool returned success but exposes no bound action receipt; inspect/recover before retry. Resolution remains unverified"});
            logger.info(
              `runTensionResolverCycle: auto-applied enrich_seed_data for ${sig.id} — ` +
              `${(result.data as { entries_inserted: number; entries_updated: number }).entries_inserted} new, ` +
              `${(result.data as { entries_inserted: number; entries_updated: number }).entries_updated} updated`
            );
          } else {
            await this.recordTensionAction(sig.id,stamped.resolution_candidate!.id!,{state:"unknown",receipt_ids:[],reason:`Tool failed; inspect possible partial effect before retry: ${result.error?.message}`});
            logger.warn(
              `runTensionResolverCycle: auto-apply for ${sig.id} failed — ${result.error?.code}: ${result.error?.message}`
            );
          }
        } catch (err) {
          await this.recordTensionAction(sig.id,stamped.resolution_candidate!.id!,{state:"unknown",receipt_ids:[],reason:String(err)});
          logger.warn(
            `runTensionResolverCycle: auto-apply for ${sig.id} threw — ` +
            `${err instanceof Error ? err.message : err}`
          );
        }
      }
    }
    return { proposed, skipped, auto_applied };
  }

  /**
   * Validation pass — runs each cycle. Decrements validation_window; when
   * window hits 0, classifies the candidate as confirmed / accepted / escalated
   * based on the current validated-edges graph.
   */
  async validateResolutionCandidates():Promise<{confirmed:number;accepted_wont_fix:number;escalated:number;awaiting:number}> {
    const outcome=await this.mutateTensions(async data=>{
      let confirmed=0,escalated=0,awaiting=0,changed=false;
      const resolved:TensionSignal[]=[];
      for(const signal of [...data.signals]){
        const candidate=signal.resolution_candidate;if(signal.resolved||!candidate)continue;changed=true;candidate.validation_window--;
        if(candidate.validation_window>0){awaiting++;continue;}
        let verification:ResolvedTension["verification"],failure="Proposal requires explicit human disposition or a declared current evidence predicate";
        if(candidate.verification_claim){try{verification=await verifyRiskClaim(signal,candidate.verification_claim);}catch(error){failure=String(error);}}
        if(verification){
          const now=new Date().toISOString();riskEvent(signal,"resolved","Declared connection predicate independently verified",{proposal_id:candidate.id,verification},now);
          (data.resolved_tensions??=[]).push({id:`${signal.id}@resolution:${signal.lifecycle_history!.at(-1)!.id}`,tension_id:signal.id,resolved_at:now,resolved_by:"system",resolution_type:"confirmed_fixed",resolution_state:"verified",
            evidence:"Current independently supported declared bridge",verification,original:structuredClone(signal)});
          data.signals=data.signals.filter(s=>s.id!==signal.id);resolved.push(signal);confirmed++;
        }else{
          signal.attempted=true;signal.lifecycle="review_required";riskEvent(signal,"review_required",failure,{proposal_id:candidate.id});delete signal.resolution_candidate;escalated++;
        }
      }
      return {result:{stats:{confirmed,accepted_wont_fix:0,escalated,awaiting},resolved},changed};
    });
    for(const signal of outcome.resolved)graphEventBus.emit("tension.resolved",{affected_ids:[signal.id,...signal.entities],payload:{tension_id:signal.id,resolved_by:"system",resolution_type:"confirmed_fixed"}});
    return outcome.stats;
  }

  /** Pipeline stats for cognitive_status. */
  async getResolutionPipelineStats(): Promise<{
    pending_candidates: number;
    by_strategy: Record<TensionResolutionStrategy, number>;
    awaiting_validation: number;
  }> {
    const tensions = await this.loadTensions();
    const by_strategy: Record<TensionResolutionStrategy, number> = {
      merge: 0, mediator: 0, split: 0, reframe: 0, wont_fix: 0,
    };
    let pending = 0;
    let awaiting = 0;
    for (const s of tensions.signals) {
      if (s.resolved || !s.resolution_candidate) continue;
      pending++;
      by_strategy[s.resolution_candidate.strategy]++;
      if (s.resolution_candidate.validation_window > 0) awaiting++;
    }
    return { pending_candidates: pending, by_strategy, awaiting_validation: awaiting };
  }

  /**
   * Infer the domain of a tension from the entity IDs and description.
   * Simple keyword-based heuristic.
   */
  private inferTensionDomain(entities: string[], description: string): TensionDomain {
    const text = [...entities, description].join(" ").toLowerCase();

    if (text.match(/rls|auth|login|jwt|password|session/)) return "security";
    if (text.match(/invoice|finvoice|billing|maventa|stamp_credit/)) return "invoicing";
    if (text.match(/sync|cloud_sync|bidirectional|realtime/)) return "sync";
    if (text.match(/stripe|resend|netvisor|openai|firebase|fcm|maventa|open_meteo/)) return "integration";
    if (text.match(/payroll|salary|worker_payroll|netvisor.*payroll/)) return "payroll";
    if (text.match(/report|pdf|export_pdf|export_history/)) return "reporting";
    if (text.match(/api_key|api_usage|pdf_as_a_service/)) return "api";
    if (text.match(/mobile|onboarding|dictation|gps|photo/)) return "mobile";
    if (text.match(/table|column|constraint|schema|migration|data_model/)) return "data_model";
    if (text.match(/signup|user_signup|account_deletion/)) return "auth";

    return "general";
  }

  private emptyTensionFile(): TensionFile {
    return {
      metadata: {
        description: "Tension Log -- signals that direct goal-oriented dreaming, with resolution archive.",
        schema_version: "2.0.0",
        total_signals: 0,
        total_resolved: 0,
        last_updated: null,
      },
      signals: [],
      resolved_tensions: [],
    };
  }

  // -------------------------------------------------------------------------
  // File I/O — Dream History
  // -------------------------------------------------------------------------

  async loadDreamHistory(): Promise<DreamHistoryFile> {
    return readCognitiveStore("dream_history.json", this.emptyHistoryFile(), ["sessions"]);
  }

  async appendHistoryEntry(entry: DreamHistoryEntry): Promise<void> {
    const committed=await withGraphReconciliation(()=>withFileLock("dream_history.json",async()=>{
      const history=await this.loadDreamHistory();
      const {timeDigest}=await import("./temporal-evidence.js");
      const prior=history.sessions.find(e=>entry.session_id?e.session_id===entry.session_id:e.timestamp===entry.timestamp&&e.cycle_number===entry.cycle_number);
      if(prior){if(timeDigest(prior)!==timeDigest(entry))throw new Error("HISTORY_IDENTITY_CONFLICT");return false;}
      history.sessions.push(entry);history.metadata.total_sessions=history.sessions.length;
      const writes=await this.prepareTimeEvidence(await this.loadTensions(),history.sessions);
      await commitGraphWrites({actor:"history_observation",cause:"history_observation",writes:[{file:"dream_history.json",content:JSON.stringify(history,null,2)},...writes]});
      return true;
    }));
    if(!committed)return;
    logger.debug(`Dream history entry recorded: session ${entry.session_id}`);
    // Phase 3 / Slice 2: appendHistoryEntry is the canonical "a cycle just
    // finished" signal — every dream/normalization/nightmare path funnels
    // through here at the end. Cheaper than instrumenting each strategy.
    graphEventBus.emit("dream.cycle.completed", {
      affected_ids: [],
      payload: {
        session_id: entry.session_id,
        strategy: (entry as { strategy?: string }).strategy ?? null,
      },
    });
  }

  private emptyHistoryFile(): DreamHistoryFile {
    return {
      metadata: {
        description: "Dream History — audit trail of every cognitive cycle.",
        schema_version: "1.0.0",
        total_sessions: 0,
        created_at: new Date().toISOString(),
      },
      sessions: [],
    };
  }

  // -------------------------------------------------------------------------
  // Clear / Reset
  // -------------------------------------------------------------------------

  private repoValues(value: unknown): string[] {
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed ? [trimmed] : [];
    }
    if (Array.isArray(value)) {
      return value
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.trim())
        .filter((v) => v.length > 0);
    }
    return [];
  }

  private hasRepoScope(entity: ProvenanceCarrier): boolean {
    return this.repoValues(entity.source_repo).length > 0;
  }

  private isDirectlyGrounded(entity: ProvenanceCarrier): boolean {
    return this.hasRepoScope(entity) && (
      this.stringArray(entity.source_files).length > 0 ||
      entity.human_asserted === true
    );
  }

  private buildGroundedCanonicalIdSet(entities: ProvenanceCarrier[]): Set<string> {
    const byId = new Map<string, ProvenanceCarrier>();
    const groundedIds = new Set<string>();

    for (const entity of entities) {
      if (!entity.id) continue;
      byId.set(entity.id, entity);
      if (this.isDirectlyGrounded(entity)) groundedIds.add(entity.id);
    }

    // Hubs are valid connective tissue when they are repo-scoped and their
    // supports already have a grounding path. Iterate to a fixed point so
    // hub→hub chains survive when their ends ultimately reach real nodes.
    let changed = true;
    while (changed) {
      changed = false;
      for (const entity of entities) {
        if (!entity.id || groundedIds.has(entity.id)) continue;
        if (!this.hasRepoScope(entity)) continue;
        const supports = this.stringArray(entity.derived_from_node_ids);
        if (supports.length > 0 && supports.every((id) => groundedIds.has(id))) {
          groundedIds.add(entity.id);
          changed = true;
        }
      }
    }

    return groundedIds;
  }

  private artifactTouchesIds(artifact: unknown, ids: Set<string>): boolean {
    if (ids.size === 0 || !artifact || typeof artifact !== "object") return false;
    const record = artifact as Record<string, unknown>;
    const scalarKeys = ["id", "dream_id", "from", "to", "source", "target"];
    for (const key of scalarKeys) {
      const value = record[key];
      if (typeof value === "string" && ids.has(value)) return true;
    }
    const arrayKeys = ["entities", "inspiration", "derived_from_node_ids", "affected_ids"];
    for (const key of arrayKeys) {
      const value = record[key];
      if (Array.isArray(value) && value.some((v) => typeof v === "string" && ids.has(v))) {
        return true;
      }
    }
    return false;
  }

  /**
   * Quarantine existing canonical/cognitive artifacts with no repository scope
   * or no provenance path back to repo evidence.
   *
   * This intentionally does NOT hard-code DreamGraph's own repository or any
   * assumed managed-project structure. The instance graph may describe any
   * project. The invariant is project-agnostic: canonical facts need at least
   * one `source_repo`, and source-less hubs are kept only when already
   * repo-scoped and derived from grounded source-backed/human/hub nodes.
   */
  async quarantineSourceLessFacts(): Promise<SourceLessFactQuarantineResult> {
    return withGraphReconciliation(() => this.quarantineSourceLessFactsUnlocked());
  }
  private async quarantineSourceLessFactsUnlocked(): Promise<SourceLessFactQuarantineResult> {
    const timestamp = new Date().toISOString();
    const quarantineFilename = `source_less_fact_quarantine_${timestamp.replace(/[:.]/g, "-")}.json`;
    const quarantineFile = dataPath(quarantineFilename);

    const [features, workflows, dataModel, dreamGraph, candidates, validated, tensions] = await Promise.all([
      loadJsonArray<Feature>("features.json"),
      loadJsonArray<Workflow>("workflows.json"),
      loadJsonArray<DataModelEntity>("data_model.json"),
      this.loadDreamGraph(),
      this.loadCandidateEdges(),
      this.loadValidatedEdges(),
      this.loadTensions(),
    ]);

    const canonicalEntities = [
      ...features.filter((e) => !("_schema" in e)),
      ...workflows.filter((e) => !("_schema" in e)),
      ...dataModel.filter((e) => !("_schema" in e)),
    ] as ProvenanceCarrier[];
    const ids = canonicalEntities.map(e => e.id).filter(Boolean);
    if (new Set(ids).size !== ids.length) throw new Error("QUARANTINE_TYPED_IDENTITY_REQUIRED");
    const groundedIds = this.buildGroundedCanonicalIdSet(canonicalEntities);
    const canonicalIds = new Set(canonicalEntities.map((e) => e.id).filter((id): id is string => typeof id === "string"));
    const affectedNodeIds = new Set<string>();

    for (const entity of canonicalEntities) {
      if (!entity.id) continue;
      const raw = entity as ProvenanceCarrier & Record<string, unknown>;
      const provenance = raw.provenance as Record<string, unknown> | undefined;
      const human = raw.human_asserted === true || raw.origin === "lucid" || raw.source_kind === "manual" || provenance?.kind === "manual" || ["human_asserted", "human", "manual"].includes(String(raw.provenance_kind));
      if (!groundedIds.has(entity.id) && !human) affectedNodeIds.add(entity.id);
    }

    const invalidCanonical = (entity: ProvenanceCarrier): boolean => !!entity.id && affectedNodeIds.has(entity.id);
    const keepFeature = (entity: Feature): boolean => ("_schema" in entity) || !invalidCanonical(entity as ProvenanceCarrier);
    const keepWorkflow = (entity: Workflow): boolean => ("_schema" in entity) || !invalidCanonical(entity as ProvenanceCarrier);
    const keepDataModel = (entity: DataModelEntity): boolean => ("_schema" in entity) || !invalidCanonical(entity as ProvenanceCarrier);

    const nextFeatures = features.filter(keepFeature);
    const nextWorkflows = workflows.filter(keepWorkflow);
    const nextDataModel = dataModel.filter(keepDataModel);
    const quarantinedNodes = [
      ...features.filter((e) => !keepFeature(e)),
      ...workflows.filter((e) => !keepWorkflow(e)),
      ...dataModel.filter((e) => !keepDataModel(e)),
    ];

    // Dream artifacts are not canonical facts, but a source-less phantom cloud
    // can keep regenerating invalid facts/tensions. Quarantine dream nodes that
    // either are the invalid canonical IDs or are source-less and disconnected
    // from a grounded canonical support path.
    const quarantinedDreamNodes = dreamGraph.nodes.filter((node) => {
      if (affectedNodeIds.has(node.id)) return true;
      if (this.artifactTouchesIds(node, affectedNodeIds)) return true;
      const carrier = node as ProvenanceCarrier;
      if (this.hasRepoScope(carrier)) return false;
      const supports = this.stringArray(carrier.inspiration).concat(this.stringArray(carrier.derived_from_node_ids));
      return supports.length === 0 || !supports.every((id) => groundedIds.has(id));
    });
    for (const node of quarantinedDreamNodes) affectedNodeIds.add(node.id);

    const quarantinedDreamNodeIds = new Set(quarantinedDreamNodes.map((node) => node.id));
    const quarantinedDreamEdges = dreamGraph.edges.filter((edge) =>
      affectedNodeIds.has(edge.from) ||
      affectedNodeIds.has(edge.to) ||
      this.artifactTouchesIds(edge, affectedNodeIds) ||
      (!canonicalIds.has(edge.from) && !groundedIds.has(edge.from) && quarantinedDreamNodeIds.has(edge.from)) ||
      (!canonicalIds.has(edge.to) && !groundedIds.has(edge.to) && quarantinedDreamNodeIds.has(edge.to))
    );
    for (const edge of quarantinedDreamEdges) affectedNodeIds.add(edge.id);

    const quarantinedValidatedEdges = validated.edges.filter((edge) =>
      affectedNodeIds.has(edge.from) ||
      affectedNodeIds.has(edge.to)
    );
    for (const edge of quarantinedValidatedEdges) affectedNodeIds.add(edge.id);

    const quarantinedCandidateResults = candidates.results.filter((result) =>
      this.artifactTouchesIds(result, affectedNodeIds)
    );

    const quarantinedActiveTensions = tensions.signals.filter((signal) =>
      this.artifactTouchesIds(signal, affectedNodeIds)
    );
    const quarantinedResolvedTensions = (tensions.resolved_tensions ?? []).filter((resolved) =>
      this.artifactTouchesIds(resolved, affectedNodeIds) ||
      this.artifactTouchesIds(resolved.original, affectedNodeIds)
    );

    const quarantineReport = {
      timestamp,
      invariant: "Canonical nodes require repo scope plus direct source files, explicit human assertion, or a grounded derived-hub chain. Hubs may connect to hubs when the chain reaches grounded repo nodes.",
      affected_node_ids: [...affectedNodeIds].sort(),
      canonical_nodes: quarantinedNodes,
      dream_nodes: quarantinedDreamNodes,
      dream_edges: quarantinedDreamEdges,
      validated_edges: quarantinedValidatedEdges,
      candidate_results: quarantinedCandidateResults,
      active_tensions: quarantinedActiveTensions,
      resolved_tensions: quarantinedResolvedTensions,
    };

    const writes = [{ file: quarantineFilename, content: JSON.stringify(quarantineReport, null, 2) },
      { file: "features.json", content: JSON.stringify(nextFeatures) },
      { file: "workflows.json", content: JSON.stringify(nextWorkflows) },
      { file: "data_model.json", content: JSON.stringify(nextDataModel) }];

    dreamGraph.nodes = dreamGraph.nodes.filter((node) => !quarantinedDreamNodes.some((q) => q.id === node.id));
    dreamGraph.edges = dreamGraph.edges.filter((edge) => !quarantinedDreamEdges.some((q) => q.id === edge.id));
    writes.push({ file: "dream_graph.json", content: JSON.stringify(dreamGraph) });

    candidates.results = candidates.results.filter((result) => !quarantinedCandidateResults.includes(result));
    writes.push({ file: "candidate_edges.json", content: JSON.stringify(candidates) });

    validated.edges = validated.edges.filter((edge) => !quarantinedValidatedEdges.includes(edge));
    validated.metadata.total_validated = validated.edges.length;
    writes.push({ file: "validated_edges.json", content: JSON.stringify(validated) });

    tensions.signals = tensions.signals.filter((signal) => !quarantinedActiveTensions.includes(signal));
    tensions.resolved_tensions = (tensions.resolved_tensions ?? []).filter((resolved) => !quarantinedResolvedTensions.includes(resolved));
    writes.push({ file: "tension_log.json", content: JSON.stringify(tensions) });

    let previousIndex: ResourceIndex = { entities: {} };
    try { previousIndex = JSON.parse(await readFile(dataPath("index.json"), "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (!previousIndex.entities || typeof previousIndex.entities !== "object" || Array.isArray(previousIndex.entities)) throw new Error("QUARANTINE_INDEX_INVALID");
    const entities: Record<string, IndexEntry> = { ...previousIndex.entities };
    for (const [key, value] of Object.entries(entities)) {
      if (!["feature", "workflow", "data_model"].includes(value.type)) continue;
      let indexedId = key;
      try {
        const uri = new URL(value.uri);
        const parts = uri.pathname.split("/").filter(Boolean);
        if (uri.protocol === "dreamgraph:" && uri.hostname === "resource" && parts.length === 2 && parts[0] === value.type) indexedId = decodeURIComponent(parts[1]);
      } catch { /* Preserve unrelated/unknown index addresses instead of guessing identity. */ }
      if (affectedNodeIds.has(indexedId)) delete entities[key];
    }
    for (const f of nextFeatures.filter((e) => !("_schema" in e))) {
      entities[f.id] = { type: "feature", uri: `dreamgraph://resource/feature/${f.id}`, name: f.name, source_repo: f.source_repo };
    }
    for (const w of nextWorkflows.filter((e) => !("_schema" in e))) {
      entities[w.id] = { type: "workflow", uri: `dreamgraph://resource/workflow/${w.id}`, name: w.name, source_repo: w.source_repo };
    }
    for (const d of nextDataModel.filter((e) => !("_schema" in e))) {
      entities[d.id] = { type: "data_model", uri: `dreamgraph://resource/data_model/${d.id}`, name: d.name, source_repo: d.source_repo };
    }
    // Slice 1 — first-class UI graph citizens. Only source-bound entries.
    for (const u of await loadIndexableUIElements()) {
      entities[u.id] = {
        type: "ui_element",
        uri: `dreamgraph://resource/ui_element/${u.id}`,
        name: u.name,
        source_repo: u.source_repo,
      };
    }
    const index: ResourceIndex = { entities };
    writes.push({ file: "index.json", content: JSON.stringify(index, null, 2) });
    await commitGraphWrites({ writes, actor: "source_less_quarantine", cause: "graph_maintenance", result: { quarantine_file: quarantineFilename, affected_ids: [...affectedNodeIds] } });
    writes.forEach(w => invalidateCache(w.file));

    const result: SourceLessFactQuarantineResult = {
      quarantined_nodes: quarantinedNodes.length,
      quarantined_validated_edges: quarantinedValidatedEdges.length,
      quarantined_candidate_results: quarantinedCandidateResults.length,
      quarantined_dream_nodes: quarantinedDreamNodes.length,
      quarantined_dream_edges: quarantinedDreamEdges.length,
      quarantined_active_tensions: quarantinedActiveTensions.length,
      quarantined_resolved_tensions: quarantinedResolvedTensions.length,
      affected_node_ids: [...affectedNodeIds].sort(),
      quarantine_file: quarantineFile,
      timestamp,
    };

    logger.warn(
      `Source-less fact quarantine complete: ${result.quarantined_nodes} canonical nodes, ` +
      `${result.quarantined_dream_nodes} dream nodes, ${result.quarantined_dream_edges} dream edges, ` +
      `${result.quarantined_validated_edges} validated edges, ${result.quarantined_candidate_results} candidates, ` +
      `${result.quarantined_active_tensions + result.quarantined_resolved_tensions} tensions. Report: ${quarantineFile}`
    );

    return result;
  }

  async clearDreamGraph(): Promise<void> {
    await this.saveDreamGraph(this.emptyDreamGraphFile());
    logger.info("Dream graph cleared");
  }

  async clearCandidateEdges(): Promise<void> {
    await this.saveCandidateEdges(this.emptyCandidateEdgesFile());
    logger.info("Candidate edges cleared");
  }

  async clearValidatedEdges(): Promise<void> {
    await this.saveValidatedEdges(this.emptyValidatedEdgesFile());
    logger.info("Validated edges cleared");
  }

  async clearTensions(): Promise<void> {
    await this.mutateTensions(data=>{
      const now=new Date().toISOString();
      for(const signal of data.signals){riskEvent(signal,"expired","Explicit attention reset; correctness unverified",undefined,now);
        (data.resolved_tensions??=[]).push({id:`${signal.id}@resolution:${signal.lifecycle_history!.at(-1)!.id}`,tension_id:signal.id,resolved_at:now,resolved_by:"system",resolution_type:"expired_unverified",
          resolution_state:"expired_unverified",evidence:"Explicit attention reset; original history retained",original:structuredClone(signal)});}
      const changed=data.signals.length>0;data.signals=[];return {result:undefined,changed};
    });
    logger.info("Tension attention cleared; history retained");
  }

  async clearHistory(): Promise<void> {
    await withFileLock("dream_history.json", async () => {
      await atomicWriteFile(historyPath(), JSON.stringify(this.emptyHistoryFile(), null, 2));
    });
    logger.info("Dream history cleared");
  }

  // -------------------------------------------------------------------------
  // Introspection (enhanced)
  // -------------------------------------------------------------------------

  async getStatus(): Promise<CognitiveState> {
    let dreamStats: CognitiveState["dream_graph_stats"] = {
      total_nodes: 0,
      total_edges: 0,
      latent_edges: 0,
      latent_nodes: 0,
      expiring_next_cycle: 0,
      avg_confidence: 0,
      avg_reinforcement: 0,
      avg_activation: 0,
    };
    let validatedStats: CognitiveState["validated_stats"] = { validated: 0, latent: 0, rejected: 0 };
    let tensionStats: CognitiveState["tension_stats"] = {
      total: 0,
      unresolved: 0,
      top_urgency: null,
    };

    try {
      const dreamGraph = await this.loadDreamGraph();
      const edges = dreamGraph.edges;
      const nodes = dreamGraph.nodes;
      const allItems = [...edges, ...nodes];

      const expiringEdges = edges.filter((e) => (e.ttl ?? 3) <= 1).length;
      const expiringNodes = nodes.filter((n) => (n.ttl ?? 3) <= 1).length;

      const avgConf =
        allItems.length > 0
          ? allItems.reduce((sum, item) => sum + item.confidence, 0) / allItems.length
          : 0;

      const avgReinf =
        allItems.length > 0
          ? allItems.reduce((sum, item) => sum + (item.reinforcement_count ?? 0), 0) / allItems.length
          : 0;

      const latentEdges = edges.filter((e) => e.status === "latent").length;
      const latentNodes = nodes.filter((n) => n.status === "latent").length;

      const activationItems = allItems.filter((i) => (i.activation_score ?? 0) > 0);
      const avgActivation =
        activationItems.length > 0
          ? activationItems.reduce((sum, i) => sum + (i.activation_score ?? 0), 0) / activationItems.length
          : 0;

      dreamStats = {
        total_nodes: nodes.length,
        total_edges: edges.length,
        latent_edges: latentEdges,
        latent_nodes: latentNodes,
        expiring_next_cycle: expiringEdges + expiringNodes,
        avg_confidence: Math.round(avgConf * 100) / 100,
        avg_reinforcement: Math.round(avgReinf * 100) / 100,
        avg_activation: Math.round(avgActivation * 100) / 100,
      };
    } catch (err) {
      logger.debug(`getStatus: dream graph stats unavailable: ${err instanceof Error ? err.message : err}`);
    }

    try {
      const candidates = await this.loadCandidateEdges();
      let promoted: unknown[] | null = null;
      try { promoted = (await this.loadValidatedEdges()).edges; } catch { /* promoted store optional for the pipeline counts */ }
      const pipeline = validationPipelineCounts(candidates.results, promoted);
      validatedStats = { validated: pipeline.validated, latent: pipeline.latent, rejected: pipeline.rejected, assessed: pipeline.assessed,
        validation_rate: pipeline.validation_rate, assessment_rows: pipeline.assessment_rows, latent_assessments: pipeline.latent_assessments,
        promoted_edges: pipeline.promoted_edges };
    } catch (err) {
      logger.debug(`getStatus: candidate edges stats unavailable: ${err instanceof Error ? err.message : err}`);
    }

    try {
      const tensions = await this.loadTensions();
      const unresolved = tensions.signals.filter((s) => !s.resolved);
      tensionStats = {
        total: tensions.signals.length,
        unresolved: unresolved.length,
        top_urgency:
          unresolved.length > 0
            ? unresolved.sort((a, b) => b.urgency - a.urgency)[0]
            : null,
      };
      // Phase 4 #8 — surface resolver pipeline stats. Best-effort.
      try {
        const pipeline = await this.getResolutionPipelineStats();
        if (pipeline.pending_candidates > 0 || pipeline.awaiting_validation > 0) {
          tensionStats.resolution_pipeline = pipeline;
        }
      } catch (err) {
        logger.debug(`getStatus: resolution pipeline stats unavailable: ${err instanceof Error ? err.message : err}`);
      }
    } catch (err) {
      logger.debug(`getStatus: tension stats unavailable: ${err instanceof Error ? err.message : err}`);
    }

    return {
      current_state: this.state,
      last_state_change: this.lastStateChange,
      total_dream_cycles: this.totalDreamCycles,
      total_normalization_cycles: this.totalNormalizationCycles,
      dream_graph_stats: dreamStats,
      validated_stats: validatedStats,
      tension_stats: tensionStats,
      last_dream_cycle: this.lastDreamCycle,
      last_normalization: this.lastNormalization,
      promotion_config: await (async () => {
        try {
          return await this.getEffectivePromotionConfig();
        } catch (err) {
          logger.debug(`getStatus: promotion config unavailable: ${err instanceof Error ? err.message : err}`);
          return DEFAULT_PROMOTION;
        }
      })(),
      decay_config: this.decayConfig,
      llm: await (async () => {
        try {
          const { getLlmProvider, getLlmConfig, getDreamerLlmConfig } = await import("./llm.js");
          const cfg = getLlmConfig();
          const provider = getLlmProvider();
          const available = await provider.isAvailable();
          return {
            provider: cfg.provider,
            model: getDreamerLlmConfig().model,
            available,
          };
        } catch (err) {
          logger.debug(`getStatus: LLM info unavailable: ${err instanceof Error ? err.message : err}`);
          return { provider: "none", model: "", available: false };
        }
      })(),
      // ADR-096: surface cold-start bootstrap status only once normalization
      // has actually run at least once (otherwise the field would be
      // misleading on a fresh, dormant instance).
      bootstrap:
        this.bootstrapStartedAt !== null || this.bootstrapState === "graduated"
          ? this.getBootstrapStatus()
          : undefined,
      // ADR-098 (Slice 2A): surface live LLM-readiness probe state. May be
      // null if the watcher hasn't completed its first probe yet.
      llm_readiness: getLlmReadinessStatus() ?? undefined,
      // ADR-098 (Slice 2B): per-fingerprint bootstrap audit log. Compact
      // tail (last 5 entries) keeps `cognitive_status` light for dashboards;
      // forensic consumers should read `data/llm_bootstrap_log.json`.
      bootstrap_history: await (async () => {
        try {
          const { getBootstrapHistory } = await import("./bootstrap-registry.js");
          const all = await getBootstrapHistory();
          return {
            total: all.length,
            recent: all.slice(-5),
          };
        } catch (err) {
          logger.debug(
            `getStatus: bootstrap history unavailable: ${err instanceof Error ? err.message : err}`,
          );
          return undefined;
        }
      })(),
    };
  }

  // -------------------------------------------------------------------------
  // Curated user mutations (Explorer Phase 4 / Slice 2)
  //
  // These three methods bypass the normal `assertState("normalizing")` gate
  // because they're driven by a human reviewer through the Explorer, not by
  // the autonomous dream loop. They are the *only* engine entry points the
  // mutation service is allowed to call. Each one:
  //   - leaves the state machine untouched
  //   - persists with the same locks the autonomous paths use
  //   - emits the same graph events (so existing consumers keep working)
  //   - returns enough data for the audit row (`affected_ids`)
  // -------------------------------------------------------------------------

  /**
   * Resolve a tension on behalf of a human operator. Wraps the existing
   * `resolveTension` (which already has no state precondition) so the
   * Explorer can call it from AWAKE.
   */
  async userResolveTension(
    tensionId: string,
    opts: {
      resolution_type?: TensionResolutionType;
      evidence?: string;
    } = {},
  ): Promise<{ resolved: ResolvedTension | null; affected_ids: string[] }> {
    const resolved = await this.resolveTension(
      tensionId,
      "human",
      opts.resolution_type ?? "confirmed_fixed",
      opts.evidence,
    );
    if (!resolved) return { resolved: null, affected_ids: [tensionId] };
    return {
      resolved,
      affected_ids: [tensionId, ...(resolved.original.entities ?? [])],
    };
  }

  /**
   * Promote a candidate (latent dream edge) into the validated edge store.
   * Locates the originating `DreamEdge` by `dream_id`, builds the
   * `ValidatedEdge`, removes the candidate's `ValidationResult`, persists
   * both files, and emits `candidate.promoted`.
   */
  async userPromoteCandidate(dreamId: string, options: { reason?: string; actor?: string; operation_id?: string;
    expected_revision?: string | null } = {}): Promise<{ edge: ValidatedEdge | null; affected_ids: string[]; candidate?: ValidationResult }> {
    return withGraphReconciliation(async () => {
      const candidates = await this.loadCandidateEdges();
      const candidate = candidates.results.filter(r => r.dream_id === dreamId && r.dream_type === "edge").sort((a,b) => b.normalization_cycle - a.normalization_cycle)[0];
      if (!candidate) return { edge: null, affected_ids: [dreamId] };
      const graph = await this.loadDreamGraph(), row = graph.edges.find(e => e.id === dreamId);
      if (!row) return { edge: null, affected_ids: [dreamId], candidate };
      await curateGraph({ target_id: dreamId, target_type: "edge", action: "assert", actor: options.actor ?? "operator",
        reason: options.reason ?? "Operator explicitly accepted this relationship as a human assertion", operation_id: options.operation_id,
        expected_revision: options.expected_revision === undefined ? (await loadPublicationState()).revision.graph_revision : options.expected_revision });
      const edge = (await this.loadValidatedEdges()).edges.find(e => e.id === `validated_${dreamId}`)!;
      graphEventBus.emit("candidate.promoted", { affected_ids: [row.from, row.to], payload: { from: row.from, to: row.to, actor: "human", assertion_class: "human_assertion" } });
      return { edge, affected_ids: [dreamId, row.from, row.to], candidate };
    });
  }

  /**
   * Reject a candidate (flip its `ValidationResult.status` to "rejected"
   * and persist). Does not delete — provenance is preserved. Emits
   * `candidate.rejected`.
   */
  async userRejectCandidate(dreamId: string, options: { reason?: string; actor?: string; operation_id?: string;
    expected_revision?: string | null; target_type?: "edge" | "node" } = {}): Promise<{ candidate: ValidationResult | null; affected_ids: string[] }> {
    return withGraphReconciliation(async () => {
      const candidates = await this.loadCandidateEdges();
      const matches = candidates.results.filter(r => r.dream_id === dreamId && (!options.target_type || r.dream_type === options.target_type));
      if (new Set(matches.map(r => r.dream_type)).size > 1) throw new Error("CURATION_TYPED_TARGET_REQUIRED");
      const candidate = matches.sort((a,b) => b.normalization_cycle - a.normalization_cycle)[0];
      if (!candidate) return { candidate: null, affected_ids: [dreamId] };
      const revision = (await loadPublicationState()).revision.graph_revision;
      await curateGraph({ target_id: dreamId, target_type: candidate.dream_type, action: "reject", actor: options.actor ?? "operator",
        reason: options.reason ?? "Operator explicitly rejected this candidate", operation_id: options.operation_id,
        expected_revision: options.expected_revision === undefined ? revision : options.expected_revision });
      const updated = { ...candidate, status: "rejected" as const, reason: options.reason ?? "Operator explicitly rejected this candidate" };
      graphEventBus.emit("candidate.rejected", { affected_ids: [dreamId], payload: { dream_id: dreamId, dream_type: candidate.dream_type } });
      return { candidate: updated, affected_ids: [dreamId] };
    });
  }

}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const engine = new CognitiveEngine();
