# Architect continuation ownership boundary

> Native API/controller code owns Architect continuation tokens and envelopes. Codex CLI and Copilot CLI adapters accept concrete execution requests and return normalized content, provenance, audit, timeout/cancellation, tool-trace, and session metadata without requiring, parsing, synthesizing, persisting, or exposing Architect continuation envelopes.

**Repository:** dreamgraph  
**Domain:** core  
**Status:** active  
**Source files:** src/architect/routes.ts, src/architect/continuation.ts, src/architect/cli-bridge.ts, extensions/vscode/src/architect-core/adapters/codex-cli/orchestrator.ts, extensions/vscode/src/architect-core/adapters/copilot-cli/provider-port.ts  

## Relationships

| Target | Type | Relationship | Strength | Description |
|--------|------|--------------|----------|-------------|
| ADR-240 | feature | related_to | moderate |  |
| workflow_architect_continuation_boundary_and_autonomous_completion | feature | related_to | moderate | auto-backlink |

