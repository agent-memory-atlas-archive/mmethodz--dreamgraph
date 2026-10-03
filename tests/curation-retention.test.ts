import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { engine } from "../src/cognitive/engine.js";
import { curateGraph, curationSuppressions } from "../src/cognitive/curation.js";
import { loadGraphMaintenanceState } from "../src/cognitive/graph-maintenance-state.js";
import { loadCanonicalGraph } from "../src/graph/read-model.js";
import { commitGraphWrites, loadPublicationState, recoverGraphPublication } from "../src/graph/publication.js";
import { getDataDir, setDataDirOverride } from "../src/utils/paths.js";
import { releaseGraphWriter } from "../src/graph/writer-lease.js";
import { executeGraphEdgeMutation } from "../src/tools/graph-edge-mutations.js";
import { buildFactSnapshot } from "../src/cognitive/strategies/_shared.js";
let dir: string, prior: string;
const metadata = {schema_version:"1.0.0",description:"Fixture",total_cycles:0,total_normalization_cycles:0};
const edge = (id="dream-a",from="a",to="b") => ({id,from,to,from_kind:"feature",to_kind:"feature",from_repository_id:"fixture",to_repository_id:"fixture",
  relation:"reads",reason:"Fixture relation",type:"hypothetical",confidence:.6,status:"candidate",origin:"rem",strategy:"gap_detection",ttl:1,decay_rate:.1,
  dream_cycle:0,last_reinforced_cycle:-1,reinforcement_count:0,created_at:"2026-10-01T00:00:00.000Z",activation_score:0,plausibility:0,evidence_score:0,contradiction_score:0} as any);
const candidate = (cycle:number,status="latent") => ({dream_id:"dream-a",dream_type:"edge",normalization_cycle:cycle,status,confidence:.5,reason:"History fixture"});
beforeEach(async () => {
  prior=getDataDir();dir=await mkdtemp(join(tmpdir(),"dg-curation-"));setDataDirOverride(dir);
  if(engine.getState()!=="awake")await engine.interrupt();
  await commitGraphWrites({writes:[{file:"features.json",content:JSON.stringify([{id:"a",name:"A",source_repo:"fixture",source_files:["a.ts"],links:[]},{id:"b",name:"B",source_repo:"fixture",source_files:["b.ts"],links:[]}])},
    {file:"workflows.json",content:"[]"},{file:"data_model.json",content:"[]"},
    {file:"dream_graph.json",content:JSON.stringify({metadata,nodes:[],edges:[edge()]})},
    {file:"candidate_edges.json",content:JSON.stringify({metadata,results:[candidate(1,"rejected"),candidate(2)]})},
    {file:"validated_edges.json",content:JSON.stringify({metadata,edges:[]})}]});
});
afterEach(async()=>{vi.restoreAllMocks();if(engine.getState()!=="awake")await engine.interrupt();await releaseGraphWriter(dir);setDataDirOverride(prior);await rm(dir,{recursive:true,force:true});});
const revision=async()=>(await loadPublicationState()).revision.graph_revision;
it("latest human rejection is durable without rewriting normalization history and suppresses rediscovery",async()=>{
  const before=await readFile(join(dir,"candidate_edges.json"),"utf8");
  const result=await engine.userRejectCandidate("dream-a",{reason:"Wrong direction",actor:"reviewer",expected_revision:await revision()});
  expect(result.candidate).toMatchObject({status:"rejected",normalization_cycle:2});
  expect(await readFile(join(dir,"candidate_edges.json"),"utf8")).toBe(before);
  const graph=await loadCanonicalGraph("fixture");expect(graph.entities.find(e=>e.identity.kind==="candidate")?.payload.status).toBe("rejected");
  engine.enterRem();const added=await engine.publishDreamCandidates([],[edge("rediscovered")],{snapshot:await buildFactSnapshot()});expect(added.edges).toEqual([]);
  expect(curationSuppressions((await loadGraphMaintenanceState()).curation!).size).toBeGreaterThan(0);
});
it("retire, restart read, scoped reopen and restore retain the exact before state and do not restore factual authority",async()=>{
  const retired=await curateGraph({target_id:"dream-a",target_type:"edge",action:"retire",actor:"reviewer",reason:"Obsolete relation",expected_revision:await revision(),operation_id:"retire:one"});
  expect((await engine.loadDreamGraph()).edges).toEqual([]);
  const persisted=(await loadGraphMaintenanceState()).curation!;expect(persisted.decisions[0].archive_file).toBeTruthy();
  const archived=JSON.parse(await readFile(join(dir,persisted.decisions[0].archive_file!),"utf8"));expect(archived.before.dream_edges[0].confidence).toBe(.6);
  await expect(curateGraph({target_id:"dream-a",target_type:"edge",action:"restore",actor:"reviewer",reason:"Wrong earlier decision",expected_revision:retired.receipt!.revision.graph_revision,decision_id:"old-wrong"})).rejects.toThrow("DECISION_CONFLICT");
  await curateGraph({target_id:"dream-a",target_type:"edge",action:"restore",actor:"reviewer",reason:"Wrong earlier decision",expected_revision:await revision(),decision_id:"retire:one"});
  expect((await engine.loadDreamGraph()).edges[0].status).toBe("latent");expect((await engine.loadValidatedEdges()).edges).toEqual([]);
  expect(curationSuppressions((await loadGraphMaintenanceState()).curation!).size).toBe(0);
});
it("curation is CAS-bound, dry run is read-only and unknown reply replay does not duplicate decisions",async()=>{
  const initial=await revision(),input={target_id:"dream-a",target_type:"edge" as const,action:"retire" as const,actor:"reviewer",reason:"Retire fixture",expected_revision:initial,operation_id:"retire:lost"};
  const preview=await curateGraph({...input,dry_run:true});expect(preview.dry_run).toBe(true);expect(await revision()).toBe(initial);
  await expect(curateGraph({...input,fault_inject:step=>{if(step==="publication_committed")throw Error("lost reply");}})).rejects.toThrow("lost reply");
  await recoverGraphPublication();const replay=await curateGraph(input);expect(replay.replayed).toBe(true);expect((await loadGraphMaintenanceState()).curation?.decisions).toHaveLength(1);
  await expect(curateGraph({...input,reason:"changed intent"})).rejects.toThrow(/IDENTITY|CONFLICT/);
  await expect(curateGraph({...input,operation_id:"competing",action:"reopen"})).rejects.toThrow("REVISION_CONFLICT");
});
it("interruption before publication restores both graph and dispositions",async()=>{
  const initial=await revision();
  await expect(curateGraph({target_id:"dream-a",target_type:"edge",action:"retire",actor:"reviewer",reason:"Failure fixture",expected_revision:initial,
    fault_inject:step=>{if(step.startsWith("after_replace:0:"))throw Error("fixture crash");}})).rejects.toThrow("fixture crash");
  await recoverGraphPublication();expect(await revision()).toBe(initial);expect((await engine.loadDreamGraph()).edges).toHaveLength(1);
  expect((await loadGraphMaintenanceState()).curation?.decisions??[]).toEqual([]);
});
it("expiry archives speculation and dependent edges together while source facts and human assertions survive",async()=>{
  const original=await engine.loadDreamGraph();original.nodes.push({id:"hub",name:"Hub",source_repo:"fixture",category:"feature",inspiration:[],ttl:1,decay_rate:.1,confidence:.5,status:"candidate",last_reinforced_cycle:-1} as any);
  original.edges.push({...edge("hub-edge","hub","a"),ttl:10},{...edge("human","b","a"),meta:{human_assertion:{actor:"reviewer"}},ttl:0});
  await engine.saveDreamGraph(original);const facts=await readFile(join(dir,"features.json"),"utf8");engine.enterRem();
  const result=await engine.applyDecay();expect(result).toEqual({decayedNodes:1,decayedEdges:2});
  expect((await engine.loadDreamGraph()).edges.map(e=>e.id)).toEqual(["human"]);expect(await readFile(join(dir,"features.json"),"utf8")).toBe(facts);
  expect((await loadGraphMaintenanceState()).curation?.decisions).toHaveLength(3);
  const dedup=await engine.publishDreamCandidates([],[{...edge("reappeared"),ttl:8}]);expect(dedup.edges[0].confidence).toBe(.6);expect(dedup.edges[0].reinforcement_count).toBe(0);
});
it("human acceptance remains human assertion with preserved assessment history and no independent root credit",async()=>{
  const before=await readFile(join(dir,"candidate_edges.json"),"utf8");const result=await engine.userPromoteCandidate("dream-a",{reason:"Reviewed local architecture",actor:"reviewer"});
  expect(result.edge?.evidence_count).toBe(0);expect(await readFile(join(dir,"candidate_edges.json"),"utf8")).toBe(before);
  const graph=await loadCanonicalGraph("fixture");expect(graph.relationships.find(r=>r.kind==="validated")?.assertion_class).toBe("human_assertion");
});
it("direct validated deletion creates a reversible tombstone and retargeting cannot inherit the old proof",async()=>{
  await engine.userPromoteCandidate("dream-a",{reason:"Fixture human acceptance"});
  const result=await executeGraphEdgeMutation({action:"retarget",edge_id:"validated_dream-a",new_from:"b",new_to:"a",reason:"Correct direction",expected_revision:await revision(),operation_id:"retarget:one"});
  expect(result.success).toBe(true);expect((await engine.loadValidatedEdges()).edges).toEqual([]);
  const next=(await engine.loadDreamGraph()).edges.find(e=>e.id==="curated_retarget:one")!;expect(next).toMatchObject({from:"b",to:"a",status:"candidate",reinforcement_count:0});expect(next.evidence_assessment).toBeUndefined();
  const denied=await executeGraphEdgeMutation({action:"delete",edge_id:"missing"});expect(denied.success).toBe(false);
});
it("malformed maintenance state is unavailable and cannot erase human dispositions",async()=>{
  await writeFile(join(dir,"graph_maintenance.json"),"{malformed");await expect(loadGraphMaintenanceState()).rejects.toThrow();
  const graph=await loadCanonicalGraph("fixture");expect(graph.state.reasons.some(r=>r.code==="CURATION_UNAVAILABLE")).toBe(true);
});
it("restore replaces a rejected incarnation, but deleted endpoints block restoration atomically",async()=>{
  await curateGraph({target_id:"dream-a",target_type:"edge",action:"reject",actor:"reviewer",reason:"Reject fixture",expected_revision:await revision()});
  await curateGraph({target_id:"dream-a",target_type:"edge",action:"restore",actor:"reviewer",reason:"Restore original candidate",expected_revision:await revision()});
  expect((await engine.loadDreamGraph()).edges[0]).toMatchObject({status:"latent",confidence:.6});
  await curateGraph({target_id:"dream-a",target_type:"edge",action:"retire",actor:"reviewer",reason:"Retire fixture",expected_revision:await revision()});
  await commitGraphWrites({writes:[{file:"features.json",content:JSON.stringify([{id:"a",name:"A",source_repo:"fixture",source_files:["a.ts"],links:[]}])}]});
  const prior=await revision();
  await expect(curateGraph({target_id:"dream-a",target_type:"edge",action:"restore",actor:"reviewer",reason:"Unavailable source",expected_revision:prior})).rejects.toThrow("ENDPOINT_UNAVAILABLE");
  expect(await revision()).toBe(prior);expect((await engine.loadDreamGraph()).edges).toEqual([]);
  expect(curationSuppressions((await loadGraphMaintenanceState()).curation!).size).toBeGreaterThan(0);
});
it("quarantine updates typed index keys without deleting unrelated families or reviewed human facts",async()=>{
  const fact=[{id:"a",name:"A",source_repo:"fixture",source_files:["a.ts"],links:[]},{id:"b",name:"B",source_repo:"fixture",source_files:["b.ts"],links:[]},
    {id:"phantom",name:"Ungrounded model output",origin:"rem",source_repo:"fixture",source_files:[],links:[]},{id:"human",name:"Reviewed assertion",origin:"lucid",source_repo:"",source_files:[],links:[]}];
  await commitGraphWrites({writes:[{file:"features.json",content:JSON.stringify(fact)},
    {file:"index.json",content:JSON.stringify({entities:{"typed:phantom":{type:"feature",uri:"dreamgraph://resource/feature/phantom",source_repo:"fixture",name:"Phantom"},
      "other:phantom":{type:"capability",uri:"dreamgraph://resource/capability/phantom",source_repo:"fixture",name:"Other identity"},
      "typed:human":{type:"feature",uri:"dreamgraph://resource/feature/human",source_repo:"",name:"Human"}}})}]});
  const result=await engine.quarantineSourceLessFacts();expect(result.quarantined_nodes).toBe(1);
  const index=JSON.parse(await readFile(join(dir,"index.json"),"utf8")).entities;
  expect(index["typed:phantom"]).toBeUndefined();expect(index["other:phantom"]).toBeDefined();expect(index["typed:human"]).toBeDefined();
  expect(JSON.parse(await readFile(join(dir,"features.json"),"utf8")).map((e:any)=>e.id)).toEqual(["a","b","human"]);
  expect((await loadPublicationState()).receipts).toBeTruthy();
});
