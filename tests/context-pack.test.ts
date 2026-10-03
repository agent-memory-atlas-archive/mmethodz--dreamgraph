import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CANONICAL_FAMILIES, loadCanonicalGraph } from "../src/graph/read-model.js";
import { buildContextPack } from "../src/graph/context-pack.js";
import { ContextPackSchema, graphIdentityKey } from "../src/graph/contracts.js";
import { commitGraphWrites } from "../src/graph/publication.js";
import { releaseGraphWriter } from "../src/graph/writer-lease.js";
import { setDataDirOverride } from "../src/utils/paths.js";
import { setDataDirResolver, invalidateCache } from "../src/utils/cache.js";
import { compileTaskPreamble, getCognitivePreamble, graphRagRetrieve } from "../src/cognitive/graph-rag.js";
import { config } from "../src/config/config.js";
import { managedSourceWrite, prepareChangeReconciliation, readDirtyPartitions } from "../src/graph/change-obligations.js";
import { withGraphReconciliation } from "../src/utils/graph-reconciliation-barrier.js";

let root: string;
const now = new Date("2026-09-30T20:00:00Z");
const identity = (id: string, kind: "feature" | "plan" | "slice" = "feature") => ({ instance_id: "i", kind, id });
async function put(file: string, value: unknown): Promise<void> { await writeFile(join(root, file), JSON.stringify(value)); invalidateCache(); }
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "dg-context-pack-"));
  setDataDirOverride(root); setDataDirResolver(() => root);
  for (const family of CANONICAL_FAMILIES) await put(family.file, { [family.arrays[0]]: [] });
});
afterEach(async () => {
  vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers();
  await releaseGraphWriter(root); setDataDirOverride(null); setDataDirResolver(null); invalidateCache();
  await rm(root, { recursive: true, force: true });
});

describe("canonical bounded graph context", () => {
  it.each(CANONICAL_FAMILIES.map(family => [family.kind, family.file, family.arrays[0]] as const))(
    "retrieves the literal %s family instead of silently excluding it", async (kind, file, array) => {
      await put(file, { [array]: [{ id: `f_${kind}`, name: `f_${kind}`, description: `Unique ${kind} knowledge` }] });
      const pack = buildContextPack(await loadCanonicalGraph("i"), { query: `f_${kind}`, depth: 0 }, now);
      const id=file==="dream_archetypes.json"?`foreign:unknown:f_${kind}`:`f_${kind}`;
      expect(pack.records).toContainEqual(expect.objectContaining({ identity: { instance_id: "i", kind, id } }));
      expect(pack.context_text).toContain(`Unique ${kind} knowledge`);
      expect(ContextPackSchema.safeParse(pack).success).toBe(true);
    },
  );
  it("traverses inline fact links and preserves trust classes without requiring validated edges", async () => {
    await put("features.json", [{ id: "scan", name: "Scan", links: [{ type: "workflow", target: "pipeline", relationship: "runs" }] }]);
    await put("workflows.json", [{ id: "pipeline", name: "Pipeline", source_repo: "repo", source_files: ["scan.ts"] }]);
    const pack = buildContextPack(await loadCanonicalGraph("i"), { query: "scan", depth: 1, token_budget: 2000 }, now);
    expect(pack.records.filter(record => record.record_type === "relationship")).toHaveLength(1);
    expect(pack.context_text).toContain('"relation":"runs"');
    expect(pack.context_text).toContain('"assertion":"source_assertion"');
    expect(pack.context_text).toContain('"confidence":null');
    expect(pack.receipt.delivery).toBe("unattested");
  });
  it("supplies structured knowledge as whole provenance-bound fields and makes oversized fields visibly omitted", async () => {
    await put("data_model.json", [{ id: "account", name: "account", fields: [{ name: "owner_id", type: "uuid", required: true }],
      constraints: [{ constraint: "Never mix accounts", reason: "Separate principal scope" }], history: ["long history ".repeat(2000)] }]);
    const pack = buildContextPack(await loadCanonicalGraph("i"), { query: "account owner_id", token_budget: 2000 }, now);
    expect(pack.context_text).toContain('"name":"owner_id","type":"uuid","required":true');
    expect(pack.context_text).toContain("Never mix accounts");
    expect(pack.records.filter(record => record.record_type === "entity_detail")).toHaveLength(2);
    expect(pack.context_text).not.toContain("long history");
    expect(pack.omissions).toContainEqual(expect.objectContaining({ reason: "context_budget" }));
    const rag = await graphRagRetrieve({ query: "account owner_id", token_budget: 2000, mode: "entity_focused", depth: 0, include_tensions: true, include_narrative: true });
    expect(rag.entities_included).toHaveLength(1);
  });
  it("keeps same IDs across kind/repository separate and rejects ambiguous required anchors", async () => {
    await put("features.json", [{ id: "Public", name: "Public", source_repo: "r1" }, { id: "Public", name: "Public", source_repo: "r2" }]);
    await put("capabilities.json", [{ id: "Public", name: "Public" }]);
    const graph = await loadCanonicalGraph("i");
    const pack = buildContextPack(graph, { query: "Public", token_budget: 2000, depth: 0 }, now);
    expect(new Set(pack.records.map(record => record.id)).size).toBe(3);
    expect(() => buildContextPack(graph, { query: "Public", mandatory_identities: [identity("Public")] }, now)).toThrow("AMBIGUOUS_ENTITY_ID");
    expect(() => buildContextPack(graph, { query: "Public", mandatory_identities: [{ ...identity("Public"), instance_id: "other" }] }, now)).toThrow("INSTANCE_SCOPE_MISMATCH");
  });
  it.each([100, 500, 2000])("budgets complete serialized Unicode evidence, headings and provenance at %i", async budget => {
    await put("features.json", [
      { id: "small", name: "小さなノード", description: "Näyttö näyttää lasilta ✨" },
      { id: "large", name: "large", description: "😀界".repeat(1000) },
    ]);
    const pack = buildContextPack(await loadCanonicalGraph("i"), { query: "", depth: 0, token_budget: budget }, now);
    expect(pack.token_count).toBe(Buffer.byteLength(pack.context_text, "utf8"));
    expect(pack.token_count).toBeLessThanOrEqual(budget);
    const lines = pack.context_text ? pack.context_text.split("\n").slice(1).map(line => JSON.parse(line)) : [];
    expect(lines).toHaveLength(pack.records.length);
    expect(pack.context_text).not.toContain("😀界");
    expect(pack.omissions).toContainEqual(expect.objectContaining({ reason: "context_budget" }));
  });
  it("reserves selected plan/slice and relevant decisions before optional entities, and reports insufficient mandatory context", async () => {
    await put("plan_state.json", { plans: [{ id: "ashoka", name: "Ashoka", lifecycle: "implementing", current_slice_ids: ["s3"] }] });
    await put("slice_state.json", { slices: [{ id: "s3", plan_id: "ashoka", status: "running" }] });
    await put("adr_log.json", { decisions: [{ id: "ADR-retrieval", title: "retrieval", decision: "Keep source facts separate from hypotheses." }] });
    await put("features.json", [{ id: "retrieval", name: "retrieval", description: "optional detail ".repeat(200) }]);
    const graph = await loadCanonicalGraph("i");
    const pack = buildContextPack(graph, { query: "retrieval", plan_id: "ashoka", slice_id: "s3", token_budget: 2000 }, now);
    expect(pack.mandatory_satisfied).toBe(true);
    expect(pack.records.filter(record => record.mandatory)).toHaveLength(3);
    expect(pack.receipt).toMatchObject({ plan_id: "ashoka", slice_id: "s3" });
    const tiny = buildContextPack(graph, { query: "retrieval", plan_id: "ashoka", slice_id: "s3", token_budget: 100 }, now);
    expect(tiny.mandatory_satisfied).toBe(false);
    expect(tiny.state.reasons.some(reason => reason.code === "MANDATORY_CONTEXT_INSUFFICIENT")).toBe(true);
  });
  it("does not bypass repository/domain/trust filters to satisfy a required anchor", async () => {
    await put("features.json", [{ id: "x", name: "x", source_repo: "private", domain: "secret", origin: "rem" }]);
    const graph = await loadCanonicalGraph("i");
    const pack = buildContextPack(graph, { query: "x", repositories: ["public"], domains: ["core"], assertion_classes: ["source_assertion"], mandatory_identities: [{ ...identity("x"), repository_id: "private" }] }, now);
    expect(pack.records).toEqual([]);
    expect(pack.mandatory_satisfied).toBe(false);
    expect(pack.source_fallback[0].reason).toBe("REQUIRED_FILTER_CONFLICT");
    expect(pack.context_text).not.toContain("secret");
  });
  it("limits high-degree hubs independently of hops and never emits orphaned relationships", async () => {
    const children = Array.from({ length: 300 }, (_, index) => ({ id: `n${index}`, name: `n${index}` }));
    await put("features.json", [{ id: "hub", name: "hub", links: children.map(child => ({ type: "feature", target: child.id, relationship: "uses" })) }, ...children]);
    const pack = buildContextPack(await loadCanonicalGraph("i"), { query: "hub", depth: 3, max_neighbors: 2, max_records: 6, token_budget: 2000 }, now);
    expect(pack.records.filter(record => record.record_type === "entity").length).toBeLessThanOrEqual(3);
    expect(pack.records.length).toBeLessThanOrEqual(6);
    expect(pack.omissions).toContainEqual(expect.objectContaining({ reason: "neighbor_limit" }));
    const records = pack.context_text.split("\n").slice(1).map(line => JSON.parse(line));
    const keys = new Set(records.map(record => record.entity).filter(Boolean));
    for (const edge of records.filter(record => record.relationship)) { expect(keys.has(edge.from)).toBe(true); expect(keys.has(edge.to)).toBe(true); }
  });
  it("reports source-only fallback paths for unmapped changes without fabricating knowledge", async () => {
    const pack = buildContextPack(await loadCanonicalGraph("i"), { query: "unrecorded feature", changed_files: [{ repository_id: "repo", path: "new.ts" }] }, now);
    expect(pack.records).toEqual([]);
    expect(pack.source_fallback).toEqual([{ identity: null, source_repo: "repo", source_path: "new.ts", reason: "SOURCE_NOT_MAPPED" }]);
    expect(pack.state.completeness).toBe("partial");
    expect(pack.state.reasons.some(reason => reason.code === "NO_RELEVANT_CONTEXT")).toBe(true);
  });
  it("keeps corrupt-store uncertainty scoped and does not call an old full scan stale", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2000-01-01T00:00:00Z"));
    await commitGraphWrites({ writes: [{ file: "features.json", content: JSON.stringify([{ id: "x", name: "x" }]) }],
      actor: "test", operation_id: "initial", source_reconciliation: { revision: "initial-source", scope: ["features"], full: true } });
    vi.setSystemTime(now);
    await commitGraphWrites({ writes: [], actor: "test", operation_id: "managed-reconcile",
      source_reconciliation: { revision: "current-source", scope: ["features"], full: false } });
    vi.useRealTimers();
    await writeFile(join(root, "ui_registry.json"), "{broken");
    const graph = await loadCanonicalGraph("i");
    const pack = buildContextPack(graph, { query: "x", kinds: ["feature"] }, now);
    expect(pack.state).toMatchObject({ freshness: "current", completeness: "complete" });
    expect(pack.currency.last_full_scan_at).toBe("2000-01-01T00:00:00.000Z");
    expect(pack.currency.last_graph_mutation_at).not.toBeNull();
    expect(pack.state.reasons).toEqual([]);
    const unavailable = buildContextPack(graph, { query: "", kinds: ["ui_element"] }, now);
    expect(unavailable.state).toMatchObject({ freshness: "unknown", completeness: "partial", availability: "unavailable" });
  });
  it("binds refreshed receipts to graph changes without claiming delivery", async () => {
    await put("features.json", [{ id: "x", name: "x", description: "before" }]);
    const before = buildContextPack(await loadCanonicalGraph("i"), { query: "x", execution_id: "e", adapter: "codex-cli" }, now);
    await commitGraphWrites({ writes: [{ file: "features.json", content: JSON.stringify([{ id: "x", name: "x", description: "after" }]) }], actor: "test", operation_id: "change" });
    const after = buildContextPack(await loadCanonicalGraph("i"), { query: "x", execution_id: "e", adapter: "codex-cli" }, now);
    expect(after.id).not.toBe(before.id);
    expect(after.receipt.revision.publication_sequence).toBeGreaterThan(before.receipt.revision.publication_sequence);
    expect(after.context_text).toContain("after"); expect(after.context_text).not.toContain("before");
    expect(after.receipt.delivery).toBe("unattested");
  });
  it("exposes managed source debt only for affected context and clears it at reconciliation, before optional cognition", async () => {
    const previousRepos = config.repos;
    const repo = join(root, "repo"); await mkdir(repo); await writeFile(join(repo, "changed.ts"), "before");
    config.repos = { fixture: repo };
    try {
      const features = [{ id: "affected", name: "affected", source_repo: "fixture", source_files: ["changed.ts"] },
        { id: "unaffected", name: "unaffected", source_repo: "fixture", source_files: ["other.ts"] }];
      await commitGraphWrites({ writes: [{ file: "features.json", content: JSON.stringify(features) }], operation_id: "baseline",
        source_reconciliation: { revision: "source1", scope: ["fixture"], full: true } });
      const change = await managedSourceWrite(join(repo, "changed.ts"), "after", "before");
      const graph = await loadCanonicalGraph("i");
      const debt = buildContextPack(graph, { query: "affected" }, now);
      expect(debt.state.freshness).toBe("stale");
      expect(debt.context_text).toContain('"freshness":"stale"');
      expect(debt.context_text).toContain("SOURCE_RECONCILIATION_PENDING");
      const healthy = buildContextPack(graph, { query: "unaffected" }, now);
      expect(healthy.state.freshness).toBe("current");
      expect(healthy.state.reasons.some(reason => reason.code === "SOURCE_RECONCILIATION_PENDING")).toBe(false);
      await withGraphReconciliation(async () => {
        const ledger = await prepareChangeReconciliation([change.id], "reconciled");
        await commitGraphWrites({ writes: ledger, operation_id: "reconciled", source_reconciliation: { revision: "source2", scope: change.scope, full: false } });
      });
      expect((await readDirtyPartitions()).partitions[0].pending_stages).toContain("enrichment");
      const settled = buildContextPack(await loadCanonicalGraph("i"), { query: "affected" }, now);
      expect(settled.state.freshness).toBe("current");
      expect(settled.state.reasons.some(reason => reason.code === "SOURCE_RECONCILIATION_PENDING")).toBe(false);
    } finally { config.repos = previousRepos; }
  });
  it("reserves required source provenance and fails truthfully when a requested evidence anchor is absent", async () => {
    await put("features.json", [{ id: "mapped", name: "mapped", source_repo: "repo", source_files: ["known.ts"], source_hashes: { "known.ts": "sha256:actual" } }]);
    const graph = await loadCanonicalGraph("i");
    const pack = buildContextPack(graph, { query: "unrelated task", mandatory_evidence_ids: ["source:repo:known.ts"] }, now);
    expect(pack.mandatory_satisfied).toBe(true);
    expect(pack.records[0].mandatory).toBe(true);
    expect(pack.context_text).toContain("sha256:actual");
    expect(pack.receipt.mandatory_evidence_ids).toContain("source:repo:known.ts");
    const unknown = buildContextPack(graph, { query: "unrelated task", mandatory_evidence_ids: ["source:repo:missing.ts"] }, now);
    expect(unknown.mandatory_satisfied).toBe(false);
    expect(unknown.source_fallback[0].reason).toBe("REQUIRED_EVIDENCE_MISSING");
    expect(unknown.context_text).toBe("");
  });
  it("does not inject partial mandatory context as an accepted task preamble", async () => {
    const preamble = await compileTaskPreamble({ task: "execute selected plan", max_tokens: 500, graph_context: { plan_id: "missing" } });
    expect(preamble.preamble_text).toBe("");
    expect(preamble.token_count).toBe(0);
    expect(preamble.validation_failures).toContain("MANDATORY_CONTEXT_INSUFFICIENT");
    expect(preamble.context_pack?.mandatory_satisfied).toBe(false);
  });
  it("provides expiring semantic observations without coordinates, screenshot history or re-verification", async () => {
    const observation = { schema: "dreamgraph.computer_observation.v1" as const, id: "o", target_id: "browser", target_generation: 2,
      execution_id: "e", kind: "postcondition" as const, observed_at: "2026-09-30T19:59:00Z", expires_at: "2026-09-30T20:01:00Z", artifact_ref: "private-screenshot", content_hash: "hash", evidence_ids: ["proof"], verified: true };
    const graph = await loadCanonicalGraph("i");
    const live = buildContextPack(graph, { query: "", execution_id: "e", observations: [{ observation, summary: "Selected plan was visible." }] }, now);
    expect(live.context_text).toContain("reobserve before acting");
    expect(live.context_text).not.toContain("private-screenshot");
    expect(live.receipt.expires_at).toBe(observation.expires_at);
    const expired = buildContextPack(graph, { query: "", execution_id: "e", observations: [{ observation, summary: "Selected plan was visible." }] }, new Date("2026-09-30T20:02:00Z"));
    expect(expired.records).toEqual([]);
    expect(expired.omissions).toContainEqual({ reason: "observation_expired_or_future", count: 1 });
    expect(() => buildContextPack(graph, { query: "", execution_id: "other", observations: [{ observation, summary: "Selected plan was visible." }] }, now)).toThrow("OBSERVATION_EXECUTION_MISMATCH");
  });
  it("enforces a separate whole-JSON metadata budget", async () => {
    await put("features.json", [{ id: "x", name: "x" }]);
    const pack = buildContextPack(await loadCanonicalGraph("i"), { query: "x", metadata_budget_bytes: 4096 }, now);
    expect(Buffer.byteLength(JSON.stringify({ ...pack, context_text: "" }))).toBeLessThanOrEqual(4096);
    const identities = Array.from({ length: 32 }, (_, index) => identity(`${index}${"z".repeat(1000)}`));
    const graph = await loadCanonicalGraph("i");
    expect(() => buildContextPack(graph, { query: "x", metadata_budget_bytes: 4096, mandatory_identities: identities }, now)).toThrow("CONTEXT_METADATA_INSUFFICIENT");
  });
  it("routes normal retrieval and preambles through one pure canonical view with no provider probe", async () => {
    await put("capabilities.json", [{ id: "dashboard", name: "Dashboard", description: "Typed engine role controls." }]);
    const fetch = vi.fn(() => { throw new Error("Retrieval must not call a provider"); }); vi.stubGlobal("fetch", fetch);
    const rag = await graphRagRetrieve({ query: "dashboard", mode: "entity_focused", token_budget: 500, depth: 0, include_tensions: true, include_narrative: true });
    const preamble = await compileTaskPreamble({ task: "dashboard", max_tokens: 500 });
    const overview = await getCognitivePreamble(500);
    expect(rag.context_text).toContain("Typed engine role controls");
    expect(preamble.context_pack?.records.map(record => record.id)).toEqual(rag.context_pack?.records.map(record => record.id));
    expect(overview.context_pack?.records.some(record => record.identity?.kind === "capability")).toBe(true);
    expect(rag.entities_included).toEqual(rag.context_pack?.records.map(record => record.id));
    expect(rag.context_pack?.records[0].id).toBe(graphIdentityKey({ instance_id: "legacy", kind: "capability", id: "dashboard" }));
    expect(fetch).not.toHaveBeenCalled();
  });
});
