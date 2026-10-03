/** Established-ledger browser admission under scheduler polling, using synthetic data only. */
import {expect,it,vi} from 'vitest';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {getDataDir,setDataDirOverride} from '../src/utils/paths.js';
import {releaseGraphWriter} from '../src/graph/writer-lease.js';
import {createSchedule,getSchedulerConfig,startScheduler,stopScheduler,updateSchedulerConfig} from '../src/cognitive/scheduler.js';
import {DaemonHttpAuthority} from '../src/server/http-authority.js';
import {commitGraphWrites,loadPublicationState} from '../src/graph/publication.js';

it('admits and reuses a browser session with 20,000 receipts and 39 inactive schedules while timer wake-ups continue',async()=>{
 const previous=getDataDir(),config=getSchedulerConfig(),directory=await mkdtemp(join(tmpdir(),'dg-scheduler-liveness-'));
 setDataDirOverride(directory);stopScheduler();updateSchedulerConfig({enabled:false});
 let authority:DaemonHttpAuthority|undefined;
 const server=createServer((req,res)=>{void(async()=>{const session=await authority!.authorize(req,res);if(session){res.writeHead(200,{'Content-Type':'text/plain'});res.end('ready');}})().catch(()=>{res.writeHead(500);res.end('failed');});});
 try{
  const seed=await createSchedule({name:'Paused legacy fixture',action:'graph_maintenance',trigger_type:'interval',interval_ms:60000});
  const schedules=JSON.parse(await readFile(join(directory,'schedules.json'),'utf8'));
  schedules.schedules=Array.from({length:39},(_,i)=>({...seed,id:`inactive-${i}`,enabled:false,status:i%2?'exhausted':'paused',created_at:'2026-01-01T00:00:00.000Z'}));
  await commitGraphWrites({actor:'fixture',writes:[{file:'schedules.json',content:JSON.stringify(schedules)}]});
  const publication=JSON.parse(await readFile(join(directory,'publication_state.json'),'utf8')),receipt=Object.values(publication.receipts)[0] as Record<string,unknown>;
  for(let i=Object.keys(publication.receipts).length;i<20000;i++)publication.receipts[createHash('sha256').update(`synthetic-history-${i}`).digest('hex')]={...receipt,operation_id:`synthetic-history-${i}`};
  await writeFile(join(directory,'publication_state.json'),JSON.stringify(publication,null,2));
  const before=await loadPublicationState();
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const port=(server.address() as {port:number}).port;
  authority=new DaemonHttpAuthority(port,{DREAMGRAPH_INSTANCE_UUID:'fixture'});
  vi.useFakeTimers({toFake:['setInterval','clearInterval']});
  startScheduler({enabled:true,tick_interval_ms:100});
  await vi.advanceTimersByTimeAsync(1000);
  const started=performance.now(),response=await fetch(`http://127.0.0.1:${port}/`,{headers:{accept:'text/html'},signal:AbortSignal.timeout(10000)});
  expect(response.status).toBe(200);expect(await response.text()).toBe('ready');const cookie=response.headers.get('set-cookie')!.split(';')[0];
  const reused=await fetch(`http://127.0.0.1:${port}/architect`,{headers:{cookie},signal:AbortSignal.timeout(10000)});
  expect(reused.status).toBe(200);expect(await reused.text()).toBe('ready');
  const after=await loadPublicationState();
  expect(Object.keys(after.receipts).length-Object.keys(before.receipts).length).toBeLessThanOrEqual(2); // One tick + one session; no polling storm.
  expect(Object.keys(JSON.parse(await readFile(join(directory,'session_authority.json'),'utf8')).sessions)).toHaveLength(1);
  console.info('Established-ledger browser admission',{receipts:20000,inactive_schedules:39,admit_and_reuse_ms:performance.now()-started,publications:after.revision.publication_sequence-before.revision.publication_sequence});
 }finally{
  stopScheduler();vi.useRealTimers();updateSchedulerConfig({...config,enabled:false});server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));
  await releaseGraphWriter(directory);setDataDirOverride(previous);await rm(directory,{recursive:true,force:true});
 }
},30000);
