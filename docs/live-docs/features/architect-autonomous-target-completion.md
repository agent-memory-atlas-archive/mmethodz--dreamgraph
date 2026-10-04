# Architect autonomous target completion

> Autonomous execution keeps the user-requested completion target authoritative across intermediate slices, verification checkpoints, and status summaries. It continues when work remains locally actionable and stops only for true completion, a genuine blocker, required user input, or explicit budget/resource policy.

**Repository:** dreamgraph<br>
**Domain:** core<br>
**Status:** active<br>
**Source files:** extensions/vscode/src/autonomy.ts, extensions/vscode/src/autonomy-loop.ts, extensions/vscode/src/test/autonomy.test.ts<br>

## Relationships

| Target | Type | Relationship | Strength | Description |
|--------|------|--------------|----------|-------------|
| ADR-240 | feature | related_to | moderate |  |
| workflow_architect_continuation_boundary_and_autonomous_completion | feature | related_to | moderate | auto-backlink |
