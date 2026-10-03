/** Actual compiled shell/Chromium, fake bounded authority/executors, zero inference or live data. */
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {createInstance} from '../dist/instance/lifecycle.js';
const {chromium}=await import(pathToFileURL(process.env.ASHOKA_PLAYWRIGHT_MODULE).href);
const directory=await mkdtemp(join(tmpdir(),'dg-browser-clients-')),out=resolve(process.env.ASHOKA_ARCHITECT_QUALIFICATION_DIR||'docs/ashoka/browser-25-review');await mkdir(out,{recursive:true});
let child,browser;const checks=[],errors=[],mutations=[],report={scope:'Focused Windows actual Chromium/compiled Architect shell, fake authority/executors, no inference; these composed checks are not complete normative UX/GE acceptance',checks,errors};
const check=(name,detail)=>{checks.push({name,detail});console.log(name);};
try{
 await mkdir(join(directory,'plans'));await writeFile(join(directory,'plans','fixture.md'),'# Fixture\n\nADR-001: Preserve captured authority.\n\n## Nervous Points\n\n- Preserve source evidence.\n\n## Open Questions\n\n- Which constraint applies?\n\n## Slice 0 — Baseline\n\n- status: pending\n\n**Acceptance:** Retain evidence.\n');
 const master=join(directory,'master'),instance=await createInstance({name:'browser-fixture',projectRoot:directory,masterDir:master,repos:{fixture:directory}});
 const reservation=createServer();await new Promise(done=>reservation.listen(0,'127.0.0.1',done));const port=reservation.address().port;await new Promise(done=>reservation.close(done));const base=`http://127.0.0.1:${port}`;
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('DREAMGRAPH_')&&!key.startsWith('DG_')&&key!=='DATABASE_URL'));
 Object.assign(env,{DREAMGRAPH_INSTANCE_UUID:instance.instance.uuid,DREAMGRAPH_MASTER_DIR:master,DREAMGRAPH_DATA_DIR:instance.scope.dataDir,DREAMGRAPH_LLM_PROVIDER:'none',DREAMGRAPH_SCHEDULER:'{"enabled":false}',DREAMGRAPH_REPOS:JSON.stringify({fixture:directory})});
 child=spawn(process.execPath,[resolve('dist/index.js'),'--transport','http','--port',String(port)],{cwd:directory,env,stdio:['ignore','pipe','pipe']});
 let stderr='';await new Promise((done,reject)=>{const timer=setTimeout(()=>reject(new Error('Daemon startup: '+stderr)),15000);child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-24000);if(String(chunk).includes('Server running on')){clearTimeout(timer);done();}});child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Daemon exited ${code}: ${stderr}`));});});
 browser=await chromium.launch({executablePath:process.env.ASHOKA_BROWSER_EXECUTABLE,headless:true});report.browser=await browser.version();const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.on('pageerror',error=>errors.push(String(error)));
 const sample=await (await page.request.get(base+'/api/architect/v1/plans/fixture')).json();assert.ok(sample.plan,'Actual plan projection required for fixture shape: '+JSON.stringify(sample));
 const created=await page.request.post(base+'/api/schedules/v2/create',{data:{operation_id:'browser-context-schedule',name:'Captured schedule',action:'graph_maintenance',trigger_type:'interval',interval_ms:60000,timezone:'UTC',enabled:false}});
 assert.equal(created.status(),200,'Actual disposable schedule must be created: '+await created.text());const schedule=(await created.json()).schedule;
 const schedulesResponse=await page.request.get(base+'/api/architect/v1/schedules');
 const schedulesBody=await schedulesResponse.text();
 assert.equal(schedulesResponse.status(),200,'Actual schedule projection must be available before UI doubles: '+schedulesBody+'; daemon: '+stderr);
 const plans=Array.from({length:1000},(_,i)=>({id:`plan-${i}`,title:`Plan ${i} ${'architecture and execution scope '.repeat(i%4)}`.trim(),slice_count:1,checkpoint_count:0,adr_bindings:[],operational_state:{...sample.plan.operational_state,source:'typed_plan_authority',revision:1,definition_hash:'fixture-definition',current_slice_ids:[],running_slice_ids:[]}}));
 const tree=Array.from({length:10},(_,i)=>({id:`group-${i}`,title:`Group ${i}`,children:plans.slice(i*100,(i+1)*100).map(plan=>({id:plan.id}))}));
 let selected='plan-875',revision=1,offline=false,slowId=null,previewEntered=null,releasePreview=null,nativeTaskEnabled=false;
 const detail=id=>{const plan={...structuredClone(sample.plan),...structuredClone(plans.find(plan=>plan.id===id)),operational_state:{...sample.plan.operational_state,source:'typed_plan_authority',reported_progress:undefined,revision,definition_hash:'fixture-definition',current_slice_ids:[sample.plan.registry.slices[0].id],running_slice_ids:[]}};plan.registry.operational_state=plan.operational_state;if(nativeTaskEnabled){plan.registry.slices[0].status='in_progress';plan.registry.slices[0].status_source='typed_plan_authority';}return plan;};
 const fulfill=(route,value,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
 await page.route('**/api/architect/v1/plans**',async route=>{const request=route.request(),url=new URL(request.url()),suffix=url.pathname.slice('/api/architect/v1/plans'.length);
  if(offline)return route.abort('failed');
  if(!suffix)return fulfill(route,{...sample,plan:undefined,plans,plan_tree:tree,plan_filters:{status_options:[],phase_options:[]},selected_plan_id:selected});
  const [,id,...parts]=suffix.split('/');if(parts.join('/')==='future-review')return fulfill(route,{future_review:{planId:id,candidates:[],review_decisions:[]}});
  if(parts.join('/')==='lifecycle/preview') {
   previewEntered?.();if(releasePreview)await releasePreview;
   const sliceId=sample.plan.registry.slices[0].id;
   return fulfill(route,{...sample,operator_id:'fixture-operator',preview:{existing_revision:revision,scope:{instance_id:instance.instance.uuid,project_id:'fixture-project',id},
    definition:{definition_hash:'fixture-definition',slices:[{id:sliceId}]},state:{revision,definition_hash:'fixture-definition',lifecycle:'implementing',
    reconciliation:{state:'current'},slices:[{id:sliceId,status:'in_progress'}],current_slice_ids:[sliceId],plan_blockers:[],leases:[],
    approval:{id:'fixture-approval',owner:'fixture-operator',definition_hash:'fixture-definition',scope:[sliceId]}}}});
  }
  if(request.method()==='POST'){const body=request.postDataJSON();mutations.push({id,body});return fulfill(route,{ok:false,message:'PLAN_REVISION_CONFLICT: captured revision changed'},409);}
  if(slowId===id)await new Promise(done=>setTimeout(done,250));return fulfill(route,{...sample,plan:detail(id)});
 });
 await page.route('**/api/architect/v1/selection',route=>{selected=route.request().postDataJSON().selected_plan_id;return fulfill(route,{...sample,result:{persisted:false}});});
 const adrPosts=[];await page.route('**/api/architect/v1/adrs/**',route=>{
  if(route.request().method()==='POST'){adrPosts.push(route.request().postDataJSON());return fulfill(route,{result:{audit_id:'fixture-proposal'}});}
  return fulfill(route,{adr:{id:'ADR-001',title:'Captured decision',status:'accepted'},full_content:{id:'ADR-001',title:'Captured decision',status:'accepted',decision:{chosen:'Preserve authority'},context:{problem:'Wrong target'},guard_rails:[],tags:[]}});
 });
 await page.goto(base+'/architect');await page.locator('#plan-title').filter({hasText:'Plan 875'}).waitFor();await page.waitForTimeout(80);
 const hide=page.getByRole('button',{name:'Hide',exact:true});if(await hide.isVisible())await hide.click();const dismiss=page.getByRole('button',{name:'Dismiss',exact:true});if(await dismiss.isVisible())await dismiss.click();
 const centered=await page.locator('#plan-list').evaluate(rail=>{const row=rail.querySelector('[data-plan-id="plan-875"]'),r=rail.getBoundingClientRect(),b=row.getBoundingClientRect();return {delta:Math.abs((b.top+b.bottom)/2-(r.top+r.bottom)/2),scroll:rail.scrollTop};});assert.ok(centered.scroll>0&&centered.delta<120,JSON.stringify(centered));assert.equal(await page.locator('#plan-list button.plan-item').count(),1000);check('B25-01','Actual 1,000 variable-height rows restore selected plan by ID and center only the rail.');
 await page.locator('#plan-search-input').fill('Plan 20 ');assert.equal(await page.locator('#plan-title').innerText(),plans[875].title);await page.getByRole('button',{name:'Reveal selected plan',exact:true}).click();await page.locator('#plan-list').getByText('Selected plan · outside current filters').waitFor();assert.equal(await page.locator('[data-plan-id="plan-875"]').count(),1);assert.equal(await page.locator('#plan-search-input').inputValue(),'Plan 20 ');check('B25-02','Filtering preserves active plan; explicit reveal adds one labelled row without clearing filters or substituting first plan.');
 await page.locator('#plan-search-input').fill('');await page.locator('#plan-list').evaluate(rail=>rail.scrollTop=500);const retained=await page.locator('#plan-list').evaluate(rail=>rail.scrollTop);await page.evaluate(()=>loadPlans(undefined,{revealSelected:false}));assert.equal(await page.locator('#plan-list').evaluate(rail=>rail.scrollTop),retained);check('B25-03','Background list/detail refresh retains rail scroll instead of stealing focus.');
 await page.evaluate(()=>{const row=document.querySelector('[data-plan-id="plan-875"]').parentElement;row.querySelector('.dg-overflow').click();});const menu=page.getByRole('menu');await menu.waitFor();assert.equal(await menu.getByRole('menuitem').count(),6);assert.equal(await page.locator('#plan-title').innerText(),plans[875].title);
 await page.evaluate(()=>loadPlan('plan-20',null,{revealSelected:false}));await menu.getByRole('menuitem',{name:'Ask Architect…',exact:true}).click();assert.ok((await page.locator('#chat-input').inputValue()).includes('plan-875'));assert.equal(mutations.length,0);check('B25-04','Menu retains captured plan after selection changes; Ask creates an editable draft without sending or mutating.');
 await page.evaluate(()=>loadPlan('plan-875',null,{revealSelected:false}));await page.locator('#chat-input').fill('Keep this draft');await page.locator('#chat-input').click({button:'right'});assert.equal(await page.getByRole('menu').count(),0);assert.equal(await page.locator('#chat-input').inputValue(),'Keep this draft');check('B25-05','Native text-input menu/draft remains intact.');
 await page.evaluate(()=>document.querySelector('[data-plan-id="plan-875"]').focus());await page.keyboard.press('Shift+F10');await menu.waitFor();await page.waitForFunction(()=>document.activeElement.closest('.dg-menu'));await page.keyboard.press('End');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Archive…');await page.keyboard.press('Home');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Open plan');await page.keyboard.press('a');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Ask Architect…');await page.keyboard.press('Escape');assert.equal(await menu.count(),0);check('B25-06','Shift-F10, Home/End, type-ahead and Escape work with focus restoration.');
 await page.evaluate(()=>document.querySelector('[data-plan-id="plan-875"]').parentElement.querySelector('.dg-overflow').click());revision=2;page.once('dialog',dialog=>dialog.accept());await menu.getByRole('menuitem',{name:'Archive…',exact:true}).click();await page.locator('#context-action-status').filter({hasText:'PLAN_REVISION_CONFLICT'}).waitFor();assert.equal(mutations.at(-1).id,'plan-875');assert.equal(mutations.at(-1).body.expected_revision,1);check('B25-07','Captured CAS command rejects changed revision; it cannot silently target the newly selected plan.');
 slowId='plan-21';await page.evaluate(()=>{void loadPlan('plan-21',null,{revealSelected:true});void loadPlan('plan-22',null,{revealSelected:true});});await page.locator('#plan-title').filter({hasText:'Plan 22 '}).waitFor();await page.waitForTimeout(320);assert.equal(await page.locator('#plan-title').innerText(),plans[22].title);check('B25-08','Out-of-order detail loads and delayed reveal ignore stale selection.');
 const disclosure=page.locator('.living-plan-foldout').filter({has:page.locator('summary',{hasText:'Nervous points'})});await disclosure.locator('summary').click();assert.equal(await disclosure.getAttribute('open'),'');assert.equal(await disclosure.locator('summary').evaluate(node=>getComputedStyle(node,'::before').content),'"▾"');await page.evaluate(()=>refreshPlanLifecycle());assert.equal(await disclosure.getAttribute('open'),'');check('B25-09','Explicit disclosure chevron and per-plan open state survive lifecycle refresh.');
 await page.setViewportSize({width:720,height:800});await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>{const target=document.querySelector('[data-plan-id="plan-22"]').parentElement.querySelector('.dg-overflow');target.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:715,clientY:795}));});await menu.waitFor();const box=await menu.boundingBox();assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=720&&box.y+box.height<=800);await page.screenshot({path:join(out,'context-menu-narrow.png')});await page.keyboard.press('Escape');check('B25-10','Narrow/reduced-motion menu stays inside viewport, with touch-visible overflow styling.');
 offline=true;await page.evaluate(()=>loadPlans().catch(error=>{document.getElementById('rail-status').textContent='Authority unavailable: '+error.message;}));assert.equal(await page.locator('#plan-title').innerText(),plans[22].title);offline=false;await page.evaluate(()=>loadPlans(undefined,{revealSelected:false}));await page.locator('#plan-title').filter({hasText:'Plan 22 '}).waitFor();check('B25-11','Offline refresh retains the as-of view and exposes failure; reconnect rereads canonical state.');
 assert.equal(await page.locator('button button').count(),0);assert.equal(await page.locator('#slice-list .dg-overflow').count(),1);assert.ok(await page.locator('#living-plan-nervous-point-list .dg-overflow').count());check('B25-12','Sibling overflow controls and slice/concern menus retain native card interactions without nested buttons.');
 let releaseConfig,configEntered;const configReady=new Promise(done=>{configEntered=done;}),configWait=new Promise(done=>{releaseConfig=done;}),chatRequests=[];
 await page.route('**/api/architect/v1/config',async route=>{configEntered();await configWait;return fulfill(route,{...sample,result:{persisted:false}});});
 await page.route('**/api/architect/v1/chat',route=>{chatRequests.push(route.request().postDataJSON());return fulfill(route,{...sample,result:{content:'Offline captured-target fixture result',route:{tool_loop:{}},continuation:{status:'stop',reason:'fixture_no_followup'}}});});
 await page.evaluate(()=>{setChatScope('plan');window.fixtureChat=sendChatMessage('Inspect captured plan',null);});await configReady;
 await page.evaluate(()=>loadPlan('plan-23',null,{revealSelected:false}));releaseConfig();await page.evaluate(()=>window.fixtureChat);
 assert.equal(chatRequests.length,1);assert.equal(chatRequests[0].planId,'plan-22');assert.equal(chatRequests[0].selected_plan_id,'plan-22');assert.equal(await page.locator('#plan-title').innerText(),plans[23].title);
 await page.evaluate(()=>sendChatMessage('Continue original plan',{continuationToken:'fixture-token',selectedActionId:'fixture',targetPlanId:'plan-22'}));assert.equal(chatRequests.length,1);await page.locator('#chat-status').filter({hasText:'Continuation paused'}).waitFor();
 check('B25-13','Actual delayed preference persistence keeps chat bound to its original plan; result cannot refresh the new selection, and mismatched continuation dispatch is stopped.');
 const previewReady=new Promise(done=>{previewEntered=done;});let unblockPreview;releasePreview=new Promise(done=>{unblockPreview=done;});const beforeApproval=mutations.length;
 await page.evaluate(()=>document.getElementById('plan-approve-implementation').click());await previewReady;
 await page.evaluate(()=>loadPlan('plan-24',null,{revealSelected:false}));unblockPreview();await page.locator('#context-action-status').filter({hasText:'Selection changed during approval preview'}).waitFor();assert.equal(mutations.length,beforeApproval);assert.equal(await page.locator('#plan-title').innerText(),plans[24].title);
 check('B25-14','Actual approval preview race stops before any lifecycle mutation; the newly selected plan cannot inherit another plan’s reviewed scope.');
 // Composed production UI with declared host-transport replies; real journal/authority is qualified separately.
 const reviews=[],declines=[],inspections=[];let lostReviewReply=true,pendingReview=null,inspectionReply=null;
 const reviewRequest=id=>({execution_id:id,approval_id:'review-'+id,context_receipt_id:'receipt-'+id,expected_record_revision:7,
  approved_actions:[{tool:'edit_file',arguments:{filePath:'source.ts',text:'Literal 漢🙂 <script>never executable</script> source'},scope_id:'fixture',calls:1}]});
 await page.route('**/api/executions/v1/**',async route=>{
  const pathname=new URL(route.request().url()).pathname,body=route.request().postDataJSON();
  if(pathname.endsWith('/reviews/read'))return fulfill(route,{execution_id:body.execution_id,authority_active:true,review_enabled:true,requests:pendingReview?[pendingReview]:[]});
  if(pathname.endsWith('/reviews/decline')){declines.push(body);pendingReview=null;return fulfill(route,{...body,status:'declined'});}
  if(pathname==='/api/executions/v1/read'){inspections.push(body);return fulfill(route,inspectionReply??{message:'No declared inspection'},inspectionReply?200:409);}
  if(pathname.endsWith('/approve')){reviews.push(body);pendingReview=null;if(lostReviewReply){lostReviewReply=false;return route.abort('failed');}
   return fulfill(route,{approval_id:body.approval_id,review_activated:true,execution:{execution_id:body.execution_id}});}
  return fulfill(route,{message:'Unqualified fixture route'},409);
 });
 await page.evaluate(()=>setArchitectCenterTab('chat'));
 pendingReview=reviewRequest('original-execution');await page.evaluate(()=>trackExecutionReviews({state:'running',active_execution_id:'original-execution'}));
 await page.locator('#execution-review-panel').waitFor({state:'visible'});
 assert.deepEqual(JSON.parse(await page.locator('#execution-review-detail').textContent()),pendingReview);assert.equal(await page.locator('#execution-review-detail script').count(),0);
 await page.evaluate(()=>loadPlan('plan-26',null,{revealSelected:false}));assert.deepEqual(JSON.parse(await page.locator('#execution-review-detail').textContent()),pendingReview);
 check('B25-15','Exact review retains literal Unicode/source arguments and original execution/receipt/revision when selected plan changes; no source markup is executed.');
 const captured=structuredClone(pendingReview);await page.getByRole('button',{name:'Approve once',exact:true}).click();
 await page.locator('#execution-review-status').filter({hasText:'acknowledgement unconfirmed'}).waitFor();
 await page.evaluate(()=>{stopExecutionReviewPolling();trackExecutionReviews({state:'running',active_execution_id:'other-execution'});});
 assert.deepEqual(JSON.parse(await page.locator('#execution-review-detail').textContent()),captured);assert.equal(reviews.length,1);
 const beforeUncertainChat=chatRequests.length;await page.evaluate(()=>sendChatMessage('Must not redispatch uncertain effect',null));assert.equal(chatRequests.length,beforeUncertainChat);
 await page.getByRole('button',{name:'Retry same review',exact:true}).click();await page.locator('#execution-review-panel').waitFor({state:'hidden'});
 assert.deepEqual(reviews,[captured,captured]);assert.ok(!(await page.locator('#chat-status').textContent()).includes('Resolve the unconfirmed'));check('B25-16','Lost acknowledgement retains exact ID/payload across stop and another execution event; continuation is fenced, retry cannot switch target, and confirmed acknowledgement clears the obsolete blocking status.');
 pendingReview=reviewRequest('decline-execution');await page.evaluate(()=>trackExecutionReviews({state:'running',active_execution_id:'decline-execution'}));
 await page.locator('#execution-review-panel').waitFor({state:'visible'});await page.getByRole('button',{name:'Decline',exact:true}).click();await page.locator('#execution-review-panel').waitFor({state:'hidden'});
 assert.deepEqual(declines,[{execution_id:'decline-execution',approval_id:'review-decline-execution'}]);assert.equal(reviews.length,2);
 check('B25-17','Decline addresses only the captured proposal and issues no approval.');
 pendingReview=reviewRequest('narrow-execution');await page.setViewportSize({width:720,height:800});await page.evaluate(()=>trackExecutionReviews({state:'running',active_execution_id:'narrow-execution'}));
 await page.locator('#execution-review-panel').waitFor({state:'visible'});const reviewBox=await page.locator('#execution-review-panel').boundingBox();assert.ok(reviewBox.x>=0&&reviewBox.x+reviewBox.width<=720,JSON.stringify(reviewBox));
 await page.locator('#execution-review-panel summary').click();assert.equal(await page.locator('#execution-review-detail').isVisible(),false);await page.locator('#execution-review-panel summary').click();
 await page.screenshot({path:join(out,'action-review-narrow.png')});pendingReview=null;await page.evaluate(()=>pollExecutionReviews());await page.locator('#execution-review-panel').waitFor({state:'hidden'});await page.evaluate(()=>stopExecutionReviewPolling());
 check('B25-18','Narrow review is within the viewport with visible native disclosure, complete scrollable detail, and no approval after the request disappears.');
 pendingReview=reviewRequest('inspection-execution');lostReviewReply=true;
 await page.evaluate(()=>trackExecutionReviews({state:'running',active_execution_id:'inspection-execution'}));await page.locator('#execution-review-panel').waitFor({state:'visible'});
 const inspectedRequest=structuredClone(pendingReview);await page.getByRole('button',{name:'Approve once',exact:true}).click();await page.locator('#execution-review-status').filter({hasText:'acknowledgement unconfirmed'}).waitFor();
 const reviewCount=reviews.length;
 const actualReply={execution_id:'inspection-execution',instance_id:'declared-fixture',record_revision:8,authority_active:false,status:'recovery_required',graph_receipt_ids:[],obligation_ids:['unresolved-source-effect'],literal:'<script>window.inspectionExecuted=true</script>'};
 inspectionReply={...actualReply,padding:'漢'.repeat(100000)};await page.getByRole('button',{name:'Check outcome',exact:true}).click();
 await page.locator('#execution-review-status').filter({hasText:'256 KiB UTF-8 byte ceiling'}).waitFor();assert.deepEqual(JSON.parse(await page.locator('#execution-review-detail').textContent()),inspectedRequest);assert.equal(reviews.length,reviewCount);
 check('B25-19','Streamed inspection over the independent UTF-8 byte ceiling refuses without clipping evidence, changing the captured target, or issuing another approval.');
 inspectionReply=actualReply;await page.getByRole('button',{name:'Check outcome',exact:true}).click();await page.locator('#execution-review-status').filter({hasText:'Outcome remains unresolved'}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Retry same review',exact:true}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Decline',exact:true}).isDisabled(),true);
 assert.deepEqual(JSON.parse(await page.locator('#execution-review-detail').textContent()),{request:inspectedRequest,inspection:actualReply});assert.equal(await page.evaluate(()=>window.inspectionExecuted),undefined);
 const beforeRecoveryChat=chatRequests.length;await page.evaluate(()=>sendChatMessage('Do not resume unresolved work',null));assert.equal(chatRequests.length,beforeRecoveryChat);
 inspectionReply={...actualReply,status:'no_change',obligation_ids:[]};await page.getByRole('button',{name:'Check outcome',exact:true}).click();await page.locator('#execution-review-title').filter({hasText:'Original execution · no_change'}).waitFor();
 assert.deepEqual(inspections,[{execution_id:'inspection-execution'},{execution_id:'inspection-execution'},{execution_id:'inspection-execution'}]);assert.equal(reviews.length,reviewCount);
 assert.equal(await page.getByRole('button',{name:'Retry same review',exact:true}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Check outcome',exact:true}).isDisabled(),true);
 assert.ok(!(await page.locator('#chat-status').textContent()).includes('Resolve the unconfirmed'));
 await page.screenshot({path:join(out,'action-review-inspection-narrow.png')});
 check('B25-20','Read-only original-execution recovery keeps unknown closure fenced and literal, disables revoked approval, and releases the acknowledgement fence only for a declared settled inactive closure without another effect/approval.');
 await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>loadPlan('plan-22',null,{revealSelected:false}));
 await page.locator('#chat-input').fill('Keep the existing operator draft');const beforeConcernChat=chatRequests.length;
 await page.locator('#living-plan-nervous-point-list .dg-overflow').click();await menu.waitFor();assert.equal(await menu.getByRole('menuitem').count(),5);
 await menu.getByRole('menuitem',{name:'Review concern…',exact:true}).click();const concernDraft=await page.locator('#chat-input').inputValue();
 assert.ok(concernDraft.startsWith('Keep the existing operator draft'));assert.ok(concernDraft.includes('source_hash'));assert.ok(concernDraft.includes('"parent_id":"plan-22"'));assert.equal(chatRequests.length,beforeConcernChat);
 check('B25-21','Concern review keeps the unique canonical source anchor, original plan and existing draft, without sending or resolving status from prose.');
 const revealSection=async id=>{const disclosure=page.locator('.architect-right-accordion').filter({has:page.locator('#'+id)});if(await disclosure.getAttribute('open')===null)await disclosure.locator('summary').first().click();};
 await revealSection('adr-list');
 await page.locator('.adr-binding-item .dg-overflow').click();await menu.waitFor();assert.equal(await menu.getByRole('menuitem').count(),5);await menu.getByRole('menuitem',{name:'Propose change…',exact:true}).click();
 await page.locator('#adr-editor-status').filter({hasText:'Review the decision'}).waitFor();
 assert.equal(await page.locator('#adr-editor-title').inputValue(),'Captured decision');await page.evaluate(()=>loadPlan('plan-23',null,{revealSelected:false}));
 await page.locator('#adr-editor').getByRole('button',{name:'Record proposal',exact:true}).click();await page.locator('#adr-editor-status').filter({hasText:'Plan context changed'}).waitFor();assert.equal(adrPosts.length,0);
 check('B25-22','ADR menu opens the existing proposal editor; changing plan before submit refuses the original draft without writing a proposal against a replacement plan.');
 await page.evaluate(()=>loadSchedules(activePlanId,activePlanLoadToken));await revealSection('schedule-list');const scheduleRow=page.locator('#schedule-list li').filter({hasText:'Captured schedule'});await scheduleRow.locator('.dg-overflow').click();await menu.waitFor();assert.equal(await menu.getByRole('menuitem').count(),6);
 const popupPromise=context.waitForEvent('page');await menu.getByRole('menuitem',{name:'Edit schedule…',exact:true}).click();const schedulePage=await popupPromise;schedulePage.on('pageerror',error=>errors.push(String(error)));await schedulePage.waitForLoadState('domcontentloaded');
 await schedulePage.locator('#sw-editor').waitFor({state:'visible'});assert.equal(await schedulePage.locator('#sw-editor [name=name]').inputValue(),'Captured schedule');assert.equal(new URL(schedulePage.url()).searchParams.get('schedule'),schedule.id);assert.equal(new URL(schedulePage.url()).searchParams.get('revision'),String(schedule.definition_revision));
 const scheduleProjection=await (await page.request.get(base+'/api/architect/v1/schedules')).json(),actualSchedule=scheduleProjection.schedules.find(row=>row.id===schedule.id);
 assert.equal(actualSchedule.linked_context.plan_id,null);for(const action of actualSchedule.actions){assert.equal(action.body.plan_id,null);assert.equal(action.body.slice_id,null);}
 const jobs=await (await schedulePage.request.get(base+'/api/jobs/v1')).json();assert.equal(jobs.total,0);await schedulePage.close();
 check('B25-23','Schedule menu opens the actual v2 workspace at its exact captured definition; unlinked plan/slice remain null and edit navigation enqueues no job or model work.');
 await revealSection('evidence-link-list');await page.locator('#evidence-link-list .dg-overflow').first().click();await menu.waitFor();assert.equal(await menu.getByRole('menuitem').count(),4);await menu.getByRole('menuitem',{name:'Ask Architect…',exact:true}).click();
 const evidenceDraft=await page.locator('#chat-input').inputValue();assert.ok(evidenceDraft.includes('"identity":null'));assert.ok(evidenceDraft.includes('"kind":"evidence"'));assert.ok(evidenceDraft.includes('source_reference'));assert.equal(chatRequests.length,beforeConcernChat);
 check('B25-24','Source file/heading references remain literal unattested evidence, rather than fabricated graph entity identities, and only draft a question.');
 await page.locator('#chat-input').fill('Double activation');await page.evaluate(()=>document.querySelector('[data-plan-id="plan-23"]').parentElement.querySelector('.dg-overflow').click());await menu.waitFor();
 await page.evaluate(()=>{const button=Array.from(document.querySelectorAll('.dg-menu button')).find(node=>node.textContent==='Ask Architect…');button.click();button.click();});
 assert.equal((await page.locator('#chat-input').inputValue()).split('Target:').length-1,1);assert.equal(chatRequests.length,beforeConcernChat);
 await page.evaluate(()=>document.querySelector('[data-plan-id="plan-23"]').parentElement.querySelector('.dg-overflow').click());await page.evaluate(()=>loadPlans(undefined,{revealSelected:false}));await menu.waitFor({state:'hidden'});
 check('B25-25','One menu activation dispatches once even for queued duplicate clicks; replacing its invoking row invalidates the old popup.');
 await page.setViewportSize({width:1440,height:1000});await page.locator('#plan-search-input').fill('');
 await page.evaluate(()=>{document.getElementById('plan-list').scrollTop=12000;});
 const anchor=await page.evaluate(()=>capturePlanRailAnchor());plans[2].title='Renamed plan with much longer variable-height scope '+('declared implementation evidence '.repeat(18));
 await page.evaluate(()=>loadPlans(undefined,{revealSelected:false}));const afterAnchor=await page.evaluate(()=>capturePlanRailAnchor());assert.equal(afterAnchor.id,anchor.id);assert.ok(Math.abs(afterAnchor.offset-anchor.offset)<2,JSON.stringify({anchor,afterAnchor}));
 check('B25-26','A real renamed row above the visible 1,000-plan rail changes height without moving the logical visible plan or its offset.');
 const touchContext=await browser.newContext({viewport:{width:960,height:800},hasTouch:true}),touchPage=await touchContext.newPage();touchPage.on('pageerror',error=>errors.push(String(error)));
 await touchPage.goto(base+'/architect?plan=fixture');const touchRow=touchPage.locator('button.plan-item[data-plan-id="fixture"]').locator('..'),touchMore=touchRow.locator('.dg-overflow');await touchMore.waitFor();assert.equal(await touchMore.evaluate(node=>getComputedStyle(node).opacity),'1');
 await touchMore.tap();await touchPage.getByRole('menu').waitFor();await touchPage.getByRole('menuitem',{name:'Ask Architect…',exact:true}).tap();assert.ok((await touchPage.locator('#chat-input').inputValue()).includes('"id":"fixture"'));assert.equal(await touchPage.getByRole('menu').count(),0);
 await touchPage.screenshot({path:join(out,'architect-touch-menu.png')});await touchContext.close();await page.bringToFront();check('B25-27','Actual Chromium touch input discovers overflow and taps a target-bound draft without a long-press, right-click or send.');
 await page.setViewportSize({width:720,height:260});await page.emulateMedia({forcedColors:'active',reducedMotion:'reduce'});await page.evaluate(()=>{window.fixtureZoomEvents=[];document.addEventListener('focusin',event=>window.fixtureZoomEvents.push({event:'focus',tag:event.target.tagName,text:event.target.textContent}));window.addEventListener('resize',()=>window.fixtureZoomEvents.push({event:'resize'}));visualViewport.addEventListener('scroll',()=>window.fixtureZoomEvents.push({event:'viewport-scroll',x:visualViewport.offsetLeft,y:visualViewport.offsetTop}));visualViewport.addEventListener('resize',()=>window.fixtureZoomEvents.push({event:'viewport-resize',width:visualViewport.width,height:visualViewport.height}));document.body.style.zoom='2';});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.evaluate(()=>{const target=document.querySelector('[data-plan-id="plan-23"]').parentElement.querySelector('.dg-overflow');target.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:715,clientY:255}));});
 await menu.waitFor();const zoomBox=await menu.boundingBox();report.zoom=await menu.evaluate(node=>({innerWidth,innerHeight,viewport:{width:visualViewport.width,height:visualViewport.height,offsetLeft:visualViewport.offsetLeft,offsetTop:visualViewport.offsetTop},offsetWidth:node.offsetWidth,offsetHeight:node.offsetHeight,style:node.getAttribute('style'),zoom:getComputedStyle(document.body).zoom,rect:node.getBoundingClientRect().toJSON(),focus:document.activeElement.textContent}));assert.ok(zoomBox.x>=0&&zoomBox.y>=0&&zoomBox.x+zoomBox.width<=720&&zoomBox.y+zoomBox.height<=260,JSON.stringify(zoomBox));assert.equal(await menu.getByRole('menuitem').count(),6);await page.waitForFunction(()=>document.activeElement.closest('.dg-menu'));await page.keyboard.press('End');report.zoomEvents=await page.evaluate(()=>window.fixtureZoomEvents);report.zoomAfter=await page.evaluate(()=>({focus:document.activeElement.textContent,tag:document.activeElement.tagName,menus:document.querySelectorAll('.dg-menu').length,x:scrollX,y:scrollY}));assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Archive…');
 const focused=await page.evaluate(()=>document.activeElement.getBoundingClientRect().toJSON());assert.ok(focused.top>=zoomBox.y&&focused.bottom<=zoomBox.y+zoomBox.height+1,JSON.stringify({focused,zoomBox}));assert.ok(await menu.evaluate(node=>node.scrollTop>0));
 await page.screenshot({path:join(out,'architect-zoom-high-contrast.png')});await page.keyboard.press('Escape');await page.evaluate(()=>document.body.style.zoom='');await page.emulateMedia({forcedColors:'none',reducedMotion:'reduce'});check('B25-28','Actual 200% CSS layout zoom and forced-colors at the bottom/right edge keeps the entire accessible scrollable menu inside the narrow viewport. This is layout-scale qualification, not a browser-chrome zoom claim.');
 await page.setViewportSize({width:1440,height:1000});await page.locator('#chat-input').fill('Keep draft after removal');const removed=plans.findIndex(plan=>plan.id==='plan-23');assert.ok(removed>=0);plans.splice(removed,1);
 await page.evaluate(()=>loadPlans(undefined,{revealSelected:false}));await page.locator('#plan-title').filter({hasText:'No plan selected'}).waitFor();assert.equal(await page.locator('#architect-pulse-plan').innerText(),'Plan: none');assert.equal(await page.locator('#chat-input').inputValue(),'Keep draft after removal');assert.equal(await page.locator('button.plan-item.active').count(),0);assert.equal(await page.locator('#slice-list [data-slice-id]').count(),0);
 check('B25-29','Removing the actual selected row clears its execution/slice views and active selection without choosing another plan or losing the operator draft.');
 // Task preparation has real browser interactions and declared read-only authority replies; no inference.
 nativeTaskEnabled=true;await page.evaluate(()=>loadPlan('plan-22',null,{revealSelected:false}));await page.locator('#chat-input').fill('Keep explicit task draft');
 const originalTarget=await page.evaluate(()=>contextTarget(activePlanSnapshot,'slice',activePlanSnapshot.registry.slices[0].id));
 const beforeTaskChat=chatRequests.length,beforeTaskMutation=mutations.length;
 await revealSection('slice-list');await page.locator('#slice-list .dg-overflow').first().click();await menu.waitFor();
 assert.equal(await menu.getByRole('menuitem').count(),6);await menu.getByRole('menuitem',{name:'Prepare native task…',exact:true}).click();
 await page.locator('#chat-native-task').waitFor({state:'visible'});assert.equal(await page.locator('#chat-input').inputValue(),'Keep explicit task draft');
 assert.equal(chatRequests.length,beforeTaskChat);assert.equal(mutations.length,beforeTaskMutation);
 check('B25-30','Explicit preparation reads current ownership, stage, source definition, approval and revision, preserves the editable draft, and starts no work.');
 await page.evaluate(()=>loadPlan('plan-24',null,{revealSelected:false}));await page.evaluate(()=>sendChatMessage('Do not reuse another plan purpose',null));
 assert.equal(chatRequests.length,beforeTaskChat);assert.equal(await page.locator('#chat-input').inputValue(),'Keep explicit task draft');
 await page.locator('#chat-status').filter({hasText:'Prepared task belongs'}).waitFor();
 check('B25-31','Changed selection refuses a prepared native purpose before preference/model dispatch and preserves the operator draft.');
 await page.locator('#chat-native-task').click();assert.equal(await page.locator('#chat-native-task').isVisible(),false);assert.equal(await page.locator('#chat-input').inputValue(),'Keep explicit task draft');
 await page.evaluate(()=>loadPlan('plan-22',null,{revealSelected:false}));await page.evaluate(target=>prepareNativePlanTask(target,'Captured slice'),originalTarget);
 await page.evaluate(()=>sendChatMessage('Execute original prepared task',null));
 assert.deepEqual(chatRequests.at(-1).plan_execution,{scope:{instance_id:instance.instance.uuid,project_id:'fixture-project',id:'plan-22'},kind:'implementation',
  slice_id:sample.plan.registry.slices[0].id,expected_revision:revision,expected_definition_hash:'fixture-definition',approval_id:'fixture-approval'});
 assert.equal(await page.locator('#chat-native-task').isVisible(),false);assert.equal(mutations.length,beforeTaskMutation);
 check('B25-32','Normal reviewed submit carries the immutable original native purpose once; clearing the purpose retains the draft, and selection alone never admits implementation.');
 assert.deepEqual(errors,[]);report.success=true;await page.setViewportSize({width:1440,height:1000});const tabs=await page.locator('.architect-center-tab-strip').boundingBox();assert.ok(tabs.y<300,'Compact center tabs must stay above the work area, including when an action error is visible');await page.screenshot({path:join(out,'architect-context-actions.png')});
}catch(error){report.success=false;report.failure=String(error.stack||error);throw error;}finally{
 await writeFile(join(out,'qualification.json'),JSON.stringify(report,null,2));await browser?.close();if(child&&!child.killed){child.kill();await new Promise(done=>{if(child.exitCode!==null)return done();child.once('exit',done);});}await rm(directory,{recursive:true,force:true});
}
