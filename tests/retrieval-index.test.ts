import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { buildContextPack } from "../src/graph/context-pack.js";
import { buildRetrievalIndex, getRetrievalIndex, lexicalTerms } from "../src/graph/retrieval-index.js";
import { retrievalFixture } from "./helpers/ashoka-retrieval.js";

describe("content-bound retrieval index", () => {
  it("retains Unicode, language and qualified symbols", () => {
    const terms = lexicalTerms("Näyttö 小さなノード C++ C# runtime.loadMedia Foo::Bar scanProject");
    for (const term of ["näyttö", "小さなノード", "c++", "c#", "runtime.loadmedia", "media", "foo::bar", "scan", "project"]) expect(terms.has(term)).toBe(true);
  });
  it("does not reuse another instance, revision or changed payload under a reused revision", () => {
    const graph = retrievalFixture("dreamgraph", []);
    const original = getRetrievalIndex(graph);
    expect(getRetrievalIndex(graph)).toBe(original);
    graph.entities[0].payload.description = "Different actual content";
    expect(getRetrievalIndex(graph)).not.toBe(original);
    const next = getRetrievalIndex(graph);
    graph.revision.publication_sequence++;
    expect(getRetrievalIndex(graph)).not.toBe(next);
    const changed = getRetrievalIndex(graph);
    graph.instance_id = "other";
    expect(getRetrievalIndex(graph)).not.toBe(changed);
  });
  it("matches rebuilt reference selection and mandatory insufficiency over frozen project tasks and budget sweeps", async () => {
    const baseline = JSON.parse(await readFile("tests/fixtures/ashoka/baseline.json", "utf8"));
    const now = new Date("2026-09-30T00:00:00Z");
    for (const task of baseline.cases.filter((task: any) => ["AT02", "AT04"].includes(task.family))) {
      const graph = retrievalFixture(task.project, baseline.evidence);
      for (const token_budget of [100, 500, 2000, 10000]) {
        const query = { query: task.prompt, mandatory_evidence_ids: task.mandatory_evidence_ids, token_budget, depth: 0 };
        const indexed = buildContextPack(graph, query, now);
        const reference = buildContextPack(graph, query, now, buildRetrievalIndex(graph));
        expect(indexed).toEqual(reference);
        expect(indexed.token_count).toBeLessThanOrEqual(token_budget);
        if (indexed.mandatory_satisfied) for (const id of task.mandatory_evidence_ids) expect(indexed.receipt.selected_evidence_ids).toContain(id);
        else expect(indexed.state.reasons.some(reason => reason.code === "MANDATORY_CONTEXT_INSUFFICIENT")).toBe(true);
      }
    }
  });
  it("abstains explicitly on a question with no matching graph evidence", () => {
    const graph = retrievalFixture("dreamgraph", []);
    const pack = buildContextPack(graph, { query: "unknownQuasarPaymentProtocol", depth: 0 });
    expect(pack.records).toHaveLength(0);
    expect(pack.state.reasons.map(reason => reason.code)).toContain("NO_RELEVANT_CONTEXT");
    expect(pack.state.completeness).toBe("partial");
  });
});
