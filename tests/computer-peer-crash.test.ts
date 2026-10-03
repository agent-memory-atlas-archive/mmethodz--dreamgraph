/** Real disposable browser/source write and forced peer death; no paid provider or native desktop claim. */
import {it,expect,vi} from 'vitest';
import {createServer,type Server} from 'node:http';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import type {ChildProcess} from 'node:child_process';
import {installOfflineAdmissionFixtures} from './helpers/offline-admission.js';
import {observeBrowserProcessTree,observedBrowserProcessesEnded} from './helpers/browser-process-tree.js';
import {inspectComputerRestart} from './helpers/computer-restart.js';
import {createInstance} from '../src/instance/lifecycle.js';
import {BrowserHarnessWorker,browserWorkerSourceHash} from '../src/computer/browser-harness.js';
import {BrowserWorkerProfileSchema} from '../src/computer/browser-profile.js';
import type {ComputerQualification} from '../src/computer/capabilities.js';
import {withComputerSession,activeComputerBroker,type ComputerExecutionBroker} from '../src/computer/broker.js';
import {computerDigest,readComputerJournal} from '../src/computer/journal.js';
import type {ComputerAction,ComputerTarget} from '../src/computer/worker-port.js';
import {SessionAuthority} from '../src/server/session-authority.js';
import {withSessionContext} from '../src/server/session-context.js';
import {beginHostExecution,approveHostExecution,endHostExecution,withHostExecution} from '../src/server/managed-execution.js';
import {deliverManagedContext,readManagedContext} from '../src/graph/execution-context.js';
import {readChangeObligations} from '../src/graph/change-obligations.js';
import {commitGraphWrites} from '../src/graph/publication.js';
import {releaseGraphWriter} from '../src/graph/writer-lease.js';
import {getDataDir,setDataDirOverride} from '../src/utils/paths.js';
import {EngineJobs} from '../src/cognitive/jobs.js';
import {config} from '../src/config/config.js';
installOfflineAdmissionFixtures({directory:false});

it('a real source write followed by peer death retains unknown intent, source debt and original recovery without redispatch',async()=>{
  const root=await mkdtemp(join(tmpdir(),'dg-computer-peer-crash-')),source=join(root,'source.ts');
  let data=join(root,'data');
  const previous=getDataDir(),repos={...config.repos},instanceConfig={...config.instance},controller=new AbortController();
  let server:Server|undefined,worker:BrowserHarnessWorker|undefined,original:ComputerExecutionBroker|undefined;
  let transfers=0,retry:ComputerAction|undefined,physicalWrite!:()=>void;
  const wrote=new Promise<void>(done=>physicalWrite=done),executionId='peer-crash-execution';
  try{
    const masterDir=join(root,'master'),created=await createInstance({name:'peer-crash-fixture',masterDir,projectRoot:root,repos:{fixture:root}});
    data=created.scope.dataDir;config.instance={uuid:created.instance.uuid,masterDir};setDataDirOverride(data);config.repos={fixture:root};
    await writeFile(source,'export const crashFixture = false;\n');
    await commitGraphWrites({actor:'peer-crash-fixture',scope:['features.json'],writes:[{file:'features.json',content:JSON.stringify({features:[{id:'peer-crash',name:'Peer crash fixture',source_repo:'fixture',source_files:['source.ts']}]})}]});
    server=createServer((req,res)=>{void(async()=>{
      if(req.url==='/fixture/apply'&&req.method==='POST'){
        transfers++;await writeFile(source,'export const crashFixture = true;\n');physicalWrite();
        // Hold the navigation response: the action cannot acknowledge before the peer is killed.
        return;
      }
      res.setHeader('Content-Type','text/html');res.end('<!doctype html><main id="app"><form method="post" action="/fixture/apply"><button type="submit">Apply</button></form><output id="status">Ready</output></main>');
    })().catch(error=>{res.statusCode=500;res.end('Fixture failed');controller.abort(error);});});
    await new Promise<void>(done=>server!.listen(0,'127.0.0.1',done));const origin='http://127.0.0.1:'+(server.address() as {port:number}).port;
    const profile=BrowserWorkerProfileSchema.parse({schema:'dreamgraph.browser_worker_profile.v1',id:'peer-crash-fixture',
      browser_executable:process.env.ASHOKA_BROWSER_EXECUTABLE||'C:/Program Files/Google/Chrome/Application/chrome.exe',
      browser_version:process.env.ASHOKA_BROWSER_VERSION||'153.0.8010.50',runtime_version:'1.62.1',initial_url:origin+'/fixture',main_origin:origin,main_path_prefix:'/fixture',
      network:[{origin,path_prefix:'/fixture',methods:['GET','POST'],allow_query:false}],blocked_origins:[],
      elements:[{id:'apply',selector:'button',read_text:true,read_value:false,operations:['click']},{id:'status',selector:'#status',read_text:true,read_value:false,operations:[]}],
      postconditions:[{id:'saved',selector:'#status',kind:'text_equals',expected:'Saved'}],navigation:false,max_actions:2,observation_bytes:8192,action_timeout_ms:5000,
      expires_at:new Date(Date.now()+60000).toISOString(),images:{enabled:false,region:null,mask_selectors:[],max_bytes:0,max_count:0,total_bytes:0},redactions:[]});
    const authority=new SessionAuthority(created.instance.uuid,data),identity=await authority.create('local-machine'),owner=identity.context;
    let workerBearer='';
    const within=<T>(work:()=>T)=>withSessionContext(owner,work);
    await within(async()=>{const host=await beginHostExecution({id:executionId,adapter:'native_api',query:'Peer crash fixture',autonomy:'supervised',timeout_ms:60000});workerBearer=host.worker_bearer;await deliverManagedContext(executionId,host.execution.block);});
    const entry=await within(()=>readManagedContext(executionId));
    const target:ComputerTarget={schema:'dreamgraph.computer_target.v1',id:'peer-crash-target',instance_id:entry.instance_id,session_id:owner.session_id,host_id:'peer-crash-local-host',surface:'browser',generation:1,origin,application:null};
    const sourceHash=await browserWorkerSourceHash();
    const qualification:ComputerQualification={schema:'dreamgraph.computer_qualification.v1',backend:'isolated_playwright',backend_version:`playwright-core@1.62.1/chromium@${profile.browser_version}/node@${process.versions.node}`,
      platform:process.platform as 'win32',architecture:process.arch,source_hash:sourceHash,protocol_hash:computerDigest('dreamgraph.computer_worker.v1'),qualified_at:new Date().toISOString(),evidence_scope:'declared_fixture',
      scope_negative_passed:true,privacy_passed:true,bounded_actions_passed:true,stop_release_ms:1,control_loss_stop_ms:1,cases:['CU04','CU05','CU10','CU11','CU20','CU22','CU24'],artifact_hash:computerDigest('Mechanical admission fixture only; the physical browser and process death are real.')};
    worker=await BrowserHarnessWorker.create(profile,{adapter:'native_api',adapter_version:'1',host_id:target.host_id},qualification);
    const grant=await authority.grantScopedComputer(owner,{operation_id:'peer-crash-grant',execution_id:executionId,target_id:target.id,profile_hash:computerDigest(profile),backend_source_hash:sourceHash,interact:true,duration_ms:60000,human_confirmed:true});
    const budget={requests:0,input_tokens:0,output_tokens:0,reasoning_tokens:0,retries:0,elapsed_ms:60000,concurrency:1,max_hops:0,max_neighbors:0,run_amount:0,day_amount:0,currency:'USD',pricing_version:null,billing_principal:'offline:peer-crash-fixture'};
    const run=within(()=>withHostExecution(executionId,()=>withComputerSession({id:'peer-crash-computer',execution_id:executionId,grant_id:grant.id,target,
      settings:{enabled:true,route:'auto'},adapter_kind:'native_api',adapter:'native_api',adapter_version:'1',requested:['observe','click'],
      limits:{max_actions:2,max_images:0,max_image_bytes:0,observation_bytes:8192,expires_at:profile.expires_at},
      profile:{hash:computerDigest(profile),postconditions:['saved'],project_workspace:root},budget},worker!,authority,async broker=>{
        original=broker;const seen=await broker.observe(),element=JSON.parse(seen.summary).elements.find((value:{text:string})=>value.text==='Apply');expect(element).toBeDefined();
        retry={schema:'dreamgraph.computer_action.v1',id:'peer-crash-action',execution_id:executionId,target_id:target.id,target_generation:seen.observation.target_generation,
          observation_id:seen.observation.id,grant_id:grant.id,operation:'click',parameters:{locator:element.ref},postcondition:'saved',fence:1};
        await within(async()=>{const current=await readManagedContext(executionId);await approveHostExecution({execution_id:executionId,approval_id:'peer-crash-approved-action',expected_record_revision:current.record_revision,
          context_receipt_id:current.pack.receipt.id,approved_actions:[{tool:'computer_action',arguments:retry!,scope_id:target.id,calls:1}]});});
        const child=(worker as unknown as {child:ChildProcess}).child,identities=await observeBrowserProcessTree(child.pid!);
        const outcome=broker.act(retry).then(()=>({error:null}),error=>({error}));
        let writeTimeout:NodeJS.Timeout|undefined;
        try{await Promise.race([wrote,new Promise<never>((_,reject)=>{writeTimeout=setTimeout(()=>reject(new Error('Physical write not observed')),10000);})]);}
        finally{clearTimeout(writeTimeout);}
        expect(await readFile(source,'utf8')).toContain('crashFixture = true');
        expect((await readComputerJournal(executionId,'peer-crash-computer')).actions[0].receipt.state).toBe('dispatched');
        const exited=once(child,'exit');expect(child.kill('SIGKILL')).toBe(true);await exited;
        expect((await outcome).error).toBeTruthy();const receipt=await broker.act(retry);expect(receipt.state).toBe('unknown');expect(transfers).toBe(1);
        await vi.waitFor(async()=>expect(await observedBrowserProcessesEnded(identities)).toBe(true),{timeout:5000,interval:50});
        // Even observed process absence is not an original authenticated Stop acknowledgement or action verification.
        await expect(worker!.stop()).rejects.toThrow('COMPUTER_');
      },{signal:controller.signal,allow_declared_fixture:true})));
    const failure=await run.then(()=>null,error=>error as Error);
    expect(failure).toBeInstanceOf(Error);expect(original,`${failure?.message}; platform=${process.platform}; browser=${profile.browser_executable}; version=${profile.browser_version}`).toBeDefined();expect(failure!.message).toMatch(/COMPUTER_|JOB_EFFECT_RECOVERY_REQUIRED/);
    const retained=await within(()=>readComputerJournal(executionId,'peer-crash-computer'));
    expect(retained.actions).toHaveLength(1);expect(retained.actions[0].receipt.state).toBe('unknown');expect(retained.stop_state).toBe('unknown');expect(retained.session.state).toBe('recovery_required');
    expect(retained.usage.actions).toBe(1);expect(transfers).toBe(1);
    const jobs=await new EngineJobs(data).inspect();expect(jobs.records[0].job.unknown_effects).toContain('peer-crash-action');expect(jobs.records[0].work_settled).toBe(true);
    expect((await within(()=>readChangeObligations())).entries.some(value=>value.execution_id===executionId&&value.state!=='graph_committed')).toBe(true);
    await within(()=>endHostExecution({execution_id:executionId,outcome:'cancelled',work_termination:'unconfirmed'}));
    expect((await within(()=>readManagedContext(executionId))).status).toBe('recovery_required');
    expect(within(()=>activeComputerBroker(executionId,'peer-crash-computer'))).toBe(original);
    await expect(within(()=>original!.recoverStop())).rejects.toThrow('COMPUTER_');
    expect((await within(()=>original!.act(retry!))).state).toBe('unknown');expect(transfers).toBe(1);
    const persisted=JSON.parse(await readFile(join(data,'execution_contexts.json'),'utf8'));
    expect(JSON.stringify(persisted)).toContain('COMPUTER_EFFECT_UNKNOWN');expect(await readFile(join(data,'features.json'),'utf8')).not.toContain('crashFixture = true');
    const obligationsBefore=await readFile(join(data,'change_obligations.json'),'utf8');
    expect(await inspectComputerRestart({root,data,masterDir,instanceUuid:created.instance.uuid,bearer:identity.bearer,workerBearer,executionId,computerId:'peer-crash-computer'})).toMatchObject({original_owner_readback:true,worker_replacement_refused:true,new_grants:0});
    expect(await readFile(join(data,'change_obligations.json'),'utf8')).toBe(obligationsBefore);expect(transfers).toBe(1);
  }finally{
    controller.abort();await worker?.stop().catch(()=>{});
    if(server){server.closeAllConnections();await new Promise<void>(done=>server!.close(()=>done()));}
    await releaseGraphWriter(data);setDataDirOverride(previous);config.repos=repos;config.instance=instanceConfig;await rm(root,{recursive:true,force:true});
  }
},90000);
