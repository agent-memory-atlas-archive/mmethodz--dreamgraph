# Scan State v1

> Backward-compatible committed scan state with an optional revision-scoped coverage_ledger classifying every canonical node by active source support and semantic state. The adjacent enrichment_state.json stores scan revision, provider fingerprint, attempt counts, reasons, and resumable outcomes; older files without either extension remain readable.

**Table:** `N/A`<br>
**Storage:** N/A<br>

## Fields

| Field | Type | Description |
|-------|------|-------------|
| committed_revision | unknown |  |
| evidence_ledger | unknown |  |
| coverage_ledger | unknown |  |
| coverage_ledger.nodes.semantic_state | unknown |  |
| enrichment_state.provider_fingerprint | unknown |  |
| enrichment_state.nodes.attempts | unknown |  |
