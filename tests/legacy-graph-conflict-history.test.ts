import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { withDataDirectory } from "../src/utils/paths.js";
import { LegacyGraphUpgrade } from "../src/graph/legacy-upgrade.js";
import { loadCanonicalGraph } from "../src/graph/read-model.js";
import { readCognitiveStore } from "../src/cognitive/cognitive-store.js";
import { publishNormalization, readNormalizationSnapshot, snapshotDocument } from "../src/cognitive/normalization-publication.js";
import { releaseGraphWriter } from "../src/graph/writer-lease.js";

let directory: string, upgrade: LegacyGraphUpgrade;
const scope = <T>(work: () => T) => withDataDirectory(directory, work);
const approval = (digest: string, operation_id: string) => ({ reviewed_digest: digest, review_id: "fixture-reviewed", operation_id });
const files = ["candidate_edges.json", "validated_edges.json", "system_story.json"];

beforeEach(async () => {
  directory = await fs.mkdtemp(join(tmpdir(), "dg-conflict-history-"));
  upgrade = new LegacyGraphUpgrade(directory, "fixture");
});
afterEach(async () => { await releaseGraphWriter(directory); await fs.rm(directory, { recursive: true, force: true }); });

async function fixture() {
  const values = {
    "candidate_edges.json": { metadata: { schema_version: "1.0.0" }, results: [
      // Genuine conflicts: no recorded order between the two variants (same cycle, no validated_at).
      { dream_type: "node", dream_id: "dream-a", normalization_cycle: 1, status: "latent", confidence: 0.2 },
      { dream_type: "node", dream_id: "dream-a", normalization_cycle: 1, status: "latent", confidence: 0.3 },
      { dream_type: "node", dream_id: "dream-a", normalization_cycle: 2, status: "latent", confidence: 0.4, validated_at: "2025-01-03T00:00:00Z" },
      { dream_type: "node", dream_id: "dream-b", normalization_cycle: 1, status: "latent", confidence: 0.5 },
    ] },
    "validated_edges.json": { metadata: { schema_version: "1.0.0" }, edges: [
      { id: "validated-a", from: "left", to: "right", normalization_cycle: 1, confidence: 0.2 },
      { id: "validated-a", from: "left", to: "right", normalization_cycle: 1, confidence: 0.8 },
      { id: "validated-b", from: "left", to: "right", normalization_cycle: 1, confidence: 0.6 },
    ] },
    "system_story.json": { metadata: { schema_version: "1.0.0" }, chapters: [
      { chapter_number: 1, title: "First account", narrative_text: "Original interpretation" },
      { chapter_number: 1, title: "Revised account", narrative_text: "Different interpretation" },
      { chapter_number: 2, title: "Independent account", narrative_text: "Unrelated chapter" },
    ], digests: [] },
  };
  const originals: Record<string,string> = {};
  for (const [file, value] of Object.entries(values)) { originals[file] = JSON.stringify(value); await fs.writeFile(join(directory, file), originals[file]); }
  return originals;
}

describe("explicit legacy conflict preservation", () => {
  it("blocks by default, then quarantines every conflicting variant without selecting one or hiding unrelated active rows", async () => {
    const originals = await fixture();
    const defaultPreview = await upgrade.preview();
    expect(defaultPreview.blockers.filter(value => value.startsWith("CONFLICTING_DUPLICATE"))).toHaveLength(3);
    expect(defaultPreview.writes).toHaveLength(0);
    const preview = await upgrade.preview([], { preserve_conflicts: true });
    expect(preview.preserve_conflicts).toBe(true);
    expect(preview.blockers).toEqual([]);
    expect(preview.writes.map(value => value.file).sort()).toEqual([...files].sort());
    expect(preview.findings.filter(value => value.code === "LEGACY_CONFLICT_PRESERVED")).toHaveLength(6);
    expect(preview.digest).not.toBe(defaultPreview.digest);
    await upgrade.apply(preview, approval(preview.digest, "preserve"));
    for (const file of files) {
      const doc = JSON.parse(await fs.readFile(join(directory, file), "utf8"));
      expect(doc.legacy_conflicts).toHaveLength(2);
      expect(new Set(doc.legacy_conflicts.map((row: { group_id: string }) => row.group_id)).size).toBe(1);
      expect(doc.legacy_conflicts.map((row: { index: number }) => row.index)).toEqual([0, 1]);
      const original = JSON.parse(originals[file]);
      expect(doc.legacy_conflicts.map((row: { row: unknown }) => row.row)).toEqual(original[file === "candidate_edges.json" ? "results" : file === "validated_edges.json" ? "edges" : "chapters"].slice(0, 2));
    }
    const candidates = JSON.parse(await fs.readFile(join(directory, "candidate_edges.json"), "utf8"));
    expect(candidates.results.map((row: { normalization_cycle: number }) => row.normalization_cycle)).toEqual([2, 1]);
    const validated = JSON.parse(await fs.readFile(join(directory, "validated_edges.json"), "utf8"));
    expect(validated.edges.map((row: { id: string }) => row.id)).toEqual(["validated-b"]);
    const story = JSON.parse(await fs.readFile(join(directory, "system_story.json"), "utf8"));
    expect(story.chapters.map((row: { chapter_number: number }) => row.chapter_number)).toEqual([2]);
    const normalizerRead = await scope(() => readCognitiveStore<any>("candidate_edges.json", { metadata: {}, results: [] }, ["results"]));
    const narratorRead = await scope(() => readCognitiveStore<any>("system_story.json", { metadata: {}, chapters: [], digests: [] }, ["chapters", "digests"]));
    expect(normalizerRead.legacy_conflicts).toHaveLength(2);
    expect(narratorRead.legacy_conflicts).toHaveLength(2);
    const graph = await scope(() => loadCanonicalGraph("fixture"));
    expect(graph.state.completeness).toBe("partial");
    expect(graph.state.reasons.filter(reason => reason.code === "LEGACY_CONFLICT_PRESERVED")).toHaveLength(3);
    expect(graph.state.reasons.some(reason => reason.code === "DUPLICATE_TYPED_ID")).toBe(false);
    expect(graph.entities.some(entity => entity.identity.kind === "candidate" && entity.payload.normalization_cycle === 2)).toBe(true);
    expect(graph.entities.some(entity => entity.identity.kind === "validated" && entity.identity.id === "validated-b")).toBe(true);
    expect(graph.entities.some(entity => entity.identity.kind === "narrative" && entity.identity.id === "chapter:2")).toBe(true);
    expect(graph.entities.some(entity => entity.identity.kind === "validated" && entity.identity.id === "validated-a")).toBe(false);
    expect(graph.entities.some(entity => entity.identity.kind === "narrative" && entity.identity.id === "chapter:1")).toBe(false);
  });

  it("supersedes recorded revisions and gives legacy chapters their v14 identity without any review or flag", async () => {
    const values = {
      "candidate_edges.json": { metadata: { schema_version: "1.0.0" }, results: [
        // Legacy re-run of one normalization cycle: the later validated_at is the active assessment.
        { dream_type: "edge", dream_id: "dream-a", normalization_cycle: 7, status: "latent", confidence: 0.2, validated_at: "2026-04-10T21:47:53.714Z" },
        { dream_type: "edge", dream_id: "dream-b", normalization_cycle: 7, status: "latent", confidence: 0.5, validated_at: "2026-04-10T21:47:53.714Z" },
        { dream_type: "edge", dream_id: "dream-a", normalization_cycle: 7, status: "latent", confidence: 0.6, validated_at: "2026-04-10T23:32:56.318Z" },
      ] },
      "validated_edges.json": { metadata: { schema_version: "1.0.0" }, edges: [
        { id: "validated-a", from: "left", to: "right", relation: "uses", normalization_cycle: 412, confidence: 0.46 },
        { id: "validated-a", from: "left", to: "right", relation: "uses", normalization_cycle: 417, confidence: 0.56 },
        { id: "validated-a", from: "left", to: "right", relation: "uses", normalization_cycle: 416, confidence: 0.5 },
      ] },
      "system_story.json": { metadata: { schema_version: "1.0.0", total_chapters: 100 }, chapters: [
        // Legacy narrator: chapter_number stuck at total_chapters + 1 after the chapter cap.
        { chapter_number: 101, title: "A Phase of Discovery", cycle_range: [1100, 1109], narrative_text: "First text" },
        { chapter_number: 101, title: "A Phase of Discovery", cycle_range: [1110, 1120], narrative_text: "Second text" },
      ], digests: [] },
    };
    for (const [file, value] of Object.entries(values)) await fs.writeFile(join(directory, file), JSON.stringify(value));
    const preview = await upgrade.preview();
    expect(preview.blockers).toEqual([]);
    expect(preview.findings.filter(value => value.code === "LEGACY_REVISION_SUPERSEDED")).toHaveLength(3);
    expect(preview.findings.filter(value => value.code === "LEGACY_CHAPTER_ID_ASSIGNED")).toHaveLength(2);
    await upgrade.apply(preview, approval(preview.digest, "supersede"));
    const candidates = JSON.parse(await fs.readFile(join(directory, "candidate_edges.json"), "utf8"));
    expect(candidates.results.map((row: { confidence: number }) => row.confidence)).toEqual([0.5, 0.6]);
    expect(candidates.legacy_conflicts.map((entry: any) => [entry.disposition, entry.index, entry.row])).toEqual([["superseded", 0, values["candidate_edges.json"].results[0]]]);
    const validated = JSON.parse(await fs.readFile(join(directory, "validated_edges.json"), "utf8"));
    expect(validated.edges.map((row: { normalization_cycle: number }) => row.normalization_cycle)).toEqual([417]);
    expect(validated.legacy_conflicts.map((entry: any) => [entry.disposition, entry.row.normalization_cycle])).toEqual([["superseded", 412], ["superseded", 416]]);
    const story = JSON.parse(await fs.readFile(join(directory, "system_story.json"), "utf8"));
    const digest = (row: any) => createHash("sha256").update(JSON.stringify([null, row.cycle_range, row.narrative_text])).digest("hex");
    expect(story.chapters.map((row: { id: string }) => row.id)).toEqual(values["system_story.json"].chapters.map(digest));
    expect(story.chapters.map((row: { chapter_number: number }) => row.chapter_number)).toEqual([101, 101]);
    const graph = await scope(() => loadCanonicalGraph("fixture"));
    expect(graph.state.reasons.some(reason => ["DUPLICATE_TYPED_ID", "LEGACY_CONFLICT_PRESERVED"].includes(reason.code))).toBe(false);
    expect(graph.entities.find(entity => entity.identity.kind === "candidate" && entity.payload.dream_id === "dream-a")?.payload.confidence).toBe(0.6);
    expect(graph.entities.find(entity => entity.identity.kind === "validated" && entity.identity.id === "validated-a")?.payload.normalization_cycle).toBe(417);
    expect(graph.entities.filter(entity => entity.identity.kind === "narrative")).toHaveLength(2);
  });

  it("retains original bytes through verified backup and reviewed restore", async () => {
    const originals = await fixture(), preview = await upgrade.preview([], { preserve_conflicts: true });
    await upgrade.apply(preview, approval(preview.digest, "preserve"));
    const restore = await upgrade.previewRestore("preserve");
    expect(restore.blockers).toEqual([]);
    await upgrade.restore(restore, approval(restore.digest, "restore"));
    for (const file of files) expect(await fs.readFile(join(directory, file), "utf8")).toBe(originals[file]);
  });

  it("retains quarantined history through a subsequent normalizer publication", async () => {
    await fixture();
    const preview = await upgrade.preview([], { preserve_conflicts: true });
    await upgrade.apply(preview, approval(preview.digest, "preserve-before-normalizing"));
    const before = JSON.parse(await fs.readFile(join(directory, "candidate_edges.json"), "utf8"));
    const published = await scope(async () => {
      const snapshot = await readNormalizationSnapshot("fixture");
      return publishNormalization({
        snapshot, dreamGraph: snapshotDocument<any>(snapshot, "dream_graph.json"),
        results: [], promotedEdges: [], promotedNodes: [], cycle: 1, minimum_roots: 1,
        operation_id: "fixture-normalization-after-migration", intent: { fixture: true }, result: { cycle: 1 },
        assert_current: () => undefined,
      });
    });
    expect(published.replayed).toBe(false);
    const after = JSON.parse(await fs.readFile(join(directory, "candidate_edges.json"), "utf8"));
    expect(after.legacy_conflicts).toEqual(before.legacy_conflicts);
    expect(after.results).toEqual(before.results);
    expect(after.metadata.last_normalization).toBeTruthy();
  });

  it("rejects malformed history and root-array stores instead of silently changing their contract", async () => {
    await fixture();
    await fs.writeFile(join(directory, "candidate_edges.json"), JSON.stringify({ results: [], legacy_conflicts: [{ schema: "unknown" }] }));
    await expect(upgrade.preview([], { preserve_conflicts: true })).rejects.toThrow();
    await fs.writeFile(join(directory, "candidate_edges.json"), JSON.stringify([
      { id: "one", value: "first" }, { id: "one", value: "second" },
    ]));
    const preview = await upgrade.preview([], { preserve_conflicts: true });
    expect(preview.blockers.some(value => value.startsWith("CONFLICT_HISTORY_REQUIRES_OBJECT_STORE"))).toBe(true);
    expect(preview.writes.some(value => value.file === "candidate_edges.json")).toBe(false);
  });

  it("keeps exact-duplicate cleanup and explicit reviewed resolutions unchanged", async () => {
    const row = { dream_type: "node", dream_id: "same", normalization_cycle: 1, status: "latent" };
    await fs.writeFile(join(directory, "candidate_edges.json"), JSON.stringify({ results: [row, row] }));
    const exact = await upgrade.preview([], { preserve_conflicts: true });
    expect(exact.blockers).toEqual([]);
    expect(exact.findings.map(value => value.code)).toEqual(["EXACT_DUPLICATE_ARCHIVED"]);
    expect(JSON.parse(exact.writes[0].content).results).toEqual([row]);

    const variant = { ...row, confidence: 0.4 };
    await fs.writeFile(join(directory, "candidate_edges.json"), JSON.stringify({ results: [row, row, variant] }));
    const conflict = await upgrade.preview([], { preserve_conflicts: true });
    expect(conflict.findings.filter(value => value.code === "LEGACY_CONFLICT_PRESERVED")).toHaveLength(3);
    expect(conflict.findings.some(value => value.code === "EXACT_DUPLICATE_ARCHIVED")).toBe(false);
    const preserved = JSON.parse(conflict.writes[0].content);
    expect(preserved.results).toEqual([]);
    expect(preserved.legacy_conflicts.map((entry: { row: unknown }) => entry.row)).toEqual([row, row, variant]);

    const blocked = await upgrade.preview();
    const finding = blocked.findings.find(value => value.code === "CONFLICTING_DUPLICATE")!;
    const reviewed = await upgrade.preview([{ file: finding.file, collection: finding.collection, index: finding.index,
      row_hash: finding.row_hash!, action: "archive", reason: "Fixture operator explicitly retains other assessment" }], { preserve_conflicts: true });
    expect(reviewed.findings.some(value => value.code === "REVIEWED_ROW_ARCHIVE")).toBe(true);
  });

  it("stores the exact original row when a reviewed ID mapping creates a conflict group", async () => {
    const first = { id: "one", normalization_cycle: 1, confidence: 0.2 };
    const second = { id: "two", normalization_cycle: 2, confidence: 0.8 };
    await fs.writeFile(join(directory, "validated_edges.json"), JSON.stringify({ edges: [first, second] }));
    const stableSecond = JSON.stringify(Object.fromEntries(Object.entries(second).sort(([a], [b]) => a.localeCompare(b))));
    const row_hash = "sha256:" + createHash("sha256").update(stableSecond).digest("hex");
    const preview = await upgrade.preview([{ file: "validated_edges.json", collection: "edges", index: 1,
      row_hash, action: "set_id", new_id: "one", reason: "Fixture reviewed mapping creates a preserved identity conflict" }], { preserve_conflicts: true });
    expect(preview.blockers).toEqual([]);
    await upgrade.apply(preview, approval(preview.digest, "reviewed-mapping"));
    const doc = JSON.parse(await fs.readFile(join(directory, "validated_edges.json"), "utf8"));
    expect(doc.edges).toEqual([]);
    expect(doc.legacy_conflicts.map((entry: { row: unknown }) => entry.row)).toEqual([first, second]);
    expect(doc.legacy_conflicts[1].row_hash).toBe(row_hash);
  });
  it("gives an unassessed legacy re-dream that reused a dream id its own id, and keeps real conflicts blocking", async () => {
    const first = { id: "dream_llm_bridge", type: "hypothetical_feature", name: "Bridge", status: "validated", dream_cycle: 264, created_at: "2026-05-12T17:56:32.113Z", promoted_at: "2026-05-12T17:57:20.612Z", origin: "rem" };
    const redream = { id: "dream_llm_bridge", type: "hypothetical_feature", name: "Bridge again", status: "candidate", dream_cycle: 265, created_at: "2026-05-12T17:59:02.143Z", promoted_at: null, origin: "rem" };
    const write = async (nodes: unknown[], edges: unknown[] = [], assessedAt = "2026-05-12T17:57:20.468Z") => {
      await fs.writeFile(join(directory, "dream_graph.json"), JSON.stringify({ metadata: { schema_version: "1.0.0" }, nodes, edges }));
      await fs.writeFile(join(directory, "candidate_edges.json"), JSON.stringify({ metadata: { schema_version: "1.0.0" }, results: [
        { dream_type: "node", dream_id: "dream_llm_bridge", normalization_cycle: 257, status: "validated", validated_at: assessedAt },
      ] }));
    };
    await write([first, redream]);
    const preview = await upgrade.preview();
    expect(preview.blockers).toEqual([]);
    expect(preview.findings.filter(value => value.code === "LEGACY_REDREAM_ID_ASSIGNED").map(value => [value.index, value.original_id, value.new_id]))
      .toEqual([[1, "dream_llm_bridge", "dream_llm_bridge~c265"]]);
    await upgrade.apply(preview, approval(preview.digest, "redream"));
    const graph = JSON.parse(await fs.readFile(join(directory, "dream_graph.json"), "utf8"));
    expect(graph.nodes).toEqual([first, { ...redream, id: "dream_llm_bridge~c265" }]);
    const read = await scope(() => loadCanonicalGraph("fixture"));
    expect(read.state.reasons.some(reason => reason.code === "DUPLICATE_TYPED_ID")).toBe(false);
    expect(read.entities.filter(entity => entity.identity.kind === "dream_node").map(entity => entity.identity.id).sort()).toEqual(["dream_llm_bridge", "dream_llm_bridge~c265"]);
  });

  it("does not rename a re-dream when an assessment or a dream edge could belong to it", async () => {
    const first = { id: "d", type: "hypothetical_feature", status: "validated", dream_cycle: 1, created_at: "2026-05-12T17:00:00Z", promoted_at: "2026-05-12T17:01:00Z" };
    const later = { id: "d", type: "hypothetical_feature", status: "candidate", dream_cycle: 2, created_at: "2026-05-12T18:00:00Z", promoted_at: null };
    const write = async (edges: unknown[], assessedAt: string) => {
      await fs.writeFile(join(directory, "dream_graph.json"), JSON.stringify({ metadata: { schema_version: "1.0.0" }, nodes: [first, later], edges }));
      await fs.writeFile(join(directory, "candidate_edges.json"), JSON.stringify({ metadata: { schema_version: "1.0.0" }, results: [
        { dream_type: "node", dream_id: "d", normalization_cycle: 1, status: "validated", validated_at: assessedAt }] }));
    };
    await write([], "2026-05-12T18:30:00Z");
    expect((await upgrade.preview()).blockers.some(value => value.startsWith("CONFLICTING_DUPLICATE: dream_graph.json"))).toBe(true);
    await write([{ id: "e", from: "d", to: "x" }], "2026-05-12T17:01:00Z");
    expect((await upgrade.preview()).blockers.some(value => value.startsWith("CONFLICTING_DUPLICATE: dream_graph.json"))).toBe(true);
  });
});
