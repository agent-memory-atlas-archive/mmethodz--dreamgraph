/**
 * DreamGraph Web Dashboard.
 *
 * Self-contained HTTP route handlers that render status, config,
 * and live documentation pages as HTML.  Zero external dependencies —
 * all CSS is inlined, all data is pulled from the running server's
 * in-memory state + persisted data stores.
 *
 * Routes:
 *   GET  /           — Dashboard index (links to all pages)
 *   GET  /status     — Cognitive state, dream stats, tensions
 *   GET  /schedules  — Schedule management (view, pause/resume, run now, delete)
 *   POST /schedules  — Retired form port (410); use /api/schedules/v2
 *   GET  /config     — Active configuration with inline edit forms
 *   POST /config     — Apply configuration changes at runtime
 *   GET  /docs       — Native markdown viewer for docs/ folder
 *   GET  /docs/:slug — Render a specific docs/*.md file
 *   GET  /health     — HTML health page (JSON available via Accept header)
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { readFileSync, watchFile, unwatchFile, existsSync } from "node:fs";
import { resolve, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { settingSchema } from "../config/setting-schema.js";
import { config, updateDatabaseConnectionString } from "../config/config.js";
import { engine } from "../cognitive/engine.js";
import { getActiveScope, isInstanceMode, getToolCallCount, getEffectiveDataDir } from "../instance/lifecycle.js";
import { getActiveProfileName, switchProfile } from "../instance/policies.js";
import {
  getSchedulerConfig, updateSchedulerConfig,
} from "../cognitive/scheduler.js";
import {
  getLlmConfig, initLlmProvider,
  getDreamerLlmConfig, getNormalizerLlmConfig, getArchitectLlmConfig,
  updateDreamerLlmConfig, updateNormalizerLlmConfig,
} from "../cognitive/llm.js";
import type { LlmConfig } from "../cognitive/llm.js";
import type { Datastore } from "../types/index.js";
import { updateConfig as updateEventConfig, getConfig as getEventConfig } from "../cognitive/event-router.js";
import { updateNarrativeConfig, getNarrativeConfig } from "../cognitive/narrator.js";
import { testDbConnection, resetDbPool, runDatastoreScan } from "../tools/db-senses.js";
import { loadJsonData, loadJsonArray } from "../utils/cache.js";
import { ENGINE_DEPLOYMENT_OVERRIDES } from "../utils/engine-env.js";
import { randomUUID } from "node:crypto";
import { handleScheduleApi } from "./schedule-api.js";
import {renderScheduleWorkspace,SCHEDULE_WORKSPACE_SCRIPT} from "./schedule-workspace.js";
import { renderConfigurationWorkspace, CONFIGURATION_WORKSPACE_SCRIPT, configurationTab, configurationModelChoices } from "./configuration-workspace.js";
import { parseEngineEnvDocument } from "../config/engine-env-document.js";
import { readEngineTemplateSource } from "../config/engine-template-source.js";
import { resolveMasterDir } from "../instance/registry.js";
import { MODEL_ROLES, readRoleProfiles, resolveRolePolicy } from "../config/role-policy.js";
import { withoutSessionContext } from "./session-context.js";
import { withGraphRead } from "../utils/graph-reconciliation-barrier.js";
import { loadCanonicalGraph } from "../graph/read-model.js";
import { readDirtyPartitions } from "../graph/change-obligations.js";
import { renderRuntimeWorkspace, RUNTIME_WORKSPACE_SCRIPT } from "./runtime-workspace.js";
import { applyEngineConfiguration, inspectEngineConfiguration, previewEngineTemplate, applyEngineTemplate, undoEngineConfiguration } from "../config/engine-configuration.js";
import { engineSettingCatalogue, engineSetting, resolveComponentSettings, componentSettingAlias, computerUsePolicy, validateEngineEnvValues } from "../config/engine-setting-catalogue.js";
import type { EventRouterConfig, SchedulerConfig, NarrativeConfig } from "../cognitive/types.js";
import { logger } from "../utils/logger.js";
import { embedArchitectWorkspace } from "./architect-workspace-shell.js";
import { buildOnboardingReadinessProjection } from "../architect/onboarding-readiness.js";
import { recordOnboardingTelemetryEvent } from "../architect/onboarding-telemetry.js";

/* ------------------------------------------------------------------ */
/*  Dashboard context — set by index.ts at HTTP startup               */
/* ------------------------------------------------------------------ */

interface DashboardContext {
  authority?: Record<string, unknown>;
  getSessionCount: () => number;
  port: number;
}

let _ctx: DashboardContext = { getSessionCount: () => 0, port: 8100 };
const PACKAGE_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..");

function templateMasterDir(): string {
  return getActiveScope()?.masterDir ?? resolveMasterDir();
}

function configurationPath(): string {
  const path = getActiveScope()?.engineEnvPath;
  if (!path) throw new Error("CONFIG_PERSISTENCE_UNAVAILABLE: attach an instance before saving");
  return path;
}
function applyEffectiveEnvironment(updates: Record<string, string | null>): void {
  for (const [key, value] of Object.entries(updates)) {
    if (engineSetting(key)?.apply === "restart" || engineSetting(key)?.apply === "read_only") continue;
    if (ENGINE_DEPLOYMENT_OVERRIDES[key] !== undefined) process.env[key] = ENGINE_DEPLOYMENT_OVERRIDES[key];
    else if (value === null) delete process.env[key]; else process.env[key] = value;
  }
}
function applyComponentSettings(): void {
  updateSchedulerConfig(resolveComponentSettings("scheduler", process.env) as SchedulerConfig);
  updateEventConfig(resolveComponentSettings("events", process.env) as EventRouterConfig);
  updateNarrativeConfig(resolveComponentSettings("narrative", process.env) as NarrativeConfig);
}
async function configurationView() {
  return { ...await inspectEngineConfiguration(configurationPath()), effective_components: {
    DREAMGRAPH_SCHEDULER: getSchedulerConfig(), DREAMGRAPH_EVENTS: getEventConfig(), DREAMGRAPH_NARRATIVE: getNarrativeConfig(),
  } };
}

/** Save and activation are separate outcomes. Existing executions retain their captured policies. */
async function activateConfiguration(updates: Record<string, string | null>) {
  const prior = Object.fromEntries(Object.keys(updates).map(key => [key, process.env[key]]));
  const owners = new Set(Object.keys(updates).map(key => engineSetting(key)?.owner));
  const previousOwners = { model: { ...getLlmConfig() }, scheduler: { ...getSchedulerConfig() }, events: { ...getEventConfig() }, narrative: { ...getNarrativeConfig() }, database: config.database.connectionString };
  try {
    applyEffectiveEnvironment(updates);
    // Resolve all component candidates before mutating their live owners.
    const scheduler = owners.has("scheduler") ? resolveComponentSettings("scheduler", process.env) as SchedulerConfig : null;
    const events = owners.has("events") ? resolveComponentSettings("events", process.env) as EventRouterConfig : null;
    const narrative = owners.has("narrative") ? resolveComponentSettings("narrative", process.env) as NarrativeConfig : null;
    if (Object.keys(updates).some(key => key.startsWith("DREAMGRAPH_LLM_"))) withoutSessionContext(() => initLlmProvider());
    if (scheduler) updateSchedulerConfig(scheduler); if (events) updateEventConfig(events); if (narrative) updateNarrativeConfig(narrative);
    if (Object.hasOwn(updates, "DATABASE_URL")) { updateDatabaseConnectionString(process.env.DATABASE_URL ?? ""); await resetDbPool(); }
    return { status: "activated", message: "Live fields are active; next-execution fields apply to new work. Restart-only fields remain staged." };
  } catch {
    // Do not expose an exception that may contain an operator secret. Preserve the committed receipt.
    for (const [key, value] of Object.entries(prior)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    try { if (Object.keys(updates).some(key => key.startsWith("DREAMGRAPH_LLM_"))) withoutSessionContext(() => initLlmProvider(previousOwners.model));
      if(owners.has("scheduler"))updateSchedulerConfig(previousOwners.scheduler);
      if(owners.has("events"))updateEventConfig(previousOwners.events); if(owners.has("narrative"))updateNarrativeConfig(previousOwners.narrative);
      if(Object.hasOwn(updates,"DATABASE_URL"))updateDatabaseConnectionString(previousOwners.database); }
    catch { /* Report the uncertain activation separately from the durable save. */ }
    return { status: "restart_required", message: "Saved, but runtime activation was not fully confirmed. Restart the instance and read back before new work." };
  }
}

/* ------------------------------------------------------------------ */
/*  engine.env → running daemon                                        */
/* ------------------------------------------------------------------ */
/**
 * Keep the running daemon in step with the instance's engine.env, including edits made
 * outside DreamGraph (a text editor, another tool). Live and next-execution settings are
 * activated through the same path as a dashboard save; restart-only settings are reported.
 * Deployment (launch environment) overrides keep precedence.
 */
let engineEnvBaseline: Record<string, string> | null = null;
let engineEnvWatched: string | null = null;
let engineEnvSync: Promise<EngineEnvSyncResult> | null = null;
export interface EngineEnvSyncResult { changed: string[]; restart_required: string[]; error: string | null; at: string }
let lastEngineEnvSync: EngineEnvSyncResult = { changed: [], restart_required: [], error: null, at: new Date(0).toISOString() };
export function syncEngineEnvFromDisk(reason: string): Promise<EngineEnvSyncResult> {
  engineEnvSync ??= (async () => {
    const path = getActiveScope()?.engineEnvPath, at = new Date().toISOString();
    if (!path) return { changed: [], restart_required: [], error: null, at };
    if (engineEnvWatched !== path) {
      if (engineEnvWatched) unwatchFile(engineEnvWatched);
      engineEnvWatched = path;
      // Polling works on Windows network/WSL paths and survives editors that replace the file.
      watchFile(path, { interval: 2000, persistent: false }, (current, previous) => {
        if (current.mtimeMs !== previous.mtimeMs || current.size !== previous.size) void syncEngineEnvFromDisk("file changed");
      });
    }
    let values: Record<string, string>;
    try { values = existsSync(path) ? parseEngineEnvDocument(readFileSync(path, "utf8")) : {}; validateEngineEnvValues(values); }
    catch (error) {
      const message = error instanceof Error ? error.message : "CONFIG_INVALID_PERSISTED_SETTINGS";
      logger.warn(`engine.env not applied (${reason}): ${message}`);
      return { changed: [], restart_required: [], error: message, at };
    }
    const previous = engineEnvBaseline, updates: Record<string, string | null> = {};
    for (const [key, value] of Object.entries(values)) {
      if (ENGINE_DEPLOYMENT_OVERRIDES[key] !== undefined || !engineSetting(key)) continue;
      const restartOnly = engineSetting(key)!.apply === "restart" || engineSetting(key)!.apply === "read_only";
      if (restartOnly ? previous !== null && previous[key] !== value : process.env[key] !== value) updates[key] = value;
    }
    // A key removed from the file is cleared only when its live value came from the file.
    if (previous) for (const [key, value] of Object.entries(previous))
      if (!(key in values) && ENGINE_DEPLOYMENT_OVERRIDES[key] === undefined && engineSetting(key) && process.env[key] === value) updates[key] = null;
    engineEnvBaseline = values;
    const changed = Object.keys(updates);
    if (!changed.length) return { changed, restart_required: [], error: null, at };
    const restart_required = changed.filter(key => ["restart", "read_only"].includes(engineSetting(key)?.apply ?? ""));
    const live = Object.fromEntries(Object.entries(updates).filter(([key]) => !restart_required.includes(key)));
    if (Object.keys(live).length) {
      const activation = await activateConfiguration(live);
      if (activation.status !== "activated") return { changed, restart_required: changed, error: activation.message, at };
    }
    logger.info(`engine.env re-read (${reason}): applied ${Object.keys(live).length} setting(s)` + (restart_required.length ? `; restart needed for ${restart_required.join(", ")}` : ""));
    return { changed, restart_required, error: null, at };
  })().then(result => { lastEngineEnvSync = result; return result; }).finally(() => { engineEnvSync = null; });
  return engineEnvSync;
}

/**
 * Provide runtime context that only index.ts knows (sessions, port).
 * Call once from startHTTP().
 */
export function setDashboardContext(ctx: DashboardContext): void {
  _ctx = ctx;
  // Establish the baseline and start watching the instance's engine.env.
  setTimeout(() => { void syncEngineEnvFromDisk("startup"); }, 0).unref?.();
}

/* ------------------------------------------------------------------ */
/*  Shared HTML chrome                                                */
/* ------------------------------------------------------------------ */

const BRAND = "DreamGraph";
const VERSION = config.server.version;
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#0d1117"/>
  <circle cx="32" cy="32" r="18" fill="none" stroke="#58a6ff" stroke-width="5"/>
  <circle cx="32" cy="32" r="6" fill="#3fb950"/>
  <path d="M32 14v12M32 38v12M14 32h12M38 32h12" stroke="#bc8cff" stroke-width="4" stroke-linecap="round"/>
</svg>`;

async function shell(title: string, body: string, activeTab: string): Promise<string> {
  const scope = getActiveScope();
  const instanceId = isInstanceMode() ? scope?.uuid ?? "legacy" : "legacy";
  const storageKey = `dreamgraph:last-tab:${instanceId}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)} — ${BRAND} v${VERSION}</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <style>${CSS}</style>
</head>
<body data-dg-active-tab="${escAttr(activeTab)}" data-dg-instance="${escAttr(instanceId)}">
  <script>
    (function() {
      try {
        var activeTab = document.body.dataset.dgActiveTab || '';
        if (window.parent !== window) return;
        var storageKey = ${JSON.stringify(storageKey)};
        if (activeTab) {
          localStorage.setItem(storageKey, activeTab);
        }
      } catch (_) {
        // Ignore storage access failures and continue rendering normally.
      }
    })();
  </script>
  <nav class="topbar">
    <a class="brand" href="/">${BRAND} <span class="version">v${VERSION}</span></a>
    <div class="nav-links">
      <a href="/status"    class="${activeTab === "status"    ? "active" : ""}">Status</a>
      <a href="/schedules" class="${activeTab === "schedules" ? "active" : ""}">Schedules</a>
      <a href="/config"    class="${activeTab === "config"    ? "active" : ""}">Config</a>
      <a href="/architect">Architect</a>
      <a href="/explorer/">Explorer</a>
      <a href="/docs"      class="${activeTab === "docs"      ? "active" : ""}">Docs</a>
      <a href="/health"    class="${activeTab === "health"    ? "active" : ""}">Health</a>
    </div>
  </nav>
  <main>${body}</main>
  <footer>
    <span>${BRAND} v${VERSION}</span>
    <span>Instance: ${instanceId}</span>
    <span>Generated: ${new Date().toISOString()}</span>
  </footer>
  <script>
    (function() {
      try {
        var activeTab = document.body.dataset.dgActiveTab || '';
        if (activeTab !== 'docs') return;
        var storageKey = ${JSON.stringify(storageKey)} + ':docs-page';
        var path = window.location.pathname || '';
        var isDocsPath = path === '/docs' || path.indexOf('/docs/') === 0;
        if (isDocsPath) {
          localStorage.setItem(storageKey, path + (window.location.search || ''));
        }
      } catch (_) {
        // Ignore storage access failures and continue rendering normally.
      }
    })();
  </script>
</body>
</html>`;
}

function html(res: ServerResponse, statusCode: number, body: string): void {
  res.writeHead(statusCode, { "Content-Type": "text/html; charset=utf-8" });
  res.end(body);
}

function json(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(payload));
}

/* ------------------------------------------------------------------ */
/*  CSS                                                               */
/* ------------------------------------------------------------------ */

const CSS = `
  :root {
    --bg: #111111; --surface: #1b1b1b; --border: #383838;
    --text: #dedede; --text-dim: #999999; --accent: #8ab4e8;
    --green: #80c59b; --yellow: #d8bb77; --red: #eb9292; --purple: #bb9ede;
    --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    --mono: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
  }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: var(--font); font-size: 13px; line-height: 1.45; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }

  .topbar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 14px; gap: 10px; flex-wrap: wrap; background: var(--surface); border-bottom: 1px solid var(--border);
    position: sticky; top: 0; z-index: 10;
  }
  .brand { font-size: 14px; font-weight: 700; color: var(--text); }
  .brand:hover { text-decoration: none; }
  .brand .version { font-weight: 400; color: var(--text-dim); font-size: 13px; }
  .nav-links { display: flex; gap: 4px; flex-wrap: wrap; }
  .nav-links a { color: var(--text-dim); font-weight: 500; padding: 4px 8px; border-radius: 6px; transition: all .15s; }
  .nav-links a:hover { color: var(--text); background: var(--border); text-decoration: none; }
  .nav-links a.active { color: var(--accent); background: rgba(88,166,255,.1); }

  main { max-width: 1440px; margin: 14px auto; padding: 0 14px; }
  footer {
    display: flex; justify-content: center; flex-wrap: wrap; gap: 12px; padding: 10px;
    color: var(--text-dim); font-size: 11px; border-top: 1px solid var(--border); margin-top: 18px;
  }

  h1 { font-size: 22px; margin-bottom: 10px; }
  h2 { font-size: 16px; margin: 18px 0 8px; color: var(--accent); border-bottom: 1px solid var(--border); padding-bottom: 4px; }
  h3 { font-size: 14px; margin: 12px 0 6px; color: var(--text-dim); }

  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; margin: 10px 0; }

  .card {
    background: var(--surface); border: 1px solid var(--border); border-radius: 4px; padding: 12px;
  }
  .card-title { font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: var(--text-dim); margin-bottom: 8px; }
  .card-value { font-size: 23px; font-weight: 600; font-family: var(--mono); }
  .card-sub { font-size: 12px; color: var(--text-dim); margin-top: 4px; }

  .badge {
    display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600;
    text-transform: uppercase; letter-spacing: .04em;
  }
  .badge-green  { background: rgba(63,185,80,.15); color: var(--green); }
  .badge-yellow { background: rgba(210,153,34,.15); color: var(--yellow); }
  .badge-red    { background: rgba(248,81,73,.15); color: var(--red); }
  .badge-purple { background: rgba(188,140,255,.15); color: var(--purple); }
  .badge-blue   { background: rgba(88,166,255,.15); color: var(--accent); }

  table { width: 100%; border-collapse: collapse; margin: 8px 0; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--text-dim); padding: 6px 10px; border-bottom: 1px solid var(--border); }
  td { padding: 8px 10px; border-bottom: 1px solid var(--border); font-size: 13px; }
  tr:last-child td { border-bottom: none; }
  .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  code, .mono { font-family: var(--mono); font-size: 12px; }
  .kv { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid var(--border); }
  .kv:last-child { border-bottom: none; }
  .kv-key { color: var(--text-dim); }
  .kv-val { font-family: var(--mono); }
  pre { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 12px; overflow-x: auto; font-size: 12px; margin: 8px 0; }
  .empty { color: var(--text-dim); font-style: italic; padding: 16px 0; }

  .state-awake       { color: var(--green); }
  .state-rem         { color: var(--purple); }
  .state-normalizing { color: var(--yellow); }
  .state-nightmare   { color: var(--red); }

  .index-hero { text-align: left; padding: 8px 0 16px; }
  .index-hero h1 { font-size: 26px; }
  .index-hero p { color: var(--text-dim); font-size: 13px; margin-top: 4px; }
  .index-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 10px; margin-top: 14px; }
  .index-card { background: var(--surface); border: 1px solid var(--border); border-radius: 4px; padding: 14px; transition: border-color .15s; }
  .index-card:hover { border-color: var(--accent); text-decoration: none; }
  .index-card h3 { color: var(--text); margin: 0 0 8px; font-size: 18px; }
  .index-card p { color: var(--text-dim); font-size: 13px; margin: 0; }
  .start-here { border: 1px solid var(--border); background: var(--surface); border-radius: 4px; padding: 14px; }
  .start-here-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
  .start-here-header h2 { border: 0; color: var(--text); font-size: 22px; margin: 0 0 6px; padding: 0; }
  .start-here-header p, .readiness-detail, .readiness-repos { color: var(--text-dim); font-size: 13px; }
  .start-here-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
  .start-here-actions .btn:hover, .readiness-action:hover { text-decoration: none; }
  .readiness-summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-top: 20px; }
  .readiness-summary-item { background: rgba(13,17,23,.45); border: 1px solid var(--border); border-radius: 6px; padding: 10px; }
  .readiness-summary-item strong { display: block; font-size: 12px; margin-bottom: 5px; }
  .readiness-checks { display: grid; grid-template-columns: repeat(auto-fit, minmax(310px, 1fr)); gap: 12px; margin-top: 12px; }
  .readiness-check { border: 1px solid var(--border); border-radius: 6px; padding: 12px; }
  .readiness-check-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .readiness-action { display: inline-block; margin-top: 8px; font-size: 12px; font-weight: 600; }

  /* Form styles for editable config */
  .config-form { margin-top: 12px; }
  .config-form .form-row { display: flex; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--border); gap: 12px; }
  .config-form .form-row:last-of-type { border-bottom: none; }
  .config-form label { color: var(--text-dim); min-width: 180px; font-size: 13px; }
  .config-form input, .config-form select {
    background: var(--bg); border: 1px solid var(--border); color: var(--text);
    font-family: var(--mono); font-size: 12px; padding: 4px 8px; border-radius: 4px;
    flex: 1; max-width: 320px;
  }
  .config-form input:focus, .config-form select:focus { border-color: var(--accent); outline: none; }
  .config-form .form-actions { padding-top: 12px; display: flex; gap: 8px; }
  .config-form .unit { color: var(--text-dim); font-size: 11px; min-width: 30px; }
  .api-key-wrap { display: flex; align-items: center; flex: 1; max-width: 320px; gap: 6px; }
  .api-key-wrap input { flex: 1; max-width: none; }
  .api-key-toggle { background: var(--bg); border: 1px solid var(--border); color: var(--text-dim);
    border-radius: 4px; padding: 4px 8px; font-size: 11px; cursor: pointer; white-space: nowrap; }
  .api-key-toggle:hover { border-color: var(--accent); color: var(--text); }
  .api-key-mask { font-family: var(--mono); font-size: 11px; color: var(--text-dim); margin-left: 4px; }
  .btn {
    padding: 6px 16px; border: 1px solid var(--border); border-radius: 6px;
    font-size: 12px; font-weight: 600; cursor: pointer; transition: all .15s;
  }
  .btn-primary { background: #365874; border-color: #7798b8; color: #f2f5f8; }
  .btn-primary:hover { background: #456b8b; }
  .toast {
    background: rgba(63,185,80,.15); color: var(--green); border: 1px solid var(--green);
    border-radius: 6px; padding: 8px 16px; margin-bottom: 16px; font-size: 13px;
  }
  .toast-error {
    background: rgba(248,81,73,.15); color: var(--red); border: 1px solid var(--red);
    border-radius: 6px; padding: 8px 16px; margin-bottom: 16px; font-size: 13px;
  }

  /* Subsection grouping (e.g. LLM > Provider / Dreamer / Normalizer) */
  .section-group { border: 1px solid var(--border); border-radius: 8px; margin: 12px 0 24px; overflow: hidden; }
  .section-group > .sub-section { border-bottom: 1px solid var(--border); padding: 16px; }
  .section-group > .sub-section:last-child { border-bottom: none; }
  .sub-section h3 { margin: 0 0 8px; font-size: 14px; color: var(--text); }
  .sub-section p.sub-desc { color: var(--text-dim); font-size: 12px; margin: 0 0 10px; }

  /* DB test result */
  .db-test-result { margin-top: 8px; padding: 8px 12px; border-radius: 6px; font-size: 13px; font-family: var(--mono); display: none; }
  .db-test-result.ok { display: block; background: rgba(63,185,80,.15); color: var(--green); border: 1px solid var(--green); }
  .db-test-result.fail { display: block; background: rgba(248,81,73,.15); color: var(--red); border: 1px solid var(--red); }
  .btn-secondary { background: var(--surface); border-color: var(--border); color: var(--text); }
  .btn-secondary:hover { background: var(--border); }
  .btn:disabled { opacity: .5; cursor: wait; }

  @media (max-width: 600px) {
    .grid { grid-template-columns: 1fr; }
    .start-here-header { flex-direction: column; }
    .readiness-checks { grid-template-columns: 1fr; }
    main { padding: 0 12px; }
    .config-form .form-row { flex-direction: column; align-items: flex-start; }
    .config-form label { min-width: auto; }
    .config-form input, .config-form select { max-width: 100%; }
  }
`;

/* ------------------------------------------------------------------ */
/*  Route: GET /                                                      */
/* ------------------------------------------------------------------ */

async function renderIndex(): Promise<string> {
  const scope = getActiveScope();
  const projectName = scope?.projectRoot?.split(/[\\/]/).pop() ?? "—";
  const readiness = buildOnboardingReadinessProjection();

  const readinessBadge = (status: string): string => {
    const badgeClass = status === "ready" || status === "attached"
      ? "badge-green"
      : status === "useful_later"
        ? "badge-blue"
        : "badge-yellow";
    return `<span class="badge ${badgeClass}">${esc(status.replace(/_/g, " "))}</span>`;
  };
  const actionHref = (action: typeof readiness.suggested_next_action): string =>
    action.kind === "open_route" ? action.target : "/architect";
  const renderCheck = (check: typeof readiness.required_to_start[number]): string => `
      <div class="readiness-check">
        <div class="readiness-check-head"><strong>${esc(check.label)}</strong>${readinessBadge(check.status)}</div>
        <div class="readiness-detail">${esc(check.detail)}</div>
        ${check.action ? `<a class="readiness-action" href="${escAttr(actionHref(check.action))}">${esc(check.action.label)} →</a>` : ""}
      </div>`;
  const repositoryNames = readiness.repositories.names.length > 0
    ? readiness.repositories.names.map((name) => esc(name)).join(", ")
    : "No repositories connected yet";

  let body = `
    <div class="index-hero">
      <h1>🧠 ${BRAND}</h1>
      <p>Autonomous Cognitive Layer for Software Systems</p>
      <p style="margin-top: 4px">${isInstanceMode()
        ? `Instance <code style="user-select:all">${scope!.uuid}</code> · Project: <strong>${esc(projectName)}</strong>`
        : "Running in legacy mode (no instance isolation)"
      }</p>
    </div>
    <section class="start-here" aria-labelledby="start-here-title">
      <div class="start-here-header">
        <div>
          <h2 id="start-here-title">Start Here</h2>
          <p>Check the basics, fix the first item that needs attention, then open Architect.</p>
        </div>
        ${readinessBadge(readiness.suggested_next_action.id === "open_architect" ? "ready" : "needs_attention")}
      </div>
      <div class="readiness-summary">
        <div class="readiness-summary-item"><strong>DreamGraph service</strong>${readinessBadge(readiness.service.status)}</div>
        <div class="readiness-summary-item"><strong>Project</strong>${readinessBadge(readiness.project.status)}</div>
        <div class="readiness-summary-item"><strong>Project map</strong>${readinessBadge(readiness.project_map.status)}</div>
        <div class="readiness-summary-item"><strong>AI connection</strong>${readinessBadge(readiness.architect_runtime.status)}</div>
        <div class="readiness-summary-item"><strong>Repositories</strong><span class="mono">${readiness.repositories.count}</span> connected</div>
      </div>
      <p class="readiness-repos" style="margin-top:10px">Connected repositories: ${repositoryNames}</p>
      <p style="margin-top:12px"><strong>Recommended next action:</strong> ${esc(readiness.suggested_next_action.label)}</p>
      <div class="start-here-actions">
        <a class="btn btn-primary" href="/architect">Open Architect</a>
        <a class="btn btn-secondary" href="/explorer/">Open Explorer</a>
        <a class="btn btn-secondary" href="#setup-details">View setup details</a>
        <a class="btn btn-secondary" href="/architect-guide">Architect beginner guide</a>
        ${readiness.suggested_next_action.id === "open_architect" ? "" : `<a class="btn btn-secondary" href="${escAttr(actionHref(readiness.suggested_next_action))}">${esc(readiness.suggested_next_action.label)}</a>`}
      </div>
      <details id="setup-details"><summary>Setup details</summary>
        <h3>Required to start</h3>
        <div class="readiness-checks">${readiness.required_to_start.map(renderCheck).join("")}</div>
        <h3>Useful later</h3>
        <div class="readiness-checks">${readiness.useful_later.map(renderCheck).join("")}</div>
      </details>
    </section>
    <div class="index-cards">
      <a class="index-card" href="/explorer/"><h3>Explorer</h3><p>Navigate the 2D or 3D graph, inspect evidence and provenance, and review candidates and tensions.</p></a>
      <a class="index-card" href="/architect"><h3>Architect</h3><p>Graph-grounded execution, plans, slices, decisions and reviewed changes.</p></a>
      <a class="index-card" href="/status">
        <h3>📊 Status</h3>
        <p>Cognitive state, dream cycles, graph stats, tensions, active schedules, LLM provider health.</p>
      </a>
      <a class="index-card" href="/schedules">
        <h3>📅 Schedules</h3>
        <p>Dream schedules — view, pause/resume, run now, create, delete. Real-time execution history.</p>
      </a>
      <a class="index-card" href="/config">
        <h3>⚙️ Config</h3>
        <p>Searchable settings, effective model roles, bounded budgets, protected templates and saved/runtime readback.</p>
      </a>
      <a class="index-card" href="/docs">
        <h3>📖 Docs</h3>
        <p>Project documentation — architecture, cognitive engine, tools reference, data model, workflows.</p>
      </a>
      <a class="index-card" href="/architect-guide">
        <h3>Architect Beginner Guide</h3>
        <p>Task-first setup, screen tour, recipes, slash commands, and authority limits.</p>
      </a>
      <a class="index-card" href="/health">
        <h3>💚 Health</h3>
        <p>Liveness and readiness status for monitoring and load balancers.</p>
      </a>
    </div>${renderRuntimeWorkspace()}`;

  return await shell("Dashboard", body, "");
}

/* ------------------------------------------------------------------ */
/*  Route: GET /status                                                */
/* ------------------------------------------------------------------ */

async function renderStatus(): Promise<string> {
  const status = await engine.getStatus();
  const scope = getActiveScope();

  const stateClass = `state-${status.current_state}`;

  // ---- Hero cards ----
  let body = `<h1>Server Status</h1>${renderRuntimeWorkspace()}
  <div class="grid">
    <div class="card">
      <div class="card-title">Cognitive State</div>
      <div class="card-value ${stateClass}">${status.current_state.toUpperCase()}</div>
      <div class="card-sub">Since ${fmtTime(status.last_state_change)}</div>
    </div>
    <div class="card">
      <div class="card-title">Dream Cycles</div>
      <div class="card-value">${status.total_dream_cycles}</div>
      <div class="card-sub">Last: ${fmtTime(status.last_dream_cycle)}</div>
    </div>
    <div class="card">
      <div class="card-title">Normalization Cycles</div>
      <div class="card-value">${status.total_normalization_cycles}</div>
      <div class="card-sub">Last: ${fmtTime(status.last_normalization)}</div>
    </div>
    <div class="card">
      <div class="card-title">Tool Calls</div>
      <div class="card-value">${getToolCallCount()}</div>
      <div class="card-sub" style="user-select:all;font-size:11px">${isInstanceMode() ? scope!.uuid : "Legacy mode"}</div>
    </div>
  </div>`;

  // ---- Dream Graph Stats ----
  const gs = status.dream_graph_stats;
  body += `<h2>Dream Graph</h2>
  <div class="grid">
    <div class="card">
      <div class="card-title">Nodes / Edges</div>
      <div class="card-value">${gs.total_nodes} / ${gs.total_edges}</div>
      <div class="card-sub">Latent: ${gs.latent_nodes} nodes, ${gs.latent_edges} edges</div>
    </div>
    <div class="card">
      <div class="card-title">Avg Confidence</div>
      <div class="card-value">${gs.avg_confidence}</div>
      <div class="card-sub">Reinforcement: ${gs.avg_reinforcement} · Activation: ${gs.avg_activation}</div>
    </div>
    <div class="card">
      <div class="card-title">Expiring Next Cycle</div>
      <div class="card-value">${gs.expiring_next_cycle}</div>
      <div class="card-sub">Edges + nodes with TTL ≤ 1</div>
    </div>
  </div>`;

  // ---- Validation Stats ----
  const vs = status.validated_stats;
  const ts = status.tension_stats;

  // Pie chart data: validated, tensions, rejected
  const pieValidated = vs.validated ?? 0;
  const pieTensions  = ts.unresolved ?? 0;
  const pieRejected  = vs.rejected ?? 0;
  const pieTotal     = pieValidated + pieTensions + pieRejected;

  // Build conic-gradient stops (percentages)
  let pieChart = "";
  if (pieTotal > 0) {
    const pctV = (pieValidated / pieTotal) * 100;
    const pctT = (pieTensions  / pieTotal) * 100;
    // pctR is the remainder
    const stopV = pctV;
    const stopT = stopV + pctT;
    pieChart = `
    <div style="display:flex;align-items:center;gap:32px;margin:16px 0 8px">
      <div style="
        width:140px;height:140px;border-radius:50%;flex-shrink:0;
        background:conic-gradient(
          var(--green) 0% ${stopV.toFixed(1)}%,
          var(--yellow) ${stopV.toFixed(1)}% ${stopT.toFixed(1)}%,
          var(--red) ${stopT.toFixed(1)}% 100%
        );
        -webkit-mask:radial-gradient(circle,transparent 45%,#000 46%);
        mask:radial-gradient(circle,transparent 45%,#000 46%);
      "></div>
      <div style="display:flex;flex-direction:column;gap:8px">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="width:12px;height:12px;border-radius:2px;background:var(--green);display:inline-block"></span>
          <span>Validated <strong>${pieValidated}</strong> <span style="color:var(--text-dim)">(${pctV.toFixed(0)}%)</span></span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="width:12px;height:12px;border-radius:2px;background:var(--yellow);display:inline-block"></span>
          <span>Tensions <strong>${pieTensions}</strong> <span style="color:var(--text-dim)">(${pctT.toFixed(0)}%)</span></span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="width:12px;height:12px;border-radius:2px;background:var(--red);display:inline-block"></span>
          <span>Rejected <strong>${pieRejected}</strong> <span style="color:var(--text-dim)">(${(100 - pctV - pctT).toFixed(0)}%)</span></span>
        </div>
      </div>
    </div>`;
  }

  body += `<h2>Validation Pipeline</h2>`;
  body += pieChart;
  body += `
  <div class="grid">
    <div class="card"><div class="card-title">Validated</div><div class="card-value" style="color:var(--green)">${vs.validated}</div></div>
    <div class="card"><div class="card-title">Latent</div><div class="card-value" style="color:var(--yellow)">${vs.latent}</div></div>
    <div class="card"><div class="card-title">Rejected</div><div class="card-value" style="color:var(--red)">${vs.rejected}</div></div>
  </div>`;

  // ---- Tensions ----
  body += `<h2>Tensions</h2>`;
  if (ts.total === 0) {
    body += `<p class="empty">No tensions recorded yet.</p>`;
  } else {
    body += `<div class="grid">
      <div class="card"><div class="card-title">Total</div><div class="card-value">${ts.total}</div></div>
      <div class="card"><div class="card-title">Unresolved</div><div class="card-value" style="color:var(--yellow)">${ts.unresolved}</div></div>
    </div>`;
    if (ts.top_urgency) {
      const t = ts.top_urgency;
      body += `<h3>Top Urgency Tension</h3>
      <div class="card">
        <div class="kv"><span class="kv-key">Type</span><span class="kv-val">${esc(t.type)}</span></div>
        <div class="kv"><span class="kv-key">Domain</span><span class="kv-val">${esc(t.domain)}</span></div>
        <div class="kv"><span class="kv-key">Urgency</span><span class="kv-val">${t.urgency}</span></div>
        <div class="kv"><span class="kv-key">Occurrences</span><span class="kv-val">${t.occurrences}</span></div>
        <div class="kv"><span class="kv-key">Description</span><span class="kv-val">${esc(t.description)}</span></div>
        <div class="kv"><span class="kv-key">Entities</span><span class="kv-val">${t.entities.map(esc).join(", ")}</span></div>
      </div>`;
    }
  }

  // ---- LLM ----
  const llm = status.llm;
  body += `<h2>LLM Provider</h2>
  <div class="card">
    <div class="kv"><span class="kv-key">Provider</span><span class="kv-val">${esc(llm?.provider ?? "none")}</span></div>
    <div class="kv"><span class="kv-key">Dreamer Model</span><span class="kv-val">${esc(getDreamerLlmConfig().model || "—")}</span></div>
    <div class="kv"><span class="kv-key">Normalizer Model</span><span class="kv-val">${esc(getNormalizerLlmConfig().model || "—")}</span></div>
    <div class="kv"><span class="kv-key">Available</span><span class="kv-val">${llm?.available
      ? '<span class="badge badge-green">online</span>'
      : '<span class="badge badge-red">offline</span>'
    }</span></div>
  </div>`;

  // ---- Promotion / Decay ----
  body += `<h2>Promotion &amp; Decay</h2>
  <div class="grid">
    <div class="card">
      <div class="card-title">Promotion Config</div>
      ${Object.entries(status.promotion_config).map(([k, v]) =>
        `<div class="kv"><span class="kv-key">${esc(k)}</span><span class="kv-val">${v}</span></div>`
      ).join("")}
    </div>
    <div class="card">
      <div class="card-title">Decay Config</div>
      ${Object.entries(status.decay_config).map(([k, v]) =>
        `<div class="kv"><span class="kv-key">${esc(k)}</span><span class="kv-val">${v}</span></div>`
      ).join("")}
    </div>
  </div>`;

  // ---- Schedules (link to dedicated page) ----
  body += `<h2>Schedules</h2>
  <p><a href="/schedules">View and manage schedules →</a></p>`;

  return await shell("Status", body, "status");
}

/* ------------------------------------------------------------------ */
/*  Route: GET /health                                                */
/* ------------------------------------------------------------------ */

async function renderHealth(): Promise<string> {
  const status = await engine.getStatus();
  const llmCfg = getLlmConfig();
  const sessions = _ctx.getSessionCount();

  const checks = [
    { name: "Cognitive Engine", ok: true, detail: status.current_state.toUpperCase() },
    { name: "HTTP Sessions", ok: true, detail: `${sessions} active` },
    { name: "LLM Provider", ok: status.llm?.available ?? false, detail: `${llmCfg.provider} — dreamer: ${getDreamerLlmConfig().model || "—"}, normalizer: ${getNormalizerLlmConfig().model || "—"}` },
    { name: "Instance", ok: isInstanceMode(), detail: isInstanceMode() ? getActiveScope()!.uuid : "legacy" },
  ];

  const allOk = checks.every(c => c.ok);

  let body = `<h1>Health Check</h1>
  <div class="card" style="margin-bottom:24px">
    <div class="card-value" style="color:var(--${allOk ? "green" : "yellow"})">
      ${allOk ? "✓ HEALTHY" : "⚠ DEGRADED"}
    </div>
    <div class="card-sub">Transport: streamable-http · Sessions: ${sessions}</div>
  </div>
  <table>
    <tr><th>Check</th><th>Status</th><th>Detail</th></tr>
    ${checks.map(c => `<tr>
      <td>${esc(c.name)}</td>
      <td>${c.ok
        ? '<span class="badge badge-green">pass</span>'
        : '<span class="badge badge-yellow">warn</span>'
      }</td>
      <td class="mono">${esc(c.detail)}</td>
    </tr>`).join("")}
  </table>
  <h2>JSON Endpoint</h2>
  <p style="color:var(--text-dim);margin-bottom:8px">
    For programmatic health checks, request with <code>Accept: application/json</code>:
  </p>
  <pre><code>curl -H "Accept: application/json" http://localhost:${_ctx.port}/health</code></pre>`;

  return await shell("Health", body, "health");
}

/* ------------------------------------------------------------------ */
/*  Route: GET /schedules                                             */
/* ------------------------------------------------------------------ */

async function renderSchedules(_toast?:string):Promise<string>{return shell("Schedules",renderScheduleWorkspace(),"schedules");}

/* ------------------------------------------------------------------ */
/*  Route: POST /schedules                                            */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  Route: GET /config                                                */
/* ------------------------------------------------------------------ */

async function renderConfig(_savedSection?: string): Promise<string> {
  const snapshot = await inspectEngineConfiguration(configurationPath());
  const instance = getActiveScope()?.uuid;
  return shell("Configuration", renderConfigurationWorkspace(snapshot.revision, instance ? `dg restart ${instance}` : "Restart the supervising DreamGraph process"), "config");
}

const ConfigurationRequest = z.object({ expected_revision: z.string().min(1), operation_id: z.string().min(1).max(256) });
async function readConfigurationRequest(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []; let bytes = 0;
  for await (const chunk of req) { const buffer = Buffer.from(chunk); bytes += buffer.length; if (bytes > 1024 * 1024) throw new Error("CONFIG_BODY_TOO_LARGE"); chunks.push(buffer); }
  let text: string; try { text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)); } catch { throw new Error("CONFIG_INVALID_ENCODING"); }
  try { return JSON.parse(text); } catch { throw new Error("CONFIG_INVALID_JSON"); }
}
async function handleConfigurationApi(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  try {
    if (req.method === "GET" && path === "/api/config/v1") {
      // Opening configuration (dashboard, Architect tab, VS Code) always re-reads engine.env first.
      const sync = await syncEngineEnvFromDisk("configuration opened");
      json(res, 200, { ok: true, result: { ...await configurationView(), engine_env_sync: sync.changed.length || sync.error ? sync : lastEngineEnvSync } }); return;
    }
    if (req.method === "GET" && path === "/api/config/v1/catalogue") {
      const defaults = parseEngineEnvDocument(await readEngineTemplateSource("default", PACKAGE_ROOT, templateMasterDir()));
      json(res, 200, { ok: true, result: engineSettingCatalogue().map(({ schema, decode, ...field }) => ({ ...field, category: configurationTab(field),
        template_default: field.secret ? null : defaults[field.key] ?? null, alias_for: componentSettingAlias(field.key),
        ...(field.key.endsWith("_MODEL") ? {model_choices:configurationModelChoices()} : {}), constraints: settingSchema(schema) })) }); return;
    }
    if (path === "/api/config/v1/billing-reviews" && req.method === "GET") {
      const { ModelAdmission } = await import("../cognitive/model-admission.js"), { directoryInstanceId } = await import("../instance/identity.js"), { getDataDir } = await import("../utils/paths.js");
      const directory = getDataDir(), admission = new ModelAdmission(process.env.DREAMGRAPH_INSTANCE_UUID || directoryInstanceId(directory), directory);
      json(res, 200, { ok: true, result: await admission.billingReviews() }); return;
    }
    if (path === "/api/config/v1/billing-reviews/resume" && req.method === "POST") {
      const input = z.object({ billing_key: z.string().min(1).max(256) }).strict().parse(await readConfigurationRequest(req));
      const { ModelAdmission } = await import("../cognitive/model-admission.js"), { directoryInstanceId } = await import("../instance/identity.js"), { getDataDir } = await import("../utils/paths.js");
      const directory = getDataDir(), admission = new ModelAdmission(process.env.DREAMGRAPH_INSTANCE_UUID || directoryInstanceId(directory), directory);
      json(res, 200, { ok: true, resumed: await admission.resumeBillingKey(input.billing_key), result: await admission.billingReviews() }); return;
    }
    if (req.method === "GET" && path === "/api/config/v1/roles") {
      const result = await withoutSessionContext(() => withGraphRead(async () => {
        const env = { ...process.env }, legacy = { ...getLlmConfig() }, profiles = await readRoleProfiles();
        return MODEL_ROLES.map(role => { const policy = resolveRolePolicy({ role, env, legacy, saved: profiles.roles[role], revision: profiles.revision });
          return { role, revision: profiles.revision, requested: policy.requested, effective: policy.effective, status: policy.status,
            diagnostics: policy.diagnostics, fingerprint: policy.fingerprint, origins: policy.origins, budget: policy.policy.budget, billing: policy.billing }; });
      }));
      json(res, 200, { ok: true, result }); return;
    }
    if (req.method !== "POST") { json(res, 404, { ok: false, error: "CONFIG_ROUTE_NOT_FOUND" }); return; }
    const raw = await readConfigurationRequest(req);
    if (path === "/api/config/v1/apply") {
      const input = ConfigurationRequest.extend({ updates: z.record(z.string().max(16384).nullable()) }).strict().parse(raw);
      const receipt = await applyEngineConfiguration(configurationPath(), input);
      const activation = receipt.status === "committed" && !receipt.replayed ? await activateConfiguration(input.updates)
        : { status: "readback_required", message: "Original receipt recovered; no runtime activation was repeated. Inspect saved and effective values." };
      json(res, 200, { ok: receipt.status === "committed", receipt, activation, result: await configurationView() }); return;
    }
    if (path === "/api/config/v1/template/preview" || path === "/api/config/v1/template/apply") {
      const previewing = path.endsWith("preview");
      const base = z.object({ template: z.enum(["default", "ollama", "lmstudio"]), keys: z.array(z.string()).max(1024).optional() });
      const input = (previewing ? base.strict() : base.merge(ConfigurationRequest).extend({ expected_template_hash: z.string().min(1) }).strict()).parse(raw);
      const template = await readEngineTemplateSource(input.template, PACKAGE_ROOT, templateMasterDir());
      if (previewing) { json(res, 200, { ok: true, result: await previewEngineTemplate(configurationPath(), template, input.keys) }); return; }
      const apply = base.merge(ConfigurationRequest).extend({ expected_template_hash: z.string().min(1) }).strict().parse(raw);
      const receipt = await applyEngineTemplate(configurationPath(), { ...apply, template });
      // Templates stage future/restart policy. Explicit apply endpoint can hot-apply ordinary fields separately.
      json(res, 200, { ok: receipt.status === "committed", receipt, effective_state: "saved; reload or restart to activate staged template fields", result: await configurationView() }); return;
    }
    if (path === "/api/config/v1/undo") {
      const input = ConfigurationRequest.extend({ undo_operation_id: z.string().min(1).max(256) }).strict().parse(raw);
      const receipt = await undoEngineConfiguration(configurationPath(), input);
      json(res, 200, { ok: receipt.status === "committed", receipt, effective_state: "saved; reload or restart to activate restored fields", result: await configurationView() }); return;
    }
    json(res, 404, { ok: false, error: "CONFIG_ROUTE_NOT_FOUND" });
  } catch (error) {
    const message = error instanceof z.ZodError ? "CONFIG_INVALID_REQUEST" : error instanceof Error ? error.message : "CONFIG_REQUEST_FAILED";
    json(res, message.includes("CONFLICT") ? 409 : 400, { ok: false, error: message,
      fields: error instanceof z.ZodError ? error.issues.map(issue => ({ field: issue.path.join("."), message: issue.message })) : [] });
  }
}

async function handleConfigPost(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = await parseFormBody(req), section = body._section;
    if (section === "policy") {
      if (!["strict", "balanced", "creative"].includes(body.profile)) throw new Error("CONFIG_INVALID_PROFILE");
      await switchProfile(body.profile as "strict" | "balanced" | "creative");
    } else {
      if (!body._config_revision || !body._operation_id) throw new Error("CONFIG_REVISION_REQUIRED: refresh configuration before saving");
      const updates: Record<string, string | null> = {};
      if (section === "llm") {
        updates.DREAMGRAPH_LLM_PROVIDER = body.provider ?? "none"; updates.DREAMGRAPH_LLM_URL = body.baseUrl ?? getLlmConfig().baseUrl;
        if (body.apiKey && body.apiKey !== "••••••••") updates.DREAMGRAPH_LLM_API_KEY = body.apiKey;
      } else if (section === "dreamer" || section === "normalizer") {
        const role = section.toUpperCase();
        updates[`DREAMGRAPH_LLM_${role}_MODEL`] = body.model ?? "";
        updates[`DREAMGRAPH_LLM_${role}_TEMPERATURE`] = body.temperature ?? "";
        updates[`DREAMGRAPH_LLM_${role}_MAX_TOKENS`] = body.maxTokens ?? "";
      } else if (["scheduler", "events", "narrative"].includes(section)) {
        const names = section === "scheduler" ? ["enabled", "tick_interval_ms", "max_runs_per_hour", "global_cooldown_ms", "nightmare_cooldown_ms", "max_error_streak"]
          : section === "events" ? ["tension_threshold", "runtime_error_threshold", "cooldown_ms", "max_auto_cycles_per_hour"] : ["auto_narrate", "narrative_interval", "digest_interval", "max_chapters"];
        const current = section === "scheduler" ? getSchedulerConfig() : section === "events" ? getEventConfig() : getNarrativeConfig();
        const candidate: Record<string, unknown> = { ...current };
        for (const name of names) candidate[name] = ["enabled", "auto_narrate"].includes(name) ? body[name] === "true" : Number(body[name]);
        updates[`DREAMGRAPH_${section.toUpperCase()}`] = JSON.stringify(candidate);
        // Remove old instance aliases so they cannot shadow the new object on restart.
        for (const field of engineSettingCatalogue()) if (field.owner === section && field.key.startsWith("DG_")) updates[field.key] = null;
      } else if (section === "database") {
        if (body.connectionString?.trim()) updates.DATABASE_URL = body.connectionString.trim();
      } else throw new Error("CONFIG_UNKNOWN_SECTION");
      const receipt = await applyEngineConfiguration(configurationPath(), { expected_revision: body._config_revision, operation_id: body._operation_id, updates });
      if (receipt.status !== "committed") throw new Error("CONFIG_APPLY_ABORTED: refresh and retry with a new operation");
      if (!receipt.replayed) {
      applyEffectiveEnvironment(updates);
      if (["scheduler", "events", "narrative"].includes(section)) applyComponentSettings();
      if (section === "llm") initLlmProvider({ ...getLlmConfig(), provider: process.env.DREAMGRAPH_LLM_PROVIDER as LlmConfig["provider"], baseUrl: process.env.DREAMGRAPH_LLM_URL ?? getLlmConfig().baseUrl, apiKey: process.env.DREAMGRAPH_LLM_API_KEY ?? "" });
      if (section === "dreamer") updateDreamerLlmConfig({ model: process.env.DREAMGRAPH_LLM_DREAMER_MODEL, temperature: Number(process.env.DREAMGRAPH_LLM_DREAMER_TEMPERATURE), maxTokens: Number(process.env.DREAMGRAPH_LLM_DREAMER_MAX_TOKENS) });
      if (section === "normalizer") updateNormalizerLlmConfig({ model: process.env.DREAMGRAPH_LLM_NORMALIZER_MODEL, temperature: Number(process.env.DREAMGRAPH_LLM_NORMALIZER_TEMPERATURE), maxTokens: Number(process.env.DREAMGRAPH_LLM_NORMALIZER_MAX_TOKENS) });
      if (section === "database") { updateDatabaseConnectionString(process.env.DATABASE_URL ?? ""); await resetDbPool(); }
      }
    }
    res.writeHead(303, { Location: `/config?saved=${encodeURIComponent(section ?? "")}` }); res.end();
  } catch (error) {
    const message = error instanceof Error ? error.message : "CONFIG_SAVE_FAILED";
    html(res, message.includes("CONFLICT") ? 409 : 400, await shell("Configuration error", `<h1>Configuration was not fully applied</h1><p>${esc(message)}</p><p>Refresh to inspect saved and effective values before retrying.</p><a href="/config">Return to configuration</a>`, "config"));
  }
}

/* ------------------------------------------------------------------ */
/*  Route: POST /config/test-db                                       */
/* ------------------------------------------------------------------ */

async function handleTestDbPost(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  // Read JSON body
  let connStr = "";
  try {
    const raw = await new Promise<string>((resolve, reject) => {
      let data = "";
      req.on("data", (chunk: Buffer) => { data += chunk.toString(); if (Buffer.byteLength(data) > 1024 * 1024) { reject(new Error("CONFIG_BODY_TOO_LARGE")); req.destroy(); } });
      req.on("end", () => resolve(data));
      req.on("error", reject);
    });
    const parsed = JSON.parse(raw);
    connStr = parsed.connectionString ?? "";
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, message: "Invalid request body.", latencyMs: 0 }));
    return;
  }

  const result = await testDbConnection(connStr || undefined);

  res.writeHead(200, {
    "Content-Type": "application/json",
    "Cache-Control": "no-cache",
  });
  res.end(JSON.stringify(result));
}

async function handleClearDbPost(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = await parseFormBody(req);
    if (!body._config_revision || !body._operation_id) throw new Error("CONFIG_REVISION_REQUIRED");
    const receipt = await applyEngineConfiguration(configurationPath(), { expected_revision: body._config_revision, operation_id: body._operation_id, updates: { DATABASE_URL: "" } });
    if (receipt.status !== "committed") throw new Error("CONFIG_APPLY_ABORTED");
    if (!receipt.replayed) { applyEffectiveEnvironment({ DATABASE_URL: "" }); updateDatabaseConnectionString(process.env.DATABASE_URL ?? ""); await resetDbPool(); }
    json(res, 200, { ok: true, receipt, deployment_override: ENGINE_DEPLOYMENT_OVERRIDES.DATABASE_URL !== undefined });
  } catch (error) { json(res, 409, { ok: false, error: error instanceof Error ? error.message : "CONFIG_SAVE_FAILED" }); }
}

/* ------------------------------------------------------------------ */
/*  Route: POST /datastores/scan                                      */
/* ------------------------------------------------------------------ */

async function handleDatastoreScanPost(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let datastoreId: string | undefined;
  let schemas: string[] | undefined;
  let createMissing: boolean | undefined;
  try {
    const raw = await new Promise<string>((resolve, reject) => {
      let data = "";
      req.on("data", (chunk: Buffer) => { data += chunk.toString(); });
      req.on("end", () => resolve(data));
      req.on("error", reject);
    });
    if (raw.trim().length > 0) {
      const parsed = JSON.parse(raw);
      if (typeof parsed.datastore_id === "string") datastoreId = parsed.datastore_id;
      if (Array.isArray(parsed.schemas)) {
        schemas = parsed.schemas.filter((s: unknown) => typeof s === "string");
      }
      if (typeof parsed.create_missing === "boolean") createMissing = parsed.create_missing;
    }
  } catch {
    json(res, 400, { success: false, error: { code: "BAD_REQUEST", message: "Invalid JSON body." } });
    return;
  }

  try {
    const result = await runDatastoreScan({ datastoreId, schemas, createMissing });
    json(res, result.success ? 200 : 400, result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Dashboard: datastore scan failed: ${msg}`);
    json(res, 500, { success: false, error: { code: "INTERNAL", message: msg } });
  }
}

/* ------------------------------------------------------------------ */
/*  Route: POST /restart                                              */
/* ------------------------------------------------------------------ */

async function handleRestartPost(res: ServerResponse): Promise<void> {
  // Acknowledge before shutdown so the browser gets a response
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, message: "Server restarting…" }));

  logger.info("Dashboard: Restart requested via web UI — exiting process");

  // Small delay to ensure the response is flushed
  setTimeout(() => {
    process.exit(0);
  }, 200);
}

/* ------------------------------------------------------------------ */
/*  Route: GET /docs — Native Markdown Viewer                         */
/* ------------------------------------------------------------------ */

/** Resolve the project-root docs/ directory from the active instance */
function docsDir(): string {
  const scope = getActiveScope();
  if (scope?.projectRoot) return resolve(scope.projectRoot, "docs");
  return resolve(PACKAGE_ROOT, "docs");
}

/**
 * Zero-dependency Markdown → HTML converter.
 * Handles: headings, paragraphs, fenced code blocks, inline code,
 * bold, italic, links, images, unordered/ordered lists, tables,
 * blockquotes, horizontal rules, and line breaks.
 */
function markdownToHtml(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  let inList: "ul" | "ol" | null = null;

  function closeList(): void {
    if (inList) { out.push(`</${inList}>`); inList = null; }
  }

  function inline(text: string): string {
    return text
      // Images (must come before links)
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2" style="max-width:100%">')
      // Links — rewrite relative .md hrefs to /docs/ dashboard URLs
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, href: string) => {
        // Only rewrite relative .md links (not http/https/mailto/anchor)
        if (
          !href.startsWith("http") &&
          !href.startsWith("mailto:") &&
          !href.startsWith("#") &&
          href.endsWith(".md")
        ) {
          const slug = href.replace(/\.md$/, "").replace(/^\.\//,"");
          return `<a href="/docs/${slug}">${label}</a>`;
        }
        return `<a href="${href}">${label}</a>`;
      })
      // Bold+italic
      .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
      // Bold
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/__(.+?)__/g, "<strong>$1</strong>")
      // Italic
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/_(.+?)_/g, "<em>$1</em>")
      // Inline code
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      // Line break (two trailing spaces)
      .replace(/  $/, "<br>");
  }

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.startsWith("```")) {
      closeList();
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      const langAttr = lang ? ` data-lang="${esc(lang)}"` : "";
      const langLabel = lang ? `<span class="code-lang">${esc(lang)}</span>` : "";
      out.push(`<div class="code-block">${langLabel}<pre${langAttr}><code>${esc(codeLines.join("\n"))}</code></pre></div>`);
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      closeList();
      out.push("<hr>");
      i++;
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      closeList();
      const level = headingMatch[1].length;
      const text = headingMatch[2].replace(/\s+#+\s*$/, ""); // strip trailing #
      const id = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      out.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
      i++;
      continue;
    }

    // Table (detect header row + separator)
    if (i + 1 < lines.length && /^\|(.+)\|$/.test(line.trim()) && /^\|[-:\s|]+\|$/.test(lines[i + 1].trim())) {
      closeList();
      const parseRow = (row: string): string[] =>
        row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());
      const headers = parseRow(line);
      i += 2; // skip header + separator
      out.push("<table><thead><tr>");
      for (const h of headers) out.push(`<th>${inline(h)}</th>`);
      out.push("</tr></thead><tbody>");
      while (i < lines.length && /^\|(.+)\|$/.test(lines[i].trim())) {
        const cells = parseRow(lines[i]);
        out.push("<tr>");
        for (let c = 0; c < headers.length; c++) {
          out.push(`<td>${inline(cells[c] ?? "")}</td>`);
        }
        out.push("</tr>");
        i++;
      }
      out.push("</tbody></table>");
      continue;
    }

    // Blockquote
    if (line.startsWith("> ") || line === ">") {
      closeList();
      const quoteLines: string[] = [];
      while (i < lines.length && (lines[i].startsWith("> ") || lines[i] === ">")) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${markdownToHtml(quoteLines.join("\n"))}</blockquote>`);
      continue;
    }

    // Unordered list
    if (/^[-*+]\s+/.test(line)) {
      if (inList !== "ul") { closeList(); out.push("<ul>"); inList = "ul"; }
      out.push(`<li>${inline(line.replace(/^[-*+]\s+/, ""))}</li>`);
      i++;
      continue;
    }

    // Ordered list
    if (/^\d+[.)]\s+/.test(line)) {
      if (inList !== "ol") { closeList(); out.push("<ol>"); inList = "ol"; }
      out.push(`<li>${inline(line.replace(/^\d+[.)]\s+/, ""))}</li>`);
      i++;
      continue;
    }

    // Blank line
    if (line.trim() === "") {
      closeList();
      i++;
      continue;
    }

    // Paragraph — collect consecutive non-empty lines
    closeList();
    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !lines[i].startsWith("#") && !lines[i].startsWith("```") && !lines[i].startsWith("> ") && !/^[-*+]\s+/.test(lines[i]) && !/^\d+[.)]\s+/.test(lines[i]) && !/^(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i]) && !/^\|(.+)\|$/.test(lines[i])) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      out.push(`<p>${paraLines.map(l => inline(l)).join("\n")}</p>`);
    }
  }

  closeList();
  return out.join("\n");
}

/** Additional CSS for the markdown viewer */
const MD_CSS = `
  .docs-layout { display: grid; grid-template-columns: 220px 1fr; gap: 32px; }
  .docs-sidebar { position: sticky; top: 80px; align-self: start; }
  .docs-sidebar a {
    display: block; padding: 6px 12px; border-radius: 6px;
    color: var(--text-dim); font-size: 13px; transition: all .15s;
  }
  .docs-sidebar a:hover { color: var(--text); background: var(--border); text-decoration: none; }
  .docs-sidebar a.active { color: var(--accent); background: rgba(88,166,255,.1); font-weight: 600; }
  .docs-content { min-width: 0; }
  .docs-content h1 { font-size: 28px; margin-bottom: 8px; }
  .docs-content h2 { font-size: 20px; margin: 28px 0 10px; }
  .docs-content h3 { font-size: 16px; margin: 20px 0 8px; color: var(--text); }
  .docs-content h4 { font-size: 14px; margin: 16px 0 6px; color: var(--text-dim); }
  .docs-content p { margin: 8px 0; line-height: 1.65; }
  .docs-content ul, .docs-content ol { margin: 8px 0 8px 24px; }
  .docs-content li { margin: 4px 0; line-height: 1.6; }
  .docs-content blockquote {
    border-left: 3px solid var(--accent); margin: 12px 0; padding: 8px 16px;
    background: rgba(88,166,255,.05); color: var(--text-dim);
  }
  .docs-content hr { border: none; border-top: 1px solid var(--border); margin: 24px 0; }
  .docs-content table { margin: 12px 0; }
  .docs-content img { border-radius: 6px; margin: 8px 0; }
  .code-block { position: relative; margin: 12px 0; }
  .code-block pre { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 14px; overflow-x: auto; font-size: 12px; }
  .code-lang {
    position: absolute; top: 4px; right: 8px; font-size: 10px;
    color: var(--text-dim); text-transform: uppercase; letter-spacing: .05em;
  }
  @media (max-width: 720px) {
    .docs-layout { grid-template-columns: 1fr; }
    .docs-sidebar { position: static; display: flex; flex-wrap: wrap; gap: 4px; }
  }
  .doc-section {
    margin-top: 12px; padding: 4px 8px; font-size: 11px; font-weight: 700;
    text-transform: uppercase; letter-spacing: .05em; color: var(--text-dim);
  }
  .doc-sublink { padding-left: 20px; font-size: 13px; }
`;

/** Friendly display name from filename */
function docTitle(filename: string): string {
  const name = basename(filename, extname(filename));
  if (name === "README") return "Overview";
  return name
    .replace(/-/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Sort order for doc files.
 * Priority: index.md / README.md first, then top-level files before
 * subdirectory files, _index.md first within a section, then alphabetical.
 */
function docOrder(a: string, b: string): number {
  if (a === "index.md" || a === "README.md") return -1;
  if (b === "index.md" || b === "README.md") return 1;
  const aDeep = a.includes("/"), bDeep = b.includes("/");
  if (!aDeep && bDeep) return -1;
  if (aDeep && !bDeep) return 1;
  // Within the same section, _index.md first
  const [aDir] = a.split("/"), [bDir] = b.split("/");
  if (aDir === bDir) {
    if (a.endsWith("/_index.md")) return -1;
    if (b.endsWith("/_index.md")) return 1;
  }
  return a.localeCompare(b);
}

/**
 * Discover all .md files in docs/, scanning one level of subdirectories.
 * Returns relative paths like "index.md" or "features/overview.md".
 */
async function getDocFiles(): Promise<string[]> {
  const base = docsDir();
  const files: string[] = [];
  try {
    const entries = await readdir(base, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory() && e.name.endsWith(".md")) {
        files.push(e.name);
      }
    }
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith(".")) {
        try {
          const sub = await readdir(resolve(base, e.name));
          for (const f of sub) {
            if (f.endsWith(".md")) files.push(`${e.name}/${f}`);
          }
        } catch { /* skip unreadable dirs */ }
      }
    }
  } catch {
    return [];
  }
  return files.sort(docOrder);
}

/** Convert a relative .md path to its URL slug: "features/overview.md" → "features/overview" */
function docSlug(relPath: string): string {
  return relPath.replace(/\.md$/, "");
}

/** Build a grouped sidebar with section headers */
function buildSidebar(files: string[], activeFile: string): string {
  const topLevel: string[] = [];
  const sections = new Map<string, string[]>();

  for (const f of files) {
    if (f.includes("/")) {
      const section = f.split("/")[0];
      if (!sections.has(section)) sections.set(section, []);
      sections.get(section)!.push(f);
    } else {
      topLevel.push(f);
    }
  }

  const parts: string[] = [];
  for (const f of topLevel) {
    const active = f === activeFile ? " active" : "";
    parts.push(`<a href="/docs/${encodeURIComponent(docSlug(f))}" class="doc-link${active}">${docTitle(f)}</a>`);
  }
  for (const [section, sectionFiles] of sections) {
    parts.push(`<div class="doc-section">${docTitle(section)}</div>`);
    for (const f of sectionFiles) {
      const active = f === activeFile ? " active" : "";
      const slug = docSlug(f);
      const name = basename(f, ".md");
      const title = name === "_index" ? "Overview" : docTitle(name);
      parts.push(`<a href="/docs/${slug}" class="doc-link doc-sublink${active}">${title}</a>`);
    }
  }
  return parts.join("\n");
}

async function renderDocs(): Promise<string> {
  const files = await getDocFiles();
  if (files.length === 0) {
    return await shell("Docs", `<h1>Documentation</h1><p class="empty">No markdown files found in docs/ directory.</p>`, "docs");
  }
  // Default to first file (index.md or README.md due to sort order)
  return renderDocFile(files[0], files);
}

async function readArchitectGuide(): Promise<string> {
  const activeProjectRoot = getActiveScope()?.projectRoot;
  const candidates = [
    resolve(PACKAGE_ROOT, "guide", "architect-for-dummies.md"),
    resolve(process.cwd(), "guide", "architect-for-dummies.md"),
    activeProjectRoot ? resolve(activeProjectRoot, "guide", "architect-for-dummies.md") : undefined,
  ].filter((candidate, index, all): candidate is string => Boolean(candidate) && all.indexOf(candidate) === index);
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return await readFile(candidate, "utf-8");
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("architect_guide_not_found");
}

async function renderArchitectGuide(): Promise<string> {
  const content = await readArchitectGuide();
  const body = `<style>${MD_CSS}</style><article class="docs-content"><p><a href="/">Back to Dashboard</a> | <a href="/architect">Open Architect</a></p>${markdownToHtml(content)}</article>`;
  return await shell("Architect Beginner Guide", body, "docs");
}

async function renderDocFile(filename: string, files?: string[]): Promise<string> {
  if (!files) files = await getDocFiles();

  // Security: reject traversal and non-.md
  if (filename.includes("..")) {
    return await shell("Not Found", `<h1>Not Found</h1><p><a href="/docs">Back to Docs</a></p>`, "docs");
  }
  const safePath = filename.endsWith(".md") ? filename : `${filename}.md`;

  let content: string;
  try {
    const fullPath = resolve(docsDir(), ...safePath.split("/"));
    content = await readFile(fullPath, "utf-8");
  } catch {
    return await shell("Not Found", `<h1>File not found</h1><p><code>${esc(safePath)}</code> does not exist.</p><p><a href="/docs">Back to Docs</a></p>`, "docs");
  }

  const sidebar = buildSidebar(files, safePath);
  const rendered = markdownToHtml(content);
  const title = docTitle(basename(safePath, ".md"));

  const body = `
    <style>${MD_CSS}</style>
    <div class="docs-layout">
      <nav class="docs-sidebar">${sidebar}</nav>
      <article class="docs-content">${rendered}</article>
    </div>`;

  return await shell(`Docs: ${title}`, body, "docs");
}

/* ------------------------------------------------------------------ */
/*  Route dispatcher                                                  */
/* ------------------------------------------------------------------ */

/**
 * Try to handle a dashboard route.
 * Returns true if the route was handled, false if it should fall through.
 */
export async function handleDashboardRoute(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  if(req.method==="GET"&&pathname==="/schedules/workspace.js"){res.writeHead(200,{"Content-Type":"application/javascript; charset=utf-8","Cache-Control":"no-store"});res.end(SCHEDULE_WORKSPACE_SCRIPT);return true;}
  if(req.method==="GET"&&pathname==="/config/workspace.js"){res.writeHead(200,{"Content-Type":"application/javascript; charset=utf-8","Cache-Control":"no-store"});res.end(CONFIGURATION_WORKSPACE_SCRIPT);return true;}
  if(req.method==="GET"&&pathname==="/status/workspace.js"){res.writeHead(200,{"Content-Type":"application/javascript; charset=utf-8","Cache-Control":"no-store"});res.end(RUNTIME_WORKSPACE_SCRIPT);return true;}
  if(req.method==="GET"&&pathname==="/api/dashboard/v1"){
    try { const result=await withGraphRead(async()=>{const graph=await loadCanonicalGraph(getActiveScope()?.uuid??"legacy"),dirty=await readDirtyPartitions();
      return {schema:"dreamgraph.dashboard_state.v1",observed_at:new Date().toISOString(),graph:{revision:graph.revision,currency:graph.currency,state:graph.state},
        dirty_total:dirty.partitions.length,dirty_regions:dirty.partitions.slice(0,100)};});json(res,200,result); }
    catch{json(res,503,{ok:false,error:"DASHBOARD_CANONICAL_READ_UNAVAILABLE"});}return true;
  }
  if(req.method==="GET"&&pathname==="/api/computer-use/v1/policy"){
    // Canonical instance policy for every Architect surface (browser, VS Code). Never a per-client copy.
    json(res,200,{ok:true,schema:"dreamgraph.computer_use_policy.v1",policy:computerUsePolicy(),setting:"DREAMGRAPH_COMPUTER_USE_POLICY",
      routes:{"codex-cli":"Codex native Computer Use","native_api_tool_loop":"DreamGraph browser harness, prepared explicitly per pass"}});return true;}
  if(await handleScheduleApi(req,res,pathname))return true;
  if (pathname.startsWith("/api/config/v1")) { await handleConfigurationApi(req, res, pathname); return true; }

  if (req.method === "GET" && new URL(req.url ?? "/", "http://localhost").searchParams.get("embed") === "architect") {
    const workspace = pathname === "/config" ? "config" : pathname === "/schedules" ? "schedules"
      : pathname === "/status" ? "status" : pathname === "/health" ? "health" : null;
    if (workspace) {
      const page = workspace === "config" ? await renderConfig() : workspace === "schedules" ? await renderSchedules()
        : workspace === "status" ? await renderStatus() : await renderHealth();
      html(res, 200, embedArchitectWorkspace(page, workspace));
      return true;
    }
  }

  if (req.method === "POST" && pathname === "/config") {
    await handleConfigPost(req, res);
    return true;
  }
  if (req.method === "POST" && pathname === "/config/test-db") {
    await handleTestDbPost(req, res);
    return true;
  }
  if (req.method === "POST" && pathname === "/config/clear-db") {
    await handleClearDbPost(req, res);
    return true;
  }
  if (req.method === "POST" && pathname === "/datastores/scan") {
    await handleDatastoreScanPost(req, res);
    return true;
  }
  if (req.method === "POST" && pathname === "/schedules") {
    json(res, 410, {ok:false,error:"LEGACY_SCHEDULE_FORM_RETIRED",workspace:"/schedules",api:"/api/schedules/v2"});
    return true;
  }
  if (req.method === "POST" && pathname === "/restart") {
    await handleRestartPost(res);
    return true;
  }

  if (req.method === "GET" && pathname === "/favicon.svg") {
    res.writeHead(200, {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=86400",
    });
    res.end(FAVICON_SVG);
    return true;
  }
  if (req.method === "GET" && (pathname === "/" || pathname === "")) {
    html(res, 200, await renderIndex());
    return true;
  }
  if (req.method === "GET" && pathname === "/status") {
    html(res, 200, await renderStatus());
    return true;
  }
  if (req.method === "GET" && pathname === "/health") {
    const accept = String(req.headers.accept ?? "");
    if (accept.includes("application/json")) {
      const status = await engine.getStatus();
      const sessions = _ctx.getSessionCount();
      const llmCfg = getLlmConfig();
      const ok = !!(status.llm?.available);
      json(res, ok ? 200 : 503, {
        ok,
        state: status.current_state,
        sessions,
        llm: {
          provider: llmCfg.provider,
          dreamer_model: getDreamerLlmConfig().model,
          normalizer_model: getNormalizerLlmConfig().model,
          available: status.llm?.available ?? false,
        },
        instance: isInstanceMode() ? getActiveScope()?.uuid : null,
        onboarding_readiness: buildOnboardingReadinessProjection(),
      });
    } else {
      html(res, 200, await renderHealth());
    }
    return true;
  }
  if (req.method === "GET" && pathname === "/schedules") {
    const url = new URL(req.url ?? "/schedules", `http://${req.headers.host ?? 'localhost'}`);
    const toast = url.searchParams.get("toast") ?? undefined;
    html(res, 200, await renderSchedules(toast));
    return true;
  }
  if (req.method === "GET" && pathname === "/config") {
    const url = new URL(req.url ?? "/config", `http://${req.headers.host ?? 'localhost'}`);
    const saved = url.searchParams.get("saved") ?? undefined;
    html(res, 200, await renderConfig(saved));
    return true;
  }
  if (req.method === "GET" && pathname === "/architect-guide") {
    await recordOnboardingTelemetryEvent({ event: "guide_opened", source: "dashboard" });
    html(res, 200, await renderArchitectGuide());
    return true;
  }
  if (req.method === "GET" && pathname === "/docs") {
    html(res, 200, await renderDocs());
    return true;
  }
  if (req.method === "GET" && pathname.startsWith("/docs/")) {
    const rel = decodeURIComponent(pathname.slice("/docs/".length));
    html(res, 200, await renderDocFile(rel));
    return true;
  }

  return false;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/** HTML-escape for element content. Null-safe — coerces any input to string. */
function esc(s: unknown): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** HTML-escape for attribute values (double-quoted). Null-safe. */
function escAttr(s: unknown): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-GB", { dateStyle: "short", timeStyle: "medium", timeZone: "UTC" }) + " UTC";
  } catch {
    return iso;
  }
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function statusBadge(status: string): string {
  const s = status.toLowerCase();
  if (s === "active" || s === "complete" || s === "implemented") return `<span class="badge badge-green">${esc(status)}</span>`;
  if (s === "planned" || s === "pending" || s === "in_progress") return `<span class="badge badge-yellow">${esc(status)}</span>`;
  if (s === "deprecated" || s === "removed") return `<span class="badge badge-red">${esc(status)}</span>`;
  return `<span class="badge badge-blue">${esc(status)}</span>`;
}

async function safeAsync<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

/** Parse a URL-encoded form body from an HTTP request. */
function parseFormBody(req: IncomingMessage): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => { data += chunk.toString(); });
    req.on("end", () => {
      try {
        const params = new URLSearchParams(data);
        const result: Record<string, string> = {};
        for (const [k, v] of params) result[k] = v;
        resolve(result);
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}
