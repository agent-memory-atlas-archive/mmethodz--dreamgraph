/** Explicit effect exceptions refine (never weaken) the accepted discipline classification. */
import { getToolClassification } from "../discipline/manifest.js";
const sourceWrites = new Set(["create_file", "edit_file", "delete_file", "rename_file", "edit_entity", "patch_file", "append_to_file", "edit_markdown_section", "patch_markdown_chapter"]);
const externalWrites = new Set(["export_living_docs", "webhook_test", "webhook_replay"]);
const runtimeWrites = new Set(["plugin_reload", "plugin_unload"]);
const outboundReads = new Set(["fetch_web_page", "query_db_schema", "git_log", "git_blame"]);
const derivedWrites = new Set(["extract_api_surface", "get_remediation_plan", "metacognitive_analysis", "scan_project", "scan_database"]);
export function coreToolPolicy(name: string) {
  const classification = getToolClassification(name);
  const internal = name.startsWith("discipline_");
  const effect = !classification ? "unqualified_extension" : internal ? name === "discipline_get_session" || name === "discipline_check_tool" ? "session_read" : "session_write"
    : sourceWrites.has(name) ? "source_write" : externalWrites.has(name) ? "external_write" : runtimeWrites.has(name) ? "runtime_write"
    : outboundReads.has(name) ? "external_read" : derivedWrites.has(name) || ["write", "cognitive"].includes(classification.tool_class) ? "graph_write" : "graph_read";
  const readOnly = ["session_read", "graph_read", "external_read"].includes(effect);
  return { schema: "dreamgraph.tool_policy.v1", effect, read_only: readOnly,
    idempotency: readOnly ? "read_only" : "caller_must_use_owner_receipt_when_available; uncertain_effect_never_automatically_retried",
    authority: internal ? "session_and_phase" : "authenticated_instance_session_and_declared_discipline",
    cancellation: "pre_dispatch_request_fence; owner_specific_cooperative_stop; no generic rollback claim",
    result: "original_content_and_structuredContent_retained_with_versioned_metadata",
    output_schema: "owner_specific; no invented universal data schema",
    retention: "owner_specific", qualification: classification ? "core_registered" : "extension_effect_unqualified" };
}
