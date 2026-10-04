/**
 * Schedules workspace (v14.0.1).
 *
 * Compact, readable list with one-click Run now (▶), Pause/Resume and Remove (✕),
 * plus an editor whose fields follow the chosen action/strategy and timing method.
 * The daemon scheduler stays authoritative: definitions, validation, previews,
 * policy digests and admission all go through /api/schedules/v2.
 */
export function renderScheduleWorkspace(): string {
  return `<section id="schedule-workspace" class="sch" aria-label="Schedules" data-loading="true">
  <header class="sch-head">
    <div><h1>Schedules</h1><p id="sw-runtime">Connecting…</p></div>
    <div class="sch-head-actions"><a href="/config?tab=automation">Scheduler settings →</a><button id="sw-refresh" type="button">Refresh</button><button id="sw-new" type="button" class="sch-primary">+ New schedule</button></div>
  </header>
  <div id="sw-status" class="sch-message" role="status" aria-live="polite"></div>
  <div class="sch-scroll">
    <section id="sw-editor-host" hidden></section>
    <section aria-labelledby="sw-list-title"><h2 id="sw-list-title" class="sch-h2">Your schedules <span id="sw-count"></span></h2><div id="sw-list" class="sch-list"></div></section>
    <section aria-labelledby="sw-runs-title"><h2 id="sw-runs-title" class="sch-h2">Recent runs</h2><div id="sw-runs"></div></section>
  </div>
</section>
<style>${SCHEDULE_WORKSPACE_CSS}</style><script src="/schedules/workspace.js" defer></script>`;
}

export const SCHEDULE_WORKSPACE_CSS = String.raw`
#schedule-workspace{--s-line:#363b42;--s-dim:#9aa4b1;--s-card:#1a1d21;--s-card2:#20242a;--s-acc:#7fb0e0;--s-ok:#86c79a;--s-warn:#e2c07a;--s-bad:#e59a9a;
  display:flex;flex-direction:column;min-height:0;height:100%;color:#dde3ea;font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
#schedule-workspace [hidden]{display:none!important}
.sch-head{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex:none;padding-bottom:8px;border-bottom:1px solid var(--s-line)}
.sch-head h1{margin:0;font-size:19px}.sch-head p{margin:2px 0 0;color:var(--s-dim);font-size:12px}
.sch-head-actions{display:flex;gap:8px;align-items:center}.sch-head-actions a{color:var(--s-acc);text-decoration:none;margin-right:4px}
.sch-message{flex:none;font-size:12px}.sch-message:not(:empty){margin-top:6px;padding:6px 9px;border-radius:4px;background:#1f2a35;border:1px solid #2f4a63}
.sch-message.is-error{background:#35201f;border-color:#6b3434;color:#f1c3c3}.sch-message.is-ok{background:#1d2d22;border-color:#355c41}
.sch-scroll{flex:1;min-height:0;overflow:auto;padding:10px 2px 16px}
.sch-h2{font-size:13px;margin:14px 0 8px;color:#cfd7e0}.sch-h2 span{color:var(--s-dim);font-weight:400}
#schedule-workspace button{font:inherit;color:#e3e8ee;background:#262b31;border:1px solid #434b55;border-radius:4px;padding:5px 11px;cursor:pointer}
#schedule-workspace button:hover:not(:disabled){background:#2f353d}#schedule-workspace button:disabled{opacity:.45;cursor:default}
#schedule-workspace .sch-primary{background:#2e5b86;border-color:#4f86ba;color:#fff;font-weight:600}
#schedule-workspace input,#schedule-workspace select,#schedule-workspace textarea{font:inherit;color:#e7ecf2;background:#111418;border:1px solid #3a414a;border-radius:4px;padding:6px 8px;box-sizing:border-box;min-width:0;width:100%}
#schedule-workspace input[type=checkbox],#schedule-workspace input[type=radio]{width:auto;padding:0;accent-color:var(--s-acc)}
#schedule-workspace :focus-visible{outline:2px solid #4b77a3;outline-offset:1px}
.sch-list{display:flex;flex-direction:column;gap:6px}
.sch-row{display:grid;grid-template-columns:44px minmax(0,1.6fr) minmax(0,1.3fr) minmax(0,1fr) auto;gap:12px;align-items:center;padding:9px 12px;background:var(--s-card);border:1px solid var(--s-line);border-radius:7px}
.sch-row.is-off{opacity:.72}.sch-row.has-problem{border-left:3px solid var(--s-warn)}
.sch-name{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sch-what{color:var(--s-dim);font-size:12px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:2px}
.sch-when{font-size:12.5px}.sch-when small,.sch-last small{display:block;color:var(--s-dim);font-size:11.5px}
.sch-last{font-size:12px}
.chip{display:inline-block;font-size:11px;padding:1px 7px;border-radius:9px;border:1px solid var(--s-line);color:#cdd5de;white-space:nowrap}
.chip.ok{color:var(--s-ok);border-color:#3c6b4b}.chip.warn{color:var(--s-warn);border-color:#6d5a30}.chip.bad{color:var(--s-bad);border-color:#6b3a3a}.chip.acc{color:var(--s-acc);border-color:#3d5c7d}
.sch-actions{display:flex;gap:4px}
#schedule-workspace .sch-icon{width:32px;height:30px;padding:0;display:inline-flex;align-items:center;justify-content:center;font-size:14px}
#schedule-workspace .sch-icon.play{color:#9fe0b8;border-color:#3c6b4b}#schedule-workspace .sch-icon.del{color:#f0b4b4;border-color:#6b3a3a}
.sch-switch{position:relative;width:38px;height:22px;display:inline-block}.sch-switch input{opacity:0;width:0;height:0;position:absolute}
.sch-switch span{position:absolute;inset:0;background:#3a414a;border-radius:11px;transition:.15s;cursor:pointer}
.sch-switch span::before{content:"";position:absolute;width:16px;height:16px;left:3px;top:3px;background:#dfe5ec;border-radius:50%;transition:.15s}
.sch-switch input:checked+span{background:#2f7a52}.sch-switch input:checked+span::before{transform:translateX(16px)}
.sch-switch input:focus-visible+span{outline:2px solid #4b77a3;outline-offset:2px}
.sch-problem{grid-column:2/-1;font-size:11.5px;color:var(--s-warn);margin-top:-4px}
.sch-confirm{grid-column:1/-1;display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 10px;border-radius:5px;background:var(--s-card2);border:1px solid var(--s-line);font-size:12.5px}
.sch-confirm .grow{flex:1;min-width:200px}
.sch-empty{padding:18px;text-align:center;color:var(--s-dim);border:1px dashed var(--s-line);border-radius:7px}
.sch-editor{background:var(--s-card);border:1px solid #3d5c7d;border-radius:8px;padding:14px 16px;margin-bottom:6px}
.sch-editor h2{margin:0 0 10px;font-size:15px}
.sch-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px 16px}
.sch-field{display:flex;flex-direction:column;gap:4px;min-width:0}.sch-field.wide{grid-column:1/-1}
.sch-field>label,.sch-field>.lbl{font-weight:600;font-size:12px}.sch-field .help{color:var(--s-dim);font-size:11.5px}
.sch-field .err{color:var(--s-bad);font-size:11.5px}
.sch-seg{display:flex;flex-wrap:wrap;gap:6px}.sch-seg label{display:flex;gap:7px;align-items:center;padding:7px 11px;border:1px solid var(--s-line);border-radius:6px;background:var(--s-card2);cursor:pointer;font-weight:400}
.sch-seg label:has(input:checked){border-color:#4f86ba;background:#1d2b39}
.sch-inline{display:flex;gap:6px;align-items:center}.sch-inline>*{flex:1}.sch-inline>.fix{flex:none}
.sch-sub{margin:14px 0 6px;font-size:12.5px;color:#cfd7e0;border-top:1px solid var(--s-line);padding-top:10px}
.sch-preview{margin-top:12px;padding:9px 11px;background:#15191d;border:1px solid var(--s-line);border-radius:6px;font-size:12.5px}
.sch-preview ol{margin:4px 0 0;padding-left:20px}.sch-preview .note{color:var(--s-dim);font-size:11.5px;margin-top:4px}
.sch-editor-actions{display:flex;gap:8px;justify-content:flex-end;align-items:center;margin-top:12px;flex-wrap:wrap}
.sch-editor-actions label{margin-right:auto;display:flex;gap:6px;align-items:center}
details.sch-more{margin-top:10px}details.sch-more>summary{cursor:pointer;color:var(--s-acc);font-size:12px}details.sch-more>.sch-grid{margin-top:10px}
.sch-runs{width:100%;border-collapse:collapse;font-size:12.5px}.sch-runs th{text-align:left;color:var(--s-dim);font-weight:600;font-size:11.5px;padding:4px 8px;border-bottom:1px solid var(--s-line)}
.sch-runs td{padding:6px 8px;border-bottom:1px solid #2a2f35;vertical-align:top}.sch-runs td.sum{color:#c4ccd5;max-width:420px}
@media(max-width:820px){.sch-row{grid-template-columns:44px minmax(0,1fr) auto}.sch-when,.sch-last{grid-column:2/3}.sch-actions{grid-column:3;grid-row:1/span 3;flex-direction:column}.sch-head{flex-wrap:wrap}}
`;
/** Kept for compatibility with older imports. */
export const SCHEDULE_WORKSPACE_LAYOUT_CSS = "";

/** Served as /schedules/workspace.js. No backticks or template placeholders inside. */
export const SCHEDULE_WORKSPACE_SCRIPT = String.raw`(() => {
'use strict';
const root = document.getElementById('schedule-workspace'); if (!root) return;
const $ = id => document.getElementById(id);
let snap = null, descriptors = {}, busy = false, nextRuns = {}, editor = null, confirmFor = null, previewTimer = 0, previewSeq = 0;

/* ---------- vocabulary ---------- */
const ACTIONS = {
  dream_cycle: ['Dream cycle', 'Look for new connections and hypotheses in the graph.'],
  nightmare_cycle: ['Security scan (nightmare)', 'Probe the graph for security weaknesses.'],
  metacognitive_analysis: ['Self-review', 'Review how well recent dreaming worked and tune strategies.'],
  dispatch_cognitive_event: ['Cognitive event', 'Inject an event (e.g. from CI) that DreamGraph reacts to.'],
  narrative_chapter: ['Story chapter', 'Write the next chapter of the system story from recent changes.'],
  federation_export: ['Export dream archetypes', 'Write shareable dream patterns to a file.'],
  graph_maintenance: ['Graph maintenance', 'Decay stale dreams and tensions.'],
};
const STRATEGY = { all: 'All strategies (adaptive)', gap_detection: 'Gap detection', weak_reinforcement: 'Strengthen weak links', cross_domain: 'Cross-domain links',
  missing_abstraction: 'Missing abstractions', symmetry_completion: 'Symmetry completion', tension_directed: 'Follow open tensions', causal_replay: 'Causal replay',
  pgo_wave: 'PGO wave (random walk)', llm_dream: 'Model-driven dreaming', orphan_bridging: 'Connect orphans', schema_grounding: 'Schema grounding',
  all_threats: 'All threat types', privilege_escalation: 'Privilege escalation', data_leak_path: 'Data leak paths', injection_surface: 'Injection surfaces',
  missing_validation: 'Missing validation', broken_access_control: 'Broken access control' };
const FIELD = {
  strategy: ['Strategy', null], max_dreams: ['Dreams per run', 'Upper bound on proposals in one cycle.'], focus_entities: ['Focus on', 'Optional. Comma-separated graph entity ids to concentrate on.'],
  focus_hops: ['Focus radius', 'How many relationship steps around the focus to include.'], focus_reason: ['Why this focus', null],
  window_size: ['Look back over', 'Number of recent cycles to review.'], auto_apply: ['Apply recommendations automatically', null],
  source: ['Event source', null], severity: ['Severity', null], description: ['Description', null], affected_entities: ['Affected entities', 'Comma-separated ids.'],
  payload: ['Extra data (JSON)', 'Optional key/value data passed with the event.'], export_path: ['Export file', 'Blank = the instance default file.'] };
const RETIRED = { strategy: ['reflective'] };
const DIAG = { paused: 'Paused', archived: 'Removed', max_runs: 'Reached its run limit', error_streak: 'Stopped after repeated failures — fix and resume', rate_limit: 'Waiting: hourly run limit reached',
  global_cooldown: 'Waiting: cooldown between runs', nightmare_cooldown: 'Waiting: security-scan cooldown' };
const UNITS = [['60000', 'minutes'], ['3600000', 'hours'], ['86400000', 'days']];
const ZONES = (() => { try { return Intl.supportedValuesOf('timeZone'); } catch (e) { return ['UTC', 'Europe/Helsinki', 'Europe/London', 'America/New_York', 'Asia/Tokyo']; } })();
const LOCAL_ZONE = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { return 'UTC'; } })();
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/* ---------- helpers ---------- */
function h(tag, attrs, ...kids) { const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) { if (v === undefined || v === null || v === false) continue; if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : String(v)); }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) n.append(kid.nodeType ? kid : document.createTextNode(String(kid))); return n; }
const say = (text, kind) => { const m = $('sw-status'); m.textContent = text || ''; m.className = 'sch-message' + (kind ? ' is-' + kind : ''); };
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
async function api(path, body) {
  const r = await fetch(path, { method: body ? 'POST' : 'GET', cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  let v = {}; try { v = await r.json(); } catch (e) { /* empty */ }
  if (!r.ok || v.ok === false) { const e = new Error(humanError(v.error || ('HTTP ' + r.status), v.fields)); e.fields = v.fields || []; throw e; }
  return v;
}
function humanError(code, fields) {
  code = String(code || '');
  if (/REVISION_CONFLICT/.test(code)) return 'This schedule was changed elsewhere. Refresh and try again.';
  if (/POLICY_PREVIEW_CONFLICT/.test(code)) return 'Model settings changed while you were reviewing. Try again.';
  if (/SCHEDULE_NOT_CLAIMED/.test(code)) return 'The scheduler did not start it (limit, cooldown or invalid definition).';
  if (/RETIRED_STRATEGY/.test(code)) return 'That strategy has been retired. Choose another.';
  if (fields && fields.length) return fields.map(f => (FIELD[String(f.field).split('.').pop()] || [String(f.field)])[0] + ': ' + f.message).join(' · ');
  if (/invalid_definition/.test(code)) return 'The definition is not valid.';
  return code.replace(/_/g, ' ').toLowerCase().replace(/^./, c => c.toUpperCase());
}
function dur(ms) { if (!Number.isFinite(ms)) return ''; const m = Math.round(ms / 60000);
  if (ms < 60000) return Math.round(ms / 1000) + ' s'; if (m < 60) return m + ' min'; const hrs = ms / 3600000; if (hrs < 48) return (Math.round(hrs * 10) / 10) + ' h'; return (Math.round(hrs / 24 * 10) / 10) + ' days'; }
function when(iso) { if (!iso) return ''; const t = Date.parse(iso); if (!Number.isFinite(t)) return ''; const d = t - Date.now(), a = Math.abs(d);
  const rel = a < 60000 ? 'now' : a < 3600000 ? Math.round(a / 60000) + ' min' : a < 86400000 ? Math.round(a / 3600000) + ' h' : Math.round(a / 86400000) + ' d';
  return rel === 'now' ? 'just now' : d > 0 ? 'in ' + rel : rel + ' ago'; }
function stamp(iso, zone) { try { return new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', ...(zone ? { timeZone: zone } : {}) }); } catch (e) { return new Date(iso).toLocaleString(); } }
function cronText(cron) {
  const p = String(cron || '').trim().split(/\s+/); if (p.length !== 5) return 'Cron ' + cron;
  const [mi, hr, dom, mon, dow] = p, at = /^\d+$/.test(mi) && /^\d+$/.test(hr) ? String(hr).padStart(2, '0') + ':' + String(mi).padStart(2, '0') : null;
  if (/^\d+$/.test(mi) && hr === '*' && dom === '*' && mon === '*' && dow === '*') return 'Every hour at :' + String(mi).padStart(2, '0');
  if (at && dom === '*' && mon === '*' && dow === '*') return 'Daily at ' + at;
  if (at && dom === '*' && mon === '*' && dow === '1-5') return 'Weekdays at ' + at;
  if (at && dom === '*' && mon === '*' && /^\d$/.test(dow)) return DAYS[Number(dow) % 7] + 's at ' + at;
  if (at && /^\d+$/.test(dom) && mon === '*' && dow === '*') return 'Monthly on day ' + dom + ' at ' + at;
  if (/^\*\/\d+$/.test(mi) && hr === '*') return 'Every ' + mi.slice(2) + ' minutes';
  if (mi === '0' && /^\*\/\d+$/.test(hr)) return 'Every ' + hr.slice(2) + ' hours';
  return 'Cron ' + cron;
}
function triggerText(s) {
  if (s.trigger_type === 'interval') return 'Every ' + dur(s.interval_ms);
  if (s.trigger_type === 'cron_like') return cronText(s.cron) + (s.timezone && s.timezone !== LOCAL_ZONE ? ' (' + s.timezone + ')' : '');
  if (s.trigger_type === 'after_cycles') return 'Every ' + s.cycle_interval + ' dream cycle' + (s.cycle_interval === 1 ? '' : 's');
  if (s.trigger_type === 'on_idle') return 'After ' + dur(s.idle_ms) + ' without activity';
  return s.trigger_type;
}
function detailText(s) {
  const p = s.parameters || {}, out = [];
  if (p.strategy) out.push(STRATEGY[p.strategy] || p.strategy);
  if (s.action === 'dream_cycle' && p.max_dreams !== undefined) out.push(p.max_dreams + ' dreams');
  if (Array.isArray(p.focus_entities) && p.focus_entities.length) out.push('focus: ' + p.focus_entities.slice(0, 3).join(', ') + (p.focus_entities.length > 3 ? '…' : ''));
  if (s.action === 'metacognitive_analysis') { out.push('last ' + (p.window_size || 50) + ' cycles'); if (p.auto_apply) out.push('auto-apply'); }
  if (s.action === 'dispatch_cognitive_event') out.push((p.severity || 'info') + ' from ' + String(p.source || 'manual').replace(/_/g, ' '));
  return out;
}
function problem(s) {
  const d = (s.diagnostics || []).filter(x => x !== 'paused');
  if (!d.length) return s.last_error ? 'Last run failed: ' + s.last_error : null;
  const r = d[0]; if (r.startsWith('invalid_definition')) return 'The saved definition is no longer valid — edit it to choose supported values.';
  return DIAG[r] || r.replace(/_/g, ' ');
}

/* ---------- loading ---------- */
async function load() {
  try {
    const [v, actions] = await Promise.all([api('/api/schedules/v2?workspace=1'), Object.keys(descriptors).length ? null : api('/api/schedules/v2/actions')]);
    snap = v; if (actions) for (const d of actions.actions) descriptors[d.action] = d.fields; else if (v.action_descriptors) for (const d of v.action_descriptors) descriptors[d.action] = d.fields;
    const c = v.config || {};
    $('sw-runtime').textContent = (c.enabled ? 'Scheduler running' : 'Scheduler paused — no schedule runs automatically') + ' · at most ' + c.max_runs_per_hour + ' runs per hour';
    root.dataset.loading = 'false';
    renderList(); renderRuns(); loadNextRuns();
  } catch (e) { say('Could not load schedules: ' + e.message, 'error'); }
}
async function loadNextRuns() {
  const list = (snap.schedules || []).filter(s => s.enabled && !problem(s) && s.trigger_type !== 'on_idle');
  await Promise.all(list.slice(0, 40).map(async s => {
    try { const r = await api('/api/schedules/v2/preview?id=' + encodeURIComponent(s.id)); const o = (r.occurrences || []).find(x => x.planned_at); nextRuns[s.id] = o ? o.planned_at : null; }
    catch (e) { nextRuns[s.id] = undefined; }
  }));
  renderList();
}

/* ---------- list ---------- */
function renderList() {
  const list = $('sw-list'); list.replaceChildren();
  const rows = (snap && snap.schedules || []).slice().sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name));
  $('sw-count').textContent = rows.length ? '(' + rows.length + ')' : '';
  if (!rows.length) { list.append(h('div', { class: 'sch-empty' }, 'No schedules yet. ', h('button', { type: 'button', onclick: () => openEditor(null) }, 'Create the first one'))); return; }
  for (const s of rows) {
    const label = (ACTIONS[s.action] || [s.action])[0], issue = problem(s), running = (s.jobs || []).some(j => ['queued', 'running', 'blocked'].includes(j.state));
    const sw = h('input', { type: 'checkbox', 'aria-label': (s.enabled ? 'Pause ' : 'Resume ') + s.name }); sw.checked = !!s.enabled;
    sw.addEventListener('change', () => { sw.checked = !!s.enabled; s.enabled ? command(s, 'update', { enabled: false }, null, 'Paused ' + s.name + '.') : enable(s); });
    const next = s.enabled ? (s.trigger_type === 'on_idle' ? 'when you are idle' : nextRuns[s.id] ? 'next ' + when(nextRuns[s.id]) : nextRuns[s.id] === null ? 'no upcoming run' : '') : 'paused';
    const last = s.last_run_at ? when(s.last_run_at) : 'never run';
    const row = h('div', { class: 'sch-row' + (s.enabled ? '' : ' is-off') + (issue ? ' has-problem' : ''), 'data-id': s.id },
      h('label', { class: 'sch-switch', title: s.enabled ? 'On — click to pause' : 'Off — click to turn on' }, sw, h('span', {})),
      h('div', {}, h('div', { class: 'sch-name', title: s.name }, s.name), h('div', { class: 'sch-what' }, h('span', { class: 'chip acc' }, label), ...detailText(s).map(t => h('span', { class: 'chip' }, t)))),
      h('div', { class: 'sch-when' }, triggerText(s), h('small', {}, next + (nextRuns[s.id] && s.enabled ? ' · ' + stamp(nextRuns[s.id], s.trigger_type === 'cron_like' ? s.timezone : undefined) : ''))),
      h('div', { class: 'sch-last' }, running ? h('span', { class: 'chip ok' }, 'running now') : h('span', {}, 'Last: ' + last),
        h('small', {}, s.run_count + (s.max_runs !== null && s.max_runs !== undefined ? ' of ' + s.max_runs : '') + ' run' + (s.run_count === 1 ? '' : 's') + (s.error_count ? ' · ' + s.error_count + ' failed' : ''))),
      h('div', { class: 'sch-actions' },
        h('button', { type: 'button', class: 'sch-icon play', title: 'Run now', 'aria-label': 'Run ' + s.name + ' now', disabled: busy || running || !!(issue && /no longer valid/.test(issue)), onclick: () => runNow(s) }, '▶'),
        h('button', { type: 'button', class: 'sch-icon', title: 'Edit', 'aria-label': 'Edit ' + s.name, onclick: () => openEditor(s) }, '✎'),
        h('button', { type: 'button', class: 'sch-icon del', title: 'Remove', 'aria-label': 'Remove ' + s.name, disabled: busy, onclick: () => askRemove(s) }, '✕')));
    if (issue) row.append(h('div', { class: 'sch-problem' }, '⚠ ' + issue));
    if (confirmFor && confirmFor.id === s.id) row.append(confirmFor.node);
    list.append(row);
  }
}
function askRemove(s) {
  confirmFor = { id: s.id, node: h('div', { class: 'sch-confirm', role: 'alert' }, h('span', { class: 'grow' }, 'Remove "' + s.name + '"? Its run history is kept.'),
    h('button', { type: 'button', class: 'sch-icon del', style: 'width:auto;padding:0 12px', onclick: () => { confirmFor = null; command(s, 'archive', null, null, 'Removed ' + s.name + '.'); } }, 'Remove'),
    h('button', { type: 'button', onclick: () => { confirmFor = null; renderList(); } }, 'Cancel')) };
  renderList();
}
async function command(s, action, updates, digest, done) {
  if (busy) return; busy = true; renderList();
  try { await api('/api/schedules/v2/commands', { action, target_id: s.id, expected_revision: s.definition_revision, operation_id: uuid(), ...(updates ? { updates } : {}), ...(digest ? { preview_digest: digest } : {}) });
    say(done || 'Done.', 'ok'); }
  catch (e) { say(e.message, 'error'); }
  finally { busy = false; await load(); }
}
async function reviewed(s) { return api('/api/schedules/v2/validate', { draft: {}, target_id: s.id, expected_revision: s.definition_revision }); }
async function enable(s) {
  try { const p = await reviewed(s); await command(s, 'update', { enabled: true }, p.preview_digest, 'Turned on ' + s.name + '.' + (p.occurrences && p.occurrences[0] && p.occurrences[0].planned_at ? ' Next run ' + when(p.occurrences[0].planned_at) + '.' : '')); }
  catch (e) { say(e.message, 'error'); }
}
async function runNow(s) {
  if (busy) return; busy = true; renderList(); say('Starting ' + s.name + '…');
  try { const p = await reviewed(s);
    await api('/api/schedules/v2/commands', { action: 'enqueue', target_id: s.id, expected_revision: s.definition_revision, operation_id: uuid(), preview_digest: p.preview_digest });
    say('Started ' + s.name + '. It appears under Recent runs when finished.', 'ok'); }
  catch (e) { say('Could not start ' + s.name + ': ' + e.message, 'error'); }
  finally { busy = false; await load(); setTimeout(load, 4000); }
}

/* ---------- recent runs ---------- */
function renderRuns() {
  const box = $('sw-runs'); box.replaceChildren();
  const live = (snap.job_records || []).filter(r => ['queued', 'running', 'blocked'].includes(r.job.state));
  const hist = (snap.history || []).slice(-25).reverse();
  if (!live.length && !hist.length) { box.append(h('div', { class: 'sch-empty' }, 'Nothing has run yet.')); return; }
  const name = id => { const s = (snap.schedules || []).find(x => x.id === id); return s ? s.name : null; };
  const t = h('table', { class: 'sch-runs' }, h('tr', {}, h('th', {}, 'Schedule'), h('th', {}, 'What'), h('th', {}, 'Started'), h('th', {}, 'Took'), h('th', {}, 'Result'), h('th', {}, 'Summary'), h('th', {})));
  for (const r of live) {
    const sid = (r.job.scope || []).map(x => String(x)).find(x => x.startsWith('schedule:'));
    t.append(h('tr', {}, h('td', {}, name(sid ? sid.slice(9) : '') || '—'), h('td', {}, (ACTIONS[r.action] || [r.action])[0]), h('td', {}, when(r.job.created_at)), h('td', {}, '…'),
      h('td', {}, h('span', { class: 'chip ok' }, r.job.state === 'queued' ? 'waiting' : r.job.state === 'blocked' ? 'blocked' : 'running')), h('td', { class: 'sum' }, r.job.state === 'blocked' && r.job.terminal_cause ? humanError(r.job.terminal_cause) : ''),
      h('td', {}, h('button', { type: 'button', title: 'Stop this run', onclick: () => cancelJob(r) }, 'Stop'))));
  }
  for (const e of hist) {
    t.append(h('tr', {}, h('td', {}, e.schedule_name || name(e.schedule_id) || '—'), h('td', {}, (ACTIONS[e.action] || [e.action])[0]), h('td', { title: e.triggered_at }, when(e.triggered_at)), h('td', {}, dur(e.duration_ms)),
      h('td', {}, h('span', { class: 'chip ' + (e.success ? 'ok' : 'bad') }, e.success ? 'ok' : 'failed')), h('td', { class: 'sum' }, readable(e.result_summary || e.error || '')), h('td', {})));
  }
  box.append(t);
}
const CODES = { ADMISSION_ZERO_PAID_ALLOCATION: 'Blocked: this paid model has no spend limit. Set one in Config → Budgets & limits.',
  ADMISSION_EXACT_PRICING_REQUIRED: 'Blocked: the model has no price set. Add it in Config → Budgets & limits.',
  ADMISSION_RUN_AMOUNT_LIMIT: 'Stopped at the per-run spend limit.', ADMISSION_DAY_AMOUNT_LIMIT: 'Stopped at the daily spend limit.',
  ADMISSION_ROLE_POLICY_BLOCKED: 'Blocked: the model for this job is not configured. Check Config → Models.', ADMISSION_RUN_DEADLINE: 'Stopped: the run took longer than its time budget.' };
function readable(text) { text = String(text || ''); for (const [code, msg] of Object.entries(CODES)) if (text.includes(code)) return msg; if (/^\s*[{[]/.test(text)) { try { const v = JSON.parse(text); return Object.entries(v).filter(([, x]) => typeof x !== 'object').slice(0, 5).map(([k, x]) => k.replace(/_/g, ' ') + ': ' + x).join(' · '); } catch (e) { /* plain */ } } return text.length > 220 ? text.slice(0, 217) + '…' : text; }
async function cancelJob(r) {
  try { await api('/api/schedules/v2/commands', { action: 'cancel_job', target_id: r.job.id, expected_revision: r.job.fence, operation_id: uuid() }); say('Stopping the run.', 'ok'); }
  catch (e) { say(e.message, 'error'); } finally { load(); }
}

/* ---------- editor ---------- */
function draftFrom(s) {
  const unit = s && s.interval_ms ? (s.interval_ms % 86400000 === 0 ? '86400000' : s.interval_ms % 3600000 === 0 ? '3600000' : '60000') : '3600000';
  return { id: s ? s.id : null, revision: s ? s.definition_revision : null, enabled: s ? !!s.enabled : true,
    name: s ? s.name : '', action: s ? s.action : 'dream_cycle', parameters: s ? JSON.parse(JSON.stringify(s.parameters || {})) : {},
    trigger_type: s ? s.trigger_type : 'interval', every: s && s.interval_ms ? s.interval_ms / Number(unit) : 6, unit,
    cron: s && s.cron ? s.cron : '0 3 * * *', timezone: s && s.timezone ? s.timezone : LOCAL_ZONE,
    cycle_interval: s && s.cycle_interval ? s.cycle_interval : 10, idle_min: s && s.idle_ms ? s.idle_ms / 60000 : 15,
    max_runs: s && s.max_runs !== null && s.max_runs !== undefined ? s.max_runs : '', missed_policy: s && s.missed_policy || 'skip', fold_policy: s && s.fold_policy || 'once' };
}
function openEditor(s) { editor = draftFrom(s); drawEditor(); $('sw-editor-host').hidden = false; $('sw-editor-host').scrollIntoView({ block: 'start' }); const n = $('se-name'); if (n) n.focus(); }
function closeEditor() { editor = null; $('sw-editor-host').hidden = true; $('sw-editor-host').replaceChildren(); }
function fld(title, control, help, wide) { return h('div', { class: 'sch-field' + (wide ? ' wide' : '') }, typeof title === 'string' ? h('div', { class: 'lbl' }, title) : title, control, help ? h('div', { class: 'help' }, help) : null); }
function bindInput(input, apply) { input.addEventListener('input', () => { apply(input.value); schedulePreview(); }); input.addEventListener('change', () => { apply(input.value); schedulePreview(); }); return input; }
function paramControls() {
  const fields = descriptors[editor.action] || {}, out = [];
  for (const [name, f] of Object.entries(fields)) {
    if (f.internal) continue;
    const [title, help] = FIELD[name] || [name.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()), null];
    const v = editor.parameters[name] !== undefined ? editor.parameters[name] : f.default;
    let c;
    if (f.type === 'enum') {
      c = h('select', {}, ...(f.options || []).filter(o => !(RETIRED[name] || []).includes(o)).map(o => h('option', { value: o }, STRATEGY[o] || o.replace(/_/g, ' ').replace(/^./, x => x.toUpperCase()))));
      if (v !== undefined && !Array.from(c.options).some(option => option.value === String(v)))
        c.prepend(h('option', { value: String(v) }, 'Unsupported legacy value: ' + v));
      if (v !== undefined) c.value = v; bindInput(c, x => { editor.parameters[name] = x; });
    } else if (f.type === 'number') {
      c = h('input', { type: 'number', min: f.minimum, max: f.maximum, step: 1, value: v !== undefined ? v : '' });
      bindInput(c, x => { if (x === '') delete editor.parameters[name]; else editor.parameters[name] = Number(x); });
    } else if (f.type === 'boolean') {
      c = h('select', {}, h('option', { value: 'false' }, 'No'), h('option', { value: 'true' }, 'Yes')); c.value = String(v === true);
      bindInput(c, x => { editor.parameters[name] = x === 'true'; });
    } else if (f.type === 'string_array') {
      c = h('input', { type: 'text', value: Array.isArray(v) ? v.join(', ') : '', placeholder: 'id-one, id-two' });
      bindInput(c, x => { editor.parameters[name] = x.split(',').map(y => y.trim()).filter(Boolean); });
    } else if (f.type === 'json') {
      c = h('textarea', { rows: 3, placeholder: '{"reason": "…"}' }, v && Object.keys(v).length ? JSON.stringify(v, null, 2) : '');
      bindInput(c, x => { try { editor.parameters[name] = x.trim() ? JSON.parse(x) : {}; c.removeAttribute('aria-invalid'); } catch (e) { c.setAttribute('aria-invalid', 'true'); } });
    } else {
      c = h('input', { type: 'text', value: v !== undefined ? v : '' }); bindInput(c, x => { if (x.trim() === '') delete editor.parameters[name]; else editor.parameters[name] = x; });
    }
    out.push(fld(title + (f.required && f.default === undefined ? ' *' : ''), c, help, f.type === 'json'));
  }
  if (!out.length) out.push(h('div', { class: 'help' }, 'No options — this action uses sensible defaults.'));
  return out;
}
function cronPresets() {
  const p = String(editor.cron).trim().split(/\s+/), time = /^\d+$/.test(p[0]) && /^\d+$/.test(p[1]) ? String(p[1]).padStart(2, '0') + ':' + String(p[0]).padStart(2, '0') : '03:00';
  const kind = /^\d+$/.test(p[0]) && p[1] === '*' && p[2] === '*' && p[4] === '*' ? 'hourly' : p[2] === '*' && p[3] === '*' && p[4] === '*' && /^\d+$/.test(p[1]) ? 'daily'
    : p[2] === '*' && p[4] === '1-5' ? 'weekdays' : p[2] === '*' && /^\d$/.test(p[4] || '') ? 'weekly' : 'custom';
  const kindSel = h('select', {}, h('option', { value: 'hourly' }, 'Every hour'), h('option', { value: 'daily' }, 'Every day'), h('option', { value: 'weekdays' }, 'Weekdays (Mon–Fri)'), h('option', { value: 'weekly' }, 'Once a week'), h('option', { value: 'custom' }, 'Custom (cron expression)'));
  kindSel.value = kind;
  const timeIn = h('input', { type: 'time', value: time }), daySel = h('select', {}, ...DAYS.map((d, i) => h('option', { value: String(i) }, d))); daySel.value = /^\d$/.test(p[4] || '') ? p[4] : '1';
  const minuteIn = h('input', { type: 'number', min: 0, max: 59, value: /^\d+$/.test(p[0]) ? p[0] : '0' });
  const cronIn = h('input', { type: 'text', value: editor.cron, spellcheck: 'false', placeholder: 'minute hour day month weekday' });
  const rebuild = () => { const [hh, mm] = (timeIn.value || '03:00').split(':').map(Number), k = kindSel.value;
    if (k === 'hourly') editor.cron = Number(minuteIn.value || 0) + ' * * * *'; else if (k === 'daily') editor.cron = mm + ' ' + hh + ' * * *';
    else if (k === 'weekdays') editor.cron = mm + ' ' + hh + ' * * 1-5'; else if (k === 'weekly') editor.cron = mm + ' ' + hh + ' * * ' + daySel.value; else editor.cron = cronIn.value.trim();
    cronIn.value = editor.cron; show(); schedulePreview(); };
  const show = () => { const k = kindSel.value; timeWrap.hidden = k === 'hourly' || k === 'custom'; minuteWrap.hidden = k !== 'hourly'; dayWrap.hidden = k !== 'weekly'; cronWrap.hidden = k !== 'custom'; };
  kindSel.addEventListener('change', rebuild); timeIn.addEventListener('change', rebuild); daySel.addEventListener('change', rebuild); minuteIn.addEventListener('input', rebuild);
  cronIn.addEventListener('input', () => { editor.cron = cronIn.value.trim(); schedulePreview(); });
  const zone = h('select', {}, ...ZONES.map(z => h('option', { value: z }, z))); zone.value = editor.timezone; bindInput(zone, x => { editor.timezone = x; });
  const timeWrap = fld('At', timeIn), minuteWrap = fld('At minute', minuteIn, 'Minutes past each hour.'), dayWrap = fld('On', daySel), cronWrap = fld('Cron expression', cronIn, 'Five fields: minute hour day-of-month month weekday. Example: 30 6 * * 1-5', true);
  setTimeout(show, 0);
  return [fld('Repeat', kindSel), timeWrap, minuteWrap, dayWrap, fld('Time zone', zone), cronWrap];
}
function timingControls() {
  const t = editor.trigger_type;
  if (t === 'interval') { const n = h('input', { type: 'number', min: 1, step: 'any', value: editor.every }), u = h('select', {}, ...UNITS.map(([v, l]) => h('option', { value: v }, l))); u.value = editor.unit;
    bindInput(n, x => { editor.every = Number(x); }); bindInput(u, x => { editor.unit = x; });
    return [fld('Run every', h('div', { class: 'sch-inline' }, n, u), 'Counted from the previous run.')]; }
  if (t === 'cron_like') return cronPresets();
  if (t === 'after_cycles') { const n = h('input', { type: 'number', min: 1, step: 1, value: editor.cycle_interval }); bindInput(n, x => { editor.cycle_interval = Number(x); });
    return [fld('Run after every', h('div', { class: 'sch-inline' }, n, h('span', { class: 'fix help' }, 'dream cycles')), 'Follows how much DreamGraph has been dreaming, not the clock.')]; }
  const n = h('input', { type: 'number', min: 1, step: 1, value: editor.idle_min }); bindInput(n, x => { editor.idle_min = Number(x); });
  return [fld('When idle for', h('div', { class: 'sch-inline' }, n, h('span', { class: 'fix help' }, 'minutes')), 'Runs once you have not used DreamGraph for this long.')];
}
function drawEditor() {
  const host = $('sw-editor-host'); host.replaceChildren();
  const name = h('input', { id: 'se-name', type: 'text', value: editor.name, maxlength: 256, placeholder: 'e.g. Nightly dream cycle' }); bindInput(name, x => { editor.name = x; });
  const act = h('select', {}, ...Object.entries(ACTIONS).map(([v, [l]]) => h('option', { value: v }, l))); act.value = editor.action;
  act.addEventListener('change', () => { editor.action = act.value; editor.parameters = {}; drawEditor(); schedulePreview(); });
  const methods = [['interval', 'Repeating interval'], ['cron_like', 'Calendar time'], ['after_cycles', 'After dream cycles'], ['on_idle', 'When I\'m idle']];
  const seg = h('div', { class: 'sch-seg', role: 'radiogroup', 'aria-label': 'Timing method' }, ...methods.map(([v, l]) => { const r = h('input', { type: 'radio', name: 'se-trigger', value: v }); r.checked = editor.trigger_type === v;
    r.addEventListener('change', () => { editor.trigger_type = v; drawEditor(); schedulePreview(); }); return h('label', {}, r, l); }));
  const maxRuns = h('input', { type: 'number', min: 1, step: 1, value: editor.max_runs, placeholder: 'No limit' }); bindInput(maxRuns, x => { editor.max_runs = x; });
  const missed = h('select', {}, h('option', { value: 'skip' }, 'Skip it'), h('option', { value: 'catch_up_once' }, 'Run once when DreamGraph is back')); missed.value = editor.missed_policy; bindInput(missed, x => { editor.missed_policy = x; });
  const fold = h('select', {}, h('option', { value: 'once' }, 'Run once'), h('option', { value: 'both' }, 'Run both times')); fold.value = editor.fold_policy; bindInput(fold, x => { editor.fold_policy = x; });
  const enabled = h('input', { type: 'checkbox', id: 'se-enabled' }); enabled.checked = editor.enabled; enabled.addEventListener('change', () => { editor.enabled = enabled.checked; });
  const save = h('button', { type: 'button', class: 'sch-primary', id: 'se-save', onclick: saveEditor }, editor.id ? 'Save changes' : 'Create schedule');
  host.append(h('div', { class: 'sch-editor' }, h('h2', {}, editor.id ? 'Edit schedule' : 'New schedule'),
    h('div', { class: 'sch-grid' }, fld('Name', name), fld('What to run', act, (ACTIONS[editor.action] || [, ''])[1])),
    h('div', { class: 'sch-sub' }, 'Options'), h('div', { class: 'sch-grid' }, ...paramControls()),
    h('div', { class: 'sch-sub' }, 'When'), seg, h('div', { class: 'sch-grid', style: 'margin-top:10px' }, ...timingControls()),
    h('details', { class: 'sch-more' }, h('summary', {}, 'More timing options'), h('div', { class: 'sch-grid' },
      fld('Stop after', h('div', { class: 'sch-inline' }, maxRuns, h('span', { class: 'fix help' }, 'runs'))),
      fld('If a run was missed', missed, 'For example while the computer was off.'),
      editor.trigger_type === 'cron_like' ? fld('When clocks go back', fold, 'An hour that happens twice on DST change.') : null)),
    h('div', { class: 'sch-preview', id: 'se-preview', 'aria-live': 'polite' }, 'Checking…'),
    h('div', { class: 'err', id: 'se-error', role: 'alert', style: 'color:var(--s-bad);margin-top:6px' }),
    h('div', { class: 'sch-editor-actions' }, h('label', { for: 'se-enabled' }, enabled, editor.id ? 'On' : 'Turn on after creating'),
      h('button', { type: 'button', onclick: closeEditor }, 'Cancel'), save)));
  schedulePreview();
}
function definition() {
  const d = { name: editor.name.trim(), action: editor.action, parameters: editor.parameters, trigger_type: editor.trigger_type, timezone: editor.timezone, missed_policy: editor.missed_policy, fold_policy: editor.fold_policy,
    max_runs: editor.max_runs === '' || editor.max_runs === null ? null : Number(editor.max_runs) };
  if (editor.trigger_type === 'interval') d.interval_ms = Math.round(Number(editor.every) * Number(editor.unit));
  if (editor.trigger_type === 'cron_like') d.cron = editor.cron;
  if (editor.trigger_type === 'after_cycles') d.cycle_interval = Math.round(Number(editor.cycle_interval));
  if (editor.trigger_type === 'on_idle') d.idle_ms = Math.round(Number(editor.idle_min) * 60000);
  return d;
}
function schedulePreview() { clearTimeout(previewTimer); previewTimer = setTimeout(runPreview, 350); }
async function runPreview() {
  if (!editor) return; const seq = ++previewSeq, box = $('se-preview'), err = $('se-error'); if (!box) return;
  const d = definition(); if (!d.name) d.name = 'Preview';
  try { const p = await api('/api/schedules/v2/validate', { draft: d }); if (seq !== previewSeq || !editor) return;
    err.textContent = ''; box.replaceChildren();
    const occ = (p.occurrences || []).filter(o => o.planned_at);
    if (editor.trigger_type === 'after_cycles') box.append('Runs after every ' + d.cycle_interval + ' dream cycles, so timing follows activity.');
    else if (editor.trigger_type === 'on_idle') box.append('Runs after ' + dur(d.idle_ms) + ' without activity.');
    else if (occ.length) box.append(h('strong', {}, 'Next runs'), h('ol', {}, ...occ.slice(0, 5).map(o => h('li', {}, stamp(o.planned_at, editor.trigger_type === 'cron_like' ? editor.timezone : undefined) + ' (' + when(o.planned_at) + ')'))));
    else box.append('No run in the next 32 days with these settings.');
    const roles = (p.effective_policies || []).map(r => r.role + ': ' + (r.effective && r.effective.model || '?'));
    box.append(h('div', { class: 'note' }, (p.model_calls_possible ? 'Uses models (' + roles.join(', ') + ') within your budget limits.' : 'Does not call any model.') + (p.scheduler_enabled === false ? ' Note: the scheduler itself is paused.' : '')));
  } catch (e) { if (seq !== previewSeq) return; box.textContent = 'Fix the highlighted settings to see when it will run.'; err.textContent = e.message; }
}
async function saveEditor() {
  const d = definition(), err = $('se-error');
  if (!d.name) { err.textContent = 'Give the schedule a name.'; $('se-name').focus(); return; }
  $('se-save').disabled = true; err.textContent = '';
  try {
    if (!editor.id) {
      const r = await api('/api/schedules/v2/create', { operation_id: uuid(), ...d });
      if (editor.enabled && r.schedule) { const p = await reviewed(r.schedule);
        await api('/api/schedules/v2/commands', { action: 'update', target_id: r.schedule.id, expected_revision: r.schedule.definition_revision, operation_id: uuid(), updates: { enabled: true }, preview_digest: p.preview_digest }); }
      say('Created ' + d.name + (editor.enabled ? ' and turned it on.' : ' (off).'), 'ok');
    } else {
      const s = snap.schedules.find(x => x.id === editor.id); if (!s) throw new Error('This schedule no longer exists.');
      const updates = { ...d }; const turnOn = editor.enabled && !s.enabled, turnOff = !editor.enabled && s.enabled;
      if (turnOff) updates.enabled = false;
      const r = await api('/api/schedules/v2/commands', { action: 'update', target_id: s.id, expected_revision: s.definition_revision, operation_id: uuid(), updates });
      if (turnOn) { const fresh = r.result || { ...s, definition_revision: s.definition_revision + 1 }; const p = await reviewed(fresh);
        await api('/api/schedules/v2/commands', { action: 'update', target_id: s.id, expected_revision: fresh.definition_revision, operation_id: uuid(), updates: { enabled: true }, preview_digest: p.preview_digest }); }
      say('Saved ' + d.name + '.', 'ok');
    }
    closeEditor(); await load();
  } catch (e) { err.textContent = e.message; const b = $('se-save'); if (b) b.disabled = false; }
}

/* ---------- wiring ---------- */
$('sw-new').addEventListener('click', () => openEditor(null));
$('sw-refresh').addEventListener('click', () => { say(''); load(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && !editor && !busy) load(); });
setInterval(() => { if (!document.hidden && !editor && !busy) load(); }, 30000);
const nav = new URLSearchParams(location.search);
load().then(() => {
  const id = nav.get('schedule'), view = nav.get('view'), s = id && snap && snap.schedules.find(x => x.id === id);
  if (!s) { if (nav.get('new') === '1') openEditor(null); else if (id) say('Original schedule unavailable. No replacement selected.', 'error'); return; }
  const revision = nav.get('revision');
  if (revision !== null && String(s.definition_revision) !== revision) {
    say('This schedule revision changed. Review the current definition before taking action.', 'error');
  } else if (view === 'edit') openEditor(s);
  else if (view === 'run' || view === 'enable') {
    const label = view === 'run' ? 'Enqueue this run' : 'Turn on this schedule';
    confirmFor = { id: s.id, node: h('div', { class: 'sch-confirm', role: 'group' },
      h('span', { class: 'grow' }, label + ' for "' + s.name + '"? Review the current definition first.'),
      h('button', { type: 'button', class: 'sch-primary', onclick: () => { confirmFor = null; view === 'run' ? runNow(s) : enable(s); } }, label),
      h('button', { type: 'button', onclick: () => { confirmFor = null; renderList(); } }, 'Cancel')) };
    renderList();
  }
  const row = Array.from(root.querySelectorAll('[data-id]')).find(node => node.getAttribute('data-id') === s.id);
  if (row) { row.scrollIntoView({ block: 'center' }); row.style.outline = '2px solid #4f86ba'; }
});
})();`;
