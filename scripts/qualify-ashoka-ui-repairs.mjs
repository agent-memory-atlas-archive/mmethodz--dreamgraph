/** Disposable compiled daemon + actual Chromium. No installed instance or model calls. */
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {createInstance} from '../dist/instance/lifecycle.js';
import {setDataDirOverride} from '../dist/utils/paths.js';
import {commitGraphWrites} from '../dist/graph/publication.js';
import {releaseGraphWriter} from '../dist/graph/writer-lease.js';
const executablePath=process.env.ASHOKA_BROWSER_EXECUTABLE;
if(!executablePath)throw new Error('Supply existing ASHOKA_BROWSER_EXECUTABLE; no installation.');
const {chromium}=await import('playwright-core');
const directory=await mkdtemp(join(tmpdir(),'dg-ui-repairs-')),out=resolve(process.env.ASHOKA_UI_REPAIR_DIR||'docs/ashoka/ui-repairs-first');
await mkdir(out);let child,browser;
const report={scope:'Compiled local daemon and actual Windows Chromium on disposable 1201-node graph and frozen Ashoka plan. Harness IPC writes/publishes through real graph services; dream completion event is injected, not a paid dream cycle. No installed daemon changes.',model_requests:0,checks:[],errors:[]};
const check=(name,detail)=>{report.checks.push({name,detail});console.log(name);};
try{
 await mkdir(join(directory,'plans'));
 await writeFile(join(directory,'plans','ashoka.md'),await readFile('tests/fixtures/ashoka/legacy-progress-plan.md'));
 await writeFile(join(directory,'plans','ashoka.implementation-log.md'),await readFile('tests/fixtures/ashoka/legacy-progress-log.md'));
 const master=join(directory,'master'),{instance,scope}=await createInstance({name:'ui-repairs',projectRoot:directory,masterDir:master,repos:{fixture:directory}});
 setDataDirOverride(scope.dataDir);
 const rows=Array.from({length:1200},(_,i)=>({id:`node-${i}`,name:`Feature ${i}`,source_kind:'manual'}));
 const features={features:[{id:'public',name:'Public',source_kind:'manual',description:'Inspector stays visible through refresh.',links:rows.slice(0,800).map(row=>({target:row.id,type:'feature',relationship:'contains'}))},...rows]};
 await commitGraphWrites({actor:'disposable-ui-fixture',scope:['features.json'],writes:[{file:'features.json',content:JSON.stringify(features)}]});await releaseGraphWriter(scope.dataDir);
 // A test-only IPC producer exercises real publication and SSE without adding a product endpoint.
 const hook=join(directory,'hook.mjs');await writeFile(hook,`
 import {graphEventBus} from ${JSON.stringify(pathToFileURL(resolve('dist/graph/events.js')).href)};
 import {commitGraphWrites} from ${JSON.stringify(pathToFileURL(resolve('dist/graph/publication.js')).href)};
 import {getGraphSnapshot} from ${JSON.stringify(pathToFileURL(resolve('dist/graph/snapshot.js')).href)};
 process.on('message',async message=>{try{
  if(message.action==='update')await commitGraphWrites({actor:'disposable-ui-fixture',scope:['capabilities.json'],writes:[{file:'capabilities.json',content:JSON.stringify({capabilities:[{id:'added',name:'Added after manual refresh '+message.id,source_kind:'manual'}]})}]});
  else if(message.action==='snapshot')await getGraphSnapshot();
  else if(message.action==='cache')graphEventBus.emit('cache.invalidated',{payload:{files:['session_authority.json']}});
  else if(message.action==='dream')graphEventBus.emit('dream.cycle.completed',{payload:{fixture:true}});
  else throw new Error('Unknown fixture command');
  process.send({id:message.id,ok:true});
 }catch(error){process.send({id:message.id,error:String(error)});}});
 `);
 const reservation=createServer();await new Promise(done=>reservation.listen(0,'127.0.0.1',done));const port=reservation.address().port;await new Promise(done=>reservation.close(done));const base=`http://127.0.0.1:${port}`;
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('DREAMGRAPH_')&&!key.startsWith('DG_')&&!/API_?KEY|ACCESS_TOKEN|AUTH_TOKEN|SECRET|DATABASE_URL/i.test(key)));
 Object.assign(env,{DREAMGRAPH_INSTANCE_UUID:instance.uuid,DREAMGRAPH_MASTER_DIR:master,DREAMGRAPH_DATA_DIR:scope.dataDir,DREAMGRAPH_LLM_PROVIDER:'none',DREAMGRAPH_SCHEDULER:'{"enabled":false}',DREAMGRAPH_REPOS:JSON.stringify({fixture:directory})});
 child=spawn(process.execPath,['--import',pathToFileURL(hook).href,resolve('dist/index.js'),'--transport','http','--port',String(port)],{cwd:directory,env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
 let stderr='';child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-24000);});
 await new Promise((done,reject)=>{const timer=setTimeout(()=>reject(new Error('Startup: '+stderr)),30000);child.stderr.on('data',chunk=>{if(String(chunk).includes('Server running on')){clearTimeout(timer);done();}});child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Daemon exit ${code}: ${stderr}`));});});
 let sequence=0;const command=action=>new Promise((done,reject)=>{const id=++sequence,timer=setTimeout(()=>{child.off('message',receive);reject(new Error('Fixture timeout: '+action));},30000);function receive(message){if(message.id!==id)return;clearTimeout(timer);child.off('message',receive);message.ok?done():reject(new Error(message.error));}child.on('message',receive);child.send({id,action});});
 browser=await chromium.launch({executablePath,headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});report.browser=browser.version();
 const page=await browser.newPage({viewport:{width:1600,height:1000}});page.on('pageerror',error=>report.errors.push(String(error)));
 await page.goto(base+'/architect?plan=ashoka');await page.locator('#slice-list [data-slice-id]').first().waitFor({state:'attached'});
 const disclosure=page.locator('.architect-right-accordion').filter({has:page.locator('#slice-list')});if(await disclosure.getAttribute('open')===null)await disclosure.locator('summary').first().click();
 // Titles are real API data; locate the exact rendered card, not a matching earlier paragraph.
 const plan=await (await page.request.get(base+'/api/architect/v1/plans/ashoka')).json();const target=plan.plan.registry.slices.find(s=>/^Slice 5\b/.test(s.title));assert(target);
 const card=page.locator('#slice-list [data-slice-id]').filter({hasText:target.title}).first();await card.click();
 await page.waitForTimeout(300);
 report.anchor_debug=await page.locator('#center-plan-body').evaluate((body,offset)=>{const range=document.createRange();range.setStart(body.firstChild,offset);range.setEnd(body.firstChild,offset+1);return {text:body.textContent.slice(offset,offset+100),offset,target:range.getBoundingClientRect().toJSON(),body:body.getBoundingClientRect().toJSON(),scroll:body.scrollTop,scrollHeight:body.scrollHeight,details:body.parentElement.getBoundingClientRect().toJSON(),panel:body.parentElement.parentElement.getBoundingClientRect().toJSON(),padding:getComputedStyle(body).paddingTop};},target.source_offset);
 await page.screenshot({path:join(out,'architect-anchor-debug.png')});console.log(JSON.stringify(report.anchor_debug));
 await page.waitForFunction(offset=>{const body=document.getElementById('center-plan-body'),range=document.createRange();range.setStart(body.firstChild,offset);range.setEnd(body.firstChild,offset+1);return Math.abs(range.getBoundingClientRect().top-body.getBoundingClientRect().top-parseFloat(getComputedStyle(body).paddingTop)-body.clientTop)<3;},target.source_offset);
 const geometry=await page.locator('#center-plan-body').evaluate(body=>({height:body.clientHeight,bottom:body.getBoundingClientRect().bottom,viewport:innerHeight,scroll:body.scrollTop,available:innerHeight-body.getBoundingClientRect().top}));
 assert(geometry.height>500,JSON.stringify(geometry));assert(geometry.available-geometry.height<50,JSON.stringify(geometry));check('Architect exact slice + full-height review',geometry);
 const scroll=page.locator('.architect-context-scroll');await scroll.evaluate(node=>node.scrollTop=node.scrollHeight);
 const rail=page.locator('[data-architect-sidebar="right"]'),handle=rail.locator('.architect-sidebar-handle'),before=await rail.boundingBox(),bar=await handle.boundingBox();
 const x=bar.x+bar.width/2,y=bar.y+bar.height-40;
 assert(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.classList.contains('architect-sidebar-handle'),{x,y}));
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x-85,y,{steps:8});await page.mouse.up();const after=await rail.boundingBox();assert(after.width-before.width>65,JSON.stringify({before,after}));check('Architect resize after full rail scroll',{before:before.width,after:after.width});
 await card.click();await page.waitForTimeout(100);await page.screenshot({path:join(out,'architect-slice5-resize.png')});
 let snapshots=0,nodes=0;const failures=[];page.on('request',request=>{if(new URL(request.url()).pathname==='/explorer/api/graph-snapshot')snapshots++;if(request.url().includes('/explorer/api/node/'))nodes++;});page.on('response',response=>{if(response.url().includes('/explorer/api/')&&response.status()>=400)failures.push({url:response.url(),status:response.status()});});
 await page.goto(base+'/explorer/');await page.locator('.canvas-wrap canvas').first().waitFor();await page.locator('.searchbar-input').fill('Public');await page.locator('.searchbar-hit').first().click();
 const started=performance.now();await page.locator('.entity-fields').filter({hasText:'Inspector stays visible'}).waitFor();report.initial_detail_ms=performance.now()-started;
 await page.waitForTimeout(1200);const settled={snapshots,nodes};
 for(let i=0;i<3;i++)await command('cache');await command('update');await page.waitForTimeout(16500);
 assert.deepEqual({snapshots,nodes},settled);assert(await page.locator('.entity-fields').isVisible());check('Cache events and ordinary writes never refresh; no 15-second poll',{snapshots,nodes,wait_ms:16500});
 let release;const held=new Promise(done=>release=done);let intercepted=false;
 await page.route('**/explorer/api/node/**',async route=>{intercepted=true;await held;await route.continue();});
 await page.getByRole('button',{name:'Refresh snapshot',exact:true}).click();
 await page.locator('.inspector-empty').filter({hasText:'Updating details'}).waitFor();assert(intercepted);assert(await page.locator('.entity-fields').isVisible());
 release();await page.locator('.inspector-empty').filter({hasText:'Updating details'}).waitFor({state:'hidden'});await page.unroute('**/explorer/api/node/**');
 assert(await page.locator('.entity-fields').isVisible());check('Manual refresh retains inspector during deliberately delayed detail response',{snapshots,nodes});
 const beforeDream=snapshots;await command('dream');await page.waitForFunction(()=>!document.querySelector('.inspector-empty')?.textContent.includes('Updating details'));await page.waitForTimeout(1500);assert(snapshots>beforeDream);check('Dream completion still requests a live snapshot',{before:beforeDream,after:snapshots});
 const beforeExternal=snapshots;await command('update');await command('snapshot');await page.waitForTimeout(1500);assert.equal(snapshots,beforeExternal+1);await page.getByRole('button',{name:'View agent context',exact:true}).waitFor();check('External snapshot replaces the view once, without a feedback loop',{before:beforeExternal,after:snapshots});
 // Same render key must preserve the WebGL scene and loaded inspector on refresh.
 await page.getByRole('button',{name:'3D',exact:false}).click();await page.locator('.graph3d-label').first().waitFor({timeout:30000});
 const canvas=await page.locator('.canvas-wrap canvas').first().elementHandle(),beforeManual=snapshots;await page.getByRole('button',{name:'Refresh snapshot',exact:true}).click();await page.waitForTimeout(1400);assert(snapshots>beforeManual);assert(await canvas.evaluate(node=>node.isConnected));assert(await page.locator('.entity-fields').isVisible());
 await page.screenshot({path:join(out,'explorer-stable-inspector.png')});check('3D scene and inspector survive unchanged refresh',{snapshots,nodes});
 assert.deepEqual(failures,[]);assert.deepEqual(report.errors,[]);report.success=true;
}catch(error){report.success=false;report.failure=String(error?.stack??error);console.error(report.failure);process.exitCode=1;}
finally{await browser?.close();if(child&&child.exitCode===null&&child.signalCode===null){const closed=once(child,'exit');child.kill('SIGKILL');await closed;}await writeFile(join(out,'qualification.json'),JSON.stringify(report,null,2)+'\n');await rm(directory,{recursive:true,force:true});}
