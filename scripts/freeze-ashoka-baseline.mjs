/** Freeze source-reviewed task labels before retrieval/model tuning. Never calls a provider. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {STORE_REGISTRY} from '../src/graph/store-registry.ts';
import {CANONICAL_CONTRACTS} from '../src/graph/contracts.ts';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const destination=path.join(root,'tests/fixtures/ashoka/baseline.json');
const hash=value=>createHash('sha256').update(value).digest('hex');
const amend=process.argv.includes('--amend-initial-review')||process.argv.includes('--amend-review');
const reasonIndex=process.argv.indexOf('--reason');
const amendmentReason=reasonIndex<0?null:process.argv[reasonIndex+1];
if(amend&&!amendmentReason)throw Error('A reviewed amendment requires --reason and preserves the preceding artifact.');
if(!process.argv.includes('--freeze')&&!amend){
 const baseline=JSON.parse(await fs.readFile(destination,'utf8'));
 if(baseline.owners.length!==29||baseline.cases.length!==12)throw Error('Incomplete Ashoka foundation inventory');
 if(new Set(baseline.cases.map(c=>c.id)).size!==12)throw Error('Duplicate task identity');
 for(const item of baseline.evidence){if(hash(item.excerpt)!==item.excerpt_sha256)throw Error('Frozen evidence changed: '+item.id);}
 for(const owner of baseline.owners){for(const anchor of owner.anchors)await fs.access(path.join(root,anchor));}
 for(const name of Object.keys(CANONICAL_CONTRACTS))if(!baseline.contracts.includes(name))throw Error('Contract added without a reviewed baseline amendment: '+name);
 if(baseline.contract_source_sha256!==hash(await fs.readFile(path.join(root,'src/graph/contracts.ts'))))throw Error('Canonical schema changed without a reviewed baseline amendment.');
 console.log(JSON.stringify({status:'verified',owners:29,cases:12,evidence:baseline.evidence.length,sha256:hash(await fs.readFile(destination))}));
 process.exit(0);
}
let previous_sha256=null;
let previousRevision=0;
let reviewedPrevious=null;
const carryReviewed=process.argv.includes('--carry-reviewed-evidence');
if(carryReviewed&&!amend)throw Error('Carrying frozen evidence requires an explicit reviewed amendment.');
try{
 const previous=await fs.readFile(destination);
 if(!amend)throw Error('Baseline already frozen. Preserve it and record an explicit reviewed amendment rather than overwriting it.');
 previous_sha256=hash(previous);
 reviewedPrevious=JSON.parse(previous);
 previousRevision=reviewedPrevious.revision;
 const archive=path.join(root,'docs/ashoka/baselines',previous_sha256+'.json');
 await fs.mkdir(path.dirname(archive),{recursive:true});
 try{await fs.writeFile(archive,previous,{flag:'wx'});}catch(error){if(error.code!=='EEXIST'||hash(await fs.readFile(archive))!==previous_sha256)throw error;}
}catch(error){if(error.code!=='ENOENT')throw error;}
const alignment=await fs.readFile(path.join(root,'docs/audits/2026-09-30-coverage/subsystem-alignment.md'),'utf8');
const owners=[];
for(const line of alignment.split('\n').filter(line=>line.startsWith('| ')&&line.includes('](../../../'))){
 const cells=line.split('|').slice(1,-1).map(c=>c.trim());
 if(cells.length!==5)continue;
 const anchors=[...cells[1].matchAll(/\]\(\.\.\/\.\.\/\.\.\/([^)]*)\)/g)].map(m=>m[1]);
 owners.push({family:cells[0],semantic_owner:'core/daemon contract maintainer',implementation_owner:`${cells[0]} module maintainer`,accountable:'project maintainer',executor:'GPT-6.1 Sol',anchors,producer_consumer_obligation:cells[2],integration_check:cells[3],foundation_review:'source-reviewed under the user-approved revision-7 implementation scope',integration_status:'pending'});
}
if(owners.length!==29)throw Error('Expected 29 subsystem owners, found '+owners.length);
const projects={dreamgraph:root,'web64-react':process.env.ASHOKA_WEB64_FIXTURE_ROOT||path.resolve(root,'../vice-3.10/build/web/react')};
const anchors={
 dreamgraph:[
  ['dg-scan','src/tools/scan-project.ts','export async function runScanProject',36],
  ['dg-rag','src/cognitive/graph-rag.ts','export async function',32],
  ['dg-scheduler','src/cognitive/scheduler.ts','export async function runScheduleNow',70],
  ['dg-evidence','src/cognitive/evidence-ledger.ts','export function buildCandidateEvidenceLedger',65],
 ],
 'web64-react':[
  ['web-compiler','src/web64-ide/compiler.mjs','export function compileWeb64IdeProject',38],
  ['web-handoff','src/web64-ide/runtime-handoff.mjs','export async function handoffProgram',30],
  ['web-speed','src/web64-emulator-speed.mjs','export const WEB64_EMULATOR_SPEED_MULTIPLIERS',10],
  ['web-compile-worker','src/web64-compile.worker.mjs','self.onmessage',25],
 ],
};
const evidence=[];
for(const [project,items]of (carryReviewed?[]:Object.entries(anchors)))for(const [id,file,anchor,span]of items){
 const source=await fs.readFile(path.join(projects[project],file),'utf8'), lines=source.split(/\r?\n/);
 const offset=lines.findIndex(line=>line.includes(anchor));
 if(offset<0)throw Error('Missing reviewed source anchor '+id);
 const excerpt=lines.slice(offset,offset+span).join('\n');
 evidence.push({id,project,file,semantic_anchor:anchor,line:offset+1,source_sha256:hash(source),excerpt,excerpt_sha256:hash(excerpt),origin:'source',review:'executor source review; no model-generated corroboration'});
}
const tasks=[
 ['AT01','Recover the governed current slice, a blocker and the next eligible slice from a revisioned test plan; ignore another session selection.',[],['authoritative_plan_id','current_slice_id','blocker','last_verified_checkpoint','resume_reason'],['completion inferred from prose','pending first slice reported as running','another session selection used as authority']],
 ['AT02','Explain the project architecture boundary with provenance.',null,['required_source_anchors','correct_boundary','unsupported_parts_disclosed'],['wrong source attribution','unsupported architecture relationship']],
 ['AT03','Classify a mixed graph containing a source assertion, human assertion, dream, validated insight, decision and tension.',[],['origin_classification','confidence_not_independent_evidence','shared_ancestry','contradiction'],['hypothesis promoted by confidence','tension called a proven defect','circulated evidence counted twice']],
 ['AT04','Retrieve one precise subsystem amid UI/build/dense graph distractors.',null,['required_source_anchors','scope','within_budget','omissions'],['mandatory anchor lost','false completeness','relevant evidence buried in noise']],
 ['AT05','Apply an authorized mutation to disposable state, lose the reply, retry, conflict and read back.',[],['durable_receipt','same_revision_readback','single_effect','stale_write_rejected','recoverable_interruption'],['success before commit','duplicate effect','unrelated state overwritten']],
 ['AT06','Use incomplete or changed evidence; distinguish an old full scan from a concrete scope gap.',[],['scoped_limit','no_age_only_staleness','unknown_is_unknown','justified_abstention','recovery'],['bluffing','old scan equated with stale graph','recent unrelated dream hides source gap']],
];
const cases=[];
for(const project of Object.keys(projects))for(const [family,prompt,refs,required,forbidden]of tasks){
 const chosen=refs??(family==='AT02'?(project==='dreamgraph'?['dg-scan','dg-rag']:['web-compiler','web-handoff']):(project==='dreamgraph'?['dg-scheduler']:['web-speed']));
 cases.push({id:`${project}:${family}`,family,project,prompt:family==='AT02'?(project==='dreamgraph'?'Explain scan-to-publication-to-agent retrieval, distinguishing scan and graph revisions.':'Explain the Web64 compiler/runtime boundary: compileWeb64IdeProject produces program artifacts; handoffProgram passes program bytes to runtime.loadMedia after readiness.'):family==='AT04'?(project==='dreamgraph'?'Retrieve DreamGraph schedule dispatch/ownership without dashboard styling noise.':'Retrieve Web64 emulator speed policy without compiler or color-picker noise.'):prompt,mandatory_evidence_ids:chosen,required_outcomes:required,forbidden_assertions:forbidden,fixture_kind:chosen.length?'source-reviewed project task':'disposable contract state',rubric_version:'ashoka.tasks.v1',execution_status:'not_run'});
}
const formats=[];
for(const [file,definition]of Object.entries(STORE_REGISTRY)){
 let actual=null;
 try{const data=JSON.parse(await fs.readFile(path.join(root,'templates/default',file),'utf8'));actual=data.schema_version??data.metadata?.schema_version??null;}
 catch(error){if(error.code!=='ENOENT')throw error;}
 formats.push({file,...definition,template_declared_version:actual,legacy_classification:actual?'explicit version; family-specific adapter':'unversioned/unknown; known legacy shape adapter only, no invented historical major',writes:'canonical publication boundary; original physical encoding retained until migration'});
}
formats.push(
 {file:'publication_state.json',domain:'publication',graph:false,schema_major:1,declared_schema:'dreamgraph.publication.v1',owner:'core/daemon publication authority',writes:'internal only; final durable publication participant; receipt and outbox share the commit'},
 {file:'reconciliation_journal.json',domain:'publication',graph:false,schema_major:2,declared_schema:'dreamgraph.reconciliation_journal.v2',previous_schema:'dreamgraph.reconciliation_journal.v1',owner:'core/daemon recovery authority',writes:'internal only; v2 receipt determines rollback/roll-forward; v1 retains rollback semantics'}
);
for(const task of cases){
 const project=task.project;
 const plan_id=`fixture:${project}:plan`, slice=id=>`${plan_id}:${id}`;
 if(task.family==='AT01'){
  task.input={plan:{id:plan_id,revision:3,lifecycle:'implementing',current_slice_ids:[slice('blocked')],running_slice_ids:[],last_verified_slice_id:slice('done'),slices:[{id:slice('done'),status:'verified',depends_on:[],evidence_ids:['checkpoint:done'],blockers:[]},{id:slice('blocked'),status:'blocked',depends_on:[slice('done')],evidence_ids:[],blockers:['required source unavailable']},{id:slice('dependent'),status:'pending',depends_on:[slice('blocked')],evidence_ids:[],blockers:[]},{id:slice('independent'),status:'pending',depends_on:[slice('done')],evidence_ids:[],blockers:[]}]},other_session_selection:slice('dependent'),historical_checkpoint:{slice_id:slice('done'),status:'verified'}};
  task.expected={plan_id,current_slice_ids:[slice('blocked')],running_slice_ids:[],next_slice_ids:[slice('independent')],last_verified_slice_id:slice('done'),preserved_blocker:'required source unavailable'};
 }else if(task.family==='AT03'){
  task.input={records:[{id:'source',source_repo:project,source_files:['fixture/source.ts'],source_verified:false,confidence:1},{id:'human',origin:'lucid',confidence:1},{id:'dream',origin:'rem',confidence:1,inspiration:['source']},{id:'validated',kind:'validated',evidence_ancestry:['source'],confidence:0.9},{id:'decision',kind:'adr',decided_by:'human'},{id:'tension',kind:'tension',description:'Possible contradiction',entities:['source','dream']}],independent_source_groups:[['source','dream','validated']]};
  task.expected={class_by_id:{source:'source_assertion',human:'human_assertion',dream:'hypothesis',validated:'validated_insight',decision:'decision',tension:'tension'},independent_source_count:1,proven_defect:false};
 }else if(task.family==='AT05'){
  task.input={instance_id:`fixture:${project}`,actor:'fixture:authorized-agent',operation_id:'fixture:mutation:1',before:{features:[]},requested_delta:{features:[{id:'fixture:added',source_repo:project,source_files:['fixture/source.ts']}]},interruptions:['before_publication','after_publication_reply_lost'],retry_same_payload:true,conflicting_payload:{features:[]}};
  task.expected={before_publication:'rolled_back',after_publication:'committed',retry:'same_receipt',conflicting_payload:'identity_conflict',effect_count:1};
 }else if(task.family==='AT06'){
  task.input={last_full_scan_at:'2001-01-01T00:00:00Z',managed_source_revision:'source:3',covered_scope:['fixture/source.ts'],concrete_gap:{path:'fixture/other.ts',expected_hash:'sha256:before',observed_hash:'sha256:after'},unrelated_recent_dream:{scope:['fixture/unrelated.ts'],graph_revision:'graph:4'},unavailable_source:'fixture/missing.ts'};
  task.expected={covered_scope_freshness:'current',changed_scope_freshness:'stale',unavailable_source_freshness:'unknown',age_only_warning:false,unrelated_dream_closes_gap:false};
 }else{
  task.input={query:task.prompt,required_evidence_ids:task.mandatory_evidence_ids,token_budgets:[100,500,2000],distractors:{count:300,prefix:`fixture:${project}:unrelated:`,description:'Unrelated UI styling and build configuration.'}};
  task.expected={mandatory_anchors:task.mandatory_evidence_ids,if_evidence_cannot_fit:'explicit_insufficiency_or_continuation',unsupported_claim_count:0};
 }
}
if(carryReviewed&&!reviewedPrevious)throw Error('No preceding reviewed baseline to preserve.');
const baseline={schema:'dreamgraph.ashoka_foundation.v1',revision:previousRevision+1,previous_sha256,amendment:amendmentReason,plan_id:'graph-trust-and-agent-effectiveness',plan_revision:7,date:'2026-09-30',authorization:'Implement the Ashoka; human owner, 2026-09-30',source_commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),contract_source_sha256:hash(await fs.readFile(path.join(root,'src/graph/contracts.ts'))),contracts:Object.keys(CANONICAL_CONTRACTS),owners:carryReviewed?reviewedPrevious.owners:owners,formats,cases:carryReviewed?reviewedPrevious.cases:cases,evidence:carryReviewed?reviewedPrevious.evidence:evidence,
 preserved_reviewed_evidence:carryReviewed,
 invariants:['core/daemon owns canonical semantics','current and previous schema major; product version independent','unknown legacy provenance/time remains unknown','old full scan does not imply stale graph','managed changes publish source reconciliation and receipts','no API continuation assumptions in CLI contracts','no provider/model/host fallback without explicit policy','no paid CI or model call without allocated finite run/day budget'],
 tolerances:{mandatory_evidence_failures:0,unsupported_truth_claims:0,token_budget_overflow:0,duplicate_mutation_effects:0,cross_session_disclosures:0,default_paid_calls:0,paired_task_rubric:'All mandatory outcomes pass independently. Score architecture/history understanding, provenance, contradictions and justified abstention on the same cases; established-instance material gain requires a reviewed improvement in at least one substantive category in each project and no mandatory regression. Baseline timings and acceptance latency bounds are recorded in Slice 4 before index tuning; no invented p50/p95 or model superiority.'},
 adr_applicability_source:'docs/audits/2026-09-30-coverage/execution-adr-evidence.json',adr_disposition:'Existing accepted decisions remain unchanged. Review scoped amendments in their owning slice before changed promotion/routing/lifecycle policy activates; ADR-240 API/CLI separation remains binding.',production_qualification:'pending; foundation fixtures do not qualify clients, live migrations, paid providers or native computer workers'};
await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,JSON.stringify(baseline,null,2)+'\n');
console.log(JSON.stringify({status:'frozen',owners:baseline.owners.length,cases:baseline.cases.length,evidence:baseline.evidence.length,sha256:hash(await fs.readFile(destination))}));
