/**
 * Human-facing configuration workspace (v14.0.1).
 *
 * The daemon remains the only authority: values are read from the instance's
 * engine.env through GET /api/config/v1 every time the page opens, and saved
 * through the revision-checked POST /api/config/v1/apply (with undo). This
 * module only decides how settings are presented: plain-language labels, real
 * controls (pickers, toggles, sliders, secrets), sensible grouping and a small
 * set of advanced options, with the full raw inventory kept collapsed.
 */
import type { EngineSetting } from "../config/engine-setting-catalogue.js";
import { providerCapabilityRecords } from "../config/provider-capabilities.js";
export function configurationModelChoices() {
  return providerCapabilityRecords().map(record => ({ value: record.model, provider: record.provider, api: record.default_api }));
}
/** Raw-inventory grouping used by the catalogue API and the collapsed "All settings" list. */
export const CONFIGURATION_TABS = [
  ["models", "Models & roles"], ["scanning", "Scan & enrichment"], ["cognition", "Cognition & truth"],
  ["scheduling", "Schedules & events"], ["retrieval", "Retrieval & budgets"],
  ["integrations", "Repositories & connections"], ["computer", "Computer Use"], ["advanced", "Advanced"],
] as const;
export function configurationTab(field: Pick<EngineSetting, "key" | "owner" | "apply">): string {
  const { key, owner } = field;
  if (field.apply === "read_only") return "advanced";
  if (key.startsWith("DREAMGRAPH_COMPUTER_USE") || owner === "role:computer_use") return "computer";
  if (/MAX_CALLS|MAX_INPUT_TOKENS|MAX_OUTPUT_TOKENS|MAX_REASONING_TOKENS|MAX_RETRIES|MAX_ELAPSED_MS|CONCURRENCY|MAX_HOPS|MAX_NEIGHBORS|RUN_BUDGET|DAY_BUDGET|BILLING|PRICING|BUDGET_CURRENCY|TOKEN_ECONOMY|SEMANTIC_CACHE|GRAPH_CONTEXT/.test(key)) return "retrieval";
  if (["scheduler", "events", "narrative"].includes(owner)) return "scheduling";
  if (owner === "role:initial_scan" || owner === "role:enrichment" || /ENRICHMENT|REPOSITORY_CHANGE|GRAPH_CHANGE|GRAPH_STALE/.test(key)) return "scanning";
  if (key.startsWith("DREAMGRAPH_LLM_") || owner.startsWith("role:") || owner === "model policy" || owner === "architect") return "models";
  if (owner === "daemon authority" || owner === "federation" || /REPOS|DATABASE|DG_DB_|RUNTIME_ENDPOINT|RUNTIME_TYPE|HOST_MCP|BRIDGE_SERVER/.test(key)) return "integrations";
  if (/^DG_(PROMOTION|RETENTION|MAX_CONTRADICTION|DECAY|TENSION|MEMORY|ORPHAN|BARREN|PROBE|STRATEGY|NORMALIZER|BOOTSTRAP|LLM_BUDGET|PGO_BUDGET)/.test(key) || /DOOM|RESOLUTION_PLANS/.test(key)) return "cognition";
  return "advanced";
}

const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export const CONFIGURATION_PAGES = [
  ["models", "Models"], ["architect", "Architect"], ["database", "Database"], ["repos", "Repositories"],
  ["automation", "Automation"], ["budgets", "Budgets & limits"], ["computer", "Computer Use"], ["advanced", "Advanced"],
] as const;

export function renderConfigurationWorkspace(revision: string, restartCommand: string): string {
  return `<section id="configuration-workspace" class="cfg" aria-label="DreamGraph configuration" data-loading="true">
  <header class="cfg-head">
    <div><h1>Configuration</h1><p id="cfg-source">Reading this instance's engine.env…</p></div>
    <div class="cfg-head-actions"><a href="/schedules">Schedules →</a><button id="cw-refresh" type="button" title="Read engine.env again">Reload</button></div>
  </header>
  <nav id="cw-tabs" class="cfg-tabs" role="tablist" aria-label="Configuration sections">${CONFIGURATION_PAGES.map(([id, label], i) =>
    `<button id="cw-tab-${id}" role="tab" type="button" aria-controls="cw-panel" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" data-tab="${id}">${label}</button>`).join("")}</nav>
  <div id="cw-message" class="cfg-message" role="status" aria-live="polite"></div>
  <div id="cw-scroll" class="cfg-scroll"><div id="cw-panel" class="cfg-panel" role="tabpanel" aria-labelledby="cw-tab-models"></div></div>
  <footer class="cfg-savebar">
    <span id="cw-draft-count">No unsaved changes</span>
    <button id="cw-discard" type="button" disabled>Discard</button>
    <button id="cw-undo" type="button" disabled title="Restore engine.env as it was before your last save">Undo last save</button>
    <button id="cw-save" type="button" class="cfg-primary" disabled>Save changes</button>
  </footer>
  <input type="hidden" id="cw-revision" value="${escape(revision)}"><input type="hidden" id="cw-restart-command" value="${escape(restartCommand)}">
  <noscript>This page needs JavaScript. engine.env can still be edited by hand.</noscript>
</section><style>${CONFIGURATION_WORKSPACE_CSS}</style><script src="/config/workspace.js" defer></script>`;
}

const CONFIGURATION_WORKSPACE_CSS = String.raw`
#configuration-workspace{--c-line:#363b42;--c-dim:#9aa4b1;--c-card:#1a1d21;--c-card2:#20242a;--c-acc:#7fb0e0;--c-ok:#86c79a;--c-warn:#e2c07a;--c-bad:#e59a9a;
  display:flex;flex-direction:column;min-height:0;height:100%;color:#dde3ea;font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
#configuration-workspace [hidden]{display:none!important}
.cfg-head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex:none;padding-bottom:6px}
.cfg-head h1{margin:0;font-size:19px}.cfg-head p{margin:2px 0 0;color:var(--c-dim);font-size:12px}
.cfg-head-actions{display:flex;gap:10px;align-items:center}.cfg-head-actions a{color:var(--c-acc);text-decoration:none}
.cfg-tabs{display:flex;gap:2px;flex:none;border-bottom:1px solid var(--c-line);overflow-x:auto}
#configuration-workspace .cfg-tabs button{background:none;border:0;border-bottom:2px solid transparent;border-radius:0;color:var(--c-dim);padding:7px 12px;cursor:pointer;font:inherit;white-space:nowrap}
#configuration-workspace .cfg-tabs button[aria-selected=true]{color:#fff;border-bottom-color:var(--c-acc);background:none}#configuration-workspace .cfg-tabs button:hover{color:#fff;background:#1c2026}
.cfg-tabs button .dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--c-warn);margin-left:5px;vertical-align:middle}
.cfg-message{flex:none;min-height:0;padding:0;font-size:12px}.cfg-message:not(:empty){padding:6px 9px;margin:6px 0 0;border-radius:4px;background:#1f2a35;border:1px solid #2f4a63}
.cfg-message.is-error{background:#35201f;border-color:#6b3434;color:#f1c3c3}.cfg-message.is-ok{background:#1d2d22;border-color:#355c41}
.cfg-scroll{flex:1;min-height:0;overflow:auto;padding:10px 2px 14px}
.cfg-panel{max-width:980px}
.cfg-intro{color:var(--c-dim);margin:0 0 12px;max-width:760px}
.cfg-card{background:var(--c-card);border:1px solid var(--c-line);border-radius:7px;padding:12px 14px;margin:0 0 12px}
.cfg-card>h2{margin:0 0 2px;font-size:14px;display:flex;align-items:center;gap:8px}.cfg-card>h2 .tag{font-weight:400}
.cfg-card>.sub{margin:0 0 10px;color:var(--c-dim);font-size:12px}
.cfg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px 16px}
.cfg-field{display:flex;flex-direction:column;gap:4px;min-width:0}.cfg-field.wide{grid-column:1/-1}
.cfg-field>label{font-weight:600;font-size:12px;display:flex;gap:6px;align-items:center}
.cfg-field .help{color:var(--c-dim);font-size:11.5px}
.cfg-field[data-dirty=true]>label::after{content:"edited";font-weight:400;font-size:10px;color:var(--c-warn);border:1px solid #6d5a30;border-radius:8px;padding:0 5px}
.cfg-field .err{color:var(--c-bad);font-size:11.5px}
#configuration-workspace input,#configuration-workspace select,#configuration-workspace textarea{font:inherit;color:#e7ecf2;background:#111418;border:1px solid #3a414a;border-radius:4px;padding:6px 8px;min-width:0;box-sizing:border-box;width:100%}
#configuration-workspace input[type=checkbox],#configuration-workspace input[type=radio]{width:auto;padding:0;margin:2px 0 0;accent-color:var(--c-acc);flex:none}
#configuration-workspace input[type=range]{padding:0;accent-color:var(--c-acc)}
#configuration-workspace input:focus,#configuration-workspace select:focus,#configuration-workspace textarea:focus{outline:2px solid #4b77a3;outline-offset:0;border-color:#4b77a3}
#configuration-workspace button{font:inherit;color:#e3e8ee;background:#262b31;border:1px solid #434b55;border-radius:4px;padding:5px 11px;cursor:pointer}
#configuration-workspace button:hover:not(:disabled){background:#2f353d}#configuration-workspace button:disabled{opacity:.45;cursor:default}
#configuration-workspace .cfg-primary{background:#2e5b86;border-color:#4f86ba;color:#fff;font-weight:600}
#configuration-workspace .cfg-primary:hover:not(:disabled){background:#356896}
#configuration-workspace .cfg-danger{color:#f0b4b4;border-color:#6b3a3a}
.cfg-inline{display:flex;gap:6px;align-items:center}.cfg-inline>input,.cfg-inline>select{flex:1}
.cfg-unit{color:var(--c-dim);font-size:12px;white-space:nowrap}
.cfg-range{display:flex;gap:8px;align-items:center}.cfg-range output{min-width:34px;text-align:right;font-variant-numeric:tabular-nums}
.tag{display:inline-block;font-size:10.5px;padding:1px 7px;border-radius:9px;border:1px solid var(--c-line);color:var(--c-dim);white-space:nowrap}
.tag.ok{color:var(--c-ok);border-color:#3c6b4b}.tag.warn{color:var(--c-warn);border-color:#6d5a30}.tag.bad{color:var(--c-bad);border-color:#6b3a3a}
.cfg-status{font-size:11.5px;color:var(--c-dim);margin-top:8px;padding-top:8px;border-top:1px dashed var(--c-line)}
.cfg-status b{color:#cfd7e0;font-weight:600}.cfg-status .warn{color:var(--c-warn)}
details.cfg-more{margin-top:10px;border-top:1px solid var(--c-line);padding-top:8px}
details.cfg-more>summary{cursor:pointer;color:var(--c-acc);font-size:12px;list-style:none}details.cfg-more>summary::before{content:"▸ ";color:var(--c-dim)}details.cfg-more[open]>summary::before{content:"▾ "}
details.cfg-more>.cfg-grid,details.cfg-more>div{margin-top:10px}
.cfg-choice{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}
.cfg-choice label{display:flex;gap:10px;align-items:flex-start;padding:12px;border:1px solid var(--c-line);border-radius:7px;background:var(--c-card2);cursor:pointer}
.cfg-choice label:has(input:checked){border-color:#4f86ba;background:#1d2b39}
.cfg-choice strong{display:block;margin-bottom:2px}.cfg-choice span{color:var(--c-dim);font-size:12px}
.cfg-repos{display:flex;flex-direction:column;gap:6px}
.cfg-repo{display:grid;grid-template-columns:minmax(110px,170px) minmax(0,1fr) 150px 34px;gap:6px;align-items:center}
.cfg-repo .x{padding:4px 0;color:#f0b4b4;font-weight:700}
.cfg-repo-head{display:grid;grid-template-columns:minmax(110px,170px) minmax(0,1fr) 150px 34px;gap:6px;font-size:11px;color:var(--c-dim)}
.cfg-table{width:100%;border-collapse:collapse;font-size:12.5px}.cfg-table th{text-align:left;font-weight:600;color:var(--c-dim);font-size:11.5px;padding:4px 6px;border-bottom:1px solid var(--c-line)}
.cfg-table td{padding:4px 6px;border-bottom:1px solid #2a2f35;vertical-align:middle}.cfg-table td input{min-width:70px}
.cfg-raw{display:grid;grid-template-columns:minmax(180px,30%) minmax(0,1fr) auto;gap:6px 10px;align-items:center;font-size:12px}
.cfg-raw .k{font-family:ui-monospace,Consolas,monospace;font-size:11px;color:var(--c-dim);overflow-wrap:anywhere}
.cfg-raw .n{font-weight:600}.cfg-raw .src{font-size:10.5px;color:var(--c-dim)}
.cfg-savebar{flex:none;display:flex;gap:8px;align-items:center;justify-content:flex-end;border-top:1px solid var(--c-line);padding:8px 2px;background:inherit}
.cfg-savebar>span{margin-right:auto;color:var(--c-dim)}.cfg-savebar>span.dirty{color:var(--c-warn)}
@media(max-width:700px){.cfg-repo,.cfg-repo-head{grid-template-columns:1fr 1fr}.cfg-repo .x{grid-column:2;justify-self:end;width:34px}.cfg-repo-head{display:none}.cfg-raw{grid-template-columns:1fr}}
`;

/** Served as /config/workspace.js. No backticks or template placeholders may appear inside. */
export const CONFIGURATION_WORKSPACE_SCRIPT = String.raw`(() => {
'use strict';
const $ = id => document.getElementById(id), root = $('configuration-workspace');
if (!root) return;

/* ---------------- state ---------------- */
let snap = null, cat = {}, roles = [], reviews = [], comps = {}, tab = 'models', busy = false, lastOperation = null, repos = null, repoDraft = null, repoDirty = false;
const D = {};          // key -> string (write) | null (remove from engine.env = use default)
const errs = {};       // key -> message
try { const saved = sessionStorage.getItem('dg-config-tab'); if (saved) tab = saved; } catch (e) { /* no storage */ }
const qs = new URLSearchParams(location.search); if (qs.get('tab')) tab = qs.get('tab');

/* ---------------- helpers ---------------- */
function h(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return n;
}
const say = (text, kind) => { const m = $('cw-message'); m.textContent = text || ''; m.className = 'cfg-message' + (kind ? ' is-' + kind : ''); };
async function api(path, body) {
  const r = await fetch(path, { method: body === undefined ? 'GET' : 'POST', cache: 'no-store', credentials: 'same-origin',
    headers: { 'Accept': 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  let v = null; try { v = await r.json(); } catch (e) { v = {}; }
  if (!r.ok || v.ok === false) { const e = new Error(humanError(v.error && v.error.message || v.error || v.message || ('HTTP ' + r.status))); e.fields = v.fields || []; e.status = r.status; throw e; }
  return v;
}
function humanError(code) {
  code = String(code || '');
  if (/REVISION|CONFLICT/.test(code)) return 'engine.env was changed somewhere else since this page loaded. Your edits are kept: press Reload, check them, and save again.';
  if (/CONFIG_INVALID_SETTING: (\S+)/.test(code)) { const key = code.match(/CONFIG_INVALID_SETTING: (\S+)/)[1]; return 'Invalid value for "' + label(key) + '" (' + key + ').'; }
  if (/CONFIG_INVALID_COMPONENT: (\S+)/.test(code)) return 'The ' + code.split(': ')[1] + ' settings are not valid together. Check the Automation page.';
  if (/PERSISTENCE_UNAVAILABLE/.test(code)) return 'No DreamGraph instance is attached, so there is no engine.env to save to.';
  return code;
}
const sett = key => snap && snap.settings[key] || null;
/** Value written in engine.env (null when the key is not in the file). */
function saved(key) { const s = sett(key); return s && s.source === 'instance' ? s.persisted : null; }
function has(key) { return Object.prototype.hasOwnProperty.call(D, key); }
/** Current value: unsaved edit, else engine.env, else null (= default). */
function cur(key) { return has(key) ? D[key] : saved(key); }
function isSecretSet(key) { const v = cur(key); return v !== null && v !== '' && v !== '[empty]'; }
const FALLBACK = {
  DREAMGRAPH_LLM_PROVIDER: 'ollama', DREAMGRAPH_LLM_TEMPERATURE: '0.7', DREAMGRAPH_LLM_MAX_TOKENS: '2048', DREAMGRAPH_LLM_TIMEOUT_MS: '120000',
  DREAMGRAPH_LLM_DREAMER_TEMPERATURE: '0.7', DREAMGRAPH_LLM_NORMALIZER_TEMPERATURE: '0.1', DREAMGRAPH_COMPUTER_USE_POLICY: 'ask',
  DREAMGRAPH_ARCHITECT_PASS_TIMEOUT_MS: '1800000', DREAMGRAPH_LLM_ARCHITECT_ADAPTER: 'native_api_tool_loop', DREAMGRAPH_ARCHITECT_TOKEN_ECONOMY: 'true',
  DREAMGRAPH_ARCHITECT_TOKEN_ECONOMY_SOFT_TARGET: '16384', DREAMGRAPH_ARCHITECT_AUTONOMY_MODE: 'manual', DREAMGRAPH_ARCHITECT_VERBOSITY_MODE: 'balanced',
  DG_DB_MAX_CONNECTIONS: '3', DG_DB_STATEMENT_TIMEOUT: '5000', DG_DB_OPERATION_TIMEOUT: '10000', DREAMGRAPH_DEBUG: 'false',
  DREAMGRAPH_GRAPH_STALE_HOURS: '24', DREAMGRAPH_ENRICHMENT_STALE_HOURS: '168', DREAMGRAPH_ENRICHMENT_BATCH_SIZE: '20', DG_PROMOTION_CONFIDENCE: '0.62',
  DG_DECAY_TTL: '8', DG_MAX_ACTIVE_TENSIONS: '200', DG_LLM_BUDGET: '0.35', DG_NORMALIZER_LLM_THRESHOLD: '0.35', DG_ALLOW_INPROCESS_PLUGINS: 'false',
  DREAMGRAPH_AUTO_APPLY_RESOLUTION_PLANS: 'false', DREAMGRAPH_METRICS_ENABLED: 'false', DREAMGRAPH_ENABLE_DOOM: 'false', DREAMGRAPH_MAJOR_REPOSITORY_CHANGE_FILES: '20',
};
/** What applies when the key is not set in engine.env. */
function dflt(key) {
  const s = sett(key);
  if (s && s.source === 'deployment' && !s.secret) return s.effective;
  const m = cat[key];
  if (m && m.template_default !== null && m.template_default !== undefined && m.template_default !== '') return m.template_default;
  return FALLBACK[key] !== undefined ? FALLBACK[key] : null;
}
/** Value that will be in effect after saving (edit, file or default). */
function eff(key) { const c = cur(key); return c !== null && c !== undefined && c !== '' ? c : dflt(key); }
function setDraft(key, value) {
  if (value === undefined) value = null;
  const base = saved(key);
  if (value === base || (value === null && base === null)) delete D[key]; else D[key] = value;
  delete errs[key];
  refreshDirty();
}
const PRETTY = {};
function label(key) { return PRETTY[key] || key.replace(/^DREAMGRAPH_(LLM_)?|^DG_/, '').toLowerCase().replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()); }
function deployed(key) { const s = sett(key); return s && s.source === 'deployment'; }

/* ---------------- generic field controls ---------------- */
function field(key, title, help, control, opts) {
  opts = opts || {}; PRETTY[key] = title;
  const wrap = h('div', { class: 'cfg-field' + (opts.wide ? ' wide' : ''), 'data-key': key, 'data-dirty': String(has(key)) },
    h('label', { for: 'f-' + key }, title, opts.badge || null), control,
    help ? h('div', { class: 'help' }, help) : null,
    deployed(key) ? h('div', { class: 'help' }, 'Set by the launching environment; that value wins over engine.env.') : null,
    h('div', { class: 'err', id: 'e-' + key }, errs[key] || ''));
  return wrap;
}
function markDirty(key) { const n = root.querySelector('.cfg-field[data-key="' + key + '"]'); if (n) n.dataset.dirty = String(has(key)); }
function text(key, title, help, opts) {
  opts = opts || {};
  const input = h('input', { id: 'f-' + key, type: 'text', value: cur(key) || '', placeholder: opts.placeholder || (dflt(key) ? 'Default: ' + dflt(key) : 'Not set'), spellcheck: 'false', autocomplete: 'off' });
  input.addEventListener('input', () => { setDraft(key, input.value.trim() === '' ? null : input.value.trim()); markDirty(key); if (opts.onchange) opts.onchange(); });
  return field(key, title, help, input, opts);
}
function secret(key, title, help, opts) {
  opts = opts || {};
  const isSet = saved(key) !== null && saved(key) !== '[empty]';
  const input = h('input', { id: 'f-' + key, type: 'password', value: has(key) && D[key] !== null ? D[key] : '', autocomplete: 'new-password', spellcheck: 'false',
    placeholder: has(key) && D[key] === null ? 'Will be removed on save' : isSet ? 'Saved — leave empty to keep it' : (opts.placeholder || 'Not set') });
  input.addEventListener('input', () => { if (input.value === '') { delete D[key]; refreshDirty(); } else setDraft(key, input.value); markDirty(key); });
  const show = h('button', { type: 'button', onclick: () => { input.type = input.type === 'password' ? 'text' : 'password'; show.textContent = input.type === 'password' ? 'Show' : 'Hide'; } }, 'Show');
  const clear = isSet ? h('button', { type: 'button', class: 'cfg-danger', title: 'Remove this secret from engine.env', onclick: () => { setDraft(key, null); input.value = ''; input.placeholder = 'Will be removed on save'; markDirty(key); } }, 'Remove') : null;
  const badge = h('span', { class: 'tag ' + (isSet ? 'ok' : '') }, isSet ? 'saved' : 'not set');
  return field(key, title, help, h('div', { class: 'cfg-inline' }, input, show, clear), { ...opts, badge });
}
/** numbers: opts.scale converts stored units (e.g. ms) to shown units (e.g. 60000 = minutes). */
function num(key, title, help, opts) {
  opts = opts || {}; const scale = opts.scale || 1;
  const raw = cur(key), d = dflt(key);
  const toShown = v => v === null || v === '' || v === undefined ? '' : String(Math.round(Number(v) / scale * 1000) / 1000);
  const input = h('input', { id: 'f-' + key, type: 'number', value: toShown(raw), placeholder: d !== null ? 'Default: ' + toShown(d) : 'Default', min: opts.min, max: opts.max, step: opts.step || 'any', inputmode: 'decimal' });
  input.addEventListener('input', () => {
    if (input.value.trim() === '') { setDraft(key, null); markDirty(key); return; }
    const v = Number(input.value);
    if (!Number.isFinite(v) || (opts.min !== undefined && v < opts.min) || (opts.max !== undefined && v > opts.max)) { errs[key] = 'Enter a number' + (opts.min !== undefined ? ' from ' + opts.min : '') + (opts.max !== undefined ? ' to ' + opts.max : '') + '.'; $('e-' + key).textContent = errs[key]; refreshDirty(); return; }
    const stored = opts.integer === false ? v * scale : Math.round(v * scale);
    setDraft(key, String(stored)); $('e-' + key).textContent = ''; markDirty(key);
  });
  return field(key, title, help, h('div', { class: 'cfg-inline' }, input, opts.unit ? h('span', { class: 'cfg-unit' }, opts.unit) : null), opts);
}
/** choices: [[value,label],...]; the first "Default" option removes the key from engine.env. */
function pick(key, title, help, choices, opts) {
  opts = opts || {};
  const d = dflt(key), c = cur(key);
  const sel = h('select', { id: 'f-' + key });
  if (!opts.noDefault) { const dl = choices.find(x => x[0] === d); sel.append(h('option', { value: '' }, 'Default' + (d !== null ? ' (' + (dl ? dl[1] : d) + ')' : ''))); }
  for (const [v, l] of choices) sel.append(h('option', { value: v }, l));
  if (c !== null && c !== '' && !choices.some(x => x[0] === c)) sel.append(h('option', { value: c }, c + ' (current)'));
  sel.value = c === null || c === undefined ? (opts.noDefault ? (d || choices[0][0]) : '') : c;
  sel.addEventListener('change', () => { setDraft(key, sel.value === '' ? null : sel.value); markDirty(key); if (opts.onchange) opts.onchange(sel.value); });
  return field(key, title, help, sel, opts);
}
function onoff(key, title, help, opts) { return pick(key, title, help, [['true', 'On'], ['false', 'Off']], opts); }
function slider(key, title, help, opts) {
  const d = dflt(key), c = cur(key), v = c !== null && c !== '' ? c : (d !== null ? d : String(opts.fallback));
  const out = h('output', {}, v), input = h('input', { id: 'f-' + key, type: 'range', min: opts.min, max: opts.max, step: opts.step, value: v });
  input.addEventListener('input', () => { out.textContent = input.value; setDraft(key, input.value); markDirty(key); });
  const reset = h('button', { type: 'button', title: 'Use the default', onclick: () => { setDraft(key, null); const nv = dflt(key) !== null ? dflt(key) : String(opts.fallback); input.value = nv; out.textContent = nv; markDirty(key); } }, 'Default');
  return field(key, title, help, h('div', { class: 'cfg-range' }, h('span', { class: 'cfg-unit' }, opts.left || ''), input, h('span', { class: 'cfg-unit' }, opts.right || ''), out, reset), opts);
}
function card(title, sub, ...kids) { return h('section', { class: 'cfg-card' }, h('h2', {}, title), sub ? h('p', { class: 'sub' }, sub) : null, ...kids); }
function grid(...kids) { return h('div', { class: 'cfg-grid' }, ...kids); }
function more(summary, ...kids) { return h('details', { class: 'cfg-more' }, h('summary', {}, summary), ...kids); }

/* ---------------- models ---------------- */
const PROVIDERS = [['openai', 'OpenAI (API key)'], ['anthropic', 'Anthropic (API key)'], ['ollama', 'Ollama (local)'], ['lmstudio', 'LM Studio (local)'], ['sampling', 'The connected MCP client (sampling)'], ['none', 'No model (heuristics only)']];
const PROVIDER_URL = { openai: 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com/v1', ollama: 'http://localhost:11434', lmstudio: 'http://localhost:1234/v1', sampling: '', none: '' };
const LOCAL_MODELS = { ollama: ['qwen3:8b', 'qwen3:4b', 'qwen3:14b', 'qwen3:32b', 'llama3.1:8b', 'llama3.3:70b', 'mistral:7b', 'deepseek-r1:8b', 'deepseek-r1:32b', 'gemma3:12b', 'phi4:14b'] };
function modelChoices(provider) {
  const out = [], seen = new Set(), add = v => { if (v && !seen.has(v)) { seen.add(v); out.push(v); } };
  for (const m of Object.values(cat)) if (m.model_choices) { for (const c of m.model_choices) if (c.provider === provider) add(c.value); break; }
  for (const v of LOCAL_MODELS[provider] || []) add(v);
  return out.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
}
const ROLE_KEY = (role, suffix) => role === 'main' ? 'DREAMGRAPH_LLM_' + suffix : 'DREAMGRAPH_LLM_' + role.toUpperCase() + '_' + suffix;
function roleProvider(role) { return role === 'main' ? eff('DREAMGRAPH_LLM_PROVIDER') || 'ollama' : (cur(ROLE_KEY(role, 'PROVIDER')) || eff('DREAMGRAPH_LLM_PROVIDER') || 'ollama'); }
function modelPicker(role, title, help) {
  const key = ROLE_KEY(role, 'MODEL'), provider = roleProvider(role), choices = modelChoices(provider), c = cur(key);
  const sel = h('select', { id: 'f-' + key }), custom = h('input', { type: 'text', placeholder: 'Model name exactly as the provider calls it', value: c || '', spellcheck: 'false' });
  sel.append(h('option', { value: '' }, role === 'main' ? 'Provider default' : 'Same as main model'));
  for (const v of choices) sel.append(h('option', { value: v }, v));
  sel.append(h('option', { value: '__custom' }, 'Other…'));
  const known = c && choices.includes(c);
  sel.value = !c ? '' : known ? c : '__custom';
  custom.hidden = sel.value !== '__custom';
  sel.addEventListener('change', () => { custom.hidden = sel.value !== '__custom'; if (sel.value === '__custom') { custom.focus(); setDraft(key, custom.value.trim() || null); } else setDraft(key, sel.value || null); markDirty(key); });
  custom.addEventListener('input', () => { setDraft(key, custom.value.trim() || null); markDirty(key); });
  return field(key, title, help || (provider === 'lmstudio' ? 'Use the model id shown in LM Studio.' : null), h('div', { class: 'cfg-inline' }, sel, custom));
}
function effortPicker(role) {
  return pick(ROLE_KEY(role, 'REASONING_EFFORT'), 'Reasoning effort', 'For reasoning models only; others ignore it.', [['minimal', 'Minimal'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['xhigh', 'Extra high']]);
}
function roleStatus(roleNames) {
  const rows = roles.filter(r => roleNames.includes(r.role));
  if (!rows.length) return null;
  return h('div', { class: 'cfg-status' }, ...rows.map(r => h('div', {},
    h('b', {}, ROLE_TITLE[r.role] || r.role), ': ', r.effective.provider + ' · ' + r.effective.model + (r.effective.adapter && !/-api$/.test(r.effective.adapter) ? ' via ' + r.effective.adapter : ''),
    r.status && !['configured', 'ready', 'active'].includes(r.status) ? h('span', { class: 'warn' }, ' · ' + String(r.status).replace(/_/g, ' ')) : h('span', { class: 'tag ok', style: 'margin-left:6px' }, 'ready'),
    ...(r.diagnostics || []).slice(0, 2).map(d => h('div', { class: 'warn' }, '⚠ ' + (d.message || d.code))))));
}
const ROLE_TITLE = { initial_scan: 'Initial scan', enrichment: 'Enrichment', dreamer: 'Dreamer', normalizer: 'Normalizer', architect: 'Architect', computer_use: 'Computer Use' };
function providerFields(role) {
  const pkey = ROLE_KEY(role, 'PROVIDER'), ukey = ROLE_KEY(role, 'URL');
  const onProvider = value => {
    const urlNow = cur(ukey), defaults = Object.values(PROVIDER_URL);
    if (!urlNow || defaults.includes(urlNow)) setDraft(ukey, role === 'main' && value ? (PROVIDER_URL[value] || null) : null);
    render();
  };
  const prov = role === 'main'
    ? pick(pkey, 'Provider', 'Where models run. Local providers need no key.', PROVIDERS, { noDefault: !!cur(pkey), onchange: onProvider })
    : pick(pkey, 'Provider', 'Leave on "Same as main" unless this role should use another provider.', PROVIDERS.filter(p => p[0] !== 'none'), { onchange: onProvider });
  if (role !== 'main') prov.querySelector('option[value=""]').textContent = 'Same as main (' + (eff('DREAMGRAPH_LLM_PROVIDER') || 'ollama') + ')';
  const provider = roleProvider(role), needsKey = provider === 'openai' || provider === 'anthropic';
  return [prov,
    text(ukey, 'Server address', 'Only change this for proxies, Azure-style gateways or a non-default local port.', { placeholder: PROVIDER_URL[provider] || 'Not needed' }),
    needsKey || role === 'main' ? secret(ROLE_KEY(role, 'API_KEY'), 'API key', role === 'main' ? 'Stored in this instance\'s engine.env. Never shown again after saving.' : 'Only needed when this role uses a different account or provider.') : null];
}
function roleCard(role, title, sub, opts) {
  const tkey = ROLE_KEY(role, 'TEMPERATURE'), provider = roleProvider(role);
  const body = [
    grid(modelPicker(role, 'Model'),
      slider(tkey, 'Creativity', opts.tempHelp, { min: 0, max: 1.5, step: 0.05, left: 'precise', right: 'creative', fallback: opts.temp }),
      num(ROLE_KEY(role, 'MAX_TOKENS'), 'Longest answer', 'Maximum tokens the model may write per request.', { unit: 'tokens', min: 256, max: 200000, step: 256 }),
      provider === 'openai' ? effortPicker(role) : null),
  ];
  if (role !== 'main') body.push(more('Use a different provider or key for this role', grid(...providerFields(role))));
  if (opts.extra) body.push(opts.extra);
  body.push(roleStatus(opts.statusRoles || [role]));
  return card(title, sub, ...body);
}
function renderModels(p) {
  p.append(h('p', { class: 'cfg-intro' }, 'Pick a provider once, then choose a model for each job. The Architect has its own page because it can also drive Codex or Copilot CLI.'));
  p.append(card('Provider', 'Shared connection used by every model below unless a role overrides it.', grid(...providerFields('main'))));
  p.append(roleCard('main', 'Main model — scanning & enrichment', 'Reads your code to build and enrich the knowledge graph. A fast, inexpensive model works well.',
    { temp: 0.2, tempHelp: 'Keep low for factual extraction.', statusRoles: ['initial_scan', 'enrichment'],
      extra: more('Separate models for the initial scan and for enrichment', grid(modelPicker('initial_scan', 'Initial scan model'), modelPicker('enrichment', 'Enrichment model'))) }));
  p.append(roleCard('dreamer', 'Dreamer', 'Proposes new connections and hypotheses during dream cycles. Benefits from a capable, more creative model.', { temp: 0.7, tempHelp: 'Higher values explore more unusual ideas.' }));
  p.append(roleCard('normalizer', 'Normalizer', 'Checks dream proposals against evidence before they are accepted. Use a precise model.', { temp: 0.1, tempHelp: 'Keep low so validation stays consistent.' }));
  p.append(more('Request timeout and context size',
    grid(num('DREAMGRAPH_LLM_TIMEOUT_MS', 'Request timeout', 'How long one model request may take.', { unit: 'seconds', scale: 1000, min: 5, max: 3600 }),
      num('DREAMGRAPH_LLM_CONTEXT_TOKENS', 'Context window', 'Leave empty to use the model\'s normal limit.', { unit: 'tokens', min: 1024, step: 1024 }))));
}

/* ---------------- architect ---------------- */
function renderArchitect(p) {
  const adapter = eff('DREAMGRAPH_LLM_ARCHITECT_ADAPTER') || 'native_api_tool_loop', cli = adapter === 'codex-cli' || adapter === 'copilot-cli';
  p.append(h('p', { class: 'cfg-intro' }, 'Defaults for the Architect chat. The engine and model can also be switched per conversation in the Architect composer.'));
  const engine = pick('DREAMGRAPH_LLM_ARCHITECT_ADAPTER', 'Engine', 'Codex and Copilot CLI use your existing subscription login and their own tools. "API" uses the provider and key below.',
    [['codex-cli', 'Codex CLI'], ['copilot-cli', 'GitHub Copilot CLI'], ['native_api_tool_loop', 'API (provider + key)'], ['deterministic_fallback', 'Offline (no model)']], { onchange: () => render() });
  const modelKey = 'DREAMGRAPH_LLM_ARCHITECT_MODEL';
  const model = cli ? text(modelKey, 'Model', 'Leave empty to use the CLI\'s own default model.', { placeholder: adapter === 'codex-cli' ? 'e.g. gpt-6.1-sol' : 'CLI default' }) : modelPicker('architect', 'Model');
  p.append(card('Engine & model', null, grid(engine, model, adapter === 'codex-cli' || !cli ? effortPicker('architect') : null,
    num('DREAMGRAPH_ARCHITECT_PASS_TIMEOUT_MS', 'Time limit per task', 'How long one Architect task (all its tool calls together) may run before it is stopped.', { unit: 'minutes', scale: 60000, min: 1, max: 240 })),
    !cli ? more('Use a different provider or key for the Architect', grid(...providerFields('architect'))) : null,
    cli ? more('CLI program location', grid(
      text('DREAMGRAPH_ARCHITECT_CODEX_CLI_BINARY', 'Codex CLI', 'Full path, only if "codex" is not on PATH.', { placeholder: 'codex' }),
      text('DREAMGRAPH_ARCHITECT_COPILOT_CLI_BINARY', 'Copilot CLI', 'Full path, only if "copilot" is not on PATH.', { placeholder: 'copilot' }))) : null,
    roleStatus(['architect'])));
  p.append(card('Behaviour', null, grid(
    pick('DREAMGRAPH_ARCHITECT_AUTONOMY_MODE', 'Autonomy', 'How far the Architect continues on its own before handing back.', [['manual', 'Manual — one step, then ask'], ['supervised', 'Supervised — stop at checkpoints'], ['autonomous', 'Autonomous — continue until done']]),
    pick('DREAMGRAPH_ARCHITECT_VERBOSITY_MODE', 'Answer length', null, [['concise', 'Concise'], ['balanced', 'Balanced'], ['detailed', 'Detailed']]),
    onoff('DREAMGRAPH_ARCHITECT_TOKEN_ECONOMY', 'Token economy', 'Send a compact project context instead of everything. Recommended.'),
    num('DREAMGRAPH_ARCHITECT_TOKEN_ECONOMY_SOFT_TARGET', 'Context target', 'Approximate context size the token economy aims for.', { unit: 'tokens', min: 1024, step: 1024 }))));
}

/* ---------------- database ---------------- */
function renderDatabase(p) {
  const key = 'DATABASE_URL', status = h('div', { class: 'help', id: 'db-status' });
  const test = h('button', { type: 'button', onclick: async () => {
    test.disabled = true; status.textContent = 'Testing…';
    try { const r = await fetch('/config/test-db', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ connectionString: has(key) && D[key] ? D[key] : '' }) }).then(x => x.json());
      status.textContent = (r.ok ? '✓ Connected' : '✗ ' + (r.message || 'Connection failed')) + (r.latencyMs ? ' (' + r.latencyMs + ' ms)' : ''); status.style.color = r.ok ? 'var(--c-ok)' : 'var(--c-bad)'; }
    catch (e) { status.textContent = '✗ ' + e.message; status.style.color = 'var(--c-bad)'; } finally { test.disabled = false; } } }, 'Test connection');
  p.append(h('p', { class: 'cfg-intro' }, 'Optional. Connect the PostgreSQL database your project uses so DreamGraph can read its schema and include tables in the graph.'));
  p.append(card('PostgreSQL connection', 'Format: postgresql://user:password@host:5432/database. Testing uses the value you typed, or the saved one if the box is empty.',
    secret(key, 'Connection URL', null, { wide: true, placeholder: 'postgresql://user:password@localhost:5432/mydb' }), h('div', { class: 'cfg-inline', style: 'margin-top:8px' }, test, status),
    more('Connection limits', grid(
      num('DG_DB_MAX_CONNECTIONS', 'Maximum connections', null, { min: 1, max: 100, step: 1 }),
      num('DG_DB_STATEMENT_TIMEOUT', 'Query timeout', 'Longest a single query may run.', { unit: 'seconds', scale: 1000, min: 0.5, max: 600 }),
      num('DG_DB_OPERATION_TIMEOUT', 'Schema read timeout', 'Longest a whole schema read may run.', { unit: 'seconds', scale: 1000, min: 1, max: 3600 })))));
}

/* ---------------- repositories ---------------- */
const REPO_ROLES = { primary: 'Primary application', frontend: 'Frontend', backend: 'Backend / service', shared: 'Shared library', docs: 'Documentation', infra: 'Infrastructure', other: 'Other / secondary' };
async function loadRepos() { const r = await api('/api/architect/v1/repo-setup'); repos = r.repo_setup; if (!repoDirty) repoDraft = repos.repositories.map(x => ({ ...x })); }
function renderRepos(p) {
  p.append(h('p', { class: 'cfg-intro' }, 'Repositories the Architect and scanners may read. Mark one as primary; add related services, libraries or documentation as needed.'));
  const list = h('div', { class: 'cfg-repos' }), status = h('div', { class: 'help' });
  const body = card('Repositories', repos ? (repos.project_map ? 'Project map: ' + repos.project_map.status.replace(/_/g, ' ') + (repos.project_map.last_refreshed_at ? ' · refreshed ' + new Date(repos.project_map.last_refreshed_at).toLocaleString() : '') : null) : 'Loading…', list);
  p.append(body);
  if (!repos) { loadRepos().then(render).catch(e => { list.replaceChildren(h('div', { class: 'err' }, 'Could not read repositories: ' + e.message)); }); return; }
  const roleNames = repos.available_roles || Object.keys(REPO_ROLES);
  const draw = () => {
    list.replaceChildren(h('div', { class: 'cfg-repo-head' }, h('span', {}, 'Name'), h('span', {}, 'Folder'), h('span', {}, 'Role'), h('span', {})));
    if (!repoDraft.length) list.append(h('div', { class: 'help' }, 'No repositories yet. Add the project folder first.'));
    repoDraft.forEach((r, i) => {
      const name = h('input', { value: r.name, placeholder: 'name', spellcheck: 'false', 'aria-label': 'Repository name' });
      const path = h('input', { value: r.path, placeholder: 'C:\\path\\to\\repo or /path/to/repo', spellcheck: 'false', 'aria-label': 'Repository folder' });
      const role = h('select', { 'aria-label': 'Repository role' }, ...roleNames.map(v => h('option', { value: v }, REPO_ROLES[v] || v)));
      role.value = r.role;
      const x = h('button', { type: 'button', class: 'x', title: 'Remove ' + (r.name || 'repository'), 'aria-label': 'Remove repository', onclick: () => { repoDraft.splice(i, 1); repoDirty = true; draw(); refreshDirty(); } }, '✕');
      name.addEventListener('input', () => { r.name = name.value.trim(); repoDirty = true; refreshDirty(); });
      path.addEventListener('input', () => { r.path = path.value.trim(); if (!r.name && r.path) { r.name = r.path.split(/[\\/]/).filter(Boolean).pop() || ''; name.value = r.name; } repoDirty = true; refreshDirty(); });
      role.addEventListener('change', () => { r.role = role.value; if (r.role === 'primary') repoDraft.forEach((o, j) => { if (j !== i && o.role === 'primary') o.role = 'other'; }); repoDirty = true; draw(); refreshDirty(); });
      list.append(h('div', { class: 'cfg-repo' }, name, path, role, x));
    });
    list.append(h('div', { class: 'cfg-inline', style: 'margin-top:6px' },
      h('button', { type: 'button', onclick: () => { repoDraft.push({ name: '', path: '', role: repoDraft.length ? 'other' : 'primary' }); repoDirty = true; draw(); refreshDirty(); const inputs = list.querySelectorAll('.cfg-repo input'); if (inputs.length) inputs[inputs.length - 2].focus(); } }, '+ Add repository'),
      status));
  };
  draw();
  p.append(card('Database', 'The project database connection is on the Database page.', h('button', { type: 'button', onclick: () => selectTab('database') }, 'Open Database settings')));
}
async function saveRepos() {
  const clean = repoDraft.filter(r => r.name || r.path);
  const r = await api('/api/architect/v1/repo-setup', { repositories: clean });
  repos = r.repo_setup; repoDraft = repos.repositories.map(x => ({ ...x })); repoDirty = false;
}

/* ---------------- automation (scheduler, events, narrative) ---------------- */
const COMP_KEY = { scheduler: 'DREAMGRAPH_SCHEDULER', events: 'DREAMGRAPH_EVENTS', narrative: 'DREAMGRAPH_NARRATIVE' };
function compValue(comp) {
  const key = COMP_KEY[comp], c = cur(key);
  const base = Object.assign({}, comps[key] || {});
  if (c) { try { Object.assign(base, JSON.parse(c)); } catch (e) { /* invalid saved JSON: keep effective */ } }
  return base;
}
function setComp(comp, prop, value) {
  const key = COMP_KEY[comp], next = compValue(comp); next[prop] = value;
  setDraft(key, JSON.stringify(next));
  // Legacy per-field aliases in engine.env would shadow the object on restart.
  for (const [k, m] of Object.entries(cat)) if (m.alias_for && m.alias_for.key === key && saved(k) !== null) setDraft(k, null);
}
function compField(comp, prop, title, help, kind, opts) {
  opts = opts || {}; const v = compValue(comp)[prop], id = 'c-' + comp + '-' + prop, scale = opts.scale || 1;
  let control;
  if (kind === 'bool') {
    control = h('select', { id }, h('option', { value: 'true' }, 'On'), h('option', { value: 'false' }, 'Off')); control.value = String(v !== false);
    control.addEventListener('change', () => setComp(comp, prop, control.value === 'true'));
  } else {
    const input = h('input', { id, type: 'number', value: v === undefined ? '' : String(Math.round(v / scale * 1000) / 1000), min: opts.min, max: opts.max, step: opts.step || 'any' });
    input.addEventListener('input', () => { const n = Number(input.value); if (input.value !== '' && Number.isFinite(n)) setComp(comp, prop, opts.integer === false ? n * scale : Math.round(n * scale)); });
    control = h('div', { class: 'cfg-inline' }, input, opts.unit ? h('span', { class: 'cfg-unit' }, opts.unit) : null);
  }
  const key = COMP_KEY[comp];
  return h('div', { class: 'cfg-field', 'data-key': key + '.' + prop }, h('label', { for: id }, title), control, help ? h('div', { class: 'help' }, help) : null);
}
function renderAutomation(p) {
  p.append(h('p', { class: 'cfg-intro' }, 'Background thinking. Individual schedules (what runs and when) are managed on the Schedules page.'),
    h('p', {}, h('a', { href: '/schedules', style: 'color:var(--c-acc)' }, 'Manage schedules →')));
  p.append(card('Scheduler', null, grid(
    compField('scheduler', 'enabled', 'Run schedules automatically', 'Off pauses every schedule; you can still run one by hand.', 'bool'),
    compField('scheduler', 'max_runs_per_hour', 'Maximum runs per hour', 'Safety cap across all schedules.', 'num', { min: 0, step: 1 }),
    compField('scheduler', 'global_cooldown_ms', 'Pause between runs', null, 'num', { unit: 'seconds', scale: 1000, min: 0 }),
    compField('scheduler', 'nightmare_cooldown_ms', 'Pause between security scans', 'Minimum gap between adversarial (nightmare) cycles.', 'num', { unit: 'minutes', scale: 60000, min: 0 }),
    compField('scheduler', 'max_error_streak', 'Stop a schedule after', 'Consecutive failures before a schedule is paused.', 'num', { unit: 'failures', min: 1, step: 1 }),
    compField('scheduler', 'execution_timeout_ms', 'Time limit per run', null, 'num', { unit: 'minutes', scale: 60000, min: 1 }))));
  p.append(card('Automatic reactions', 'Dream automatically when the graph shows strain.', grid(
    compField('events', 'tension_threshold', 'React when tension reaches', '0 = always, 1 = never. Default 0.8.', 'num', { min: 0, max: 1, step: 0.05, integer: false }),
    compField('events', 'max_auto_cycles_per_hour', 'Maximum automatic cycles per hour', null, 'num', { min: 0, step: 1 }),
    compField('events', 'cooldown_ms', 'Pause between reactions', null, 'num', { unit: 'seconds', scale: 1000, min: 0 }))));
  p.append(card('Story', 'DreamGraph writes a running narrative of how your system evolves.', grid(
    compField('narrative', 'auto_narrate', 'Write chapters automatically', null, 'bool'),
    compField('narrative', 'narrative_interval', 'New chapter every', null, 'num', { unit: 'dream cycles', min: 1, step: 1 }),
    compField('narrative', 'max_chapters', 'Keep at most', null, 'num', { unit: 'chapters', min: 1, step: 1 }))));
}

/* ---------------- budgets ---------------- */
const BUDGET_ROLES = [['initial_scan', 'Initial scan'], ['enrichment', 'Enrichment'], ['dreamer', 'Dreamer'], ['normalizer', 'Normalizer'], ['architect', 'Architect']];
const PRICE_VERSION = 'dashboard';
function pricing() { try { const v = JSON.parse(cur('DREAMGRAPH_LLM_PRICING') || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
function setPrice(provider, model, field, value) {
  const list = pricing(); let row = list.find(r => r.provider === provider && r.model === model && r.version === PRICE_VERSION);
  if (!row) { row = { version: PRICE_VERSION, provider, model, currency: 'USD', source: 'DreamGraph dashboard (operator entered)', input_per_million: 0, output_per_million: 0, output_includes_reasoning: true, input_includes_images: true }; list.push(row); }
  row[field] = value;
  setDraft('DREAMGRAPH_LLM_PRICING', JSON.stringify(list));
  for (const [r] of BUDGET_ROLES) { const pr = roles.find(x => x.role === r); if (pr && pr.effective.provider === provider && pr.effective.model === model) { setDraft('DREAMGRAPH_LLM_' + r.toUpperCase() + '_PRICING_VERSION', PRICE_VERSION); if (!cur('DREAMGRAPH_LLM_' + r.toUpperCase() + '_BUDGET_CURRENCY')) setDraft('DREAMGRAPH_LLM_' + r.toUpperCase() + '_BUDGET_CURRENCY', 'USD'); } }
}
const BUDGET_FIELD = { MAX_CALLS: 'requests', MAX_INPUT_TOKENS: 'input_tokens', MAX_OUTPUT_TOKENS: 'output_tokens', CONCURRENCY: 'concurrency', RUN_BUDGET: 'run_amount', DAY_BUDGET: 'day_amount' };
/** Built-in budget the daemon resolved for this role (placeholder for empty cells). */
function roleBudgetDefault(key) {
  const m = key.match(/^DREAMGRAPH_LLM_([A-Z_]+?)_(MAX_CALLS|MAX_INPUT_TOKENS|MAX_OUTPUT_TOKENS|CONCURRENCY|RUN_BUDGET|DAY_BUDGET)$/);
  if (!m) return null; const r = roles.find(x => x.role === m[1].toLowerCase());
  const v = r && r.budget ? r.budget[BUDGET_FIELD[m[2]]] : undefined; return v === undefined || v === null ? null : String(v);
}
function cell(key, opts) {
  opts = opts || {}; const scale = opts.scale || 1, c = cur(key), d = dflt(key) !== null ? dflt(key) : roleBudgetDefault(key);
  const input = h('input', { type: 'number', min: 0, step: opts.step || 'any', value: c === null ? '' : String(Number(c) / scale), placeholder: d !== null ? String(Number(d) / scale) : 'default', 'aria-label': label(key), title: key });
  input.addEventListener('input', () => { const n = Number(input.value); if (input.value === '') setDraft(key, null); else if (Number.isFinite(n) && n >= 0) setDraft(key, String(opts.integer === false ? n * scale : Math.round(n * scale))); });
  return h('td', {}, input);
}
function renderBudgets(p) {
  p.append(h('p', { class: 'cfg-intro' }, 'Hard limits that keep background work bounded. Empty cells use the built-in defaults shown in grey.'));
  for (const r of reviews) {
    const resume = h('button', { type: 'button', class: 'cfg-primary', onclick: async () => { resume.disabled = true;
      try { reviews = (await api('/api/config/v1/billing-reviews/resume', { billing_key: r.billing_key })).result || []; say('Paid requests for ' + (r.provider || 'this provider') + ' resumed.', 'ok'); render(); }
      catch (e) { say('Could not resume: ' + e.message, 'error'); resume.disabled = false; } } }, 'Reviewed — resume');
    p.append(card('Paid requests paused' + (r.provider ? ' · ' + r.provider : ''), 'A request' + (r.model ? ' to ' + r.model : '') + ' used more than DreamGraph reserved for it (' + r.variance.map(v => v.replace(/_/g, ' ')).join(', ') + '). Paid requests on this account are paused until you check your limits and prices below.', resume));
  }
  const apiRoles = roles.filter(r => r.billing && r.billing.channel === 'api' && BUDGET_ROLES.some(b => b[0] === r.role));
  const tbl = h('table', { class: 'cfg-table' }, h('tr', {}, h('th', {}, 'Job'), h('th', {}, 'Requests per run'), h('th', {}, 'Input tokens per run'), h('th', {}, 'Output tokens per run'), h('th', {}, 'Parallel requests'), h('th', {}, 'Spend per run (USD)'), h('th', {}, 'Spend per day (USD)')));
  for (const [r, title] of BUDGET_ROLES) {
    const R = 'DREAMGRAPH_LLM_' + r.toUpperCase() + '_', pr = roles.find(x => x.role === r), paid = pr && pr.billing && pr.billing.channel === 'api';
    tbl.append(h('tr', {}, h('td', {}, title, h('div', { class: 'help' }, pr ? pr.effective.model + (paid ? '' : ' · ' + (pr.billing ? pr.billing.channel : 'local')) : '')),
      cell(R + 'MAX_CALLS', { step: 1 }), cell(R + 'MAX_INPUT_TOKENS', { step: 1000 }), cell(R + 'MAX_OUTPUT_TOKENS', { step: 1000 }), cell(R + 'CONCURRENCY', { step: 1 }),
      paid ? cell(R + 'RUN_BUDGET', { step: 0.01, integer: false }) : h('td', { class: 'help' }, 'not billed'), paid ? cell(R + 'DAY_BUDGET', { step: 0.01, integer: false }) : h('td', { class: 'help' }, 'not billed')));
  }
  p.append(card('Limits per job', 'Paid API jobs only run when both spend limits are above zero and the model has a price below.', h('div', { style: 'overflow-x:auto' }, tbl)));
  const models = []; for (const r of apiRoles) if (!models.some(m => m.provider === r.effective.provider && m.model === r.effective.model)) models.push({ provider: r.effective.provider, model: r.effective.model });
  if (models.length) {
    const pt = h('table', { class: 'cfg-table' }, h('tr', {}, h('th', {}, 'Model'), h('th', {}, 'Input price per 1M tokens (USD)'), h('th', {}, 'Output price per 1M tokens (USD)')));
    for (const m of models) {
      const row = pricing().find(x => x.provider === m.provider && x.model === m.model) || {};
      const mk = f => { const i = h('input', { type: 'number', min: 0, step: 0.01, value: row[f] !== undefined ? String(row[f]) : '', placeholder: 'e.g. 2.50', 'aria-label': m.model + ' ' + f }); i.addEventListener('input', () => { const n = Number(i.value); if (i.value !== '' && Number.isFinite(n) && n >= 0) setPrice(m.provider, m.model, f, n); }); return h('td', {}, i); };
      pt.append(h('tr', {}, h('td', {}, m.model, h('div', { class: 'help' }, m.provider)), mk('input_per_million'), mk('output_per_million')));
    }
    p.append(card('Prices of paid models', 'Copy these from your provider\'s pricing page. DreamGraph uses them to stop work before a spend limit would be exceeded.', h('div', { style: 'overflow-x:auto' }, pt)));
  }
  p.append(card('Graph retrieval', 'How much of the graph is gathered around each question.', grid(
    num('DREAMGRAPH_LLM_ARCHITECT_MAX_HOPS', 'Relationship depth (Architect)', 'How many steps away from the focus to follow.', { min: 0, max: 6, step: 1 }),
    num('DREAMGRAPH_LLM_ARCHITECT_MAX_NEIGHBORS', 'Neighbours per step (Architect)', null, { min: 1, max: 500, step: 1 }),
    num('DREAMGRAPH_SEMANTIC_CACHE_MIN_CONFIDENCE', 'Reuse cached understanding above', 'Confidence (0–1) needed to reuse an enriched summary instead of rereading source.', { min: 0, max: 1, step: 0.01, integer: false }))));
}

/* ---------------- computer use ---------------- */
function renderComputer(p) {
  const key = 'DREAMGRAPH_COMPUTER_USE_POLICY', c = eff(key) || 'ask'; PRETTY[key] = 'Computer Use';
  p.append(h('p', { class: 'cfg-intro' }, 'Computer Use lets the Architect operate this computer — open the browser, click, type and look at the screen — to complete a task. DreamGraph only listens on this machine, so this is your call.'));
  const opt = (v, t, d) => { const r = h('input', { type: 'radio', name: 'cu-policy', value: v }); r.checked = c === v; r.addEventListener('change', () => { setDraft(key, v); markDirty(key); }); return h('label', {}, r, h('div', {}, h('strong', {}, t), h('span', {}, d))); };
  p.append(card('Allow the Architect to use this computer?', null, h('div', { class: 'cfg-field', 'data-key': key, 'data-dirty': String(has(key)) }, h('div', { class: 'cfg-choice', role: 'radiogroup', 'aria-label': 'Computer Use policy' },
    opt('allow', 'Allow', 'Use it whenever a task needs it.'),
    opt('ask', 'Ask every time', 'When the Architect needs the computer it asks you first, then continues if you allow it. You can also pre-approve the next message.'),
    opt('deny', 'Deny', 'Never operate this computer.'))),
    h('div', { class: 'cfg-status' }, 'Codex CLI uses its own built-in Computer Use. The API engine uses DreamGraph\'s browser harness, which is prepared per task from the Architect\'s Harness button.')));
  p.append(more('Time limit for tasks', grid(num('DREAMGRAPH_ARCHITECT_PASS_TIMEOUT_MS', 'Time limit per task', 'Tasks that use the computer usually need longer. Shared with the Architect page.', { unit: 'minutes', scale: 60000, min: 1, max: 240 }))));
}

/* ---------------- advanced ---------------- */
function renderAdvanced(p) {
  p.append(h('p', { class: 'cfg-intro' }, 'Fine-tuning. The defaults suit most projects.'));
  p.append(card('Common', null, grid(
    onoff('DREAMGRAPH_DEBUG', 'Debug logging', 'Writes much more detail to the instance log.'),
    num('DREAMGRAPH_GRAPH_STALE_HOURS', 'Suggest a rescan after', 'Only a hint; an old scan is not treated as wrong.', { unit: 'hours', min: 1, step: 1 }),
    num('DREAMGRAPH_ENRICHMENT_STALE_HOURS', 'Suggest re-enrichment after', null, { unit: 'hours', min: 1, step: 1 }),
    num('DREAMGRAPH_MAJOR_REPOSITORY_CHANGE_FILES', 'Large change threshold', 'Changed files that count as a major repository change.', { unit: 'files', min: 1, step: 1 }),
    num('DREAMGRAPH_ENRICHMENT_BATCH_SIZE', 'Enrichment batch size', 'Graph nodes enriched per model request.', { min: 1, step: 1 }),
    num('DG_PROMOTION_CONFIDENCE', 'Accept dreams above', 'Combined confidence (0–1) needed to promote a dream into the validated graph.', { min: 0, max: 1, step: 0.01, integer: false }),
    num('DG_NORMALIZER_LLM_THRESHOLD', 'Ask the normalizer above', 'Dreams below this confidence are rejected without a model call.', { min: 0, max: 1, step: 0.01, integer: false }),
    num('DG_LLM_BUDGET', 'Share of model-driven dreaming', 'Fraction (0–1) of each dream cycle that uses the model rather than heuristics.', { min: 0, max: 1, step: 0.05, integer: false }),
    num('DG_DECAY_TTL', 'Forget unconfirmed dreams after', null, { unit: 'cycles', min: 1, step: 1 }),
    num('DG_MAX_ACTIVE_TENSIONS', 'Maximum open tensions', null, { min: 1, step: 1 }),
    onoff('DREAMGRAPH_AUTO_APPLY_RESOLUTION_PLANS', 'Apply fix plans automatically', 'When off, proposed resolution plans wait for your review.'),
    onoff('DG_ALLOW_INPROCESS_PLUGINS', 'Allow in-process plugins', 'Trusted plugins then run with full DreamGraph permissions.'))));
  const groups = {}; for (const m of Object.values(cat)) { if (m.apply === 'read_only' || m.secret) continue; (groups[m.category] = groups[m.category] || []).push(m); }
  const tabs = { models: 'Models & roles', scanning: 'Scan & enrichment', cognition: 'Cognition & truth', scheduling: 'Schedules & events', retrieval: 'Retrieval & budgets', integrations: 'Repositories & connections', computer: 'Computer Use', advanced: 'Other' };
  const filter = h('input', { type: 'search', placeholder: 'Filter by name or variable…' }), box = h('div', {});
  const drawRaw = () => {
    const q = filter.value.toLowerCase(); box.replaceChildren();
    for (const [g, title] of Object.entries(tabs)) {
      const rows = (groups[g] || []).filter(m => !q || m.key.toLowerCase().includes(q) || label(m.key).toLowerCase().includes(q) || (m.description || '').toLowerCase().includes(q));
      if (!rows.length) continue;
      const gridEl = h('div', { class: 'cfg-raw' });
      for (const m of rows) {
        const input = h('input', { value: cur(m.key) || '', placeholder: dflt(m.key) !== null ? String(dflt(m.key)) : 'default', spellcheck: 'false', 'aria-label': m.key });
        input.addEventListener('input', () => setDraft(m.key, input.value.trim() === '' ? null : input.value.trim()));
        gridEl.append(h('div', {}, h('div', { class: 'n' }, label(m.key)), h('div', { class: 'k' }, m.key)), input,
          h('div', { class: 'src', title: m.description || '' }, (m.unit && m.unit !== 'value' ? m.unit + ' · ' : '') + (m.apply === 'restart' ? 'restart' : m.apply === 'live' ? 'live' : 'next task')));
      }
      box.append(h('h3', { style: 'margin:14px 0 6px;font-size:12.5px' }, title + ' (' + rows.length + ')'), gridEl);
    }
  };
  filter.addEventListener('input', drawRaw); drawRaw();
  p.append(more('All engine.env settings (expert)', h('p', { class: 'help' }, 'Every setting DreamGraph understands, by variable name. Empty means default. Secrets are only editable on their own pages.'), filter, box));
}

/* ---------------- tabs, rendering, saving ---------------- */
const RENDER = { models: renderModels, architect: renderArchitect, database: renderDatabase, repos: renderRepos, automation: renderAutomation, budgets: renderBudgets, computer: renderComputer, advanced: renderAdvanced };
function selectTab(next) {
  if (!RENDER[next]) next = 'models'; tab = next;
  try { sessionStorage.setItem('dg-config-tab', tab); } catch (e) { /* no storage */ }
  for (const b of root.querySelectorAll('#cw-tabs [role=tab]')) { const on = b.dataset.tab === tab; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; }
  $('cw-panel').setAttribute('aria-labelledby', 'cw-tab-' + tab); render(); $('cw-scroll').scrollTop = 0;
}
function render() {
  const p = $('cw-panel'); p.replaceChildren();
  if (!snap) { p.append(h('p', { class: 'cfg-intro' }, 'Loading…')); return; }
  try { RENDER[tab](p); } catch (e) { p.append(h('div', { class: 'cfg-message is-error' }, 'This section could not be shown: ' + e.message)); }
  refreshDirty();
}
function refreshDirty() {
  const n = Object.keys(D).length + (repoDirty ? 1 : 0), bad = Object.keys(errs).length;
  const span = $('cw-draft-count');
  span.textContent = bad ? 'Fix ' + bad + ' invalid value' + (bad > 1 ? 's' : '') + ' before saving' : n ? n + ' unsaved change' + (n > 1 ? 's' : '') : 'No unsaved changes';
  span.className = n || bad ? 'dirty' : '';
  $('cw-save').disabled = busy || !n || !!bad; $('cw-discard').disabled = busy || !n; $('cw-undo').disabled = busy || !lastOperation || !!n;
  $('cw-refresh').disabled = busy;
}
async function load(keepDrafts) {
  busy = true; refreshDirty();
  try {
    const [state, catalogue, roleState] = await Promise.all([api('/api/config/v1'), cat && Object.keys(cat).length ? null : api('/api/config/v1/catalogue'), api('/api/config/v1/roles').catch(() => null)]);
    const r = state.result; snap = { revision: r.revision, settings: {}, diagnostics: r.diagnostics || [] };
    for (const s of r.settings) snap.settings[s.key] = s;
    comps = r.effective_components || {};
    if (catalogue) { cat = {}; for (const m of catalogue.result) cat[m.key] = m; }
    if (roleState) roles = roleState.result || [];
    try { reviews = (await api('/api/config/v1/billing-reviews')).result || []; } catch (e) { reviews = []; }
    if (!keepDrafts) { for (const k of Object.keys(D)) delete D[k]; for (const k of Object.keys(errs)) delete errs[k]; }
    const inFile = Object.values(snap.settings).filter(s => s.source === 'instance').length, deployedCount = Object.values(snap.settings).filter(s => s.source === 'deployment').length;
    $('cfg-source').textContent = 'engine.env · ' + inFile + ' value' + (inFile === 1 ? '' : 's') + ' set' + (deployedCount ? ' · ' + deployedCount + ' set by the launch environment' : '') + ' · read ' + new Date().toLocaleTimeString();
    $('cw-revision').value = snap.revision; root.dataset.loading = 'false';
    const sync = r.engine_env_sync;
    if (sync && sync.error) say('engine.env was edited but could not be applied: ' + humanError(sync.error), 'error');
    else if (sync && sync.restart_required && sync.restart_required.length) say('engine.env changes are saved, but these only take effect after restarting DreamGraph: ' + sync.restart_required.map(label).join(', ') + ' (' + $('cw-restart-command').value + ').');
    else if (!keepDrafts && sync && sync.changed && sync.changed.length && Date.now() - Date.parse(sync.at) < 15000) say('Picked up ' + sync.changed.length + ' change' + (sync.changed.length > 1 ? 's' : '') + ' made to engine.env outside this page and applied them.', 'ok');
    if (snap.diagnostics.length) say('engine.env has problems: ' + snap.diagnostics.slice(0, 3).map(humanError).join(' · '), 'error');
  } catch (e) { say('Could not read the configuration: ' + e.message, 'error'); }
  finally { busy = false; render(); }
}
async function save() {
  if (busy) return; busy = true; refreshDirty(); say('Saving…');
  const updates = Object.assign({}, D), parts = [];
  try {
    if (repoDirty) { await saveRepos(); parts.push('repositories'); }
    if (Object.keys(updates).length) {
      const operation = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
      const result = await api('/api/config/v1/apply', { expected_revision: snap.revision, operation_id: operation, updates });
      lastOperation = result.receipt && result.receipt.operation_id || operation;
      for (const k of Object.keys(D)) delete D[k];
      const restart = result.receipt && result.receipt.restart_required || [];
      parts.push(Object.keys(updates).length + ' setting' + (Object.keys(updates).length > 1 ? 's' : ''));
      await load(false);
      say('Saved ' + parts.join(' and ') + '. ' + (restart.length ? 'Restart DreamGraph to apply: ' + restart.map(label).join(', ') + ' (' + $('cw-restart-command').value + ').' : 'Changes apply to new work right away.'), restart.length ? undefined : 'ok');
    } else { await load(true); say('Saved ' + parts.join(' and ') + '.', 'ok'); }
  } catch (e) {
    for (const f of e.fields || []) { const k = f.field.split('.').pop(); if (k) errs[k] = f.message; }
    say('Not saved: ' + e.message, 'error'); busy = false; render(); return;
  }
  busy = false; refreshDirty();
}
async function undo() {
  if (!lastOperation || busy) return; busy = true; refreshDirty();
  try { await api('/api/config/v1/undo', { expected_revision: snap.revision, operation_id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), undo_operation_id: lastOperation });
    lastOperation = null; busy = false; await load(false); say('Your last save was undone. Restart DreamGraph if it changed restart-only settings.', 'ok'); }
  catch (e) { busy = false; say('Undo failed: ' + e.message, 'error'); refreshDirty(); }
}
$('cw-save').addEventListener('click', save);
$('cw-undo').addEventListener('click', undo);
$('cw-discard').addEventListener('click', () => { for (const k of Object.keys(D)) delete D[k]; for (const k of Object.keys(errs)) delete errs[k]; repoDirty = false; if (repos) repoDraft = repos.repositories.map(x => ({ ...x })); say('Edits discarded.'); render(); });
$('cw-refresh').addEventListener('click', () => { if (Object.keys(D).length && !confirm('Reload engine.env and discard your unsaved edits?')) return; repos = null; repoDirty = false; load(false).then(() => say('Reloaded from engine.env.', 'ok')); });
$('cw-tabs').addEventListener('click', e => { const b = e.target.closest('[role=tab]'); if (b) selectTab(b.dataset.tab); });
$('cw-tabs').addEventListener('keydown', e => { const t = Array.from(root.querySelectorAll('#cw-tabs [role=tab]')), i = t.findIndex(b => b.dataset.tab === tab);
  const j = e.key === 'ArrowRight' ? (i + 1) % t.length : e.key === 'ArrowLeft' ? (i - 1 + t.length) % t.length : e.key === 'Home' ? 0 : e.key === 'End' ? t.length - 1 : -1;
  if (j >= 0) { e.preventDefault(); selectTab(t[j].dataset.tab); t[j].focus(); } });
window.addEventListener('beforeunload', e => { if (Object.keys(D).length || repoDirty) { e.preventDefault(); e.returnValue = ''; } });
/* Read engine.env every time the page (or the Architect tab showing it) becomes visible again. */
document.addEventListener('visibilitychange', () => { if (!document.hidden && !busy && !Object.keys(D).length && !repoDirty) load(false); });
selectTab(tab);
load(false);
})();`;
