/** Reviewed physical legacy repairs over the existing publication owner; no model or source scan. */
import fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { withDataDirectory } from "../utils/paths.js";
import { withGraphRead, withGraphReconciliation } from "../utils/graph-reconciliation-barrier.js";
import { atomicWriteFileRaw } from "../utils/atomic-write.js";
import { assertGraphWriter } from "./writer-lease.js";
import { CANONICAL_FAMILIES, legacyIdentity, loadCanonicalGraph, type CanonicalGraphRead } from "./read-model.js";
import { EngineJobsStoreSchema } from "../cognitive/jobs.js";
import { ManagedExecutionStoreSchema } from "./execution-context.js";
import { decodePlanAuthorityStore } from "../discipline/plan-authority.js";
import { prepareEvidenceGeneration } from "./change-obligations.js";
import { STORE_REGISTRY, storeDefinition } from "./store-registry.js";
import { classifySchemaMajor, RevisionVectorSchema } from "./contracts.js";
import { loadPublicationState, commitGraphWrites, findOperationReceipt, publicationContentHash,
  recoverGraphPublication, PUBLICATION_FILE, JOURNAL_FILE, type PublicationState, type CommitGraphInput } from "./publication.js";

const FILE = "graph_upgrade_log.json", PRIVATE = ".graph-upgrades";
const MAX_FILE = 128 * 1024 * 1024, MAX_TOTAL = 512 * 1024 * 1024, MAX_ROWS = 100_000;
const id = z.string().min(1).max(1024), sha = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const file = z.string().regex(/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.json$/).refine(name => !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(name));
const stable = (value: unknown): string => value === null || typeof value !== "object" ? JSON.stringify(value)
  : Array.isArray(value) ? "[" + value.map(stable).join(",") + "]" : "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + stable((value as Record<string, unknown>)[key])).join(",") + "}";
const hash = (bytes: string | Buffer) => "sha256:" + createHash("sha256").update(bytes).digest("hex");
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): string | null => typeof value === "string" && value.length > 0 ? value : null;
const fold = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
const within = (root: string, target: string) => { const relative = path.relative(fold(root), fold(target)); return relative === "" || relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative); };
const ResolutionSchema = z.object({ file, collection: id, index: z.number().int().nonnegative(), row_hash: sha,
  action: z.enum(["archive", "set_id"]), new_id: id.optional(), reason: z.string().min(1).max(2000) }).strict();
export type GraphUpgradeResolution = z.infer<typeof ResolutionSchema>;
const FileStampSchema = z.object({ file, hash: sha.nullable(), semantic_hash: sha.nullable(), bytes: z.number().int().nonnegative() }).strict();
const ConfigStampSchema = z.object({file:z.string().regex(/^[a-zA-Z0-9_.-]+$/),hash:sha,bytes:z.number().int().nonnegative()}).strict();
const FindingSchema = z.object({ code: id, file, collection: z.string(), index: z.number().int().nonnegative(), row_hash: sha.nullable(),
  original_id: z.string().nullable(), new_id: z.string().nullable(), disposition: z.enum(["retained", "assigned", "renamed", "archived", "blocked"]) }).strict();
export const GraphUpgradePreviewSchema = z.object({ schema: z.literal("dreamgraph.graph_upgrade_preview.v1"), instance_id: id, directory_hash: sha,
  created_at: z.string().datetime(), epoch: id, revision: RevisionVectorSchema, files: z.array(FileStampSchema).max(4096),
  config_directory_hash:sha.nullable(),config_files:z.array(ConfigStampSchema).max(64),
  resolutions: z.array(ResolutionSchema).max(4096), findings: z.array(FindingSchema).max(MAX_ROWS), blockers: z.array(id).max(MAX_ROWS),
  unknown_baselines: z.array(id), readonly_owners: z.array(id),
  writes: z.array(z.object({ file, content: z.string(), before_hash: sha, after_hash: sha }).strict()).max(32),
  before: z.record(z.unknown()), after: z.record(z.unknown()), digest: sha }).strict();
export type GraphUpgradePreview = z.infer<typeof GraphUpgradePreviewSchema>;
export const GraphUpgradeRestorePreviewSchema = z.object({ schema:z.literal("dreamgraph.graph_upgrade_restore_preview.v1"),
  instance_id:id,directory_hash:sha,created_at:z.string().datetime(),epoch:id,revision:RevisionVectorSchema,
  original_operation_id:id,backup_id:z.string().uuid(),backup_hash:sha,files:z.array(FileStampSchema).max(4096),
  config_directory_hash:sha.nullable(),config_files:z.array(ConfigStampSchema).max(64),
  changes:z.array(ChangeSchemaForRestore()).max(32),blockers:z.array(id).max(32),before:z.record(z.unknown()),after:z.record(z.unknown()),digest:sha }).strict();
function ChangeSchemaForRestore(){return z.object({file,before_hash:sha,after_hash:sha}).strict();}
export type GraphUpgradeRestorePreview = z.infer<typeof GraphUpgradeRestorePreviewSchema>;
interface InputFile { file: string; bytes: Buffer; body: string; value: unknown; semantic_hash: string; hash: string }
interface Snapshot { physical: string; publication: PublicationState; files: Map<string, InputFile>; stamps: z.infer<typeof FileStampSchema>[];
  config_directory_hash:string|null;config_files:z.infer<typeof ConfigStampSchema>[];config_bytes:Map<string,Buffer> }
const ChangeSchema = z.object({ file, before_hash: sha, after_hash: sha }).strict();
const UpgradeEntrySchema = z.object({ operation_id: id, preview_digest: sha, review_id: id, backup_id: z.string().uuid(),
  backup_hash: sha, prepared_at: z.string().datetime(), changes: z.array(ChangeSchema).max(32),
  restore_operations: z.array(id).max(128) }).strict();
const LogSchema = z.object({ schema: z.literal("dreamgraph.graph_upgrades.v1"), entries: z.array(UpgradeEntrySchema).max(128) }).strict();
const BackupSchema = z.object({ schema: z.literal("dreamgraph.graph_upgrade_backup.v1"), instance_id: id, directory_hash: sha,
  backup_id: z.string().uuid(), preview_digest: sha, epoch: id, revision: RevisionVectorSchema,
  files: z.array(z.object({ file, hash: sha, blob: z.string().regex(/^\d{4}\.bin$/), bytes: z.number().int().nonnegative() }).strict()).max(4096),
  config_directory_hash:sha.nullable(),config_files:z.array(ConfigStampSchema.extend({blob:z.string().regex(/^config-\d{4}\.bin$/)})).max(64) }).strict();
export interface GraphUpgradeApproval { reviewed_digest: string; review_id: string; operation_id: string; signal?: AbortSignal;
  /** Disposable fault/restart tests only; never transported from CLI/HTTP. */ fault_inject?: CommitGraphInput["fault_inject"] }

/** Pins the physical instance. CLI mutation commands are offline and cannot steal a running daemon's writer. */
export class LegacyGraphUpgrade {
  constructor(readonly directory: string, readonly instance_id: string, readonly config_directory?:string) { id.parse(instance_id); }
  private scope<T>(work: () => T): T { return withDataDirectory(this.directory, work); }
  private async readSnapshot(): Promise<Snapshot> {
    const physical = await fs.realpath(this.directory), publication = await loadPublicationState();
    const names = (await fs.readdir(physical, { withFileTypes: true })).filter(entry => entry.name.endsWith(".json"));
    if (names.length > 4096) throw new Error("GRAPH_UPGRADE_FILE_CAPACITY");
    const files = new Map<string, InputFile>(); let total = 0;
    for (const entry of names.sort((a,b) => a.name.localeCompare(b.name))) {
      file.parse(entry.name); if (!entry.isFile() || entry.isSymbolicLink()) throw new Error("GRAPH_UPGRADE_LINK_OR_KIND_REJECTED");
      if (entry.name === JOURNAL_FILE) throw new Error("GRAPH_RECOVERY_REQUIRED");
      const target = path.join(physical, entry.name), before = await fs.stat(target);
      if (before.size > MAX_FILE || (total += before.size) > MAX_TOTAL) throw new Error("GRAPH_UPGRADE_BYTE_CAPACITY");
      const bytes = await fs.readFile(target), after = await fs.stat(target);
      if (bytes.length !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error("GRAPH_UPGRADE_INPUT_CHANGED");
      let body: string, value: unknown;
      try { body = new TextDecoder("utf-8", { fatal: true }).decode(bytes); value = JSON.parse(body.replace(/^\uFEFF/, "")); }
      catch { throw new Error("GRAPH_UPGRADE_INVALID_JSON_OR_ENCODING: " + entry.name); }
      const semantic_hash = publicationContentHash(body);
      if (publication.stores[entry.name] && publication.stores[entry.name].hash !== semantic_hash) throw new Error("GRAPH_UPGRADE_UNPUBLISHED_INPUT: " + entry.name);
      files.set(entry.name, { file: entry.name, bytes, body, value, semantic_hash, hash: hash(bytes) });
    }
    const stamps = [...new Set([...Object.keys(STORE_REGISTRY), ...files.keys()])].sort().map(file => {
      const input = files.get(file); return { file, hash: input?.hash ?? null, semantic_hash: input?.semantic_hash ?? null, bytes: input?.bytes.length ?? 0 };
    });
    const config_files:Snapshot["config_files"]=[],config_bytes=new Map<string,Buffer>();let config_directory_hash:string|null=null;
    if(this.config_directory){
      const configRoot=await fs.realpath(this.config_directory);
      if(fold(path.dirname(configRoot))!==fold(path.dirname(physical)))throw new Error("GRAPH_UPGRADE_CONFIG_SCOPE");
      config_directory_hash=hash(fold(configRoot));
      const configs=await fs.readdir(configRoot,{withFileTypes:true});if(configs.length>64)throw new Error("GRAPH_UPGRADE_CONFIG_CAPACITY");
      for(const entry of configs.sort((a,b)=>a.name.localeCompare(b.name))){
        if(!entry.isFile()||entry.isSymbolicLink()||! /^[a-zA-Z0-9_.-]+$/.test(entry.name))throw new Error("GRAPH_UPGRADE_CONFIG_LINK_OR_KIND");
        const target=path.join(configRoot,entry.name),before=await fs.stat(target,{bigint:true});
        if(before.size>BigInt(10*1024*1024)||(total+=Number(before.size))>MAX_TOTAL)throw new Error("GRAPH_UPGRADE_BYTE_CAPACITY");
        const bytes=await fs.readFile(target),after=await fs.stat(target,{bigint:true});
        if([before.dev,before.ino,before.size,before.mtimeNs,before.ctimeNs].join(":")!==[after.dev,after.ino,after.size,after.mtimeNs,after.ctimeNs].join(":"))throw new Error("GRAPH_UPGRADE_CONFIG_CHANGED");
        config_files.push({file:entry.name,hash:hash(bytes),bytes:bytes.length});config_bytes.set(entry.name,bytes);
      }
    }
    return { physical, publication, files, stamps, config_directory_hash, config_files, config_bytes };
  }
  private repair(snapshot: Snapshot, resolutions: GraphUpgradeResolution[]) {
    const findings: GraphUpgradePreview["findings"] = [], blockers: string[] = [], writes: GraphUpgradePreview["writes"] = [];
    const requested = new Map<string, GraphUpgradeResolution>(), used = new Set<string>();
    const address = (file: string, collection: string, index: number) => stable([file, collection, index]);
    for (const resolution of resolutions) { ResolutionSchema.parse(resolution); const key = address(resolution.file, resolution.collection, resolution.index);
      if (requested.has(key)) throw new Error("GRAPH_UPGRADE_RESOLUTION_DUPLICATE"); requested.set(key, resolution); }
    for (const family of CANONICAL_FAMILIES) {
      const input = snapshot.files.get(family.file); if (!input || ["plan", "slice"].includes(family.kind)) continue;
      const value = structuredClone(input.value), header = object(value) ? value : null;
      const version = text(header?.schema_version ?? header?.metadata?.schema_version);
      if (version && !["current", "previous"].includes(classifySchemaMajor(version, storeDefinition(family.file).schema_major))) { blockers.push("UNSUPPORTED_STORE_SCHEMA: " + family.file); continue; }
      const matching = header ? family.arrays.filter(key => Array.isArray(header[key])) : [];
      if (!Array.isArray(value) && matching.length !== 1) { blockers.push("INVALID_STORE_SHAPE: " + family.file); continue; }
      const collections: Array<[string, any[]]> = Array.isArray(value) ? [["$root", value]] : [[matching[0], header![matching[0]]]];
      if (family.kind === "tension" && Array.isArray(header?.resolved_tensions)) collections.push(["resolved_tensions", header!.resolved_tensions]);
      if (family.kind === "narrative") for (const key of ["digests", "weekly_digests"]) if (Array.isArray(header?.[key])) collections.push([key, header![key]]);
      let changed = false;
      for (const [collection, entries] of collections) {
        if (entries.length > MAX_ROWS) throw new Error("GRAPH_UPGRADE_ROW_CAPACITY");
        const retained: any[] = [], groups = new Map<string, { row: any; index: number; row_hash: string; identity: string }>();
        for (let index = 0; index < entries.length; index++) {
          const row = entries[index]; if (!object(row)) { blockers.push("INVALID_ENTITY: " + family.file + "/" + collection + "/" + index); continue; }
          if (row._schema || row._note) { retained.push(row); continue; }
          const row_hash = hash(stable(row)), key = address(family.file, collection, index), resolution = requested.get(key);
          let identity = legacyIdentity(family, row);
          const original_id = identity;
          if (resolution) {
            used.add(key); if (resolution.row_hash !== row_hash) throw new Error("GRAPH_UPGRADE_RESOLUTION_CHANGED");
            if (resolution.action === "archive") { changed = true; findings.push({ code: "REVIEWED_ROW_ARCHIVE", file: family.file, collection, index, row_hash, original_id, new_id: null, disposition: "archived" }); continue; }
            if (!resolution.new_id || family.kind === "candidate" && Number.isSafeInteger(row.normalization_cycle) && text(row.dream_id)) throw new Error("GRAPH_UPGRADE_ASSESSMENT_REQUIRES_EXPLICIT_ARCHIVE_SELECTION");
            row.id = resolution.new_id; identity = legacyIdentity(family, row)!; changed = true;
            findings.push({ code: "REVIEWED_ID_MAPPING", file: family.file, collection, index, row_hash, original_id, new_id: identity, disposition: "renamed" });
          }
          if (!identity) { identity = "legacy:" + family.kind + ":" + hash(stable([family.file, collection, row])).slice(7,31); row.id = identity; changed = true;
            findings.push({ code: "MISSING_ID_ASSIGNED", file: family.file, collection, index, row_hash, original_id: null, new_id: identity, disposition: "assigned" }); }
          // Assessment history keeps its original artifact/cycle; no latest winner or independent support is invented.
          const grouping = family.file === "candidate_edges.json" && text(row.dream_id) && ["edge","node"].includes(row.dream_type) && Number.isSafeInteger(row.normalization_cycle)
            ? stable(["assessment", row.dream_type, row.dream_id, row.normalization_cycle]) : stable(["identity", identity, row.source_repo ?? null]);
          const prior = groups.get(grouping);
          if (prior) {
            if (stable(prior.row) === stable(row)) { changed = true; findings.push({ code: "EXACT_DUPLICATE_ARCHIVED", file: family.file, collection, index, row_hash, original_id, new_id: prior.identity, disposition: "archived" }); continue; }
            blockers.push("CONFLICTING_DUPLICATE: " + family.file + "/" + collection + "/" + prior.index + "," + index);
            findings.push({ code: "CONFLICTING_DUPLICATE", file: family.file, collection, index, row_hash, original_id, new_id: null, disposition: "blocked" });
          } else groups.set(grouping, { row, index, row_hash, identity });
          retained.push(row);
        }
        if (Array.isArray(value)) { value.length = 0; for (const row of retained) value.push(row); } else header![collection] = retained;
      }
      if (changed) { const content = JSON.stringify(value); writes.push({ file: family.file, content, before_hash: input.hash, after_hash: hash(content) }); }
    }
    if ([...requested.keys()].some(key => !used.has(key))) throw new Error("GRAPH_UPGRADE_RESOLUTION_TARGET_MISSING");
    return { findings, blockers, writes };
  }
  private summary(graph: CanonicalGraphRead) { return { state: { ...graph.state, reasons: graph.state.reasons.map(({ code, scope }) => ({code,scope})) }, entities: graph.entities.length, relationships: graph.relationships.length,
    by_kind: Object.fromEntries(CANONICAL_FAMILIES.map(f => [f.kind, graph.entities.filter(e => e.identity.kind === f.kind).length])), unresolved_endpoints: graph.relationships.filter(r => !r.source || !r.target).length }; }
  private introducedFailures(before: CanonicalGraphRead, after: CanonicalGraphRead): string[] {
    const prior = new Set(before.state.reasons.map(reason => stable([reason.code, reason.scope])));
    return after.state.reasons.filter(reason => !prior.has(stable([reason.code, reason.scope])) &&
      ["AMBIGUOUS_IDENTITY", "MISSING_ENTITY_ID", "DUPLICATE_TYPED_ID", "INVALID_ENTITY", "INVALID_STORE_SHAPE"].includes(reason.code))
      .map(reason => "STAGED_GRAPH_INVALID: " + reason.code + ":" + reason.scope.join(","));
  }
  private async stage(snapshot: Snapshot, writes: GraphUpgradePreview["writes"]) {
    const directory = await fs.mkdtemp(path.join(tmpdir(), "dg-upgrade-stage-"));
    if (!within(path.resolve(tmpdir()), path.resolve(directory)) || !path.basename(directory).startsWith("dg-upgrade-stage-")) throw new Error("GRAPH_UPGRADE_STAGE_SCOPE");
    try {
      for (const input of snapshot.files.values()) await fs.writeFile(path.join(directory, input.file), input.bytes);
      const publication = structuredClone(snapshot.publication);
      for (const write of writes) { await fs.writeFile(path.join(directory, write.file), write.content); publication.stores[write.file] = { hash: publicationContentHash(write.content), domain: storeDefinition(write.file).domain }; }
      await fs.writeFile(path.join(directory, PUBLICATION_FILE), JSON.stringify(publication));
      return await withDataDirectory(directory, () => loadCanonicalGraph(this.instance_id));
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  }
  preview(resolutions: GraphUpgradeResolution[] = []): Promise<GraphUpgradePreview> {
    return this.scope(() => withGraphRead(async () => {
      const snapshot = await this.readSnapshot(), repair = this.repair(snapshot, resolutions);
      const before = await loadCanonicalGraph(this.instance_id), after = await this.stage(snapshot, repair.writes);
      repair.blockers.push(...this.introducedFailures(before, after));
      const result = { schema: "dreamgraph.graph_upgrade_preview.v1" as const, instance_id: this.instance_id, directory_hash: hash(fold(snapshot.physical)),
        created_at: new Date().toISOString(), epoch: snapshot.publication.epoch, revision: snapshot.publication.revision, files: snapshot.stamps,
        config_directory_hash:snapshot.config_directory_hash,config_files:snapshot.config_files,
        resolutions, ...repair, unknown_baselines: ["scan_state.json", "enrichment_state.json"].filter(file => !snapshot.files.has(file)),
        readonly_owners: ["C14 plan/slice authority and recorded progress", "source/normalization evidence", "jobs/execution/grants/spend", "configuration", "unknown extension/history files"],
        before: this.summary(before), after: this.summary(after) };
      return GraphUpgradePreviewSchema.parse({ ...result, digest: hash(stable(result)) });
    }));
  }
  private quiescent(snapshot: Snapshot) {
    const jobs = snapshot.files.get("jobs.json")?.value, executions = snapshot.files.get("execution_contexts.json")?.value, plans = snapshot.files.get("plan_state.json")?.value;
    if (jobs !== undefined) { const owner = EngineJobsStoreSchema.parse(jobs);
      if(owner.instance_id!==this.instance_id)throw new Error("GRAPH_UPGRADE_JOB_INSTANCE_MISMATCH");
      if(owner.records.some(record=> !["cancelled","succeeded","failed","partial"].includes(record.job.state) || !record.work_settled || record.external_effects.some(effect=>effect.state!=="acknowledged"))) throw new Error("GRAPH_UPGRADE_ACTIVE_OR_UNCONFIRMED_JOB"); }
    if (executions !== undefined && ManagedExecutionStoreSchema.parse(executions).entries.some(entry => !["no_change","state_committed","graph_committed"].includes(entry.status) || entry.plan_closure?.effective_termination === "unconfirmed")) throw new Error("GRAPH_UPGRADE_ACTIVE_OR_UNCONFIRMED_EXECUTION");
    if (plans !== undefined && object(plans) && plans.schema === "dreamgraph.plan_authority.v1" && Object.values(decodePlanAuthorityStore(plans).records).some(record => record.state.leases.length)) throw new Error("GRAPH_UPGRADE_ACTIVE_PLAN_LEASE");
  }
  private log(snapshot: Snapshot) { return LogSchema.parse(snapshot.files.get(FILE)?.value ?? { schema: "dreamgraph.graph_upgrades.v1", entries: [] }); }
  private async privateDirectory(backup_id?: string, create = false) {
    const physical = await fs.realpath(this.directory), root = path.join(physical, PRIVATE);
    for (const target of backup_id ? [root, path.join(root, z.string().uuid().parse(backup_id))] : [root]) {
      try { const info = await fs.lstat(target); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("GRAPH_UPGRADE_BACKUP_LINK_REJECTED"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT" || !create) throw error; await fs.mkdir(target); }
      if (!within(physical, await fs.realpath(target))) throw new Error("GRAPH_UPGRADE_BACKUP_SCOPE");
    }
    return backup_id ? path.join(root, backup_id) : root;
  }
  private async backup(snapshot: Snapshot, preview: GraphUpgradePreview, signal?: AbortSignal) {
    const backup_id = randomUUID(), directory = await this.privateDirectory(backup_id, true), files = [];
    let index = 0;
    for (const input of snapshot.files.values()) {
      signal?.throwIfAborted(); const blob = String(index++).padStart(4,"0") + ".bin", handle = await fs.open(path.join(directory, blob), "wx");
      try { await handle.writeFile(input.bytes); await handle.datasync(); } finally { await handle.close(); }
      files.push({ file: input.file, hash: input.hash, blob, bytes: input.bytes.length });
    }
    const config_files=[];index=0;
    for(const input of snapshot.config_files){signal?.throwIfAborted();const blob="config-"+String(index++).padStart(4,"0")+".bin",handle=await fs.open(path.join(directory,blob),"wx");
      try{await handle.writeFile(snapshot.config_bytes.get(input.file)!);await handle.datasync();}finally{await handle.close();}config_files.push({...input,blob});}
    const manifest = BackupSchema.parse({ schema: "dreamgraph.graph_upgrade_backup.v1", instance_id: this.instance_id, directory_hash: preview.directory_hash,
      backup_id, preview_digest: preview.digest, epoch: preview.epoch, revision: preview.revision, files,
      config_directory_hash:snapshot.config_directory_hash,config_files });
    const content = JSON.stringify(manifest); await atomicWriteFileRaw(path.join(directory,"manifest.json"), content);
    await this.verifyBackup(backup_id, hash(content)); return { backup_id, backup_hash: hash(content) };
  }
  private async verifyBackup(backup_id: string, expected_hash: string) {
    const directory = await this.privateDirectory(backup_id), target = path.join(directory,"manifest.json"), info = await fs.lstat(target);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) throw new Error("GRAPH_UPGRADE_BACKUP_LINK_OR_SIZE_REJECTED");
    const content = await fs.readFile(target,"utf8");
    if (hash(content) !== expected_hash) throw new Error("GRAPH_UPGRADE_BACKUP_MANIFEST_CHANGED");
    const manifest = BackupSchema.parse(JSON.parse(content));
    if (manifest.instance_id !== this.instance_id || manifest.directory_hash !== hash(fold(await fs.realpath(this.directory))) || manifest.backup_id !== backup_id) throw new Error("GRAPH_UPGRADE_BACKUP_OWNER_MISMATCH");
    const files = new Map<string, Buffer>();
    for (const input of manifest.files) { const target = path.join(directory,input.blob), info = await fs.lstat(target);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error("GRAPH_UPGRADE_BACKUP_LINK_REJECTED");
      const bytes = await fs.readFile(target); if (bytes.length !== input.bytes || hash(bytes) !== input.hash || files.has(input.file)) throw new Error("GRAPH_UPGRADE_BACKUP_CHANGED"); files.set(input.file, bytes); }
    const configs=new Set<string>();
    for(const input of manifest.config_files){const target=path.join(directory,input.blob),info=await fs.lstat(target);
      if(!info.isFile()||info.isSymbolicLink()||info.size!==input.bytes||configs.has(input.file))throw new Error("GRAPH_UPGRADE_BACKUP_CONFIG_CHANGED");
      if(hash(await fs.readFile(target))!==input.hash)throw new Error("GRAPH_UPGRADE_BACKUP_CONFIG_CHANGED");configs.add(input.file);}
    return { manifest, files };
  }
  async apply(raw: GraphUpgradePreview, approval: GraphUpgradeApproval) {
    const preview = GraphUpgradePreviewSchema.parse(raw), { digest, ...bound } = preview;
    if (digest !== hash(stable(bound)) || digest !== sha.parse(approval.reviewed_digest)) throw new Error("GRAPH_UPGRADE_REVIEW_CHANGED");
    id.parse(approval.review_id); id.parse(approval.operation_id);
    if (preview.instance_id !== this.instance_id || preview.directory_hash !== hash(fold(await fs.realpath(this.directory)))) throw new Error("GRAPH_UPGRADE_INSTANCE_MISMATCH");
    return this.scope(() => withGraphReconciliation(async () => {
      await assertGraphWriter(); await recoverGraphPublication(); approval.signal?.throwIfAborted();
      const prior = await findOperationReceipt(approval.operation_id,"graph_upgrade",preview.epoch === "uninitialized" ? undefined : preview.epoch);
      if (prior) { if (prior.result?.preview_digest !== digest || prior.result?.review_id !== approval.review_id) throw new Error("GRAPH_UPGRADE_OPERATION_CONFLICT"); return { receipt: prior, replayed: true }; }
      if (preview.blockers.length) throw new Error("GRAPH_UPGRADE_RESOLUTIONS_REQUIRED: " + preview.blockers.length);
      const snapshot = await this.readSnapshot(); this.quiescent(snapshot);
      if (snapshot.publication.epoch !== preview.epoch || stable(snapshot.publication.revision) !== stable(preview.revision) || stable(snapshot.stamps) !== stable(preview.files)
        ||snapshot.config_directory_hash!==preview.config_directory_hash||stable(snapshot.config_files)!==stable(preview.config_files)) throw new Error("GRAPH_UPGRADE_REVISION_CONFLICT");
      const repair = this.repair(snapshot,preview.resolutions);
      if (stable(repair.writes) !== stable(preview.writes) || stable(repair.findings) !== stable(preview.findings) || repair.blockers.length) throw new Error("GRAPH_UPGRADE_PREVIEW_INVALID");
      const before = await loadCanonicalGraph(this.instance_id);
      if (stable(["scan_state.json","enrichment_state.json"].filter(file=>!snapshot.files.has(file)))!==stable(preview.unknown_baselines)
        ||stable(this.summary(before))!==stable(preview.before))throw new Error("GRAPH_UPGRADE_PREVIEW_INVALID");
      const staged = await this.stage(snapshot,repair.writes); if (stable(this.summary(staged)) !== stable(preview.after)) throw new Error("GRAPH_UPGRADE_STAGE_CHANGED");
      if (this.introducedFailures(before, staged).length) throw new Error("GRAPH_UPGRADE_STAGE_INVALID");
      const backup = await this.backup(snapshot,preview,approval.signal); await approval.fault_inject?.("upgrade_backup_verified"); approval.signal?.throwIfAborted();
      const log = this.log(snapshot); if (log.entries.length >= 128) throw new Error("GRAPH_UPGRADE_HISTORY_CAPACITY");
      log.entries.push({ operation_id: approval.operation_id, preview_digest: digest, review_id: approval.review_id, ...backup,
        prepared_at: new Date().toISOString(), changes: repair.writes.map(({file,before_hash,after_hash})=>({file,before_hash,after_hash})), restore_operations: [] });
      const unresolved = [...new Set([...preview.unknown_baselines.map(name=>`baseline:${name}`), ...staged.state.reasons.flatMap(reason=>reason.scope)])];
      const evidenceWrites = unresolved.length ? await prepareEvidenceGeneration({ id: "legacy-upgrade:"+approval.operation_id,
        scope: unresolved.length>100?[`legacy-graph:${this.instance_id}:unresolved-regions`,...unresolved.slice(0,99)]:unresolved, fingerprint:digest, unknown_impact:true }) : [];
      return commitGraphWrites({ actor:"graph_upgrade",operation_id:approval.operation_id,...(preview.epoch === "uninitialized" ? {} : {operation_epoch:preview.epoch}),
        expected_sequence:preview.revision.publication_sequence,expected_store_hashes:Object.fromEntries(snapshot.stamps.map(input=>[input.file,input.semantic_hash])),
        writes:[...repair.writes.map(({file,content})=>({file,content})),...evidenceWrites,{file:FILE,content:JSON.stringify(LogSchema.parse(log))}],scope:["legacy-graph",this.instance_id],cause:"reviewed_legacy_identity_repair",
        intent:{preview_digest:digest,review_id:approval.review_id},result:{preview_digest:digest,review_id:approval.review_id,backup_id:backup.backup_id,changed_files:repair.writes.length,unresolved_regions:unresolved.length,unresolved_regions_limited:unresolved.length>100},fault_inject:approval.fault_inject,
        check_expected:async()=>{const latest=await this.readSnapshot();if(stable(latest.stamps)!==stable(snapshot.stamps)||stable(latest.config_files)!==stable(snapshot.config_files)||latest.config_directory_hash!==snapshot.config_directory_hash)throw new Error("GRAPH_UPGRADE_INPUT_CHANGED");} });
    }));
  }
  previewRestore(operation_id: string): Promise<GraphUpgradeRestorePreview> {
    id.parse(operation_id);
    return this.scope(()=>withGraphRead(async()=>{
      const snapshot=await this.readSnapshot(),entry=this.log(snapshot).entries.find(entry=>entry.operation_id===operation_id);
      if(!entry)throw new Error("GRAPH_UPGRADE_OPERATION_NOT_FOUND");
      const backup=await this.verifyBackup(entry.backup_id,entry.backup_hash),writes:GraphUpgradePreview["writes"]=[],blockers:string[]=[];
      for(const change of entry.changes){
        const original=backup.files.get(change.file); if(!original||hash(original)!==change.before_hash)throw new Error("GRAPH_UPGRADE_BACKUP_CHANGED");
        if(snapshot.files.get(change.file)?.hash!==change.after_hash)blockers.push("GRAPH_UPGRADE_RESTORE_CONFLICT: "+change.file);
        writes.push({file:change.file,content:original.toString("utf8"),before_hash:change.after_hash,after_hash:change.before_hash});
      }
      const result={schema:"dreamgraph.graph_upgrade_restore_preview.v1" as const,instance_id:this.instance_id,directory_hash:hash(fold(snapshot.physical)),
        created_at:new Date().toISOString(),epoch:snapshot.publication.epoch,revision:snapshot.publication.revision,original_operation_id:operation_id,
        backup_id:entry.backup_id,backup_hash:entry.backup_hash,files:snapshot.stamps,changes:entry.changes,blockers,
        config_directory_hash:snapshot.config_directory_hash,config_files:snapshot.config_files,
        before:this.summary(await loadCanonicalGraph(this.instance_id)),after:this.summary(await this.stage(snapshot,writes))};
      return GraphUpgradeRestorePreviewSchema.parse({...result,digest:hash(stable(result))});
    }));
  }
  async restore(raw: GraphUpgradeRestorePreview, approval: GraphUpgradeApproval) {
    const preview=GraphUpgradeRestorePreviewSchema.parse(raw),{digest,...bound}=preview,operation_id=preview.original_operation_id;
    if(digest!==hash(stable(bound))||digest!==sha.parse(approval.reviewed_digest))throw new Error("GRAPH_UPGRADE_REVIEW_CHANGED");
    id.parse(approval.operation_id);id.parse(approval.review_id);
    if(preview.instance_id!==this.instance_id||preview.directory_hash!==hash(fold(await fs.realpath(this.directory))))throw new Error("GRAPH_UPGRADE_INSTANCE_MISMATCH");
    return this.scope(() => withGraphReconciliation(async () => {
      await assertGraphWriter(); await recoverGraphPublication(); approval.signal?.throwIfAborted();
      const prior = await findOperationReceipt(approval.operation_id,"graph_upgrade_restore",preview.epoch);
      if(prior){if(prior.result?.original_operation_id!==operation_id||prior.result?.review_id!==approval.review_id||prior.result?.preview_digest!==digest)throw new Error("GRAPH_UPGRADE_OPERATION_CONFLICT");return {receipt:prior,replayed:true};}
      if(preview.blockers.length)throw new Error("GRAPH_UPGRADE_RESTORE_CONFLICT");
      const snapshot=await this.readSnapshot();this.quiescent(snapshot);
      if(snapshot.publication.epoch!==preview.epoch||stable(snapshot.publication.revision)!==stable(preview.revision)||stable(snapshot.stamps)!==stable(preview.files)
        ||snapshot.config_directory_hash!==preview.config_directory_hash||stable(snapshot.config_files)!==stable(preview.config_files))throw new Error("GRAPH_UPGRADE_REVISION_CONFLICT");
      const log=this.log(snapshot),entry=log.entries.find(entry=>entry.operation_id===operation_id);if(!entry)throw new Error("GRAPH_UPGRADE_OPERATION_NOT_FOUND");
      const backup=await this.verifyBackup(entry.backup_id,entry.backup_hash),writes=[];
      if(entry.backup_id!==preview.backup_id||entry.backup_hash!==preview.backup_hash||stable(entry.changes)!==stable(preview.changes))throw new Error("GRAPH_UPGRADE_BACKUP_CHANGED");
      for(const change of entry.changes){if(snapshot.files.get(change.file)?.hash!==change.after_hash)throw new Error("GRAPH_UPGRADE_RESTORE_CONFLICT: "+change.file);
        const original=backup.files.get(change.file);if(!original||hash(original)!==change.before_hash)throw new Error("GRAPH_UPGRADE_BACKUP_CHANGED");writes.push({file:change.file,content:original.toString("utf8")});}
      approval.signal?.throwIfAborted();entry.restore_operations.push(approval.operation_id);LogSchema.parse(log);
      const staged=await this.stage(snapshot,writes.map(write=>({...write,before_hash:snapshot.files.get(write.file)!.hash,after_hash:hash(write.content)})));
      if(stable(this.summary(staged))!==stable(preview.after))throw new Error("GRAPH_UPGRADE_STAGE_CHANGED");
      return commitGraphWrites({actor:"graph_upgrade_restore",operation_id:approval.operation_id,operation_epoch:snapshot.publication.epoch,expected_sequence:preview.revision.publication_sequence,
        expected_store_hashes:Object.fromEntries(snapshot.stamps.map(input=>[input.file,input.semantic_hash])),writes:[...writes,{file:FILE,content:JSON.stringify(log)}],
        scope:["legacy-graph",this.instance_id],cause:"reviewed_legacy_restore",intent:{original_operation_id:operation_id,review_id:approval.review_id,preview_digest:digest},
        result:{original_operation_id:operation_id,review_id:approval.review_id,preview_digest:digest,restored_files:writes.length},fault_inject:approval.fault_inject,
        check_expected:async()=>{const latest=await this.readSnapshot();if(stable(latest.stamps)!==stable(snapshot.stamps)||stable(latest.config_files)!==stable(snapshot.config_files)||latest.config_directory_hash!==snapshot.config_directory_hash)throw new Error("GRAPH_UPGRADE_INPUT_CHANGED");} });
    }));
  }
}
