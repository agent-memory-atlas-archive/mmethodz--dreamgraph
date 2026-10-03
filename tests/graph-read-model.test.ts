import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setDataDirOverride } from "../src/utils/paths.js";
import { setDataDirResolver } from "../src/utils/cache.js";
import { CANONICAL_FAMILIES, exactGraphEntity, loadCanonicalGraph, projectGraphContext } from "../src/graph/read-model.js";
import { commitGraphWrites } from "../src/graph/publication.js";
import { releaseGraphWriter } from "../src/graph/writer-lease.js";
import { compareLegacyGraphProjection } from "../src/graph/projection-comparison.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "dg-read-model-"));
  setDataDirOverride(root);
  setDataDirResolver(() => root);
});
afterEach(async () => {
  await releaseGraphWriter(root);
  setDataDirOverride(null);
  await rm(root, { recursive: true, force: true });
});
const put = (file: string, body: unknown) => writeFile(join(root, file), JSON.stringify(body));

describe("canonical graph read contract", () => {
  it("retains actual narrative digests and resolved tension history without colliding with active records", async () => {
    const resolved = { tension_id: "tension:a", resolved_at: "2026-09-30T12:00:00Z", original: { id: "tension:a" }, resolved_by: "human" };
    await put("tension_log.json", { signals: [{ id: "tension:a" }], resolved_tensions: [resolved] });
    await put("system_story.json", { chapters: [{ chapter_number: 1, title: "First" }], digests: [{ id: "digest:a" }], weekly_digests: [{ id: "legacy-digest:a" }] });
    const graph = await loadCanonicalGraph("instance:a");
    expect(graph.state.completeness).toBe("complete");
    expect(graph.entities.map(e => e.identity.id)).toEqual(["tension:a", "tension:a@resolved:2026-09-30T12:00:00Z", "chapter:1", "digest:a", "legacy-digest:a"]);
    expect(graph.entities[1]).toMatchObject({ assertion_class: "historical", payload: resolved });
  });
  it("compares legacy and canonical projections at one publication without accepting lossy meanings", async () => {
    await commitGraphWrites({ writes: [
      { file: "features.json", content: '[{"id":"same","name":"Public"}]' },
      { file: "workflows.json", content: '[{"id":"same","name":"Scripts"}]' },
      { file: "adr_log.json", content: '{"decisions":[{"id":"ADR-fixture","title":"Keep typed identity"}]}' },
    ], operation_id: "golden:typed" });
    const comparison = await compareLegacyGraphProjection("instance:a");
    expect(comparison.revision.graph_revision).toBe("graph:1");
    expect(comparison.canonical_entities).toBe(3);
    expect(comparison.legacy_nodes).toBe(1);
    expect(comparison.losses.map(loss => loss.code)).toContain("LEGACY_ID_COLLISION");
    expect(comparison.losses.find(loss => loss.code === "LEGACY_ENTITY_OMITTED")?.scope[0]).toContain("ADR-fixture");
    expect(comparison.equivalent).toBe(false);
    const graph = await loadCanonicalGraph("instance:a");
    expect(graph.revision).toEqual(comparison.revision);
    expect(graph.entities.map(e => e.label)).toEqual(["Public", "Scripts", "Keep typed identity"]);
  });

  it("rejects duplicate dream identities and never attaches candidates to an arbitrary edge", async () => {
    await put("features.json", [{ id: "a" }, { id: "b" }, { id: "c" }]);
    await put("dream_graph.json", { nodes: [], edges: [{ id: "duplicate", from: "a", to: "b" }, { id: "duplicate", from: "a", to: "c" }] });
    await put("candidate_edges.json", { results: [{ dream_id: "duplicate", dream_type: "edge" }] });
    const graph = await loadCanonicalGraph("instance:a");
    expect(graph.relationships).toEqual([]);
    expect(graph.state.completeness).toBe("partial");
    expect(graph.state.reasons.map(r => r.code)).toContain("CANDIDATE_ENDPOINTS_UNKNOWN");
  });
  it("reads every kind, preserving equal legacy IDs without name merging", async () => {
    for (const family of CANONICAL_FAMILIES) {
      const raw = { id: "shared", name: "Public", source_repo: "fixture", source_files: ["source.ts"] };
      await put(family.file, { [family.arrays[0]]: [raw] });
    }
    const graph = await loadCanonicalGraph("instance:a");
    expect(graph.entities).toHaveLength(18);
    expect(graph.by_identity.size).toBe(18);
    expect(graph.state.completeness).toBe("complete");
    for (const family of CANONICAL_FAMILIES) {
      const id=family.file==="dream_archetypes.json"?"foreign:unknown:shared":"shared";
      expect(exactGraphEntity(graph, { instance_id: "instance:a", kind: family.kind, id })?.identity.kind).toBe(family.kind);
    }
    expect(() => exactGraphEntity(graph, { instance_id: "instance:b", kind: "feature", id: "shared" })).toThrow("INSTANCE_SCOPE_MISMATCH");
  });

  it("preserves typed inline facts and retains ambiguous speculative endpoints", async () => {
    await put("features.json", [{ id: "shared", name: "Public", source_repo: "repo", source_files: ["a.ts"],
      links: [{ target: "shared", type: "workflow", relationship: "uses" }] }]);
    await put("workflows.json", [{ id: "shared", name: "Public", source_repo: "repo", source_files: ["a.ts"] }]);
    await put("dream_graph.json", { nodes: [], edges: [{ id: "dream:1", from: "shared", to: "shared", confidence: 0.99 }] });
    const graph = await loadCanonicalGraph("instance:a");
    expect(graph.relationships[0]).toMatchObject({ kind: "fact", source: { kind: "feature" }, target: { kind: "workflow" }, confidence: null });
    expect(graph.relationships[1]).toMatchObject({ kind: "dream", source: null, target: null, assertion_class: "hypothesis" });
    expect(graph.state.reasons.some(r => r.code === "UNRESOLVED_ENDPOINT")).toBe(true);
  });

  it("preserves the same kind and ID in different repositories and requires scoped exact reads", async () => {
    await put("features.json", [{ id: "public", source_repo: "repo:a" }, { id: "public", source_repo: "repo:b" }]);
    const graph = await loadCanonicalGraph("instance:a");
    expect(graph.entities).toHaveLength(2);
    expect(graph.by_identity.size).toBe(2);
    expect(() => exactGraphEntity(graph, { instance_id: "instance:a", kind: "feature", id: "public" })).toThrow("AMBIGUOUS_ENTITY_ID");
    expect(exactGraphEntity(graph, { instance_id: "instance:a", kind: "feature", repository_id: "repo:b", id: "public" })?.identity.repository_id).toBe("repo:b");
  });

  it("keeps source, human, dream, validation, decision and tension evidence distinct", async () => {
    await put("features.json", [{ id: "source", source_repo: "repo", source_files: ["same.ts"], enrichment: { model: "fixture", confidence: 1 } }, { id: "human", origin: "lucid" }]);
    await put("dream_graph.json", { nodes: [{ id: "dream", origin: "rem", confidence: 1, inspiration: ["source"] }], edges: [] });
    await put("validated_edges.json", { edges: [{ id: "validated", confidence: 0.9, evidence_ancestry: ["source"] }] });
    await put("adr_log.json", { decisions: [{ id: "decision", decided_by: "human" }] });
    await put("tension_log.json", { signals: [{ id: "tension", urgency: 1 }] });
    const graph = await loadCanonicalGraph("instance:a");
    expect(graph.entities.map(e => e.assertion_class)).toEqual(["source_assertion", "human_assertion", "hypothesis", "hypothesis", "tension", "decision"]);
    expect(graph.entities[0].evidence.map(e => e.origin)).toEqual(["source", "model"]);
    expect(graph.entities[0].evidence[0].validation).toBe("unreviewed");
    expect(graph.entities[2].evidence[0].ancestry).toEqual(["source"]);
  });

  it("indexes source/evidence dependents and preserves the same record meaning in every role", async () => {
    await put("features.json", [{ id: "source", source_repo: "repo", source_files: ["a.ts"], links: [{ target: "flow", type: "workflow" }] }]);
    await put("workflows.json", [{ id: "flow", source_repo: "repo", source_files: ["a.ts"] }]);
    const graph = await loadCanonicalGraph("instance:a");
    expect(graph.source_dependents.get("repo/a.ts")?.size).toBe(3);
    expect(graph.evidence_dependents.get("source:repo:a.ts")?.size).toBe(3);
    const identity = { instance_id: "instance:a", kind: "feature" as const, repository_id: "repo", id: "source" };
    const key = [...graph.by_identity.keys()].find(key => key.endsWith("/source"))!;
    expect(graph.entity_dependents.get(key)?.size).toBe(1);
    const projections = (["task", "dreamer", "normalizer"] as const).map(role => projectGraphContext(graph, { role, identities: [identity] }).graph);
    expect(projections.map(p => p.records)).toEqual([projections[0].records, projections[0].records, projections[0].records]);
    expect(projections.every(p => p.revision.graph_revision === graph.revision.graph_revision)).toBe(true);
    const absent = projectGraphContext(graph, { role: "task", identities: [{ ...identity, id: "missing" }] }).graph;
    expect(absent.state.completeness).toBe("partial");
    expect(absent.state.reasons.at(-1)?.code).toBe("MISSING_REQUIRED_ENTITY");
  });

  it("reports malformed and duplicate families as unavailable rather than empty success", async () => {
    await put("features.json", [{ id: "duplicate" }, { id: "duplicate" }]);
    await writeFile(join(root, "workflows.json"), "{broken");
    const graph = await loadCanonicalGraph("instance:a");
    expect(graph.entities).toEqual([]);
    expect(graph.state.availability).toBe("unavailable");
    expect(graph.state.completeness).toBe("partial");
    expect(graph.state.reasons).toHaveLength(2);
  });

  it("rejects newer persisted formats instead of interpreting them as the current format", async () => {
    await put("tension_log.json", { metadata: { schema_version: "99.0.0" }, signals: [] });
    const graph = await loadCanonicalGraph("instance:a");
    expect(graph.state.reasons[0].code).toBe("UNSUPPORTED_STORE_SCHEMA");
    await put("tension_log.json", { metadata: { schema_version: "1.0" }, signals: [] });
    expect((await loadCanonicalGraph("instance:a")).state.reasons).toEqual([]);
  });

  it("does not judge old scan dates stale, and cannot hide a concrete gap with a newer dream", async () => {
    await commitGraphWrites({ writes: [{ file: "features.json", content: '[{"id":"source"}]' }],
      source_reconciliation: { revision: "source:1", scope: ["repo:a"], full: true } });
    const metadata = JSON.parse(await readFile(join(root, "publication_state.json"), "utf8"));
    metadata.currency.last_full_scan_at = "2001-01-01T00:00:00Z";
    await put("publication_state.json", metadata);
    await commitGraphWrites({ writes: [{ file: "dream_graph.json", content: '{"nodes":[],"edges":[]}' }] });
    expect((await loadCanonicalGraph("instance:a")).state.freshness).toBe("current");
    await put("features.json", [{ id: "changed_outside_publication" }]);
    const graph = await loadCanonicalGraph("instance:a");
    expect(graph.state.freshness).toBe("stale");
    expect(graph.state.reasons[0].scope).toEqual(["features.json"]);
    expect(graph.currency.last_full_scan_at).toBe("2001-01-01T00:00:00Z");
  });
});
