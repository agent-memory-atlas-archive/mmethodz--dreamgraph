/** Cheap, read-only format notice. Navigation never scans the graph or mutates it. */
import fs from "node:fs/promises";
import { withGraphRead } from "../utils/graph-reconciliation-barrier.js";
import { dataPath } from "../utils/paths.js";
import { loadPublicationState, publicationContentHash } from "./publication.js";
import { CANONICAL_FAMILIES } from "./read-model.js";
import { classifySchemaMajor } from "./contracts.js";
import { storeDefinition } from "./store-registry.js";
export async function graphUpgradeNotice(instance_id: string) {
  return withGraphRead(async () => {
    const publication = await loadPublicationState();
    const notices: string[] = [], files: string[] = [];
    let recorded: {operation_id:string;publication_sequence:number}|null = null;
    // A recorded review counts only with its original durable commit, never by a UI dismissal.
    try {
      const target=dataPath("graph_upgrade_log.json"),info=await fs.stat(target);
      if(info.size>1024*1024)throw new Error("UPGRADE_NOTICE_LOG_CAPACITY");
      const body=await fs.readFile(target,"utf8"),log=JSON.parse(body.replace(/^\uFEFF/,""));
      if(publication.stores["graph_upgrade_log.json"]?.hash!==publicationContentHash(body)||log.schema!=="dreamgraph.graph_upgrades.v1"||!Array.isArray(log.entries))throw new Error("UPGRADE_NOTICE_UNVERIFIED_LOG");
      const entry=log.entries.at(-1);
      if(entry&&!entry.restore_operations?.length){const receipt=Object.values(publication.receipts).find(receipt=>receipt.actor==="graph_upgrade"&&receipt.operation_id===entry.operation_id&&receipt.result?.preview_digest===entry.preview_digest);
        if(receipt)recorded={operation_id:receipt.operation_id,publication_sequence:receipt.revision.publication_sequence};}
    } catch(error) { if((error as NodeJS.ErrnoException).code!=="ENOENT")notices.push("Migration history needs recovery or review"); }
    if(!recorded)for(const family of CANONICAL_FAMILIES.filter(f=>!["plan","slice"].includes(f.kind))){
      try {
        const handle=await fs.open(dataPath(family.file),"r");
        try {const info=await handle.stat();if(info.size>128*1024*1024){notices.push("Format review required for oversized "+family.file);continue;}
          const buffer=Buffer.alloc(Math.min(info.size,8192)),read=await handle.read(buffer,0,buffer.length,0),prefix=buffer.subarray(0,read.bytesRead).toString("utf8").replace(/^\uFEFF/,"").trimStart();
          // A bounded prefix can identify a legacy flat array. Small template placeholders are excluded.
          if(info.size>8192){if(prefix.startsWith("[")||prefix.startsWith("{")&&!publication.stores[family.file])files.push(family.file);}
          else {
            const value=JSON.parse(prefix),rows=Array.isArray(value)?value:family.arrays.flatMap(key=>Array.isArray(value[key])?value[key]:[]);
            const populated=rows.some((row: any)=>row&&typeof row==="object"&&!row._schema&&!row._note);
            if(populated&&(Array.isArray(value)||!publication.stores[family.file]))files.push(family.file);
            const version=value?.schema_version??value?.metadata?.schema_version;
            if(typeof version==="string"){const classification=classifySchemaMajor(version,storeDefinition(family.file).schema_major);
              if(classification==="previous"&&populated)files.push(family.file);
              else if(!["current","previous"].includes(classification))notices.push("Unsupported declared schema in "+family.file);}
          }
        } finally {await handle.close();}
      } catch(error) {if((error as NodeJS.ErrnoException).code!=="ENOENT")notices.push("Format detection unavailable for "+family.file);}
    }
    const review=files.length>0||publication.epoch==="uninitialized"&&Object.keys(publication.stores).length>0;
    return {schema:"dreamgraph.graph_upgrade_notice.v1",instance_id,revision:publication.revision,
      state:notices.length?"inspection_required":recorded?"review_recorded":review?"review_recommended":"no_format_issue_detected",
      files,notices,recorded_review:recorded,scope:"bounded format detection; not a full migration preview or source freshness assessment",
      title:notices.length?"Graph format inspection needed":review?"Legacy graph format: migration review available":"Graph format review",
      message:"Review the structural delta before migration. Existing graph use can continue where supported. Migration is separate from a source scan and enrichment; the last full scan date does not determine graph freshness.",
      preview_command:`dg graph-upgrade ${JSON.stringify(instance_id)} preview --out graph-upgrade-preview.json`,
      apply_requires:"Reviewed preview digest, review and operation IDs, verified backup, and an offline instance with no unfinished job or execution"};
  });
}
