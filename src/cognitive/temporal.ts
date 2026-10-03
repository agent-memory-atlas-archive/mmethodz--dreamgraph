/** Event time and observation time are distinct. Predictions remain advisory, with no fabricated urgency history. */
import { engine } from "./engine.js";
import { withGraphRead } from "../utils/graph-reconciliation-barrier.js";
import { chronologicalHistory, cycleAtTime, loadTemporalObservations, tensionObservations, timeDigest, TIME_POLICY } from "./temporal-evidence.js";
import type { TemporalInsights, TensionFile, DreamHistoryEntry, TensionTrajectory } from "./types.js";

export function temporalFromSnapshot(tensions:TensionFile,sessions:DreamHistoryEntry[],
  observations:Awaited<ReturnType<typeof loadTemporalObservations>>["events"]):TemporalInsights {
  const history=chronologicalHistory(sessions),reasons=new Set(history.reasons);
  const byId=new Map(observations.map(e=>[e.id,e]));
  // Legacy snapshots only expose current urgency at last_seen; no invented first_seen urgency.
  for(const e of tensionObservations(tensions,null))if(!byId.has(e.id))byId.set(e.id,e);
  const trajectories:TensionTrajectory[]=[];
  const byTension=new Map<string,typeof observations>();
  for(const event of byId.values()){const rows=byTension.get(event.tension_id)??[];rows.push(event);byTension.set(event.tension_id,rows);}
  const ids=[...new Set([...tensions.signals.map(s=>s.id),...(tensions.resolved_tensions??[]).map(r=>r.tension_id)])].sort();
  for(const id of ids) {
    const entries=(byTension.get(id)??[]).sort((a,b)=>(a.event_time??"").localeCompare(b.event_time??"")||a.id.localeCompare(b.id));
    const points:TensionTrajectory["urgency_over_time"]=[];
    for(const entry of entries) {
      const cycle=cycleAtTime(entry.event_time,history.sessions);
      if(cycle===null){reasons.add("observation_cycle_unknown:"+entry.id);continue;}
      // Different readings at the exact same event time are conflicting observations, not a slope.
      if(entries.some(e=>e.event_time===entry.event_time&&e.urgency!==entry.urgency&&e.resolved===entry.resolved)){
        reasons.add("conflicting_observation_time:"+id);continue;
      }
      points.push({cycle,urgency:entry.urgency,event_time:entry.event_time!,observed_at:entry.observed_at});
    }
    const resolution=(tensions.resolved_tensions??[]).filter(r=>r.tension_id===id).sort((a,b)=>a.resolved_at.localeCompare(b.resolved_at)).at(-1);
    const signal=tensions.signals.find(s=>s.id===id)??resolution?.original;if(!signal)continue;
    const delta=points.length>1?points.at(-1)!.urgency-points[0].urgency:0;
    const pattern=resolution&&!tensions.signals.some(s=>s.id===id&&!s.resolved)?"resolved":delta>0.15?"rising":delta< -0.15?"falling":"stable";
    trajectories.push({tension_id:id,domain:signal.domain??null,urgency_over_time:points,peak_urgency:Math.max(signal.urgency,...points.map(p=>p.urgency)),pattern,
      ...(resolution?{resolution_cycle:cycleAtTime(resolution.resolved_at,history.sessions)??undefined}:{})});
  }
  const predictions:TemporalInsights["predictions"]=[];
  for(const trajectory of trajectories.filter(t=>t.pattern==="rising")){
    const first=trajectory.urgency_over_time[0],last=trajectory.urgency_over_time.at(-1)!;
    const elapsed=last.cycle-first.cycle;if(elapsed<=0){reasons.add("nonmonotonic_cycle_sequence:"+trajectory.tension_id);continue;}
    const rate=(last.urgency-first.urgency)/elapsed;
    const signal=tensions.signals.find(s=>s.id===trajectory.tension_id);if(!signal)continue;
    for(const entity of [...new Set(signal.entities)].sort())predictions.push({entity_id:entity,predicted_tension_type:signal.type,confidence:Math.min(rate*5,0.9),
      estimated_cycles_to_critical:Math.ceil(Math.max(0,0.8-last.urgency)/rate),
      basis:"Advisory extrapolation of "+trajectory.tension_id+" from recorded readings over "+elapsed+" observed cycles. This is not a calibrated probability or causal proof."});
  }
  return {trajectories:trajectories.slice(0,20),predictions:predictions.sort((a,b)=>b.confidence-a.confidence||a.entity_id.localeCompare(b.entity_id)).slice(0,15),
    seasonal_patterns:[],retrocognition:[],time_horizon:{total_cycles_analyzed:history.sessions.length,oldest_data:history.sessions[0]?.timestamp??null,newest_data:history.sessions.at(-1)?.timestamp??null},
    policy:TIME_POLICY,input_fingerprint:timeDigest([history.sessions,[...byId.keys()].sort()]),reasons:[...reasons].sort(),
    limitations:["Only recorded urgency readings are used. Missing history and event time remain unknown.",
      "Seasonality and trajectory-matched past resolutions lack qualified data and are unavailable.",
      ...(trajectories.length>20?["trajectory_output_truncated:20"]:[])]};
}
export async function analyzeTemporalPatterns():Promise<TemporalInsights>{
  return withGraphRead(async()=>temporalFromSnapshot(await engine.loadTensions(),(await engine.loadDreamHistory()).sessions,(await loadTemporalObservations()).events));
}
