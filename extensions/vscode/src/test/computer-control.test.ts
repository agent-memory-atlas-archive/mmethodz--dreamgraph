/** Declared operator ports and compiled DOM; physical/API browser bounds are qualified by root integration separately. */
import test from 'node:test';import assert from 'node:assert/strict';
const {JSDOM}=require('jsdom');
import {ComputerControlController,type ComputerControlView} from '../computer-control.js';
import {computerControlMarkup,installComputerControl} from '../webview/computer-control.js';
import type {ComputerOperatorPort,ComputerOperatorSnapshot,ComputerEvidence} from '@dreamgraph/sdk/seams/computer-control' with {"resolution-mode":"import"};
const snapshot=(id='one',state='ready')=>({session:{id,execution_id:'execution:'+id,instance_id:'instance',state,fence:1,host_id:'declared-host'},targets:[{id:'target:'+id,generation:1,origin:'https://fixture.example'}],
 capability:{route:'dreamgraph_harness',backend_version:'declared-fixture'},worker_available:true,pause_supported:true,usage:{actions:0,images:0,image_bytes:0,observation_bytes:0},
 limits:{max_actions:2,max_images:0,max_image_bytes:0,observation_bytes:1000,expires_at:'2026-10-02T23:00:00Z'},last_receipt:null}) as unknown as ComputerOperatorSnapshot;
const harness=()=>{let latest:ComputerControlView={status:'idle',sessions:[]},calls:string[]=[];const port:ComputerOperatorPort={baseUrl:'http://fixture:1',
 async listComputerSessions(){calls.push('list');return {ok:true,sessions:[snapshot(),snapshot('two')],total:2,next_cursor:null,snapshot_hash:'sha256:'+'a'.repeat(64),history_scope:'active_execution_store'};},
 async readComputerStatus(execution,id){calls.push('read:'+id);return snapshot(id);},async controlComputer(execution,id,action){calls.push(action+':'+id);return snapshot(id,action==='stop'?'stopped':action==='pause'?'paused':'ready');}};
 const controller=new ComputerControlController(view=>latest=view);return {controller,port,calls,get latest(){return latest;}};};
test('on-demand discovery and selection issue no grant, input, model call or control',async()=>{const h=harness();assert.deepEqual(h.calls,[]);await h.controller.refresh(h.port,'instance');await h.controller.select(h.port,'instance','one');
 assert.deepEqual(h.calls,['list','read:one']);assert.equal(h.latest.selected?.session.id,'one');await assert.rejects(h.controller.select(h.port,'instance','unlisted'),/UNLISTED/);h.controller.dispose();});
test('another instance or endpoint cannot receive a captured original control',async()=>{const h=harness();await h.controller.refresh(h.port,'instance');await h.controller.select(h.port,'instance','one');
 await assert.rejects(h.controller.act(h.port,'other','one','stop'),/OWNER_CHANGED/);const changed={...h.port,baseUrl:'http://fixture:2'};await assert.rejects(h.controller.act(changed,'instance','one','stop'),/OWNER_CHANGED/);
 assert.equal(h.calls.some(call=>call.startsWith('stop')),false);h.controller.dispose();});
test('late selection cannot attach previous target state or controls',async()=>{const h=harness(),pending=new Map<string,(value:ComputerOperatorSnapshot)=>void>();await h.controller.refresh(h.port,'instance');
 h.port.readComputerStatus=async(_,id)=>new Promise(done=>pending.set(id,done));const one=h.controller.select(h.port,'instance','one'),two=h.controller.select(h.port,'instance','two');
 pending.get('two')!(snapshot('two'));await two;pending.get('one')!(snapshot('one'));await one;assert.equal(h.latest.selected?.session.id,'two');h.controller.dispose();});
test('Stop bypasses a pending pause wait and retains the original execution/target',async()=>{const h=harness();await h.controller.refresh(h.port,'instance');await h.controller.select(h.port,'instance','one');let release!:(value:ComputerOperatorSnapshot)=>void;
 h.port.controlComputer=async(execution,id,action)=>{h.calls.push(action+':'+execution+':'+id);if(action==='pause')return new Promise(done=>release=done);return snapshot(id,'stopped');};
 const pause=h.controller.act(h.port,'instance','one','pause');await h.controller.act(h.port,'instance','one','stop');assert.equal(h.latest.selected?.session.state,'stopped');
 release(snapshot('one','paused'));await pause;assert.equal(h.latest.selected?.session.state,'stopped');assert(h.calls.includes('stop:execution:one:one'));h.controller.dispose();});
test('unconfirmed reply preserves the original session for inspection without a fresh pass',async()=>{const h=harness();await h.controller.refresh(h.port,'instance');await h.controller.select(h.port,'instance','one');
 h.port.controlComputer=async()=>{throw new Error('declared lost reply');};await assert.rejects(h.controller.act(h.port,'instance','one','pause'),/lost reply/);assert.equal(h.latest.status,'unconfirmed');
 assert.equal(h.latest.selected?.session.id,'one');await h.controller.select(h.port,'instance','one');assert.equal(h.latest.status,'ready');h.controller.dispose();});
test('pages carry their exact captured snapshot and changed/foreign rows are refused',async()=>{const h=harness();h.port.listComputerSessions=async page=>{if(page){assert.equal(page.snapshot_hash,'sha256:'+'b'.repeat(64));throw new Error('COMPUTER_SESSION_PAGE_CHANGED');}
 return {ok:true,sessions:[snapshot()],total:2,next_cursor:'sha256:'+'c'.repeat(64),snapshot_hash:'sha256:'+'b'.repeat(64),history_scope:'active_execution_store'};};
 await h.controller.refresh(h.port,'instance');await assert.rejects(h.controller.refresh(h.port,'instance',true),/PAGE_CHANGED/);assert.equal(h.latest.status,'error');h.controller.dispose();});
test('compiled drawer is quiet until opened, renders literal evidence and keeps Stop available during pause',()=>{const dom=new JSDOM(computerControlMarkup),sent:unknown[]=[];
 installComputerControl(dom.window.document,dom.window as unknown as Window,value=>sent.push(value));assert.deepEqual(sent,[]);const panel=dom.window.document.getElementById('computer-control') as HTMLDetailsElement;
 panel.open=true;panel.dispatchEvent(new dom.window.Event('toggle'));assert.deepEqual(sent,[{type:'computerRefresh'}]);const row=snapshot();row.session.host_id='<img src=x onerror=alert(1)>';
 dom.window.dispatchEvent(new dom.window.MessageEvent('message',{data:{type:'computerView',view:{status:'controlling',sessions:[row],selected:row,endpoint:'http://fixture:1'}}}));
 const stop=dom.window.document.getElementById('computer-control-stop') as HTMLButtonElement;assert.equal(stop.disabled,false);assert.equal(stop.hidden,false);stop.click();
 assert.deepEqual(sent.at(-1),{type:'computerControl',id:'one',action:'stop'});assert.equal(dom.window.document.querySelector('img'),null);assert.match(dom.window.document.getElementById('computer-control-detail')!.textContent!,/<img/);dom.window.close();});
const evidence=(id='one')=>({schema:'dreamgraph.computer_evidence.v1',instance_id:'instance',execution_id:'execution:'+id,computer_session_id:id,fence:1,worker_available:true,
 observation:{observation:{id:'observation:'+id,target_id:'target:'+id,target_generation:1,execution_id:'execution:'+id,observed_at:new Date().toISOString(),expires_at:new Date(Date.now()+20000).toISOString(),content_hash:'declared'},
  summary:'<img src=x onerror=alert(1)> literal evidence',expired:false,image:{mime_type:'image/png',content_hash:'declared',data_base64:'aGVsbG8='}}}) as unknown as ComputerEvidence;
test('evidence remains on demand, scoped to the original selection and cleared before another selection',async()=>{
 const h=harness();h.port.readComputerEvidence=async(_,id)=>{h.calls.push('evidence:'+id);return evidence(id);};await h.controller.refresh(h.port,'instance');await h.controller.select(h.port,'instance','one');
 assert.equal(h.calls.some(call=>call.startsWith('evidence')),false);await h.controller.inspectEvidence(h.port,'instance','one');assert.equal(h.latest.evidence?.computer_session_id,'one');
 await h.controller.select(h.port,'instance','two');assert.equal(h.latest.evidence,undefined);assert.deepEqual(h.calls,['list','read:one','evidence:one','read:two']);h.controller.dispose();
});
test('late evidence cannot attach to a new selection or block priority Stop',async()=>{
 const h=harness();let release!:(value:ComputerEvidence)=>void;h.port.readComputerEvidence=async()=>new Promise(done=>release=done);await h.controller.refresh(h.port,'instance');await h.controller.select(h.port,'instance','one');
 const read=h.controller.inspectEvidence(h.port,'instance','one');await h.controller.act(h.port,'instance','one','stop');release(evidence());await read;
 assert.equal(h.latest.selected?.session.state,'stopped');assert.equal(h.latest.evidence,undefined);assert.equal(h.latest.evidenceLoading,false);h.controller.dispose();
});
test('foreign observation/fence cannot become selected evidence',async()=>{
 const h=harness();await h.controller.refresh(h.port,'instance');await h.controller.select(h.port,'instance','one');h.port.readComputerEvidence=async()=>evidence('two');
 await assert.rejects(h.controller.inspectEvidence(h.port,'instance','one'),/OWNER_MISMATCH/);assert.equal(h.latest.evidence,undefined);h.port.readComputerEvidence=async()=>({...evidence(),fence:2});
 await assert.rejects(h.controller.inspectEvidence(h.port,'instance','one'),/OWNER_MISMATCH/);h.controller.dispose();
});
test('compiled drawer renders scoped pixels and literal summaries only when open, clearing them on close',async()=>{
 const dom=new JSDOM(computerControlMarkup),sent:unknown[]=[];installComputerControl(dom.window.document,dom.window as unknown as Window,value=>sent.push(value));
 const panel=dom.window.document.getElementById('computer-control') as HTMLDetailsElement;panel.open=true;panel.dispatchEvent(new dom.window.Event('toggle'));
 const view={status:'ready',sessions:[snapshot()],selected:snapshot(),evidence:evidence()};dom.window.dispatchEvent(new dom.window.MessageEvent('message',{data:{type:'computerView',view}}));
 assert.equal(dom.window.document.querySelector('img')?.getAttribute('src'),'data:image/png;base64,aGVsbG8=');assert.match(dom.window.document.getElementById('computer-control-evidence-detail')!.textContent!,/<img/);
 const show=dom.window.document.getElementById('computer-control-evidence') as HTMLButtonElement;show.click();assert.deepEqual(sent.at(-1),{type:'computerEvidence',id:'one'});
 panel.open=false;panel.dispatchEvent(new dom.window.Event('toggle'));assert.equal(dom.window.document.querySelector('img'),null);assert.deepEqual(sent.at(-1),{type:'computerEvidenceClear'});
 // Changing open also queues a native toggle; let it finish with its DOM intact.
 await new Promise<void>(resolve=>panel.addEventListener('toggle',()=>resolve(),{once:true}));dom.window.close();
});
