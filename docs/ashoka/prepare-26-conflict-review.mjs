/** Concrete own-instance row proposal and disposable exact-byte apply/restore proof. Original instance is read-only. */
import {readFile,writeFile,mkdtemp,mkdir,rm,stat,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import assert from 'node:assert/strict';
import {LegacyGraphUpgrade} from '../../dist/graph/legacy-upgrade.js';
import {releaseGraphWriter} from '../../dist/graph/writer-lease.js';
import {CANONICAL_FAMILIES,legacyIdentity} from '../../dist/graph/read-model.js';
const directory='C:/Users/Mika Jussila/.dreamgraph/ee9ce3b9-0313-4768-b5f1-24b9b3fffc4b/data';
const configDirectory='C:/Users/Mika Jussila/.dreamgraph/ee9ce3b9-0313-4768-b5f1-24b9b3fffc4b/config';
const previewPath='docs/ashoka/slice-26-live-preview-oct03.json',preview=JSON.parse(await readFile(previewPath,'utf8'));
const stable=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(stable).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}';
const hash=bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
const scratch=await mkdtemp(join(tmpdir(),'dg-ashoka26-copy-'));
assert(resolve(scratch).startsWith(resolve(tmpdir())+sep)&&scratch.includes('dg-ashoka26-copy-'));
const data=join(scratch,'data'),config=join(scratch,'config');await mkdir(data);await mkdir(config);
const sourceBytes=new Map(),configBytes=new Map(),resolutions=[],groups=[];
let result;
try{
 // Revalidate all original input bytes; never recover or claim the live writer.
 for(const stamp of preview.files){if(stamp.hash===null)continue;const target=join(directory,stamp.file),physical=await realpath(target);
  assert.equal(physical,join(await realpath(directory),stamp.file));const info=await stat(target);assert(info.isFile());
  const bytes=await readFile(target);assert.equal(hash(bytes),stamp.hash,stamp.file);sourceBytes.set(stamp.file,bytes);await writeFile(join(data,stamp.file),bytes);}
 for(const stamp of preview.config_files){const bytes=await readFile(join(configDirectory,stamp.file));assert.equal(hash(bytes),stamp.hash,stamp.file);configBytes.set(stamp.file,bytes);await writeFile(join(config,stamp.file),bytes);}
 for(const filename of ['candidate_edges.json','validated_edges.json','system_story.json']){
  const family=CANONICAL_FAMILIES.find(item=>item.file===filename),value=JSON.parse(sourceBytes.get(filename).toString('utf8').replace(/^\uFEFF/,''));
  const collection=family.arrays.find(key=>Array.isArray(value[key])),rows=value[collection],buckets=new Map();
  rows.forEach((row,index)=>{if(row._schema||row._note)return;const identity=legacyIdentity(family,row);if(!identity)return;
   const group=filename==='candidate_edges.json'&&row.dream_id&&['edge','node'].includes(row.dream_type)&&Number.isSafeInteger(row.normalization_cycle)
    ?stable(['assessment',row.dream_type,row.dream_id,row.normalization_cycle]):stable(['identity',identity,row.source_repo??null]);
   const bucket=buckets.get(group)??[];bucket.push({row,index,identity,row_hash:hash(stable(row))});buckets.set(group,bucket);});
  for(const bucket of buckets.values()){
   if(bucket.length<2||new Set(bucket.map(item=>item.row_hash)).size===1)continue;
   assert(bucket.some(item=>preview.findings.some(finding=>finding.file===filename&&finding.collection===collection&&finding.index===item.index&&finding.code==='CONFLICTING_DUPLICATE')),'Every proposal must resolve an observed conflict.');
   const action=filename==='system_story.json'?'set_id':'archive';
   groups.push({file:filename,collection,original_id:bucket[0].identity,rows:bucket.map(item=>({index:item.index,row_hash:item.row_hash,
    normalization_cycle:item.row.normalization_cycle??null,status:item.row.status??null,chapter_number:item.row.chapter_number??null})),
    proposal:action==='archive'?'Archive every member of this conflicting active assessment/validation group; retain all original versions in the exact backup, and leave applicability unresolved rather than choose a winner.':'Give every conflicting story row its own stable content-derived ID, preserving original chapter number, timestamps, prose and provenance; old ambiguous references remain explicit.'});
   for(const item of bucket)resolutions.push({file:filename,collection,index:item.index,row_hash:item.row_hash,action,
    ...(action==='set_id'?{new_id:'legacy:narrative:'+item.row_hash.slice(7,31)}:{}),reason:action==='archive'?'Reviewed proposal: preserve every ambiguous version in the exact original backup; no confidence, timestamp or array-position winner. Applicability remains unresolved.':'Reviewed proposal: distinct immutable historical chapter identity; original chapter number, prose, time and provenance are preserved.'});
  }
 }
 resolutions.sort((a,b)=>a.file.localeCompare(b.file)||a.collection.localeCompare(b.collection)||a.index-b.index);
 assert(resolutions.length>0&&resolutions.length<=4096);assert.equal(new Set(resolutions.map(row=>stable([row.file,row.collection,row.index]))).size,resolutions.length);
 const service=new LegacyGraphUpgrade(data,preview.instance_id,config),copiedPreview=await service.preview(resolutions);assert.equal(copiedPreview.blockers.length,0,JSON.stringify(copiedPreview.blockers));
 const applied=await service.apply(copiedPreview,{reviewed_digest:copiedPreview.digest,review_id:'disposable-copy-review:ashoka26',operation_id:'ashoka26-reviewed-copy'});
 const log=JSON.parse(await readFile(join(data,'graph_upgrade_log.json'),'utf8')),entry=log.entries.find(item=>item.operation_id==='ashoka26-reviewed-copy');
 const backupDirectory=join(data,'.graph-upgrades',entry.backup_id),manifest=JSON.parse(await readFile(join(backupDirectory,'manifest.json'),'utf8'));
 for(const file of manifest.files)assert((await readFile(join(backupDirectory,file.blob))).equals(sourceBytes.get(file.file)),file.file);
 for(const file of manifest.config_files)assert((await readFile(join(backupDirectory,file.blob))).equals(configBytes.get(file.file)),file.file);
 const replay=await service.apply(copiedPreview,{reviewed_digest:copiedPreview.digest,review_id:'disposable-copy-review:ashoka26',operation_id:'ashoka26-reviewed-copy'});assert.equal(replay.replayed,true);assert.equal(replay.receipt.operation_id,applied.receipt.operation_id);
 const restorePreview=await service.previewRestore('ashoka26-reviewed-copy');assert.equal(restorePreview.blockers.length,0);
 const restored=await service.restore(restorePreview,{reviewed_digest:restorePreview.digest,review_id:'disposable-copy-restore-review:ashoka26',operation_id:'ashoka26-reviewed-copy-restore'});
 for(const write of copiedPreview.writes)assert((await readFile(join(data,write.file))).equals(sourceBytes.get(write.file)),write.file);
 // Live source may advance during this demonstration. The proposal is never an approval for changed bytes.
 const liveChanged=[];for(const [file,bytes]of sourceBytes)if(!(await readFile(join(directory,file))).equals(bytes))liveChanged.push(file);
 for(const [file,bytes]of configBytes)if(!(await readFile(join(configDirectory,file))).equals(bytes))liveChanged.push('config/'+file);
 result={schema:'dreamgraph.ashoka.own_graph_conflict_proposal.v1',recorded_at:new Date().toISOString(),status:'proposal_disposable_copy_proved_live_review_required',
  instance_id:preview.instance_id,original_preview:previewPath,original_digest:preview.digest,original_revision:preview.revision,
  scope:'Only candidate_edges.json, validated_edges.json and system_story.json structural identity/ambiguity disposition; no source scan, model call, C14 progress import or other instance change.',
  groups,resolutions_file:'docs/ashoka/slice-26-conflict-resolutions-proposed.json',resolutions_hash:hash(stable(resolutions)),
  counts:{groups:groups.length,resolutions:resolutions.length,archived_active_rows:resolutions.filter(row=>row.action==='archive').length,story_identity_mappings:resolutions.filter(row=>row.action==='set_id').length,
   backup_data_files:manifest.files.length,backup_config_files:manifest.config_files.length,backup_bytes:manifest.files.reduce((n,file)=>n+file.bytes,0)+manifest.config_files.reduce((n,file)=>n+file.bytes,0)},
  before:copiedPreview.before,after:copiedPreview.after,changes:copiedPreview.writes.map(({file,before_hash,after_hash,content})=>({file,before_hash,after_hash,bytes:Buffer.byteLength(content)})),
  copy_proof:{blockers:copiedPreview.blockers,apply_receipt:applied.receipt.operation_id,replay_same_receipt:true,all_backup_bytes_verified:true,restore_receipt:restored.receipt.operation_id,all_changed_families_restored_exactly:true},
  live_changed_during_copy_proof:liveChanged,unknown_baselines:copiedPreview.unknown_baselines,
  required_before_live_apply:['Human review of this exact row-bound archive/identity proposal and permission to drain/stop only the named running instance.','No unsettled work or unconfirmed effects; original offline physical writer fence.','Fresh preview and exact config/input/source hashes; changed rows or scope require renewed review.','Verified byte-preserving original-instance backup and the same one journaled publication/recovery owner.'],
  original_instance_changed:false,model_requests:0,windows_global_install_changed:false};
 await writeFile(result.resolutions_file,JSON.stringify(resolutions,null,2)+'\n',{flag:'wx'});
 await writeFile('docs/ashoka/slice-26-conflict-proposal.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({status:result.status,counts:result.counts,files:result.changes.map(change=>change.file),copy_proof:result.copy_proof,live_changed:liveChanged,original_instance_changed:false}));
}finally{await releaseGraphWriter(data);assert(resolve(scratch).startsWith(resolve(tmpdir())+sep)&&scratch.includes('dg-ashoka26-copy-'));await rm(scratch,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
