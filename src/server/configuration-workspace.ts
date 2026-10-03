/** Compact configuration client. Persistence, validation and activation stay with the daemon. */
import type { EngineSetting } from "../config/engine-setting-catalogue.js";
import { providerCapabilityRecords } from "../config/provider-capabilities.js";
export function configurationModelChoices() {
  return providerCapabilityRecords().map(record => ({ value: record.model, provider: record.provider, api: record.default_api }));
}
export const CONFIGURATION_TABS = [
  ["models", "Models & roles"], ["scanning", "Scan & enrichment"], ["cognition", "Cognition & truth"],
  ["scheduling", "Schedules & events"], ["retrieval", "Retrieval & budgets"],
  ["integrations", "Repositories & connections"], ["computer", "Computer Use"], ["advanced", "Advanced"],
] as const;
export function configurationTab(field: Pick<EngineSetting, "key" | "owner" | "apply">): string {
  const { key, owner } = field;
  if (field.apply === "read_only") return "advanced";
  if (key === "DREAMGRAPH_COMPUTER_USE" || owner === "role:computer_use") return "computer";
  if (/MAX_CALLS|MAX_INPUT_TOKENS|MAX_OUTPUT_TOKENS|MAX_REASONING_TOKENS|MAX_RETRIES|MAX_ELAPSED_MS|CONCURRENCY|MAX_HOPS|MAX_NEIGHBORS|RUN_BUDGET|DAY_BUDGET|BILLING|PRICING|BUDGET_CURRENCY|TOKEN_ECONOMY|SEMANTIC_CACHE|GRAPH_CONTEXT/.test(key)) return "retrieval";
  if (["scheduler", "events", "narrative"].includes(owner)) return "scheduling";
  if (owner === "role:initial_scan" || owner === "role:enrichment" || /ENRICHMENT|REPOSITORY_CHANGE|GRAPH_CHANGE|GRAPH_STALE/.test(key)) return "scanning";
  if (key.startsWith("DREAMGRAPH_LLM_") || owner.startsWith("role:") || owner === "model policy" || owner === "architect") return "models";
  if (owner === "daemon authority" || owner === "federation" || /REPOS|DATABASE|DG_DB_|RUNTIME_ENDPOINT|RUNTIME_TYPE|HOST_MCP|BRIDGE_SERVER/.test(key)) return "integrations";
  if (/^DG_(PROMOTION|RETENTION|MAX_CONTRADICTION|DECAY|TENSION|MEMORY|ORPHAN|BARREN|PROBE|STRATEGY|NORMALIZER|BOOTSTRAP|LLM_BUDGET|PGO_BUDGET)/.test(key) || /DOOM|RESOLUTION_PLANS/.test(key)) return "cognition";
  return "advanced";
}
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export function renderConfigurationWorkspace(revision: string, restartCommand: string): string {
  return `<section id="configuration-workspace" aria-label="Engine configuration">
  <header class="cw-heading"><div><h1>Engine configuration</h1><p>Saved settings, effective policies and the next execution.</p></div><a href="/schedules">Manage schedules →</a></header>
  <div class="cw-toolbar"><label>Find a setting <input id="cw-search" type="search" placeholder="Model, max hops, budget, repository…" autocomplete="off"></label><span id="cw-count"></span><button id="cw-refresh" type="button">Read back</button></div>
  <nav id="cw-tabs" role="tablist" aria-label="Configuration categories">${CONFIGURATION_TABS.map(([id, label], i) => `<button id="cw-tab-${id}" role="tab" aria-controls="cw-panel" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" data-tab="${id}">${label}</button>`).join("")}</nav>
  <div id="cw-message" role="status" aria-live="polite">Loading saved and effective settings…</div>
  <div id="cw-diagnostics" role="alert"></div>
  <div class="cw-layout"><section id="cw-panel" role="tabpanel" aria-labelledby="cw-tab-models"><div id="cw-policies"></div>
  <details id="cw-computer-profiles" hidden><summary>Browser workers and scoped targets</summary><p class="cw-note">Import qualification from the exact installation, then define allowed origins, controls, postconditions and observation limits. Saving is setup only; scope confirmation belongs to each Architect pass.</p>
  <div class="cw-toolbar"><label>Type <select id="cw-computer-kind"><option value="worker">Browser worker</option><option value="target">Browser target</option></select></label><label>Name <input id="cw-computer-id" list="cw-computer-names" autocomplete="off" pattern="[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}" placeholder="local-browser"></label><datalist id="cw-computer-names"></datalist><button id="cw-computer-read" type="button">Read / new draft</button><label>Import <input id="cw-computer-import" type="file" accept=".json,application/json" disabled></label></div>
  <p><code>dg computer-use qualify --browser-executable &lt;absolute-path&gt; --browser-version &lt;exact-version&gt; --worker-id &lt;name&gt; --out &lt;new-file&gt;</code></p>
  <div id="cw-computer-status" role="status" aria-live="polite">Profiles are read on demand.</div><div id="cw-computer-editor"></div><div class="cw-toolbar"><button id="cw-computer-save" type="button" disabled>Save reviewed profile</button><button id="cw-computer-retry" type="button" hidden>Recover exact save</button></div></details>
  <div id="cw-fields"></div></section>
  <aside class="cw-inspector"><h2>Configuration state</h2><div id="cw-state"></div>
    <p class="cw-note">Edits are drafts until saved. Existing executions retain their admitted policy and limits.</p>
    <details id="cw-templates"><summary>Apply a template</summary><label>Template <select id="cw-template"><option value="default">Default</option><option value="ollama">Ollama</option><option value="lmstudio">LM Studio</option></select></label><label>Scope <select id="cw-template-scope"><option value="category">Current category</option><option value="all">All editable settings</option></select></label>
    <p class="cw-note">Secrets, instance paths, repositories and protected policies are retained. Preview writes nothing. Apply stages settings for restart.</p><button id="cw-preview" type="button">Preview changes</button><div id="cw-diff"></div><button id="cw-apply-template" type="button" disabled>Apply reviewed diff</button></details>
    <details><summary>Restart and read back</summary><p>Restart this instance through its CLI, then read back to verify effective values.</p><code id="cw-restart-command">${escape(restartCommand)}</code><button id="cw-copy-restart" type="button">Copy restart command</button><p class="cw-note">A successful save does not confirm a restart.</p></details>
  </aside></div>
  <div class="cw-savebar"><span id="cw-draft-count">No unsaved changes</span><button id="cw-discard" type="button" disabled>Discard drafts</button><button id="cw-undo" type="button" disabled>Undo last save</button><button id="cw-retry" type="button" hidden>Retry the captured request</button><button id="cw-save" class="btn btn-primary" type="button" disabled>Save changes</button></div>
  <input type="hidden" name="_config_revision" value="${escape(revision)}"><noscript>This workspace requires JavaScript. The CLI and configuration API remain available.</noscript>
  </section><style>${CONFIGURATION_WORKSPACE_CSS}</style><script src="/config/workspace.js" defer></script>`;
}
const CONFIGURATION_WORKSPACE_CSS = `
#configuration-workspace{font-size:13px}#configuration-workspace h1{margin:0;font-size:20px}#configuration-workspace h2{font-size:13px;margin:8px 0;color:var(--text)}
.cw-heading,.cw-toolbar,.cw-savebar{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.cw-heading{justify-content:space-between;margin-bottom:10px}.cw-heading p,.cw-note{color:var(--text-dim);font-size:12px}.cw-toolbar{margin-bottom:8px}.cw-toolbar label{flex:1;display:flex;gap:8px;align-items:center}
#configuration-workspace input,#configuration-workspace select,#configuration-workspace textarea,#configuration-workspace button{font:inherit;color:var(--text);background:var(--surface);border:1px solid var(--border);border-radius:3px;padding:4px 7px;min-height:28px}#configuration-workspace input[type=checkbox]{min-height:0;margin-right:5px}#configuration-workspace textarea{width:100%;min-height:78px;resize:vertical;font-family:var(--mono);font-size:12px}#configuration-workspace button{cursor:pointer}#configuration-workspace button:disabled{opacity:.45;cursor:default}#configuration-workspace :focus-visible{outline:2px solid var(--accent);outline-offset:2px}
#cw-search{width:100%;max-width:540px}#cw-tabs{display:flex;gap:2px;border-bottom:1px solid var(--border);overflow-x:auto;padding-bottom:5px}#cw-tabs button{white-space:nowrap;border-color:transparent}#cw-tabs button[aria-selected=true]{border-bottom:2px solid var(--accent);background:#2b2b2b}
#configuration-workspace .btn-primary{background:#365874;border-color:#7798b8;color:#f2f5f8;font-weight:600}
.cw-layout{display:grid;grid-template-columns:minmax(0,1fr) 285px;gap:12px;margin-top:8px}.cw-inspector{border-left:1px solid var(--border);padding-left:12px;align-self:start;position:sticky;top:60px}.cw-inspector details{border-top:1px solid var(--border);padding:8px 0}.cw-inspector label{display:flex;justify-content:space-between;gap:5px;margin:5px 0}.cw-inspector code{display:block;overflow-wrap:anywhere;margin:8px 0}.cw-inspector p{margin:6px 0}
.cw-field{padding:7px 0;border-bottom:1px solid var(--border)}.cw-field>summary{cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px;flex-wrap:wrap}.cw-field>summary:before{content:'▸';color:var(--text-dim)}.cw-field[open]>summary:before{content:'▾'}.cw-label{font-weight:600}.cw-key{color:var(--text-dim);font:11px var(--mono);overflow-wrap:anywhere}.cw-meta{font-size:11px;color:var(--text-dim);margin-left:auto}.cw-field[data-dirty=true]{border-left:2px solid var(--accent);padding-left:7px}.cw-body{padding:7px 10px}.cw-help{color:var(--text-dim);margin:3px 0 6px}.cw-values{font-size:11px;overflow-wrap:anywhere;margin:5px 0}.cw-values span{display:block}.cw-enabled{display:block;margin:6px 0}.cw-edit{min-width:0}.cw-edit>input,.cw-edit>select{width:100%;max-width:540px}.cw-property{display:grid;grid-template-columns:minmax(130px,35%) minmax(0,1fr);gap:8px;align-items:start;margin:4px 0}.cw-property>label{overflow-wrap:anywhere}.cw-property .cw-property{grid-template-columns:minmax(100px,35%) minmax(0,1fr)}.cw-json{border-left:1px solid var(--border);padding-left:8px}.cw-error,#cw-diagnostics{color:var(--red);font-size:12px}.cw-error:not(:empty){margin-top:6px}.cw-readonly{color:var(--text-dim)}.cw-savebar{position:sticky;bottom:0;background:var(--bg);border-top:1px solid var(--border);padding:9px 0;margin-top:12px;z-index:5}.cw-savebar>span{margin-right:auto}#cw-message{padding:7px 0;min-height:32px}#cw-diff{max-height:320px;overflow:auto;font-size:12px;overflow-wrap:anywhere}.cw-diff-row{padding:5px 0;border-bottom:1px solid var(--border)}.cw-diff-row code{font-size:10px}.cw-policy{border:1px solid var(--border);padding:7px 9px;border-radius:3px;margin-bottom:5px}.cw-policy summary{cursor:pointer}.cw-policy .cw-values{margin:6px 0}.cw-active{color:var(--green)}.cw-pending{color:var(--yellow)}[aria-invalid=true]{border-color:var(--red)!important}
@media(max-width:850px){.cw-layout{grid-template-columns:minmax(0,1fr)}.cw-inspector{position:static;border-left:0;border-top:1px solid var(--border);padding:8px 0}.cw-inspector details{display:block}.cw-toolbar label{flex-basis:100%}}
@media(max-width:480px){.cw-property,.cw-property .cw-property{grid-template-columns:minmax(0,1fr)}.cw-body{padding:7px 3px}.cw-meta{margin-left:0}.cw-savebar{gap:5px}#cw-search{min-width:0}}
@media(forced-colors:active){#cw-tabs button[aria-selected=true],.cw-field[data-dirty=true]{border-color:Highlight}.cw-active,.cw-pending,.cw-error{color:CanvasText}}
`;
export const CONFIGURATION_WORKSPACE_SCRIPT = String.raw`(() => {
  'use strict';
  const $ = id => document.getElementById(id), root = $('configuration-workspace');
  if (!root) return;
  const drafts = new Map(), explicitDrafts = new Map(), errors = new Map();
  let snapshot = null, catalogue = [], policies = [], tab = 'models', busy = false, captured = null, preview = null, lastReceipt = null, generation = 0;
  const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
  const message = text => { $('cw-message').textContent = text; };
  const pretty = text => text.replace(/^DREAMGRAPH_(LLM_)?|^DG_/, '').toLowerCase().replace(/_/g, ' ');
  const shown = value => value === null || value === undefined ? 'Engine default (resolved at use)' : value;
  const api = async (path, body) => {
    const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type':'application/json', 'Accept':'application/json' }, cache:'no-store', ...(body === undefined ? {} : { body:JSON.stringify(body) }), signal:AbortSignal.timeout(15000) });
    const value = await response.json();
    if (!response.ok || value.ok === false) { const error = new Error(value.error || ('HTTP ' + response.status)); error.refused = response.status >= 400 && response.status < 500; error.fields = value.fields || []; throw error; }
    return value;
  };
  function controls() {
    const locked = busy || !!captured;
    root.dataset.busy = String(busy); $('cw-refresh').disabled = busy;
    for (const id of ['cw-save','cw-preview','cw-apply-template','cw-undo','cw-discard','cw-template','cw-template-scope']) $(id).disabled = locked;
    $('cw-save').disabled = locked || !drafts.size || !!errors.size;
    $('cw-discard').disabled = locked || !drafts.size;
    $('cw-undo').disabled = locked || !lastReceipt || !!drafts.size;
    $('cw-preview').disabled = locked || !!drafts.size || !snapshot;
    $('cw-apply-template').disabled = locked || !preview || !preview.result.diff.length || !!drafts.size;
    $('cw-retry').hidden = !captured || busy; $('cw-retry').disabled = busy;
    $('cw-draft-count').textContent = drafts.size ? drafts.size + ' unsaved setting' + (drafts.size === 1 ? '' : 's') : 'No unsaved changes';
    for (const node of root.querySelectorAll('#cw-fields input,#cw-fields select,#cw-fields textarea,#cw-fields button')) node.disabled = locked || node.dataset.readonly === 'true';
  }
  function invalid(key, text) {
    if (text) errors.set(key, text); else errors.delete(key);
    const row = [...$('cw-fields').children].find(node => node.dataset.key === key);
    if (row) { row.querySelector('.cw-error').textContent = text || ''; for (const node of row.querySelectorAll('input,select,textarea')) node.setAttribute('aria-invalid', text ? 'true' : 'false'); }
    controls();
  }
  function draft(field, value) {
    const saved = snapshot.settings.find(s => s.key === field.key)?.persisted ?? null;
    if (!field.secret && value === saved || field.secret && value === null && saved === null) explicitDrafts.delete(field.key); else explicitDrafts.set(field.key, value);
    rebuildDrafts();
    invalid(field.key, ''); const row = [...$('cw-fields').children].find(node => node.dataset.key === field.key); if (row) row.dataset.dirty = String(drafts.has(field.key));
    preview = null; $('cw-diff').replaceChildren(); controls();
  }
  function rebuildDrafts() {
    drafts.clear(); for (const [key,value] of explicitDrafts) drafts.set(key,value);
    for (const [key,value] of explicitDrafts) {
      const aliases = catalogue.filter(field => field.alias_for?.key === key); if(!aliases.length)continue;
      try { const before=JSON.parse(snapshot.settings.find(s=>s.key===key)?.persisted||'{}'),after=JSON.parse(value||'{}');
        for (const alias of aliases) if(!explicitDrafts.has(alias.key) && JSON.stringify(before[alias.alias_for.property])!==JSON.stringify(after[alias.alias_for.property]) && snapshot.settings.find(s=>s.key===alias.key)?.persisted!==null) drafts.set(alias.key,null);
      } catch { /* Invalid structured input is retained for daemon/field validation. */ }
    }
  }
  function schemaFor(schema, value) {
    if (!schema.anyOf) return schema;
    return schema.anyOf.find(s => s.const !== undefined && s.const === value || s.type === (Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value)) || schema.anyOf.find(s => s.type !== 'null') || schema.anyOf[0];
  }
  function initial(schema) {
    if (Object.hasOwn(schema, 'default')) return structuredClone(schema.default);
    if (Object.hasOwn(schema, 'const')) return schema.const;
    schema = schemaFor(schema, undefined);
    if (schema.enum) return schema.enum[0];
    if (schema.type === 'object') return Object.fromEntries(Object.entries(schema.properties || {}).filter(([,s]) => !s.optional).map(([k,s]) => [k,initial(s)]));
    if (schema.type === 'array') return [];
    if (schema.type === 'boolean') return false;
    if (schema.type === 'number' || schema.type === 'integer') return schema.checks?.find(c => c.kind === 'min')?.value ?? 0;
    if (schema.type === 'null') return null;
    return '';
  }
  function tree(schema, value, changed, label, depth = 0) {
    const box = el('div', undefined, 'cw-edit');
    if (schema.anyOf) {
      const chooser = el('select'); chooser.setAttribute('aria-label', label + ' value type');
      const current = schemaFor(schema, value);
      schema.anyOf.forEach((branch, i) => { const option = el('option', branch.type || String(branch.const)); option.value = String(i); option.selected = branch === current; chooser.append(option); });
      const content = el('div'); const rebuild = s => { content.replaceChildren(tree(s, value, changed, label, depth)); };
      chooser.onchange = () => { const s = schema.anyOf[Number(chooser.value)]; value = initial(s); changed(value); rebuild(s); }; box.append(chooser, content); rebuild(current); return box;
    }
    if (schema.type === 'object' && schema.properties && depth < 6) {
      box.classList.add('cw-json'); const object = value && typeof value === 'object' && !Array.isArray(value) ? structuredClone(value) : {};
      for (const [key, child] of Object.entries(schema.properties)) {
        const row = el('div', undefined, 'cw-property'), caption = el('label'), toggle = el('input'); toggle.type = 'checkbox'; toggle.checked = Object.hasOwn(object, key); caption.append(toggle, document.createTextNode(pretty(key) + (child.optional ? '' : ' *')));
        const editor = el('div'); const redraw = () => { editor.replaceChildren(); if (toggle.checked) editor.append(tree(child, object[key], v => { object[key] = v; changed(object); }, label + ' ' + key, depth + 1)); else editor.append(el('span', Object.hasOwn(child, 'default') ? 'Default: ' + JSON.stringify(child.default) : 'Not set', 'cw-note')); };
        toggle.onchange = () => { if (toggle.checked) object[key] = initial(child); else delete object[key]; changed(object); redraw(); };
        row.append(caption, editor); box.append(row); redraw();
      }
      return box;
    }
    if ((schema.type === 'array' || schema.type === 'object') && depth < 6 && (!Array.isArray(value) || value.length <= 64) && (!value || Object.keys(value).length <= 64)) {
      box.classList.add('cw-json'); const array = schema.type === 'array', collection = value && typeof value === 'object' ? structuredClone(value) : array ? [] : {}, rows = el('div');
      const rebuild = () => { rows.replaceChildren(); for (const [key,v] of Object.entries(collection)) { const row = el('div', undefined, 'cw-property'), caption = el('span', array ? 'Item ' + (Number(key) + 1) : key), editor = el('div'); editor.append(tree(array ? schema.items : typeof schema.additionalProperties === 'object' ? schema.additionalProperties : { type:'string' }, v, next => { collection[key] = next; changed(collection); }, label + ' ' + key, depth + 1)); const remove = el('button', 'Remove'); remove.type='button'; remove.onclick=()=>{ if(array)collection.splice(Number(key),1);else delete collection[key]; changed(collection); rebuild(); }; editor.append(remove); row.append(caption,editor); rows.append(row); } };
      const add = el('button', array ? 'Add item' : 'Add entry'); add.type='button'; const name=el('input'); name.setAttribute('aria-label',label+' entry name'); name.placeholder='Entry name';
      add.onclick=()=>{ if(Object.keys(collection).length>=64){message('Use the complete JSON editor for more than 64 entries.');return;} if(array){collection.push(initial(schema.items));}else{const key=name.value.trim();if(!key||['__proto__','prototype','constructor'].includes(key)||Object.hasOwn(collection,key)){message('Enter a unique entry name.');return;}collection[key]=initial(typeof schema.additionalProperties==='object'?schema.additionalProperties:{type:'string'});name.value='';}changed(collection);rebuild();};
      box.append(rows);if(!array)box.append(name);box.append(add);rebuild();return box;
    }
    let input;
    if (schema.enum || schema.type === 'boolean' || Object.hasOwn(schema,'const')) {
      input=el('select'); const options=schema.enum || (Object.hasOwn(schema,'const') ? [schema.const] : [true,false]);
      for(const optionValue of options){const option=el('option',String(optionValue));option.value=String(optionValue);option.selected=optionValue===value;input.append(option);} input.onchange=()=>changed(schema.type==='boolean'?input.value==='true':Object.hasOwn(schema,'const')?schema.const:input.value);
    } else if (schema.type === 'object' || schema.type === 'array') {
      input=el('textarea');input.value=JSON.stringify(value ?? initial(schema),null,2);input.setAttribute('aria-label',label+' complete JSON');input.oninput=()=>{try{changed(JSON.parse(input.value));input.setCustomValidity('');}catch{input.setCustomValidity('Enter valid JSON.');}};
    } else if (schema.type === 'null') { box.append(el('span','null')); return box;
    } else {
      input=el('input');input.type=schema.type==='number'||schema.type==='integer'?'number':'text';input.value=value===null||value===undefined?'':String(value);
      if(input.type==='number'){input.step=schema.type==='integer'?'1':'any'; for(const c of schema.checks||[]){if(c.kind==='min')input.min=String(c.value);if(c.kind==='max')input.max=String(c.value);}}
      else for(const c of schema.checks||[]){if(c.kind==='max')input.maxLength=c.value;if(c.kind==='min')input.minLength=c.value;}
      input.oninput=()=>changed(input.type==='number'?Number(input.value):input.value);
    }
    input.setAttribute('aria-label',label);box.append(input);return box;
  }
  function fieldRow(field, saved) {
    const row=el('details',undefined,'cw-field');row.dataset.key=field.key;row.dataset.dirty=String(drafts.has(field.key));
    const summary=el('summary'), title=el('span',pretty(field.key),'cw-label'), key=el('code',field.key,'cw-key'), meta=el('span',field.apply.replace(/_/g,' ')+' · '+field.unit,'cw-meta');summary.append(title,key,meta);row.append(summary);
    const body=el('div',undefined,'cw-body'), help=el('p',field.description,'cw-help'), states=el('div',undefined,'cw-values');
    states.append(el('span','Saved: '+shown(saved.persisted)),el('span','Effective: '+shown(saved.effective)+' · '+saved.source));
    if(saved.mismatch)states.append(el('span',saved.source==='deployment'?'Deployment override remains effective.':'Saved and effective values differ; read back after activation or restart.','cw-pending'));
    if(snapshot.effective_components?.[field.key])states.append(el('span','Resolved component: '+JSON.stringify(snapshot.effective_components[field.key])));
    const aliases=catalogue.filter(f=>f.alias_for?.key===field.key&&snapshot.settings.find(s=>s.key===f.key)?.effective!==null);
    if(aliases.length)states.append(el('span','Legacy overrides: '+aliases.map(f=>f.key).join(', ')+'. Editing a structured property also removes its corresponding instance alias; unrelated limits are retained.','cw-pending'));
    if(field.alias_for)states.append(el('span','Overrides '+field.alias_for.key+'.'+field.alias_for.property));
    if(field.template_default!==null&&field.template_default!==undefined)states.append(el('span','Default template: '+field.template_default));
    body.append(help,states);
    if(field.apply==='read_only'){body.append(el('p',field.description || 'Imported value is retained and hidden; configure it through its owning process.','cw-readonly'));}
    else {
      const enabledLabel=el('label',undefined,'cw-enabled'), enabled=el('input');enabled.type='checkbox'; const raw=drafts.has(field.key)?drafts.get(field.key):saved.persisted;enabled.checked=raw!==null;enabledLabel.append(enabled,document.createTextNode('Set an instance value'));
      const editor=el('div');let value=raw;
      const rebuild=()=>{editor.replaceChildren();if(!enabled.checked){editor.append(el('p','Uses the owning engine default or saved role profile.','cw-note'));return;}
        if(field.secret){const input=el('input');input.type='password';input.autocomplete='new-password';input.setAttribute('aria-label',pretty(field.key));input.placeholder=saved.persisted?'Configured — leave blank to keep':'Enter secret';input.value=drafts.get(field.key)||'';input.oninput=()=>{if(input.value)draft(field,input.value);else{explicitDrafts.delete(field.key);rebuildDrafts();invalid(field.key,'');controls();}};editor.append(input,el('p','The stored secret is never returned. Uncheck to remove it.','cw-note'));}
        else{let parsed=value;const s=schemaFor(field.constraints,undefined);if(s.type==='object'||s.type==='array'){try{parsed=typeof value==='string'?JSON.parse(value):value;}catch{const input=el('textarea');input.value=value||'';input.setAttribute('aria-label',pretty(field.key)+' complete JSON');input.oninput=()=>{draft(field,input.value);try{JSON.parse(input.value);invalid(field.key,'');}catch{invalid(field.key,'Enter valid JSON.');}};editor.append(input);return;}}
        else if(s.type==='number'||s.type==='integer')parsed=Number(value);else if(s.type==='boolean')parsed=value==='true';
        editor.append(tree(field.constraints,parsed,v=>{value=typeof v==='object'?JSON.stringify(v):String(v);draft(field,value);},pretty(field.key)));
        if(field.model_choices?.length){const input=editor.querySelector('input'),list=el('datalist');list.id='cw-models-'+field.key;for(const choice of field.model_choices){const option=el('option');option.value=choice.value;option.label=choice.provider+' · '+choice.api;list.append(option);}if(input)input.setAttribute('list',list.id);editor.append(list,el('p','Suggestions use the core API registry. Custom models and native CLI identifiers still require their adapter capabilities.','cw-note'));}}
      };
      enabled.onchange=()=>{if(!enabled.checked){value=null;draft(field,null);}else{value=field.secret?'':saved.persisted??(typeof initial(field.constraints)==='object'?JSON.stringify(initial(field.constraints)):String(initial(field.constraints)));if(!field.secret)draft(field,value);}rebuild();controls();};
      body.append(enabledLabel,editor);rebuild();
    }
    const error=el('div',errors.get(field.key)||'','cw-error');error.id='cw-error-'+field.key;error.setAttribute('role','alert');body.append(error);row.append(body);
    for(const input of row.querySelectorAll('input,select,textarea')){input.setAttribute('aria-describedby',error.id);input.setAttribute('aria-invalid',String(errors.has(field.key)));}return row;
  }
  function renderPolicies() {
    const target=$('cw-policies');target.replaceChildren();
    $('cw-computer-profiles').hidden=tab!=='computer';
    if(!['models','scanning','computer','retrieval'].includes(tab))return;
    for(const p of policies.filter(p=>tab==='models'?['architect','dreamer','normalizer'].includes(p.role):tab==='scanning'?['initial_scan','enrichment'].includes(p.role):tab==='computer'?p.role==='computer_use':true)){
      const card=el('details',undefined,'cw-policy'), summary=el('summary',pretty(p.role)+' · '+p.effective.provider+'/'+p.effective.model+' · '+p.status);card.append(summary);
      const info=el('div',undefined,'cw-values');info.append(el('span','Requested: '+p.requested.adapter+' / '+p.requested.api+' / '+p.requested.model),el('span','Effective: '+p.effective.adapter+' / '+p.effective.api+' · effort '+(p.effective.effort??'default')+' · temperature '+(p.effective.temperature??'omitted')+' · retention '+(p.effective.retention??'unattested')),el('span','Run cap '+p.budget.run_amount+'; day cap '+p.budget.day_amount+' '+p.billing.currency+' · '+p.billing.channel),el('span',p.diagnostics.map(d=>d.field+': '+d.message).join(' · ')||'Policy is configured; actual dispatch still requires admission.'));card.append(info);target.append(card);
    }
    if(tab==='computer')target.append(el('p','Enablement is setup only. Each session needs explicit scope, permissions and finite limits. Native CLI capabilities depend on that adapter; an unqualified backend remains unavailable.','cw-note'));
  }
  function render() {
    if(!snapshot)return;const query=$('cw-search').value.toLowerCase().trim(),fields=catalogue.filter(f=>query?[f.key,f.description,f.owner,pretty(f.key)].join(' ').toLowerCase().includes(query):f.category===tab), open=new Set([...$('cw-fields').children].filter(n=>n.open).map(n=>n.dataset.key));
    $('cw-fields').replaceChildren(...fields.map(field=>{const row=fieldRow(field,snapshot.settings.find(s=>s.key===field.key)||{persisted:null,effective:null,source:'default',mismatch:false});row.open=open.has(field.key)||!!query||errors.has(field.key);return row;}));
    $('cw-count').textContent=fields.length+' of '+catalogue.length+' settings';$('cw-panel').setAttribute('aria-labelledby','cw-tab-'+tab);renderPolicies();
    const state=$('cw-state');state.replaceChildren();const pending=snapshot.settings.filter(s=>s.mismatch&&s.source!=='deployment'&&s.apply!=='read_only'), deployment=snapshot.settings.filter(s=>s.source==='deployment');
    state.append(el('p','Saved revision '+snapshot.revision.slice(7,19)),el('p',pending.length+' saved/effective differences',pending.length?'cw-pending':'cw-active'),el('p',deployment.length+' deployment overrides'),el('p',snapshot.settings.filter(s=>s.apply==='restart'&&s.mismatch).length+' restart-only differences'));
    if(lastReceipt)state.append(el('p','Last saved operation: '+lastReceipt.operation_id+' · '+lastReceipt.status));
    $('cw-diagnostics').textContent=snapshot.diagnostics.join(' · ');document.querySelector('[name=_config_revision]').value=snapshot.revision;controls();
  }
  async function load() {
    root.dataset.loading='true';const ticket=++generation;try{const [state,fields]=await Promise.all([api('/api/config/v1'),api('/api/config/v1/catalogue')]);if(ticket!==generation)return;snapshot=state.result;catalogue=fields.result;rebuildDrafts();
      for(const saved of snapshot.settings)if(!catalogue.some(f=>f.key===saved.key))catalogue.push({key:saved.key,owner:'imported',category:'advanced',description:'Unknown imported value: retained and redacted. Its owning process must configure it.',unit:'value',apply:'read_only',secret:true,protected:true,constraints:{type:'string'}});
      render();message(drafts.size?'Read back current values; drafts are retained. Save uses this revision.':captured?'Read back current values; the captured request is still uncertain. Retry it to recover its receipt.':'Saved and effective configuration loaded.');
      try{const roles=await api('/api/config/v1/roles');if(ticket!==generation)return;policies=roles.result;renderPolicies();}catch(error){if(ticket===generation)$('cw-policies').replaceChildren(el('p','Effective role policies unavailable: '+error.message,'cw-error'));}
      return true;
    }catch(error){message('Read back failed: '+error.message+'. Existing drafts remain available.');return false;}
    finally{if(ticket===generation)root.dataset.loading='false';}
  }
  async function perform(request) {
    if(busy)return;busy=true;captured=request;controls();message('Saving the captured configuration request…');
    try{const result=await api(request.path,request.body);captured=null;lastReceipt=result.receipt;snapshot=result.result;drafts.clear();explicitDrafts.clear();errors.clear();preview=null;$('cw-diff').replaceChildren();render();const readback=await load();message('Saved '+result.receipt.changed_keys.length+' settings. '+(result.effective_state||result.activation?.message||'Read back effective values before starting new work.')+(readback?'':' Read back failed; inspect configuration before new work.'));}
    catch(error){if(error.refused){captured=null;const key=error.message.match(/CONFIG_(?:INVALID_SETTING|READ_ONLY|UNKNOWN_KEY):\s*([A-Z_]+)/)?.[1];if(key)invalid(key,error.message);for(const f of error.fields||[])if(f.field)invalid(f.field.replace(/^updates\./,''),f.message);message(error.message+'. Drafts were retained; read back after a revision conflict.');render();}else message('Save acknowledgement is uncertain: '+error.message+'. Retry the exact captured request to recover; no new operation has been started.');}
    finally{busy=false;controls();}
  }
  $('cw-save').onclick=()=>{for(const input of $('cw-fields').querySelectorAll('input,select,textarea'))if(!input.checkValidity()){const row=input.closest('.cw-field');invalid(row.dataset.key,input.validationMessage);row.open=true;input.focus();return;}if(!drafts.size||captured||busy)return;perform({path:'/api/config/v1/apply',body:{expected_revision:snapshot.revision,operation_id:crypto.randomUUID(),updates:Object.fromEntries(drafts)}});};
  $('cw-discard').onclick=()=>{drafts.clear();explicitDrafts.clear();errors.clear();render();message('Drafts discarded; saved configuration is unchanged.');};
  $('cw-refresh').onclick=load;$('cw-retry').onclick=()=>{if(captured)perform(captured);};
  $('cw-undo').onclick=()=>{if(!lastReceipt||drafts.size||captured||busy)return;perform({path:'/api/config/v1/undo',body:{expected_revision:snapshot.revision,operation_id:crypto.randomUUID(),undo_operation_id:lastReceipt.operation_id}});};
  const invalidatePreview=()=>{preview=null;$('cw-diff').replaceChildren();controls();};$('cw-template').onchange=invalidatePreview;$('cw-template-scope').onchange=invalidatePreview;
  $('cw-preview').onclick=async()=>{if(busy||captured||drafts.size)return;busy=true;controls();const body={template:$('cw-template').value,...($('cw-template-scope').value==='category'?{keys:catalogue.filter(f=>f.category===tab).map(f=>f.key)}:{})};try{const response=await api('/api/config/v1/template/preview',body);preview={body,result:response.result};snapshot.revision=response.result.revision;const diff=$('cw-diff');diff.replaceChildren(el('p',response.result.diff.length+' changes; '+response.result.retained.length+' protected or unknown settings retained.'));for(const change of response.result.diff){const row=el('div',undefined,'cw-diff-row');row.append(el('code',change.key),el('div',shown(change.before)+' → '+shown(change.after)+' · '+change.apply));diff.append(row);}message('Preview only. Review this exact diff before applying.');}catch(error){invalidatePreview();message('Preview failed: '+error.message);}finally{busy=false;controls();}};
  $('cw-apply-template').onclick=()=>{if(!preview||busy||captured||drafts.size)return;perform({path:'/api/config/v1/template/apply',body:{...preview.body,expected_revision:preview.result.revision,expected_template_hash:preview.result.template_hash,operation_id:crypto.randomUUID()}});};
  function selectTab(button) {tab=button.dataset.tab;for(const node of $('cw-tabs').children){node.setAttribute('aria-selected',String(node===button));node.tabIndex=node===button?0:-1;}invalidatePreview();render();}
  for(const button of $('cw-tabs').children){button.onclick=()=>selectTab(button);button.onkeydown=event=>{const buttons=[...$('cw-tabs').children],index=buttons.indexOf(button);let next;if(event.key==='ArrowRight')next=(index+1)%buttons.length;if(event.key==='ArrowLeft')next=(index+buttons.length-1)%buttons.length;if(event.key==='Home')next=0;if(event.key==='End')next=buttons.length-1;if(next!==undefined){event.preventDefault();buttons[next].focus();selectTab(buttons[next]);}};}
  $('cw-search').oninput=render;$('cw-copy-restart').onclick=async()=>{try{await navigator.clipboard.writeText($('cw-restart-command').textContent);message('Restart command copied. Run it in your terminal, then read back.');}catch{message('Copy the displayed restart command, then run it in your terminal.');}};
  let computerSchemas=null,computerProfiles=[],computerDocument=null,computerDraft=null,computerDirty=false,computerSave=null,computerBusy=false,computerReadGeneration=0;
  const computerMessage=text=>$('cw-computer-status').textContent=text;
  function computerControls(){const locked=computerBusy||!!computerSave;
    for(const id of ['cw-computer-kind','cw-computer-id','cw-computer-read'])$(id).disabled=locked;
    $('cw-computer-import').disabled=locked||!computerDocument;$('cw-computer-save').disabled=locked||!computerDocument||!computerDirty;
    $('cw-computer-retry').hidden=!computerSave||computerBusy;
    for(const input of $('cw-computer-editor').querySelectorAll('input,select,textarea,button'))input.disabled=locked;
  }
  function computerNames(){const list=$('cw-computer-names');list.replaceChildren();for(const profile of computerProfiles.filter(row=>row.kind===$('cw-computer-kind').value)){const option=el('option');option.value=profile.id;list.append(option);}}
  async function computerCatalogue(){const result=await api('/api/architect/v1/computer/profiles');computerSchemas=result.schemas;computerProfiles=result.profiles;computerNames();}
  function computerEdit(){const target=$('cw-computer-editor');target.replaceChildren();if(!computerDocument)return;
    target.append(tree(computerSchemas[computerDocument.kind],computerDraft,value=>{computerDraft=structuredClone(value);computerDirty=true;computerControls();},'Computer '+computerDocument.kind));computerControls();}
  function computerInvalidate(){computerReadGeneration++;computerDocument=null;computerDraft=null;computerDirty=false;$('cw-computer-editor').replaceChildren();computerControls();}
  for(const id of ['cw-computer-kind','cw-computer-id'])$(id).addEventListener(id.endsWith('-id')?'input':'change',()=>{computerInvalidate();computerNames();computerMessage('Selection changed. Read the exact named profile before editing.');});
  $('cw-computer-profiles').addEventListener('toggle',async()=>{if(!$('cw-computer-profiles').open||computerSchemas)return;try{await computerCatalogue();computerMessage('Select a name to read, or enter a new name.');}catch(error){computerMessage(error.message);}});
  $('cw-computer-read').onclick=async()=>{if(computerBusy||computerSave)return;if(!$('cw-computer-id').checkValidity()||!$('cw-computer-id').value.trim()){computerMessage('Enter a profile name using letters, digits, underscore or hyphen.');return;}
    const selection={kind:$('cw-computer-kind').value,id:$('cw-computer-id').value.trim()},ticket=++computerReadGeneration;computerBusy=true;computerControls();
    try{if(!computerSchemas)await computerCatalogue();const response=await api('/api/architect/v1/computer/profiles/read?'+new URLSearchParams(selection));if(ticket!==computerReadGeneration)return;
      computerDocument=response.result;computerDraft=computerDocument.value||{...initial(computerSchemas[selection.kind]),id:selection.id};computerDirty=!computerDocument.value;computerEdit();
      computerMessage((computerDocument.value?'Saved profile loaded.':'New unsaved profile.')+(computerDocument.runtime_current===false?' This worker needs fresh qualification before use.':'')+' Saving does not enable Computer Use or issue a grant.');
    }catch(error){if(ticket===computerReadGeneration)computerMessage(error.message);}finally{if(ticket===computerReadGeneration){computerBusy=false;computerControls();}}};
  $('cw-computer-import').onchange=async()=>{const file=$('cw-computer-import').files[0],ticket=computerReadGeneration;if(!file||!computerDocument)return;
    try{if(file.size>65536)throw new Error('COMPUTER_CONFIGURATION_BYTE_BOUND');const value=JSON.parse(await file.text());if(ticket!==computerReadGeneration)return;
      const imported=value.schema==='dreamgraph.browser_runtime_qualification.v1'?value.worker:value;if(imported.id!==computerDocument.id)throw new Error('COMPUTER_CONFIGURATION_ID_MISMATCH');
      computerDraft=imported;computerDirty=true;computerEdit();computerMessage('Imported into draft. Review the complete scope and pins before saving.');
    }catch(error){if(ticket===computerReadGeneration)computerMessage(error.message);}finally{$('cw-computer-import').value='';}};
  async function saveComputerProfile(request){if(computerBusy)return;computerBusy=true;computerSave=request;computerControls();computerMessage('Saving the exact reviewed profile…');
    try{const response=await api('/api/architect/v1/computer/profiles/apply',request);computerSave=null;computerDocument=response.result;computerDraft=response.result.value;computerDirty=false;computerEdit();computerMessage(response.effective_state+(response.result.runtime_current===false?' Worker qualification is not current.':''));await computerCatalogue();}
    catch(error){if(error.refused){computerSave=null;computerMessage(error.message+(error.fields?.length?' · '+error.fields.map(field=>field.field+': '+field.message).join(' · '):'')+'. Draft retained; read back after a conflict.');}
      else computerMessage('Save outcome is uncertain: '+error.message+'. Recover the exact save; no new operation was started.');}
    finally{computerBusy=false;computerControls();}}
  $('cw-computer-save').onclick=()=>{if(!computerDocument||!computerDirty||computerSave||computerBusy)return;for(const input of $('cw-computer-editor').querySelectorAll('input,select,textarea'))if(!input.checkValidity()){input.focus();computerMessage(input.validationMessage);return;}
    saveComputerProfile({kind:computerDocument.kind,id:computerDocument.id,expected_revision:computerDocument.revision,operation_id:crypto.randomUUID(),value:structuredClone(computerDraft)});};
  $('cw-computer-retry').onclick=()=>{if(computerSave)saveComputerProfile(computerSave);};
  window.addEventListener('beforeunload',event=>{if(drafts.size||captured||computerDirty||computerSave){event.preventDefault();event.returnValue='';}});
  load();
})();`;
