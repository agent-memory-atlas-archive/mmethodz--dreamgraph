/** Operator-only offline structural migration. Installation and graph activation are separate. */
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ParsedArgs } from "../dg.js";
import { resolveInstanceForCommand, readServerMeta, isProcessAlive } from "../utils/daemon.js";
import { LegacyGraphUpgrade, GraphUpgradePreviewSchema, GraphUpgradeRestorePreviewSchema, type GraphUpgradePreview, type GraphUpgradeRestorePreview, type GraphUpgradeProgress } from "../../graph/legacy-upgrade.js";
import { releaseGraphWriter } from "../../graph/writer-lease.js";
const help = `
dg graph-upgrade — Review and migrate an existing graph (no model calls)

Usage:
  dg graph-upgrade <uuid|name> [--dry-run] [--preserve-conflicts] [--out <file>] [--resolutions <file>] [--json]
  dg graph-upgrade <uuid|name> preview [--preserve-conflicts] [--out <file>] [--resolutions <file>] [--json]
  dg graph-upgrade <uuid|name> apply --preview <file> --reviewed-digest <sha256:...> --review-id <id> --operation-id <id>
  dg graph-upgrade <uuid|name> restore-preview --original-operation <id> [--out <file>] [--json]
  dg graph-upgrade <uuid|name> restore --preview <file> --reviewed-digest <sha256:...> --review-id <id> --operation-id <id>

With no action, the command analyzes, creates a verified backup and applies the
structural upgrade. Stop the instance explicitly and settle active work first.
--dry-run (or preview) only analyzes; no instance data is changed.
Normal output shows working stages and gathered statistics. --json requests
machine output: a bounded result for upgrades, the full review for previews.
--out saves the full revision-bound review to a new file outside the instance.
An upgrade also saves recovery details beside it; without --out both are saved
under the master directory's graph-upgrade-reviews/. Existing files are refused.
Unresolved relationships are graph diagnostics, separate from
structural migration blockers; they are preserved for explicit reviewed repair.
Resolutions are explicit row hashes/indexes with archive or set_id and a reason.
--preserve-conflicts explicitly preserves every conflicting revision in its
store's quarantined legacy history. No revision is selected as canonical.
Unrelated records remain usable; the affected identities stay unresolved.
The same verified backup, reviewed publication and restore guarantees apply.
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
type Preview = GraphUpgradePreview | GraphUpgradeRestorePreview;
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString("en-US") : "unknown";
const excerpt = (value: unknown, limit = 180) => String(value).replace(/[\r\n\x00-\x1f\x7f]/g, " ").slice(0, limit);
/** Console output stays bounded; the exact review/digest and all diagnostics remain in JSON. */
function printPreviewSummary(action: string, name: string, preview: Preview, target?: string, outcome: "preview" | "committed" | "blocked" = "preview"): void {
  const before = preview.before, after = preview.after, state = object(after.state);
  const diagnostics = new Map<string, number>();
  for (const reason of Array.isArray(state.reasons) ? state.reasons : []) {
    const code = object(reason).code;
    if (typeof code === "string") diagnostics.set(code, (diagnostics.get(code) ?? 0) + 1);
  }
  const lines = [
    `Graph ${action === "restore-preview" ? "restore" : "upgrade"}${outcome === "preview" ? " preview" : ""} — ${excerpt(name)}`,
    ...(outcome === "preview" ? ["Read-only preview. No instance data changed; no migration applied."] : []),
    `Records: ${count(before.entities)} → ${count(after.entities)} · relationships: ${count(before.relationships)} → ${count(after.relationships)}`,
    `Graph completeness: ${excerpt(object(before.state).completeness)} → ${excerpt(state.completeness)}`,
    `${outcome === "committed" ? "Migrated" : "Proposed"} store changes: ${"writes" in preview ? preview.writes.length : preview.changes.length}`,
    `Migration blockers: ${count(preview.blockers.length)}`,
  ];
  for (const blocker of preview.blockers.slice(0, 5)) lines.push(`  ${excerpt(blocker)}`);
  if (preview.blockers.length > 5) lines.push(`  … ${count(preview.blockers.length - 5)} more blockers in the full review.`);
  if ("findings" in preview) {
    const preserved = preview.findings.filter(finding => finding.code === "LEGACY_CONFLICT_PRESERVED");
    if (preserved.length) {
      lines.push(`Conflicting revisions preserved in quarantined history: ${count(preserved.length)}. No canonical winner selected.`);
      lines.push("Previously rejected stores can now expose unrelated records and additional diagnostics. Increased counts do not mean references were repaired.");
    }
    const superseded = preview.findings.filter(finding => finding.code === "LEGACY_REVISION_SUPERSEDED");
    if (superseded.length) lines.push(`Earlier revisions superseded by a later recorded revision (validated_at / normalization_cycle): ${count(superseded.length)}. Kept byte-exact as history; the newest stays active.`);
    const chapters = preview.findings.filter(finding => finding.code === "LEGACY_CHAPTER_ID_ASSIGNED");
    if (chapters.length) lines.push(`Legacy story chapters given their v14 content identity: ${count(chapters.length)}.`);
    const redreams = preview.findings.filter(finding => finding.code === "LEGACY_REDREAM_ID_ASSIGNED");
    if (redreams.length) lines.push(`Unassessed re-dreams that reused an existing dream id, given their own id (<id>~c<cycle>): ${count(redreams.length)}. Content unchanged; the first dream keeps the id.`);
    if (preview.blockers.some(blocker => blocker.startsWith("CONFLICTING_DUPLICATE:"))) {
      lines.push("To retain all conflicting revisions without choosing a winner, use --preserve-conflicts; otherwise supply reviewed --resolutions.");
    }
  }
  lines.push(`Unresolved relationships: ${count(before.unresolved_endpoints)} → ${count(after.unresolved_endpoints)}`);
  if (typeof after.unresolved_endpoints === "number" && after.unresolved_endpoints > 0) {
    if (before.unresolved_endpoints === after.unresolved_endpoints) lines.push(`  ${count(after.unresolved_endpoints)} pre-existing unresolved references preserved.`);
    lines.push("  Missing, ambiguous or type-mismatched references remain unresolved. Structural migration does not repair these links.");
  }
  const codes = [...diagnostics].sort(([a], [b]) => a.localeCompare(b));
  if (codes.length) lines.push("Graph diagnostics: " + codes.slice(0, 5).map(([code, total]) => `${excerpt(code, 64)} (${count(total)})`).join(", ")
    + (codes.length > 5 ? `; ${count(codes.length - 5)} more diagnostic types in the full review.` : ""));
  if ("unknown_baselines" in preview && preview.unknown_baselines.length) {
    lines.push("Unknown historical baselines: " + preview.unknown_baselines.slice(0, 5).map(value => excerpt(value, 80)).join(", "));
  }
  lines.push(`Digest: ${preview.digest}`);
  if (target) {
    lines.push(`Full review saved: ${target}`);
    if (outcome === "preview") lines.push("Review the complete file, including proposed writes and blockers, before apply.");
  }
  else {
    const command = `dg graph-upgrade ${JSON.stringify(preview.instance_id)} ${action}`
      + ("original_operation_id" in preview ? ` --original-operation ${JSON.stringify(preview.original_operation_id)}` : "");
    lines.push("Full review has not been saved.", `Save it: ${command} --out graph-${action}.json`, `Full JSON: ${command} --json`);
  }
  if (outcome === "blocked") lines.push("Migration blocked. No graph changes applied; resolve the structural blockers before retrying.");
  if (outcome === "committed") lines.push("Migration complete.");
  console.log(lines.join("\n"));
}
function statistics(preview: Preview) {
  const summarize = (summary: Record<string, unknown>) => {
    const diagnostics: Record<string, number> = {};
    for (const reason of Array.isArray(object(summary.state).reasons) ? object(summary.state).reasons as unknown[] : []) {
      const code = object(reason).code;
      if (typeof code === "string") diagnostics[code] = (diagnostics[code] ?? 0) + 1;
    }
    return { entities: summary.entities, relationships: summary.relationships, by_kind: summary.by_kind,
      completeness: object(summary.state).completeness, unresolved_endpoints: summary.unresolved_endpoints, diagnostics };
  };
  return { before: summarize(preview.before), after: summarize(preview.after), blockers: preview.blockers.length,
    changed_files: "writes" in preview ? preview.writes.length : preview.changes.length,
    preserved_conflicting_revisions: "findings" in preview ? preview.findings.filter(finding => finding.code === "LEGACY_CONFLICT_PRESERVED").length : 0 };
}
async function saveOutsideInstance(instanceRoot: string, target: string, value: unknown) {
  const parent = await fs.realpath(path.dirname(path.resolve(target))), physicalTarget = path.join(parent, path.basename(target));
  if (within(await fs.realpath(instanceRoot), physicalTarget)) throw new Error("Preview output must be outside the instance directory.");
  const handle = await fs.open(physicalTarget, "wx");
  try { await handle.writeFile(JSON.stringify(value, null, 2) + "\n"); await handle.datasync(); } finally { await handle.close(); }
  return physicalTarget;
}
export async function cmdGraphUpgrade(positional: string[], flags: ParsedArgs["flags"]): Promise<void> {
  if(flags.help||flags.h){console.log(help);return;}
  const [query,requested="upgrade"]=positional;
  if(!["upgrade","preview","apply","restore-preview","restore"].includes(requested)||positional.length>2)throw new Error("Unknown graph-upgrade action. Run dg graph-upgrade --help.");
  if(flags["dry-run"]&&!["upgrade","preview","restore-preview"].includes(requested))throw new Error("--dry-run cannot be combined with apply or restore. Use preview or restore-preview.");
  if(flags["preserve-conflicts"]!==undefined&&flags["preserve-conflicts"]!==true)throw new Error("--preserve-conflicts is a boolean option.");
  if(flags["preserve-conflicts"]&&!["upgrade","preview"].includes(requested))throw new Error("--preserve-conflicts applies to a new upgrade or preview; apply uses the policy bound in its saved preview.");
  const action=flags["dry-run"]&&requested==="upgrade"?"preview":requested;
  if(action==="upgrade"&&["preview","reviewed-digest","review-id","operation-id"].some(key=>flags[key]!==undefined))throw new Error("Use the apply action to resume an existing reviewed upgrade.");
  const working=(message:string)=>{if(!flags.json)console.log(message);};
  working(`Checking instance '${excerpt(query??"active instance")}' for graph ${["preview","restore-preview"].includes(action)?"preview":"upgrade"}…`);
  const {entry,instanceRoot,masterDir}=await resolveInstanceForCommand(query,flags),directory=path.join(instanceRoot,"data");
  let publicationStarted=false;
  const progress=(event:GraphUpgradeProgress)=>{
    if(event.stage==="publishing"||event.stage==="published")publicationStarted=true;
    const messages:Partial<Record<GraphUpgradeProgress["stage"],string>>={
      analyzing:"Analyzing legacy graph…",mapping:"Mapping legacy identities…",validating:"Validating migration…",
      backing_up:"Creating verified backup…",backup_verified:"Verified backup… done",publishing:"Migrating graph…",published:"Graph publication confirmed.",
    };
    if(event.stage==="analyzed")working(`${count(event.entities)} records · ${count(event.relationships)} relationships`);
    else if(messages[event.stage])working(messages[event.stage]!);
  };
  const service=new LegacyGraphUpgrade(directory,entry.uuid,path.join(instanceRoot,"config"),progress),controller=new AbortController();
  const cancel=()=>controller.abort(new Error("GRAPH_UPGRADE_CANCELLED"));process.once("SIGINT",cancel);process.once("SIGTERM",cancel);
  try {
    if(["upgrade","apply","restore"].includes(action)){
      const meta=await readServerMeta(instanceRoot);if(meta&&isProcessAlive(meta.pid))throw new Error(`Stop instance '${entry.name}' explicitly before upgrading its graph. Active scans/jobs must settle first.`);
    }
    if(["apply","restore"].includes(action)){
      const approval={reviewed_digest:required(flags,"reviewed-digest"),review_id:required(flags,"review-id"),operation_id:required(flags,"operation-id"),signal:controller.signal};
      const raw=await read(required(flags,"preview"),512*1024*1024);
      const result=action==="apply"?await service.apply(GraphUpgradePreviewSchema.parse(raw),approval):await service.restore(GraphUpgradeRestorePreviewSchema.parse(raw),approval);
      console.log(JSON.stringify(result,null,2));return;
    }
    const preview=action==="restore-preview"?await service.previewRestore(required(flags,"original-operation")):
      await service.preview(flags.resolutions===undefined?[]:await read(required(flags,"resolutions"),2*1024*1024),
        flags["preserve-conflicts"] ? { preserve_conflicts: true } : {});
    controller.signal.throwIfAborted();
    if(action==="upgrade"){
      const token=randomUUID();let target:string;
      if(flags.out!==undefined)target=path.resolve(required(flags,"out"));
      else{const reviews=path.join(masterDir,"graph-upgrade-reviews");await fs.mkdir(reviews,{recursive:true});target=path.join(reviews,token+".json");}
      const previewPath=await saveOutsideInstance(instanceRoot,target,preview);
      if(preview.blockers.length){
        if(flags.json)console.log(JSON.stringify({action,status:"blocked",instance_id:entry.uuid,preview_path:previewPath,digest:preview.digest,stats:statistics(preview)},null,2));
        else printPreviewSummary(action,entry.name,preview,previewPath,"blocked");
        throw new Error("GRAPH_UPGRADE_RESOLUTIONS_REQUIRED: "+preview.blockers.length);
      }
      // The command is the operator's authorization; persist its exact review and IDs before applying.
      const approval={reviewed_digest:preview.digest,review_id:"cli-command:"+token,operation_id:"cli-graph-upgrade:"+token};
      const recovery={schema:"dreamgraph.graph_upgrade_cli_recovery.v1",instance_id:entry.uuid,master_directory:masterDir,
        preview_path:previewPath,...approval,resume_arguments:["graph-upgrade",entry.uuid,"apply","--preview",previewPath,
          "--reviewed-digest",approval.reviewed_digest,"--review-id",approval.review_id,"--operation-id",approval.operation_id,"--master-dir",masterDir]};
      const recoveryPath=await saveOutsideInstance(instanceRoot,previewPath+".recovery.json",recovery);
      working(`Recovery details saved: ${recoveryPath}`);
      controller.signal.throwIfAborted();
      let result;
      try{result=await service.apply(GraphUpgradePreviewSchema.parse(preview),{...approval,signal:controller.signal});}
      catch(error){console.error(`${publicationStarted?"Migration completion is unconfirmed":"Migration stopped before publication"}. Exact review and resume arguments: ${recoveryPath}`);throw error;}
      if(flags.json)console.log(JSON.stringify({action,status:"committed",instance_id:entry.uuid,preview_path:previewPath,recovery_path:recoveryPath,
        ...approval,...result,stats:statistics(preview)},null,2));
      else{
        working(`Verified backup: ${excerpt(result.receipt.result?.backup_id)}`);
        working(`Publication: ${result.receipt.revision.publication_sequence} · operation: ${approval.operation_id}`);
        printPreviewSummary(action,entry.name,preview,previewPath,"committed");
      }
      return;
    }
    if(flags.out===undefined){if(flags.json)console.log(JSON.stringify(preview,null,2));else printPreviewSummary(action,entry.name,preview);return;}
    const physicalTarget=await saveOutsideInstance(instanceRoot,required(flags,"out"),preview);
    if(!flags.json){printPreviewSummary(action,entry.name,preview,physicalTarget);return;}
    console.log(JSON.stringify({action,instance_id:entry.uuid,preview_path:physicalTarget,digest:preview.digest,blockers:preview.blockers,revision:preview.revision,before:preview.before,after:preview.after,
      note:"No instance data changed. Review the entire preview before apply; schema repair, source reconstruction and enrichment are separate."},null,2));
  } finally {process.removeListener("SIGINT",cancel);process.removeListener("SIGTERM",cancel);await releaseGraphWriter(directory);}
}
