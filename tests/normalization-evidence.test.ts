import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { config } from "../src/config/config.js";
import { getDataDir, setDataDirOverride } from "../src/utils/paths.js";
import { releaseGraphWriter } from "../src/graph/writer-lease.js";
import { commitGraphWrites, loadPublicationState } from "../src/graph/publication.js";
import { loadCanonicalGraph } from "../src/graph/read-model.js";
import { loadClaimEvidence, assessClaimEvidence, publishSourceClaimObservation, withdrawClaimObservation,
  type ClaimSourceProof, type NormalizationClaim } from "../src/cognitive/normalization-evidence.js";
import { normalize } from "../src/cognitive/normalizer.js";
import { engine } from "../src/cognitive/engine.js";
import { curateGraph } from "../src/cognitive/curation.js";
import { graphEventBus, type GraphEvent } from "../src/graph/events.js";
import { exportArchetypes } from "../src/cognitive/federation.js";
import { evaluateLabeledNormalization } from "../src/cognitive/calibration-evaluation.js";
import { resolveRolePolicy } from "../src/config/role-policy.js";
import {captureCognitiveProjection,projectionCurrentness} from "../src/cognitive/projection-context.js";
import {generateNarrative} from "../src/cognitive/narrator.js";
import {buildDreamPlayback} from "../src/cognitive/playback.js";
import {getGraphSnapshot} from "../src/graph/snapshot.js";
import {buildCognitiveLifecycleProjection} from "../src/cognitive/lifecycle-visibility.js";
import { managedSourceEffect, managedSourceWrite, readChangeObligations, recoverSourceEffects } from "../src/graph/change-obligations.js";
import * as llm from "../src/cognitive/llm.js";
import * as policies from "../src/instance/policies.js";
import type { DreamEdge, DreamGraphFile, DreamNode } from "../src/cognitive/types.js";

let root: string, old: string, oldRepos: typeof config.repos;
const now = "2026-10-01T00:00:00.000Z";
const identity = (id: string) => ({ instance_id: "legacy", repository_id: "fixture", kind: "feature" as const, id });
const claim: NormalizationClaim = { type: "edge", from: identity("a"), to: identity("b"), relation: "depends_on" };
const promo = { promotion_confidence: 0.62, promotion_plausibility: 0.45, promotion_evidence: 0.4, promotion_evidence_count: 2, retention_plausibility: 0.35, max_contradiction: 0.3 };
const edge = (): DreamEdge => ({ id: "dream-claim", from: "a", to: "b", type: "feature", relation: "depends_on", reason: "fixture hypothesis",
  confidence: 0.99, origin: "rem", created_at: now, dream_cycle: 1, strategy: "gap_detection", ttl: 8, decay_rate: 0.05,
  reinforcement_count: 1000, last_reinforced_cycle: 1, status: "candidate", activation_score: 0, plausibility: 0, evidence_score: 0, contradiction_score: 0 });
const graph = (): DreamGraphFile => ({ metadata: { description: "", schema_version: "1.0.0", last_dream_cycle: null, total_cycles: 1,
  last_normalization: null, total_normalization_cycles: 0, created_at: now, bootstrap_state: "cold_start" }, nodes: [], edges: [edge()] });
beforeEach(async () => {
  old = getDataDir(); root = await mkdtemp(join(tmpdir(), "dg-normalization-evidence-"));
  setDataDirOverride(root); await mkdir(join(root, "repo")); oldRepos = config.repos; config.repos = { fixture: join(root, "repo") };
  vi.spyOn(llm, "getRoleLlmProvider").mockResolvedValue(null);
  vi.spyOn(policies, "resolveNormalizationStrictness").mockResolvedValue({ profile: "balanced", inherited_strict: false, override_applied: false, effective_strict: false });
  vi.spyOn(engine, "getEffectivePromotionConfig").mockResolvedValue(promo);
  if (engine.getState() !== "awake") engine.wake();
  await commitGraphWrites({ actor: "fixture_source", operation_id: "baseline", writes: [
    { file: "features.json", content: JSON.stringify(["a", "b"].map(id => ({ id, name: id, source_repo: "fixture", source_files: ["fake.ts"], source_verified: true,
      domain: "core", keywords: ["common", "tokens"], links: [] }))) },
    { file: "dream_graph.json", content: JSON.stringify(graph()) } ] });
});
afterEach(async () => { if (engine.getState() !== "awake") engine.wake(); vi.restoreAllMocks(); config.repos = oldRepos;
  await releaseGraphWriter(root); setDataDirOverride(old); await rm(root, { recursive: true, force: true }); });
async function observe(id: string, options: { claim?: NormalizationClaim; verdict?: "supports" | "contradicts"; lineage?: string; body?: string } = {}) {
  const observation = { claim: options.claim ?? claim, verdict: options.verdict ?? "supports" };
  const body = options.body ?? JSON.stringify({ witness: id, observation });
  await writeFile(join(root, "repo", `${id}.json`), body);
  const source: ClaimSourceProof = { repository_id: "fixture", path: `${id}.json`, content_hash: createHash("sha256").update(body).digest("hex"), json_pointer: "/observation", independence_id: options.lineage ?? id };
  await publishSourceClaimObservation({ id, ...observation, source, operation_id: `observe:${id}` });
  return source;
}
async function run(operation_id = "normalize", extras: Parameters<typeof normalize>[2] = {}) {
  if (engine.getState() === "awake") { engine.enterRem(); engine.enterNormalizing(); }
  return normalize(undefined, false, { operation_id, ...extras });
}
it("Slice18: only currently applicable local proofs export; prose/IDs/source paths stay out, artifacts replay exactly",async()=>{
  await observe("first");await observe("second");await run("export-proof");
  vi.stubEnv("DREAMGRAPH_FEDERATION",JSON.stringify({instance_id:"fixture-privacy"}));
  try{
    const result=await exportArchetypes(),body=await readFile(result.file_path,"utf8");expect(result.archetypes_exported).toBe(1);
    const exchange=JSON.parse(body);expect(exchange.archetypes[0].local_validation).toBe("unreviewed");
    expect(exchange.archetypes[0].entity_roles).toEqual(["system_component","system_component"]);
    expect(body).not.toContain("fixture hypothesis");expect(body).not.toContain("dream-claim");expect(body).not.toContain("first.json");expect(body).not.toContain("fixture-privacy");
    expect(await exportArchetypes()).toEqual(result);
    await writeFile(result.file_path,"tampered");await expect(exportArchetypes()).rejects.toThrow("ARTIFACT_CHANGED");
    await withdrawClaimObservation({observation_id:"second",operation_id:"withdraw-for-export",reason:"Source proof revoked"});
    expect((await exportArchetypes()).archetypes_exported).toBe(0);
    await expect(exportArchetypes(join(root,"dream_archetypes.json"))).rejects.toThrow("STORE_TARGET_FORBIDDEN");
  }finally{vi.unstubAllEnvs();}
});
it("Slice19: action alone cannot resolve; current exact independent proof verifies and withdrawal reopens the same risk",async()=>{
  const risk=await engine.recordTension({type:"missing_link",entities:["a","b"],description:"Declared bridge is missing",urgency:0.7});
  const unrelated=await engine.recordTension({type:"code_insight",entities:["other"],description:"Separate concern",urgency:0.5});
  const proposal={strategy:"merge" as const,rationale:"Verify the exact depends_on predicate",validation_window:1,source:"heuristic" as const,verification_claim:claim};
  const stamped=await engine.proposeTensionResolution(risk.id,proposal);
  await engine.recordTensionAction(risk.id,stamped!.resolution_candidate!.id!,{state:"completed",receipt_ids:["action-receipt"],reason:"Action finished; source verification remains pending"});
  expect((await engine.loadTensions()).signals.find(s=>s.id===risk.id)?.resolved).toBe(false);
  expect((await engine.validateResolutionCandidates()).confirmed).toBe(0);
  await observe("proof-first");await observe("proof-second");await run("risk-proof");
  await engine.proposeTensionResolution(risk.id,proposal);
  expect((await engine.validateResolutionCandidates()).confirmed).toBe(1);
  const archive=(await engine.getResolvedTensions()).find(r=>r.tension_id===risk.id)!;
  expect(archive.resolution_state).toBe("verified");expect(archive.verification?.independent_roots).toHaveLength(2);
  const projection=(await captureCognitiveProjection()).context;
  const originalValidated=await engine.loadValidatedEdges(),originalCandidates=await engine.loadCandidateEdges();
  const history=await engine.loadDreamHistory();history.sessions=[{session_id:"recorded-proof-cycle",timestamp:now,cycle_number:originalValidated.edges[0].normalization_cycle,strategy:"all",generated_nodes:0,generated_edges:1,decayed_nodes:0,decayed_edges:0,duplicates_merged:0,duration_ms:1,tension_signals_created:0,tension_signals_resolved:1,tensions_expired:0,tensions_decayed:0}];
  const playback=async()=>buildDreamPlayback({history,dreamGraph:await engine.loadDreamGraph(),candidates:originalCandidates,validated:originalValidated,tensions:await engine.loadTensions(),currentGraph:await loadCanonicalGraph("legacy")});
  expect((await playback()).promoted_edges[0].trust.state).toBe("validated_insight");
  expect((await getGraphSnapshot()).edges.some(edge=>edge.kind==="validated"&&edge.assertion_class==="validated_insight")).toBe(true);
  const otherBefore=(await engine.loadTensions()).signals.find(s=>s.id===unrelated.id);
  await withdrawClaimObservation({observation_id:"proof-second",operation_id:"risk-withdraw",reason:"Independent source proof revoked"});
  expect(await engine.processRecheckWindows(["other"])).toBe(0);
  expect(await engine.processRecheckWindows(["a"])).toBe(1);
  const reopened=(await engine.loadTensions()).signals.find(s=>s.id===risk.id)!;
  expect(reopened.lifecycle).toBe("review_required");expect(reopened.lifecycle_history?.some(e=>e.kind==="action")).toBe(true);
  expect((await engine.getResolvedTensions()).find(r=>r.tension_id===risk.id)?.reopened_at).toBeTruthy();
  expect((await engine.loadTensions()).signals.find(s=>s.id===unrelated.id)).toEqual(otherBefore);
  expect(await projectionCurrentness(projection)).toBe("superseded");
  const after=await playback();expect(after.interpretation).toBe("historical_projection");expect(after.promoted_edges[0].trust.state).toBe("advisory_candidate");expect(after.promoted_edges[0].evidence_ledger.claim_support?.state).not.toBe("supported");
  expect((await getGraphSnapshot()).edges.some(edge=>edge.kind==="validated")).toBe(false);
  expect(buildCognitiveLifecycleProjection({resolvedTensions:await engine.getResolvedTensions()}).transitions.some(t=>t.artifact_id===risk.id&&t.new_state==="reopened")).toBe(true);
});
it("Slice20 XS16: re-ingested narrative JSON retains derived origin and never becomes a fresh independent witness",async()=>{
  const narrative=await generateNarrative();expect(narrative.projection?.derived).toBe(true);
  await expect(observe("narrative-one",{body:JSON.stringify({...narrative,witness:"one",observation:{claim,verdict:"supports"}})})).rejects.toThrow("SOURCE_PROOF_REJECTED");
  await expect(observe("narrative-two",{body:JSON.stringify({...narrative,witness:"two",observation:{claim,verdict:"supports"}})})).rejects.toThrow("SOURCE_PROOF_REJECTED");
  const assessment=assessClaimEvidence(claim,await loadClaimEvidence(),2);expect(assessment.independent_roots).toHaveLength(0);expect(assessment.state).not.toBe("supported");
});
it("human rejection survives independently supported normalization; reviewed reopen requires a fresh normalization receipt", async () => {
  await observe("first"); await observe("second"); await run("supported-before-rejection");
  const before = await readFile(join(root,"candidate_edges.json"),"utf8");
  await curateGraph({target_id:"dream-claim",target_type:"edge",action:"reject",actor:"reviewer",reason:"Human veto requires review",expected_revision:(await loadPublicationState()).revision.graph_revision});
  expect(await readFile(join(root,"candidate_edges.json"),"utf8")).toBe(before);
  expect((await run("after-rejection")).promotedEdges).toEqual([]);
  const rejected = JSON.parse(await readFile(join(root,"candidate_edges.json"),"utf8")).results;
  expect(rejected.at(-1).status).toBe("rejected"); expect(rejected[0].status).toBe("validated");
  await curateGraph({target_id:"dream-claim",target_type:"edge",action:"reopen",actor:"reviewer",reason:"Reconsider with current proof",expected_revision:(await loadPublicationState()).revision.graph_revision});
  expect((await run("after-reopen")).promotedEdges).toHaveLength(1);
  expect((await loadCanonicalGraph("legacy")).relationships.find(e=>e.kind==="validated")?.assertion_class).toBe("validated_insight");
});
it("GE08: repetition, domain/keyword overlap and source_verified flags never manufacture corroboration", async () => {
  const result = await run(); expect(result.promotedEdges).toEqual([]); expect(result.validated).toBe(0);
  const candidates = JSON.parse(await readFile(join(root, "candidate_edges.json"), "utf8"));
  expect(candidates.results[0].evidence_count).toBe(0); expect(candidates.results[0].evidence_assessment.state).toBe("unproven");
  expect(result.receipt.bootstrap.relaxed_fields).not.toContain("promotion_evidence_count");
});
it("GE12: independently attributed current claims promote atomically, emit a committed pulse and replay without duplicate history", async () => {
  await observe("first"); await observe("second"); const events: GraphEvent[] = [], off = graphEventBus.subscribe(e => events.push(e));
  try {
    const result = await run(); expect(result.promotedEdges).toHaveLength(1); expect(result.promotedEdges[0].evidence_count).toBe(2);
    expect(result.operation_receipt!.affected_files).toEqual(expect.arrayContaining(["dream_graph.json", "candidate_edges.json", "validated_edges.json"]));
    expect(events.filter(e => e.kind === "candidate.promoted")[0].payload!.operation_id).toBe("normalize");
    const before = await readFile(join(root, "candidate_edges.json"), "utf8"), replay = await run();
    expect(replay.operation_receipt).toEqual(result.operation_receipt); expect(await readFile(join(root, "candidate_edges.json"), "utf8")).toBe(before);
    expect((await loadCanonicalGraph("legacy")).relationships.find(e => e.kind === "validated")!.assertion_class).toBe("validated_insight");
    expect(events.filter(e => e.kind === "candidate.promoted")).toHaveLength(1);
  } finally { off(); }
});
it("GE13/XS15: withdrawal revokes applicability while preserving original evidence, promotion and assessment history", async () => {
  await observe("first"); await observe("second"); await run();
  await withdrawClaimObservation({ observation_id: "second", operation_id: "withdraw", reason: "reviewed source withdrawal" });
  const read = await loadCanonicalGraph("legacy"); expect(read.relationships.find(e => e.kind === "validated")!.assertion_class).toBe("hypothesis");
  const result = await run("reassess"); expect(result.promotedEdges).toEqual([]);
  const candidates = JSON.parse(await readFile(join(root, "candidate_edges.json"), "utf8"));
  expect(candidates.results).toHaveLength(2); expect(candidates.results[0].status).toBe("validated"); expect(candidates.results[1].evidence_assessment.state).toBe("withdrawn");
  const evidence = await loadClaimEvidence(); expect(evidence.ledger.observations).toHaveLength(2); expect(evidence.ledger.withdrawals).toHaveLength(1);
  expect(JSON.parse(await readFile(join(root, "validated_edges.json"), "utf8")).edges).toHaveLength(1);
});
it("GE13: changed source proof is material; an old scan date alone is irrelevant", async () => {
  await observe("first"); await observe("second"); await run();
  await writeFile(join(root, "repo", "second.json"), "{}\n");
  expect(assessClaimEvidence(claim, await loadClaimEvidence(), 2).state).toBe("withdrawn");
  expect((await loadCanonicalGraph("legacy")).relationships.find(e => e.kind === "validated")!.assertion_class).toBe("hypothesis");
  expect((await loadPublicationState()).currency.last_full_scan_at).toBeNull();
});
it("GE08/GE12: changed wrapper bytes, repeated model/narrative/federation copies and renamed source copies retain one ancestry", async () => {
  await observe("first", { lineage: "same-origin" }); await observe("copy", { lineage: "same-origin" });
  const snapshot = await loadClaimEvidence();
  for (const [i, origin] of ["model", "derived", "imported"].entries()) snapshot.ledger.observations.push({ id: `copy-${i}`, claim, verdict: "supports", origin: origin as "model" | "derived" | "imported",
    parents: ["first", "copy"], operation_id: "fixture-copy", observed_at: now });
  expect(assessClaimEvidence(claim, snapshot, 2).independent_roots).toHaveLength(1);
  const result = await run(); expect(result.promotedEdges).toEqual([]);
});
it("GE08: copying identical source bytes with different lineage IDs cannot create independent roots", async () => {
  const body = JSON.stringify({ observation: { claim, verdict: "supports" } });
  await observe("first", { body }); await observe("second", { body });
  expect(assessClaimEvidence(claim, await loadClaimEvidence(), 2).independent_roots).toHaveLength(1);
});
it("GE12: corroboration is directed and claim-specific; adjacent source references do not validate another relation", async () => {
  await observe("first"); await observe("second"); const snapshot = await loadClaimEvidence();
  expect(assessClaimEvidence({ ...claim, from: claim.to, to: claim.from }, snapshot, 2).state).toBe("unproven");
  expect(assessClaimEvidence({ ...claim, relation: "invented_relation" }, snapshot, 2).state).toBe("unproven");
  await expect(publishSourceClaimObservation({ id: "fabricated", claim: { ...claim, relation: "invented_relation" }, verdict: "supports", source: snapshot.ledger.observations[0].source!, operation_id: "fabricated" })).rejects.toThrow("CLAIM_SOURCE_PROOF_REJECTED");
});
it("GE13: fresh contradictory source prevents promotion even with multiple strong supporting roots", async () => {
  await observe("first"); await observe("second"); await observe("counter", { verdict: "contradicts" });
  const result = await run(); expect(result.promotedEdges).toEqual([]); expect(result.rejected).toBe(1);
  expect(assessClaimEvidence(claim, await loadClaimEvidence(), 2).contradiction_roots).toHaveLength(1);
});
it("XS21: interruption before publication rolls back every participant; lost reply after commit recovers one original result", async () => {
  await observe("first"); await observe("second"); const before = await readFile(join(root, "dream_graph.json"), "utf8");
  await expect(run("before", { fault_inject: step => { if (step === "before_replace:1:candidate_edges.json") throw new Error("fixture interruption"); } })).rejects.toThrow("fixture interruption");
  expect(await readFile(join(root, "dream_graph.json"), "utf8")).toBe(before);
  await expect(readFile(join(root, "validated_edges.json"))).rejects.toThrow();
  await expect(run("after", { fault_inject: step => { if (step === "before_journal_remove") throw new Error("fixture lost reply"); } })).rejects.toThrow("fixture lost reply");
  const replay = await run("after"); expect(replay.promotedEdges).toHaveLength(1);
  expect(JSON.parse(await readFile(join(root, "candidate_edges.json"), "utf8")).results).toHaveLength(1);
});
it("XS11: labeled precision and recall are independent of promotion volume and missing labels remain unmeasured", () => {
  const measured = evaluateLabeledNormalization({ review_id: "fixture-source-review:v1", cases: [
    { id: "supported", supported: true, promoted: true, confidence: 0.9 }, { id: "missed", supported: true, promoted: false, confidence: 0.4 },
    { id: "fabricated", supported: false, promoted: true, confidence: 0.9 }, { id: "abstain", supported: false, promoted: false, confidence: 0.1 } ] });
  expect(measured.precision).toBe(0.5); expect(measured.recall).toBe(0.5); expect(measured.brier_score).toBeCloseTo(0.2975);
  expect(() => evaluateLabeledNormalization({ review_id: "", cases: [] })).toThrow("CALIBRATION_REVIEWED_LABELS_REQUIRED");
});

function semanticProvider(complete: (...args: any[]) => Promise<any>) {
  const policy = resolveRolePolicy({ role: "normalizer", env: { DREAMGRAPH_LLM_PROVIDER: "ollama" } });
  vi.mocked(llm.getRoleLlmProvider).mockResolvedValue({ provider: { isAvailable: async () => true, complete },
    config: { provider: "ollama", model: "fixture", temperature: null, maxTokens: 4000 }, policy } as Awaited<ReturnType<typeof llm.getRoleLlmProvider>>);
}
it("GE08: actual semantic model agreement changes plausibility, never independent evidence; unchanged context avoids another call", async () => {
  const complete = vi.fn(async () => ({ text: JSON.stringify({ evaluations: [{ edge_id: "dream-claim", semantic_relevance: 1, reasoning: "strong model agreement" }] }), tokensUsed: 20 }));
  semanticProvider(complete);
  await run("first-semantic"); await run("cached-semantic");
  expect(complete).toHaveBeenCalledTimes(1);
  const rows = JSON.parse(await readFile(join(root, "candidate_edges.json"), "utf8")).results;
  expect(rows[0].semantic_evaluation.semantic_relevance).toBe(1);
  expect(rows[0].model_provenance).toBeDefined();
  expect(rows.every((r: any) => r.evidence_count === 0 && r.status !== "validated")).toBe(true);
});
it("GE12: supported node publication commits source seeds, index and promotion marker together without laundering speculative intent", async () => {
  const node: DreamNode = { id: "dream_c", type: "feature", name: "Component", description: "Source-declared component", inspiration: ["a", "b"],
    source_repo: "fixture", category: "feature", intent: "Speculative future purpose", confidence: 0.95, origin: "rem", created_at: now,
    dream_cycle: 1, ttl: 8, decay_rate: 0.05, reinforcement_count: 50, last_reinforced_cycle: 1, status: "candidate", activation_score: 0 };
  const nodeClaim: NormalizationClaim = { type: "node", identity: identity("c"), label: node.name, description: node.description };
  await observe("node-first", { claim: nodeClaim }); await observe("node-second", { claim: nodeClaim });
  await commitGraphWrites({ actor: "fixture_source", operation_id: "node-fixture", writes: [{ file: "dream_graph.json", content: JSON.stringify({ ...graph(), nodes: [node], edges: [] }) }] });
  const result = await run(); expect(result.promotedNodes).toBe(1);
  const row = JSON.parse(await readFile(join(root, "features.json"), "utf8")).find((e: any) => e.id === "c");
  expect(row.description).toBe(node.description); expect(row.description).not.toContain(node.intent); expect(row.origin).toBe("rem");
  expect(result.operation_receipt!.affected_files).toEqual(expect.arrayContaining(["features.json", "index.json", "dream_graph.json"]));
  expect((await loadCanonicalGraph("legacy")).entities.find(e => e.identity.id === "c")!.assertion_class).toBe("validated_insight");
  await withdrawClaimObservation({ observation_id: "node-second", reason: "source withdrawn", operation_id: "node-withdraw" });
  expect((await loadCanonicalGraph("legacy")).entities.find(e => e.identity.id === "c")!.assertion_class).toBe("hypothesis");
});
it("GE13: known managed source debt blocks only affected claims; changing an unrelated file does not invalidate the graph", async () => {
  await observe("first"); await observe("second"); await run();
  await managedSourceWrite(join(root, "repo", "unrelated.ts"), "export const unrelated = 1;");
  expect((await loadCanonicalGraph("legacy")).relationships.find(e => e.kind === "validated")!.assertion_class).toBe("validated_insight");
  await managedSourceWrite(join(root, "repo", "fake.ts"), "export const changed = 1;");
  expect((await loadCanonicalGraph("legacy")).relationships.find(e => e.kind === "validated")!.assertion_class).toBe("hypothesis");
  expect((await run("pending-source")).promotedEdges).toHaveLength(0);
});
it("retired promoted nodes retain history but restored authority requires a fresh receipt without duplicating the entity",async()=>{
  const node:DreamNode={id:"dream_llm_c",type:"feature",name:"Component",description:"Source-declared component",inspiration:["a","b"],source_repo:"fixture",category:"feature",confidence:.95,
    origin:"rem",created_at:now,dream_cycle:1,ttl:8,decay_rate:.05,reinforcement_count:0,last_reinforced_cycle:1,status:"candidate",activation_score:0};
  const nodeClaim:NormalizationClaim={type:"node",identity:identity("c"),label:node.name,description:node.description};
  await observe("node-first",{claim:nodeClaim});await observe("node-second",{claim:nodeClaim});
  await commitGraphWrites({writes:[{file:"dream_graph.json",content:JSON.stringify({...graph(),nodes:[node],edges:[]})}]});await run("original-node");
  await curateGraph({target_id:node.id,target_type:"node",action:"reject",actor:"reviewer",reason:"Review node again",expected_revision:(await loadPublicationState()).revision.graph_revision});
  expect((await loadCanonicalGraph("legacy")).entities.find(e=>e.identity.id==="c")?.assertion_class).toBe("hypothesis");
  await curateGraph({target_id:node.id,target_type:"node",action:"restore",actor:"reviewer",reason:"Restore for reevaluation",expected_revision:(await loadPublicationState()).revision.graph_revision});
  const restored=await loadCanonicalGraph("legacy");expect(restored.entities.find(e=>e.identity.id==="c")?.assertion_class).toBe("hypothesis");
  await run("restored-node");const current=await loadCanonicalGraph("legacy");expect(current.entities.filter(e=>e.identity.id==="c")).toHaveLength(1);
  expect(current.entities.find(e=>e.identity.id==="c")?.assertion_class).toBe("validated_insight");
});
it("GE13: rejected candidates are reconsidered when real independent corroboration arrives", async () => {
  vi.mocked(policies.resolveNormalizationStrictness).mockResolvedValueOnce({ profile: "balanced", inherited_strict: false, override_applied: true, effective_strict: true });
  await run("strict-first", {});
  expect(JSON.parse(await readFile(join(root, "candidate_edges.json"), "utf8")).results[0].status).toBe("rejected");
  await observe("first"); await observe("second");
  expect((await run("new-proof")).promotedEdges).toHaveLength(1);
});
it("GE13: an unconfirmed witness write blocks trust until durable observation recovery", async () => {
  await observe("first"); await observe("second"); await run();
  const initial = await loadCanonicalGraph("legacy");
  expect(initial.relationships.find(e => e.kind === "validated")!.evidence.some(e => e.source_path === "first.json")).toBe(true);
  const witness = join(root, "repo", "first.json"), body = await readFile(witness, "utf8");
  await expect(managedSourceEffect({ changes: [{ file: witness, content: body, expected_content: body }],
    apply: () => writeFile(witness, body), fault_inject: stage => { if (stage === "effect_applied") throw new Error("lost acknowledgement"); },
  })).rejects.toThrow("RECOVERY_REQUIRED");
  expect((await readChangeObligations()).entries[0].state).toBe("unknown");
  const pending = await loadCanonicalGraph("legacy");
  expect(pending.relationships.find(e => e.kind === "validated")!.assertion_class).toBe("hypothesis");
  expect(pending.entities.find(e => e.identity.kind === "validated")!.assertion_class).toBe("hypothesis");
  expect((await run("pending-witness")).promotedEdges).toHaveLength(0);
  expect((await recoverSourceEffects()).unknown).toEqual([]);
  expect((await readChangeObligations()).entries[0].state).toBe("failed");
  expect((await loadCanonicalGraph("legacy")).relationships.find(e => e.kind === "validated")!.assertion_class).toBe("validated_insight");
  expect((await run("witness-current")).validated).toBe(1);
});
it("GE13: a confirmed unchanged witness write leaves valid evidence usable without a scan", async () => {
  await observe("first"); await observe("second"); await run();
  const witness = join(root, "repo", "first.json"), body = await readFile(witness, "utf8");
  expect((await managedSourceWrite(witness, body, body)).state).toBe("failed");
  expect((await loadCanonicalGraph("legacy")).relationships.find(e => e.kind === "validated")!.assertion_class).toBe("validated_insight");
  expect((await run("unchanged-witness")).validated).toBe(1);
});
it("XS21: full outcomes larger than receipt limits recover without clipping or duplicate effects", async () => {
  await observe("first"); await observe("second");
  await commitGraphWrites({ actor: "fixture_source", operation_id: "large-fixture", writes: [{ file: "dream_graph.json", content: JSON.stringify({ ...graph(), edges: Array.from({ length: 50 }, (_, i) => ({ ...edge(), id: `dream-${i}`, reason: "source-qualified fixture ".repeat(30) })) }) }] });
  const result = await run("large"); expect(result.promotedEdges).toHaveLength(50);
  expect(Buffer.byteLength(JSON.stringify(result))).toBeGreaterThan(65536);
  expect(Buffer.byteLength(JSON.stringify(result.operation_receipt!.result))).toBeLessThan(1024);
  expect((await run("large")).promotedEdges).toEqual(result.promotedEdges);
  expect((await loadCanonicalGraph("legacy")).relationships.filter(r => r.kind === "validated" && r.assertion_class === "validated_insight")).toHaveLength(50);
});
it("XS21: current source changes while awaiting semantic work reject the whole pass before publication", async () => {
  semanticProvider(async () => { await writeFile(join(root, "repo", "first.json"), "{}"); return { text: JSON.stringify({ evaluations: [] }) }; });
  await observe("first");
  await expect(run("changed-during-provider")).rejects.toThrow("NORMALIZATION_EVIDENCE_CHANGED");
  await expect(readFile(join(root, "candidate_edges.json"))).rejects.toThrow();
});
it("GE13: physical witness paths expose dependency debt through a repository directory alias", async () => {
  await observe("first"); await observe("second");
  await mkdir(join(root, "repo", "actual"));
  const body = JSON.stringify({ witness: "alias", observation: { claim, verdict: "supports" } });
  await writeFile(join(root, "repo", "actual", "alias.json"), body);
  await symlink(join(root, "repo", "actual"), join(root, "repo", "alias"), process.platform === "win32" ? "junction" : "dir");
  await publishSourceClaimObservation({ id: "alias", claim, verdict: "supports", operation_id: "observe:alias",
    source: { repository_id: "fixture", path: "alias/alias.json", content_hash: createHash("sha256").update(body).digest("hex"), json_pointer: "/observation", independence_id: "alias" } });
  await run();
  const witness = join(root, "repo", "actual", "alias.json");
  await expect(managedSourceEffect({ changes: [{ file: witness, content: body, expected_content: body }],
    apply: () => writeFile(witness, body), fault_inject: stage => { if (stage === "effect_applied") throw new Error("lost acknowledgement"); },
  })).rejects.toThrow("RECOVERY_REQUIRED");
  const debt = (await readChangeObligations()).entries[0];
  expect(debt.state).toBe("unknown");
  const graph = await loadCanonicalGraph("legacy");
  expect(debt.scope).toEqual(["source:fixture/actual/alias.json"]);
  expect(graph.relationships.find(r => r.kind === "validated")!.evidence.some(ref => ref.source_path === "actual/alias.json")).toBe(true);
  expect(graph.relationships.find(r => r.kind === "validated")!.assertion_class).toBe("hypothesis");
  expect((await run("alias-pending")).promotedEdges).toHaveLength(0);
});
it("XS14: malformed optional claim evidence leaves unrelated canonical entities available and prevents normalizer publication", async () => {
  await writeFile(join(root, "normalization_evidence.json"), "{broken");
  const read = await loadCanonicalGraph("legacy"); expect(read.entities.some(e => e.identity.id === "a")).toBe(true);
  expect(read.state.completeness).toBe("partial"); expect(read.state.reasons.some(r => r.code === "CLAIM_LEDGER_UNAVAILABLE")).toBe(true);
  await expect(run()).rejects.toThrow(); await expect(readFile(join(root, "candidate_edges.json"))).rejects.toThrow();
});
it("XS21: abort reaches the actual semantic provider and prevents a successful publication", async () => {
  const controller = new AbortController();
  semanticProvider(async (_messages, options) => { expect(options.signal).toBe(controller.signal); controller.abort(new Error("fixture cancel")); throw controller.signal.reason; });
  await expect(run("cancelled", { signal: controller.signal })).rejects.toThrow("fixture cancel");
  await expect(readFile(join(root, "candidate_edges.json"))).rejects.toThrow();
  expect(Object.values((await loadPublicationState()).receipts).some(r => r.operation_id === "cancelled")).toBe(false);
});
it("GE08: cyclic, missing and wrong-claim ancestry remains reviewable without creating a source root; human assertions stay distinct", async () => {
  const snapshot = await loadClaimEvidence();
  snapshot.ledger.observations.push(...[
    { id: "cycle-a", parents: ["cycle-b"] }, { id: "cycle-b", parents: ["cycle-a"] }, { id: "missing", parents: ["absent"] },
  ].map(v => ({ ...v, claim, verdict: "supports" as const, origin: "model" as const, operation_id: "fixture", observed_at: now })));
  snapshot.ledger.observations.push({ id: "human", claim, verdict: "supports", origin: "human", parents: [], operation_id: "fixture", observed_at: now });
  const assessment = assessClaimEvidence(claim, snapshot, 2);
  expect(assessment.state).toBe("unproven"); expect(assessment.independent_roots).toHaveLength(0); expect(assessment.human_assertions).toEqual(["human"]);
  expect(assessment.reasons).toEqual(expect.arrayContaining(["ancestry_cycle", "unknown_or_different_claim_ancestor"]));
});
