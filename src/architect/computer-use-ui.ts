/** Compact controls use the same daemon contract as other clients. Selection/preflight never issues permission. */
export const COMPUTER_USE_CSS=String.raw`
 .computer-row{display:flex;align-items:center;gap:6px;margin:0 10px 5px;font-size:11px;color:#b5c6bf}.computer-row button{padding:3px 7px}
 .computer-drawer{margin:0 10px 6px;padding:6px 8px;border:1px solid #384c44;border-radius:4px;background:#1e2421;font-size:11px}
 .computer-drawer[hidden]{display:none}.computer-drawer summary{cursor:pointer;font-weight:600}.computer-drawer pre{max-height:180px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;margin:5px 0}
 .computer-actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.computer-drawer img{max-width:100%;max-height:260px;border:1px solid #46584f}.computer-actions button{padding:3px 7px}
`;
export const COMPUTER_USE_MARKUP=String.raw`
 <div class="computer-row"><button id="computer-use-open" type="button" aria-expanded="false" aria-controls="computer-use-drawer">Computer Use</button><span id="computer-use-state" role="status" aria-live="polite">Inactive · no target grant</span><button id="computer-use-pause" type="button" hidden>Pause</button><button id="computer-use-stop" type="button" hidden>Stop</button></div>
 <section id="computer-use-drawer" class="computer-drawer" aria-label="Computer Use scope and evidence" hidden><details open><summary>Scope, limits and evidence</summary>
 <div class="computer-actions"><label id="computer-use-sessions-label" hidden>Session <select id="computer-use-sessions" aria-label="Existing Computer Use sessions"></select></label><button id="computer-use-refresh" type="button">Refresh sessions</button><button id="computer-use-more" type="button" hidden>More sessions</button><button id="computer-use-recover" type="button" hidden>Recheck original stop</button></div>
 <pre id="computer-use-setup" tabindex="0"></pre><div class="computer-actions"><label>Model <select id="computer-use-model-role"><option value="architect">Selected Architect model</option><option value="computer_use">Configured Computer Use role</option></select></label><label><input id="computer-use-interact" type="checkbox"> Allow interaction</label><button id="computer-use-prepare" type="button" disabled>Prepare next pass</button><button id="computer-use-confirm" type="button" hidden>Confirm scope</button><button id="computer-use-inspect" type="button" hidden>Inspect observation</button><a href="/config">Configure</a></div>
 <pre id="computer-use-evidence" tabindex="0"></pre><img id="computer-use-image" alt="Latest scoped browser observation" hidden></details></section>
`;
export const COMPUTER_USE_SCRIPT=String.raw`
    const computerOpenEl=document.getElementById('computer-use-open'),computerDrawerEl=document.getElementById('computer-use-drawer'),computerStateEl=document.getElementById('computer-use-state');
    const computerSetupEl=document.getElementById('computer-use-setup'),computerPrepareEl=document.getElementById('computer-use-prepare'),computerConfirmEl=document.getElementById('computer-use-confirm');
    const computerStopEl=document.getElementById('computer-use-stop'),computerInspectEl=document.getElementById('computer-use-inspect'),computerEvidenceEl=document.getElementById('computer-use-evidence'),computerImageEl=document.getElementById('computer-use-image');
    const computerSessionsEl=document.getElementById('computer-use-sessions'),computerSessionsLabel=document.getElementById('computer-use-sessions-label'),computerRefreshEl=document.getElementById('computer-use-refresh');
    const computerMoreEl=document.getElementById('computer-use-more'),computerRecoverEl=document.getElementById('computer-use-recover');
    const computerModelRoleEl=document.getElementById('computer-use-model-role');
    const computerPauseEl=document.getElementById('computer-use-pause');let computerControlFence=null,computerPaused=false;
    let computerPreparation=null,computerPendingRequest=null,computerActive=null,computerTimer=0,computerPolling=null,computerGeneration=0;
    let computerSessions=[],computerPage=null,computerPreparationGeneration=0,computerSetupGeneration=0,computerAvailable=false;
    const computerAdapter=()=>document.getElementById('architect-adapter-select').value;
    async function computerRequest(route,body){const response=await fetch('/api/architect/v1/computer/'+route,{...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),cache:'no-store',signal:AbortSignal.timeout(10000)});
      const result=await response.json();if(!response.ok||result.error)throw new Error(result.error||'COMPUTER_REQUEST_FAILED');return result;}
    function computerShowSetup(value){computerSetupEl.textContent=JSON.stringify(value,null,2);computerImageEl.hidden=true;computerImageEl.removeAttribute('src');}
    function computerSelect(value){computerGeneration++;clearTimeout(computerTimer);computerActive=value;computerPolling=null;
      computerImageEl.hidden=true;computerImageEl.removeAttribute('src');computerStopEl.hidden=true;computerRecoverEl.hidden=true;computerPauseEl.hidden=true;computerControlFence=null;computerInspectEl.hidden=!value;
      if(value)void pollComputerState();}
    async function loadComputerSessions(append=false){computerRefreshEl.disabled=true;computerMoreEl.disabled=true;
      try{const query=new URLSearchParams({limit:'16'});if(append&&computerPage?.next_cursor){query.set('cursor',computerPage.next_cursor);query.set('snapshot_hash',computerPage.snapshot_hash);}
        const page=await computerRequest('sessions?'+query);computerPage=page;computerSessions=append?[...computerSessions,...page.sessions]:page.sessions;
        computerSessionsEl.replaceChildren();for(const row of computerSessions){const option=document.createElement('option');option.value=row.cursor;
          option.textContent=row.journal.session.state+' · '+(row.journal.targets[0].origin||row.journal.targets[0].application||row.journal.session.host_id)+' · '+row.execution_id;computerSessionsEl.append(option);}
        computerSessionsLabel.hidden=!computerSessions.length;computerMoreEl.hidden=!page.next_cursor;
        const match=computerSessions.find(row=>row.execution_id===computerActive?.execution_id&&row.journal.session.id===computerActive?.id);
        const chosen=match||(!computerActive?computerSessions.find(row=>!['stopped','failed'].includes(row.journal.session.state)):null);
        if(chosen){computerSessionsEl.value=chosen.cursor;if(!computerActive)computerSelect({execution_id:chosen.execution_id,id:chosen.journal.session.id});}
      }catch(error){computerStateEl.textContent=error.message+' · refresh sessions to read current state';}
      finally{computerRefreshEl.disabled=false;computerMoreEl.disabled=false;}}
    function invalidateComputerPreparation(){computerPreparationGeneration++;computerPreparation=null;computerPendingRequest=null;computerAvailable=false;
      computerConfirmEl.hidden=true;computerConfirmEl.disabled=false;computerPrepareEl.disabled=true;}
    async function loadComputerSetup(){const generation=computerPreparationGeneration,request=++computerSetupGeneration;computerAvailable=false;computerPrepareEl.disabled=true;
      try{const setup=await computerRequest('setup?'+new URLSearchParams({adapter:computerAdapter(),model_role:computerModelRoleEl.value}));if(generation!==computerPreparationGeneration||request!==computerSetupGeneration)return;
        computerShowSetup(setup);computerAvailable=setup.available;computerPrepareEl.disabled=!computerAvailable;}
      catch(error){if(generation===computerPreparationGeneration&&request===computerSetupGeneration){computerStateEl.textContent=error.message;computerPrepareEl.disabled=true;}}}
    computerOpenEl.addEventListener('click',async()=>{computerDrawerEl.hidden=!computerDrawerEl.hidden;computerOpenEl.setAttribute('aria-expanded',String(!computerDrawerEl.hidden));if(computerDrawerEl.hidden)return;
      void loadComputerSessions();await loadComputerSetup();});
    for(const control of [computerModelRoleEl,document.getElementById('architect-adapter-select'),document.getElementById('computer-use-interact')])control.addEventListener('change',()=>{
      invalidateComputerPreparation();computerStateEl.textContent='Selection changed · review a new scope before the next pass';if(!computerDrawerEl.hidden)void loadComputerSetup();});
    computerRefreshEl.addEventListener('click',()=>void loadComputerSessions());computerMoreEl.addEventListener('click',()=>void loadComputerSessions(true));
    computerSessionsEl.addEventListener('change',()=>{const row=computerSessions.find(item=>item.cursor===computerSessionsEl.value);
      if(row)computerSelect({execution_id:row.execution_id,id:row.journal.session.id});});
    computerPrepareEl.addEventListener('click',async()=>{if(!computerAvailable)return;const generation=++computerPreparationGeneration;computerPrepareEl.disabled=true;computerPendingRequest=null;computerPreparation=null;computerConfirmEl.hidden=true;
      try{const result=await computerRequest('prepare',{adapter:computerAdapter(),interact:document.getElementById('computer-use-interact').checked,duration_ms:30000,model_role:computerModelRoleEl.value});if(generation!==computerPreparationGeneration)return;computerPreparation=result.result;computerShowSetup(computerPreparation);
        computerStateEl.textContent='Prepared · review scope and limits';computerConfirmEl.textContent=computerPreparation.interact?'Allow this interaction scope':'Allow this observation scope';computerConfirmEl.hidden=false;}
      catch(error){if(generation===computerPreparationGeneration)computerStateEl.textContent=error.message;}finally{if(generation===computerPreparationGeneration)computerPrepareEl.disabled=!computerAvailable;}});
    computerConfirmEl.addEventListener('click',async()=>{if(!computerPreparation)return;const preparation=computerPreparation,generation=computerPreparationGeneration;computerConfirmEl.disabled=true;computerPrepareEl.disabled=true;
      try{const result=await computerRequest('confirm',{id:preparation.id,human_confirmed:true});if(generation!==computerPreparationGeneration)return;
        computerPendingRequest={...result.result,interact:preparation.interact,model_role:computerModelRoleEl.value};
        computerConfirmEl.hidden=true;computerStateEl.textContent=(preparation.interact?'Interact':'Observe')+' · '+preparation.origin+' · next pass only';}
      catch(error){if(generation===computerPreparationGeneration)computerStateEl.textContent=error.message;}finally{if(generation===computerPreparationGeneration){computerConfirmEl.disabled=false;computerPrepareEl.disabled=!computerAvailable;}}});
    function takeComputerPreparation(continuation){if(continuation||!computerPendingRequest)return null;if(computerAdapter()!=='native_api_tool_loop')throw new Error('COMPUTER_ADAPTER_ROUTE_MISMATCH');
      if(computerPendingRequest.model_role!==computerModelRoleEl.value)throw new Error('COMPUTER_MODEL_SELECTION_CHANGED');
      const value=computerPendingRequest;invalidateComputerPreparation();computerGeneration++;computerPolling=null;computerActive={execution_id:value.execution_id,id:value.id};computerStopEl.hidden=false;computerInspectEl.hidden=false;
      clearTimeout(computerTimer);computerTimer=setTimeout(pollComputerState,500);return value.id;}
    async function pollComputerState(){if(!computerActive||computerPolling===computerGeneration)return;const generation=computerGeneration,selected={...computerActive};computerPolling=generation;let again=false;
      try{const result=await computerRequest('status?'+new URLSearchParams(selected));if(generation!==computerGeneration)return;const j=result.journal;
        const stopLabel=j.session.state==='stopping'&&j.session.terminal_reason==='COMPUTER_INPUT_RELEASED_TERMINATION_PENDING'?'Stopping · input released · confirming termination':j.stop_state==='unknown'?'Recovery required · termination unconfirmed':j.session.state;
        computerStateEl.textContent=(j.capability.effective.some(op=>op!=='observe')?'Interact':'Observe')+' · '+j.targets[0].origin+' · '+j.session.host_id+' · '+stopLabel;
        computerEvidenceEl.textContent=JSON.stringify({state:j.session.state,stop:j.stop_state,actions:j.usage.actions,images:j.usage.images,expires_at:j.limits.expires_at,reason:j.session.terminal_reason,receipts:j.actions.map(a=>a.receipt)},null,2);
        again=['created','ready','running','paused','stopping'].includes(j.session.state)&&result.worker_available!==false;computerStopEl.hidden=!again;
        computerControlFence=j.session.fence;computerPaused=j.session.state==='paused';computerPauseEl.textContent=computerPaused?'Resume':'Pause';
        computerPauseEl.hidden=!result.pause_supported||!['ready','running','paused'].includes(j.session.state);computerPauseEl.disabled=j.pause_state==='requested';
        computerRecoverEl.hidden=!['unknown','requested'].includes(j.stop_state)||result.worker_available===false;
        if(result.worker_available===false&&!['stopped','failed'].includes(j.session.state))computerStateEl.textContent+=' · original worker unavailable; recovery unresolved';
      }catch(error){if(generation===computerGeneration){computerStateEl.textContent=error.message;again=error.message==='COMPUTER_CONTROL_REJECTED';}}
      finally{if(computerPolling===generation)computerPolling=null;if(again&&generation===computerGeneration)computerTimer=setTimeout(pollComputerState,2000);}}
    computerStopEl.addEventListener('click',async()=>{if(!computerActive)return;const selected={...computerActive},generation=computerGeneration;computerStopEl.disabled=true;
      computerStateEl.textContent='Stopping · awaiting input release and termination';computerPauseEl.hidden=true;
      try{await computerRequest('stop',selected);if(generation===computerGeneration)await pollComputerState();}catch(error){if(generation===computerGeneration)computerStateEl.textContent=error.message+' · termination is unconfirmed';}
      finally{computerStopEl.disabled=false;}});
    computerPauseEl.addEventListener('click',async()=>{if(!computerActive||computerControlFence===null)return;const selected={...computerActive,fence:computerControlFence},generation=computerGeneration,route=computerPaused?'resume':'pause';computerPauseEl.disabled=true;
      computerImageEl.hidden=true;computerImageEl.removeAttribute('src');try{await computerRequest(route,selected);if(generation===computerGeneration)await pollComputerState();}
      catch(error){if(generation===computerGeneration){computerStateEl.textContent=error.message+' · inspect the original state; Stop remains available';void pollComputerState();}}
      finally{if(generation===computerGeneration)computerPauseEl.disabled=false;}});
    computerRecoverEl.addEventListener('click',async()=>{if(!computerActive)return;const selected={...computerActive},generation=computerGeneration;computerRecoverEl.disabled=true;
      try{await computerRequest('recover-stop',selected);if(generation===computerGeneration)await pollComputerState();}
      catch(error){if(generation===computerGeneration)computerStateEl.textContent=error.message+' · termination remains unconfirmed';}
      finally{computerRecoverEl.disabled=false;}});
    computerInspectEl.addEventListener('click',async()=>{if(!computerActive)return;
      const selected={...computerActive},generation=computerGeneration;try{const result=await computerRequest('observation?'+new URLSearchParams(selected));if(generation!==computerGeneration)return;const value=result.observation;
        computerEvidenceEl.textContent=value?JSON.stringify({observation:value.observation,expired:value.expired,summary:value.summary},null,2):'No retained observation. Durable descriptors and receipts remain available.';
        computerImageEl.hidden=!value?.image;if(value?.image)computerImageEl.src='data:'+value.image.mime_type+';base64,'+value.image.data_base64;else computerImageEl.removeAttribute('src');}
      catch(error){if(generation===computerGeneration)computerStateEl.textContent=error.message;}});
    window.addEventListener('pagehide',()=>{computerGeneration++;invalidateComputerPreparation();clearTimeout(computerTimer);computerImageEl.removeAttribute('src');});
`;
