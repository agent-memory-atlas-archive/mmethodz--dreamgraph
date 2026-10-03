import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {createServer,type Server} from "node:http";
import {mkdtemp,rm,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {JSDOM,VirtualConsole} from "jsdom";
import {randomUUID} from "node:crypto";
import {handleDashboardRoute} from "../src/server/dashboard.js";
import {handleApiRoute} from "../src/api/routes.js";
import {EngineJobs} from "../src/cognitive/jobs.js";
import {createSchedule,duplicateSchedule,getScheduleSnapshot,getSchedules,updateSchedule,getSchedulerConfig,updateSchedulerConfig,stopScheduler} from "../src/cognitive/scheduler.js";
import {scheduleDraftPreview,scheduleActionDescriptors} from "../src/server/schedule-workspace-contract.js";
import {getDataDir,setDataDirOverride} from "../src/utils/paths.js";
import {releaseGraphWriter} from "../src/graph/writer-lease.js";
import {commitGraphWrites} from "../src/graph/publication.js";
let directory:string,previous:string,server:Server,url:string,dom:JSDOM|undefined,config:ReturnType<typeof getSchedulerConfig>;
beforeEach(async()=>{previous=getDataDir();directory=await mkdtemp(join(tmpdir(),"dg-schedule-workspace-"));setDataDirOverride(directory);config=getSchedulerConfig();stopScheduler();updateSchedulerConfig({enabled:false,global_cooldown_ms:0,nightmare_cooldown_ms:0,execution_timeout_ms:10000});
 server=createServer((req,res)=>{const path=new URL(req.url!,"http://localhost").pathname;void (async()=>{if(await handleApiRoute(req,res,path))return;if(await handleDashboardRoute(req,res,path))return;res.writeHead(404);res.end();})().catch(error=>{res.writeHead(500);res.end(String(error));});});
 await new Promise<void>(done=>server.listen(0,"127.0.0.1",done));url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
});
afterEach(async()=>{dom?.window.close();dom=undefined;server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));stopScheduler();updateSchedulerConfig({...config,enabled:false});vi.unstubAllEnvs();
 await releaseGraphWriter(directory);setDataDirOverride(previous);await rm(directory,{recursive:true,force:true});});
const post=async(path:string,body:unknown)=>{const response=await fetch(url+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
const create=(name="Maintenance")=>createSchedule({name,action:"graph_maintenance",trigger_type:"interval",interval_ms:60000});
async function eventually(test:()=>boolean|Promise<boolean>){for(let i=0;i<100;i++){if(await test())return;await new Promise(done=>setTimeout(done,20));}throw new Error("fixture condition not reached");}
async function browser(query=""){const errors:string[]=[];const virtualConsole=new VirtualConsole();virtualConsole.on("jsdomError",error=>errors.push(error.message));
 dom=await JSDOM.fromURL(url+"/schedules"+query,{resources:"usable",runScripts:"dangerously",pretendToBeVisual:true,virtualConsole,beforeParse(window){window.fetch=((path:any,input:any)=>fetch(new URL(path,url),input)) as any;window.structuredClone=structuredClone;Object.defineProperty(window.crypto,"randomUUID",{value:randomUUID});window.HTMLElement.prototype.scrollIntoView=()=>{};}});
 await eventually(()=>!!dom!.window.document.querySelector("#sw-runtime")?.textContent?.includes("revision"));return {document:dom.window.document,errors};
}
it("schema-derived action fields and draft preview validate without creating files/jobs or changing definitions",async()=>{
 const descriptors=scheduleActionDescriptors();expect(descriptors).toHaveLength(7);expect(descriptors.find(d=>d.action==="dream_cycle")!.fields.focus_hops.maximum).toBe(4);
 const preview=await post("/api/schedules/v2/validate",{draft:{name:"Dry draft",action:"dream_cycle",parameters:{focus_entities:["a"],focus_hops:1,max_dreams:10},trigger_type:"interval",interval_ms:60000}});
 expect(preview.status).toBe(200);expect(preview.body.occurrences).toHaveLength(5);expect(preview.body.model_calls_possible).toBe(true);expect(preview.body.estimated_actual_cost).toBeNull();expect(preview.body.effective_policies.map((p:any)=>p.role)).toEqual(["dreamer","normalizer"]);
 expect((await new EngineJobs().inspect()).records).toHaveLength(0);expect(await getSchedules()).toEqual([]);await expect(readFile(join(directory,"schedules.json"))).rejects.toMatchObject({code:"ENOENT"});
 const invalid=await post("/api/schedules/v2/validate",{draft:{name:"Invalid parameters",action:"dream_cycle",trigger_type:"interval",interval_ms:60000,parameters:{focus_hops:99}}});expect(invalid.status).toBe(409);expect(invalid.body.fields[0].field).toBe("parameters.focus_hops");
 expect((await new EngineJobs().inspect()).records).toHaveLength(0);
});
it("duplicate is atomic/new/disabled and original receipt replays after later source edits",async()=>{
 const original=await create();const controls={expected_revision:1,operation_id:"duplicate"};const copy=await duplicateSchedule(original.id,controls);expect(copy.id).not.toBe(original.id);expect(copy.enabled).toBe(false);expect(copy.run_count).toBe(0);
 await updateSchedule(original.id,{name:"Later"},{expected_revision:1,operation_id:"edit"});expect(await duplicateSchedule(original.id,controls)).toEqual(copy);
 await expect(duplicateSchedule(original.id,{expected_revision:1,operation_id:"stale"})).rejects.toThrow("SCHEDULE_REVISION_CONFLICT");
});
it("enable and enqueue bind reviewed policy; lost replies replay originals rather than applying new ambient policy",async()=>{
 const schedule=await create(),preview=await scheduleDraftPreview({},schedule);
 const enable={target_id:schedule.id,expected_revision:1,operation_id:"enable",action:"update",updates:{enabled:true},preview_digest:preview.preview_digest};
 expect((await post("/api/schedules/v2/commands",{...enable,preview_digest:undefined})).body.error).toBe("SCHEDULE_ENABLE_PREVIEW_REQUIRED");
 const first=await post("/api/schedules/v2/commands",enable);expect(first.status).toBe(200);expect(first.body.result.enabled).toBe(true);
 vi.stubEnv("DREAMGRAPH_LLM_NORMALIZER_MODEL","changed-model");expect(await post("/api/schedules/v2/commands",enable)).toEqual(first);
 const current=(await getSchedules())[0],next=await scheduleDraftPreview({},current);vi.stubEnv("DREAMGRAPH_LLM_NORMALIZER_MODEL","other-model");
 const blocked=await post("/api/schedules/v2/commands",{target_id:current.id,expected_revision:2,operation_id:"run",action:"enqueue",preview_digest:next.preview_digest});expect(blocked.body.error).toBe("SCHEDULE_POLICY_PREVIEW_CONFLICT");expect((await new EngineJobs().inspect()).records).toHaveLength(0);
});
it("actual served browser script saves disabled, preserves invalid drafts, and supports keyboard tabs/filter/edit",async()=>{
 await create("Alpha");await create("Beta");const {document,errors}=await browser();
 (document.querySelector("#sw-new") as HTMLButtonElement).click();const form=document.querySelector("#sw-editor") as HTMLFormElement;
 (form.elements.namedItem("name") as HTMLInputElement).value="Browser created";
 const trigger=form.elements.namedItem("trigger_type") as HTMLSelectElement;trigger.value="cron_like";trigger.dispatchEvent(new dom!.window.Event("change",{bubbles:true}));
 (form.elements.namedItem("cron") as HTMLInputElement).value="bad cron";(document.querySelector("#sw-preview") as HTMLButtonElement).click();await eventually(()=>document.querySelector("#sw-field-errors")!.textContent!.includes("SCHEDULE_INVALID_CRON"));expect(form.hidden).toBe(false);expect(await getSchedules()).toHaveLength(2);
 trigger.value="interval";trigger.dispatchEvent(new dom!.window.Event("change",{bubbles:true}));(form.elements.namedItem("duration") as HTMLInputElement).value="2";(form.elements.namedItem("unit") as HTMLSelectElement).value="60000";
 form.dispatchEvent(new dom!.window.Event("submit",{bubbles:true,cancelable:true}));await eventually(async()=>(await getSchedules()).length===3);await eventually(()=>form.hidden&&document.querySelector("#sw-status")!.textContent!.includes("Authority readback"));
 expect((await getSchedules()).find(s=>s.name==="Browser created")).toMatchObject({enabled:false,interval_ms:120000});expect((await new EngineJobs().inspect()).records).toHaveLength(0);
 const tab=document.querySelector("#sw-tab-schedules") as HTMLButtonElement;tab.focus();tab.dispatchEvent(new dom!.window.KeyboardEvent("keydown",{key:"End",bubbles:true}));expect(document.querySelector("#sw-tab-runs")!.getAttribute("aria-selected")).toBe("true");
 expect(errors).toEqual([]);
});
it("captured menu targets survive selection changes and stale edits fail while source history survives",async()=>{
 const alpha=await create("Alpha"),beta=await create("Beta");const {document,errors}=await browser();
 const row=Array.from(document.querySelectorAll(".sw-row")).find(row=>row.textContent!.includes("Alpha"))!;const overflow=row.querySelector('[aria-label="Actions for Alpha"]') as HTMLButtonElement;overflow.click();
 const menu=document.querySelector('[role="menu"]')!;const edit=Array.from(menu.querySelectorAll("button")).find(b=>b.textContent==="Edit")!;
 (Array.from(document.querySelectorAll(".sw-select")).find(b=>b.textContent!.startsWith("Beta")) as HTMLButtonElement).click();edit.click();
 const form=document.querySelector("#sw-editor") as HTMLFormElement;expect((form.elements.namedItem("name") as HTMLInputElement).value).toBe("Alpha");
 await updateSchedule(alpha.id,{name:"Other client"},{expected_revision:1,operation_id:"other"});(form.elements.namedItem("name") as HTMLInputElement).value="Lost edit";form.dispatchEvent(new dom!.window.Event("submit",{bubbles:true,cancelable:true}));
 await eventually(()=>document.querySelector("#sw-status")!.textContent!.includes("SCHEDULE_REVISION_CONFLICT"));expect(form.hidden).toBe(false);expect((await getSchedules()).find(s=>s.id===beta.id)!.name).toBe("Beta");expect((await getSchedules()).find(s=>s.id===alpha.id)!.name).toBe("Other client");expect(errors).toEqual([]);
});
it("shows an invalid legacy strategy without flooding the row or silently replacing its value",async()=>{
 const schedule=await createSchedule({name:"Stabilize additive scan",action:"dream_cycle",parameters:{strategy:"all"},trigger_type:"interval",interval_ms:60000});
 const file=JSON.parse(await readFile(join(directory,"schedules.json"),"utf8"));file.schedules[0].parameters.strategy="associative";
 await commitGraphWrites({actor:"legacy-fixture",scope:["schedules.json"],writes:[{file:"schedules.json",content:JSON.stringify(file)}]});
 const {document,errors}=await browser();const row=document.querySelector(".sw-row")!;
 expect(row.querySelector(".sw-row-status")!.textContent).toBe("Invalid definition");
 expect(row.querySelector(".sw-row-status")!.textContent).not.toContain("invalid_enum_value");
 expect(row.querySelector(".sw-select")!.textContent).toContain("Stabilize additive scan");
 (row.querySelector(".sw-select") as HTMLButtonElement).click();
 expect(document.querySelector(".sw-invalid")!.textContent).toContain("associative");
 expect(document.querySelector(".sw-invalid")!.textContent).toContain("dispatch blocked");
 expect((Array.from(document.querySelectorAll("#sw-detail button")).find(node=>node.textContent==="Run now") as HTMLButtonElement).disabled).toBe(true);
 (Array.from(document.querySelectorAll("#sw-detail button")).find(node=>node.textContent==="Edit") as HTMLButtonElement).click();
 const form=document.querySelector("#sw-editor") as HTMLFormElement,strategy=form.elements.namedItem("param:strategy") as HTMLSelectElement;
 expect(strategy.value).toBe("associative");expect(strategy.selectedOptions[0].textContent).toContain("Unsupported legacy value");
 (document.querySelector("#sw-preview") as HTMLButtonElement).click();
 await eventually(()=>document.querySelector("#sw-field-errors")!.textContent!.includes("parameters.strategy"));
 expect((await getSchedules()).find(item=>item.id===schedule.id)!.parameters.strategy).toBe("associative");
 strategy.value="all";strategy.dispatchEvent(new dom!.window.Event("change",{bubbles:true}));
 form.dispatchEvent(new dom!.window.Event("submit",{bubbles:true,cancelable:true}));
 await eventually(async()=>((await getSchedules()).find(item=>item.id===schedule.id)?.parameters.strategy)==="all");
 await eventually(()=>form.hidden&&document.querySelector("#sw-status")!.textContent!.includes("Authority readback"));
 expect(errors).toEqual([]);
});

it('captured schedule navigation opens the exact draft or run preview without mutating definitions or enqueueing work',async()=>{
 const alpha=await create('Captured Alpha'),beta=await create('Other Beta');const before=await getSchedules();
 const {document,errors}=await browser('?'+new URLSearchParams({schedule:alpha.id,revision:String(alpha.definition_revision),view:'run'}));
 await eventually(()=>!!document.querySelector('.sw-confirm'));
 expect(document.querySelector('#sw-detail')!.textContent).toContain('Captured Alpha');expect(document.querySelector('.sw-confirm')!.textContent).toContain('Enqueue this run');
 expect(await getSchedules()).toEqual(before);expect((await new EngineJobs().inspect()).records).toHaveLength(0);
 (document.querySelector('#sw-refresh') as HTMLButtonElement).click();await eventually(()=>document.querySelector('#sw-status')!.textContent!.startsWith('Authority readback'));
 expect(document.querySelector('.sw-confirm')!.textContent).toContain('Enqueue this run');expect((await getSchedules()).find(s=>s.id===beta.id)!.name).toBe('Other Beta');expect(errors).toEqual([]);
});
it('stale captured schedule navigation shows inspection and never opens or dispatches a replacement action',async()=>{
 const alpha=await create('Before edit');await updateSchedule(alpha.id,{name:'New definition'},{expected_revision:alpha.definition_revision,operation_id:'navigation-other-owner'});
 const {document,errors}=await browser('?'+new URLSearchParams({schedule:alpha.id,revision:String(alpha.definition_revision),view:'run'}));
 await eventually(()=>document.querySelector('#sw-status')!.textContent!.includes('revision changed'));
 expect(document.querySelector('#sw-detail')!.textContent).toContain('New definition');expect(document.querySelector('.sw-confirm')).toBeNull();expect((document.querySelector('#sw-editor') as HTMLFormElement).hidden).toBe(true);
 expect((await new EngineJobs().inspect()).records).toHaveLength(0);expect(errors).toEqual([]);
});
it('missing captured schedule navigation retains an honest unavailable selection rather than opening another definition',async()=>{
 await create('Available different definition');const {document,errors}=await browser('?schedule=missing-original&revision=1&view=edit');
 await eventually(()=>document.querySelector('#sw-status')!.textContent!.includes('No replacement selected'));
 expect(document.querySelector('#sw-detail')!.textContent).toContain('Select a definition');expect((document.querySelector('#sw-editor') as HTMLFormElement).hidden).toBe(true);expect((await new EngineJobs().inspect()).records).toHaveLength(0);expect(errors).toEqual([]);
});
