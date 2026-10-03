/** Actual Linux installer/browser proof. Updates only the explicitly named WSL test bed. */
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

if(process.platform!=='win32')throw new Error('Run this WSL qualification coordinator on Windows.');
const flags=Object.fromEntries(process.argv.slice(2).reduce((pairs,value,index,values)=>{
  if(index%2===0)pairs.push([value,values[index+1]]);return pairs;
},[]));
if(Object.keys(flags).some(key=>!['--distribution','--out','--npm-cache','--browser-cache'].includes(key))||!flags['--distribution']||!flags['--out'])
  throw new Error('Usage: node scripts/qualify-ashoka-wsl-browser.mjs --distribution Ubuntu --out <new-directory> [--npm-cache <Linux-cache>] [--browser-cache <Linux-cache>]');
for(const name of ['--npm-cache','--browser-cache'])if(flags[name]&&!/^\/tmp\/dg-ashoka-wsl-[a-zA-Z0-9_/-]+$/.test(flags[name]))
  throw new Error('Only a retained Linux qualification cache may be reused.');
const distribution=flags['--distribution'],output=resolve(flags['--out']);
await mkdir(output); // A previous proof cannot be overwritten by a retry.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const stage=await mkdtemp(join(tmpdir(),'dg-ashoka-wsl-source-'));
const inventory=[],skip=new Set(['node_modules','dist','.git','.codex','.env','.env.local']);
let copiedBytes=0;
async function copy(relative){
  const input=join(root,relative),entries=await readdir(input,{withFileTypes:true});
  await mkdir(join(stage,relative),{recursive:true});
  for(const entry of entries){
    if(skip.has(entry.name)||entry.name.endsWith('.tsbuildinfo'))continue;
    const name=relative+'/'+entry.name;
    if(entry.isDirectory())await copy(name);
    else if(entry.isFile())await copyFile(name);
    else throw new Error('Qualification source must contain regular files: '+name);
  }
}
async function copyFile(relative){
  const body=await readFile(join(root,relative));copiedBytes+=body.length;
  if(inventory.length>=10000||copiedBytes>128*1024*1024)throw new Error('Qualification source capacity exceeded.');
  // Linux checkouts must have executable shell sources with LF line endings.
  const staged=relative.endsWith('.sh')?Buffer.from(body.toString('utf8').replaceAll('\r\n','\n')):body;
  await writeFile(join(stage,relative),staged,{flag:'wx'});
  const hash=value=>createHash('sha256').update(value).digest('hex');
  inventory.push({file:relative,original_sha256:hash(body),staged_sha256:hash(staged),bytes:staged.length});
}
for(const relative of ['src','packages','explorer','scripts','templates'])await copy(relative);
for(const relative of ['package.json','package-lock.json','tsconfig.json','tsconfig.base.json','README.md','LICENSE','.npmignore'])await copyFile(relative);
inventory.sort((a,b)=>a.file.localeCompare(b.file));
await writeFile(join(output,'source-inventory.json'),JSON.stringify({schema:'dreamgraph.wsl_source_inventory.v1',files:inventory,
  excludes:['Windows dependencies and build output','personal configuration and credentials','VS Code activation','live graph and instance files'],
  shell_line_endings:'LF',aggregate_sha256:createHash('sha256').update(JSON.stringify(inventory)).digest('hex')},null,2)+'\n',{flag:'wx'});
async function wsl(args,{log,timeout=60000}={}){
  return await new Promise((done,fail)=>{
    const child=spawn('wsl.exe',['--distribution',distribution,'--exec',...args],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    const parts=[];let size=0,timedOut=false;
    const capture=part=>{size+=part.length;if(size>8*1024*1024){child.kill();fail(new Error('WSL qualification output capacity exceeded.'));}else parts.push(part);};
    child.stdout.on('data',capture);child.stderr.on('data',capture);
    const timer=setTimeout(()=>{timedOut=true;child.kill();},timeout);
    child.once('error',error=>{clearTimeout(timer);fail(error);});
    child.once('close',async code=>{clearTimeout(timer);const text=Buffer.concat(parts).toString('utf8');
      if(log)await writeFile(join(output,log),text,{flag:'wx'});
      if(code!==0||timedOut)fail(new Error(`WSL phase failed (${code}${timedOut?', timeout':''}): ${text.slice(-3000)}`));else done(text.trim());
    });
  });
}
const linuxStage=await wsl(['wslpath','-a',stage]);
const linuxOutput=await wsl(['wslpath','-a',output]);
const linuxRoot='/tmp/dg-ashoka-wsl-'+randomUUID();
const linuxProof=String.raw`
import {readFile,writeFile,realpath} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import os from 'node:os';
const task=process.argv[2],master=await realpath(process.env.DREAMGRAPH_MASTER_DIR),bin=join(master,'bin');
if(!master.startsWith('/home/')||master.startsWith('/mnt/'))throw new Error('LINUX_INSTALL_SCOPE_REQUIRED');
const manifest=JSON.parse(await readFile(join(bin,'package.json'),'utf8'));
const runtime=JSON.parse(await readFile(join(bin,'node_modules/playwright-core/package.json'),'utf8'));
if(manifest.optionalDependencies?.['playwright-core']!=='1.62.1'||runtime.version!=='1.62.1')throw new Error('INSTALLED_BROWSER_RUNTIME_MISMATCH');
const {chromium}=await import(pathToFileURL(join(bin,'node_modules/playwright-core/index.mjs')).href);
const executable=await realpath(chromium.executablePath());
const version=execFileSync(executable,['--version'],{encoding:'utf8'}).trim().match(/\d+\.\d+\.\d+\.\d+/)?.[0];
if(!version)throw new Error('BROWSER_VERSION_UNVERIFIED');
const proof=join(task,'browser-qualification.json');
const cliOutput=execFileSync(join(os.homedir(),'.local/bin/dg'),['computer-use','qualify','--browser-executable',executable,
  '--browser-version',version,'--worker-id','ashoka-wsl-ubuntu-browser','--out',proof],{encoding:'utf8',timeout:120000});
const qualification=JSON.parse(await readFile(proof,'utf8'));
if(qualification.evidence.platform!=='linux'||qualification.evidence.model_requests!==0||qualification.evidence.traces.length!==11)throw new Error('INCOMPLETE_BROWSER_PROOF');
const workspaces=JSON.parse(execFileSync(process.execPath,[join(task,'source/scripts/workspace-artifacts.mjs'),'verify',join(task,'source'),bin],{encoding:'utf8'}));
const sdk=join(bin,'node_modules/@dreamgraph/sdk/dist/seams');
const {ManagedExecutionClient}=await import(pathToFileURL(join(sdk,'graph-execution.js')).href),native=await import(pathToFileURL(join(sdk,'computer-pass.js')).href);
const control_methods=['readComputerPassSetup','prepareComputerPass','confirmComputerPass','cancelComputerPass','runComputerPass'];
const client=new ManagedExecutionClient({baseUrl:'http://127.0.0.1:9',sessionBearer:'declared-installer-only'});
try{if(control_methods.some(name=>typeof client[name]!=='function')||native.NativeComputerScopeSchema.shape.model.shape.role.value!=='computer_use')throw new Error('INSTALLED_NATIVE_COMPUTER_SEAM_MISSING');
 native.NativeComputerSetupSchema.parse({ok:true,available:false,route:'unavailable',reasons:['COMPUTER_DISABLED'],remedy:'Explicit configuration required.'});
}finally{client.dispose();}
const sha=body=>createHash('sha256').update(body).digest('hex');
const files=[];
for(const name of ['package.json','dist/cli/dg.js','dist/computer/browser-harness.js','dist/computer/browser-worker-entry.js'])
  files.push({file:name,sha256:sha(await readFile(join(bin,name)))});
await writeFile(join(task,'installation-proof.json'),JSON.stringify({schema:'dreamgraph.wsl_installation_proof.v1',recorded_at:new Date().toISOString(),
  platform:process.platform,architecture:process.arch,kernel:os.release(),distribution:await readFile('/etc/os-release','utf8'),node:process.versions.node,
  npm:execFileSync('npm',['--version'],{encoding:'utf8'}).trim(),master,source:join(task,'source'),version:manifest.version,
  cli_version:execFileSync(join(os.homedir(),'.local/bin/dg'),['--version'],{encoding:'utf8'}).trim(),workspaces,files,
  runtime_version:runtime.version,browser_executable:executable,browser_version:version,model_requests:0,
  native_sdk_contract:{control_methods,role:'computer_use',scope:'Installed export/schema readback only; no daemon request, grant or model dispatch.'},
  support_scope:'Actual WSL Linux test-bed installer and isolated headless browser only. No native desktop, CLI computer adapter, macOS, Linux Mint GUI or VS Code activation qualification.',
  browser_artifact_hash:qualification.worker.qualification.artifact_hash,cli_output:JSON.parse(cliOutput)},null,2)+'\n',{flag:'wx'});
`;
const shell=String.raw`#!/usr/bin/env bash
set -euo pipefail
task_root="$1"
staged_source="$2"
proof_output="$3"
npm_cache="$4"
browser_cache="$5"
[[ "$task_root" == /tmp/dg-ashoka-wsl-* && ! -e "$task_root" ]]
[[ "$(realpath "$HOME")" == /home/* && ! -w /usr/local/bin ]]
mkdir -p "$task_root"
cp -a "$staged_source" "$task_root/source"
cp "$staged_source/linux-proof.mjs" "$task_root/linux-proof.mjs"
export PATH="$HOME/.local/bin:/usr/bin:/bin"
mkdir -p "$HOME/.local/bin"
export DREAMGRAPH_MASTER_DIR="$HOME/.dreamgraph"
export npm_config_cache="$npm_cache"
export PLAYWRIGHT_BROWSERS_PATH="$browser_cache"
unset OPENAI_API_KEY ANTHROPIC_API_KEY AZURE_OPENAI_API_KEY
export DREAMGRAPH_LLM_PROVIDER=none DG_SCHEDULER_ENABLED=false
cd "$task_root"
bash "$task_root/source/scripts/install.sh" --force
node "$DREAMGRAPH_MASTER_DIR/bin/node_modules/playwright-core/cli.js" install chromium --no-shell
node "$task_root/linux-proof.mjs" "$task_root"
cp "$task_root/installation-proof.json" "$proof_output/installation-proof.json"
cp "$task_root/browser-qualification.json" "$proof_output/browser-qualification.json"
`;
await writeFile(join(stage,'linux-proof.mjs'),linuxProof,{flag:'wx'});
await writeFile(join(stage,'linux-runner.sh'),shell,{flag:'wx'});
const npmCache=flags['--npm-cache']||linuxRoot+'/npm-cache',browserCache=flags['--browser-cache']||linuxRoot+'/browsers';
await writeFile(join(output,'run-scope.json'),JSON.stringify({distribution,linux_root:linuxRoot,npm_cache:npmCache,browser_cache:browserCache,
  operation:'install.sh --force against the authorized old Linux test bed; fresh Linux source/dependencies, then installed CLI browser qualification',
  Windows_installation:'untouched',source_files:inventory.length},null,2)+'\n',{flag:'wx'});
try{
  await wsl(['bash',linuxStage+'/linux-runner.sh',linuxRoot,linuxStage,linuxOutput,npmCache,browserCache],{log:'installer-browser.log',timeout:20*60*1000});
  const proof=JSON.parse(await readFile(join(output,'installation-proof.json'),'utf8'));
  console.log(JSON.stringify({output,version:proof.version,node:proof.node,browser:proof.browser_version,
    measured_checks:proof.cli_output.measured_checks,stop_release_ms:proof.cli_output.stop_release_ms,
    control_loss_stop_ms:proof.cli_output.control_loss_stop_ms,model_requests:0,scope:proof.support_scope},null,2));
}catch(error){await writeFile(join(output,'failure.json'),JSON.stringify({recorded_at:new Date().toISOString(),error:String(error),
  Linux_test_bed:'An attempted real installer may have updated it; inspect the retained phase log.',
  Windows_installation:'untouched',linux_root:linuxRoot},null,2)+'\n',{flag:'wx'});throw error;}
