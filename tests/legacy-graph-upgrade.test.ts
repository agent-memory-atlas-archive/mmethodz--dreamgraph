import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { once } from "node:events";
import { withDataDirectory } from "../src/utils/paths.js";
import { LegacyGraphUpgrade, type GraphUpgradePreview } from "../src/graph/legacy-upgrade.js";
import { CANONICAL_FAMILIES, loadCanonicalGraph } from "../src/graph/read-model.js";
import { commitGraphWrites, loadPublicationState, recoverGraphPublication } from "../src/graph/publication.js";
import { releaseGraphWriter } from "../src/graph/writer-lease.js";
import { readDirtyPartitions, prepareEvidenceGeneration } from "../src/graph/change-obligations.js";
import { graphUpgradeNotice } from "../src/graph/upgrade-notice.js";
import { EngineJobs } from "../src/cognitive/jobs.js";
let directory: string, service: LegacyGraphUpgrade;
const scope = <T>(work: () => T) => withDataDirectory(directory, work);
const sha = (value: string|Buffer) => "sha256:"+createHash("sha256").update(value).digest("hex");
const stable = (value: any): string => value===null||typeof value!=="object"?JSON.stringify(value):Array.isArray(value)?"["+value.map(stable).join(",")+"]":"{"+Object.keys(value).sort().map(key=>JSON.stringify(key)+":"+stable(value[key])).join(",")+"}";
const approval = (preview: {digest:string}, operation_id="upgrade") => ({reviewed_digest:preview.digest,review_id:"operator:review",operation_id});
beforeEach(async()=>{directory=await fs.mkdtemp(join(tmpdir(),"dg-legacy-upgrade-"));service=new LegacyGraphUpgrade(directory,"fixture");
  for(const family of CANONICAL_FAMILIES)await fs.writeFile(join(directory,family.file),JSON.stringify({[family.arrays[0]]:[]}));
  await fs.writeFile(join(directory,"extension_history.json"),'\ufeff{"original":"untouched extension archive"}\n');
});
afterEach(async()=>{await releaseGraphWriter(directory);await fs.rm(directory,{recursive:true,force:true});});
async function features(rows:unknown[]){await fs.writeFile(join(directory,"features.json"),JSON.stringify(rows));}
async function bytes(){return Object.fromEntries(await Promise.all((await fs.readdir(directory)).filter(name=>name.endsWith(".json")).map(async name=>[name,sha(await fs.readFile(join(directory,name)))])));}
describe("reviewed offline legacy graph upgrade",()=>{
  it("previews all families without writing, preserves scoped identities and provenance, and never invents source/scan history",async()=>{
    await features([{id:"shared",source_repo:"one",source_files:["a.ts"],origin:"lucid"},{id:"shared",source_repo:"two",source_files:["b.ts"]},{name:"Missing",confidence:1,origin:"rem"}]);
    await fs.writeFile(join(directory,"workflows.json"),'[{"id":"shared","source_repo":"one"}]');
    await fs.writeFile(join(directory,"validated_edges.json"),'{"edges":[{"id":"edge","from":"shared","to":"missing"}]}');
    await fs.writeFile(join(directory,"candidate_edges.json"),'{"results":[{"dream_type":"node","dream_id":"shared","normalization_cycle":1,"status":"latent"},{"dream_type":"edge","dream_id":"shared","normalization_cycle":1,"status":"rejected"},{"dream_type":"node","dream_id":"shared","normalization_cycle":2,"status":"latent"}]}');
    await fs.writeFile(join(directory,"tension_log.json"),'{"signals":[],"resolved_tensions":[{"tension_id":"old","resolved_at":"2020-01-01T00:00:00Z","rationale":"Historical resolution"}]}');
    await fs.writeFile(join(directory,"dream_archetypes.json"),'{"archetypes":[{"id":"shared","source_instance":"foreign"}]}');
    const original=await bytes(),preview=await service.preview();expect(await bytes()).toEqual(original);expect(preview.blockers).toEqual([]);
    expect(preview.findings).toHaveLength(1);expect(preview.unknown_baselines).toEqual(["scan_state.json","enrichment_state.json"]);
    const result=await service.apply(preview,approval(preview));expect(result.receipt.result).toMatchObject({changed_files:1});
    expect(await fs.readFile(join(directory,"extension_history.json"),"utf8")).toBe('\ufeff{"original":"untouched extension archive"}\n');
    const graph=await scope(()=>loadCanonicalGraph("fixture"));expect(graph.entities.filter(row=>row.identity.id==="shared")).toHaveLength(3);
    expect(graph.entities.some(row=>row.identity.id==="foreign:foreign:shared")).toBe(true);expect(graph.entities.some(row=>row.identity.id==="old@resolved:2020-01-01T00:00:00Z")).toBe(true);
    expect(graph.entities.find(row=>row.identity.id==="shared"&&row.identity.repository_id==="one"&&row.identity.kind==="feature")?.assertion_class).toBe("human_assertion");
    expect(graph.entities.find(row=>row.payload.name==="Missing")?.assertion_class).toBe("hypothesis");
    expect(graph.relationships.find(row=>row.payload.id==="edge")).toMatchObject({source:null,target:null});
    expect(result.receipt.currency.last_full_scan_at).toBeNull();expect(result.receipt.currency.last_source_reconciliation_at).toBeNull();
    const dirty=await scope(readDirtyPartitions);expect(dirty.partitions).toHaveLength(1);expect(dirty.partitions[0]).toMatchObject({state:"partial",pending_stages:[],running_generation:null});
  });
  it("archives exact duplicates once but blocks conflicting claims until exact row-bound explicit choices",async()=>{
    const row={id:"same",name:"Human original",origin:"lucid",confidence:1};await features([row,row,{id:"same",name:"Conflicting original",confidence:0.9}]);
    const blocked=await service.preview();expect(blocked.findings.some(item=>item.code==="EXACT_DUPLICATE_ARCHIVED")).toBe(true);expect(blocked.blockers).toHaveLength(1);
    await expect(service.apply(blocked,approval(blocked))).rejects.toThrow("RESOLUTIONS_REQUIRED");
    const target=blocked.findings.find(item=>item.code==="CONFLICTING_DUPLICATE")!;
    const preview=await service.preview([{file:target.file,collection:target.collection,index:target.index,row_hash:target.row_hash!,action:"archive",reason:"Explicit fixture operator chooses original; retain conflicting original in backup"}]);
    expect(preview.blockers).toEqual([]);await service.apply(preview,approval(preview));expect(JSON.parse(await fs.readFile(join(directory,"features.json"),"utf8"))).toEqual([row]);
    expect((await service.apply(preview,approval(preview))).replayed).toBe(true);await expect(service.apply(preview,{...approval(preview),review_id:"changed"})).rejects.toThrow("OPERATION_CONFLICT");
    const log=JSON.parse(await fs.readFile(join(directory,"graph_upgrade_log.json"),"utf8")),manifest=JSON.parse(await fs.readFile(join(directory,".graph-upgrades",log.entries[0].backup_id,"manifest.json"),"utf8"));
    const original=manifest.files.find((file:any)=>file.file==="features.json");expect(JSON.parse(await fs.readFile(join(directory,".graph-upgrades",log.entries[0].backup_id,original.blob),"utf8"))).toHaveLength(3);
  });
  it("keeps immutable assessment history and chapter identities; no automatic cycle winner or evidence promotion",async()=>{
    await fs.writeFile(join(directory,"candidate_edges.json"),'{"results":[{"dream_id":"artifact","dream_type":"node","normalization_cycle":3,"status":"latent"},{"dream_id":"artifact","dream_type":"node","normalization_cycle":3,"status":"validated"}]}');
    const preview=await service.preview(),finding=preview.findings.find(item=>item.code==="CONFLICTING_DUPLICATE")!;
    expect(preview.blockers).toHaveLength(1);await expect(service.preview([{file:finding.file,collection:finding.collection,index:finding.index,row_hash:finding.row_hash!,action:"set_id",new_id:"new",reason:"Must not rename cycle identity"}])).rejects.toThrow("EXPLICIT_ARCHIVE");
    await fs.writeFile(join(directory,"system_story.json"),'{"chapters":[{"chapter_number":2,"title":"Prior narrative"}],"digests":[{"id":"digest","text":"Prior derived text"}]}');
    const resolved=await service.preview([{file:finding.file,collection:finding.collection,index:finding.index,row_hash:finding.row_hash!,action:"archive",reason:"Explicit fixture assessment choice"}]);
    expect(resolved.writes.find(write=>write.file==="system_story.json")).toBeUndefined();
  });
  it("rejects unsupported majors, invalid UTF-8 and schema shapes, stale resolutions and changed previews",async()=>{
    await fs.writeFile(join(directory,"tension_log.json"),'{"schema_version":"3.0.0","signals":[]}');expect((await service.preview()).blockers[0]).toContain("UNSUPPORTED_STORE_SCHEMA");
    await fs.writeFile(join(directory,"tension_log.json"),'{"schema_version":"1.0.0","signals":[]}');expect((await service.preview()).blockers).toEqual([]);
    await features([{name:"one"}]);const preview=await service.preview();const modified=structuredClone(preview);modified.writes[0].content="[]";
    await expect(service.apply(modified,approval(preview))).rejects.toThrow("REVIEW_CHANGED");
    const {digest,...bound}=modified;modified.digest=sha(stable(bound));await expect(service.apply(modified,approval(modified))).rejects.toThrow("PREVIEW_INVALID");
    await expect(service.preview([{file:"features.json",collection:"$root",index:0,row_hash:sha("wrong"),action:"archive",reason:"Wrong evidence"}])).rejects.toThrow("RESOLUTION_CHANGED");
    await fs.writeFile(join(directory,"features.json"),Buffer.from([0x5b,0xff,0x5d]));await expect(service.preview()).rejects.toThrow("INVALID_JSON_OR_ENCODING");
  });
  it("rejects stale input and unpublished changes instead of overwriting concurrent source or graph work",async()=>{
    await features([{name:"before"}]);const preview=await service.preview();await features([{name:"later"}]);await expect(service.apply(preview,approval(preview))).rejects.toThrow("REVISION_CONFLICT");
    await scope(()=>commitGraphWrites({writes:[{file:"features.json",content:'[{"id":"current"}]'}]}));await features([{id:"outside-published-owner"}]);await expect(service.preview()).rejects.toThrow("UNPUBLISHED_INPUT");
  });
  it("refuses cross-collection identity collisions even when a modified preview conceals the staged blocker",async()=>{
    await fs.writeFile(join(directory,"system_story.json"),'{"chapters":[{"name":"Missing chapter"}],"digests":[{"id":"taken"}]}');
    const preview = await service.preview(), target = preview.findings[0];
    const blocked = await service.preview([{file:target.file,collection:target.collection,index:target.index,row_hash:target.row_hash!,action:"set_id",new_id:"taken",reason:"Fixture deliberate cross-collection conflict"}]);
    expect(blocked.blockers.some(reason=>reason.includes("STAGED_GRAPH_INVALID: DUPLICATE_TYPED_ID"))).toBe(true);
    const hidden = structuredClone(blocked); hidden.blockers=[];
    const {digest,...bound}=hidden;hidden.digest=sha(stable(bound));
    await expect(service.apply(hidden,approval(hidden))).rejects.toThrow("STAGE_INVALID");
    expect(await fs.readFile(join(directory,"system_story.json"),"utf8")).toContain("Missing chapter");
    const other = await fs.mkdtemp(join(tmpdir(),"dg-other-upgrade-"));
    try { await expect(new LegacyGraphUpgrade(other,"fixture").apply(preview,approval(preview))).rejects.toThrow("INSTANCE_MISMATCH");
      await expect(new LegacyGraphUpgrade(directory,"other-instance").apply(preview,approval(preview))).rejects.toThrow("INSTANCE_MISMATCH");
    } finally { await fs.rm(other,{recursive:true,force:true}); }
  });
  it("cancels before cutover and rejects input changes after backup; original mutation is retained",async()=>{
    await features([{name:"original"}]);const before=await bytes(),preview=await service.preview(),controller=new AbortController();
    await expect(service.apply(preview,{...approval(preview),signal:controller.signal,fault_inject:at=>{if(at==="upgrade_backup_verified")controller.abort(new Error("operator stop"));}})).rejects.toThrow("operator stop");
    expect(await bytes()).toEqual(before);expect((await fs.readdir(join(directory,".graph-upgrades"))).length).toBe(1);
    await expect(service.apply(preview,{...approval(preview),fault_inject:async at=>{if(at==="upgrade_backup_verified")await features([{id:"outside-change"}]);}})).rejects.toThrow("INPUT_CHANGED");
    expect(JSON.parse(await fs.readFile(join(directory,"features.json"),"utf8"))).toEqual([{id:"outside-change"}]);
  });
  it("binds and privately backs up opaque configuration bytes while restore preserves later operating settings",async()=>{
    const configRoot=await fs.mkdtemp(join(tmpdir(),"dg-upgrade-config-"));
    try {
      const configBytes=Buffer.from('\ufeffKEY=fixture-private-value\r\n','utf8');await fs.writeFile(join(configRoot,"engine.env"),configBytes);
      await features([{name:"original"}]);const configured=new LegacyGraphUpgrade(directory,"fixture",configRoot),old=await configured.preview();
      expect(JSON.stringify(old)).not.toContain("fixture-private-value");
      await fs.writeFile(join(configRoot,"engine.env"),"KEY=changed\n");await expect(configured.apply(old,approval(old))).rejects.toThrow("REVISION_CONFLICT");
      await fs.writeFile(join(configRoot,"engine.env"),configBytes);const preview=await configured.preview();await configured.apply(preview,approval(preview));
      const log=JSON.parse(await fs.readFile(join(directory,"graph_upgrade_log.json"),"utf8")),backup=join(directory,".graph-upgrades",log.entries[0].backup_id),manifest=JSON.parse(await fs.readFile(join(backup,"manifest.json"),"utf8"));
      expect(await fs.readFile(join(backup,manifest.config_files[0].blob))).toEqual(configBytes);
      await fs.writeFile(join(configRoot,"engine.env"),"KEY=later-intent\n");const restore=await configured.previewRestore("upgrade");await configured.restore(restore,approval(restore,"restore"));
      expect(await fs.readFile(join(configRoot,"engine.env"),"utf8")).toBe("KEY=later-intent\n");
    } finally { await fs.rm(configRoot,{recursive:true,force:true}); }
  });
  it("skips the daemon's own .engine-config receipt store but still fails closed on any other config entry",async()=>{
    // An instance whose engine.env was ever edited through the Config page has config/.engine-config/<sha>/<sha>.json.
    const configRoot=await fs.mkdtemp(join(tmpdir(),"dg-upgrade-config-"));
    try {
      await fs.writeFile(join(configRoot,"engine.env"),"KEY=value\n");
      const receipts=join(configRoot,".engine-config","a".repeat(64));await fs.mkdir(receipts,{recursive:true});
      await fs.writeFile(join(receipts,"b".repeat(64)+".json"),'{"schema":"dreamgraph.engine_config_receipt.v1"}');
      await features([{name:"original"}]);const configured=new LegacyGraphUpgrade(directory,"fixture",configRoot);
      await fs.mkdir(join(configRoot,"unexpected"));
      await expect(configured.preview()).rejects.toThrow('GRAPH_UPGRADE_CONFIG_LINK_OR_KIND: "unexpected" is a directory');
      await fs.rmdir(join(configRoot,"unexpected"));
      const preview=await configured.preview();expect(preview.config_files.map(entry=>entry.file)).toEqual(["engine.env"]);
      await configured.apply(preview,approval(preview));
    } finally { await fs.rm(configRoot,{recursive:true,force:true}); }
  });
  it("cannot acquire a live process writer and proceeds only after that kernel owner exits",async()=>{
    await features([{name:"original"}]);const preview=await service.preview(),module=pathToFileURL(resolve("src/graph/writer-lease.ts")).href;
    const child=spawn(process.execPath,["--import","tsx","--input-type=module","-e",`import {assertGraphWriter} from ${JSON.stringify(module)};await assertGraphWriter(process.env.DG_UPGRADE_DIR);console.log('held');process.stdin.resume();`],{cwd:process.cwd(),env:{...process.env,DG_UPGRADE_DIR:directory},stdio:["pipe","pipe","pipe"],windowsHide:true});
    try { await new Promise<void>((done,reject)=>{const timer=setTimeout(()=>reject(new Error("writer fixture did not start")),10000);child.stdout.on("data",chunk=>{if(String(chunk).includes("held")){clearTimeout(timer);done();}});child.once("error",reject);});
      await expect(service.apply(preview,approval(preview))).rejects.toThrow("INSTANCE_WRITER_UNAVAILABLE");
      const exited=once(child,"exit");child.kill();await exited;await service.apply(preview,approval(preview));
      expect((await scope(loadPublicationState)).revision.publication_sequence).toBe(1);
    } finally {if(child.exitCode===null&&child.signalCode===null){const exited=once(child,"exit");child.kill();await exited;}}
  });
  it("validates owner stores and refuses unfinished jobs instead of cancelling or reassigning them",async()=>{
    const jobs=new EngineJobs(directory),ownService=new LegacyGraphUpgrade(directory,jobs.instance_id);
    const record=await jobs.accept({operation_id:"active",action:"fixture",owner:"fixture",scope:[],budget:{requests:0,input_tokens:0,output_tokens:0,reasoning_tokens:0,retries:0,elapsed_ms:1000,concurrency:1,max_hops:0,max_neighbors:0,run_amount:0,day_amount:0,currency:"USD",pricing_version:null,billing_principal:"fixture"},roles:[]});
    const preview=await ownService.preview();await expect(ownService.apply(preview,approval(preview))).rejects.toThrow("ACTIVE_OR_UNCONFIRMED_JOB");
    await jobs.cancel(record.job.id,"fixture cancellation");
    await fs.writeFile(join(directory,"execution_contexts.json"),'{"schema":"unknown-owner","entries":[]}');const invalid=await ownService.preview();
    await expect(ownService.apply(invalid,approval(invalid))).rejects.toMatchObject({name:"ZodError"});
  });
  it("restores exact original bytes as a new publication while preserving post-cutover debt, history and source currency",async()=>{
    const original='\ufeff[ {"name":"Original Unicode Ω 日本語","origin":"lucid"} ]\n';await fs.writeFile(join(directory,"features.json"),original);
    const preview=await service.preview();await service.apply(preview,approval(preview));
    await scope(async()=>{const writes=await prepareEvidenceGeneration({id:"later",scope:["repository:later"],fingerprint:"source:later",unknown_impact:true});await commitGraphWrites({writes:[{file:"workflows.json",content:'[{"id":"later"}]'},...writes],source_reconciliation:{revision:"managed:later",scope:["repository:later"],full:true},operation_id:"later"});});
    const currency=(await scope(loadPublicationState)).currency,dirty=await scope(readDirtyPartitions),restore=await service.previewRestore("upgrade");
    expect(restore.blockers).toEqual([]);const result=await service.restore(restore,approval(restore,"restore"));expect(result.receipt.revision.publication_sequence).toBeGreaterThan(restore.revision.publication_sequence);
    expect(result.receipt.currency.last_full_scan_at).toBe(currency.last_full_scan_at);expect(result.receipt.currency.source_reconciliation_revision).toBe("managed:later");
    expect(await fs.readFile(join(directory,"features.json"),"utf8")).toBe(original);expect(await fs.readFile(join(directory,"workflows.json"),"utf8")).toBe('[{"id":"later"}]');expect(await scope(readDirtyPartitions)).toEqual(dirty);
    expect((await service.restore(restore,approval(restore,"restore"))).replayed).toBe(true);expect((await scope(graphUpgradeNotice.bind(null,"fixture"))).state).toBe("review_recommended");
  });
  it("exposes restore conflicts and backup corruption before any restore; an uncertain old result is not overwritten",async()=>{
    await features([{name:"original"}]);const preview=await service.preview();await service.apply(preview,approval(preview));
    await scope(()=>commitGraphWrites({writes:[{file:"features.json",content:'[{"id":"new-legitimate-work"}]'}]}));
    const restore=await service.previewRestore("upgrade");expect(restore.blockers[0]).toContain("RESTORE_CONFLICT");await expect(service.restore(restore,approval(restore,"restore"))).rejects.toThrow("RESTORE_CONFLICT");
    const log=JSON.parse(await fs.readFile(join(directory,"graph_upgrade_log.json"),"utf8"));await fs.writeFile(join(directory,".graph-upgrades",log.entries[0].backup_id,"manifest.json"),"{}");await expect(service.previewRestore("upgrade")).rejects.toThrow("BACKUP_MANIFEST_CHANGED");
  });
  it.each(["after_replace:0:","publication_committed"])("recovers a real killed writer at %s without replaying a second graph effect",async step=>{
    await features([{name:"crash-original"}]);const preview=await service.preview(),previewFile=join(directory,".preview-fixture");await fs.writeFile(previewFile,JSON.stringify(preview));
    const module=pathToFileURL(resolve("src/graph/legacy-upgrade.ts")).href;
    const source=`import fs from 'node:fs/promises';import {LegacyGraphUpgrade} from ${JSON.stringify(module)};const preview=JSON.parse(await fs.readFile(process.env.DG_UPGRADE_PREVIEW,'utf8'));await new LegacyGraphUpgrade(process.env.DG_UPGRADE_DIR,'fixture').apply(preview,{reviewed_digest:preview.digest,review_id:'operator:review',operation_id:'crash',fault_inject:at=>{if(at.startsWith(process.env.DG_UPGRADE_CRASH))process.exit(42);}});process.exit(0);`;
    const child=spawn(process.execPath,["--import","tsx","--input-type=module","-e",source],{cwd:process.cwd(),env:{...process.env,DG_UPGRADE_DIR:directory,DG_UPGRADE_PREVIEW:previewFile,DG_UPGRADE_CRASH:step},stdio:["ignore","pipe","pipe"]});let error="";child.stderr.on("data",part=>error+=part);const [code]=await once(child,"exit");expect(code,error).toBe(42);
    await expect(scope(loadPublicationState)).rejects.toThrow("GRAPH_RECOVERY_REQUIRED");expect(await scope(recoverGraphPublication)).toBe(step==="publication_committed"?"rolled_forward":"rolled_back");
    const result=await service.apply(preview,approval(preview,"crash"));expect(result.replayed).toBe(step==="publication_committed");expect(JSON.parse(await fs.readFile(join(directory,"features.json"),"utf8"))).toHaveLength(1);expect((await scope(loadPublicationState)).revision.publication_sequence).toBe(1);
  });
});
