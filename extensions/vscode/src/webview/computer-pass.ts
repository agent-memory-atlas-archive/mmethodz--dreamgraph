/// <reference lib="dom" />
import type {ComputerPassView} from '../computer-pass.js';
export const computerPassMarkup=`<details id="computer-pass"><summary>New scoped pass <span id="computer-pass-badge">Daemon API</span></summary>
 <p class="computer-pass-hint">Uses the daemon’s configured computer_use API role. Your local Architect model stays selected. Tool effect reviews remain required.</p>
 <div class="computer-control-actions"><button id="computer-pass-setup">Review setup</button><label><input type="checkbox" id="computer-pass-interact"> Allow target interaction</label><label>Seconds <input type="number" id="computer-pass-duration" min="1" max="300" value="30"></label><button id="computer-pass-prepare" disabled>Prepare</button></div>
 <div id="computer-pass-status" role="status"></div><pre id="computer-pass-scope"></pre>
 <textarea id="computer-pass-prompt" maxlength="16384" rows="2" aria-label="Scoped computer task" placeholder="Describe a task within the displayed browser target…"></textarea>
 <div class="computer-control-actions"><button id="computer-pass-confirm" hidden>Confirm exact scope</button><button id="computer-pass-start" hidden>Start once</button><button id="computer-pass-cancel" hidden>Cancel preparation</button><button id="computer-pass-stop" hidden>Stop original pass</button><button id="computer-pass-inspect" hidden>Inspect original execution</button></div></details>`;
export const computerPassStyles=`#computer-pass{border-top:1px solid var(--vscode-panel-border);margin-top:5px;padding-top:4px}#computer-pass summary{font-weight:500}
 .computer-pass-hint{margin:4px 0;opacity:.8}#computer-pass-scope{white-space:pre-wrap;overflow-wrap:anywhere;max-height:210px;overflow:auto;margin:4px 0;font:inherit;user-select:text}
 #computer-pass-status{overflow-wrap:anywhere}#computer-pass-duration{width:52px;font:inherit}#computer-pass .computer-control-actions{flex-wrap:wrap}#computer-pass label{display:inline-flex;align-items:center;gap:3px}
 #computer-pass-prompt{box-sizing:border-box;width:100%;resize:vertical;font:inherit;padding:4px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border)}
 #computer-pass-stop{color:var(--vscode-errorForeground)}`;
export function installComputerPass(document:Document,window:Window,send:(message:unknown)=>void){
 const get=(id:string)=>document.getElementById('computer-pass-'+id)!,button=(id:string)=>get(id) as HTMLButtonElement;
 const interact=get('interact') as HTMLInputElement,duration=get('duration') as HTMLInputElement,prompt=get('prompt') as HTMLTextAreaElement;
 let view:ComputerPassView={status:'idle',busy:false,dispatched:false};
 button('setup').addEventListener('click',()=>{if(!button('setup').disabled)send({type:'computerPassSetup'});});
 button('prepare').addEventListener('click',()=>{if(!button('prepare').disabled&&duration.checkValidity())send({type:'computerPassPrepare',interact:interact.checked,duration_ms:Number(duration.value)*1000});});
 button('confirm').addEventListener('click',()=>{if(!button('confirm').disabled&&view.preparation)send({type:'computerPassConfirm',id:view.preparation.id});});
 button('start').addEventListener('click',()=>{if(!button('start').disabled&&view.preparation&&prompt.value.trim())send({type:'computerPassStart',id:view.preparation.id,message:prompt.value});});
 button('cancel').addEventListener('click',()=>{if(!button('cancel').disabled&&view.preparation)send({type:'computerPassCancel',id:view.preparation.id});});
 button('stop').addEventListener('click',()=>{if(view.dispatched)send({type:'computerPassStop'});});
 button('inspect').addEventListener('click',()=>{if(!button('inspect').disabled)send({type:'computerPassInspect'});});
 window.addEventListener('message',(event:MessageEvent)=>{if(event.data?.type!=='computerPassView')return;view=event.data.view as ComputerPassView;
  const held=!!view.preparation&&view.status!=='settled',scope=held?view.preparation:view.setup;
  get('badge').textContent=view.status;get('status').textContent=view.message??'';
  // Literal bounded configuration/evidence; never treat target text as markup or instructions.
  get('scope').textContent=scope?JSON.stringify({endpoint:view.endpoint,scope,...(view.execution?{execution:{id:view.execution.execution_id,status:view.execution.status,revision:view.execution.record_revision,authority_active:view.execution.authority_active,
   graph_receipts:view.execution.graph_receipt_ids.length,source_obligations:view.execution.obligation_ids.length}}:{})},null,2):'';
  button('setup').disabled=view.busy||held;button('prepare').disabled=view.busy||held||!view.setup?.available;
  interact.disabled=held||view.busy;duration.disabled=held||view.busy;prompt.disabled=view.dispatched&&view.status!=='settled';
  button('confirm').hidden=!held||view.dispatched||view.cancellationRequested===true||!!view.confirmation;button('confirm').disabled=view.busy||!['prepared','unconfirmed'].includes(view.status);
  button('start').hidden=view.status!=='confirmed';button('start').disabled=view.busy;
  button('cancel').hidden=!held||view.dispatched&&view.status!=='unconfirmed';button('cancel').disabled=view.status==='recovering'||view.dispatched&&view.busy;
  button('cancel').textContent=view.dispatched?'Revoke unused scope':'Cancel preparation';
  button('stop').hidden=!view.dispatched||view.status==='settled';button('stop').disabled=false;
  button('inspect').hidden=!view.dispatched;button('inspect').disabled=view.busy;
 });
}
export function getComputerPassScript(){return `(${installComputerPass.toString()})(document, window, message => vscode.postMessage(message));`;}
