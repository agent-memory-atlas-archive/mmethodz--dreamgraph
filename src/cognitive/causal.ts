/** Temporal correlation hypotheses. No intervention experiment or causal certainty is implied. */
import { z } from "zod";
import { engine } from "./engine.js";
import { withGraphRead } from "../utils/graph-reconciliation-barrier.js";
import { chronologicalHistory, cycleAtTime, knownTime, readEvidenceStore, timeDigest, TIME_POLICY } from "./temporal-evidence.js";
import type { CausalLink, CausalChain, CausalInsights, DreamEdge, DreamHistoryEntry, TensionFile } from "./types.js";
import { DEFAULT_DECAY } from "./types.js";

export interface TensionEvent { id:string; tension_id:string; entity:string; cycle:number; timestamp_iso:string; }
/** Distinct tension onset, not repeated wrapper/import/occurrence counts. Missing timestamps are excluded. */
export function tensionTimeline(tensions:TensionFile,sessions:DreamHistoryEntry[]) {
  const history=chronologicalHistory(sessions), reasons=new Set(history.reasons),events=new Map<string,TensionEvent>();
  const all=[...tensions.signals,...(tensions.resolved_tensions??[]).map(r=>r.original)];
  const identities=new Map<string,string>();
  for(const signal of all.sort((a,b)=>a.id.localeCompare(b.id)||timeDigest(a).localeCompare(timeDigest(b)))) {
    const onset=knownTime(signal.first_seen),identity=timeDigest([onset,[...new Set(signal.entities)].sort()]);
    const prior=identities.get(signal.id);if(prior&&prior!==identity){reasons.add("conflicting_tension_onset:"+signal.id);continue;}identities.set(signal.id,identity);
    const cycle=cycleAtTime(onset,history.sessions);
    if(onset===null||cycle===null){reasons.add("onset_cycle_unknown:"+signal.id);continue;}
    for(const entity of [...new Set(signal.entities)].sort()) {
      const id="onset:"+timeDigest([signal.id,onset,entity]);
      events.set(id,{id,tension_id:signal.id,entity,cycle,timestamp_iso:onset});
    }
  }
  for(const id of identities.keys())if(reasons.has("conflicting_tension_onset:"+id))for(const [key,event]of events)if(event.tension_id===id)events.delete(key);
  return {events:[...events.values()].sort((a,b)=>Date.parse(a.timestamp_iso)-Date.parse(b.timestamp_iso)||a.id.localeCompare(b.id)),reasons:[...reasons].sort()};
}
export function correlationLinks(events:TensionEvent[],maxLag=5):CausalLink[] {
  const ordered=[...new Map(events.map(e=>[e.id,e])).values()].sort((a,b)=>Date.parse(a.timestamp_iso)-Date.parse(b.timestamp_iso)||a.id.localeCompare(b.id));
  if(ordered.length>1024)throw new Error("CAUSAL_HISTORY_BOUND_EXCEEDED");
  const byEntity=new Map<string,TensionEvent[]>();for(const e of ordered){const rows=byEntity.get(e.entity)??[];rows.push(e);byEntity.set(e.entity,rows);}
  const entities=[...byEntity.keys()].sort(),links:CausalLink[]=[];
  for(const cause_entity of entities)for(const effect_entity of entities){
    if(cause_entity===effect_entity)continue;
    const causes=byEntity.get(cause_entity)!,effects=byEntity.get(effect_entity)!,used=new Set<string>();
    const pairs:Array<[TensionEvent,TensionEvent]>=[];
    for(const cause of causes){const effect=effects.find(effect=>!used.has(effect.id)&&effect.tension_id!==cause.tension_id
      &&Date.parse(effect.timestamp_iso)>Date.parse(cause.timestamp_iso)&&effect.cycle-cause.cycle>0&&effect.cycle-cause.cycle<=maxLag);
      if(effect){used.add(effect.id);pairs.push([cause,effect]);}}
    if(pairs.length<2)continue;
    const strength=Math.round(pairs.length/Math.max(causes.length,effects.length)*100)/100;if(strength<0.3)continue;
    const parents=[...new Set(pairs.flatMap(p=>p.map(e=>e.id)))].sort();
    links.push({id:"correlation:"+timeDigest([cause_entity,effect_entity,parents,TIME_POLICY]),cause_entity,effect_entity,
      lag_cycles:Math.round(pairs.reduce((sum,[a,b])=>sum+b.cycle-a.cycle,0)/pairs.length*10)/10,
      correlation_strength:strength,observed_count:pairs.length,first_observed:pairs[0][0].timestamp_iso,last_observed:pairs.at(-1)![1].timestamp_iso,
      description:'Tension onsets in "'+cause_entity+'" precede onsets in "'+effect_entity+'" in '+pairs.length+' distinct matched pairs. Temporal correlation; common causes and other confounders have not been excluded.',
      assertion_class:"hypothesis",evidence_ancestry:parents,policy:TIME_POLICY});
  }
  return links.sort((a,b)=>b.correlation_strength-a.correlation_strength||a.id!.localeCompare(b.id!));
}
export function correlationChains(links:CausalLink[],maxDepth=4):CausalChain[]{
  const chains:CausalChain[]=[],bySource=new Map<string,CausalLink[]>();
  for(const link of links){const list=bySource.get(link.cause_entity)??[];list.push(link);bySource.set(link.cause_entity,list);}
  for(const root of links){const queue:CausalLink[][]=[[root]];
    while(queue.length&&chains.length<256){const path=queue.shift()!,terminal=path.at(-1)!.effect_entity;
      if(path.length>=2){const parents=[...new Set(path.flatMap(l=>l.evidence_ancestry??[]))].sort();chains.push({
        id:"causal_chain_"+timeDigest(path.map(l=>l.id)),links:path,total_strength:Math.round(path.reduce((s,l)=>s*l.correlation_strength,1)*100)/100,
        root_cause:path[0].cause_entity,terminal_effect:terminal,discovered_at:path.map(l=>l.last_observed).sort().at(-1)!,
        assertion_class:"hypothesis",evidence_ancestry:parents});}
      if(path.length>=maxDepth)continue;
      const visited=new Set([path[0].cause_entity,...path.map(l=>l.effect_entity)]);
      for(const next of bySource.get(terminal)??[])if(!visited.has(next.effect_entity)&&queue.length<256)queue.push([...path,next]);
    }
  }
  return [...new Map(chains.map(c=>[c.id,c])).values()].sort((a,b)=>b.total_strength-a.total_strength||a.id.localeCompare(b.id)).slice(0,20);
}
export function causalityFromSnapshot(tensions:TensionFile,sessions:DreamHistoryEntry[]):CausalInsights {
  const timeline=tensionTimeline(tensions,sessions),reasons=[...timeline.reasons];
  const events=timeline.events.slice(0,1024);if(timeline.events.length>1024)reasons.push("causal_history_truncated:1024");
  const links=correlationLinks(events),chains=correlationChains(links);
  const entities=[...new Set(links.map(l=>l.cause_entity))];
  const propagation_hotspots=entities.map(entity=>{const rows=links.filter(l=>l.cause_entity===entity);return {entity,downstream_count:rows.length,
    avg_lag:Math.round(rows.reduce((s,l)=>s+l.lag_cycles,0)/rows.length*10)/10};}).sort((a,b)=>b.downstream_count-a.downstream_count||a.entity.localeCompare(b.entity)).slice(0,10);
  return {chains,propagation_hotspots,predicted_impacts:propagation_hotspots.map(h=>{const rows=links.filter(l=>l.cause_entity===h.entity);return {
    if_changed:h.entity,likely_affected:rows.map(l=>l.effect_entity),confidence:Math.round(rows.reduce((s,l)=>s+l.correlation_strength,0)/rows.length*100)/100};}),
    links,observations:events,assertion_class:"hypothesis",policy:TIME_POLICY,input_fingerprint:timeDigest(events),reasons,
    limitations:["Observed tension-onset correlation is not evidence that changing an entity causes failure. No intervention or confounder control was performed.","Cycle numbers are an observed sequence, not elapsed wall-clock time."]};
}
export async function analyzeCausality():Promise<CausalInsights>{
  return withGraphRead(async()=>causalityFromSnapshot(await engine.loadTensions(),(await engine.loadDreamHistory()).sessions));
}
const CausalStoreSchema=z.object({schema:z.literal("dreamgraph.correlation_hypotheses.v1"),metadata:z.object({schema_version:z.literal("1.0.0")}).strict(),
  input_fingerprint:z.string(),hypotheses:z.array(z.object({id:z.string(),cause_entity:z.string(),effect_entity:z.string(),
    lag_cycles:z.number(),correlation_strength:z.number().min(0).max(1),observed_count:z.number().int().min(2),first_observed:z.string().datetime(),last_observed:z.string().datetime(),
    description:z.string(),assertion_class:z.literal("hypothesis"),evidence_ancestry:z.array(z.string()),policy:z.literal(TIME_POLICY),
    observed_at:z.string().datetime(),event_time:z.string().datetime(),origin:z.literal("derived"),applicability:z.enum(["current","superseded"]),superseded_at:z.string().datetime().nullable()}).strict()).max(10000),
  observations:z.array(z.object({id:z.string(),tension_id:z.string(),entity:z.string(),cycle:z.number().int().nonnegative(),timestamp_iso:z.string().datetime(),observed_at:z.string().datetime()}).strict()).max(10000),
  reasons:z.array(z.string())}).strict();
/** Deterministic hypotheses published with the tension owner. No writes on get_* calls. */
export async function prepareCausalHypotheses(tensions:TensionFile,sessions:DreamHistoryEntry[]):Promise<{file:string;content:string}[]> {
  const result=causalityFromSnapshot(tensions,sessions),body=await readEvidenceStore("causal_graph.json");
  const current=body===null?null:CausalStoreSchema.parse(body);
  if(current&&current.input_fingerprint===result.input_fingerprint&&JSON.stringify(current.reasons)===JSON.stringify(result.reasons))return [];
  const old=new Map(current?.hypotheses.map(h=>[h.id,h]));
  const at=new Date().toISOString(),active=new Set(result.links!.slice(0,1024).map(l=>l.id));
  const observations=new Map(current?.observations.map(e=>[e.id,e]));
  for(const e of result.observations!)if(!observations.has(e.id))observations.set(e.id,{...e,observed_at:at});
  const hypotheses=[...result.links!.slice(0,1024).map(l=>({...l,observed_at:old.get(l.id!)?.observed_at??at,event_time:l.last_observed,origin:"derived",applicability:"current",superseded_at:null})),
    ...(current?.hypotheses??[]).filter(h=>!active.has(h.id)).map(h=>({...h,applicability:"superseded",superseded_at:h.superseded_at??at}))].sort((a,b)=>a.id!.localeCompare(b.id!));
  const next=CausalStoreSchema.parse({schema:"dreamgraph.correlation_hypotheses.v1",metadata:{schema_version:"1.0.0"},input_fingerprint:result.input_fingerprint,
    hypotheses,observations:[...observations.values()].sort((a,b)=>a.id.localeCompare(b.id)),reasons:result.reasons});
  return [{file:"causal_graph.json",content:JSON.stringify(next)}];
}
export async function causalReplayDream(cycle:number,max:number):Promise<DreamEdge[]>{
  engine.assertState("rem","causalReplayDream");
  const insights=await analyzeCausality();
  return insights.links!.slice(0,max).map(link=>({id:"dream_causal_"+timeDigest([link.id,cycle]),from:link.cause_entity,to:link.effect_entity,type:"hypothetical",
    relation:"temporal_correlation",reason:link.description,confidence:Math.round(link.correlation_strength*0.8*100)/100,origin:"rem",created_at:link.last_observed,
    dream_cycle:cycle,strategy:"causal_replay",meta:{causal_lag:link.lag_cycles,observed_count:link.observed_count,correlation_strength:link.correlation_strength,
      assertion_class:"hypothesis",evidence_ancestry:link.evidence_ancestry,causal_proof:false},ttl:DEFAULT_DECAY.ttl+2,decay_rate:DEFAULT_DECAY.decay_rate,
    reinforcement_count:0,last_reinforced_cycle:cycle,status:"candidate",activation_score:0,plausibility:0,evidence_score:0,contradiction_score:0}));
}
