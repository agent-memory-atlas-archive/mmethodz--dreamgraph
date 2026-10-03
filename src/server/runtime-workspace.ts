/** Dashboard reads canonical currency/debt and the existing scoped job/cancel ports. */
export function renderRuntimeWorkspace(): string {
  return `<section id="runtime-workspace" aria-label="Graph and execution status"><header class="rw-heading"><h2>Graph and execution</h2><span id="rw-observed"></span><button id="rw-refresh" type="button" class="btn btn-secondary">Refresh</button><a href="/explorer/">Open Explorer →</a></header>
  <div id="rw-message" role="status" aria-live="polite"></div><button id="rw-retry" type="button" class="btn btn-secondary" hidden>Retry captured cancellation</button>
  <div class="rw-grid"><div><h3>Graph currency</h3><div id="rw-currency">Loading canonical state…</div><details><summary>Pending knowledge and evidence</summary><div id="rw-debt"></div></details></div>
  <div><h3>Executions</h3><label>Show <select id="rw-filter"><option value="active">Active and recovery</option><option value="all">Recent history</option></select></label><span id="rw-job-count"></span><div id="rw-jobs"></div><button id="rw-more" type="button" class="btn btn-secondary" hidden>More executions</button></div></div>
  </section><style>${RUNTIME_WORKSPACE_CSS}</style><script src="/status/workspace.js" defer></script>`;
}
const RUNTIME_WORKSPACE_CSS = `
.rw-heading{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.rw-heading h2{flex:1;border:0;margin:12px 0}.rw-heading span,#rw-job-count{font-size:11px;color:var(--text-dim)}.rw-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px;border:1px solid var(--border);padding:12px;background:var(--surface);border-radius:4px}.rw-grid h3{margin:0 0 6px;color:var(--text);font-size:13px}.rw-grid details{margin-top:8px}.rw-grid summary{cursor:pointer}.rw-grid select{background:var(--bg);color:var(--text);border:1px solid var(--border);padding:3px 6px;border-radius:3px;margin:0 7px 7px}.rw-line{font-size:12px;overflow-wrap:anywhere;padding:2px 0}.rw-muted{color:var(--text-dim)}.rw-job,.rw-region{border-top:1px solid var(--border);padding:6px 0;font-size:12px;overflow-wrap:anywhere}.rw-job .btn{padding:3px 8px;margin:4px 7px 0 0}.rw-job details{margin:4px 0}.rw-job pre{max-height:160px;white-space:pre-wrap}#rw-message{font-size:12px;color:var(--yellow);margin:4px 0}#rw-currency[data-stale=true],#rw-jobs[data-stale=true]{border-left:2px solid var(--yellow);padding-left:7px}
@media(max-width:760px){.rw-grid{grid-template-columns:minmax(0,1fr)}}
`;
export const RUNTIME_WORKSPACE_SCRIPT = String.raw`(() => {
 'use strict';const $=id=>document.getElementById(id);if(!$('runtime-workspace'))return;
 const el=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
 let jobs=[],offset=0,next=null,generation=0,busy=false,captured=null;
 const tell=text=>{$('rw-message').textContent=text;};
 async function api(path,body){const response=await fetch(path,{method:body===undefined?'GET':'POST',cache:'no-store',headers:{Accept:'application/json','Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});const value=await response.json();if(!response.ok||value.ok===false){const error=new Error(value.error||'HTTP '+response.status);error.refused=response.status>=400&&response.status<500;throw error;}return value;}
 function currency(value){const node=$('rw-currency'),g=value.graph,c=g.currency;node.dataset.stale='false';node.replaceChildren();
  for(const text of ['Graph: '+g.state.availability+' · '+g.state.completeness+' · '+g.state.freshness,'Last graph mutation: '+(c.last_graph_mutation_at||'Unknown'),'Last full scan: '+(c.last_full_scan_at||'Unknown'),'Last source reconciliation: '+(c.last_source_reconciliation_at||'Unknown'),'Reconciliation scope: '+(c.source_reconciliation_scope.join(', ')||'Not recorded'),'Graph revision: '+(g.revision.graph_revision||'Unknown')])node.append(el('div',text,'rw-line'));
  node.append(el('div','An old scan date alone does not mean the graph is stale.','rw-line rw-muted'));
  const debt=$('rw-debt');debt.replaceChildren();for(const reason of g.state.reasons)debt.append(el('div',reason.code+' · '+reason.scope.join(', ')+' · '+reason.detail,'rw-region'));
  debt.append(el('p',value.dirty_total+' affected regions; showing '+value.dirty_regions.length+'.','rw-line rw-muted'));
  for(const region of value.dirty_regions){debt.append(el('div',region.id+' · '+region.state+' · pending '+(region.pending_stages||[]).join(', '),'rw-region'));}
  $('rw-observed').textContent='Read at '+value.observed_at;
 }
 function renderJobs(total){const target=$('rw-jobs');target.dataset.stale='false';target.replaceChildren();$('rw-job-count').textContent=' '+jobs.length+' of '+total+' visible executions';
  for(const record of jobs){const job=record.job,row=el('div',undefined,'rw-job');row.append(el('strong',record.action.replace(/_/g,' ')+' · '+job.state),el('div','Updated '+job.updated_at+' · '+job.lifetime.replace(/_/g,' ')+' · scope '+job.scope.join(', '),'rw-muted'));
   if(job.terminal_cause)row.append(el('div','Cause: '+job.terminal_cause));
   if(job.unknown_effects.length)row.append(el('div','Unconfirmed work: '+job.unknown_effects.join(', ')));
   if(job.receipt_ids.length)row.append(el('div','Committed receipts: '+job.receipt_ids.join(', ')));
   const budget=record.snapshot?.budget;if(budget)row.append(el('div','Admitted limits: '+budget.requests+' calls; '+budget.max_hops+' hops; run '+budget.run_amount+' / day '+budget.day_amount+' '+budget.currency+'; actual cost may be unknown.','rw-muted'));
   if(['queued','blocked','running'].includes(job.state)){const cancel=el('button','Cancel','btn btn-secondary');cancel.type='button';cancel.disabled=busy||!!captured;const body={operation_id:crypto.randomUUID(),expected_revision:job.fence,action:'cancel_job',target_id:job.id};cancel.onclick=()=>cancelJob(body);row.append(cancel);}
   if(['failed','partial','cancelled'].includes(job.state))row.append(el('div','Start a new reviewed execution from its original CLI or Architect workflow; history is retained.','rw-muted'));
   if(job.state==='recovery_required')row.append(el('div','Recovery needs evidence that the original work stopped. Cancellation or refresh cannot prove that.','rw-muted'));
   const schedule=el('a','Schedules and occurrence history →');schedule.href='/schedules';row.append(schedule);target.append(row);
  }
  if(!jobs.length)target.append(el('p','No executions in this view.','rw-muted'));$('rw-more').hidden=next===null;
 }
 async function readJobs(append,ticket){const start=append?next:0;if(start===null)return;const page=await api('/api/jobs/v1?order=recent&state='+$('rw-filter').value+'&limit=50&offset='+start);if(ticket!==generation)return;offset=start;next=page.next_offset;jobs=append?[...jobs,...page.records]:page.records;renderJobs(page.total);}
 async function refresh(){const ticket=++generation;const results=await Promise.allSettled([api('/api/dashboard/v1'),readJobs(false,ticket)]);if(ticket!==generation)return;const messages=[];if(results[0].status==='fulfilled')currency(results[0].value);else{$('rw-currency').dataset.stale='true';messages.push('Graph read unavailable: '+results[0].reason.message+'. Previous data is retained.');}if(results[1].status==='rejected'){$('rw-jobs').dataset.stale='true';messages.push('Execution read unavailable: '+results[1].reason.message+'. Previous data is retained.');}tell(messages.join(' ')||(captured?'Cancellation acknowledgement remains uncertain. Retry the captured request.':''));}
 async function cancelJob(body){if(busy)return;busy=true;captured=body;$('rw-retry').hidden=true;for(const button of $('rw-jobs').querySelectorAll('button'))button.disabled=true;
  try{await api('/api/schedules/v2/commands',body);captured=null;await refresh();tell('Cancellation requested. The authoritative state shows whether owned work has stopped.');}
  catch(error){if(error.refused){captured=null;tell(error.message+'. Refresh the original execution before another action.');}else tell('Cancellation acknowledgement is uncertain: '+error.message+'. The original operation is retained.');}
  finally{busy=false;$('rw-retry').hidden=!captured;$('rw-retry').disabled=false;for(const button of $('rw-jobs').querySelectorAll('button'))button.disabled=!!captured;}
 }
 $('rw-refresh').onclick=refresh;$('rw-filter').onchange=refresh;$('rw-more').onclick=()=>readJobs(true,generation).catch(error=>tell('More executions unavailable: '+error.message));$('rw-retry').onclick=()=>{if(captured)cancelJob(captured);};refresh();
})();`;
