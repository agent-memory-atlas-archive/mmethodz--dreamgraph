/** Core-owned analytics inputs and definitions. Reports never infer proof from labels or age. */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { loadCanonicalGraph, type CanonicalGraphRead } from "../graph/read-model.js";
import { graphIdentityKey } from "../graph/contracts.js";
import { loadPublicationState,publicationContentHash } from "../graph/publication.js";
import { withGraphRead } from "../utils/graph-reconciliation-barrier.js";
import { getActiveScope } from "../instance/index.js";
import { dataPath } from "../utils/paths.js";
import { stripBom } from "../utils/read-json.js";
import { readDirtyPartitions } from "../graph/change-obligations.js";
import {z} from "zod";
import {GraphEntitySchema,GraphRelationshipSchema,RevisionVectorSchema,GraphCurrencySchema,ResultStateSchema} from "../graph/contracts.js";

type Row=Record<string,unknown>;
export const ANALYTICS_DEFINITIONS={
  tension_flow:{population:"unique retained dream sessions and current unresolved risks",unit:"events",interpretation:"activity; decay is not closure"},
  tension_halflife:{population:"retained closure events with known aware UTC times",unit:"seconds",interpretation:"closure lifetime distribution, not verified-fix half-life"},
  reappearance_rate:{population:"retained closure events with stable risk identity",unit:"ratio",interpretation:"recorded reopenings; concern identity is not an entity pair"},
  domain_saturation:{population:"all seven canonical factual families",unit:"entities",interpretation:"domain population; unknown domains are explicit"},
  hub_health:{population:"typed factual entities and canonical fact relationships",unit:"entities",interpretation:"description coverage among connected entities, not correctness"},
  confidence_integrity:{population:"current canonical entities",unit:"entities",interpretation:"confidence availability and assertion classes, not truth accuracy"},
  promotion_funnel:{population:"latest typed canonical candidates and retained promotion rows",unit:"entities",interpretation:"current independently supported candidates versus historical promotion labels"},
  orphan_pressure:{population:"all seven typed factual families and canonical fact relationships",unit:"entities",interpretation:"known isolated entities and unresolved relationship endpoints"},
  model_impact:{population:"retained dream artifacts with explicit model provenance",unit:"artifacts",interpretation:"attribution only; no guessed model identity or usefulness"},
  maturity_score:{population:"canonical result state and latest typed candidates",unit:"ratio",interpretation:"evidence coverage; no composite score can erase critical defects"},
  meaningful_edges:{population:"latest typed candidate decisions",unit:"ratio",interpretation:"accepted decision rate; task meaningfulness remains unmeasured"},
  domain_entropy:{population:"known-domain factual entities; unknowns excluded and counted",unit:"bits",interpretation:"population distribution, not health or desired attention"},
  cognitive_load:{population:"current unresolved risks, unproven candidates and dirty scopes",unit:"items",interpretation:"workload, not agent confusion or understanding"},
} as const;
export type AnalyticsModule=keyof typeof ANALYTICS_DEFINITIONS;
export const ANALYTICS_DEFINITION_VERSION="2.0.0";
export const AnalyticsPayloadSchema=z.object({schema:z.literal("dreamgraph.analytics_payload.v1"),definition_version:z.literal(ANALYTICS_DEFINITION_VERSION),
  generated_at:z.string().datetime({offset:true}),instance_id:z.string().min(1),revision:RevisionVectorSchema,currency:GraphCurrencySchema,state:ResultStateSchema,
  dependency_hashes:z.record(z.string().nullable()),entities:z.array(GraphEntitySchema),relationships:z.array(GraphRelationshipSchema),
  history:z.array(z.record(z.unknown())),dream_edges:z.array(z.record(z.unknown())),resolved_tensions:z.array(z.record(z.unknown())),dirty_regions:z.array(z.record(z.unknown())),
}).strict();
export interface AnalyticsPayload {
  schema:"dreamgraph.analytics_payload.v1";
  definition_version:typeof ANALYTICS_DEFINITION_VERSION;
  generated_at:string;
  instance_id:string;
  revision:CanonicalGraphRead["revision"];
  currency:CanonicalGraphRead["currency"];
  state:CanonicalGraphRead["state"];
  dependency_hashes:Record<string,string|null>;
  entities:CanonicalGraphRead["entities"];
  relationships:CanonicalGraphRead["relationships"];
  history:Row[];
  dream_edges:Row[];
  resolved_tensions:Row[];
  dirty_regions:Row[];
}
const objects=(value:unknown):Row[]=>Array.isArray(value)?value.filter((r):r is Row=>!!r&&typeof r==="object"&&!Array.isArray(r)):[];
const count=(value:unknown)=>typeof value==="number"&&Number.isSafeInteger(value)&&value>=0?value:0;
const sum=(rows:Row[],field:string)=>rows.reduce((total,row)=>total+count(row[field]),0);
const safeTime=(value:unknown):number|null=>typeof value==="string"&&/(Z|[+-]\d\d:\d\d)$/.test(value)&&Number.isFinite(Date.parse(value))?Date.parse(value):null;
const ratio=(n:number,d:number)=>d?Math.round(n/d*1e6)/1e6:null;
export const FACT_KINDS=["feature","workflow","data_model","capability","datastore","auxiliary","ui_element"] as const;
export function measureAnalytics(module:AnalyticsModule,p:AnalyticsPayload):Row {
  const facts=p.entities.filter(e=>FACT_KINDS.some(kind=>kind===e.identity.kind));
  const candidates=p.entities.filter(e=>e.identity.kind==="candidate"&&e.payload.dream_type);
  const validated=p.entities.filter(e=>e.identity.kind==="validated");
  const active=p.entities.filter(e=>e.identity.kind==="tension"&&e.assertion_class==="tension"&&!e.payload.resolved);
  const supported=candidates.filter(e=>e.assertion_class==="validated_insight").length;
  const domains:Record<string,number>={};let unknownDomains=0;
  for(const e of facts){const domain=e.payload.domain;if(typeof domain==="string"&&domain.trim())domains[domain]=(domains[domain]??0)+1;else unknownDomains++;}
  const keys=new Set(facts.map(e=>graphIdentityKey(e.identity))),connected=new Set<string>();let dangling=0;
  for(const r of p.relationships.filter(r=>r.kind==="fact")){if(!r.source||!r.target){dangling++;continue;}
    const a=graphIdentityKey(r.source),b=graphIdentityKey(r.target);if(keys.has(a)&&keys.has(b)){connected.add(a);connected.add(b);}}
  const classes:Record<string,number>={};for(const e of p.entities)classes[e.assertion_class]=(classes[e.assertion_class]??0)+1;
  const knownDomains=facts.length-unknownDomains;
  switch(module){
    case "tension_flow":return {sessions:p.history.length,created:sum(p.history,"tension_signals_created"),closed:sum(p.history,"tension_signals_resolved"),expired:sum(p.history,"tensions_expired"),decayed:sum(p.history,"tensions_decayed"),net_change:sum(p.history,"tension_signals_created")-sum(p.history,"tension_signals_resolved")-sum(p.history,"tensions_expired"),active_now:active.length,initial_active:null};
    case "tension_halflife":{const lifetimes:number[]=[];let unknown=0;const dispositions:Record<string,number>={};for(const r of p.resolved_tensions){const a=safeTime((r.original as Row|undefined)?.first_seen),b=safeTime(r.resolved_at);const state=String(r.resolution_state??"unknown");dispositions[state]=(dispositions[state]??0)+1;if(a===null||b===null||b<a)unknown++;else lifetimes.push((b-a)/1000);}lifetimes.sort((a,b)=>a-b);return {closures:p.resolved_tensions.length,known_lifetimes:lifetimes.length,unknown_lifetimes:unknown,median_seconds:lifetimes.length?(lifetimes[Math.floor((lifetimes.length-1)/2)]+lifetimes[Math.floor(lifetimes.length/2)])/2:null,dispositions};}
    case "reappearance_rate":{const known=p.resolved_tensions.filter(r=>typeof r.tension_id==="string"&&r.tension_id);const reopened=known.filter(r=>safeTime(r.reopened_at)!==null).length;return {closure_events:known.length,unknown_identity:p.resolved_tensions.length-known.length,reopened_events:reopened,reappearance_ratio:ratio(reopened,known.length)};}
    case "domain_saturation":return {facts:facts.length,known_domains:knownDomains,unknown_domains:unknownDomains,by_domain:domains,by_kind:Object.fromEntries(FACT_KINDS.map(k=>[k,facts.filter(e=>e.identity.kind===k).length]))};
    case "hub_health":{const described=facts.filter(e=>connected.has(graphIdentityKey(e.identity))&&typeof e.payload.description==="string"&&e.payload.description.trim().length>=60).length;return {facts:facts.length,connected:connected.size,substantively_described:described,description_coverage:ratio(described,connected.size)};}
    case "confidence_integrity":return {entities:p.entities.length,known_confidence:p.entities.filter(e=>e.confidence!==null).length,unknown_confidence:p.entities.filter(e=>e.confidence===null).length,assertion_classes:classes};
    case "promotion_funnel":return {latest_candidates:candidates.length,current_supported:supported,retained_promotions:validated.length,current_supported_promotions:validated.filter(e=>e.assertion_class==="validated_insight").length,human_assertions:validated.filter(e=>e.assertion_class==="human_assertion").length,support_ratio:ratio(supported,candidates.length)};
    case "orphan_pressure":return {facts:facts.length,connected:connected.size,isolated:facts.length-connected.size,unresolved_endpoints:dangling,orphan_ratio:ratio(facts.length-connected.size,facts.length)};
    case "model_impact":{const artifacts=[...p.entities.filter(e=>e.identity.kind==="dream_node").map(e=>e.payload),...p.dream_edges];const models:Record<string,number>={};let unknown=0;for(const row of artifacts){const provenance=(row.model_provenance??(row.meta as Row|undefined)?.model_provenance) as Row|undefined;const model=provenance?.reported_model??provenance?.requested_model;if(!provenance||typeof model!=="string"||typeof provenance.provider!=="string"){unknown++;continue;}const key=JSON.stringify([provenance.provider,model,provenance.adapter??null]);models[key]=(models[key]??0)+1;}return {artifacts:artifacts.length,known_provenance:artifacts.length-unknown,unknown_provenance:unknown,by_model:models,task_usefulness:null};}
    case "maturity_score":return {availability:p.state.availability,completeness:p.state.completeness,freshness:p.state.freshness,defect_count:p.state.reasons.length,latest_candidates:candidates.length,current_supported:supported,evidence_coverage:ratio(supported,candidates.length),project_maturity:null};
    case "meaningful_edges":{const accepted=candidates.filter(e=>e.payload.status==="validated").length,rejected=candidates.filter(e=>e.payload.status==="rejected").length;return {accepted_decisions:accepted,rejected_decisions:rejected,decided:accepted+rejected,accepted_decision_ratio:ratio(accepted,accepted+rejected),current_supported:supported,task_meaningfulness:null};}
    case "domain_entropy":{const h=knownDomains?Object.values(domains).reduce((h,n)=>h-(n/knownDomains)*Math.log2(n/knownDomains),0):null;return {known_entities:knownDomains,unknown_domains:unknownDomains,distinct_domains:Object.keys(domains).length,entropy_bits:h===null?null:Math.round(h*1e6)/1e6,normalized_entropy:h===null?null:Object.keys(domains).length<=1?0:Math.round(h/Math.log2(Object.keys(domains).length)*1e6)/1e6,population_state:!facts.length?"empty":!knownDomains?"unknown":Object.keys(domains).length===1?"concentrated":"distributed"};}
    case "cognitive_load":return {open_risks:active.length,unproven_candidates:candidates.length-supported,dirty_regions:p.dirty_regions.filter(r=>r.state!=="settled").length,required_reconciliation_regions:p.dirty_regions.filter(r=>Array.isArray(r.pending_stages)&&r.pending_stages.includes("reconciliation")).length,agent_understanding:null};
  }
}
/** Persist/transport the exact payload string: consumers verify bytes, not reserialized JSON. */
export async function captureAnalyticsSnapshot(){return withGraphRead(async()=>{
  const graph=await loadCanonicalGraph(getActiveScope()?.uuid??process.env.DREAMGRAPH_INSTANCE_UUID??"legacy"),publication=await loadPublicationState();
  const dependencies={...graph.store_hashes};
  async function store(file:string,fields:string[]):Promise<Row[]> {try{const body=await readFile(dataPath(file),"utf8");dependencies[file]=publicationContentHash(body);
    if(publication.stores[file]&&publication.stores[file].hash!==dependencies[file])throw new Error(`ANALYTICS_UNPUBLISHED_INPUT:${file}`);
    const doc=JSON.parse(stripBom(body));const arrays=fields.map(k=>doc?.[k]).filter(Array.isArray);if(arrays.length!==fields.length)throw new Error(`ANALYTICS_INVALID_INPUT:${file}`);
    if(arrays.some(rows=>rows.some((r:unknown)=>!r||typeof r!=="object"||Array.isArray(r))))throw new Error(`ANALYTICS_INVALID_ROWS:${file}`);return arrays.flat();
  }catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT"||publication.stores[file])throw error;dependencies[file]=null;return [];}}
  const history=await store("dream_history.json",["sessions"]),dream_edges=await store("dream_graph.json",["edges"]),resolved_tensions=await store("tension_log.json",["resolved_tensions"]);
  const uniqueHistory=new Map<string,Row>();for(const row of history){const key=typeof row.session_id==="string"?row.session_id:JSON.stringify([row.cycle_number,row.timestamp]);const prior=uniqueHistory.get(key);if(prior&&JSON.stringify(prior)!==JSON.stringify(row))throw new Error("ANALYTICS_CONFLICTING_SESSION");uniqueHistory.set(key,row);}
  const payload:AnalyticsPayload={schema:"dreamgraph.analytics_payload.v1",definition_version:ANALYTICS_DEFINITION_VERSION,generated_at:new Date().toISOString(),instance_id:graph.instance_id,revision:graph.revision,currency:graph.currency,state:graph.state,dependency_hashes:dependencies,entities:graph.entities,relationships:graph.relationships,history:[...uniqueHistory.values()],dream_edges,resolved_tensions,dirty_regions:(await readDirtyPartitions()).partitions};
  const body=JSON.stringify(AnalyticsPayloadSchema.parse(payload));if(Buffer.byteLength(body)>32*1024*1024)throw new Error("ANALYTICS_SNAPSHOT_CAPACITY");
  return {schema:"dreamgraph.analytics_export.v1" as const,derived:true as const,assertion_class:"historical" as const,payload_json:body,payload_sha256:createHash("sha256").update(body).digest("hex"),definitions:ANALYTICS_DEFINITIONS};
});}
