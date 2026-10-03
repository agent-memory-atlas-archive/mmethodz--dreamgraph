/** Historical observations are not source claims. Reads never initialize/repair these stores. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { dataPath } from "../utils/paths.js";
import { stripBom } from "../utils/read-json.js";
import { withGraphRead } from "../utils/graph-reconciliation-barrier.js";
import { loadPublicationState, publicationContentHash } from "../graph/publication.js";
import type { DreamHistoryEntry, TensionFile } from "./types.js";

export const TIME_POLICY = "ashoka.observed-time.v1";
export const timeDigest = (input: unknown): string => createHash("sha256").update(JSON.stringify(input)).digest("hex");
export const knownTime = (input: unknown): string | null => typeof input === "string" && z.string().datetime({ offset: true }).safeParse(input).success
  ? new Date(input).toISOString() : null;
export const TemporalObservationSchema = z.object({
  id: z.string(), tension_id: z.string(), entities: z.array(z.string()).max(256), domain: z.string().nullable(),
  event_time: z.string().datetime().nullable(), observed_at: z.string().datetime().nullable(),
  urgency: z.number().min(0).max(1), resolved: z.boolean(), origin: z.literal("derived"),
  source_digest: z.string().regex(/^[a-f0-9]{64}$/), policy: z.literal(TIME_POLICY),
  evidence_ancestry: z.array(z.string()).max(256), assertion_class: z.literal("historical"),
}).strict();
export type TemporalObservation = z.infer<typeof TemporalObservationSchema>;
export const TemporalStoreSchema = z.object({
  schema: z.literal("dreamgraph.temporal_observations.v1"), metadata: z.object({schema_version: z.literal("1.0.0")}).strict(),
  events: z.array(TemporalObservationSchema).max(10000),
}).strict();
export async function readEvidenceStore(file: string): Promise<unknown | null> {
  return withGraphRead(async () => {
    let body: string;
    try { body = await readFile(dataPath(file), "utf8"); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT" && !(await loadPublicationState()).stores[file]) return null; throw e; }
    if (Buffer.byteLength(body) > 16 * 1024 * 1024) throw new Error("EVIDENCE_STORE_CAPACITY");
    const publication = await loadPublicationState();
    if (publication.stores[file] && publication.stores[file].hash !== publicationContentHash(body)) throw new Error(`UNPUBLISHED_EVIDENCE_CHANGE:${file}`);
    return JSON.parse(stripBom(body));
  });
}
export async function loadTemporalObservations() {
  const body = await readEvidenceStore("temporal_graph.json");
  return body === null ? TemporalStoreSchema.parse({schema:"dreamgraph.temporal_observations.v1",metadata:{schema_version:"1.0.0"},events:[]}) : TemporalStoreSchema.parse(body);
}
/** Exact tension snapshots. No urgency is backfilled at first_seen and no TTL-derived time is invented. */
export function tensionObservations(tensions: TensionFile, observed_at: string | null): TemporalObservation[] {
  const events = new Map<string, TemporalObservation>();
  const add = (signal: TensionFile["signals"][number], event_time: string | null, resolved: boolean, urgency: number) => {
    const entities = [...new Set(signal.entities)].sort();
    const source_digest = timeDigest([signal.id, entities, signal.domain, event_time, resolved, urgency]);
    const event = TemporalObservationSchema.parse({id:`temporal:${source_digest}`,tension_id:signal.id,entities,domain:typeof signal.domain==="string"?signal.domain:null,
      event_time,observed_at,urgency,resolved,origin:"derived",source_digest,policy:TIME_POLICY,
      evidence_ancestry:[`tension:${signal.id}`],assertion_class:"historical"});
    events.set(event.id,event);
  };
  for (const signal of tensions.signals) if (!signal.resolved) add(signal,knownTime(signal.last_seen),false,signal.urgency);
  for (const resolution of tensions.resolved_tensions ?? []) {
    add(resolution.original,knownTime(resolution.original.last_seen),false,resolution.original.urgency);
    add(resolution.original,knownTime(resolution.resolved_at),true,0);
  }
  return [...events.values()];
}
/** Caller is the tension publication owner: both files participate in one transaction. */
export async function prepareTemporalObservations(tensions: TensionFile): Promise<{file:string;content:string}[]> {
  const current = await loadTemporalObservations(), byId = new Map(current.events.map(e=>[e.id,e]));
  for (const event of tensionObservations(tensions,new Date().toISOString())) if (!byId.has(event.id)) byId.set(event.id,event);
  const next = TemporalStoreSchema.parse({...current,events:[...byId.values()].sort((a,b)=>a.id.localeCompare(b.id))});
  return JSON.stringify(next) === JSON.stringify(current) ? [] : [{file:"temporal_graph.json",content:JSON.stringify(next)}];
}
export function chronologicalHistory(sessions: DreamHistoryEntry[]): {sessions:DreamHistoryEntry[]; reasons:string[]} {
  const byKey = new Map<string,DreamHistoryEntry>(), reasons = new Set<string>(), conflicts = new Set<string>();
  for (const session of sessions) {
    const time = knownTime(session.timestamp);
    if (time === null || !Number.isSafeInteger(session.cycle_number) || session.cycle_number < 0) { reasons.add("history_time_or_cycle_unknown"); continue; }
    const key = `${time}:${session.cycle_number}`, prior=byKey.get(key);
    if (prior && timeDigest(prior) !== timeDigest(session)) { reasons.add("conflicting_history_identity"); conflicts.add(key); byKey.delete(key); }
    if (!conflicts.has(key)) byKey.set(key,{...session,timestamp:time});
  }
  return {sessions:[...byKey.values()].sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp)||a.cycle_number-b.cycle_number),reasons:[...reasons].sort()};
}
/** Unknown/out-of-range/ambiguous time remains null. Cycle number is not wall-clock time. */
const timeIndexes = new WeakMap<DreamHistoryEntry[],{times:number[];monotonic:boolean}>();
export function cycleAtTime(time: string | null, history: DreamHistoryEntry[]): number | null {
  if (!time || !history.length) return null;
  let index=timeIndexes.get(history);
  if(!index){index={times:history.map(s=>Date.parse(s.timestamp)),monotonic:history.every((s,i)=>!i||s.cycle_number>history[i-1].cycle_number)};timeIndexes.set(history,index);}
  const ts=Date.parse(time);if(!index.monotonic||!Number.isFinite(ts)||ts<index.times[0]||ts>index.times.at(-1)!)return null;
  let lo=0,hi=history.length-1;while(lo<hi){const mid=(lo+hi+1)>>>1;if(index.times[mid]<=ts)lo=mid;else hi=mid-1;}
  if(lo>0&&index.times[lo-1]===index.times[lo]||lo+1<history.length&&index.times[lo+1]===index.times[lo])return null;
  return history[lo].cycle_number;
}
