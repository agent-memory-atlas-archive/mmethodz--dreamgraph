/** Real C07 filesystem owner and HTTP ports; browser identities/qualification metadata are declared fixtures. */
import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {mkdtemp,mkdir,readFile,writeFile,readdir,rm,symlink} from "node:fs/promises";
import {createServer} from "node:http";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {inspectComputerConfiguration,applyComputerConfiguration,listComputerConfiguration,computerConfigurationSchemas} from "../src/computer/configuration.js";
import {handleComputerHttp} from "../src/computer/http.js";
import {releaseGraphWriter} from "../src/graph/writer-lease.js";
import {withSessionContext,type SessionContext} from "../src/server/session-context.js";
import * as lifecycle from "../src/instance/lifecycle.js";
import {computerDigest} from "../src/computer/digest.js";
import {browserWorkerSourceHash} from "../src/computer/browser-harness.js";
let root:string,context:SessionContext;
const own=<T>(work:()=>T)=>withSessionContext(context,work);
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),"dg-cu-config-"));await mkdir(join(root,"config"));await mkdir(join(root,"data"));
 context={principal:"declared-human",session_id:"human-one",channel:"browser",directory:join(root,"data"),environment:{},continuation_key:"private-fixture"};
 vi.spyOn(lifecycle,"getActiveScope").mockReturnValue({uuid:"fixture-instance",dataDir:context.directory,projectRoot:root,engineEnvPath:join(root,"config/engine.env")} as never);
});
afterEach(async()=>{vi.restoreAllMocks();try{for(const part of ["config/computer-use/workers","config/computer-use/targets"])await releaseGraphWriter(join(root,part)).catch(error=>{if(error.code!=="ENOENT")throw error;});}finally{await rm(root,{recursive:true,force:true});}});
const target=(id="local-target")=>({schema:"dreamgraph.browser_target_definition.v1",id,initial_url:"https://fixture.example/app",main_origin:"https://fixture.example",main_path_prefix:"/app",navigation:false,
 network:[{origin:"https://fixture.example",path_prefix:"/app",methods:["GET"],allow_query:false}],blocked_origins:[],elements:[{id:"status",selector:"#status",read_text:true,read_value:false,operations:[]}],
 postconditions:[{id:"ready",selector:"#status",kind:"text_equals",expected:"Ready"}],observation_bytes:4096,action_timeout_ms:2000,max_actions:1,
 images:{enabled:false,region:null,mask_selectors:[],max_bytes:0,max_count:0,total_bytes:0},redactions:["SYNTHETIC_PRIVATE"]});
async function request(id="local-target",operation_id="profile-one"){const state=await own(()=>inspectComputerConfiguration({kind:"target",id}));return {kind:"target",id,operation_id,expected_revision:state.revision,value:target(id)};}
it("schema-driven setup uses existing C07 receipts and exact recovery without engine enablement, graph writes or grants",async()=>{
 const before=await own(listComputerConfiguration);expect(before).toEqual([]);expect((await own(computerConfigurationSchemas)).target.type).toBe("object");const input=await request();
 const saved=await own(()=>applyComputerConfiguration(input));expect(saved.receipt.status).toBe("committed");expect(saved.result.value).toEqual(input.value);expect(saved.effective_state).toContain("no activation or grant");
 expect((await own(()=>applyComputerConfiguration(input))).receipt).toMatchObject({replayed:true,operation_id:"profile-one"});
 expect(await own(listComputerConfiguration)).toEqual([{kind:"target",id:"local-target"}]);expect(await readdir(context.directory)).toEqual([]);expect((await readdir(join(root,"config"))).includes("engine.env")).toBe(false);
});
it.each(["prepared","file_committed"])("an actual interruption after %s recovers through C07 and never mints replacement authority",async stage=>{
 const input=await request();await expect(own(()=>applyComputerConfiguration(input,step=>{if(step===stage)throw new Error("DECLARED_ACK_LOSS");}))).rejects.toThrow("ACK_LOSS");
 const recovered=await own(()=>applyComputerConfiguration(input));expect(recovered.receipt.replayed).toBe(true);expect(recovered.receipt.status).toBe(stage==="prepared"?"aborted":"committed");
 expect(recovered.result.value).toEqual(stage==="prepared"?null:input.value);
});
it("competing edits and reused operation IDs preserve the original file and require readback",async()=>{
 const first=await request();await own(()=>applyComputerConfiguration(first));const second=await request("local-target","profile-two");second.value.postconditions[0].expected="Current";await own(()=>applyComputerConfiguration(second));
 const replay=await own(()=>applyComputerConfiguration(first));expect(replay.receipt.replayed).toBe(true);expect(replay.result.value.postconditions[0].expected).toBe("Current");
 await expect(own(()=>applyComputerConfiguration({...first,operation_id:"new-stale"}))).rejects.toThrow("REVISION_CONFLICT");
 await expect(own(()=>applyComputerConfiguration({...first,value:second.value}))).rejects.toThrow("OPERATION_REUSE_CONFLICT");
});
it("typed and semantic scope errors reject before writes, including ID mismatch and out-of-scope initial URLs",async()=>{
 const input=await request();for(const value of [{...input.value,id:"other"},{...input.value,initial_url:"https://other.example/app"},{...input.value,postconditions:[{id:"bad",kind:"text_equals"}]},{...input.value,authority_bypass:true}])
  await expect(own(()=>applyComputerConfiguration({...input,value}))).rejects.toThrow();expect((await own(()=>inspectComputerConfiguration({kind:"target",id:input.id}))).value).toBeNull();
 await expect(own(()=>inspectComputerConfiguration({kind:"target",id:"../escape"}))).rejects.toThrow();await expect(own(()=>inspectComputerConfiguration({kind:"target",id:"CON"}))).rejects.toThrow();
});
it("physical configuration links cannot redirect profile installation outside this instance",async()=>{
 const outside=join(root,"outside");await mkdir(outside);await symlink(outside,join(root,"config/computer-use"),process.platform==="win32"?"junction":"dir");
 await expect(own(()=>inspectComputerConfiguration({kind:"target",id:"local-target"}))).rejects.toThrow("PHYSICAL_SCOPE_REJECTED");expect(await readdir(outside)).toEqual([]);
});
it("declared qualification can be stored as setup but cannot be displayed as current production support",async()=>{
 const state=await own(()=>inspectComputerConfiguration({kind:"worker",id:"local-browser"}));const value={schema:"dreamgraph.browser_install.v1",id:"local-browser",browser_executable:join(root,"fixture-browser"),browser_version:"fixture",runtime_version:"1.62.1",
  qualification:{schema:"dreamgraph.computer_qualification.v1",backend:"isolated_playwright",backend_version:`playwright-core@1.62.1/chromium@fixture/node@${process.versions.node}`,platform:process.platform,architecture:process.arch,source_hash:await browserWorkerSourceHash(),
   protocol_hash:computerDigest("dreamgraph.computer_worker.v1"),qualified_at:new Date().toISOString(),evidence_scope:"declared_fixture",scope_negative_passed:true,privacy_passed:true,bounded_actions_passed:true,stop_release_ms:1,control_loss_stop_ms:1,cases:["CU04","CU05","CU10","CU20","CU24"],artifact_hash:computerDigest("Declared fixture")}};
 const saved=await own(()=>applyComputerConfiguration({kind:"worker",id:value.id,expected_revision:state.revision,operation_id:"worker-one",value}));expect(saved.result.runtime_current).toBe(false);expect(saved.receipt.status).toBe("committed");
});
it("HTTP worker/model callers cannot read or change operator profiles and exact human saves remain bounded",async()=>{
 let transport=context;const server=createServer((req,res)=>withSessionContext(transport,()=>handleComputerHttp(req,res,new URL(req.url!,"http://local").pathname)));
 await new Promise<void>(done=>server.listen(0,"127.0.0.1",done));const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api/architect/v1/computer/`;
 try{const input=await request(),headers={"Content-Type":"application/json",Origin:new URL(base).origin,"Sec-Fetch-Mode":"cors"};
  const save=await fetch(base+"profiles/apply",{method:"POST",headers,body:JSON.stringify(input)});expect(save.status).toBe(200);expect((await save.json()).receipt.status).toBe("committed");
  const stale=await fetch(base+"profiles/apply",{method:"POST",headers,body:JSON.stringify({...input,operation_id:"stale"})});expect(stale.status).toBe(409);expect((await stale.json()).error).toBe("CONFIG_REVISION_CONFLICT");
  transport={...context,execution_policy:{id:"worker-execution"} as never};expect((await fetch(base+"profiles")).status).toBe(403);expect((await fetch(base+"profiles/apply",{method:"POST",headers,body:JSON.stringify(input)})).status).toBe(403);
  transport={...context,channel:"mcp"};expect((await fetch(base+"profiles")).status).toBe(403);transport=context;
  expect((await fetch(base+"profiles/apply",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(input)})).status).toBe(403);
 }finally{server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}
});
