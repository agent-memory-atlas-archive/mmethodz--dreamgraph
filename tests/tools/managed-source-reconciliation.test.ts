import { beforeEach, afterEach, it, expect, vi } from "vitest";
import fs from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {createHash} from "node:crypto";
import {config} from "../../src/config/config.js";
import {loadCanonicalGraph} from "../../src/graph/read-model.js";
import {buildContextPack} from "../../src/graph/context-pack.js";
import {getDataDir,setDataDirOverride} from "../../src/utils/paths.js";
import {releaseGraphWriter} from "../../src/graph/writer-lease.js";
import {commitGraphWrites,loadPublicationState} from "../../src/graph/publication.js";
import {managedSourceEffect,readChangeObligations,readDirtyPartitions,beginObservedSourceEffect} from "../../src/graph/change-obligations.js";
import {reconcileManagedSourceChanges} from "../../src/tools/managed-source-reconciliation.js";

let root:string,prior:string,repos:Record<string,string>;
const digest=(s:string)=>"sha256:"+createHash("sha256").update(s).digest("hex");
beforeEach(async()=>{
 prior=getDataDir();repos={...config.repos};root=await fs.mkdtemp(join(tmpdir(),"dg-scoped-reconcile-"));
 config.repos={fixture:root};setDataDirOverride(join(root,"data"));
});
afterEach(async()=>{vi.restoreAllMocks();await releaseGraphWriter(join(root,"data"));setDataDirOverride(prior);config.repos=repos;await fs.rm(root,{recursive:true,force:true});});
async function edit(rel:string,content:string|null,execution_id="run") {
 const file=join(root,rel);await fs.mkdir(join(file,".."),{recursive:true});
 return managedSourceEffect({execution_id,changes:[{file,content}],apply:()=>content===null?fs.unlink(file):fs.writeFile(file,content)});
}
async function rows(){const body=JSON.parse(await fs.readFile(join(root,"data","features.json"),"utf8"));return body.features??body;}

it("settles all named files without a repository walk, preserves assertions and does not perform enrichment",async()=>{
 await fs.mkdir(join(root,"src","group"),{recursive:true});
 await fs.writeFile(join(root,"src","group","0.ts"),"before");
 await commitGraphWrites({actor:"fixture",writes:[{file:"features.json",content:JSON.stringify({schema:"legacy",features:[
  {id:"fixture_src_group",name:"Group",source_repo:"fixture",source_files:["src/group/0.ts"],description:"Human meaning",manual_note:"Keep me"},
  {id:"unrelated",source_repo:"fixture",source_files:["untouched.ts"],description:"Unrelated"}
 ]})}]});
 for(let i=0;i<12;i++)await edit("src/group/"+i+".ts","export const n="+i+";");
 const before=await loadPublicationState();
 const walk=vi.spyOn(fs,"readdir").mockRejectedValue(new Error("REPOSITORY_WALK_FORBIDDEN"));
 expect(await reconcileManagedSourceChanges("run")).toEqual({reconciled:12,files:12});
 expect(walk).not.toHaveBeenCalled();
 const graph=await rows(),group=graph.find((row:any)=>row.id==="fixture_src_group");
 expect(group.source_files).toHaveLength(12);
 expect(group).toMatchObject({description:"Human meaning",manual_note:"Keep me",semantic_validity:{state:"review"}});
 expect(group.source_hashes["src/group/11.ts"]).toBe(digest("export const n=11;"));
 const pack=buildContextPack(await loadCanonicalGraph("fixture-instance"),{query:"Group",token_budget:6000});
 expect(pack.context_text).toContain('"semantic_validity":{"state":"review"');
 expect(pack.context_text).toContain("Human meaning");
 expect(graph.find((row:any)=>row.id==="unrelated")).toEqual({id:"unrelated",source_repo:"fixture",source_files:["untouched.ts"],description:"Unrelated"});
 expect(JSON.parse(await fs.readFile(join(root,"data","features.json"),"utf8")).schema).toBe("legacy");
 const publication=await loadPublicationState();
 expect(publication.currency.last_full_scan_at).toBe(before.currency.last_full_scan_at);
 const obligations=(await readChangeObligations()).entries;
 expect(obligations.every(item=>item.state==="graph_committed")).toBe(true);
 expect(new Set(obligations.map(item=>item.graph_receipt_id)).size).toBe(1);
 expect((await readDirtyPartitions()).partitions.every(p=>!p.pending_stages.includes("reconciliation")&&p.pending_stages.includes("enrichment"))).toBe(true);
 const stable=await loadPublicationState();
 expect(await reconcileManagedSourceChanges("run")).toEqual({reconciled:0,files:0});
 expect(await loadPublicationState()).toEqual(stable);
});

it("withdraws deleted and gitignored source support, while retaining unrelated supporters and records",async()=>{
 await fs.writeFile(join(root,"deleted.ts"),"before");
 await fs.writeFile(join(root,"ignored.ts"),"before");
 await commitGraphWrites({actor:"fixture",writes:[{file:"features.json",content:JSON.stringify({features:[
  {id:"deleted",source_repo:"fixture",source_files:["deleted.ts"],source_hashes:{"deleted.ts":digest("before")}},
  {id:"mixed",source_repo:"fixture",source_files:["ignored.ts","retained.ts"],source_hashes:{"ignored.ts":digest("before"),"retained.ts":digest("unchanged")}}
 ]})}]});
 await fs.writeFile(join(root,".gitignore"),"ignored.ts\n");
 await edit("deleted.ts",null);await edit("ignored.ts","after");
 expect(await reconcileManagedSourceChanges("run")).toEqual({reconciled:2,files:2});
 const graph=await rows();
 expect(graph.find((r:any)=>r.id==="deleted")).toMatchObject({status:"deprecated",source_files:[],source_hashes:{}});
 expect(graph.find((r:any)=>r.id==="mixed")).toMatchObject({source_files:["retained.ts"],source_hashes:{"retained.ts":digest("unchanged")}});
 expect(graph).toHaveLength(2); // excluded files do not generate new entities
});

it("refuses external changes and leaves the entire graph and obligation ledger uncommitted",async()=>{
 await edit("source.ts","known");
 await fs.writeFile(join(root,"source.ts"),"unrecorded");
 const before=await loadPublicationState(),ledger=await readChangeObligations();
 await expect(reconcileManagedSourceChanges("run")).rejects.toThrow("SOURCE_RECONCILIATION_SOURCE_CHANGED");
 expect(await readChangeObligations()).toEqual(ledger);expect(await loadPublicationState()).toEqual(before);
});
it("refuses unresolved process effects instead of sweeping repositories or reporting completion",async()=>{
 await beginObservedSourceEffect({operation_id:"unknown",execution_id:"run",actor:"fixture",repositories:["fixture"],before_hashes:{}});
 const before=await loadPublicationState();
 await expect(reconcileManagedSourceChanges("run")).rejects.toThrow("SOURCE_RECONCILIATION_EFFECT_UNKNOWN");
 expect((await readChangeObligations()).entries[0].state).toBe("intent");
 expect(await loadPublicationState()).toEqual(before);
});
