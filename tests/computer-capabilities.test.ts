import {expect,it} from "vitest";
import {ComputerWorkerProbeSchema,negotiateComputerCapability,type ComputerQualification,type ComputerWorkerProbe} from "../src/computer/capabilities.js";
import {computerDigest} from "../src/computer/journal.js";
const qualification:ComputerQualification={schema:"dreamgraph.computer_qualification.v1",backend:"fixture",backend_version:"1",platform:process.platform as "win32",architecture:process.arch,
 source_hash:computerDigest("declared-synthetic-worker"),protocol_hash:computerDigest("dreamgraph.computer_worker.v1"),qualified_at:new Date().toISOString(),evidence_scope:"declared_fixture",scope_negative_passed:true,privacy_passed:true,bounded_actions_passed:true,stop_release_ms:10,control_loss_stop_ms:100,cases:["CU04","CU05","CU10","CU20","CU24"],artifact_hash:computerDigest("declared-fixture-trace")};
const probe:ComputerWorkerProbe={protocol:"dreamgraph.computer_worker.v1",backend:"fixture",backend_version:"1",adapter:"native-api",adapter_version:"1",platform:process.platform as "win32",architecture:process.arch,host_id:"host",epoch:"epoch",route:"dreamgraph_harness",profile_hash:computerDigest("fixture-profile"),supported:["click","type"],permitted:["click","type"],evidence_granularity:"action",isolated:true,scope_enforced:true,bounded_actions:true,privacy_enforced:true,independent_stop:true,physical_seat:"not_used",qualification_hash:computerDigest(qualification),reasons:[]};
const input={adapter_kind:"native_api" as const,adapter:"native-api",adapter_version:"1",requested:["click","type"] as ComputerWorkerProbe["supported"],enabled:true,selected_route:"auto" as const,probe,qualification,allow_declared_fixture:true};
it("negotiates the intersection and does not treat declared fixtures as product qualification",()=>{
 expect(negotiateComputerCapability(input)).toMatchObject({route:"dreamgraph_harness",effective:["click","type"]});
 expect(negotiateComputerCapability({...input,allow_declared_fixture:false})).toMatchObject({route:"unavailable",effective:[],qualified_at:null});
 expect(negotiateComputerCapability({...input,probe:{...probe,permitted:["click"]}}).reasons).toContain("COMPUTER_REQUESTED_OPERATION_NOT_PERMITTED");
 expect(negotiateComputerCapability({...input,requested:["native_task"]}).reasons).toContain("COMPUTER_REQUESTED_OPERATION_UNSUPPORTED");
});
it("native CLI cannot silently inherit a harness or infer native input authority from model/shell support",()=>{
 const cli={...input,adapter_kind:"native_cli" as const,adapter:"codex-cli",adapter_version:"0.159.2",probe:undefined,qualification:undefined};
 expect(negotiateComputerCapability(cli)).toMatchObject({route:"unavailable",effective:[],reasons:["COMPUTER_NATIVE_CLI_CONFORMANCE_UNAVAILABLE","COMPUTER_REQUESTED_OPERATION_UNSUPPORTED"]});
 expect(negotiateComputerCapability({...cli,probe,qualification}).reasons).toContain("COMPUTER_ADAPTER_PROBE_MISMATCH");
 expect(negotiateComputerCapability({...cli,selected_route:"dreamgraph_harness"}).reasons).toContain("COMPUTER_SELECT_MATCHING_ADAPTER_FOR_ROUTE");
});
it.each(["scope_enforced","bounded_actions","privacy_enforced","independent_stop"] as const)("mandatory %s cannot be relaxed by an otherwise qualified backend",field=>{
 const result=negotiateComputerCapability({...input,probe:{...probe,[field]:false}});expect(result.route).toBe("unavailable");expect(result.effective).toEqual([]);
});
it("rejects incompatible protocols, backend pin drift, missing compound proof and unleased physical input",()=>{
 expect(()=>ComputerWorkerProbeSchema.parse({...probe,protocol:"future"})).toThrow();
 const changed={...qualification,backend_version:"2"};expect(negotiateComputerCapability({...input,qualification:changed,probe:{...probe,qualification_hash:computerDigest(changed)}}).reasons).toContain("COMPUTER_QUALIFICATION_PIN_MISMATCH");
 const missing={...qualification,cases:["CU04"] as ComputerQualification["cases"]};expect(negotiateComputerCapability({...input,qualification:missing,probe:{...probe,qualification_hash:computerDigest(missing)}}).reasons).toContain("COMPUTER_MANDATORY_CASES_MISSING");
 expect(negotiateComputerCapability({...input,probe:{...probe,isolated:false}}).reasons).toContain("COMPUTER_PHYSICAL_SEAT_UNQUALIFIED");
});
