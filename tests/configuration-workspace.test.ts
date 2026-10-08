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
  await releaseGraphWriter(configDir); await releaseGraphWriter(dataDir);for(const part of ["workers","targets"])await releaseGraphWriter(join(configDir,"computer-use",part)).catch(error=>{if(error.code!=="ENOENT")throw error;});setDataDirOverride(previous);
  // Windows may still be releasing a just-closed writer handle after the DOM and HTTP server settle.
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
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
  if (path.split("?")[0] === "/config") await eventually(() => dom!.window.document.querySelector<HTMLElement>('#configuration-workspace')?.dataset.loading === 'false');
  else await eventually(() => !!dom!.window.document.querySelector("#rw-observed")?.textContent?.includes("Read at"));
  return { document: dom.window.document, errors };
}
function advancedInput(document: Document, key: string) {
  document.querySelector<HTMLButtonElement>("#cw-tab-advanced")!.click();
  const expert = [...document.querySelectorAll<HTMLDetailsElement>("#cw-panel details")].find(row => row.querySelector("summary")?.textContent?.includes("All engine.env settings"))!;
  expert.open = true;
  const filter = expert.querySelector<HTMLInputElement>('input[type="search"]')!;
  filter.value = key; filter.dispatchEvent(new dom!.window.Event("input", { bubbles: true }));
  return expert.querySelector<HTMLInputElement>(`input[aria-label="${key}"]`)!;
}

function editArchitect(document: Document, key: string, value: string) {
  const input = document.querySelector<HTMLSelectElement>("#f-" + key)!;
  input.value = value; input.dispatchEvent(new dom!.window.Event("change", { bubbles: true }));
}
it("persists the Claude route and checks setup without sending credentials or an API request", async () => {
  let readinessBody: unknown;
  const { document, errors } = await browser("/config?tab=architect", async (path, input, send) => {
    if (path === "/api/architect/v1/provider-readiness") {
      readinessBody = JSON.parse(String(input?.body));
      return new Response(JSON.stringify({ ok: true, readiness: { ready: false, detail: "CLAUDE_LOGIN_REQUIRED" } }), { headers: { "Content-Type": "application/json" } });
    }
    return send();
  });
  editArchitect(document, "DREAMGRAPH_LLM_ARCHITECT_ADAPTER", "claude-cli");
  editArchitect(document, "DREAMGRAPH_LLM_ARCHITECT_MODEL", "claude-opus-5-5");
  const effort = document.querySelector<HTMLSelectElement>('#f-DREAMGRAPH_LLM_ARCHITECT_REASONING_EFFORT')!;
  expect([...effort.options].map(option => option.value)).toEqual(["", "low", "medium", "high", "xhigh", "max"]);
  editArchitect(document, "DREAMGRAPH_LLM_ARCHITECT_REASONING_EFFORT", "max");
  (document.querySelector("#cw-save") as HTMLButtonElement).click();
  await eventually(async () => (await readFile(envPath, "utf8")).includes("DREAMGRAPH_LLM_ARCHITECT_MODEL=claude-opus-5-5"));
  await eventually(() => document.querySelector<HTMLElement>("#configuration-workspace")?.dataset.busy === "false");
  document.querySelector<HTMLButtonElement>("#cw-tab-architect")!.click();
  expect(document.body.textContent).toContain("irm https://claude.ai/install.ps1 | iex");
  expect(document.body.textContent).toContain("dedicated profile");
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Check Claude setup")!.click();
  await eventually(() => !!readinessBody);
  expect(readinessBody).toEqual({ adapter: "claude-cli", model: "claude-opus-5-5", reasoning_effort: "max" });
  expect(await readFile(envPath, "utf8")).toContain("DREAMGRAPH_LLM_ARCHITECT_REASONING_EFFORT=max");
  expect(document.body.textContent).not.toContain("private-secret");
  expect(await readFile(envPath, "utf8")).toContain("DREAMGRAPH_LLM_ARCHITECT_ADAPTER=claude-cli");
  expect(errors).toEqual([]);
});
it("offers model-specific effort choices and an explicit clearing path", async () => {
  const { document, errors } = await browser("/config?tab=architect");
  const effort = () => document.querySelector<HTMLSelectElement>("#f-DREAMGRAPH_LLM_ARCHITECT_REASONING_EFFORT")!;
  editArchitect(document, "DREAMGRAPH_LLM_ARCHITECT_ADAPTER", "codex-cli");
  expect(effort().querySelector('option[value="max"]')).not.toBeNull();
  editArchitect(document, "DREAMGRAPH_LLM_ARCHITECT_ADAPTER", "claude-cli");
  editArchitect(document, "DREAMGRAPH_LLM_ARCHITECT_MODEL", "claude-opus-5-5");
  editArchitect(document, "DREAMGRAPH_LLM_ARCHITECT_REASONING_EFFORT", "xhigh");
  editArchitect(document, "DREAMGRAPH_LLM_ARCHITECT_MODEL", "claude-opus-4-6");
  expect(effort().value).toBe("xhigh");
  expect(effort().selectedOptions[0].disabled).toBe(true);
  expect(effort().disabled).toBe(false);
  editArchitect(document, "DREAMGRAPH_LLM_ARCHITECT_REASONING_EFFORT", "");
  editArchitect(document, "DREAMGRAPH_LLM_ARCHITECT_MODEL", "claude-haiku-4-5");
  expect(effort().disabled).toBe(true);
  expect(document.querySelector("#f-DREAMGRAPH_LLM_ARCHITECT_MODEL")?.tagName).toBe("SELECT");
  editArchitect(document, "DREAMGRAPH_LLM_ARCHITECT_MODEL", "__custom");
  const custom = document.querySelector<HTMLInputElement>('[data-key="DREAMGRAPH_LLM_ARCHITECT_MODEL"] input')!;
  expect(custom.hidden).toBe(false);
  custom.value="claude-custom"; custom.dispatchEvent(new dom!.window.Event("input",{bubbles:true}));
  custom.dispatchEvent(new dom!.window.Event("change",{bubbles:true}));
  expect(effort().disabled).toBe(true);
  document.querySelector<HTMLButtonElement>("#cw-save")!.click();
  await eventually(async()=> (await readFile(envPath,"utf8")).includes("DREAMGRAPH_LLM_ARCHITECT_MODEL=claude-custom"));
  expect(await readFile(envPath,"utf8")).toMatch(/DREAMGRAPH_LLM_ARCHITECT_REASONING_EFFORT=(?=\r?\n|$)/);
  expect(errors).toEqual([]);
});
it("keeps the embedded configuration workspace functional under the same save authority", async () => {
  const { document, errors } = await browser("/config?embed=architect");
  expect(document.body.dataset.architectWorkspace).toBe("config");
  expect(document.querySelector("#cfg-source")?.textContent).toContain("engine.env");
  edit(document, "DG_SCHEDULER_MAX_RUNS_HR", "0");
  (document.querySelector("#cw-save") as HTMLButtonElement).click();
  await eventually(async () => (await readFile(envPath, "utf8")).includes("DG_SCHEDULER_MAX_RUNS_HR=0"));
  expect((await readFile(envPath, "utf8"))).toContain("CUSTOM_SECRET=private-custom");
  expect(errors).toEqual([]);
});
it("previews, applies and undoes a named template from Advanced without exposing or resetting secrets", async () => {
  const original = await readFile(envPath, "utf8");
  const { document, errors } = await browser("/config?tab=advanced");
  const template = document.querySelector<HTMLSelectElement>("#cw-template")!;
  template.value = "ollama"; template.dispatchEvent(new dom!.window.Event("change"));
  (document.querySelector("#cw-preview") as HTMLButtonElement).click();
  await eventually(() => document.querySelector("#cw-diff")!.textContent!.includes("changes;") && !(document.querySelector("#cw-apply-template") as HTMLButtonElement).disabled);
  expect(await readFile(envPath, "utf8")).toBe(original);
  expect(document.querySelector("#cw-diff")!.textContent).not.toContain("private-secret");
  (document.querySelector("#cw-apply-template") as HTMLButtonElement).click();
  await eventually(async () => (await readFile(envPath, "utf8")) !== original && !(document.querySelector("#cw-undo") as HTMLButtonElement).disabled);
  expect(await readFile(envPath, "utf8")).toContain("DREAMGRAPH_LLM_API_KEY=private-secret");
  expect(await readFile(envPath, "utf8")).toContain("CUSTOM_SECRET=private-custom");
  (document.querySelector("#cw-undo") as HTMLButtonElement).click();
  await eventually(async () => (await readFile(envPath, "utf8")) === original);
  expect(errors).toEqual([]);
});
it("recovers an uncertain template apply before ordinary saves and keeps later drafts", async () => {
  let lose = true; const payloads: string[] = [];
  const { document } = await browser('/config', async (path, input, send) => {
    if (path === '/api/config/v1/template/apply') { payloads.push(String(input!.body)); const response = await send(); if (lose) { lose = false; await response.text(); throw Error('template acknowledgement lost'); } return response; }
    return send();
  });
  document.querySelector<HTMLButtonElement>('#cw-tab-advanced')!.click();
  const template = document.querySelector<HTMLSelectElement>('#cw-template')!; template.value = 'ollama'; template.dispatchEvent(new dom!.window.Event('change'));
  document.querySelector<HTMLButtonElement>('#cw-preview')!.click();
  await eventually(() => !document.querySelector<HTMLButtonElement>('#cw-apply-template')!.disabled);
  document.querySelector<HTMLButtonElement>('#cw-apply-template')!.click();
  await eventually(() => document.querySelector('#cw-message')!.textContent!.includes('outcome uncertain'));
  edit(document, 'DREAMGRAPH_LLM_MODEL', 'later-draft');
  for (const id of ['cw-save', 'cw-refresh', 'cw-discard', 'cw-undo']) expect(document.querySelector<HTMLButtonElement>('#' + id)!.disabled, id).toBe(true);
  expect(document.querySelector<HTMLButtonElement>('#cw-apply-template')!.disabled).toBe(false);
  document.querySelector<HTMLButtonElement>('#cw-apply-template')!.click();
  await eventually(() => document.querySelector('#cw-draft-count')!.textContent === '1 unsaved change' && document.querySelector<HTMLElement>('#configuration-workspace')!.dataset.busy === 'false' && document.querySelector('#cw-message')!.textContent!.includes('Template applied'));
  expect(payloads).toHaveLength(2); expect(payloads[0]).toBe(payloads[1]);
  expect(advancedInput(document, 'DREAMGRAPH_LLM_MODEL').value).toBe('later-draft');
});
function edit(document: Document, key: string, value: string) {
  const input = advancedInput(document, key);
  input.value = value; input.dispatchEvent(new dom!.window.Event("input", { bubbles: true })); return input;
}

it("keeps the full editable inventory available behind Advanced without leaking stored secrets", async () => {
  const { document, errors } = await browser();
  document.querySelector<HTMLButtonElement>('#cw-tab-advanced')!.click();
  const expert = [...document.querySelectorAll<HTMLDetailsElement>('#cw-panel details')].find(row => row.querySelector('summary')?.textContent?.includes('All engine.env settings'))!;
  expert.open = true;
  const inventory = new Set([...expert.querySelectorAll<HTMLInputElement>('input[aria-label]')].map(input => input.getAttribute('aria-label')));
  for (const field of engineSettingCatalogue().filter(field => field.apply !== 'read_only' && !field.secret)) expect(inventory.has(field.key), field.key).toBe(true);
  expect(document.body.textContent).not.toContain("private-secret"); expect(document.body.textContent).not.toContain("private-custom");
  expect(dom!.window.localStorage.length).toBe(1); // Only the existing last-tab navigation preference.
  expect(errors).toEqual([]); expect((await new EngineJobs().inspect()).records).toHaveLength(0);
  document.querySelector<HTMLButtonElement>('#cw-tab-models')!.click();
  expect(document.querySelector<HTMLInputElement>('#f-DREAMGRAPH_LLM_API_KEY')!.type).toBe('password');
  expect(document.querySelector<HTMLSelectElement>('#f-DREAMGRAPH_LLM_PROVIDER')!.options.length).toBeGreaterThan(3);
});
it("keeps invalid drafts and keyboard tab state, then saves an independent zero limit without enabling work", async () => {
  const { document, errors } = await browser();
  document.querySelector<HTMLButtonElement>('#cw-tab-automation')!.click();
  const limit = document.querySelector<HTMLInputElement>('#c-scheduler-max_runs_per_hour')!;
  limit.value = '-1'; limit.dispatchEvent(new dom!.window.Event('input', { bubbles: true }));
  (document.querySelector("#cw-save") as HTMLButtonElement).click();
  await eventually(() => document.querySelector('#cw-message')!.textContent!.includes('Not saved'));
  expect((await readFile(envPath, 'utf8'))).toContain('DG_SCHEDULER_MAX_RUNS_HR=7');
  const tab = document.querySelector<HTMLButtonElement>("#cw-tab-models")!; tab.dispatchEvent(new dom!.window.KeyboardEvent("keydown", { key: "End", bubbles: true }));
  expect(document.querySelector("#cw-tab-advanced")!.getAttribute("aria-selected")).toBe("true");
  document.querySelector<HTMLButtonElement>('#cw-tab-automation')!.click();
  const valid = document.querySelector<HTMLInputElement>('#c-scheduler-max_runs_per_hour')!;
  valid.value = '0'; valid.dispatchEvent(new dom!.window.Event('input', { bubbles: true }));
  (document.querySelector("#cw-save") as HTMLButtonElement).click();
  await eventually(async () => JSON.parse(parseEngineEnvDocument(await readFile(envPath, 'utf8')).DREAMGRAPH_SCHEDULER || '{}').max_runs_per_hour === 0);
  await eventually(() => document.querySelector("#cw-draft-count")!.textContent === "No unsaved changes");
  expect(getSchedulerConfig().max_runs_per_hour).toBe(0); expect((await new EngineJobs().inspect()).records).toHaveLength(0); expect(errors).toEqual([]);
});
it("edits structured component settings and retains explicit zeros/default inheritance through restart parsing", async () => {
  const { document, errors } = await browser(); document.querySelector<HTMLButtonElement>('#cw-tab-automation')!.click();
  const input = document.querySelector<HTMLInputElement>('#c-events-cooldown_ms')!; input.value = "0"; input.dispatchEvent(new dom!.window.Event("input", { bubbles: true }));
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
it("keeps a later draft separate from the exact captured replay after a lost reply", async () => {
  let lose = true; const payloads: string[] = [];
  const { document } = await browser('/config', async (path, input, send) => {
    if (path === '/api/config/v1/apply') {
      payloads.push(String(input!.body)); const response = await send();
      if (lose) { lose = false; await response.text(); throw Error('fixture lost reply'); }
      return response;
    }
    return send();
  });
  edit(document, 'DREAMGRAPH_LLM_MODEL', 'first-model');
  (document.querySelector('#cw-save') as HTMLButtonElement).click();
  await eventually(() => !document.querySelector<HTMLButtonElement>('#cw-retry')!.hidden);
  expect(document.querySelector<HTMLButtonElement>('#cw-refresh')!.disabled).toBe(true);
  edit(document, 'DREAMGRAPH_LLM_MODEL', 'later-draft');
  (document.querySelector('#cw-retry') as HTMLButtonElement).click();
  await eventually(() => document.querySelector('#cw-draft-count')!.textContent === '1 unsaved change' && document.querySelector<HTMLElement>('#configuration-workspace')!.dataset.busy === 'false');
  expect(payloads.slice(0, 2)).toEqual([payloads[0], payloads[0]]);
  expect(parseEngineEnvDocument(await readFile(envPath, 'utf8')).DREAMGRAPH_LLM_MODEL).toBe('first-model');
  expect(advancedInput(document, 'DREAMGRAPH_LLM_MODEL').value).toBe('later-draft');
  (document.querySelector('#cw-save') as HTMLButtonElement).click();
  await eventually(async () => parseEngineEnvDocument(await readFile(envPath, 'utf8')).DREAMGRAPH_LLM_MODEL === 'later-draft');
  expect(payloads).toHaveLength(3);
});
it("keeps drafts on concurrent revision refusal and never overwrites the intervening file", async () => {
  const { document } = await browser(); edit(document, "DREAMGRAPH_LLM_MODEL", "my-draft");
  const state = await (await fetch(url + "/api/config/v1")).json(); await post("/api/config/v1/apply", { expected_revision: state.result.revision, operation_id: "other", updates: { DREAMGRAPH_LLM_MODEL: "other-writer" } });
  (document.querySelector("#cw-save") as HTMLButtonElement).click(); await eventually(() => !!document.querySelector("#cw-message")!.textContent?.includes("changed somewhere else"));
  expect(parseEngineEnvDocument(await readFile(envPath, "utf8")).DREAMGRAPH_LLM_MODEL).toBe("other-writer"); expect(advancedInput(document, "DREAMGRAPH_LLM_MODEL").value).toBe("my-draft");
});
it("saves a provider edit through the current workspace and undoes the original bytes", async () => {
  const original = await readFile(envPath, "utf8"), dataBefore = await readFile(join(dataDir, "features.json"), "utf8");
  const { document, errors } = await browser(); edit(document, 'DREAMGRAPH_LLM_PROVIDER', 'ollama');
  (document.querySelector("#cw-save") as HTMLButtonElement).click(); await eventually(async () => parseEngineEnvDocument(await readFile(envPath, "utf8")).DREAMGRAPH_LLM_PROVIDER === "ollama");
  expect(process.env.DREAMGRAPH_LLM_PROVIDER).toBe("ollama"); expect(parseEngineEnvDocument(await readFile(envPath, "utf8")).DREAMGRAPH_LLM_API_KEY).toBe("private-secret");
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
  const {document}=await browser();document.querySelector<HTMLButtonElement>('#cw-tab-automation')!.click();
  const input=document.querySelector<HTMLInputElement>('#c-scheduler-global_cooldown_ms')!;input.value='0.025';input.dispatchEvent(new dom!.window.Event('input',{bubbles:true}));(document.querySelector('#cw-save') as HTMLButtonElement).click();
  await eventually(async()=>JSON.parse(parseEngineEnvDocument(await readFile(envPath,'utf8')).DREAMGRAPH_SCHEDULER||'{}').global_cooldown_ms===25);
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
it("edits Computer Use policy without reading scoped profiles or granting a session", async () => {
  const requests: string[] = [];
  const { document, errors } = await browser('/config', async (path, _input, send) => { requests.push(path); return send(); });
  document.querySelector<HTMLButtonElement>('#cw-tab-computer')!.click();
  expect(requests.filter(path => path.includes('/computer/')).every(path => path === '/api/architect/v1/computer/browser-bridge')).toBe(true);
  const policy = document.querySelector<HTMLInputElement>('input[name="cu-policy"][value="deny"]')!;
  policy.click(); (document.querySelector('#cw-save') as HTMLButtonElement).click();
  await eventually(async () => parseEngineEnvDocument(await readFile(envPath, 'utf8')).DREAMGRAPH_COMPUTER_USE_POLICY === 'deny');
  expect((await new EngineJobs().inspect()).records).toHaveLength(0);
  expect(requests.filter(path => path.includes('/computer/')).every(path => path === '/api/architect/v1/computer/browser-bridge')).toBe(true);
  expect(errors).toEqual([]);
});
it("edits a scoped Computer Use target and replays its captured profile save after lost acknowledgement", async () => {
  requestOwner = { principal: 'operator', session_id: 'profile-editor', directory: dataDir, channel: 'browser', environment: {}, continuation_key: 'private-fixture' };
  const target = { schema: 'dreamgraph.browser_target_definition.v1', id: 'local-target', initial_url: 'https://fixture.example/app', main_origin: 'https://fixture.example', main_path_prefix: '/app', navigation: false,
    network: [{ origin: 'https://fixture.example', path_prefix: '/app', methods: ['GET'], allow_query: false }], blocked_origins: [], elements: [{ id: 'status', selector: '#status', read_text: true, read_value: false, operations: [] }],
    postconditions: [{ id: 'ready', selector: '#status', kind: 'text_equals', expected: 'Ready' }], observation_bytes: 4096, action_timeout_ms: 2000, max_actions: 1,
    images: { enabled: false, region: null, mask_selectors: [], max_bytes: 0, max_count: 0, total_bytes: 0 }, redactions: [] };
  await mkdir(join(configDir, 'computer-use/targets'), { recursive: true });
  const file = join(configDir, 'computer-use/targets/local-target.json'); await writeFile(file, JSON.stringify(target));
  const before = await readFile(envPath, 'utf8'), payloads: string[] = []; let lose = true;
  const { document, errors } = await browser('/config', async (path, input, send) => {
    if (path.endsWith('/computer/profiles/apply')) { payloads.push(String(input!.body)); const response = await send(); if (lose) { lose = false; await response.text(); throw Error('profile acknowledgement lost'); } return response; }
    return send();
  });
  document.querySelector<HTMLButtonElement>('#cw-tab-computer')!.click();
  const details = document.querySelector<HTMLDetailsElement>('#cw-computer-profiles')!; details.open = true;
  await eventually(() => document.querySelector('#cw-computer-status')!.textContent!.includes('Select a name'));
  const kind = document.querySelector<HTMLSelectElement>('#cw-computer-kind')!; kind.value = 'target'; kind.dispatchEvent(new dom!.window.Event('change'));
  const id = document.querySelector<HTMLInputElement>('#cw-computer-id')!; id.value = 'local-target'; id.dispatchEvent(new dom!.window.Event('input'));
  document.querySelector<HTMLButtonElement>('#cw-computer-read')!.click();
  await eventually(() => document.querySelector('#cw-computer-status')!.textContent!.includes('Saved profile loaded'));
  const expected = document.querySelector<HTMLInputElement>('input[aria-label="Computer target postconditions 0 expected"]')!;
  expect(expected).toBeTruthy(); expected.value = 'Current'; expected.dispatchEvent(new dom!.window.Event('input', { bubbles: true }));
  document.querySelector<HTMLButtonElement>('#cw-computer-save')!.click();
  await eventually(() => !document.querySelector<HTMLButtonElement>('#cw-computer-retry')!.hidden);
  expect(document.querySelector('#cw-computer-status')!.textContent).toContain('uncertain');
  expect(JSON.parse(await readFile(file, 'utf8')).postconditions[0].expected).toBe('Current');
  document.querySelector<HTMLButtonElement>('#cw-computer-retry')!.click();
  await eventually(() => document.querySelector<HTMLButtonElement>('#cw-computer-save')!.disabled && document.querySelector('#cw-computer-status')!.textContent!.includes('no activation or grant'));
  expect(payloads).toHaveLength(2); expect(payloads[0]).toBe(payloads[1]);
  expect(await readFile(envPath, 'utf8')).toBe(before); expect((await new EngineJobs().inspect()).records).toHaveLength(0); expect(errors).toEqual([]);
});
it("retains a profile read when the operator leaves the Computer Use tab mid-request", async () => {
  requestOwner = { principal: 'operator', session_id: 'profile-editor', directory: dataDir, channel: 'browser', environment: {}, continuation_key: 'fixture' };
  let release: (() => void) | undefined;
  const { document, errors } = await browser('/config', async (path, _input, send) => {
    if (path.startsWith('/api/architect/v1/computer/profiles/read?')) await new Promise<void>(resolve => { release = resolve; });
    return send();
  });
  document.querySelector<HTMLButtonElement>('#cw-tab-computer')!.click();
  document.querySelector<HTMLDetailsElement>('#cw-computer-profiles')!.open = true;
  await eventually(() => document.querySelector('#cw-computer-status')!.textContent!.includes('Select a name'));
  const id = document.querySelector<HTMLInputElement>('#cw-computer-id')!; id.value = 'new-target'; id.dispatchEvent(new dom!.window.Event('input'));
  document.querySelector<HTMLButtonElement>('#cw-computer-read')!.click(); await eventually(() => !!release);
  document.querySelector<HTMLButtonElement>('#cw-tab-models')!.click(); release!();
  await new Promise(done => setTimeout(done, 30));
  document.querySelector<HTMLButtonElement>('#cw-tab-computer')!.click();
  document.querySelector<HTMLDetailsElement>('#cw-computer-profiles')!.open = true;
  await eventually(() => document.querySelector('#cw-computer-status')!.textContent!.includes('restored'));
  expect(document.querySelector<HTMLInputElement>('#cw-computer-id')!.value).toBe('new-target');
  expect(errors).toEqual([]);
});
