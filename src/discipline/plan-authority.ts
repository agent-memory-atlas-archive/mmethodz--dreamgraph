/** One C14 writer over the existing publication journal and registered plan store. */
import { readFile, realpath, stat } from "node:fs/promises";
import { z } from "zod";
import { dataPath } from "../utils/paths.js";
import { stripBom } from "../utils/read-json.js";
import { withGraphRead, withGraphReconciliation } from "../utils/graph-reconciliation-barrier.js";
import { commitGraphWrites, loadPublicationState, publicationContentHash } from "../graph/publication.js";
import { readChangeObligations, readDirtyPartitions } from "../graph/change-obligations.js";
import { PlanStateV2Schema, PlanDefinitionSchema, type PlanDefinition, type PlanWorkflowState } from "../graph/contracts.js";
import { approvalHash } from "./approval.js";
import { PlanCommandSchema, initialPlanState, reducePlanCommand, projectPlanState, type PlanActor, type PlanCommand, type PlanTransitionContext } from "./plan-workflow.js";

const EventSchema = z.object({ sequence: z.number().int(), actor: z.object({ id: z.string(), instance_id: z.string(), project_id: z.string(), kind: z.enum(["operator", "agent", "runtime"]), review_grant: z.object({ plan_id: z.string(), definition_hash: z.string(), slice_ids: z.array(z.string()) }).strict().optional() }).strict(),
  command: PlanCommandSchema, now: z.string(), before_hash: z.string(), after_hash: z.string(), implementation_receipts_valid: z.boolean(), closure_allowed: z.boolean() }).strict();
const RecordSchema = z.object({ initial: PlanStateV2Schema, state: PlanStateV2Schema, history: z.array(EventSchema).max(4096),
  backups: z.array(z.object({ source_hash: z.string(), log_hash: z.string().nullable(), markdown: z.string(), log_markdown: z.string().nullable(), review_id: z.string() }).strict()).max(128) }).strict();
const RootSchema = z.object({ schema: z.literal("dreamgraph.plan_authority.v1"), reducer_version: z.literal("c14.1"), records: z.record(RecordSchema) }).strict();
type Root = z.infer<typeof RootSchema>;
const FILE = "plan_state.json";
const key = (scope: { instance_id: string; project_id: string; id: string }) => [scope.instance_id, scope.project_id, scope.id].map(encodeURIComponent).join("/");
const actorKey = (actor: PlanActor) => `plan-actor:${actor.instance_id}/${actor.project_id}/${actor.id}`;
function fail(condition: unknown, code: string): asserts condition { if (!condition) throw new Error(code); }
/** The same store validator is used by direct authority reads and graph projections. */
export function decodePlanAuthorityStore(raw: unknown): Root {
  const root = RootSchema.parse(raw);
  fail(Object.keys(root.records).length <= 512, "PLAN_AUTHORITY_CAPACITY_EXHAUSTED");
  for (const [identity, record] of Object.entries(root.records)) {
    fail(identity === key(record.state), "PLAN_AUTHORITY_SCOPE_CORRUPT");
    if (record.history.length) fail(record.history.at(-1)!.after_hash === approvalHash(record.state), "PLAN_AUTHORITY_PROJECTION_CORRUPT");
  }
  return root;
}
/** Slice-local IDs can repeat across plans. Graph identity is stable, bounded and scoped. */
export const planSliceGraphId = (scope: { instance_id: string; project_id: string; id: string }, slice_id: string) =>
  "plan-slice:" + approvalHash({ ...scope, slice_id });
/** Pure projection of the bytes already fenced by the graph reader; never rereads, imports or writes. */
export function projectPlanAuthorityEntities(raw: unknown, instance_id: string, epoch: string, now: string) {
  const root = decodePlanAuthorityStore(raw);
  const result: Array<{ kind: "plan" | "slice"; payload: Record<string, unknown> }> = [];
  for (const record of Object.values(root.records)) {
    if (record.state.instance_id !== instance_id) continue;
    const view = projectPlanState(record.state, now), state = view.state;
    const scope = { instance_id, project_id: state.project_id, id: state.id };
    const common = { source: "typed_plan_authority", project_id: state.project_id, plan_id: state.id,
      revision: state.revision, event_sequence: state.event_sequence, definition_hash: state.definition_hash, updated_at: state.updated_at };
    const projection = { epoch, ...common, lifecycle: state.lifecycle, underlying_lifecycle: state.underlying_lifecycle, execution: view.execution,
      current_slice_id: view.current_slice_id, current_slice_ids: state.current_slice_ids,
      running_slice_id: view.running_slice_id, running_slice_ids: state.running_slice_ids,
      next_slice: view.next_slice, last_verified_slice_id: state.last_verified_slice_id,
      progress: view.progress, resume_action: view.resume_action, reconciliation: state.reconciliation,
      plan_blockers: state.plan_blockers, leases: state.leases };
    const slices = state.slices.map(slice => {
      const definition = state.definition.slices.find(item => item.id === slice.id)!;
      return { kind: "slice" as const, payload: { ...slice, ...common, id: planSliceGraphId(scope, slice.id), slice_id: slice.id,
        title: definition.title, acceptance_hash: definition.acceptance_hash, required: definition.required,
        plan_projection: projection } };
    });
    result.push({ kind: "plan", payload: { ...common, id: state.id, title: state.definition.title, lifecycle: state.lifecycle,
      current_slice_ids: state.current_slice_ids, running_slice_ids: state.running_slice_ids, next_slice_ids: state.next_slice_ids,
      plan_projection: projection, links: slices.map(slice => ({ target: slice.payload.id, type: "slice", relationship: "contains_slice" })) } }, ...slices);
  }
  return result;
}
const rootReads = new Map<string, { stamp: string; value: Promise<{ root: Root; hash: string }> }>();
async function loadRoot(readOnly = false): Promise<Root> {
  const publication = await loadPublicationState();
  let physical: string;
  try { physical = await realpath(dataPath(FILE)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" || publication.stores[FILE]) throw new Error("PLAN_AUTHORITY_RECOVERY_REQUIRED: missing published store");
    return { schema: "dreamgraph.plan_authority.v1", reducer_version: "c14.1", records: {} };
  }
  const key = process.platform === "win32" ? physical.toLowerCase() : physical, info = await stat(physical, { bigint: true });
  if (info.size > 32n * 1024n * 1024n) throw new Error("PLAN_AUTHORITY_CAPACITY_EXHAUSTED");
  const stampOf = (s: typeof info) => `${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`, stamp = stampOf(info);
  let cached = rootReads.get(key);
  if (cached?.stamp !== stamp) {
    const value = (async () => {
      const body = await readFile(physical, "utf8");
      if (stampOf(await stat(physical, { bigint: true })) !== stamp) throw new Error("PLAN_AUTHORITY_RECOVERY_REQUIRED: input changed");
      try {
        const root = decodePlanAuthorityStore(JSON.parse(stripBom(body))), pending: unknown[] = [root];
        while (pending.length) { const item = pending.pop(); if (!item || typeof item !== "object" || Object.isFrozen(item)) continue;
          for (const child of Object.values(item)) pending.push(child); Object.freeze(item); }
        return { root, hash: publicationContentHash(body) };
      } catch (error) { throw new Error(`PLAN_AUTHORITY_RECOVERY_REQUIRED: ${String(error)}`); }
    })();
    cached = { stamp, value }; rootReads.delete(key); rootReads.set(key, cached);
    if (rootReads.size > 4) rootReads.delete(rootReads.keys().next().value!);
  }
  let loaded: Awaited<typeof cached.value>;
  try { loaded = await cached.value; } catch (error) { if (rootReads.get(key) === cached) rootReads.delete(key); throw error; }
  if (publication.stores[FILE] && publication.stores[FILE].hash !== loaded.hash) throw new Error("PLAN_AUTHORITY_RECOVERY_REQUIRED: unpublished store change");
  return readOnly ? loaded.root : structuredClone(loaded.root);
}
function encode(root: Root): string {
  fail(Object.keys(root.records).length <= 512, "PLAN_AUTHORITY_CAPACITY_EXHAUSTED");
  const body = JSON.stringify(RootSchema.parse(root));
  fail(Buffer.byteLength(body) <= 32 * 1024 * 1024, "PLAN_AUTHORITY_CAPACITY_EXHAUSTED"); return body;
}
function identityInput(actor: PlanActor, plan_id: string) {
  fail(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,200}$/.test(plan_id), "PLAN_ID_INVALID");
  return { instance_id: actor.instance_id, project_id: actor.project_id, id: plan_id };
}
export async function readPlanAuthority(scope: { instance_id: string; project_id: string; id: string }, now = new Date().toISOString()) {
  return withGraphRead(async () => {
    const root = await loadRoot(true), record = root.records[key(scope)];
    if (!record) return null;
    const publication = await loadPublicationState();
    return { ...projectPlanState(record.state, now), epoch: publication.epoch, source: "typed_plan_authority" as const };
  });
}
type Fault = (step: string) => Promise<void> | void;
/** Reviewed initialization preserves original bytes and imports no completion claims. */
export async function importPlanAuthority(input: { actor: PlanActor; definition: PlanDefinition; markdown: string; log_markdown: string | null;
  review_id: string; operation_id: string; request_reference?: string; fault_inject?: Fault; check_sources?: () => Promise<void>; now?: string }) {
  return withGraphReconciliation(async () => {
    fail(input.actor.kind === "operator", "PLAN_OPERATOR_REVIEW_REQUIRED");
    const definition = PlanDefinitionSchema.parse(input.definition), identity = identityInput(input.actor, definition.id);
    fail(definition.instance_id === identity.instance_id && definition.project_id === identity.project_id, "PLAN_SCOPE_REJECTED");
    fail(definition.source_hash === bytesHash(input.markdown) && definition.log_hash === (input.log_markdown === null ? null : bytesHash(input.log_markdown)), "PLAN_IMPORT_PREVIEW_CONFLICT");
    fail(Buffer.byteLength(input.markdown) + Buffer.byteLength(input.log_markdown ?? "") <= 2 * 1024 * 1024, "PLAN_IMPORT_BACKUP_LIMIT");
    const scope = [`plan:${key(identity)}`], actor = actorKey(input.actor);
    const intent = { kind: "import_plan", identity, definition, review_id: input.review_id, actor: input.actor, request_reference: input.request_reference ?? null };
    const publication = await loadPublicationState();
    if (Object.values(publication.receipts).some(receipt => receipt.actor === actor && receipt.operation_id === input.operation_id)) {
      return commitGraphWrites({ writes: [], actor, scope, operation_id: input.operation_id, intent, cause: "plan_transition" });
    }
    await input.check_sources?.(); const root = await loadRoot(); fail(!root.records[key(identity)], "PLAN_ALREADY_IMPORTED");
    const now = input.now ?? new Date().toISOString(), state = initialPlanState(definition, now);
    root.records[key(identity)] = { initial: structuredClone(state), state, history: [], backups: [{ source_hash: definition.source_hash, log_hash: definition.log_hash,
      markdown: input.markdown, log_markdown: input.log_markdown, review_id: input.review_id }] };
    return commitGraphWrites({ writes: [{ file: FILE, content: encode(root) }], actor, scope, operation_id: input.operation_id, intent, cause: "plan_transition",
      expected_sequence: publication.revision.publication_sequence, check_expected: input.check_sources, fault_inject: input.fault_inject,
      result: { plan_identity: identity, revision: state.revision, sequence: state.event_sequence, imported_completion_claims: 0, request_reference: input.request_reference ?? null } });
  });
}
export const bytesHash = (content: string) => {
  // Byte hashes bind previews/backups; semantic definition hashes are separate.
  // Imported text is UTF-8 as read by the registry, including any BOM.
  return "sha256:" + createHash("sha256").update(content, "utf8").digest("hex");
};
import { createHash } from "node:crypto";
async function closureAllowed(state: PlanWorkflowState, slice_id?: string): Promise<boolean> {
  const obligations = await readChangeObligations(), dirty = await readDirtyPartitions(), publication = await loadPublicationState();
  const slices = slice_id ? state.slices.filter(slice => slice.id === slice_id) : state.slices;
  for (const slice of slices) {
    for (const id of slice.effect_obligation_ids) {
      const obligation = obligations.entries.find(entry => entry.id === id && entry.instance_id === state.instance_id);
      if (!obligation || obligation.state !== "graph_committed" || !obligation.graph_receipt_id) return false;
      const receipt = Object.values(publication.receipts).find(candidate => candidate.operation_id === obligation.graph_receipt_id && candidate.actor === "source_reconciliation");
      if (!receipt || !["committed", "no_change"].includes(receipt.outcome) || !obligation.scope.every(scope => receipt.currency.source_reconciliation_scope.includes(scope))) return false;
      for (const partition of dirty.partitions.filter(partition => partition.root_cause_ids.includes(id))) {
        if (slice.required_stages.some(stage => partition.pending_stages.includes(stage))) return false;
      }
    }
  }
  return true;
}
async function implementationValid(state: PlanWorkflowState, command: Extract<PlanCommand, { type: "record_implementation" }>, actor: PlanActor) {
  if (!command.receipt_ids.length && !command.effect_obligation_ids.length) return !!command.reviewed_no_change_id && (actor.kind === "operator"
    || actor.review_grant?.plan_id === state.id && actor.review_grant.definition_hash === state.definition_hash && actor.review_grant.slice_ids.includes(command.slice_id));
  const publication = await loadPublicationState(), obligations = await readChangeObligations();
  for (const id of command.receipt_ids) {
    const receipt = Object.values(publication.receipts).find(receipt => receipt.operation_id === id);
    // A metadata/status receipt is never implementation evidence by itself.
    if (!receipt || !receipt.affected_files.some(file => publication.stores[file]?.domain === "graph") || !["committed", "no_change"].includes(receipt.outcome)) return false;
  }
  for (const id of command.effect_obligation_ids) {
    const obligation = obligations.entries.find(entry => entry.id === id && entry.instance_id === state.instance_id);
    if (!obligation || !["source_applied", "reconciliation_pending", "graph_committed"].includes(obligation.state)) return false;
    if (!command.required_stages.includes("reconciliation")) return false;
  }
  return true;
}
export async function applyPlanCommand(input: { actor: PlanActor; plan_id: string; operation_id: string; expected_revision: number; expected_definition_hash: string;
  command: unknown; request_reference?: string; now?: string; fault_inject?: Fault; check_sources?: () => Promise<void>;
  definition_backup?: { markdown: string; log_markdown: string | null } }) {
  return withGraphReconciliation(async () => {
    const command = PlanCommandSchema.parse(input.command), identity = identityInput(input.actor, input.plan_id), scope = [`plan:${key(identity)}`], actor = actorKey(input.actor);
    fail(input.operation_id.length > 0 && input.operation_id.length <= 200, "PLAN_OPERATION_ID_INVALID");
    const intent = { kind: "plan_command", identity, expected_revision: input.expected_revision, expected_definition_hash: input.expected_definition_hash,
      command, actor: input.actor, request_reference: input.request_reference ?? null, definition_backup_hash: input.definition_backup ? bytesHash(input.definition_backup.markdown + "\0" + (input.definition_backup.log_markdown ?? "")) : null };
    const publication = await loadPublicationState();
    if (Object.values(publication.receipts).some(receipt => receipt.actor === actor && receipt.operation_id === input.operation_id)) {
      return commitGraphWrites({ writes: [], actor, scope, operation_id: input.operation_id, intent, cause: "plan_transition" });
    }
    const root = await loadRoot(), record = root.records[key(identity)]; fail(record, "PLAN_NOT_IMPORTED");
    fail(record.state.revision === input.expected_revision && record.state.definition_hash === input.expected_definition_hash, "PLAN_STATE_REVISION_CONFLICT");
    await input.check_sources?.();
    const now = input.now ?? new Date().toISOString();
    const context: PlanTransitionContext = { actor: input.actor, now,
      implementation_receipts_valid: command.type === "record_implementation" ? await implementationValid(record.state, command, input.actor) : false,
      closure_allowed: ["finish_verification", "complete_plan", "archive_plan", "supersede_plan"].includes(command.type) ? await closureAllowed(record.state, "slice_id" in command ? command.slice_id ?? undefined : undefined) : false };
    const next = reducePlanCommand(record.state, command, context);
    if (command.type === "reconcile_definition") {
      const backup = input.definition_backup; fail(backup && command.source_hash === bytesHash(backup.markdown) && command.log_hash === (backup.log_markdown === null ? null : bytesHash(backup.log_markdown)), "PLAN_DEFINITION_BACKUP_REQUIRED");
      fail(Buffer.byteLength(backup.markdown) + Buffer.byteLength(backup.log_markdown ?? "") <= 2 * 1024 * 1024, "PLAN_IMPORT_BACKUP_LIMIT");
      record.backups.push({ ...backup, source_hash: command.source_hash, log_hash: command.log_hash, review_id: command.review_id });
    }
    record.history.push({ sequence: next.event_sequence, actor: input.actor, command, now, before_hash: approvalHash(record.state), after_hash: approvalHash(next),
      implementation_receipts_valid: context.implementation_receipts_valid === true, closure_allowed: context.closure_allowed === true });
    record.state = next;
    return commitGraphWrites({ writes: [{ file: FILE, content: encode(root) }], actor, scope, operation_id: input.operation_id, intent, cause: "plan_transition",
      expected_sequence: publication.revision.publication_sequence, check_expected: input.check_sources, fault_inject: input.fault_inject,
      result: { plan_identity: identity, revision: next.revision, sequence: next.event_sequence, lifecycle: next.lifecycle, definition_hash: next.definition_hash, request_reference: input.request_reference ?? null } });
  });
}
/** Deterministic rebuild for inspection/recovery, never a read-time rewrite. */
export async function replayPlanHistory(scope: { instance_id: string; project_id: string; id: string }) {
  return withGraphRead(async () => {
    const record = (await loadRoot(true)).records[key(scope)]; fail(record, "PLAN_NOT_IMPORTED");
    let state = structuredClone(record.initial);
    for (const event of record.history) {
      fail(event.before_hash === approvalHash(state), "PLAN_HISTORY_CHAIN_CORRUPT");
      state = reducePlanCommand(state, event.command, event);
      fail(event.sequence === state.event_sequence && event.after_hash === approvalHash(state), "PLAN_HISTORY_REPLAY_CONFLICT");
    }
    fail(approvalHash(state) === approvalHash(record.state), "PLAN_HISTORY_PROJECTION_CONFLICT"); return state;
  });
}
/** Every consumer refetches on a gap/epoch change; duplicates cannot overwrite newer state. */
export function planEventDecision(current: { epoch: string; revision: number; sequence: number }, event: { epoch: string; revision: number; sequence: number }): "ignore" | "apply" | "refetch" {
  if (current.epoch !== event.epoch) return "refetch";
  if (event.sequence <= current.sequence || event.revision <= current.revision) return "ignore";
  return event.sequence === current.sequence + 1 && event.revision === current.revision + 1 ? "apply" : "refetch";
}

/** A content-bound front-end request can recover its result before rebuilding a changed preview. */
export async function replayPlanRequest(actor: PlanActor, operation_id: string, request_reference: string) {
  return withGraphRead(async () => {
    const receipt = Object.values((await loadPublicationState()).receipts).find(r => r.actor === actorKey(actor) && r.operation_id === operation_id);
    if (!receipt) return null;
    fail((receipt.result as { request_reference?: string } | undefined)?.request_reference === request_reference, "OPERATION_IDENTITY_CONFLICT");
    return { receipt, result: receipt.result, replayed: true };
  });
}
