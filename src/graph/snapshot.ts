/**
 * GraphSnapshotService — build a compact, versioned graph snapshot for
 * the Explorer SPA.
 *
 * Wire envelope (see plans/DREAMGRAPH_EXPLORER.md §4.1):
 *   {
 *     version: 1,
 *     etag, generated_at, instance_uuid,
 *     stats: { node_count, edge_count, build_ms, bytes_uncompressed },
 *     nodes: [{id,type,label,degree,health,confidence}],
 *     edges: [{s,t,kind,conf}]
 *   }
 *
 * Snapshot requests recheck canonical evidence. Detail reads reuse a bounded
 * exact as-of view; explicit refresh and autonomous snapshot events replace
 * the rendered view. Cache-invalidated telemetry alone never does so.
 */

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { resolve } from "node:path";
import { getDataDir } from "../utils/paths.js";
import type { GraphRawSnapshot } from "./store.js";
import { recordSnapshotMetrics } from "./metrics.js";
import { graphEventBus } from "./events.js";
import { getActiveScope } from "../instance/index.js";
import { loadCanonicalGraph, type CanonicalGraphRead } from "./read-model.js";
import { graphIdentityKey, type GraphIdentity, type GraphEntity, type GraphRelationship, type ResultState, type GraphCurrency, type RevisionVector } from "./contracts.js";
import { FORBIDDEN_PERSISTENCE_SENTINELS } from "../semantic-invariants.js";
import type {
  Feature,
  Workflow,
  DataModelEntity,
  CapabilityEntity,
  Datastore,
  AuxiliaryEntity,
  GraphLink,
} from "../types/index.js";

export const SNAPSHOT_VERSION = 1;
export const CANONICAL_EXPLORER_VERSION = 2;

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
  | "fact"        // from seed `links` arrays
  | "validated"   // from validated_edges.json
  | "candidate"   // from candidate_edges.json (post-normalize, not yet promoted)
  | "dream"       // from dream_graph.json edges
  | "tension";    // implicit edges between tension.entities

export interface ExplorerNode {
  id: string;
  type: ExplorerNodeType;
  label: string;
  degree: number;
  /** 0..1 — derived health score (1.0 = healthy, lower = tensions / low confidence). */
  health: number;
  /** 0..1 — confidence where applicable (dream nodes, validated nodes). 1.0 default. */
  confidence: number;
  identity?: GraphIdentity;
  assertion_class?: GraphEntity["assertion_class"];
  confidence_known?: boolean;
}

export interface ExplorerEdge {
  s: string;
  t: string;
  kind: ExplorerEdgeKind;
  /** 0..1 confidence. */
  conf: number;
  id?: string;
  assertion_class?: GraphRelationship["assertion_class"];
  relation?: string;
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
  representation?: "canonical" | "legacy";
  revision?: RevisionVector;
  currency?: GraphCurrency;
  state?: ResultState;
  scope?: { rendered_nodes: number; eligible_nodes: number; canonical_entities: number; rendered_edges: number; canonical_relationships: number; omitted_nodes: number; omitted_edges: number; excluded_families: string[] };
  render_key?:string;
  canonical_state?:ResultState;
}

/* ------------------------------------------------------------------ */
/*  Builder                                                           */
/* ------------------------------------------------------------------ */

interface NodeAccum {
  type: ExplorerNodeType;
  label: string;
  degree: number;
  confidence: number;
  /** Number of tensions touching this node — feeds health. */
  tension_hits: number;
}

function pushSeedNode(
  out: Map<string, NodeAccum>,
  id: string,
  type: ExplorerNodeType,
  label: string,
): void {
  if (out.has(id)) return;
  out.set(id, { type, label, degree: 0, confidence: 1, tension_hits: 0 });
}

function pushEdge(
  edges: ExplorerEdge[],
  nodes: Map<string, NodeAccum>,
  s: string,
  t: string,
  kind: ExplorerEdgeKind,
  conf: number,
): void {
  // Skip edges whose endpoints we never registered as nodes — Phase 0
  // doesn't synthesize ghost nodes; future phases may.
  const sn = nodes.get(s);
  const tn = nodes.get(t);
  if (!sn || !tn) return;
  edges.push({ s, t, kind, conf });
  sn.degree++;
  tn.degree++;
}

function ingestLinks(
  edges: ExplorerEdge[],
  nodes: Map<string, NodeAccum>,
  source: { id: string; links?: GraphLink[] },
): void {
  if (!source.links) return;
  for (const link of source.links) {
    if (!link?.target) continue;
    pushEdge(edges, nodes, source.id, link.target, "fact", 1);
  }
}

function buildSnapshot(raw: GraphRawSnapshot): GraphSnapshot {
  const t0 = performance.now();
  const nodes = new Map<string, NodeAccum>();
  const edges: ExplorerEdge[] = [];

  // ---- Seed entities (fact graph nodes) ----
  for (const f of raw.features as Feature[]) {
    if (f?.id) pushSeedNode(nodes, f.id, "feature", f.name ?? f.id);
  }
  for (const w of raw.workflows as Workflow[]) {
    if (w?.id) pushSeedNode(nodes, w.id, "workflow", w.name ?? w.id);
  }
  for (const d of raw.dataModel as DataModelEntity[]) {
    if (d?.id) pushSeedNode(nodes, d.id, "data_model", d.name ?? d.id);
  }
  for (const c of raw.capabilities as CapabilityEntity[]) {
    if (c?.id) pushSeedNode(nodes, c.id, "capability", c.name ?? c.id);
  }
  for (const ds of (raw.datastores ?? []) as Datastore[]) {
    if (ds?.id) pushSeedNode(nodes, ds.id, "datastore", ds.name ?? ds.id);
  }
  // Auxiliary scanner entities (tests, configuration, scripts, MCP tools)
  // share the Explorer's capability presentation while retaining their full
  // record and semantic links in the backing graph.
  for (const auxiliary of (raw.auxiliary ?? []) as AuxiliaryEntity[]) {
    if (auxiliary?.id) pushSeedNode(nodes, auxiliary.id, "capability", auxiliary.name ?? auxiliary.id);
  }

  // ---- UI registry nodes (only entries with source_repo provenance) ----
  // Indexable UI elements are first-class graph citizens (per ui-index gate).
  // They are seeded BEFORE fact-edge ingestion so `used_by` / `children` /
  // `flows` edges from features and workflows can land on them, and so the
  // UI element's own outgoing edges can resolve their endpoints.
  for (const ui of raw.uiElements ?? []) {
    if (ui?.id) pushSeedNode(nodes, ui.id, "ui_element", ui.name ?? ui.id);
  }

  // ---- Dream nodes (speculative; lower default health) ----
  for (const dn of raw.dreamGraph.nodes ?? []) {
    if (!dn?.id) continue;
    if (!nodes.has(dn.id)) {
      nodes.set(dn.id, {
        type: "dream_node",
        label: dn.name ?? dn.id,
        degree: 0,
        confidence: typeof dn.confidence === "number" ? dn.confidence : 0.5,
        tension_hits: 0,
      });
    }
  }

  // ---- Tension nodes (one per signal) and implicit edges ----
  for (const sig of raw.tensions.signals ?? []) {
    if (!sig?.id) continue;
    if (!nodes.has(sig.id)) {
      nodes.set(sig.id, {
        type: "tension",
        label: sig.description?.slice(0, 80) ?? sig.id,
        degree: 0,
        confidence: 1,
        tension_hits: 0,
      });
    }
    for (const ent of sig.entities ?? []) {
      const n = nodes.get(ent);
      if (n) n.tension_hits++;
      pushEdge(edges, nodes, sig.id, ent, "tension", sig.urgency ?? 0.5);
    }
  }

  // ---- Fact edges from seed `links` ----
  for (const f of raw.features as Feature[]) ingestLinks(edges, nodes, f);
  for (const w of raw.workflows as Workflow[]) ingestLinks(edges, nodes, w);
  for (const d of raw.dataModel as DataModelEntity[]) ingestLinks(edges, nodes, d);
  for (const c of raw.capabilities as CapabilityEntity[]) ingestLinks(edges, nodes, c);
  for (const ds of (raw.datastores ?? []) as Datastore[]) ingestLinks(edges, nodes, ds);
  for (const auxiliary of (raw.auxiliary ?? []) as AuxiliaryEntity[]) ingestLinks(edges, nodes, auxiliary);

  // ---- UI registry fact edges ----
  // `used_by` / `children` / `flows` are the registry's evidence-bound
  // structural references. `pushEdge` skips endpoints that were never
  // seeded, so UI nodes cannot synthesize ghost facts for unknown ids.
  for (const ui of raw.uiElements ?? []) {
    if (!ui?.id) continue;
    ingestLinks(edges, nodes, ui);
    for (const target of ui.used_by ?? []) pushEdge(edges, nodes, ui.id, target, "fact", 1);
    for (const target of ui.children ?? []) pushEdge(edges, nodes, ui.id, target, "fact", 1);
    for (const target of ui.flows ?? []) pushEdge(edges, nodes, ui.id, target, "fact", 1);
  }

  // ---- Evidence-bound `stored_in` edges ----
  // Data models are connected to datastores only when explicit metadata or links
  // resolve to a concrete datastore. Never fall back to a primary/first datastore:
  // many scanned projects have no datastore, and storage must not be inferred.
  if ((raw.datastores ?? []).length > 0) {
    const stores = (raw.datastores ?? []) as Datastore[];
    const storeById = new Map(stores.map((d) => [d.id, d]));
    const resolveStore = (storage: string | undefined): Datastore | undefined => {
      const value = storage?.trim();
      if (!value) return undefined;
      if (FORBIDDEN_PERSISTENCE_SENTINELS.includes(value.toLowerCase())) return undefined;
      const exact = storeById.get(value);
      if (exact) return exact;
      const needle = value.toLowerCase();
      return stores.find((d) => {
        const hay = `${d.id} ${d.name} ${d.kind}`.toLowerCase();
        return hay.includes(needle) || needle.includes(d.kind);
      });
    };
    for (const dm of raw.dataModel as DataModelEntity[]) {
      if (!dm?.id) continue;
      const alreadyLinked = (dm.links ?? []).some(
        (l) => l.relationship === "stored_in" || storeById.has(l.target),
      );
      if (alreadyLinked) continue;
      const target = resolveStore(dm.storage);
      if (!target) continue;
      pushEdge(edges, nodes, dm.id, target.id, "fact", 1);
    }
  }

  // ---- Validated edges (promoted dreams) ----
  for (const e of raw.validated.edges ?? []) {
    if (!e?.from || !e?.to) continue;
    pushEdge(edges, nodes, e.from, e.to, "validated", e.confidence ?? 1);
  }

  // ---- Dream edges (still speculative) ----
  for (const e of raw.dreamGraph.edges ?? []) {
    if (!e?.from || !e?.to) continue;
    pushEdge(edges, nodes, e.from, e.to, "dream", e.confidence ?? 0.5);
  }

  // ---- Candidate edges (normalization "latent" results: dream edges that
  //      didn't pass the validation threshold yet but aren't rejected). We
  //      look up the underlying dream edge by id to recover its endpoints.
  const dreamEdgeById = new Map(
    (raw.dreamGraph.edges ?? []).map((e) => [e.id, e] as const),
  );
  for (const r of raw.candidates.results ?? []) {
    if (r?.status !== "latent" || r.dream_type !== "edge") continue;
    const de = dreamEdgeById.get(r.dream_id);
    if (!de?.from || !de?.to) continue;
    pushEdge(edges, nodes, de.from, de.to, "candidate", r.confidence ?? 0.5);
  }

  // ---- Materialize nodes with derived health ----
  const outNodes: ExplorerNode[] = [];
  for (const [id, acc] of nodes) {
    // Health: 1.0 minus tension penalty, minus orphan penalty (degree=0).
    // Tension nodes are excluded from the orphan penalty — their "health"
    // isn't meaningful (the UI shows `urgency` instead).
    const tensionPenalty = 0.2 * acc.tension_hits;
    const orphanPenalty =
      acc.type !== "tension" && acc.degree === 0 ? 0.4 : 0;
    const health = Math.max(0.1, 1 - tensionPenalty - orphanPenalty);
    outNodes.push({
      id,
      type: acc.type,
      label: acc.label,
      degree: acc.degree,
      health,
      confidence: acc.confidence,
    });
  }

  const build_ms = Math.round(performance.now() - t0);

  // Serialize once to compute bytes + ETag (cheap; we send this same body)
  const scope = getActiveScope();
  const body = {
    version: SNAPSHOT_VERSION,
    nodes: outNodes,
    edges,
  };
  const serialized = JSON.stringify(body);
  const etag = `sha256:${createHash("sha256")
    .update(serialized)
    .digest("hex")
    .slice(0, 32)}`;

  const snapshot: GraphSnapshot = {
    version: SNAPSHOT_VERSION,
    etag,
    generated_at: new Date().toISOString(),
    instance_uuid: scope?.uuid ?? "legacy",
    stats: {
      node_count: outNodes.length,
      edge_count: edges.length,
      build_ms,
      bytes_uncompressed: Buffer.byteLength(serialized, "utf8"),
    },
    nodes: outNodes,
    edges,
  };

  recordSnapshotMetrics(snapshot.stats);
  return snapshot;
}

/* ------------------------------------------------------------------ */
/*  Public API                                                        */
/* ------------------------------------------------------------------ */

/** Last etag we surfaced — used to detect drift and emit snapshot.changed. */
let lastEmittedEtag: string | null = null;

export async function getGraphSnapshot(fresh = false): Promise<GraphSnapshot> {
  const { snapshot } = await getExplorerGraphView(undefined, fresh);
  if (lastEmittedEtag !== snapshot.etag) {
    const previous = lastEmittedEtag;
    lastEmittedEtag = snapshot.etag;
    // Suppress the very first emit on cold start — it's not a "change",
    // just the initial snapshot. Clients fetch it via the snapshot route.
    if (previous !== null) {
      graphEventBus.emit("snapshot.changed", {
        etag: snapshot.etag,
        payload: {
          previous_etag: previous,
          node_count: snapshot.stats.node_count,
          edge_count: snapshot.stats.edge_count,
        },
      });
    }
  }
  return snapshot;
}

/** Test seam — clear etag drift tracking so unit tests start clean. */
export function _resetSnapshotEmitterForTest(): void {
  lastEmittedEtag = null;
  resetExplorerViews();
}

/** Exposed for unit tests so they can drive the builder with fixtures. */
export function buildSnapshotForTest(raw: GraphRawSnapshot): GraphSnapshot {
  return buildSnapshot(raw);
}

/** Explicit transitional projection for same-revision compatibility audits. */
export function buildLegacyGraphSnapshot(raw: GraphRawSnapshot): GraphSnapshot {
  return { ...buildSnapshot(raw), representation: "legacy" };
}

/** Both renderers and the agent use the same typed identity and present evidence assessment. */
export function buildCanonicalExplorerSnapshot(graph: CanonicalGraphRead): GraphSnapshot {
  const started = performance.now();
  const types: Partial<Record<GraphIdentity["kind"], ExplorerNodeType>> = {
    feature:"feature", workflow:"workflow", data_model:"data_model", capability:"capability", auxiliary:"capability",
    datastore:"datastore", ui_element:"ui_element", dream_node:"dream_node", tension:"tension",
  };
  const eligible = graph.entities.filter(e => types[e.identity.kind] && e.assertion_class !== "historical").sort((a,b)=>graphIdentityKey(a.identity).localeCompare(graphIdentityKey(b.identity)));
  const nodes: ExplorerNode[] = eligible.slice(0,10000).map(entity=>({ id:graphIdentityKey(entity.identity), identity:entity.identity,
    type:types[entity.identity.kind]!, label:entity.label, degree:0, health:1, confidence:entity.confidence ?? 0.5,
    confidence_known:entity.confidence !== null, assertion_class:entity.assertion_class }));
  const byId = new Map(nodes.map(node=>[node.id,node]));
  const edges: ExplorerEdge[] = [];
  for (const relation of [...graph.relationships].sort((a,b)=>a.id.localeCompare(b.id))) {
    if (!relation.source || !relation.target) continue;
    const s=graphIdentityKey(relation.source), t=graphIdentityKey(relation.target);
    if (!byId.has(s) || !byId.has(t) || edges.length>=30000) continue;
    // Historical promotion is never enough to produce the authoritative green channel.
    const kind = relation.kind === "validated" && relation.assertion_class !== "validated_insight" ? "candidate" : relation.kind;
    edges.push({id:relation.id,s,t,kind,conf:relation.confidence ?? 0.5,assertion_class:relation.assertion_class,relation:relation.relation});
    byId.get(s)!.degree++; byId.get(t)!.degree++;
    if (kind === "tension") { byId.get(s)!.health=Math.max(0.1,byId.get(s)!.health-0.2); byId.get(t)!.health=Math.max(0.1,byId.get(t)!.health-0.2); }
  }
  for (const node of nodes) if (!node.degree && node.type !== "tension") node.health=0.6;
  const scope={rendered_nodes:nodes.length,eligible_nodes:eligible.length,canonical_entities:graph.entities.length,rendered_edges:edges.length,
    canonical_relationships:graph.relationships.length,omitted_nodes:eligible.length-nodes.length,omitted_edges:graph.relationships.length-edges.length,
    excluded_families:[...new Set(graph.entities.filter(e=>!types[e.identity.kind]||e.assertion_class==="historical").map(e=>e.identity.kind))].sort()};
  const state:ResultState={...graph.state,reasons:[...graph.state.reasons]};
  if (scope.omitted_nodes || scope.omitted_edges) { state.completeness="partial";state.reasons.push({code:"EXPLORER_RENDER_SCOPE",scope:[],detail:`${scope.omitted_nodes} eligible nodes and ${scope.omitted_edges} relationships omitted by render limits or non-rendered families; evidence/context remains available through canonical retrieval.`}); }
  const render_key=createHash("sha256").update(JSON.stringify({nodes,edges})).digest("hex");
  const body={version:CANONICAL_EXPLORER_VERSION,representation:"canonical" as const,instance_uuid:graph.instance_id,revision:graph.revision,currency:graph.currency,state,canonical_state:graph.state,render_key,scope,nodes,edges};
  const serialized=JSON.stringify(body), bytes=Buffer.byteLength(serialized,"utf8");
  if(bytes>24*1024*1024)throw new Error("EXPLORER_SNAPSHOT_BYTE_LIMIT");
  const snapshot:GraphSnapshot={...body,etag:`sha256:${createHash("sha256").update(serialized).update(JSON.stringify(graph.store_hashes)).digest("hex").slice(0,32)}`,
    generated_at:new Date().toISOString(),stats:{node_count:nodes.length,edge_count:edges.length,build_ms:Math.round(performance.now()-started),bytes_uncompressed:bytes}};
  recordSnapshotMetrics(snapshot.stats);return snapshot;
}

type ExplorerView = {graph:CanonicalGraphRead;snapshot:GraphSnapshot};
// A detail request belongs to the rendered snapshot, not whatever publication happens
// to win the race next. Keep at most three exact physical views. Age alone does
// not invalidate a displayed snapshot; eviction requires an explicit refresh.
const retainedViews = new Map<string,ExplorerView>();
const pendingViews = new Map<string,Promise<ExplorerView>>();
const MAX_RETAINED_VIEWS = 3;
export function resetExplorerViews():void { retainedViews.clear(); pendingViews.clear(); }
function retain(key:string,view:ExplorerView):ExplorerView {
  retainedViews.delete(key);retainedViews.set(key,view);
  while(retainedViews.size>MAX_RETAINED_VIEWS)retainedViews.delete(retainedViews.keys().next().value!);
  return view;
}
/** Pure, bounded as-of views. Refresh rechecks all evidence, including source files. */
export async function getExplorerGraphView(expectedEtag?:string, fresh = false):Promise<ExplorerView>{
  const directory=await fs.realpath(getDataDir()).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return resolve(getDataDir());throw error;});
  const instance=getActiveScope()?.uuid??"legacy",prefix=directory+'\0'+instance+'\0';
  if(expectedEtag){
    const pinned=retainedViews.get(prefix+expectedEtag);
    if(!pinned)throw new Error('EXPLORER_REVISION_CONFLICT');
    return pinned;
  }
  // A writer must not join a reader queued behind its own exclusive boundary.
  const existing=pendingViews.get(prefix);if(existing&&!fresh)return existing;
  const pending=(async()=>{
    const graph=await loadCanonicalGraph(instance),view={graph,snapshot:buildCanonicalExplorerSnapshot(graph)};
    return retain(prefix+view.snapshot.etag,view);
  })();
  if(!fresh)pendingViews.set(prefix,pending);
  try{return await pending;}finally{if(pendingViews.get(prefix)===pending)pendingViews.delete(prefix);}
}
