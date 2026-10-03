/** Actual fresh daemon over a disposable saved instance; no installed daemon or model access. */
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {releaseGraphWriter} from '../../src/graph/writer-lease.js';
export async function inspectComputerRestart(input:{root:string;data:string;masterDir:string;instanceUuid:string;bearer:string;workerBearer:string;executionId:string;computerId:string}){
  await releaseGraphWriter(input.data);
  const reservation=createServer();await new Promise<void>(done=>reservation.listen(0,'127.0.0.1',done));
  const port=(reservation.address() as {port:number}).port;await new Promise<void>(done=>reservation.close(()=>done()));
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('DREAMGRAPH_')&&!key.startsWith('DG_')&&key!=='DATABASE_URL'&&!/API_KEY|ACCESS_TOKEN|BEARER|SECRET|CREDENTIAL/i.test(key)));
  Object.assign(env,{DREAMGRAPH_DATA_DIR:input.data,DREAMGRAPH_INSTANCE_UUID:input.instanceUuid,DREAMGRAPH_MASTER_DIR:input.masterDir,DREAMGRAPH_LLM_PROVIDER:'none',DG_SCHEDULER_ENABLED:'false',
    DREAMGRAPH_REPOS:JSON.stringify({fixture:input.root}),DREAMGRAPH_EVENTS:'{"max_auto_cycles_per_hour":0}',DREAMGRAPH_NARRATIVE:'{"auto_narrate":false}'});
  for(const role of ['INITIAL_SCAN','ENRICHMENT','DREAMER','NORMALIZER','ARCHITECT','COMPUTER_USE'])for(const suffix of ['RUN_BUDGET','DAY_BUDGET','MAX_CALLS'])env['DREAMGRAPH_LLM_'+role+'_'+suffix]='0';
  const daemon=spawn(process.execPath,[fileURLToPath(new URL('../../dist/index.js',import.meta.url)),'--transport','http','--port',String(port)],
    {cwd:input.root,env,stdio:['ignore','pipe','pipe'],windowsHide:true});
  // Diagnostic text is bounded and never contains a private bearer or literal input.
  let stderr='';daemon.stdout.on('data',()=>{});
  try{
    await new Promise<void>((done,reject)=>{
      let settled=false;const finish=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):done();};
      const timer=setTimeout(()=>finish(new Error('Disposable restart did not become ready: '+stderr)),30000);
      daemon.stderr.on('data',chunk=>{stderr=(stderr+String(chunk)).slice(-8000);if(String(chunk).includes('Server running on'))finish();});
      daemon.once('error',error=>finish(error));daemon.once('exit',code=>finish(new Error('Disposable restart exited '+code+': '+stderr)));
    });
    const base='http://127.0.0.1:'+port,query=new URLSearchParams({execution_id:input.executionId,id:input.computerId});
    const get=async(path:string,bearer=input.bearer)=>{const reply=await fetch(base+path,{headers:{'X-DreamGraph-Session':bearer},signal:AbortSignal.timeout(10000)});
      return {status:reply.status,value:await reply.json()};};
    const status=await get('/api/executions/v1/computer/status?'+query);
    assert.equal(status.status,200);assert.equal(status.value.worker_available,false);assert.equal(status.value.session.state,'recovery_required');
    assert.equal(status.value.last_receipt.state,'unknown');assert.equal(status.value.usage.actions,1);
    const page=await get('/api/executions/v1/computer/sessions');assert.equal(page.status,200);assert.equal(page.value.sessions.length,1);
    assert.equal(page.value.sessions[0].session.execution_id,input.executionId);assert.equal(page.value.sessions[0].worker_available,false);
    const before=JSON.parse(await readFile(join(input.data,'session_authority.json'),'utf8'));
    for(const action of ['pause','resume','stop','recover-stop']){
      const reply=await fetch(base+'/api/executions/v1/computer/'+action,{method:'POST',headers:{'X-DreamGraph-Session':input.bearer,'Content-Type':'application/json'},
        body:JSON.stringify({execution_id:input.executionId,id:input.computerId,...(['pause','resume'].includes(action)?{fence:1}:{})}),signal:AbortSignal.timeout(10000)});
      assert.equal(reply.status,400);assert.equal((await reply.json()).error,'COMPUTER_ORIGINAL_WORKER_UNAVAILABLE');
    }
    const worker=await get('/api/executions/v1/computer/sessions',input.workerBearer);assert.equal(worker.status,403);
    const unbound=await fetch(base+'/api/executions/v1/computer/sessions',{signal:AbortSignal.timeout(10000)});
    assert.equal(unbound.status,403);
    const foreign=await fetch(base+'/architect',{headers:{Accept:'text/html'},signal:AbortSignal.timeout(10000)});
    const foreignBearer=foreign.headers.get('X-DreamGraph-Session');assert(foreignBearer);
    const foreignPage=await get('/api/executions/v1/computer/sessions',foreignBearer);
    assert.equal(foreignPage.status,200);assert.deepEqual(foreignPage.value.sessions,[]);
    const after=JSON.parse(await readFile(join(input.data,'session_authority.json'),'utf8'));
    assert.deepEqual(after.grants,before.grants);assert.deepEqual(after.challenges,before.challenges);
    const contexts=JSON.parse(await readFile(join(input.data,'execution_contexts.json'),'utf8'));
    const saved=contexts.entries.find((entry:{id:string})=>entry.id===input.executionId);assert.equal(saved.status,'recovery_required');
    assert.equal(saved.computer_sessions[0].actions[0].receipt.state,'unknown');assert.equal(saved.computer_sessions[0].stop_state,'unknown');
    return {original_owner_readback:true,worker_replacement_refused:true,new_grants:0,action_state:'unknown',stop_state:'unknown'};
  }finally{
    if(daemon.exitCode===null&&daemon.signalCode===null){
      const exited=once(daemon,'exit');daemon.kill('SIGTERM');let timer:NodeJS.Timeout|undefined;
      try{await Promise.race([exited,new Promise<never>((_,reject)=>{timer=setTimeout(()=>{daemon.kill('SIGKILL');reject(new Error('Disposable daemon termination unconfirmed'));},10000);})]);}
      finally{clearTimeout(timer);}
    }
  }
}
