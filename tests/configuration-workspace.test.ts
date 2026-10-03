import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { createServer, request as httpRequest, type Server } from "node:http";
import { mkdtemp, mkdir, rm, readFile, writeFile, cp, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { JSDOM, VirtualConsole } from "jsdom";
import * as lifecycle from "../src/instance/lifecycle.js";
import { handleDashboardRoute } from "../src/server/dashboard.js";
import { handleApiRoute } from "../src/api/routes.js";
import { getLlmConfig, initLlmProvider, getDreamerLlmConfig, type LlmConfig } from "../src/cognitive/llm.js";
import * as llm from "../src/cognitive/llm.js";
import { getSchedulerConfig, updateSchedulerConfig, stopScheduler } from "../src/cognitive/scheduler.js";
import { getDataDir, setDataDirOverride } from "../src/utils/paths.js";
import { releaseGraphWriter } from "../src/graph/writer-lease.js";
import { parseEngineEnvDocument } from "../src/config/engine-env-document.js";
import { engineSettingCatalogue, resolveComponentSettings } from "../src/config/engine-setting-catalogue.js";
import { loadCanonicalGraph } from "../src/graph/read-model.js";
import { EngineJobs } from "../src/cognitive/jobs.js";
import { withSessionContext, type SessionContext } from "../src/server/session-context.js";
import {handleComputerHttp} from "../src/computer/http.js";

let directory: string, configDir: string, dataDir: string, envPath: string, previous: string, server: Server, url: string, dom: JSDOM | undefined;
let oldModel: LlmConfig, oldScheduler: ReturnType<typeof getSchedulerConfig>, envBefore: Record<string, string | undefined>;
let requestOwner: SessionContext | undefined;
beforeEach(async () => {
  envBefore = { ...process.env }; oldModel = { ...getLlmConfig() }; oldScheduler = getSchedulerConfig(); previous = getDataDir();
  directory = await mkdtemp(join(tmpdir(), "dg-settings-workspace-")); configDir = join(directory, "config"); dataDir = join(directory, "data"); envPath = join(configDir, "engine.env");
  await mkdir(configDir); await mkdir(dataDir);
  for (const file of (await readdir(resolve("templates/default"))).filter(file => file.endsWith(".json"))) await cp(resolve("templates/default", file), join(dataDir, file));
  setDataDirOverride(dataDir);
  for (const key of Object.keys(process.env)) if (key.startsWith("DREAMGRAPH_LLM_")) delete process.env[key];
  process.env.DREAMGRAPH_LLM_PROVIDER = "none"; process.env.DREAMGRAPH_LLM_MODEL = "old-model";
  process.env.DG_SCHEDULER_ENABLED="false";
  await writeFile(envPath, "# retained notes\nDREAMGRAPH_LLM_PROVIDER=none\nDREAMGRAPH_LLM_MODEL=old-model\nDREAMGRAPH_LLM_API_KEY=private-secret\nCUSTOM_SECRET=private-custom\nDG_SCHEDULER_ENABLED=false\nDG_SCHEDULER_MAX_RUNS_HR=7\n");
  initLlmProvider(); stopScheduler(); updateSchedulerConfig({ enabled: false }); requestOwner = undefined;
  vi.spyOn(lifecycle, "getActiveScope").mockReturnValue({ uuid: "workspace-fixture", name: "Fixture", configDir, dataDir, projectRoot: directory, repos: {}, engineEnvPath: envPath } as never);
  server = createServer((req, res) => {
    const run = async () => {
      const pathname = new URL(req.url!, "http://localhost").pathname;
      return await handleComputerHttp(req, res, pathname) || await handleApiRoute(req, res, pathname) || await handleDashboardRoute(req, res, pathname);
    };
    void (requestOwner ? withSessionContext(requestOwner, run) : run()).then(handled => { if (!handled) { res.statusCode = 404; res.end(); } }).catch(() => { res.statusCode = 500; res.end(JSON.stringify({ error: "fixture error" })); });
  });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done)); url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterEach(async () => {
  if(dom?.window.document.querySelector('#configuration-workspace'))await eventually(()=>{const root=dom!.window.document.querySelector<HTMLElement>('#configuration-workspace')!;return root.dataset.loading!=='true'&&root.dataset.busy!=='true';});
  dom?.window.close(); dom = undefined; if (server?.listening) { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
  stopScheduler(); updateSchedulerConfig({ ...oldScheduler, enabled: false }); vi.restoreAllMocks();
  for (const key of Object.keys(process.env)) if (!(key in envBefore)) delete process.env[key]; Object.assign(process.env, envBefore); initLlmProvider(oldModel);
  await releaseGraphWriter(configDir); await releaseGraphWriter(dataDir);for(const part of ["workers","targets"])await releaseGraphWriter(join(configDir,"computer-use",part)).catch(error=>{if(error.code!=="ENOENT")throw error;});setDataDirOverride(previous); await rm(directory, { recursive: true, force: true });
});
async function post(path: string, body: unknown) { const response = await fetch(url + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() }; }
async function eventually(check: () => boolean | Promise<boolean>) { for (let i = 0; i < 150; i++) { if (await check()) return; await new Promise(done => setTimeout(done, 15)); } throw Error("Browser condition not reached"); }
type FetchInterceptor = (path: string, input: RequestInit | undefined, send: () => Promise<Response>) => Promise<Response>;
async function browser(path = "/config", intercept?: FetchInterceptor) {
  const errors: string[] = [], console = new VirtualConsole(); console.on("jsdomError", error => errors.push(error.message));
  dom = await JSDOM.fromURL(url + path, { resources: "usable", runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: console, beforeParse(window) {
    window.fetch = ((path: any, input: any) => { const send = () => fetch(new URL(path, url), String(path).includes('/computer/')&&input?.method==='POST'?{...input,headers:{...input.headers,Origin:url,'Sec-Fetch-Mode':'cors'}}:input); return intercept ? intercept(String(path), input, send) : send(); }) as any;
    window.structuredClone = structuredClone; Object.defineProperty(window.crypto, "randomUUID", { value: randomUUID });
    Object.defineProperty(window.AbortSignal, "timeout", { value: AbortSignal.timeout });
  } });
  if (path.split("?")[0] === "/config") await eventually(() => !!dom!.window.document.querySelector("#cw-count")?.textContent?.includes("settings") && dom!.window.document.querySelector<HTMLElement>('#configuration-workspace')!.dataset.loading==='false');
  else await eventually(() => !!dom!.window.document.querySelector("#rw-observed")?.textContent?.includes("Read at"));
  return { document: dom.window.document, errors };
}
function find(document: Document, key: string) {
  const search = document.querySelector<HTMLInputElement>("#cw-search")!; search.value = key; search.dispatchEvent(new dom!.window.Event("input", { bubbles: true }));
  return document.querySelector<HTMLDetailsElement>(`[data-key="${key}"]`)!;
}

it("keeps the embedded configuration workspace functional under the same save authority", async () => {
  const { document, errors } = await browser("/config?embed=architect");
  expect(document.body.dataset.architectWorkspace).toBe("config");
  expect(document.querySelector("#cw-count")?.textContent).toContain("settings");
  edit(document, "DG_SCHEDULER_MAX_RUNS_HR", "0");
  (document.querySelector("#cw-save") as HTMLButtonElement).click();
  await eventually(async () => (await readFile(envPath, "utf8")).includes("DG_SCHEDULER_MAX_RUNS_HR=0"));
  expect((await readFile(envPath, "utf8"))).toContain("CUSTOM_SECRET=private-custom");
  expect(errors).toEqual([]);
});
function edit(document: Document, key: string, value: string) {
  let row = find(document, key), toggle = row.querySelector<HTMLInputElement>(".cw-enabled input")!;
  if (!toggle.checked) { toggle.click(); row = document.querySelector(`[data-key="${key}"]`)!; }
  const input = row.querySelector<HTMLInputElement>(".cw-edit input, .cw-body>div input[type=password], .cw-body input[autocomplete=new-password]")!;
  input.value = value; input.dispatchEvent(new dom!.window.Event("input", { bubbles: true })); return input;
}

it("maps every consumed setting to one typed control or named read-only exception without leaking stored secrets", async () => {
  const { document, errors } = await browser();
  for (const field of engineSettingCatalogue()) { const row = find(document, field.key); expect(row, field.key).toBeTruthy();
    if (field.apply === "read_only") expect(row.querySelector(".cw-readonly")?.textContent).toBeTruthy();
    else expect(row.querySelector(".cw-enabled input"), field.key).toBeTruthy();
  }
  expect(document.body.textContent).not.toContain("private-secret"); expect(document.body.textContent).not.toContain("private-custom");
  expect(dom!.window.localStorage.length).toBe(1); // Only the existing last-tab navigation preference.
  expect(errors).toEqual([]); expect((await new EngineJobs().inspect()).records).toHaveLength(0);
  const modelRow=find(document,'DREAMGRAPH_LLM_DREAMER_MODEL');modelRow.querySelector<HTMLInputElement>('.cw-enabled input')!.click();
  const options=[...modelRow.querySelectorAll<HTMLOptionElement>('datalist option')].map(option=>option.value);expect(options).toContain('gpt-6.1-sol');expect(options).toContain('claude-opus-5-5');expect(modelRow.querySelector<HTMLInputElement>('.cw-edit input')!.list).toBeTruthy();
});
it("keeps invalid drafts and keyboard tab state, then saves an independent zero limit without enabling work", async () => {
  const { document, errors } = await browser();
  edit(document, "DG_SCHEDULER_MAX_RUNS_HR", "-1"); (document.querySelector("#cw-save") as HTMLButtonElement).click();
  expect(document.querySelector(".cw-error")!.textContent).toBeTruthy();
  const tab = document.querySelector<HTMLButtonElement>("#cw-tab-models")!; tab.dispatchEvent(new dom!.window.KeyboardEvent("keydown", { key: "End", bubbles: true }));
  expect(document.querySelector("#cw-tab-advanced")!.getAttribute("aria-selected")).toBe("true");
  expect(find(document, "DG_SCHEDULER_MAX_RUNS_HR").querySelector(".cw-error")!.textContent).toBeTruthy();
  edit(document, "DG_SCHEDULER_MAX_RUNS_HR", "0"); (document.querySelector("#cw-save") as HTMLButtonElement).click();
  await eventually(async () => parseEngineEnvDocument(await readFile(envPath, "utf8")).DG_SCHEDULER_MAX_RUNS_HR === "0");
  await eventually(() => document.querySelector("#cw-draft-count")!.textContent === "No unsaved changes");
  expect(getSchedulerConfig().max_runs_per_hour).toBe(0); expect((await new EngineJobs().inspect()).records).toHaveLength(0); expect(errors).toEqual([]);
});
it("edits structured component settings and retains explicit zeros/default inheritance through restart parsing", async () => {
  const { document, errors } = await browser(); const row = find(document, "DREAMGRAPH_EVENTS"); row.querySelector<HTMLInputElement>(".cw-enabled input")!.click();
  const cooldown = [...row.querySelectorAll<HTMLLabelElement>(".cw-property>label")].find(label => label.textContent?.includes("cooldown ms"))!; cooldown.querySelector<HTMLInputElement>("input")!.click();
  const input = row.querySelector<HTMLInputElement>('input[aria-label="events cooldown_ms"]')!; input.value = "0"; input.dispatchEvent(new dom!.window.Event("input", { bubbles: true }));
  (document.querySelector("#cw-save") as HTMLButtonElement).click(); await eventually(async () => JSON.parse(parseEngineEnvDocument(await readFile(envPath, "utf8")).DREAMGRAPH_EVENTS ?? "{}").cooldown_ms === 0);
  expect(errors).toEqual([]); expect((await new EngineJobs().inspect()).records).toHaveLength(0);
});
it("retains a whole captured save after a committed lost reply and recovers that receipt without a second effect", async () => {
  let lose = true; const payloads: string[] = [];
  const { document, errors } = await browser("/config", async (path, input, send) => { if (path === "/api/config/v1/apply") { payloads.push(String(input!.body)); const response = await send(); if (lose) { lose = false; await response.text(); throw Error("fixture lost reply"); } return response; } return send(); });
  edit(document, "DREAMGRAPH_LLM_MODEL", "new-model"); (document.querySelector("#cw-save") as HTMLButtonElement).click();
  await eventually(() => !(document.querySelector("#cw-retry") as HTMLButtonElement).hidden);
  expect(document.querySelector("#cw-message")!.textContent).toContain("uncertain"); expect(document.querySelector<HTMLButtonElement>("#cw-save")!.disabled).toBe(true);
  (document.querySelector("#cw-retry") as HTMLButtonElement).click(); await eventually(() => document.querySelector("#cw-draft-count")!.textContent === "No unsaved changes");
  expect(payloads).toHaveLength(2); expect(payloads[1]).toBe(payloads[0]); expect(await readdir(join(configDir, ".engine-config"))).toHaveLength(1);
  const receiptFolder = (await readdir(join(configDir, ".engine-config")))[0]; expect(await readdir(join(configDir, ".engine-config", receiptFolder))).toHaveLength(1); expect(errors).toEqual([]);
});
it("keeps drafts on concurrent revision refusal and never overwrites the intervening file", async () => {
  const { document } = await browser(); edit(document, "DREAMGRAPH_LLM_MODEL", "my-draft");
  const state = await (await fetch(url + "/api/config/v1")).json(); await post("/api/config/v1/apply", { expected_revision: state.result.revision, operation_id: "other", updates: { DREAMGRAPH_LLM_MODEL: "other-writer" } });
  (document.querySelector("#cw-save") as HTMLButtonElement).click(); await eventually(() => !!document.querySelector("#cw-message")!.textContent?.includes("CONFIG_REVISION_CONFLICT"));
  expect(parseEngineEnvDocument(await readFile(envPath, "utf8")).DREAMGRAPH_LLM_MODEL).toBe("other-writer"); expect(find(document, "DREAMGRAPH_LLM_MODEL").querySelector<HTMLInputElement>(".cw-edit input")!.value).toBe("my-draft");
});
it("previews a scoped template without writes, applies protected staging and undoes the original bytes", async () => {
  const original = await readFile(envPath, "utf8"), dataBefore = await readFile(join(dataDir, "features.json"), "utf8");
  const { document, errors } = await browser(); const template = document.querySelector<HTMLSelectElement>("#cw-template")!; template.value = "ollama"; template.dispatchEvent(new dom!.window.Event("change"));
  (document.querySelector("#cw-preview") as HTMLButtonElement).click(); await eventually(() => !document.querySelector<HTMLButtonElement>("#cw-apply-template")!.disabled);
  expect(await readFile(envPath, "utf8")).toBe(original); expect(document.querySelector("#cw-diff")!.textContent).not.toContain("private-secret");
  (document.querySelector("#cw-apply-template") as HTMLButtonElement).click(); await eventually(async () => parseEngineEnvDocument(await readFile(envPath, "utf8")).DREAMGRAPH_LLM_PROVIDER === "ollama");
  expect(process.env.DREAMGRAPH_LLM_PROVIDER).toBe("none"); expect(parseEngineEnvDocument(await readFile(envPath, "utf8")).DREAMGRAPH_LLM_API_KEY).toBe("private-secret");
  await eventually(() => !document.querySelector<HTMLButtonElement>("#cw-undo")!.disabled); (document.querySelector("#cw-undo") as HTMLButtonElement).click();
  await eventually(async () => (await readFile(envPath, "utf8")) === original); expect(await readFile(join(dataDir, "features.json"), "utf8")).toBe(dataBefore); expect(errors).toEqual([]);
});
it("generic apply refreshes actual cached model controls and daemon role readback without touching session overrides", async () => {
  delete process.env.DG_SCHEDULER_ENABLED; // Independent runtime pause must survive a model-only save.
  getDreamerLlmConfig(); const state = await (await fetch(url + "/api/config/v1")).json();
  const input = { expected_revision: state.result.revision, operation_id: "policy", updates: { DREAMGRAPH_LLM_PROVIDER: "openai", DREAMGRAPH_LLM_MODEL: "gpt-5.4", DREAMGRAPH_LLM_API: "responses", DREAMGRAPH_LLM_RETENTION: "store_false", DREAMGRAPH_LLM_TEMPERATURE: "0", DREAMGRAPH_LLM_MAX_TOKENS: "1600", DREAMGRAPH_LLM_DREAMER_MODEL: "gpt-5.4-mini" } };
  const saved = await post("/api/config/v1/apply", input); expect(saved.status).toBe(200); expect(saved.body.activation.status).toBe("activated");
  expect(getLlmConfig()).toMatchObject({ provider: "openai", model: "gpt-5.4", api: "responses", store: false, temperature: 0, maxTokens: 1600 }); expect(getDreamerLlmConfig().model).toBe("gpt-5.4-mini");
  requestOwner = { principal: "operator", session_id: "first", directory: dataDir, channel: "browser", environment: { DREAMGRAPH_LLM_ARCHITECT_MODEL: "session-model" }, continuation_key: "fixture" };
  const roles = await (await fetch(url + "/api/config/v1/roles")).json(); expect(roles.result).toHaveLength(6); expect(roles.result.find((role: any) => role.role === "architect").requested.model).toBe("gpt-5.4");
  expect(JSON.stringify(roles)).not.toContain("private-secret"); expect(requestOwner.environment.DREAMGRAPH_LLM_ARCHITECT_MODEL).toBe("session-model");
  expect((await post("/api/config/v1/apply", input)).body.activation.status).toBe("readback_required"); expect((await new EngineJobs().inspect()).records).toHaveLength(0);expect(getSchedulerConfig().enabled).toBe(false);
});
it("structured edits remove only corresponding legacy aliases and preserve unrelated zero limits",async()=>{
  await writeFile(envPath,(await readFile(envPath,'utf8'))+'DREAMGRAPH_SCHEDULER={"max_runs_per_hour":30,"global_cooldown_ms":10000}\nDG_SCHEDULER_MAX_RUNS_HR=0\nDG_SCHEDULER_COOLDOWN=0\n');
  Object.assign(process.env,parseEngineEnvDocument(await readFile(envPath,'utf8')));updateSchedulerConfig(resolveComponentSettings('scheduler',process.env));
  const {document}=await browser();const row=find(document,'DREAMGRAPH_SCHEDULER');expect(row.textContent).toContain('Resolved component');expect(row.textContent).toContain('DG_SCHEDULER_MAX_RUNS_HR');
  const input=row.querySelector<HTMLInputElement>('input[aria-label="scheduler global_cooldown_ms"]')!;input.value='25';input.dispatchEvent(new dom!.window.Event('input',{bubbles:true}));(document.querySelector('#cw-save') as HTMLButtonElement).click();
  await eventually(()=>document.querySelector<HTMLElement>('#configuration-workspace')!.dataset.busy==='false');
  const saved=parseEngineEnvDocument(await readFile(envPath,'utf8'));expect(saved.DG_SCHEDULER_COOLDOWN).toBeUndefined();expect(saved.DG_SCHEDULER_MAX_RUNS_HR).toBe('0');expect(getSchedulerConfig()).toMatchObject({enabled:false,global_cooldown_ms:25,max_runs_per_hour:0});expect((await new EngineJobs().inspect()).records).toHaveLength(0);
});
it("a runtime activation failure preserves the committed save, restores prior runtime and excludes secret error text",async()=>{
  const state=await(await fetch(url+'/api/config/v1')).json();vi.spyOn(llm,'initLlmProvider').mockImplementationOnce(()=>{throw Error('private-secret');});
  const result=await post('/api/config/v1/apply',{expected_revision:state.result.revision,operation_id:'activation-failure',updates:{DREAMGRAPH_LLM_MODEL:'saved-model'}});
  expect(result.status).toBe(200);expect(result.body.receipt.status).toBe('committed');expect(result.body.activation.status).toBe('restart_required');expect(JSON.stringify(result)).not.toContain('private-secret');
  expect(parseEngineEnvDocument(await readFile(envPath,'utf8')).DREAMGRAPH_LLM_MODEL).toBe('saved-model');expect(process.env.DREAMGRAPH_LLM_MODEL).toBe('old-model');expect(getLlmConfig().model).toBe('old-model');expect(result.body.result.settings.find((field:any)=>field.key==='DREAMGRAPH_LLM_MODEL').mismatch).toBe(true);expect(getSchedulerConfig().enabled).toBe(false);
});
it("recent and active pagination retains session isolation and refuses cancellation of another session job",async()=>{
  const jobs=new EngineJobs(),shared=await jobs.accept({operation_id:'shared',owner:'daemon',action:'graph_maintenance',scope:['fixture'],roles:['normalizer']});
  const own=await jobs.accept({operation_id:'own',owner:'operator',session_id:'first',lifetime:'session_bound',action:'graph_maintenance',scope:['fixture'],roles:['normalizer']});
  const foreign=await jobs.accept({operation_id:'foreign',owner:'operator',session_id:'second',lifetime:'session_bound',action:'graph_maintenance',scope:['fixture'],roles:['normalizer']});
  requestOwner={principal:'operator',session_id:'first',directory:dataDir,channel:'browser',environment:{},continuation_key:'fixture'};
  const page=await(await fetch(url+'/api/jobs/v1?order=recent&state=active&limit=1')).json();expect(page.total).toBe(2);expect(page.records[0].job.id).toBe(own.job.id);expect(page.next_offset).toBe(1);
  const second=await(await fetch(url+'/api/jobs/v1?order=recent&state=active&limit=1&offset=1')).json();expect(second.records[0].job.id).toBe(shared.job.id);
  const refused=await post('/api/schedules/v2/commands',{operation_id:'bad-cancel',action:'cancel_job',target_id:foreign.job.id,expected_revision:0});expect(refused.body.error).toBe('JOB_OWNER_MISMATCH');expect((await jobs.inspect()).records.find(r=>r.job.id===foreign.job.id)!.job.state).toBe('queued');
  expect((await fetch(url+'/api/jobs/v1?order=unknown')).status).toBe(409);
});
it("preserves fragmented UTF-8 configuration bytes and rejects invalid encoding before any file write",async()=>{
  const state=await(await fetch(url+'/api/config/v1')).json(),model='määrä🌿',body=Buffer.from(JSON.stringify({expected_revision:state.result.revision,operation_id:'utf8',updates:{DREAMGRAPH_LLM_MODEL:model}}));
  const split=body.indexOf(Buffer.from('ä'))+1;
  const response=await new Promise<{status:number;body:any}>((done,reject)=>{const request=httpRequest(url+'/api/config/v1/apply',{method:'POST',headers:{'Content-Type':'application/json','Content-Length':body.length}},res=>{const chunks:Buffer[]=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>done({status:res.statusCode!,body:JSON.parse(Buffer.concat(chunks).toString('utf8'))}));});request.on('error',reject);request.write(body.subarray(0,split));setTimeout(()=>request.end(body.subarray(split)),10);});
  expect(response.status).toBe(200);expect(parseEngineEnvDocument(await readFile(envPath,'utf8')).DREAMGRAPH_LLM_MODEL).toBe(model);
  const before=await readFile(envPath,'utf8'),invalid=Buffer.from('{"broken":"\u00ff"}');invalid[invalid.indexOf(Buffer.from('ÿ'))]=255;
  const refused=await fetch(url+'/api/config/v1/apply',{method:'POST',headers:{'Content-Type':'application/json'},body:invalid});expect(refused.status).toBe(400);expect((await refused.json()).error).toBe('CONFIG_INVALID_ENCODING');expect(await readFile(envPath,'utf8')).toBe(before);
});
it("reports a staged deletion as a mismatch until restart clears the old runtime override", async () => {
  const state = await (await fetch(url + "/api/config/v1")).json(); const staged = await post("/api/config/v1/template/preview", { template: "default", keys: ["DREAMGRAPH_LLM_MODEL"] });
  const result = await post("/api/config/v1/template/apply", { template: "default", keys: ["DREAMGRAPH_LLM_MODEL"], expected_revision: state.result.revision, expected_template_hash: staged.body.result.template_hash, operation_id: "remove" });
  const setting = result.body.result.settings.find((row: any) => row.key === "DREAMGRAPH_LLM_MODEL"); expect(setting).toMatchObject({ persisted: null, effective: "old-model", mismatch: true });
  delete process.env.DREAMGRAPH_LLM_MODEL; initLlmProvider(); const after = await (await fetch(url + "/api/config/v1")).json(); expect(after.result.settings.find((row: any) => row.key === "DREAMGRAPH_LLM_MODEL")).toMatchObject({ persisted: null, effective: null, mismatch: false });
});
it("root runtime uses canonical currency and shows actual scoped queued cancellation without inventing stop or retry", async () => {
  const record = await new EngineJobs().accept({ operation_id: "queued", owner: "daemon", action: "graph_maintenance", scope: ["fixture"], roles: ["normalizer"] });
  const graph = await loadCanonicalGraph("workspace-fixture"), state = await (await fetch(url + "/api/dashboard/v1")).json(); expect(state.graph.currency).toEqual(graph.currency); expect(state.graph.revision).toEqual(graph.revision);
  const { document, errors } = await browser("/"); expect(document.querySelector('a[href="/explorer/"]')).toBeTruthy(); await eventually(() => !!document.querySelector("#rw-jobs button"));
  expect(document.querySelector("#rw-currency")!.textContent).toContain("An old scan date alone"); (document.querySelector("#rw-jobs button") as HTMLButtonElement).click();
  await eventually(async () => (await new EngineJobs().inspect()).records.find(r => r.job.id === record.job.id)!.job.state === "cancelled");
  await eventually(() => !!document.querySelector("#rw-message")!.textContent?.includes("Cancellation requested")); expect(errors).toEqual([]);
});
it("schema-driven Computer Use profiles load only on demand and recover the exact real CAS save after lost acknowledgement",async()=>{
 requestOwner={principal:"operator",session_id:"profile-editor",directory:dataDir,channel:"browser",environment:{},continuation_key:"private-fixture"};
 const target={schema:"dreamgraph.browser_target_definition.v1",id:"local-target",initial_url:"https://fixture.example/app",main_origin:"https://fixture.example",main_path_prefix:"/app",navigation:false,
 network:[{origin:"https://fixture.example",path_prefix:"/app",methods:["GET"],allow_query:false}],blocked_origins:[],elements:[{id:"status",selector:"#status",read_text:true,read_value:false,operations:[]}],
 postconditions:[{id:"ready",selector:"#status",kind:"text_equals",expected:"Ready"}],observation_bytes:4096,action_timeout_ms:2000,max_actions:1,
 images:{enabled:false,region:null,mask_selectors:[],max_bytes:0,max_count:0,total_bytes:0},redactions:[]};
 await mkdir(join(configDir,"computer-use/targets"),{recursive:true});const file=join(configDir,"computer-use/targets/local-target.json");await writeFile(file,JSON.stringify(target));const before=await readFile(envPath,"utf8");
 const requests:Array<{path:string;body:string|undefined}>=[];let lost=true;
 const {document,errors}=await browser('/config',async(path,input,send)=>{requests.push({path,body:input?.body as string|undefined});const response=await send();
  if(path.endsWith('/computer/profiles/apply')&&lost){lost=false;throw new Error('DECLARED_PROFILE_SAVE_ACK_LOST');}return response;});
 expect(requests.some(row=>row.path.includes('/computer/'))).toBe(false);(document.querySelector('#cw-tab-computer') as HTMLButtonElement).click();
 const details=document.querySelector<HTMLDetailsElement>('#cw-computer-profiles')!;expect(details.hidden).toBe(false);details.open=true;
 await eventually(()=>document.querySelector('#cw-computer-status')!.textContent!.includes('Select a name'));
 const kind=document.querySelector<HTMLSelectElement>('#cw-computer-kind')!;kind.value='target';kind.dispatchEvent(new dom!.window.Event('change'));
 const id=document.querySelector<HTMLInputElement>('#cw-computer-id')!;id.value='local-target';id.dispatchEvent(new dom!.window.Event('input'));
 (document.querySelector('#cw-computer-read') as HTMLButtonElement).click();await eventually(()=>document.querySelector('#cw-computer-status')!.textContent!.includes('Saved profile loaded'));
 const input=document.querySelector<HTMLInputElement>('input[aria-label="Computer target postconditions 0 expected"]')!;expect(input).toBeTruthy();input.value='Current';input.dispatchEvent(new dom!.window.Event('input',{bubbles:true}));
 (document.querySelector('#cw-computer-save') as HTMLButtonElement).click();await eventually(()=>!document.querySelector<HTMLButtonElement>('#cw-computer-retry')!.hidden);
 expect(JSON.parse(await readFile(file,'utf8')).postconditions[0].expected).toBe('Current');expect(document.querySelector('#cw-computer-status')!.textContent).toContain('uncertain');
 (document.querySelector('#cw-computer-retry') as HTMLButtonElement).click();await eventually(()=>document.querySelector<HTMLButtonElement>('#cw-computer-save')!.disabled&&document.querySelector('#cw-computer-status')!.textContent!.includes('no activation or grant'));
 const saves=requests.filter(row=>row.path.endsWith('/computer/profiles/apply'));expect(saves).toHaveLength(2);expect(saves[0].body).toBe(saves[1].body);
 expect(await readFile(envPath,'utf8')).toBe(before);expect((await new EngineJobs().inspect()).records).toHaveLength(0);expect(errors).toEqual([]);
});
