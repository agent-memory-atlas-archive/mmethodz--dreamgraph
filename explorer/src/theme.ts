/**
 * Edge & node visual vocabulary — single source of truth for the SPA.
 *
 * Mirrors plans/DREAMGRAPH_EXPLORER.md §3.2. Phase 1 expresses these
 * with stock Sigma styling (color, thickness, dashed via type=line/arrow);
 * Phase 1.5 will introduce custom Sigma `Program`s for shimmer/pulse.
 */

import type { ExplorerEdgeKind, ExplorerNodeType } from "./types";

export const NODE_COLORS: Record<ExplorerNodeType, string> = {
  feature: "#8baeff",      // sapphire
  workflow: "#58d8bf",     // sea glass
  data_model: "#e9bd79",   // champagne amber
  capability: "#d994d6",   // orchid — distinct from dream
  datastore: "#60c8e8",    // aquamarine
  ui_element: "#f0d994",   // pale gold
  dream_node: "#af9af4",   // amethyst
  tension: "#ee8194",      // coral
};

export interface EdgeStyle {
  color: string;
  size: number;
  type?: string;
}

export const EDGE_STYLES: Record<ExplorerEdgeKind, EdgeStyle> = {
  fact: { color: "#6984a6", size: 0.7 },
  validated: { color: "#70c6b4", size: 0.9 },
  candidate: { color: "#849ef1", size: 0.7 },
  dream: { color: "#b49adc", size: 0.8 },
  tension: { color: "#ed8794", size: 1.0 },
  /** Not rejected, waiting for proof: latent candidates and promoted edges without current evidence. */
  latent: { color: "#8fa8a0", size: 0.6 },
};

/** Matching silhouettes in the glass atlas and its accessible legend. */
export const NODE_SHAPES: Record<ExplorerNodeType, { description: string; path: string }> = {
  feature: { description: "Beveled block · a unit of functionality", path: "M12 3 21 8v9l-9 5-9-5V8z M3 8l9 5 9-5 M12 13v9" },
  workflow: { description: "Directional prism · a flow of work", path: "m5 3 15 9-15 9 4-9z M9 12h11" },
  data_model: { description: "Hexagonal column · structured information", path: "m12 2 8 4v12l-8 4-8-4V6z M4 6l8 4 8-4 M12 10v12" },
  capability: { description: "Ring · an available ability", path: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0" },
  datastore: { description: "Stacked discs · persistent storage", path: "M3 6c0-4 18-4 18 0s-18 4-18 0v12c0 4 18 4 18 0V6 M3 12c0 4 18 4 18 0" },
  ui_element: { description: "Glass panel · an interface surface", path: "M4 4h16v16H4z M4 9h16 M7 6.5h.1 M10 6.5h.1" },
  dream_node: { description: "Diamond · an emerging idea", path: "m12 2 8 10-8 10-8-10z M4 12h16 M12 2v20" },
  tension: { description: "Tetrahedron · a point of friction", path: "m12 2 10 18H2z M12 2v12L2 20 M12 14l10 6" },
};

/** Confidence ring will be a custom shader in Phase 1.5; for now we
 *  fake it with a halo color drawn into the node fill. */
export function nodeRenderColor(type: ExplorerNodeType, health: number): string {
  const base = NODE_COLORS[type];
  if (health >= 0.9) return base;
  // Tilt toward warning color when health drops.
  return mixHex(base, "#ee8194", Math.min(0.55, (1 - health) * 0.65));
}

function mixHex(a: string, b: string, t: number): string {
  const pa = hexToRgb(a);
  const pb = hexToRgb(b);
  const r = Math.round(pa.r * (1 - t) + pb.r * t);
  const g = Math.round(pa.g * (1 - t) + pb.g * t);
  const bl = Math.round(pa.b * (1 - t) + pb.b * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const v = hex.replace("#", "");
  const n = parseInt(v.length === 3 ? v.split("").map((c) => c + c).join("") : v, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
