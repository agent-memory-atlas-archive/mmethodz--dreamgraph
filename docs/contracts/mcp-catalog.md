# Registered MCP catalogue

93 core tools, 31 resource URIs; one local extension classification. Source: core registration; contract version 1.

| Tool | Effect | Class | Idempotency |
|---|---|---|---|
| append_to_file | source_write | file_operation | owner receipt required; never automatic retry |
| bootstrap_instance | graph_write | cognitive | owner receipt required; never automatic retry |
| clear_dreams | graph_write | cognitive | owner receipt required; never automatic retry |
| cognitive_status | graph_read | truth | read only |
| create_file | source_write | file_operation | owner receipt required; never automatic retry |
| delete_file | source_write | file_operation | owner receipt required; never automatic retry |
| delete_schedule | graph_write | cognitive | owner receipt required; never automatic retry |
| deprecate_architecture_decision | graph_write | write | owner receipt required; never automatic retry |
| discipline_approve_plan | session_write | verification | owner receipt required; never automatic retry |
| discipline_check_tool | session_read | verification | read only |
| discipline_complete_session | session_write | verification | owner receipt required; never automatic retry |
| discipline_get_session | session_read | verification | read only |
| discipline_record_delta | session_write | verification | owner receipt required; never automatic retry |
| discipline_record_tool_call | session_write | verification | owner receipt required; never automatic retry |
| discipline_start_session | session_write | verification | owner receipt required; never automatic retry |
| discipline_submit_plan | session_write | verification | owner receipt required; never automatic retry |
| discipline_transition | session_write | verification | owner receipt required; never automatic retry |
| discipline_verify | session_write | verification | owner receipt required; never automatic retry |
| dispatch_cognitive_event | graph_write | cognitive | owner receipt required; never automatic retry |
| dream_cycle | graph_write | cognitive | owner receipt required; never automatic retry |
| edit_entity | source_write | file_operation | owner receipt required; never automatic retry |
| edit_file | source_write | file_operation | owner receipt required; never automatic retry |
| edit_markdown_section | source_write | file_operation | owner receipt required; never automatic retry |
| enrich_parser_nodes | graph_write | write | owner receipt required; never automatic retry |
| enrich_seed_data | graph_write | write | owner receipt required; never automatic retry |
| export_dream_archetypes | graph_write | cognitive | owner receipt required; never automatic retry |
| export_living_docs | external_write | analysis | owner receipt required; never automatic retry |
| extract_api_surface | graph_write | truth | owner receipt required; never automatic retry |
| fetch_web_page | external_read | truth | read only |
| generate_ui_migration_plan | graph_read | analysis | read only |
| generate_visual_flow | graph_read | analysis | read only |
| get_causal_insights | graph_read | truth | read only |
| get_cognitive_preamble | graph_read | truth | read only |
| get_dream_insights | graph_read | truth | read only |
| get_remediation_plan | graph_write | analysis | owner receipt required; never automatic retry |
| get_schedule_history | graph_read | truth | read only |
| get_system_narrative | graph_read | truth | read only |
| get_system_story | graph_read | truth | read only |
| get_temporal_insights | graph_read | truth | read only |
| get_workflow | graph_read | truth | read only |
| git_blame | external_read | truth | read only |
| git_log | external_read | truth | read only |
| graph_health_report | graph_read | truth | read only |
| graph_rag_retrieve | graph_read | truth | read only |
| import_dream_archetypes | graph_write | cognitive | owner receipt required; never automatic retry |
| init_graph | graph_write | write | owner receipt required; never automatic retry |
| list_directory | graph_read | truth | read only |
| list_markdown_chapters | graph_read | truth | read only |
| list_schedules | graph_read | truth | read only |
| lucid_action | graph_write | cognitive | owner receipt required; never automatic retry |
| lucid_dream | graph_write | cognitive | owner receipt required; never automatic retry |
| metacognitive_analysis | graph_write | truth | owner receipt required; never automatic retry |
| modify_api_surface | graph_write | write | owner receipt required; never automatic retry |
| mutate_validated_edge | graph_write | write | owner receipt required; never automatic retry |
| nightmare_cycle | graph_write | cognitive | owner receipt required; never automatic retry |
| normalize_dreams | graph_write | cognitive | owner receipt required; never automatic retry |
| patch_file | source_write | file_operation | owner receipt required; never automatic retry |
| patch_markdown_chapter | source_write | file_operation | owner receipt required; never automatic retry |
| plugin_reload | runtime_write | write | owner receipt required; never automatic retry |
| plugin_unload | runtime_write | write | owner receipt required; never automatic retry |
| quarantine_source_less_facts | graph_write | cognitive | owner receipt required; never automatic retry |
| query_api_surface | graph_read | truth | read only |
| query_architecture_decisions | graph_read | truth | read only |
| query_db_schema | external_read | truth | read only |
| query_dreams | graph_read | truth | read only |
| query_resource | graph_read | truth | read only |
| query_runtime_metrics | graph_read | truth | read only |
| query_self_metrics | graph_read | truth | read only |
| query_ui_elements | graph_read | truth | read only |
| read_markdown_chapter | graph_read | truth | read only |
| read_source_code | graph_read | truth | read only |
| record_architecture_decision | graph_write | write | owner receipt required; never automatic retry |
| register_ui_element | graph_write | write | owner receipt required; never automatic retry |
| rename_file | source_write | file_operation | owner receipt required; never automatic retry |
| resolve_tension | graph_write | write | owner receipt required; never automatic retry |
| run_schedule_now | graph_write | cognitive | owner receipt required; never automatic retry |
| scan_database | graph_write | analysis | owner receipt required; never automatic retry |
| scan_project | graph_write | analysis | owner receipt required; never automatic retry |
| schedule_dream | graph_write | cognitive | owner receipt required; never automatic retry |
| search_data_model | graph_read | truth | read only |
| search_source_code | graph_read | truth | read only |
| shortest_path | graph_read | truth | read only |
| solidify_cognitive_insight | graph_write | write | owner receipt required; never automatic retry |
| update_schedule | graph_write | cognitive | owner receipt required; never automatic retry |
| wake_from_lucid | graph_write | cognitive | owner receipt required; never automatic retry |
| webhook_dead_letter_list | graph_read | truth | read only |
| webhook_list | graph_read | truth | read only |
| webhook_register | graph_write | write | owner receipt required; never automatic retry |
| webhook_remove | graph_write | write | owner receipt required; never automatic retry |
| webhook_replay | external_write | write | owner receipt required; never automatic retry |
| webhook_set_enabled | graph_write | write | owner receipt required; never automatic retry |
| webhook_test | external_write | write | owner receipt required; never automatic retry |
| wire_links | graph_write | write | owner receipt required; never automatic retry |

Exact input schemas, phases and limitations are in [the machine catalogue](mcp-catalog.v1.json). Future owning slices extend this catalogue before final qualification.
