/** Execute the maintainer-authorized small pilot through the existing admitted collector. */
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {parseEngineEnvDocument} from '../../dist/config/engine-env-document.js';
const directory=resolve(process.argv[2]);assert(process.argv[2]);
const read=async file=>JSON.parse((await readFile(join(directory,file),'utf8')).replace(/^\uFEFF/,''));
const hash=value=>'sha256:'+createHash('sha256').update(value).digest('hex');
const manifest=await read('manifest.json');assert.equal(manifest.runs.length,14);assert.equal(manifest.paid_calls_max,28);
assert.equal(manifest.shared_day_cap_usd,2.5);assert.equal(manifest.model,'gpt-4.1-2025-04-14');
const ledger=join(directory,'ledger');
const childEnv=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('DREAMGRAPH_')&&!key.startsWith('DG_')&&!/API_KEY|ACCESS_TOKEN|AUTH_TOKEN|SECRET/i.test(key)));
async function cli(args,env=childEnv){
 return new Promise((done,reject)=>{const child=spawn(process.execPath,['scripts/collect-agent-pair.mjs',...args],{cwd:resolve('.'),env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let text='';child.stdout.on('data',chunk=>text+=chunk);child.stderr.on('data',chunk=>text+=chunk);
  child.on('error',reject);child.on('close',code=>code===0?done(text):reject(new Error('Collector failed '+code+': '+text.slice(-6000))));});
}
await cli(['init','--ledger-dir',ledger]);
const reviewed=[];
for(const run of manifest.runs){
 assert(!run.file.includes('/')&&!run.file.includes('\\'));
 const spec=await read(run.file);assert.equal(hash(JSON.stringify(spec)),run.sha256);
 assert.equal(spec.budget.day_amount,2.5);assert.equal(spec.budget.run_amount,.16);assert.equal(spec.budget.retries,0);
 const previewFile=run.file.replace('.json','.preview.json');
 await cli(['preview','--ledger-dir',ledger,'--spec',join(directory,run.file),'--out',join(directory,previewFile)]);
 const preview=await read(previewFile),approvalFile=run.file.replace('.json','.approval.json');
 const approval={...preview.approval_template,expires_at:new Date(Date.now()+4*60*60*1000).toISOString()};
 await writeFile(join(directory,approvalFile),JSON.stringify(approval,null,2)+'\n',{flag:'wx',mode:0o600});
 reviewed.push({...run,previewFile,approvalFile});
}
await writeFile(join(directory,'authorization.json'),JSON.stringify({recorded_at:new Date().toISOString(),
 human_direction:'Actually if the workload is reasonable, run them.',
 delegation:'Executing agent selected and reviewed this bounded 28-call workload; disclosed pinned GPT-4.1, Responses/store:false, $2.24 maximum reservations and shared $2.50 ceiling before dispatch.',
 data:'Frozen source excerpts and disposable contract inputs; two bounded read-only existing project graph contexts; no credentials/configuration contents.',
 original_specifications:reviewed.map(run=>({file:run.file,sha256:run.sha256,preview:run.previewFile})),
 no_retry:true,no_escalation:true},null,2)+'\n',{flag:'wx',mode:0o600});
// The named existing provider credential is read only after the whole finite workload has validated.
const values=parseEngineEnvDocument(await readFile('C:/Users/Mika Jussila/.dreamgraph/ee9ce3b9-0313-4768-b5f1-24b9b3fffc4b/config/engine.env','utf8'));
assert.equal(values.DREAMGRAPH_LLM_PROVIDER,'openai');
const key=values.DREAMGRAPH_LLM_API_KEY;assert(key,'Existing named OpenAI credential required');
const results=[];
try{
 for(const run of reviewed){
  console.log('Collecting '+run.task_id);
  const resultFile=run.file.replace('.json','.answers.json');
  await cli(['collect','--ledger-dir',ledger,'--spec',join(directory,run.file),'--approval',join(directory,run.approvalFile),'--out',join(directory,resultFile)],{...childEnv,ASHOKA_EVALUATION_API_KEY:key});
  const result=await read(resultFile);assert.equal(result.kind,'real_model');assert.equal(result.results.length,2);
  results.push({task_id:run.task_id,result_file:resultFile,job_id:result.job_id,answer_hashes:result.results.map(row=>row.answer_hash)});
  console.log('Completed '+run.task_id);
 }
}finally{
 await writeFile(join(directory,'collection-status.json'),JSON.stringify({recorded_at:new Date().toISOString(),completed:results,
  status:results.length===14?'collected_review_pending':'partial_original_ledger_required',no_automatic_retry:true},null,2)+'\n',{flag:'wx',mode:0o600});
}
