/** No provider dispatch. Preserve measured baseline output alongside oracle fixtures. */
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { assessCognitiveReply, evaluateCognitivePolicies } from "../src/evaluation/cognitive-policy.ts";
import { resolveRolePolicy } from "../src/config/role-policy.ts";
import { engine } from "../src/cognitive/engine.ts";
import { normalize } from "../src/cognitive/normalizer.ts";
import { initLlmProvider } from "../src/cognitive/llm.ts";
import { setDataDirOverride } from "../src/utils/paths.ts";
import { invalidateCache, setDataDirResolver } from "../src/utils/cache.ts";
import { releaseGraphWriter } from "../src/graph/writer-lease.ts";
const hash = body => createHash("sha256").update(body).digest("hex");
const raw = await readFile(new URL("../docs/ashoka/cognitive-policy-protocol.json", import.meta.url));
const protocol = JSON.parse(raw.toString()), reports = [];
const policies = protocol.profiles.map(p => resolveRolePolicy({ role: "dreamer", env: { DREAMGRAPH_LLM_PROVIDER: p.provider, DREAMGRAPH_LLM_MODEL: p.model } }));
for (const task of protocol.cases) {
  const claim = task.sources[0].supports[0];
  const reply = { outcome: "completed", calls: 0, latency_ms: 0, original_output: "Frozen offline source-anchor hypothesis with explicit contradiction/abstention",
    candidates: [{ id: "novel", claim, cited_source_ids: [task.sources[0].id], outcome: "hypothesis", novel: true }],
    contradictions: task.required_contradictions, abstentions: task.required_abstentions };
  reports.push(await evaluateCognitivePolicies({ task, policies, kind: "offline_fixture", execute: async () => reply }));
  const faulty = assessCognitiveReply(task, { ...reply, original_output: "Deliberately bad fixture; never a model output",
    candidates: [{ id: "repeated", claim, cited_source_ids: task.sources.slice(0, 2).map(s => s.id), outcome: "validated", novel: true },
      { id: "fabricated", claim: "fixture:unsafe", cited_source_ids: [task.sources[0].id], outcome: "hypothesis", novel: true }] });
  if (faulty.unsupported_promotions !== 1 || faulty.factual_errors !== 1) throw new Error("FROZEN_ORACLE_REGRESSION");
  reports.push({ kind: "deliberate_fault_detection", assessment: faulty });
}
const directory = await mkdtemp(join(tmpdir(), "dg-cognitive-baseline-")); let baseline;
try {
  setDataDirOverride(directory); setDataDirResolver(() => directory); invalidateCache();
  initLlmProvider({ provider: "none", model: "none", baseUrl: "", apiKey: "", temperature: 0, maxTokens: 1024, timeoutMs: 1000 });
  // Explicit disablement also overrides any operator role selection in this offline script.
  process.env.DREAMGRAPH_LLM_NORMALIZER_PROVIDER = "none";
  const facts = ["alpha", "beta"].map(id => ({ id, name: id, description: "Shared fixture source", domain: "fixture", source_repo: "fixture",
    source_files: ["fixture/source.ts"], keywords: ["shared"], links: [] }));
  await writeFile(join(directory, "features.json"), JSON.stringify(facts));
  for (const file of ["workflows.json", "data_model.json"]) await writeFile(join(directory, file), "[]");
  const graph = await engine.loadDreamGraph();
  graph.edges = ["beta", "missing"].map((to, i) => ({ id: `baseline:${i}`, from: "alpha", to, type: "feature", relation: "relates_to",
    reason: "Synthetic shared ancestry fixture; no proof of source relationship", confidence: .9, origin: "rem", created_at: protocol.frozen_at,
    dream_cycle: 1, strategy: "gap_detection", ttl: 5, decay_rate: .05, reinforcement_count: 8, last_reinforced_cycle: 1,
    status: "candidate", activation_score: 0, plausibility: 0, evidence_score: 0, contradiction_score: 0 }));
  await writeFile(join(directory, "dream_graph.json"), JSON.stringify(graph)); invalidateCache();
  engine.enterRem(); engine.enterNormalizing(); const started = performance.now();
  const result = await normalize(undefined, false); engine.wake();
  const output = await engine.loadCandidateEdges();
  baseline = { kind: "actual_current_normalizer_structural_baseline", source_sha256: hash(await readFile(new URL("../src/cognitive/normalizer.ts", import.meta.url))),
    input_hash: hash(JSON.stringify({ facts, edges: graph.edges })), original_output: output, result, elapsed_ms: performance.now() - started,
    provider_calls: 0, usage: null, cost: null, independent_source_evidence: "not established by these structural fixtures",
    limitations: ["Synthetic endpoints test current structural behavior; no semantic model response or superiority is measured.", "Cold-start settings are retained literally in the normalization receipt."] };
} finally {
  await releaseGraphWriter(directory); setDataDirOverride(null); setDataDirResolver(() => process.cwd()); invalidateCache(); await rm(directory, { recursive: true, force: true });
}
const result = { schema: "dreamgraph.cognitive_policy_report.v1", protocol_sha256: hash(raw), measured_at: new Date().toISOString(),
  qualification: protocol.qualification, reports, baseline, provider_calls: 0, model_gain: null, paid_canaries: "not_run" };
await writeFile(new URL("../docs/ashoka/cognitive-policy-report.json", import.meta.url), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ reports: reports.length, baseline_processed: baseline.result.processed, provider_calls: 0, model_gain: null }));
