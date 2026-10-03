/** Coherent normalizer snapshot and commit; a failed write is never called a successful rollback. */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dataPath, getDataDir } from "../utils/paths.js";
import { stripBom } from "../utils/read-json.js";
import { withGraphRead } from "../utils/graph-reconciliation-barrier.js";
import { commitGraphWrites, publicationContentHash, type CommitGraphInput } from "../graph/publication.js";
import { loadCanonicalGraph, type CanonicalGraphRead } from "../graph/read-model.js";
import { graphIdentityKey, type GraphIdentity } from "../graph/contracts.js";
import { graphEventBus } from "../graph/events.js";
import { getActiveScope } from "../instance/index.js";
import { assessClaimEvidence, claimCurrencyReasons, claimSourceScopes, loadClaimEvidence, NORMALIZATION_EVIDENCE_FILE,
  type ClaimEvidenceSnapshot, type NormalizationClaim } from "./normalization-evidence.js";
import type { CandidateEdgesFile, DreamEdge, DreamGraphFile, DreamNode, ValidatedEdge, ValidatedEdgesFile, ValidationResult } from "./types.js";
import { normalizationResultFile, NORMALIZATION_RESULT_LIMIT } from "./normalization-results.js";
import { loadGraphMaintenanceState } from "./graph-maintenance-state.js";

export const NORMALIZATION_SCOPE = ["candidate_edges.json", "data_model.json", "dream_graph.json", "features.json", "index.json", "validated_edges.json", "workflows.json"];
type Doc = { raw: unknown; hash: string | null };
export interface NormalizationSnapshot {
  graph: CanonicalGraphRead; evidence: ClaimEvidenceSnapshot; documents: Map<string, Doc>; evidence_fingerprint: string;
  maintenance: Awaited<ReturnType<typeof loadGraphMaintenanceState>>;
}
const fallback = (file: string): unknown => ["features.json", "workflows.json", "data_model.json"].includes(file) ? []
  : file === "index.json" ? { entities: {} }
  : { metadata: { description: "", schema_version: "1.0.0", created_at: new Date().toISOString() },
    ...(file === "candidate_edges.json" ? { results: [] } : file === "validated_edges.json" ? { edges: [] } : { nodes: [], edges: [] }) };
export async function readNormalizationSnapshot(instanceId = getActiveScope()?.uuid ?? "legacy"): Promise<NormalizationSnapshot> {
  return withGraphRead(async () => {
    const graph = await loadCanonicalGraph(instanceId), evidence = await loadClaimEvidence();
    if (graph.state.reasons.some(r => /INVALID_STORE|MISSING_ENTITY|DUPLICATE_TYPED|UNPUBLISHED|PUBLISHED_STORE|UNSUPPORTED_STORE/.test(r.code))) throw new Error("NORMALIZATION_GRAPH_UNAVAILABLE: " + JSON.stringify(graph.state.reasons));
    const documents = new Map<string, Doc>();
    for (const file of NORMALIZATION_SCOPE) {
      try { const body = await readFile(dataPath(file), "utf8"); documents.set(file, { raw: JSON.parse(stripBom(body)), hash: publicationContentHash(body) }); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; documents.set(file, { raw: fallback(file), hash: null }); }
    }
    for (const [file, key] of [["dream_graph.json", "edges"], ["dream_graph.json", "nodes"], ["candidate_edges.json", "results"], ["validated_edges.json", "edges"]]) {
      const raw = documents.get(file)!.raw as Record<string, unknown>;
      if (!raw || typeof raw !== "object" || !Array.isArray(raw[key])) throw new Error(`NORMALIZATION_STORE_INVALID: ${file}.${key}`);
      const ids = new Set<string>();
      for (const row of raw[key] as Record<string, unknown>[]) {
        const identity = key === "results" ? `${row.dream_type}:${row.dream_id}:${row.normalization_cycle}` : String(row.id);
        if (identity === "undefined" || ids.has(identity)) throw new Error(`NORMALIZATION_ID_AMBIGUOUS: ${file}`);
        ids.add(identity);
      }
    }
    const sourceStores = Object.entries(graph.store_hashes).filter(([file]) => !["dream_graph.json", "candidate_edges.json", "validated_edges.json"].includes(file));
    const currency = graph.state.reasons.filter(r => ["SOURCE_RECONCILIATION_PENDING", "SOURCE_EFFECT_UNKNOWN", "CHANGE_LEDGER_UNAVAILABLE"].includes(r.code));
    const maintenance = await loadGraphMaintenanceState();
    const evidence_fingerprint = createHash("sha256").update(JSON.stringify([sourceStores, evidence.hash, [...evidence.current_sources], currency, maintenance.curation ?? null])).digest("hex");
    return { graph, evidence, documents, evidence_fingerprint, maintenance };
  });
}
const kinds = new Set<GraphIdentity["kind"]>(["feature", "workflow", "data_model", "capability", "datastore", "ui_element", "auxiliary"]);
export function edgeClaim(edge: Pick<DreamEdge, "from" | "to" | "relation"> & Record<string, unknown>, graph: CanonicalGraphRead): NormalizationClaim | null {
  function endpoint(id: string, kind: unknown, repo: unknown): GraphIdentity | null {
    const matches = graph.entities.filter(e => kinds.has(e.identity.kind) && e.identity.id === id
      && (kind === undefined || e.identity.kind === kind) && (repo === undefined || e.identity.repository_id === repo));
    return matches.length === 1 ? matches[0].identity : null;
  }
  const from = endpoint(edge.from, edge.from_kind, edge.from_repository_id), to = endpoint(edge.to, edge.to_kind, edge.to_repository_id);
  return from && to ? { type: "edge", from, to, relation: edge.relation } : null;
}
export function nodeClaim(node: DreamNode, instanceId: string): NormalizationClaim | null {
  if (!node.source_repo || !["feature", "workflow", "data_model"].includes(node.category ?? "feature")) return null;
  return { type: "node", identity: { instance_id: instanceId, repository_id: node.source_repo, kind: node.category ?? "feature", id: node.id.replace(/^dream_(llm_)?/, "") }, label: node.name, description: node.description };
}
export function snapshotDocument<T>(snapshot: NormalizationSnapshot, file: string): T { return structuredClone(snapshot.documents.get(file)!.raw) as T; }

/** Every read dependency and current source proof is rechecked under the publication writer. */
export async function publishNormalization(input: {
  snapshot: NormalizationSnapshot; dreamGraph: DreamGraphFile; results: ValidationResult[]; promotedEdges: ValidatedEdge[];
  promotedNodes: DreamNode[]; cycle: number; minimum_roots: number; operation_id: string; intent: Record<string, unknown>;
  result: Record<string, unknown>; fault_inject?: CommitGraphInput["fault_inject"]; assert_current: () => void;
}): Promise<Awaited<ReturnType<typeof commitGraphWrites>>> {
  const candidates = snapshotDocument<CandidateEdgesFile>(input.snapshot, "candidate_edges.json");
  candidates.results.push(...input.results);
  candidates.metadata.last_normalization = new Date().toISOString(); candidates.metadata.total_cycles = input.cycle;
  const validated = snapshotDocument<ValidatedEdgesFile>(input.snapshot, "validated_edges.json");
  // Historical promotions remain readable. Their current applicability follows real re-evaluation.
  for (const old of validated.edges) {
    const result = input.results.find(r => r.dream_type === "edge" && r.dream_id === old.id);
    if (result) old.evidence_assessment = result.evidence_assessment;
  }
  for (const edge of input.promotedEdges) {
    edge.normalization_operation_id = input.operation_id;
    const old = validated.edges.find(e => e.id === edge.id);
    if (old) { old.evidence_assessment = edge.evidence_assessment; old.normalization_operation_id = input.operation_id; }
    else validated.edges.push(edge);
  }
  validated.metadata.last_validation = new Date().toISOString(); validated.metadata.total_validated = validated.edges.length;
  input.dreamGraph.metadata.last_normalization = new Date().toISOString(); input.dreamGraph.metadata.total_normalization_cycles = input.cycle;
  const writes = [
    { file: "dream_graph.json", content: JSON.stringify(input.dreamGraph, null, 2) },
    { file: "candidate_edges.json", content: JSON.stringify(candidates, null, 2) },
    { file: "validated_edges.json", content: JSON.stringify(validated, null, 2) },
  ];
  const index = snapshotDocument<{ entities: Record<string, unknown> }>(input.snapshot, "index.json");
  for (const kind of ["feature", "workflow", "data_model"] as const) {
    const file = kind === "feature" ? "features.json" : kind === "workflow" ? "workflows.json" : "data_model.json";
    const doc = snapshotDocument<unknown>(input.snapshot, file);
    const wrapper = doc as Record<string, unknown>;
    const rows = Array.isArray(doc) ? doc : [kind === "feature" ? "features" : kind === "workflow" ? "workflows" : "data_model", "entities"]
      .map(key => wrapper[key]).filter(Array.isArray)[0] as Record<string, unknown>[];
    if (!Array.isArray(rows)) throw new Error(`NORMALIZATION_STORE_INVALID: ${file}`);
    let changed = false;
    for (const node of input.promotedNodes) {
      const claim = nodeClaim(node, input.snapshot.graph.instance_id);
      if (!claim || claim.type !== "node" || claim.identity.kind !== kind) continue;
      const assessment = assessClaimEvidence(claim, input.snapshot.evidence, input.minimum_roots);
      if (assessment.state !== "supported") throw new Error("NORMALIZATION_NODE_EVIDENCE_REQUIRED");
      const existing = rows.find(row => row.id === claim.identity.id && row.source_repo === claim.identity.repository_id);
      if (existing && (existing.origin !== "rem" || existing.name !== node.name || existing.description !== node.description)) throw new Error("NORMALIZATION_NODE_ALREADY_EXISTS");
      const promoted = { id: claim.identity.id, name: node.name, description: node.description, source_repo: node.source_repo,
        source_files: input.snapshot.evidence.ledger.observations.filter(o => assessment.ancestry.includes(o.id) && o.source).map(o => o.source!.path),
        origin: "rem", status: "discovered", provenance_kind: "source_backed", evidence_assessment: assessment, normalization_operation_id: input.operation_id,
        domain: node.domain ?? "", keywords: node.keywords ?? [], links: [], intent: node.intent ?? null,
        ...(kind === "workflow" ? { trigger: "source assertion", steps: [] } : kind === "data_model" ? { key_fields: [], relationships: [] } : { tags: ["dream-promoted"] }) };
      if (existing) Object.assign(existing, { evidence_assessment: assessment, normalization_operation_id: input.operation_id });
      else rows.push(promoted);
      node.promoted_at = new Date().toISOString();
      const dreamNode = input.dreamGraph.nodes.find(n => n.id === node.id); if (dreamNode) dreamNode.promoted_at = node.promoted_at;
      index.entities[graphIdentityKey(claim.identity)] = { type: kind, source_repo: node.source_repo, name: node.name,
        uri: `dreamgraph://resource/${kind}/${encodeURIComponent(claim.identity.id)}` };
      changed = true;
    }
    if (changed) writes.push({ file, content: JSON.stringify(doc, null, 2) });
  }
  if (input.promotedNodes.length) writes.push({ file: "index.json", content: JSON.stringify(index, null, 2) });
  input.result.promotedNodeClaims = input.promotedNodes.map(node => nodeClaim(node, input.snapshot.graph.instance_id));
  const resultBody = JSON.stringify(input.result), resultFile = normalizationResultFile(input.operation_id);
  if (Buffer.byteLength(resultBody) > NORMALIZATION_RESULT_LIMIT) throw new Error("NORMALIZATION_RESULT_BUDGET");
  writes.push({ file: resultFile, content: resultBody });
  writes[0].content = JSON.stringify(input.dreamGraph, null, 2);
  const committed = await commitGraphWrites({ writes, actor: "normalizer", scope: NORMALIZATION_SCOPE, operation_id: input.operation_id,
    intent: input.intent, result: { result_file: resultFile, result_hash: publicationContentHash(resultBody), cycle: input.cycle }, cause: "normalization", expected_graph_revision: input.snapshot.graph.revision.graph_revision,
    expected_store_hashes: Object.fromEntries([...input.snapshot.documents].map(([file, doc]) => [file, doc.hash])),
    check_expected: async () => {
      input.assert_current();
      const current = await readNormalizationSnapshot(input.snapshot.graph.instance_id);
      if (current.evidence_fingerprint !== input.snapshot.evidence_fingerprint) throw new Error("NORMALIZATION_EVIDENCE_CHANGED");
      for (const item of [...input.promotedEdges, ...input.promotedNodes]) {
        const claim = "from" in item ? edgeClaim(item as unknown as DreamEdge & Record<string, unknown>, current.graph) : nodeClaim(item as DreamNode, current.graph.instance_id);
        const assessment = claim ? assessClaimEvidence(claim, current.evidence, input.minimum_roots) : null;
        if (!claim || !assessment || assessment.state !== "supported" || claimCurrencyReasons(claim, current.graph.state, claimSourceScopes(assessment, current.evidence)).length) throw new Error("NORMALIZATION_EVIDENCE_NO_LONGER_SUPPORTED");
      }
    }, fault_inject: input.fault_inject });
  // Durable outbox remains authoritative if process exit prevents these optional live pulses.
  if (!committed.replayed) {
    for (const edge of input.promotedEdges) graphEventBus.emit("candidate.promoted", { affected_ids: [edge.from, edge.to], payload: { from: edge.from, to: edge.to, operation_id: committed.receipt.operation_id } });
    for (const row of input.results.filter(r => r.status === "latent")) graphEventBus.emit("candidate.added", { affected_ids: [row.dream_id], payload: { dream_id: row.dream_id, operation_id: committed.receipt.operation_id } });
  }
  return committed;
}
