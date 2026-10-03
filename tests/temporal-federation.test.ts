import { afterEach,beforeEach,expect,it,vi } from "vitest";
import { mkdtemp,readFile,rm,writeFile,access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setDataDirOverride,getDataDir } from "../src/utils/paths.js";
import { releaseGraphWriter } from "../src/graph/writer-lease.js";
import { commitGraphWrites,loadPublicationState } from "../src/graph/publication.js";
import { loadCanonicalGraph } from "../src/graph/read-model.js";
import { readDirtyPartitions,prepareEvidenceGeneration } from "../src/graph/change-obligations.js";
import { withGraphReconciliation } from "../src/utils/graph-reconciliation-barrier.js";
import { engine } from "../src/cognitive/engine.js";
import { temporalFromSnapshot,analyzeTemporalPatterns } from "../src/cognitive/temporal.js";
import { causalityFromSnapshot,causalReplayDream,tensionTimeline } from "../src/cognitive/causal.js";
import { cycleAtTime,chronologicalHistory,loadTemporalObservations,timeDigest,tensionObservations } from "../src/cognitive/temporal-evidence.js";
import { importArchetypes,getArchetypes,manifestDigest,parseExchange,FEDERATION_POLICY } from "../src/cognitive/federation.js";
import { assessClaimEvidence,loadClaimEvidence } from "../src/cognitive/normalization-evidence.js";
import {validateEngineEnvValues,engineSetting} from "../src/config/engine-setting-catalogue.js";
import type { DreamHistoryEntry,TensionFile,TensionSignal } from "../src/cognitive/types.js";

let root:string,old:string;
const at=(cycle:number)=>new Date(Date.UTC(2026,0,1,0,cycle)).toISOString();
const histories=()=>Array.from({length:10},(_,i)=>({timestamp:at(i+1),cycle_number:i+1}) as DreamHistoryEntry);
const signal=(id:string,entity:string,cycle:number):TensionSignal=>({id,entities:[entity],type:"missing_link",domain:"general",description:"Observed gap",occurrences:1,
  urgency:0.4,first_seen:at(cycle),last_seen:at(cycle),attempted:false,resolved:false,ttl:20});
async function tensions(...signals:TensionSignal[]):Promise<TensionFile>{return {...await engine.loadTensions(),signals};}
beforeEach(async()=>{old=getDataDir();root=await mkdtemp(join(tmpdir(),"dg-time-federation-"));setDataDirOverride(root);vi.stubEnv("DREAMGRAPH_FEDERATION",JSON.stringify({instance_id:"local"}));});
afterEach(async()=>{if(engine.getState()==="rem")engine.enterNormalizing();if(engine.getState()==="normalizing")engine.wake();vi.restoreAllMocks();vi.unstubAllEnvs();await releaseGraphWriter(root);setDataDirOverride(old);await rm(root,{recursive:true,force:true});});
const origin="dg:"+"a".repeat(64),claim_id="b".repeat(64);
function exchange(description="Remote assertion; not a local proof."){
  const row={id:"foreign:"+origin+":"+claim_id,pattern_type:"structural_gap",description,entity_roles:["api_endpoint","data_entity"],relation_pattern:"structural_gap",
    confidence:0.9,source_instance:origin,times_validated:1,created_at:at(1),origin:{namespace:origin,claim_id,source_digest:"c".repeat(64),evidence_digest:"d".repeat(64),
      policy:FEDERATION_POLICY,event_time:at(1),ancestry:["d".repeat(64)],validation:"foreign_claim"},local_validation:"unreviewed",assertion_class:"hypothesis"};
  return {metadata:{description:"Redacted architectural hypotheses; local validation is required.",schema_version:"2.0.0",source_instance:origin,exported_at:at(2),
    total_archetypes:1,manifest_digest:manifestDigest([row as any]),redaction:"fixed-role-vocabulary.v1",policy:FEDERATION_POLICY},archetypes:[row]};
}
async function incoming(body=JSON.stringify(exchange())){const file=join(root,"incoming.json");await writeFile(file,body);return file;}
it("read-only empty analysis leaves times unknown and creates no evidence files",async()=>{
  const result=await analyzeTemporalPatterns();expect(result.time_horizon).toEqual({total_cycles_analyzed:0,oldest_data:null,newest_data:null});
  await expect(access(join(root,"temporal_graph.json"))).rejects.toThrow();expect((await loadPublicationState()).revision.publication_sequence).toBe(0);
});
it("out-of-order and repeated history/onsets produce identical correlations, IDs and support",async()=>{
  const data=await tensions(signal("a1","a",1),signal("b1","b",2),signal("c1","c",3),signal("a2","a",5),signal("b2","b",6),signal("c2","c",7));
  const first=causalityFromSnapshot(data,histories()),duplicate={...data,signals:[...data.signals.slice().reverse(),...data.signals]};
  expect(causalityFromSnapshot(duplicate,histories().reverse().concat(histories()))).toEqual(first);
  expect(first.links!.find(l=>l.cause_entity==="a"&&l.effect_entity==="b")?.observed_count).toBe(2);
  expect(first.chains[0].assertion_class).toBe("hypothesis");expect(first.links![0].description).toContain("confounders");
});
it("one cause with many later effects cannot fabricate two independent matched observations",async()=>{
  const data=await tensions(signal("a1","a",1),signal("b1","b",2),signal("b2","b",3));
  expect(causalityFromSnapshot(data,histories()).links).toEqual([]);
});
it("shared underlying tension, malformed/out-of-range time and conflicting IDs cannot be causal support",async()=>{
  const shared={...signal("shared","a",1),entities:["a","b"]};
  const bad={...signal("bad","a",2),first_seen:"not-time"};
  const data=await tensions(shared,bad,signal("conflict","c",2),signal("conflict","d",4),signal("outside","b",20));
  const result=tensionTimeline(data,histories());expect(result.events.every(e=>e.tension_id==="shared")).toBe(true);
  expect(result.reasons).toEqual(expect.arrayContaining(["onset_cycle_unknown:bad","onset_cycle_unknown:outside","conflicting_tension_onset:conflict"]));
  expect(cycleAtTime(null,histories())).toBeNull();expect(cycleAtTime(at(0),histories())).toBeNull();
});
it("duplicate snapshots do not invent urgency at first_seen, and elapsed observed cycles determine slopes",async()=>{
  const s=signal("t","a",1);s.last_seen=at(5);const data=await tensions(s);
  const first=tensionObservations(data,at(7));expect(first).toHaveLength(1);expect(first[0].event_time).toBe(at(5));
  const result=temporalFromSnapshot(data,histories(),first);expect(result.trajectories[0].urgency_over_time).toHaveLength(1);expect(result.predictions).toEqual([]);
  const prior=tensionObservations(await tensions({...s,last_seen:at(1),urgency:0.1}),at(2));
  const slope=temporalFromSnapshot(data,histories(),[...first,...prior]);expect(slope.predictions[0].estimated_cycles_to_critical).toBe(6);
  expect(temporalFromSnapshot({...data,signals:data.signals.slice().reverse()},histories().reverse().concat(histories()),[...prior,...first])).toEqual(slope);
});
it("tension publication commits readings and hypotheses together; exact readings do not multiply on resave",async()=>{
  await commitGraphWrites({actor:"fixture",writes:[{file:"features.json",content:JSON.stringify({features:["a","b"].map(id=>({id,name:id,source_repo:"fixture",source_files:[id+".ts"]}))})},
    {file:"dream_history.json",content:JSON.stringify({metadata:{schema_version:"1.0.0"},sessions:histories()})}]});
  const data=await tensions(signal("a1","a",1),signal("b1","b",2),signal("a2","a",5),signal("b2","b",6));
  await engine.saveTensions(data);const before=await readFile(join(root,"temporal_graph.json"),"utf8");
  const pub=await loadPublicationState();expect(pub.stores).toHaveProperty("causal_graph.json");expect(pub.stores).toHaveProperty("temporal_graph.json");
  const partition=(await readDirtyPartitions()).partitions.find(p=>p.id==="evidence:temporal:tension_observations")!;
  expect(partition.scope).toEqual(expect.arrayContaining(["legacy/feature/fixture/a","legacy/feature/fixture/b"]));expect(partition.pending_stages).toEqual(["digestion"]);
  await engine.saveTensions(data);expect(await readFile(join(root,"temporal_graph.json"),"utf8")).toBe(before);
  expect((await readDirtyPartitions()).partitions.find(p=>p.id===partition.id)?.generation).toBe(partition.generation);
  expect((await loadTemporalObservations()).events).toHaveLength(4);
  engine.enterRem();const dreams=await causalReplayDream(12,2);expect(dreams[0].relation).toBe("temporal_correlation");expect(dreams[0].meta?.causal_proof).toBe(false);
});
it("XS11/15 concurrent and restarted exact imports return one original durable receipt without reinforcement",async()=>{
  const file=await incoming();const results=await Promise.all([importArchetypes(file),importArchetypes(file)]);expect(results[0]).toEqual(results[1]);
  const prior=await readFile(join(root,"dream_archetypes.json"),"utf8");await releaseGraphWriter(root);
  expect(await importArchetypes(file)).toEqual(results[0]);expect(await readFile(join(root,"dream_archetypes.json"),"utf8")).toBe(prior);
  const catalogue=await getArchetypes();expect(catalogue.imports).toHaveLength(1);expect(catalogue.archetypes[0]).toMatchObject({confidence:0.9,times_validated:1,local_validation:"unreviewed"});
  const dirty=(await readDirtyPartitions()).partitions[0];expect(dirty.state).toBe("partial");expect(dirty.pending_stages).toEqual([]);expect(results[0].tensions_created).toBe(0);
  const graph=await loadCanonicalGraph("legacy"),foreign=graph.entities.find(e=>e.identity.id.startsWith("foreign:"))!;
  expect(foreign.assertion_class).toBe("hypothesis");expect(foreign.evidence[0].origin).toBe("imported");expect(foreign.evidence[0].observed_at).toBe(results[0].timestamp);
  const claim={type:"edge" as const,from:{instance_id:"legacy",kind:"feature" as const,id:"a"},to:{instance_id:"legacy",kind:"feature" as const,id:"b"},relation:"depends_on"};
  expect(assessClaimEvidence(claim,await loadClaimEvidence(),2).independent_roots).toEqual([]);
});
it("new export timestamps/whitespace do not inflate an identical imported origin",async()=>{
  const file=await incoming();await importArchetypes(file);const update=exchange();update.metadata.exported_at=at(9);
  await writeFile(file,JSON.stringify(update,null,2));const result=await importArchetypes(file);expect(result.archetypes_imported).toBe(0);expect(result.archetypes_skipped).toBe(1);
  expect((await getArchetypes()).archetypes[0].confidence).toBe(0.9);expect((await getArchetypes()).archetypes[0].times_validated).toBe(1);
});
it.each(["unknown-version","wrong-manifest","changed-origin","legacy"])("quarantines %s with exact original bytes, never replaces a good hypothesis",async(kind)=>{
  const file=await incoming();await importArchetypes(file);const bad=exchange(kind);
  if(kind==="unknown-version")bad.metadata.schema_version="99.0.0";if(kind==="wrong-manifest")bad.metadata.manifest_digest="f".repeat(64);
  if(kind==="legacy")bad.metadata.schema_version="1.0.0";const body=JSON.stringify(bad);await writeFile(file,body);
  const result=await importArchetypes(file);expect(result.status).toBe("quarantined");expect(result.archetypes_imported).toBe(0);
  const disk=JSON.parse(await readFile(join(root,"dream_archetypes.json"),"utf8"));expect(disk.quarantine[0].raw_body).toBe(body);expect(disk.quarantine[0].artifact_digest).toBe(timeDigest(body));
  expect((await getArchetypes()).quarantine[0]).not.toHaveProperty("raw_body");expect(disk.archetypes[0].description).not.toBe(kind);
});
it("malformed sharing configuration and oversized imports do not default to permissive sharing",async()=>{
  const file=await incoming();vi.stubEnv("DREAMGRAPH_FEDERATION","{broken");await expect(importArchetypes(file)).rejects.toThrow();
  vi.stubEnv("DREAMGRAPH_FEDERATION",JSON.stringify({allow_import:false}));await expect(importArchetypes(file)).rejects.toThrow("DISABLED");
  vi.stubEnv("DREAMGRAPH_FEDERATION","{}");await writeFile(file," ".repeat(1048577));await expect(importArchetypes(file)).rejects.toThrow("BYTE_BOUND");
});
it("origin/manifest mismatch and duplicate identity fail original wire validation",()=>{
  const value=exchange();value.archetypes[0].origin.namespace="other";value.metadata.manifest_digest=manifestDigest(value.archetypes as any);
  expect(()=>parseExchange(JSON.stringify(value))).toThrow("ORIGIN_MISMATCH");
  const duplicate=exchange();duplicate.archetypes.push(duplicate.archetypes[0]);duplicate.metadata.total_archetypes=2;duplicate.metadata.manifest_digest=manifestDigest(duplicate.archetypes as any);
  expect(()=>parseExchange(JSON.stringify(duplicate))).toThrow("DUPLICATE_ID");
});
it("ambiguous history identities and nonmonotonic cycles remain unknown instead of defining a fabricated order",()=>{
  const first=histories()[0],conflict={...first,state:"other"} as DreamHistoryEntry;
  const a=chronologicalHistory([first,conflict,...histories().slice(1)]),b=chronologicalHistory([conflict,first,...histories().slice(1).reverse()]);
  expect(a).toEqual(b);expect(a.reasons).toContain("conflicting_history_identity");expect(a.sessions.some(s=>s.cycle_number===1)).toBe(false);
  expect(cycleAtTime(at(2),[{...first,cycle_number:8},histories()[1]])).toBeNull();
});
it("removed correlation hypotheses and original onset observations survive as superseded history",async()=>{
  await commitGraphWrites({actor:"fixture",writes:[{file:"dream_history.json",content:JSON.stringify({metadata:{schema_version:"1.0.0"},sessions:histories()})}]});
  const data=await tensions(signal("a1","a",1),signal("b1","b",2),signal("a2","a",5),signal("b2","b",6));await engine.saveTensions(data);
  const prior=JSON.parse(await readFile(join(root,"causal_graph.json"),"utf8"));expect(prior.hypotheses.length).toBeGreaterThan(0);
  await engine.saveTensions({...data,signals:data.signals.filter(s=>s.entities[0]==="b")});
  const next=JSON.parse(await readFile(join(root,"causal_graph.json"),"utf8"));expect(next.hypotheses[0].applicability).toBe("superseded");
  expect(next.hypotheses[0].id).toBe(prior.hypotheses[0].id);expect(next.observations).toEqual(prior.observations);
});
it("corrupt or legacy local evidence is never silently interpreted as an empty successful store",async()=>{
  await writeFile(join(root,"dream_archetypes.json"),"{malformed");await expect(getArchetypes()).rejects.toThrow();
  await writeFile(join(root,"dream_archetypes.json"),JSON.stringify({metadata:{schema_version:"1.0.0"},archetypes:[]}));await expect(getArchetypes()).rejects.toThrow("LEGACY_REVIEW_REQUIRED");
});
it("late and duplicate history uses the publication owner and refreshes existing hypotheses without a second cycle",async()=>{
  const data=await tensions(signal("a1","a",1),signal("b1","b",2),signal("a2","a",5),signal("b2","b",6));await engine.saveTensions(data);
  expect(JSON.parse(await readFile(join(root,"causal_graph.json"),"utf8")).hypotheses).toEqual([]);
  const entries=histories().map((h,i)=>({...h,session_id:"observed-"+i}));for(const entry of entries.slice().reverse())await engine.appendHistoryEntry(entry);
  const before=await readFile(join(root,"causal_graph.json"),"utf8"),history=await readFile(join(root,"dream_history.json"),"utf8");
  expect(JSON.parse(before).hypotheses.filter((h:any)=>h.applicability==="current").length).toBeGreaterThan(0);
  const revision=(await loadPublicationState()).revision;await engine.appendHistoryEntry(entries[0]);expect((await loadPublicationState()).revision).toEqual(revision);
  expect(await readFile(join(root,"dream_history.json"),"utf8")).toBe(history);expect(await readFile(join(root,"causal_graph.json"),"utf8")).toBe(before);
  await expect(engine.appendHistoryEntry({...entries[0],timestamp:at(8)})).rejects.toThrow("HISTORY_IDENTITY_CONFLICT");
});
it("federation configuration is typed before persistence and retains protected reset policy",()=>{
  expect(engineSetting("DREAMGRAPH_FEDERATION")).toMatchObject({owner:"federation",apply:"next_execution",protected:true});
  expect(validateEngineEnvValues({DREAMGRAPH_FEDERATION:JSON.stringify({allow_import:false,allow_export:false,anonymize:false})},["DREAMGRAPH_FEDERATION"])).toEqual([]);
  expect(()=>validateEngineEnvValues({DREAMGRAPH_FEDERATION:JSON.stringify({allow_export:true,anonymize:false})},["DREAMGRAPH_FEDERATION"])).toThrow("CONFIG_INVALID_SETTING");
});
it("successive evidence generations retain unsettled scopes, old running generation and unknown debt",async()=>{
  const publish=async(scope:string[],fingerprint:string,unknown_impact=false)=>withGraphReconciliation(async()=>{
    const writes=await prepareEvidenceGeneration({id:"observed",scope,fingerprint,unknown_impact});
    if(writes.length)await commitGraphWrites({actor:"fixture",writes});
  });
  await publish(["entity:a"],"first");
  const running=await readDirtyPartitions();running.partitions[0].running_generation=1;running.partitions[0].state="running";
  await commitGraphWrites({actor:"fixture",writes:[{file:"dirty_partitions.json",content:JSON.stringify(running)}]});
  await publish(["entity:b"],"second");
  expect((await readDirtyPartitions()).partitions[0]).toMatchObject({scope:["entity:a","entity:b"],generation:2,running_generation:1,pending_stages:["digestion"]});
  await publish(["unknown:external"],"third",true);await publish(["entity:c"],"fourth");
  expect((await readDirtyPartitions()).partitions[0]).toMatchObject({scope:["entity:a","entity:b","entity:c","unknown:external"],generation:4,state:"partial",pending_stages:[]});
  const before=await readFile(join(root,"dirty_partitions.json"),"utf8");
  await expect(publish(Array.from({length:100},(_,i)=>"new:"+i),"overflow")).rejects.toThrow("REQUIRES_RECONCILIATION");
  expect(await readFile(join(root,"dirty_partitions.json"),"utf8")).toBe(before);
  const settled=await readDirtyPartitions();Object.assign(settled.partitions[0],{state:"settled",running_generation:null});
  await commitGraphWrites({actor:"fixture",writes:[{file:"dirty_partitions.json",content:JSON.stringify(settled)}]});
  await publish(["entity:d"],"new-window");expect((await readDirtyPartitions()).partitions[0]).toMatchObject({scope:["entity:d"],generation:5,state:"ready",pending_stages:["digestion"]});
});
