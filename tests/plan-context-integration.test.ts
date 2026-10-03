/** Real C14 authority and canonical retrieval; no model answers or completion inferred from prose. */
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {getDataDir,setDataDirOverride} from '../src/utils/paths.js';
import {releaseGraphWriter} from '../src/graph/writer-lease.js';
import {loadCanonicalGraph} from '../src/graph/read-model.js';
import {buildContextPack} from '../src/graph/context-pack.js';
import {importPlanAuthority,readPlanAuthority,applyPlanCommand,bytesHash} from '../src/discipline/plan-authority.js';
import {planDefinitionDigest,type PlanActor} from '../src/discipline/plan-workflow.js';
import {type PlanDefinition} from '../src/graph/contracts.js';
import {commitGraphWrites} from '../src/graph/publication.js';
let directory:string,previous:string,sequence:number;
const now='2026-10-02T00:00:00Z',markdown='# Plan\n\n### Slice 0 - Work\n\n- status: pending\n';
const actor:PlanActor={id:'operator',kind:'operator',instance_id:'plan-context-instance',project_id:'project'};
beforeEach(async()=>{previous=getDataDir();directory=await mkdtemp(join(tmpdir(),'dg-plan-context-'));setDataDirOverride(directory);sequence=0;});
afterEach(async()=>{vi.useRealTimers();await releaseGraphWriter(directory);setDataDirOverride(previous);await rm(directory,{recursive:true,force:true});});
async function imported(id='ashoka',owner=actor){
 const definition:PlanDefinition={id,instance_id:owner.instance_id,project_id:owner.project_id,revision:1,definition_hash:'pending',source_hash:bytesHash(markdown),log_hash:null,title:'Ashoka '+id,phase:null,
  slices:[{id:'slice-0-work',title:'Work',order:0,priority:1,required:true,depends_on:[],acceptance_hash:'acceptance-work'},
   {id:'slice-1-verify',title:'Next work',order:1,priority:1,required:true,depends_on:['slice-0-work'],acceptance_hash:'acceptance-next'}]};
 definition.definition_hash=planDefinitionDigest(definition);
 await importPlanAuthority({actor:owner,definition,markdown,log_markdown:null,review_id:'source-review',operation_id:`import-${++sequence}`,now});
 return definition;
}
async function command(type:unknown,id='ashoka',owner=actor){
 const view=(await readPlanAuthority({id,instance_id:owner.instance_id,project_id:owner.project_id},now))!;
 return applyPlanCommand({actor:owner,plan_id:id,operation_id:`transition-${++sequence}`,expected_revision:view.state.revision,expected_definition_hash:view.state.definition_hash,command:type,now});
}
it('PL16 graph consumers retrieve the actual typed plan and selected slice with the same authority revision and gates',async()=>{
 await imported();await command({type:'review_plan',review_id:'design-review'});await command({type:'approve_scope',approval_id:'scope-review',owner:actor.id,scope:['slice-0-work','slice-1-verify'],parallel_limit:1});await command({type:'start_slice',slice_id:'slice-0-work'});
 const view=(await readPlanAuthority({id:'ashoka',instance_id:actor.instance_id,project_id:actor.project_id},now))!,before=await readFile(join(directory,'plan_state.json'),'utf8');
 const graph=await loadCanonicalGraph(actor.instance_id),plan=graph.entities.find(entity=>entity.identity.kind==='plan'&&entity.identity.id==='ashoka');
 expect(plan,JSON.stringify(graph.state)).toBeDefined();expect(plan!.payload).toMatchObject({source:'typed_plan_authority',revision:view.state.revision,lifecycle:view.state.lifecycle,current_slice_ids:['slice-0-work'],running_slice_ids:[]});
 expect(graph.relationships.filter(relation=>relation.relation==='contains_slice')).toHaveLength(2);expect(graph.relationships.filter(relation=>relation.relation==='contains_slice').every(relation=>relation.assertion_class==='historical')).toBe(true);
 const pack=buildContextPack(graph,{query:'Recover active plan',plan_id:'ashoka',slice_id:'slice-0-work',token_budget:6000,depth:0},new Date(now));
 expect(pack.mandatory_satisfied,JSON.stringify(pack.state)).toBe(true);expect(pack.context_text).toContain('definition_hash');expect(pack.context_text).toContain('resume_current');expect(pack.context_text).toContain('slice-0-work');
 expect(await readFile(join(directory,'plan_state.json'),'utf8')).toBe(before);
});

it('local slice IDs repeating across plans remain distinct, while an unscoped request is explicitly ambiguous',async()=>{
 await imported('one');await imported('two');await imported('foreign',{...actor,instance_id:'foreign-instance'});
 const graph=await loadCanonicalGraph(actor.instance_id),slices=graph.entities.filter(entity=>entity.identity.kind==='slice');
 expect(graph.state.completeness).toBe('complete');expect(slices).toHaveLength(4);expect(new Set(slices.map(entity=>entity.identity.id)).size).toBe(4);
 expect(graph.entities.some(entity=>entity.payload.plan_id==='foreign')).toBe(false);
 const ambiguous=buildContextPack(graph,{query:'Work',slice_id:'slice-0-work',token_budget:6000,depth:0});
 expect(ambiguous.mandatory_satisfied).toBe(false);expect(ambiguous.source_fallback).toContainEqual(expect.objectContaining({reason:'REQUIRED_SLICE_ID_AMBIGUOUS'}));
 const scoped=buildContextPack(graph,{query:'Work',plan_id:'two',slice_id:'slice-0-work',token_budget:6000,depth:0});
 expect(scoped.mandatory_satisfied).toBe(true);const selected=scoped.records.find(record=>record.selection_reason==='selected_slice');
 expect(graph.by_identity.get(selected!.id)!.payload).toMatchObject({plan_id:'two',slice_id:'slice-0-work'});
 expect(JSON.stringify(graph.entities)).not.toContain('log_markdown');expect(JSON.stringify(graph.entities)).not.toContain('backups');
});

it('invalid typed authority removes all its plan and slice projections while preserving an independently valid legacy slice store',async()=>{
 await imported('one');await imported('two');const file=JSON.parse(await readFile(join(directory,'plan_state.json'),'utf8'));
 const second=Object.values(file.records)[1] as any;second.state.instance_id='forged-owner';
 await commitGraphWrites({actor:'declared-corrupt-fixture',scope:['plan_state.json'],writes:[{file:'plan_state.json',content:JSON.stringify(file)},{file:'slice_state.json',content:JSON.stringify({slices:[{id:'legacy',plan_id:'legacy-plan',status:'unknown'}]})}]});
 const graph=await loadCanonicalGraph(actor.instance_id);expect(graph.state.completeness).toBe('partial');
 expect(graph.state.reasons).toContainEqual(expect.objectContaining({code:'PLAN_AUTHORITY_SCOPE_CORRUPT',scope:['plan_state.json']}));
 expect(graph.entities).toHaveLength(1);expect(graph.entities[0]).toMatchObject({identity:{kind:'slice',id:'legacy'},payload:{status:'unknown'}});
 await expect(readPlanAuthority({id:'one',instance_id:actor.instance_id,project_id:actor.project_id})).rejects.toThrow('PLAN_AUTHORITY_SCOPE_CORRUPT');
});

it('colliding plan IDs in separate projects cannot select one authority by insertion order',async()=>{
 await imported('same');await imported('same',{...actor,project_id:'other-project'});
 const graph=await loadCanonicalGraph(actor.instance_id);
 expect(graph.state.completeness).toBe('partial');expect(graph.state.reasons).toContainEqual(expect.objectContaining({code:'DUPLICATE_TYPED_ID',scope:['plan_state.json']}));
 expect(graph.entities.filter(entity=>entity.payload.source==='typed_plan_authority')).toHaveLength(0);
 const pack=buildContextPack(graph,{query:'Recover same plan',plan_id:'same',slice_id:'slice-0-work',token_budget:6000,depth:0});
 expect(pack.mandatory_satisfied).toBe(false);expect(pack.state.completeness).toBe('partial');
 expect((await readPlanAuthority({id:'same',instance_id:actor.instance_id,project_id:'other-project'},now))!.state.project_id).toBe('other-project');
});

it('expired typed plan leases change effective graph/context receipts without writing or reviving running work',async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date(now));
 await imported();await command({type:'review_plan',review_id:'design-review'});await command({type:'approve_scope',approval_id:'scope-review',owner:actor.id,scope:['slice-0-work'],parallel_limit:1});await command({type:'start_slice',slice_id:'slice-0-work'});
 await command({type:'admit_execution',slice_id:'slice-0-work',lease_id:'original-lease',execution_id:'original-job',generation:1,kind:'implementation',expires_at:new Date(Date.now()+700).toISOString()},'ashoka',{...actor,kind:'runtime'});
 const before=await readFile(join(directory,'plan_state.json'),'utf8'),running=await loadCanonicalGraph(actor.instance_id);
 const query={query:'Recover active plan',plan_id:'ashoka',slice_id:'slice-0-work',token_budget:6000,depth:0};
 const initial=buildContextPack(running,query);expect(initial.context_text).toContain('"execution":"running"');
 let expired:Awaited<ReturnType<typeof loadCanonicalGraph>>;
 vi.setSystemTime(new Date(Date.parse(now)+701));
 expired=await loadCanonicalGraph(actor.instance_id);expect(expired.entities.find(entity=>entity.identity.kind==='plan')!.payload.plan_projection).toMatchObject({execution:'recovery_required',running_slice_ids:[],resume_action:'recover_execution'});
 const recovered=buildContextPack(expired!,query);expect(recovered.receipt.id).not.toBe(initial.receipt.id);expect(recovered.revision).toEqual(initial.revision);
 expect(recovered.context_text).toContain('recover_execution');expect(await readFile(join(directory,'plan_state.json'),'utf8')).toBe(before);
});

it('verified implementation evidence is distinct from the next slice and recovers after a transcript-free read',async()=>{
 await imported();await command({type:'review_plan',review_id:'design-review'});await command({type:'approve_scope',approval_id:'scope-review',owner:actor.id,scope:['slice-0-work','slice-1-verify'],parallel_limit:1});await command({type:'start_slice',slice_id:'slice-0-work'});
 await commitGraphWrites({actor:'source-fixture',operation_id:'implementation',scope:['source-fixture'],writes:[{file:'features.json',content:JSON.stringify({features:[{id:'implemented-source',name:'Implementation witness'}]})}]});
 await command({type:'record_implementation',slice_id:'slice-0-work',receipt_ids:['implementation'],effect_obligation_ids:[],required_stages:[],evidence_ids:['source-witness']});await command({type:'begin_verification',slice_id:'slice-0-work'});
 const implementing=(await readPlanAuthority({id:'ashoka',instance_id:actor.instance_id,project_id:actor.project_id},now))!;
 await command({type:'finish_verification',slice_id:'slice-0-work',implementation_revision:implementing.state.slices[0].implementation_revision,acceptance_hash:'acceptance-work',passed:true,evidence_ids:['qualified-check'],review_id:'acceptance-review',reason:'Actual disposable fixture checks'});
 const graph=await loadCanonicalGraph(actor.instance_id),plan=graph.entities.find(entity=>entity.identity.kind==='plan')!,slice=graph.entities.find(entity=>entity.payload.slice_id==='slice-0-work')!;
 expect(plan.payload.plan_projection).toMatchObject({current_slice_id:null,running_slice_id:null,last_verified_slice_id:'slice-0-work',next_slice:{id:'slice-1-verify',can_start:true},progress:{verified:1}});
 expect(slice).toMatchObject({assertion_class:'historical',confidence:null,payload:{status:'verified',verification:{fresh:true,review_id:'acceptance-review',evidence_ids:['qualified-check'],acceptance_hash:'acceptance-work'},implementation_receipt_ids:['implementation']}});
 const pack=buildContextPack(graph,{query:'Recover next task without prior transcript',plan_id:'ashoka',slice_id:'slice-1-verify',token_budget:6000,depth:0});
 expect(pack.mandatory_satisfied).toBe(true);expect(pack.context_text).toContain('start_eligible_slice');expect(pack.context_text).toContain('last_verified_slice_id');
});
