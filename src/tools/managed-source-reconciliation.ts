/** Daemon-owned structural settlement of named managed source changes. No repository walk or model calls. */
import fs from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { config } from "../config/config.js";
import { dataPath } from "../utils/paths.js";
import { stripBom } from "../utils/read-json.js";
import { withGraphReconciliation } from "../utils/graph-reconciliation-barrier.js";
import { readChangeObligations, sourceForScope } from "../graph/change-obligations.js";
import { loadPublicationState, publicationContentHash } from "../graph/publication.js";
import { CANONICAL_FAMILIES } from "../graph/read-model.js";
import { withReconciliationTransaction } from "./reconciliation-transaction.js";
import { createRootGitignoreFilter } from "./scanner-ignore-policy.js";
import { isScannerTrackedFile } from "./scanner-artifact-policy.js";
import { makeScannedFile, reconcileAddedModifiedEntities } from "./incremental-reconciliation.js";
import { generateStructuralFeatures, generateStructuralWorkflows, generateStructuralDataModel } from "./structural-generators.js";
import type { ProjectScan } from "./scan-types.js";
import { buildIndex } from "./scan-project.js";

const hash=(value:Buffer|string)=>"sha256:"+createHash("sha256").update(value).digest("hex");
const strings=(value:unknown):string[]=>Array.isArray(value)?value.filter((item):item is string=>typeof item==="string"):[];
type Row=Record<string,unknown>;
/** Call only from the execution owner with IDs/scopes read from its durable record, never from model arguments. */
export async function reconcileManagedSourceChanges(executionId:string, dependencies:string[]=[]) {
 return withGraphReconciliation(async()=>{
  const ledger=(await readChangeObligations()).entries;
  const pending=ledger.filter(item=>!["graph_committed","failed"].includes(item.state));
  const scopes=new Set(dependencies.filter(scope=>scope.startsWith("source:")));
  const selected=new Set(pending.filter(item=>item.execution_id===executionId).map(item=>item.id));
  // Coalesce the exact connected source-change chain, including earlier sessions; never sweep the repository.
  let changed=true;
  while(changed){changed=false;for(const item of pending)if(selected.has(item.id)||item.scope.some(scope=>scopes.has(scope))){
   if(!selected.has(item.id)){selected.add(item.id);changed=true;}
   for(const scope of item.scope)if(!scopes.has(scope)){scopes.add(scope);changed=true;}
  }}
  const obligations=pending.filter(item=>selected.has(item.id));
  if(!obligations.length)return {reconciled:0,files:0};
  if(obligations.some(item=>!["source_applied","reconciliation_pending"].includes(item.state)))throw new Error("SOURCE_RECONCILIATION_EFFECT_UNKNOWN");
  if([...scopes].some(scope=>!scope.startsWith("source:")))throw new Error("SOURCE_RECONCILIATION_SCOPE_UNKNOWN");
  const operation="managed-source-reconciliation:"+randomUUID(),now=new Date().toISOString();
  const captures=new Map<string,{repo:string;rel:string;file:string;content:Buffer|null;digest:string;excluded:boolean}>();
  const ignores=new Map<string,Awaited<ReturnType<typeof createRootGitignoreFilter>>>();
  for(const scope of scopes){
   const [repo,...parts]=scope.slice(7).split("/").map(decodeURIComponent),rel=parts.join("/");
   const file=await sourceForScope(scope);
   let content:Buffer|null;
   try{content=await fs.readFile(file);}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;content=null;}
   const digest=content===null?"absent":hash(content);
   const latest=ledger.filter(item=>item.scope.includes(scope)&&item.state!=="failed").at(-1);
   if(!latest || latest.after_hashes[scope]!==digest)throw new Error("SOURCE_RECONCILIATION_SOURCE_CHANGED: "+scope);
   let ignored=ignores.get(repo);if(!ignored){ignored=await createRootGitignoreFilter(config.repos[repo]);ignores.set(repo,ignored);}
   captures.set(scope,{repo,rel,file,content,digest,excluded:ignored(rel)||!isScannerTrackedFile(config.repos[repo],file)});
  }
  const scans:ProjectScan[]=[];
  for(const repo of new Set([...captures.values()].map(item=>item.repo))){
   const files=[...captures.values()].filter(item=>item.repo===repo&&item.content!==null&&!item.excluded).map(item=>({
    ...makeScannedFile(config.repos[repo],item.rel,item.content!.length),content:item.content!.toString("utf8"),content_hash:item.digest,
   }));
   scans.push({repoName:repo,repoRoot:config.repos[repo],technology:"scoped managed source",files,uiFiles:[],manifestContent:{},
    topLevelDirs:[...new Set(files.map(file=>file.dirParts[0]).filter(Boolean))],auxiliaryFiles:{test_suite:[],configuration:[],automation_script:[],mcp_tool:[]}});
  }
  const publication=await loadPublicationState(),writes:Array<{file:string;content:string}>=[],indexOverrides:Partial<Record<"features.json"|"workflows.json"|"data_model.json",Row[]>>={};
  const specs=[
   {file:"features.json" as const,target:"features" as const,generate:generateStructuralFeatures},
   {file:"workflows.json" as const,target:"workflows" as const,generate:generateStructuralWorkflows},
   {file:"data_model.json" as const,target:"data_model" as const,generate:generateStructuralDataModel},
  ];
  // Preserve each store's envelope and human/model assertions. Only source structure and currency change.
  for(const family of CANONICAL_FAMILIES.slice(0,7)){
   let raw:unknown=[];
   try{
    const text=await fs.readFile(dataPath(family.file),"utf8");
    if(publication.stores[family.file]&&publication.stores[family.file].hash!==publicationContentHash(text))throw new Error("UNPUBLISHED_STORE_CHANGE: "+family.file);
    raw=JSON.parse(stripBom(text));
   }catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;
    if(publication.stores[family.file])throw new Error("SOURCE_RECONCILIATION_STORE_MISSING: "+family.file);}
   const envelope=raw as Record<string,unknown>,arrayKey=Array.isArray(raw)?null:family.arrays.find(key=>Array.isArray(envelope[key]));
   if(!Array.isArray(raw)&&!arrayKey)throw new Error("SOURCE_RECONCILIATION_STORE_SHAPE: "+family.file);
   const original=(arrayKey?envelope[arrayKey]:raw) as Row[];
   let rows=original;
   const spec=specs.find(spec=>spec.file===family.file);
   if(spec){
    // Extract per named file so fallback display/sample limits cannot discard source support.
    const incoming=scans.flatMap(scan=>scan.files.flatMap(file=>spec.generate({...scan,files:[file]}).map(entity=>({repo:scan.repoName,target:spec.target,kind:spec.target,entity,
      file_hashes:{[file.rel]:file.content_hash!}}))));
    rows=reconcileAddedModifiedEntities({existing:rows,incoming,reconciliation_target:spec.target,revision:operation}).entities;
   }
   rows=rows.map(row=>{
    const repo=typeof row.source_repo==="string"?row.source_repo:"",files=strings(row.source_files);
    const affected=[...captures.values()].filter(item=>item.repo===repo&&files.includes(item.rel));
    if(!affected.length)return row;
    const source_hashes={...(row.source_hashes as Record<string,string>|undefined)};
    const removed=new Set(affected.filter(item=>item.content===null||item.excluded).map(item=>item.rel));
    for(const item of affected){if(removed.has(item.rel))delete source_hashes[item.rel];else source_hashes[item.rel]=item.digest;}
    const retained=files.filter(file=>!removed.has(file));
    return {...row,source_files:retained,source_hashes,source_revision:operation,source_observed_at:now,source_verified:false,
     ...(retained.length?{}:{status:"deprecated"}),
     semantic_validity:{state:Object.keys(row).some(key=>key==="human_asserted"||key.startsWith("manual_")||key.startsWith("governed_"))?"review":"invalidated",reason:"managed_source_changed; structural source reconciled, semantic review separate"}};
   });
   if(spec)indexOverrides[spec.file]=rows;
   if(JSON.stringify(rows)!==JSON.stringify(original))writes.push({file:family.file,content:JSON.stringify(arrayKey?{...envelope,[arrayKey]:rows}:rows,null,2)});
  }
  if(writes.length)writes.push({file:"index.json",content:JSON.stringify(await buildIndex(indexOverrides),null,2)});
  await withReconciliationTransaction({expected_revision:publication.revision.graph_revision,next_revision:operation,writes,
   read_current_revision:async()=>(await loadPublicationState()).revision.graph_revision,operation_id:operation,
   reconciliation_scope:[...scopes],change_obligation_ids:obligations.map(item=>item.id),full_scan:false,
   before_commit:async()=>{
    for(const [scope,item]of captures){
     let current:string;try{current=hash(await fs.readFile(await sourceForScope(scope)));}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;current="absent";}
     if(current!==item.digest)throw new Error("SOURCE_RECONCILIATION_SOURCE_CHANGED: "+scope);
    }
    return {execution_id:executionId,files:[...captures].map(([scope,item])=>({scope,disposition:item.excluded?"excluded":item.content===null?"deleted":"structurally_reconciled"}))};
   }});
  return {reconciled:obligations.length,files:captures.size};
 });
}
