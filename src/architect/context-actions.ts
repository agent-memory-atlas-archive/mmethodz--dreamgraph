/** Injected into the Architect shell's scope. All targets are captured before awaiting. */
export const ARCHITECT_CONTEXT_ACTION_SCRIPT=String.raw`
    let architectInstanceId = 'unbound';
    const planDisclosureState = new Map();
    let preparedNativePlanTask = null;
    function renderPreparedNativeTask() {
      const chip=document.getElementById('chat-native-task');if(!chip)return;
      chip.hidden=!preparedNativePlanTask;
      if(preparedNativePlanTask){chip.textContent=preparedNativePlanTask.kind.replaceAll('_',' ')+' · '+(preparedNativePlanTask.slice_id||preparedNativePlanTask.scope.id)+' ×';
        chip.title='Explicit native task for '+preparedNativePlanTask.scope.id+'. Clear task purpose; keep the draft.';}
      chip.onclick=()=>{preparedNativePlanTask=null;renderPreparedNativeTask();chatStatusEl.textContent='Task purpose cleared. Draft kept.';};
    }
    function validatePreparedNativeTask(scope,planId) {
      if(!preparedNativePlanTask)return;
      const task=preparedNativePlanTask,state=activePlanSnapshot?.operational_state;
      if(scope!=='plan'||planId!==task.scope.id||String(state?.revision)!==String(task.expected_revision)||state?.definition_hash!==task.expected_definition_hash)
        throw new Error('Prepared task belongs to an earlier plan view. Return to that plan and prepare again, or clear the task purpose.');
    }
    async function prepareNativePlanTask(target,label) {
      if(chatProcessing)throw new Error('Wait for the original pass before preparing another task.');
      const planId=target.kind==='plan'?target.id:target.parent_id;
      if(!planId||activePlanId!==planId)throw new Error('Select the captured plan before preparing its native task.');
      const selection=activePlanLoadToken;
      const response=await fetch('/api/architect/v1/plans/'+encodeURIComponent(planId)+'/lifecycle/preview',{cache:'no-store'}),payload=await response.json();
      if(!response.ok)throw new Error(payload.message||'Plan authority unavailable.');
      if(activePlanId!==planId||activePlanLoadToken!==selection||chatProcessing)throw new Error('Selection changed while preparing the task. Nothing was sent.');
      const preview=payload.preview,state=preview?.state,scope=preview?.scope,slice=state?.slices?.find(item=>item.id===target.id);
      if(!scope||scope.id!==planId||scope.instance_id!==target.instance_id||preview.existing_revision===null
        ||String(preview.existing_revision)!==target.expected_revision||state.definition_hash!==target.definition_hash
        ||preview.definition.definition_hash!==state.definition_hash||state.reconciliation.state!=='current')throw new Error('Plan revision or definition changed. Refresh and prepare the captured task again.');
      const kind=target.kind==='plan'&&state.lifecycle==='verifying'?'final_verification':slice?.status==='in_progress'?'implementation':slice?.status==='verifying'?'verification':null;
      const approval=state.approval;
      if(!kind||!approval||approval.owner!==payload.operator_id||approval.definition_hash!==state.definition_hash
        ||kind!=='final_verification'&&(!approval.scope.includes(target.id)||!state.current_slice_ids.includes(target.id))
        ||state.plan_blockers.length||state.leases.length)throw new Error('Task is not eligible under the current approval, ownership, stage or recovery state. Review the plan lifecycle first.');
      preparedNativePlanTask=Object.freeze({scope:Object.freeze({...scope}),kind:kind,slice_id:kind==='final_verification'?null:target.id,
        expected_revision:state.revision,expected_definition_hash:state.definition_hash,approval_id:approval.id});
      renderPreparedNativeTask();setChatScope('plan');setArchitectCenterTab('chat');
      if(!chatInputEl.value)chatInputEl.value='Perform the '+kind.replaceAll('_',' ')+' task for '+label+' using the declared acceptance, graph evidence and governed actions. Report evidence and unresolved limits.';
      chatInputEl.dispatchEvent(new Event('input',{bubbles:true}));chatInputEl.focus();
      chatStatusEl.textContent='Native task prepared. Review the draft and submit normally; no work has started.';
    }
    function contextTarget(plan, kind, id, anchor) {
      const state=plan.operational_state||{};
      return Object.freeze({instance_id:architectInstanceId,kind:kind,id:id,parent_id:kind==='plan'?null:plan.id,
        expected_revision:String(state.revision===undefined?'unknown':state.revision),definition_hash:state.definition_hash||null,
        ...(anchor?{source_kind:anchor.kind||null,source_hash:anchor.source_hash||null,source_reference:anchor.target||null}:{})});
    }
    function draftContextQuestion(target,label) {
      const draft='Review '+label+' using its evidence and dependencies. Target: '+JSON.stringify(target);
      chatInputEl.value=(chatInputEl.value?chatInputEl.value+'\n\n':'')+draft;
      setChatScope(target.kind==='plan'&&target.id===activePlanId||target.parent_id===activePlanId?'plan':'project');
      setArchitectCenterTab('chat');chatInputEl.dispatchEvent(new Event('input',{bubbles:true}));chatInputEl.focus();
      chatStatusEl.textContent='Editable draft added. Nothing has been sent.';
    }
    async function copyContextTarget(target){await navigator.clipboard.writeText(JSON.stringify(target,null,2));actionStatusEl.textContent='Captured target copied.';}
    async function openCapturedPlan(target){const id=target.kind==='plan'?target.id:target.parent_id;if(!id)throw new Error('No plan source anchor.');
      await loadPlan(id,null,{revealSelected:true,activatePlanScope:true});
      if(activePlanId!==id)throw new Error('Selection changed while opening the captured target.');
      if(target.expected_revision!=='unknown'&&String(activePlanSnapshot.operational_state.revision)!==target.expected_revision)throw new Error('Target revision changed. Refreshed the view; open actions again.');
      return activePlanSnapshot;
    }
    async function inspectCapturedTarget(target,label){await openCapturedPlan(target);setArchitectCenterTab('plan');
      const body=centerPlanBodyEl,source=activePlanSnapshot.markdown||'',offset=source.indexOf(label);body.scrollTop=offset<0?0:source.slice(0,offset).split('\n').length*16;body.tabIndex=-1;body.focus({preventScroll:true});
    }
    async function archiveCapturedPlan(target){
      if(target.expected_revision==='unknown'||!target.definition_hash)throw new Error('Review and import the plan definition before lifecycle commands.');
      if(!window.confirm('Archive '+target.id+'? Its history will remain available.'))return;
      const response=await fetch('/api/architect/v1/plans/'+encodeURIComponent(target.id)+'/lifecycle/commands',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation_id:crypto.randomUUID(),expected_revision:Number(target.expected_revision),expected_definition_hash:target.definition_hash,command:{type:'archive_plan',reason:'Operator requested archive from captured plan actions'}})});
      const payload=await response.json();if(!response.ok)throw new Error(payload.message||'Archive rejected; refresh the target.');
      await loadPlans(activePlanId===target.id?null:activePlanId,{revealSelected:false});
    }
    function attachPlanContext(node,plan){node.dreamGraphPlanProjection=plan;
      window.DreamGraphContextMenu.attach(node,()=>{const plan=node.dreamGraphPlanProjection,target=contextTarget(plan,'plan',plan.id);return [
        {label:'Open plan',run:()=>openCapturedPlan(target)},
        plan.operational_state?.plan_lifecycle==='verifying'
          ? {label:'Prepare final verification…',run:()=>prepareNativePlanTask(target,plan.title||plan.id)}
          : {label:'Reveal current slice',run:async()=>{await openCapturedPlan(target);document.getElementById('slice-jump-current').click();}},
        {label:'Open implementation log',available:!!(plan.vscode_links&&plan.vscode_links.implementation_log),reason:'No source link in this projection',run:()=>{window.location.href=plan.vscode_links.implementation_log;}},
        {label:'Ask Architect…',run:()=>draftContextQuestion(target,plan.title||plan.id)},
        {label:'Copy target',run:()=>copyContextTarget(target)},
        {label:'Archive…',available:target.expected_revision!=='unknown'&&!!target.definition_hash,reason:'Review the canonical plan definition first',run:()=>archiveCapturedPlan(target)}
      ];},plan.title||plan.id);
    }
    function attachConcernContext(node,plan,anchor,label){
      attachEvidenceContext(node,plan,'nervous_point',anchor?anchor.id:null,label,[
        {label:'Find related slices…',run:target=>draftContextQuestion(target,label+' — find declared related slices and dependencies; disclose missing links rather than inventing them')},
        {label:'Review concern…',run:target=>draftContextQuestion(target,label+' — review evidence and propose a rationale; distinguish acknowledged, mitigated and resolved without marking status from prose')}
      ],anchor);
    }
    function attachAdrContext(node,plan,adr){
      const target=contextTarget(plan,'adr',adr);
      const open=async()=>{await openCapturedPlan(target);await openAdrEditor(adr);setArchitectCenterTab('adr');};
      window.DreamGraphContextMenu.attach(node,()=>[
        {label:'Open decision',run:open},
        {label:'Propose change…',run:async()=>{await open();window.adrEditorStatusEl.textContent='Review the decision and submit an explicit proposal. The accepted decision is not overwritten.';}},
        {label:'Inspect plan binding',run:()=>inspectCapturedTarget(target,adr)},
        {label:'Ask Architect…',run:()=>draftContextQuestion(target,adr)},
        {label:'Copy target',run:()=>copyContextTarget(target)}
      ],adr);
    }
    function attachScheduleContext(node,schedule){
      const captured=structuredClone(schedule),target=Object.freeze({instance_id:architectInstanceId,kind:'schedule',id:captured.id,
        expected_revision:captured.definition_revision,plan_id:captured.linked_context?.plan_id||null,slice_id:captured.linked_context?.slice_id||null});
      const open=view=>{const search=new URLSearchParams({schedule:target.id,revision:String(target.expected_revision),view:view}).toString();if(typeof openArchitectOperationalWorkspace==='function')openArchitectOperationalWorkspace('schedules',search);else window.open('/schedules?'+search, '_blank','noopener');};
      const pause=(captured.actions||[]).find(action=>action.id==='pause');
      window.DreamGraphContextMenu.attach(node,()=>[
        {label:'Edit schedule…',run:()=>open('edit')},
        {label:'Preview upcoming runs',run:()=>open('preview')},
        {label:'Run now…',run:()=>open('run')},
        {label:captured.enabled?'Pause future dispatch':'Preview and enable…',available:!captured.enabled||!!pause,reason:'No captured pause command',run:()=>captured.enabled?postScheduleAction(pause):open('enable')},
        {label:'View run history',run:()=>open('history')},
        {label:'Copy target',run:()=>copyContextTarget(target)}
      ],captured.name||captured.id);
    }
    function attachEvidenceContext(node,plan,kind,id,label,extra,anchor){
      if (!id) {
        const source={identity:null,availability:'unattested',kind:kind,plan_id:plan.id,label:label,source_reference:anchor?.target||null,revision:String((plan.operational_state||{}).revision??'unknown')};
        window.DreamGraphContextMenu.attach(node,()=>[
          {label:'Inspect source (as of view)',run:()=>{setArchitectCenterTab('plan');centerPlanTitleEl.textContent='Source as of view: '+(plan.title||plan.id);resetNode(centerPlanChipsEl);centerPlanBodyEl.textContent=plan.markdown||'Source unavailable in this view';}},
          {label:'Ask Architect…',run:()=>{setChatPromptDraft((chatInputEl.value?chatInputEl.value+'\n\n':'')+'Review this source item. Identity is unattested: '+JSON.stringify(source));setChatScope('project');setArchitectCenterTab('chat');chatInputEl.focus();}},
          {label:'Copy source reference',run:()=>navigator.clipboard.writeText(JSON.stringify(source,null,2))},
          {label:'Governed status unavailable',available:false,reason:'No stable source identity. Refresh or reconcile the plan before proposing a status change.',run:()=>{}}
        ],label);return;
      }
      const target=contextTarget(plan,kind,id,anchor);
      window.DreamGraphContextMenu.attach(node,()=>[
        {label:'Inspect source',run:()=>inspectCapturedTarget(target,label)},
        ...(extra||[]).map(action=>({...action,run:()=>action.run(target)})),
        {label:'Ask Architect…',run:()=>draftContextQuestion(target,label)},
        {label:'Copy target',run:()=>copyContextTarget(target)}
      ].slice(0,6),label);
    }
    function restorePlanDisclosures(planId){document.querySelectorAll('.living-plan-foldout').forEach((node,index)=>{const key=planId+':'+index;if(planDisclosureState.has(key))node.open=planDisclosureState.get(key);node.ontoggle=()=>{if(activePlanId===planId)planDisclosureState.set(key,node.open);};});}
    window.addEventListener('dreamgraph.action.error',event=>{actionStatusEl.textContent=event.detail;const notice=document.getElementById('context-action-status');notice.hidden=false;notice.textContent=event.detail;});
`;
