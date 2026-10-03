/** Executed browser script against declared HTTP responses. Real Chrome/process checks are separate. */
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {JSDOM} from "jsdom";
import {COMPUTER_USE_MARKUP,COMPUTER_USE_SCRIPT} from "../src/architect/computer-use-ui.js";
let dom:JSDOM,calls:Array<{path:string;body:Record<string,unknown>|null}>,respond:(path:string,body:Record<string,unknown>|null)=>unknown;
const click=(id:string)=>(dom.window.document.getElementById(id) as HTMLButtonElement).click();
const setup={ok:true,available:true,origin:"https://fixture.example",limits:{max_actions:3},capability:{route:"dreamgraph_harness"}};
const emptySessions={ok:true,sessions:[],total:0,next_cursor:null,snapshot_hash:"fixture",history_scope:"active_execution_store"};
const initialResponse=(path:string)=>path.includes('/sessions?')?emptySessions:setup;
beforeEach(()=>{calls=[];respond=initialResponse;dom=new JSDOM('<select id="architect-adapter-select"><option value="native_api_tool_loop">API</option><option value="codex-cli">CLI</option></select>'+COMPUTER_USE_MARKUP,{url:"http://127.0.0.1:8010/architect",runScripts:"outside-only"});
 Object.assign(dom.window,{fetch:async(path:string,options?:{body?:string})=>{const body=options?.body?JSON.parse(options.body):null;calls.push({path,body});const result=respond(path,body);return {ok:true,json:async()=>result};},AbortSignal});dom.window.eval(COMPUTER_USE_SCRIPT);});
afterEach(()=>{dom.window.dispatchEvent(new dom.window.Event("pagehide"));dom.window.close();vi.restoreAllMocks();});
it("opening/inspecting scope does not mint permission or create a pass and does not add a startup request",async()=>{
 expect(calls).toEqual([]);click("computer-use-open");await vi.waitFor(()=>expect(calls).toHaveLength(2));
 expect(calls.some(call=>call.path.includes("setup?adapter=native_api_tool_loop"))).toBe(true);expect(dom.window.document.getElementById("computer-use-drawer")!.hasAttribute("hidden")).toBe(false);
 expect(dom.window.document.getElementById("computer-use-confirm")!.hasAttribute("hidden")).toBe(true);
});
it("exact human confirmation is separate from preparation and loss retries preserve its ID",async()=>{
 let confirmations=0;respond=(path,body)=>path.endsWith("/prepare")?{ok:true,result:{id:"fixture-preparation",execution_id:"fixture-execution",interact:false,...setup}}:
  path.endsWith("/confirm")? (++confirmations===1?{error:"DECLARED_ACKNOWLEDGEMENT_LOST"}:{ok:true,result:{id:body!.id,execution_id:"fixture-execution",grant_id:"g"}}):initialResponse(path);
 click("computer-use-open");await vi.waitFor(()=>expect((dom.window.document.getElementById("computer-use-prepare") as HTMLButtonElement).disabled).toBe(false));
 click("computer-use-prepare");await vi.waitFor(()=>expect(dom.window.document.getElementById("computer-use-confirm")!.hasAttribute("hidden")).toBe(false));expect(confirmations).toBe(0);
 click("computer-use-confirm");await vi.waitFor(()=>expect(dom.window.document.getElementById("computer-use-state")!.textContent).toContain("ACKNOWLEDGEMENT_LOST"));
 click("computer-use-confirm");await vi.waitFor(()=>expect(dom.window.document.getElementById("computer-use-state")!.textContent).toContain("next pass only"));
 const confirmCalls=calls.filter(call=>call.path.endsWith("/confirm"));expect(confirmCalls).toHaveLength(2);expect(confirmCalls[0].body).toEqual(confirmCalls[1].body);
 (dom.window.document.getElementById("architect-adapter-select") as HTMLSelectElement).value="codex-cli";
 expect(()=>dom.window.eval("takeComputerPreparation(null)")).toThrow("ADAPTER_ROUTE_MISMATCH");
});
it("an unavailable native CLI keeps the requested mechanism visible and cannot prepare a harness",async()=>{
 respond=path=>path.includes('/sessions?')?emptySessions:({ok:true,available:false,route:"native_cli",reasons:["COMPUTER_NATIVE_CLI_CONFORMANCE_UNAVAILABLE"]});
 (dom.window.document.getElementById("architect-adapter-select") as HTMLSelectElement).value="codex-cli";click("computer-use-open");
 await vi.waitFor(()=>expect(dom.window.document.getElementById("computer-use-setup")!.textContent).toContain("NATIVE_CLI_CONFORMANCE_UNAVAILABLE"));
 expect((dom.window.document.getElementById("computer-use-prepare") as HTMLButtonElement).disabled).toBe(true);expect(calls).toHaveLength(2);
});
function journal(id="computer-one",state="recovery_required",stop_state="unknown") {return {session:{id,state,host_id:"original-host",terminal_reason:null},
 targets:[{origin:"https://fixture.example"}],capability:{effective:["observe","type"]},limits:{expires_at:new Date(Date.now()+30000).toISOString()},
 usage:{actions:1,images:0},stop_state,actions:[{receipt:{outcome:"unknown"}}]};}
it("reconnect discovers only retained descriptors and rechecks the exact original stop without a new pass or grant",async()=>{
 let recovered=false;respond=(path,body)=>path.includes('/sessions?')?{...emptySessions,sessions:[{cursor:"one",execution_id:"original-execution",journal:journal(),worker_available:true}],total:1}:
  path.includes('/status?')?{ok:true,journal:journal("computer-one",recovered?"stopped":"recovery_required",recovered?"acknowledged":"unknown"),worker_available:!recovered}:
  path.endsWith('/recover-stop')?(recovered=true,{ok:true}):initialResponse(path);
 click("computer-use-open");await vi.waitFor(()=>expect(dom.window.document.getElementById("computer-use-recover")!.hasAttribute("hidden")).toBe(false));
 click("computer-use-recover");await vi.waitFor(()=>expect(dom.window.document.getElementById("computer-use-state")!.textContent).toContain("stopped"));
 expect(calls.find(call=>call.path.endsWith('/recover-stop'))!.body).toEqual({execution_id:"original-execution",id:"computer-one"});
 expect(calls.every(call=>!/(prepare|confirm)$/.test(call.path))).toBe(true);
});
it("released input is displayed as stopping until termination is acknowledged",async()=>{
 let state='running',stop_state='not_requested',finish!:()=>void;const stopped=new Promise<void>(done=>finish=done);
 const current=()=>{const j=journal('computer-one',state,stop_state);return {...j,session:{...j.session,terminal_reason:state==='stopping'?'COMPUTER_INPUT_RELEASED_TERMINATION_PENDING':null}};};
 respond=path=>path.includes('/sessions?')?{...emptySessions,sessions:[{cursor:'one',execution_id:'original-execution',journal:current(),worker_available:true}],total:1}:
  path.includes('/status?')?{ok:true,journal:current(),worker_available:true}:
  path.endsWith('/stop')?(state='stopping',stop_state='requested',stopped.then(()=>({ok:true}))):initialResponse(path);
 click('computer-use-open');await vi.waitFor(()=>expect(dom.window.document.getElementById('computer-use-stop')!.hasAttribute('hidden')).toBe(false));
 click('computer-use-stop');expect(dom.window.document.getElementById('computer-use-state')!.textContent).toContain('Stopping');
 await dom.window.eval('pollComputerState()');expect(dom.window.document.getElementById('computer-use-state')!.textContent).toContain('input released · confirming termination');
 state='stopped';stop_state='acknowledged';finish();await vi.waitFor(()=>expect(dom.window.document.getElementById('computer-use-state')!.textContent).toContain('stopped'));
});
it("a missing original worker keeps recovery visible without offering renewed input or claiming a stop",async()=>{
 respond=path=>path.includes('/sessions?')?{...emptySessions,sessions:[{cursor:"one",execution_id:"original-execution",journal:journal(),worker_available:false}],total:1}:
  path.includes('/status?')?{ok:true,journal:journal(),worker_available:false}:initialResponse(path);
 click("computer-use-open");await vi.waitFor(()=>expect(dom.window.document.getElementById("computer-use-state")!.textContent).toContain("original worker unavailable; recovery unresolved"));
 expect(dom.window.document.getElementById("computer-use-stop")!.hasAttribute("hidden")).toBe(true);expect(dom.window.document.getElementById("computer-use-recover")!.hasAttribute("hidden")).toBe(true);
 expect(calls.every(call=>!call.body)).toBe(true);
});
it("a late observation from the prior selection cannot replace the selected session or show its pixels",async()=>{
 let reply!:(value:unknown)=>void;const late=new Promise(resolve=>reply=resolve);
 respond=path=>path.includes('/sessions?')?{...emptySessions,sessions:[{cursor:"one",execution_id:"execution-one",journal:journal()},{cursor:"two",execution_id:"execution-two",journal:journal("computer-two")}],total:2}:
  path.includes('/status?')?{ok:true,journal:journal(path.includes('execution-two')?"computer-two":"computer-one"),worker_available:false}:
  path.includes('/observation?')?late:initialResponse(path);
 click("computer-use-open");await vi.waitFor(()=>expect(calls.some(call=>call.path.includes('/status?'))).toBe(true));click("computer-use-inspect");
 const select=dom.window.document.getElementById("computer-use-sessions") as HTMLSelectElement;select.value="two";select.dispatchEvent(new dom.window.Event("change"));
 await vi.waitFor(()=>expect(calls.some(call=>call.path.includes('/status?')&&call.path.includes('execution-two'))).toBe(true));
 reply({ok:true,observation:{observation:{id:"old"},summary:"OLD PRIVATE SUMMARY",image:{mime_type:"image/png",data_base64:"old-pixels"}}});
 await late;await new Promise(resolve=>setTimeout(resolve,0));expect(dom.window.document.getElementById("computer-use-evidence")!.textContent).not.toContain("OLD PRIVATE");
 expect(dom.window.document.getElementById("computer-use-image")!.hasAttribute("src")).toBe(false);
});
function changeRole(value:string){const select=dom.window.document.getElementById("computer-use-model-role") as HTMLSelectElement;select.value=value;select.dispatchEvent(new dom.window.Event("change"));}
it("a late setup for the old model cannot enable a rejected new model",async()=>{
 let reply!:(value:unknown)=>void;const late=new Promise(resolve=>reply=resolve);
 respond=path=>path.includes('/sessions?')?emptySessions:path.includes('model_role=architect')?late:{...setup,available:false,reason:"NEW_ROLE_UNAVAILABLE"};
 click("computer-use-open");await vi.waitFor(()=>expect(calls).toHaveLength(2));changeRole("computer_use");
 await vi.waitFor(()=>expect(dom.window.document.getElementById("computer-use-setup")!.textContent).toContain("NEW_ROLE_UNAVAILABLE"));reply(setup);await late;await new Promise(resolve=>setTimeout(resolve,0));
 expect((dom.window.document.getElementById("computer-use-prepare") as HTMLButtonElement).disabled).toBe(true);expect(dom.window.document.getElementById("computer-use-setup")!.textContent).toContain("NEW_ROLE_UNAVAILABLE");
});
it.each(["prepare","confirm"])("a late %s reply cannot attach the old scope to a new model selection",async phase=>{
 let reply!:(value:unknown)=>void;const late=new Promise(resolve=>reply=resolve),prepared={id:"old-preparation",execution_id:"old-execution",interact:true,...setup};
 respond=path=>path.endsWith('/'+phase)?late:path.endsWith('/prepare')?{ok:true,result:prepared}:initialResponse(path);
 click("computer-use-open");await vi.waitFor(()=>expect((dom.window.document.getElementById("computer-use-prepare") as HTMLButtonElement).disabled).toBe(false));click("computer-use-prepare");
 if(phase==="confirm"){await vi.waitFor(()=>expect(dom.window.document.getElementById("computer-use-confirm")!.hasAttribute("hidden")).toBe(false));click("computer-use-confirm");}
 await vi.waitFor(()=>expect(calls.some(call=>call.path.endsWith('/'+phase))).toBe(true));changeRole("computer_use");reply({ok:true,result:prepared});await late;await new Promise(resolve=>setTimeout(resolve,0));
 expect(dom.window.eval("takeComputerPreparation(null)")).toBeNull();expect(dom.window.document.getElementById("computer-use-confirm")!.hasAttribute("hidden")).toBe(true);
 expect(dom.window.document.getElementById("computer-use-state")!.textContent).toContain("Selection changed");expect(calls.some(call=>call.path.includes('/status?'))).toBe(false);
});
it("pause and resume use the selected original fence and retain independent Stop while paused",async()=>{
 let paused=false,fence=1;respond=(path,body)=>path.includes('/sessions?')?{...emptySessions,sessions:[{cursor:"one",execution_id:"original-execution",journal:journal("computer-one","running","not_requested")}],total:1}:
  path.includes('/status?')?{ok:true,journal:{...journal("computer-one",paused?"paused":"running","not_requested"),session:{...journal().session,id:"computer-one",state:paused?"paused":"running",fence},pause_state:paused?"acknowledged":"not_requested"},worker_available:true,pause_supported:true}:
  path.endsWith('/pause')?(paused=true,fence++,{ok:true}):path.endsWith('/resume')?(paused=false,fence++,{ok:true}):initialResponse(path);
 click("computer-use-open");await vi.waitFor(()=>expect(dom.window.document.getElementById("computer-use-pause")!.hasAttribute("hidden")).toBe(false));click("computer-use-pause");
 await vi.waitFor(()=>expect(dom.window.document.getElementById("computer-use-pause")!.textContent).toBe("Resume"));expect(dom.window.document.getElementById("computer-use-stop")!.hasAttribute("hidden")).toBe(false);
 click("computer-use-pause");await vi.waitFor(()=>expect(dom.window.document.getElementById("computer-use-pause")!.textContent).toBe("Pause"));
 expect(calls.find(call=>call.path.endsWith('/pause'))!.body).toEqual({execution_id:"original-execution",id:"computer-one",fence:1});expect(calls.find(call=>call.path.endsWith('/resume'))!.body).toEqual({execution_id:"original-execution",id:"computer-one",fence:2});
});
