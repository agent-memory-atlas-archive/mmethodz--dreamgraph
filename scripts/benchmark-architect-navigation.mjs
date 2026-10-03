/** Read-only replica of existing plan/publication inputs; no model, daemon control or instance writes. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {performance} from 'node:perf_hooks';
import {withDataDirectory} from '../src/utils/paths.ts';
import {loadPublicationState} from '../src/graph/publication.ts';
import {listPlanFiles,buildPlanSummary,loadPlanDetail} from '../src/architect/plan-registry.ts';
const input=process.env.ASHOKA_NAVIGATION_DATA;
if(!input)throw Error('ASHOKA_NAVIGATION_DATA is required; only a disposable copy is benchmarked.');
const directory=await fs.mkdtemp(path.join(tmpdir(),'dg-navigation-benchmark-'));
try {
  for(const file of ['publication_state.json','plan_state.json','features.json','workflows.json','capabilities.json','data_model.json']) {
    try{await fs.copyFile(path.join(input,file),path.join(directory,file));}catch(e){if(e.code!=='ENOENT')throw e;}
  }
  const result=await withDataDirectory(directory,async()=>{
    const measure=async(fn)=>{const start=performance.now(),result=await fn();return {ms:Math.round((performance.now()-start)*100)/100,result};};
    const metadata=await measure(async()=>{let sequence;for(let i=0;i<12;i++)sequence=(await loadPublicationState()).revision.publication_sequence;return sequence;});
    const names=await listPlanFiles();
    const listing=await measure(async()=>{const summaries=[];for(const name of names)summaries.push(await buildPlanSummary(name));return summaries.length;});
    const selection=await measure(()=>loadPlanDetail('graph-trust-and-agent-effectiveness'));
    return {schema:'dreamgraph.ashoka.navigation_benchmark.v1',observed_at:new Date().toISOString(),input:'read-only copy of publication and plan/catalogue stores; source plan files',publication_bytes:(await fs.stat(path.join(directory,'publication_state.json'))).size,metadata_12_reads_ms:metadata.ms,plan_count:listing.result,plan_list_ms:listing.ms,selected_plan_ms:selection.ms,selected_plan_id:selection.result?.id,scope:'source modules, no running-daemon latency or browser qualification claimed'};
  });
  console.log(JSON.stringify(result,null,2));
} finally {
  if(path.dirname(directory)!==path.resolve(tmpdir())||!path.basename(directory).startsWith('dg-navigation-benchmark-'))throw Error('Unexpected benchmark cleanup scope');
  await fs.rm(directory,{recursive:true,force:true});
}
