/** Pure speculative deduplication: rediscovery is not independent evidence. */
import { dreamClaimKey } from "./strategy-portfolio.js";
import type { DreamEdge, DreamNode, DreamGraphFile } from "./types.js";
import type { FactSnapshot } from "./strategies/_shared.js";
export function deduplicateDreamCandidates(graph: DreamGraphFile, nodes: DreamNode[], edges: DreamEdge[],
  snapshot?: FactSnapshot, suppressed = new Set<string>()) {
  const appendedNodes: DreamNode[] = [], appendedEdges: DreamEdge[] = [], mapping: Record<string, string | null> = {};
  let merged = 0;
  const dreamNodes = new Map(graph.nodes.map(n => [n.id, n]));
  const byNode = new Map(graph.nodes.map(n => [dreamClaimKey(n, snapshot), n]));
  const byEdge = new Map(graph.edges.map(e => [dreamClaimKey(e, snapshot, dreamNodes), e]));
  for (const raw of nodes) {
    const key = dreamClaimKey(raw, snapshot), old = byNode.get(key);
    if (suppressed.has(key) || old?.status === "rejected") { mapping[raw.id] = null; merged++; continue; }
    if (old) { mapping[raw.id] = old.id; merged++; continue; }
    const row = structuredClone(raw); mapping[row.id] = row.id; graph.nodes.push(row); appendedNodes.push(row); byNode.set(key, row); dreamNodes.set(row.id, row);
  }
  for (const raw of edges) {
    if (mapping[raw.from] === null || mapping[raw.to] === null) { merged++; continue; }
    const row = { ...structuredClone(raw), from: mapping[raw.from] ?? raw.from, to: mapping[raw.to] ?? raw.to };
    const speculativeKeys: Record<string, string> = {};
    for (const side of ["from", "to"] as const) {
      const entity = snapshot?.entities.get(row[side]);
      if (entity) {
        row[`${side}_kind`] = entity.type;
        row[`${side}_repository_id`] = entity.source_repo;
      } else if (dreamNodes.has(row[side])) {
        const node = dreamNodes.get(row[side])!;
        row[`${side}_kind`] = "dream_node"; row[`${side}_repository_id`] = node.source_repo;
        speculativeKeys[side] = dreamClaimKey(node);
      }
    }
    row.meta = { ...row.meta, speculative_endpoint_keys: speculativeKeys };
    const key = dreamClaimKey(row, snapshot, dreamNodes);
    if (row.from === row.to || suppressed.has(key) || byEdge.has(key)) { merged++; continue; }
    graph.edges.push(row); appendedEdges.push(row); byEdge.set(key, row);
  }
  return { nodes: appendedNodes, edges: appendedEdges, merged, id_mapping: mapping };
}
