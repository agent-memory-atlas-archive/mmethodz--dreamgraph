/** Persistent learning belongs to meta_log; model output volume is never accuracy. */
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { dataPath } from "../utils/paths.js";
import { stripBom } from "../utils/read-json.js";
import { commitGraphWrites, loadPublicationState, publicationContentHash, findOperationReceipt } from "../graph/publication.js";
import { withGraphRead, withGraphReconciliation } from "../utils/graph-reconciliation-barrier.js";
import { ACTIVE_STRATEGY_NAMES, allocateStrategyBudgets } from "./strategy-catalog.js";
import { CognitiveProvenanceSchema } from "./cognitive-provenance.js";
import { AdmissionLedgerSchema } from "./model-admission.js";
import type { DreamEdge, DreamNode, MetaLogFile } from "./types.js";
import type { FactSnapshot } from "./strategies/_shared.js";

const id = z.string().min(1).max(2048), count = z.number().int().nonnegative();
const ObservationSchema = z.object({ id, strategy: id, version: id, input_hash: id, cycle: count,
  status: z.enum(["completed", "failed"]), budget: count, generated: count, persisted: count, novel: count,
  claim_keys: z.array(id).max(1000), artifact_ids: z.array(id).max(1000), ancestry: z.array(id).max(2000), elapsed_ms: z.number().finite().nonnegative(),
  attempt_ids: z.array(id).max(256), charge_nanounits: z.string().regex(/^\d+$/).nullable(),
  charge_provenance: z.enum(["no_provider_call", "provider_usage_estimate", "unavailable"]),
  reason: z.string().max(4096).optional(), recorded_at: z.string().datetime() }).strict();
const ReviewSchema = z.object({ claim_key: id, strategy: id, version: id, input_hash: id, useful: z.boolean(),
  reviewer: id, reason: id, evidence_ids: z.array(id).min(1).max(64), recorded_at: z.string().datetime() }).strict();
export const PortfolioSchema = z.object({ schema: z.literal("dreamgraph.strategy_portfolio.v1"), revision: count,
  mode: z.enum(["adaptive", "fixed"]), sequence: count, observations: z.array(ObservationSchema).max(2000),
  seen_claims: z.array(id).max(20000), reviews: z.array(ReviewSchema).max(2000),
  reset_history: z.array(z.object({ id, reason: id, reviewer: id, recorded_at: z.string().datetime(),
    previous_hash: id })).max(64) }).strict();
export type StrategyPortfolio = z.infer<typeof PortfolioSchema>;
export type StrategyObservation = z.infer<typeof ObservationSchema>;
export const strategyVersion = (strategy: string) => `${strategy}:ashoka-1`;
export const portfolioHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function emptyPortfolio(): StrategyPortfolio { return { schema: "dreamgraph.strategy_portfolio.v1", revision: 0,
  mode: "adaptive", sequence: 0, observations: [], seen_claims: [], reviews: [], reset_history: [] }; }

/** Missing is an empty initial store; malformed existing state is unavailable, never reset. */
export async function readMetaDocument(): Promise<MetaLogFile & { portfolio?: StrategyPortfolio }> {
  return withGraphRead(async () => {
  try {
    const body = await readFile(dataPath("meta_log.json"), "utf8");
    const publication = await loadPublicationState();
    if (publication.stores["meta_log.json"] && publication.stores["meta_log.json"].hash !== publicationContentHash(body)) throw new Error("UNPUBLISHED_PORTFOLIO_CHANGE");
    if (Buffer.byteLength(body) > 16 * 1024 * 1024) throw new Error("META_LOG_CAPACITY");
    const doc = JSON.parse(stripBom(body));
    if (!doc || !doc.metadata || !Array.isArray(doc.entries)) throw new Error("META_LOG_INVALID");
    if (doc.portfolio !== undefined) doc.portfolio = PortfolioSchema.parse(doc.portfolio);
    return doc;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    if ((await loadPublicationState()).stores["meta_log.json"]) throw new Error("PUBLISHED_PORTFOLIO_MISSING");
    return { metadata: { description: "Metacognitive audit and strategy portfolio", schema_version: "1.2.0",
      total_entries: 0, last_analysis: null }, entries: [] };
  }
  });
}
export function snapshotLearningHash(snapshot: FactSnapshot): string {
  return portfolioHash([...snapshot.entities].sort(([a], [b]) => a.localeCompare(b))
    .map(([key, row]) => [key, { ...row, descriptionTokens: [...row.descriptionTokens].sort() }]));
}

/** Direction, kind and repository are part of identity. No prefix stripping or confidence. */
export function dreamClaimKey(row: DreamNode | DreamEdge, snapshot?: FactSnapshot, dreamNodes?: ReadonlyMap<string, DreamNode>): string {
  if ("from" in row) {
    const edge = row as DreamEdge & Record<string, unknown>;
    const endpoint = (side: "from" | "to") => {
      const fact = snapshot?.entities.get(edge[side]);
      const node = !fact ? dreamNodes?.get(edge[side]) : undefined;
      const recorded = (row.meta?.speculative_endpoint_keys as Record<string, unknown> | undefined)?.[side];
      const semanticKey = node ? dreamClaimKey(node) : edge[`${side}_kind`] === "dream_node" && typeof recorded === "string" && /^node:[a-f0-9]{64}$/.test(recorded) ? recorded : null;
      return semanticKey ? ["dream_node", semanticKey] : [edge[`${side}_repository_id`] ?? fact?.source_repo ?? "legacy",
        edge[`${side}_kind`] ?? fact?.type ?? "legacy", edge[side]];
    };
    return `edge:${portfolioHash([endpoint("from"), endpoint("to"), edge.relation])}`;
  }
  return `node:${portfolioHash([row.source_repo ?? "legacy", row.category ?? "feature", row.name.trim().normalize("NFKC").toLowerCase()])}`;
}
export function checkPortfolioCapacity(portfolio: StrategyPortfolio, maximum: number): void {
  if (portfolio.seen_claims.length + maximum > 20000 || portfolio.observations.length + ACTIVE_STRATEGY_NAMES.length > 2000)
    throw new Error("STRATEGY_PORTFOLIO_CAPACITY_REQUIRES_REVIEWED_RESET");
}
export function strategyScore(portfolio: StrategyPortfolio, strategy: string, inputHash: string): number {
  // Only explicit task/evidence reviews affect exploitation. Novelty and promotion rates are diagnostics.
  const reviews = portfolio.reviews.filter(r => r.strategy === strategy && r.version === strategyVersion(strategy) && r.input_hash === inputHash);
  const score = reviews.length ? Math.max(.25, Math.min(3, 1 + 2 * reviews.reduce((s, r) => s + (r.useful ? 1 : -1), 0) / reviews.length)) : 1;
  const threshold = portfolioSetting("DG_BARREN_THRESHOLD", 3), window = portfolioSetting("DG_STRATEGY_HISTORY", 12);
  const recent = portfolio.observations.filter(o => o.strategy === strategy && o.version === strategyVersion(strategy) && o.input_hash === inputHash && o.status === "completed").slice(-Math.min(threshold, window));
  return recent.length >= threshold && recent.every(o => o.novel === 0) ? Math.max(.25, score * .5) : score;
}
export function portfolioSetting(name: string, fallback: number): number {
  const value = process.env[name] === undefined ? fallback : Number(process.env[name]);
  if (!Number.isSafeInteger(value) || value < 1 || value > 2000) throw new Error(`STRATEGY_SETTING_INVALID:${name}`);
  return value;
}
export function allocatePortfolioBudgets(portfolio: StrategyPortfolio, names: readonly string[], total: number,
  inputHash: string, fractions: { llm: number; pgo: number }): Record<string, number> {
  const fixed = allocateStrategyBudgets(names, total, fractions);
  if (portfolio.mode === "fixed" || names.length <= 1 || total === 0) return fixed;
  const others = names.filter(n => !["llm_dream", "pgo_wave"].includes(n));
  const remaining = others.reduce((sum, n) => sum + fixed[n], 0);
  if (!remaining || !others.length) return fixed;
  const out = { ...fixed }; others.forEach(n => { out[n] = 0; });
  // At least one exploration slot; tiny allocations rotate across restarts. The rest exploits reviewed utility.
  const exploration = Math.max(1, Math.ceil(remaining / portfolioSetting("DG_PROBE_INTERVAL", 6)));
  for (let i = 0; i < exploration; i++) out[others[(portfolio.sequence + i) % others.length]]++;
  const weights = others.map(n => strategyScore(portfolio, n, inputHash)), sum = weights.reduce((a, b) => a + b, 0);
  const extra = remaining - exploration;
  const counts = weights.map(w => Math.floor(extra * w / sum));
  counts.forEach((n, i) => { out[others[i]] += n; });
  let leftover = extra - counts.reduce((a, b) => a + b, 0);
  const order = others.map((name, i) => ({ name, i, residual: extra * weights[i] / sum - counts[i] }))
    .sort((a, b) => b.residual - a.residual || ((a.i - portfolio.sequence % others.length + others.length) % others.length) - ((b.i - portfolio.sequence % others.length + others.length) % others.length));
  for (const item of order) { if (!leftover) break; out[item.name]++; leftover--; }
  return out;
}
export function appendPortfolioObservations(portfolio: StrategyPortfolio, observations: StrategyObservation[]): StrategyPortfolio {
  const next = structuredClone(portfolio), seen = new Set(next.seen_claims);
  for (const raw of observations) {
    const existing = next.observations.find(o => o.id === raw.id);
    if (existing) {
      const comparable = (o: StrategyObservation) => ({ ...o, novel: 0, claim_keys: [...new Set(o.claim_keys)] });
      if (portfolioHash(comparable(existing)) !== portfolioHash(comparable(raw))) throw new Error("STRATEGY_OBSERVATION_IDENTITY_CONFLICT");
      continue;
    }
    const row = ObservationSchema.parse(raw), keys = [...new Set(row.claim_keys)];
    row.novel = keys.filter(k => !seen.has(k)).length; row.claim_keys = keys;
    keys.forEach(k => seen.add(k)); next.observations.push(row);
  }
  next.seen_claims = [...seen]; next.sequence++; next.revision++;
  return PortfolioSchema.parse(next);
}

/** Every measured charge is joined to its durable attempt; absent usage stays unknown. */
export async function strategyCharge(attemptIds: string[]): Promise<Pick<StrategyObservation, "charge_nanounits" | "charge_provenance">> {
  if (!attemptIds.length) return { charge_nanounits: "0", charge_provenance: "no_provider_call" };
  try {
    const ledger = AdmissionLedgerSchema.parse(JSON.parse(stripBom(await readFile(dataPath("spend_ledger.json"), "utf8"))));
    const attempts = [...new Set(attemptIds)].map(id => ledger.attempts[id]);
    if (attempts.some(a => !a || a.state !== "settled" || a.charge_source !== "provider_usage_estimate"))
      return { charge_nanounits: null, charge_provenance: "unavailable" };
    return { charge_nanounits: attempts.reduce((sum, a) => sum + BigInt(a.accounted_nanounits), 0n).toString(), charge_provenance: "provider_usage_estimate" };
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return { charge_nanounits: null, charge_provenance: "unavailable" }; }
}
export function candidateAttribution(rows: Array<DreamNode | DreamEdge>): { attempt_ids: string[]; ancestry: string[] } {
  const proofs = rows.map(r => CognitiveProvenanceSchema.safeParse("from" in r ? r.meta?.model_provenance : r.model_provenance)).filter(p => p.success).map(p => p.data!);
  return { attempt_ids: [...new Set(proofs.flatMap(p => p.admission?.attempt_ids ?? []))], ancestry: [...new Set(proofs.flatMap(p => p.ancestry_ids))] };
}

/** Governance ports; a reset is archived atomically and never erases past analysis. */
export async function updatePortfolio(input: { reviewer: string; reason: string; expected_revision: number;
  mode?: "adaptive" | "fixed"; review?: z.infer<typeof ReviewSchema>; reset?: boolean; operation_id?: string }): Promise<StrategyPortfolio> {
  id.parse(input.reviewer); id.parse(input.reason);
  return withGraphReconciliation(async () => {
    if (input.operation_id && await findOperationReceipt(input.operation_id, "strategy_portfolio")) {
      const replay = await commitGraphWrites({ writes: [], actor: "strategy_portfolio", operation_id: input.operation_id,
        scope: ["meta_log.json"], intent: input, cause: "strategy_portfolio_review" });
      const file = replay.receipt.result?.portfolio_file, hash = replay.receipt.result?.portfolio_hash;
      if (typeof file !== "string" || !/^strategy-portfolio-result-[a-f0-9]{64}\.json$/.test(file) || typeof hash !== "string") throw new Error("STRATEGY_PORTFOLIO_REPLAY_UNAVAILABLE");
      const body = await readFile(dataPath(file), "utf8");
      if (publicationContentHash(body) !== hash) throw new Error("STRATEGY_PORTFOLIO_REPLAY_CHANGED");
      return PortfolioSchema.parse(JSON.parse(body));
    }
    const doc = await readMetaDocument(), current = doc.portfolio ?? emptyPortfolio();
    if (current.revision !== input.expected_revision) throw new Error("STRATEGY_PORTFOLIO_REVISION_CONFLICT");
    const next = input.reset ? emptyPortfolio() : structuredClone(current);
    const writes: Array<{ file: string; content: string }> = [];
    if (input.reset) {
      const resetId = randomUUID(), previousHash = portfolioHash(current);
      writes.push({ file: `strategy-portfolio-${previousHash}.json`, content: JSON.stringify(current) });
      next.reset_history = [...current.reset_history, { id: resetId, reason: input.reason, reviewer: input.reviewer,
        previous_hash: previousHash, recorded_at: new Date().toISOString() }];
    }
    if (input.mode) next.mode = input.mode;
    if (input.review) {
      const review = ReviewSchema.parse(input.review);
      if (review.reviewer !== input.reviewer || review.reason !== input.reason || !next.observations.some(o => o.strategy === review.strategy && o.version === review.version && o.input_hash === review.input_hash && o.claim_keys.includes(review.claim_key)))
        throw new Error("STRATEGY_REVIEW_UNOBSERVED_CLAIM");
      next.reviews = next.reviews.filter(r => !(r.claim_key === review.claim_key && r.reviewer === review.reviewer)); next.reviews.push(review);
    }
    next.revision = current.revision + 1; doc.portfolio = PortfolioSchema.parse(next);
    const resultBody = JSON.stringify(next), resultHash = publicationContentHash(resultBody), resultFile = `strategy-portfolio-result-${resultHash.slice(7)}.json`;
    writes.push({ file: resultFile, content: resultBody });
    writes.push({ file: "meta_log.json", content: JSON.stringify(doc) });
    await commitGraphWrites({ writes, actor: "strategy_portfolio", scope: ["meta_log.json"], operation_id: input.operation_id, intent: input,
      result: { revision: next.revision, mode: next.mode, portfolio_file: resultFile, portfolio_hash: resultHash }, cause: "strategy_portfolio_review" });
    return next;
  });
}
