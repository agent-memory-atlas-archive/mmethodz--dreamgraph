import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setDataDirOverride } from "../../src/utils/paths.js";
import { releaseGraphWriter } from "../../src/graph/writer-lease.js";
import { commitGraphWrites, loadPublicationState } from "../../src/graph/publication.js";
import { createEnrichmentRun, persistEnrichmentRun, recordEnrichmentOutcome, loadEnrichmentRun } from "../../src/tools/enrichment-state.js";
import { enrichmentNodeKey, publishEnrichmentBatch, type EnrichmentBatchInput } from "../../src/tools/enrichment-publication.js";

let root: string;
const base = { id: "a", name: "A", source_repo: "repo", source_files: ["a.ts"], description: "parser", tags: [] };
const next = { ...base, description: "source-grounded semantic description", tags: ["semantic"], enrichment: { enriched: true, model: "fixture" } };
const key = enrichmentNodeKey("features.json", base);
const read = async (file: string) => JSON.parse(await readFile(join(root, file), "utf8"));
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "dg-enrichment-publication-")); setDataDirOverride(root); });
afterEach(async () => { await releaseGraphWriter(root); setDataDirOverride(null); await rm(root, { recursive: true, force: true }); });
async function setup(wrapper = false): Promise<EnrichmentBatchInput> {
  await writeFile(join(root, "features.json"), JSON.stringify(wrapper ? { metadata: { note: "retain" }, features: [base] } : [base]));
  const before = createEnrichmentRun("legacy-unscoped", "fixture", [key]);
  await persistEnrichmentRun(join(root, "enrichment_state.json"), before);
  return { operation_id: "batch:1", scan_revision: "legacy-unscoped", checkpoint_before: before,
    checkpoint_after: recordEnrichmentOutcome(before, key, { state: "enriched" }),
    deltas: [{ file: "features.json", kind: "feature", checkpoint_id: key, base, next }] };
}
describe("enrichment publication boundary", () => {
  it.each([false, true])("commits entity/index/checkpoint together while retaining wrappers and concurrent unrelated records (wrapper=%s)", async wrapper => {
    const input = await setup(wrapper);
    const extra = { id: "human", name: "Preserved human addition", origin: "lucid" };
    await commitGraphWrites({ writes: [{ file: "features.json", content: JSON.stringify(wrapper ? { metadata: { note: "retain" }, features: [base, extra] } : [base, extra]) }] });
    const result = await publishEnrichmentBatch(input);
    const file = await read("features.json");
    expect(wrapper ? file.features : file).toEqual([next, extra]);
    if (wrapper) expect(file.metadata.note).toBe("retain");
    expect((await read("index.json")).entities[key]).toMatchObject({ type: "feature", name: "A" });
    expect((await read("enrichment_state.json")).nodes[key].state).toBe("enriched");
    expect(result.batch.applied_ids).toEqual([key]);
    const state = await loadPublicationState();
    expect(state.currency.last_graph_mutation_at).toBe(result.receipt.committed_at);
    expect(result.receipt.affected_files).toEqual(["features.json", "index.json", "enrichment_state.json"]);
  });
  it.each(["curation", "source", "deletion"])("preserves concurrent %s and leaves generated enrichment retryable", async conflict => {
    const input = await setup();
    const current = conflict === "curation" ? { ...base, description: "Human-written description" }
      : conflict === "source" ? { ...base, source_files: ["renamed.ts"] } : null;
    await commitGraphWrites({ writes: [{ file: "features.json", content: JSON.stringify(current ? [current] : []) }] });
    const before = await loadPublicationState();
    const result = await publishEnrichmentBatch(input);
    expect(await read("features.json")).toEqual(current ? [current] : []);
    expect(result.checkpoint.nodes[key]).toMatchObject({ state: "failed_retryable", reason: conflict === "curation" ? "concurrent_edit_conflict" : conflict === "source" ? "source_changed" : "entity_removed" });
    expect(result.batch.applied_ids).toEqual([]);
    expect((await loadPublicationState()).currency.last_graph_mutation_at).toBe(before.currency.last_graph_mutation_at);
  });
  it("fences an actual source change between prompt and publication", async () => {
    const input = await setup();
    const source = join(root, "a.ts"); await writeFile(source, "before");
    input.source_checks = [{ path: source, content_hash: createHash("sha256").update("before").digest("hex"), checkpoint_ids: [key] }];
    await writeFile(source, "after");
    expect((await publishEnrichmentBatch(input)).checkpoint.nodes[key]).toMatchObject({ state: "failed_retryable", reason: "source_changed" });
    expect(await read("features.json")).toEqual([base]);
  });
  it.each(["journal_prepared", "before_replace:0:features.json", "after_replace:0:features.json", "before_replace:1:index.json", "after_replace:1:index.json", "before_replace:2:enrichment_state.json", "after_replace:2:enrichment_state.json", "before_replace:3:publication_state.json"])("never acknowledges uncommitted work at %s", async step => {
    const input = await setup();
    await expect(publishEnrichmentBatch({ ...input, fault_inject: at => { if (at === step) throw new Error("injected disk failure"); } })).rejects.toThrow("injected");
    expect(await read("features.json")).toEqual([base]);
    expect((await read("enrichment_state.json")).nodes[key]).toMatchObject({ state: "pending", attempts: 0 });
    const result = await publishEnrichmentBatch(input);
    expect(result.batch.applied_ids).toEqual([key]);
    expect(result.checkpoint.nodes[key].attempts).toBe(1);
  });
  it.each(["after_replace:3:publication_state.json", "publication_committed", "before_journal_remove"])("recovers committed outcomes after a lost reply at %s without repeating attempts", async step => {
    const input = await setup();
    await expect(publishEnrichmentBatch({ ...input, fault_inject: at => { if (at === step) throw new Error("lost reply"); } })).rejects.toThrow("lost reply");
    const committed = await loadPublicationState();
    const result = await publishEnrichmentBatch(input);
    expect(result.replayed).toBe(true);
    expect(result.checkpoint.nodes[key].attempts).toBe(1);
    expect(result.receipt.revision).toEqual(committed.revision);
    expect((await loadPublicationState()).currency.last_graph_mutation_at).toBe(committed.currency.last_graph_mutation_at);
    await expect(publishEnrichmentBatch({ ...input, deltas: [{ ...input.deltas[0], next: { ...next, description: "changed intent" } }] })).rejects.toThrow("OPERATION_IDENTITY_CONFLICT");
  });
  it("does not discard or overwrite corrupt checkpoints", async () => {
    await writeFile(join(root, "enrichment_state.json"), "{corrupt");
    await expect(loadEnrichmentRun(join(root, "enrichment_state.json"))).rejects.toThrow("ENRICHMENT_CHECKPOINT_UNAVAILABLE");
    expect(await readFile(join(root, "enrichment_state.json"), "utf8")).toBe("{corrupt");
  });
});
