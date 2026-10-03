import { beforeEach,afterEach,expect,it,vi } from "vitest";
import { mkdtemp,mkdir,readFile,writeFile,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../src/config/config.js";
import { getDataDir,setDataDirOverride } from "../src/utils/paths.js";
import { releaseGraphWriter } from "../src/graph/writer-lease.js";
import { commitGraphWrites,loadPublicationState } from "../src/graph/publication.js";
import { engine } from "../src/cognitive/engine.js";
import { nightmare,getThreatLog,clearThreatLog } from "../src/cognitive/adversarial.js";
import { generateRemediationPlans,loadRemediationLog } from "../src/cognitive/intervention.js";
import { buildTensionClusters } from "../src/cognitive/tension-clustering.js";
import * as llm from "../src/cognitive/llm.js";
import { EngineJobs } from "../src/cognitive/jobs.js";
let root:string,old:string,repos:typeof config.repos;
beforeEach(async()=>{old=getDataDir();root=await mkdtemp(join(tmpdir(),"dg-risk-"));await mkdir(join(root,"repo"));setDataDirOverride(root);repos=config.repos;config.repos={fixture:join(root,"repo")};
  vi.spyOn(llm,"selectLlmRoute").mockResolvedValue({layer:"deterministic_fallback",provider:null,model:null,options:{},provenance:{task:"remediation_drafting",layer:"deterministic_fallback",provider:null,model:null,source:"deterministic_fallback",fallback_reason:"no_daemon_model"}});
});
afterEach(async()=>{if(engine.getState()!=="awake")await engine.interrupt();vi.restoreAllMocks();await releaseGraphWriter(root);setDataDirOverride(old);config.repos=repos;await rm(root,{recursive:true,force:true});});
const input={type:"missing_link" as const,entities:["a","b"],description:"Exact connection concern",urgency:0.6};
it("concurrent replay retains one risk, distinct concerns do not subset-merge, and stale commands fail without overwriting",async()=>{
  const signals=await Promise.all(Array.from({length:8},()=>engine.recordTension(input)));
  expect(new Set(signals.map(s=>s.id)).size).toBe(1);expect((await engine.loadTensions()).signals[0].occurrences).toBe(1);
  const other=await engine.recordTension({...input,entities:["a"],description:"Different source concern"});expect(other.id).not.toBe(signals[0].id);
  const snapshot=await engine.loadTensions();await engine.proposeTensionResolution(signals[0].id,{strategy:"merge",rationale:"Review declared bridge",validation_window:1,source:"heuristic"});
  await expect(engine.resolveTension(signals[0].id,"human","wont_fix","Accept scoped risk",undefined,{expected_revision:signals[0].revision})).rejects.toThrow("REVISION_CONFLICT");
  await expect(engine.saveTensions(snapshot)).rejects.toThrow("TENSION_REVISION_CONFLICT");expect((await engine.loadTensions()).signals).toHaveLength(2);
});
it("proposal/action histories survive review, exact action replay is idempotent and automated dispositions cannot invent proof",async()=>{
  const risk=await engine.recordTension(input),proposal={strategy:"merge" as const,rationale:"Inspect source",validation_window:1,source:"heuristic" as const,
    proposed_action:{tool:"enrich_seed_data" as const,target:"features" as const,mode:"merge" as const,entries:[{id:"a",description:"suggested"}]}};
  const stamped=await engine.proposeTensionResolution(risk.id,proposal),id=stamped!.resolution_candidate!.id!;
  expect(stamped?.resolution_candidate?.proposed_action).toEqual(proposal.proposed_action);
  const outcome={state:"completed" as const,receipt_ids:["receipt"],reason:"Graph assertion committed; source verification unavailable"};
  await engine.recordTensionAction(risk.id,id,outcome);const revision=(await loadPublicationState()).revision;await engine.recordTensionAction(risk.id,id,outcome);
  expect((await loadPublicationState()).revision).toEqual(revision);
  await expect(engine.resolveTension(risk.id,"system","confirmed_fixed","Tool succeeded")).rejects.toThrow();
  await expect(engine.resolveTension(risk.id,"system","wont_fix","Heuristic accepts risk")).rejects.toThrow("HUMAN_DISPOSITION_REQUIRED");
  expect((await engine.validateResolutionCandidates()).confirmed).toBe(0);
  const current=(await engine.loadTensions()).signals[0];expect(current.lifecycle_history?.map(e=>e.kind)).toEqual(["observed","proposed","action","review_required"]);expect(current.proposal_history).toHaveLength(1);
});
it("human scope/rationale persists and material reappearance keeps the same identity and original disposition",async()=>{
  const risk=await engine.recordTension(input);await engine.resolveTension(risk.id,"human","wont_fix","Reviewer accepts only this risk",3);
  expect((await engine.recordTension(input)).resolved).toBe(true);expect((await engine.loadTensions()).signals).toEqual([]);
  await engine.processRecheckWindows();expect((await engine.getResolvedTensions())[0].recheck_ttl).toBe(2);
  const reappeared=await engine.recordTension({...input,observation_fingerprint:"material-source-change"});expect(reappeared.id).toBe(risk.id);expect(reappeared.lifecycle).toBe("review_required");
  expect((await engine.getResolvedTensions())[0]).toMatchObject({evidence:"Reviewer accepts only this risk",resolution_state:"human_disposition",reappearance_reason:expect.any(String)});
});
it("durable action intent permits one dispatch and lost/restarted results never authorize automatic retry",async()=>{
  const risk=await engine.recordTension(input),proposal=await engine.proposeTensionResolution(risk.id,{strategy:"merge",rationale:"Inspect one declared action",validation_window:1,source:"heuristic"});
  const id=proposal!.resolution_candidate!.id!;
  expect((await Promise.all([engine.beginTensionAction(risk.id,id),engine.beginTensionAction(risk.id,id)])).filter(Boolean)).toHaveLength(1);
  await releaseGraphWriter(root);expect(await engine.beginTensionAction(risk.id,id)).toBe(false);
  await engine.recordTensionAction(risk.id,id,{state:"unknown",receipt_ids:[],reason:"Process disappeared after dispatch; inspect effects before retry"});
  expect(await engine.beginTensionAction(risk.id,id)).toBe(false);expect((await engine.loadTensions()).signals[0].resolved).toBe(false);
});
it("unconfirmed remediation effects retain the existing job recovery owner instead of claiming execution success",async()=>{
  const risk=await engine.recordTension(input),proposal=await engine.proposeTensionResolution(risk.id,{strategy:"merge",rationale:"One bounded effect",validation_window:1,source:"heuristic"});
  const jobs=new EngineJobs(),accepted=await jobs.accept({operation_id:"risk-effect",action:"fixture",owner:"fixture",scope:[risk.id],role_policies:{},budget:{requests:1,input_tokens:1000,output_tokens:1000,reasoning_tokens:1000,retries:0,elapsed_ms:10000,concurrency:1,max_hops:0,max_neighbors:10,run_amount:0,day_amount:0,currency:"USD",pricing_version:null,billing_principal:"fixture"}});
  await expect(jobs.run(accepted.job.id,async()=>{
    expect(await engine.beginTensionAction(risk.id,proposal!.resolution_candidate!.id!)).toBe(true);
    await engine.recordTensionAction(risk.id,proposal!.resolution_candidate!.id!,{state:"unknown",receipt_ids:[],reason:"Effect result unavailable"});return "cannot claim successful execution";
  })).rejects.toThrow();
  const record=(await jobs.inspect()).records.find(r=>r.job.id===accepted.job.id)!;expect(record.job.state).toBe("recovery_required");expect(record.job.unknown_effects).toHaveLength(1);
  expect((await engine.loadTensions()).signals[0].resolved).toBe(false);
});
it("known canonical features are not phantom entities and corrupt factual context cannot yield a successful phantom remedy",async()=>{
  await commitGraphWrites({actor:"fixture",writes:[{file:"features.json",content:JSON.stringify([{id:"a",name:"A",description:"One component",source_repo:"fixture",source_files:["a.ts"],links:[]}])}]});
  await engine.recordTension({type:"code_insight",entities:["a"],description:"Review the source responsibilities",urgency:0.8});
  const result=await generateRemediationPlans();expect(result.plans[0].intervention_type).not.toBe("wont_fix");
  await writeFile(join(root,"features.json"),"{broken");
  await expect(generateRemediationPlans()).rejects.toThrow("FACT_CONTEXT_UNAVAILABLE");
  expect(await readFile(join(root,"features.json"),"utf8")).toBe("{broken");
});
it("TTL retires attention as unverified and repeated cluster wrappers cannot increase support",async()=>{
  const risk=await engine.recordTension(input),data=await engine.loadTensions();data.signals[0].ttl=1;await engine.saveTensions(data);await engine.applyTensionDecay();
  expect((await engine.getResolvedTensions())[0]).toMatchObject({resolution_type:"expired_unverified",resolution_state:"expired_unverified"});
  const again=await engine.recordTension(input);expect(again.id).toBe(risk.id);expect(again.resolved).toBe(false);
  expect(buildTensionClusters([again,again])).toEqual(buildTensionClusters([again]));expect(buildTensionClusters([again])[0].assertion_class).toBe("advisory");
});
it("remediation replay keeps original proposal/receipt, adaptive memory and selected stage across restart; malformed history fails closed",async()=>{
  const risk=await engine.recordTension({...input,entities:["phantom"],description:"Inspect unknown entity",urgency:0.8});
  const first=await generateRemediationPlans(),disk=await loadRemediationLog();expect(first.plans[0]).toMatchObject({stage:"proposed",assertion_class:"advisory"});
  expect(disk.adaptive_future?.outcomes[0]).toMatchObject({stage:"proposal_selected",assertion_class:"advisory",selected_plan_id:first.plans[0].id});
  await releaseGraphWriter(root);const second=await generateRemediationPlans();expect(second.plans).toEqual(first.plans);
  expect((await loadRemediationLog()).history).toEqual([]);expect((await loadRemediationLog()).adaptive_future?.outcomes).toHaveLength(1);
  expect((await engine.loadTensions()).signals.find(s=>s.id===risk.id)?.resolved).toBe(false);
  await writeFile(join(root,"remediation_log.json"),"{broken");
  await expect(generateRemediationPlans()).rejects.toThrow();expect(await readFile(join(root,"remediation_log.json"),"utf8")).toBe("{broken");
});
it("adversarial findings and risk share a compound publication; changed inputs reopen acknowledged review without duplicates",async()=>{
  const feature=(name:string)=>({id:"form",name,description:"Input form creates records",domain:"security",source_repo:"fixture",source_files:["form.ts"],links:[{target:"records",type:"data_model",relationship:"writes",strength:"strong"}]});
  const seed=async(name:string)=>commitGraphWrites({actor:"fixture",writes:[{file:"features.json",content:JSON.stringify([feature(name)])},
    {file:"data_model.json",content:JSON.stringify([{id:"records",name:"records",description:"Store password data",source_repo:"fixture",source_files:["records.ts"],links:[]}])}]});
  await seed("Form");engine.enterNightmare();const first=await nightmare("injection_surface");engine.wakeFromNightmare();expect(first.threats_found).toHaveLength(1);
  const initial=(await getThreatLog()).threats[0];expect((await engine.loadTensions()).signals[0].id).toBe(initial.tension_id);
  engine.enterNightmare();expect((await nightmare("injection_surface")).threats_found).toEqual([]);engine.wakeFromNightmare();
  const reviewed=await getThreatLog();reviewed.threats[0].acknowledged=true;reviewed.threats[0].lifecycle="deferred";reviewed.threats[0].ack_note="Explicit operator rationale";
  await commitGraphWrites({actor:"fixture_human",writes:[{file:"threat_log.json",content:JSON.stringify(reviewed)}]});await seed("Form v2");
  engine.enterNightmare();const next=await nightmare("injection_surface");engine.wakeFromNightmare();expect(next.threats_found).toHaveLength(1);
  const row=(await getThreatLog()).threats[0];expect(row.id).toBe(initial.id);expect(row.tension_id).toBe(initial.tension_id);expect(row.acknowledged).toBe(false);expect(row.review_history?.[0].previous_acknowledged).toBe(true);
  expect((await engine.loadTensions()).signals).toHaveLength(1);expect((await engine.loadTensions()).signals[0].lifecycle).toBe("review_required");
  const publication=await loadPublicationState();expect(publication.stores["threat_log.json"].hash).toBeDefined();
  await clearThreatLog();expect((await getThreatLog()).archived_threats).toHaveLength(1);expect((await engine.loadTensions()).signals).toHaveLength(1);
});
