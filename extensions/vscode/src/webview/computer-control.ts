/// <reference lib="dom" />
import type {ComputerControlView} from '../computer-control.js';
import {computerPassMarkup} from './computer-pass.js';
export const computerControlMarkup=`<details id="computer-control"><summary>Computer Use <span id="computer-control-badge">Inspect original sessions</span></summary>
 <div class="computer-control-actions"><button id="computer-control-refresh">Refresh</button><select id="computer-control-select" aria-label="Original computer session"><option value="">Choose a session</option></select><button id="computer-control-more" hidden>More</button></div>
 <div id="computer-control-status" role="status"></div><pre id="computer-control-detail"></pre>
 <div class="computer-control-actions"><button id="computer-control-pause" hidden>Pause</button><button id="computer-control-resume" hidden>Resume</button><button id="computer-control-stop" hidden>Stop</button><button id="computer-control-inspect" hidden>Inspect original state</button><button id="computer-control-evidence" hidden>View observation</button><button id="computer-control-evidence-clear" hidden>Clear observation</button></div>
 <div id="computer-control-evidence-status" role="status"></div><pre id="computer-control-evidence-detail" hidden></pre><div id="computer-control-pixels" hidden></div>${computerPassMarkup}</details>`;
export const computerControlStyles=`#computer-control{margin:2px 8px;padding:4px 7px;border:1px solid var(--vscode-panel-border);border-radius:4px;flex-shrink:0;font-size:11px}
 #computer-control summary{cursor:pointer;font-weight:600}#computer-control-badge{font-weight:400;opacity:.8;margin-left:6px}
 #computer-control-status{overflow-wrap:anywhere;margin-top:4px}#computer-control-detail{white-space:pre-wrap;overflow-wrap:anywhere;max-height:160px;overflow:auto;margin:4px 0;font:inherit;user-select:text}
 .computer-control-actions{display:flex;gap:5px;align-items:center;margin-top:4px}.computer-control-actions select{min-width:0;flex:1}
 .computer-control-actions button,.computer-control-actions select{font:inherit;padding:2px 6px;border:1px solid var(--vscode-panel-border);border-radius:3px;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}
 .computer-control-actions button:focus-visible,.computer-control-actions select:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:2px}.computer-control-actions button:disabled{opacity:.5}
 #computer-control-stop{color:var(--vscode-errorForeground)}#computer-control-evidence-detail{white-space:pre-wrap;overflow-wrap:anywhere;max-height:160px;overflow:auto;font:inherit;user-select:text}
 #computer-control-pixels img{display:block;max-width:100%;max-height:320px;object-fit:contain;border:1px solid var(--vscode-panel-border);margin-top:4px}`;
export function installComputerControl(document:Document,window:Window,send:(value:unknown)=>void){
 const get=(id:string)=>document.getElementById('computer-control-'+id)!,panel=document.getElementById('computer-control') as HTMLDetailsElement;
 const select=get('select') as HTMLSelectElement,refresh=get('refresh') as HTMLButtonElement,more=get('more') as HTMLButtonElement;
 const pause=get('pause') as HTMLButtonElement,resume=get('resume') as HTMLButtonElement,stop=get('stop') as HTMLButtonElement,inspect=get('inspect') as HTMLButtonElement;
 const evidence=get('evidence') as HTMLButtonElement,clear=get('evidence-clear') as HTMLButtonElement,pixels=get('pixels');let expiryTimer:number|undefined;
 const clearPixels=()=>{if(expiryTimer!==undefined)window.clearTimeout(expiryTimer);expiryTimer=undefined;pixels.querySelector('img')?.removeAttribute('src');pixels.replaceChildren();pixels.hidden=true;};
 const clearEvidence=()=>{clearPixels();get('evidence-detail').textContent='';get('evidence-detail').hidden=true;get('evidence-status').textContent='';clear.hidden=true;send({type:'computerEvidenceClear'});};
 let selected:string|undefined,readStarted=false;
 const control=(action:string)=>{if(selected)send({type:'computerControl',id:selected,action});};
 panel.addEventListener('toggle',()=>{if(!panel.open)clearEvidence();else if(!readStarted){readStarted=true;send({type:'computerRefresh'});}});
 evidence.addEventListener('click',()=>{if(selected&&!evidence.disabled)send({type:'computerEvidence',id:selected});});clear.addEventListener('click',clearEvidence);
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')clearEvidence();});
 refresh.addEventListener('click',()=>send({type:'computerRefresh'}));more.addEventListener('click',()=>send({type:'computerRefresh',more:true}));
 select.addEventListener('change',()=>{if(select.value)send({type:'computerSelect',id:select.value});});
 pause.addEventListener('click',()=>{if(!pause.disabled)control('pause');});resume.addEventListener('click',()=>{if(!resume.disabled)control('resume');});
 stop.addEventListener('click',()=>{if(!stop.disabled)control('stop');});inspect.addEventListener('click',()=>{if(selected&&!inspect.disabled)send({type:'computerSelect',id:selected});});
 window.addEventListener('message',(event:MessageEvent)=>{if(event.data?.type!=='computerView')return;const view=event.data.view as ComputerControlView;
  const pending=view.status==='loading'||view.status==='controlling';refresh.disabled=pending;more.hidden=!view.nextCursor;more.disabled=pending;select.disabled=pending;
  const options=view.sessions.map(row=>{const option=document.createElement('option');option.value=row.session.id;option.textContent=row.session.execution_id+' · '+row.session.state;return option;});
  const empty=document.createElement('option');empty.value='';empty.textContent='Choose a session';select.replaceChildren(empty,...options);
  selected=view.selected?.session.id;if(selected)select.value=selected;
  get('badge').textContent=view.selected?.session.state??view.status;get('status').textContent=view.message??'';
  const row=view.selected;get('detail').textContent=row?['Instance: '+row.session.instance_id,'Authority endpoint: '+view.endpoint,'Interaction host: '+row.session.host_id,
   'Route: '+row.capability.route+' · '+row.capability.backend_version,'Target: '+row.targets.map(target=>target.origin??target.application??target.id).join(', '),
   'Execution: '+row.session.execution_id,'State: '+row.session.state+' · '+(row.worker_available?'original worker available':'original worker unavailable'),
   'Actions: '+row.usage.actions+'/'+row.limits.max_actions+' · Images: '+row.usage.images+'/'+row.limits.max_images,'Original expiry: '+row.limits.expires_at,
   'Last action: '+(row.last_receipt?.state??'none')].join('\n'):'';
  const live=!!row?.worker_available;pause.hidden=!row||!row.pause_supported||row.session.state==='paused';pause.disabled=!live||pending||!['ready','running'].includes(row?.session.state??'');
  resume.hidden=!row||row.session.state!=='paused';resume.disabled=!live||pending;
  stop.hidden=!row||row.session.state==='stopped';stop.disabled=!live;
  inspect.hidden=!row;inspect.disabled=pending;
  evidence.hidden=!row;evidence.disabled=pending||view.evidenceLoading===true;clear.hidden=!view.evidence&&!view.evidenceLoading;
  clearPixels();get('evidence-status').textContent=view.evidenceMessage??'';const seen=view.evidence?.observation,detail=get('evidence-detail');
  detail.hidden=!seen;detail.textContent=seen?['Observed: '+seen.observation.observed_at,'Expires: '+seen.observation.expires_at,'Observation: '+seen.observation.id,
   'Evidence: '+seen.observation.content_hash,'State: '+(seen.expired?'expired; inspection only':'inspection only; no authority grant'),seen.summary].join('\n'):'';
  const remaining=seen?Date.parse(seen.observation.expires_at)-Date.now():0,image=seen?.image;
  if(panel.open&&seen&&!seen.expired&&remaining>0&&image&&['image/png','image/jpeg'].includes(image.mime_type)
   &&image.data_base64.length<=1398104&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image.data_base64)){
   const img=document.createElement('img');img.alt='Scoped original observation; inspection only';img.src='data:'+image.mime_type+';base64,'+image.data_base64;pixels.append(img);pixels.hidden=false;
   expiryTimer=window.setTimeout(()=>{clearPixels();get('evidence-status').textContent='Observation expired; pixels cleared. Refresh the original state before further inspection.';send({type:'computerEvidenceClear'});},Math.min(remaining,2147483647));
  }
 });
}
export function getComputerControlScript(){return `(${installComputerControl.toString()})(document, window, message => vscode.postMessage(message));`;}
