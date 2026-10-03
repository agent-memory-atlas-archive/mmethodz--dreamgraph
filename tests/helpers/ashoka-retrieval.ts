import { GraphEntitySchema, graphIdentityKey } from "../../src/graph/contracts.js";
import type { CanonicalGraphRead } from "../../src/graph/read-model.js";

/** Frozen source excerpts with explicitly synthetic unrelated records, not a mature live graph. */
export function retrievalFixture(project: string, evidence: Array<{ id: string; project: string; file: string; excerpt: string; excerpt_sha256: string }>, noise = 300): CanonicalGraphRead {
  const entities = [...evidence.filter(item => item.project === project).map(item => GraphEntitySchema.parse({
    identity: { instance_id: `fixture:${project}`, repository_id: project, kind: "feature", id: item.id },
    label: item.id, assertion_class: "source_assertion", confidence: null,
    evidence: [{ id: item.id, origin: "source", ancestry: [], revision: "frozen-baseline:7", observed_at: null,
      source_repo: project, source_path: item.file, content_hash: item.excerpt_sha256, validation: "unreviewed" }],
    payload: { description: item.excerpt, source_repo: project, source_files: [item.file] },
  })), ...Array.from({ length: noise }, (_, i) => GraphEntitySchema.parse({
    identity: { instance_id: `fixture:${project}`, repository_id: project, kind: "feature", id: `unrelated:${i}` },
    label: `Unrelated UI ${i}`, assertion_class: "unknown", confidence: null, evidence: [],
    payload: { description: "Unrelated UI styling and build configuration." },
  }))];
  const timestamp = "2026-09-30T00:00:00Z";
  return { schema: "dreamgraph.graph_snapshot.v1", instance_id: `fixture:${project}`,
    revision: { graph_revision: "fixture:7", publication_sequence: 7, domains: {} },
    currency: { last_graph_mutation_at: timestamp, last_full_scan_at: "2001-01-01T00:00:00Z", last_source_reconciliation_at: timestamp,
      source_reconciliation_revision: "fixture:source:7", source_reconciliation_scope: [] },
    state: { availability: "available", completeness: "complete", freshness: "current", reasons: [] }, entities, relationships: [], store_hashes: {},
    by_identity: new Map(entities.map(entity => [graphIdentityKey(entity.identity), entity])), source_dependents: new Map(), evidence_dependents: new Map(), entity_dependents: new Map() };
}
