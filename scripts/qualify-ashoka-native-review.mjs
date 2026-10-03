/** Real compiled authority attached read-only to the source worktree; disposable review storage. */
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {createInstance} from '../dist/instance/lifecycle.js';
const root=resolve('.'),helper=resolve(process.argv[2]||'docs/ashoka/native-review-23.mjs');
if(!helper.startsWith(root+sep)||!/^native-review-\d+(?:-health|-editor|-wsl|-recovery|-cli|-provider|-evidence|-clock|-pass|-closure)?\.mjs$/.test(helper.split(/[\\/]/).at(-1)))throw Error('Only a workspace bounded review helper is permitted.');
const directory=await mkdtemp(join(tmpdir(),'dg-source-review-'));
if(!resolve(directory).startsWith(resolve(tmpdir())+sep)||!directory.includes('dg-source-review-'))throw Error('Temporary scope escaped.');
let daemon;
try{
 const master=join(directory,'master'),{scope,instance}=await createInstance({name:'ashoka-bounded-source-review',projectRoot:root,masterDir:master,repos:{dreamgraph:root}});
 // Existing reviewed decisions are source material, never rewritten in the installed graph.
 const adr=await readFile('C:/Users/Mika Jussila/.dreamgraph/ee9ce3b9-0313-4768-b5f1-24b9b3fffc4b/data/adr_log.json');await writeFile(join(scope.dataDir,'adr_log.json'),adr);
 const values={DREAMGRAPH_LLM_PROVIDER:'none',DG_SCHEDULER_ENABLED:'false',DREAMGRAPH_EVENTS:'{"max_auto_cycles_per_hour":0}',DREAMGRAPH_NARRATIVE:'{"auto_narrate":false}',DREAMGRAPH_REPOS:JSON.stringify({dreamgraph:root})};
 for(const role of ['INITIAL_SCAN','ENRICHMENT','DREAMER','NORMALIZER','ARCHITECT','COMPUTER_USE'])for(const suffix of ['RUN_BUDGET','DAY_BUDGET','MAX_CALLS'])values['DREAMGRAPH_LLM_'+role+'_'+suffix]='0';
 await writeFile(scope.engineEnvPath,Object.entries(values).map(([key,value])=>key+'='+value).join('\n')+'\n');
 const reservation=createServer();await new Promise(done=>reservation.listen(0,'127.0.0.1',done));const port=reservation.address().port;await new Promise(done=>reservation.close(done));
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('DREAMGRAPH_')&&!key.startsWith('DG_')&&key!=='DATABASE_URL'&&!/API_KEY|ACCESS_TOKEN|BEARER|SECRET|CREDENTIAL/i.test(key)));
 Object.assign(env,{DREAMGRAPH_INSTANCE_UUID:instance.uuid,DREAMGRAPH_MASTER_DIR:master,DREAMGRAPH_DATA_DIR:scope.dataDir});
 daemon=spawn(process.execPath,[join(root,'dist/index.js'),'--transport','http','--port',String(port)],{cwd:directory,env,stdio:['ignore','pipe','pipe'],windowsHide:true});
 let stderr='';await new Promise((done,reject)=>{const timer=setTimeout(()=>reject(Error('Bounded authority startup: '+stderr)),30000);daemon.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-16000);if(String(chunk).includes('Server running on')){clearTimeout(timer);done();}});daemon.once('error',reject);daemon.once('exit',code=>{clearTimeout(timer);reject(Error('Bounded authority exited '+code+': '+stderr));});});
 Object.assign(env,{ASHOKA_REVIEW_ENDPOINT:'http://127.0.0.1:'+port+'/mcp',ASHOKA_REVIEW_DATA_DIR:scope.dataDir,ASHOKA_REVIEW_SCOPE:'Actual compiled disposable DreamGraph authority attached to the real source worktree; installed own-instance unavailable and unchanged. Reviewed ADR bytes copied read-only.'});
 const review=spawn(process.execPath,[helper],{cwd:root,env,stdio:'inherit',windowsHide:true});const [code]=await once(review,'exit');if(code!==0)throw Error('Bounded review helper failed: '+code);
}finally{if(daemon&&daemon.exitCode===null&&daemon.signalCode===null){const exited=once(daemon,'exit');daemon.kill('SIGTERM');await exited;}await rm(directory,{recursive:true,force:true});}
