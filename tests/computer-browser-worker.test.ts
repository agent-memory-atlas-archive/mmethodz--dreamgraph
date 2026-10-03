/** Actual isolated Chrome/process against controlled local fixtures. This host does not qualify other OS/native input. */
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {createServer,type Server} from "node:http";
import {performance} from "node:perf_hooks";
import {BrowserComputerDriver} from "../src/computer/browser-driver.js";
import {BrowserHarnessWorker,browserWorkerSourceHash} from "../src/computer/browser-harness.js";
import {BrowserWorkerProfileSchema,browserUrlAllowed} from "../src/computer/browser-profile.js";
import {computerDigest} from "../src/computer/digest.js";
import type {ComputerQualification} from "../src/computer/capabilities.js";
import type {ComputerAction,ComputerTarget,ComputerWorkerPort} from "../src/computer/worker-port.js";
const stopFault=vi.hoisted(()=>({enabled:false,delay:false,dropped:0,forces:0,settled:0}));
vi.mock('node:child_process',async importOriginal=>{
 const actual=await importOriginal<typeof import('node:child_process')>();
 return {...actual,fork:(modulePath:string,args:string[],options:import('node:child_process').ForkOptions)=>{
  const child=actual.fork(modulePath,args,{...options,env:{...options.env,DREAMGRAPH_TEST_DELAY_TREE_STOP:stopFault.delay?'1500':'0'},execArgv:[...options.execArgv??[],'--import',new URL('./fixtures/computer-stop-trace.mjs',import.meta.url).href,...(stopFault.enabled?['--import',new URL('./fixtures/computer-hold-graceful-close.mjs',import.meta.url).href]:[])]});
  child.on('message',(raw:any)=>{if(raw?.test_trace==='original_browser_stop'){
   if(raw.event==='owner_async_force_start')stopFault.forces++;
   if(raw.event==='owner_async_force_return')stopFault.settled++;
   console.info('Original browser Stop trace',raw);
  }});
  child.on('message',(raw:any)=>{if(raw?.test_fault==='graceful_close_dropped')stopFault.dropped++;});
  return child;
 }};
});
let server:Server,forbidden:Server,origin:string,other:string,visits:number,transfers:number,ticks:number,profile:ReturnType<typeof BrowserWorkerProfileSchema.parse>,target:ComputerTarget;
const workers:Array<{stop():Promise<unknown>}>=[];
const confirmedDisconnected=new WeakSet<object>();
const listen=async(server:Server)=>{await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));return "http://127.0.0.1:"+(server.address() as {port:number}).port;};
beforeEach(async()=>{
 stopFault.enabled=false;stopFault.delay=false;stopFault.dropped=0;stopFault.forces=0;stopFault.settled=0;
 visits=0;transfers=0;ticks=0;forbidden=createServer((_req,res)=>{visits++;res.end("Forbidden account/admin fixture");});other=await listen(forbidden);
 server=createServer((req,res)=>{
  if(req.url==="/fixture/redirect"){res.writeHead(302,{Location:other+"/authority"});res.end();return;}
  if(req.url==="/fixture/slow"){req.on("close",()=>clearTimeout(timer));const timer=setTimeout(()=>{res.end("<main>late fixture</main>");},10000);return;}
  if(req.url==="/fixture/cookie"){res.setHeader("Content-Type","application/json");res.end(JSON.stringify({cookie:req.headers.cookie??null}));return;}
  if(req.url==="/fixture/save"){transfers++;res.end("saved");return;}
  if(req.url==="/fixture/tick"){ticks++;res.end("tick");return;}
  res.setHeader("Content-Type","text/html");res.end(`<!doctype html><html><head><style>body{background:#18212c;color:#ddd;font-family:sans-serif}#app{width:720px;padding:12px}#scroll{height:100px;width:350px;overflow:auto;background:#243345}#spacer{height:900px}button,input{padding:8px;margin:4px}#cover{display:none;position:absolute;inset:0;background:#333;z-index:100}</style></head><body><main id=app>
  <input id=name aria-label="Name"><button id=apply type=button onclick="document.querySelector('#status').textContent='Saved'">Apply</button><output id=status>Ready</output>
  <input id=agree type=checkbox aria-label="Agree"><button id=disabled disabled>Disabled</button><input id=secret type=password name=api-token value=SYNTHETIC_SECRET_TOKEN>
  <div id=private>SYNTHETIC_SECRET_TOKEN</div><button id=spoof type=button onclick="fetch('${other}/messages',{method:'POST',body:'SYNTHETIC_SECRET_TOKEN'}).catch(()=>{})">Save</button>
  <a id=redirect href=/fixture/redirect>Redirect</a><button id=popup type=button onclick="window.open('${other}/account')">Popup</button>
  <button id=frame type=button onclick="let frame=document.createElement('iframe');frame.src='${other}/frame';document.body.append(frame)">Frame</button>
  <button id=post type=button onclick="fetch('/fixture/save',{method:'POST',body:'fixture'}).catch(()=>{})">Post</button>
  <div id=scroll><div id=spacer>Scrollable fixture</div></div></main><div id=cover></div><script>window.changeFixture=()=>{document.querySelector('#apply').style.marginLeft='100px'};setInterval(()=>fetch('/fixture/tick').catch(()=>{}),100);</script></body></html>`);
 });origin=await listen(server);
 profile=BrowserWorkerProfileSchema.parse({schema:"dreamgraph.browser_worker_profile.v1",id:"actual-browser-fixture",browser_executable:process.env.ASHOKA_BROWSER_EXECUTABLE||"C:/Program Files/Google/Chrome/Application/chrome.exe",browser_version:process.env.ASHOKA_BROWSER_VERSION||"153.0.8010.50",runtime_version:"1.62.1",
  initial_url:origin+"/fixture",main_origin:origin,main_path_prefix:"/fixture",network:[{origin,path_prefix:"/fixture",methods:["GET","HEAD"],allow_query:false}],blocked_origins:[other],
  elements:[{id:"name",selector:"#name",read_text:false,read_value:true,operations:["type","key"]},{id:"apply",selector:"#apply",read_text:true,read_value:false,operations:["click"]},
   {id:"status",selector:"#status",read_text:true,read_value:false,operations:[]},{id:"agree",selector:"#agree",read_text:false,read_value:false,operations:["set_checked"]},
   ...["disabled","secret","spoof","redirect","popup","frame","post"].map(id=>({id,selector:"#"+id,read_text:true,read_value:true,operations:["click"]})),
   {id:"private",selector:"#private",read_text:true,read_value:false,operations:[]},{id:"scroll",selector:"#scroll",read_text:true,read_value:false,operations:["scroll"]}],
  postconditions:[{id:"typed",selector:"#name",kind:"value_equals_input"},{id:"saved",selector:"#status",kind:"text_equals",expected:"Saved"},{id:"checked",selector:"#agree",kind:"checked_equals_input"},
    {id:"visible",selector:"#status",kind:"visible"}],observation_bytes:16384,action_timeout_ms:2000,max_actions:12,expires_at:new Date(Date.now()+60000).toISOString(),
  images:{enabled:false,region:null,mask_selectors:[],max_bytes:0,max_count:0,total_bytes:0},redactions:["SYNTHETIC_SECRET_TOKEN"]});
 target={schema:"dreamgraph.computer_target.v1",id:"target",instance_id:"fixture",session_id:"fixture",host_id:"fixture-local-host",surface:"browser",generation:1,origin,application:null};
});
afterEach(async()=>{
 const errors:unknown[]=[];
 for(const worker of workers.splice(0))try{await worker.stop();}catch(error){
  if(!confirmedDisconnected.has(worker))errors.push(error);
 }
 for(const value of [server,forbidden]){value.closeAllConnections();await new Promise<void>(resolve=>value.close(()=>resolve()));}
 if(errors.length)throw new AggregateError(errors,'Original browser cleanup failed');
});
const signal=()=>new AbortController().signal;
async function driver(){const value=new BrowserComputerDriver(profile,"actual-fixture-driver");workers.push(value);await value.open(target,signal());return value;}
const element=(observed:{summary:string},selector:string)=>{const values=JSON.parse(observed.summary).elements;const found=values.find((item:{label:string;tag:string;text:string})=>selector==="name"?item.tag==="input"&&item.label==="Name":selector==="agree"?item.label==="Agree":selector==="secret"?item.sensitive:selector==="scroll"?item.text.startsWith("Scrollable"):item.text===selector);expect(found).toBeDefined();return found.ref;};
function action(observed:{target:ComputerTarget;summary:string},ref:string,operation:ComputerAction["operation"],postcondition:string,parameters:ComputerAction["parameters"]={}):ComputerAction{
 return {schema:"dreamgraph.computer_action.v1",id:"operation:"+Math.random(),execution_id:"fixture",target_id:target.id,target_generation:observed.target.generation,observation_id:"fixture-observation",grant_id:"fixture-grant",operation,parameters:{...(ref?{locator:ref}:{}),...parameters},postcondition,fence:1};
}
it("performs real Unicode, checked, click/readback and scrolling using opaque current references",async()=>{
 const value=await driver();let observed=await value.observe(signal());expect(observed.summary).not.toContain("SYNTHETIC_SECRET_TOKEN");
 let result=await value.act(action(observed,element(observed,"name"),"type","typed",{text:"Å日本語"}),signal());expect(result.postcondition_met).toBe(true);
 observed=result.observation;result=await value.act(action(observed,element(observed,"agree"),"set_checked","checked",{checked:true}),signal());expect(result.postcondition_met).toBe(true);
 observed=result.observation;result=await value.act(action(observed,element(observed,"Apply"),"click","saved"),signal());expect(result.postcondition_met).toBe(true);expect(result.observation.summary).toContain("Saved");
 observed=result.observation;expect((await value.act(action(observed,element(observed,"scroll"),"scroll","visible",{delta_y:80}),signal())).input_delivered).toBe(true);
});
it("moved/covered controls, disabled and credential controls never receive a guessed action",async()=>{
 const value=await driver(),observed=await value.observe(signal());
 await expect(value.act(action(observed,element(observed,"Disabled"),"click","visible"),signal())).rejects.toThrow("ELEMENT_REJECTED");
 await expect(value.act(action(observed,element(observed,"secret"),"click","visible"),signal())).rejects.toThrow("ELEMENT_REJECTED");
 const page=(value as unknown as {page:import("playwright-core").Page}).page;await page.evaluate(()=>{(window as unknown as {changeFixture:()=>void}).changeFixture();});
 const moved=await value.act(action(observed,element(observed,"Apply"),"click","saved"),signal());expect(moved.input_delivered).toBe(false);
 expect(moved.observation.target.generation).toBeGreaterThan(observed.target.generation);
 await expect(value.act(action(observed,element(observed,"Apply"),"click","saved"),signal())).rejects.toThrow("STALE");
});
it("forbidden posts, redirects, popups and frames cannot reach another origin or authority",async()=>{
 const value=await driver();for(const label of ["Save","Popup","Frame","Post","Redirect"]){const observed=await value.observe(signal());
  try{await value.act(action(observed,element(observed,label),"click","visible"),signal());}catch(error){expect(String(error)).toMatch(/COMPUTER_|net::ERR_BLOCKED_BY_CLIENT/);}
 }
 expect(visits).toBe(0);expect(transfers).toBe(0);
});
it("exact scope cannot be widened with lookalike paths, secrets in URL or a future browser/runtime",async()=>{
 expect(browserUrlAllowed(profile,origin+"/fixture-other","GET",true)).toBe(false);expect(browserUrlAllowed(profile,origin+"/fixture?token=secret","GET")).toBe(false);
 expect(browserUrlAllowed(profile,other+"/fixture","GET")).toBe(false);expect(browserUrlAllowed(profile,origin+"/fixture/save","POST")).toBe(false);
 const wrong=new BrowserComputerDriver({...profile,browser_version:"0.0.0-unqualified"},"wrong-version");workers.push(wrong);await expect(wrong.open(target,signal())).rejects.toThrow("VERSION_UNQUALIFIED");
 expect(()=>BrowserWorkerProfileSchema.parse({...profile,runtime_version:"future"})).toThrow();
 expect(()=>BrowserWorkerProfileSchema.parse({...profile,initial_url:origin+"/fixture-other"})).toThrow();
});
it("explicit navigation stays inside the approved origin and segment path and verifies independent destination state",async()=>{
 profile={...profile,navigation:true,postconditions:[...profile.postconditions,{id:"destination",kind:"url_equals",expected:origin+"/fixture/next"}]};
 const value=await harness();await value.open(target,signal());const observed=await value.observe(target,signal());
 await expect(value.act(action(observed,"","navigate","destination",{url:other+"/authority"}),signal())).rejects.toThrow("NAVIGATION_DENIED");
 const result=await value.act(action(observed,"","navigate","destination",{url:origin+"/fixture/next"}),signal());
 expect(result.postcondition_met).toBe(true);expect(result.observation.target.generation).toBeGreaterThan(observed.target.generation);expect(visits).toBe(0);
});
async function harness(){const qualification:ComputerQualification={schema:"dreamgraph.computer_qualification.v1",backend:"isolated_playwright",backend_version:`playwright-core@1.62.1/chromium@${profile.browser_version}/node@${process.versions.node}`,
 platform:process.platform as "win32",architecture:process.arch,source_hash:await browserWorkerSourceHash(),protocol_hash:computerDigest("dreamgraph.computer_worker.v1"),qualified_at:new Date().toISOString(),
 evidence_scope:"declared_fixture",scope_negative_passed:true,privacy_passed:true,bounded_actions_passed:true,stop_release_ms:1,control_loss_stop_ms:1,cases:["CU04","CU05","CU10","CU20","CU24"],artifact_hash:computerDigest("Provisional mechanical fixture; not product qualification")};
 const value=await BrowserHarnessWorker.create(profile,{adapter:"native_api",adapter_version:"1",host_id:target.host_id},qualification);workers.push(value);
 // Keep the bounded operation phase in diagnostics; Vitest's generic timeout
 // stack omits Error.cause and otherwise hides whether Stop or an action failed.
 const peer=value as unknown as {request(operation:string,payload:unknown,timeout:number):Promise<unknown>},request=peer.request.bind(value);
 peer.request=async(operation,payload,timeout)=>{const started=performance.now();try{return await request(operation,payload,timeout);}catch(error){
  if(error instanceof Error&&error.message==='COMPUTER_WORKER_REPLY_UNKNOWN')console.error('Original worker reply deadline',{operation,timeout_ms:timeout,elapsed_ms:performance.now()-started,cause:error.cause});throw error;
 }};return value;}
async function stopPhases(value:BrowserHarnessWorker){
 const started=performance.now();expect(await value.releaseInput()).toEqual({epoch:value.probe.epoch,input_released:true});
 const input_release_ms=performance.now()-started;expect(input_release_ms).toBeLessThan(1000);
 expect(await value.stop()).toMatchObject({epoch:value.probe.epoch,input_released:true,terminated:true});
 const termination_ms=performance.now()-started;expect(termination_ms).toBeLessThan(5000);return {input_release_ms,termination_ms};
}
it("private worker process preserves typed observations and responsive independent termination",async()=>{
 const value=await harness();await value.open(target,signal());const observed=await value.observe(target,signal());expect(observed.epoch).toBe(value.probe.epoch);expect(observed.summary).not.toContain("SYNTHETIC_SECRET_TOKEN");
 const result=await value.act(action(observed,element(observed,"name"),"type","typed",{text:"Å日本語"}),signal());expect(result.postcondition_met).toBe(true);
 await stopPhases(value);
 await expect(value.observe(target,signal())).rejects.toThrow("INPUT_FENCED");
});
it("Stop releases input within one second and confirms its original tree within five seconds when graceful close is ignored",async()=>{
 stopFault.enabled=true;
 const value=await harness();await value.open(target,signal());await value.observe(target,signal());
 await vi.waitFor(()=>expect(ticks).toBeGreaterThan(0),{timeout:2000});
 const timing=await stopPhases(value);expect(stopFault.dropped).toBeGreaterThan(0);
 if(process.platform==='win32'){expect(stopFault.forces).toBe(1);expect(stopFault.settled).toBe(1);}
 const stoppedTicks=ticks;await new Promise(resolve=>setTimeout(resolve,350));expect(ticks).toBe(stoppedTicks);
 await expect(value.observe(target,signal())).rejects.toThrow('INPUT_FENCED');
 console.info('Forced original-browser termination evidence',{...timing,dropped_graceful_frames:stopFault.dropped,requests_quiescent:true});
});
it("input release is not Stop complete while the original termination helper remains alive",async()=>{
 // Exercise the existing Windows owner; other hosts retain their original runtime owner.
 if(process.platform!=='win32')return;
 stopFault.enabled=true;stopFault.delay=true;
 const value=await harness();await value.open(target,signal());await value.observe(target,signal());
 const started=performance.now();let complete=false;
 const stopped=value.stop().then(proof=>{complete=true;return proof;});
 expect(await value.releaseInput()).toEqual({epoch:value.probe.epoch,input_released:true});
 const input_release_ms=performance.now()-started;expect(input_release_ms).toBeLessThan(1000);
 expect(complete).toBe(false);await expect(value.observe(target,signal())).rejects.toThrow('INPUT_FENCED');
 await new Promise(resolve=>setTimeout(resolve,100));expect(complete).toBe(false);
 expect(await stopped).toMatchObject({terminated:true});const termination_ms=performance.now()-started;
 expect(termination_ms).toBeGreaterThan(1500);expect(termination_ms).toBeLessThan(5000);
 console.info('Separated Stop guarantees with live owned helper',{input_release_ms,termination_ms});
});
it("original worker pause fences capture/input and resumes with new references before independent Stop",async()=>{
 const value=await harness();await value.open(target,signal());const before=await value.observe(target,signal()),old=action(before,element(before,"name"),"type","typed",{text:"never replay"});
 expect(await value.pause()).toMatchObject({epoch:value.probe.epoch,input_released:true,paused:true});await expect(value.observe(target,signal())).rejects.toThrow("PAUSED");await expect(value.act(old,signal())).rejects.toThrow("PAUSED");
 const fresh=await value.resume(before.target,signal());expect(fresh.target.generation).toBeGreaterThan(before.target.generation);await expect(value.act(old,signal())).rejects.toThrow("STALE");
 const resumed=await value.act(action(fresh,element(fresh,"name"),"type","typed",{text:"fresh resumed input"}),signal());expect(resumed.postcondition_met).toBe(true);
 await stopPhases(value);await expect(value.resume(fresh.target,signal())).rejects.toThrow("INPUT_FENCED");
});
it("stop bypasses a pending browser navigation and never waits for its ten-second server response",async()=>{
 profile={...profile,initial_url:origin+"/fixture/slow"};const value=await harness();
 let requestArrived!:()=>void;const navigating=new Promise<void>(done=>requestArrived=done),arrived=(request:import("node:http").IncomingMessage)=>{if(request.url==="/fixture/slow")requestArrived();};server.on("request",arrived);
 const opened=value.open(target,signal());const failed=expect(opened).rejects.toThrow("COMPUTER_");
 try{
  // Observe the actual pending navigation. A fixed700ms could instead measure
  // cold browser launch, before this fixture's ten-second response even began.
  let timer:NodeJS.Timeout|undefined;
  try{await Promise.race([navigating,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error("COMPUTER_TEST_NAVIGATION_NOT_STARTED")),10000);})]);}finally{clearTimeout(timer);}
  await stopPhases(value);await failed;
 }finally{server.removeListener("request",arrived);}
});
it("masked frames have a verified digest and image exhaustion refuses before another input",async()=>{
 profile={...profile,images:{enabled:true,region:"#app",mask_selectors:["#private"],max_bytes:1024*1024,max_count:1,total_bytes:1024*1024}};
 const value=await harness();await value.open(target,signal());const observed=await value.observe(target,signal());expect(observed.image?.mime_type).toBe("image/png");expect(observed.image?.content_hash).toMatch(/^sha256:/);
 await expect(value.act(action(observed,element(observed,"name"),"type","typed",{text:"no input"}),signal())).rejects.toThrow("RESERVATION_EXHAUSTED");
 await stopPhases(value);
});
it.each(["disconnect","watchdog"])("a real worker closes its dedicated browser on %s without another model call",async loss=>{
 const value=await harness();await value.open(target,signal());await value.observe(target,signal());
 const local=value as unknown as {child:import("node:child_process").ChildProcess;heartbeat:NodeJS.Timeout;localStop:unknown};
 await vi.waitFor(()=>expect(ticks).toBeGreaterThan(0),{timeout:2000});clearInterval(local.heartbeat);
 const before=performance.now();if(loss==="disconnect")local.child.disconnect();
 await vi.waitFor(()=>{if(local.child.signalCode)throw new Error("COMPUTER_TEST_EXIT_SIGNAL_"+local.child.signalCode);expect(local.child.exitCode,JSON.stringify(local.localStop)).toBe(0);},{timeout:7000,interval:25});
 console.info("Computer control-loss evidence",{mode:loss,elapsed_ms:performance.now()-before,local_stop:local.localStop??null});
 // C17 gives a severed control channel a five-second lease-expiry ceiling.
 // Responsive Stop separately proves input release within one second.
 expect(performance.now()-before,JSON.stringify(local.localStop)).toBeLessThan(5000);
 const stoppedAt=ticks;await new Promise(resolve=>setTimeout(resolve,350));expect(ticks).toBe(stoppedAt);
 await expect(value.observe(target,signal())).rejects.toThrow(loss==="watchdog"?"INPUT_FENCED":"CHANNEL_UNAVAILABLE");
 // This is local containment evidence; no receipt acknowledgement crossed the lost channel.
 if(loss==="disconnect"){await expect(value.stop()).rejects.toThrow("CHANNEL_UNAVAILABLE");confirmedDisconnected.add(value);}
 else expect(await value.stop()).toMatchObject({epoch:value.probe.epoch,input_released:true,terminated:true});
},15000);
it("lost stop acknowledgement keeps the original peer for stop-only recovery and cannot reopen input",async()=>{
 const value=await harness();await value.open(target,signal());await value.observe(target,signal());
 const local=value as unknown as {receive:(raw:unknown)=>void;child:import("node:child_process").ChildProcess},receive=local.receive.bind(value);let drop=true;
 // Only the transport reply is fault-injected. The real worker/Chrome execute
 // termination; the first caller is deliberately denied its acknowledgement.
 local.receive=raw=>{const message=raw as {body?:{terminated?:boolean}};if(drop&&message.body?.terminated){drop=false;return;}receive(raw);};
 await expect(value.stop()).rejects.toThrow("REPLY_UNKNOWN");expect(local.child.connected).toBe(true);
 await expect(value.observe(target,signal())).rejects.toThrow("INPUT_FENCED");
 await expect(value.open(target,signal())).rejects.toThrow("INPUT_FENCED");
 expect(await value.stop()).toMatchObject({epoch:value.probe.epoch,input_released:true,terminated:true});
},15000);
