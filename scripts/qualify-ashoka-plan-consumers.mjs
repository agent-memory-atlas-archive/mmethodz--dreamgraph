/** Real compiled daemon, CLI, MCP and Windows Chrome; disposable typed plans, zero inference. */
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {createHash} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {createInstance} from '../dist/instance/lifecycle.js';
import {writeServerMeta} from '../dist/cli/utils/daemon.js';
import {setDataDirOverride} from '../dist/utils/paths.js';
import {commitGraphWrites} from '../dist/graph/publication.js';
import {releaseGraphWriter} from '../dist/graph/writer-lease.js';
import {createPluginGraphContext} from '../dist/plugins/graph-context.js';
import {ContextPackSchema,PluginManifestSchema} from '@dreamgraph/sdk';
const require=createRequire(import.meta.url),{DaemonClient}=require('../extensions/vscode/dist/daemon-client.js');
const execute=promisify(execFile),modulePath=process.env.ASHOKA_PLAYWRIGHT_MODULE,executablePath=process.env.ASHOKA_BROWSER_EXECUTABLE;
if(!modulePath||!executablePath)throw new Error('Supply existing Playwright module and browser; no installation.');
const {chromium}=await import(pathToFileURL(modulePath).href);
const directory=await mkdtemp(join(tmpdir(),'dg-plan-consumers-')),out=resolve(process.env.ASHOKA_PLAN_QUALIFICATION_DIR||'docs/ashoka/plan-consumers-first');
await mkdir(out,{recursive:true});
let child,browser,mcp,editor;const checks=[],errors=[],snapshots=[],report={scope:'Actual compiled daemon/CLI/MCP/editor HTTP client and Windows Chromium, disposable reviewed lifecycle fixtures for both AT01/AT05 project families; plugin core read port and SDK generated validation. No paid-model understanding, native editor GUI, cross-platform runtime or full task acceptance claim.',checks,errors,snapshots};
const check=(name,detail)=>{checks.push({name,detail});console.log(name);};
try{
 const plansRoot=join(directory,'plans');await mkdir(plansRoot);
 const names=['dreamgraph','web64'];
 await writeFile(join(plansRoot,'ashoka-reported.md'),await readFile(resolve('tests/fixtures/ashoka/legacy-progress-plan.md'),'utf8'));
 await writeFile(join(plansRoot,'ashoka-reported.implementation-log.md'),await readFile(resolve('tests/fixtures/ashoka/legacy-progress-log.md'),'utf8'));
 for(const project of names)await writeFile(join(plansRoot,`${project}.md`),`# ${project} lifecycle fixture\n\nStatus: completed\n\n### Slice 0 - Verified work\n\n- id: done\n- status: verified\n\nAcceptance: independent source fixture checked.\n\n### Slice 1 - Blocked work\n\n- id: blocked\n- Depends on: done\n\nAcceptance: required source available.\n\n### Slice 2 - Dependent work\n\n- id: dependent\n- Depends on: blocked\n\nAcceptance: dependency verified.\n\n### Slice 3 - Independent work\n\n- id: independent\n- Depends on: done\n\nAcceptance: independent scope verified.\n`);
 const master=join(directory,'master'),created=await createInstance({name:'plan-consumers',projectRoot:directory,masterDir:master,repos:{fixture:directory}}),instance=created.instance,scope=created.scope;
 setDataDirOverride(scope.dataDir);
 await commitGraphWrites({actor:'declared-disposable-implementation',operation_id:'source-fixture',scope:['fixture:source'],writes:[{file:'features.json',content:JSON.stringify({features:[{id:'implementation-witness',name:'Disposable source implementation',source_kind:'manual'}]})}]});await releaseGraphWriter(scope.dataDir);
 const reservation=createServer();await new Promise(done=>reservation.listen(0,'127.0.0.1',done));const port=reservation.address().port;await new Promise(done=>reservation.close(done));const base=`http://127.0.0.1:${port}`;
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('DREAMGRAPH_')&&!key.startsWith('DG_')&&key!=='DATABASE_URL'));
 Object.assign(env,{DREAMGRAPH_INSTANCE_UUID:instance.uuid,DREAMGRAPH_MASTER_DIR:master,DREAMGRAPH_DATA_DIR:scope.dataDir,DREAMGRAPH_LLM_PROVIDER:'none',DREAMGRAPH_SCHEDULER:'{"enabled":false}',DREAMGRAPH_REPOS:JSON.stringify({fixture:directory})});
 child=spawn(process.execPath,[resolve('dist/index.js'),'--transport','http','--port',String(port)],{cwd:directory,env,stdio:['ignore','pipe','pipe']});
 let stderr='';await new Promise((done,reject)=>{const timer=setTimeout(()=>reject(new Error('Daemon startup: '+stderr)),30000);child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-24000);if(String(chunk).includes('Server running on')){clearTimeout(timer);done();}});child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Daemon exited ${code}: ${stderr}`));});});
 await writeServerMeta(scope.instanceRoot,{pid:child.pid,uuid:instance.uuid,command:'dreamgraph',bin_path:resolve('dist/index.js'),transport:'http',port,started_at:new Date().toISOString(),version:'13.4.0'});
 browser=await chromium.launch({executablePath,headless:true});report.browser=await browser.version();const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.on('pageerror',error=>errors.push(String(error)));
 const showSlices=async()=>{const disclosure=page.locator('.architect-right-accordion').filter({has:page.locator('#slice-list')});if(await disclosure.getAttribute('open')===null)await disclosure.locator('summary').first().click();};
 await page.goto(base+'/architect?plan=dreamgraph');await page.locator('#slice-list [data-slice-id="done"]').waitFor({state:'attached'});await showSlices();await page.locator('#slice-list [data-slice-id="done"]').waitFor();
 const get=async path=>{const response=await page.request.get(base+path);assert.equal(response.status(),200,await response.text());return response.json();};
 const post=async(path,body)=>{const response=await page.request.post(base+path,{data:body});assert.equal(response.status(),200,await response.text());return response.json();};
 const detail=async id=>(await get(`/api/architect/v1/plans/${id}`)).plan;
 // Original v13 progress remains readable before any C14 import. Use the actual frozen Ashoka files.
 const reportedPlan=await detail('ashoka-reported'),reported=reportedPlan.operational_state;
 assert.equal(reported.source,'legacy_review_projection');assert.equal(reported.reported_progress.completed,26);assert.equal(reported.reported_progress.required,32);
 assert.equal(reported.plan_lifecycle,'implementing');assert.match(reported.current_slice_title,/^Slice 25/);assert.equal(reported.active_slice,null);assert.deepEqual(reported.running_slice_ids,[]);
 assert.deepEqual(reported.verified_slice_ids,[]);assert.equal(reported.progress.verified,0);assert.equal(reported.next_eligibility.can_start,false);
 await assert.rejects(readFile(join(scope.dataDir,'plan_state.json')),{code:'ENOENT'});
 const legacyCli=await execute(process.execPath,[resolve('dist/cli/dg.js'),'architect',instance.uuid,'plan','show','ashoka-reported','--json','--master-dir',master],{cwd:directory,env,timeout:30000,maxBuffer:8*1024*1024,windowsHide:true});
 assert.deepEqual(JSON.parse(legacyCli.stdout).plan.operational_state,reported);
 await page.evaluate(()=>loadPlan('ashoka-reported',null,{revealSelected:true}));await showSlices();
 assert.equal(await page.locator('#slice-list .slice-completed').count(),26);assert.equal(await page.locator('#slice-list .slice-running').count(),0);
 assert((await page.locator('#slice-list .slice-current').innerText()).includes('Slice 25'));
 assert((await page.locator('#plan-chips').innerText()).includes('26/32 completed (reported)'));
 assert((await page.locator('button.plan-item[data-plan-id="ashoka-reported"]').innerText()).includes('implementing (reported) | idle'));
 assert((await page.locator('#architect-pulse-plan').innerText()).includes('implementing/idle (reported)'));
 await page.locator('#slice-status-filter').selectOption('open');assert.equal(await page.locator('#slice-list [data-slice-id]').count(),6);
 await page.locator('#slice-jump-current').click();assert.equal(await page.evaluate(()=>document.activeElement.dataset.sliceId),reported.current_slice_id);
 await page.screenshot({path:join(out,'ashoka-reported-progress.png'),fullPage:true});
 await assert.rejects(readFile(join(scope.dataDir,'plan_state.json')),{code:'ENOENT'});
 check('Ashoka reported progress','Real frozen 32-slice plan/log, compiled daemon, CLI and Chrome preserve 26 completed cards, current Slice25 and next gated candidate without importing, approving or claiming running/verified authority.');
 let sequence=0;
 const command=async(id,command)=>{const op=(await detail(id)).operational_state;return post(`/api/architect/v1/plans/${id}/lifecycle/commands`,{operation_id:`transition-${++sequence}`,expected_revision:op.revision,expected_definition_hash:op.definition_hash,command});};
 mcp=new Client({name:'plan-consumer-qualification',version:'1'});await mcp.connect(new StreamableHTTPClientTransport(new URL(base+'/mcp')));
 editor=new DaemonClient({host:'127.0.0.1',port,timeoutMs:30000});
 const plugin=createPluginGraphContext(PluginManifestSchema.parse({id:'qualification.plan',version:'1.0.0',displayName:'Plan fixture',engine:{dreamgraph:'>=13.4.0'},main:'./index.js',intent:'Read governed plan context',expectedEffects:['read_internal_graph'],capabilities:['resources:read']}),instance.uuid,new AbortController().signal);
 const semantic=projection=>({lifecycle:projection.lifecycle,revision:projection.revision,definition_hash:projection.definition_hash,current:projection.current_slice_ids,running:projection.running_slice_ids,next:projection.next_slice?.id??null,can_start:projection.next_slice?.can_start??null,last:projection.last_verified_slice_id,resume:projection.resume_action});
 const parsePlan=pack=>{assert.equal(pack.mandatory_satisfied,true,JSON.stringify(pack.state));return JSON.parse(pack.context_text.split('\n').find(line=>line.startsWith('{')&&JSON.parse(line).plan_projection&&JSON.parse(line).slice_id===undefined)).plan_projection;};
 async function compare(id,localSlice,stage){
  const plan=await detail(id),op=plan.operational_state,request={query:'Recover governed current slice, blockers and next eligible slice',plan_id:id,slice_id:localSlice,token_budget:10000,depth:0,max_records:12};
  const api=ContextPackSchema.parse(await post('/api/context/v1',request)),expected=semantic(parsePlan(api));
  assert.deepEqual(expected,{lifecycle:op.plan_lifecycle,revision:op.revision,definition_hash:op.definition_hash,current:op.current_slice_ids,running:op.running_slice_ids,next:op.next_slice?.id??null,can_start:op.next_eligibility?.can_start??null,last:op.last_completed_slice?.id??null,resume:op.resume_action});
  const reply=await mcp.callTool({name:'graph_rag_retrieve',arguments:request});assert(!reply.isError,JSON.stringify(reply));const tool=reply.structuredContent??JSON.parse(reply.content.find(item=>item.type==='text').text);assert.equal(tool.success,true);assert.deepEqual(semantic(parsePlan(ContextPackSchema.parse(tool.data))),expected);
  assert.deepEqual(semantic(parsePlan(await editor.getContextPack(request))),expected);assert.deepEqual(semantic(parsePlan(await plugin.retrieve(request))),expected);
  const cli=await execute(process.execPath,[resolve('dist/cli/dg.js'),'architect',instance.uuid,'plan','show',id,'--json','--master-dir',master],{cwd:directory,env,timeout:30000,maxBuffer:8*1024*1024,windowsHide:true});
  assert.deepEqual(JSON.parse(cli.stdout).plan.operational_state,op);
  const memory=op.task_memory_binding;assert.deepEqual({lifecycle:memory.plan_lifecycle,current:memory.current_slice_id,running:memory.active_slice_id,next:memory.next_slice_id,last:memory.last_completed_slice_id},{lifecycle:expected.lifecycle,current:op.current_slice_id,running:op.active_slice?.id??null,next:expected.next,last:expected.last});
  const exported=await get('/api/analytics/v1/snapshot');assert.equal(createHash('sha256').update(exported.payload_json).digest('hex'),exported.payload_sha256);const analytics=JSON.parse(exported.payload_json),row=analytics.entities.find(entity=>entity.identity.kind==='plan'&&entity.identity.id===id);assert.deepEqual(semantic(row.payload.plan_projection),expected);
  // Real new client sessions can publish authority-only receipts between reads. They cannot change graph/plan evidence.
  assert.equal(analytics.revision.graph_revision,api.revision.graph_revision);assert.equal(analytics.revision.domains.plans,api.revision.domains.plans);
  await page.evaluate(id=>loadPlan(id,null,{revealSelected:true}),id);await page.waitForFunction(({id,revision})=>activePlanId===id&&activePlanSnapshot?.operational_state?.revision===revision,{id,revision:op.revision});await showSlices();
  const chips=await page.locator('#plan-chips').innerText();assert(chips.includes('Lifecycle: '+expected.lifecycle),chips);
  const rail=await page.locator(`button.plan-item[data-plan-id="${id}"]`).innerText();assert(rail.includes(expected.lifecycle+' | idle'),rail);
  assert.equal(await page.locator('#architect-pulse-plan').innerText(),'Plan: '+id+' '+expected.lifecycle+'/idle');
  await page.evaluate(()=>renderArchitectPulse({plan:{id:'unrelated-session-plan',lifecycle:'draft',execution:'running'}}));
  assert.equal(await page.locator('#architect-pulse-plan').innerText(),'Plan: '+id+' '+expected.lifecycle+'/idle');
  if(stage==='verified')assert.equal(await page.locator('#slice-list [data-slice-id="done"]').evaluate(node=>node.classList.contains('slice-completed')),true);
  if(stage==='blocked')assert.equal(await page.locator('#slice-list [data-slice-id="blocked"]').evaluate(node=>node.classList.contains('slice-current')),true);
  if(stage==='blocked'){const selected=JSON.parse(api.context_text.split('\n').find(line=>line.startsWith('{')&&JSON.parse(line).slice_id==='blocked'));assert.deepEqual(selected.blockers,['required source unavailable']);assert.equal(expected.next,'independent');assert.equal(expected.can_start,true);}
  const before=await readFile(join(scope.dataDir,'plan_state.json'),'utf8');await editor.getContextPack(request);assert.equal(await readFile(join(scope.dataDir,'plan_state.json'),'utf8'),before);
  snapshots.push({project:id,stage,semantic:expected,context_revision:api.revision,analytics_revision:analytics.revision,context_receipt:api.receipt.id});check(`${id}:${stage}`,'API/MCP/real CLI/compiled editor client/plugin SDK validation/task memory/analytics and actual browser share committed lifecycle and slice state. Independent real client sessions may advance authority-only publication receipts.');
 }
 for(const id of names){
  const previewResponse=await get(`/api/architect/v1/plans/${id}/lifecycle/preview`),preview=previewResponse.preview;
  await post(`/api/architect/v1/plans/${id}/lifecycle/review`,{operation_id:'import-'+id,preview_hash:preview.preview_hash,review_id:'declared-disposable-review'});
  await compare(id,'done','draft');
  await command(id,{type:'review_plan',review_id:'design-'+id});await command(id,{type:'approve_scope',approval_id:'scope-'+id,owner:previewResponse.operator_id,scope:['done','blocked','dependent','independent'],parallel_limit:1});await command(id,{type:'start_slice',slice_id:'done'});
  const receipt=await command(id,{type:'record_implementation',slice_id:'done',receipt_ids:['source-fixture'],effect_obligation_ids:[],required_stages:[],evidence_ids:['disposable-source-witness']});assert(receipt.result.receipt,'Actual durable command receipt required');
  await compare(id,'done','implemented');await command(id,{type:'begin_verification',slice_id:'done'});
  const state=(await get(`/api/architect/v1/plans/${id}/lifecycle/preview`)).preview.state;
  await command(id,{type:'finish_verification',slice_id:'done',implementation_revision:state.slices.find(row=>row.id==='done').implementation_revision,acceptance_hash:state.definition.slices.find(row=>row.id==='done').acceptance_hash,passed:true,evidence_ids:['actual-disposable-consumer-check'],review_id:'fixture-acceptance',reason:'Declared physical fixture checkpoint; no paid agent qualification'});
  await compare(id,'independent','verified');await command(id,{type:'start_slice',slice_id:'blocked'});await command(id,{type:'block',slice_id:'blocked',reason:'required source unavailable'});await compare(id,'blocked','blocked');
  const consoleReply=await execute(process.execPath,[resolve('dist/cli/dg.js'),'architect',instance.uuid,'plan','show',id,'--section','summary','--master-dir',master],{cwd:directory,env,timeout:30000,windowsHide:true});assert.match(consoleReply.stdout,/Current:\s+.*Blocked work/);assert.match(consoleReply.stdout,/Running:\s+none/);assert.doesNotMatch(consoleReply.stdout,/Active:/);
  await page.screenshot({path:join(out,id+'-blocked.png'),fullPage:true});
 }
 const explorer=await get('/explorer/api/graph-snapshot');assert(explorer.scope.excluded_families.includes('plan'));assert(explorer.scope.excluded_families.includes('slice'));assert.equal(explorer.scope.canonical_entities,11);check('Explorer scope','Explorer honestly reports plan/slice as non-rendered families; the canonical context endpoint still provides them. No plan-node rendering claim.');
 assert.deepEqual(errors,[]);report.success=true;
}catch(error){report.success=false;report.failure=String(error?.stack??error);console.error(report.failure);process.exitCode=1;}
finally{editor?.dispose();await mcp?.close();await browser?.close();if(child&&child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGKILL');await exited;}await writeFile(join(out,'qualification.json'),JSON.stringify(report,null,2));await releaseGraphWriter();await rm(directory,{recursive:true,force:true});}
