# Auxiliary Entities

> This node represents the generated auxiliary graph entities and classification categories exercised by `tests/auxiliary-entities.test.ts`, especially test-suite, configuration, automation-script, and MCP-tool outputs derived from scanned repository files. The file shows that these entities exist to turn non-primary source artifacts into stable graph records with deterministic IDs, URIs, and tags, while preserving distinctions such as tests winning over `src/tools/*.test.ts` and tool registrations being extracted from MCP tool source content. In practice, the model sits between the shared `dreamgraph_src_tools_scan_types` scan contract and the broader `test_suite`/`testing_process`, because the tests build `ProjectScan` fixtures and verify that downstream generators emit semantically useful auxiliary entities rather than raw file listings.

**Table:** `auxiliary_entities`  
**Storage:** memory  

## Fields

| Field | Type | Description |
|-------|------|-------------|
| id | string | Unique identifier for the auxiliary entity. |
| type | string | Type of the auxiliary entity. |
| properties | object | Properties associated with the auxiliary entity. |

