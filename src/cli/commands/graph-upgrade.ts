/** Operator-only offline structural migration. Installation and graph activation are separate. */
import fs from "node:fs/promises";
import path from "node:path";
import type { ParsedArgs } from "../dg.js";
import { resolveInstanceForCommand, readServerMeta, isProcessAlive } from "../utils/daemon.js";
import { LegacyGraphUpgrade, GraphUpgradePreviewSchema, GraphUpgradeRestorePreviewSchema } from "../../graph/legacy-upgrade.js";
import { releaseGraphWriter } from "../../graph/writer-lease.js";
const help = `
dg graph-upgrade — Review and migrate an existing graph (no model calls)

Usage:
  dg graph-upgrade <uuid|name> preview --out <file> [--resolutions <file>]
  dg graph-upgrade <uuid|name> apply --preview <file> --reviewed-digest <sha256:...> --review-id <id> --operation-id <id>
  dg graph-upgrade <uuid|name> restore-preview --original-operation <id> --out <file>
  dg graph-upgrade <uuid|name> restore --preview <file> --reviewed-digest <sha256:...> --review-id <id> --operation-id <id>

Preview is read-only and revision-bound. --out creates a new file outside the
instance; it refuses an existing file. Without --out the full JSON goes to stdout.
Resolutions are explicit row hashes/indexes with archive or set_id and a reason.
Apply/restore require an offline instance and no unfinished jobs/executions.
They never stop the daemon, scan sources, re-enrich, purchase or spend model credit.
Apply verifies a byte-preserving backup of every root JSON store and instance
configuration file before one journaled publication. Other directories are unchanged.
Restore is a new publication; it preserves later unrelated changes and refuses
to overwrite modified migrated files. Reuse the exact preview, digest, review
and operation IDs after an uncertain reply. --master-dir overrides the registry.
`;
const required = (flags: ParsedArgs["flags"], key: string) => {
  const value=flags[key];if(typeof value!=="string"||!value.trim())throw new Error(`--${key} is required`);return value;
};
const within=(root:string,target:string)=>{const fold=(s:string)=>process.platform==="win32"?s.toLowerCase():s;
  const relative=path.relative(fold(root),fold(target));return !relative||relative!==".."&&!relative.startsWith(".."+path.sep)&&!path.isAbsolute(relative);};
async function read(file:string,limit:number){const info=await fs.stat(file);if(!info.isFile()||info.size>limit)throw new Error("GRAPH_UPGRADE_INPUT_SIZE");return JSON.parse((await fs.readFile(file,"utf8")).replace(/^\uFEFF/,""));}
export async function cmdGraphUpgrade(positional: string[], flags: ParsedArgs["flags"]): Promise<void> {
  if(flags.help||flags.h){console.log(help);return;}
  const [query,action="preview"]=positional;
  if(!["preview","apply","restore-preview","restore"].includes(action))throw new Error("Unknown graph-upgrade action. Run dg graph-upgrade --help.");
  const {entry,instanceRoot}=await resolveInstanceForCommand(query,flags),directory=path.join(instanceRoot,"data");
  const service=new LegacyGraphUpgrade(directory,entry.uuid,path.join(instanceRoot,"config")),controller=new AbortController();
  const cancel=()=>controller.abort(new Error("GRAPH_UPGRADE_CANCELLED"));process.once("SIGINT",cancel);process.once("SIGTERM",cancel);
  try {
    if(["apply","restore"].includes(action)){
      const meta=await readServerMeta(instanceRoot);if(meta&&isProcessAlive(meta.pid))throw new Error(`Stop instance '${entry.name}' explicitly before applying a reviewed graph upgrade. Active scans/jobs must settle first.`);
      const approval={reviewed_digest:required(flags,"reviewed-digest"),review_id:required(flags,"review-id"),operation_id:required(flags,"operation-id"),signal:controller.signal};
      const raw=await read(required(flags,"preview"),512*1024*1024);
      const result=action==="apply"?await service.apply(GraphUpgradePreviewSchema.parse(raw),approval):await service.restore(GraphUpgradeRestorePreviewSchema.parse(raw),approval);
      console.log(JSON.stringify(result,null,2));return;
    }
    const preview=action==="restore-preview"?await service.previewRestore(required(flags,"original-operation")):
      await service.preview(flags.resolutions===undefined?[]:await read(required(flags,"resolutions"),2*1024*1024));
    controller.signal.throwIfAborted();
    if(flags.out===undefined){console.log(JSON.stringify(preview,null,2));return;}
    const target=path.resolve(required(flags,"out")),parent=await fs.realpath(path.dirname(target)),physicalTarget=path.join(parent,path.basename(target));
    if(within(await fs.realpath(instanceRoot),physicalTarget))throw new Error("Preview output must be outside the instance directory.");
    const handle=await fs.open(physicalTarget,"wx");try{await handle.writeFile(JSON.stringify(preview,null,2)+"\n");await handle.datasync();}finally{await handle.close();}
    console.log(JSON.stringify({action,instance_id:entry.uuid,preview_path:physicalTarget,digest:preview.digest,blockers:preview.blockers,revision:preview.revision,before:preview.before,after:preview.after,
      note:"No instance data changed. Review the entire preview before apply; schema repair, source reconstruction and enrichment are separate."},null,2));
  } finally {process.removeListener("SIGINT",cancel);process.removeListener("SIGTERM",cancel);await releaseGraphWriter(directory);}
}
