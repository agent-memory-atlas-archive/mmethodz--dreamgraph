/** Real configuration/session owners; the operator qualification metadata is an explicit registration fixture, not an OS qualification. No browser/model is launched. */
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {mkdir,mkdtemp,readFile,rm,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import * as lifecycle from "../src/instance/lifecycle.js";
import {setDataDirOverride} from "../src/utils/paths.js";
import {releaseGraphWriter} from "../src/graph/writer-lease.js";
import {SessionAuthority} from "../src/server/session-authority.js";
import {withSessionContext,type SessionContext} from "../src/server/session-context.js";
import {DEFAULT_COMPUTER_USE_SETTINGS} from "../src/config/engine-settings.js";
import {inspectComputerSetup,prepareConfiguredComputer,confirmConfiguredComputer,claimConfiguredComputer,createPreparedWorker,preparedComputerModelBinding} from "../src/computer/browser-registry.js";
import {browserWorkerSourceHash} from "../src/computer/browser-harness.js";
import {computerDigest} from "../src/computer/digest.js";
let root:string,owner:SessionContext,foreign:SessionContext,prior:string|undefined,workerPath:string,targetPath:string;
let install:Record<string,unknown>,target:Record<string,unknown>;
const within=<T>(work:()=>T)=>withSessionContext(owner,work);
beforeEach(async()=>{
 root=await mkdtemp(join(tmpdir(),"dg-computer-registry-"));await mkdir(join(root,"data"));await mkdir(join(root,"config/computer-use/workers"),{recursive:true});await mkdir(join(root,"config/computer-use/targets"));setDataDirOverride(join(root,"data"));
 vi.spyOn(lifecycle,"getActiveScope").mockReturnValue({uuid:"fixture-instance",dataDir:join(root,"data"),engineEnvPath:join(root,"config/engine.env"),projectRoot:root} as never);
 const authority=new SessionAuthority("fixture-instance",join(root,"data"));owner=(await authority.create("operator")).context;foreign=(await authority.create("operator")).context;
 prior=process.env.DREAMGRAPH_COMPUTER_USE;process.env.DREAMGRAPH_COMPUTER_USE=JSON.stringify({...DEFAULT_COMPUTER_USE_SETTINGS,enabled:true,worker_profile:"fixture-worker",target_profile:"fixture-target",max_actions:3,max_images:0,max_image_bytes:0,elapsed_ms:30000});
 install={schema:"dreamgraph.browser_install.v1",id:"fixture-worker",browser_executable:join(root,"declared-browser-executable"),browser_version:"fixture-version",runtime_version:"1.62.1",
  qualification:{schema:"dreamgraph.computer_qualification.v1",backend:"isolated_playwright",backend_version:`playwright-core@1.62.1/chromium@fixture-version/node@${process.versions.node}`,platform:process.platform,architecture:process.arch,
   source_hash:await browserWorkerSourceHash(),protocol_hash:computerDigest("dreamgraph.computer_worker.v1"),qualified_at:new Date().toISOString(),evidence_scope:"actual_runtime",scope_negative_passed:true,privacy_passed:true,bounded_actions_passed:true,
   stop_release_ms:100,control_loss_stop_ms:100,cases:["CU04","CU05","CU10","CU20","CU24"],artifact_hash:computerDigest("DECLARED_REGISTRATION_FIXTURE_NO_BROWSER_LAUNCHED")}};
 target={schema:"dreamgraph.browser_target_definition.v1",id:"fixture-target",initial_url:"https://fixture.example/app",main_origin:"https://fixture.example",main_path_prefix:"/app",navigation:true,
  network:[{origin:"https://fixture.example",path_prefix:"/app",methods:["GET"],allow_query:false}],blocked_origins:[],elements:[{id:"status",selector:"#status",read_text:true,read_value:false,operations:["click"]}],
  postconditions:[{id:"visible",selector:"#status",kind:"visible"}],observation_bytes:2048,action_timeout_ms:1000,max_actions:10,
  images:{enabled:false,region:null,mask_selectors:[],max_bytes:0,max_count:0,total_bytes:0},redactions:["SYNTHETIC_SECRET"]};
 workerPath=join(root,"config/computer-use/workers/fixture-worker.json");targetPath=join(root,"config/computer-use/targets/fixture-target.json");await writeFile(workerPath,JSON.stringify(install));await writeFile(targetPath,JSON.stringify(target));
});
afterEach(async()=>{vi.restoreAllMocks();vi.unstubAllEnvs();if(prior===undefined)delete process.env.DREAMGRAPH_COMPUTER_USE;else process.env.DREAMGRAPH_COMPUTER_USE=prior;
 await releaseGraphWriter(join(root,"data"));setDataDirOverride(null);await rm(root,{recursive:true,force:true});});
const prepareRole=()=>{for(const [suffix,value]of Object.entries({PROVIDER:"openai",MODEL:"gpt-5.4",API:"responses",URL:"http://127.0.0.1:1/v1",API_KEY:"SYNTHETIC_ROLE_CREDENTIAL",REASONING_EFFORT:"none",STRICT_SCHEMA:"false",RETENTION:"store_false"}))vi.stubEnv("DREAMGRAPH_LLM_COMPUTER_USE_"+suffix,value);};
it("a dedicated model role is explicitly selected, shown without secrets and pinned before confirmation and dispatch",()=>within(async()=>{
 prepareRole();const prepared=await prepareConfiguredComputer({adapter:"native_api_tool_loop",interact:false,duration_ms:10000,model_role:"computer_use"});
 expect(prepared.model).toMatchObject({role:"computer_use",provider:"openai",model:"gpt-5.4",api:"responses",retention:{requested:"store_false"}});expect(JSON.stringify(prepared)).not.toContain("SYNTHETIC_ROLE_CREDENTIAL");
 expect(await new SessionAuthority("fixture-instance",join(root,"data")).ownGrants(owner)).toEqual([]);
 await confirmConfiguredComputer({id:prepared.id,human_confirmed:true});const claimed=await claimConfiguredComputer(prepared.id,"native_api_tool_loop"),bound=await preparedComputerModelBinding(claimed);
 expect(bound!.config).toMatchObject({model:"gpt-5.4",api:"responses",store:false,admissionPolicy:{policy:{role:"computer_use"}}});
 const changed=structuredClone(claimed.preparation);changed.setup.model_role="architect";await expect(preparedComputerModelBinding({...claimed,preparation:changed})).rejects.toThrow("ORIGINAL_PREPARATION_CHANGED");
 vi.stubEnv("DREAMGRAPH_LLM_COMPUTER_USE_MODEL","gpt-5.5");await expect(preparedComputerModelBinding(claimed)).rejects.toThrow("PREPARATION_MODEL_CHANGED");
}));
it("model changes before confirmation require a new reviewed preparation instead of silent escalation",()=>within(async()=>{
 prepareRole();const prepared=await prepareConfiguredComputer({adapter:"native_api_tool_loop",interact:false,duration_ms:10000,model_role:"computer_use"});
 vi.stubEnv("DREAMGRAPH_LLM_COMPUTER_USE_MODEL","gpt-6.1-sol");await expect(confirmConfiguredComputer({id:prepared.id,human_confirmed:true})).rejects.toThrow("PREPARATION_MODEL_CHANGED");
 expect(await new SessionAuthority("fixture-instance",join(root,"data")).ownGrants(owner)).toEqual([]);
}));
it("an API worker cannot borrow an unqualified native CLI model role or unsupported tool protocol",()=>within(async()=>{
 prepareRole();vi.stubEnv("DREAMGRAPH_LLM_COMPUTER_USE_ADAPTER","codex-cli");vi.stubEnv("DREAMGRAPH_LLM_COMPUTER_USE_API","native_cli");
 await expect(prepareConfiguredComputer({adapter:"native_api_tool_loop",interact:false,duration_ms:10000,model_role:"computer_use"})).rejects.toThrow("MODEL_ROLE_UNQUALIFIED");
 vi.stubEnv("DREAMGRAPH_LLM_COMPUTER_USE_ADAPTER","openai-api");vi.stubEnv("DREAMGRAPH_LLM_COMPUTER_USE_API","chat_completions");vi.stubEnv("DREAMGRAPH_LLM_COMPUTER_USE_MODEL","gpt-6.1-sol");vi.stubEnv("DREAMGRAPH_LLM_COMPUTER_USE_REASONING_EFFORT","high");
 await expect(prepareConfiguredComputer({adapter:"native_api_tool_loop",interact:false,duration_ms:10000,model_role:"computer_use"})).rejects.toThrow("MODEL_TOOLS_UNSUPPORTED");
}));
it("preflight and selection create no grant; human confirmation pins finite scope and exact lost reply",async()=>within(async()=>{
 const inspected=await inspectComputerSetup("native_api_tool_loop");expect(inspected.available).toBe(true);expect(JSON.stringify(inspected)).not.toContain(root);expect(JSON.stringify(inspected)).not.toContain("SYNTHETIC_SECRET");
 const prepared=await prepareConfiguredComputer({adapter:"native_api_tool_loop",interact:false,duration_ms:10000});
 const authority=new SessionAuthority("fixture-instance",join(root,"data"));expect(await authority.ownGrants(owner)).toEqual([]);expect(prepared.limits.max_actions).toBe(3);
 await expect(withSessionContext(foreign,()=>confirmConfiguredComputer({id:prepared.id,human_confirmed:true}))).rejects.toThrow("OWNER_REJECTED");
 const confirmed=await confirmConfiguredComputer({id:prepared.id,human_confirmed:true});expect(await confirmConfiguredComputer({id:prepared.id,human_confirmed:true})).toEqual(confirmed);
 const claimed=await claimConfiguredComputer(prepared.id,"native_api_tool_loop");expect(claimed.preparation.execution_id).toBe(prepared.execution_id);
 await expect(claimConfiguredComputer(prepared.id,"native_api_tool_loop")).rejects.toThrow("ORIGINAL_PREPARATION_REQUIRED");
 claimed.preparation.target.origin="https://unreviewed.example";
 await expect(createPreparedWorker(claimed,DEFAULT_BUDGET)).rejects.toThrow("ORIGINAL_PREPARATION_CHANGED");
 expect(await readFile(join(root,"data/session_authority.json"),"utf8")).not.toContain("SYNTHETIC_SECRET");
}));
const DEFAULT_BUDGET={requests:0,input_tokens:0,output_tokens:0,reasoning_tokens:0,retries:0,elapsed_ms:10000,concurrency:1,max_hops:0,max_neighbors:0,run_amount:0,day_amount:0,currency:"USD",pricing_version:null,billing_principal:"operator"};
it("profile or attached-project changes after preparation cannot widen a grant",async()=>within(async()=>{
 const prepared=await prepareConfiguredComputer({adapter:"native_api_tool_loop",interact:true,duration_ms:10000});await writeFile(targetPath,JSON.stringify({...target,main_path_prefix:"/"}));
 await expect(confirmConfiguredComputer({id:prepared.id,human_confirmed:true})).rejects.toThrow("SETUP_CHANGED");
 await writeFile(targetPath,JSON.stringify(target));vi.mocked(lifecycle.getActiveScope).mockReturnValue({uuid:"fixture-instance",dataDir:join(root,"data"),engineEnvPath:join(root,"config/engine.env"),projectRoot:root+"-other"} as never);
 await expect(confirmConfiguredComputer({id:prepared.id,human_confirmed:true})).rejects.toThrow("INSTANCE_CHANGED");
 expect(await new SessionAuthority("fixture-instance",join(root,"data")).ownGrants(owner)).toEqual([]);
}));
it("unqualified OS/source/retention/native CLI and authority-origin targets remain unavailable",async()=>within(async()=>{
 expect(await inspectComputerSetup("codex-cli")).toMatchObject({available:false,route:"native_cli"});
 await expect(prepareConfiguredComputer({adapter:"native_api_tool_loop",interact:false,duration_ms:10000},["https://fixture.example"])).rejects.toThrow();
 const qualification=install.qualification as Record<string,unknown>;await writeFile(workerPath,JSON.stringify({...install,qualification:{...qualification,evidence_scope:"declared_fixture"}}));
 expect((await inspectComputerSetup("native_api_tool_loop")).available).toBe(false);
 await expect(prepareConfiguredComputer({adapter:"native_api_tool_loop",interact:false,duration_ms:10000})).rejects.toThrow("RUNTIME_UNQUALIFIED");
 await writeFile(workerPath,JSON.stringify({...install,qualification:{...qualification,source_hash:computerDigest("wrong")}}));expect(await inspectComputerSetup("native_api_tool_loop")).toMatchObject({available:false,reasons:["COMPUTER_BROWSER_SOURCE_QUALIFICATION_MISMATCH"]});
 process.env.DREAMGRAPH_COMPUTER_USE=JSON.stringify({...JSON.parse(process.env.DREAMGRAPH_COMPUTER_USE!),retention:"session"});expect(await inspectComputerSetup("native_api_tool_loop")).toMatchObject({available:false,reasons:["COMPUTER_RETAINED_EVIDENCE_UNQUALIFIED"]});
}));
