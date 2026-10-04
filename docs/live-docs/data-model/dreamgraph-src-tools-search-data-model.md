# Search Data Model

> This module registers the read-only MCP tool `search_data_model`, which looks up a specific entity in cached `data_model.json` by id or name and returns the full schema record. It exists to give callers a focused way to inspect one data-model entity, including fields, relationships, and source file locations, without mutating repositories or graph state. The implementation validates input with Zod, loads cached JSON through the shared cache utility, wraps execution in the common error helpers, and emits either a success payload or a not-found error listing available entities.

**Table:** `N/A`  
**Storage:** N/A  

