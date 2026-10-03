/** Explicit isolated benchmark operator. Preview/init/inspect never dispatch a model. */
import {randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir,lstat,realpath,open} from 'node:fs/promises';
import {dirname,isAbsolute,relative,resolve,sep} from 'node:path';
import {userInfo} from 'node:os';
import {withDataDirectory} from '../dist/utils/paths.js';
import {releaseGraphWriter} from '../dist/graph/writer-lease.js';
import {EngineJobs} from '../dist/cognitive/jobs.js';
import {previewCompletionPair,evaluateAuthorizedCompletionPair} from '../dist/evaluation/agent-usefulness.js';
const help=`
Read-only matched answer collection (separate from whole Ashoka usefulness acceptance)

  node scripts/collect-agent-pair.mjs init --ledger-dir <new-directory>
  node scripts/collect-agent-pair.mjs preview --ledger-dir <directory> --spec <json> --out <new-json>
  node scripts/collect-agent-pair.mjs collect --ledger-dir <same-directory> --spec <same-json> --approval <json> --out <new-json>
  node scripts/collect-agent-pair.mjs inspect --ledger-dir <directory> --job <original-id> --out <new-json>

init creates an isolated per-instance benchmark ledger; it grants no paid allocation.
preview writes only the bounded disclosure summary. Review the exact specification,
source/graph contexts, provider/model/API, retention, prices and run/day ceilings.
collect requires that digest and the original local operator/expiry in --approval.
Set only the specification's named credential in the environment. Never paste it
into a JSON file. Whole task/mutation/tool claims and understanding remain unreviewed.
inspect reads retained original job/partial answers without redispatch or repair.
Daily caps apply to this fixed ledger, not every account/instance or a new ledger.
Existing output files and ordinary DreamGraph/live data directories are refused.
Ctrl+C propagates to the provider; aborted waiting does not confirm provider stop.
`;
const arguments_=process.argv.slice(2),command=arguments_.shift(),flags={};
if(!command||command==='--help'){console.log(help);process.exit(0);}
if(!['init','preview','collect','inspect'].includes(command))throw new Error('Use --help for the supported commands.');
for(let i=0;i<arguments_.length;i+=2){const key=arguments_[i],value=arguments_[i+1];
 if(!['--ledger-dir','--spec','--approval','--out','--job'].includes(key)||!value||value.startsWith('--')||flags[key])throw new Error('EVALUATION_EXPLICIT_ARGUMENTS_REQUIRED');flags[key]=value;}
const required=name=>{if(!flags[name])throw new Error(name+' is required');return flags[name];};
const directory=resolve(required('--ledger-dir')),marker='readonly-evaluation-ledger.json';
const readJson=async path=>{const file=await lstat(path);if(!file.isFile()||file.isSymbolicLink()||file.size>8*1024*1024)throw new Error('EVALUATION_REGULAR_BOUNDED_JSON_REQUIRED');
 return JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));};
if(command==='init'){
 if(Object.keys(flags).length!==1)throw new Error('init accepts only --ledger-dir');
 await mkdir(directory,{mode:0o700});const physical=await realpath(directory),value={schema:'dreamgraph.readonly_evaluation_ledger.v1',id:randomUUID(),directory:physical,operator:userInfo().username,created_at:new Date().toISOString()};
 await writeFile(resolve(directory,marker),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({ledger_dir:physical,operator:value.operator,model_requests:0,paid_allocation:false}));process.exit(0);
}
const physical=await realpath(directory),definition=await readJson(resolve(physical,marker));
if(definition.schema!=='dreamgraph.readonly_evaluation_ledger.v1'||definition.directory!==physical||definition.operator!==userInfo().username)throw new Error('EVALUATION_ORIGINAL_ISOLATED_LEDGER_REQUIRED');
// An evaluation marker cannot turn existing project stores into a test ledger.
for(const file of ['instance.json','features.json','plan_state.json','role_profiles.json','scan_state.json']){
 try{await lstat(resolve(physical,file));throw new Error('EVALUATION_LIVE_GRAPH_REFUSED');}catch(error){if(error.code!=='ENOENT')throw error;}
}
const output=resolve(required('--out')),parent=await realpath(dirname(output)),relation=relative(physical,resolve(parent,output.split(/[\\/]/).at(-1)));
if(!relation||relation!=='..'&&!relation.startsWith('..'+sep)&&!isAbsolute(relation))throw new Error('EVALUATION_OUTPUT_OUTSIDE_LEDGER_REQUIRED');
// Reserve the output before dispatch; never spend only to discover that an earlier result would be overwritten.
const file=await open(output,'wx',0o600),controller=new AbortController(),cancel=()=>controller.abort(new Error('EVALUATION_OPERATOR_CANCELLED'));
process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
// No installed instance UUID or ambient engine price can retarget the isolated ledger.
delete process.env.DREAMGRAPH_INSTANCE_UUID;
try{await withDataDirectory(physical,async()=>{
 let result;
 if(command==='inspect'){
  if(flags['--spec']||flags['--approval'])throw new Error('inspect accepts only --ledger-dir/--job/--out');
  const jobs=new EngineJobs(),id=required('--job'),row=(await jobs.inspect()).records.find(value=>value.job.id===id&&value.job.owner===definition.operator);
  if(!row)throw new Error('EVALUATION_ORIGINAL_JOB_UNAVAILABLE');
  result={schema:'dreamgraph.completion_pair_inspection.v1',job:row.job,error:row.error,work_settled:row.work_settled,result:await jobs.readResultArtifact(id),model_requests:0};
 }else{
  if(flags['--job'])throw new Error('Use inspect for an original job.');
  const spec=await readJson(resolve(required('--spec'))),preview=previewCompletionPair(spec);
  if(command==='preview'){
   if(flags['--approval'])throw new Error('preview cannot approve or collect');
   result={schema:preview.schema,digest:preview.digest,ledger:preview.ledger,operator:definition.operator,task:{id:spec.task.id,project:spec.task.project,prompt:spec.task.prompt},
    execution:spec.execution,endpoint:spec.endpoint,credential_reference:spec.api_key_env,pricing:spec.pricing,budget:spec.budget,retention:preview.policy.policy.retention,
    policy_fingerprint:preview.policy.fingerprint,arms:spec.arms.map(arm=>({arm:arm.arm,source_manifest_hash:arm.source_manifest_hash,context_bytes:arm.context_bytes,construction_ms:arm.construction_ms})),
    local_results:spec.local_results,scope:spec.scope,limitations:preview.limitations,model_requests:0,
    approval_template:{digest:preview.digest,principal:definition.operator,expires_at:'REPLACE_WITH_EXPLICIT_FUTURE_UTC_EXPIRY'}};
  }else{
   const approval=await readJson(resolve(required('--approval')));if(approval.principal!==definition.operator)throw new Error('EVALUATION_ORIGINAL_OPERATOR_REQUIRED');
   result=await evaluateAuthorizedCompletionPair({specification:spec,approval,signal:controller.signal});
  }
 }
 controller.signal.throwIfAborted();await file.writeFile(JSON.stringify(result,null,2)+'\n');await file.datasync();
 console.log(JSON.stringify({output,schema:result.schema,job_id:result.job_id??result.job?.id??null,assessment_status:result.assessment_status??null,
  model_requests:result.model_requests??null,note:command==='collect'?'Collected actual answers; independent task/understanding review remains required.':'No provider dispatch.'}));
});}catch(error){
 await file.writeFile(JSON.stringify({schema:'dreamgraph.completion_pair_collection_failure.v1',command,reason:'EVALUATION_COLLECTION_FAILED',
  note:'Inspect the original isolated ledger for known partial answers, charges and recovery. This failure does not attest work termination or zero usage.'})+'\n').catch(()=>{});throw error;
}finally{process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);await file.close();await releaseGraphWriter(physical);}
