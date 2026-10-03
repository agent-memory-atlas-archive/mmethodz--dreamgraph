import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {mkdtemp,mkdir,readFile,writeFile,rm} from "node:fs/promises";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {config} from "../src/config/config.js";
import {setDataDirOverride} from "../src/utils/paths.js";
import {releaseGraphWriter} from "../src/graph/writer-lease.js";
import {commitGraphWrites} from "../src/graph/publication.js";
import {withGraphReconciliation} from "../src/utils/graph-reconciliation-barrier.js";
import {captureAnalyticsSnapshot,measureAnalytics,ANALYTICS_DEFINITIONS,type AnalyticsModule} from "../src/observability/analytics-snapshot.js";
import {assessGraphHealth} from "../src/tools/graph-health.js";
import {managedSourceWrite,prepareChangeReconciliation} from "../src/graph/change-obligations.js";
import {getRuntimeMetricsSnapshotV1} from "../src/observability/runtime-metrics.js";
const execute=promisify(execFile);let root:string;const oldRepos=config.repos,oldDb=config.database.connectionString;
const names=Object.keys(ANALYTICS_DEFINITIONS) as AnalyticsModule[];
const python=async(code:string,args:string[]=[])=>execute("python",["-c",code,...args],{env:{...process.env,PYTHONPATH:resolve("python"),PYTHONIOENCODING:"utf-8"},windowsHide:true,timeout:20000,maxBuffer:8*1024*1024});
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),"dg-analytics-"));await mkdir(join(root,"repo"));config.repos={fixture:join(root,"repo")};config.database.connectionString="";setDataDirOverride(root);});
afterEach(async()=>{vi.useRealTimers();vi.restoreAllMocks();await releaseGraphWriter(root);setDataDirOverride(undefined);config.repos=oldRepos;config.database.connectionString=oldDb;await rm(root,{recursive:true,force:true});});
async function baseline(){const files=["features.json","workflows.json","data_model.json","capabilities.json","datastores.json","auxiliary_entities.json","ui_registry.json"];
 const rows=files.map((file,index)=>{const row={id:index<2?"same":`id${index}`,name:`Component ${index}`,description:"A concrete responsibility with explicit ownership, interaction contracts and source-grounded context for architecture questions.",intent:"Preserve source-grounded architecture and interaction ownership",domain:index===6?undefined:"core",source_repo:"fixture",source_files:["a.ts"],keywords:["architecture"],tags:["core"],enrichment:{enriched:true},steps:["verify"],key_fields:["id"],tables:["main"],last_scanned_at:"2020-01-01T00:00:00.000Z",data_contract:{inputs:["id"]},interactions:[],visual_semantics:{},layout_semantics:{},links:index===0?[{target:"same",type:"workflow",target_repository_id:"fixture",relationship:"uses"}]:[]};return {file,content:JSON.stringify(index===5?{entries:[row]}:index===6?{metadata:{},elements:[row]}:[row])};});
 await writeFile(join(root,"repo","a.ts"),"before");
 await commitGraphWrites({actor:"fixture_initial_scan",operation_id:"initial-scan",writes:rows,source_reconciliation:{revision:"initial-scan",scope:["source:fixture/a.ts"],full:true}});
}
async function compareAll(){const exported=await captureAnalyticsSnapshot(),file=join(root,"analytics-snapshot.json");await writeFile(file,JSON.stringify(exported));
 const p=JSON.parse(exported.payload_json);const result=await python("import importlib,json,sys\nfrom pathlib import Path\nnames=json.loads(sys.argv[2])\nprint(json.dumps({name:importlib.import_module('analytics.'+name).analyze(Path(sys.argv[1])) for name in names},ensure_ascii=False,allow_nan=False))",[file,JSON.stringify(names)]);
 const reports=JSON.parse(result.stdout);for(const name of names){expect(reports[name].measurement,name).toEqual(measureAnalytics(name,p));expect(reports[name].snapshot.revision).toEqual(p.revision);expect(reports[name].definition.version).toBe("2.0.0");}return {p,reports,exported,file};
}
it("all13 actual Python modules agree with core on seven families, colliding legacy IDs, exact typed links and unknown domains",async()=>{
 await baseline();const {reports}=await compareAll();expect(reports.domain_saturation.measurement).toMatchObject({facts:7,known_domains:6,unknown_domains:1});expect(reports.orphan_pressure.measurement).toMatchObject({facts:7,connected:2,isolated:5,unresolved_endpoints:0});expect(reports.domain_entropy.measurement.population_state).toBe("concentrated");expect(reports.model_impact.measurement.task_usefulness).toBeNull();
});
it("all13 empty denominators remain unavailable and raw files require explicit unverified compatibility",async()=>{
 const {reports}=await compareAll();expect(reports.promotion_funnel.measurement.support_ratio).toBeNull();expect(reports.domain_entropy.measurement).toMatchObject({population_state:"empty",entropy_bits:null});
 await expect(python("from analytics import tension_flow\nfrom pathlib import Path\nimport sys\ntension_flow.analyze(Path(sys.argv[1]))",[join(root,"repo")])).rejects.toThrow("ANALYTICS_SNAPSHOT_REQUIRED");
});
it("history totals distinguish decay, retained closures and reopenings; duplicate sessions cannot inflate activity",async()=>{
 await baseline();const session={session_id:"cycle1",timestamp:"2026-01-01T00:00:00.000Z",cycle_number:1,strategy:"all",tension_signals_created:5,tension_signals_resolved:1,tensions_expired:1,tensions_decayed:100,generated_edges:0,generated_nodes:0};
 await commitGraphWrites({actor:"fixture_history",writes:[{file:"dream_history.json",content:JSON.stringify({sessions:[session,session]})},{file:"tension_log.json",content:JSON.stringify({signals:[],resolved_tensions:[{tension_id:"risk-one",resolved_at:"2026-01-01T02:00:00.000Z",reopened_at:"2026-01-02T00:00:00.000Z",resolution_state:"human_disposition",original:{first_seen:"2026-01-01T00:00:00.000Z",entities:["same"],type:"missing_link"}},{tension_id:"risk-two",resolved_at:"2026-01-01T03:00:00.000Z",resolution_state:"expired_unverified",original:{first_seen:"2026-01-01T01:00:00.000Z",entities:["same"],type:"missing_link"}}]})}]});
 const {reports}=await compareAll();expect(reports.tension_flow.measurement).toMatchObject({sessions:1,net_change:3,decayed:100,initial_active:null});expect(reports.tension_halflife.measurement).toMatchObject({closures:2,median_seconds:7200});expect(reports.reappearance_rate.measurement).toMatchObject({closure_events:2,reopened_events:1,reappearance_ratio:.5});
});
it("one old full scan plus managed edits stays current after scoped reconciliation; unrelated mutations cannot hide a gap",async()=>{
 vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2020-01-01T00:00:00.000Z"));await baseline();vi.useRealTimers();
 const changed=await managedSourceWrite(join(root,"repo","a.ts"),"after","before");
 await commitGraphWrites({actor:"unrelated",writes:[{file:"capabilities.json",content:JSON.stringify([{id:"unrelated",name:"Unrelated"}])}]});
 const gap=await assessGraphHealth();expect(gap.state.freshness).toBe("stale");expect(gap.observations.some(o=>o.signal==="SOURCE_RECONCILIATION_PENDING")).toBe(true);expect(["healthy","excellent"]).not.toContain(gap.status);
 await withGraphReconciliation(async()=>{const writes=await prepareChangeReconciliation([changed.id],"scoped-reconcile");await commitGraphWrites({actor:"fixture_reconcile",operation_id:"scoped-reconcile",writes,source_reconciliation:{revision:"scoped-reconcile",scope:["source:fixture/a.ts"],full:false}});});
 const current=await assessGraphHealth();expect(current.currency.last_full_scan_at).toBe("2020-01-01T00:00:00.000Z");expect(current.state.freshness).toBe("current");expect(current.status).toBe("healthy");expect(current.observations.some(o=>o.signal==="stale_scan")).toBe(false);expect(current.dimensions.workload.optional_pending_regions).toBe(1);
 const {reports}=await compareAll();expect(reports.maturity_score.measurement.freshness).toBe("current");expect(reports.cognitive_load.measurement.required_reconciliation_regions).toBe(0);
});
it("corrupt/unpublished inputs and a tampered export never become empty healthy success",async()=>{
 await baseline();const {file,exported}=await compareAll();await writeFile(file,JSON.stringify({...exported,payload_json:exported.payload_json+" "}));await expect(python("from analytics.loader import read_snapshot\nfrom pathlib import Path\nimport sys\nread_snapshot(Path(sys.argv[1]))",[file])).rejects.toThrow("HASH_MISMATCH");
 await writeFile(join(root,"features.json"),"{broken");const damaged=JSON.parse((await captureAnalyticsSnapshot()).payload_json);expect(damaged.state.completeness).toBe("partial");expect(damaged.state.reasons.some((r:{scope:string[]})=>r.scope.includes("features.json"))).toBe(true);await expect(assessGraphHealth()).rejects.toThrow();
});
it("export capture is immutable across later publications and Python rejects a hash-valid invalid canonical schema",async()=>{
 await baseline();const {file,exported,p}=await compareAll();
 await commitGraphWrites({actor:"later",writes:[{file:"features.json",content:"[]"}]});
 const retained=await python("import json,sys\nfrom pathlib import Path\nfrom analytics import domain_saturation\nprint(json.dumps(domain_saturation.analyze(Path(sys.argv[1]))['measurement']))",[file]);expect(JSON.parse(retained.stdout).facts).toBe(7);
 p.entities[0].confidence=1.5;const body=JSON.stringify(p),{createHash}=await import("node:crypto");await writeFile(file,JSON.stringify({...exported,payload_json:body,payload_sha256:createHash("sha256").update(body).digest("hex")}));
 await expect(python("from analytics.loader import read_snapshot\nfrom pathlib import Path\nimport sys\nread_snapshot(Path(sys.argv[1]))",[file])).rejects.toThrow("ANALYTICS_SCHEMA");
});
it("runtime reports actual sample windows and never confuses delivered context or missing usage with understanding or dead features",async()=>{
 await baseline();const snapshot=await getRuntimeMetricsSnapshotV1();expect(snapshot.context_utility).toMatchObject({understood:null,verified_rereads_avoided:null});expect(snapshot.measurement_windows.explorer.maximum_samples).toBe(200);expect(snapshot.latency.by_operation_class.every(r=>r.p50_ms===null&&r.p95_ms===null)).toBe(true);expect(snapshot.features.dead_candidates[0].reason).toContain("does not establish a dead feature");
});
