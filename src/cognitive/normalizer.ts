/** Claim-specific normalization. Semantic fit guides exploration; independent source ancestry governs promotion.
 * ADR-241 preserves ADR-096 dual exit and exploration while removing relaxed factual corroboration.
 * Current proofs, candidates, promotion and their history publish through one C04 transaction.
 */

import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { curationSuppressions, emptyCuration } from "./curation.js";
import { normalizationClaimKey } from "./normalization-evidence.js";
import { commitGraphWrites, findOperationReceipt, type CommitGraphInput } from "../graph/publication.js";
import { assessClaimEvidence, claimCurrencyReasons, claimSourceScopes, NORMALIZATION_EVIDENCE_POLICY, type NormalizationClaim } from "./normalization-evidence.js";
import { readNormalizationSnapshot, snapshotDocument, edgeClaim, nodeClaim, publishNormalization, NORMALIZATION_SCOPE, type NormalizationSnapshot } from "./normalization-publication.js";
import { readNormalizationResult, NORMALIZATION_RESULT_LIMIT } from "./normalization-results.js";
import type { CanonicalGraphRead } from "../graph/read-model.js";
import type { GraphIdentity } from "../graph/contracts.js";
import { cognitiveProvenance, type CognitiveProvenance } from "./cognitive-provenance.js";
import { loadJsonArray } from "../utils/cache.js";
import { logger } from "../utils/logger.js";
import { engine } from "./engine.js";
import type { Feature, Workflow, DataModelEntity } from "../types/index.js";
import type {
  DreamEdge,
  DreamNode,
  DreamGraphFile,
  ValidationResult,
  ValidationEvidence,
  ValidatedEdge,
  NormalizationOutcome,
  NormalizationReasonCode,
} from "./types.js";
import { countEvidence, computeConfidence, DEFAULT_PROMOTION, type PromotionConfig } from "./types.js";
import { getRoleLlmProvider } from "./llm.js";
import type { LlmMessage } from "./llm.js";
import { resolveNormalizationStrictness } from "../instance/policies.js";

// ---------------------------------------------------------------------------
// Event-loop yielding (ADR-052)
// ---------------------------------------------------------------------------
// Synchronous CPU-bound passes over candidate edges/nodes can block the
// daemon's event loop on large dream graphs (1k+ items). We yield to the
// event loop every NORMALIZER_YIELD_BATCH iterations so HTTP requests,
// dashboard polling, and other async work stay responsive during a
// normalization cycle.
//
// TODO(F-12 worker-thread follow-up): if profiling shows CPU saturation
// dominating wall time, move PASS 1 scoring into a worker_threads pool.
// FactLookup needs serialization helpers (Maps/Sets → arrays) before that
// is viable. Tracked as a future iteration of ADR-052.
const NORMALIZER_YIELD_BATCH = 100;
const TENSION_CANDIDATE_LIMIT_PER_CYCLE = 5;
const RECURRENT_REJECTION_TENSION_MIN_REINFORCEMENT = 3;

const yieldToEventLoop = (): Promise<void> =>
  new Promise<void>((resolve) => setImmediate(resolve));

// ---------------------------------------------------------------------------
// Fact Graph lookup structures
// ---------------------------------------------------------------------------

interface FactLookup {
  /** All entity IDs that exist in the fact graph */
  entityIds: Set<string>;
  /** Entity → domain mapping */
  domains: Map<string, string>;
  /** Entity → keywords mapping */
  keywords: Map<string, string[]>;
  /** Entity → source_repo mapping */
  repos: Map<string, string>;
  /** Entity → type mapping */
  types: Map<string, GraphIdentity["kind"]>;
  /** Set of "from|to" for existing edges */
  edgeSet: Set<string>;
  /** Workflow step orderings for consistency checks */
  workflowSteps: Map<string, string[]>;
}

function buildFactLookup(graph: CanonicalGraphRead): FactLookup {
  const lookup: FactLookup = { entityIds: new Set(), domains: new Map(), keywords: new Map(), repos: new Map(), types: new Map(), edgeSet: new Set(), workflowSteps: new Map() };
  const facts = graph.entities.filter(e => ["feature", "workflow", "data_model", "capability", "datastore", "ui_element", "auxiliary"].includes(e.identity.kind));
  const counts = new Map<string, number>();
  for (const e of facts) counts.set(e.identity.id, (counts.get(e.identity.id) ?? 0) + 1);
  // Legacy heuristics do not guess when typed namespaces share an ID.
  for (const e of facts) {
    if (counts.get(e.identity.id) !== 1) continue;
    const id = e.identity.id, raw = e.payload;
    lookup.entityIds.add(id); lookup.domains.set(id, typeof raw.domain === "string" ? raw.domain : "");
    lookup.keywords.set(id, Array.isArray(raw.keywords) ? raw.keywords.filter((v): v is string => typeof v === "string") : []);
    lookup.repos.set(id, e.identity.repository_id ?? "");
    lookup.types.set(id, e.identity.kind);
    if (e.identity.kind === "workflow") lookup.workflowSteps.set(id, Array.isArray(raw.steps) ? raw.steps.map(s => String((s as { name?: unknown }).name ?? "")) : []);
  }
  for (const edge of graph.relationships.filter(e => e.kind === "fact" && e.source && e.target)) {
    if (counts.get(edge.source!.id) === 1 && counts.get(edge.target!.id) === 1) lookup.edgeSet.add(`${edge.source!.id}|${edge.target!.id}`);
  }
  return lookup;
}

// ---------------------------------------------------------------------------
// Validation checks
// ---------------------------------------------------------------------------

function checkEntityGrounding(
  edge: DreamEdge,
  lookup: FactLookup
): { fromExists: boolean; toExists: boolean } {
  return {
    fromExists: lookup.entityIds.has(edge.from),
    toExists: lookup.entityIds.has(edge.to),
  };
}

function checkDomainCoherence(
  edge: DreamEdge,
  lookup: FactLookup
): string[] {
  const domainA = lookup.domains.get(edge.from) ?? "";
  const domainB = lookup.domains.get(edge.to) ?? "";
  const overlap: string[] = [];
  if (domainA && domainB && domainA === domainB) {
    overlap.push(domainA);
  }
  return overlap;
}

function checkKeywordOverlap(
  edge: DreamEdge,
  lookup: FactLookup
): string[] {
  const kwA = lookup.keywords.get(edge.from) ?? [];
  const kwB = lookup.keywords.get(edge.to) ?? [];
  return kwA.filter((k) => kwB.includes(k));
}

function checkRepoCoherence(
  edge: DreamEdge,
  lookup: FactLookup
): boolean {
  const repoA = lookup.repos.get(edge.from) ?? "";
  const repoB = lookup.repos.get(edge.to) ?? "";
  if (!repoA || !repoB) return false;
  return repoA === repoB || repoA === "both" || repoB === "both";
}

function checkDuplicate(
  edge: DreamEdge,
  lookup: FactLookup
): boolean {
  // Only flag as duplicate if the EXACT same direction exists in the fact graph.
  // Symmetry-completion edges propose B→A when A→B exists — that's the point,
  // not a duplicate.  The reverse direction is new information.
  if (edge.strategy === "symmetry_completion") {
    return lookup.edgeSet.has(`${edge.from}|${edge.to}`);
  }
  return (
    lookup.edgeSet.has(`${edge.from}|${edge.to}`) ||
    lookup.edgeSet.has(`${edge.to}|${edge.from}`)
  );
}

function findContradictions(
  edge: DreamEdge,
  lookup: FactLookup
): string[] {
  const contradictions: string[] = [];

  // Check if the edge's from/to types conflict with the claimed type
  const fromType = lookup.types.get(edge.from);
  const toType = lookup.types.get(edge.to);

  if (
    edge.type !== "hypothetical" &&
    fromType &&
    toType &&
    edge.type !== fromType &&
    edge.type !== toType
  ) {
    contradictions.push(
      `Edge type "${edge.type}" doesn't match entity types: ${edge.from} is ${fromType}, ${edge.to} is ${toType}`
    );
  }

  return contradictions;
}

// ---------------------------------------------------------------------------
// Score calculation — split scoring (plausibility / evidence / contradiction)
// ---------------------------------------------------------------------------

interface SplitScore {
  plausibility: number;    // structural/semantic fit (0–1)
  evidence: number;        // grounding in actual graph (0–1)
  contradiction: number;   // conflict severity (0–1)
  confidence: number;      // combined score
  outcome: NormalizationOutcome;
  reason_code: NormalizationReasonCode;
}

function calculateSplitScore(
  grounding: { fromExists: boolean; toExists: boolean },
  domainOverlap: string[],
  keywordOverlap: string[],
  repoMatch: boolean,
  isDuplicate: boolean,
  contradictions: string[],
  originalConfidence: number,
  reinforcementCount: number,
  promo: PromotionConfig = DEFAULT_PROMOTION
): SplitScore {
  // --- Contradiction Score (0–1) ---
  let contradictionScore = 0;
  if (!grounding.fromExists && !grounding.toExists) {
    // Both endpoints missing — strong negative signal but not instant death.
    // After init_graph populates the fact graph, this case is rare; when it
    // does occur the edge likely references entities that don't exist *yet*
    // (e.g. dreamer-invented IDs).  A score of 0.5 is a heavy penalty but
    // still allows well-supported edges through on reinforcement.
    contradictionScore = 0.5;
  } else if (!grounding.fromExists || !grounding.toExists) {
    // One endpoint missing ≠ contradiction — it may not exist *yet*
    // This is "insufficient evidence", not "bad evidence"
    contradictionScore = 0;
  }
  if (isDuplicate) {
    contradictionScore = Math.max(contradictionScore, 0.8); // hard duplicate
  }
  if (contradictions.length > 0) {
    contradictionScore = Math.max(
      contradictionScore,
      Math.min(contradictions.length * 0.4, 1.0)
    );
  }

  // --- Plausibility Score (0–1): structural/semantic fit ---
  let plausibility = 0;
  // Domain coherence contributes strongly to plausibility
  if (domainOverlap.length > 0) plausibility += 0.35;
  // Keyword overlap is structural fit
  plausibility += Math.min(keywordOverlap.length * 0.1, 0.35);
  // Repo coherence implies architectural relatedness
  if (repoMatch) plausibility += 0.15;
  // Original dreamer confidence reflects pattern quality
  plausibility += originalConfidence * 0.15;
  // Reinforcement bonus: persistent ideas are inherently more plausible
  plausibility += Math.min(reinforcementCount * 0.06, 0.15);
  plausibility = Math.round(Math.min(Math.max(plausibility, 0), 1) * 100) / 100;

  // --- Evidence Score (0–1): grounding in actual data ---
  let evidenceScore = 0;
  // Entity grounding is the strongest evidence signal
  if (grounding.fromExists) evidenceScore += 0.25;
  if (grounding.toExists) evidenceScore += 0.25;
  // Domain overlap also counts as evidence of factual alignment
  if (domainOverlap.length > 0) evidenceScore += 0.2;
  // Keyword matches are evidence of semantic grounding
  evidenceScore += Math.min(keywordOverlap.length * 0.05, 0.15);
  // Repo match is factual evidence
  if (repoMatch) evidenceScore += 0.15;
  // Reinforcement history: surviving multiple cycles IS evidence
  // Repetition affects plausibility only; claim evidence is resolved separately.
  evidenceScore = Math.round(Math.min(Math.max(evidenceScore, 0), 1) * 100) / 100;

  // --- Combined Confidence ---
  const confidence = computeConfidence(
    plausibility,
    evidenceScore,
    reinforcementCount,
    contradictionScore
  );

  // --- Three-outcome classification ---
  let outcome: NormalizationOutcome;
  let reason_code: NormalizationReasonCode;

  if (contradictionScore >= promo.max_contradiction) {
    // High contradiction = reject
    outcome = "rejected";
    reason_code = isDuplicate ? "low_signal" :
      (!grounding.fromExists && !grounding.toExists) ? "invalid_endpoints" :
      "contradicted";
  } else if (
    confidence >= promo.promotion_confidence &&
    plausibility >= promo.promotion_plausibility &&
    evidenceScore >= promo.promotion_evidence
  ) {
    // Strong on all axes = validate
    outcome = "validated";
    reason_code = "strong_evidence";
  } else if (plausibility >= promo.retention_plausibility) {
    // Plausible but not proven = latent (speculative memory)
    outcome = "latent";
    reason_code = "insufficient_evidence";
  } else {
    // Low plausibility = reject (noise)
    outcome = "rejected";
    reason_code = "low_signal";
  }

  return {
    plausibility,
    evidence: evidenceScore,
    contradiction: contradictionScore,
    confidence,
    outcome,
    reason_code,
  };
}

// ---------------------------------------------------------------------------
// Validate a single edge
// ---------------------------------------------------------------------------

function validateEdge(
  edge: DreamEdge,
  lookup: FactLookup,
  cycle: number,
  promo: PromotionConfig = DEFAULT_PROMOTION
): ValidationResult {
  const grounding = checkEntityGrounding(edge, lookup);
  const domainOverlap = checkDomainCoherence(edge, lookup);
  const keywordOverlap = checkKeywordOverlap(edge, lookup);
  const repoMatch = checkRepoCoherence(edge, lookup);
  const isDuplicate = checkDuplicate(edge, lookup);
  const contradictions = findContradictions(edge, lookup);

  // Find shared entities (entities connected to both from and to)
  const sharedEntities: string[] = [];
  for (const entityId of lookup.entityIds) {
    if (entityId === edge.from || entityId === edge.to) continue;
    const forwardA = lookup.edgeSet.has(`${edge.from}|${entityId}`);
    const forwardB = lookup.edgeSet.has(`${edge.to}|${entityId}`);
    if (forwardA && forwardB) {
      sharedEntities.push(entityId);
    }
  }

  // Find shared workflows
  const sharedWorkflows: string[] = [];
  for (const [wfId, _steps] of lookup.workflowSteps) {
    const wfLinksFrom = lookup.edgeSet.has(`${wfId}|${edge.from}`);
    const wfLinksTo = lookup.edgeSet.has(`${wfId}|${edge.to}`);
    if (wfLinksFrom && wfLinksTo) {
      sharedWorkflows.push(wfId);
    }
  }

  const { plausibility, evidence, contradiction, confidence, outcome, reason_code } = calculateSplitScore(
    grounding,
    domainOverlap,
    keywordOverlap,
    repoMatch,
    isDuplicate,
    contradictions,
    edge.confidence,
    edge.reinforcement_count ?? 0,
    promo
  );

  const evidenceObj: ValidationEvidence = {
    shared_entities: sharedEntities.slice(0, 10),
    shared_workflows: sharedWorkflows,
    domain_overlap: domainOverlap,
    keyword_overlap: keywordOverlap,
    source_repo_match: repoMatch,
    contradictions,
  };

  // Build reason
  const parts: string[] = [];
  if (!grounding.fromExists) parts.push(`"${edge.from}" not in fact graph`);
  if (!grounding.toExists) parts.push(`"${edge.to}" not in fact graph`);
  if (isDuplicate) parts.push("duplicate of existing edge");
  if (contradictions.length > 0)
    parts.push(`contradictions: ${contradictions.join("; ")}`);
  if (domainOverlap.length > 0)
    parts.push(`shared domain: ${domainOverlap.join(", ")}`);
  if (keywordOverlap.length > 0)
    parts.push(`shared keywords: ${keywordOverlap.join(", ")}`);
  if (sharedEntities.length > 0)
    parts.push(`${sharedEntities.length} shared connections`);
  if (sharedWorkflows.length > 0)
    parts.push(`${sharedWorkflows.length} shared workflows`);

  const reason =
    parts.length > 0 ? parts.join(". ") + "." : "Insufficient evidence.";

  const evidenceCount = countEvidence(evidenceObj);

  return {
    dream_id: edge.id,
    dream_type: "edge",
    status: outcome,
    confidence,
    plausibility,
    evidence_score: evidence,
    contradiction_score: contradiction,
    evidence: evidenceObj,
    evidence_count: evidenceCount,
    reason_code,
    reason,
    validated_at: new Date().toISOString(),
    normalization_cycle: cycle,
    strategy: edge.strategy,
  };
}

// ---------------------------------------------------------------------------
// Validate a single node
// ---------------------------------------------------------------------------

function validateNode(
  node: DreamNode,
  lookup: FactLookup,
  cycle: number,
  promo: PromotionConfig = DEFAULT_PROMOTION
): ValidationResult {
  // Check if inspiration entities exist
  const existingInspirations = node.inspiration.filter((id) =>
    lookup.entityIds.has(id)
  );
  const groundingRatio =
    node.inspiration.length > 0
      ? existingInspirations.length / node.inspiration.length
      : 0;

  // Check domain/keyword coherence across inspirations
  const inspirationDomains = existingInspirations
    .map((id) => lookup.domains.get(id) ?? "")
    .filter(Boolean);
  const uniqueDomains = [...new Set(inspirationDomains)];

  const allKeywords = existingInspirations.flatMap(
    (id) => lookup.keywords.get(id) ?? []
  );
  const keywordCounts = new Map<string, number>();
  for (const kw of allKeywords) {
    keywordCounts.set(kw, (keywordCounts.get(kw) ?? 0) + 1);
  }
  const sharedKeywords = [...keywordCounts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([kw]) => kw);

  // --- Node-level domain/keyword grounding ---
  // Even without inspiration, a node's own domain and keywords can ground
  // it against the fact graph.  This prevents the "empty inspiration = dead
  // on arrival" problem that plagued earlier versions.
  const nodeDomain = (node.domain ?? "").toLowerCase();
  const nodeKws = new Set((node.keywords ?? []).map((k) => k.toLowerCase()));
  let directDomainMatch = false;
  let directKeywordMatches = 0;
  for (const [eid, domain] of lookup.domains) {
    if (nodeDomain && domain?.toLowerCase() === nodeDomain) {
      directDomainMatch = true;
    }
    const entityKws = lookup.keywords.get(eid) ?? [];
    for (const kw of entityKws) {
      if (nodeKws.has(kw.toLowerCase())) directKeywordMatches++;
    }
  }

  // Split scoring for nodes
  // Base: domain coherence from inspirations
  let plausibility =
    (uniqueDomains.length === 1 ? 0.35 : uniqueDomains.length <= 2 ? 0.2 : 0.05) +
    Math.min(sharedKeywords.length * 0.1, 0.35) +
    node.confidence * 0.15;
  // Boost from direct domain/keyword grounding (new path for nodes with
  // populated domain/keywords even if inspiration is sparse)
  if (directDomainMatch) plausibility += 0.15;
  plausibility += Math.min(directKeywordMatches * 0.03, 0.15);
  plausibility = Math.round(Math.min(Math.max(plausibility, 0), 1) * 100) / 100;

  let evidenceScore = groundingRatio * 0.5 +
    (uniqueDomains.length > 0 ? 0.2 : 0) +
    Math.min(sharedKeywords.length * 0.05, 0.15);
  // Direct grounding contributes to evidence too
  if (directDomainMatch) evidenceScore += 0.15;
  evidenceScore += Math.min(directKeywordMatches * 0.02, 0.10);
  evidenceScore = Math.round(Math.min(Math.max(evidenceScore, 0), 1) * 100) / 100;

  const contradictionScore = 0; // nodes don't have structural contradictions

  const confidence = computeConfidence(
    plausibility,
    evidenceScore,
    node.reinforcement_count ?? 0,
    contradictionScore
  );

  // Grounding gate: require EITHER inspiration grounding OR direct
  // domain+keyword grounding.  The old hard requirement of
  // groundingRatio >= 0.5 killed every node with sparse inspiration.
  const hasDirectGrounding = directDomainMatch && directKeywordMatches >= 2;

  let outcome: NormalizationOutcome;
  let reason_code: NormalizationReasonCode;
  if (
    confidence >= promo.promotion_confidence &&
    plausibility >= promo.promotion_plausibility &&
    (groundingRatio >= 0.4 || hasDirectGrounding)
  ) {
    outcome = "validated";
    reason_code = "strong_evidence";
  } else if (plausibility >= promo.retention_plausibility) {
    outcome = "latent";
    reason_code = "insufficient_evidence";
  } else {
    outcome = "rejected";
    reason_code = "low_signal";
  }

  const evidenceObj: ValidationEvidence = {
    shared_entities: existingInspirations,
    shared_workflows: [],
    domain_overlap: uniqueDomains,
    keyword_overlap: sharedKeywords,
    source_repo_match: false,
    contradictions: [],
  };

  const reason = `${existingInspirations.length}/${node.inspiration.length} inspirations grounded. ${uniqueDomains.length} domain(s). ${sharedKeywords.length} shared keywords.${directDomainMatch ? " Direct domain match." : ""}${directKeywordMatches > 0 ? ` ${directKeywordMatches} direct keyword matches.` : ""}`;

  const evidenceCount = countEvidence(evidenceObj);

  return {
    dream_id: node.id,
    dream_type: "node",
    status: outcome,
    confidence,
    plausibility,
    evidence_score: evidenceScore,
    contradiction_score: contradictionScore,
    evidence: evidenceObj,
    evidence_count: evidenceCount,
    reason_code,
    reason,
    validated_at: new Date().toISOString(),
    normalization_cycle: cycle,
  };
}

// ---------------------------------------------------------------------------
// LLM Semantic Validation — ask the LLM to evaluate abstract concept matches
// ---------------------------------------------------------------------------

/** Schema for LLM semantic validation responses (strict mode) */
const SEMANTIC_VALIDATION_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    evaluations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          edge_id:            { type: "string", description: "The dream edge ID being evaluated" },
          semantic_relevance: { type: "number", description: "0.0-1.0 how semantically meaningful is this connection" },
          reasoning:          { type: "string", description: "Brief explanation of the semantic judgment" },
        },
        required: ["edge_id", "semantic_relevance", "reasoning"],
        additionalProperties: false,
      },
    },
  },
  required: ["evaluations"],
  additionalProperties: false,
};

interface SemanticEvaluation {
  model_provenance?: CognitiveProvenance;
  edge_id: string;
  semantic_relevance: number;
  reasoning: string;
}

/**
 * Batch-evaluate latent/near-threshold edges using the LLM for semantic
 * understanding. Structural scoring cannot judge whether abstract concepts
 * like "caching_layer relates_to query_optimizer" make sense — only the LLM
 * can reason about intent and meaning.
 *
 * Cost control:
 * - Evaluates latent edges (confidence ≥ 0.35) and low_signal rejections
 * - Batches up to 20 edges per call (~800 tokens)
 * - Skips entirely if LLM is unavailable
 * - Uses normalizer LLM config (low temperature) for consistent judgments
 *
 * Returns a map of edge_id → SemanticEvaluation for edges the LLM reviewed.
 */
async function llmSemanticValidation(
  edges: Array<{ edge: DreamEdge; result: ValidationResult }>,
  lookup: FactLookup,
  signal?: AbortSignal,
): Promise<Map<string, SemanticEvaluation>> {
  const evaluations = new Map<string, SemanticEvaluation>();

  // Filter to candidates worth evaluating:
  // 1. Latent edges (speculative memory — may have semantic value the heuristic missed)
  // 2. Rejected edges with reason_code "low_signal" whose endpoints both exist
  //    in the fact graph (structurally valid but heuristically under-scored)
  // This rescues edges that are semantically meaningful but lack keyword/domain overlap.
  const candidates = edges.filter(({ edge, result }) => {
    // Latent edges near threshold — existing behavior
    if (result.status === "latent" && result.confidence >= (Number(process.env.DG_NORMALIZER_LLM_THRESHOLD) || 0.35)) return true;
    // Low-signal rejections where both endpoints are grounded — the heuristic
    // couldn't find structural overlap, but the LLM may see semantic meaning
    if (
      result.status === "rejected" &&
      result.reason_code === "low_signal" &&
      result.contradiction_score < 0.3
    ) return true;
    return false;
  });

  if (candidates.length === 0) return evaluations;

  // Check LLM availability
  const runtime = await getRoleLlmProvider("normalizer").catch(error => { logger.warn("Semantic validation role blocked: " + String(error)); return null; });
  const available = runtime && await runtime.provider.isAvailable();
  if (!available) {
    logger.debug("Semantic validation: LLM not available, skipping");
    return evaluations;
  }

  const llm = runtime!.provider;

  // Batch up to N edges per call (low_signal rejections need coverage)
  const batchSize = Number(process.env.DG_NORMALIZER_BATCH_SIZE) || 20;
  const batch = candidates.slice(0, batchSize);

  // Build context: describe each edge and its endpoints
  const edgeDescriptions = batch.map(({ edge, result }) => {
    const fromDomain = lookup.domains.get(edge.from) ?? "unknown";
    const toDomain = lookup.domains.get(edge.to) ?? "unknown";
    const fromKw = (lookup.keywords.get(edge.from) ?? []).join(", ");
    const toKw = (lookup.keywords.get(edge.to) ?? []).join(", ");
    return [
      `ID: ${edge.id}`,
      `  ${edge.from} (domain: ${fromDomain}, keywords: ${fromKw || "none"})`,
      `  --[${edge.relation}]-->`,
      `  ${edge.to} (domain: ${toDomain}, keywords: ${toKw || "none"})`,
      `  Reason: ${edge.reason}`,
      `  Structural confidence: ${result.confidence}, plausibility: ${result.plausibility}`,
    ].join("\n");
  }).join("\n\n");

  const messages: LlmMessage[] = [
    {
      role: "system",
      content: `You are a strict semantic validator for a software knowledge graph. You evaluate proposed relationships between entities and judge whether they make genuine semantic sense — not just syntactic or structural similarity.

Score each edge's semantic_relevance from 0.0 to 1.0:
- 0.0-0.3: No meaningful semantic connection, coincidental overlap
- 0.3-0.5: Weak or indirect connection, not worth promoting
- 0.5-0.7: Reasonable connection with clear rationale
- 0.7-1.0: Strong, insightful connection that reveals real architectural meaning

Be a strict critic. Only score above 0.6 if the relationship genuinely reveals something meaningful about the software architecture.`,
    },
    {
      role: "user",
      content: `Evaluate the semantic validity of these proposed knowledge graph edges:\n\n${edgeDescriptions}\n\nRespond with a JSON object containing an "evaluations" array.`,
    },
  ];

  try {
    logger.debug(`Semantic validation: evaluating ${batch.length} edges via LLM`);

    const normCfg = runtime!.config;
    const started = performance.now();
    const response = await llm.complete(messages, {
      signal,
      cognitiveRole: "normalizer",
      ...(normCfg.reasoningEffort ? { reasoningEffort: normCfg.reasoningEffort } : {}),
      temperature: normCfg.temperature,
      maxTokens: normCfg.maxTokens,
      model: normCfg.model,
      jsonSchema: {
        name: "semantic_validation",
        schema: SEMANTIC_VALIDATION_SCHEMA,
      },
    });

    const provenance = cognitiveProvenance({ role: "normalizer", prompt_version: "normalizer.semantic-baseline.v1", schema_version: "semantic_validation.v1",
      messages, output_schema: SEMANTIC_VALIDATION_SCHEMA, source_context: edgeDescriptions,
      source_ids: batch.flatMap(({ edge }) => [edge.from, edge.to]),
      ancestry_ids: batch.flatMap(({ edge }) => {
        const prior = edge.meta?.model_provenance as CognitiveProvenance | undefined;
        return prior?.ancestry_ids ?? [edge.id];
      }), policy: runtime!.policy, elapsed_ms: performance.now() - started, response });
    const parsed = JSON.parse(response.text) as { evaluations?: SemanticEvaluation[] };
    if (Array.isArray(parsed.evaluations)) {
      for (const ev of parsed.evaluations) {
        if (ev.edge_id && typeof ev.semantic_relevance === "number") {
          evaluations.set(ev.edge_id, {
            model_provenance: provenance,
            edge_id: ev.edge_id,
            semantic_relevance: Math.max(0, Math.min(1, ev.semantic_relevance)),
            reasoning: ev.reasoning ?? "",
          });
        }
      }
    }

    logger.info(
      `Semantic validation: ${evaluations.size}/${batch.length} edges evaluated ` +
      `(${response.tokensUsed ?? "?"} tokens)`
    );
  } catch (err) {
    logger.warn(
      `Semantic validation failed: ${err instanceof Error ? err.message : "unknown error"}`
    );
  }

  return evaluations;
}

/**
 * Apply semantic validation results to edge assessments.
 * Edges with high semantic relevance get boosted:
 * - plausibility increases; independent evidence does not
 * - reason_code → "semantic_boost"
 * - If the boosted scores cross thresholds → upgraded to "validated"
 */
function applySemanticBoost(
  result: ValidationResult,
  evaluation: SemanticEvaluation,
  promo: PromotionConfig,
): void {
  if (evaluation.semantic_relevance < 0.5) return;

  // Scale boost by semantic relevance (0.5→small, 1.0→full)
  const boostScale = (evaluation.semantic_relevance - 0.5) / 0.5; // 0→1

  // Stronger boosts for rejected edges (they start from a deeper deficit)
  const wasRejected = result.status === "rejected";
  const plausBoost = (wasRejected ? 0.30 : 0.15) * boostScale;


  result.plausibility = Math.round(Math.min(result.plausibility + plausBoost, 1) * 100) / 100;
  result.semantic_evaluation = { semantic_relevance: evaluation.semantic_relevance, reasoning: evaluation.reasoning };

  // Recompute confidence with boosted scores
  result.confidence = computeConfidence(
    result.plausibility,
    result.evidence_score,
    0, // reinforcement already baked in
    result.contradiction_score,
  );

  // Append semantic reasoning
  result.reason = `${result.reason} LLM semantic: ${evaluation.reasoning} (relevance: ${evaluation.semantic_relevance.toFixed(2)})`;
  result.reason_code = "semantic_boost";

  // Re-classify with boosted scores — can upgrade rejected→latent or latent→validated
  if (
    result.confidence >= promo.promotion_confidence &&
    result.plausibility >= promo.promotion_plausibility &&
    result.evidence_score >= promo.promotion_evidence
  ) {
    result.status = "validated";
  } else if (result.plausibility >= promo.retention_plausibility) {
    // Semantic boost rescued this from rejection → latent (speculative memory)
    if (result.status === "rejected") result.status = "latent";
  }
}

// ---------------------------------------------------------------------------
// Edge promotion — three-outcome gate uses PromotionConfig thresholds
// ---------------------------------------------------------------------------

function promoteToValidatedEdge(
  edge: DreamEdge,
  result: ValidationResult,
  promo: PromotionConfig = DEFAULT_PROMOTION
): ValidatedEdge | null {
  // Only "validated" outcome edges pass
  if (result.status !== "validated") return null;

  if (result.evidence_assessment?.state !== "supported") return null;
  const effectiveEvidenceCount = result.evidence_assessment.independent_roots.length;
  if (effectiveEvidenceCount < Math.max(1, promo.promotion_evidence_count)) return null;

  // Only edges between real fact graph entities can be promoted
  const validTypes = ["feature", "workflow", "data_model"] as const;
  const edgeType = validTypes.find((t) => t === edge.type);
  if (!edgeType && edge.type !== "hypothetical") return null;

  return {
    evidence_assessment: result.evidence_assessment,
    from_kind: result.evidence_assessment.claim.type === "edge" ? result.evidence_assessment.claim.from.kind : undefined,
    to_kind: result.evidence_assessment.claim.type === "edge" ? result.evidence_assessment.claim.to.kind : undefined,
    from_repository_id: result.evidence_assessment.claim.type === "edge" ? result.evidence_assessment.claim.from.repository_id : undefined,
    to_repository_id: result.evidence_assessment.claim.type === "edge" ? result.evidence_assessment.claim.to.repository_id : undefined,
    id: edge.id,
    from: edge.from,
    to: edge.to,
    type: edgeType ?? "feature",
    relation: edge.relation,
    description: edge.reason,
    confidence: result.confidence,
    plausibility: result.plausibility,
    evidence_score: result.evidence_score,
    origin: "rem",
    status: "validated",
    evidence_summary: result.reason,
    evidence_count: effectiveEvidenceCount,
    reinforcement_count: edge.reinforcement_count ?? 0,
    dream_cycle: edge.dream_cycle,
    normalization_cycle: result.normalization_cycle,
    validated_at: result.validated_at,
    strategy: edge.strategy,
  };
}

// ---------------------------------------------------------------------------
// Public API — Normalize
// ---------------------------------------------------------------------------

export interface TensionCandidate {
  dreamId: string;
  from: string;
  to: string;
  confidence: number;
  reason: string;
}

export interface NormalizationReceipt {
  profile: string;
  requested_strict: boolean | null;
  inherited_strict: boolean;
  override_applied: boolean;
  effective_strict: boolean;
  threshold_source: "explicit" | "policy";
  base_promotion_config: PromotionConfig;
  applied_promotion_config: PromotionConfig;
  bootstrap: {
    active: boolean;
    state: "cold_start" | "graduated";
    relaxed_fields: Array<keyof PromotionConfig>;
  };
}

export interface NormalizationResult {
  cycle: number;
  processed: number;
  validated: number;
  latent: number;
  rejected: number;
  blockedByGate: number;
  promotedEdges: ValidatedEdge[];
  /** Number of dream nodes promoted to the fact graph as entities */
  promotedNodes: number;
  /** Rejected edges that are tension-worthy (grounded endpoints, non-trivial rejection) */
  tensionCandidates: TensionCandidate[];
  receipt: NormalizationReceipt;
  operation_receipt?: import("../graph/contracts.js").OperationReceipt;
}

function isTensionWorthyRejection(
  edge: DreamEdge,
  result: ValidationResult,
  lookup: FactLookup,
): boolean {
  if (result.status !== "rejected") return false;
  if (!(lookup.entityIds.has(edge.from) || lookup.entityIds.has(edge.to))) return false;
  if (result.reason_code === "contradicted") return true;
  return (edge.reinforcement_count ?? 0) >= RECURRENT_REJECTION_TENSION_MIN_REINFORCEMENT;
}

const tensionSourcePrefix = (source: "dream_cycle" | "scheduler"): string =>
  source === "scheduler" ? "[scheduler] " : "";

export async function recordWeakConnectionTensions(
  tensionCandidates: TensionCandidate[],
  source: "dream_cycle" | "scheduler",
): Promise<number> {
  if (tensionCandidates.length === 0) {
    return 0;
  }

  const selectedCandidates = [...tensionCandidates]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, TENSION_CANDIDATE_LIMIT_PER_CYCLE);
  logger.info(
    `${tensionSourcePrefix(source)}Tension pipeline: ${tensionCandidates.length} candidates, selecting top ${selectedCandidates.length}`
  );

  let tensionsCreated = 0;
  for (const tc of selectedCandidates) {
    const urgency = Math.max(0.3, Math.min(0.7, tc.confidence * 2 + 0.2));
    await engine.recordTension({
      type: "weak_connection",
      entities: [tc.from, tc.to],
      description: `Dream "${tc.dreamId}" rejected: ${tc.reason}`,
      urgency,
    });
    tensionsCreated++;
  }

  if (tensionsCreated > 0) {
    logger.info(
      `${tensionSourcePrefix(source)}Tension pipeline: ${tensionsCreated} tensions recorded`
    );
  }

  return tensionsCreated;
}

export async function resolveTensionsFromPromotedEdges(
  promotedEdges: ValidatedEdge[],
  source: "dream_cycle" | "scheduler",
): Promise<number> {
  if (promotedEdges.length === 0) {
    return 0;
  }

  const unresolvedTensions = await engine.getUnresolvedTensions();
  let tensionsResolved = 0;

  for (const promoted of promotedEdges) {
    for (const tension of unresolvedTensions) {
      if (tension.resolved) continue;
      const fromMatch = tension.entities.includes(promoted.from);
      const toMatch = tension.entities.includes(promoted.to);
      const claim=tension.resolution_candidate?.verification_claim;
      if (fromMatch && toMatch && claim?.type==="edge" && claim.from.id===promoted.from && claim.to.id===promoted.to && claim.relation===promoted.relation) {
        const resolved=await engine.resolveTension(
          tension.id,
          "system",
          "confirmed_fixed",
          "Declared connection predicate verified by current independently supported normalization",
          undefined,{verification_claim:claim,expected_revision:tension.revision??0}
        );
        if(!resolved)continue;
        tension.resolved = true;
        tensionsResolved++;
        logger.info(
          `${tensionSourcePrefix(source)}Tension resolved: '${tension.id}' addressed by promoted edge ${promoted.from} -> ${promoted.to}`
        );
      }
    }
  }

  return tensionsResolved;
}

/**
 * Run normalization on all unvalidated dream graph items.
 *
 * Three-outcome classifier (speculative memory):
 * - validated:  Strong evidence → promote to fact-adjacent space
 * - latent:     Plausible but insufficient evidence → keep in dream space
 * - rejected:   Contradicted, malformed, or noise → discard
 *
 * Latent edges remain in the dream graph as speculative memory.
 * They may be validated in future cycles when new evidence appears.
 *
 * PRECONDITION: Engine must be in NORMALIZING state.
 */
export async function normalize(
  threshold?: number,
  strict?: boolean,
  options: { operation_id?: string; signal?: AbortSignal; entity_ids?:string[];fault_inject?: CommitGraphInput["fault_inject"] } = {},
): Promise<NormalizationResult> {
  engine.assertState("normalizing", "normalize");

  if (threshold !== undefined && (!Number.isFinite(threshold) || threshold < 0 || threshold > 1)) throw new Error("NORMALIZATION_THRESHOLD_INVALID");
  const operation_id = options.operation_id ?? randomUUID();
  if(options.entity_ids!==undefined&&(!Array.isArray(options.entity_ids)||options.entity_ids.length>100||options.entity_ids.some(id=>!id)))throw new Error("NORMALIZATION_SCOPE_INVALID");
  const focus=options.entity_ids===undefined?null:new Set(options.entity_ids);
  const intent = { threshold: threshold ?? null, strict: strict ?? null, policy: NORMALIZATION_EVIDENCE_POLICY,...(focus?{entity_ids:[...focus].sort()}: {}) };
  const prior = await findOperationReceipt(operation_id, "normalizer");
  if (prior) {
    const replay = await commitGraphWrites({ writes: [], actor: "normalizer", scope: NORMALIZATION_SCOPE, operation_id, intent, cause: "normalization" });
    return { ...(await readNormalizationResult(replay.receipt) as unknown as NormalizationResult), operation_receipt: replay.receipt };
  }
  const assertCurrent = () => { engine.assertState("normalizing", "normalize publication"); options.signal?.throwIfAborted(); };
  assertCurrent();
  const strictness = await resolveNormalizationStrictness(strict);
  const effectiveStrict = strictness.effective_strict;

  // Resolve promotion config from engine (policy tuning + live overrides)
  const strictPromo = await engine.getEffectivePromotionConfig();

  // ADR-241 amends only ADR-096's factual-evidence relaxation. Dual exit remains below.
  // Cold start keeps low-floor exploration/retention, never weakens corroboration.
  const isColdStart = engine.isColdStart();
  if (isColdStart) engine.markBootstrapStart();
  const promo: PromotionConfig = { ...strictPromo, promotion_evidence_count: Math.max(1, strictPromo.promotion_evidence_count),
    retention_plausibility: isColdStart ? Math.min(strictPromo.retention_plausibility, 0.2) : strictPromo.retention_plausibility };
  const effectiveThreshold = threshold ?? promo.promotion_confidence;
  const relaxedFields = (Object.keys(promo) as Array<keyof PromotionConfig>).filter(
    (key) => promo[key] !== strictPromo[key]
  );

  const cycle = engine.nextNormalizationCycle();
  const receipt: NormalizationReceipt = {
    profile: strictness.profile,
    requested_strict: strict ?? null,
    inherited_strict: strictness.inherited_strict,
    override_applied: strictness.override_applied,
    effective_strict: effectiveStrict,
    threshold_source: threshold === undefined ? "policy" : "explicit",
    base_promotion_config: { ...strictPromo },
    applied_promotion_config: { ...promo },
    bootstrap: {
      active: isColdStart,
      state: isColdStart ? "cold_start" : "graduated",
      relaxed_fields: relaxedFields,
    },
  };
  logger.info(
    `Normalization cycle #${cycle} starting (threshold: ${effectiveThreshold})`
  );
  logger.info(`Normalization receipt: ${JSON.stringify(receipt)}`);

  const snapshot = await readNormalizationSnapshot();
  const lookup = buildFactLookup(snapshot.graph);
  const dreamGraph = snapshotDocument<DreamGraphFile>(snapshot, "dream_graph.json");
  // Reserve a conservative finite result envelope before any semantic model dispatch.
  if (dreamGraph.nodes.length + dreamGraph.edges.length > 10000
    || Buffer.byteLength(JSON.stringify([dreamGraph, snapshot.evidence.ledger])) * 4 + 32768 > NORMALIZATION_RESULT_LIMIT) throw new Error("NORMALIZATION_RESULT_ADMISSION_BUDGET");
  const existingCandidates = snapshotDocument<import("./types.js").CandidateEdgesFile>(snapshot, "candidate_edges.json");
  const previousResults = new Map(existingCandidates.results.map(r => [`${r.dream_type}:${r.dream_id}`, r] as const));
  // Cheap evidence re-evaluation always runs, including rejected/previously promoted claims.
  // Unchanged evidence reuses prior semantic judgment instead of paying for repeated consensus.
  const minimumRoots = Math.max(1, strictPromo.promotion_evidence_count);
  const suppressed = curationSuppressions(snapshot.maintenance.curation ?? emptyCuration());
  const humanDisposition = new Map<string, string>();
  for (const decision of snapshot.maintenance.curation?.decisions ?? []) if (decision.action !== "expire") humanDisposition.set(`${decision.target_type}:${decision.target_id}`, decision.action);
  const applyEvidence = (result: ValidationResult, claim: NormalizationClaim | null): void => {
    result.evidence_input_hash = snapshot.evidence_fingerprint;
    result.evidence_assessment = claim ? assessClaimEvidence(claim, snapshot.evidence, minimumRoots) : undefined;
    const currencyReasons = claim && result.evidence_assessment ? claimCurrencyReasons(claim, snapshot.graph.state, claimSourceScopes(result.evidence_assessment, snapshot.evidence)) : [];
    if (result.evidence_assessment && currencyReasons.length) {
      result.evidence_assessment.state = "unproven";
      result.evidence_assessment.reasons.push(...currencyReasons);
    }
    result.evidence_count = result.evidence_assessment?.independent_roots.length ?? 0;
    result.evidence.claim_evidence = result.evidence_assessment;
    result.evidence_score = Math.min(result.evidence_count / minimumRoots, 1);
    if (["reject", "retire"].includes(humanDisposition.get(`${result.dream_type}:${result.dream_id}`) ?? "") || claim && suppressed.has(normalizationClaimKey(claim))) {
      result.status = "rejected"; result.reason_code = "contradicted";
      result.reason += " Human disposition requires explicit reopen.";
    } else if (result.evidence_assessment?.state === "disputed") {
      result.status = "rejected"; result.reason_code = "contradicted"; result.contradiction_score = 1;
    } else if (!claim) {
      result.status = "rejected"; result.reason_code = "invalid_endpoints";
    } else if (result.evidence_assessment?.state === "supported" && result.contradiction_score < promo.max_contradiction) {
      result.plausibility = Math.max(result.plausibility, 0.75);
      result.confidence = computeConfidence(result.plausibility, result.evidence_score, 0, result.contradiction_score);
      result.status = result.confidence >= effectiveThreshold && result.plausibility >= promo.promotion_plausibility && result.evidence_score >= promo.promotion_evidence ? "validated" : "latent";
      result.reason_code = result.status === "validated" ? "strong_evidence" : "insufficient_evidence";
    } else if (result.status === "validated") { result.status = "latent"; result.reason_code = "insufficient_evidence"; }
    result.reason = result.reason.replace(/ Claim corroboration:.*?(?= LLM semantic:|$)/g, "");
    result.reason += ` Claim corroboration: ${result.evidence_assessment?.state ?? "identity_unknown"}; ${result.evidence_count} independent source root(s).`;
    result.confidence = computeConfidence(result.plausibility, result.evidence_score, 0, result.contradiction_score);
  };

  // Validate all eligible edges — PASS 1: structural scoring
  const edgeAssessments: Array<{ edge: DreamEdge; result: ValidationResult }> = [];
  const newResults: ValidationResult[] = [];

  let edgeIter = 0;
  for (const edge of dreamGraph.edges) {
    if(focus&&!focus.has(edge.from)&&!focus.has(edge.to))continue;
    if (edge.interrupted) continue;

    assertCurrent();
    const result = validateEdge(edge, lookup, cycle, promo);
    applyEvidence(result, edgeClaim(edge as DreamEdge & Record<string, unknown>, snapshot.graph));

    // Apply custom threshold override
    if (result.status === "validated" && result.confidence < effectiveThreshold) {
      result.status = "latent";
      result.reason_code = "insufficient_evidence";
    }

    // NOTE: strict-mode downgrade (latent→rejected) is deferred until AFTER
    // the LLM semantic validation pass so the LLM can rescue edges first.

    edgeAssessments.push({ edge, result });
    newResults.push(result);

    // ADR-052: yield to event loop periodically so the daemon stays
    // responsive on large dream graphs (1k+ edges).
    if (++edgeIter % NORMALIZER_YIELD_BATCH === 0) await yieldToEventLoop();
  }

  // PASS 2: LLM semantic validation on latent edges
  // The LLM evaluates abstract concept matches that structural scoring misses.
  // Only runs when LLM is available; gracefully degrades to structural-only.
  const semanticResults = await llmSemanticValidation(edgeAssessments.filter(({ edge }) => previousResults.get(`edge:${edge.id}`)?.evidence_input_hash !== snapshot.evidence_fingerprint), lookup, options.signal);
  let semanticBoosts = 0;
  for (const { edge, result } of edgeAssessments) {
    const previous = previousResults.get(`edge:${edge.id}`);
    const evaluation = semanticResults.get(edge.id) ?? (previous?.evidence_input_hash === snapshot.evidence_fingerprint && previous.semantic_evaluation
      ? { ...previous.semantic_evaluation, edge_id: edge.id, model_provenance: previous.model_provenance } : undefined);
    if (evaluation) {
      result.model_provenance = evaluation.model_provenance;
      applySemanticBoost(result, evaluation, promo);
      if (result.reason_code === "semantic_boost") semanticBoosts++;
    }
    applyEvidence(result, edgeClaim(edge as DreamEdge & Record<string, unknown>, snapshot.graph));
    edge.evidence_assessment = result.evidence_assessment;
  }
  if (semanticBoosts > 0) {
    logger.info(`Semantic validation boosted ${semanticBoosts} edges`);
  }

  // PASS 2b: apply strict-mode downgrade AFTER LLM has had its say
  if (effectiveStrict) {
    for (const { result } of edgeAssessments) {
      if (result.status === "latent") {
        result.status = "rejected";
        result.reason_code = "low_signal";
      }
    }
  }

  // PASS 3: promotion gate — apply after semantic boosts
  const promotedEdges: ValidatedEdge[] = [];
  let blockedByGate = 0;

  let gateIter = 0;
  for (const { edge, result } of edgeAssessments) {
    // Update edge status in dream graph to reflect normalization outcome
    edge.status = result.status === "validated" ? "validated" :
                  result.status === "latent" ? "latent" : "rejected";
    edge.plausibility = result.plausibility;
    edge.evidence_score = result.evidence_score;
    edge.contradiction_score = result.contradiction_score;
    edge.confidence = result.confidence;

    // PROMOTION GATE — only validated with sufficient evidence count
    if (result.status === "validated") {
      const promoted = promoteToValidatedEdge(edge, result, promo);
      if (promoted) {
        promotedEdges.push(promoted);
      } else {
        // Validated but blocked by evidence count gate — downgrade BOTH
        // dream graph edge AND candidate result to latent.  Without this,
        // the candidate stays "validated" and gets skipped forever.
        edge.status = "latent";
        result.status = "latent";
        result.reason_code = "insufficient_evidence";
        blockedByGate++;
      }
    }

    // ADR-052: yield to event loop periodically.
    if (++gateIter % NORMALIZER_YIELD_BATCH === 0) await yieldToEventLoop();
  }

  // Validate all eligible nodes
  const promotableNodes: DreamNode[] = [];
  let nodeIter = 0;
  for (const node of dreamGraph.nodes) {
    if(focus&&!focus.has(node.id)&&!node.inspiration.some(id=>focus.has(id)))continue;
    if (node.interrupted) continue;
    const alreadyPromoted = Boolean(node.promoted_at);
    assertCurrent();
    const result = validateNode(node, lookup, cycle, promo);
    applyEvidence(result, nodeClaim(node, snapshot.graph.instance_id));
    node.evidence_assessment = result.evidence_assessment;

    if (result.status === "validated" && result.confidence < effectiveThreshold) {
      result.status = "latent";
      result.reason_code = "insufficient_evidence";
    }
    if (effectiveStrict && result.status === "latent") {
      result.status = "rejected";
      result.reason_code = "low_signal";
    }

    newResults.push(result);

    // Update node status
    node.status = result.status === "validated" ? "validated" :
                  result.status === "latent" ? "latent" : "rejected";
    node.activation_score = result.status === "latent"
      ? Math.round(result.plausibility * 0.5 * 100) / 100
      : 0;

    // Collect validated nodes for entity promotion
    if (result.status === "validated" && !alreadyPromoted) {
      promotableNodes.push(node);
    }

    // ADR-052: yield to event loop periodically.
    if (++nodeIter % NORMALIZER_YIELD_BATCH === 0) await yieldToEventLoop();
  }

  // One durable C04 publication follows current proof and state re-checks.
  // Failures propagate with the actual recovery state; no fabricated partial rollback.
  const promotedNodeCount = promotableNodes.length;
  const counts = {
    validated: newResults.filter((r) => r.status === "validated").length,
    latent: newResults.filter((r) => r.status === "latent").length,
    rejected: newResults.filter((r) => r.status === "rejected").length,
  };

  // Collect tension-worthy rejections behind a separate admission gate.
  // Rejection alone is not enough: weak low-signal misses should decay away,
  // while recurring or contradictory grounded misses should surface as work.
  const tensionCandidates: TensionCandidate[] = [];
  for (const { edge, result } of edgeAssessments) {
    if (isTensionWorthyRejection(edge, result, lookup)) {
      tensionCandidates.push({
        dreamId: edge.id,
        from: edge.from,
        to: edge.to,
        confidence: result.confidence,
        reason: result.reason,
      });
    }
  }

  if (tensionCandidates.length > 0) {
    logger.info(`Normalization: ${tensionCandidates.length} tension-worthy rejections identified`);
  }

  const result: NormalizationResult = { cycle, processed: newResults.length, ...counts, blockedByGate, promotedEdges,
    promotedNodes: promotedNodeCount, tensionCandidates, receipt };
  const publication = await publishNormalization({ snapshot, dreamGraph, results: newResults, promotedEdges, promotedNodes: promotableNodes,
    cycle, minimum_roots: minimumRoots, operation_id, intent, result: result as unknown as Record<string, unknown>,
    fault_inject: options.fault_inject, assert_current: assertCurrent });
  const response = { ...result, operation_receipt: publication.receipt };
  logger.info(
    `Normalization cycle #${cycle} complete: ${newResults.length} processed ` +
      `(${counts.validated} validated, ${counts.latent} latent, ${counts.rejected} rejected), ` +
      `${promotedEdges.length} edges promoted, ${promotedNodeCount} entities promoted, ${blockedByGate} blocked by gate`
  );

  // ADR-096: evaluate cold-start dual exit condition AFTER this cycle's
  // promotions. Both branches (entity-count OR window) MUST remain wired
  // and exit_reason MUST be populated on every exit (guard rails).
  if (isColdStart) {
    const entityCount = lookup.entityIds.size;
    let validatedEdgeCount = 0;
    try {
      const validatedFile = await engine.loadValidatedEdges();
      validatedEdgeCount = validatedFile.edges.length;
    } catch (err) {
      logger.debug(
        `Cold-start exit eval: validated_edges count unavailable: ${err instanceof Error ? err.message : err}`
      );
    }
    const exitReason = engine.evaluateBootstrapExit(entityCount, validatedEdgeCount);
    if (exitReason) {
      await engine.graduateBootstrap(exitReason);
    }
  }

  return response;
}
