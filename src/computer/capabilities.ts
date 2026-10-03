/** Trusted local probes, not model claims. Native CLI and API harness never silently replace one another. */
import { z } from "zod";
import { ComputerActionSchema, ComputerCapabilitySchema } from "../graph/contracts.js";
import { computerDigest } from "./digest.js";
const id=z.string().min(1).max(256),digest=z.string().regex(/^sha256:[a-f0-9]{64}$/);
const operations=z.array(ComputerActionSchema.shape.operation).max(16);
export const ComputerWorkerProbeSchema=z.object({protocol:z.literal("dreamgraph.computer_worker.v1"),backend:id,backend_version:id,
  adapter:id,adapter_version:id,platform:z.enum(["win32","darwin","linux"]),architecture:id,host_id:id,epoch:id,
  route:z.enum(["native_cli","dreamgraph_harness"]),profile_hash:digest,supported:operations,permitted:operations,
  evidence_granularity:z.enum(["action","aggregate","none"]),isolated:z.boolean(),
  scope_enforced:z.boolean(),bounded_actions:z.boolean(),privacy_enforced:z.boolean(),independent_stop:z.boolean(),
  physical_seat:z.enum(["not_used","worker_owned_kernel_lease","unqualified"]),
  qualification_hash:digest.nullable(),reasons:z.array(id).max(32)}).strict();
export const ComputerQualificationSchema=z.object({schema:z.literal("dreamgraph.computer_qualification.v1"),
  backend:id,backend_version:id,platform:z.enum(["win32","darwin","linux"]),architecture:id,
  source_hash:digest,protocol_hash:digest,qualified_at:z.string().datetime({offset:true}),
  evidence_scope:z.enum(["declared_fixture","actual_runtime"]),
  scope_negative_passed:z.boolean(),privacy_passed:z.boolean(),bounded_actions_passed:z.boolean(),
  stop_release_ms:z.number().finite().min(0).max(1000),control_loss_stop_ms:z.number().finite().min(0).max(5000),
  cases:z.array(z.string().regex(/^CU(?:0[1-9]|1\d|2[0-4])$/)).min(1).max(24),artifact_hash:digest}).strict();
export type ComputerWorkerProbe=z.infer<typeof ComputerWorkerProbeSchema>;
export type ComputerQualification=z.infer<typeof ComputerQualificationSchema>;
export function negotiateComputerCapability(input:{adapter_kind:"native_api"|"native_cli";adapter:string;adapter_version:string;
  requested:ComputerWorkerProbe["supported"];enabled:boolean;selected_route:"auto"|"native_cli"|"dreamgraph_harness";
  probe?:ComputerWorkerProbe;qualification?:ComputerQualification;allow_declared_fixture?:boolean}){
  const requested=[...new Set(operations.parse(input.requested))],reasons:string[]=[];
  const expected=input.adapter_kind==="native_cli"?"native_cli":"dreamgraph_harness";
  if(!input.enabled)reasons.push("COMPUTER_DISABLED");
  if(input.selected_route!=="auto"&&input.selected_route!==expected)reasons.push("COMPUTER_SELECT_MATCHING_ADAPTER_FOR_ROUTE");
  const probe=input.probe?ComputerWorkerProbeSchema.parse(input.probe):undefined;
  const qualification=input.qualification?ComputerQualificationSchema.parse(input.qualification):undefined;
  if(!probe)reasons.push(expected==="native_cli"?"COMPUTER_NATIVE_CLI_CONFORMANCE_UNAVAILABLE":"COMPUTER_WORKER_UNAVAILABLE");
  else {
    if(probe.adapter!==input.adapter||probe.adapter_version!==input.adapter_version||probe.route!==expected)reasons.push("COMPUTER_ADAPTER_PROBE_MISMATCH");
    if(!probe.scope_enforced)reasons.push("COMPUTER_SCOPE_UNQUALIFIED");
    if(!probe.bounded_actions)reasons.push("COMPUTER_ACTION_LIMIT_UNQUALIFIED");
    if(!probe.privacy_enforced)reasons.push("COMPUTER_PRIVACY_UNQUALIFIED");
    if(!probe.independent_stop)reasons.push("COMPUTER_INDEPENDENT_STOP_UNQUALIFIED");
    if(probe.evidence_granularity==="none")reasons.push("COMPUTER_EVIDENCE_UNAVAILABLE");
    if(!probe.isolated&&probe.physical_seat!=="worker_owned_kernel_lease")reasons.push("COMPUTER_PHYSICAL_SEAT_UNQUALIFIED");
    if(!qualification||computerDigest(qualification)!==probe.qualification_hash)reasons.push("COMPUTER_RUNTIME_QUALIFICATION_REQUIRED");
    else {
      if(qualification.backend!==probe.backend||qualification.backend_version!==probe.backend_version||qualification.platform!==probe.platform
        ||qualification.architecture!==probe.architecture||qualification.protocol_hash!==computerDigest("dreamgraph.computer_worker.v1"))reasons.push("COMPUTER_QUALIFICATION_PIN_MISMATCH");
      if(qualification.evidence_scope!=="actual_runtime"&&!input.allow_declared_fixture)reasons.push("COMPUTER_ACTUAL_RUNTIME_QUALIFICATION_REQUIRED");
      if(!qualification.scope_negative_passed||!qualification.privacy_passed||!qualification.bounded_actions_passed)reasons.push("COMPUTER_MANDATORY_CONFORMANCE_FAILED");
      if(!["CU04","CU05","CU10","CU20","CU24"].every(id=>qualification.cases.includes(id)))reasons.push("COMPUTER_MANDATORY_CASES_MISSING");
    }
  }
  const supported=probe?[...new Set(probe.supported)]:[],permitted=probe?[...new Set(probe.permitted)]:[];
  const effective=reasons.length?[]:requested.filter(operation=>supported.includes(operation)&&permitted.includes(operation));
  if(requested.some(operation=>!supported.includes(operation)))reasons.push("COMPUTER_REQUESTED_OPERATION_UNSUPPORTED");
  if(requested.some(operation=>supported.includes(operation)&&!permitted.includes(operation)))reasons.push("COMPUTER_REQUESTED_OPERATION_NOT_PERMITTED");
  // Partial capability is visible, but a missing mandatory requested operation blocks this task's activation.
  const available=!!effective.length&&requested.every(operation=>effective.includes(operation));
  return ComputerCapabilitySchema.parse({schema:"dreamgraph.computer_capability.v1",id:`computer-capability:${computerDigest({input:{adapter:input.adapter,version:input.adapter_version,requested,route:expected},probe,qualification:qualification?computerDigest(qualification):null}).slice(7)}`,
    adapter:input.adapter,adapter_version:input.adapter_version,backend_version:probe?.backend_version??null,route:available?expected:"unavailable",
    requested,supported,permitted,effective:available?effective:[],evidence_granularity:probe?.evidence_granularity??"none",
    independent_stop:probe?.independent_stop??false,reasons:[...new Set([...reasons,...probe?.reasons??[]])],qualified_at:available?qualification!.qualified_at:null});
}
