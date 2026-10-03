/** Publish reviewed benchmark evidence without credentials, approvals, private ledger or live graph contexts. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const directory=resolve(process.argv[2]??'');assert(process.argv[2],'Original private collection directory required');
const output='docs/ashoka/benchmarks/2026-10-03-gpt-4.1';
const hash=value=>createHash('sha256').update(value).digest('hex');
const read=async path=>JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));
const manifest=await read(join(directory,'manifest.json')),collection=await read(join(directory,'collection-status.json'));
assert.equal(collection.status,'collected_review_pending');assert.equal(collection.completed.length,14);
const protocol=await read('docs/ashoka/agent-evaluation-protocol.json');
assert.equal('sha256:'+hash(await readFile('docs/ashoka/agent-evaluation-protocol.json')),manifest.source_protocol_sha256);
const reviews={
 AT01:{mandatory_pass:false,disposition:'partial',finding:'Both arms recover the blocked current slice, blocker and eligible independent slice. Neither gives all required authoritative plan/checkpoint/resume fields explicitly. Identical inputs are controls, not a graph benefit.'},
 AT03:{mandatory_pass:false,disposition:'failed',finding:'Replies blur recorded assertion/validated-insight labels with factual truth and do not establish the one independent source root. Confidence and shared ancestry do not justify promotion. The Web64 assisted reply correctly calls the dream a hypothesis, but the complete mandatory rubric is not satisfied.'},
 AT05:{mandatory_pass:false,disposition:'not_an_execution_test',finding:'Read-only completions receive a proposed interruption scenario, no mutation tools or actual receipt. Replies narrate attempted operations/readbacks that were never performed; some claim the conflicting payload is the observed final state. No durable effect, same-revision readback or recovery is proven. Actual core mutation tests remain separate.'},
 AT06:{mandatory_pass:false,disposition:'failed',finding:'Both arms identify the concrete hash mismatch and missing source, but still describe covered evidence as outdated/stale based on the old scan. This violates the no-age-only-staleness outcome; unrelated dreams do not repair the gap.'},
};
const rows=[];let input=0,outputTokens=0,cached=0,elapsed=0,calls=0;
await mkdir('docs/ashoka/benchmarks',{recursive:true});
await mkdir(output,{recursive:false});await mkdir(join(output,'requests'));
for(const [index,run] of manifest.runs.entries()){
 const spec=await read(join(directory,run.file));assert.equal('sha256:'+hash(JSON.stringify(spec)),run.sha256);
 const saved=collection.completed.find(row=>row.task_id===run.task_id);assert(saved);
 const answer=await read(join(directory,saved.result_file));assert.equal(answer.kind,'real_model');assert.equal(answer.results.length,2);
 assert.equal(answer.execution.model,'gpt-4.1-2025-04-14');assert.equal(answer.scope,'read_only_supplied_context_completion');
 const family=run.task_id.split(':')[1],frozen=family!=='GE16-pilot';
 let review=reviews[family];
 if(family==='AT02')review=run.task_id.startsWith('dreamgraph:')
  ?{mandatory_pass:false,disposition:'partial',finding:'Both cite the scan and retrieval source anchors and acknowledge missing publication code, but then present inferred publication/scan semantics as fact. The assisted answer overstates scans as unversioned/uncommitted and publication as scan-derived. No zero-unsupported-claim pass.'}
  :{mandatory_pass:true,disposition:'passed_for_supplied_excerpt',finding:'Both identify compileWeb64IdeProject artifact production, handoffProgram readiness and runtime.loadMedia, with source attribution and missing runtime/artifact internals disclosed. No material difference established.'};
 if(family==='AT04')review={mandatory_pass:true,disposition:'passed_for_supplied_excerpt',finding:run.task_id.startsWith('dreamgraph:')
  ?'Both locate the frozen scheduler excerpt and its file-lock/in-flight/mutex ownership without UI noise. Assisted reply states partial multi-process scope. This describes the frozen historical excerpt, not a current source audit. Both contexts/replies fit their explicit limits.'
  :'Both locate the complete frozen speed-policy excerpt, allowed multipliers, default-to-one and resource conversion, without compiler/color-picker noise. No missing required anchor and both contexts/replies fit their explicit limits.'};
 if(!frozen)review={mandatory_pass:false,disposition:'gain_not_established',finding:run.task_id.startsWith('dreamgraph:')
  ?'Assisted reply retrieves ADR-036 but extrapolates its title into scan/publication guarantees absent from supplied evidence. Both replies overstate scan side effects. More history was retrieved; improved understanding/decision is not established.'
  :'Assisted reply retrieves the recorded declarative build-target ADR-009 and gives a relevant next-change constraint. It also invents atomic/side-effect-free runtime handoff guarantees. Useful extra history does not establish a reliable net understanding gain from this single pair.'};
 assert(review);
 const results=answer.results.map((arm,i)=>{
  assert.equal(hash(JSON.stringify(arm.answer)),arm.answer_hash);assert.equal(arm.answer_hash,saved.answer_hashes[i]);assert.equal(arm.outcome,'completed');assert.equal(arm.calls,1);
  assert.equal(Buffer.byteLength(spec.arms.find(a=>a.arm===arm.arm).context),arm.context_bytes);
  input+=arm.usage.inputTokens;outputTokens+=arm.usage.outputTokens;cached+=arm.usage.cachedInputTokens??0;elapsed+=arm.latency_ms;calls+=arm.calls;
  return {arm:arm.arm,outcome:arm.outcome,context_hash:arm.context_hash,context_bytes:arm.context_bytes,context_tokens:arm.context_tokens,
   context_token_measurement:arm.context_token_measurement,construction_ms:arm.construction_ms,latency_ms:arm.latency_ms,calls:arm.calls,usage:arm.usage,
   answer_hash:arm.answer_hash,...(frozen?{answer:arm.answer}:{answer_withheld:'Established graph context is private; only reviewed finding, hash and resource measurements are published.'}),
   review:{...review,reviewer:'executing_agent',review_method:'Read both original replies against frozen inputs/rubric; not blinded, not an independent paid judge.'}};
 });
 if(frozen){
  assert(protocol.task_labels.some(task=>task.id===run.task_id));
  const publicSpec=structuredClone(spec);publicSpec.api_key_env='DREAMGRAPH_EVALUATION_API_KEY';publicSpec.budget.billing_principal='benchmark-operator';
  const serialized=JSON.stringify(publicSpec,null,2)+'\n';assert(!/sk-(?:proj-)?[A-Za-z0-9_-]{25,}/.test(serialized));
  await writeFile(join(output,'requests',run.file),serialized,{flag:'wx'});
 }
 rows.push({task_id:run.task_id,scope:run.scope,order:answer.order,execution:answer.execution,task_hash:answer.task_hash,
  original_specification_sha256:run.sha256,results,material_understanding_gain:null,
  replay_request:frozen?'requests/'+run.file:null,limitation:run.limitation});
}
assert.equal(calls,28);
const report={schema:'dreamgraph.ashoka.reviewed_pilot.v1',recorded_at:new Date().toISOString(),collected_at:collection.recorded_at,
 status:'completed_with_published_quality_failures',source_protocol:'../../agent-evaluation-protocol.json',source_protocol_sha256:manifest.source_protocol_sha256,
 scope:'Twelve frozen supplied-context task pairs and two private established-graph exploratory pairs, one call per arm. Not autonomous agent execution or a statistical usefulness estimate.',
 environment:{os:process.platform,architecture:process.arch,node:process.versions.node},
 totals:{pairs:14,calls,input_tokens:input,output_tokens:outputTokens,cached_input_tokens:cached,model_latency_ms:elapsed,
  reviewed_tariff_usd_before_cache_discount:(input*2+outputTokens*8)/1e6,day_cap_usd:2.5,maximum_reserved_usd:2.24,retries:0},
 findings:['AT01 omits required status fields.','AT03 blurs trust classes/independence.','AT05 does not execute and invents effects/readbacks.','AT06 contains age-only staleness claims.','DreamGraph AT02 and both GE16 pilot replies contain unsupported boundary guarantees.','Web64 AT02 and the two AT04 pairs meet their narrow supplied-excerpt outcomes.'],
 limitations:['Expected labels and required-outcome checklist were not injected into the task prompt. Eight pairs use identical raw contract controls, not canonical production preambles. They expose model/harness limitations and are not proof that production authority contracts fail.',
  'Four retrieval comparisons use the declared frozen corpus with synthetic distractors. The supplied source excerpts are historical; no fresh current-code understanding claim.',
  'Two established-graph arms add context to the same frozen source; partial/unknown graph state and a single unblinded run cannot establish general gains. No repeat-until-pass, model escalation or label changes.',
  'No source tool use, rereads avoided, governed mutation or continuation is measured by these read-only completions. No general improvement, cost saving or task-success percentage is claimed.',
  'Provider-reported whole-request token usage is separate from UTF-8 context bytes. Local construction duration includes both arms and is not added twice. The tariff estimate is not an invoice.',
  'store:false does not attest account/provider retention. Public fixture answers/requests were reviewed for publication; live graph context, credentials, approvals and original private ledger are excluded.'],
 follow_up:{owner:'Agent evaluation and retrieval maintainers',target:'Post-14.0.0 field-feedback patch',work:'Add task-aligned outcome instructions and canonical trust/currency preambles, richer applicable ADR evidence, tool-enabled AT05 and repeated independently reviewed matched comparisons. Preserve this failed pilot.'},runs:rows};
await writeFile(join(output,'results.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:report.status,pairs:14,calls,estimated_usd:report.totals.reviewed_tariff_usd_before_cache_discount,output}));
