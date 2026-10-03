# MCP tool coverage matrix

Captured from the live 13.4.0 daemon. All 93 tools are source-located. “Mention files” counts literal names in root/extension tests, not behavioral assertions. Coverage belongs to the registration file, not the callback. “Live read” means one of this audit’s focused read-only probes; “not invoked” is deliberate for mutating/paid tools. No tool advertised MCP annotations.

| Tool | Registration | Mention files | File line coverage | Audit live call |
|---|---|---:|---:|---|
| `append_to_file` | [src/tools/code-senses.ts:1262](../../../src/tools/code-senses.ts) | 2 | 0% | not invoked |
| `bootstrap_instance` | [src/tools/bootstrap-instance.ts:49](../../../src/tools/bootstrap-instance.ts) | 3 | 0% | not invoked |
| `clear_dreams` | [src/cognitive/register.ts:1182](../../../src/cognitive/register.ts) | 0 | 0% | not invoked |
| `cognitive_status` | [src/cognitive/register.ts:1017](../../../src/cognitive/register.ts) | 6 | 0% | read-only probe |
| `create_file` | [src/tools/code-senses.ts:653](../../../src/tools/code-senses.ts) | 4 | 0% | not invoked |
| `delete_file` | [src/tools/code-senses.ts:868](../../../src/tools/code-senses.ts) | 2 | 0% | not invoked |
| `delete_schedule` | [src/cognitive/register.ts:2553](../../../src/cognitive/register.ts) | 0 | 0% | not invoked |
| `deprecate_architecture_decision` | [src/tools/adr-historian.ts:570](../../../src/tools/adr-historian.ts) | 0 | 2.03% | not invoked |
| `discipline_approve_plan` | [src/discipline/tools.ts:457](../../../src/discipline/tools.ts) | 0 | 0% | not invoked |
| `discipline_check_tool` | [src/discipline/tools.ts:236](../../../src/discipline/tools.ts) | 0 | 0% | not invoked |
| `discipline_complete_session` | [src/discipline/tools.ts:539](../../../src/discipline/tools.ts) | 0 | 0% | not invoked |
| `discipline_get_session` | [src/discipline/tools.ts:304](../../../src/discipline/tools.ts) | 0 | 0% | not invoked |
| `discipline_record_delta` | [src/discipline/tools.ts:375](../../../src/discipline/tools.ts) | 0 | 0% | not invoked |
| `discipline_record_tool_call` | [src/discipline/tools.ts:265](../../../src/discipline/tools.ts) | 1 | 0% | not invoked |
| `discipline_start_session` | [src/discipline/tools.ts:153](../../../src/discipline/tools.ts) | 0 | 0% | not invoked |
| `discipline_submit_plan` | [src/discipline/tools.ts:416](../../../src/discipline/tools.ts) | 0 | 0% | not invoked |
| `discipline_transition` | [src/discipline/tools.ts:197](../../../src/discipline/tools.ts) | 0 | 0% | not invoked |
| `discipline_verify` | [src/discipline/tools.ts:478](../../../src/discipline/tools.ts) | 0 | 0% | not invoked |
| `dispatch_cognitive_event` | [src/cognitive/register.ts:2116](../../../src/cognitive/register.ts) | 0 | 0% | not invoked |
| `dream_cycle` | [src/cognitive/register.ts:682](../../../src/cognitive/register.ts) | 11 | 0% | not invoked |
| `edit_entity` | [src/tools/code-senses.ts:1022](../../../src/tools/code-senses.ts) | 5 | 0% | not invoked |
| `edit_file` | [src/tools/code-senses.ts:746](../../../src/tools/code-senses.ts) | 4 | 0% | not invoked |
| `edit_markdown_section` | [src/tools/code-senses.ts:1369](../../../src/tools/code-senses.ts) | 1 | 0% | not invoked |
| `enrich_parser_nodes` | [src/tools/enrich-parser-nodes.ts:2284](../../../src/tools/enrich-parser-nodes.ts) | 7 | 87.17% | not invoked |
| `enrich_seed_data` | [src/tools/enrich-seed-data.ts:780](../../../src/tools/enrich-seed-data.ts) | 6 | 51.14% | not invoked |
| `export_dream_archetypes` | [src/cognitive/register.ts:1863](../../../src/cognitive/register.ts) | 0 | 0% | not invoked |
| `export_living_docs` | [src/tools/living-docs-exporter.ts:1141](../../../src/tools/living-docs-exporter.ts) | 0 | 0% | not invoked |
| `extract_api_surface` | [src/tools/api-surface.ts:1407](../../../src/tools/api-surface.ts) | 1 | 12.38% | not invoked |
| `fetch_web_page` | [src/tools/web-senses.ts:157](../../../src/tools/web-senses.ts) | 1 | 0% | not invoked |
| `generate_ui_migration_plan` | [src/tools/ui-registry.ts:1458](../../../src/tools/ui-registry.ts) | 0 | 58.04% | not invoked |
| `generate_visual_flow` | [src/tools/visual-architect.ts:562](../../../src/tools/visual-architect.ts) | 0 | 0% | not invoked |
| `get_causal_insights` | [src/cognitive/register.ts:1676](../../../src/cognitive/register.ts) | 0 | 0% | not invoked |
| `get_cognitive_preamble` | [src/cognitive/register.ts:2691](../../../src/cognitive/register.ts) | 3 | 0% | not invoked |
| `get_dream_insights` | [src/cognitive/register.ts:1290](../../../src/cognitive/register.ts) | 0 | 0% | read-only probe |
| `get_remediation_plan` | [src/cognitive/register.ts:1967](../../../src/cognitive/register.ts) | 0 | 0% | not invoked |
| `get_schedule_history` | [src/cognitive/register.ts:2589](../../../src/cognitive/register.ts) | 0 | 0% | not invoked |
| `get_system_narrative` | [src/cognitive/register.ts:1927](../../../src/cognitive/register.ts) | 0 | 0% | not invoked |
| `get_system_story` | [src/cognitive/register.ts:2208](../../../src/cognitive/register.ts) | 0 | 0% | not invoked |
| `get_temporal_insights` | [src/cognitive/register.ts:1770](../../../src/cognitive/register.ts) | 0 | 0% | not invoked |
| `get_workflow` | [src/tools/get-workflow.ts:29](../../../src/tools/get-workflow.ts) | 1 | 0% | not invoked |
| `git_blame` | [src/tools/git-senses.ts:283](../../../src/tools/git-senses.ts) | 0 | 0% | not invoked |
| `git_log` | [src/tools/git-senses.ts:176](../../../src/tools/git-senses.ts) | 0 | 0% | not invoked |
| `graph_health_report` | [src/tools/graph-health.ts:496](../../../src/tools/graph-health.ts) | 2 | 83.33% | read-only probe |
| `graph_rag_retrieve` | [src/cognitive/register.ts:2631](../../../src/cognitive/register.ts) | 3 | 0% | read-only probe |
| `import_dream_archetypes` | [src/cognitive/register.ts:1893](../../../src/cognitive/register.ts) | 0 | 0% | not invoked |
| `init_graph` | [src/tools/init-graph.ts:582](../../../src/tools/init-graph.ts) | 1 | 0% | not invoked |
| `list_directory` | [src/tools/code-senses.ts:349](../../../src/tools/code-senses.ts) | 4 | 0% | not invoked |
| `list_markdown_chapters` | [src/tools/code-senses.ts:1924](../../../src/tools/code-senses.ts) | 0 | 0% | not invoked |
| `list_schedules` | [src/cognitive/register.ts:2404](../../../src/cognitive/register.ts) | 0 | 0% | not invoked |
| `lucid_action` | [src/cognitive/register.ts:2768](../../../src/cognitive/register.ts) | 0 | 0% | not invoked |
| `lucid_dream` | [src/cognitive/register.ts:2729](../../../src/cognitive/register.ts) | 0 | 0% | not invoked |
| `metacognitive_analysis` | [src/cognitive/register.ts:2012](../../../src/cognitive/register.ts) | 0 | 0% | not invoked |
| `modify_api_surface` | [src/tools/api-surface.ts:1768](../../../src/tools/api-surface.ts) | 3 | 12.38% | not invoked |
| `mutate_validated_edge` | [src/tools/graph-edge-mutations.ts:163](../../../src/tools/graph-edge-mutations.ts) | 0 | 0% | not invoked |
| `nightmare_cycle` | [src/cognitive/register.ts:1613](../../../src/cognitive/register.ts) | 0 | 0% | not invoked |
| `normalize_dreams` | [src/cognitive/register.ts:945](../../../src/cognitive/register.ts) | 2 | 0% | not invoked |
| `patch_file` | [src/tools/code-senses.ts:1134](../../../src/tools/code-senses.ts) | 6 | 0% | not invoked |
| `patch_markdown_chapter` | [src/tools/code-senses.ts:2009](../../../src/tools/code-senses.ts) | 3 | 0% | not invoked |
| `plugin_reload` | [src/tools/plugin-ops.ts:39](../../../src/tools/plugin-ops.ts) | 0 | 0% | not invoked |
| `plugin_unload` | [src/tools/plugin-ops.ts:60](../../../src/tools/plugin-ops.ts) | 0 | 0% | not invoked |
| `quarantine_source_less_facts` | [src/cognitive/register.ts:1251](../../../src/cognitive/register.ts) | 0 | 0% | not invoked |
| `query_api_surface` | [src/tools/api-surface.ts:1444](../../../src/tools/api-surface.ts) | 1 | 12.38% | not invoked |
| `query_architecture_decisions` | [src/tools/adr-historian.ts:457](../../../src/tools/adr-historian.ts) | 4 | 2.03% | not invoked |
| `query_db_schema` | [src/tools/db-senses.ts:362](../../../src/tools/db-senses.ts) | 0 | 8.53% | not invoked |
| `query_dreams` | [src/cognitive/register.ts:1045](../../../src/cognitive/register.ts) | 1 | 0% | not invoked |
| `query_resource` | [src/tools/query-resource.ts:117](../../../src/tools/query-resource.ts) | 19 | 0% | read-only probe |
| `query_runtime_metrics` | [src/tools/runtime-senses.ts:113](../../../src/tools/runtime-senses.ts) | 1 | 0% | not invoked |
| `query_self_metrics` | [src/tools/runtime-senses.ts:174](../../../src/tools/runtime-senses.ts) | 0 | 0% | not invoked |
| `query_ui_elements` | [src/tools/ui-registry.ts:1346](../../../src/tools/ui-registry.ts) | 2 | 58.04% | not invoked |
| `read_markdown_chapter` | [src/tools/code-senses.ts:1959](../../../src/tools/code-senses.ts) | 0 | 0% | not invoked |
| `read_source_code` | [src/tools/code-senses.ts:439](../../../src/tools/code-senses.ts) | 16 | 0% | not invoked |
| `record_architecture_decision` | [src/tools/adr-historian.ts:359](../../../src/tools/adr-historian.ts) | 5 | 2.03% | not invoked |
| `register_ui_element` | [src/tools/ui-registry.ts:1022](../../../src/tools/ui-registry.ts) | 3 | 58.04% | not invoked |
| `rename_file` | [src/tools/code-senses.ts:937](../../../src/tools/code-senses.ts) | 1 | 0% | not invoked |
| `resolve_tension` | [src/cognitive/register.ts:1527](../../../src/cognitive/register.ts) | 0 | 0% | not invoked |
| `run_schedule_now` | [src/cognitive/register.ts:2519](../../../src/cognitive/register.ts) | 0 | 0% | not invoked |
| `scan_database` | [src/tools/db-senses.ts:901](../../../src/tools/db-senses.ts) | 1 | 8.53% | not invoked |
| `scan_project` | [src/tools/scan-project.ts:1664](../../../src/tools/scan-project.ts) | 8 | 53.17% | not invoked |
| `schedule_dream` | [src/cognitive/register.ts:2272](../../../src/cognitive/register.ts) | 2 | 0% | not invoked |
| `search_data_model` | [src/tools/search-data-model.ts:29](../../../src/tools/search-data-model.ts) | 0 | 0% | not invoked |
| `search_source_code` | [src/tools/code-senses.ts:1552](../../../src/tools/code-senses.ts) | 5 | 0% | not invoked |
| `shortest_path` | [src/cognitive/register.ts:2852](../../../src/cognitive/register.ts) | 0 | 0% | not invoked |
| `solidify_cognitive_insight` | [src/tools/solidify-insight.ts:797](../../../src/tools/solidify-insight.ts) | 3 | 58.93% | not invoked |
| `update_schedule` | [src/cognitive/register.ts:2456](../../../src/cognitive/register.ts) | 0 | 0% | not invoked |
| `wake_from_lucid` | [src/cognitive/register.ts:2821](../../../src/cognitive/register.ts) | 0 | 0% | not invoked |
| `webhook_dead_letter_list` | [src/tools/webhooks.ts:171](../../../src/tools/webhooks.ts) | 0 | 0% | not invoked |
| `webhook_list` | [src/tools/webhooks.ts:106](../../../src/tools/webhooks.ts) | 0 | 0% | not invoked |
| `webhook_register` | [src/tools/webhooks.ts:87](../../../src/tools/webhooks.ts) | 1 | 0% | not invoked |
| `webhook_remove` | [src/tools/webhooks.ts:118](../../../src/tools/webhooks.ts) | 0 | 0% | not invoked |
| `webhook_replay` | [src/tools/webhooks.ts:181](../../../src/tools/webhooks.ts) | 0 | 0% | not invoked |
| `webhook_set_enabled` | [src/tools/webhooks.ts:130](../../../src/tools/webhooks.ts) | 0 | 0% | not invoked |
| `webhook_test` | [src/tools/webhooks.ts:141](../../../src/tools/webhooks.ts) | 0 | 0% | not invoked |
| `wire_links` | [src/tools/wire-links.ts:585](../../../src/tools/wire-links.ts) | 2 | 33.12% | not invoked |

## Resources

All advertised URIs below require catalog/query parity and bounded output tests in Slice 1. Listing a URI is not proof of a successful read.

- `system://overview`
- `system://features`
- `system://workflows`
- `system://data-model`
- `system://datastores`
- `system://capabilities`
- `system://index`
- `ops://metrics`
- `system://metrics`
- `system://plugins`
- `system://webhooks`
- `ops://api-surface`
- `dream://graph`
- `dream://candidates`
- `dream://validated`
- `dream://status`
- `dream://tensions`
- `dream://history`
- `dream://adrs`
- `dream://ui-registry`
- `dream://threats`
- `dream://archetypes`
- `dream://metacognition`
- `dream://events`
- `dream://story`
- `dream://schedules`
- `dream://schedule-history`
- `dream://context`
- `dream://lucid`
- `discipline://manifest`
