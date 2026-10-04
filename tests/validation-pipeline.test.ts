import { describe, expect, it } from "vitest";

import { formatValidationRate, storeRows, validationPipelineCounts } from "../src/cognitive/validation-pipeline.js";

const row = (dream_id: string, status: string, normalization_cycle: number, dream_type = "edge", validated_at = `2026-01-01T00:00:${String(normalization_cycle).padStart(2, "0")}Z`) =>
  ({ dream_id, dream_type, status, normalization_cycle, validated_at });

describe("the shared validation pipeline definition", () => {
  it("counts each dream once with its latest assessment, so latent re-assessments do not inflate the totals", () => {
    const results = [
      { _schema: "header row" },
      row("a", "latent", 1), row("a", "latent", 2), row("a", "validated", 3),
      row("b", "latent", 1), row("b", "rejected", 2),
      row("c", "latent", 1), row("c", "latent", 4),
      row("n1", "validated", 2, "node"),
      row("x", "expired", 1, "edge"),
    ];
    const counts = validationPipelineCounts(results, [{ _note: "x" }, { from: "a", to: "b" }, { from: "c", to: "d" }]);
    expect(counts).toMatchObject({ assessed: 5, validated: 2, rejected: 2, latent: 1, assessment_rows: 9, latent_assessments: 5, promoted_edges: 2 });
    expect(counts.by_type.edge).toEqual({ validated: 1, latent: 1, rejected: 2 });
    expect(counts.by_type.node).toEqual({ validated: 1, latent: 0, rejected: 0 });
    expect(counts.validation_rate).toBe(0.5);
    expect(formatValidationRate(counts.validation_rate)).toBe("50.0%");
  });

  it("breaks a cycle tie by the latest validated_at, independent of row order", () => {
    const early = row("a", "latent", 3, "edge", "2026-01-01T00:00:00Z"), late = row("a", "validated", 3, "edge", "2026-01-02T00:00:00Z");
    expect(validationPipelineCounts([early, late]).validated).toBe(1);
    expect(validationPipelineCounts([late, early]).validated).toBe(1);
  });

  it("handles empty and array-or-object stores", () => {
    const empty = validationPipelineCounts([]);
    expect(empty).toMatchObject({ assessed: 0, validated: 0, validation_rate: null, promoted_edges: null });
    expect(formatValidationRate(null)).toBe("n/a");
    expect(storeRows({ results: [1, 2] }, "results")).toEqual([1, 2]);
    expect(storeRows([1], "results")).toEqual([1]);
    expect(storeRows(null, "results")).toEqual([]);
  });
});
