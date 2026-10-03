import { it, expect, vi, afterEach } from "vitest";
import { llmDream } from "../src/cognitive/strategies/llm-dream.js";
import * as llm from "../src/cognitive/llm.js";
import * as senses from "../src/utils/senses.js";
import { engine } from "../src/cognitive/engine.js";
import { resolveRolePolicy } from "../src/config/role-policy.js";
import type { FactEntity, FactSnapshot } from "../src/cognitive/strategies/_shared.js";
afterEach(() => vi.restoreAllMocks());
it("attaches selected role, exact context and response attribution to actual accepted dream output", async () => {
  const policy = resolveRolePolicy({ role: "dreamer", env: { DREAMGRAPH_LLM_PROVIDER: "openai", DREAMGRAPH_LLM_MODEL: "gpt-5.4" } });
  const complete = vi.fn(async () => ({ text: JSON.stringify({ edges: [{ from: "a", to: "b", relation: "possible_call", reason: "Source anchor suggests a connection", confidence: .6,
    type: "hypothetical", source_evidence: "export function sharedCall" }], new_nodes: [] }), model: "reported-fixture", usage: { inputTokens: 12 } }));
  vi.spyOn(llm, "getRoleLlmProvider").mockResolvedValue({ policy, config: { provider: "openai", model: "gpt-5.4", temperature: 0, maxTokens: 1000 },
    provider: { isAvailable: async () => true, complete } } as never);
  vi.spyOn(engine, "getUnresolvedTensions").mockResolvedValue([]); vi.spyOn(engine, "getRecentValidatedEdges").mockResolvedValue([]);
  vi.spyOn(senses, "groundEntities").mockResolvedValue([{ entityId: "a", file: "fixture.ts", snippet: "export function sharedCall() { return b(); }" }] as never);
  const entity = (id: string): FactEntity => ({ id, name: id, type: "feature", source_repo: "fixture", source_files: ["fixture.ts"], links: [], keywords: [], tags: [],
    description: "Fixture", domain: "fixture", category: "fixture", steps: [], key_fields: [], relationships: [], descriptionTokens: new Set() });
  const snapshot: FactSnapshot = { entities: new Map([["a", entity("a")], ["b", entity("b")]]), edgeSet: new Set(), domains: new Set(["fixture"]),
    sourceFileIndex: new Map([["fixture.ts", ["a", "b"]]]), degree: new Map() };
  const result = await llmDream(snapshot, 1, 2); expect(result.edges).toHaveLength(1);
  expect(result.edges[0].meta?.model_provenance).toMatchObject({ role: "dreamer", requested_model: "gpt-5.4", reported_model: "reported-fixture",
    policy_fingerprint: policy.fingerprint, independence: "model_assessment_not_independent_evidence", prompt_version: "dreamer.grounded.v2" });
  expect(result.edges[0].meta?.model_provenance).not.toHaveProperty("apiKey"); expect(complete).toHaveBeenCalledOnce();
});

it("actual LLM parser normalizes new-node aliases and bounds dependent edges without dangling output", async () => {
  const policy = resolveRolePolicy({ role: "dreamer", env: { DREAMGRAPH_LLM_PROVIDER: "openai", DREAMGRAPH_LLM_MODEL: "gpt-5.4" } });
  const complete = vi.fn(async () => ({ text: JSON.stringify({ new_nodes: [
    { id: "hub", name: "Proposed shared hub", description: "Hypothesis", domain: "fixture" },
    { id: "omitted", name: "Second hub", description: "Hypothesis", domain: "fixture" },
  ], edges: [
    { from: "hub", to: "a", relation: "possible_call", reason: "Hypothesis", confidence: .5, source_evidence: "export function sharedCall" },
    { from: "omitted", to: "a", relation: "possible_call", reason: "Hypothesis", confidence: .5, source_evidence: "export function sharedCall" },
    { from: "a", to: "a", relation: "self", reason: "Invalid", confidence: .5, source_evidence: "export function sharedCall" },
    { from: "a", to: "missing", relation: "unknown", reason: "Invalid", confidence: .5, source_evidence: "export function sharedCall" },
  ] }), model: "reported-fixture" }));
  vi.spyOn(llm, "getRoleLlmProvider").mockResolvedValue({ policy, config: { provider: "openai", model: "gpt-5.4", maxTokens: 1000 }, provider: { isAvailable: async () => true, complete } } as never);
  vi.spyOn(engine, "getUnresolvedTensions").mockResolvedValue([]); vi.spyOn(engine, "getRecentValidatedEdges").mockResolvedValue([]);
  vi.spyOn(senses, "groundEntities").mockResolvedValue([{ entityId: "a", file: "fixture.ts", snippet: "export function sharedCall() { return b(); }" }] as never);
  const a: FactEntity = { id: "a", name: "A", type: "feature", source_repo: "fixture", source_files: ["fixture.ts"], links: [], keywords: [], tags: [], description: "Fixture", domain: "fixture", category: "", steps: [], key_fields: [], relationships: [], descriptionTokens: new Set() };
  const snapshot: FactSnapshot = { entities: new Map([["a", a]]), edgeSet: new Set(), domains: new Set(["fixture"]), sourceFileIndex: new Map(), degree: new Map() };
  const result = await llmDream(snapshot, 1, 2);
  expect(result.nodes.map(n => n.id)).toEqual(["dream_llm_hub"]); expect(result.edges).toHaveLength(1);
  expect(result.edges[0]).toMatchObject({ from: "dream_llm_hub", to: "a", status: "candidate" });
  complete.mockRejectedValueOnce(new Error("provider_refused") as never);
  await expect(llmDream(snapshot, 1, 2)).rejects.toThrow("provider_refused");
});
