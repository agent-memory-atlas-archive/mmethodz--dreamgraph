/** Actual Codex metadata only. No thread/turn, input, model request or native Stop qualification. */
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createArchitectCodexConfigToml,createArchitectCliBridgeSpawnPlan,resolveArchitectCliBridgeExecutablePath,inspectCodexNativeComputer,parseCodexComputerDiscovery} from '../dist/architect/cli-bridge.js';
const output=process.argv[2];if(!output)throw Error('Supply a fresh evidence output file.');
const directory=await mkdtemp(join(tmpdir(),'dg-codex-policy-'));
assert(resolve(directory).startsWith(resolve(tmpdir())+sep)&&directory.includes('dg-codex-policy-'));
let server;
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('DREAMGRAPH_')&&!key.startsWith('DG_')&&!/API_KEY|ACCESS_TOKEN|BEARER|SECRET|CREDENTIAL/i.test(key)));
env.CODEX_HOME=directory;
const command=await resolveArchitectCliBridgeExecutablePath(process.env.DREAMGRAPH_ARCHITECT_CODEX_CLI_BINARY||'codex',process.env);assert(command);
const config=createArchitectCodexConfigToml({bridgeCommand:process.execPath,bridgeArgs:[],env:{},tools:['query_resource']});
await writeFile(join(directory,'config.toml'),config,{mode:0o600});
function start(args){const plan=createArchitectCliBridgeSpawnPlan(command,args);return spawn(plan.command,plan.args,{cwd:directory,env,windowsHide:true,
 windowsVerbatimArguments:plan.windowsVerbatimArguments,stdio:['pipe','pipe','pipe']});}
async function run(args){const child=start(args);let stdout='',bytes=0;const timer=setTimeout(()=>child.kill('SIGTERM'),15000);
 try{child.stderr.on('data',()=>{});child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>32768)child.kill('SIGTERM');else stdout+=chunk;});child.stdin.end();
  const [code]=await once(child,'exit');assert.equal(code,0);assert(bytes<=32768);return stdout;
 }finally{clearTimeout(timer);}}
try{
 const detected=await inspectCodexNativeComputer();assert.equal(detected.qualified,false);
 const isolated=parseCodexComputerDiscovery(await run(['--version']),await run(['features','list']));
 for(const name of ['computer_use','browser_use','browser_use_external','browser_use_full_cdp_access','in_app_browser'])assert.equal(isolated.features[name]?.enabled,false,name);
 server=start(['app-server']);let buffer='',total=0,nextId=1,diagnostic='';const pending=new Map();
 server.stderr.on('data',chunk=>{diagnostic=(diagnostic+chunk).slice(-2000);});
 server.stdout.on('data',chunk=>{total+=chunk.length;if(total>256*1024){server.kill('SIGTERM');return;}buffer+=chunk;
  for(;;){const end=buffer.indexOf('\n');if(end<0)break;const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!line.trim())continue;
   try{const reply=JSON.parse(line),wait=pending.get(reply.id);if(wait){pending.delete(reply.id);reply.error?wait.reject(Error('Metadata RPC refused: '+reply.error.code)):wait.resolve(reply.result);}}
   catch{server.kill('SIGTERM');}
  }});
 const rpc=(method,params)=>new Promise((resolveReply,reject)=>{const id=nextId++,timer=setTimeout(()=>{pending.delete(id);reject(Error('Metadata RPC deadline: '+method));},15000);
  pending.set(id,{resolve:value=>{clearTimeout(timer);resolveReply(value);},reject:error=>{clearTimeout(timer);reject(error);}});
  server.stdin.write(JSON.stringify({id,method,params})+'\n');});
 await rpc('initialize',{clientInfo:{name:'dreamgraph-ashoka-metadata-proof',version:'1'},capabilities:{experimentalApi:true}});
 server.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');
 const settings=await rpc('config/read',{includeLayers:false,cwd:directory});
 assert.equal(settings.config.computer_use?.default_app_access,'deny');
 const record={schema:'dreamgraph.ashoka.codex_native_metadata.v1',at:new Date().toISOString(),platform:process.platform,node:process.versions.node,
  version:isolated.version,detected,isolated_features:isolated.features,default_app_access:settings.config.computer_use.default_app_access,
  config_sha256:createHash('sha256').update(await readFile(join(directory,'config.toml'))).digest('hex'),
  model_requests:0,threads:0,native_input:0,qualified:false,scope:'Actual CLI version/features and app-server config/read only. Native scope, action budgets, privacy, independent physical Stop and normalized receipts remain unqualified. No personal config/auth artifacts copied.'};
 await writeFile(output,JSON.stringify(record,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({version:record.version,disabled:Object.keys(record.isolated_features).length,default_app_access:'deny',model_requests:0,qualified:false}));
}finally{
 if(server&&server.exitCode===null&&server.signalCode===null){const exited=once(server,'exit');server.stdin.end();const timer=setTimeout(()=>server.kill('SIGTERM'),3000);try{await exited;}finally{clearTimeout(timer);}}
 await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
