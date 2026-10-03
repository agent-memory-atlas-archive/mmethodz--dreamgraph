import { describe, expect, it, vi } from "vitest";
import { evaluatePairedTask, percentile, type MatchedExecution, type EvaluationAssessment, type EvaluationArm, EvaluationCancellationError } from "../src/evaluation/agent-usefulness.js";

const task = { id: "dreamgraph:AT02", project: "dreamgraph", prompt: "Explain the scan boundary",
  required_outcomes: ["correct_boundary"], mandatory_evidence_ids: ["dg-scan"], forbidden_assertions: ["wrong source attribution"] };
const execution: MatchedExecution = { provider: "fixture", model: "deterministic", api: "fixture", effort: null,
  prompt_version: "ashoka.tasks.v1", source_manifest_hash: "frozen:7", input_tokens: 1000,
  context_bytes: 1000, output_bytes: 1600, output_tokens: 100, max_calls: 1, max_elapsed_ms: 1000, retention: "local_only", currency: "USD", max_amount: 0 };
const arms: [EvaluationArm, EvaluationArm] = [{ arm: "graph_assisted", context: "graph", source_manifest_hash: "frozen:7", construction_ms: 2, context_bytes: 5 },
  { arm: "source_only", context: "source", source_manifest_hash: "frozen:7", construction_ms: 4, context_bytes: 6 }];
const assessment: EvaluationAssessment = { reviewer: "deterministic_fixture_oracle", evidence_ids: ["dg-scan"], mandatory_outcomes: { correct_boundary: true },
  unsupported_assertions: [], stale_assertions: [], understanding: { architecture: 2, history: 1, constraints: 2, uncertainty: 2 }, rationale: "Frozen source oracle" };
const evaluator = () => ({ execute: vi.fn(async () => ({ content: "Fixture answer", calls: 1, source_reads: [], outcome: "completed" as const })), assess: vi.fn(async () => assessment) });

describe("matched paired task harness", () => {
  it("runs both arms with identical settings and retains unknown usage and separate construction cost", async () => {
    const adapter = evaluator();
    const result = await evaluatePairedTask({ task, execution, arms, evaluator: adapter, kind: "offline_fixture", order: "source_first" });
    expect(adapter.execute.mock.calls.map(([input]: any) => input.arm.arm)).toEqual(["source_only", "graph_assisted"]);
    expect(result.results.every(arm => arm.mandatory_pass)).toBe(true);
    expect(result.results[0].usage).toBeNull();
    expect(result.schema).toBe("dreamgraph.paired_task_evaluation.v3");
    expect(result.execution.input_tokens).toBe(1000);
    expect(result.results[0].construction_ms).toBe(4);
    expect(result.material_understanding_gain).toBeNull();
    expect(result.limitations.join(" ")).toContain("not measured model");
  });
  it("rejects unmatched source/resource metrics and unpaid real execution before dispatch", async () => {
    const adapter = evaluator();
    await expect(evaluatePairedTask({ task, execution, arms: [{ ...arms[0], source_manifest_hash: "changed" }, arms[1]], evaluator: adapter, kind: "offline_fixture", order: "graph_first" })).rejects.toThrow("UNMATCHED_SOURCE");
    await expect(evaluatePairedTask({ task, execution, arms: [{ ...arms[0], context_bytes: 1 }, arms[1]], evaluator: adapter, kind: "offline_fixture", order: "graph_first" })).rejects.toThrow("UNVERIFIED_CONTEXT");
    await expect(evaluatePairedTask({ task, execution, arms, evaluator: adapter, kind: "real_model", order: "graph_first" })).rejects.toThrow("REQUIRES_SLICE_6_27");
    expect(adapter.execute).not.toHaveBeenCalled();
  });
  it("cannot pass missing mandatory anchors, unsupported claims or a refused answer", async () => {
    const adapter = evaluator(); adapter.assess.mockResolvedValue({ ...assessment, evidence_ids: [], unsupported_assertions: ["confidence was claimed as independent evidence"] });
    const result = await evaluatePairedTask({ task, execution, arms, evaluator: adapter, kind: "offline_fixture", order: "graph_first" });
    expect(result.results.every(arm => !arm.mandatory_pass)).toBe(true);
  });
  it("rejects excess calls and reports percentiles without mutating samples", async () => {
    const adapter = evaluator(); adapter.execute.mockResolvedValue({ content: "", calls: 2, source_reads: [], outcome: "completed" });
    await expect(evaluatePairedTask({ task, execution, arms, evaluator: adapter, kind: "offline_fixture", order: "graph_first" })).rejects.toThrow("CALL_BOUND");
    const samples = [5, 1, 9, 2]; expect(percentile(samples, 0.5)).toBe(2); expect(percentile(samples, 0.95)).toBe(9); expect(samples).toEqual([5, 1, 9, 2]);
    expect(percentile([], 0.95)).toBeNull();
    expect(() => percentile([NaN], 0.95)).toThrow("INVALID_MEASUREMENT");
  });
  it("rejects malformed usage and times out a non-cooperative executor without inventing a result", async () => {
    const adapter = evaluator();
    adapter.execute.mockResolvedValue({ content: "", calls: 1, source_reads: [], outcome: "completed", usage: { outputTokens: -1 } } as any);
    await expect(evaluatePairedTask({ task, execution, arms, evaluator: adapter, kind: "offline_fixture", order: "graph_first" })).rejects.toThrow();
    adapter.execute.mockImplementation(() => new Promise(() => {}));
    await expect(evaluatePairedTask({ task, execution: { ...execution, max_elapsed_ms: 15 }, arms, evaluator: adapter, kind: "offline_fixture", order: "graph_first" })).rejects.toThrow();
    expect(adapter.assess).not.toHaveBeenCalled();
  });
  it("keeps task labels and arm evidence immutable for an evaluator and requires a completed outcome", async () => {
    const adapter = evaluator();
    adapter.execute.mockImplementation(async (input: any) => {
      expect(Object.isFrozen(input.task.required_outcomes)).toBe(true); expect(Object.isFrozen(input.arm)).toBe(true);
      return { content: "Refused fixture", calls: 1, source_reads: [], outcome: "refused" };
    });
    const result = await evaluatePairedTask({ task, execution, arms, evaluator: adapter, kind: "offline_fixture", order: "graph_first" });
    expect(result.results.every(arm => !arm.mandatory_pass)).toBe(true); expect(task.required_outcomes).toEqual(["correct_boundary"]);
  });

});

it("measures Unicode bytes without confusing either byte ceiling with model tokens", async () => {
  const adapter = evaluator(); adapter.execute.mockResolvedValue({ content: "é", calls: 1, source_reads: [], outcome: "completed", usage: { inputTokens: 20, outputTokens: 1 } } as any);
  const result = await evaluatePairedTask({ task, execution: { ...execution, input_tokens: 30, output_tokens: 1, output_bytes: 2 },
    arms: [{ ...arms[0], context: "漢🙂", context_bytes: 7 }, arms[1]], evaluator: adapter, kind: "offline_fixture", order: "graph_first" });
  expect(result.results[0]).toMatchObject({ context_bytes: 7, context_tokens: null, context_token_measurement: "unavailable", usage: { inputTokens: 20, outputTokens: 1 } });
  await expect(evaluatePairedTask({ task, execution: { ...execution, input_tokens: 19 }, arms, evaluator: adapter, kind: "offline_fixture", order: "graph_first" })).rejects.toThrow("TOKEN_BOUND");
  await expect(evaluatePairedTask({ task, execution: { ...execution, output_bytes: 1 }, arms, evaluator: adapter, kind: "offline_fixture", order: "graph_first" })).rejects.toThrow("OUTPUT_BYTE_BOUND");
});
it("propagates abort into assessment and never starts a second arm or claims work terminated", async () => {
  const adapter = evaluator(), controller = new AbortController();
  let observedSignal: AbortSignal | undefined, lateWorkFinished = false;
  adapter.assess.mockImplementation(async (input: any) => {
    observedSignal = input.signal; controller.abort(new Error("operator_stop"));
    await new Promise(resolve => setTimeout(resolve, 30)); lateWorkFinished = true; return assessment;
  });
  let failure: unknown;
  try { await evaluatePairedTask({ task, execution, arms, evaluator: adapter, signal: controller.signal, kind: "offline_fixture", order: "graph_first" }); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(EvaluationCancellationError);
  expect(failure).toMatchObject({ phase: "assessment", termination_status: "unconfirmed" });
  expect(observedSignal?.aborted).toBe(true); expect(adapter.execute).toHaveBeenCalledOnce(); expect(lateWorkFinished).toBe(false);
  await new Promise(resolve => setTimeout(resolve, 40)); expect(lateWorkFinished).toBe(true);
});
it("assessment deadline is signaled even if the assessor never settles", async () => {
  const adapter = evaluator(); let observed: AbortSignal | undefined;
  adapter.assess.mockImplementation((input: any) => { observed = input.signal; return new Promise(() => {}); });
  await expect(evaluatePairedTask({ task, execution: { ...execution, max_elapsed_ms: 20 }, arms, evaluator: adapter, kind: "offline_fixture", order: "graph_first" })).rejects.toMatchObject({ phase: "assessment", termination_status: "unconfirmed" });
  expect(observed?.aborted).toBe(true); expect(adapter.execute).toHaveBeenCalledOnce();
});
