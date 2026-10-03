/** Three-way entity deltas and checkpoint/index outcomes at one durable boundary. */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { z } from "zod";
import { dataPath } from "../utils/paths.js";
import { stripBom } from "../utils/read-json.js";
import { withGraphReconciliation } from "../utils/graph-reconciliation-barrier.js";
import { commitGraphWrites, findOperationReceipt, publicationContentHash, recoverGraphPublication, type CommitGraphInput } from "../graph/publication.js";
import { CANONICAL_FAMILIES } from "../graph/read-model.js";
import type { GraphIdentity, OperationReceipt } from "../graph/contracts.js";
import { EnrichmentRunSchema, loadEnrichmentRun, type EnrichmentRunState } from "./enrichment-state.js";
import { loadScanState } from "./scan-state.js";

type Row = Record<string, unknown>;
export interface EnrichmentDelta {
  file: string; kind: GraphIdentity["kind"]; checkpoint_id: string; base: Row; next: Row;
}
export interface EnrichmentBatchInput {
  operation_id: string; scan_revision: string; checkpoint_before: EnrichmentRunState; checkpoint_after: EnrichmentRunState;
  deltas: EnrichmentDelta[];
  source_checks?: Array<{ path: string; content_hash: string; checkpoint_ids: string[] }>;
  fault_inject?: CommitGraphInput["fault_inject"];
}
const BatchResultSchema = z.object({ applied_ids: z.array(z.string()),
  conflicts: z.array(z.object({ checkpoint_id: z.string(), reason: z.string(), fields: z.array(z.string()) })),
  outcomes: z.record(z.object({ state: z.string(), attempts: z.number(), updated_at: z.string(), reason: z.string().optional() })) });
export type EnrichmentBatchResult = z.infer<typeof BatchResultSchema>;
const stable = (value: unknown): string => value === undefined ? "undefined" : value === null || typeof value !== "object" ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(stable).join(",")}]`
  : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable((value as Row)[key])}`).join(",")}}`;
const equal = (left: unknown, right: unknown): boolean => stable(left) === stable(right);
export const enrichmentNodeKey = (file: string, row: Row): string => [file, String(row.source_repo ?? ""), String(row.id)].map(encodeURIComponent).join("/");
const actor = "semantic_enrichment";
const sourceFields = ["source_repo", "source_file", "source_files", "source_hashes", "source_revision", "provenance", "key_fields", "implementations", "steps", "model_kind"];
async function document(file: string, fallback?: unknown): Promise<{ raw: unknown; hash: string | null }> {
  try { const body = await readFile(dataPath(file), "utf8"); return { raw: JSON.parse(stripBom(body)), hash: publicationContentHash(body) }; }
  catch (failure) { if ((failure as NodeJS.ErrnoException).code === "ENOENT" && fallback !== undefined) return { raw: fallback, hash: null }; throw failure; }
}
function collection(file: string, raw: unknown): Row[] {
  if (Array.isArray(raw)) { z.array(z.record(z.unknown())).parse(raw); return raw as Row[]; }
  const wrapper = z.record(z.unknown()).parse(raw);
  const family = CANONICAL_FAMILIES.find(f => f.file === file);
  if (!family) throw new Error(`ENRICHMENT_STORE_UNSUPPORTED: ${file}`);
  const fields = family.arrays.filter(field => Array.isArray(wrapper[field]));
  if (fields.length !== 1) throw new Error(`INVALID_STORE_SHAPE: ${file}`);
  // Mutate the actual document array; retain every wrapper and unrelated field.
  z.array(z.record(z.unknown())).parse(wrapper[fields[0]]);
  return wrapper[fields[0]] as Row[];
}

export async function publishEnrichmentBatch(input: EnrichmentBatchInput): Promise<{
  receipt: OperationReceipt; batch: EnrichmentBatchResult; checkpoint: EnrichmentRunState; replayed: boolean;
}> {
  EnrichmentRunSchema.parse(input.checkpoint_before); EnrichmentRunSchema.parse(input.checkpoint_after);
  const intent = { scan_revision: input.scan_revision, before: input.checkpoint_before, after: input.checkpoint_after,
    deltas: input.deltas, source_checks: input.source_checks ?? [] };
  const scope = [...new Set(["enrichment_state.json", "index.json", ...input.deltas.map(delta => delta.file)])].sort();
  return withGraphReconciliation(async () => {
    await recoverGraphPublication();
    const existing = await findOperationReceipt(input.operation_id, actor);
    if (existing) {
      const replay = await commitGraphWrites({ writes: [], actor, scope, operation_id: input.operation_id, intent, cause: "enrichment" });
      const checkpoint = await loadEnrichmentRun(dataPath("enrichment_state.json"));
      if (!checkpoint || checkpoint.run_id !== input.checkpoint_before.run_id) throw new Error("ENRICHMENT_RUN_CHANGED: committed receipt remains available; do not repeat the batch");
      return { receipt: replay.receipt, batch: BatchResultSchema.parse(replay.result), checkpoint, replayed: true };
    }
    const scan = await loadScanState();
    if (scan.status !== "missing" && scan.status !== "compatible") throw new Error(`ENRICHMENT_SCAN_UNAVAILABLE: ${scan.reason}`);
    if ((scan.state?.committed_revision ?? "legacy-unscoped") !== input.scan_revision) throw new Error("ENRICHMENT_SCAN_REVISION_CHANGED");
    const checkpointDoc = await document("enrichment_state.json");
    const checkpoint = EnrichmentRunSchema.parse(checkpointDoc.raw);
    if (checkpoint.run_id !== input.checkpoint_before.run_id || !equal(checkpoint, input.checkpoint_before)) throw new Error("ENRICHMENT_CHECKPOINT_CONFLICT");
    const nextCheckpoint = structuredClone(input.checkpoint_after);
    const batch: EnrichmentBatchResult = { applied_ids: [], conflicts: [], outcomes: {} };
    const files = new Map<string, Awaited<ReturnType<typeof document>>>();
    const seen = new Set<string>();
    const sourceChanged = new Set<string>();
    for (const check of input.source_checks ?? []) {
      let current: string | null = null;
      try { current = createHash("sha256").update(await readFile(check.path)).digest("hex"); }
      catch (failure) { if ((failure as NodeJS.ErrnoException).code !== "ENOENT") throw failure; }
      if (current !== check.content_hash) for (const id of check.checkpoint_ids) sourceChanged.add(id);
    }
    const indexDoc = await document("index.json", { entities: {} });
    const index = z.object({ entities: z.record(z.unknown()) }).passthrough().parse(indexDoc.raw);
    for (const delta of input.deltas) {
      const identity = enrichmentNodeKey(delta.file, delta.base);
      if (seen.has(identity)) throw new Error(`DUPLICATE_ENRICHMENT_DELTA: ${identity}`);
      seen.add(identity);
      if (!equal(delta.base.id, delta.next.id) || !equal(delta.base.source_repo, delta.next.source_repo)) throw new Error("ENRICHMENT_IDENTITY_CHANGE_FORBIDDEN");
      let file = files.get(delta.file);
      if (!file) { file = await document(delta.file); files.set(delta.file, file); }
      const rows = collection(delta.file, file.raw);
      const candidates = rows.filter(row => enrichmentNodeKey(delta.file, row) === identity);
      if (candidates.length > 1) throw new Error(`AMBIGUOUS_ENRICHMENT_ENTITY: ${identity}`);
      const current = candidates[0];
      const modified = Object.keys(delta.next).filter(field => field !== "graph_type" && !equal(delta.base[field], delta.next[field]));
      const conflictFields = current ? modified.filter(field => !equal(current[field], delta.base[field]) && !equal(current[field], delta.next[field])) : [];
      const sourceChangedFields = current ? sourceFields.filter(field => !equal(current[field], delta.base[field])) : [];
      const reason = !current ? "entity_removed" : sourceChanged.has(delta.checkpoint_id) || sourceChangedFields.length ? "source_changed" : conflictFields.length ? "concurrent_edit_conflict" : null;
      if (reason) {
        batch.conflicts.push({ checkpoint_id: delta.checkpoint_id, reason, fields: [...new Set([...sourceChangedFields, ...conflictFields])] });
        // No generated field is published on a changed source or curated record.
        const outcome = nextCheckpoint.nodes[delta.checkpoint_id];
        if (!outcome) throw new Error(`ENRICHMENT_NODE_NOT_ELIGIBLE: ${delta.checkpoint_id}`);
        nextCheckpoint.nodes[delta.checkpoint_id] = { ...outcome, state: "failed_retryable", reason };
        continue;
      }
      for (const field of modified) current[field] = structuredClone(delta.next[field]);
      batch.applied_ids.push(delta.checkpoint_id);
      // Legacy aliases survive only where they already identify this entity.
      const entry = { type: delta.kind, uri: `dreamgraph://resource/${delta.kind}/${encodeURIComponent(String(current.id))}`,
        name: String(current.name ?? current.title ?? current.id), source_repo: String(current.source_repo ?? "") };
      index.entities[identity] = entry;
      const alias = index.entities[String(current.id)] as Row | undefined;
      if (alias && alias.type === delta.kind && alias.source_repo === entry.source_repo) index.entities[String(current.id)] = entry;
    }
    for (const id of Object.keys(nextCheckpoint.nodes)) {
      if (!equal(checkpoint.nodes[id], nextCheckpoint.nodes[id])) batch.outcomes[id] = nextCheckpoint.nodes[id];
    }
    const writes = [...files].map(([file, doc]) => ({ file, content: JSON.stringify(doc.raw, null, 2) }));
    writes.push({ file: "index.json", content: JSON.stringify(index, null, 2) }, { file: "enrichment_state.json", content: JSON.stringify(nextCheckpoint, null, 2) });
    const committed = await commitGraphWrites({ writes, actor, scope, operation_id: input.operation_id, intent, cause: "enrichment",
      expected_store_hashes: { ...Object.fromEntries([...files].map(([file, doc]) => [file, doc.hash])), "index.json": indexDoc.hash, "enrichment_state.json": checkpointDoc.hash },
      result: batch, fault_inject: input.fault_inject });
    return { receipt: committed.receipt, batch, checkpoint: nextCheckpoint, replayed: committed.replayed };
  });
}
