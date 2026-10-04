/**
 * Wire types mirroring the daemon's Phase 0 snapshot envelope.
 * Keep in sync with src/graph/snapshot.ts on the server side.
 */

import type { GraphIdentity, GraphEntity, GraphRelationship, ResultState, GraphCurrency, RevisionVector } from "../../packages/sdk/src/graph-contracts";
export const EXPECTED_SNAPSHOT_VERSION = 2;

export type ExplorerNodeType =
  | "feature"
  | "workflow"
  | "data_model"
  | "capability"
  | "datastore"
  | "ui_element"
  | "dream_node"
  | "tension";

export type ExplorerEdgeKind =
  | "fact"
  | "validated"
  | "candidate"
  | "latent"
  | "dream"
  | "tension";

export interface ExplorerNode {
  id: string;
  type: ExplorerNodeType;
  label: string;
  degree: number;
  health: number;
  confidence: number;
  identity?:GraphIdentity;
  assertion_class?:GraphEntity["assertion_class"];
  confidence_known?:boolean;
}

export interface ExplorerEdge {
  s: string;
  t: string;
  kind: ExplorerEdgeKind;
  conf: number;
  id?:string;assertion_class?:GraphRelationship["assertion_class"];relation?:string;
}

export interface SnapshotStats {
  node_count: number;
  edge_count: number;
  build_ms: number;
  bytes_uncompressed: number;
}

export interface GraphSnapshot {
  version: number;
  etag: string;
  generated_at: string;
  instance_uuid: string;
  stats: SnapshotStats;
  nodes: ExplorerNode[];
  edges: ExplorerEdge[];
  representation?:"canonical"|"legacy";
  revision?:RevisionVector;currency?:GraphCurrency;state?:ResultState;
  scope?:{rendered_nodes:number;eligible_nodes:number;canonical_entities:number;rendered_edges:number;canonical_relationships:number;omitted_nodes:number;omitted_edges:number;excluded_families:string[]};
  render_key?:string;canonical_state?:ResultState;
}

/* ------------------------------------------------------------------ */
/*  Phase 2 query response shapes                                     */
/* ------------------------------------------------------------------ */

export interface NodeRecord {
  id: string;
  type: ExplorerNodeType;
  label: string;
  degree: number;
  health: number;
  confidence: number;
  /** Original entity (Feature / Workflow / DreamNode / TensionSignal / …). */
  entity: unknown;
  outgoing: ExplorerEdge[];
  incoming: ExplorerEdge[];
  canonical?:GraphEntity;etag?:string;revision?:RevisionVector;currency?:GraphCurrency;state?:ResultState;
  adjacency?:{offset:number;limit:number;outgoing_total:number;incoming_total:number;next_offset:number|null};
  relationships?:GraphRelationship[];
}

export interface NeighborhoodResult {
  root: string;
  depth: number;
  truncated: boolean;
  nodes: ExplorerNode[];
  edges: ExplorerEdge[];
}

export interface SearchHit {
  id: string;
  type: ExplorerNodeType;
  label: string;
  score: number;
}

export interface SearchResult {
  query: string;
  hits: SearchHit[];
}

export interface StatsResult {
  generated_at: string;
  etag: string;
  totals: {
    nodes: number;
    edges: number;
    tensions_active: number;
    tensions_resolved: number;
  };
  nodes_by_type: Record<ExplorerNodeType, number>;
  edges_by_kind: Record<ExplorerEdgeKind, number>;
  health_mean: number;
  confidence_mean: number|null;
  recorded_confidence_count?:number;
  revision?:RevisionVector;currency?:GraphCurrency;state?:ResultState;scope?:GraphSnapshot["scope"];
  /** Normalization pipeline (per dream, latest assessment): same definition as the Status board and `dg status`. */
  validation_pipeline?:ValidationPipelineCounts|null;
}

/** Mirror of src/cognitive/validation-pipeline.ts ValidationPipelineCounts. */
export interface ValidationPipelineCounts {
  assessed: number;
  validated: number;
  rejected: number;
  latent: number;
  by_type: Record<"edge" | "node" | "other", Record<"validated" | "latent" | "rejected", number>>;
  validation_rate: number | null;
  assessment_rows: number;
  latent_assessments: number;
  promoted_edges: number | null;
}

export type CognitiveTrustState =
  | "accepted_fact"
  | "validated_insight"
  | "advisory_candidate"
  | "latent_speculative_link"
  | "rejected_link"
  | "expired_artifact"
  | "human_reviewed_decision";

export interface CognitiveTrustDescriptor {
  state: CognitiveTrustState;
  label: string;
  authority: "source" | "daemon_validation" | "daemon_advisory" | "daemon_rejection" | "daemon_lifecycle" | "human_review";
  reviewable: boolean;
  implies_authority: boolean;
}

export interface TensionEntity {
  id: string;
  type: string;
  domain: string;
  entities: string[];
  description: string;
  occurrences: number;
  urgency: number;
  first_seen: string;
  last_seen: string;
  attempted: boolean;
  resolved: boolean;
  ttl: number;
  trust?: CognitiveTrustDescriptor;
}

export interface TensionView {
  omitted?:number;
  etag?:string;revision?:RevisionVector;state?:ResultState;
  active: TensionEntity[];
  resolved: { tension_id: string; resolved_at: string; original: TensionEntity; trust?: CognitiveTrustDescriptor }[];
  total_active: number;
  total_resolved: number;
}

