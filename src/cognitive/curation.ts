/** Append-only human dispositions and reversible archives on the existing maintenance owner. */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { dataPath } from "../utils/paths.js";
import { stripBom } from "../utils/read-json.js";
import { commitGraphWrites, findOperationReceipt, loadPublicationState, publicationContentHash, type CommitGraphInput } from "../graph/publication.js";
import { withGraphReconciliation } from "../utils/graph-reconciliation-barrier.js";
import { loadGraphMaintenanceState } from "./graph-maintenance-state.js";
import { dreamClaimKey } from "./strategy-portfolio.js";
import { normalizationClaimKey, NormalizationClaimSchema, type NormalizationClaim } from "./normalization-evidence.js";
import { loadCanonicalGraph } from "../graph/read-model.js";
import { getActiveScope } from "../instance/index.js";
import type { DreamNode, DreamEdge, DreamGraphFile, CandidateEdgesFile, ValidatedEdgesFile } from "./types.js";

const id = z.string().min(1).max(2048);
export const CurationSchema = z.object({ schema: z.literal("dreamgraph.curation.v1"), revision: z.number().int().nonnegative(),
  memory_window_cycles: z.number().int().positive().max(2000).default(30),
  decisions: z.array(z.object({ id, target_type: z.enum(["edge", "node"]), target_id: id, keys: z.array(id).min(1).max(3),
    action: z.enum(["reject", "retire", "reopen", "expire", "restore", "assert"]), actor: id, reason: id,
    archive_file: z.string().regex(/^(curation|expiry)-[a-f0-9]{64}\.json$/).nullable(), archive_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/).nullable(), previous_id: id.nullable(), recorded_at: z.string().datetime(), cycle: z.number().int().nonnegative().optional() }).strict()).max(10000) }).strict();
export type CurationState = z.infer<typeof CurationSchema>;
export const emptyCuration = (): CurationState => ({ schema: "dreamgraph.curation.v1", revision: 0, memory_window_cycles: 30, decisions: [] });
const CURATION_SCOPE = ["candidate_edges.json", "dream_graph.json", "graph_maintenance.json", "validated_edges.json"];
export const recentExpiryDecisions = (state: CurationState, cycle: number) => state.decisions.filter(d => d.action === "expire" && d.cycle !== undefined && cycle >= d.cycle && cycle - d.cycle <= state.memory_window_cycles);
export function curationSuppressions(state: CurationState): Set<string> {
  const dispositions = new Map<string, boolean>();
  for (const decision of state.decisions) {
    if (decision.action === "expire") continue;
    for (const key of decision.keys) dispositions.set(key, ["reject", "retire"].includes(decision.action));
  }
  return new Set([...dispositions].filter(([, retired]) => retired).map(([key]) => key));
}
export function curationKeys(row: DreamNode | DreamEdge, claim?: NormalizationClaim | null): string[] {
  const assessed = NormalizationClaimSchema.safeParse(row.evidence_assessment?.claim);
  return [...new Set([dreamClaimKey(row), ...(claim ? [normalizationClaimKey(claim)] : assessed.success ? [normalizationClaimKey(assessed.data)] : [])])];
}
async function readDoc<T>(file: string, fallback: T): Promise<T> {
  try { return JSON.parse(stripBom(await readFile(dataPath(file), "utf8"))) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; return fallback; }
}
export interface CurationInput {
  target_id: string; target_type: "edge" | "node"; action: "reject" | "retire" | "reopen" | "restore" | "assert";
  actor: string; reason: string; expected_revision: string | null; operation_id?: string; decision_id?: string;
  replacement?: DreamEdge; dry_run?: boolean; fault_inject?: CommitGraphInput["fault_inject"];
}
export async function curateGraph(input: CurationInput) {
  [input.target_id, input.actor, input.reason].forEach(value => id.parse(value));
  const operation = input.operation_id ?? `curation:${randomUUID()}`;
  const intent = { ...input }; delete intent.fault_inject;
  return withGraphReconciliation(async () => {
    // Replay only the identical operator intent; a changed payload cannot reuse its receipt.
    const replay = await findOperationReceipt(operation, "graph_curation");
    if (replay) {
      const result = await commitGraphWrites({ writes: [], actor: "graph_curation", scope: CURATION_SCOPE, operation_id: operation, intent, cause: "graph_curation" });
      return { ...result, decision: result.receipt.result?.decision, dry_run: false };
    }
    const publication = await loadPublicationState();
    if (publication.revision.graph_revision !== input.expected_revision) throw new Error("CURATION_REVISION_CONFLICT");
    const maintenance = await loadGraphMaintenanceState(), curation = maintenance.curation ?? emptyCuration();
    if (curation.decisions.length >= 10000) throw new Error("CURATION_CAPACITY_REQUIRES_ARCHIVE");
    const dream = await readDoc<DreamGraphFile>("dream_graph.json", { metadata: {} as DreamGraphFile["metadata"], nodes: [], edges: [] });
    const validated = await readDoc<ValidatedEdgesFile>("validated_edges.json", { metadata: {} as ValidatedEdgesFile["metadata"], edges: [] });
    const candidates = await readDoc<CandidateEdgesFile>("candidate_edges.json", { metadata: {} as CandidateEdgesFile["metadata"], results: [] });
    if (!Array.isArray(dream.nodes) || !Array.isArray(dream.edges) || !Array.isArray(validated.edges) || !Array.isArray(candidates.results)) throw new Error("CURATION_STORE_INVALID");
    const row = input.target_type === "edge" ? validated.edges.find(e => e.id === input.target_id) ?? dream.edges.find(e => e.id === input.target_id) : dream.nodes.find(n => n.id === input.target_id);
    const previous = [...curation.decisions].reverse().find(d => d.target_id === input.target_id && d.target_type === input.target_type);
    if (input.decision_id && previous?.id !== input.decision_id) throw new Error("CURATION_DECISION_CONFLICT");
    if (!row && !previous) throw new Error("CURATION_TARGET_NOT_FOUND");
    if (["reopen", "restore"].includes(input.action) && (!previous || !["reject", "retire"].includes(previous.action))) throw new Error("CURATION_REOPEN_REQUIRES_RETIRED_DECISION");
    if (input.action === "assert" && (input.target_type !== "edge" || !row || previous && ["reject", "retire"].includes(previous.action))) throw new Error("CURATION_ASSERT_REQUIRES_REOPEN_OR_ACTIVE_EDGE");
    const aliases = new Set([input.target_id, ...(row && "source_dream_id" in row && typeof row.source_dream_id === "string" ? [row.source_dream_id] : [])]);
    const before = { dream_nodes: dream.nodes.filter(n => input.target_type === "node" && aliases.has(n.id)),
      dream_edges: dream.edges.filter(e => input.target_type === "edge" && aliases.has(e.id) || input.target_type === "node" && (aliases.has(e.from) || aliases.has(e.to))),
      validated_edges: validated.edges.filter(e => aliases.has(e.id) || (e as unknown as Record<string, unknown>).source_dream_id === input.target_id),
      candidates: candidates.results.filter(r => aliases.has(r.dream_id) && r.dream_type === input.target_type) };
    const archiveBody = JSON.stringify({ schema: "dreamgraph.curation_archive.v1", target_id: input.target_id, target_type: input.target_type, before });
    const archiveHash = publicationContentHash(archiveBody), archiveFile = `curation-${archiveHash.slice(7)}.json`;
    let claim: NormalizationClaim | null = null, typedKey: string | null = null;
    if (row && "from" in row) {
      const graph = await loadCanonicalGraph(getActiveScope()?.uuid ?? "legacy");
      const endpoint = (side: "from" | "to") => {
        const candidates = graph.entities.filter(e => e.identity.id === row[side] && !["dream_node", "validated", "candidate"].includes(e.identity.kind)
          && (!(row as unknown as Record<string, unknown>)[`${side}_kind`] || e.identity.kind === (row as unknown as Record<string, unknown>)[`${side}_kind`])
          && (!(row as unknown as Record<string, unknown>)[`${side}_repository_id`] || e.identity.repository_id === (row as unknown as Record<string, unknown>)[`${side}_repository_id`]));
        return candidates.length === 1 ? candidates[0].identity : null;
      };
      const from = endpoint("from"), to = endpoint("to");
      if (from && to) {
        claim = { type: "edge", from, to, relation: row.relation };
        typedKey = dreamClaimKey({ ...row, from_kind: from.kind, to_kind: to.kind, from_repository_id: from.repository_id ?? undefined, to_repository_id: to.repository_id ?? undefined } as DreamEdge);
      }
    }
    const decision: CurationState["decisions"][number] = { id: operation, target_id: input.target_id, target_type: input.target_type,
      action: input.action, actor: input.actor, reason: input.reason, keys: row ? [...new Set([...curationKeys(row as DreamNode | DreamEdge, claim), ...(typedKey ? [typedKey] : [])])] : previous!.keys,
      archive_file: ["reject", "retire"].includes(input.action) ? archiveFile : previous?.archive_file ?? null,
      archive_hash: ["reject", "retire"].includes(input.action) ? archiveHash : previous?.archive_hash ?? null,
      previous_id: previous?.id ?? null, recorded_at: new Date().toISOString() };
    const writes: Array<{ file: string; content: string }> = [];
    if (["reject", "retire"].includes(input.action)) {
      writes.push({ file: archiveFile, content: archiveBody });
      if (input.action === "retire") {
        dream.nodes = dream.nodes.filter(n => input.target_type !== "node" || !aliases.has(n.id));
        dream.edges = dream.edges.filter(e => !aliases.has(e.id) && (input.target_type !== "node" || !aliases.has(e.from) && !aliases.has(e.to)));
      } else {
        for (const n of dream.nodes.filter(n => input.target_type === "node" && aliases.has(n.id))) n.status = "rejected";
        for (const e of dream.edges.filter(e => aliases.has(e.id) || input.target_type === "node" && (aliases.has(e.from) || aliases.has(e.to)))) e.status = "rejected";
      }
      validated.edges = validated.edges.filter(e => !before.validated_edges.includes(e));
      // Normalization history/counters are immutable. Human disposition is a separate overlay.
    } else if (input.action === "reopen") {
      for (const n of dream.nodes.filter(n => input.target_type === "node" && aliases.has(n.id))) {
        n.status = "latent"; n.evidence_assessment = undefined; n.promoted_at = undefined;
      }
      for (const e of dream.edges.filter(e => aliases.has(e.id))) { e.status = "latent"; e.evidence_assessment = undefined; }
    } else if (input.action === "restore") {
      if (!previous!.archive_file || !previous!.archive_hash) throw new Error("CURATION_ARCHIVE_MISSING");
      const body = await readFile(dataPath(previous!.archive_file), "utf8");
      if (publicationContentHash(body) !== previous!.archive_hash) throw new Error("CURATION_ARCHIVE_CHANGED");
      const document = JSON.parse(body), archive = document.before as typeof before;
      if (document.schema !== "dreamgraph.curation_archive.v1" || document.target_id !== input.target_id || document.target_type !== input.target_type
        || !archive || !Array.isArray(archive.dream_nodes) || !Array.isArray(archive.dream_edges) || !Array.isArray(archive.validated_edges)) throw new Error("CURATION_ARCHIVE_INVALID");
      const graph = await loadCanonicalGraph(getActiveScope()?.uuid ?? "legacy");
      for (const n of archive.dream_nodes) {
        const existing = dream.nodes.find(row => row.id === n.id);
        if (existing && dreamClaimKey(existing) !== dreamClaimKey(n)) throw new Error("CURATION_RESTORE_SUBJECT_CONFLICT");
        dream.nodes = dream.nodes.filter(row => row.id !== n.id); dream.nodes.push({ ...n, status: "latent", evidence_assessment: undefined, promoted_at: undefined });
      }
      for (const e of archive.dream_edges) {
        const existing = dream.edges.find(row => row.id === e.id);
        if (existing && dreamClaimKey(existing) !== dreamClaimKey(e)) throw new Error("CURATION_RESTORE_SUBJECT_CONFLICT");
        for (const side of ["from", "to"] as const) {
          const kind = e[`${side}_kind`], repo = e[`${side}_repository_id`];
          const endpoints = graph.entities.filter(entity => entity.identity.id === e[side] && !["candidate", "validated", "dream_node"].includes(entity.identity.kind)
            && (!kind || entity.identity.kind === kind) && (!repo || entity.identity.repository_id === repo));
          const hubs = dream.nodes.filter(node => node.id === e[side] && (!kind || kind === "dream_node") && (!repo || node.source_repo === repo));
          if (endpoints.length + hubs.length !== 1) throw new Error("CURATION_RESTORE_ENDPOINT_UNAVAILABLE");
        }
        dream.edges = dream.edges.filter(row => row.id !== e.id); dream.edges.push({ ...e, status: "latent", evidence_assessment: undefined });
      }
      // Restored corroboration must be re-evaluated. Historical promotion receipts never grant new proof.
    }
    if (input.replacement) {
      if (input.target_type !== "edge" || input.action !== "retire") throw new Error("CURATION_REPLACEMENT_INVALID");
      dream.edges.push({ ...input.replacement, status: "candidate", origin: "rem", reinforcement_count: 0,
        meta: { ...input.replacement.meta, human_assertion: { actor: input.actor, reason: input.reason, previous_id: input.target_id } } });
    }
    if (input.action === "assert" && row && "from" in row) {
      const assertion = { id: `validated_${input.target_id}`, from: row.from, to: row.to, relation: row.relation,
        type: "feature" as const, description: "reason" in row ? row.reason : row.description,
        confidence: row.confidence, plausibility: 0, evidence_score: 0, origin: "rem" as const, status: "validated" as const,
        human_asserted: true, human_assertion: { actor: input.actor, reason: input.reason, operation_id: operation }, source_dream_id: input.target_id,
        evidence_summary: `Human assertion: ${input.reason}`, evidence_count: 0, reinforcement_count: 0,
        dream_cycle: row.dream_cycle, normalization_cycle: 0, validated_at: decision.recorded_at,
        ...(claim?.type === "edge" ? { from_kind: claim.from.kind, to_kind: claim.to.kind,
          from_repository_id: claim.from.repository_id ?? undefined, to_repository_id: claim.to.repository_id ?? undefined } : {}) };
      validated.edges = validated.edges.filter(e => e.id !== assertion.id); validated.edges.push(assertion);
    }
    curation.decisions.push(decision); curation.revision++; maintenance.curation = CurationSchema.parse(curation);
    validated.metadata.total_validated = validated.edges.length;
    writes.push({ file: "graph_maintenance.json", content: JSON.stringify(maintenance) },
      { file: "dream_graph.json", content: JSON.stringify(dream) }, { file: "validated_edges.json", content: JSON.stringify(validated) },
      { file: "candidate_edges.json", content: JSON.stringify(candidates) });
    if (input.dry_run) return { decision, dry_run: true, affected_files: writes.map(w => w.file), receipt: null };
    const result = await commitGraphWrites({ writes, actor: "graph_curation", scope: CURATION_SCOPE, operation_id: operation, intent,
      expected_graph_revision: input.expected_revision, result: { decision }, cause: "graph_curation", fault_inject: input.fault_inject });
    return { ...result, decision, dry_run: false };
  });
}

/** Archive expiry in the same publication as removal. No resurrection confidence memory. */
export async function decayArchiveWrites(nodes: DreamNode[], edges: DreamEdge[], cycle: number) {
  const maintenance = await loadGraphMaintenanceState(), state = maintenance.curation ?? emptyCuration();
  const body = JSON.stringify({ schema: "dreamgraph.expiry_archive.v1", cycle, nodes, edges });
  const hash = publicationContentHash(body), file = `expiry-${hash.slice(7)}.json`, timestamp = new Date().toISOString();
  const window = process.env.DG_MEMORY_TTL_CYCLES === undefined ? 30 : Number(process.env.DG_MEMORY_TTL_CYCLES);
  if (!Number.isSafeInteger(window) || window < 1 || window > 2000) throw new Error("CURATION_MEMORY_WINDOW_INVALID");
  state.memory_window_cycles = window;
  for (const row of [...nodes, ...edges]) state.decisions.push({ id: `expiry:${hash}:${row.id}`, target_type: "from" in row ? "edge" : "node",
    target_id: row.id, keys: curationKeys(row), action: "expire", actor: "dream_decay", reason: "Speculative cycle lifetime expired; no source fact or human assertion deleted",
    archive_file: file, archive_hash: hash, previous_id: null, recorded_at: timestamp, cycle });
  state.revision++; maintenance.curation = CurationSchema.parse(state);
  return [{ file, content: body }, { file: "graph_maintenance.json", content: JSON.stringify(maintenance) }];
}
