/** Compact surface only. Definitions, timing, policy, admission and history stay in the daemon. */
import { CONTEXT_MENU_CSS, CONTEXT_MENU_SCRIPT } from "./context-menu.js";
export function renderScheduleWorkspace():string{return `
<section id="schedule-workspace" aria-label="Schedule workspace">
  <header class="sw-toolbar"><h1>Schedules</h1><span id="sw-runtime">Connecting to authority…</span><button id="sw-refresh" type="button">Refresh</button><button id="sw-new" type="button" class="btn btn-primary">New schedule</button></header>
  <nav id="sw-tabs" role="tablist" aria-label="Schedule views"><button role="tab" aria-selected="true" aria-controls="sw-schedules" id="sw-tab-schedules" data-tab="schedules">Schedules</button><button role="tab" aria-selected="false" tabindex="-1" aria-controls="sw-upcoming" id="sw-tab-upcoming" data-tab="upcoming">Upcoming</button><button role="tab" aria-selected="false" tabindex="-1" aria-controls="sw-runs" id="sw-tab-runs" data-tab="runs">Runs</button></nav>
  <div id="sw-status" role="status" aria-live="polite"></div><button id="sw-retry" type="button" hidden>Retry the same captured request</button>
  <div class="sw-layout"><div class="sw-main">
    <section id="sw-schedules" role="tabpanel" aria-labelledby="sw-tab-schedules"><div class="sw-filter"><label>Find <input id="sw-search" type="search" placeholder="Name, action or scope"></label><label>State <select id="sw-filter"><option value="all">All</option><option value="enabled">Enabled</option><option value="paused">Paused</option><option value="blocked">Blocked</option><option value="error">Error</option></select></label></div><p id="sw-count"></p><div id="sw-list" aria-label="Schedule list"></div></section>
    <section id="sw-upcoming" role="tabpanel" aria-labelledby="sw-tab-upcoming" hidden><p>Read-only forecasts from the same evaluator used for dispatch. Paused schedules are shown as intent, without dispatch.</p><div id="sw-forecast"></div></section>
    <section id="sw-runs" role="tabpanel" aria-labelledby="sw-tab-runs" hidden><p id="sw-run-count"></p><div id="sw-run-list"></div></section>
  </div><aside class="sw-inspector" aria-label="Schedule details"><div id="sw-detail"><p>Select a schedule to inspect its definition, policy and history.</p></div>
    <form id="sw-editor" hidden><h2 id="sw-edit-title">New schedule</h2><p>Save disabled. Enable separately after reviewing the preview.</p>
      <label>Name <input name="name" required maxlength="256"></label><label>Action <select name="action"></select></label>
      <label>Trigger <select name="trigger_type"><option value="interval">Elapsed interval</option><option value="cron_like">Calendar / cron</option><option value="after_cycles">Engine cycles</option><option value="on_idle">User inactivity</option></select></label>
      <label data-trigger="interval on_idle">Duration <span class="sw-duration"><input name="duration" type="number" min="0.001" step="any" value="1"><select name="unit"><option value="3600000">hours</option><option value="60000">minutes</option><option value="1000">seconds</option><option value="1">milliseconds</option></select></span></label>
      <label data-trigger="cron_like">Cron <input name="cron" placeholder="0 6 * * *"><small>Five fields: minute hour day month weekday; *, values, ranges, lists and steps. No seconds or names.</small></label>
      <label data-trigger="after_cycles">Every N cycles <input name="cycle_interval" type="number" min="1" value="10"></label>
      <label>Timezone <input name="timezone" value="UTC" required list="sw-zones"><datalist id="sw-zones"><option value="UTC"><option value="Europe/Helsinki"><option value="America/New_York"><option value="Asia/Tokyo"></datalist></label>
      <label>Repeated local time <select name="fold_policy"><option value="once">Once (default)</option><option value="both">Both occurrences</option></select></label>
      <label>Missed occurrence <select name="missed_policy"><option value="skip">Skip with reason</option><option value="catch_up_once">Catch up once</option></select></label>
      <label>Maximum runs <input name="max_runs" type="number" min="0" placeholder="Blank = unlimited; 0 = no runs"></label>
      <div id="sw-parameter-fields"></div><div id="sw-field-errors" role="alert"></div>
      <div class="sw-actions"><button id="sw-preview" type="button">Preview and validate</button><button id="sw-save" type="submit" class="btn btn-primary">Save disabled</button><button id="sw-close-editor" type="button">Close editor</button></div>
      <div id="sw-preview-result"></div>
    </form>
    <details class="sw-debt"><summary>Graph currency and pending knowledge</summary><div id="sw-debt"></div></details>
  </aside></div>
</section>
<style>${SCHEDULE_WORKSPACE_CSS}${SCHEDULE_WORKSPACE_LAYOUT_CSS}${CONTEXT_MENU_CSS}</style><script src="/schedules/workspace.js" defer></script>`;}

export const SCHEDULE_WORKSPACE_CSS=`
#schedule-workspace{--sw-line:#383838;--sw-muted:#aaa;color:#e0e0e0;font:12px/1.45 system-ui,sans-serif}#schedule-workspace h1{font-size:18px;margin:0}#schedule-workspace h2{font-size:14px;margin:8px 0}#schedule-workspace h3{font-size:12px;margin:8px 0 4px}#schedule-workspace p{margin:5px 0;color:var(--sw-muted)}.sw-toolbar,.sw-filter,.sw-actions,#sw-tabs{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.sw-toolbar{padding:6px 0}.sw-toolbar #sw-runtime{margin-right:auto}.sw-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(300px,390px);border-top:1px solid var(--sw-line);min-height:60vh}.sw-main{padding:8px 10px 8px 0;min-width:0}.sw-inspector{border-left:1px solid var(--sw-line);padding:8px 10px;min-width:0}#sw-tabs{gap:2px;margin-top:4px}#sw-tabs button{border-bottom:2px solid transparent}#sw-tabs [aria-selected=true]{border-bottom-color:#82aaff;background:#303030}#schedule-workspace button{padding:4px 8px;border:1px solid #444;background:#282828;color:inherit;border-radius:3px;cursor:pointer;font:inherit}#schedule-workspace button:hover{background:#363636}#schedule-workspace button:focus-visible,#schedule-workspace input:focus-visible,#schedule-workspace select:focus-visible,#schedule-workspace textarea:focus-visible{outline:2px solid #9db8dc;outline-offset:2px}#schedule-workspace button:disabled{opacity:.45;cursor:default}#schedule-workspace input,#schedule-workspace select,#schedule-workspace textarea{background:#151515;border:1px solid #444;color:inherit;border-radius:2px;padding:4px 6px;font:inherit;max-width:100%;min-width:0;box-sizing:border-box}.sw-filter input{width:220px}.sw-filter label{display:flex;align-items:center;gap:5px}.sw-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:5px;padding:7px 8px;border-bottom:1px solid var(--sw-line)}.sw-row.is-selected{background:#30343a;border-left:2px solid #92a9c8}.sw-row .sw-select{text-align:left;border:0!important;padding:0!important;background:transparent!important;overflow-wrap:anywhere}.sw-row small,.sw-run small{display:block;color:var(--sw-muted)}.sw-run{padding:7px 8px;border-bottom:1px solid var(--sw-line);overflow-wrap:anywhere}.sw-run.is-running{border-left:2px solid #75b69c}.sw-row-status{font-size:11px;align-self:center;color:#aec1d4}.sw-row-status.is-blocked{color:#d9af72}#sw-editor>label,#sw-parameter-fields>label{display:grid;grid-template-columns:130px minmax(0,1fr);gap:6px;margin:6px 0;align-items:start}#sw-editor small{grid-column:2;color:var(--sw-muted)}.sw-duration{display:flex;gap:4px}.sw-duration input{width:90px}.sw-duration select{flex:1}#sw-editor textarea{min-height:50px;resize:vertical}.sw-actions{margin-top:8px}#sw-status{min-height:20px;padding:4px 0}#sw-status.is-error,#sw-field-errors{color:#eeb7a0}#sw-preview-result, #sw-detail{overflow-wrap:anywhere}#schedule-workspace pre{white-space:pre-wrap;font:11px/1.4 ui-monospace,monospace;background:#171717;padding:6px;max-height:250px;overflow:auto}#schedule-workspace details{border-top:1px solid var(--sw-line);padding:6px 0}#schedule-workspace summary{cursor:pointer}.sw-debt{margin-top:8px}.sw-state{font-weight:600;color:#8fbf9f}#schedule-workspace [hidden]{display:none!important}#schedule-workspace [aria-invalid=true]{border-color:#d89c80}#schedule-workspace .sw-confirm{border-left:2px solid #d0a565;padding:6px;margin:6px 0}#schedule-workspace .sw-menu{position:fixed;z-index:80;background:#242424;border:1px solid #555;padding:4px;box-shadow:0 6px 20px #0008;display:grid;gap:2px;min-width:145px}#schedule-workspace .sw-menu button{text-align:left;border:0}@media(max-width:850px){.sw-layout{grid-template-columns:1fr}.sw-inspector{border-left:0;border-top:1px solid var(--sw-line);padding:8px 0}.sw-main{padding-right:0}.sw-toolbar #sw-runtime{flex-basis:100%;order:2}}`;

/** Correct the three-cell list rows and let the workspace fill its host pane. */
export const SCHEDULE_WORKSPACE_LAYOUT_CSS=`
#schedule-workspace{display:flex;flex-direction:column;height:100%;min-height:min(680px,calc(100dvh - 88px));min-width:0;overflow:hidden;--sw-line:#344257;--sw-muted:#9eafc4;color:#e4ecf8}
#schedule-workspace .sw-toolbar{min-height:32px;padding:4px 8px;gap:7px}
#schedule-workspace #sw-tabs{margin:0;padding:0 8px}
#schedule-workspace #sw-status{min-height:0;padding:3px 8px}
#schedule-workspace .sw-layout{flex:1;min-height:0;min-width:0;grid-template-columns:minmax(0,1fr) clamp(260px,32%,390px);overflow:hidden}
#schedule-workspace .sw-main,#schedule-workspace .sw-inspector{min-height:0;overflow:auto;overscroll-behavior:contain}
#schedule-workspace .sw-main{padding:8px}
#schedule-workspace .sw-row{grid-template-columns:minmax(0,1fr) minmax(70px,max-content) 27px;align-items:center;column-gap:8px;padding:5px 7px;min-width:0}
#schedule-workspace .sw-row .sw-select{display:block;min-width:0;width:100%;max-width:100%;overflow:hidden;overflow-wrap:normal;white-space:nowrap;text-overflow:ellipsis}
#schedule-workspace .sw-row .sw-select small{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
#schedule-workspace .sw-row-status{min-width:0;max-width:126px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;text-align:right}
#schedule-workspace .sw-row>button:last-child{width:27px;min-width:27px;height:27px;padding:0;text-align:center}
#schedule-workspace .sw-invalid{margin:8px 0;padding:8px 10px;border:1px solid #826339;border-left:3px solid #d9ab63;background:#2b251f}
#schedule-workspace .sw-invalid strong{color:#f0c582}
#schedule-workspace .sw-invalid pre{max-height:160px;word-break:break-word}
@media(max-width:850px){#schedule-workspace{height:100%;min-height:0;overflow:hidden}#schedule-workspace .sw-layout{display:block;overflow:auto}#schedule-workspace .sw-main,#schedule-workspace .sw-inspector{overflow:visible}#schedule-workspace .sw-inspector{padding:8px}}
@media(max-width:460px){#schedule-workspace .sw-row{grid-template-columns:minmax(0,1fr) 27px;row-gap:1px}#schedule-workspace .sw-row-status{grid-column:1;grid-row:2;text-align:left;max-width:100%}#schedule-workspace .sw-row>button:last-child{grid-column:2;grid-row:1 / span 2}}
`;

/** Served as JavaScript: executable browser tests exercise this exact source. */
export const SCHEDULE_WORKSPACE_SCRIPT=CONTEXT_MENU_SCRIPT+String.raw`(() => {
 'use strict';
 const root=document.getElementById('schedule-workspace'); if(!root)return;
 const $=id=>document.getElementById(id), form=$('sw-editor');
 let snapshot=null,selected=null,tab='schedules',editTarget=null,dirty=false,busy=false,pending=null,refreshing=null,preview=null,menu=null;
 const navigation=new URLSearchParams(window.location.search),requestedSchedule=navigation.get('schedule'),requestedRevision=navigation.get('revision'),requestedView=navigation.get('view')||'inspect';let navigationHandled=false;
 const controls=()=>Array.from(root.querySelectorAll('button')).filter(b=>b.dataset.mutation==='true');
 const message=(text,error=false)=>{$('sw-status').textContent=text;$('sw-status').classList.toggle('is-error',error);};
 const element=(tag,text,attrs={})=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;for(const [key,value]of Object.entries(attrs))node.setAttribute(key,String(value));return node;};
 const button=(text,click,mutation=false)=>{const node=element('button',text,{type:'button'});node.dataset.mutation=String(mutation);node.disabled=mutation&&(busy||!!pending);node.addEventListener('click',click);return node;};
 const stamp=(value,zone)=>{if(!value)return 'Unknown / activity-dependent';const date=new Date(value);if(!Number.isFinite(date.getTime()))return 'Unknown time';return date.toLocaleString(undefined,{timeZone:zone||undefined})+(zone?' '+zone:' local');};
 const field=name=>form.elements.namedItem(name);
 const setField=(name,value)=>{const node=field(name);if(node)node.value=value===null||value===undefined?'':String(value);};
 async function json(path,body){const reply=await fetch(path,{credentials:'same-origin',headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{method:'POST',body:JSON.stringify(body)}:{})});const value=await reply.json();if(!reply.ok){const err=new Error(value.error||value.message||('HTTP '+reply.status));err.fields=value.fields||[];err.status=reply.status;throw err;}return value;}
 async function refresh(force){if(refreshing){const result=await refreshing;return force===true?refresh(true):result;}const work=(async()=>{try{const value=await json('/api/schedules/v2?workspace=1');if(value.schema!=='dreamgraph.schedule_snapshot.v2')throw new Error('Schedule schema unavailable');snapshot=value;
   $('sw-runtime').textContent=(value.config.enabled?'Scheduler enabled':'Scheduler paused')+' · revision '+value.revision+' · max '+value.config.max_runs_per_hour+'/hour';
   if(selected&&!value.schedules.some(s=>s.id===selected))selected=null;
   render();const navigationMessage=await applyNavigation();if(!busy&&!pending)message(navigationMessage||('Authority readback · '+stamp(new Date().toISOString())),!!navigationMessage&&navigationMessage.startsWith('Captured'));return true;
  }catch(error){message('Authority unavailable. Last view retained; commands require fresh admission. '+error.message,true);return false;}})();refreshing=work;try{return await work;}finally{if(refreshing===work)refreshing=null;}}
 function render(){renderList();renderRuns();renderDebt();if(form.hidden)renderDetail();if(tab==='upcoming')void forecast();}
 async function applyNavigation(){
  if(navigationHandled||!requestedSchedule)return null;navigationHandled=true;
  const target=snapshot.schedules.find(schedule=>schedule.id===requestedSchedule);
  if(!target)return 'Captured schedule is unavailable: '+requestedSchedule+'. No replacement selected.';
  selected=target.id;
  if(requestedRevision!==null&&(!/^\d+$/.test(requestedRevision)||!Number.isSafeInteger(Number(requestedRevision))||Number(requestedRevision)!==target.definition_revision)){
   render();return 'Captured schedule revision changed. Current definition is shown for inspection; reopen its actions before changing or running it.';
  }
  render();
  if(requestedView==='edit')openEditor(structuredClone(target));
  else if(requestedView==='history')selectTab('runs');
  else if(requestedView==='preview'){if(!await showPreview(structuredClone(target)))return 'Captured schedule preview refused: '+$('sw-status').textContent;}
  else if(requestedView==='run'){if(!await confirmRun(structuredClone(target)))return 'Captured schedule run preview refused: '+$('sw-status').textContent;}
  else if(requestedView==='enable'){if(!await enable(structuredClone(target)))return 'Captured schedule enable preview refused: '+$('sw-status').textContent;}
  else if(requestedView!=='inspect')return 'Captured schedule view is unavailable. Inspect the current definition and choose an action.';
  return 'Opened captured schedule '+target.name+' at definition r'+target.definition_revision+'. Navigation did not change the definition or enqueue work.';
 }
 function filtered(){const needle=$('sw-search').value.toLowerCase(),filter=$('sw-filter').value;return snapshot.schedules.filter(s=>{
  const blocked=s.diagnostics.some(reason=>reason!=='paused');return JSON.stringify([s.name,s.action,s.parameters]).toLowerCase().includes(needle)&&(filter==='all'||filter==='enabled'&&s.enabled||filter==='paused'&&!s.enabled||filter==='error'&&s.status==='error'||filter==='blocked'&&blocked);});}
 function invalidDefinition(schedule){return schedule.diagnostics.find(reason=>reason.startsWith('invalid_definition:'));}
 function invalidDetail(reason){const raw=reason.slice('invalid_definition:'.length);try{const issues=JSON.parse(raw);if(Array.isArray(issues))return issues.map(issue=>{
   const path=Array.isArray(issue.path)&&issue.path.length?issue.path.join('.'):'Definition';
   return issue.code==='invalid_enum_value'?path+': unsupported value '+JSON.stringify(issue.received)+'. Choose one of: '+(issue.options||[]).join(', '):path+': '+(issue.message||issue.code||'Invalid value');
  }).join('\n');}catch{}return raw;}
 function renderList(){const list=$('sw-list');list.replaceChildren();if(!snapshot)return;const rows=filtered();$('sw-count').textContent=rows.length+' / '+snapshot.schedules.length+' definitions. Selection does not start work.';
  for(const schedule of rows.slice(0,500)){const captured=structuredClone(schedule),row=element('div',undefined,{class:'sw-row'+(selected===schedule.id?' is-selected':'')});
   const pick=button(schedule.name,()=>{selected=captured.id;render();});pick.className='sw-select';pick.append(element('small',schedule.action+' · '+schedule.trigger_type+' · r'+schedule.definition_revision));row.append(pick);
   const blocked=schedule.diagnostics.filter(reason=>reason!=='paused'),invalid=invalidDefinition(schedule),state=invalid?'Invalid definition':blocked.length?blocked[0]:schedule.enabled?'Enabled':'Paused';
   const status=element('span',state,{class:'sw-row-status'+(blocked.length?' is-blocked':'')});status.title=invalid?'Select to inspect and repair the definition':blocked.join('\n')||state;row.append(status);
   const more=button('⋯',event=>openMenu(event,captured));more.setAttribute('aria-label','Actions for '+schedule.name);row.append(more);row.addEventListener('contextmenu',event=>{event.preventDefault();openMenu(event,captured);});
   row.addEventListener('keydown',event=>{if(event.key==='ContextMenu'||event.key==='F10'&&event.shiftKey){event.preventDefault();openMenu(event,captured);}});list.append(row);
  }if(rows.length>500)list.append(element('p',(rows.length-500)+' definitions outside this list. Narrow the search.'));
 }
 function openMenu(event,target){const mutation=!busy&&!pending,invalid=invalidDefinition(target),reason=invalid?'Fix the invalid definition in Edit before dispatch': 'Another request or unconfirmed outcome is pending';window.DreamGraphContextMenu.open(event,[
  {label:'Edit',run:()=>openEditor(target)}, {label:'Preview',available:!invalid,reason,run:()=>showPreview(target)},
  {label:'Run now',available:mutation&&!invalid,reason,run:()=>confirmRun(target)},
  {label:target.enabled?'Pause future dispatch':'Preview and enable',available:mutation&&!invalid,reason,run:()=>target.enabled?command(target,'update',{enabled:false}):enable(target)},
  {label:'History',run:()=>{selected=target.id;selectTab('runs');}},
  {label:'Copy target',run:()=>navigator.clipboard.writeText(JSON.stringify({kind:'schedule',id:target.id,expected_revision:target.definition_revision},null,2))}
 ],event.currentTarget,'Schedule actions');}
 function closeMenu(){window.DreamGraphContextMenu.close(false);}
 window.addEventListener('dreamgraph.action.error',event=>message(event.detail,true));
 function renderDetail(){const detail=$('sw-detail'),retained=Array.from(detail.querySelectorAll('.sw-confirm,.sw-preview'));detail.replaceChildren();if(!snapshot)return;const schedule=snapshot.schedules.find(s=>s.id===selected);if(!schedule){detail.append(element('p','Select a definition, or create a disabled schedule.'));return;}
  const target=structuredClone(schedule),invalid=invalidDefinition(schedule);detail.append(element('h2',schedule.name),element('p',schedule.id+' · definition r'+schedule.definition_revision),element('p','Timezone '+schedule.timezone+' · missed '+schedule.missed_policy+' · overlap '+schedule.overlap_policy));
  const actions=element('div',undefined,{class:'sw-actions'}),duplicate=button('Duplicate disabled',()=>command(target,'duplicate'),true),inspectPreview=button('Preview',()=>showPreview(target)),dispatch=button(target.enabled?'Pause':'Preview and enable',()=>target.enabled?command(target,'update',{enabled:false}):enable(target),true),run=button('Run now',()=>confirmRun(target),true);
  if(invalid)for(const control of [duplicate,inspectPreview,dispatch,run]){control.disabled=true;control.title='Edit and fix the invalid definition first';}
  actions.append(button('Edit',()=>openEditor(target)),duplicate,inspectPreview,dispatch,run,button('Archive',()=>confirmArchive(target),true));detail.append(actions);
  if(invalid){const notice=element('div',undefined,{class:'sw-invalid',role:'alert'});
   notice.append(element('strong','Invalid legacy definition · dispatch blocked'),element('p','Edit this schedule and explicitly choose a supported value, then preview before saving.'),element('pre',invalidDetail(invalid)));
   detail.append(notice);
  }for(const reason of schedule.diagnostics.filter(reason=>reason!==invalid))detail.append(element('p','Dispatch: '+reason));
  detail.append(element('h3','Definition'),element('pre',JSON.stringify(schedule.parameters,null,2)));
  const jobs=snapshot.job_records.filter(r=>r.job.scope.includes('schedule:'+schedule.id));for(const record of jobs.filter(r=>!['succeeded','failed','cancelled','partial'].includes(r.job.state)))detail.append(jobRow(record));
  const history=element('details');history.append(element('summary','Original run snapshots ('+jobs.length+')'));for(const record of jobs.slice(-20).reverse())history.append(jobRow(record));detail.append(history);
  for(const box of retained)if(box.dataset.scheduleId===schedule.id&&Number(box.dataset.definitionRevision)===schedule.definition_revision)detail.append(box);
 }
 function jobRow(record){const job=record.job,row=element('article',undefined,{class:'sw-run'+(job.state==='running'?' is-running':'')});row.append(element('strong',job.state+' · '+record.action),element('small',job.id+' · '+stamp(job.created_at)+' · config '+job.config_revision));
  if(job.terminal_cause||record.error)row.append(element('p',job.terminal_cause||record.error));
  if(job.unknown_effects.length)row.append(element('p','Recovery required: '+job.unknown_effects.join(', ')));
  const detail=element('details');detail.append(element('summary','Admitted scope, policy, budget and result'),element('pre',JSON.stringify({scope:job.scope,input_revision:job.input_revision,budget:record.snapshot.budget,role_policies:record.snapshot.role_policies,parameters:record.parameters,receipts:job.receipt_ids,result:record.result,work_settled:record.work_settled},null,2)));row.append(detail);
  if(!['succeeded','failed','cancelled','partial'].includes(job.state))row.append(button('Cancel this run',()=>mutation('/api/schedules/v2/commands',{action:'cancel_job',target_id:job.id,expected_revision:job.fence,operation_id:crypto.randomUUID()}),true));return row;
 }
 function renderRuns(){const list=$('sw-run-list');list.replaceChildren();if(!snapshot)return;const records=snapshot.job_records.filter(r=>!selected||r.job.scope.includes('schedule:'+selected));$('sw-run-count').textContent='Showing '+records.length+' captured jobs; '+snapshot.job_total+' retained in authority. Archived definitions retain history.';
  for(const record of records.slice().reverse())list.append(jobRow(record));
  const legacy=snapshot.history.filter(row=>!row.job_id);if(legacy.length){list.append(element('h3','Legacy history — original policy unknown'));for(const row of legacy.slice(-30).reverse())list.append(element('pre',JSON.stringify(row,null,2)));}
 }
 function renderDebt(){const node=$('sw-debt');node.replaceChildren();if(!snapshot)return;const graph=snapshot.graph;node.append(element('p',graph.state.freshness+' · '+graph.state.completeness+' · r'+graph.revision.publication_sequence),element('p','Graph updated '+stamp(graph.currency.last_graph_mutation_at)),element('p','Inclusive scan '+stamp(graph.currency.last_full_scan_at)+' — historical, not a staleness test'));
  for(const reason of graph.state.reasons.slice(0,15))node.append(element('p',reason.code+': '+reason.detail));
  const dirtyRows=snapshot.dirty_regions.filter(p=>p.state!=='settled');node.append(element('p',dirtyRows.length+' pending affected scopes. Optional cognition is distinct from required reconciliation.'));
  for(const partition of dirtyRows.slice(0,30))node.append(element('pre',JSON.stringify({id:partition.id,generation:partition.generation,state:partition.state,scope:partition.scope,pending:partition.pending_stages,reason:partition.reason},null,2)));
 }
 async function previewFor(target,draft){return json('/api/schedules/v2/validate',{draft:draft||{},...(target?{target_id:target.id,expected_revision:target.definition_revision}:{})});}
 function renderPreview(parent,value){parent.replaceChildren();parent.append(element('h3','Preview — no job or model call'),element('p','Definition '+(value.definition_revision===null?'new':value.definition_revision)+' · '+(value.model_calls_possible?'Model calls possible within admitted caps':'No model calls in this action')));
  for(const occurrence of value.occurrences)parent.append(element('p',stamp(occurrence.planned_at,value.definition.timezone)+' / '+stamp(occurrence.planned_at)+' · UTC '+(occurrence.planned_at||'future activity')+' · '+occurrence.trigger_cursor));
  if(value.context_required.length)parent.append(element('p','Timing depends on '+value.context_required.join(', ')));if(!value.complete)parent.append(element('p','Bounded 32-day forecast; absence is not a promise of no future occurrence.'));
  for(const policy of value.effective_policies){const group=element('details');group.append(element('summary',policy.role+': '+policy.requested.model+' → '+policy.effective.model+' / '+policy.effective.adapter+' · '+policy.status),element('pre',JSON.stringify({requested:policy.requested,effective:policy.effective,budget:policy.budget,retention:policy.retention,billing:policy.billing,diagnostics:policy.diagnostics},null,2)));parent.append(group);}
  parent.append(element('h3',value.definition.name||'New definition'),element('pre',JSON.stringify(value.definition.parameters,null,2)),element('p',value.cost_note),element('a','Configure role models and limits',{href:'/config'}));
 }
 const capturedBox=(target,kind)=>element('div',undefined,{class:kind,'data-schedule-id':target.id,'data-definition-revision':target.definition_revision});
 async function showPreview(target){try{const value=await previewFor(target);const box=capturedBox(target,'sw-preview');renderPreview(box,value);$('sw-detail').append(box);return true;}catch(error){message(error.message,true);return false;}}
 async function enable(target){try{const value=await previewFor(target);const box=capturedBox(target,'sw-confirm');renderPreview(box,value);box.append(button('Enable this definition',()=>command(target,'update',{enabled:true},value.preview_digest),true),button('Keep paused',()=>box.remove()));$('sw-detail').append(box);box.scrollIntoView({block:'nearest'});return true;}catch(error){message(error.message,true);return false;}}
 async function confirmRun(target){try{const value=await previewFor(target);const box=capturedBox(target,'sw-confirm');renderPreview(box,value);box.append(element('p','Run now enqueues this captured definition through normal authority, readiness and budget admission.'),button('Enqueue this run',()=>command(target,'enqueue',undefined,value.preview_digest),true),button('Close',()=>box.remove()));$('sw-detail').append(box);box.scrollIntoView({block:'nearest'});return true;}catch(error){message(error.message,true);return false;}}
 function confirmArchive(target){const box=capturedBox(target,'sw-confirm');box.append(element('p','Archive '+target.name+'? Original history stays. Active jobs are not cancelled.'),button('Archive this definition',()=>command(target,'archive'),true),button('Keep definition',()=>box.remove()));$('sw-detail').append(box);}
 async function mutation(path,body){if(busy)return;if(pending&&JSON.stringify(pending.body)!==JSON.stringify(body)){message('Resolve the previous unknown request before starting another mutation.',true);return;}
  pending={path,body};busy=true;$('sw-retry').hidden=true;controls().forEach(node=>node.disabled=true);
  try{const result=await json(path,body);pending=null;message('Authority accepted the operation; reading its canonical result.');if(result.schedule)selected=result.schedule.id;if(body.action==='duplicate'&&result.result)selected=result.result.id;
   if(path.endsWith('/create')||body.action==='update'&&form.hidden===false){form.hidden=true;dirty=false;}if(await refresh(true))message('Authority readback · '+stamp(new Date().toISOString()));else message('Operation accepted; canonical readback unavailable. Refresh to recover current state.',true);
  }catch(error){if(error.status){pending=null;showErrors(error);message('Command rejected: '+error.message+'. Refresh and review the captured definition; the draft is retained.',true);}else{message('Reply unavailable; outcome is unknown. Retry reuses the exact request and operation ID.',true);$('sw-retry').hidden=false;}}
  finally{busy=false;controls().forEach(node=>node.disabled=!!pending);if(!pending&&snapshot)render();}
 }
 function command(target,action,updates,preview_digest){return mutation('/api/schedules/v2/commands',{target_id:target.id,expected_revision:target.definition_revision,operation_id:crypto.randomUUID(),action,...(updates?{updates}:{}),...(preview_digest?{preview_digest}:{})});}
 function showErrors(error){const box=$('sw-field-errors');box.replaceChildren();for(const node of form.querySelectorAll('[aria-invalid]'))node.removeAttribute('aria-invalid');const fields=error.fields||[];
  for(const issue of fields){box.append(element('p',issue.field+': '+issue.message));const name=issue.field.replace(/^parameters\./,'param:');const node=field(name==='interval_ms'||name==='idle_ms'?'duration':name);if(node)node.setAttribute('aria-invalid','true');}if(!fields.length)box.append(element('p',error.message));}
 function parameterFields(values={}){const box=$('sw-parameter-fields');box.replaceChildren();const action=field('action').value,descriptor=snapshot.action_descriptors.find(d=>d.action===action);if(!descriptor)return;
  for(const [name,definition]of Object.entries(descriptor.fields)){if(definition.internal)continue;const label=element('label',name.replaceAll('_',' ')),value=values[name]===undefined?definition.default:values[name];let input;
   if(definition.type==='enum'){input=element('select');for(const option of definition.options)input.append(element('option',option,{value:option}));
    if(value!==undefined&&!definition.options.includes(value)){const legacy=element('option','Unsupported legacy value: '+String(value)+' — choose a replacement',{value});legacy.disabled=true;input.prepend(legacy);}}
   else if(definition.type==='string_array'||definition.type==='json')input=element('textarea');else input=element('input',undefined,{type:definition.type==='number'?'number':definition.type==='boolean'?'checkbox':'text'});
   input.name='param:'+name;if(definition.type==='boolean')input.checked=!!value;else input.value=definition.type==='string_array'?(value||[]).join('\n'):definition.type==='json'?JSON.stringify(value||{},null,2):value===undefined?'':String(value);
   if(definition.minimum!==undefined)input.min=definition.minimum;if(definition.maximum!==undefined)input.max=definition.maximum;if(definition.required)input.required=true;label.append(input);if(definition.type==='string_array')label.append(element('small','One entity ID per line. Empty means the documented action scope.'));box.append(label);
  }
 }
 function triggerFields(){const trigger=field('trigger_type').value;for(const node of form.querySelectorAll('[data-trigger]'))node.hidden=!node.dataset.trigger.split(' ').includes(trigger);}
 function openEditor(target){if(dirty){message('Close or save the existing draft before replacing it.',true);return;}editTarget=target?structuredClone(target):null;preview=null;form.reset();form.hidden=false;$('sw-edit-title').textContent=target?'Edit '+target.name:'New disabled schedule';$('sw-save').textContent=target?'Save definition':'Save disabled';$('sw-preview-result').replaceChildren();$('sw-field-errors').replaceChildren();
  const action=field('action');action.replaceChildren();for(const descriptor of snapshot.action_descriptors)action.append(element('option',descriptor.action,{value:descriptor.action}));setField('action',target?target.action:'graph_maintenance');
  if(target){for(const key of ['name','trigger_type','cron','timezone','fold_policy','missed_policy','cycle_interval','max_runs'])setField(key,target[key]);const duration=target.trigger_type==='on_idle'?target.idle_ms:target.interval_ms;if(duration){const unit=[3600000,60000,1000,1].find(n=>duration%n===0);setField('unit',unit);setField('duration',duration/unit);}}
  parameterFields(target?target.parameters:{});triggerFields();form.dataset.operation=crypto.randomUUID();dirty=false;field('name').focus();
 }
 function draft(){const action=field('action').value,descriptor=snapshot.action_descriptors.find(d=>d.action===action),parameters={};for(const [name,definition]of Object.entries(descriptor.fields)){
   const input=field('param:'+name);if(!input){if(editTarget&&editTarget.parameters[name]!==undefined)parameters[name]=editTarget.parameters[name];continue;}
   if(definition.type==='boolean')parameters[name]=input.checked;else if(input.value!=='')parameters[name]=definition.type==='number'?Number(input.value):definition.type==='string_array'?input.value.split(/\r?\n/).map(v=>v.trim()).filter(Boolean):definition.type==='json'?JSON.parse(input.value):input.value;
  }
  const trigger=field('trigger_type').value,value={name:field('name').value,action,parameters,trigger_type:trigger,timezone:field('timezone').value,fold_policy:field('fold_policy').value,missed_policy:field('missed_policy').value,max_runs:field('max_runs').value===''?null:Number(field('max_runs').value)};
  if(trigger==='interval')value.interval_ms=Number(field('duration').value)*Number(field('unit').value);if(trigger==='on_idle')value.idle_ms=Number(field('duration').value)*Number(field('unit').value);if(trigger==='cron_like')value.cron=field('cron').value;if(trigger==='after_cycles')value.cycle_interval=Number(field('cycle_interval').value);return value;
 }
 form.addEventListener('input',()=>{dirty=true;preview=null;});field('action').addEventListener('change',()=>{parameterFields();dirty=true;preview=null;});field('trigger_type').addEventListener('change',triggerFields);
 $('sw-preview').addEventListener('click',async()=>{try{preview=await previewFor(editTarget,draft());renderPreview($('sw-preview-result'),preview);$('sw-field-errors').replaceChildren();}catch(error){showErrors(error);message('Invalid draft; nothing was written. '+error.message,true);}});
 form.addEventListener('submit',async event=>{event.preventDefault();if(busy||pending)return;try{const value=draft();const reviewed=await previewFor(editTarget,value);
  if(editTarget)await mutation('/api/schedules/v2/commands',{target_id:editTarget.id,expected_revision:editTarget.definition_revision,operation_id:form.dataset.operation,action:'update',updates:value,preview_digest:reviewed.preview_digest});else await mutation('/api/schedules/v2/create',{...value,operation_id:form.dataset.operation,enabled:false});
 }catch(error){showErrors(error);message(error.message,true);}});
 $('sw-close-editor').addEventListener('click',()=>{if(dirty){const box=$('sw-field-errors');box.replaceChildren(element('p','Discard the unsaved draft?'));box.append(button('Discard draft',()=>{dirty=false;form.hidden=true;renderDetail();}));return;}form.hidden=true;renderDetail();});
 $('sw-new').addEventListener('click',()=>{if(snapshot)openEditor(null);});$('sw-refresh').addEventListener('click',refresh);$('sw-search').addEventListener('input',renderList);$('sw-filter').addEventListener('change',renderList);
 $('sw-retry').addEventListener('click',()=>{if(pending)void mutation(pending.path,pending.body);});
 function selectTab(name){tab=name;for(const node of $('sw-tabs').querySelectorAll('[role=tab]')){const active=node.dataset.tab===name;node.setAttribute('aria-selected',String(active));node.tabIndex=active?0:-1;$('sw-'+node.dataset.tab).hidden=!active;}if(name==='upcoming')void forecast();if(name==='runs')renderRuns();}
 $('sw-tabs').addEventListener('click',event=>{const node=event.target.closest('[data-tab]');if(node)selectTab(node.dataset.tab);});$('sw-tabs').addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const nodes=Array.from($('sw-tabs').querySelectorAll('[role=tab]')),index=nodes.indexOf(document.activeElement);const next=event.key==='Home'?0:event.key==='End'?nodes.length-1:(index+(event.key==='ArrowRight'?1:-1)+nodes.length)%nodes.length;selectTab(nodes[next].dataset.tab);nodes[next].focus();});
 let forecastGeneration=0;async function forecast(){if(!snapshot)return;const generation=++forecastGeneration,rows=filtered().slice(0,12),box=$('sw-forecast');box.replaceChildren(element('p','Forecasting '+rows.length+' / '+filtered().length+' filtered definitions. Narrow search for the rest.'));
  for(const schedule of rows){try{const value=await previewFor(schedule);if(generation!==forecastGeneration)return;const group=element('details');group.append(element('summary',schedule.name+' · '+(schedule.enabled?'enabled':'paused intent')));const content=element('div');renderPreview(content,value);group.append(content);box.append(group);}catch(error){if(generation===forecastGeneration)box.append(element('p',schedule.name+': '+error.message));}}
 }
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});window.addEventListener('online',refresh);window.addEventListener('beforeunload',event=>{if(dirty||pending){event.preventDefault();event.returnValue='';}});
 setInterval(()=>{if(!document.hidden)void refresh();},15000);void refresh();
})();`;
