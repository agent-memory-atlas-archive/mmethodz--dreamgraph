/** Physical encodings remain independent; this inventory routes publication only. */
export interface StoreDefinition { domain: string; graph: boolean; optional_at_bootstrap: boolean; schema_major: number }
const graph = { domain: "graph", graph: true, optional_at_bootstrap: true, schema_major: 1 };
export const STORE_REGISTRY: Record<string, StoreDefinition> = Object.fromEntries([
  "features.json", "workflows.json", "data_model.json", "capabilities.json", "datastores.json",
  "auxiliary_entities.json", "dream_graph.json", "candidate_edges.json", "validated_edges.json",
  "tension_log.json", "adr_log.json", "dream_history.json", "remediation_log.json", "ui_registry.json",
  "system_story.json", "threat_log.json", "dream_archetypes.json", "structural_evidence.json", "normalization_evidence.json", "temporal_graph.json", "causal_graph.json",
].map(file => [file, { ...graph }]));
STORE_REGISTRY["tension_log.json"].schema_major = 2;
STORE_REGISTRY["dream_archetypes.json"].schema_major = 2;
for (const [file, domain] of Object.entries({
  "scan_state.json": "scan", "enrichment_state.json": "enrichment", "index.json": "index",
  "graph_maintenance.json": "maintenance", "schedules.json": "schedules", "event_log.json": "events",
  "meta_log.json": "metrics", "bootstrap_registry.json": "bootstrap", "jobs.json": "jobs", "lucid_log.json": "lucid",
  "plan_state.json": "plans", "slice_state.json": "plans", "role_profiles.json": "config", "spend_ledger.json": "spend",
  "session_authority.json": "authority", "change_obligations.json": "changes", "dirty_partitions.json": "maintenance",
  "execution_contexts.json": "execution", "graph_upgrade_log.json": "maintenance",
})) STORE_REGISTRY[file] = { domain, graph: false, optional_at_bootstrap: true, schema_major: 1 };
STORE_REGISTRY["schedules.json"].schema_major = 2;

export function storeDefinition(file: string): StoreDefinition {
  return STORE_REGISTRY[file] ?? { domain: "extension_state", graph: false, optional_at_bootstrap: true, schema_major: 1 };
}
