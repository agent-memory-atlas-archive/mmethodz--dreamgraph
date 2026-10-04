/**
 * The one definition of the normalization validation pipeline, shared by the
 * Status board (engine getStatus), `dg status` and the Explorer.
 *
 * Unit: a dream (dream_type + dream_id). candidate_edges.json is assessment
 * history: a latent dream is re-assessed every normalization cycle until it is
 * validated or rejected, so raw rows over-count latent work. Each dream counts
 * once, with the status of its latest assessment (highest normalization_cycle,
 * then latest validated_at). Validated and rejected are terminal, so those
 * counts equal the historical row counts.
 *
 * Status mapping is the historical one: "validated", "latent", anything else
 * counts as rejected.
 */

export type PipelineStatus = "validated" | "latent" | "rejected";

export interface ValidationPipelineCounts {
  /** Dreams with at least one assessment. */
  assessed: number;
  validated: number;
  rejected: number;
  /** Dreams still pending (latest assessment latent). */
  latent: number;
  by_type: Record<"edge" | "node" | "other", Record<PipelineStatus, number>>;
  /** validated / (validated + rejected): share of decided dreams that were validated. Null when nothing is decided. */
  validation_rate: number | null;
  /** Raw assessment rows in candidate_edges.json (includes repeated latent re-assessments). */
  assessment_rows: number;
  /** Raw latent assessment rows (one per cycle a dream stayed latent). */
  latent_assessments: number;
  /** Rows in validated_edges.json: promoted edges (normalization promotions plus e.g. tension-resolution edges). Null when not read. */
  promoted_edges: number | null;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const statusOf = (row: Record<string, unknown>): PipelineStatus =>
  row.status === "validated" ? "validated" : row.status === "latent" ? "latent" : "rejected";
const time = (value: unknown): number => {
  if (typeof value !== "string") return Number.NEGATIVE_INFINITY;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
};
const cycle = (value: unknown): number => typeof value === "number" && Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;

/** Rows of a store document: the array itself, or the named array inside it. */
export function storeRows(document: unknown, key: string): unknown[] {
  if (Array.isArray(document)) return document;
  const value = asRecord(document)?.[key];
  return Array.isArray(value) ? value : [];
}

export function validationPipelineCounts(candidateResults: readonly unknown[], validatedEdges?: readonly unknown[] | null): ValidationPipelineCounts {
  const latest = new Map<string, Record<string, unknown>>();
  let assessment_rows = 0, latent_assessments = 0, anonymous = 0;
  for (const value of candidateResults) {
    const row = asRecord(value);
    if (!row || row._schema !== undefined || row._note !== undefined) continue;
    assessment_rows++;
    if (statusOf(row) === "latent") latent_assessments++;
    const type = typeof row.dream_type === "string" ? row.dream_type : "other";
    const key = typeof row.dream_id === "string" && row.dream_id ? `${type}\u0000${row.dream_id}` : `anonymous\u0000${anonymous++}`;
    const prior = latest.get(key);
    if (!prior || cycle(row.normalization_cycle) > cycle(prior.normalization_cycle)
      || (cycle(row.normalization_cycle) === cycle(prior.normalization_cycle) && time(row.validated_at) >= time(prior.validated_at))) latest.set(key, row);
  }
  const empty = (): Record<PipelineStatus, number> => ({ validated: 0, latent: 0, rejected: 0 });
  const by_type: ValidationPipelineCounts["by_type"] = { edge: empty(), node: empty(), other: empty() };
  for (const row of latest.values()) {
    const type = row.dream_type === "edge" || row.dream_type === "node" ? row.dream_type : "other";
    by_type[type][statusOf(row)]++;
  }
  const total = (status: PipelineStatus) => by_type.edge[status] + by_type.node[status] + by_type.other[status];
  const validated = total("validated"), rejected = total("rejected"), latent = total("latent");
  return {
    assessed: latest.size, validated, rejected, latent, by_type,
    validation_rate: validated + rejected > 0 ? validated / (validated + rejected) : null,
    assessment_rows, latent_assessments,
    promoted_edges: validatedEdges ? validatedEdges.filter(value => { const row = asRecord(value); return !!row && row._schema === undefined && row._note === undefined; }).length : null,
  };
}

/** "14.7%" style, or "n/a". */
export function formatValidationRate(rate: number | null): string {
  return rate === null ? "n/a" : `${(rate * 100).toFixed(1)}%`;
}
