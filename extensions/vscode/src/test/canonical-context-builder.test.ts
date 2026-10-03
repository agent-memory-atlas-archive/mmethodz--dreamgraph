/** Actual compiled ContextBuilder and prompt renderer; only the editor/reader ports are doubles. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import vm from "node:vm";
import type { EditorContextEnvelope, ContextPlan } from "../types.js";
import { ContextPackSchema } from "../generated/graph-contracts.js";

const modulePath=join(__dirname,"..","context-builder.js"), realRequire=createRequire(modulePath);
const compiledModule={exports:{} as typeof import("../context-builder.js")};
vm.runInNewContext(readFileSync(modulePath,"utf8"),{module:compiledModule,exports:compiledModule.exports,
 require:(id:string)=>id==="vscode"?{workspace:{},window:{},commands:{},languages:{}}:realRequire(id),
 Buffer,process,console,setTimeout,clearTimeout,setInterval,clearInterval,__filename:modulePath,__dirname:join(__dirname,"..")},
 {filename:modulePath,importModuleDynamically:vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER});
const {ContextBuilder}=compiledModule.exports;
const revision={publication_sequence:1,graph_revision:"graph:fixture:1",domains:{graph:1}};
const currency={last_graph_mutation_at:null,last_full_scan_at:null,last_source_reconciliation_at:null,source_reconciliation_scope:[],source_reconciliation_revision:null};
const state={availability:"available",completeness:"complete",freshness:"unknown",reasons:[]};
const identity={instance_id:"fixture",kind:"feature",id:"same",repository_id:"repo-one"};
function pack(collision=false){
 const records=[{id:"feature-one",record_type:"entity",identity,assertion_class:"human_assertion",evidence_ids:["human:one"],mandatory:true,selection_reason:"required_identity"},
 ...(collision?[{id:"feature-two",record_type:"entity",identity:{...identity,repository_id:"repo-two"},assertion_class:"human_assertion",evidence_ids:[],mandatory:false,selection_reason:"query_match"}]:[])];
 const context_text='DreamGraph evidence fixture\n'+JSON.stringify({entity:"feature-one",label:"Canonical memory",assertion:"human_assertion",knowledge:"é🙂 source boundary"});
 return ContextPackSchema.parse({schema:"dreamgraph.context_pack.v1",id:"pack-one",instance_id:"fixture",revision,currency,state,context_text,token_budget:5000,
 token_count:Buffer.byteLength(context_text),token_count_method:"utf8_byte_upper_bound",metadata_budget_bytes:32768,records,mandatory_satisfied:true,omissions:[],source_fallback:[],
 receipt:{schema:"dreamgraph.context_receipt.v1",id:"receipt-one",instance_id:"fixture",execution_id:"unbound:fixture",revision,plan_id:null,slice_id:null,scope:["feature-one"],mandatory_evidence_ids:["feature-one"],selected_evidence_ids:["feature-one","human:one"],state,issued_at:"2026-10-01T00:00:00.000Z",expires_at:null,adapter:"vscode",delivery:"unattested"}});
}
const plan:ContextPlan={intentMode:"ask_dreamgraph",taskSummary:"Explain canonical memory",secondaryAnchors:[],requiredEvidence:["task"],optionalEvidence:[],codeReadPlan:[],
 budgetPolicy:{maxTokens:12000,reserveTokens:800,reserveGraphTokens:1200,includeOptionalEvidence:false,allowFullActiveFile:false}};
const envelope=()=>({graphContext:null,activeFile:null,visibleFiles:[],intentMode:"ask_dreamgraph",intentConfidence:1} as unknown as EditorContextEnvelope);
function builder(port:any){const result=new ContextBuilder({} as any,port,{maxContextTokens:12000,instance:null});result.createContextPlan=async()=>plan;return result;}
test("canonical graph context reaches the actual model-facing packet at high pressure, with exact receipt and Unicode evidence",async()=>{
 let calls=0;const context=pack(),client={getContextPack:async()=>{calls++;return context;},getGraphContext:async()=>{throw new Error("legacy path must not run");}};
 const host=builder(client),input=envelope();input.graphContext=await host.resolveGraphContext(input,plan);
 const packet=await host.buildReasoningPacket(input,{coordinator:{recordComponentActual(){},getContextPressureLabel:()=>"high",getRemainingTargetTokens:()=>0}});
 const rendered=host.renderReasoningPacket(packet);
 assert.equal(calls,1);assert.ok(rendered.text.includes(context.context_text));assert.ok(rendered.text.includes('"id":"receipt-one"'));assert.ok(rendered.text.includes('"delivery":"unattested"'));
 assert.equal(packet.evidence[0].kind,"graph_context");assert.equal(packet.omitted.some(item=>item.kind==="graph_context"),false);
});
test("a missing canonical capability is visible in the prompt and does not silently call the legacy data projection",async()=>{
 const host=builder({getContextPack:async()=>{throw new Error("HTTP 404");},getGraphContext:async()=>{throw new Error("incorrect fallback");}}),input=envelope();
 input.graphContext=await host.resolveGraphContext(input,plan);const packet=await host.buildReasoningPacket(input);const rendered=host.renderReasoningPacket(packet);
 assert.ok(rendered.text.includes("CANONICAL_CONTEXT_UNAVAILABLE"));assert.ok(rendered.text.includes("HTTP 404"));assert.ok(rendered.text.includes("never evidence of staleness"));
});
test("required graph records borrow optional space within the same total bound; they never disappear when too large",async()=>{
 const host=builder({getContextPack:async()=>pack()}),input=envelope();input.graphContext=await host.resolveGraphContext(input,plan);
 let packet=await host.buildReasoningPacket(input);assert.ok(packet.evidence.some(item=>item.kind==="graph_context"));assert.ok(packet.tokenUsage.used<=packet.tokenUsage.budget);
 host.createContextPlan=async()=>({...plan,budgetPolicy:{...plan.budgetPolicy,maxTokens:200,reserveTokens:0,reserveGraphTokens:100}});
 await assert.rejects(host.buildReasoningPacket(input),/MANDATORY_CONTEXT_EXCEEDS_REQUEST_BUDGET/);
});
test("repository-local ID collisions remain in the whole canonical pack without manufacturing a navigation identity",async()=>{
 const host=builder({getContextPack:async()=>pack(true)}),input=envelope(),context=await host.resolveGraphContext(input,plan);
 assert.equal(context?.relatedFeatures.length,0);assert.equal(context?.canonicalPack?.records.length,2);
});
