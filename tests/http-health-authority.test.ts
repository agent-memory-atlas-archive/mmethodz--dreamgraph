/** Actual HTTP authority/publication owners; all identities are declared disposable fixtures. */
import {afterEach,beforeEach,expect,it} from "vitest";
import {createServer,request,type Server} from "node:http";
import {mkdtemp,readFile,readdir,rm,writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {DaemonHttpAuthority} from "../src/server/http-authority.js";
import {getDataDir,setDataDirOverride} from "../src/utils/paths.js";
import {commitGraphWrites} from "../src/graph/publication.js";
import {releaseGraphWriter} from "../src/graph/writer-lease.js";
import {getSessionContext,withSessionContext} from "../src/server/session-context.js";
let root:string,previous:string,server:Server,base:string,authority:DaemonHttpAuthority;
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),"dg-stateless-health-"));previous=getDataDir();setDataDirOverride(root);authority=new DaemonHttpAuthority(0,{});
 server=createServer(async(req,res)=>{try{const identity=await authority.authorize(req,res);if(!identity)return;
  await withSessionContext(identity,async()=>{if(await authority.handle(req,res,identity))return;
   if(req.method==="GET"&&new URL(req.url!,base).pathname==="/health"){res.setHeader("Content-Type","application/json");res.end(JSON.stringify({status:"ok",channel:getSessionContext()!.channel}));return;}res.statusCode=404;res.end();});
 }catch(error){res.statusCode=500;res.end(String(error));}});
 await new Promise<void>(done=>server.listen(0,"127.0.0.1",done));base="http://127.0.0.1:"+(server.address() as {port:number}).port;
});
afterEach(async()=>{server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));await releaseGraphWriter(root);setDataDirOverride(previous);await rm(root,{recursive:true,force:true});});
const digest=(value:string)=>createHash("sha256").update(value).digest("hex");
async function fullSessions(){const now=new Date(),expires_at=new Date(now.getTime()+12*60*60*1000).toISOString(),sessions=Object.fromEntries(Array.from({length:512},(_,index)=>{
 const id=`declared-session-${index}`;return [id,{id,principal:authority.policy.principal,token_hash:digest("declared-fixture-secret"),created_at:now.toISOString(),expires_at,environment:{}}];}));
 await commitGraphWrites({actor:"declared-session-capacity-fixture",scope:["session_authority.json"],writes:[{file:"session_authority.json",content:JSON.stringify({
  schema:"dreamgraph.session_authority.v1",instance_id:authority.sessions.instance_id,revision:1,sessions,challenges:{},grants:{}})}]});
 return {session:await readFile(join(root,"session_authority.json"),"utf8"),publication:await readFile(join(root,"publication_state.json"),"utf8")};}
const get=(path:string,headers:Record<string,string>={})=>fetch(base+path,{headers,signal:AbortSignal.timeout(3000)});

it("native and browser health probes create no identity, cookie, grant, publication or private preference",async()=>{
 for(let batch=0;batch<8;batch++)await Promise.all(Array.from({length:8},async(_,index)=>{const response=await get("/health",index%2?{Accept:"text/html",Origin:base,"Sec-Fetch-Site":"same-origin"}:{Accept:"application/json"});
  expect(response.status).toBe(200);expect(response.headers.get("set-cookie")).toBeNull();expect(response.headers.get("x-dreamgraph-session")).toBeNull();expect(await response.json()).toEqual({status:"ok",channel:"stdio"});}));
 expect(await readdir(root)).toEqual([]);
 const owner=await get("/api/authority/v1/status"),token=owner.headers.get("x-dreamgraph-session")!;expect(token).toBeTruthy();await owner.json();
 const before=await readFile(join(root,"session_authority.json"),"utf8");await (await get("/health",{"X-DreamGraph-Session":token})).json();expect(await readFile(join(root,"session_authority.json"),"utf8")).toBe(before);
});
it("full session capacity leaves health available, refuses new identities promptly, and preserves existing owners",async()=>{
 const before=await fullSessions();for(let index=0;index<8;index++)expect((await get("/health")).status).toBe(200);
 const blocked=await get("/api/authority/v1/status");expect(blocked.status).toBe(503);expect(blocked.headers.get("retry-after")).toBe("30");expect(await blocked.json()).toMatchObject({error:"SESSION_CAPACITY"});
 const existing=await get("/api/authority/v1/status",{"X-DreamGraph-Session":"declared-session-0.declared-fixture-secret"});expect(existing.status).toBe(200);expect((await existing.json()).session_id).toBe("declared-session-0");
 expect(await readFile(join(root,"session_authority.json"),"utf8")).toBe(before.session);expect(await readFile(join(root,"publication_state.json"),"utf8")).toBe(before.publication);
});
it("an interrupted publication cannot make a liveness probe recover or mutate the graph",async()=>{
 const journal='{"schema":"declared-interrupted-fixture","status":"unknown"}\n';await writeFile(join(root,"reconciliation_journal.json"),journal);
 const response=await get("/health");expect(response.status).toBe(200);await response.json();expect(await readFile(join(root,"reconciliation_journal.json"),"utf8")).toBe(journal);
 expect(await readdir(root)).toEqual(["reconciliation_journal.json"]);
});
it("stateless health keeps remote authentication, origin and execution-transport restrictions",async()=>{
 const token="declared-remote-fixture-"+"k".repeat(40);authority=new DaemonHttpAuthority(0,{DREAMGRAPH_REMOTE_ENABLED:"true",DREAMGRAPH_REMOTE_TOKEN:token,DREAMGRAPH_HTTP_ALLOWED_HOSTS:'["127.0.0.1"]'});
 expect((await get("/health")).status).toBe(401);expect((await get("/health",{Authorization:"Bearer wrong"})).status).toBe(401);
 expect((await get("/health",{Authorization:"Bearer "+token,Origin:"https://foreign.example"})).status).toBe(403);
 expect((await get("/health",{Authorization:"Bearer "+token,"X-DreamGraph-Session":"dgexec.declared-worker"})).status).toBe(403);
 const allowed=await get("/health",{Authorization:"Bearer "+token});expect(allowed.status).toBe(200);await allowed.json();expect(allowed.headers.get("x-dreamgraph-session")).toBeNull();expect(await readdir(root)).toEqual([]);
 const invalidHost=await new Promise<number>((done,reject)=>{const req=request(base+"/health",{headers:{Host:"foreign.example:"+new URL(base).port,Authorization:"Bearer "+token}},res=>{res.resume();res.once("end",()=>done(res.statusCode!));});req.once("error",reject);req.end();});expect(invalidHost).toBe(403);
});
