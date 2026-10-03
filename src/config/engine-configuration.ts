/** Daemon-owned config CAS, recovery receipts and revision-aware template/undo. */
import { readFileSync, existsSync, mkdirSync, readdirSync, realpathSync, openSync, closeSync, writeFileSync, fdatasyncSync, renameSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { assertGraphWriter } from "../graph/writer-lease.js";
import { parseEngineEnvDocument, renderEngineEnvUpdates, ENGINE_ENV_MAX_BYTES } from "./engine-env-document.js";
import { engineSetting, engineSettingCatalogue, validateEngineEnvValues } from "./engine-setting-catalogue.js";
import { ENGINE_DEPLOYMENT_OVERRIDES } from "../utils/engine-env.js";
import { graphEventBus } from "../graph/events.js";

const hash = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const ReceiptSchema = z.object({ schema: z.literal("dreamgraph.engine_config_receipt.v1"), operation_id: z.string().min(1).max(256), request_hash: z.string(),
  format: z.enum(["engine_env", "computer_worker", "computer_target"]).default("engine_env"),
  status: z.enum(["prepared", "committed", "aborted"]), before: z.string().max(ENGINE_ENV_MAX_BYTES), after: z.string().max(ENGINE_ENV_MAX_BYTES),
  before_revision: z.string(), revision: z.string(), changed_keys: z.array(z.string()), committed_at: z.string().nullable() }).strict();
type Receipt = z.infer<typeof ReceiptSchema>;
type DocumentOwner = { format: Receipt["format"]; validate: (content: string) => void };
const engineDocument: DocumentOwner = { format: "engine_env", validate: content => { parseEngineEnvDocument(content); validateEngineEnvValues(parseEngineEnvDocument(content)); } };
const queues = new Map<string, Promise<unknown>>();
export interface ConfigReceipt { operation_id: string; status: "committed" | "aborted"; before_revision: string; revision: string; changed_keys: string[]; committed_at: string | null; replayed: boolean; restart_required: string[]; }
export interface ConfigSnapshot { schema: "dreamgraph.engine_config.v1"; revision: string; settings: Array<{ key: string; persisted: string | null; effective: string | null; source: "deployment" | "instance" | "default"; secret: boolean; apply: string; mismatch: boolean }>; diagnostics: string[]; }
function readDocument(path: string): string { return existsSync(path) ? readFileSync(path, "utf8") : ""; }
function atomic(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`; let fd: number | undefined;
  try { fd = openSync(temp, "wx", 0o600); writeFileSync(fd, body, "utf8"); fdatasyncSync(fd); closeSync(fd); fd = undefined; renameSync(temp, path); }
  finally { if (fd !== undefined) closeSync(fd); try { unlinkSync(temp); } catch { /* already renamed */ } }
}
function receiptDir(path: string): string { return join(dirname(path), ".engine-config", createHash("sha256").update(path).digest("hex")); }
function receiptPath(path: string, operation: string): string { return join(receiptDir(path), createHash("sha256").update(operation).digest("hex") + ".json"); }
function saveReceipt(path: string, receipt: Receipt): void { atomic(receiptPath(path, receipt.operation_id), JSON.stringify(receipt)); }
function validateReceipt(receipt: Receipt, document: DocumentOwner = engineDocument): void {
  if (receipt.format !== document.format) throw new Error("CONFIG_RECOVERY_DOCUMENT_MISMATCH");
  if (hash(receipt.before) !== receipt.before_revision || hash(receipt.after) !== receipt.revision) throw new Error("CONFIG_RECOVERY_HASH_MISMATCH");
  if (document.format === "engine_env") { parseEngineEnvDocument(receipt.before); document.validate(receipt.after); }
  else { document.validate(receipt.before); document.validate(receipt.after); }
}
function recover(path: string, document: DocumentOwner): void {
  const dir = receiptDir(path); if (!existsSync(dir)) return;
  for (const file of readdirSync(dir).filter(file => /^[a-f0-9]{64}\.json$/.test(file))) {
    const receipt = ReceiptSchema.parse(JSON.parse(readFileSync(join(dir, file), "utf8")));
    validateReceipt(receipt, document);
    if (receipt.status !== "prepared") continue;
    const revision = hash(readDocument(path));
    if (revision === receipt.revision) { receipt.status = "committed"; receipt.committed_at = new Date().toISOString(); }
    else if (revision === receipt.before_revision) receipt.status = "aborted";
    else throw new Error("CONFIG_RECOVERY_CONFLICT: engine.env changed during an uncertain apply; preserve the file and receipts for repair");
    saveReceipt(path, receipt);
  }
}
async function owned<T>(envPath: string, task: (path: string) => T, document: DocumentOwner = engineDocument): Promise<T> {
  const absolute = resolve(envPath); mkdirSync(dirname(absolute), { recursive: true });
  // The same physical config folder is owned even when addressed through a symlink.
  const path = join(realpathSync(dirname(absolute)), absolute.slice(dirname(absolute).length + 1));
  await assertGraphWriter(dirname(path));
  const key = process.platform === "win32" ? path.toLowerCase() : path;
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => { recover(path, document); return task(path); });
  queues.set(key, next); try { return await next; } finally { if (queues.get(key) === next) queues.delete(key); }
}
export async function recoverEngineConfiguration(path: string): Promise<void> { return owned(path, () => undefined); }
// Imported unknown values may be credentials referenced under arbitrary names.
const secretLike = (key: string) => engineSetting(key)?.secret ?? true;
function redact(key: string, value: string | undefined): string | null { return value === undefined ? null : secretLike(key) ? value ? "[configured]" : "[empty]" : value; }
export async function inspectEngineConfiguration(path: string, deployment = ENGINE_DEPLOYMENT_OVERRIDES, runtime = process.env): Promise<ConfigSnapshot> {
  return owned(path, physical => {
    const content = readDocument(physical), values = parseEngineEnvDocument(content);
    let diagnostics: string[];
    try { diagnostics = validateEngineEnvValues(values); }
    catch (error) { diagnostics = [error instanceof Error ? error.message : "CONFIG_INVALID_PERSISTED_SETTINGS"]; }
    const keys = new Set([...engineSettingCatalogue().map(entry => entry.key), ...Object.keys(values)]);
    return { schema: "dreamgraph.engine_config.v1", revision: hash(content), diagnostics, settings: [...keys].sort().map(key => {
      const effective = runtime[key];
      return { key, persisted: redact(key, values[key]), effective: redact(key, effective), source: deployment[key] !== undefined ? "deployment" : values[key] !== undefined ? "instance" : "default",
        secret: secretLike(key), apply: engineSetting(key)?.apply ?? "read_only", mismatch: effective !== values[key] };
    }) };
  });
}
function publicReceipt(receipt: Receipt, replayed: boolean): ConfigReceipt {
  return { operation_id: receipt.operation_id, status: receipt.status as "committed" | "aborted", before_revision: receipt.before_revision, revision: receipt.revision,
    changed_keys: receipt.changed_keys, committed_at: receipt.committed_at, replayed, restart_required: receipt.changed_keys.filter(key => engineSetting(key)?.apply === "restart") };
}
function commit(path: string, input: { expected_revision: string; operation_id: string; request: unknown; after: (before: string) => string; changedKeys: string[]; onStep?: (step: string) => void }, document: DocumentOwner = engineDocument): ConfigReceipt {
  if (!input.operation_id || input.operation_id.length > 256) throw new Error("CONFIG_INVALID_OPERATION_ID");
  const requestHash = hash(JSON.stringify(input.request)), priorPath = receiptPath(path, input.operation_id);
  if (existsSync(priorPath)) {
    const prior = ReceiptSchema.parse(JSON.parse(readFileSync(priorPath, "utf8"))); validateReceipt(prior, document);
    if (prior.request_hash !== requestHash) throw new Error("CONFIG_OPERATION_REUSE_CONFLICT");
    return publicReceipt(prior, true);
  }
  const before = readDocument(path), beforeRevision = hash(before);
  if (beforeRevision !== input.expected_revision) throw new Error("CONFIG_REVISION_CONFLICT");
  const after = input.after(before);
  if (document.format === "engine_env") validateEngineEnvValues(parseEngineEnvDocument(after), input.changedKeys); else document.validate(after);
  const receipt: Receipt = { schema: "dreamgraph.engine_config_receipt.v1", operation_id: input.operation_id, request_hash: requestHash, status: "prepared",
    format: document.format,
    before, after, before_revision: beforeRevision, revision: hash(after), changed_keys: input.changedKeys, committed_at: null };
  // Durable before/after backup doubles as recovery intent; private config folder, never graph/model context.
  saveReceipt(path, receipt);
  input.onStep?.("prepared");
  // No await between final CAS and rename; another daemon cannot own this physical folder.
  if (hash(readDocument(path)) !== beforeRevision) throw new Error("CONFIG_REVISION_CONFLICT");
  atomic(path, after);
  input.onStep?.("file_committed");
  receipt.status = "committed"; receipt.committed_at = new Date().toISOString(); saveReceipt(path, receipt);
  graphEventBus.emit("config.changed", { affected_ids: [], etag: null, payload: { ...publicReceipt(receipt, false) } });
  input.onStep?.("receipt_committed");
  return publicReceipt(receipt, false);
}
/** Trusted typed document owners only. Uses the same physical writer, CAS, backups and exact-retry receipts as engine.env. */
export async function inspectConfigurationDocument(path: string, document: DocumentOwner): Promise<{ revision: string; content: string }> {
  return owned(path, physical => { const content = readDocument(physical); document.validate(content); return { revision: hash(content), content }; }, document);
}
export async function applyConfigurationDocument(path: string, document: DocumentOwner, input: { expected_revision: string; operation_id: string; content: string; key: string }, onStep?: (step: string) => void): Promise<ConfigReceipt> {
  if (Buffer.byteLength(input.content, "utf8") > 64 * 1024) throw new Error("CONFIG_DOCUMENT_BYTE_BOUND");
  if (!input.content) throw new Error("CONFIG_DOCUMENT_REQUIRED");
  document.validate(input.content);
  return owned(path, physical => commit(physical, { ...input, onStep, request: { expected_revision: input.expected_revision, content: input.content, key: input.key },
    changedKeys: [input.key], after: () => input.content }, document), document);
}
export async function applyEngineConfiguration(path: string, input: { expected_revision: string; operation_id: string; updates: Record<string, string | null> }, onStep?: (step: string) => void): Promise<ConfigReceipt> {
  const updates = Object.fromEntries(Object.entries(input.updates).sort(([a], [b]) => a.localeCompare(b)));
  // Null deletions must be checked as well as active assignments.
  for (const key of Object.keys(updates)) { const entry = engineSetting(key); if (!entry) throw new Error(`CONFIG_UNKNOWN_KEY: ${key}`); if (entry.apply === "read_only") throw new Error(`CONFIG_READ_ONLY: ${key}`); }
  return owned(path, physical => commit(physical, { ...input, onStep, request: { expected_revision: input.expected_revision, updates }, changedKeys: Object.keys(updates), after: before => renderEngineEnvUpdates(before, updates) }));
}
export async function previewEngineTemplate(path: string, template: string, keys?: string[]) {
  return owned(path, physical => {
    const before = readDocument(physical), values = parseEngineEnvDocument(before), preset = parseEngineEnvDocument(template); validateEngineEnvValues(preset);
    const selected = keys ?? [...new Set([...Object.keys(values), ...Object.keys(preset)])];
    const updates: Record<string, string | null> = {}, retained: string[] = [];
    for (const key of selected) {
      const entry = engineSetting(key);
      if (!entry || entry.protected || entry.apply === "read_only") { retained.push(key); continue; }
      if (values[key] !== preset[key]) updates[key] = preset[key] ?? null;
    }
    validateEngineEnvValues(parseEngineEnvDocument(renderEngineEnvUpdates(before, updates)), Object.keys(updates));
    return { revision: hash(before), template_hash: hash(template), retained, updates, diff: Object.entries(updates).map(([key, value]) => ({ key, before: redact(key, values[key]), after: redact(key, value ?? undefined), apply: engineSetting(key)!.apply })) };
  });
}
export async function applyEngineTemplate(path: string, input: { template: string; keys?: string[]; expected_revision: string; expected_template_hash: string; operation_id: string }): Promise<ConfigReceipt> {
  if (hash(input.template) !== input.expected_template_hash) throw new Error("CONFIG_TEMPLATE_CHANGED");
  return owned(path, physical => {
    const preset = parseEngineEnvDocument(input.template); validateEngineEnvValues(preset);
    const values = parseEngineEnvDocument(readDocument(physical));
    const keys = input.keys ?? [...new Set([...Object.keys(values), ...Object.keys(preset)])];
    const updates: Record<string, string | null> = {};
    for (const key of keys) { const entry = engineSetting(key); if (entry && !entry.protected && entry.apply !== "read_only") updates[key] = preset[key] ?? null; }
    return commit(physical, { ...input, request: { expected_revision: input.expected_revision, template_hash: input.expected_template_hash, keys: input.keys?.slice().sort() ?? null },
      changedKeys: Object.keys(updates), after: before => renderEngineEnvUpdates(before, updates) });
  });
}
export async function undoEngineConfiguration(path: string, input: { expected_revision: string; operation_id: string; undo_operation_id: string }): Promise<ConfigReceipt> {
  return owned(path, physical => {
    const backupPath = receiptPath(physical, input.undo_operation_id);
    if (!existsSync(backupPath)) throw new Error("CONFIG_BACKUP_UNAVAILABLE");
    const prior = ReceiptSchema.parse(JSON.parse(readFileSync(backupPath, "utf8"))); validateReceipt(prior);
    if (prior.status !== "committed" || prior.revision !== input.expected_revision) throw new Error("CONFIG_UNDO_CONFLICT");
    return commit(physical, { ...input, request: { expected_revision: input.expected_revision, undo_operation_id: input.undo_operation_id }, changedKeys: prior.changed_keys, after: () => prior.before });
  });
}
