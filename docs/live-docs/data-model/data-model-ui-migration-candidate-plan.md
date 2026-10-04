# UI Migration Candidate Plan

> This node is the optional advisory output contract for `generate_ui_migration_plan`, describing how a source UI element could be ported or refactored while preserving semantic registry constraints. The UI registry evidence shows the registry is intentionally platform-independent and captures what elements are, not how they look, while the tests prove that a valid migration plan must compare futures, map source elements to existing or explicitly proposed new elements, and record risks, verification, graph updates, and UI-registry updates under strict validation. It exists to let DreamGraph reason about UI migration as an evidence-bounded planning artifact rather than directly mutating the registry or implementation, and it is tied to `ui_registry` as the semantic source of element contracts and to `feature_adaptive_future_engine` as an advisory future-comparison surface.

**Table:** `N/A`  
**Storage:** N/A  

## Fields

| Field | Type | Description |
|-------|------|-------------|
| strategy_summary | unknown |  |
| futures_compared | unknown |  |
| element_mappings | unknown |  |
| steps | unknown |  |
| risks | unknown |  |
| data_contract_changes | unknown |  |
| verification | unknown |  |
| graph_updates | unknown |  |
| ui_registry_updates | unknown |  |

## Relationships

| Target | Type | Description |
|--------|------|-------------|
| feature_adaptive_future_engine | produced_by | - |
| tests/tools/ui-migration-plan.test.ts | validated_by | - |

