import { cliModelEfforts } from "../config/architect-model-controls.js";
/** Physical inference boundary. A request cannot reach a provider without durable admission. */
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { getDataDir, withDataDirectory } from "../utils/paths.js";
import { readRoleProfiles, resolveRolePolicy, snapshotRolePolicy, type ModelRole, type ResolvedRolePolicy } from "../config/role-policy.js";
import { ModelPricingCatalogueSchema, type ModelPricing } from "../config/model-pricing.js";
import { providerCapability } from "../config/provider-capabilities.js";
import { MODEL_REQUEST_FRAMING_RESERVE_BYTES } from "../config/request-bounds.js";
import { ModelAdmission, ModelAdmissionError } from "./model-admission.js";
import { providerUsage } from "./provider-outcome.js";
import { summarizeProviderUsage } from "./provider-usage.js";
import type { LlmConfig, TokenUsage } from "./llm.js";
import { currentJob, assertJobCurrent } from "./job-context.js";
import {directoryInstanceId} from "../instance/identity.js";

const execution = new AsyncLocalStorage<ModelExecution>();
const callFrame = new AsyncLocalStorage<{ run_id: string; attempt_ids: string[]; usage: Array<TokenUsage | undefined> }>();
export interface ModelCallAdmission { run_id: string; attempt_ids: string[]; calls: number; usage?: TokenUsage;
  usage_by_call: Array<TokenUsage | null>; usage_provenance: "unavailable" | "partial" | "provider_reported"; }
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export class ModelExecution {
  readonly directory = getDataDir();
  readonly run_id: string;
  private sequence = 0;
  private deadline?: AbortSignal;
  private signals = new WeakMap<AbortSignal, AbortSignal>();
  private binding?: Promise<{ policy: Readonly<ResolvedRolePolicy>; admission: ModelAdmission; prices: ModelPricing[] }>;
  /** Previous admitted request of this run and the input tokens the provider reported for it (see calibratedInputAllocation). */
  private calibration?: { payload: string; input_tokens: number };
  constructor(private readonly config: LlmConfig, private readonly role: ModelRole,
    private readonly supplied?: Readonly<ResolvedRolePolicy>, run_id = `inference:${randomUUID()}`) { this.run_id = run_id; }
  private bind() {
    return this.binding ??= withDataDirectory(this.directory, async () => {
      const saved = await readRoleProfiles();
      const policy = this.supplied ?? snapshotRolePolicy(resolveRolePolicy({ role: this.role, saved: saved.roles[this.role], revision: saved.revision,
        legacy: this.config, session: { provider: this.config.provider, model: this.config.model, base_url: this.config.baseUrl,
          api: this.config.api === "responses" ? "responses" : this.config.api === "chat-completions" ? "chat_completions"
            : this.config.provider === "anthropic" ? "messages" : this.config.provider === "openai" || this.config.provider === "lmstudio"
              ? providerCapability(this.config.provider, this.config.model, this.config.capability)?.default_api === "responses" ? "responses" : "chat_completions" : "local",
          ...(this.config.reasoningEffort ? { effort: this.config.reasoningEffort } : {}),
          ...(this.config.store !== undefined ? { retention: this.config.store ? "store_true" : "store_false" } : {}),
          ...(this.config.capability ? { capability: this.config.capability } : {}),
          temperature: this.config.temperature, output_tokens: this.config.maxTokens, timeout_ms: this.config.timeoutMs } }));
      if (policy.status !== "configured") throw new ModelAdmissionError("ADMISSION_ROLE_POLICY_BLOCKED", this.run_id);
      const pinned=currentJob()?.role_policies[this.role];
      if(pinned&&policy.fingerprint!==pinned.fingerprint && !pinned.policy.fallbacks.some(fallback=>fallback.approved && fallback.provider===policy.policy.provider
        && fallback.model===policy.effective.model && fallback.adapter===policy.effective.adapter))throw new ModelAdmissionError("ADMISSION_JOB_ROUTE_NOT_APPROVED",this.run_id);
      const prices = ModelPricingCatalogueSchema.parse(JSON.parse(currentJob()?.pricing ?? process.env.DREAMGRAPH_LLM_PRICING ?? "[]"));
      const instance = process.env.DREAMGRAPH_INSTANCE_UUID || directoryInstanceId(this.directory);
      return { policy, prices, admission: new ModelAdmission(instance, this.directory) };
    });
  }
  within<T>(work: () => T): T { return withDataDirectory(this.directory, () => execution.run(this, work)); }
  async complete<T extends object>(work: () => Promise<T>): Promise<T & { admission: ModelCallAdmission }> {
    const frame = { run_id: this.run_id, attempt_ids: [] as string[], usage: [] as Array<TokenUsage | undefined> };
    const report = (): ModelCallAdmission => ({ run_id: frame.run_id, attempt_ids: [...frame.attempt_ids], calls: frame.attempt_ids.length,
      ...summarizeProviderUsage(frame.usage) });
    return this.within(() => callFrame.run(frame, async () => {
      try { return Object.assign(await work(), { admission: report() }); }
      catch (error) { if (error && typeof error === "object") Object.assign(error, { admission: report() }); throw error; }
    }));
  }
  async request<T>(input: { provider: string; model: string; payload: string; output_tokens: number; signal?: AbortSignal; retry?: boolean; attempt_id?: string },
    work: (signal: AbortSignal, attempt: { attempt_id: string; run_id: string }) => Promise<{ result: T; usage?: TokenUsage; acknowledged: boolean }>): Promise<T> {
    input.signal?.throwIfAborted();
    await assertJobCurrent();
    const { policy, prices, admission } = await this.bind();
    input.signal?.throwIfAborted();
    if (input.provider !== policy.policy.provider || input.model !== policy.effective.model) throw new ModelAdmissionError("ADMISSION_REQUEST_POLICY_MISMATCH", this.run_id);
    // Full UTF-8 wire bytes plus framing is a conservative allocation, not measured tokens. Within a run, the part of
    // the request already measured by the provider (the unchanged prefix and suffix of the previous request) is
    // counted by the provider-reported input tokens instead; only the new bytes keep the byte bound.
    // Images are included in the wire allocation. Variance halts further account admission.
    const input_tokens = calibratedInputAllocation(this.calibration, input.payload) + MODEL_REQUEST_FRAMING_RESERVE_BYTES;
    if (input_tokens > policy.effective.context_tokens) throw new ModelAdmissionError("ADMISSION_CONTEXT_LIMIT", this.run_id, null,
      `setting=DREAMGRAPH_LLM_${this.role.toUpperCase()}_CONTEXT_TOKENS; `
      + `required_allocation=${input_tokens}; context_allocation=${policy.effective.context_tokens}; `
      + `origin=${policy.origins.context_tokens}; counting=utf8_wire_bytes_plus_${MODEL_REQUEST_FRAMING_RESERVE_BYTES}`);
    if (!Number.isSafeInteger(input.output_tokens) || input.output_tokens < 1 || input.output_tokens > policy.effective.output_tokens) {
      throw new ModelAdmissionError("ADMISSION_OUTPUT_REQUEST_LIMIT", this.run_id);
    }
    const hasReasoning = policy.effective.effort !== "none" && (policy.capability?.efforts.length !== 0);
    const attempt_id = input.attempt_id ?? `${this.run_id}:${++this.sequence}:${randomUUID()}`;
    const tariff = prices.find(price => price.version === policy.policy.budget.pricing_version && price.provider === input.provider
      && price.model === input.model && price.currency === policy.policy.budget.currency);
    await admission.reserve({ id: attempt_id, run_id: this.run_id, policy_fingerprint: policy.fingerprint, budget: policy.policy.budget,
      ...(currentJob() ? { parent_run_id: currentJob()!.parent_admission.run_id } : {}),
      provider: input.provider, model: input.model, channel: policy.billing.channel, credential_reference: policy.connection.api_key_env,
      payload_hash: hash(input.payload), source_scope: [`role:${this.role}`],
      resources: { input_tokens, output_tokens: input.output_tokens, reasoning_tokens: hasReasoning ? input.output_tokens : 0, retry: input.retry ?? false }, pricing: tariff });
    if (input.signal?.aborted) { await admission.release(attempt_id); input.signal.throwIfAborted(); }
    const ledger = await admission.inspect(), run = ledger.runs[this.run_id];
    const remaining = policy.policy.budget.elapsed_ms - (Date.now() - Date.parse(run.created_at));
    this.deadline ??= AbortSignal.timeout(Math.max(1, remaining));
    let signal = input.signal ? this.signals.get(input.signal) : undefined;
    if (!signal) { signal = AbortSignal.any([...(input.signal ? [input.signal] : [AbortSignal.timeout(policy.effective.timeout_ms)]), this.deadline,
      ...(currentJob() ? [currentJob()!.signal] : [])]);
      if (input.signal) this.signals.set(input.signal, signal); }
    if (signal.aborted) { await admission.release(attempt_id); signal.throwIfAborted(); }
    try { await admission.dispatch(attempt_id); }
    catch (error) {
      // A lost dispatch reply is uncertain. Release succeeds only if durable state proves no dispatch.
      await admission.release(attempt_id).catch(() => undefined); throw error;
    }
    const frame = callFrame.getStore(), position = frame?.attempt_ids.length;
    if (frame) { frame.attempt_ids.push(attempt_id); frame.usage.push(undefined); }
    let answer: { result: T; usage?: TokenUsage; acknowledged: boolean };
    try { signal.throwIfAborted(); answer = await work(signal, { attempt_id, run_id: this.run_id }); }
    catch (error) {
      await admission.settle(attempt_id, { acknowledged: false }); throw error;
    }
    await admission.settle(attempt_id, { usage: answer.usage, acknowledged: answer.acknowledged });
    if (answer.acknowledged && answer.usage?.inputTokens !== undefined) this.calibration = { payload: input.payload, input_tokens: answer.usage.inputTokens };
    if (frame && position !== undefined) frame.usage[position] = answer.usage;
    signal.throwIfAborted(); return answer.result;
  }
}

/**
 * Input allocation for a request. Without a measured previous request of the same run this is the UTF-8 byte count.
 * With one, the new request is split into the prefix and suffix it shares with the previous request plus the bytes
 * in between: shared content is bounded by the provider-reported input tokens of the previous request (removed
 * content is not subtracted, which keeps the bound conservative) and the bytes in between are counted as tokens.
 * Never larger than the byte count.
 */
export function calibratedInputAllocation(previous: { payload: string; input_tokens: number } | undefined, payload: string): number {
  const bytes = Buffer.byteLength(payload);
  if (!previous || !Number.isSafeInteger(previous.input_tokens) || previous.input_tokens < 0) return bytes;
  const before = previous.payload, limit = Math.min(before.length, payload.length);
  let prefix = 0; while (prefix < limit && before.charCodeAt(prefix) === payload.charCodeAt(prefix)) prefix += 1;
  let suffix = 0; while (suffix < limit - prefix && before.charCodeAt(before.length - 1 - suffix) === payload.charCodeAt(payload.length - 1 - suffix)) suffix += 1;
  const changed = Buffer.byteLength(payload.slice(prefix, payload.length - suffix));
  return Math.min(bytes, previous.input_tokens + changed);
}

/** Readiness GETs deliberately remain outside this boundary; only inference dispatch calls use it. */
export async function admittedModelFetch(provider: string, url: string, init: RequestInit, retry = false): Promise<Response> {
  const bound = execution.getStore();
  if (!bound) throw new ModelAdmissionError("ADMISSION_EXECUTION_REQUIRED", "unbound");
  if (typeof init.body !== "string") throw new Error("ADMISSION_JSON_BODY_REQUIRED");
  const body = JSON.parse(init.body), output = body.max_output_tokens ?? body.max_completion_tokens ?? body.max_tokens ?? body.options?.num_predict;
  return bound.request({ provider, model: body.model, payload: init.body, output_tokens: output,
    signal: init.signal ?? undefined, retry }, async signal => {
    const response = await fetch(url, { ...init, signal });
    let result = response, content: string;
    if (response instanceof Response) {
      const reader = response.body?.getReader(), parts: Uint8Array[] = []; let length = 0;
      if (reader) try {
        for (;;) { signal.throwIfAborted(); const next = await reader.read(); if (next.done) break;
          length += next.value.byteLength;
          if (length > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error("PROVIDER_RESPONSE_BYTE_LIMIT"); }
          parts.push(next.value);
        }
      } finally { reader.releaseLock(); }
      content = Buffer.concat(parts).toString("utf8");
      result = new Response(content || null, { status: response.status, statusText: response.statusText, headers: response.headers });
    } else {
      // Fetch-compatible embedders may provide an already buffered response.
      const buffered = response as unknown as Response;
      content = buffered.ok ? JSON.stringify(await buffered.json()) : await buffered.text();
      if (Buffer.byteLength(content) > MAX_RESPONSE_BYTES) throw new Error("PROVIDER_RESPONSE_BYTE_LIMIT");
    }
    let usage: TokenUsage | undefined;
    try { const data = JSON.parse(content); usage = providerUsage(provider, provider === "ollama" ? data : data.usage); } catch { /* Unknown usage retains its reservation. */ }
    return { result, usage, acknowledged: true };
  });
}

export function currentModelExecution(): ModelExecution {
  const bound = execution.getStore();
  if (!bound) throw new ModelAdmissionError("ADMISSION_EXECUTION_REQUIRED", "unbound");
  return bound;
}

/** CLI limits count invocations. Internal inference count/currency is not observable or qualified. */
export async function nativeCliModelExecution(config: LlmConfig, adapter: string, model: string, effort?: string,
  role: ModelRole = "architect", run_id?: string): Promise<ModelExecution> {
  const profiles = await readRoleProfiles();
  const policy = snapshotRolePolicy(resolveRolePolicy({ role, legacy: config, saved: profiles.roles[role], revision: profiles.revision,
    session: { provider: config.provider, model, adapter, api: "native_cli", output_tokens: config.maxTokens,
      timeout_ms: config.timeoutMs, effort: effort ?? null },
    capabilities: { adapter, version: "dreamgraph.native_cli_invocation.v1", model,
      apis: ["native_cli"], efforts: cliModelEfforts(adapter, model),
      retention: [], strict_schema: false } }));
  return new ModelExecution({ ...config, model }, role, policy, run_id);
}
