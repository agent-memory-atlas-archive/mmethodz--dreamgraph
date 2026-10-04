# Additive Scan

> Additive Scan is a parser-node evidenced from src/tools/scan-project.ts, src/tools/scan-state.ts. Its declared fields, source provenance, and explicit links define how it participates in the project while semantic model output is unavailable. This evidence-only account is intentionally provisional and will be replaced by the next successful LLM enrichment pass.

**Repository:** dreamgraph<br>
**Domain:** core<br>
**Status:** released<br>
**Source files:** src/tools/scan-project.ts, src/tools/scan-state.ts, src/tools/incremental-reconciliation.ts, src/tools/reconciliation-transaction.ts, src/utils/graph-reconciliation-barrier.ts, src/cli/commands/scan.ts, tests/tools/scan-project-incremental-e2e.test.ts, RELEASE_NOTES_v13.1.0.md<br>

## Relationships

| Target | Type | Relationship | Strength | Description |
|--------|------|--------------|----------|-------------|
| release_workflow | workflow | released_via | strong | Published through the governed release workflow at the v13.1.0 GitHub release. |
| data_scan_state_v1 | data_model | uses | strong | Incremental reconciliation requires the committed scan-state evidence baseline. |
| graph_enrichment | feature | makes_explicit | strong | Incremental enrichment is opt-in rather than an implicit scan side effect. |
| cli_tool | feature | related_to | moderate | auto-backlink |
| data_store | feature | related_to | moderate | auto-backlink |
| standalone-architect-cli-bridge | feature | related_to | moderate | auto-backlink |
| workflow_incremental_evidence_lifecycle | feature | related_to | moderate | auto-backlink |
| graph_snapshot | feature | related_to | moderate | auto-backlink |
| feature_scan_completion_mcp_performance_plan | feature | related_to | moderate | auto-backlink |
| dreamgraph_src_cli_utils | feature | depends_on | moderate | auto-backlink |
| dreamgraph_src_tools | feature | depends_on | moderate | auto-backlink |

**Tags:** v13.1.0, additive-scan, incremental-scan, verified, released, parser-discovered, structural-fallback
