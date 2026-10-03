/** Transitional audit, not a switch to legacy semantics or a data repair. */
import { withGraphRead } from "../utils/graph-reconciliation-barrier.js";
import { loadCanonicalGraph } from "./read-model.js";
import { loadGraphRaw } from "./store.js";
import { buildLegacyGraphSnapshot } from "./snapshot.js";
import { graphIdentityKey } from "./contracts.js";

export async function compareLegacyGraphProjection(instance_id: string) {
  return withGraphRead(async () => {
    const canonical = await loadCanonicalGraph(instance_id);
    const legacy = buildLegacyGraphSnapshot(await loadGraphRaw());
    const losses: Array<{ code: string; scope: string[]; detail: string }> = [];
    const byId = new Map<string, typeof canonical.entities>();
    for (const entity of canonical.entities) byId.set(entity.identity.id, [...(byId.get(entity.identity.id) ?? []), entity]);
    for (const node of legacy.nodes) {
      const matches = byId.get(node.id) ?? [];
      if (matches.length > 1) losses.push({ code: "LEGACY_ID_COLLISION", scope: matches.map(e => graphIdentityKey(e.identity)), detail: "Legacy raw-ID map collapses distinct typed identities." });
      if (matches.length === 1 && matches[0].confidence === null && node.confidence !== null) losses.push({ code: "LEGACY_DEFAULT_CONFIDENCE", scope: [graphIdentityKey(matches[0].identity)], detail: "Legacy presentation invents confidence where canonical confidence is unknown." });
    }
    const visible = new Set(legacy.nodes.map(node => node.id));
    for (const entity of canonical.entities) if (!visible.has(entity.identity.id)) losses.push({ code: "LEGACY_ENTITY_OMITTED", scope: [graphIdentityKey(entity.identity)], detail: "Entity is not represented as a node in the legacy Explorer view." });
    for (const relationship of canonical.relationships) if (!relationship.source || !relationship.target) losses.push({ code: "LEGACY_UNRESOLVED_RELATIONSHIP", scope: [relationship.id], detail: "Canonical projection preserves unresolved evidence; legacy traversal cannot represent it reliably." });
    for (const edge of legacy.edges) {
      if (!canonical.relationships.some(r => r.kind === edge.kind && r.source?.id === edge.s && r.target?.id === edge.t)) losses.push({ code: "LEGACY_ONLY_RELATIONSHIP", scope: [edge.s, edge.t], detail: "Legacy edge is inferred, ambiguous or absent from canonical evidence; migration must not silently copy it." });
    }
    return { schema: "dreamgraph.projection_comparison.v1", instance_id, revision: canonical.revision,
      canonical_state: canonical.state, canonical_entities: canonical.entities.length,
      legacy_nodes: legacy.nodes.length, losses, equivalent: losses.length === 0 };
  });
}
