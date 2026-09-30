import { describe, expect, it } from "vitest";
import { placeLabels, type LabelCandidate } from "../explorer/src/label-layout";

const label = (id: string, x: number, y: number, priority = 0): LabelCandidate => ({ id, x, y, priority, width: 110, height: 22 });

describe("Explorer label packing", () => {
  it("keeps a selected hub readable among hundreds of overlapping neighbors", () => {
    const neighbors = Array.from({ length: 800 }, (_, i) => label(`node-${i}`, 280 + i % 20, 300 + i % 15, i));
    const placed = placeLabels([...neighbors, label("Public", 290, 300, 10000)], 1000, 800);
    expect(placed.map((entry) => entry.id)).toEqual(["Public"]);
  });

  it("bounds the visible label count and prevents intersecting text rectangles", () => {
    const candidates = Array.from({ length: 1200 }, (_, i) => label(`node-${i}`, 50 + i * 37 % 1100, 90 + i * 29 % 690, i));
    const placed = placeLabels(candidates, 1200, 900);
    expect(placed.length).toBeGreaterThan(5);
    expect(placed.length).toBeLessThanOrEqual(18);
    for (const a of placed) {
      expect(a.left).toBeGreaterThanOrEqual(12);
      expect(a.left + a.width).toBeLessThanOrEqual(1188);
      for (const b of placed) {
        if (a === b) continue;
        expect(a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top).toBe(false);
      }
    }
  });

  it("uses the available viewport and excludes off-screen or invalid candidates", () => {
    const candidates = [label("left", -10, 200), label("toolbar", 200, 20), label("controls", 200, 780), label("nan", NaN, 200), label("visible", 4, 200)];
    const placed = placeLabels(candidates, 900, 800);
    expect(placed.map((entry) => entry.id)).toEqual(["visible"]);
    expect(placed[0].left).toBe(12);
    expect(placeLabels(candidates, 100, 800)).toEqual([]);
  });
});
