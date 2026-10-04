# Graph Enrichment Candidate Validation

> This node is the validation contract that constrains LLM-produced graph enrichment output before it can be merged into DreamGraph stores. The `enrich_parser_nodes` tool defines a strict per-node enrichment shape with required description, intent, purpose, tags, feature anchors, relations, and optional UI knowledge, while `wire_links` separately defines a bounded JSON schema for candidate links with controlled relationship vocabulary, direction, evidence excerpt, confidence, and strength. It exists to keep graph enrichment safe and evidence-bounded: invalid or malformed model output is rejected or reduced to safe behavior, and the associated tests verify batching, parsing, persistence boundaries, and LLM-unavailable short-circuit behavior rather than allowing unchecked graph mutation.

**Table:** `N/A`  
**Storage:** N/A  

## Fields

| Field | Type | Description |
|-------|------|-------------|
| candidate_id | unknown |  |
| relationship | unknown |  |
| direction | unknown |  |
| evidence_excerpt | unknown |  |
| confidence | unknown |  |
| deterministic_score | unknown |  |

## Relationships

| Target | Type | Description |
|--------|------|-------------|
| feature_adaptive_future_engine | references | - |
| workflow_adaptive_future_engine_slice_rollout | references | - |

