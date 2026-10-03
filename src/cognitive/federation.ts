/** Versioned exchange of foreign hypotheses. A remote validation claim is never a local source witness. */
import { readFile, stat, mkdir, realpath, lstat } from "node:fs/promises";
import { dirname, resolve, relative, isAbsolute, sep } from "node:path";
import { z } from "zod";
import { engine } from "./engine.js";
import { dataPath, getDataDir } from "../utils/paths.js";
import { atomicWriteFile } from "../utils/atomic-write.js";
import { withGraphRead, withGraphReconciliation } from "../utils/graph-reconciliation-barrier.js";
import { commitGraphWrites, findOperationReceipt } from "../graph/publication.js";
import { loadCanonicalGraph } from "../graph/read-model.js";
import { readEvidenceStore, timeDigest } from "./temporal-evidence.js";
import { prepareEvidenceGeneration } from "../graph/change-obligations.js";
import type { ExportArchetypesOutput, ImportArchetypesOutput } from "./types.js";
import { FederationSettingsSchema } from "../config/engine-settings.js";

export const FEDERATION_POLICY="ashoka.foreign-hypothesis.v2";
const hash=z.string().regex(/^[a-f0-9]{64}$/),id=z.string().min(1).max(256),utc=z.string().datetime({offset:true});
const roles=["auth_component","api_endpoint","data_entity","workflow_entity","financial_component","notification_component","admin_component","discovery_component","system_component"] as const;
const patterns=["security_pattern","structural_gap","cross_domain_bridge","tension_resolution","symmetry_pattern","reinforcement_pattern","causal_pattern","generic_connection"] as const;
export const ArchetypeSchema=z.object({
  id,pattern_type:z.enum(patterns),description:z.string().max(1024),entity_roles:z.array(z.enum(roles)).length(2),
  relation_pattern:z.enum(patterns),confidence:z.number().min(0).max(1),source_instance:id,times_validated:z.literal(1),
  created_at:utc,origin:z.object({namespace:id,claim_id:hash,source_digest:hash,evidence_digest:hash,policy:id,event_time:utc.nullable(),
    ancestry:z.array(hash).max(64),validation:z.literal("foreign_claim")}).strict(),
  local_validation:z.literal("unreviewed"),assertion_class:z.literal("hypothesis"),
}).strict();
export const ExchangeSchema=z.object({
  metadata:z.object({description:z.literal("Redacted architectural hypotheses; local validation is required."),schema_version:z.literal("2.0.0"),
    source_instance:id,exported_at:utc,total_archetypes:z.number().int().min(0).max(1000),manifest_digest:hash,
    redaction:z.literal("fixed-role-vocabulary.v1"),policy:z.literal(FEDERATION_POLICY)}).strict(),
  archetypes:z.array(ArchetypeSchema).max(1000),
}).strict();
const StoreSchema=z.object({schema:z.literal("dreamgraph.federation_store.v2"),metadata:z.object({schema_version:z.literal("2.0.0")}).strict(),
  archetypes:z.array(ArchetypeSchema).max(10000),
  imports:z.array(z.object({artifact_digest:hash,manifest_digest:hash,source_instance:id,observed_at:utc,
    imported:z.number().int(),skipped:z.number().int(),operation_id:id}).strict()).max(10000),
  exports:z.array(z.object({manifest_digest:hash,file_path:z.string(),artifact_digest:hash,observed_at:utc}).strict()).max(10000),
  quarantine:z.array(z.object({artifact_digest:hash,reason:z.string().max(2048),observed_at:utc,raw_body:z.string().max(1048576)}).strict()).max(100),
}).strict();
function federationConfig(){
  // Bad configuration cannot silently re-enable sharing.
  const config=FederationSettingsSchema.parse(process.env.DREAMGRAPH_FEDERATION?JSON.parse(process.env.DREAMGRAPH_FEDERATION):{});
  return {...config,namespace:"dg:"+timeDigest(config.instance_id??process.env.DREAMGRAPH_INSTANCE_UUID??resolve(getDataDir()))};
}
async function loadStore(){
  const raw=await readEvidenceStore("dream_archetypes.json");
  if(raw===null)return StoreSchema.parse({schema:"dreamgraph.federation_store.v2",metadata:{schema_version:"2.0.0"},archetypes:[],imports:[],exports:[],quarantine:[]});
  if((raw as {metadata?:{schema_version?:string}}).metadata?.schema_version==="1.0.0")throw new Error("FEDERATION_LEGACY_REVIEW_REQUIRED");
  return StoreSchema.parse(raw);
}
export const manifestDigest=(archetypes:z.infer<typeof ArchetypeSchema>[]):string=>timeDigest([...archetypes].sort((a,b)=>a.id.localeCompare(b.id)));
export function parseExchange(raw:string){
  const input=ExchangeSchema.parse(JSON.parse(raw));
  if(input.metadata.total_archetypes!==input.archetypes.length||manifestDigest(input.archetypes)!==input.metadata.manifest_digest)throw new Error("FEDERATION_MANIFEST_MISMATCH");
  const ids=new Set<string>();
  for(const archetype of input.archetypes){
    if(ids.has(archetype.id))throw new Error("FEDERATION_DUPLICATE_ID");ids.add(archetype.id);
    if(archetype.source_instance!==archetype.origin.namespace||archetype.origin.namespace!==input.metadata.source_instance
      ||archetype.id!=="foreign:"+archetype.origin.namespace+":"+archetype.origin.claim_id)throw new Error("FEDERATION_ORIGIN_MISMATCH");
  }
  return input;
}
function role(entity:string):typeof roles[number]{
  const id=entity.toLowerCase();
  if(/auth|login|jwt/.test(id))return "auth_component";if(/api|route|endpoint/.test(id))return "api_endpoint";
  if(/table|schema|model/.test(id))return "data_entity";if(/workflow|process|flow/.test(id))return "workflow_entity";
  if(/payment|billing|invoice/.test(id))return "financial_component";if(/email|notification|alert/.test(id))return "notification_component";
  if(/admin|dashboard/.test(id))return "admin_component";if(/search|catalog|browse/.test(id))return "discovery_component";return "system_component";
}
function pattern(relation:string):typeof patterns[number]{
  if(/security|rls|auth/.test(relation))return "security_pattern";if(/missing|gap/.test(relation))return "structural_gap";
  if(/cross_domain|bridge/.test(relation))return "cross_domain_bridge";if(/tension|resolution/.test(relation))return "tension_resolution";
  if(/symmetry|reverse/.test(relation))return "symmetry_pattern";if(/strengthen|reinforce/.test(relation))return "reinforcement_pattern";
  if(/causal|correlation/.test(relation))return "causal_pattern";return "generic_connection";
}
export async function exportArchetypes(exportPath?:string):Promise<ExportArchetypesOutput>{
  const config=federationConfig();if(!config.allow_export)throw new Error("FEDERATION_EXPORT_DISABLED");
  if(!config.anonymize)throw new Error("FEDERATION_UNREDACTED_EXPORT_NOT_SUPPORTED");
  return withGraphReconciliation(async()=>{
    const canonical=await loadCanonicalGraph(process.env.DREAMGRAPH_INSTANCE_UUID||"legacy"),store=await loadStore();
    const candidates=canonical.entities.filter(e=>e.identity.kind==="validated"&&e.assertion_class==="validated_insight");
    if(candidates.length>1000)throw new Error("FEDERATION_EXPORT_CAPACITY");
    const archetypes=candidates.map(entity=>{
      const raw=entity.payload,assessment=raw.current_evidence_assessment as {independent_roots:string[]};
      const source_digest=timeDigest([config.namespace,raw]);
      const evidence_digest=timeDigest([config.namespace,assessment.independent_roots.slice().sort()]);
      const claim_id=timeDigest([config.namespace,entity.identity.id,source_digest,evidence_digest]);
      const pattern_type=pattern(String(raw.relation??"").toLowerCase());
      return ArchetypeSchema.parse({id:"foreign:"+config.namespace+":"+claim_id,pattern_type,
        description:"Architectural "+pattern_type.replace(/_/g," ")+" hypothesis. Validate independently against local sources.",
        entity_roles:[role(String(raw.from)),role(String(raw.to))],relation_pattern:pattern_type,confidence:raw.confidence??0,
        source_instance:config.namespace,times_validated:1,created_at:raw.validated_at,
        origin:{namespace:config.namespace,claim_id,source_digest,evidence_digest,policy:FEDERATION_POLICY,event_time:raw.validated_at,
          ancestry:[evidence_digest],validation:"foreign_claim"},local_validation:"unreviewed",assertion_class:"hypothesis"});
    }).sort((a,b)=>a.id.localeCompare(b.id));
    const manifest_digest=manifestDigest(archetypes);let timestamp=new Date().toISOString();
    const prior=store.exports.find(e=>e.manifest_digest===manifest_digest);
    const outputPath=exportPath?.trim()?resolve(isAbsolute(exportPath)?exportPath:dataPath(exportPath)):dataPath("federation/exports/"+manifest_digest+".json");
    // An explicit artifact path must not overwrite the canonical graph/control stores.
    const rel=relative(resolve(getDataDir()),outputPath);
    if(rel&&!rel.startsWith(".."+sep)&&!isAbsolute(rel)&&!rel.includes(sep))throw new Error("FEDERATION_EXPORT_STORE_TARGET_FORBIDDEN");
    if(exportPath&&!isAbsolute(exportPath)&&(rel===".."||rel.startsWith(".."+sep)||isAbsolute(rel)))throw new Error("FEDERATION_EXPORT_OUT_OF_SCOPE");
    await mkdir(dirname(outputPath),{recursive:true});
    const physicalRoot=await realpath(getDataDir()),physicalParent=await realpath(dirname(outputPath)),physicalRelative=relative(physicalRoot,physicalParent);
    if(physicalParent.toLowerCase()===physicalRoot.toLowerCase())throw new Error("FEDERATION_EXPORT_STORE_TARGET_FORBIDDEN");
    if((!exportPath||!isAbsolute(exportPath))&&(physicalRelative===".."||physicalRelative.startsWith(".."+sep)||isAbsolute(physicalRelative)))throw new Error("FEDERATION_EXPORT_OUT_OF_SCOPE");
    try{if((await lstat(outputPath)).isSymbolicLink())throw new Error("FEDERATION_EXPORT_SYMLINK_TARGET");}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
    if(prior&&prior.file_path===outputPath){
      if(timeDigest(await readFile(outputPath,"utf8"))!==prior.artifact_digest)throw new Error("FEDERATION_EXPORT_ARTIFACT_CHANGED");
      return {archetypes_exported:archetypes.length,file_path:outputPath,instance_id:config.namespace,timestamp:prior.observed_at,manifest_digest};
    }
    const exchange=ExchangeSchema.parse({metadata:{description:"Redacted architectural hypotheses; local validation is required.",schema_version:"2.0.0",
      source_instance:config.namespace,exported_at:timestamp,total_archetypes:archetypes.length,manifest_digest,redaction:"fixed-role-vocabulary.v1",policy:FEDERATION_POLICY},archetypes});
    let body=JSON.stringify(exchange,null,2);
    // A prepared artifact survives publication failure. Reconcile exact manifest bytes, never overwrite a different destination.
    try{
      const existingBody=await readFile(outputPath,"utf8"),existing=parseExchange(existingBody);
      if(existing.metadata.manifest_digest!==manifest_digest||existing.metadata.source_instance!==config.namespace)throw new Error("FEDERATION_EXPORT_DESTINATION_CONFLICT");
      body=existingBody;timestamp=existing.metadata.exported_at;
    }catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;await atomicWriteFile(outputPath,body);}
    const artifact_digest=timeDigest(body);
    store.exports.push({manifest_digest,file_path:outputPath,artifact_digest,observed_at:timestamp});
    await commitGraphWrites({actor:"federation_export",operation_id:"export:"+timeDigest([manifest_digest,outputPath]),intent:{manifest_digest,outputPath},
      cause:"federation_export_manifest",writes:[{file:"dream_archetypes.json",content:JSON.stringify(StoreSchema.parse(store))}]});
    return {archetypes_exported:archetypes.length,file_path:outputPath,instance_id:config.namespace,timestamp,manifest_digest};
  });
}
export async function importArchetypes(filePath:string):Promise<ImportArchetypesOutput>{
  const config=federationConfig();if(!config.allow_import)throw new Error("FEDERATION_IMPORT_DISABLED");
  if((await stat(filePath)).size>1048576)throw new Error("FEDERATION_IMPORT_BYTE_BOUND");
  const raw=await readFile(filePath,"utf8");if(Buffer.byteLength(raw)>1048576)throw new Error("FEDERATION_IMPORT_BYTE_BOUND");
  const artifact_digest=timeDigest(raw),operation_id="import:"+artifact_digest;
  return withGraphReconciliation(async()=>{
    const prior=await findOperationReceipt(operation_id,"federation_import");
    if(prior?.result)return prior.result as unknown as ImportArchetypesOutput;
    const store=await loadStore(),timestamp=new Date().toISOString();
    let incoming:ReturnType<typeof parseExchange>|undefined,reason:string|undefined;
    try{incoming=parseExchange(raw);}catch(error){reason=String(error);}
    if(incoming)for(const row of incoming.archetypes){
      const same=store.archetypes.find(e=>e.id===row.id);
      if(same&&timeDigest(same)!==timeDigest(row)){reason="FEDERATION_ORIGIN_ID_CHANGED";break;}
      if(row.origin.namespace===config.namespace){reason="FEDERATION_SELF_IMPORT_REQUIRES_REVIEW";break;}
    }
    if(reason||!incoming){
      const result:ImportArchetypesOutput={archetypes_imported:0,archetypes_skipped:0,tensions_created:0,source_instance:incoming?.metadata.source_instance??"unknown",
        timestamp,status:"quarantined",reason:reason??"FEDERATION_INVALID",artifact_digest};
      store.quarantine.push({artifact_digest,reason:result.reason!,observed_at:timestamp,raw_body:raw});
      await commitGraphWrites({actor:"federation_import",operation_id,intent:{artifact_digest},cause:"federation_quarantine",
        writes:[{file:"dream_archetypes.json",content:JSON.stringify(StoreSchema.parse(store))}],result:result as unknown as Record<string,unknown>});
      return result;
    }
    let imported=0,skipped=0;
    for(const row of incoming.archetypes){if(store.archetypes.some(e=>e.id===row.id)){skipped++;continue;}store.archetypes.push(row);imported++;}
    store.imports.push({artifact_digest,manifest_digest:incoming.metadata.manifest_digest,source_instance:incoming.metadata.source_instance,observed_at:timestamp,imported,skipped,operation_id});
    const result:ImportArchetypesOutput={archetypes_imported:imported,archetypes_skipped:skipped,tensions_created:0,source_instance:incoming.metadata.source_instance,
      timestamp,status:"imported",artifact_digest};
    const affected=imported?await prepareEvidenceGeneration({id:"federation:"+artifact_digest,scope:["foreign:"+incoming.metadata.source_instance],
      fingerprint:incoming.metadata.manifest_digest,unknown_impact:true}):[];
    await commitGraphWrites({actor:"federation_import",operation_id,intent:{artifact_digest},cause:"foreign_hypotheses",
      writes:[{file:"dream_archetypes.json",content:JSON.stringify(StoreSchema.parse(store))},...affected],result:result as unknown as Record<string,unknown>});
    return result;
  });
}
/** Public view omits quarantined original bytes; those remain preserved in the local authority. */
export async function getArchetypes(){
  return withGraphRead(async()=>{const store=await loadStore();return {...store,quarantine:store.quarantine.map(({raw_body,...entry})=>entry)};});
}
