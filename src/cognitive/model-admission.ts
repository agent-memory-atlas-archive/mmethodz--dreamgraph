/** Durable reserve-before-dispatch accounting over the shared publication owner. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { BudgetSchema, type ResourceBudget } from "../graph/contracts.js";
import { commitGraphWrites, loadPublicationState, publicationContentHash, recoverGraphPublication } from "../graph/publication.js";
import { withGraphRead, withGraphReconciliation } from "../utils/graph-reconciliation-barrier.js";
import { dataPath, getDataDir, withDataDirectory } from "../utils/paths.js";
import { stripBom } from "../utils/read-json.js";
import { allocationFloor, estimateCharge, estimateUsageCharge, ModelPricingSchema, type ModelPricing } from "../config/model-pricing.js";
import type { TokenUsage } from "./llm.js";
import { assertJobCurrent, withoutJobContext } from "./job-context.js";

const id = z.string().min(1).max(1024), count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const utc = z.string().datetime({ offset: true }), amount = z.string().regex(/^\d+$/);
const UsageSchema = z.object({ inputTokens: count.optional(), outputTokens: count.optional(), totalTokens: count.optional(),
  cachedInputTokens: count.optional(), cacheCreationInputTokens: count.optional(), reasoningTokens: count.optional() }).strict();
const ResourcesSchema = z.object({ input_tokens: count, output_tokens: count, reasoning_tokens: count, retry: z.boolean() }).strict();
const AttemptSchema = z.object({
  id, run_id: id, payload_hash: id, billing_key: id, policy_fingerprint: id, provider: id, model: id,
  channel: z.enum(["api", "local", "subscription", "client"]), credential_reference: id.nullable(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), admitted_at: utc, dispatched_at: utc.nullable(), settled_at: utc.nullable(),
  state: z.enum(["reserved", "dispatched", "settled", "uncertain", "released"]), acknowledged: z.boolean(),
  resources: ResourcesSchema, usage: UsageSchema.nullable(), pricing: ModelPricingSchema.nullable(),
  reserved_nanounits: amount, accounted_nanounits: amount, settlement_fingerprint: id.nullable(),
  charge_source: z.enum(["not_applicable", "conservative_reservation", "provider_usage_estimate", "unmeasured_subscription"]),
  source_scope: z.array(id).max(128), variance: z.array(id),
  /** Process that admitted the attempt; only a live owner can still have a request in flight. */
  owner_pid: count.optional(),
}).strict();
const RunSchema = z.object({ id, instance_id: id, policy_fingerprint: id, budget: BudgetSchema,
  created_at: utc, cancel_requested_at: utc.nullable(), parent_run_id: id.nullable().default(null) }).strict();
export const AdmissionLedgerSchema = z.object({
  schema: z.literal("dreamgraph.model_admission.v1"), instance_id: id, revision: count,
  runs: z.record(RunSchema), attempts: z.record(AttemptSchema), halted_billing_keys: z.record(z.array(id)),
}).strict();
export type AdmissionAttempt = z.infer<typeof AttemptSchema>;
export class ModelAdmissionError extends Error {
  constructor(readonly code: string, readonly run_id: string, readonly attempt_id: string | null = null,
    readonly detail: string | null = null) {
    super(`${code}: run ${run_id}${attempt_id ? `, attempt ${attempt_id}` : ""}${detail ? `; ${detail}` : ""}`); this.name = "ModelAdmissionError";
  }
}
export interface AdmissionRequest {
  id: string; run_id: string; policy_fingerprint: string; budget: ResourceBudget;
  parent_run_id?: string;
  provider: string; model: string; channel: AdmissionAttempt["channel"]; credential_reference: string | null;
  payload_hash: string; source_scope: string[]; resources: z.infer<typeof ResourcesSchema>; pricing?: ModelPricing | null;
}
/**
 * True when the process that admitted an attempt is still running. A request can only be in flight while
 * its owning daemon lives: after a crash or restart nobody can dispatch or settle it, so it must not keep
 * holding a concurrency slot (it used to block every later pass until its time budget ran out).
 * Attempts written before owner tracking (no owner_pid) predate this process and are treated as orphaned.
 */
export function ownerAlive(pid: number | undefined): boolean {
  if (pid === undefined) return false;
  if (pid === process.pid) return true;
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}
const hash = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const FILE = "spend_ledger.json";
const used = (attempt: AdmissionAttempt, field: "input_tokens" | "output_tokens" | "reasoning_tokens"): number => {
  if (attempt.state === "released") return 0;
  const known = field === "input_tokens" ? attempt.usage?.inputTokens : field === "output_tokens" ? attempt.usage?.outputTokens : attempt.usage?.reasoningTokens;
  return Math.max(known ?? 0, known === undefined ? attempt.resources[field] : 0);
};
const checkedSum = (values: number[]): number => {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(total)) throw new Error("ADMISSION_COUNT_OVERFLOW");
  return total;
};

/** One service is pinned to a physical instance directory, never the caller's later selection. */
export class ModelAdmission {
  constructor(readonly instance_id: string, readonly directory = getDataDir(), private readonly clock = () => new Date()) {
    id.parse(instance_id);
  }
  private inScope<T>(work: () => T): T { return withDataDirectory(this.directory, work); }
  private async load(): Promise<z.infer<typeof AdmissionLedgerSchema>> {
    const publication = await loadPublicationState();
    try {
      const body = await readFile(dataPath(FILE), "utf8");
      if (publication.stores[FILE] && publication.stores[FILE].hash !== publicationContentHash(body)) throw new Error("UNPUBLISHED_ADMISSION_CHANGE");
      const ledger = AdmissionLedgerSchema.parse(JSON.parse(stripBom(body)));
      if (ledger.instance_id !== this.instance_id) throw new Error("ADMISSION_INSTANCE_MISMATCH");
      return ledger;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && !publication.stores[FILE]) return {
        schema: "dreamgraph.model_admission.v1", instance_id: this.instance_id, revision: 0, runs: {}, attempts: {}, halted_billing_keys: {} };
      throw new ModelAdmissionError(`ADMISSION_LEDGER_UNAVAILABLE (${error instanceof Error ? error.message : "invalid state"})`, "unbound");
    }
  }
  private async save(ledger: z.infer<typeof AdmissionLedgerSchema>, operation: string): Promise<void> {
    ledger.revision++;
    AdmissionLedgerSchema.parse(ledger);
    const body = JSON.stringify(ledger);
    if (Buffer.byteLength(body) > (operation.startsWith("reserve:") ? 4 : 8) * 1024 * 1024) {
      throw new ModelAdmissionError("ADMISSION_LEDGER_CAPACITY_REQUIRES_ARCHIVE", "unbound");
    }
    const state = await loadPublicationState();
    await withoutJobContext(() => commitGraphWrites({ actor: "model_admission", operation_id: `admission:${operation}:${ledger.revision}`,
      ...(state.epoch !== "uninitialized" ? { operation_epoch: state.epoch } : {}),
      scope: [FILE], writes: [{ file: FILE, content: body }], cause: "model_admission" }));
  }
  async inspect() { return this.inScope(() => withGraphRead(() => this.load())); }
  async registerParentRun(run_id: string, fingerprint: string, budget: ResourceBudget): Promise<void> {
    id.parse(run_id); id.parse(fingerprint); BudgetSchema.parse(budget);
    return this.inScope(() => withGraphReconciliation(async () => {
      await recoverGraphPublication(); await assertJobCurrent(); const ledger = await this.load();
      const previous = ledger.runs[run_id];
      if (previous) {
        if (previous.policy_fingerprint !== fingerprint || hash(previous.budget) !== hash(budget) || previous.parent_run_id) throw new ModelAdmissionError("ADMISSION_PARENT_POLICY_CONFLICT", run_id);
        return;
      }
      ledger.runs[run_id] = { id: run_id, instance_id: this.instance_id, policy_fingerprint: fingerprint, budget,
        created_at: this.clock().toISOString(), cancel_requested_at: null, parent_run_id: null };
      await this.save(ledger, `parent:${run_id}`);
    }));
  }
  async reserve(request: AdmissionRequest): Promise<AdmissionAttempt> {
    const resources = ResourcesSchema.parse(request.resources), budget = BudgetSchema.parse(request.budget);
    [request.id, request.run_id, request.policy_fingerprint, request.provider, request.model, request.payload_hash].forEach(value => id.parse(value));
    z.array(id).max(128).parse(request.source_scope);
    const pricing = request.pricing ? ModelPricingSchema.parse(request.pricing) : null;
    const payload = hash({ ...request, resources, budget, pricing });
    return this.inScope(() => withGraphReconciliation(async () => {
      await recoverGraphPublication();
      await assertJobCurrent();
      const ledger = await this.load(), existing = ledger.attempts[request.id];
      if (existing) {
        if (existing.payload_hash !== payload) throw new ModelAdmissionError("ADMISSION_IDENTITY_CONFLICT", request.run_id, request.id);
        return existing; // Caller must inspect state; no dispatched/uncertain identity is executable again.
      }
      const now = this.clock(), timestamp = now.toISOString(), day = timestamp.slice(0, 10);
      const reject = (code: string): never => { throw new ModelAdmissionError(code, request.run_id, request.id); };
      const run = ledger.runs[request.run_id] ?? { id: request.run_id, instance_id: this.instance_id, policy_fingerprint: request.policy_fingerprint,
        budget, created_at: timestamp, cancel_requested_at: null, parent_run_id: request.parent_run_id ?? null };
      if (run.policy_fingerprint !== request.policy_fingerprint || hash(run.budget) !== hash(budget)) reject("ADMISSION_RUN_POLICY_CHANGED");
      if (run.parent_run_id !== (request.parent_run_id ?? null)) reject("ADMISSION_PARENT_CHANGED");
      if (run.cancel_requested_at) reject("ADMISSION_RUN_CANCELLED");
      if (now.getTime() < Date.parse(run.created_at)) reject("ADMISSION_CLOCK_REGRESSION");
      if (!budget.requests || !budget.concurrency || !budget.elapsed_ms || !resources.output_tokens) reject("ADMISSION_ZERO_RESOURCE_ALLOCATION");
      if (now.getTime() - Date.parse(run.created_at) >= budget.elapsed_ms) reject("ADMISSION_RUN_DEADLINE");
      const billing_key = hash({ instance: this.instance_id, principal: budget.billing_principal, provider: request.provider,
        currency: budget.currency });
      // Variance halts protect money. Subscription/local/client channels have no measured spend, so an
      // agentic CLI using more tokens than its first-request reservation must not stop all future work.
      if (request.channel === "api" && ledger.halted_billing_keys[billing_key]?.length) reject("ADMISSION_BILLING_VARIANCE_REQUIRES_REVIEW");
      const runAttempts = Object.values(ledger.attempts).filter(attempt => attempt.run_id === request.run_id && attempt.state !== "released");
      if (runAttempts.length >= budget.requests) reject("ADMISSION_REQUEST_LIMIT");
      if (checkedSum(runAttempts.map(attempt => Number(attempt.resources.retry))) + Number(resources.retry) > budget.retries) reject("ADMISSION_RETRY_LIMIT");
      for (const field of ["input_tokens", "output_tokens", "reasoning_tokens"] as const) {
        if (checkedSum(runAttempts.map(attempt => used(attempt, field))) + resources[field] > budget[field]) reject(`ADMISSION_${field.toUpperCase()}_LIMIT`);
      }
      // Unacknowledged requests hold a concurrency slot while they can still be in flight: the run is inside
      // its elapsed budget AND the process that admitted it is still running. Expired or orphaned attempts
      // (deadline passed, daemon restarted/crashed) keep their spend accounting but release the slot, so one
      // crashed, killed or expired pass cannot block every later pass.
      const nowMs = this.clock().getTime();
      const live = (attempt: AdmissionAttempt) => { const owner = ledger.runs[attempt.run_id];
        return !!owner && nowMs - Date.parse(owner.created_at) < owner.budget.elapsed_ms && ownerAlive(attempt.owner_pid); };
      const active = Object.values(ledger.attempts).filter(attempt => attempt.billing_key === billing_key && attempt.state !== "released" && !attempt.acknowledged && live(attempt));
      const concurrency = Math.min(budget.concurrency, ...active.map(attempt => ledger.runs[attempt.run_id].budget.concurrency));
      if (active.length >= concurrency) reject("ADMISSION_CONCURRENCY_LIMIT");
      let reserved = 0n;
      if (request.channel === "api") {
        if (!budget.run_amount || !budget.day_amount) reject("ADMISSION_ZERO_PAID_ALLOCATION");
        if (!pricing || pricing.provider !== request.provider || pricing.model !== request.model || pricing.currency !== budget.currency
          || pricing.version !== budget.pricing_version) reject("ADMISSION_EXACT_PRICING_REQUIRED");
        reserved = estimateCharge(pricing!, resources.input_tokens, resources.output_tokens);
        const runCharge = runAttempts.reduce((sum, attempt) => sum + BigInt(attempt.accounted_nanounits), 0n);
        const dayCharge = Object.values(ledger.attempts).filter(attempt => attempt.billing_key === billing_key && attempt.day === day)
          .reduce((sum, attempt) => sum + BigInt(attempt.accounted_nanounits), 0n);
        if (runCharge + reserved > allocationFloor(budget.run_amount)) reject("ADMISSION_RUN_AMOUNT_LIMIT");
        if (dayCharge + reserved > allocationFloor(budget.day_amount)) reject("ADMISSION_DAY_AMOUNT_LIMIT");
      } else if (request.channel === "subscription" && (budget.run_amount || budget.day_amount)) {
        // An API tariff cannot establish Codex/Copilot allowance consumption.
        reject("ADMISSION_SUBSCRIPTION_CURRENCY_UNQUALIFIED");
      }
      if (request.parent_run_id) {
        const parent = ledger.runs[request.parent_run_id];
        if (!parent || parent.parent_run_id || parent.id === request.run_id) reject("ADMISSION_PARENT_REQUIRED");
        const ceiling = parent!.budget;
        if (parent!.cancel_requested_at) reject("ADMISSION_PARENT_CANCELLED");
        if (now.getTime() < Date.parse(parent!.created_at) || now.getTime() - Date.parse(parent!.created_at) >= ceiling.elapsed_ms) reject("ADMISSION_PARENT_DEADLINE");
        const siblings = Object.values(ledger.attempts).filter(attempt => ledger.runs[attempt.run_id]?.parent_run_id === parent!.id && attempt.state !== "released");
        if (siblings.length >= ceiling.requests) reject("ADMISSION_PARENT_REQUEST_LIMIT");
        if (checkedSum(siblings.map(attempt => Number(attempt.resources.retry))) + Number(resources.retry) > ceiling.retries) reject("ADMISSION_PARENT_RETRY_LIMIT");
        for (const field of ["input_tokens", "output_tokens", "reasoning_tokens"] as const) if (checkedSum(siblings.map(attempt => used(attempt, field))) + resources[field] > ceiling[field]) reject(`ADMISSION_PARENT_${field.toUpperCase()}_LIMIT`);
        if (siblings.filter(attempt => !attempt.acknowledged && live(attempt)).length >= ceiling.concurrency) reject("ADMISSION_PARENT_CONCURRENCY_LIMIT");
        if (request.channel === "api") {
          if (ceiling.currency !== budget.currency) reject("ADMISSION_PARENT_CURRENCY_MISMATCH");
          if (ceiling.billing_principal !== budget.billing_principal) reject("ADMISSION_PARENT_PRINCIPAL_MISMATCH");
          if (!ceiling.run_amount || !ceiling.day_amount) reject("ADMISSION_PARENT_ZERO_PAID_ALLOCATION");
          if (siblings.reduce((sum, attempt) => sum + BigInt(attempt.accounted_nanounits), 0n) + reserved > allocationFloor(ceiling.run_amount)) reject("ADMISSION_PARENT_RUN_AMOUNT_LIMIT");
          const parentDay = Object.values(ledger.attempts).filter(attempt => attempt.day === day && ledger.runs[attempt.run_id]?.parent_run_id
            && ledger.runs[ledger.runs[attempt.run_id].parent_run_id!]?.budget.billing_principal === ceiling.billing_principal
            && ledger.runs[ledger.runs[attempt.run_id].parent_run_id!]?.budget.currency === ceiling.currency);
          if (parentDay.reduce((sum, attempt) => sum + BigInt(attempt.accounted_nanounits), 0n) + reserved > allocationFloor(ceiling.day_amount)) reject("ADMISSION_PARENT_DAY_AMOUNT_LIMIT");
        }
      }
      const attempt: AdmissionAttempt = { id: request.id, run_id: request.run_id, payload_hash: payload, billing_key,
        policy_fingerprint: request.policy_fingerprint, provider: request.provider, model: request.model, channel: request.channel,
        credential_reference: request.credential_reference, day, admitted_at: timestamp, dispatched_at: null, settled_at: null,
        state: "reserved", acknowledged: false, resources, usage: null, pricing, reserved_nanounits: String(reserved), accounted_nanounits: String(reserved),
        settlement_fingerprint: null, charge_source: request.channel === "api" ? "conservative_reservation" : request.channel === "subscription" ? "unmeasured_subscription" : "not_applicable",
        source_scope: request.source_scope, variance: [], owner_pid: process.pid };
      ledger.runs[request.run_id] = run; ledger.attempts[request.id] = attempt;
      await this.save(ledger, `reserve:${request.id}`);
      return attempt;
    }));
  }
  async dispatch(attempt_id: string): Promise<AdmissionAttempt> {
    return this.inScope(() => withGraphReconciliation(async () => {
      await assertJobCurrent();
      await recoverGraphPublication(); const ledger = await this.load(), attempt = ledger.attempts[attempt_id];
      if (!attempt) throw new ModelAdmissionError("ADMISSION_ATTEMPT_UNKNOWN", "unbound", attempt_id);
      if (attempt.state !== "reserved") throw new ModelAdmissionError("ADMISSION_REDISPATCH_FORBIDDEN", attempt.run_id, attempt_id);
      if (ledger.runs[attempt.run_id].cancel_requested_at) throw new ModelAdmissionError("ADMISSION_RUN_CANCELLED", attempt.run_id, attempt_id);
      const parent_id = ledger.runs[attempt.run_id].parent_run_id;
      if (parent_id && ledger.runs[parent_id].cancel_requested_at) throw new ModelAdmissionError("ADMISSION_PARENT_CANCELLED", attempt.run_id, attempt_id);
      if (this.clock().getTime() < Date.parse(ledger.runs[attempt.run_id].created_at)) throw new ModelAdmissionError("ADMISSION_CLOCK_REGRESSION", attempt.run_id, attempt_id);
      if (this.clock().getTime() - Date.parse(ledger.runs[attempt.run_id].created_at) >= ledger.runs[attempt.run_id].budget.elapsed_ms) {
        throw new ModelAdmissionError("ADMISSION_RUN_DEADLINE", attempt.run_id, attempt_id);
      }
      attempt.state = "dispatched"; attempt.dispatched_at = this.clock().toISOString();
      await this.save(ledger, `dispatch:${attempt_id}`); return attempt;
    }));
  }
  async settle(attempt_id: string, input: { usage?: TokenUsage; acknowledged: boolean }): Promise<AdmissionAttempt> {
    const usage = input.usage ? UsageSchema.parse(input.usage) : null, fingerprint = hash({ usage, acknowledged: input.acknowledged });
    return this.inScope(() => withGraphReconciliation(async () => {
      await recoverGraphPublication(); const ledger = await this.load(), attempt = ledger.attempts[attempt_id];
      if (!attempt) throw new ModelAdmissionError("ADMISSION_ATTEMPT_UNKNOWN", "unbound", attempt_id);
      if (attempt.settlement_fingerprint === fingerprint) return attempt;
      if (!["dispatched", "uncertain"].includes(attempt.state)) throw new ModelAdmissionError("ADMISSION_SETTLEMENT_STATE_CONFLICT", attempt.run_id, attempt_id);
      if (usage && attempt.usage) for (const [field, value] of Object.entries(usage)) {
        const before = attempt.usage[field as keyof TokenUsage];
        if (before !== undefined && value < before) throw new ModelAdmissionError("ADMISSION_USAGE_REGRESSION", attempt.run_id, attempt_id);
      }
      attempt.usage = usage || attempt.usage ? { ...attempt.usage, ...usage } : null;
      attempt.acknowledged ||= input.acknowledged; attempt.settlement_fingerprint = fingerprint;
      const observed = attempt.usage;
      const complete = observed?.inputTokens !== undefined && observed.outputTokens !== undefined
        && (attempt.resources.reasoning_tokens === 0 || observed.reasoningTokens !== undefined);
      attempt.state = complete && attempt.acknowledged ? "settled" : "uncertain";
      attempt.settled_at = this.clock().toISOString();
      if (attempt.pricing && observed?.inputTokens !== undefined && observed.outputTokens !== undefined) {
        const charge = estimateUsageCharge(attempt.pricing, { inputTokens: observed.inputTokens, outputTokens: observed.outputTokens, cachedInputTokens: observed.cachedInputTokens });
        // Missing reasoning is already inside output billing; monetary estimation can
        // be known while its independent reasoning limit remains conservatively held.
        attempt.accounted_nanounits = String(charge); attempt.charge_source = "provider_usage_estimate";
      }
      for (const field of ["input_tokens", "output_tokens", "reasoning_tokens"] as const) {
        if (used(attempt, field) > attempt.resources[field]) attempt.variance.push(`${field}_exceeded_reservation`);
      }
      if (BigInt(attempt.accounted_nanounits) > BigInt(attempt.reserved_nanounits)) attempt.variance.push("estimated_charge_exceeded_reservation");
      if (observed?.inputTokens !== undefined && (observed.cachedInputTokens ?? 0) + (observed.cacheCreationInputTokens ?? 0) > observed.inputTokens) attempt.variance.push("inconsistent_cache_components");
      if (observed?.outputTokens !== undefined && (observed.reasoningTokens ?? 0) > observed.outputTokens) attempt.variance.push("inconsistent_reasoning_component");
      attempt.variance = [...new Set(attempt.variance)];
      if (attempt.variance.length && attempt.channel === "api") ledger.halted_billing_keys[attempt.billing_key] = [...new Set(attempt.variance)];
      await this.save(ledger, `settle:${attempt_id}`); return attempt;
    }));
  }
  /** Releases only a durable reservation proven not to have been dispatched. */
  async release(attempt_id: string): Promise<void> {
    return this.inScope(() => withGraphReconciliation(async () => {
      await recoverGraphPublication(); const ledger = await this.load(), attempt = ledger.attempts[attempt_id];
      if (!attempt || attempt.state === "released") return;
      if (attempt.state !== "reserved") throw new ModelAdmissionError("ADMISSION_RELEASE_REQUIRES_NO_DISPATCH", attempt.run_id, attempt_id);
      attempt.state = "released"; attempt.acknowledged = true; attempt.accounted_nanounits = "0";
      await this.save(ledger, `release:${attempt_id}`);
    }));
  }
  /** Paid billing keys paused because actual usage exceeded a reservation, with what caused it. */
  async billingReviews() {
    const ledger = await this.inspect();
    return Object.entries(ledger.halted_billing_keys).map(([billing_key, variance]) => {
      const attempts = Object.values(ledger.attempts).filter(attempt => attempt.billing_key === billing_key);
      const latest = attempts.sort((a, b) => b.admitted_at.localeCompare(a.admitted_at))[0];
      return { billing_key, variance, provider: latest?.provider ?? null, model: latest?.model ?? null, channel: latest?.channel ?? null, since: latest?.settled_at ?? latest?.admitted_at ?? null };
    });
  }
  /** Operator review: resume a paused billing key. Attempt history and accounting are kept. */
  async resumeBillingKey(billing_key: string): Promise<boolean> {
    return this.inScope(() => withGraphReconciliation(async () => {
      await recoverGraphPublication(); const ledger = await this.load();
      if (!ledger.halted_billing_keys[billing_key]) return false;
      delete ledger.halted_billing_keys[billing_key];
      await this.save(ledger, `review:${billing_key.slice(0, 16)}`); return true;
    }));
  }
  async cancel(run_id: string): Promise<string[]> {
    return this.inScope(() => withGraphReconciliation(async () => {
      await recoverGraphPublication(); const ledger = await this.load(), run = ledger.runs[run_id];
      if (!run) throw new ModelAdmissionError("ADMISSION_RUN_UNKNOWN", run_id);
      if (!run.cancel_requested_at) { run.cancel_requested_at = this.clock().toISOString(); await this.save(ledger, `cancel:${run_id}`); }
      return Object.values(ledger.attempts).filter(attempt => (attempt.run_id === run_id || ledger.runs[attempt.run_id]?.parent_run_id === run_id)
        && !attempt.acknowledged && attempt.state !== "released").map(attempt => attempt.id);
    }));
  }
}
