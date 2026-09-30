import { describe, expect, it } from "vitest";
import { classifyEnrichmentFailure, createEnrichmentRun, recordEnrichmentOutcome, resumableNodeIds, unfinishedEnrichmentNodeIds } from "../../src/tools/enrichment-state.js";

describe("resumable enrichment state", () => {
  it("resumes pending/retryable nodes without reprocessing success", () => {
    let state = createEnrichmentRun("scan-1", "provider-1", ["b", "a"]);
    state = recordEnrichmentOutcome(state, "a", { state: "enriched" });
    state = recordEnrichmentOutcome(state, "b", { state: "failed_retryable", reason: "transient_timeout" });
    expect(resumableNodeIds(state)).toEqual(["b"]);
    expect(recordEnrichmentOutcome(state, "a", { state: "failed_terminal", reason: "validation_failure" })).toBe(state);
  });

  it("repairs legacy fallback-as-success checkpoints on the next successful attempt", () => {
    let state = createEnrichmentRun("scan-1", "provider-1", ["fallback"]);
    state = recordEnrichmentOutcome(state, "fallback", { state: "enriched", reason: "evidence_only_fallback" });
    expect(resumableNodeIds(state)).toEqual(["fallback"]);
    expect(unfinishedEnrichmentNodeIds(state)).toEqual(["fallback"]);
    state = recordEnrichmentOutcome(state, "fallback", { state: "enriched" });
    expect(state.nodes.fallback).toMatchObject({ state: "enriched", attempts: 2 });
    expect(state.nodes.fallback.reason).toBeUndefined();
    expect(unfinishedEnrichmentNodeIds(state)).toEqual([]);
  });

  it("keeps exhausted retryable and terminal nodes unfinished without exceeding the retry limit", () => {
    let state = createEnrichmentRun("scan-1", "provider-1", ["fallback", "terminal"]);
    for (let attempt = 0; attempt < 3; attempt++) {
      state = recordEnrichmentOutcome(state, "fallback", { state: "failed_retryable", reason: "evidence_only_fallback" });
    }
    state = recordEnrichmentOutcome(state, "terminal", { state: "failed_terminal", reason: "unsupported_evidence" });
    expect(resumableNodeIds(state)).toEqual([]);
    expect(unfinishedEnrichmentNodeIds(state)).toEqual(["fallback", "terminal"]);
  });

  it.each([
    [new Error("request timed out"), "failed_retryable", "transient_timeout"],
    [new Error("provider unavailable"), "failed_retryable", "provider_unavailable"],
    [new Error("context token limit exceeded"), "failed_terminal", "context_overflow"],
    [new Error("schema validation"), "failed_terminal", "validation_failure"],
  ])("classifies %s", (failure, state, reason) => {
    expect(classifyEnrichmentFailure(failure)).toEqual({ state, reason });
  });
});
