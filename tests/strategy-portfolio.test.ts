import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { engine } from "../src/cognitive/engine.js";
import { dream } from "../src/cognitive/dreamer.js";
import { emptyPortfolio, readMetaDocument, appendPortfolioObservations, allocatePortfolioBudgets, updatePortfolio,
  strategyVersion, strategyCharge, dreamClaimKey, type StrategyObservation } from "../src/cognitive/strategy-portfolio.js";
import { computePortfolioMetrics, runMetacognitiveAnalysis } from "../src/cognitive/metacognition.js";
import { ACTIVE_STRATEGY_NAMES, allocateStrategyBudgets } from "../src/cognitive/strategy-catalog.js";
import { setDataDirOverride, getDataDir } from "../src/utils/paths.js";
import { releaseGraphWriter } from "../src/graph/writer-lease.js";
import { deduplicateDreamCandidates } from "../src/cognitive/dream-deduplication.js";
import { commitGraphWrites } from "../src/graph/publication.js";
let directory: string, prior: string;
beforeEach(async () => {
  prior = getDataDir(); directory = await mkdtemp(join(tmpdir(), "dg-portfolio-")); setDataDirOverride(directory);
  for (const file of ["features.json", "workflows.json", "data_model.json"]) await writeFile(join(directory,file), JSON.stringify(file === "features.json" ? [
    { id: "a", name: "Owner", source_repo: "fixture", links: ["b","c"].map(target => ({ target, type: "feature", relationship: "reads" })) },
    { id: "b", name: "B", source_repo: "fixture", links: [] }, { id: "c", name: "C", source_repo: "fixture", links: [] }] : []));
  if (engine.getState() !== "awake") await engine.interrupt();
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); if (engine.getState() !== "awake") await engine.interrupt();
  await releaseGraphWriter(directory); setDataDirOverride(prior); await rm(directory,{recursive:true,force:true}); });
const observation = (id: string, strategy = "gap_detection", keys = ["edge:claim"]): StrategyObservation => ({ id, strategy,
  version: strategyVersion(strategy), input_hash: "frozen-source", cycle: 1, status: "completed", budget: 10, generated: 10,
  persisted: keys.length, novel: 0, claim_keys: keys, artifact_ids: keys.map(k => k.replace("claim","artifact")), ancestry: ["source:fixture"], elapsed_ms: 2,
  attempt_ids: [], charge_nanounits: "0", charge_provenance: "no_provider_call", recorded_at: "2026-10-01T00:00:00.000Z" });
it("actual dream publication retains only post-dedup yield and survives new reader instances", async () => {
  engine.enterRem(); const first = await dream("missing_abstraction",3), second = await dream("missing_abstraction",3);
  expect(first.strategy_yields.missing_abstraction).toBe(3); expect(second.strategy_yields.missing_abstraction).toBe(0);
  const saved = await readMetaDocument(); expect(saved.portfolio?.observations.map(o => [o.persisted,o.novel])).toEqual([[3,3],[0,0]]);
  expect(JSON.parse(await readFile(join(directory,"meta_log.json"),"utf8")).portfolio.sequence).toBe(2);
  expect(saved.portfolio?.observations[0].artifact_ids).toHaveLength(3);
});
it("duplicate flooding and replay cannot multiply novelty or make confidence into evidence", () => {
  let state = appendPortfolioObservations(emptyPortfolio(),[observation("run:a")]);
  state = appendPortfolioObservations(state,[observation("run:a"),observation("run:b","gap_detection",Array(100).fill("edge:claim"))]);
  expect(state.observations).toHaveLength(2); expect(state.observations.map(o => o.novel)).toEqual([1,0]); expect(state.seen_claims).toEqual(["edge:claim"]);
  const metrics = computePortfolioMetrics(state,null).find(m => m.strategy === "gap_detection")!;
  expect(metrics).toMatchObject({ total_generated:1,total_validated:0,precision:null,evidence_state:"unavailable" });
});
it("zero and tiny allocations remain bounded and rotate all eligible heuristics across persisted sequence", () => {
  let state = emptyPortfolio(); const observed = new Set<string>();
  const names = ACTIVE_STRATEGY_NAMES.filter(n => !["llm_dream","pgo_wave"].includes(n));
  for (let cycle=0;cycle<names.length;cycle++) {
    const allocation = allocatePortfolioBudgets(state,names,1,"frozen-source",{llm:0,pgo:0});
    expect(Object.values(allocation).reduce((a,b)=>a+b,0)).toBe(1); observed.add(Object.keys(allocation).find(n=>allocation[n])!);
    state = JSON.parse(JSON.stringify(appendPortfolioObservations(state,[])));
  }
  expect(observed.size).toBe(names.length);
  for (const total of [0,1,2,10,1000]) {
    const allocation = allocatePortfolioBudgets(state,ACTIVE_STRATEGY_NAMES,total,"frozen-source",{llm:.35,pgo:.15});
    expect(Object.values(allocation).reduce((a,b)=>a+b,0)).toBe(total);
    const fixed = allocateStrategyBudgets(ACTIVE_STRATEGY_NAMES,total); expect(allocation.llm_dream).toBe(fixed.llm_dream); expect(allocation.pgo_wave).toBe(fixed.pgo_wave);
  }
});
it("bounded adaptation improves a frozen labeled allocation trace over the fixed baseline without volume credit", () => {
  const names = ["gap_detection","weak_reinforcement","cross_domain"];
  const state = appendPortfolioObservations(emptyPortfolio(),names.map(n=>observation(`run:${n}`,n,[`edge:${n}`])));
  state.reviews = names.map(n=>({claim_key:`edge:${n}`,strategy:n,version:strategyVersion(n),input_hash:"frozen-source",useful:n==="cross_domain",reviewer:"frozen-task-oracle",reason:"Independent outcome label",evidence_ids:[`task:${n}`],recorded_at:"2026-10-01T00:00:00.000Z"}));
  const adaptive = allocatePortfolioBudgets(state,names,30,"frozen-source",{llm:0,pgo:0}), fixed = allocateStrategyBudgets(names,30,{llm:0,pgo:0});
  expect(adaptive.cross_domain).toBeGreaterThan(fixed.cross_domain); expect(adaptive.gap_detection).toBeGreaterThan(0);
  expect(allocatePortfolioBudgets({...state,mode:"fixed"},names,30,"frozen-source",{llm:0,pgo:0})).toEqual(fixed);
  expect(allocatePortfolioBudgets(state,names,30,"new-source",{llm:0,pgo:0}).cross_domain).toBeLessThan(adaptive.cross_domain);
});
it("same label in another repository or category and directed inverse edges stay distinct; duplicate confidence stays unchanged", () => {
  const edge = { id:"one",from:"a",to:"b",relation:"reads",confidence:.3,status:"candidate",origin:"rem" } as any;
  const graph = {metadata:{},nodes:[],edges:[edge]} as any;
  const result = deduplicateDreamCandidates(graph,[],[{...edge,id:"repeat",confidence:1},{...edge,id:"inverse",from:"b",to:"a"}]);
  expect(result.edges.map(e=>e.id)).toEqual(["inverse"]); expect(edge.confidence).toBe(.3);
  expect(dreamClaimKey({name:"Hub",category:"feature",source_repo:"a"} as any)).not.toBe(dreamClaimKey({name:"Hub",category:"feature",source_repo:"b"} as any));
});
it("reset archives observations atomically, retains analysis and detects competing revisions", async () => {
  engine.enterRem(); await dream("missing_abstraction",3); const before = (await readMetaDocument()).portfolio!;
  const reset = await updatePortfolio({reviewer:"operator",reason:"Review new strategy version",expected_revision:before.revision,reset:true,mode:"fixed"});
  expect(reset.observations).toEqual([]); expect(reset.reset_history).toHaveLength(1);
  const archive = JSON.parse(await readFile(join(directory,`strategy-portfolio-${reset.reset_history[0].previous_hash}.json`),"utf8")); expect(archive).toEqual(before);
  await expect(updatePortfolio({reviewer:"operator",reason:"stale reset",expected_revision:before.revision,reset:true})).rejects.toThrow("REVISION_CONFLICT");
});
it("malformed portfolio is unavailable, missing provider usage is unknown and own promotion rates never auto-tune truth", async () => {
  await writeFile(join(directory,"meta_log.json"),"{broken"); await expect(readMetaDocument()).rejects.toThrow();
  await rm(join(directory,"meta_log.json"));
  expect(await strategyCharge(["unreported-attempt"])).toEqual({charge_nanounits:null,charge_provenance:"unavailable"});
  const tune = vi.spyOn(engine,"setPromotionOverride"); const entry = await runMetacognitiveAnalysis(50,true);
  expect(entry.threshold_recommendations).toEqual([]); expect(tune).not.toHaveBeenCalled();
});
it("expired hubs rediscovered with new generated IDs retain one semantic novelty identity",async()=>{
  engine.enterRem();await dream("missing_abstraction",3);const saved=(await readMetaDocument()).portfolio!;
  const graph=await engine.loadDreamGraph();graph.nodes.forEach(n=>{n.ttl=0;n.last_reinforced_cycle=-1;});graph.edges.forEach(e=>{e.ttl=0;e.last_reinforced_cycle=-1;});
  await engine.saveDreamGraph(graph);await engine.applyDecay();await dream("missing_abstraction",3);
  const next=(await readMetaDocument()).portfolio!;expect(next.observations.at(-1)?.persisted).toBe(3);expect(next.observations.at(-1)?.novel).toBe(0);expect(next.seen_claims).toEqual(saved.seen_claims);
});
it("published learning cannot disappear into an empty reset and conflicting observation replay is rejected",async()=>{
  const state=appendPortfolioObservations(emptyPortfolio(),[observation("stable")]);
  expect(()=>appendPortfolioObservations(state,[{...observation("stable"),generated:999}])).toThrow("IDENTITY_CONFLICT");
  await commitGraphWrites({writes:[{file:"meta_log.json",content:JSON.stringify({metadata:{},entries:[],portfolio:state})}]});
  await rm(join(directory,"meta_log.json"));await expect(readMetaDocument()).rejects.toThrow("PUBLISHED_PORTFOLIO_MISSING");
});
it("portfolio retry returns its original result after later reviews and refuses changed retry intent",async()=>{
  const input={reviewer:"operator",reason:"Review fixed baseline",expected_revision:0,mode:"fixed" as const,operation_id:"portfolio:original"};
  const first=await updatePortfolio(input);await updatePortfolio({reviewer:"operator",reason:"Resume adaptive exploration",expected_revision:first.revision,mode:"adaptive"});
  expect(await updatePortfolio(input)).toEqual(first);
  await expect(updatePortfolio({...input,mode:"adaptive"})).rejects.toThrow(/IDENTITY|CONFLICT/);
});
