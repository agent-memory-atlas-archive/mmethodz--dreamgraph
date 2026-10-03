import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { buildContextPack } from "../src/graph/context-pack.ts";
import { buildRetrievalIndex } from "../src/graph/retrieval-index.ts";
import { percentile } from "../src/evaluation/agent-usefulness.ts";
import { retrievalFixture } from "../tests/helpers/ashoka-retrieval.ts";
const hash = value => createHash("sha256").update(value).digest("hex");
const raw = await readFile(new URL("../docs/ashoka/agent-evaluation-protocol.json", import.meta.url));
const protocol = JSON.parse(raw.toString());
let baseline = await readFile(new URL("../tests/fixtures/ashoka/baseline.json", import.meta.url));
if (hash(baseline) !== protocol.baseline_sha256) baseline = await readFile(new URL(`../docs/ashoka/baselines/${protocol.baseline_sha256}.json`, import.meta.url));
if (hash(baseline) !== protocol.baseline_sha256) throw new Error("EVALUATION_BASELINE_CHANGED");
const cases = [];
for (const task of protocol.task_labels.filter(task => ["AT02", "AT04"].includes(task.family))) {
  const graph = retrievalFixture(task.project, protocol.source_evidence);
  const request = { query: task.prompt, token_budget: 10000, depth: 0, mandatory_evidence_ids: task.mandatory_evidence_ids };
  const now = new Date(protocol.frozen_at), reference = [], indexed = [];
  let differences = 0;
  for (let i = 0; i < protocol.repetitions; i++) {
    let expected, actual;
    const runReference = () => { const start = performance.now(); expected = buildContextPack(graph, request, now, buildRetrievalIndex(graph)); reference.push(performance.now() - start); };
    const runIndexed = () => { const start = performance.now(); actual = buildContextPack(graph, request, now); indexed.push(performance.now() - start); };
    if (i % 2) { runIndexed(); runReference(); } else { runReference(); runIndexed(); }
    if (JSON.stringify(expected) !== JSON.stringify(actual)) differences++;
  }
  const referenceP95 = percentile(reference, .95), indexedP95 = percentile(indexed, .95);
  cases.push({ id: task.id, query: task.prompt, snapshot_kind: "frozen_source_with_synthetic_distractors", records: graph.entities.length,
    reference: { p50_ms: percentile(reference, .5), p95_ms: referenceP95 }, indexed: { p50_ms: percentile(indexed, .5), p95_ms: indexedP95 },
    context_differences: differences, latency_tolerance_pass: indexedP95 <= protocol.latency.max_p95_ms && indexedP95 <= referenceP95 * protocol.latency.max_p95_ratio + protocol.latency.additive_jitter_ms });
}
const result = { schema: "dreamgraph.retrieval_benchmark.v1", measured_at: new Date().toISOString(), protocol_sha256: hash(raw),
  baseline_sha256: hash(baseline), repetitions: protocol.repetitions, platform: process.platform, node: process.version, cases,
  success: cases.every(item => item.latency_tolerance_pass && item.context_differences === 0),
  limitations: protocol.limitations, provider_calls: 0, agent_understanding_gain: null };
await writeFile(new URL("../docs/ashoka/retrieval-benchmark.json", import.meta.url), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result));
if (!result.success) process.exitCode = 1;
