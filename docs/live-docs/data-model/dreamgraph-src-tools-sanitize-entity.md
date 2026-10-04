# Sanitize Entity

> This module is a pure helper layer for normalizing and recovering entity records used by `scan_project` and the LLM enrichment pipeline before merge and persistence. It strips template stub rows, merges incoming entities by stable `id`, recovers JSON arrays from messy model output including code fences and wrapper objects, coerces array fields defensively, and fills missing record defaults such as `name`, `source_repo`, `status`, and `domain`. Because it has no I/O or external state, it is designed to be imported broadly across the tools surface as a safe preprocessing step between raw LLM output and downstream graph storage contracts.

**Table:** `N/A`  
**Storage:** N/A  

