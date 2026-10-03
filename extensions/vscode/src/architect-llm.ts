import { resolveProviderCapability } from "./generated/provider-capabilities.js";
import { AsyncLocalStorage } from 'node:async_hooks';
import type { ManagedModelSession, NativeModelTicket } from './managed-model-session.js';
import type { ManagedModelBinding } from './generated/graph-contracts.js';
import { assertProviderOutcome, assertClientFunctionOutput, providerUsage, compileOutputValidator, validateCompletionText, anthropicOutputSchema, ProviderOutcomeError, type TokenUsage } from "./generated/provider-outcome.js";
/**
 * DreamGraph Architect LLM Provider — Layer 2 (Context Orchestration).
 *
 * Calls the Architect model (Anthropic, OpenAI, or Ollama) with
 * structured prompts assembled from the context orchestration layer.
 */

import * as vscode from "vscode";
import {
  buildOpenAIResponsesRequest,
  extractOpenAIResponsesRawItems,
  extractOpenAIResponsesToolCalls,
  normalizeOpenAIResponsesResult,
  toOpenAIResponsesContent,
  translateRawToOpenAIResponses,
  usesOpenAIResponsesApi,
  RESPONSES_RAW_ITEMS_KEY,
  type OpenAIResponsesData,
} from "./openai-responses-adapter";
import {
  applySharedRequestCompaction,
  compactSystemPrompt,
  minifyToolDefinitions,
} from "./request-compaction";
import {
  ARCHITECT_PASS_JSON_SCHEMA,
  ARCHITECT_PASS_SCHEMA_NAME,
} from "./architect-pass-schema.js";
import {
  StrictNarrativeStreamExtractor,
  projectStrictEnvelopeToLegacy,
} from "./architect-pass-projection.js";

export type ArchitectProvider = "anthropic" | "openai" | "ollama" | "lmstudio" | "copilot-cli" | "codex-cli";
export type AnthropicEffort = "low" | "medium" | "high" | "xhigh" | "max";

export interface ArchitectConfig {
  provider: ArchitectProvider;
  model: string;
  baseUrl: string;
  apiKey: string;
}

export type ArchitectContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; dataBase64: string; fileName?: string; filePath?: string };

export type ArchitectTextBlock = { type: "text"; text: string };
export type ArchitectImageBlock = { type: "image"; mimeType: string; dataBase64: string; fileName?: string; filePath?: string };
export type ArchitectContent = ArchitectTextBlock | ArchitectImageBlock;

export interface ArchitectMessage {
  role: "system" | "user" | "assistant";
  content: string | ArchitectContent[];
}

export interface ArchitectModelCapabilities {
  textAttachments: boolean;
  imageAttachments: boolean;
}

export interface ArchitectResponse {
  content: string;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
  usage?: TokenUsage;
}

export interface ToolUseRequest {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ArchitectToolResponse extends ArchitectResponse {
  toolCalls: ToolUseRequest[];
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "stop" | string;
  /** Provider-specific verbatim assistant turn items.
   * OpenAI returns `output[]` including encrypted reasoning; Anthropic returns
   * signed `content[]` blocks. Persist these unchanged for the next tool turn. */
  providerRawAssistant?: unknown[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolResultMessage {
  role: "user";
  content: Array<{
    type: "tool_result";
    tool_use_id: string;
    content: string;
    is_error?: boolean;
  }>;
}

export type StreamCallback = (chunk: string) => void;

export const ANTHROPIC_MODELS = [
  "claude-opus-5-5",
  "claude-sonnet-5-5",
  "claude-fable-5-1",
  "claude-mythos-5-1",
  "claude-opus-5",
  "claude-sonnet-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-fable-5",
  "claude-mythos-5",
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
];

export const OPENAI_MODELS = [
  "gpt-6.1-sol",
  "gpt-6-astra",
  "gpt-6-sol",
  "gpt-6-luna",
  "gpt-5.6",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.5",
  "gpt-5",
  "gpt-5.4",
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
  "gpt-4o-mini",
  "o3",
  "o4-mini",
];

// Models the GitHub Copilot CLI accepts on the `--model` flag. The CLI
// is the source of truth and may add/remove entries between releases;
// this list reflects the currently-shipping set the user has access to.
export const COPILOT_CLI_MODELS = [
  "claude-opus-4.7",
  "claude-opus-4.6",
  "gpt-5.5",
  "gpt-5.4",
  "gpt-4o",
  "claude-sonnet-4.6",
  "auto",
];

export const CODEX_CLI_MODELS = [
  "gpt-6.1-sol",
  "gpt-6-astra",
  "gpt-6-sol",
  "gpt-6-luna",
  "gpt-5.6",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.3-codex",
  "gpt-5.2-codex",
  "gpt-5.2",
  "gpt-5-mini",
  "auto",
];

const ANTHROPIC_EFFORT_MODELS = [
  "claude-opus-5",
  "claude-sonnet-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-fable-5",
  "claude-mythos-5",
] as const;

export function supportsAnthropicEffortConfig(model: string): boolean {
  return Boolean(resolveProviderCapability("anthropic", model.trim())?.efforts.length);
}

export function supportsAnthropicAdaptiveThinking(model: string): boolean {
  return supportsAnthropicEffortConfig(model);
}

export function usesBoundAnthropicThinking(model: string): boolean {
  return /^claude-(?:opus-5-5|sonnet-5-5|fable-5-1)(?:$|[-_])/i.test(model.trim());
}

function anthropicThinkingHeaders(model: string): Record<string, string> {
  return usesBoundAnthropicThinking(model)
    ? { "anthropic-beta": "thinking-binding-controls-2026-08-01" } : {};
}

function logAnthropicThinkingDrops(model: string, transformations: unknown): void {
  if (!Array.isArray(transformations)) return;
  const dropped = transformations.filter((item) => item?.type === "thinking_dropped").length;
  if (dropped > 0) console.warn("[DreamGraph][anthropic_thinking_dropped]", { model, dropped });
}

export function getAnthropicDefaultEffortForModel(model: string): AnthropicEffort {
  if (model.trim().toLowerCase().startsWith("claude-opus-5-5")) return "medium";
  if (/^claude-(sonnet-5|fable-5-1|mythos-5-1)/i.test(model.trim())) return "high";
  const supported = resolveProviderCapability("anthropic", model.trim())?.efforts as readonly string[] | undefined;
  return supported?.includes("xhigh") ? "xhigh" : "high";
}

export function getAnthropicMaxTokensForModel(model: string): number {
  const normalized = model.trim().toLowerCase();
  if (normalized.startsWith("claude-fable-5")) {
    return 128_000;
  }
  if (/^claude-(opus-5|sonnet-5|mythos-5-1)/.test(normalized)) return 128_000;
  if (supportsAnthropicEffortConfig(normalized)) {
    return 65_536;
  }
  return 8_192;
}


/* ------------------------------------------------------------------ */
/*  Emergency input-budget brakes                                     */
/* ------------------------------------------------------------------ */
/**
 * Per-section warning threshold (chars). Character/token estimates are telemetry.
 * An independent UTF-8 byte ceiling refuses the complete serialized request;
 * neither this defensive ceiling nor the soft coordinator measures model tokens.
 */
const SECTION_WARN_CHARS = 80_000;
const MAX_NATIVE_REQUEST_BYTES = 8 * 1024 * 1024;

/**
 * Optional sink that receives structured budget summaries.
 * Set by extension activation via `setRequestBudgetSink(inspector.logRequestBudget.bind(inspector))`
 * so output appears in the "DreamGraph Context" output channel.
 * Falls back to console.log/warn if no sink is registered.
 */
type RequestBudgetSink = (summary: {
  callsite: string;
  model: string;
  inputChars: number;
  approxTokens: number;
  sections: Array<{ name: string; chars: number; approxTokens: number }>;
  warn?: boolean;
}) => void;
let _budgetSink: RequestBudgetSink | undefined;
export function setRequestBudgetSink(sink: RequestBudgetSink | undefined): void {
  _budgetSink = sink;
}

function _logRequestBudget(callsite: string, model: string, body: Record<string, unknown>, serialized: string): void {
  // Per-section breakdown: top-level keys + system + per-message char counts.
  const sections: Array<{ name: string; chars: number; approxTokens: number }> = [];
  const push = (name: string, content: unknown): void => {
    const s = typeof content === 'string' ? content : JSON.stringify(content ?? '');
    const chars = s.length;
    sections.push({ name, chars, approxTokens: Math.ceil(chars / 4) });
  };
  if (typeof body.system === 'string') push('system', body.system);
  const messages = (body as { messages?: unknown[] }).messages;
  if (Array.isArray(messages)) {
    messages.forEach((m, i) => {
      const role = (m as { role?: string }).role ?? 'unknown';
      push(`messages[${i}].${role}`, (m as { content?: unknown }).content);
    });
  }
  const tools = (body as { tools?: unknown[] }).tools;
  if (Array.isArray(tools)) push('tools', tools);

  const inputChars = serialized.length;
  const approxTokens = Math.ceil(inputChars / 4);
  const oversizedSections = sections.filter((s) => s.chars > SECTION_WARN_CHARS);
  const warn = oversizedSections.length > 0 || inputChars > 200_000;
  const topSections = sections.sort((a, b) => b.chars - a.chars).slice(0, 10);

  if (_budgetSink) {
    _budgetSink({ callsite, model, inputChars, approxTokens, sections: topSections, warn });
    return;
  }
  // Fallback: console output if no sink registered yet (early activation).
  const summary = { callsite, model, inputChars, approxTokens, sections: topSections };
  if (warn) console.warn('[DreamGraph][llm_input_budget]', JSON.stringify(summary));
  else console.log('[DreamGraph][llm_input_budget]', JSON.stringify({ callsite, model, inputChars, approxTokens }));
}

function _serializeAndLogRequest(callsite: string, model: string, body: Record<string, unknown>): string {
  const serialized = JSON.stringify(body);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_NATIVE_REQUEST_BYTES) {
    throw new Error('REQUEST_UTF8_BYTE_BOUND: whole request exceeds 8 MiB; narrow the input. Required evidence was not clipped, and no provider request was sent.');
  }
  _logRequestBudget(callsite, model, body, serialized);
  return serialized;
}

export class ArchitectLlm implements vscode.Disposable {
  private _config: ArchitectConfig | null = null;
  private _secretStorage: vscode.SecretStorage;
  private _managedModelsRequired = false;
  private readonly _modelScope = new AsyncLocalStorage<ManagedModelSession>();
  private readonly _modelCall = new AsyncLocalStorage<{ session: ManagedModelSession; retry: boolean; ticket?: NativeModelTicket; launched: boolean; terminal: boolean; usage?: TokenUsage; controller: AbortController }>();

  /** Scope follows asynchronous continuations, without sharing authority between concurrent host passes. */
  withinModelAdmission<T>(session: ManagedModelSession, work: () => Promise<T>): Promise<T> {
    if (this._modelScope.getStore()) throw new Error('NATIVE_MODEL_SCOPE_ALREADY_BOUND');
    return this._modelScope.run(session, work);
  }
  /** Production editor entry points cannot silently become an unaccounted provider adapter. */
  requireModelAdmission(): void { this._managedModelsRequired = true; }
  private async _inference<T extends ArchitectResponse>(retry: boolean, work: () => Promise<T>): Promise<T> {
    const session = this._modelScope.getStore();
    if (!session) {
      if (this._managedModelsRequired) throw new Error('NATIVE_MODEL_MANAGED_SCOPE_REQUIRED: use the original DreamGraph host model admission');
      return work(); // Standalone embedders remain explicitly unattested until they adopt a host port.
    }
    const frame = { session, retry, launched: false, terminal: false, controller: new AbortController() } as NonNullable<ReturnType<ArchitectLlm['_modelCall']['getStore']>>;
    return this._modelCall.run(frame, async () => {
      let reply: T | undefined, failure: unknown;
      try { reply = await work(); } catch (error) { failure = error; }
      try {
        if (frame.ticket) await session.settle(frame.ticket, reply?.usage ?? frame.usage ?? (failure instanceof ProviderOutcomeError ? failure.usage : undefined),
          frame.terminal || !frame.launched ? 'confirmed' : 'unconfirmed', frame.terminal || !frame.launched);
      } catch (error) {
        throw new Error(`NATIVE_MODEL_REPORT_REQUIRED: ${session.executionId}; ${String(error)}${failure ? `; native outcome: ${String(failure)}` : ''}`, { cause: failure ?? error });
      } finally { frame.controller.abort(new Error('NATIVE_MODEL_REQUEST_CLOSED')); }
      if (failure !== undefined) throw failure;
      if (!reply) throw new Error('NATIVE_MODEL_REPLY_UNAVAILABLE');
      if (frame.ticket && !frame.terminal) throw new Error('NATIVE_MODEL_TERMINAL_UNCONFIRMED');
      return reply;
    });
  }
  private async _fetch(config: ArchitectConfig, url: string, init: RequestInit): Promise<Response> {
    const frame = this._modelCall.getStore();
    if (!frame) return fetch(url, init);
    if (frame.ticket) throw new Error('NATIVE_MODEL_SECOND_DISPATCH_FORBIDDEN');
    if (typeof init.body !== 'string') throw new Error('NATIVE_MODEL_SERIALIZED_BODY_REQUIRED');
    const body = JSON.parse(init.body), api = url === `${config.baseUrl}/responses` ? 'responses'
      : url === `${config.baseUrl}/chat/completions` ? 'chat_completions'
      : url === `${config.baseUrl}/messages` ? 'messages' : url === `${config.baseUrl}/api/chat` ? 'local' : undefined;
    if (!api || !['openai', 'anthropic', 'ollama', 'lmstudio'].includes(config.provider)) throw new Error('NATIVE_MODEL_ENDPOINT_UNSUPPORTED');
    const output = body.max_output_tokens ?? body.max_completion_tokens ?? body.max_tokens ?? body.options?.num_predict;
    const binding: ManagedModelBinding = { provider: config.provider as ManagedModelBinding['provider'], adapter: 'native_api', model: config.model,
      api, base_url: config.baseUrl, effort: body.reasoning?.effort ?? body.reasoning_effort ?? body.output_config?.effort ?? null,
      retention: body.store === false ? 'store_false' : body.store === true ? 'store_true' : api === 'local' ? 'local_only' : 'provider_default',
      strict_schema: body.response_format?.json_schema?.strict === true || body.text?.format?.strict === true || body.output_config?.format?.type === 'json_schema', output_tokens: output };
    frame.ticket = await frame.session.admit(binding, init.body, output, init.signal ?? undefined, frame.retry);
    frame.ticket.signal.throwIfAborted();
    frame.launched = true;
    const signal = AbortSignal.any([frame.ticket.signal, frame.controller.signal]);
    const response = await fetch(url, { ...init, signal });
    // A finite whole-response ceiling preserves live streaming; it is byte safety, not token measurement.
    const reader = response.body?.getReader(); let bytes = 0, eventBuffer = '';
    const decoder = new TextDecoder(), rawUsage: Record<string, unknown> = {};
    const observe = (data: any) => {
      if (!data || typeof data !== 'object') return;
      const providerData = data.response ?? data;
      if (binding.provider === 'openai' && (binding.api === 'responses'
        ? ['completed', 'incomplete', 'failed', 'cancelled'].includes(providerData.status)
        : ['stop', 'tool_calls', 'function_call', 'length', 'content_filter'].includes(data.choices?.[0]?.finish_reason))
        || binding.provider === 'lmstudio' && ['stop', 'tool_calls', 'function_call', 'length', 'content_filter'].includes(data.choices?.[0]?.finish_reason)
        || binding.provider === 'anthropic' && (data.type === 'message_stop' || ['end_turn', 'tool_use', 'max_tokens', 'stop_sequence', 'refusal', 'pause_turn', 'model_context_window_exceeded'].includes(data.stop_reason))
        || binding.provider === 'ollama' && data.done === true) frame.terminal = true;
      Object.assign(rawUsage, data.message?.usage ?? {}, providerData.usage ?? data.usage ?? {});
      const usage = providerUsage(binding.provider, binding.provider === 'ollama' ? data : rawUsage);
      if (usage) frame.usage = { ...frame.usage, ...usage };
    };
    const observeLine = (line: string) => {
      const value = binding.provider === 'ollama' ? line.trim() : line.startsWith('data:') ? line.slice(5).trim() : '';
      if (!value || value === '[DONE]') return; // A transport sentinel alone cannot attest provider completion.
      try { observe(JSON.parse(value)); } catch { /* The native parser owns malformed protocol refusal. */ }
    };
    const bounded = reader ? new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          signal.throwIfAborted(); const part = await reader.read();
          if (part.done) {
            if (body.stream) { eventBuffer += decoder.decode(); if (eventBuffer.trim()) observeLine(eventBuffer); }
            reader.releaseLock(); controller.close(); return;
          }
          bytes += part.value.byteLength;
          if (bytes > 8 * 1024 * 1024) { await reader.cancel(); throw new Error('NATIVE_MODEL_RESPONSE_UTF8_BYTE_BOUND'); }
          if (body.stream && response.ok) {
            eventBuffer += decoder.decode(part.value, { stream: true });
            const lines = eventBuffer.split('\n'); eventBuffer = lines.pop() ?? '';
            if (Buffer.byteLength(eventBuffer, 'utf8') > 4 * 1024 * 1024) throw new Error('NATIVE_MODEL_STREAM_FRAME_BYTE_BOUND');
            lines.forEach(observeLine);
          }
          controller.enqueue(part.value);
        } catch (error) { await reader.cancel().catch(() => undefined); controller.error(error); }
      },
      cancel(reason) { return reader.cancel(reason); },
    }) : null;
    const result = new Response(bounded, { status: response.status, statusText: response.statusText, headers: response.headers });
    if (!body.stream || !result.ok && [400, 401, 403, 404, 422, 429].includes(result.status)) {
      const content = await result.text(); signal.throwIfAborted();
      if (!result.ok && [400, 401, 403, 404, 422, 429].includes(result.status)) frame.terminal = true;
      else if (result.ok) { try { observe(JSON.parse(content)); } catch { /* Native validation refuses the invalid whole result. */ } }
      return new Response(content || null, { status: result.status, statusText: result.statusText, headers: result.headers });
    }
    return result;
  }

  constructor(secretStorage: vscode.SecretStorage) {
    this._secretStorage = secretStorage;
  }

  get isConfigured(): boolean {
    return this._config !== null && this._config.provider.length > 0;
  }

  get provider(): ArchitectProvider | null {
    return this._config?.provider ?? null;
  }

  get currentConfig(): ArchitectConfig | null {
    return this._config ? { ...this._config } : null;
  }

  /** Apply a config directly in memory (skips settings round-trip). */
  applyConfig(config: ArchitectConfig): void {
    this._config = {
      ...config,
      baseUrl: config.baseUrl || this._defaultBaseUrl(config.provider),
    };
  }

  getModelCapabilities(provider?: ArchitectProvider | null, model?: string | null): ArchitectModelCapabilities {
    const effectiveProvider = provider ?? this._config?.provider ?? null;
    const effectiveModel = (model ?? this._config?.model ?? "").toLowerCase();

    if (!effectiveProvider) {
      return { textAttachments: false, imageAttachments: false };
    }

    switch (effectiveProvider) {
      case "anthropic":
      case "openai":
        return { textAttachments: true, imageAttachments: resolveProviderCapability(effectiveProvider, effectiveModel)?.images ?? false };
      case "ollama":
        return { textAttachments: true, imageAttachments: false };
      case "lmstudio":
        return { textAttachments: true, imageAttachments: false };
      case "copilot-cli":
      case "codex-cli":
        // Native CLI provider ports serialize attachments as prompt-visible
        // @file references, which the CLI can load from its prompt surface.
        return { textAttachments: true, imageAttachments: true };
      default:
        return { textAttachments: false, imageAttachments: false };
    }
  }

  private _getAnthropicEffort(model: string): AnthropicEffort {
    const cfg = vscode.workspace.getConfiguration("dreamgraph.architect");
    const configured = (cfg.get<string>("anthropic.effort") ?? "").trim().toLowerCase();
    const normalized = configured === "xhigh" || configured === "max" || configured === "high" || configured === "medium" || configured === "low"
      ? (configured as AnthropicEffort)
      : undefined;

    if (normalized) {
      if (!(resolveProviderCapability("anthropic", model)?.efforts as readonly string[] | undefined)?.includes(normalized)) throw new Error("REASONING_EFFORT_UNSUPPORTED");
      return normalized;
    }

    return getAnthropicDefaultEffortForModel(model);
  }

  private _getAnthropicMaxTokens(model: string): number {
    return getAnthropicMaxTokensForModel(model);
  }

  private _getAnthropicThinking(model: string): Record<string, unknown> | undefined {
    if (!supportsAnthropicAdaptiveThinking(model)) {
      return undefined;
    }

    const cfg = vscode.workspace.getConfiguration("dreamgraph.architect");
    const enabled = cfg.get<boolean>("anthropic.adaptiveThinking") ?? true;
    if (!enabled && !usesBoundAnthropicThinking(model)) {
      return undefined;
    }

    const summarized = cfg.get<boolean>("anthropic.showThinkingSummary") ?? true;
    return {
      type: "adaptive",
      ...(summarized ? { display: "summarized" } : {}),
      // Architect can rebuild context/tools between passes. Let the API discard
      // only invalidated reasoning instead of rejecting a compacted history.
      ...(usesBoundAnthropicThinking(model)
        ? { block_binding: { prefix_mismatch_behavior: "drop_block" } } : {}),
    };
  }

  private _buildAnthropicMessagesRequest(
    config: ArchitectConfig,
    messages: unknown[],
    system?: string,
    tools?: ToolDefinition[],
    stream?: boolean,
  ): Record<string, unknown> {
    const compactedSystem = system ? compactSystemPrompt(system) : undefined;
    const compactedTools = tools ? minifyToolDefinitions(tools) : undefined;
    const body: Record<string, unknown> = {
      model: config.model,
      max_tokens: this._getAnthropicMaxTokens(config.model),
      messages,
    };

    if (compactedSystem) {
      body.system = compactedSystem;
    }

    if (stream) {
      body.stream = true;
    }

    if (compactedTools && compactedTools.length > 0) {
      body.tools = compactedTools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
    }

    if (supportsAnthropicEffortConfig(config.model)) {
      body.output_config = { effort: this._getAnthropicEffort(config.model) };
      const thinking = this._getAnthropicThinking(config.model);
      if (thinking) {
        body.thinking = thinking;
      }
    }

    if (this._isStructuredOutputEnabled(config.provider)) body.output_config = { ...(body.output_config as Record<string, unknown> ?? {}), format: { type: "json_schema", schema: anthropicOutputSchema(ARCHITECT_PASS_JSON_SCHEMA) } };
    return body;
  }

  async loadConfig(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("dreamgraph.architect");
    const provider = (cfg.get<string>("provider") ?? "anthropic") as ArchitectProvider;
    const configuredModel = (cfg.get<string>("model") ?? "").trim();
    const model = configuredModel || this._defaultModel(provider);
    const baseUrl = cfg.get<string>("baseUrl") || this._defaultBaseUrl(provider);

    let apiKey = "";
    if (provider === "lmstudio") {
      // LM Studio ignores the auth header but the OpenAI-compat code path
      // sends `Authorization: Bearer <key>` unconditionally. A literal
      // placeholder avoids "Bearer " (empty) which some setups reject.
      apiKey = "lm-studio";
    } else if (provider && provider !== "ollama" && provider !== "copilot-cli" && provider !== "codex-cli") {
      apiKey = (await this._secretStorage.get(`dreamgraph.apiKey.${provider}`)) ?? "";
    }

    this._config = { provider, model, baseUrl, apiKey };
  }

  async setApiKey(provider: ArchitectProvider, key: string): Promise<void> {
    await this._secretStorage.store(`dreamgraph.apiKey.${provider}`, key);
    if (this._config && this._config.provider === provider) {
      this._config.apiKey = key;
    }
  }

  async getApiKey(provider: ArchitectProvider): Promise<string | undefined> {
    return this._secretStorage.get(`dreamgraph.apiKey.${provider}`);
  }

  async call(messages: ArchitectMessage[], signal?: AbortSignal): Promise<ArchitectResponse> {
    return this._inference(false, () => this._callConfigured(messages, signal));
  }
  private async _callConfigured(messages: ArchitectMessage[], signal?: AbortSignal): Promise<ArchitectResponse> {
    this._ensureConfigured();
    const config = this._config!;
    const start = Date.now();

    switch (config.provider) {
      case "anthropic":
        return this._callAnthropic(config, messages, start, signal);
      case "openai":
      case "lmstudio":
        return this._callOpenAI(config, messages, start, signal);
      case "ollama":
        return this._callOllama(config, messages, start, signal);
      default:
        throw new Error(`Unknown Architect provider: ${config.provider}`);
    }
  }

  async stream(messages: ArchitectMessage[], onChunk: StreamCallback, signal?: AbortSignal): Promise<ArchitectResponse> {
    return this._inference(false, () => this._streamConfigured(messages, onChunk, signal));
  }
  private async _streamConfigured(messages: ArchitectMessage[], onChunk: StreamCallback, signal?: AbortSignal): Promise<ArchitectResponse> {
    this._ensureConfigured();
    const config = this._config!;
    const start = Date.now();

    switch (config.provider) {
      case "anthropic":
        return this._streamAnthropic(config, messages, onChunk, start, signal);
      case "openai":
      case "lmstudio":
        return this._streamOpenAI(config, messages, onChunk, start, signal);
      case "ollama":
        return this._streamOllama(config, messages, onChunk, start, signal);
      default:
        throw new Error(`Unknown Architect provider: ${config.provider}`);
    }
  }

  async callWithTools(
    messages: ArchitectMessage[], tools: ToolDefinition[], rawMessages?: unknown[], signal?: AbortSignal, retry = false,
  ): Promise<ArchitectToolResponse> {
    return this._inference(retry, () => this._callWithToolsConfigured(messages, tools, rawMessages, signal));
  }
  private async _callWithToolsConfigured(
    messages: ArchitectMessage[],
    tools: ToolDefinition[],
    rawMessages?: unknown[],
    signal?: AbortSignal,
  ): Promise<ArchitectToolResponse> {
    this._ensureConfigured();
    const config = this._config!;
    const start = Date.now();
    const compactedRequest = applySharedRequestCompaction({
      messages,
      rawMessages,
      tools,
      provider: config.provider,
    });

    const validators = new Map(tools.map(tool => [tool.name, compileOutputValidator(tool.inputSchema)]));
    const validate = async (operation: Promise<ArchitectToolResponse>) => {
      const response = await operation;
      const seen = new Set<string>();
      for (const call of response.toolCalls) {
        if (!call.id || seen.has(call.id) || !validators.get(call.name)?.(call.input)) throw new ProviderOutcomeError("TOOL_ARGUMENTS_INVALID", config.provider, config.model, "tool_contract_mismatch", response.usage);
        seen.add(call.id);
      }
      return response;
    };
    switch (config.provider) {
      case "anthropic":
        return validate(this._callAnthropicWithTools(
          config,
          compactedRequest.messages,
          compactedRequest.tools ?? [],
          start,
          compactedRequest.rawMessages,
          signal,
        ));
      case "openai":
      case "lmstudio":
        return validate(this._callOpenAIWithTools(
          config,
          compactedRequest.messages,
          compactedRequest.tools ?? [],
          start,
          compactedRequest.rawMessages,
          signal,
        ));
      case "ollama": {
        const resp = await this._callOllama(config, compactedRequest.messages, start, signal);
        return { ...resp, toolCalls: [], stopReason: "end_turn" };
      }
      default:
        throw new Error(`Unknown Architect provider: ${config.provider}`);
    }
  }

  private _messageTextContent(content: string | ArchitectContent[]): string {
    if (typeof content === "string") return content;
    return content.filter((block): block is ArchitectTextBlock => block.type === "text").map((block) => block.text).join("\n\n");
  }

  private _toAnthropicContent(content: string | ArchitectContent[]): unknown {
    if (typeof content === "string") return content;
    return content.map((block) => {
      if (block.type === "text") return { type: "text", text: block.text };
      return {
        type: "image",
        source: {
          type: "base64",
          media_type: block.mimeType,
          data: block.dataBase64,
        },
      };
    });
  }

  private _toOpenAIContent(content: string | ArchitectContent[]): unknown {
    if (typeof content === "string") return content;
    return content.map((block) => {
      if (block.type === "text") return { type: "text", text: block.text };
      // OpenAI Chat Completions API uses `image_url` (object form), distinct
      // from the Responses API which uses `input_image` (string form). This
      // serializer is only ever invoked from the chat/completions endpoints
      // — the Responses path runs through `_toOpenAIResponsesContent`.
      return {
        type: "image_url",
        image_url: { url: `data:${block.mimeType};base64,${block.dataBase64}` },
      };
    });
  }

  private _toOllamaContent(content: string | ArchitectContent[]): string {
    return this._messageTextContent(content);
  }

  private _translateRawToOpenAI(raw: unknown[]): unknown[] {
    const out: unknown[] = [];

    for (const msg of raw) {
      const m = msg as Record<string, unknown>;
      const role = m.role as string;
      const content = m.content;

      if (typeof content === "string") {
        out.push({ role, content });
        continue;
      }

      if (!Array.isArray(content)) {
        out.push(msg);
        continue;
      }

      const blocks = content as Array<Record<string, unknown>>;

      if (role === "assistant") {
        const textParts = blocks.filter((b) => b.type === "text").map((b) => b.text as string);
        const toolUseBlocks = blocks.filter((b) => b.type === "tool_use");
        const openaiMsg: Record<string, unknown> = {
          role: "assistant",
          content: textParts.join("") || null,
        };
        if (toolUseBlocks.length > 0) {
          openaiMsg.tool_calls = toolUseBlocks.map((b) => ({
            id: b.id as string,
            type: "function",
            function: {
              name: b.name as string,
              arguments: typeof b.input === "string" ? b.input : JSON.stringify(b.input),
            },
          }));
        }
        out.push(openaiMsg);
      } else if (role === "user") {
        const toolResults = blocks.filter((b) => b.type === "tool_result");
        const nonToolBlocks = blocks.filter((b) => b.type !== "tool_result");
        if (nonToolBlocks.length > 0) {
          const translated = nonToolBlocks.map((b) => {
            if (b.type === "image") {
              // Two equivalent inbound shapes:
              //  (a) Anthropic-style: { source: { type: 'base64', media_type, data } }
              //  (b) Canonical ArchitectImageBlock: { mimeType, dataBase64, fileName? }
              // Both must serialize to OpenAI Chat Completions' image_url object.
              const src = b.source as Record<string, unknown> | undefined;
              if (src && src.type === "base64") {
                return {
                  type: "image_url",
                  image_url: { url: `data:${src.media_type};base64,${src.data}` },
                };
              }
              if (typeof b.mimeType === "string" && typeof b.dataBase64 === "string") {
                return {
                  type: "image_url",
                  image_url: { url: `data:${b.mimeType};base64,${b.dataBase64}` },
                };
              }
            }
            return b;
          });
          out.push({ role: "user", content: translated });
        }
        for (const tr of toolResults) {
          out.push({
            role: "tool",
            tool_call_id: tr.tool_use_id as string,
            content: typeof tr.content === "string" ? tr.content : JSON.stringify(tr.content),
          });
        }
      } else {
        out.push(msg);
      }
    }

    return out;
  }

  private async _callAnthropic(
    config: ArchitectConfig,
    messages: ArchitectMessage[],
    start: number,
    signal?: AbortSignal,
  ): Promise<ArchitectResponse> {
    const { system, userMessages } = this._splitSystem(messages);
    const requestBody = this._buildAnthropicMessagesRequest(
      config,
      userMessages.map((m) => ({ role: m.role, content: this._toAnthropicContent(m.content) })),
      system,
    );

    const res = await this._fetch(config, `${config.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
        ...anthropicThinkingHeaders(config.model),
      },
      body: _serializeAndLogRequest('callAnthropic', config.model, requestBody),
      signal,
    });

    if (!res.ok) throw new Error(`Anthropic API error (${res.status})`);

    const data = (await res.json()) as {
      content: Array<{ type: string; text?: string }>;
      usage: { input_tokens: number; output_tokens: number };
      input_transformations?: unknown[];
    };

    assertProviderOutcome(config.provider, config.model, data, providerUsage(config.provider, data.usage));
    logAnthropicThinkingDrops(config.model, data.input_transformations);

    return {
      content: this._maybeProjectStructuredContent(config, data.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("")),
      usage: providerUsage(config.provider, data.usage),
      promptTokens: data.usage?.input_tokens ?? 0,
      completionTokens: data.usage?.output_tokens ?? 0,
      durationMs: Date.now() - start,
    };
  }

  private async _callAnthropicWithTools(
    config: ArchitectConfig,
    messages: ArchitectMessage[],
    tools: ToolDefinition[],
    start: number,
    rawMessages?: unknown[],
    signal?: AbortSignal,
  ): Promise<ArchitectToolResponse> {
    const { system } = this._splitSystem(messages);
    const apiMessages = rawMessages
      ? rawMessages.map((message) => {
          const msg = message as Record<string, unknown>;
          const stored = msg[RESPONSES_RAW_ITEMS_KEY];
          return { role: msg.role, content: msg.role === "assistant" && Array.isArray(stored)
            && stored.every((item) => item && ["text", "thinking", "redacted_thinking", "tool_use"].includes(item.type))
            ? stored : msg.content };
        })
      : messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: this._toAnthropicContent(m.content) }));

    const requestBody = this._buildAnthropicMessagesRequest(config, apiMessages, system, tools);
    const res = await this._fetch(config, `${config.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
        ...anthropicThinkingHeaders(config.model),
      },
      body: _serializeAndLogRequest('callAnthropicWithTools', config.model, requestBody),
      signal,
    });

    if (!res.ok) throw new Error(`Anthropic API error (${res.status})`);

    const data = (await res.json()) as {
      content: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
      usage: { input_tokens: number; output_tokens: number };
      stop_reason: string;
      input_transformations?: unknown[];
    };

    assertProviderOutcome(config.provider, config.model, data, providerUsage(config.provider, data.usage));
    logAnthropicThinkingDrops(config.model, data.input_transformations);

    assertClientFunctionOutput(config.provider,config.model,data.content,"anthropic",providerUsage(config.provider,data.usage));
    return {
      content: this._maybeProjectStructuredContent(config, data.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join(""), data.content.some(c => c.type === "tool_use")),
      usage: providerUsage(config.provider, data.usage),
      promptTokens: data.usage?.input_tokens ?? 0,
      completionTokens: data.usage?.output_tokens ?? 0,
      durationMs: Date.now() - start,
      toolCalls: data.content
        .filter((c) => c.type === "tool_use")
        .map((c) => ({ id: c.id!, name: c.name!, input: c.input ?? {} })),
      stopReason: data.stop_reason ?? "end_turn",
      providerRawAssistant: data.content,
    };
  }

    private _usesOpenAIResponsesApi(model: string, tools = false): boolean {
    const selected = vscode.workspace.getConfiguration("dreamgraph.architect").get<string>("openai.api") ?? "auto";
    const evidence = resolveProviderCapability("openai", model);
    if (!["auto", "responses", "chat_completions"].includes(selected)) throw new Error("PROVIDER_API_UNSUPPORTED");
    const api = selected === "auto" ? evidence?.default_api ?? "chat-completions" : selected === "responses" ? "responses" : "chat-completions";
    if (evidence && !(evidence.apis as readonly string[]).includes(api)) throw new Error("PROVIDER_API_UNSUPPORTED");
    const efforts = evidence?.tool_api_efforts;
    if (tools && efforts && (!(api in efforts) || efforts[api] !== null && !(efforts[api] as readonly string[]).includes(this._getOpenAIReasoningEffort() ?? "provider_default"))) throw new Error("TOOLS_REQUIRE_RESPONSES");
    return api === "responses";
  }

  private _getOpenAIReasoningEffort(): "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | undefined {
    const cfg = vscode.workspace.getConfiguration("dreamgraph.architect");
    const configured = (cfg.get<string>("openai.reasoningEffort") ?? "").trim().toLowerCase();
    const evidence = resolveProviderCapability("openai", this._config?.model ?? "");
    const efforts: readonly string[] = evidence?.efforts ?? [];
    if (!configured && efforts.length === 0) return undefined;
    const effort = configured || (efforts.includes("medium") ? "medium" : efforts.includes("high") ? "high" : efforts[0]);
    if (!efforts.includes(effort)) throw new Error("REASONING_EFFORT_UNSUPPORTED");
    return effort as "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  }

  private _getOpenAITextVerbosity(): "low" | "medium" | "high" {
    const cfg = vscode.workspace.getConfiguration("dreamgraph.architect");
    const configured = (cfg.get<string>("openai.verbosity") ?? "").trim().toLowerCase();
    if (configured === "low" || configured === "medium" || configured === "high") {
      return configured;
    }

    const reportingMode = (cfg.get<string>("reportingMode") ?? "standard").trim().toLowerCase();
    if (reportingMode === "deep" || reportingMode === "forensic") {
      return "medium";
    }
    return "low";
  }

    private _toOpenAIResponsesContent(content: string | ArchitectContent[]): unknown {
    return toOpenAIResponsesContent(content);
  }

    private _translateRawToOpenAIResponses(raw: unknown[]): unknown[] {
    return translateRawToOpenAIResponses(raw);
  }

    private _buildOpenAIResponsesRequest(
    config: ArchitectConfig,
    messages: ArchitectMessage[],
    rawMessages?: unknown[],
    tools?: ToolDefinition[],
  ): Record<string, unknown> {
    return buildOpenAIResponsesRequest(messages, {
      model: config.model,
      reasoningEffort: this._getOpenAIReasoningEffort(),
      textVerbosity: this._getOpenAITextVerbosity(),
      rawMessages,
      tools,
      structuredOutput: this._isStructuredOutputEnabled(config.provider),
    });
  }

  /**
   * Whether to attach the canonical architect-pass JSON schema to outbound
   * requests for the given provider. Today only OpenAI's first-party API
   * (Chat Completions + Responses) is supported \u2014 LM Studio's openai-compat
   * endpoint accepts `response_format` but its model-side enforcement varies
   * by loaded model, so we keep it opt-in via the same setting.
   *
   * Setting: `dreamgraph.architect.structuredOutput` (boolean, default true
   * for `openai`, false otherwise). User can disable to fall back to the
   * legacy fenced-JSON contract if a specific snapshot rejects schemas.
   */
  private _isStructuredOutputEnabled(provider: ArchitectProvider): boolean {
    const cfg = vscode.workspace.getConfiguration("dreamgraph.architect");
    const explicit = cfg.get<boolean>("structuredOutput");
    const evidence = resolveProviderCapability(provider, this._config?.model ?? "");
    if ((explicit === true || explicit === undefined && provider === "openai") && !evidence?.strict_schema) throw new Error("STRICT_SCHEMA_CAPABILITY_REQUIRED");
    if (typeof explicit === "boolean") return explicit;
    // Default ON for OpenAI (strict json_schema is grammar-constrained server-side).
    // Default OFF for ollama and lmstudio: schema support exists in recent Ollama
    // (>=0.5) and via OpenAI-compat in LM Studio, but enforcement quality depends
    // on the loaded model, so users opt in. Default OFF for anthropic: forced
    // Native JSON schemas are available; preserve explicit opt-in because the
    // legacy Claude route used a prompt-driven envelope by default.
    return provider === "openai";
  }

  /**
   * Build the `format` body field for the Ollama /api/chat request. Recent
   * Ollama (>=0.5) accepts a JSON Schema object here and grammar-constrains
   * the response server-side, mirroring OpenAI's strict json_schema mode.
   * Returns an empty object when structured output is disabled — callers
   * spread the result so the field simply doesn't appear on the wire for
   * older Ollama versions that wouldn't recognize it.
   */
  private _ollamaFormatField(provider: ArchitectProvider): Record<string, unknown> {
    if (!this._isStructuredOutputEnabled(provider)) return {};
    return { format: ARCHITECT_PASS_JSON_SCHEMA };
  }

  /**
   * Build the `response_format` body field for OpenAI Chat Completions.
   * Strict json_schema mode is grammar-constrained server-side: the model
   * physically cannot emit text outside the schema. Returns an empty object
   * when structured output is disabled — callers spread the result into the
   * request body so the field simply doesn't appear.
   */
  private _openAIChatResponseFormat(provider: ArchitectProvider): Record<string, unknown> {
    if (!this._isStructuredOutputEnabled(provider)) return {};
    return {
      response_format: {
        type: "json_schema",
        json_schema: {
          name: ARCHITECT_PASS_SCHEMA_NAME,
          schema: ARCHITECT_PASS_JSON_SCHEMA,
          strict: true,
        },
      },
    };
  }

  /**
   * When structured-output mode is on, the wire content is a strict
   * `architect_pass_envelope` JSON object. Project it back to the legacy
   * "prose markdown + fenced ```json envelope" shape so every existing
   * downstream parser (autonomy, summary card, webview body renderer)
   * keeps working without needing to learn the new shape. When projection
   * fails or structured output is off, the original content is returned
   * unchanged.
   */
  private _maybeProjectStructuredContent(config: ArchitectConfig, content: string, allowEmptyForTools = false): string {
    if (!content.trim() && !allowEmptyForTools && this._isStructuredOutputEnabled(config.provider)) throw new ProviderOutcomeError("PROVIDER_OUTPUT_INVALID", config.provider, config.model, "empty_structured_output");
    if (content.trim() && this._isStructuredOutputEnabled(config.provider)) validateCompletionText(content, { jsonSchema: { name: ARCHITECT_PASS_SCHEMA_NAME, schema: ARCHITECT_PASS_JSON_SCHEMA } }, config.provider, config.model);
    if (!this._isStructuredOutputEnabled(config.provider)) return content;
    const projection = projectStrictEnvelopeToLegacy(content);
    return projection ? projection.legacyContent : content;
  }

  private async _callOpenAIResponses(
    config: ArchitectConfig,
    messages: ArchitectMessage[],
    start: number,
    signal?: AbortSignal,
  ): Promise<ArchitectResponse> {
    const requestBody = this._buildOpenAIResponsesRequest(config, messages);
    const res = await this._fetch(config, `${config.baseUrl}/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: _serializeAndLogRequest('callOpenAIResponses', config.model, requestBody),
      signal,
    });

    if (!res.ok) throw new Error(`OpenAI Responses API error (${res.status})`);

    const data = (await res.json()) as OpenAIResponsesData;
    assertProviderOutcome(config.provider, config.model, data, providerUsage(config.provider, data.usage));
    const result = normalizeOpenAIResponsesResult(data);

    return {
      content: this._maybeProjectStructuredContent(config, result.text),
      usage: providerUsage(config.provider, result.usage),
      promptTokens: result.usage?.input_tokens ?? 0,
      completionTokens: result.usage?.output_tokens ?? 0,
      durationMs: Date.now() - start,
    };
  }

  private async _callOpenAIResponsesWithTools(
    config: ArchitectConfig,
    messages: ArchitectMessage[],
    tools: ToolDefinition[],
    start: number,
    rawMessages?: unknown[],
    signal?: AbortSignal,
  ): Promise<ArchitectToolResponse> {
    const requestBody = this._buildOpenAIResponsesRequest(config, messages, rawMessages, tools);
    const res = await this._fetch(config, `${config.baseUrl}/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: _serializeAndLogRequest('callOpenAIResponsesWithTools', config.model, requestBody),
      signal,
    });

    if (!res.ok) throw new Error(`OpenAI Responses API error (${res.status})`);

    const data = (await res.json()) as OpenAIResponsesData;
    assertProviderOutcome(config.provider, config.model, data, providerUsage(config.provider, data.usage));
    const result = normalizeOpenAIResponsesResult(data);
    const toolCalls = extractOpenAIResponsesToolCalls(data);
    assertClientFunctionOutput(config.provider,config.model,data.output??[],"responses",providerUsage(config.provider,data.usage));

    return {
      content: this._maybeProjectStructuredContent(config, result.text, toolCalls.length > 0),
      usage: providerUsage(config.provider, result.usage),
      promptTokens: result.usage?.input_tokens ?? 0,
      completionTokens: result.usage?.output_tokens ?? 0,
      durationMs: Date.now() - start,
      toolCalls,
      // Verbatim output[] items (incl. reasoning) for stateless replay.
      providerRawAssistant: extractOpenAIResponsesRawItems(data),
      stopReason: result.finishReason ?? "end_turn",
    };
  }

  private async _callOpenAIWithTools(
    config: ArchitectConfig,
    messages: ArchitectMessage[],
    tools: ToolDefinition[],
    start: number,
    rawMessages?: unknown[],
    signal?: AbortSignal,
  ): Promise<ArchitectToolResponse> {
    if (this._usesOpenAIResponsesApi(config.model, true)) {
      return this._callOpenAIResponsesWithTools(config, messages, tools, start, rawMessages, signal);
    }

    // Trim tool descriptions / strip schema metadata to keep the `tools`
    // section out of the budget hot path. Mirrors the Anthropic and
    // OpenAI Responses paths (both already call `minifyToolDefinitions`).
    const compactedTools = minifyToolDefinitions(tools);
    const openaiTools = compactedTools.map((t) => ({
      type: "function" as const,
      function: { name: t.name, description: t.description, parameters: t.inputSchema },
    }));

    const apiMessages = rawMessages
      ? this._translateRawToOpenAI(rawMessages)
      : messages.map((m) => ({ role: m.role, content: this._toOpenAIContent(m.content) }));

    const { system } = this._splitSystem(messages);
    if (system && !apiMessages.some((m) => (m as Record<string, unknown>).role === "system")) {
      (apiMessages as Array<Record<string, unknown>>).unshift({ role: "system", content: system });
    }

    const res = await this._fetch(config, `${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: _serializeAndLogRequest('callOpenAIWithTools', config.model, {
        model: config.model,
        max_completion_tokens: 16384,
        ...(this._getOpenAIReasoningEffort() ? { reasoning_effort: this._getOpenAIReasoningEffort() } : {}),
        messages: apiMessages,
        tools: openaiTools,
        ...this._openAIChatResponseFormat(config.provider),
      }),
      signal,
    });

    if (!res.ok) throw new Error(`OpenAI API error (${res.status})`);

    const data = (await res.json()) as {
      choices: Array<{
        message: { content: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> };
        finish_reason: string;
      }>;
      usage: { prompt_tokens: number; completion_tokens: number };
    };

    assertProviderOutcome(config.provider, config.model, data, providerUsage(config.provider, data.usage));
    const choice = data.choices[0];
    return {
      content: this._maybeProjectStructuredContent(config, choice?.message?.content ?? "", !!choice?.message?.tool_calls?.length),
      usage: providerUsage(config.provider, data.usage),
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
      durationMs: Date.now() - start,
      toolCalls: (choice?.message?.tool_calls ?? []).map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        input: (() => { try { return JSON.parse(tc.function.arguments); } catch { throw new ProviderOutcomeError("TOOL_ARGUMENTS_INVALID", config.provider, config.model, "invalid_json", providerUsage(config.provider, data.usage)); } })(),
      })),
      stopReason: choice?.finish_reason === "tool_calls" ? "tool_use" : (choice?.finish_reason ?? "stop"),
    };
  }

  private async _streamAnthropic(
    config: ArchitectConfig,
    messages: ArchitectMessage[],
    onChunk: StreamCallback,
    start: number,
    signal?: AbortSignal,
  ): Promise<ArchitectResponse> {
    const { system, userMessages } = this._splitSystem(messages);
    const requestBody = this._buildAnthropicMessagesRequest(
      config,
      userMessages.map((m) => ({ role: m.role, content: this._toAnthropicContent(m.content) })),
      system,
      undefined,
      true,
    );

    const res = await this._fetch(config, `${config.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
        ...anthropicThinkingHeaders(config.model),
      },
      body: _serializeAndLogRequest('streamAnthropic', config.model, requestBody),
      signal,
    });

    if (!res.ok) throw new Error(`Anthropic API error (${res.status})`);
    const result = await this._readSSEStream(res, onChunk, start, "anthropic");
    return { ...result, content: this._maybeProjectStructuredContent(config, result.content) };
  }

  private async _callOpenAI(
    config: ArchitectConfig,
    messages: ArchitectMessage[],
    start: number,
    signal?: AbortSignal,
  ): Promise<ArchitectResponse> {
    if (this._usesOpenAIResponsesApi(config.model)) {
      return this._callOpenAIResponses(config, messages, start, signal);
    }

    const res = await this._fetch(config, `${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: _serializeAndLogRequest('callOpenAI', config.model, {
        model: config.model,
        max_completion_tokens: 16384,
        ...(this._getOpenAIReasoningEffort() ? { reasoning_effort: this._getOpenAIReasoningEffort() } : {}),
        messages: messages.map((m) => ({ role: m.role, content: this._toOpenAIContent(m.content) })),
        ...this._openAIChatResponseFormat(config.provider),
      }),
      signal,
    });

    if (!res.ok) throw new Error(`OpenAI API error (${res.status})`);

    const data = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
      usage: { prompt_tokens: number; completion_tokens: number };
    };

    assertProviderOutcome(config.provider, config.model, data, providerUsage(config.provider, data.usage));
    const rawContent = data.choices[0]?.message?.content ?? "";
    const projectedContent = this._maybeProjectStructuredContent(config, rawContent);

    return {
      content: projectedContent,
      usage: providerUsage(config.provider, data.usage),
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
      durationMs: Date.now() - start,
    };
  }

  private async _streamOpenAIResponses(config: ArchitectConfig, messages: ArchitectMessage[], onChunk: StreamCallback, start: number, signal?: AbortSignal): Promise<ArchitectResponse> {
    const body = { ...this._buildOpenAIResponsesRequest(config, messages), stream: true };
    const res = await this._fetch(config, `${config.baseUrl}/responses`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` }, body: _serializeAndLogRequest("streamOpenAIResponses", config.model, body), signal });
    if (!res.ok) throw new Error(`OpenAI Responses API error (${res.status})`);
    const reader = res.body?.getReader(); if (!reader) throw new Error("No response body");
    let buffer = "", content = "", completed: OpenAIResponsesData | null = null;
    const decoder = new TextDecoder(), extractor = this._isStructuredOutputEnabled(config.provider) ? new StrictNarrativeStreamExtractor() : null;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true });
        if (buffer.length > 4 * 1024 * 1024) throw new ProviderOutcomeError("PROVIDER_OUTPUT_INVALID", "openai", config.model, "stream_frame_limit");
        const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim(); if (!data || data === "[DONE]") continue;
          let event: any; try { event = JSON.parse(data); } catch { throw new ProviderOutcomeError("PROVIDER_OUTPUT_INVALID", "openai", config.model, "invalid_stream"); }
          if (event.type === "error") throw new ProviderOutcomeError("PROVIDER_FAILED", "openai", config.model, "stream_error");
          if (event.type === "response.refusal.delta" || event.type === "response.refusal.done") throw new ProviderOutcomeError("PROVIDER_REFUSAL", "openai", config.model, "refusal");
          if (event.type === "response.failed" || event.type === "response.incomplete") assertProviderOutcome("openai", config.model, event.response ?? { status: event.type.slice(9) }, providerUsage("openai", event.response?.usage));
          if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
            content += event.delta; if (content.length > 512 * 1024) throw new ProviderOutcomeError("PROVIDER_OUTPUT_INVALID", "openai", config.model, "output_limit");
            const visible = extractor ? extractor.feed(event.delta) : event.delta; if (visible) onChunk(visible);
          }
          if (event.type === "response.completed") {
            if (!event.response || event.response.status !== "completed") throw new ProviderOutcomeError("PROVIDER_OUTPUT_INVALID", "openai", config.model, "missing_completed_response");
            completed = event.response; assertProviderOutcome("openai", config.model, completed, providerUsage("openai", completed!.usage));
          }
        }
      }
      if (!completed) throw new ProviderOutcomeError("PROVIDER_INCOMPLETE", "openai", config.model, "stream_ended_without_completion");
      const final = normalizeOpenAIResponsesResult(completed), usage = providerUsage("openai", completed.usage);
      // The completed authoritative response wins over preview deltas.
      const text = final.text || content;
      return { content: this._maybeProjectStructuredContent(config, text), usage, promptTokens: usage?.inputTokens ?? 0, completionTokens: usage?.outputTokens ?? 0, durationMs: Date.now() - start };
    } finally { await reader.cancel().catch(() => undefined); }
  }

  private async _streamOpenAI(
    config: ArchitectConfig,
    messages: ArchitectMessage[],
    onChunk: StreamCallback,
    start: number,
    signal?: AbortSignal,
  ): Promise<ArchitectResponse> {
    if (this._usesOpenAIResponsesApi(config.model)) return this._streamOpenAIResponses(config, messages, onChunk, start, signal);
    const res = await this._fetch(config, `${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: _serializeAndLogRequest('streamOpenAI', config.model, {
        model: config.model,
        max_completion_tokens: 16384,
        ...(this._getOpenAIReasoningEffort() ? { reasoning_effort: this._getOpenAIReasoningEffort() } : {}),
        stream: true,
        messages: messages.map((m) => ({ role: m.role, content: this._toOpenAIContent(m.content) })),
        ...this._openAIChatResponseFormat(config.provider),
      }),
      signal,
    });

    if (!res.ok) throw new Error(`OpenAI API error (${res.status})`);

    // When strict structured-output is on, the wire content is a single JSON
    // object that begins with `{`. Stream the unescaped `narrative` field to
    // the live UI (so the user sees clean prose, not raw JSON), buffer the
    // rest, and project to the legacy fenced-envelope shape on completion so
    // every downstream parser keeps working untouched.
    if (this._isStructuredOutputEnabled(config.provider)) {
      const extractor = new StrictNarrativeStreamExtractor();
      const wrapped: StreamCallback = (chunk) => {
        const visible = extractor.feed(chunk);
        if (visible) onChunk(visible);
      };
      const raw = await this._readSSEStream(res, wrapped, start, "openai");
      // Replay the full raw text into the extractor so finalize sees
      // everything (the wrapper above only forwarded narrative chars). The
      // SSE reader assembled the full content from deltas; feed any unfed
      // tail by replacing the buffer wholesale via finalize on raw content.
      return { ...raw, content: this._maybeProjectStructuredContent(config, raw.content) };
    }
    return this._readSSEStream(res, onChunk, start, "openai");
  }


  private async _callOllama(
    config: ArchitectConfig,
    messages: ArchitectMessage[],
    start: number,
    signal?: AbortSignal,
  ): Promise<ArchitectResponse> {
    const res = await this._fetch(config, `${config.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: _serializeAndLogRequest('callOllama', config.model, {
        model: config.model,
        messages: messages.map((m) => ({ role: m.role, content: this._toOllamaContent(m.content) })),
        stream: false,
        options: { num_predict: 8192 },
        ...this._ollamaFormatField(config.provider),
      }),
      signal,
    });

    if (!res.ok) throw new Error(`Ollama API error (${res.status}): ${await res.text()}`);

    const data = (await res.json()) as {
      message: { content: string };
      prompt_eval_count?: number;
      eval_count?: number;
    };

    if (this._modelCall.getStore() && (data as { done?: boolean }).done !== true) throw new ProviderOutcomeError('PROVIDER_INCOMPLETE', config.provider, config.model, 'missing_local_completion', providerUsage(config.provider, data));
    assertProviderOutcome(config.provider, config.model, data, providerUsage(config.provider, data));
    return {
      content: this._maybeProjectStructuredContent(config, data.message?.content ?? ""),
      usage: providerUsage(config.provider, data),
      promptTokens: data.prompt_eval_count ?? 0,
      completionTokens: data.eval_count ?? 0,
      durationMs: Date.now() - start,
    };
  }

  private async _streamOllama(
    config: ArchitectConfig,
    messages: ArchitectMessage[],
    onChunk: StreamCallback,
    start: number,
    signal?: AbortSignal,
  ): Promise<ArchitectResponse> {
    const res = await this._fetch(config, `${config.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: _serializeAndLogRequest('streamOllama', config.model, {
        model: config.model,
        messages: messages.map((m) => ({ role: m.role, content: this._toOllamaContent(m.content) })),
        stream: true,
        options: { num_predict: 8192 },
        ...this._ollamaFormatField(config.provider),
      }),
      signal,
    });

    if (!res.ok) throw new Error(`Ollama API error (${res.status}): ${await res.text()}`);

    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");
    const decoder = new TextDecoder();
    let fullContent = '', buffer = '', terminal = false, usage: TokenUsage | undefined;
    const extractor = this._isStructuredOutputEnabled(config.provider) ? new StrictNarrativeStreamExtractor() : null;
    const consume = (line: string) => {
      if (!line.trim()) return;
      let data: any;
      try { data = JSON.parse(line); } catch { throw new ProviderOutcomeError('PROVIDER_OUTPUT_INVALID', config.provider, config.model, 'invalid_local_stream', usage); }
      assertProviderOutcome(config.provider, config.model, data, providerUsage(config.provider, data));
      const text = data.message?.content ?? '';
      if (typeof text !== 'string') throw new ProviderOutcomeError('PROVIDER_OUTPUT_INVALID', config.provider, config.model, 'invalid_local_content', usage);
      fullContent += text;
      if (Buffer.byteLength(fullContent, 'utf8') > 512 * 1024) throw new ProviderOutcomeError('PROVIDER_OUTPUT_INVALID', config.provider, config.model, 'local_output_byte_bound', usage);
      const visible = extractor ? extractor.feed(text) : text;
      if (visible) onChunk(visible);
      if (data.done === true) { terminal = true; usage = providerUsage(config.provider, data); }
    };
    try {
      for (;;) {
        signal?.throwIfAborted();
        const part = await reader.read();
        if (part.done) break;
        buffer += decoder.decode(part.value, { stream: true });
        const lines = buffer.split('\n'); buffer = lines.pop() ?? '';
        if (Buffer.byteLength(buffer, 'utf8') > 4 * 1024 * 1024) throw new ProviderOutcomeError('PROVIDER_OUTPUT_INVALID', config.provider, config.model, 'local_frame_byte_bound', usage);
        lines.forEach(consume);
      }
      buffer += decoder.decode(); if (buffer.trim()) consume(buffer);
      if (!terminal) throw new ProviderOutcomeError('PROVIDER_INCOMPLETE', config.provider, config.model, 'local_stream_ended_without_completion', usage);
      return { content: this._maybeProjectStructuredContent(config, fullContent), usage,
        promptTokens: usage?.inputTokens ?? 0, completionTokens: usage?.outputTokens ?? 0, durationMs: Date.now() - start };
    } finally { await reader.cancel().catch(() => undefined); }
  }
  private async _readSSEStream(
    res: Response,
    onChunk: StreamCallback,
    start: number,
    provider: "anthropic" | "openai",
  ): Promise<ArchitectResponse> {
    let fullContent = "", buffer = "", terminal = false;
    const rawUsage: Record<string, unknown> = {};
    let stopReason: string | undefined;
    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") { terminal = true; continue; }
          let parsed: any;
          try { parsed = JSON.parse(data); } catch { throw new ProviderOutcomeError("PROVIDER_OUTPUT_INVALID", provider, this._config?.model ?? "unknown", "invalid_stream", providerUsage(provider, rawUsage)); }
          if (parsed.error || parsed.type === "error") throw new ProviderOutcomeError("PROVIDER_FAILED", provider, this._config?.model ?? "unknown", "stream_error", providerUsage(provider, rawUsage));
          if (provider === "anthropic") {
            if (parsed.type === "message_start") {
              Object.assign(rawUsage, parsed.message?.usage ?? {});
              logAnthropicThinkingDrops(this._config?.model ?? "", parsed.input_transformations ?? parsed.message?.input_transformations);
            }
            if (parsed.type === "message_delta") { Object.assign(rawUsage, parsed.usage ?? {}); stopReason = parsed.delta?.stop_reason ?? stopReason; }
            if (parsed.type === "message_stop") terminal = true;
            if (parsed.type === "content_block_delta" && parsed.delta?.text) { fullContent += parsed.delta.text; onChunk(parsed.delta.text); }
          } else {
            Object.assign(rawUsage, parsed.usage ?? {});
            const choice = parsed.choices?.[0]; stopReason = choice?.finish_reason ?? stopReason;
            if (choice?.delta?.refusal) throw new ProviderOutcomeError("PROVIDER_REFUSAL", provider, this._config?.model ?? "unknown", "refusal", providerUsage(provider, rawUsage));
            if (choice?.delta?.content) { fullContent += choice.delta.content; onChunk(choice.delta.content); }
          }
        }
      }
      const usage = providerUsage(provider, rawUsage);
      if (!terminal || !stopReason) throw new ProviderOutcomeError("PROVIDER_INCOMPLETE", provider, this._config?.model ?? "unknown", "stream_ended_without_completion", usage);
      assertProviderOutcome(provider, this._config?.model ?? "unknown", { stop_reason: stopReason }, usage);
      return { content: fullContent, promptTokens: usage?.inputTokens ?? 0, completionTokens: usage?.outputTokens ?? 0, usage, durationMs: Date.now() - start };
    } finally { await reader.cancel().catch(() => undefined); }
  }

  private _splitSystem(messages: ArchitectMessage[]): { system: string | undefined; userMessages: ArchitectMessage[] } {
    const systemMsgs = messages.filter((m) => m.role === "system");
    const userMessages = messages.filter((m) => m.role !== "system");
    const system = systemMsgs.length > 0 ? systemMsgs.map((m) => this._messageTextContent(m.content)).join("\n\n") : undefined;
    return { system, userMessages };
  }

  private _defaultBaseUrl(provider: ArchitectProvider): string {
    switch (provider) {
      case "anthropic":
        return "https://api.anthropic.com/v1";
      case "openai":
        return "https://api.openai.com/v1";
      case "ollama":
        return "http://localhost:11434";
      case "lmstudio":
        return "http://localhost:1234/v1";
      case "copilot-cli":
      case "codex-cli":
        // No HTTP transport; the CLI is invoked locally.
        return "";
      default:
        return "";
    }
  }

  private _defaultModel(provider: ArchitectProvider): string {
    switch (provider) {
      case "anthropic":
        return "claude-opus-4-7";
      case "openai":
        return OPENAI_MODELS[0];
      case "ollama":
        return "llama3.1";
      case "lmstudio":
        return "";
      case "copilot-cli":
        return COPILOT_CLI_MODELS[0] ?? "auto";
      case "codex-cli":
        return CODEX_CLI_MODELS[0] ?? "auto";
      default:
        return "";
    }
  }

  private _ensureConfigured(): void {
    if (!this._config || !this._config.provider) {
      throw new Error('Architect model not configured. Set "dreamgraph.architect.provider" and "dreamgraph.architect.model" in settings.');
    }
    if (!this._config.model) {
      throw new Error('Architect model name not set. Set "dreamgraph.architect.model" in settings.');
    }
    if (
      this._config.provider !== "ollama" &&
      this._config.provider !== "lmstudio" &&
      this._config.provider !== "copilot-cli" &&
      this._config.provider !== "codex-cli" &&
      !this._config.apiKey
    ) {
      throw new Error(`No API key stored for ${this._config.provider}. Use "DreamGraph: Set Architect API Key" to store one.`);
    }
    if (this._config.provider === "copilot-cli" || this._config.provider === "codex-cli") {
      // Native CLI providers are not callable through ArchitectLlm. The
      // chat panel must route turns through their ProviderPort-backed
      // runner instead of `architectLlm.stream`/`callWithTools`. Fail
      // loudly if a call slips through.
      throw new Error(
        `${this._config.provider} provider does not use ArchitectLlm transport. Route this turn through the native CLI ProviderPort instead.`,
      );
    }
  }

  dispose(): void {
    // Nothing to clean up
  }
}
