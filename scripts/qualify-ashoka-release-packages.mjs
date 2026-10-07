/** Exact tarball upgrade/reconnect/migration smoke. Never touches an installed user instance. */
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,cp,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {addressWorkspaceTarball} from './workspace-artifacts.mjs';

const run=promisify(execFile), root=resolve('.'), assets=resolve(process.env.ASHOKA_RELEASE_ASSETS||'.codex/ashoka-release/artifacts');
const targetVersion=JSON.parse(await readFile(join(root,'package.json'),'utf8')).version;
const baselineVersion=process.env.ASHOKA_RELEASE_BASELINE||'13.4.0';
assert(['13.4.0','14.0.0','14.0.1'].includes(baselineVersion),`Unsupported release baseline: ${baselineVersion}`);
const npm=process.env.npm_execpath||join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
const output=resolve(process.env.ASHOKA_RELEASE_PACKAGE_EVIDENCE||`docs/ashoka/release-packages-${targetVersion}.json`);
const fixture=await mkdtemp(join(tmpdir(),'dg-release-packages-')), master=join(fixture,'master'), bin=join(master,'bin');
const report={schema:'dreamgraph.release_packages.v1',recorded_at:new Date().toISOString(),baseline_version:baselineVersion,target_version:targetVersion,scope:`Exact ${baselineVersion} and ${targetVersion} tarball payloads; disposable shared-bin install/restart and retained legacy data. Excludes PATH/VS Code activation, real instances and paid requests.`,checks:[],artifacts:[],model_requests:0};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const record=(name,value)=>{report.checks.push({name,value});console.log(name,JSON.stringify(value));};
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('DREAMGRAPH_')&&!key.startsWith('DG_')&&!/API_?KEY|ACCESS_TOKEN|AUTH_TOKEN|SECRET|DATABASE_URL/i.test(key)));
Object.assign(env,{DREAMGRAPH_MASTER_DIR:master,DREAMGRAPH_BIN_DIR:bin,DREAMGRAPH_LLM_PROVIDER:'none',DREAMGRAPH_SCHEDULER:'{"enabled":false}'});
let child,instance,data,port;
async function command(file,args,extra={}){return run(file,args,{cwd:fixture,env,windowsHide:true,maxBuffer:8*1024*1024,timeout:180000,...extra});}
async function deploy(version){
 const payload=join(fixture,'payload-'+version);await mkdir(payload,{recursive:true});
 const tarball=join(assets,`dreamgraph-${version}.tgz`);report.artifacts.push({file:`dreamgraph-${version}.tgz`,sha256:hash(await readFile(tarball))});
 await command('tar',['-xzf',tarball,'--strip-components','1','-C',payload]);
 await mkdir(bin,{recursive:true});await rm(join(bin,'dist'),{recursive:true,force:true});await cp(join(payload,'dist'),join(bin,'dist'),{recursive:true});
 await cp(join(payload,'templates'),join(master,'templates'),{recursive:true});
 if(version===targetVersion)await cp(join(payload,'browser-extension'),join(bin,'browser-extension'),{recursive:true});
 const manifest=JSON.parse(await readFile(join(payload,'package.json'),'utf8'));
 const vendor=join(bin,'vendor');await mkdir(vendor,{recursive:true});
 const dependencies={...manifest.dependencies};
 if(manifest.devDependencies?.['@modelcontextprotocol/sdk'])dependencies['@modelcontextprotocol/sdk']=manifest.devDependencies['@modelcontextprotocol/sdk'];
 for(const name of ['sdk','host','token-economy']){
  const filename=`dreamgraph-${name}-${version}.tgz`,bytes=await readFile(join(assets,filename));report.artifacts.push({file:filename,sha256:hash(bytes)});
  await writeFile(join(vendor,filename),bytes);dependencies['@dreamgraph/'+name]='file:./vendor/'+await addressWorkspaceTarball(join(vendor,filename));
 }
 await writeFile(join(bin,'package.json'),JSON.stringify({name:'dreamgraph-global',version,type:'module',dependencies,optionalDependencies:manifest.optionalDependencies}));
 await rm(join(bin,'package-lock.json'),{force:true});
 await command(process.execPath,[npm,'install','--omit=dev','--no-audit','--no-fund'],{cwd:bin});
 const cli=await command(process.execPath,[join(bin,'dist/cli/dg.js'),'--version']);assert(cli.stdout.includes(version));
 record('Installed CLI '+version,{version:cli.stdout.trim(),same_bin:true});
 if(version===targetVersion){
  const verification=await command(process.execPath,[join(root,'scripts/workspace-artifacts.mjs'),'verify',payload,bin]);record('Installed workspace bytes and daemon import',JSON.parse(verification.stdout));
  for(const file of ['dist/computer/browser-worker-entry.js','dist/explorer-spa/index.html','dist/architect/operational-workspaces-ui.js'])assert((await readFile(join(bin,file))).length>0,file);
  const extension=JSON.parse(await readFile(join(bin,'browser-extension/manifest.json'),'utf8'));
  assert.equal(extension.version,targetVersion);
  for(const file of ['background.js','popup.js','popup.html','README.md'])assert((await readFile(join(bin,'browser-extension',file))).length>0,file);
  for(const file of ['dist/computer/browser-bridge/host-main.js','dist/cli/commands/browser.js'])assert((await readFile(join(bin,file))).length>0,file);
  record('Browser extension and native host packaged at release version',{version:extension.version});
 }
 return payload;
}
async function stop(){if(child&&child.exitCode===null&&child.signalCode===null){const exit=once(child,'exit');child.kill();await Promise.race([exit,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Owned daemon termination unconfirmed')),5000))]);}child=null;}
async function boot(version){
 child=spawn(process.execPath,[join(bin,'dist/index.js'),'--transport','http','--port',String(port)],{cwd:fixture,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 let log='';child.stderr.on('data',chunk=>{log=(log+chunk).slice(-12000);});
 const start=performance.now();await new Promise((done,reject)=>{const timer=setTimeout(()=>reject(new Error('Startup timed out: '+log)),30000);child.stderr.on('data',chunk=>{if(String(chunk).includes('Server running on')){clearTimeout(timer);done();}});child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);reject(new Error('Daemon exited '+code+': '+log));});});
 const health=await fetch(`http://127.0.0.1:${port}/health`,{signal:AbortSignal.timeout(10000)});assert.equal(health.status,200);
 record('Daemon health '+version,{http:health.status,start_ms:Math.round(performance.now()-start)});
}
const cli=async(args)=>JSON.parse((await command(process.execPath,[join(bin,'dist/cli/dg.js'),'graph-upgrade',instance.uuid,...args,'--master-dir',master,'--json'])).stdout);
try{
 const old=await deploy(baselineVersion);
 const make=`import {createInstance} from ${JSON.stringify(pathToFileURL(join(bin,'dist/instance/lifecycle.js')).href)};const {instance,scope}=await createInstance({name:'release-fixture',masterDir:process.env.DREAMGRAPH_MASTER_DIR,projectRoot:process.cwd(),repos:{fixture:process.cwd()},transport:{type:'http'}});console.log(JSON.stringify({instance,data:scope.dataDir}));`;
 const created=JSON.parse((await command(process.execPath,['--input-type=module','-e',make])).stdout);instance=created.instance;data=created.data;
 env.DREAMGRAPH_INSTANCE_UUID=instance.uuid;env.DREAMGRAPH_DATA_DIR=data;env.DREAMGRAPH_REPOS=JSON.stringify({fixture:fixture});
 const original='\ufeff[ {"id":"release-fixture","name":"Release Fixture","description":"Retained legacy source fact","source_repo":"fixture","source_files":["fixture.ts"],"origin":"lucid"}, {"name":"Legacy missing identity"} ]\n';
 await writeFile(join(data,'features.json'),original);await writeFile(join(data,'extension_history.json'),'{"fixture":"retained extension history"}\n');
 const config=join(master,instance.uuid,'config','engine.env');await writeFile(config,'DREAMGRAPH_LLM_PROVIDER=none\nDREAMGRAPH_SCHEDULER={"enabled":false}\nCUSTOM_RELEASE_FIXTURE=retained\n');
 const reservation=createServer();await new Promise(done=>reservation.listen(0,'127.0.0.1',done));port=reservation.address().port;await new Promise(done=>reservation.close(done));
 const legacyClient=await import(pathToFileURL(join(bin,'dist/cli/utils/mcp-call.js')).href);
 await boot(baselineVersion);const legacyTools=await legacyClient.mcpListTools(port);assert(legacyTools.some(tool=>tool.name==='query_resource'));
 const first=await legacyClient.mcpCallTool(port,'query_resource',{uri:'system://features',filter:{id:'release-fixture'},...(baselineVersion.startsWith('14.')?{contract_version:'legacy'}:{})},10000);assert(!first.isError);record(`Actual ${baselineVersion} CLI MCP client`,{tool_count:legacyTools.length,read:true,contract_version:baselineVersion.startsWith('14.')?'legacy':'default'});await stop();
 const configBefore=hash(await readFile(config)),historyBefore=hash(await readFile(join(data,'extension_history.json')));
 await deploy(targetVersion);assert.equal(hash(await readFile(config)),configBefore);assert.equal(await readFile(join(data,'features.json'),'utf8'),original);assert.equal(hash(await readFile(join(data,'extension_history.json'))),historyBefore);
 record('Install leaves graph, instance configuration and extension history untouched',true);
 await boot(targetVersion);const tools=await legacyClient.mcpListTools(port);assert(tools.some(tool=>tool.name==='query_resource'));
 const canonical=await legacyClient.mcpCallTool(port,'query_resource',{uri:'system://features',filter:{id:'release-fixture'}},10000);
 assert(canonical.isError&&canonical.structuredContent.data.state.reasons.some(reason=>reason.code==='MISSING_ENTITY_ID'),'Canonical reads must expose the deliberate missing legacy identity before migration');
 const result=await legacyClient.mcpCallTool(port,'query_resource',{uri:'system://features',filter:{id:'release-fixture'},contract_version:'legacy'},10000);assert(!result.isError,JSON.stringify(result));assert(JSON.stringify(result).includes('Release Fixture'));
 record(`${baselineVersion} client reconnects to ${targetVersion} MCP authority`,{tool_count:tools.length,explicit_legacy_contract_read:true,canonical_missing_identity_refused:true});
 for(const path of ['/architect','/config?embed=architect','/schedules?embed=architect','/status?embed=architect','/explorer/']){const response=await fetch(`http://127.0.0.1:${port}${path}`,{signal:AbortSignal.timeout(10000)});assert.equal(response.status,200,path);assert((await response.text()).length>100);}
 const settings=await fetch(`http://127.0.0.1:${port}/api/config/v1`,{signal:AbortSignal.timeout(10000)});assert.equal(settings.status,200);record('Packaged web surfaces and sibling template config readback',true);await stop();
 const previewFile=join(fixture,'preview.json'),preview=await cli(['preview','--out',previewFile]);assert.deepEqual(preview.blockers,[]);assert.equal(await readFile(join(data,'features.json'),'utf8'),original);
 const reviewed=JSON.parse(await readFile(previewFile,'utf8'));assert(reviewed.writes.length>0);const approval=['--preview',previewFile,'--reviewed-digest',preview.digest,'--review-id','release-package-review','--operation-id','release-package-upgrade'];
 const applied=await cli(['apply',...approval]);assert(applied.receipt);const replayed=await cli(['apply',...approval]);assert.equal(replayed.replayed,true);record('Installed CLI reviewed migration and lost-reply replay',{changed_files:applied.receipt.result.changed_files,replayed:true});
 await boot(targetVersion);const feature=await legacyClient.mcpCallTool(port,'query_resource',{uri:'system://features',filter:{id:'release-fixture'}},10000);assert(!feature.isError);await stop();record('Post-migration restart and legacy lookup',true);
 await writeFile(config,'DREAMGRAPH_LLM_PROVIDER=none\nDREAMGRAPH_SCHEDULER={"enabled":false}\nCUSTOM_RELEASE_FIXTURE=later-intent\n');
 const restoreFile=join(fixture,'restore.json'),restore=await cli(['restore-preview','--original-operation','release-package-upgrade','--out',restoreFile]);assert.deepEqual(restore.blockers,[]);
 const restored=await cli(['restore','--preview',restoreFile,'--reviewed-digest',restore.digest,'--review-id','release-package-restore-review','--operation-id','release-package-restore']);assert(restored.receipt);assert.equal(await readFile(join(data,'features.json'),'utf8'),original);assert((await readFile(config,'utf8')).includes('later-intent'));assert.equal(hash(await readFile(join(data,'extension_history.json'))),historyBefore);record('Reviewed exact-byte restore preserves later configuration and unrelated history',true);
 await writeFile(join(data,'tension_log.json'),'{"schema_version":"99.0.0","signals":[]}');const unsupported=await cli(['preview']);assert(unsupported.blockers.some(value=>value.includes('UNSUPPORTED_STORE_SCHEMA')));record('Unknown/future schema refuses migration',true);
 report.success=true;
}catch(error){report.success=false;report.failure=String(error?.stack??error);console.error(report.failure);process.exitCode=1;}
finally{await stop();await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');await rm(fixture,{recursive:true,force:true});}
