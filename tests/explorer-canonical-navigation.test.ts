import {afterEach,beforeEach,expect,it} from "vitest";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createServer,type Server} from "node:http";
import {getDataDir,setDataDirOverride} from "../src/utils/paths.js";
import {releaseGraphWriter} from "../src/graph/writer-lease.js";
import {commitGraphWrites} from "../src/graph/publication.js";
import {loadCanonicalGraph} from "../src/graph/read-model.js";
import {buildCanonicalExplorerSnapshot,getGraphSnapshot, getExplorerGraphView, resetExplorerViews} from "../src/graph/snapshot.js";
import {getNodeRecord,getExplorerContext,getNeighborhood,search,getStats} from "../src/explorer/queries.js";
import {buildContextPack} from "../src/graph/context-pack.js";
import {graphIdentityKey} from "../src/graph/contracts.js";
import {handleExplorerRoute} from "../src/explorer/routes.js";
import {newerSnapshot,resolveViewIdentity,validateExplorerSnapshot} from "../explorer/src/view-contract.js";

let directory:string,previous:string,server:Server|undefined;
beforeEach(async()=>{resetExplorerViews();previous=getDataDir();directory=await mkdtemp(join(tmpdir(),"dg-explorer-canonical-"));setDataDirOverride(directory);});
afterEach(async()=>{if(server){server.closeAllConnections();await new Promise<void>(done=>server!.close(()=>done()));server=undefined;}await releaseGraphWriter(directory);setDataDirOverride(previous);await rm(directory,{recursive:true,force:true});});
async function fixture(neighbors=3){
 const rows=Array.from({length:neighbors},(_,i)=>({id:`n${i}`,name:`Scripts ${i}`,source_kind:"manual"}));
 const content={"features.json":{features:[{id:"Public",name:"Public",source_kind:"manual",links:rows.map(row=>({target:row.id,type:"feature",relationship:"contains"}))},...rows]},
  "workflows.json":{workflows:[{id:"Public",name:"Public workflow",source_kind:"manual"}]},"data_model.json":{data_model:[]},"capabilities.json":{capabilities:[]},"datastores.json":{datastores:[]},"auxiliary_entities.json":{entries:[]},"ui_registry.json":{elements:[]},
  "validated_edges.json":{edges:[{id:"legacy-claim",from:"n0",to:"n1",from_kind:"feature",to_kind:"feature",confidence:0.99,origin:"rem"}]},
  "dream_graph.json":{nodes:[],edges:[]},"candidate_edges.json":{results:[]},"tension_log.json":{signals:[],resolved_tensions:[]}};
 await commitGraphWrites({actor:"fixture",scope:Object.keys(content),writes:Object.entries(content).map(([file,value])=>({file,content:JSON.stringify(value)}))});
}
it("preserves typed collisions and current trust instead of raw historical validated styling",async()=>{
 await fixture();const snapshot=await getGraphSnapshot();expect(snapshot.version).toBe(2);expect(snapshot.representation).toBe("canonical");
 const matching=snapshot.nodes.filter(n=>n.identity?.id==="Public");expect(matching.map(n=>n.identity!.kind).sort()).toEqual(["feature","workflow"]);expect(matching[0].label).toBe("Public");
 await expect(getNodeRecord("Public")).rejects.toThrow("EXPLORER_AMBIGUOUS_ID");expect((await search("Public",null,25)).hits).toHaveLength(2);
 const feature=matching.find(n=>n.type==="feature")!,record=(await getNodeRecord(feature.id,snapshot.etag))!;
 expect(record.canonical?.identity).toEqual(feature.identity);expect(record.outgoing).toHaveLength(3);expect(record.revision).toEqual(snapshot.revision);
 expect(snapshot.edges.some(edge=>edge.kind==="validated")).toBe(false);expect(snapshot.edges.find(edge=>edge.kind==="latent")?.assertion_class).toBe("hypothesis");
 expect((await getStats()).confidence_mean).toBeNull();
 const graph=await loadCanonicalGraph("legacy"),actual=await getExplorerContext(feature.id,snapshot.etag);
 const agent=buildContextPack(graph,{query:"Public",mode:"entity_focused",mandatory_identities:[feature.identity!],depth:1,max_neighbors:12,max_records:24,token_budget:3000,adapter:"explorer"});
 expect(actual.context_text).toBe(agent.context_text);expect(actual.records).toEqual(agent.records);expect(actual.revision).toEqual(agent.revision);
 expect(validateExplorerSnapshot(snapshot)).toBe(snapshot);expect(()=>resolveViewIdentity(snapshot,"Public")).toThrow("ambiguous");
});
it("bounds dense neighborhoods and keeps details on the displayed revision across unrelated publications",async()=>{
 await fixture(260);const before=await getGraphSnapshot(),id=before.nodes.find(n=>n.identity?.kind==="feature"&&n.identity.id==="Public")!.id;
 const first=(await getNodeRecord(id,before.etag))!;expect(first.outgoing).toHaveLength(50);expect(first.relationships).toHaveLength(50);expect(first.adjacency).toMatchObject({outgoing_total:260,next_offset:50});
 expect((await getNodeRecord(id,before.etag,250))!.outgoing).toHaveLength(10);expect((await getNeighborhood(id,1,12))!).toMatchObject({truncated:true,root:id});
 await commitGraphWrites({actor:"fixture",scope:["capabilities.json"],writes:[{file:"capabilities.json",content:JSON.stringify({capabilities:[{id:"new",name:"New"}]})}]});
 expect((await getNodeRecord(id,before.etag))!.revision).toEqual(before.revision);
 expect((await getExplorerContext(id,before.etag)).revision).toEqual(before.revision);
 expect((await getStats(before.etag)).etag).toBe(before.etag);
 const after=await getGraphSnapshot();expect(newerSnapshot(after,before)).toBe(after);expect(newerSnapshot(after,{...after})).toBe(after);
 const tampered=structuredClone(after);tampered.nodes[0].identity!.instance_id="other";expect(()=>validateExplorerSnapshot(tampered)).toThrow("EXPLORER_IDENTITY_INVALID");
});
it("coalesces snapshot construction, retains three exact views and isolates physical directories",async()=>{
 await fixture();const views=await Promise.all(Array.from({length:8},()=>getExplorerGraphView()));
 expect(views.every(view=>view===views[0])).toBe(true);const original=views[0];
 for(let i=0;i<3;i++){
  await commitGraphWrites({actor:"fixture",scope:["capabilities.json"],writes:[{file:"capabilities.json",content:JSON.stringify({capabilities:[{id:`new${i}`,name:`New ${i}`}]})}]});
  const current=await getExplorerGraphView();expect(current.graph).not.toBe(original.graph);
 }
 await expect(getExplorerGraphView(original.snapshot.etag)).rejects.toThrow("EXPLORER_REVISION_CONFLICT");
 const last=await getExplorerGraphView(),other=await mkdtemp(join(tmpdir(),"dg-explorer-other-"));
 try {setDataDirOverride(other);await expect(getExplorerGraphView(last.snapshot.etag)).rejects.toThrow("EXPLORER_REVISION_CONFLICT");}
 finally{setDataDirOverride(directory);await rm(other,{recursive:true,force:true});}
});
it("pins actual HTTP inspection/context to render etag and maps ambiguous IDs to a specific conflict",async()=>{
 await fixture();server=createServer((req,res)=>{void handleExplorerRoute(req,res,new URL(req.url!,"http://localhost").pathname);});await new Promise<void>(done=>server!.listen(0,"127.0.0.1",done));
 const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`,snapshot=await (await fetch(url+"/explorer/api/graph-snapshot")).json();
 const id=snapshot.nodes.find((n:any)=>n.identity.kind==="feature"&&n.identity.id==="Public").id;
 expect((await fetch(url+"/explorer/api/node/Public")).status).toBe(409);
 const node=await (await fetch(url+`/explorer/api/node/${encodeURIComponent(id)}?etag=${encodeURIComponent(snapshot.etag)}`)).json();expect(node.canonical.identity.id).toBe("Public");
 const context=await (await fetch(url+`/explorer/api/context/${encodeURIComponent(id)}?etag=${encodeURIComponent(snapshot.etag)}`)).json();expect(context.records.some((row:any)=>row.id===id)).toBe(true);expect(context.receipt.adapter).toBe("explorer");
 expect((await fetch(url+`/explorer/api/node/${encodeURIComponent(id)}?etag=old`)).status).toBe(409);
 for(const path of ["candidates","tensions","stats"])expect((await fetch(url+`/explorer/api/${path}?etag=old`)).status).toBe(409);
});
it("discloses render exclusions and keeps metadata-only revisions from rebuilding the layout",async()=>{
 await fixture();const initial=await getGraphSnapshot();await commitGraphWrites({actor:"fixture",scope:["schedules.json"],writes:[{file:"schedules.json",content:"{}"}]});
 const metadata=await getGraphSnapshot();expect(metadata.etag).not.toBe(initial.etag);expect(metadata.render_key).toBe(initial.render_key);
 const graph=await loadCanonicalGraph("legacy"),root=graph.entities[0];
 const dense=Array.from({length:10005},(_,i)=>({...root,identity:{instance_id:"legacy",kind:"feature" as const,id:String(i)},label:`Node ${i}`}));
 const snapshot=buildCanonicalExplorerSnapshot({...graph,entities:dense,relationships:[]});expect(snapshot.nodes).toHaveLength(10000);expect(snapshot.scope?.omitted_nodes).toBe(5);expect(snapshot.state?.reasons.some(reason=>reason.code==="EXPLORER_RENDER_SCOPE")).toBe(true);
 expect(new Set(snapshot.nodes.map(node=>node.id)).size).toBe(10000);expect(snapshot.nodes.every(node=>node.id===graphIdentityKey(node.identity!))).toBe(true);
});
