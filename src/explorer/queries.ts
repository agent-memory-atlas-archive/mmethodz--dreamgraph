/**
 * DreamGraph Explorer — Phase 2 read-only queries.
 *
 * Surface (per plans/DREAMGRAPH_EXPLORER.md §4.2):
 *   GET /explorer/api/node/:id
 *   GET /explorer/api/neighborhood/:id?depth=N&limit=M
 *   GET /explorer/api/search?q=...&types=...&limit=
 *   GET /explorer/api/edges?kind=...&min_conf=&limit=
 *   GET /explorer/api/tensions[?status=active|resolved]
 *   GET /explorer/api/stats
 *
 * All endpoints derive from the same in-memory `GraphIndex` cached by the
 * snapshot etag. The index is rebuilt lazily when a fresh snapshot supersedes
 * the cached one — no SSE invalidation yet (Phase 3).
 *
 * No file I/O happens here directly; everything reads the snapshot the
 * `GraphSnapshotService` already produces, plus the raw stores via
 * `loadGraphRaw` for full entity records / tension details.
 */

import { getExplorerGraphView, resetExplorerViews } from "../graph/snapshot.js";
import type { CanonicalGraphRead } from "../graph/read-model.js";
import { graphIdentityKey, type GraphEntity, type GraphCurrency, type RevisionVector, type ResultState } from "../graph/contracts.js";
import { buildContextPack } from "../graph/context-pack.js";
import type {
  ExplorerEdge,
  ExplorerEdgeKind,
  ExplorerNode,
  ExplorerNodeType,
  GraphSnapshot,
} from "../graph/snapshot.js";
import { graphEventBus } from "../graph/events.js";
import { loadGraphRaw, type GraphRawSnapshot } from "../graph/store.js";
import { describeCognitiveTrustState, trustStateFromResolvedTension, type CognitiveTrustDescriptor } from "../cognitive/trust-state.js";
import type {
  CapabilityEntity,
  DataModelEntity,
  Datastore,
  Feature,
  Workflow,
} from "../types/index.js";
import type {
  DreamNode,
  ResolvedTension,
  TensionSignal,
} from "../cognitive/types.js";
import type { ValidationPipelineCounts } from "../cognitive/validation-pipeline.js";

/* ------------------------------------------------------------------ */
/*  GraphIndex — O(1) per-node neighbor lookup                        */
/* ------------------------------------------------------------------ */

interface IndexedNode extends ExplorerNode {
  /** Lower-case label/id for substring search. */
  searchKey: string;
}

export class GraphIndex {
  readonly etag: string;
  readonly snapshot: GraphSnapshot;
  readonly nodesById: Map<string, IndexedNode>;
  /** Outgoing + incoming neighbors, keyed by node id → set of neighbor ids. */
  readonly neighbors: Map<string, Set<string>>;
  /** Edges grouped by source so neighborhood queries can recover edge data. */
  readonly edgesByEndpoint: Map<string, ExplorerEdge[]>;

  constructor(snapshot: GraphSnapshot, readonly graph?: CanonicalGraphRead) {
    this.snapshot = snapshot;
    this.etag = snapshot.etag;
    this.nodesById = new Map();
    this.neighbors = new Map();
    this.edgesByEndpoint = new Map();

    for (const n of snapshot.nodes) {
      this.nodesById.set(n.id, {
        ...n,
        searchKey: `${n.label} ${n.id}`.toLowerCase(),
      });
      this.neighbors.set(n.id, new Set());
      this.edgesByEndpoint.set(n.id, []);
    }
    for (const e of snapshot.edges) {
      // Endpoints are guaranteed to exist by the snapshot builder.
      this.neighbors.get(e.s)?.add(e.t);
      this.neighbors.get(e.t)?.add(e.s);
      this.edgesByEndpoint.get(e.s)?.push(e);
      this.edgesByEndpoint.get(e.t)?.push(e);
    }
  }

  /** Transitional deep links are accepted only when one typed entity matches. */
  resolve(id: string): string | null {
    if (this.nodesById.has(id)) return id;
    const matches=[...this.nodesById.values()].filter(n=>n.identity?.id===id);
    if(matches.length>1)throw new Error("EXPLORER_AMBIGUOUS_ID");
    return matches[0]?.id??null;
  }

  /** Breadth-first walk up to `depth` hops. Returns reached node ids. */
  bfs(rootId: string, depth: number, limit: number): Set<string> {
    const out = new Set<string>();
    if (!this.nodesById.has(rootId)) return out;
    out.add(rootId);
    let frontier = [rootId];
    for (let d = 0; d < depth && frontier.length > 0; d++) {
      const next: string[] = [];
      for (const id of frontier) {
        const ns = this.neighbors.get(id);
        if (!ns) continue;
        for (const m of ns) {
          if (!out.has(m)) {
            out.add(m);
            next.push(m);
            if (out.size >= limit) return out;
          }
        }
      }
      frontier = next;
    }
    return out;
  }
}

/* ------------------------------------------------------------------ */
/*  Cached singleton — rebuilt when snapshot etag changes             */
/* ------------------------------------------------------------------ */

let cached: GraphIndex | null = null;

// Drop the cached index whenever an upstream producer signals the underlying
// data may have shifted. The next getIndex() call will rebuild from the fresh
// snapshot. Subscribed once at module load — the bus is process-wide so
// re-subscribing on every call would leak handlers.
graphEventBus.subscribe((event) => {
  if (event.kind === "snapshot.changed" || event.kind === "cache.invalidated") {
    cached = null;
  }
});

async function getIndex(expectedEtag?:string): Promise<GraphIndex> {
  const {snapshot:snap,graph} = await getExplorerGraphView(expectedEtag);
  if (!cached || cached.etag !== snap.etag || cached.graph !== graph) {
    cached = new GraphIndex(snap,graph);
  }
  return cached;
}

/** Test seam — reset the cache so fixtures take effect. */
export function _resetGraphIndexCache(): void {
  cached = null;
  resetExplorerViews();
}

/* ------------------------------------------------------------------ */
/*  Entity record resolver                                            */
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
  /** Edges where this node is the source (to-target shape). */
  outgoing: ExplorerEdge[];
  /** Edges where this node is the target (from-source shape). */
  incoming: ExplorerEdge[];
  canonical?: GraphEntity;
  etag?: string;
  revision?: RevisionVector;
  currency?: GraphCurrency;
  state?: ResultState;
  adjacency?: { offset:number; limit:number; outgoing_total:number; incoming_total:number; next_offset:number|null };
  relationships?:CanonicalGraphRead["relationships"];
}

export async function getNodeRecord(id: string, expectedEtag?:string, offset=0, limit=50): Promise<NodeRecord | null> {
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error("EXPLORER_PAGE_INVALID");
  const idx = await getIndex(expectedEtag);
  if(expectedEtag&&expectedEtag!==idx.etag)throw new Error("EXPLORER_REVISION_CONFLICT");
  const resolved=idx.resolve(id);if(!resolved)return null;
  const node = idx.nodesById.get(resolved);
  if (!node) return null;
  const canonical=node.identity?idx.graph?.by_identity.get(graphIdentityKey(node.identity)):undefined;
  const entity=canonical?.payload??null;

  const outgoing: ExplorerEdge[] = [];
  const incoming: ExplorerEdge[] = [];
  for (const e of idx.edgesByEndpoint.get(resolved) ?? []) {
    if (e.s === resolved) outgoing.push(e);
    if (e.t === resolved) incoming.push(e);
  }
  const relationshipIds=new Set([...outgoing.slice(offset,offset+limit),...incoming.slice(offset,offset+limit)].map(edge=>edge.id));

  return {
    id: node.id,
    type: node.type,
    label: node.label,
    degree: node.degree,
    health: node.health,
    confidence: node.confidence,
    entity,
    outgoing:outgoing.slice(offset,offset+limit),
    incoming:incoming.slice(offset,offset+limit),
    canonical,etag:idx.etag,revision:idx.snapshot.revision,currency:idx.snapshot.currency,state:idx.snapshot.state,
    adjacency:{offset,limit,outgoing_total:outgoing.length,incoming_total:incoming.length,next_offset:offset+limit<Math.max(outgoing.length,incoming.length)?offset+limit:null},
    relationships:idx.graph?.relationships.filter(r=>relationshipIds.has(r.id)),
  };
}

/* ------------------------------------------------------------------ */
/*  Neighborhood                                                       */
/* ------------------------------------------------------------------ */

export interface NeighborhoodResult {
  root: string;
  depth: number;
  truncated: boolean;
  nodes: ExplorerNode[];
  edges: ExplorerEdge[];
  etag?:string;
  revision?:RevisionVector;
  state?:ResultState;
}

export async function getNeighborhood(
  rootId: string,
  depth: number,
  limit: number,
): Promise<NeighborhoodResult | null> {
  const idx = await getIndex();
  const resolved=idx.resolve(rootId);if(!resolved)return null;
  limit=Math.max(1,Math.min(2000,limit));
  const probe=idx.bfs(resolved,Math.max(1,Math.min(depth,4)),limit+1);
  const reached=new Set([...probe].slice(0,limit));

  const nodes: ExplorerNode[] = [];
  for (const id of reached) {
    const n = idx.nodesById.get(id);
    if (n) nodes.push(stripIndexedNode(n));
  }
  const edges: ExplorerEdge[] = [];
  // Include only edges whose BOTH endpoints are inside the reached set —
  // this keeps the rendered subgraph closed.
  const seenEdgeKey = new Set<string>();
  for (const id of reached) {
    for (const e of idx.edgesByEndpoint.get(id) ?? []) {
      if (!reached.has(e.s) || !reached.has(e.t)) continue;
      const k = e.id??`${e.s}->${e.t}::${e.kind}`;
      if (seenEdgeKey.has(k)) continue;
      seenEdgeKey.add(k);
      edges.push(e);
    }
  }

  return {
    root: resolved,
    depth,
    truncated: probe.size > limit,
    nodes,
    edges,
    etag:idx.etag,revision:idx.snapshot.revision,state:idx.snapshot.state,
  };
}

/* ------------------------------------------------------------------ */
/*  Search                                                             */
/* ------------------------------------------------------------------ */

export interface SearchHit {
  id: string;
  type: ExplorerNodeType;
  label: string;
  /** Higher = better match. */
  score: number;
}

export interface SearchResult {
  query: string;
  hits: SearchHit[];
  total?:number;
  truncated?:boolean;
  etag?:string;
  revision?:RevisionVector;
}

export async function search(
  q: string,
  typeFilter: Set<ExplorerNodeType> | null,
  limit: number,
): Promise<SearchResult> {
  const idx = await getIndex();
  const needle = q.trim().toLowerCase();
  if (needle.length === 0) return { query: q, hits: [] };

  const hits: SearchHit[] = [];
  for (const n of idx.nodesById.values()) {
    if (typeFilter && !typeFilter.has(n.type)) continue;
    const labelLow = n.label.toLowerCase();
    const idLow = n.id.toLowerCase();
    let score = 0;
    if (labelLow === needle) score = 1.0;
    else if (idLow === needle) score = 0.95;
    else if (labelLow.startsWith(needle)) score = 0.85;
    else if (idLow.startsWith(needle)) score = 0.75;
    else if (labelLow.includes(needle)) score = 0.55;
    else if (idLow.includes(needle)) score = 0.45;
    else continue;

    // Tiny degree boost so well-connected matches float up.
    score += Math.min(0.05, n.degree * 0.001);
    hits.push({ id: n.id, type: n.type, label: n.label, score });
  }
  hits.sort((a, b) => b.score - a.score);
  const bounded=hits.slice(0,Math.max(1,Math.min(200,limit)));
  return {query:q,hits:bounded,total:hits.length,truncated:bounded.length<hits.length,etag:idx.etag,revision:idx.snapshot.revision};
}

/* ------------------------------------------------------------------ */
/*  Edges (filtered list)                                              */
/* ------------------------------------------------------------------ */

export interface EdgeListResult {
  total: number;
  truncated: boolean;
  edges: ExplorerEdge[];
}

export async function listEdges(
  kindFilter: Set<ExplorerEdgeKind> | null,
  minConf: number,
  limit: number,
): Promise<EdgeListResult> {
  const idx = await getIndex();
  const out: ExplorerEdge[] = [];
  let total = 0;
  for (const e of idx.snapshot.edges) {
    if (kindFilter && !kindFilter.has(e.kind)) continue;
    if (e.conf < minConf) continue;
    total++;
    if (out.length < limit) out.push(e);
  }
  return { total, truncated: total > out.length, edges: out };
}

/* ------------------------------------------------------------------ */
/*  Tensions                                                           */
/* ------------------------------------------------------------------ */

export type TrustedTensionSignal = TensionSignal & { trust: CognitiveTrustDescriptor };
export type TrustedResolvedTension = ResolvedTension & { trust: CognitiveTrustDescriptor };

export interface TensionView {
  active: TrustedTensionSignal[];
  resolved: TrustedResolvedTension[];
  total_active: number;
  total_resolved: number;
  etag?:string;revision?:RevisionVector;state?:ResultState;omitted?:number;
}

export async function getTensionView(
  status: "active" | "resolved" | "all",
  expectedEtag?: string,
): Promise<TensionView> {
  const idx=await getIndex(expectedEtag),records=idx.graph?.entities.filter(e=>e.identity.kind==="tension")??[];
  const activeRecords=records.filter(e=>e.assertion_class!=="historical"),resolvedRecords=records.filter(e=>e.assertion_class==="historical");
  const active = status === "resolved" ? [] : activeRecords.slice(0,200).map((entity) => ({
    ...entity.payload as unknown as TensionSignal,
    trust: describeCognitiveTrustState("advisory_candidate"),
  }));
  const resolved = status === "active" ? [] : resolvedRecords.slice(-200).map((entity) => ({
    ...entity.payload as unknown as ResolvedTension,
    trust: describeCognitiveTrustState(trustStateFromResolvedTension()),
  }));
  return {
    active,
    resolved,
    total_active:activeRecords.length,
    total_resolved:resolvedRecords.length,
    etag:idx.etag,revision:idx.snapshot.revision,state:idx.snapshot.state,
    omitted:(status!=="resolved"?Math.max(0,activeRecords.length-active.length):0)+(status!=="active"?Math.max(0,resolvedRecords.length-resolved.length):0),
  };
}

/* ------------------------------------------------------------------ */
/*  Stats                                                              */
/* ------------------------------------------------------------------ */

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
  /** Mean health / confidence across all nodes. */
  health_mean: number;
  confidence_mean: number|null;
  recorded_confidence_count?:number;
  revision?:RevisionVector;
  currency?:GraphCurrency;
  state?:ResultState;
  scope?:GraphSnapshot["scope"];
  /** Normalization pipeline (per dream, latest assessment): same definition as the Status board and `dg status`. edges_by_kind counts rendered edges only. */
  validation_pipeline?:ValidationPipelineCounts|null;
}

const NODE_TYPES: ExplorerNodeType[] = [
  "feature", "workflow", "data_model", "capability", "datastore", "ui_element", "dream_node", "tension",
];
const EDGE_KINDS: ExplorerEdgeKind[] = [
  "fact", "validated", "candidate", "latent", "dream", "tension",
];

export async function getStats(expectedEtag?:string): Promise<StatsResult> {
  const idx = await getIndex(expectedEtag);

  const nodesByType = Object.fromEntries(
    NODE_TYPES.map((t) => [t, 0]),
  ) as Record<ExplorerNodeType, number>;
  const edgesByKind = Object.fromEntries(
    EDGE_KINDS.map((k) => [k, 0]),
  ) as Record<ExplorerEdgeKind, number>;

  let healthSum = 0;
  let confSum = 0;
  let confCount=0;
  for (const n of idx.snapshot.nodes) {
    nodesByType[n.type]++;
    healthSum += n.health;
    if(n.confidence_known!==false){confSum+=n.confidence;confCount++;}
  }
  for (const e of idx.snapshot.edges) {
    edgesByKind[e.kind]++;
  }
  const denom = Math.max(1, idx.snapshot.nodes.length);

  return {
    generated_at: idx.snapshot.generated_at,
    etag: idx.snapshot.etag,
    totals: {
      nodes: idx.snapshot.nodes.length,
      edges: idx.snapshot.edges.length,
      tensions_active:idx.graph?.entities.filter(e=>e.identity.kind==="tension"&&e.assertion_class!=="historical").length??0,
      tensions_resolved:idx.graph?.entities.filter(e=>e.identity.kind==="tension"&&e.assertion_class==="historical").length??0,
    },
    nodes_by_type: nodesByType,
    edges_by_kind: edgesByKind,
    health_mean: healthSum / denom,
    confidence_mean:confCount?confSum/confCount:null,recorded_confidence_count:confCount,
    revision:idx.snapshot.revision,currency:idx.snapshot.currency,state:idx.snapshot.state,scope:idx.snapshot.scope,
    validation_pipeline:idx.graph?.validation_pipeline??null,
  };
}

/** Exact same pure context assembler used by canonical graph_rag_retrieve. */
export async function getExplorerContext(id:string,expectedEtag?:string){
  const idx=await getIndex(expectedEtag);if(expectedEtag&&expectedEtag!==idx.etag)throw new Error("EXPLORER_REVISION_CONFLICT");
  const resolved=idx.resolve(id),entity=resolved?idx.graph?.by_identity.get(resolved):undefined;
  if(!entity||!idx.graph)throw new Error("EXPLORER_ENTITY_NOT_FOUND");
  return buildContextPack(idx.graph,{query:entity.label,mode:"entity_focused",mandatory_identities:[entity.identity],depth:1,max_neighbors:12,max_records:24,token_budget:3000,adapter:"explorer"});
}

export async function getCandidateView(expectedEtag?:string){
  const idx=await getIndex(expectedEtag),graph=idx.graph!;
  const all=graph.entities.filter(e=>e.identity.kind==="candidate"&&e.payload.status==="latent");
  const mapped=all.map(entity=>{
    const row=entity.payload;
    if(row.dream_type==="edge"){
      const relation=graph.relationships.find(r=>r.kind==="candidate"&&r.payload.dream_id===row.dream_id);
      if(!relation?.source||!relation.target)return null;
      return {...row,from:graphIdentityKey(relation.source),to:graphIdentityKey(relation.target),relation:relation.relation,
        strategy:relation.payload.strategy,canonical_identity:entity.identity,assertion_class:entity.assertion_class};
    }
    const dreams=graph.entities.filter(e=>e.identity.kind==="dream_node"&&e.identity.id===row.dream_id);
    if(dreams.length!==1)return null;
    return {...dreams[0].payload,...row,canonical_identity:entity.identity,assertion_class:entity.assertion_class};
  }).filter(row=>row!==null);
  return {total:graph.entities.filter(e=>e.identity.kind==="candidate").length,pending:mapped.length,orphaned:all.length-mapped.length,
    candidates:mapped.slice(0,200),omitted:Math.max(0,mapped.length-200),last_normalization:null,etag:idx.etag,revision:graph.revision,state:graph.state};
}

/* ------------------------------------------------------------------ */
/*  Internal                                                           */
/* ------------------------------------------------------------------ */

function stripIndexedNode(n: IndexedNode): ExplorerNode {
  const { searchKey: _searchKey, ...rest } = n;
  return rest;
}

/** Type-safe split helper: "feature,workflow" → Set with valid kinds only. */
export function parseNodeTypeSet(csv: string | undefined): Set<ExplorerNodeType> | null {
  if (!csv) return null;
  const valid = new Set<ExplorerNodeType>();
  for (const raw of csv.split(",")) {
    const t = raw.trim();
    if ((NODE_TYPES as string[]).includes(t)) valid.add(t as ExplorerNodeType);
  }
  return valid.size > 0 ? valid : null;
}

export function parseEdgeKindSet(csv: string | undefined): Set<ExplorerEdgeKind> | null {
  if (!csv) return null;
  const valid = new Set<ExplorerEdgeKind>();
  for (const raw of csv.split(",")) {
    const t = raw.trim();
    if ((EDGE_KINDS as string[]).includes(t)) valid.add(t as ExplorerEdgeKind);
  }
  return valid.size > 0 ? valid : null;
}
