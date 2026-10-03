# DreamGraph v13.4.0 - Glass Atlas

## Explorer

- Compact navigation and panels, a coordinated mineral palette, and matching shape legends across both renderers.
- Instanced glass blocks, prisms, columns, rings, disc stacks, panes, diamonds, and tetrahedra distinguish node roles. Tinted reflections, soft rims, and a studio backdrop reveal depth without white hotspots.
- Connections use bounded screen-space thickness, normal compositing, junction fading, and density-aware opacity. Flow remains visible without overwhelming nodes at close zoom.
- Selection receives label priority. Viewport budgeting and collision packing limit map labels to at most 18; small viewports show fewer. Hidden labels remain discoverable by hovering, searching, or using the inspector.
- Fit-graph and pause-flow controls, navigation hints, reduced-motion support, and consistent filters and two-hop Focus in both views.
- Correct premultiplied-alpha output for Sigma, and a linear HDR → bloom → output color conversion → SMAA pipeline for Three.js. Screenshot capture retains the live view's exposure.

## Browser Architect

- Web64 IDE v2-inspired workstation styling: neutral charcoal surfaces, compact beveled controls, flat tabs, and amber keyboard focus.
- Denser plan navigation and inspector accordions, clearer conversation and composer surfaces, and consistent onboarding, runtime controls, and ADR editing.
- Responsive stacked sidebars, reduced-motion support, and proper hiding of inactive controls. Provider routing, plan state, and daemon authority are unchanged.

## Scan and enrichment

- `dg scan <instance> --max-hops N` and `dg enrich <instance> --max-hops N` control semantic neighborhood expansion, from 0 through 6. The default remains 3; 0 omits neighbor context. MCP tools accept the equivalent `context_hops` input.
- More tolerant relation normalization, explicit output schemas, and item-level recovery reduce avoidable semantic-enrichment fallbacks.
- Same-instance scan/enrichment exclusion prevents overlapping expensive passes. Existing active scans are not interrupted by these source changes.

## Distribution

CLI, standalone Architect, VS Code Architect, daemon, Explorer, Dashboard, SDK/host/token-economy packages, analytics, and daemon-exposed MCP identity share version **13.4.0**. Current model support introduced in v13.3.0 is retained.

See the [Explorer guide](guide/07-the-explorer.md) and [bootstrapping guide](guide/05-bootstrapping-the-graph.md) for usage.
