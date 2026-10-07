/** Actual isolated Chrome, provider/MCP HTTP and durable owners. Provider answers are declared deterministic fixtures, not model understanding. */
import {beforeAll,it,expect,vi} from "vitest";
vi.mock('node:child_process',async importOriginal=>{
 const actual=await importOriginal<typeof import('node:child_process')>();
 return {...actual,fork:(modulePath:string,args:string[],options:import('node:child_process').ForkOptions)=>{
  const child=actual.fork(modulePath,args,{...options,execArgv:[...options.execArgv??[],'--import',new URL('./fixtures/computer-stop-trace.mjs',import.meta.url).href]});
  child.on('message',(raw:any)=>{if(raw?.test_trace==='original_browser_stop')console.info('Original graph-loop Stop trace',raw);});
  return child;
 }};
});
import {createServer,type IncomingMessage} from "node:http";
import {mkdtemp,mkdir,readFile,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {Server} from "@modelcontextprotocol/sdk/server/index.js";
import {StreamableHTTPServerTransport} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {CallToolRequestSchema,ListToolsRequestSchema} from "@modelcontextprotocol/sdk/types.js";
import {installOfflineAdmissionFixtures} from "./helpers/offline-admission.js";
import {qualifyBrowserRuntime,browserQualificationFailureDetails} from "../src/computer/qualify-browser.js";
import {BrowserHarnessWorker} from "../src/computer/browser-harness.js";
import {prepareConfiguredComputer,confirmConfiguredComputer,claimConfiguredComputer,preparedComputerModelBinding} from "../src/computer/browser-registry.js";
import {runArchitectNativeToolLoop} from "../src/architect/native-tool-loop.js";
import {DaemonHttpAuthority} from "../src/server/http-authority.js";
import {withSessionContext} from "../src/server/session-context.js";
import {approveHostExecution,readHostExecution} from "../src/server/managed-execution.js";
import {invokeToolBoundary} from "../src/server/tool-boundary.js";
import {readChangeObligations,prepareChangeReconciliation} from "../src/graph/change-obligations.js";
import {commitGraphWrites} from "../src/graph/publication.js";
import {releaseGraphWriter} from "../src/graph/writer-lease.js";
import {getDataDir,setDataDirOverride} from "../src/utils/paths.js";
import {config} from "../src/config/config.js";
import * as lifecycle from "../src/instance/lifecycle.js";
import {DEFAULT_COMPUTER_USE_SETTINGS} from "../src/config/engine-settings.js";
import {getRoleLlmProvider,getRoleModelPolicy} from "../src/cognitive/llm.js";
import {recordRoleQualification,roleQualification} from '../src/cognitive/role-qualification.js';
import {ManagedExecutionClient} from '../packages/sdk/src/seams/graph-execution.js';
import {handleManagedExecutionApi} from '../src/server/managed-execution.js';
import {readManagedContext} from '../src/graph/execution-context.js';
import {previewArchitectPlanAuthority,reviewArchitectPlanDefinition} from '../src/architect/plan-registry.js';
import {applyPlanCommand,readPlanAuthority} from '../src/discipline/plan-authority.js';
import type {PlanExecutionIntent} from '../src/graph/contracts.js';
installOfflineAdmissionFixtures({directory:false});
let qualified:Awaited<ReturnType<typeof qualifyBrowserRuntime>>;
// Qualification pins unchanged host/runtime/source, not a target or grant. Reuse that one actual
// qualification across this file's six independently scoped sessions instead of 66 duplicate subchecks.
beforeAll(async()=>{
 const trace:unknown[]=[],start=performance.now();let workerId=0;
 const record=(event:object)=>{if(trace.length<100)trace.push({ms:performance.now()-start,...event});};
 const create=BrowserHarnessWorker.create;
 const traced=vi.spyOn(BrowserHarnessWorker,'create').mockImplementation(async(...args)=>{
  const worker=await create(...args),id=++workerId,stop=worker.stop.bind(worker);
  const child=(worker as unknown as {child:import('node:child_process').ChildProcess}).child;
  child.on('message',(raw:any)=>{if(raw?.body?.terminated!==undefined)record({worker:id,event:'original_stop_reply',terminated:raw.body.terminated,input_released:raw.body.input_released});});
  child.on('exit',(code,signal)=>record({worker:id,event:'original_child_exit',code,signal}));
  worker.stop=()=>{const before=performance.now();record({worker:id,event:'stop_called'});
   return stop().then(value=>{record({worker:id,event:'stop_resolved',elapsed_ms:performance.now()-before});return value;},error=>{record({worker:id,event:'stop_rejected',elapsed_ms:performance.now()-before,reason:error.message});throw error;});};
  return worker;
 });
 try{qualified=await qualifyBrowserRuntime({browser_executable:process.env.ASHOKA_BROWSER_EXECUTABLE||"C:/Program Files/Google/Chrome/Application/chrome.exe",
 browser_version:process.env.ASHOKA_BROWSER_VERSION||"153.0.8010.50",worker_id:"graph-loop-browser"},AbortSignal.timeout(60000));}
 catch(error){console.error('Actual graph-loop browser qualification:',browserQualificationFailureDetails(error),JSON.stringify(trace));throw error;}
 finally{traced.mockRestore();}
},65000);

it.each(['native_core','native_sdk','native_sdk_stop','native_sdk_plan','native_sdk_plan_stop','native_sdk_plan_limit'] as const)("%s real scoped browser pass preserves original control, source/graph boundaries and closure",async route=>{
 const nativeApi=route!=='native_core';
 const planBound=route.startsWith('native_sdk_plan'),stopRequested=route==='native_sdk_stop'||route==='native_sdk_plan_stop',contextExhausted=route==='native_sdk_plan_limit';
 const controller=new AbortController(),root=await mkdtemp(join(tmpdir(),"dg-cu-graph-loop-")),previous=getDataDir(),repos={...config.repos};
 const connections:Array<{server:Server;transport:StreamableHTTPServerTransport}>=[],requests:Array<Record<string,any>>=[];
 const handlers=new Set<Promise<void>>();
 let fixture:ReturnType<typeof createServer>|undefined,http:ReturnType<typeof createServer>|undefined,transfers=0,dataCreated=false;
 let running:Promise<unknown>|undefined;
 let nativeOperator:ManagedExecutionClient|undefined;
 let notifyPaused!:()=>void;const pauseObserved=new Promise<void>(done=>notifyPaused=done);
 const source=join(root,"source.ts"),changed="export const changed = true;\n",scan={mode:"incremental",enrich:false};
 const parseBody=async(req:IncomingMessage)=>{const parts:Buffer[]=[];for await(const chunk of req)parts.push(Buffer.from(chunk));return JSON.parse(Buffer.concat(parts).toString("utf8"));};
 const listen=async(server:ReturnType<typeof createServer>)=>{await new Promise<void>(done=>server.listen(0,"127.0.0.1",done));return "http://127.0.0.1:"+(server.address() as {port:number}).port;};
 const page=(saved:boolean)=>`<!doctype html><main id="app"><form action="/fixture/apply" method="post"><button type="submit">Apply</button></form><output id="status">${saved?"Saved":"Ready"}</output></main>`;
 const feature=(description:string)=>({features:[{id:"controlled-gui",name:"Controlled GUI",description,source_repo:"fixture",source_files:["source.ts"]}]});
 try{
  expect(qualified.evidence.model_requests).toBe(0);expect(qualified.worker.qualification.evidence_scope).toBe("actual_runtime");
  const data=join(root,"data"),configDir=join(root,"config");await mkdir(data);dataCreated=true;setDataDirOverride(data);config.repos={fixture:root};
  vi.stubEnv("DREAMGRAPH_INSTANCE_UUID","graph-loop-instance");
  vi.spyOn(lifecycle,"getActiveScope").mockReturnValue({uuid:"graph-loop-instance",dataDir:data,configDir,engineEnvPath:join(configDir,"engine.env"),projectRoot:root,repos:{fixture:root}} as never);
  await writeFile(source,"export const initial = true;\n");await commitGraphWrites({actor:"fixture",scope:["features.json"],writes:[{file:"features.json",content:JSON.stringify(feature("Initial GUI source"))}]});
  fixture=createServer(async(req,res)=>{if(req.url!=="/fixture"&&req.url!=="/fixture/apply"){res.statusCode=404;res.end();return;}
   if(req.method==="POST"&&req.url==="/fixture/apply"){transfers++;await writeFile(source,changed);}res.setHeader("Content-Type","text/html");res.end(page(transfers>0));});
  const origin=await listen(fixture);await mkdir(join(configDir,"computer-use/workers"),{recursive:true});await mkdir(join(configDir,"computer-use/targets"));
  await writeFile(join(configDir,"computer-use/workers/graph-loop-browser.json"),JSON.stringify(qualified.worker));
  await writeFile(join(configDir,"computer-use/targets/graph-loop-target.json"),JSON.stringify({schema:"dreamgraph.browser_target_definition.v1",id:"graph-loop-target",
   initial_url:origin+"/fixture",main_origin:origin,main_path_prefix:"/fixture",navigation:false,network:[{origin,path_prefix:"/fixture",methods:["GET","POST"],allow_query:false}],blocked_origins:[],
   elements:[{id:"apply",selector:"button",read_text:true,read_value:false,operations:["click"]},{id:"status",selector:"#status",read_text:true,read_value:false,operations:[]}],
   postconditions:[{id:"saved",selector:"#status",kind:"text_equals",expected:"Saved"}],observation_bytes:4096,action_timeout_ms:5000,max_actions:2,
   images:{enabled:true,region:'#app',mask_selectors:[],max_bytes:65536,max_count:8,total_bytes:524288},redactions:["SYNTHETIC_SOURCE_SECRET"]}));
  vi.stubEnv("DREAMGRAPH_COMPUTER_USE",JSON.stringify({...DEFAULT_COMPUTER_USE_SETTINGS,enabled:true,worker_profile:"graph-loop-browser",target_profile:"graph-loop-target",max_actions:2,max_images:8,max_image_bytes:524288,elapsed_ms:60000}));
  const authority=new DaemonHttpAuthority(1,{DREAMGRAPH_INSTANCE_UUID:"graph-loop-instance"}),operator=await authority.sessions.create("local-machine");
  const own=<T>(work:()=>T)=>withSessionContext(operator.context,work),shapes={query_resource:{},query_architecture_decisions:{},scan_project:{mode:z.literal("incremental"),enrich:z.literal(false)}};
  let planIntent:PlanExecutionIntent|undefined;
  if(planBound){
   await mkdir(join(root,'plans'));await writeFile(join(root,'plans/gui.md'),'# Governed GUI fixture\n\n### Slice 0 - Apply scoped source change\n\n- id: gui-work\n\nAcceptance: saved source, reconciled graph and independent verification.\n');
   const preview=await own(()=>previewArchitectPlanAuthority('gui')),actor={id:operator.context.principal,kind:'operator' as const,instance_id:preview.scope.instance_id,project_id:preview.scope.project_id};
   await own(()=>reviewArchitectPlanDefinition({plan_id:'gui',operation_id:'gui-import',preview_hash:preview.preview_hash,review_id:'gui-definition-review',actor}));
   for(const command of [{type:'review_plan',review_id:'gui-design-review'},{type:'approve_scope',approval_id:'gui-scope',owner:actor.id,scope:['gui-work'],parallel_limit:1},{type:'start_slice',slice_id:'gui-work'}]){
    const current=(await readPlanAuthority(preview.scope))!;await own(()=>applyPlanCommand({actor,plan_id:preview.scope.id,operation_id:'gui-'+command.type,expected_revision:current.state.revision,expected_definition_hash:current.state.definition_hash,command}));
   }
   const current=(await readPlanAuthority(preview.scope))!;planIntent={scope:preview.scope,kind:'implementation',slice_id:'gui-work',expected_revision:current.state.revision,expected_definition_hash:current.state.definition_hash,approval_id:'gui-scope'};
  }
  let executionId:string,computerId:string,action:Record<string,unknown>|undefined,followup=false,followupCalls=0;
  http=createServer((req,res)=>{const response=(async()=>{
   try{if(req.url==="/v1/chat/completions"){
    const request=await parseBody(req);requests.push(request);const index=followup?++followupCalls:requests.length;
    let calls:Array<{id:string;name:string;input:unknown}>=[];
    if(index===1)calls=[{id:"resource",name:"query_resource",input:{}},{id:"adr",name:"query_architecture_decisions",input:{}},...(!followup?[{id:"observe",name:"computer_observe",input:{}}]:[])];
    if(!followup&&index===2){const original=await nativeOperator!.readComputerStatus(executionId,computerId);
     const before=await own(()=>readFile(join(data,'publication_state.json'),'utf8')),evidence=await nativeOperator!.readComputerEvidence(executionId,computerId);
     expect(evidence.observation?.observation.target_id).toBe(original.targets[0].id);expect(evidence.observation?.image?.mime_type).toBe('image/png');
     expect(evidence.observation?.image?.data_base64.length).toBeGreaterThan(0);expect(evidence.observation?.image_observation?.content_hash).toBe(evidence.observation?.image?.content_hash);
     expect(await own(()=>readFile(join(data,'publication_state.json'),'utf8'))).toBe(before);
     expect((await nativeOperator!.readComputerStatus(executionId,computerId)).usage).toEqual(original.usage);
     const listed=await nativeOperator!.listComputerSessions();expect(listed.sessions.some(row=>row.session.id===computerId)).toBe(true);
     const paused=await nativeOperator!.controlComputer(executionId,computerId,'pause',original.session.fence);expect(paused.session.state).toBe('paused');
     calls=[{id:"while-paused",name:"computer_observe",input:{}}];notifyPaused();}
    if(!followup&&index===3)calls=[{id:"resume-observe",name:"computer_observe",input:{}}];
    if(!followup&&index===4){const observed=JSON.parse(request.messages.find((m:any)=>m.tool_call_id==="resume-observe").content),element=JSON.parse(observed.summary).elements.find((value:any)=>value.text==="Apply");
     action={schema:"dreamgraph.computer_action.v1",id:"gui-source:one",execution_id:observed.binding.execution_id,target_id:observed.binding.target_id,target_generation:observed.observation.target_generation,
      observation_id:observed.observation.id,grant_id:observed.binding.grant_id,operation:"click",parameters:{locator:element.ref},postcondition:"saved",fence:observed.binding.fence};
     // The declared human reviewer is separate from all model/worker HTTP authority.
     await own(async()=>{const host=await readHostExecution(executionId);await approveHostExecution({execution_id:executionId,approval_id:"review-real-gui-action",expected_record_revision:host.record_revision,
      context_receipt_id:host.pack.receipt.id,approved_actions:[{tool:"computer_action",arguments:action!,scope_id:"fixture",calls:1},{tool:"scan_project",arguments:scan,scope_id:"fixture",calls:1}]});});
     calls=[{id:"gui-action",name:"computer_action",input:action}];}
    if(!followup&&index===5)calls=[{id:"reconcile",name:"scan_project",input:scan}];
    for(const call of calls)expect(request.tools.map((tool:any)=>tool.function.name),"Declared fixture must use only advertised tools").toContain(call.name);
    // This refusal case deliberately has no provider usage: retain the conservative wire-byte allocation.
    // Measured replies on the successful routes exercise the calibrated prompt-caching path.
    res.setHeader("Content-Type","application/json");res.end(JSON.stringify({model:"gpt-4.1",usage:contextExhausted?undefined:{prompt_tokens:100,completion_tokens:10},choices:[{finish_reason:calls.length?"tool_calls":"stop",message:{
     content:contextExhausted&&index===4?'Declared context expansion after the GUI action. '.repeat(900):calls.length?null:'Controlled source evidence inspected.\n```architect_continuation\n{"schema":"dreamgraph.architect.continuation.v1","status":"completed"}\n```',
     tool_calls:calls.map(call=>({id:call.id,type:"function",function:{name:call.name,arguments:JSON.stringify(call.input)}}))}}]}));return;}
    const owner=await authority.authorize(req,res);if(!owner)return;
    await withSessionContext(owner,async()=>{if(await authority.handle(req,res,owner)||await handleManagedExecutionApi(req,res,new URL(req.url!,"http://local").pathname))return;
     const known=connections.find(value=>value.transport.sessionId===req.headers["mcp-session-id"]);if(known){await known.transport.handleRequest(req,res);return;}
     const server=new Server({name:"declared-source-reconciliation-owner",version:"1"},{capabilities:{tools:{}}});
     server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:Object.keys(shapes).map(name=>({name,inputSchema:{type:"object" as const,
      properties:name==="scan_project"?{mode:{type:"string"},enrich:{type:"boolean"}}:{}}}))}));
     server.setRequestHandler(CallToolRequestSchema,async call=>invokeToolBoundary({name:call.params.name,shape:shapes[call.params.name as keyof typeof shapes],args:call.params.arguments,handler:async()=>{
      if(call.params.name!=="scan_project")return {content:[{type:"text",text:"Literal source/ADR fixture; no model understanding claim."}]};
      expect(await readFile(source,"utf8")).toBe(changed);const obligations=(await readChangeObligations()).entries;expect(obligations.some(item=>item.state!=="graph_committed")).toBe(true);
      const writes=await prepareChangeReconciliation(obligations.map(item=>item.id),"real-gui-source-commit");const committed=await commitGraphWrites({actor:"declared-source-parser",operation_id:"real-gui-source-commit",scope:["source:fixture/source.ts"],
       writes:[...writes,{file:"features.json",content:JSON.stringify(feature("Reconciled GUI source: changed = true"))}],source_reconciliation:{revision:"actual-fixture-source",scope:["source:fixture/source.ts"],full:false}});
      return {content:[{type:"text",text:JSON.stringify(committed.receipt)}]};}}));
     const transport=new StreamableHTTPServerTransport({sessionIdGenerator:randomUUID});connections.push({server,transport});await server.connect(transport);await transport.handleRequest(req,res);});
   }catch(error){console.error("Declared offline provider/MCP fixture failed:",error);if(!res.headersSent)res.statusCode=500;res.end(JSON.stringify({error:String(error)}));}
  })();handlers.add(response);void response.finally(()=>handlers.delete(response));});const endpoint=await listen(http);
  // Use the real SDK's per-route deadlines: short status/control requests stay
  // at 10s, but the whole multi-step pass must not inherit that short timeout.
  // This fixture still has a 60s test/pass budget and unchanged Stop deadlines.
  nativeOperator=new ManagedExecutionClient({baseUrl:endpoint,sessionBearer:operator.bearer});
  for(const role of ["COMPUTER_USE","ARCHITECT"])for(const [suffix,value]of Object.entries({PROVIDER:"openai",MODEL:"gpt-4.1",API:"chat_completions",URL:endpoint+"/v1",API_KEY:"synthetic-offline-credential",MAX_TOKENS:"1000",TIMEOUT_MS:"60000",RETENTION:"store_false",STRICT_SCHEMA:"false"}))vi.stubEnv(`DREAMGRAPH_LLM_${role}_${suffix}`,value);
  // Explicit fixture admission: the selected plan's native prompt is larger than the project-only prompt.
  // The refusal fixture adds an explicit 43KB assistant/tool-call turn after the GUI action rather than depending
  // on incidental prompt overhead. Its declared output allowance accommodates that synthetic expansion.
  // Never raise product/default limits or retry a paid request.
  if(contextExhausted)vi.stubEnv('DREAMGRAPH_LLM_COMPUTER_USE_MAX_TOKENS','20000');
  if(planBound)vi.stubEnv('DREAMGRAPH_LLM_COMPUTER_USE_CONTEXT_TOKENS',contextExhausted?'32768':'65536');
  if(nativeApi)vi.stubEnv('DREAMGRAPH_LLM_ARCHITECT_STRICT_SCHEMA','true'); // Its ordinary role cannot bind; the explicit computer_use role must still work.
  if(nativeApi){
   const setup=await nativeOperator.readComputerPassSetup();expect(setup).toMatchObject({available:true,instance_id:'graph-loop-instance',model:{role:'computer_use',provider:'openai',model:'gpt-4.1'},visual:{enabled:true,region:'#app'},redaction_rules:1});
   const unused=await nativeOperator.prepareComputerPass({interact:false,duration_ms:30000});
   const lost=new ManagedExecutionClient({baseUrl:endpoint,sessionBearer:operator.bearer,fetch:async(url,init)=>{const response=await fetch(url,init);if(String(url).endsWith('/confirm')){await response.text();throw new Error('declared lost confirmation');}return response;}});
   try{await expect(lost.confirmComputerPass(unused.id)).rejects.toThrow('lost confirmation');}finally{lost.dispose();}
   const confirmed=await nativeOperator.confirmComputerPass(unused.id),again=await nativeOperator.confirmComputerPass(unused.id);expect(again).toEqual(confirmed);
   const targetPath=join(configDir,'computer-use/targets/graph-loop-target.json'),targetBytes=await readFile(targetPath,'utf8');
   await writeFile(targetPath,targetBytes+'\n');
   expect(await nativeOperator.cancelComputerPass(unused.id)).toMatchObject({id:unused.id,execution_id:unused.execution_id,status:'cancelled',grant_revoked:true});
   expect(await nativeOperator.cancelComputerPass(unused.id)).toMatchObject({status:'cancelled',grant_revoked:true});
   const grant=(await authority.sessions.ownGrants(operator.context)).find(grant=>grant.id===confirmed.grant_id);expect(grant?.revoked_at).not.toBeNull();
   await expect(nativeOperator.confirmComputerPass(unused.id)).rejects.toThrow('COMPUTER_PREPARATION_CANCELLED');
   await writeFile(targetPath,targetBytes);expect(requests).toHaveLength(0);expect(transfers).toBe(0);
   const concurrent=await Promise.allSettled(Array.from({length:5},()=>nativeOperator!.prepareComputerPass({interact:false,duration_ms:30000})));
   const admitted=concurrent.filter(result=>result.status==='fulfilled');expect(admitted).toHaveLength(4);
   const refused=concurrent.filter(result=>result.status==='rejected');expect(refused).toHaveLength(1);expect(String((refused[0] as PromiseRejectedResult).reason)).toContain('COMPUTER_PREPARATION_CAPACITY');
   for(const result of admitted)if(result.status==='fulfilled')expect((await nativeOperator.cancelComputerPass(result.value.id)).grant_revoked).toBe(false);
   expect(requests).toHaveLength(0);expect(transfers).toBe(0);
  }
  const prepared=nativeApi?await nativeOperator.prepareComputerPass({interact:true,duration_ms:60000}):await own(()=>prepareConfiguredComputer({adapter:"native_api_tool_loop",model_role:"computer_use",interact:true,duration_ms:60000},[endpoint]));executionId=prepared.execution_id;computerId=prepared.id;
  const originalModel=await own(()=>getRoleModelPolicy('computer_use'));
  // Declared warm-health fixture: a refused later pass must revoke only this role's prior success.
  if(contextExhausted)recordRoleQualification('computer_use',originalModel.fingerprint);
  if(nativeApi){expect(prepared.model).toMatchObject({role:'computer_use',provider:'openai',model:'gpt-4.1'});await nativeOperator.confirmComputerPass(prepared.id);}
  else await own(()=>confirmConfiguredComputer({id:prepared.id,human_confirmed:true}));
  const pass=(async()=>{
   if(nativeApi){
    const reply=await nativeOperator!.runComputerPass({computer_preparation_id:prepared.id,message:'Update Controlled GUI and reconcile the graph with incremental scan_project.',autonomy_mode:'supervised',verbosity_mode:'concise',...(planIntent?{plan_id:planIntent.scope.id,plan_execution:planIntent}: {})},executionId,controller.signal);
    const closed=await own(()=>readManagedContext(executionId));
    expect(reply,JSON.stringify({status:reply.execution.status,content:reply.content.slice(0,1000),plan_termination:closed.plan_closure?.effective_termination,effects:closed.effects.map(effect=>({tool:effect.tool,outcome:effect.outcome})),provider_requests:requests.length,source_transfers:transfers})).toMatchObject({execution_id:executionId,provider:'openai',model:'gpt-4.1',execution:{execution_id:executionId,...(stopRequested?{}:{status:contextExhausted?'reconciliation_pending':'graph_committed'}),authority_active:false}});
    if(contextExhausted)expect(reply.content).toContain('ADMISSION_CONTEXT_LIMIT');
    return {graph_execution:await own(()=>readManagedContext(executionId))};
   }
   const computer=await own(()=>claimConfiguredComputer(prepared.id,'native_api_tool_loop')),binding=(await own(()=>preparedComputerModelBinding(computer)))!;
   return own(()=>runArchitectNativeToolLoop({req:{headers:{host:new URL(endpoint).host}} as IncomingMessage,config:{...binding.config,component:'architect',providerSource:'computer_use',modelSource:'computer_use'},provider:binding.provider,signal:controller.signal,
    messages:[{role:'user',content:'Update Controlled GUI and reconcile the graph with incremental scan_project.'}],userMessage:'Update Controlled GUI and reconcile the graph with incremental scan_project.',computer,executionId,autonomyMode:'supervised',operatorReviewEnabled:true}));
  })();
  running=pass;void pass.catch(()=>{});
  await Promise.race([pauseObserved,pass.then(()=>{throw new Error("Expected the actual native pass to pause first");})]);await new Promise(done=>setTimeout(done,100));
  expect((await nativeOperator.readComputerEvidence(executionId,computerId)).observation).toBeNull();
  expect(requests).toHaveLength(2);expect(transfers).toBe(0);const state=await nativeOperator.readComputerStatus(executionId,computerId);expect(state.session.state).toBe('paused');
  if(planIntent){
   const running=(await readPlanAuthority(planIntent.scope))!;expect(running.state.current_slice_ids).toEqual(['gui-work']);expect(running.state.running_slice_ids).toEqual(['gui-work']);
   expect(running.state.leases[0]).toMatchObject({execution_id:executionId,state:'running'});expect((await nativeOperator.read(executionId)).plan_execution?.state.running_slice_ids).toEqual(['gui-work']);
  }
  if(nativeApi)await expect(nativeOperator.cancelComputerPass(prepared.id)).rejects.toThrow('COMPUTER_PREPARATION_ALREADY_CLAIMED');
  if(stopRequested){
   const stopped=await nativeOperator.controlComputer(executionId,computerId,'stop');expect(stopped.session.state).toBe('stopped');controller.abort(new Error('original native RPC Stop'));
   await pass.catch(error=>expect(String(error)).toContain('original native RPC Stop'));
   const end=Date.now()+5000;let original=await own(()=>readHostExecution(executionId));
   // Revocation precedes durable ledger/closure settlement; it is not itself an execution outcome.
   while((original.authority_active||['assembled','running'].includes(original.status))&&Date.now()<end){await new Promise(done=>setTimeout(done,50));original=await own(()=>readHostExecution(executionId));}
   expect(original.authority_active).toBe(false);expect(original.status).toBe('recovery_required');
   const retained=await own(()=>readManagedContext(executionId)),journal=retained.computer_sessions[0];expect(journal.stop_state).toBe('acknowledged');expect(journal.actions).toEqual([]);
   expect(retained.effects.some(effect=>effect.tool==='host_adapter_termination'&&effect.outcome==='unknown')).toBe(true);
   if(planIntent){const pending=(await readPlanAuthority(planIntent.scope))!;expect(pending.progress.verified).toBe(0);expect(pending.state.leases[0].state).toBe('recovery_required');expect(pending.state.slices[0].verification).toBeNull();
    expect(retained.plan_closure).toMatchObject({effective_termination:'unconfirmed'});expect(pending.state.slices[0].implementation_receipt_ids).toEqual([]);}
   expect(transfers).toBe(0);expect(await readFile(source,'utf8')).toBe('export const initial = true;\n');expect((await readChangeObligations()).entries).toEqual([]);return;
  }
  await nativeOperator.controlComputer(executionId,computerId,'resume',state.session.fence);
  if(contextExhausted){const result=await pass,original=result.graph_execution!;expect(transfers).toBe(1);expect(requests).toHaveLength(4);expect(await readFile(source,'utf8')).toBe(changed);
   expect(roleQualification('computer_use',originalModel.fingerprint)).toBeNull();
   expect(original.computer_sessions[0].stop_state).toBe('acknowledged');expect(original.computer_sessions[0].actions[0].receipt.state).toBe('verified');
   expect(original.plan_closure).toMatchObject({effective_termination:'confirmed'});expect(original.effects.some(effect=>effect.outcome==='unknown')).toBe(false);
   expect((await readChangeObligations()).entries.some(item=>item.execution_id===executionId&&item.state==='reconciliation_pending')).toBe(true);
   const pending=(await readPlanAuthority(planIntent!.scope))!;expect(pending.progress.verified).toBe(0);expect(pending.state.leases).toEqual([]);expect(pending.state.slices[0].implementation_receipt_ids).toEqual([]);
   expect(pending.state.slices[0].verification).toBeNull();return;
  }
  const result=await pass;expect(transfers).toBe(1);expect(requests).toHaveLength(6);const contextAt=(i:number)=>requests[i].messages.find((m:any)=>typeof m.content==="string"&&m.content.startsWith("DreamGraph required execution context.")).content;
  if(nativeApi){expect(roleQualification('computer_use',originalModel.fingerprint)).not.toBeNull();expect(roleQualification('architect',originalModel.fingerprint)).toBeNull();}
  expect(contextAt(0)).toContain("Initial GUI source");expect(contextAt(4)).toContain("SOURCE_RECONCILIATION_PENDING");expect(contextAt(5)).toContain("Reconciled GUI source: changed = true");expect(contextAt(5)).not.toContain("SOURCE_RECONCILIATION_PENDING");
  expect(result.graph_execution?.status).toBe("graph_committed");const journal=result.graph_execution!.computer_sessions[0];expect(journal.stop_state).toBe("acknowledged");expect(journal.actions[0].receipt.state).toBe("verified");
  expect(journal.actions[0].receipt).not.toHaveProperty("graph_committed");expect((await readChangeObligations()).entries.every(item=>item.state==="graph_committed")).toBe(true);
  if(planIntent){const closed=(await readPlanAuthority(planIntent.scope))!;expect(closed.state.running_slice_ids).toEqual([]);expect(closed.state.current_slice_ids).toEqual(['gui-work']);expect(closed.progress.verified).toBe(0);
   expect(closed.state.slices[0]).toMatchObject({status:'in_progress',implementation_receipt_ids:[],verification:null,last_attempt:{outcome:'completed'}});
   expect(result.graph_execution?.plan_execution).toEqual(planIntent);expect(result.graph_execution?.plan_closure?.effective_termination).toBe('confirmed');
  }else expect(result.graph_execution?.plan_execution).toBeUndefined();
  followup=true;vi.stubEnv('DREAMGRAPH_LLM_ARCHITECT_STRICT_SCHEMA','false');const next=await own(()=>getRoleLlmProvider("architect"));const inspected=await own(()=>runArchitectNativeToolLoop({req:{headers:{host:new URL(endpoint).host}} as IncomingMessage,config:{...next.config,component:"architect",providerSource:"architect",modelSource:"architect"},provider:next.provider,
   messages:[{role:"user",content:"Inspect Controlled GUI architecture."}],userMessage:"Inspect Controlled GUI architecture.",executionId:"gui-followup",autonomyMode:"manual"}));
  expect(contextAt(6)).toContain("Reconciled GUI source: changed = true");expect(contextAt(6)).not.toContain("SOURCE_RECONCILIATION_PENDING");expect(inspected.graph_execution?.status).toBe("no_change");expect(requests).toHaveLength(8);
 }catch(error){
  if(error instanceof Error&&error.message==="COMPUTER_WORKER_REPLY_UNKNOWN")console.error("Offline native GUI worker timeout phase:",(error.cause as {phase?:string}|undefined)?.phase??"unavailable");
  throw error;
 }finally{controller.abort();nativeOperator?.dispose();await running?.catch(()=>{});for(const value of connections)await value.server.close();for(const server of [http,fixture])if(server){server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}
  // Closing an HTTP socket does not settle its asynchronous fixture handler.
  await Promise.allSettled([...handlers]);
  vi.restoreAllMocks();if(dataCreated)await releaseGraphWriter(join(root,"data"));setDataDirOverride(previous);config.repos=repos;vi.unstubAllEnvs();await rm(root,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
},60000);
