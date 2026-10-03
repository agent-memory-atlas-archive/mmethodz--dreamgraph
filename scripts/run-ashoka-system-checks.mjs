/** Full offline build/contract/consumer/browser gate. No release, migration or model-evaluation approval. */
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,readdir,readFile,realpath,stat,writeFile} from 'node:fs/promises';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const systemSteps=Object.freeze([
 ['server','npm',['run','build:server']],
 ['explorer','npm',['--prefix','explorer','run','build']],
 ['editor','npm',['--prefix','extensions/vscode','run','build']],
 ...['contracts:check','providers:check','mcp:check','metrics:check','config:check','ashoka:baseline:check'].map(name=>[name.replaceAll(':','-'),'npm',['run',name]]),
 ['editor-tests','node',['scripts/run-ashoka-editor-tests.mjs']],
 // The release gate measures functional and real-browser deadlines without a
 // second suite competing for the same host. This is not a stress-load claim.
 // Keep text diagnostics as well as JSON: JSON alone drops error causes/hooks.
 ['root-tests','npm',['exec','--','vitest','run','--maxWorkers','1','--reporter=default','--reporter=json']],
 ['browser','node',['dist/cli/dg.js','computer-use','qualify']],
]);
const retiredSkips=new Set(['pushParticlesForEdge ParticleSystem removed in Slice F1 — flow now lives on the tube shader','ParticleSystem ParticleSystem removed in Slice F1']);
export function assertRootReport(result,expectedFiles){
 if(!result||result.success!==true||result.numFailedTests!==0||!Number.isSafeInteger(result.numPassedTests)||result.numPassedTests<1
  ||result.numFailedTestSuites!==0||result.numTodoTests!==0||result.snapshot?.failure===true
  ||!Array.isArray(result.testResults)||!result.testResults.length||result.testResults.some(test=>test.status!=='passed'||!test.assertionResults?.length))throw new Error('ASHOKA_ROOT_SUITE_NOT_PASSED');
 const cases=result.testResults.flatMap(file=>file.assertionResults),skipped=cases.filter(test=>test.status==='skipped');
 if(cases.some(test=>test.status!=='passed'&&(test.status!=='skipped'||!retiredSkips.has(test.fullName)))
  ||skipped.length!==result.numPendingTests||cases.length!==result.numTotalTests||cases.filter(test=>test.status==='passed').length!==result.numPassedTests)throw new Error('ASHOKA_ROOT_MISSING_OR_UNEXPECTED_SKIP');
 if(expectedFiles){const normalize=path=>process.platform==='win32'?resolve(path).toLowerCase():resolve(path);
  if(JSON.stringify(result.testResults.map(test=>normalize(test.name)).sort())!==JSON.stringify(expectedFiles.map(normalize).sort()))throw new Error('ASHOKA_ROOT_FILE_COVERAGE_INCOMPLETE');}
 return {passed:result.numPassedTests,failed:0,skipped:result.numPendingTests,skip_names:skipped.map(test=>test.fullName),files:result.testResults.length};
}
export function assertEditorReport(log){
 const count=name=>Number(log.match(new RegExp('(?:#|ℹ) '+name+' (\\d+)(?:\\r?\\n|$)'))?.[1]??NaN);
 const tests=count('tests'),passed=count('pass');
 if(!Number.isSafeInteger(tests)||tests<1||tests!==passed||['fail','cancelled','skipped','todo'].some(name=>count(name)!==0))throw new Error('ASHOKA_EDITOR_SUITE_NOT_PASSED');
 return {passed,failed:0,skipped:0};
}
export function assertBrowserProof(value){
 const qualification=value?.worker?.qualification,traces=value?.evidence?.traces;
 const termination=traces?.find(trace=>trace.id==='BW04')?.evidence?.termination_ms;
 if(qualification?.evidence_scope!=='actual_runtime'||value.evidence.model_requests!==0||!Array.isArray(traces)||traces.length!==11
  ||!qualification.scope_negative_passed||!qualification.privacy_passed||!qualification.bounded_actions_passed
  ||!Number.isFinite(qualification.stop_release_ms)||qualification.stop_release_ms<0||qualification.stop_release_ms>1000
  ||!Number.isFinite(termination)||termination<0||termination>5000
  ||!Number.isFinite(qualification.control_loss_stop_ms)||qualification.control_loss_stop_ms<0||qualification.control_loss_stop_ms>5000
  ||!['CU04','CU05','CU10','CU20','CU24'].every(id=>qualification.cases?.includes(id)))throw new Error('ASHOKA_BROWSER_NOT_QUALIFIED');
 return {platform:qualification.platform,architecture:qualification.architecture,checks:traces.length,stop_release_ms:qualification.stop_release_ms,termination_ms:termination,control_loss_stop_ms:qualification.control_loss_stop_ms};
}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function sourceSnapshot(){
 const files=[],excluded=new Set(['node_modules','dist','dist-test','__pycache__','.git','.codex','tmp']);
 async function walk(folder){for(const item of await readdir(join(root,folder),{withFileTypes:true})){
  if(excluded.has(item.name)||item.name.endsWith('.tsbuildinfo')||item.name.endsWith('.pyc'))continue;
  const path=folder+'/'+item.name;if(item.isDirectory())await walk(path);else if(item.isFile()){
   if(item.name.startsWith('.env'))throw new Error('ASHOKA_SOURCE_CREDENTIAL_FILE_REFUSED');
   const bytes=await readFile(join(root,path));if(bytes.length>8*1024*1024||files.length>=10000)throw new Error('ASHOKA_SOURCE_SNAPSHOT_CAPACITY');
   files.push({path,bytes:bytes.length,sha256:sha(bytes)});
  }else throw new Error('ASHOKA_SOURCE_LINK_REFUSED');
 }}
 for(const directory of ['src','packages','explorer/src','extensions/vscode/src','python/analytics','tests','scripts','templates','.github/workflows'])await walk(directory);
 for(const path of ['package.json','package-lock.json','tsconfig.json','tsconfig.base.json','vitest.config.ts','explorer/package.json','explorer/package-lock.json','explorer/tsconfig.json','extensions/vscode/package.json','extensions/vscode/package-lock.json','extensions/vscode/tsconfig.json','extensions/vscode/tsconfig.test.json']){
  const bytes=await readFile(join(root,path));files.push({path,bytes:bytes.length,sha256:sha(bytes)});
 }
 files.sort((a,b)=>a.path.localeCompare(b.path));return {files,hash:sha(JSON.stringify(files))};
}
async function main(){
 const args=process.argv.slice(2);
 if(args.length===1&&args[0]==='--describe'){console.log(JSON.stringify({schema:'dreamgraph.ashoka.offline_gate_definition.v1',steps:systemSteps,model_requests:0,
  exclusions:['Live graph migration','Real-model comparisons','Physical VS Code','Native desktop/CLI/provider qualification','Release acceptance']},null,2));return;}
 if(args.length!==2||args[0]!=='--out')throw new Error('Use npm run ashoka:system:check -- --out <new-directory>. --describe performs no work.');
 if(await realpath(process.cwd())!==await realpath(root))throw new Error('ASHOKA_ROOT_WORKSPACE_REQUIRED');
 const npm=process.env.npm_execpath;if(!npm||!isAbsolute(npm)||!(await stat(npm)).isFile())throw new Error('ASHOKA_NPM_RUN_REQUIRED');
 const browser=process.env.ASHOKA_BROWSER_EXECUTABLE,version=process.env.ASHOKA_BROWSER_VERSION;
 if(!browser||!isAbsolute(browser)||!/^\d+(?:\.\d+){3}$/.test(version??''))throw new Error('ASHOKA_EXPLICIT_BROWSER_REQUIRED');
 // A clean CI checkout contains no local .env. Refuse before any command rather than import personal credentials.
 for(const file of ['.env','.env.local','extensions/vscode/.env','explorer/.env']){
  try{await stat(join(root,file));throw new Error('ASHOKA_CREDENTIAL_FREE_CHECKOUT_REQUIRED');}catch(error){if(error.code!=='ENOENT')throw error;}
 }
 const output=resolve(args[1]);await mkdir(output); // Never replace a prior run.
 const source=await sourceSnapshot();await writeFile(join(output,'source-inventory.json'),JSON.stringify(source,null,2)+'\n',{flag:'wx'});
 const environment={...process.env};for(const key of Object.keys(environment))if(/API_?KEY|ACCESS_TOKEN|AUTH_TOKEN|(^|_)SECRET|^OPENAI_|^ANTHROPIC_|^AZURE_OPENAI_/i.test(key))delete environment[key];
 const results=[],controller=new AbortController(),cancel=()=>controller.abort(new Error('ASHOKA_GATE_CANCELLED'));
 process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
 const report={schema:'dreamgraph.ashoka.offline_gate.v1',status:'running',source_hash:source.hash,platform:process.platform,architecture:process.arch,node:process.versions.node,
  model_requests:0,scope:'Offline builds, contracts, compiled consumers and actual isolated browser only. No release or real-model usefulness claim.',steps:results};
 try{
  for(const [name,kind,base]of systemSteps){
   controller.signal.throwIfAborted();const args=[...base];
   if(name==='root-tests')args.push('--outputFile='+join(output,'root-tests.json'));
   if(name==='browser')args.push('--browser-executable',browser,'--browser-version',version,'--worker-id','ashoka-ci-browser','--out',join(output,'browser-qualification.json'));
   const command=kind==='npm'?[npm,...args]:args,parts=[];let bytes=0;const started=performance.now();
   console.log('Ashoka offline gate: '+name);
   const result=await new Promise(done=>{
    const child=spawn(process.execPath,command,{cwd:root,env:environment,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let reason=null,settled=false,force,unknown;
    const finish=(code,signal,closed)=>{if(settled)return;settled=true;clearTimeout(deadline);clearTimeout(force);clearTimeout(unknown);
     controller.signal.removeEventListener('abort',abort);done({code,signal,closed,reason});};
    // Preserve partial output on every failure. A rejected wait is never a termination receipt.
    const stop=error=>{if(settled||reason)return;reason=error;child.kill('SIGTERM');
     force=setTimeout(()=>{child.kill('SIGKILL');unknown=setTimeout(()=>finish(null,null,false),1000);},2000);};
    const capture=part=>{bytes+=part.length;if(bytes>64*1024*1024)stop('ASHOKA_GATE_OUTPUT_CAPACITY');else if(!settled)parts.push(part);};
    const abort=()=>stop('ASHOKA_GATE_CANCELLED');
    const deadline=setTimeout(()=>stop('ASHOKA_GATE_STEP_TIMEOUT'),20*60*1000);deadline.unref();
    child.stdout.on('data',capture);child.stderr.on('data',capture);
    child.once('error',()=>{reason='ASHOKA_GATE_CHILD_START_FAILED';finish(null,null,false);});
    controller.signal.addEventListener('abort',abort,{once:true});if(controller.signal.aborted)abort();
    child.once('close',(code,signal)=>finish(code,signal,true));
   });
   await writeFile(join(output,name+'.log'),Buffer.concat(parts),{flag:'wx'});
   results.push({name,exit_code:result.code,signal:result.signal,child_closed:result.closed,failure:result.reason,elapsed_seconds:(performance.now()-started)/1000});
   if(result.reason||!result.closed||result.code!==0||result.signal)throw new Error((result.reason??'ASHOKA_GATE_STEP_FAILED')+':'+name);
   if(name==='editor-tests')report.editor=assertEditorReport(Buffer.concat(parts).toString('utf8'));
   if(name==='root-tests')report.root=assertRootReport(JSON.parse(await readFile(join(output,'root-tests.json'),'utf8')),source.files.filter(file=>file.path.startsWith('tests/')&&file.path.endsWith('.test.ts')).map(file=>join(root,file.path)));
   if(name==='browser')report.browser=assertBrowserProof(JSON.parse(await readFile(join(output,'browser-qualification.json'),'utf8')));
  }
  controller.signal.throwIfAborted();
  if((await sourceSnapshot()).hash!==source.hash)throw new Error('ASHOKA_GATE_SOURCE_CHANGED');
  report.status='passed';
 }catch(error){report.status='failed';report.reason=error instanceof Error?error.message:'ASHOKA_GATE_FAILED';throw error;}
 finally{process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);report.finished_at=new Date().toISOString();
  await writeFile(join(output,'result.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 }
 console.log(JSON.stringify(report));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
