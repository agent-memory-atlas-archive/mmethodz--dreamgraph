import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import * as lifecycle from "../src/instance/lifecycle.js";
import { handleDashboardRoute } from "../src/server/dashboard.js";
import { getSchedulerConfig, stopScheduler } from "../src/cognitive/scheduler.js";
import { loadEngineEnv } from "../src/utils/engine-env.js";
import { resolveComponentSettings } from "../src/config/engine-setting-catalogue.js";
import { parseEngineEnvDocument } from "../src/config/engine-env-document.js";
import { releaseGraphWriter } from "../src/graph/writer-lease.js";
let root: string, configDir: string, envPath: string, base: string, server: Server;
const envBefore = { ...process.env };
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "dg-config-http-")); configDir = join(root, "config"); envPath = join(configDir, "engine.env"); await mkdir(configDir);
  await writeFile(envPath, "DREAMGRAPH_LLM_API_KEY=hidden-secret\nCUSTOM_SETTING=unchanged\nDG_SCHEDULER_MAX_RUNS_HR=7\n");
  vi.spyOn(lifecycle, "getActiveScope").mockReturnValue({ uuid: "test", configDir, dataDir: join(root, "data"), projectRoot: root, repos: {}, engineEnvPath: envPath } as never);
  server = createServer((req, res) => { handleDashboardRoute(req, res, new URL(req.url ?? "/", "http://localhost").pathname).then(handled => { if (!handled) { res.statusCode = 404; res.end(); } }).catch(() => { res.statusCode = 500; res.end("fixture error"); }); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => { stopScheduler(); await new Promise<void>(resolve => server.close(() => resolve())); vi.restoreAllMocks(); await releaseGraphWriter(configDir); await rm(root, { recursive: true, force: true }); for (const key of Object.keys(process.env)) if (!(key in envBefore)) delete process.env[key]; Object.assign(process.env, envBefore); });
const post = (path: string, body: unknown) => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
describe("configuration HTTP parity", () => {
  it("returns redacted typed catalogue and rejects unsupported fields", async () => {
    const state = await (await fetch(base + "/api/config/v1")).json(); expect(JSON.stringify(state)).not.toContain("hidden-secret");
    const catalogue = await (await fetch(base + "/api/config/v1/catalogue")).json(); expect(catalogue.ok).toBe(true);
    expect(catalogue.result.find((field: any) => field.key === "DG_SCHEDULER_TICK").constraints).toMatchObject({ type: "integer" });
    const before = await readFile(envPath, "utf8"), response = await post("/api/config/v1/apply", { expected_revision: state.result.revision, operation_id: "invalid", updates: { DG_SCHEDULER_TICK: "NaN" } });
    expect(response.status).toBe(400); expect(await readFile(envPath, "utf8")).toBe(before);
  });
  it("keeps the legacy scheduler form route revision checked and reloads exactly", async () => {
    const page = await (await fetch(base + "/config")).text(); expect(page).not.toContain("hidden-secret");
    const revision = page.match(/id="cw-revision" value="([^"]+)"/)?.[1]; expect(revision).toBeTruthy();
    const response = await fetch(base + "/config", { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ _section: "scheduler", _config_revision: revision!, _operation_id: "scheduler-form", enabled: "false", tick_interval_ms: "30000", max_runs_per_hour: "0", global_cooldown_ms: "0", nightmare_cooldown_ms: "300000", max_error_streak: "3" }) });
    expect(response.status).toBe(303); expect(getSchedulerConfig()).toMatchObject({ enabled: false, max_runs_per_hour: 0, global_cooldown_ms: 0 });
    const values = parseEngineEnvDocument(await readFile(envPath, "utf8")); expect(values.DG_SCHEDULER_MAX_RUNS_HR).toBeUndefined(); expect(values.CUSTOM_SETTING).toBe("unchanged"); expect(values.DREAMGRAPH_LLM_API_KEY).toBe("hidden-secret");
    loadEngineEnv(envPath); expect(resolveComponentSettings("scheduler", process.env)).toMatchObject({ enabled: false, max_runs_per_hour: 0, global_cooldown_ms: 0 });
    const conflict = await post("/api/config/v1/apply", { expected_revision: revision, operation_id: "stale-page", updates: { DG_SCHEDULER_TICK: "50000" } }); expect(conflict.status).toBe(409);
  });
  it("does not show success after invalid form input or missing revision", async () => {
    const before = await readFile(envPath, "utf8");
    const response = await fetch(base + "/config", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ _section: "dreamer", model: "gpt-5.5", temperature: "NaN", maxTokens: "4096" }) });
    expect(response.status).toBe(400); expect(response.headers.get("location")).toBeNull(); expect(await response.text()).toContain("CONFIG_REVISION_REQUIRED"); expect(await readFile(envPath, "utf8")).toBe(before);
  });
  it("previews, applies and restores a named template without exposing secrets or resetting unrelated data", async () => {
    const original = await readFile(envPath, "utf8");
    const preview = await (await post("/api/config/v1/template/preview", { template: "ollama" })).json(); expect(preview.ok).toBe(true); expect(await readFile(envPath, "utf8")).toBe(original); expect(JSON.stringify(preview)).not.toContain("hidden-secret");
    const applied = await (await post("/api/config/v1/template/apply", { template: "ollama", expected_revision: preview.result.revision, expected_template_hash: preview.result.template_hash, operation_id: "template" })).json(); expect(applied.ok).toBe(true);
    const undo = await (await post("/api/config/v1/undo", { expected_revision: applied.receipt.revision, operation_id: "undo", undo_operation_id: "template" })).json(); expect(undo.ok).toBe(true); expect(await readFile(envPath, "utf8")).toBe(original);
    expect((await post("/api/config/v1/template/preview", { template: "../other" })).status).toBe(400);
  });
});
