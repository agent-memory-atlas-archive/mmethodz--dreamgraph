/** One durable publication boundary over the existing instance JSON stores. */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
import { atomicWriteFileRaw } from "../utils/atomic-write.js";
import { withGraphRead, withGraphReconciliation } from "../utils/graph-reconciliation-barrier.js";
import { dataPath } from "../utils/paths.js";
import { invalidateCache } from "../utils/cache.js";
import { stripBom } from "../utils/read-json.js";
import { assertGraphWriter } from "./writer-lease.js";
import { storeDefinition } from "./store-registry.js";
import { getSessionContext } from "../server/session-context.js";
import {
  GraphCurrencySchema, OperationReceiptSchema, RevisionVectorSchema,
  type GraphCurrency, type OperationReceipt, type RevisionVector,
} from "./contracts.js";

export const PUBLICATION_FILE = "publication_state.json";
export const JOURNAL_FILE = "reconciliation_journal.json";
const StateSchema = z.object({
  schema: z.literal("dreamgraph.publication.v1"), epoch: z.string(),
  revision: RevisionVectorSchema, currency: GraphCurrencySchema,
  last_transaction_id: z.string().nullable(),
  stores: z.record(z.object({ hash: z.string(), domain: z.string() }).strict()),
  receipts: z.record(OperationReceiptSchema), retired_epochs: z.array(z.string()).max(256),
  outbox: z.array(z.object({
    id: z.string(), operation_id: z.string(), graph_revision: z.string().nullable(),
    sequence: z.number().int(), scope: z.array(z.string()), affected_files: z.array(z.string()),
    cause: z.string(), created_at: z.string(),
  }).strict()),
}).strict();
export type PublicationState = z.infer<typeof StateSchema>;
export const emptyCurrency = (): GraphCurrency => ({
  last_graph_mutation_at: null, last_full_scan_at: null, last_source_reconciliation_at: null,
  source_reconciliation_scope: [], source_reconciliation_revision: null,
});
function emptyState(): PublicationState {
  return { schema: "dreamgraph.publication.v1", epoch: "uninitialized",
    revision: { publication_sequence: 0, graph_revision: null, domains: {} },
    currency: emptyCurrency(), last_transaction_id: null, stores: {}, receipts: {}, retired_epochs: [], outbox: [] };
}
const hash = (value: string): string => "sha256:" + createHash("sha256").update(value).digest("hex");
function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + stable((value as Record<string, unknown>)[key])).join(",") + "}";
}
function contentHash(value: string): string {
  return hash(stable(JSON.parse(stripBom(value))));
}
function safeFile(file: string, internal = false): void {
  if (!/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.json$/.test(file) || path.basename(file) !== file || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(file)) {
    throw new Error(`UNSAFE_PUBLICATION_PATH: ${file}`);
  }
  if (!internal && [PUBLICATION_FILE, JOURNAL_FILE].includes(file.toLowerCase())) throw new Error(`PUBLICATION_INTERNAL_ONLY: ${file}`);
}
const fileKey = (file: string): string => process.platform === "win32" ? file.toLowerCase() : file;
async function optional(file: string): Promise<string | null> {
  try { return await fs.readFile(dataPath(file), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
async function remove(file: string): Promise<void> {
  try { await fs.unlink(dataPath(file)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
// Receipt history can be large. Reuse one validated immutable physical version,
// never a time-based value or an unfenced cache keyed only by instance selection.
const publicationReads = new Map<string, { stamp: string; state: Promise<PublicationState> }>();
function immutable<T>(value: T): T {
  const pending: unknown[] = [value];
  while (pending.length) {
    const item = pending.pop();
    if (!item || typeof item !== "object" || Object.isFrozen(item)) continue;
    for (const child of Object.values(item)) pending.push(child); Object.freeze(item);
  }
  return value;
}
async function loadStateUnlocked(): Promise<PublicationState> {
  let physical: string;
  try { physical = await fs.realpath(dataPath(PUBLICATION_FILE)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState(); throw error; }
  const key = fileKey(physical), info = await fs.stat(physical, { bigint: true });
  const stampOf = (s: typeof info) => `${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`;
  const stamp = stampOf(info), cached = publicationReads.get(key);
  if (cached?.stamp === stamp) return cached.state;
  const state = (async () => {
    const raw = await fs.readFile(physical, "utf8");
    if (stampOf(await fs.stat(physical, { bigint: true })) !== stamp) throw new Error("GRAPH_REVISION_CONFLICT: publication changed while loading");
    try { return immutable(StateSchema.parse(JSON.parse(stripBom(raw)))); }
    catch (error) { throw new Error(`GRAPH_RECOVERY_REQUIRED: invalid ${PUBLICATION_FILE}: ${String(error)}`); }
  })();
  const entry = { stamp, state }; publicationReads.delete(key); publicationReads.set(key, entry);
  if (publicationReads.size > 16) publicationReads.delete(publicationReads.keys().next().value!);
  try { return await state; } catch (error) { if (publicationReads.get(key) === entry) publicationReads.delete(key); throw error; }
}
/** Pure read: unknown historical metadata remains unknown; never initializes disk. */
export function loadPublicationState(): Promise<PublicationState> {
  return withGraphRead(async () => {
    await assertPublishedRead();
    return loadStateUnlocked();
  });
}

/** Recovery is a writer/startup action; a reader must never expose interrupted stores. */
export async function assertPublishedRead(): Promise<void> {
  if (await optional(JOURNAL_FILE) !== null) throw new Error("GRAPH_RECOVERY_REQUIRED: publication journal is pending");
}

/** Before/after stamp also detects a publication by a different process. */
export async function readPublicationStamp(): Promise<string> {
  await assertPublishedRead();
  const state = await loadStateUnlocked();
  await assertPublishedRead();
  return `${state.epoch}:${state.revision.publication_sequence}`;
}

const JournalSchema = z.object({
  schema: z.literal("dreamgraph.reconciliation_journal.v2"), transaction_id: z.string(),
  status: z.enum(["prepared", "committing", "recovery_required"]),
  writes: z.array(z.object({ file: z.string(), next: z.string(), previous: z.string().nullable(), next_hash: z.string() }).strict()),
}).strict();
type Journal = z.infer<typeof JournalSchema>;
const LegacyJournalSchema = z.object({
  schema: z.literal("dreamgraph.reconciliation_journal.v1"), transaction_id: z.string(),
  expected_revision: z.string().nullable(), next_revision: z.string(),
  status: z.enum(["prepared", "committing", "rolling_back", "recovery_required"]),
  writes: z.array(z.object({ file: z.string(), next: z.string(), previous: z.string().nullable() }).strict()),
}).strict();
export type PublicationRecovery = "clean" | "rolled_back" | "rolled_forward";

async function recoverUnlocked(fault?: CommitGraphInput["fault_inject"]): Promise<PublicationRecovery> {
  const raw = await optional(JOURNAL_FILE);
  if (raw === null) return "clean";
  let journal: Journal;
  let parsed: unknown;
  try { parsed = JSON.parse(stripBom(raw)); }
  catch (error) { throw new Error(`GRAPH_RECOVERY_REQUIRED: invalid publication journal: ${String(error)}`); }
  // v13 journals have no durable commit receipt. Preserve their declared rollback semantics.
  if ((parsed as { schema?: unknown })?.schema === "dreamgraph.reconciliation_journal.v1") {
    const legacy = LegacyJournalSchema.parse(parsed);
    const files = new Set<string>();
    for (const w of legacy.writes) {
      safeFile(w.file);
      if (files.has(fileKey(w.file))) throw new Error("GRAPH_RECOVERY_REQUIRED: duplicate legacy journal participant");
      files.add(fileKey(w.file));
      if (w.previous !== null) JSON.parse(stripBom(w.previous));
    }
    try {
      for (let index = 0; index < legacy.writes.length; index++) {
        const w = legacy.writes[index];
        await fault?.(`recovery_before_restore:${index}:${w.file}`);
        if (w.previous === null) await remove(w.file);
        else await atomicWriteFileRaw(dataPath(w.file), w.previous);
        invalidateCache(w.file);
        await fault?.(`recovery_after_restore:${index}:${w.file}`);
      }
      await remove(JOURNAL_FILE);
    } catch (error) {
      await atomicWriteFileRaw(dataPath(JOURNAL_FILE), JSON.stringify({ ...legacy, status: "recovery_required" }, null, 2));
      throw new Error(`RECONCILIATION_RECOVERY_REQUIRED: ${String(error)}`);
    }
    return "rolled_back";
  }
  try { journal = JournalSchema.parse(parsed); }
  catch (error) { throw new Error(`GRAPH_RECOVERY_REQUIRED: invalid publication journal: ${String(error)}`); }
  const files = new Set<string>();
  for (const w of journal.writes) {
    safeFile(w.file, true);
    if (w.file.toLowerCase() === JOURNAL_FILE || files.has(fileKey(w.file)) || hash(w.next) !== w.next_hash) throw new Error("GRAPH_RECOVERY_REQUIRED: ambiguous journal writes");
    files.add(fileKey(w.file));
  }
  if (!files.has(PUBLICATION_FILE)) throw new Error("GRAPH_RECOVERY_REQUIRED: missing publication participant");
  if (journal.writes.at(-1)?.file !== PUBLICATION_FILE) throw new Error("GRAPH_RECOVERY_REQUIRED: publication participant must be last");
  const marker = StateSchema.parse(JSON.parse(journal.writes.find(w => w.file === PUBLICATION_FILE)!.next));
  if (marker.last_transaction_id !== journal.transaction_id) throw new Error("GRAPH_RECOVERY_REQUIRED: invalid publication marker");
  const current = await loadStateUnlocked();
  const committed = current.last_transaction_id === journal.transaction_id;
  try {
    for (let index = 0; index < journal.writes.length; index++) {
      const w = journal.writes[index];
      await fault?.(`recovery_before_restore:${index}:${w.file}`);
      const wanted = committed ? w.next : w.previous;
      if (wanted === null) await remove(w.file);
      else if (await optional(w.file) !== wanted) await atomicWriteFileRaw(dataPath(w.file), wanted);
      invalidateCache(w.file);
      await fault?.(`recovery_after_restore:${index}:${w.file}`);
    }
    await remove(JOURNAL_FILE);
  } catch (error) {
    await atomicWriteFileRaw(dataPath(JOURNAL_FILE), JSON.stringify({ ...journal, status: "recovery_required" }, null, 2));
    throw new Error(`RECONCILIATION_RECOVERY_REQUIRED: ${String(error)}`);
  }
  return committed ? "rolled_forward" : "rolled_back";
}

export async function recoverGraphPublication(): Promise<PublicationRecovery> {
  return withGraphReconciliation(async () => { await assertGraphWriter(); return recoverUnlocked(); });
}

export interface CommitGraphInput {
  writes: Array<{ file: string; content: string }>;
  actor?: string; scope?: string[]; operation_id?: string; operation_epoch?: string;
  expected_graph_revision?: string | null; expected_sequence?: number;
  expected_store_hashes?: Record<string, string | null>;
  cause?: string;
  /** Stable caller intent binds operation identity even when deltas merge newer state. */
  intent?: Record<string, unknown>;
  /** Small durable result recovered together with the commit receipt after a lost reply. */
  result?: Record<string, unknown>;
  source_reconciliation?: { revision: string; scope: string[]; full: boolean };
  /** Compatibility CAS for the independent source-scan revision. */
  check_expected?: () => Promise<void>;
  before_commit?: () => Promise<unknown>;
  /** Only deterministic disposable-state tests supply fault injection. */
  fault_inject?: (step: string) => Promise<void> | void;
}

const publicationOwner = new AsyncLocalStorage<{ active: boolean }>();
type JournalChange = Journal["writes"][number];

/** All marker maintenance uses the same recovery boundary as graph commits. */
async function publishState(next: PublicationState, changes: JournalChange[], transaction_id: string,
  fault?: CommitGraphInput["fault_inject"], beforeCommit?: CommitGraphInput["before_commit"]): Promise<unknown> {
  const nextBody = JSON.stringify(StateSchema.parse(next), null, 2);
  const writes = [...changes, { file: PUBLICATION_FILE, next: nextBody, previous: await optional(PUBLICATION_FILE), next_hash: hash(nextBody) }];
  const journal: Journal = { schema: "dreamgraph.reconciliation_journal.v2", transaction_id, status: "prepared", writes };
  await atomicWriteFileRaw(dataPath(JOURNAL_FILE), JSON.stringify(journal, null, 2));
  try {
    await fault?.("journal_prepared");
    const result = await beforeCommit?.();
    await atomicWriteFileRaw(dataPath(JOURNAL_FILE), JSON.stringify({ ...journal, status: "committing" }, null, 2));
    for (let index = 0; index < writes.length; index++) {
      const w = writes[index];
      await fault?.(`before_replace:${index}:${w.file}`);
      await atomicWriteFileRaw(dataPath(w.file), w.next);
      invalidateCache(w.file);
      await fault?.(`after_replace:${index}:${w.file}`);
    }
    await fault?.("publication_committed");
    await fault?.("before_journal_remove");
    await remove(JOURNAL_FILE);
    return result;
  } catch (error) { await recoverUnlocked(fault); throw error; }
}

export async function commitGraphWrites(input: CommitGraphInput): Promise<{ receipt: OperationReceipt; result: unknown; replayed: boolean }> {
  if (publicationOwner.getStore()?.active) throw new Error("NESTED_PUBLICATION_FORBIDDEN");
  return withGraphReconciliation(() => {
    const owner = { active: true };
    return publicationOwner.run(owner, async () => {
    try {
    await assertGraphWriter();
    await recoverUnlocked(input.fault_inject);
    const { assertJobCurrent } = await import("../cognitive/job-context.js");
    await assertJobCurrent();
    const current = await loadStateUnlocked();
    if (input.result && Buffer.byteLength(JSON.stringify(input.result), "utf8") > 65_536) throw new Error("RECEIPT_RESULT_LIMIT_EXCEEDED");
    const seen = new Set<string>();
    for (const w of input.writes) {
      safeFile(w.file);
      if (seen.has(fileKey(w.file))) throw new Error(`DUPLICATE_PUBLICATION_FILE: ${w.file}`);
      seen.add(fileKey(w.file));
      JSON.parse(stripBom(w.content));
    }
    const actor = input.actor ?? "internal";
    const { currentJob } = await import("../cognitive/job-context.js");
    const intentScope=[...new Set(input.scope??input.writes.map(w=>w.file))].sort();
    const executionId = getSessionContext()?.execution_policy?.id;
    const scope = [...new Set([...intentScope, ...(currentJob() ? [`job:${currentJob()!.id}`] : []),
      ...(executionId ? [`execution:${executionId}`] : [])])].sort();
    const payload_digest = hash(stable({ actor, scope:intentScope, cause: input.cause ?? "mutation",
      source_reconciliation: input.source_reconciliation ?? null,
      ...(input.intent ? { intent: input.intent } : { writes: [...input.writes].sort((a, b) => a.file.localeCompare(b.file)).map(w => ({ file: w.file, hash: contentHash(w.content) })) }) }));
    const epoch = input.operation_epoch ?? (current.epoch === "uninitialized" ? randomUUID() : current.epoch);
    if (input.operation_id && !input.operation_epoch && current.retired_epochs.length) throw new Error("OPERATION_EPOCH_REQUIRED: reconcile archived identities before dispatch");
    if (current.retired_epochs.includes(epoch) || (input.operation_epoch && current.epoch !== "uninitialized" && current.epoch !== epoch)) {
      throw new Error("RECEIPT_EXPIRED_RECONCILIATION_REQUIRED");
    }
    const operation_id = input.operation_id ?? randomUUID();
    const receiptKey = hash(stable({ epoch, actor, operation_id }));
    const prior = current.receipts[receiptKey];
    if (prior) {
      if (prior.payload_digest !== payload_digest) throw new Error("OPERATION_IDENTITY_CONFLICT");
      return { receipt: prior, result: prior.result, replayed: true };
    }
    if (input.expected_graph_revision !== undefined && current.revision.graph_revision !== input.expected_graph_revision) throw new Error("GRAPH_REVISION_CONFLICT");
    if (input.expected_sequence !== undefined && current.revision.publication_sequence !== input.expected_sequence) throw new Error("PUBLICATION_REVISION_CONFLICT");
    await input.check_expected?.();
    if (Object.keys(current.receipts).length >= 100_000 || current.outbox.length >= 10_000) throw new Error("PUBLICATION_CAPACITY_EXHAUSTED: drain/archive before further admission");
    const changes = [];
    for (const w of input.writes) {
      const previous = await optional(w.file);
      const previousHash = previous === null ? null : contentHash(previous);
      if (input.expected_store_hashes && Object.hasOwn(input.expected_store_hashes, w.file) && input.expected_store_hashes[w.file] !== previousHash) {
        throw new Error(`STORE_REVISION_CONFLICT: ${w.file}`);
      }
      if (current.stores[w.file] && previousHash !== current.stores[w.file].hash) {
        throw new Error(`UNPUBLISHED_STORE_CHANGE: ${w.file}; reconcile before overwriting`);
      }
      if (previous === null || contentHash(previous) !== contentHash(w.content)) changes.push({ file: w.file, next: w.content, previous, next_hash: hash(w.content) });
    }
    if (changes.length === 0 && !input.operation_id && !input.source_reconciliation) {
      const receipt: OperationReceipt = { schema: "dreamgraph.operation_receipt.v1", operation_id, epoch, payload_digest,
        actor, scope, transaction_id: "none", revision: current.revision, committed_at: new Date().toISOString(),
        affected_files: [], outcome: "no_change", currency: current.currency, ...(input.result ? { result: input.result } : {}) };
      return { receipt, result: input.result, replayed: false };
    }
    const committed_at = new Date().toISOString();
    const transaction_id = randomUUID();
    const changedGraph = changes.some(w => storeDefinition(w.file).graph);
    const revision: RevisionVector = structuredClone(current.revision);
    revision.publication_sequence++;
    if (changedGraph) revision.graph_revision = `graph:${revision.publication_sequence}`;
    for (const domain of new Set(changes.map(w => storeDefinition(w.file).domain))) revision.domains[domain] = (revision.domains[domain] ?? 0) + 1;
    const currency = structuredClone(current.currency);
    if (changedGraph) currency.last_graph_mutation_at = committed_at;
    const reconciliation = input.source_reconciliation;
    if (reconciliation) {
      currency.last_source_reconciliation_at = committed_at;
      currency.source_reconciliation_scope = [...new Set(reconciliation.scope)].sort();
      currency.source_reconciliation_revision = reconciliation.revision;
      if (reconciliation.full) currency.last_full_scan_at = committed_at;
    }
    const receipt: OperationReceipt = { schema: "dreamgraph.operation_receipt.v1", operation_id, epoch,
      payload_digest, actor, scope, transaction_id, revision, committed_at,
      affected_files: changes.map(w => w.file), outcome: changes.length ? "committed" : "no_change", currency,
      ...(input.result ? { result: input.result } : {}) };
    const next: PublicationState = structuredClone(current);
    Object.assign(next, { epoch, revision, currency, last_transaction_id: transaction_id });
    next.receipts[receiptKey] = receipt;
    for (const w of changes) next.stores[w.file] = { hash: contentHash(w.next), domain: storeDefinition(w.file).domain };
    if (changedGraph) next.outbox.push({ id: transaction_id, operation_id, graph_revision: revision.graph_revision,
      sequence: revision.publication_sequence, scope, affected_files: changes.map(w => w.file), cause: input.cause ?? "mutation", created_at: committed_at });
    const result = await publishState(next, changes, transaction_id, input.fault_inject, input.before_commit);
    return { receipt, result: input.result ?? result, replayed: false };
    } finally { owner.active = false; }
    });
  });
}

export async function findOperationReceipt(operation_id: string, actor: string, epoch?: string): Promise<OperationReceipt | null> {
  const state = await loadPublicationState();
  if (!epoch && state.retired_epochs.length) throw new Error("OPERATION_EPOCH_REQUIRED: reconcile archived identities before dispatch");
  if (epoch && state.retired_epochs.includes(epoch)) throw new Error("RECEIPT_EXPIRED_RECONCILIATION_REQUIRED");
  return state.receipts[hash(stable({ epoch: epoch ?? state.epoch, actor, operation_id }))] ?? null;
}

/** Acknowledge durable notification delivery without manufacturing a graph mutation. */
export async function acknowledgePublicationEvents(ids: string[], fault?: CommitGraphInput["fault_inject"]): Promise<void> {
  await withGraphReconciliation(async () => {
    await assertGraphWriter();
    await recoverUnlocked();
    const state = structuredClone(await loadStateUnlocked());
    const acknowledged = new Set(ids);
    const remaining = state.outbox.filter(event => !acknowledged.has(event.id));
    if (remaining.length === state.outbox.length) return;
    state.outbox = remaining;
    state.revision.publication_sequence++;
    const transaction_id = randomUUID(); state.last_transaction_id = transaction_id;
    await publishState(state, [], transaction_id, fault);
  });
}

/** At-least-once port: consumers deduplicate the stable event ID; failure retains undelivered debt. */
export async function drainPublicationEvents(deliver: (event: PublicationState["outbox"][number]) => Promise<void>, limit = 100): Promise<number> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("INVALID_OUTBOX_LIMIT");
  const pending = (await loadPublicationState()).outbox.slice(0, limit);
  let delivered = 0;
  for (const event of pending) {
    await deliver(event);
    await acknowledgePublicationEvents([event.id]);
    delivered++;
  }
  return delivered;
}

/** Explicit maintenance port, not automatic GC. Job/client owners must attest quiescence under this writer boundary. */
export async function retirePublicationEpoch(input: {
  expected_epoch: string; expected_sequence: number; retirement_id: string; reason: string;
  assert_quiescent: () => Promise<void>; fault_inject?: CommitGraphInput["fault_inject"];
}): Promise<{ retired_epoch: string; epoch: string; archive: string; replayed: boolean }> {
  return withGraphReconciliation(async () => {
    await assertGraphWriter(); await recoverUnlocked();
    const current = await loadStateUnlocked();
    const archive = `receipt_epoch_${hash(input.expected_epoch).slice(7, 39)}.json`;
    const identity = hash(stable({ expected_epoch: input.expected_epoch, expected_sequence: input.expected_sequence, retirement_id: input.retirement_id, reason: input.reason }));
    if (current.retired_epochs.includes(input.expected_epoch)) {
      const previous = await optional(archive);
      if (!previous) throw new Error("RECEIPT_ARCHIVE_UNAVAILABLE");
      const saved = JSON.parse(previous);
      if (saved.schema !== "dreamgraph.receipt_archive.v1" || saved.identity !== identity || contentHash(previous) !== current.stores[archive]?.hash) throw new Error("RETIREMENT_IDENTITY_CONFLICT");
      return { retired_epoch: input.expected_epoch, epoch: saved.next_epoch, archive, replayed: true };
    }
    if (current.epoch === "uninitialized" || current.epoch !== input.expected_epoch || current.revision.publication_sequence !== input.expected_sequence) throw new Error("PUBLICATION_REVISION_CONFLICT");
    if (!input.retirement_id.trim() || !input.reason.trim()) throw new Error("RETIREMENT_REASON_REQUIRED");
    if (current.retired_epochs.length >= 256) throw new Error("RECEIPT_ARCHIVE_CAPACITY_EXHAUSTED");
    if (current.outbox.length) throw new Error("OUTBOX_DELIVERY_PENDING");
    if (typeof input.assert_quiescent !== "function") throw new Error("RETIREMENT_QUIESCENCE_REQUIRED");
    await input.assert_quiescent();
    const afterQuiescence = await loadStateUnlocked();
    if (afterQuiescence.epoch !== current.epoch || afterQuiescence.revision.publication_sequence !== current.revision.publication_sequence) throw new Error("PUBLICATION_REVISION_CONFLICT");
    if (await optional(archive) !== null) throw new Error("RECEIPT_ARCHIVE_CONFLICT");
    const epoch = randomUUID();
    const body = JSON.stringify({ schema: "dreamgraph.receipt_archive.v1", identity, retirement_id: input.retirement_id,
      reason: input.reason, retired_epoch: current.epoch, next_epoch: epoch, retired_at: new Date().toISOString(), receipts: current.receipts }, null, 2);
    const next = structuredClone(current);
    next.retired_epochs.push(current.epoch); next.epoch = epoch; next.receipts = {};
    next.revision.publication_sequence++; const transaction_id = randomUUID(); next.last_transaction_id = transaction_id;
    next.stores[archive] = { hash: contentHash(body), domain: "receipt_archive" };
    await publishState(next, [{ file: archive, next: body, previous: null, next_hash: hash(body) }], transaction_id, input.fault_inject);
    return { retired_epoch: current.epoch, epoch, archive, replayed: false };
  });
}

export function publicationContentHash(content: string): string { return contentHash(content); }
