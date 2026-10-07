/** Retain the source/effect-to-graph gap; unknown effects are never blindly repeated. */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { config } from "../config/config.js";
import { getActiveScope } from "../instance/index.js";
import { dataPath } from "../utils/paths.js";
import { stripBom } from "../utils/read-json.js";
import { withGraphReconciliation, withGraphRead } from "../utils/graph-reconciliation-barrier.js";
import { commitGraphWrites, recoverGraphPublication, loadPublicationState, findOperationReceipt } from "./publication.js";
import { ChangeObligationSchema, DirtyPartitionSchema } from "./contracts.js";
import { assertJobCurrent, currentJob } from "../cognitive/job-context.js";
import { isScannerTrackedFile } from "../tools/scanner-artifact-policy.js";
import { getSessionContext } from "../server/session-context.js";

const ObligationFileSchema = z.object({ schema: z.literal("dreamgraph.change_obligations.v1"), entries: z.array(ChangeObligationSchema) }).strict();
export const DirtyFileSchema = z.object({ schema: z.literal("dreamgraph.dirty_partitions.v1"), partitions: z.array(DirtyPartitionSchema).max(4096) }).strict();
type Obligation = z.infer<typeof ChangeObligationSchema>;
type DirtyFile = z.infer<typeof DirtyFileSchema>;
/** Derived/imported evidence participates in the existing generation owner; it never becomes a source obligation. */
export async function prepareEvidenceGeneration(input: {id:string;scope:string[];fingerprint:string;unknown_impact?:boolean}):Promise<Array<{file:string;content:string}>> {
  if(!input.scope.length||input.scope.length>100)throw new Error("EVIDENCE_SCOPE_BOUND");
  const partitions=await readDirtyPartitions(),partitionId=`evidence:${input.id}`,prior=partitions.partitions.find(p=>p.id===partitionId);
  if(prior?.input_fingerprint===input.fingerprint)return [];
  // G+1 supersedes execution of G, but not the unprocessed region of G.
  // An unknown region stays unknown until explicitly reconciled; a later narrow
  // observation cannot authorize work over it or falsely settle the earlier debt.
  const unsettled=prior && (prior.state!=="settled" || prior.running_generation!==null);
  const now=new Date().toISOString(),scope=[...new Set([...(unsettled?prior.scope:[]),...input.scope])].sort();
  if(scope.length>100)throw new Error("EVIDENCE_SCOPE_BOUND_REQUIRES_RECONCILIATION");
  const unknown=input.unknown_impact || !!(unsettled && prior.state==="partial" && !prior.pending_stages.length);
  if(prior){if(!unsettled)prior.first_changed_at=now;
    prior.generation++;prior.input_fingerprint=input.fingerprint;prior.scope=scope;prior.last_changed_at=now;
    prior.pending_stages=unknown?[]:["digestion"];prior.state=unknown?"partial":"ready";}
  else partitions.partitions.push({schema:"dreamgraph.dirty_partition.v1",id:partitionId,scope,generation:1,running_generation:null,
    root_cause_ids:[input.id],input_fingerprint:input.fingerprint,pending_stages:unknown?[]:["digestion"],state:unknown?"partial":"ready",
    first_changed_at:now,last_changed_at:now,stage_receipt_ids:[]});
  const content=JSON.stringify(DirtyFileSchema.parse(partitions));if(Buffer.byteLength(content)>16*1024*1024)throw new Error("EVIDENCE_GENERATION_CAPACITY");
  return [{file:"dirty_partitions.json",content}];
}
const hash = (content: string | Buffer) => "sha256:" + createHash("sha256").update(content).digest("hex");
const absent = "absent";
async function sourceHash(file: string): Promise<string> {
  try { return hash(await fs.readFile(file)); }
  catch (failure) { if ((failure as NodeJS.ErrnoException).code === "ENOENT") return absent; throw failure; }
}
async function physical(file: string): Promise<string> {
  try { return await fs.realpath(file); }
  catch (failure) {
    if ((failure as NodeJS.ErrnoException).code !== "ENOENT") throw failure;
    const parent = path.dirname(file);
    if (parent === file) throw failure;
    return path.join(await physical(parent), path.basename(file));
  }
}
/** Validate real ancestors too, including destinations which do not exist yet. */
async function sourceScope(file: string): Promise<string> {
  const absolute = await physical(path.resolve(file));
  const roots = await Promise.all(Object.entries(config.repos).map(async ([repo, root]) => ({ repo, root: await physical(path.resolve(root)) })));
  roots.sort((a, b) => b.root.length - a.root.length);
  const fold = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
  for (const { repo, root } of roots) {
    const relative = path.relative(fold(root), fold(absolute));
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) continue;
    const spelling = path.relative(root, absolute).replace(/\\/g, "/");
    return `source:${encodeURIComponent(repo)}/${spelling.split("/").map(encodeURIComponent).join("/")}`;
  }
  throw new Error("SOURCE_SCOPE_DENIED: effect is outside configured physical repository roots");
}
async function sourceForScope(scope: string): Promise<string> {
  if (!scope.startsWith("source:")) throw new Error("SOURCE_SCOPE_UNSUPPORTED");
  const [repo, ...parts] = scope.slice(7).split("/").map(decodeURIComponent);
  if (!repo || !config.repos[repo] || !parts.length) throw new Error("SOURCE_SCOPE_UNAVAILABLE");
  const file = path.resolve(config.repos[repo], ...parts);
  if (await sourceScope(file) !== scope) throw new Error("SOURCE_SCOPE_CHANGED");
  return file;
}
async function load<T>(file: string, schema: z.ZodType<T>, empty: T): Promise<T> {
  try {
    const body = await fs.readFile(dataPath(file), "utf8");
    const publication = await loadPublicationState();
    const { publicationContentHash } = await import("./publication.js");
    if (publication.stores[file] && publication.stores[file].hash !== publicationContentHash(body)) throw new Error(`UNPUBLISHED_STORE_CHANGE: ${file}`);
    return schema.parse(JSON.parse(stripBom(body)));
  } catch (failure) {
    if ((failure as NodeJS.ErrnoException).code === "ENOENT" && !(await loadPublicationState()).stores[file]) return empty;
    throw new Error(`CHANGE_LEDGER_UNAVAILABLE: ${file}: ${String(failure)}`);
  }
}
export function readChangeObligations(): Promise<z.infer<typeof ObligationFileSchema>> {
  return withGraphRead(() => load("change_obligations.json", ObligationFileSchema, { schema: "dreamgraph.change_obligations.v1", entries: [] }));
}
export function readDirtyPartitions(): Promise<DirtyFile> {
  return withGraphRead(() => load("dirty_partitions.json", DirtyFileSchema, { schema: "dreamgraph.dirty_partitions.v1", partitions: [] }));
}
function dirty(file: DirtyFile, obligation: Obligation, ledger: z.infer<typeof ObligationFileSchema>): void {
  for (const scope of obligation.scope) {
    const repository=scope.startsWith("repository:")?scope.slice(11):scope.slice(7).split("/")[0];
    const partitionId=file.partitions.some(partition=>partition.id===scope)||file.partitions.length<2048?scope:`overflow:${repository}`;
    const existing = file.partitions.find(partition => partition.id === partitionId);
    if (existing) {
      const fresh = !existing.root_cause_ids.includes(obligation.id);
      if(fresh)existing.root_cause_ids=existing.root_cause_ids.filter(id=>!ledger.entries.some(entry=>entry.id===id&&["graph_committed","failed"].includes(entry.state)));
      if(fresh&&existing.state==="settled")existing.first_changed_at=obligation.created_at;
      if (obligation.state === "failed") {
        existing.root_cause_ids = existing.root_cause_ids.filter(id => id !== obligation.id);
        if (!existing.root_cause_ids.length) { existing.pending_stages = []; existing.state = "settled"; }
        continue;
      }
      if (fresh) existing.generation++;
      existing.last_changed_at = obligation.updated_at;
      existing.input_fingerprint = hash(JSON.stringify(obligation.after_hashes));
      if (fresh) existing.root_cause_ids.push(obligation.id);
      if(existing.root_cause_ids.length>256)throw new Error("DIRTY_REGION_CAPACITY_REQUIRES_RECONCILIATION");
      existing.pending_stages = ["reconciliation", "enrichment", "digestion"];
      existing.state = "awaiting_reconciliation";
    } else if (obligation.state !== "failed") file.partitions.push({ schema: "dreamgraph.dirty_partition.v1", id: partitionId, scope: partitionId===scope?[scope]:[`repository:${repository}`], generation: 1,
      running_generation: null, root_cause_ids: [obligation.id], input_fingerprint: hash(JSON.stringify(obligation.after_hashes)),
      pending_stages: ["reconciliation", "enrichment", "digestion"], state: "awaiting_reconciliation",
      first_changed_at: obligation.created_at, last_changed_at: obligation.updated_at, stage_receipt_ids: [] });
  }
}
async function save(entry: Obligation, stage: string): Promise<void> {
  const ledger = await readChangeObligations(), partitions = await readDirtyPartitions();
  const index = ledger.entries.findIndex(candidate => candidate.id === entry.id);
  if (index < 0) ledger.entries.push(entry); else ledger.entries[index] = entry;
  // Intent is sufficient to block context admission until the effect is resolved.
  dirty(partitions, entry, ledger);
  if(ledger.entries.length>100000||Buffer.byteLength(JSON.stringify([ledger,partitions]))>16*1024*1024)throw new Error("CHANGE_LEDGER_CAPACITY_REQUIRES_ARCHIVE");
  await commitGraphWrites({ writes: [
    { file: "change_obligations.json", content: JSON.stringify(ObligationFileSchema.parse(ledger), null, 2) },
    { file: "dirty_partitions.json", content: JSON.stringify(DirtyFileSchema.parse(partitions), null, 2) },
  ], actor: entry.actor, operation_id: `${entry.operation_id}:${stage}`, scope: entry.scope, cause: "source_effect", result: { obligation_id: entry.id, state: entry.state } });
}

export interface SourceEffectInput {
  operation_id?: string; execution_id?: string; actor?: string;
  changes: Array<{ file: string; content: string | Buffer | null; expected_content?: string | Buffer | null; expected_hash?: string | null }>;
  apply: () => Promise<void>;
  /** Disposable effect/crash tests only. */
  fault_inject?: (stage: "intent_committed" | "effect_applied" | "effect_recorded") => void | Promise<void>;
}
/** A source file's repository, scope and current hash, for effects made outside DreamGraph's tools (such as a file the
 * browser saves), observed with the calls below. Null when the file is outside the configured repository roots or
 * is not a file the project scanner tracks (e.g. an application's own project file): such files get no obligation. */
export async function observeSourceFile(file: string): Promise<{ repository: string; scope: string; hash: string } | null> {
  let scope: string;
  try { scope = await sourceScope(file); }
  catch (failure) { if (String(failure).includes("SOURCE_SCOPE_DENIED")) return null; throw failure; }
  const repository = decodeURIComponent(scope.slice(7).split("/")[0]);
  const root = config.repos[repository];
  if (!root || !isScannerTrackedFile(await physical(path.resolve(root)), await physical(path.resolve(file)))) return null;
  return { repository, scope, hash: await sourceHash(file) };
}
/** Unknown-footprint process intent. The caller supplies independently observed
 * hashes afterward; a lost process acknowledgement is never retried here. */
export async function beginObservedSourceEffect(input: {operation_id:string;execution_id:string;actor:string;repositories:string[];before_hashes:Record<string,string>}):Promise<Obligation> {
  return withGraphReconciliation(async()=>{
    if (!input.repositories.length || input.repositories.length>32) throw new Error("SOURCE_OBSERVATION_SCOPE_REQUIRED");
    if((await readChangeObligations()).entries.some(entry=>entry.operation_id===input.operation_id&&entry.actor===input.actor)) throw new Error("SOURCE_EFFECT_RECOVERY_REQUIRED: operation already has a durable intent");
    const now=new Date().toISOString(),entry:Obligation={schema:"dreamgraph.change_obligation.v1",id:randomUUID(),instance_id:getActiveScope()?.uuid??"legacy",
      execution_id:input.execution_id,operation_id:input.operation_id,actor:input.actor,scope:input.repositories.map(repo=>`repository:${encodeURIComponent(repo)}`),
      state:"intent",before_hashes:input.before_hashes,after_hashes:{},graph_receipt_id:null,created_at:now,updated_at:now};
    await save(entry,"intent");return entry;
  });
}
export async function settleObservedSourceEffect(id:string,after_hashes:Record<string,string>|null):Promise<Obligation> {
  return withGraphReconciliation(async()=>{
    const entry=(await readChangeObligations()).entries.find(item=>item.id===id);
    if(!entry)throw new Error("SOURCE_OBSERVATION_INTENT_UNAVAILABLE");
    const observationDigest = after_hashes === null ? null : hash(JSON.stringify(Object.entries(after_hashes).sort(([a],[b])=>a.localeCompare(b))));
    if (!["intent","unknown"].includes(entry.state)) {
      const receipt = await findOperationReceipt(`${entry.operation_id}:observed`, entry.actor);
      // A later observation failure cannot erase an already committed observation.
      // An exact lost-reply retry recovers the current disposition, even after reconciliation.
      if (receipt?.result?.obligation_id === id && (after_hashes === null || receipt.result.observation_digest === observationDigest)) return entry;
      throw new Error("SOURCE_OBSERVATION_REPLAY_CONFLICT");
    }
    if(after_hashes===null){entry.state="unknown";entry.updated_at=new Date().toISOString();await save(entry,"unknown");return entry;}
    const oldScope=[...entry.scope],paths=[...new Set([...Object.keys(entry.before_hashes),...Object.keys(after_hashes)])].sort();
    const changed=paths.filter(key=>(entry.before_hashes[key]??absent)!==(after_hashes[key]??absent));
    // Settle the conservative repository intent before installing exact changed scopes.
    const partitions=await readDirtyPartitions();
    for(const partition of partitions.partitions.filter(item=>oldScope.includes(item.id))){partition.root_cause_ids=partition.root_cause_ids.filter(cause=>cause!==id);if(!partition.root_cause_ids.length){partition.pending_stages=[];partition.state="settled";}}
    entry.before_hashes=Object.fromEntries(changed.map(key=>[key,entry.before_hashes[key]??absent]));
    entry.after_hashes=Object.fromEntries(changed.map(key=>[key,after_hashes[key]??absent]));
    entry.scope=changed;entry.state=changed.length?"reconciliation_pending":"failed"; // failed = exact no-source-effect, the existing recovery disposition.
    entry.updated_at=new Date().toISOString();
    const ledger=await readChangeObligations();ledger.entries[ledger.entries.findIndex(item=>item.id===id)]=entry;dirty(partitions,entry,ledger);
    const content=JSON.stringify(ObligationFileSchema.parse(ledger));if(Buffer.byteLength(content)>16*1024*1024)throw new Error("CHANGE_LEDGER_CAPACITY_REQUIRES_ARCHIVE");
    await commitGraphWrites({actor:entry.actor,operation_id:`${entry.operation_id}:observed`,scope:[...oldScope,...changed],writes:[
      {file:"change_obligations.json",content},{file:"dirty_partitions.json",content:JSON.stringify(DirtyFileSchema.parse(partitions))}],
      result:{obligation_id:id,state:entry.state,source_outcome:changed.length?"changed":"no_change_in_observed_scope",observation_digest:observationDigest}});
    return entry;
  });
}
export async function managedSourceEffect(input: SourceEffectInput): Promise<Obligation> {
  for (const change of input.changes) if (change.expected_hash !== undefined && change.expected_hash !== null
    && !/^sha256:[a-f0-9]{64}$/.test(change.expected_hash)) throw new Error('SOURCE_HASH_PRECONDITION_INVALID');
  return withGraphReconciliation(async () => {
    await recoverGraphPublication();
    const operation_id = input.operation_id ?? randomUUID();
    const execution_id = input.execution_id ?? getSessionContext()?.execution_policy?.id ?? currentJob()?.id ?? null;
    if (getSessionContext()?.execution_policy && execution_id !== getSessionContext()!.execution_policy!.id) throw new Error("SOURCE_EXECUTION_ID_MISMATCH");
    const existing = (await readChangeObligations()).entries.find(entry => entry.operation_id === operation_id && entry.actor === (input.actor ?? "source_tool"));
    const scopes = await Promise.all(input.changes.map(change => sourceScope(change.file)));
    if (new Set(scopes).size !== scopes.length) throw new Error("DUPLICATE_SOURCE_EFFECT_SCOPE");
    const intended = Object.fromEntries(input.changes.map((change, index) => [scopes[index], change.content === null ? absent : hash(change.content)]));
    if (existing) {
      if (JSON.stringify(Object.entries(existing.after_hashes).sort()) !== JSON.stringify(Object.entries(intended).sort())) throw new Error("OPERATION_IDENTITY_CONFLICT");
      if (existing.execution_id !== execution_id || input.changes.some((change, index) => change.expected_content !== undefined && existing.before_hashes[scopes[index]] !== (change.expected_content === null ? absent : hash(change.expected_content)))) throw new Error("OPERATION_IDENTITY_CONFLICT");
      if (input.changes.some((change,index)=>change.expected_hash!==undefined && existing.before_hashes[scopes[index]]!==(change.expected_hash??absent))) throw new Error('OPERATION_IDENTITY_CONFLICT');
      if (existing.state === "graph_committed" || existing.state === "reconciliation_pending" || existing.state === "source_applied"
        || existing.state === "failed" && scopes.every(scope => existing.before_hashes[scope] === existing.after_hashes[scope])) return existing;
      throw new Error(`SOURCE_EFFECT_RECOVERY_REQUIRED: ${existing.id}; resolve the durable effect, never blindly repeat it`);
    }
    const before = Object.fromEntries(await Promise.all(input.changes.map(async (change, index) => {
      const current = await sourceHash(change.file);
      if (change.expected_content !== undefined && current !== (change.expected_content === null ? absent : hash(change.expected_content))) throw new Error("SOURCE_REVISION_CONFLICT");
      if (change.expected_hash !== undefined && current !== (change.expected_hash ?? absent)) throw new Error('SOURCE_REVISION_CONFLICT');
      return [scopes[index], current];
    })));
    const now = new Date().toISOString();
    const entry: Obligation = { schema: "dreamgraph.change_obligation.v1", id: randomUUID(), instance_id: getActiveScope()?.uuid ?? "legacy",
      execution_id, operation_id, actor: input.actor ?? "source_tool", scope: scopes,
      state: "intent", before_hashes: before, after_hashes: intended, graph_receipt_id: null, created_at: now, updated_at: now };
    await save(entry, "intent"); await input.fault_inject?.("intent_committed");
    try {
      // External operating discipline does not replace the tool's own CAS check.
      for (let index = 0; index < input.changes.length; index++) if (await sourceHash(input.changes[index].file) !== before[scopes[index]]) throw new Error("SOURCE_REVISION_CONFLICT");
      await assertJobCurrent();
      await input.apply(); await input.fault_inject?.("effect_applied");
      for (let index = 0; index < input.changes.length; index++) if (await sourceHash(input.changes[index].file) !== intended[scopes[index]]) throw new Error("SOURCE_EFFECT_POSTCONDITION_FAILED");
      entry.state = scopes.every(scope => before[scope] === intended[scope]) ? "failed" : "reconciliation_pending";
      entry.updated_at = new Date().toISOString();
      await save(entry, "applied"); await input.fault_inject?.("effect_recorded");
      return entry;
    } catch (failure) {
      if (["reconciliation_pending", "failed"].includes(entry.state) && (await readChangeObligations()).entries.some(saved => saved.id === entry.id && saved.state === entry.state)) {
        throw new Error(`SOURCE_EFFECT_COMMITTED_RESULT_UNAVAILABLE: ${entry.id}; recover the saved obligation instead of repeating the effect`);
      }
      // Preserve uncertainty even when the operation threw after a successful write.
      entry.state = "unknown"; entry.updated_at = new Date().toISOString();
      await save(entry, "unknown").catch(() => undefined);
      throw new Error(`SOURCE_EFFECT_RECOVERY_REQUIRED: ${entry.id}: ${String(failure)}`);
    }
  });
}
export async function managedSourceWrite(file: string, content: string, expected_content?: string): Promise<Obligation> {
  return managedSourceEffect({ changes: [{ file, content, ...(expected_content === undefined ? {} : { expected_content }) }], apply: () => fs.writeFile(file, content, "utf8") });
}
/** Recovery inspects exact saved hashes. It never repeats the external mutation. */
export async function recoverSourceEffects(): Promise<{ resolved: string[]; unknown: string[] }> {
  return withGraphReconciliation(async () => {
    await recoverGraphPublication();
    const ledger = await readChangeObligations(); const result = { resolved: [] as string[], unknown: [] as string[] };
    for (const entry of ledger.entries.filter(entry => entry.state === "intent" || entry.state === "unknown")) {
      let hashes: Record<string, string>;
      try { hashes = Object.fromEntries(await Promise.all(entry.scope.map(async scope => [scope, await sourceHash(await sourceForScope(scope))]))); }
      catch { result.unknown.push(entry.id); continue; }
      const matches = (expected: Record<string, string>) => entry.scope.every(scope => hashes[scope] === expected[scope]);
      if (matches(entry.after_hashes)) entry.state = matches(entry.before_hashes) ? "failed" : "reconciliation_pending";
      else if (matches(entry.before_hashes)) entry.state = "failed";
      else { result.unknown.push(entry.id); continue; }
      entry.updated_at = new Date().toISOString();
      await save(entry, `recovery:${hash(JSON.stringify(hashes))}`); result.resolved.push(entry.id);
    }
    return result;
  });
}

/** Called only inside a graph publication. The caller must actually reconcile these scopes. */
export async function prepareChangeReconciliation(ids: string[], operation_id: string): Promise<Array<{ file: string; content: string }>> {
  const ledger = await readChangeObligations(), partitions = await readDirtyPartitions();
  for (const id of new Set(ids)) {
    const entry = ledger.entries.find(candidate => candidate.id === id);
    if (!entry) throw new Error(`CHANGE_OBLIGATION_MISSING: ${id}`);
    if (entry.state === "graph_committed" && entry.graph_receipt_id === operation_id) continue;
    if (entry.state !== "reconciliation_pending" && entry.state !== "source_applied") throw new Error(`CHANGE_OBLIGATION_NOT_RECONCILABLE: ${id}: ${entry.state}`);
    for (const scope of entry.scope) {
      const current=await sourceHash(await sourceForScope(scope));
      let expected=entry.after_hashes[scope];
      // A source reconciliation may cover a verified chain of coalesced managed edits.
      // An external/unconfirmed discontinuity never receives this acknowledgement.
      for(const later of ledger.entries.slice(ledger.entries.indexOf(entry)+1).filter(later=>later.scope.includes(scope)&&later.state!=="failed")) {
        if(!["source_applied","reconciliation_pending","graph_committed"].includes(later.state)||later.before_hashes[scope]!==expected)throw new Error(`CHANGE_OBLIGATION_SOURCE_CHAIN_UNKNOWN: ${scope}`);
        expected=later.after_hashes[scope];
      }
      if(current!==expected)throw new Error(`CHANGE_OBLIGATION_SOURCE_CHANGED: ${scope}`);
    }
    entry.state = "graph_committed"; entry.graph_receipt_id = operation_id; entry.updated_at = new Date().toISOString();
    for (const partition of partitions.partitions.filter(partition => entry.scope.includes(partition.id)||partition.root_cause_ids.includes(entry.id))) {
      const otherPending = partition.root_cause_ids.some(cause => {
        const other = ledger.entries.find(candidate => candidate.id === cause);
        return other && !["graph_committed", "failed"].includes(other.state);
      });
      if (!otherPending) {
        partition.pending_stages = partition.pending_stages.filter(stage => stage !== "reconciliation");
        partition.state = partition.pending_stages.length ? "ready" : "settled";
      }
      if (!partition.stage_receipt_ids.includes(operation_id)) partition.stage_receipt_ids.push(operation_id);
    }
  }
  return [{ file: "change_obligations.json", content: JSON.stringify(ledger, null, 2) }, { file: "dirty_partitions.json", content: JSON.stringify(partitions, null, 2) }];
}
