import {afterEach,beforeEach,expect,it} from "vitest";
import {createServer,type Server} from "node:http";
import {mkdtemp,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {handleApiRoute} from "../src/api/routes.js";
import {setDataDirOverride,getDataDir} from "../src/utils/paths.js";
import {commitGraphWrites} from "../src/graph/publication.js";
import {releaseGraphWriter} from "../src/graph/writer-lease.js";
import {loadCanonicalGraph} from "../src/graph/read-model.js";
import {buildContextPack} from "../src/graph/context-pack.js";
import {boundMachineResult,hasRequiredEvidence} from "../packages/token-economy/src/machine-result.js";
import {DaemonClient} from "../extensions/vscode/src/daemon-client.js";
import {compactSystemPrompt,compactToolResultContent} from "../extensions/vscode/src/request-compaction.js";
let directory:string,previous:string,server:Server,base:string;
beforeEach(async()=>{previous=getDataDir();directory=await mkdtemp(join(tmpdir(),"dg-client-context-"));setDataDirOverride(directory);
 await commitGraphWrites({actor:"fixture",scope:["features.json"],writes:[{file:"features.json",content:JSON.stringify({features:[{id:"shared",name:"Public",description:"Unicode é🙂 architectural fact",source_kind:"manual",links:[]}]})}]});
 server=createServer((req,res)=>{void handleApiRoute(req,res,new URL(req.url!,"http://localhost").pathname).then(handled=>{if(!handled){res.writeHead(404);res.end();}});});await new Promise<void>(done=>server.listen(0,"127.0.0.1",done));base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
});
afterEach(async()=>{server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));await releaseGraphWriter(directory);setDataDirOverride(previous);await rm(directory,{recursive:true,force:true});});
it("serves the exact canonical core context with an unattested external receipt and rejects oversized input",async()=>{
 const graph=await loadCanonicalGraph("legacy"),identity=graph.entities.find(entity=>entity.identity.id==="shared")!.identity;
 const request={query:"Public",mandatory_identities:[identity],token_budget:3000,depth:0,adapter:"vscode"};
 const reply=await fetch(base+"/api/context/v1",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(request)}),pack=await reply.json();
 expect(reply.status).toBe(200);const expected=buildContextPack(graph,request);
 expect(pack).toMatchObject({id:expected.id,revision:expected.revision,records:expected.records,context_text:expected.context_text,receipt:{delivery:"unattested"}});
 expect(pack.token_count).toBe(Buffer.byteLength(pack.context_text,"utf8"));expect(pack.token_count_method).toBe("utf8_byte_upper_bound");
 const oversized=await fetch(base+"/api/context/v1",{method:"POST",body:JSON.stringify({query:"x".repeat(70000)})});expect(oversized.status).toBe(400);
});
it("the actual VSCode client validates the generated canonical pack and preserves an HTTP failure",async()=>{
 const client=new DaemonClient({host:"127.0.0.1",port:(server.address() as {port:number}).port,timeoutMs:10000});
 const pack=await client.getContextPack({query:"Public",token_budget:3000,depth:0});expect(pack.receipt.adapter).toBe("vscode");expect(pack.receipt.delivery).toBe("unattested");
 await expect(client.getContextPack({query:"x".repeat(20000)})).rejects.toThrow();
 // Each generated request field is valid, while the complete UTF-8 body exceeds the server's independent 64 KiB transport ceiling.
 await expect(client.getContextPack({query:"漢".repeat(16000),mandatory_evidence_ids:Array(32).fill("x".repeat(1024))})).rejects.toThrow("HTTP 400");client.dispose();
});
it("oversized model-facing results retain mandatory graph receipts, mutation uncertainty and errors as whole JSON",async()=>{
 const pack=buildContextPack(await loadCanonicalGraph("legacy"),{query:"Public",token_budget:3000,adapter:"fixture"});
 const original=JSON.stringify({isError:true,structuredContent:{pack,obligation_id:"durable-op",error:{code:"OWNER_FAILURE"},extra:"x".repeat(20000)}});
 const bounded=JSON.parse(boundMachineResult(original,4000)!.content);
 expect(bounded.isError).toBe(true);expect(bounded.error.code).toBe("INSUFFICIENT_CONTEXT_BUDGET");
 expect(bounded.required_anchors).toContainEqual({obligation_id:"durable-op"});
 expect(bounded.required_anchors.find((anchor:any)=>anchor.schema===pack.schema).receipt).toMatchObject({id:pack.receipt.id,revision:pack.revision,delivery:"unattested"});
 expect(bounded.effect_status).toContain("omission_is_not_failure_or_rollback");
 expect(()=>boundMachineResult(original,100)).toThrow("MANDATORY_ANCHORS_EXCEED");
});
it("prose compaction cannot remove required ADR/graph anchors or alter literal tool source",()=>{
 const system="Identity\n"+"optional prose ".repeat(1500)+"\nADR-217: use governed CLI tools. dreamgraph.context_receipt.v1 receipt=exact";
 expect(hasRequiredEvidence(system)).toBe(true);expect(compactSystemPrompt(system,3)).toBe(system);
 const source="  é🙂\r\n\n\nfunction example() {}  ";expect(compactToolResultContent(source,3)).toBe(source);
});
it("timeout of a streaming response cannot cancel another request; disposal cancels all outstanding bodies",async()=>{
 const slow=createServer((req,res)=>{if(req.url==="/health"){setTimeout(()=>res.end(JSON.stringify({status:"ok"})),180);}else {res.writeHead(200,{"Content-Type":"application/json"});res.write('{"schema":');}});
 await new Promise<void>(done=>slow.listen(0,"127.0.0.1",done));const client=new DaemonClient({host:"127.0.0.1",port:(slow.address() as {port:number}).port,timeoutMs:350});
 try {
  const blocked=client.getContextPack({query:"fixture"});const observed=blocked.catch(error=>error);
  await new Promise(done=>setTimeout(done,220));const health=await client.getHealth();expect(health?.response).toMatchObject({status:"ok"});expect(await observed).toBeInstanceOf(Error);
  const other=client.getContextPack({query:"again"}).catch(error=>error);setTimeout(()=>client.dispose(),20);expect(await other).toBeInstanceOf(Error);
 }finally{client.dispose();slow.closeAllConnections();await new Promise<void>(done=>slow.close(()=>done()));}
});
