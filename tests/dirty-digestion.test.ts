import { beforeEach, afterEach, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../src/config/config.js";
import { managedSourceEffect,readDirtyPartitions,prepareChangeReconciliation,readChangeObligations } from "../src/graph/change-obligations.js";
import { commitGraphWrites } from "../src/graph/publication.js";
import { runDirtyDigestion,type DirtyStagePorts } from "../src/cognitive/digestion.js";
import { loadGraphMaintenanceState } from "../src/cognitive/graph-maintenance-state.js";
import { withGraphReconciliation } from "../src/utils/graph-reconciliation-barrier.js";
import { getDataDir,setDataDirOverride } from "../src/utils/paths.js";
import { releaseGraphWriter } from "../src/graph/writer-lease.js";
let root:string,directory:string,source:string,previous:string,repos:typeof config.repos;
beforeEach(async()=>{root=await fs.mkdtemp(join(tmpdir(),"dg-dirty-"));directory=join(root,"data");await fs.mkdir(directory);source=join(root,"a.ts");await fs.writeFile(source,"one");
 previous=getDataDir();setDataDirOverride(directory);repos=config.repos;config.repos={fixture:root};
 await commitGraphWrites({writes:[{file:"features.json",content:JSON.stringify([{id:"a",name:"A",source_repo:"fixture",source_files:["a.ts"],links:[]}])}]});});
afterEach(async()=>{vi.unstubAllEnvs();await releaseGraphWriter(directory);setDataDirOverride(previous);config.repos=repos;await fs.rm(root,{recursive:true,force:true});});
async function change(operation_id:string,text:string){return managedSourceEffect({operation_id,changes:[{file:source,content:text}],apply:()=>fs.writeFile(source,text)});}
async function reconcile(ids:string[],operation_id:string){await withGraphReconciliation(async()=>{
 const writes=await prepareChangeReconciliation(ids,operation_id);await commitGraphWrites({actor:"fixture_scan",operation_id,writes,source_reconciliation:{revision:operation_id,scope:["source:fixture/a.ts"],full:false}});
});}
const ports=(calls:string[]):DirtyStagePorts=>({enrichment:async(record)=>{calls.push(`enrichment:${record.generation}`);return{state:"complete",receipt_ids:[`enrichment:${record.id}`]};},
 digestion:async(record)=>{calls.push(`digestion:${record.generation}`);return{state:"complete",receipt_ids:[`digestion:${record.id}`]};}});
it("source debt is reconciled first; optional stages then share a bounded coalesced generation",async()=>{
 const first=await change("one","two"),second=await change("two","three");const calls:string[]=[];
 await runDirtyDigestion({debounce_ms:0,ports:ports(calls)});expect(calls).toEqual([]);
 await reconcile([first.id,second.id],"reconcile");expect((await readDirtyPartitions()).partitions[0]).toMatchObject({generation:2,state:"ready",pending_stages:["enrichment","digestion"]});
 await runDirtyDigestion({debounce_ms:0,ports:ports(calls)});await runDirtyDigestion({debounce_ms:0,ports:ports(calls)});await runDirtyDigestion({debounce_ms:0,ports:ports(calls)});
 expect(calls).toEqual(["enrichment:2","digestion:2"]);expect((await readDirtyPartitions()).partitions[0].state).toBe("settled");
 expect((await readChangeObligations()).entries.every(e=>e.state==="graph_committed")).toBe(true);
});
it("finishing G preserves G+1 and its reconciliation obligation",async()=>{
 const first=await change("one","two");await reconcile([first.id],"r1");let entered!:()=>void,release!:()=>void;const ready=new Promise<void>(resolve=>entered=resolve);
 const calls:string[]=[];const stagePorts=ports(calls);stagePorts.enrichment=async(record)=>{entered();await new Promise<void>(resolve=>release=resolve);return{state:"complete",receipt_ids:[`stage:${record.id}`]};};
 const running=runDirtyDigestion({debounce_ms:0,ports:stagePorts});await ready;const second=await change("two","three");release();await running;
 const partition=(await readDirtyPartitions()).partitions[0];expect(partition).toMatchObject({generation:2,running_generation:null,state:"awaiting_reconciliation",pending_stages:["reconciliation","enrichment","digestion"]});
 expect(partition.root_cause_ids).toContain(second.id);
});
it("unfunded optional cognition remains visible without making reconciled source facts stale",async()=>{
 vi.stubEnv("DREAMGRAPH_LLM_PROVIDER","openai");vi.stubEnv("DREAMGRAPH_LLM_MODEL","gpt-4.1");
 const entry=await change("one","two");await reconcile([entry.id],"r1");await runDirtyDigestion({debounce_ms:0});
 expect((await readDirtyPartitions()).partitions[0]).toMatchObject({state:"budget_blocked",pending_stages:["enrichment","digestion"]});
 expect((await loadGraphMaintenanceState()).digestion?.records[0]).toMatchObject({state:"budget_blocked",reason:"optional_cognition_unfunded_or_unconfigured"});
 expect((await readChangeObligations()).entries[0].state).toBe("graph_committed");
});
it("unknown affected scope never becomes an all-graph cognition request",async()=>{
 const other=join(root,"unmapped.ts");await fs.writeFile(other,"old");const entry=await managedSourceEffect({operation_id:"unknown",changes:[{file:other,content:"new"}],apply:()=>fs.writeFile(other,"new")});
 await reconcile([entry.id],"r1");const calls:string[]=[];await runDirtyDigestion({debounce_ms:0,ports:ports(calls)});
 expect(calls).toEqual([]);expect((await readDirtyPartitions()).partitions[0].state).toBe("partial");
 expect((await loadGraphMaintenanceState()).digestion?.records[0]).toMatchObject({state:"partial",job_id:"not_admitted",reason:"DIRTY_SCOPE_UNMAPPED"});
 await runDirtyDigestion({debounce_ms:0,ports:ports(calls)});expect(calls).toEqual([]);
});
