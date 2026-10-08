import { getSessionContext, sessionEnvironment, sessionNamespace } from "../server/session-context.js";
import { validateProviderImages, providerImageContent, type LlmImage } from "./provider-images.js";
/**
 * DreamGraph LLM Provider — The dream engine's brain.
 *
 * Dreams don't work without an LLM. The deterministic strategies find
 * structural patterns; the LLM provides the creative leap — proposing
 * connections no graph algorithm would discover. The normalizer then
 * filters hallucinations from insights.
 *
 * Provider hierarchy (tried in order):
 *   1. Direct API (Ollama / OpenAI-compatible / Anthropic) — autonomous daemon dreaming
 *   2. MCP Sampling — ask the connected client's LLM (human-in-the-loop)
 *   3. None — structural-only fallback (degraded mode)
 *
 * Configuration (env vars):
 *   Shared:
 *     DREAMGRAPH_LLM_PROVIDER   = "ollama" | "openai" | "anthropic" | "sampling" | "none"
 *     DREAMGRAPH_LLM_URL        = API base URL (default: http://localhost:11434 for Ollama)
 *     DREAMGRAPH_LLM_API_KEY    = API key for OpenAI-compatible providers
 *
 *   Dreamer (creative dream generation):
 *     DREAMGRAPH_LLM_DREAMER_MODEL       = model name (default: provider-specific)
 *     DREAMGRAPH_LLM_DREAMER_TEMPERATURE = creativity (default: 0.7)
 *     DREAMGRAPH_LLM_DREAMER_MAX_TOKENS  = max response tokens (default: 2048)
 *
 *   Normalizer (semantic validation):
 *     DREAMGRAPH_LLM_NORMALIZER_MODEL       = model name (default: provider-specific)
 *     DREAMGRAPH_LLM_NORMALIZER_TEMPERATURE = temperature (default: 0.1)
 *     DREAMGRAPH_LLM_NORMALIZER_MAX_TOKENS  = max response tokens (default: 2048)
 *
 *   Architect (interactive browser chat):
 *     DREAMGRAPH_LLM_ARCHITECT_PROVIDER    = provider override (default: shared provider)
 *     DREAMGRAPH_LLM_ARCHITECT_MODEL       = model override (fallback: general -> normalizer -> dreamer)
 *     DREAMGRAPH_LLM_ARCHITECT_TEMPERATURE = temperature (default: shared temperature)
 *     DREAMGRAPH_LLM_ARCHITECT_MAX_TOKENS  = max response tokens (default: shared max tokens)
 */

import { ModelExecution, admittedModelFetch, currentModelExecution } from "./model-execution.js";
import { logger } from "../utils/logger.js";
import { resolveRolePolicy, readRoleProfiles, snapshotRolePolicy, type ModelRole, type ResolvedRolePolicy, type RoleSettings } from "../config/role-policy.js";
import { modelTemperatureCapability, assertReasoningEffort } from "../config/model-temperature.js";
import { cognitiveRoleInstruction } from "./role-instructions.js";
import { providerCapability, assertProviderRequest, type ProviderCapability } from "../config/provider-capabilities.js";
import { recordRoleQualification, revokeRoleQualification } from "./role-qualification.js";
import { assertProviderOutcome, assertClientFunctionOutput, providerUsage, compileOutputValidator, validateCompletionText, completionSignal, ProviderOutcomeError, anthropicOutputSchema } from "./provider-outcome.js";

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export type LlmProviderType = "ollama" | "lmstudio" | "openai" | "anthropic" | "sampling" | "none";

export interface LlmConfig {
  /** Internal immutable policy binding; transport request bodies cannot provide it. */
  admissionPolicy?: Readonly<ResolvedRolePolicy>;
  provider: LlmProviderType;
  model: string;
  baseUrl: string;
  apiKey: string;
  temperature: number;
  maxTokens: number;
  /** Per-request abort timeout in milliseconds. Defaults to 120_000. */
  timeoutMs: number;
  /** Explicit protocol and reasoning settings; omission retains provider defaults. */
  api?: "responses" | "chat-completions";
  reasoningEffort?: string;
  store?: boolean;
  capability?: ProviderCapability;
}

export type LlmConfigSource = "architect" | "general" | "normalizer" | "dreamer" | "computer_use" | "provider_default";

export interface ArchitectLlmConfig extends LlmConfig {
  component: "architect";
  providerSource: "architect" | "general" | "computer_use";
  modelSource: LlmConfigSource;
  textVerbosity?: "low" | "medium" | "high";
}

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
  reasoningTokens?: number;
}

export interface LlmResult {
  admission?: import("./model-execution.js").ModelCallAdmission;
  text: string;
  finishReason?: string;
  usage?: TokenUsage;
}

export interface LlmResponse extends LlmResult {
  model: string;
  tokensUsed?: number;
  stopReason?: string;
  outputContract?: { api: LlmModelApi; mode: "native_strict" | "local_validation" | "json" | "text"; capabilityVersion: string | null; fallbackReason?: string };
}

export type LlmModelApi = "chat-completions" | "responses" | "anthropic-messages" | "ollama-chat" | "mcp-sampling" | "none";

export interface ModelCapabilities {
  model: string;
  api: LlmModelApi;
  supportsTemperature: boolean;
  supportsReasoningEffort: boolean;
  supportsStructuredOutputs: boolean;
  supportsJsonSchema: boolean;
}

/**
 * Options for LLM completion requests.
 *
 * JSON enforcement hierarchy (OpenAI provider):
 *   1. `jsonSchema` — Structured Outputs (`strict: true`) — guaranteed schema conformance
 *   2. `jsonMode` — `response_format: json_object` — guaranteed valid JSON, no schema
 *   3. Neither — free-form text
 *
 * For Ollama both fall back to `format: "json"`.
 */
export interface LlmCompletionOptions {
  /** Internal checkpoint/job identity; pins cumulative admission across continuation. */
  admissionRunId?: string;
  signal?: AbortSignal;
  images?: LlmImage[];
  capability?: ProviderCapability;
  /** Explicitly allow local validation when native constrained decoding is unavailable. */
  schemaFallback?: "local_validation";
  temperature?: number;
  maxTokens?: number;
  /** Override the model for this request (uses provider default if omitted) */
  model?: string;
  api?: "responses" | "chat-completions";
  reasoningEffort?: string;
  store?: boolean;
  /** Retained in instructions when sampling controls are unavailable. */
  cognitiveRole?: ModelRole;
  /** Optional OpenAI Responses text verbosity. Ignored by providers without native support. */
  textVerbosity?: "low" | "medium" | "high";
  /** Basic JSON mode — model must output valid JSON (no schema enforcement) */
  jsonMode?: boolean;
  /**
   * Strict JSON Schema (OpenAI Structured Outputs).
   * When provided, the OpenAI provider sends `response_format: { type: "json_schema", json_schema: { name, strict: true, schema } }`.
   * This guarantees the response matches the schema exactly — no malformed JSON, no missing fields.
   * Implies `jsonMode` — you don't need to set both.
   */
  jsonSchema?: {
    /** Schema name (e.g. "dream_response") */
    name: string;
    /** JSON Schema object */
    schema: Record<string, unknown>;
  };
}

export interface LlmProvider {
  readonly name: string;
  /** Check if provider is reachable */
  isAvailable(): Promise<boolean>;
  /** Generate a completion */
  complete(messages: LlmMessage[], options?: LlmCompletionOptions): Promise<LlmResponse>;
}

export type LlmToolDefinition = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};

export type LlmToolCall = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type LlmToolContentBlock =
  | { type: "text"; text: string }
  | ({ type: "image" } & LlmImage)
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export type LlmToolLoopMessage = {
  role: "system" | "user" | "assistant";
  content: string | LlmToolContentBlock[];
  providerRawAssistant?: Array<Record<string, unknown>>;
};

export type LlmToolLoopResponse = {
  admission?: import("./model-execution.js").ModelCallAdmission;
  text: string;
  model: string;
  stopReason: string;
  toolCalls: LlmToolCall[];
  providerRawAssistant?: Array<Record<string, unknown>>;
  usage?: TokenUsage;
};

function usesBoundAnthropicThinking(model: string): boolean {
  return /^claude-(?:opus-5-5|sonnet-5-5|fable-5-1)(?:$|[-_])/i.test(model.trim());
}

function anthropicThinkingOptions(model: string): Record<string, unknown> {
  return usesBoundAnthropicThinking(model) ? {
    thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } },
  } : {};
}

function anthropicThinkingHeaders(model: string): Record<string, string> {
  return usesBoundAnthropicThinking(model)
    ? { "anthropic-beta": "thinking-binding-controls-2026-08-01" } : {};
}

function logAnthropicThinkingDrops(model: string, transformations: unknown): void {
  if (!Array.isArray(transformations)) return;
  const dropped = transformations.filter((item) => item?.type === "thinking_dropped").length;
  if (dropped > 0) logger.warn(`Anthropic ${model}: API dropped ${dropped} bound thinking block(s) after a context or model change`);
}

export type LlmRouteLayer = "connected" | "daemon" | "deterministic_fallback";

export type LlmRouteFallbackReason =
  | "no_connected_model"
  | "connected_model_unavailable"
  | "no_daemon_model"
  | "daemon_model_unavailable"
  | "provider_failed"
  | "invalid_output"
  | "validation_failed"
  | "role_policy_blocked";

export type LlmRouteTask =
  | "remediation_drafting"
  | "task_preamble_compilation"
  | "graph_enrichment"
  | "dream_generation"
  | "normalization"
  | "generic";

export interface ConnectedLlmContext {
  provider: LlmProvider;
  /** Compact source label only; do not include prompt or secret material. */
  source: "architect" | "external" | "caller" | "sampling";
  model?: string;
}

export interface LlmRouteRequest {
  task: LlmRouteTask;
  /** Defaults to dreamer. Normalizer stays available for low-temperature validation tasks. */
  daemon_component?: "dreamer" | "normalizer";
  /** Task-specific daemon temperature required by ADR-203. */
  daemon_temperature?: number;
  max_tokens?: number;
  connected?: ConnectedLlmContext | null;
}

export interface LlmRouteSelection {
  layer: LlmRouteLayer;
  provider: LlmProvider | null;
  model: string | null;
  options: LlmCompletionOptions;
  provenance: {
    task: LlmRouteTask;
    layer: LlmRouteLayer;
    provider: string | null;
    model: string | null;
    source: ConnectedLlmContext["source"] | "daemon" | "deterministic_fallback";
    fallback_reason?: LlmRouteFallbackReason;
    temperature?: number;
    cognitive_role?: ModelRole;
    temperature_omitted?: string;
    role_policy_fingerprint?: string;
    role_policy_revision?: number;
    role_policy_diagnostics?: string[];
  };
}

// ---------------------------------------------------------------------------
// Ollama Provider — local model, no API key, autonomous
// ---------------------------------------------------------------------------

function withCognitiveRole(messages: LlmMessage[], role?: ModelRole): LlmMessage[] {
  if (!role) return messages;
  const instruction = cognitiveRoleInstruction(role);
  return messages.some(message => message.role === "system" && message.content === instruction)
    ? messages : [{ role: "system", content: instruction }, ...messages];
}

class OllamaProvider implements LlmProvider {
  readonly name = "ollama";

  constructor(
    private baseUrl: string,
    private model: string,
    private defaultTemperature: number,
    private defaultMaxTokens: number,
    private timeoutMs: number = 120_000,
  ) {}

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async complete(messages: LlmMessage[], options?: LlmCompletionOptions): Promise<LlmResponse> {
    const temp = options?.temperature ?? this.defaultTemperature;
    messages = withCognitiveRole(messages, options?.cognitiveRole);
    const maxTokens = options?.maxTokens ?? this.defaultMaxTokens;

    const model = options?.model ?? this.model;
    if (options?.images?.length) throw new Error("PROVIDER_IMAGES_UNQUALIFIED");

    const body: Record<string, unknown> = {
      model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      stream: false,
      options: {
        temperature: temp,
        num_predict: maxTokens,
      },
    };

    if (options?.jsonSchema) compileOutputValidator(options.jsonSchema.schema);
    const signal = completionSignal(this.timeoutMs, options?.signal);
    if (options?.jsonSchema || options?.jsonMode) {
      body.format = options?.jsonSchema?.schema ?? "json";
    }

    const res = await admittedModelFetch("ollama", `${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "unknown");
      throw new Error(`Ollama ${res.status}: ${errText}`);
    }

    const data = await res.json() as {
      message?: { content?: string };
      model?: string;
      eval_count?: number;
      prompt_eval_count?: number;
      done_reason?: string;
    };

    const usage = providerUsage("ollama", data);
    assertProviderOutcome("ollama", model, data, usage);
    validateCompletionText(data.message?.content ?? "", options, "ollama", model, usage);
    return {
      text: data.message?.content ?? "",
      model: data.model ?? this.model,
      tokensUsed: data.eval_count,
      stopReason: data.done_reason,
      usage,
      outputContract: { api: "ollama-chat", mode: options?.jsonSchema ? "local_validation" : options?.jsonMode ? "json" : "text", capabilityVersion: null },
    };
  }
}

// ---------------------------------------------------------------------------
// OpenAI-Compatible Provider — Anthropic, OpenAI, Groq, LM Studio, etc.
// ---------------------------------------------------------------------------

export function getModelCapabilities(provider: LlmProviderType | string, model: string, reasoningEffort?: string, override?: ProviderCapability): ModelCapabilities {
  const evidence = providerCapability(provider, model, override);
  return { model: model.trim(), api: evidence?.default_api ?? (provider === "anthropic" ? "anthropic-messages" : provider === "ollama" ? "ollama-chat" : provider === "sampling" ? "mcp-sampling" : provider === "none" ? "none" : "chat-completions"),
    supportsTemperature: modelTemperatureCapability(provider, model, reasoningEffort).support === "supported",
    supportsReasoningEffort: Boolean(evidence?.efforts.length), supportsStructuredOutputs: evidence?.strict_schema ?? false, supportsJsonSchema: evidence?.strict_schema ?? false };
}

/** Heuristic: error body indicates the strict json_schema form is unsupported. */
function _isJsonSchemaUnsupportedError(status: number, body: string): boolean {
  if (status < 400 || status >= 500) return false;
  const lower = body.toLowerCase();
  if (!lower.includes("response_format") && !lower.includes("json_schema")) {
    return false;
  }
  return (
    lower.includes("unsupported") ||
    lower.includes("not supported") ||
    lower.includes("not support") ||
    lower.includes("invalid") ||
    lower.includes("unknown")
  );
}

class OpenAiCompatibleProvider implements LlmProvider {
  readonly name: string;

  constructor(
    private baseUrl: string,
    private model: string,
    private apiKey: string,
    private defaultTemperature: number,
    private defaultMaxTokens: number,
    name: string = "openai",
    private timeoutMs: number = 120_000,
    private requestDefaults: Pick<LlmConfig, "api" | "reasoningEffort" | "store" | "capability"> = {},
  ) {
    this.name = name;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async complete(messages: LlmMessage[], options?: LlmCompletionOptions): Promise<LlmResponse> {
    options = { ...this.requestDefaults, ...options };
    const model = options.model ?? this.model;
    const capabilities = getModelCapabilities(this.name, model, options.reasoningEffort, options.capability);
    const api = options.api ?? capabilities.api;
    const allowLocal = options.schemaFallback === "local_validation";
    const evidence = assertProviderRequest(this.name, model, api, options.reasoningEffort, Boolean(options.jsonSchema && !allowLocal), false, options.capability);
    assertReasoningEffort(this.name, model, options.reasoningEffort);
    if (options.jsonSchema) compileOutputValidator(options.jsonSchema.schema);
    const signal = completionSignal(this.timeoutMs, options.signal);
    validateProviderImages(this.name, model, options.images ?? [], options.capability);
    if (options.images?.length && !messages.some(m => m.role === "user")) throw new Error("PROVIDER_IMAGE_USER_MESSAGE_REQUIRED");
    messages = withCognitiveRole(messages, options.cognitiveRole);
    const temp = options.temperature ?? this.defaultTemperature, maxTokens = options.maxTokens ?? this.defaultMaxTokens;
    if (api === "responses") return this.completeWithResponses(messages, model, temp, maxTokens, capabilities, { ...options, signal });
    const useNewTokenParam = /^(?:o[134](?:-|$)|gpt-(?:4\.1|5|6)(?:\.|-|$))/.test(model);
    let useStrict = Boolean(options.jsonSchema && evidence?.strict_schema);
    const body: Record<string, unknown> = { model, messages: messages.map((m, index) => ({ ...m, content: m.role === "user" && index === messages.map(value => value.role).lastIndexOf("user") ? providerImageContent(m.content, options!.images ?? [], "chat-completions") : m.content })),
      ...(capabilities.supportsTemperature ? { temperature: temp } : {}),
      ...(options.reasoningEffort ? { reasoning_effort: options.reasoningEffort } : {}),
      ...(options.store !== undefined ? { store: options.store } : {}),
      ...(useNewTokenParam ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }) };
    let callCount = 0;
    const call = () => {
      signal.throwIfAborted();
      if (useStrict) body.response_format = { type: "json_schema", json_schema: { name: options!.jsonSchema!.name, strict: true, schema: options!.jsonSchema!.schema } };
      else if (options!.jsonSchema || options!.jsonMode) body.response_format = { type: "json_object" };
      return admittedModelFetch(this.name, this.baseUrl + "/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + this.apiKey }, body: JSON.stringify(body), signal }, callCount++ > 0);
    };
    let res = await call();
    let fallbackReason = options.jsonSchema && !useStrict ? "native_schema_unqualified; explicitly authorized local validation" : undefined;
    if (!res.ok && useStrict && allowLocal) {
      const error = await res.text().catch(() => "unknown");
      if (!_isJsonSchemaUnsupportedError(res.status, error)) throw new Error("OpenAI-compat " + res.status);
      useStrict = false; fallbackReason = "native_schema_rejected; explicitly authorized local validation"; res = await call();
    }
    if (!res.ok) throw new Error("OpenAI-compat " + res.status);
    const data = await res.json() as any;
    const usage = providerUsage(this.name, data.usage);
    assertProviderOutcome(this.name, model, data, usage);
    const choice = data.choices?.[0];
    if (!choice?.message || typeof choice.message.content !== "string") throw new ProviderOutcomeError("PROVIDER_OUTPUT_INVALID", this.name, model, "missing_message", usage);
    validateCompletionText(choice.message.content, options, this.name, model, usage);
    return { text: choice.message.content, model: data.model ?? model, tokensUsed: usage?.outputTokens, stopReason: choice.finish_reason, finishReason: choice.finish_reason, usage,
      outputContract: { api: "chat-completions", mode: options.jsonSchema ? useStrict ? "native_strict" : "local_validation" : options.jsonMode ? "json" : "text", capabilityVersion: evidence?.version ?? null, ...(fallbackReason ? { fallbackReason } : {}) } };
  }

  private async completeWithResponses(
    messages: LlmMessage[],
    model: string,
    temp: number,
    maxTokens: number,
    capabilities: ModelCapabilities,
    options?: LlmCompletionOptions,
  ): Promise<LlmResponse> {
    const instructions = messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n");
    const input = messages
      .filter((message) => message.role !== "system")
      .map((message, index, values) => ({ role: message.role === "assistant" ? "assistant" : "user", content: message.role === "user" && index === values.map(value => value.role).lastIndexOf("user") ? providerImageContent(message.content, options?.images ?? [], "responses") : message.content }));
    const body: Record<string, unknown> = {
      model,
      input,
      max_output_tokens: maxTokens,
      text: {
        ...(options?.textVerbosity ? { verbosity: options.textVerbosity } : {}),
        ...(options?.jsonSchema && capabilities.supportsJsonSchema ? { format: { type: "json_schema", name: options.jsonSchema.name, schema: options.jsonSchema.schema, strict: true } }
          : options?.jsonSchema || options?.jsonMode ? { format: { type: "json_object" } } : {}),
      },
      ...(capabilities.supportsTemperature ? { temperature: temp } : {}),
      ...(options?.reasoningEffort ? { reasoning: { effort: options.reasoningEffort } } : {}),
      ...(options?.store !== undefined ? { store: options.store } : {}),
    };
    if (instructions) {
      body.instructions = instructions;
    }

    let useStrict = !!options?.jsonSchema && capabilities.supportsJsonSchema;
    let fallbackReason = options?.jsonSchema && !useStrict ? "native_schema_unqualified; explicitly authorized local validation" : undefined;
    const signal = options?.signal ?? completionSignal(this.timeoutMs);
    let callCount = 0;
    const call = () => { signal.throwIfAborted(); return admittedModelFetch(this.name, `${this.baseUrl}/responses`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` }, body: JSON.stringify(body), signal,
    }, callCount++ > 0); };
    let res = await call();
    if (!res.ok && useStrict && options?.schemaFallback === "local_validation") {
      const error = await res.text().catch(() => "unknown");
      if (!_isJsonSchemaUnsupportedError(res.status, error)) throw new Error(`OpenAI Responses ${res.status}`);
      useStrict = false; fallbackReason = "native_schema_rejected; explicitly authorized local validation";
      (body.text as Record<string, unknown>).format = { type: "json_object" }; res = await call();
    }

    if (!res.ok) {
      throw new Error(`OpenAI Responses ${res.status}`);
    }

    const data = await res.json() as {
      output_text?: string;
      model?: string;
      status?: string;
      usage?: Record<string, unknown>;
      output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
    };
    const usage = providerUsage(this.name, data.usage);
    assertProviderOutcome(this.name, model, data, usage);
    const text = data.output_text ?? (data.output ?? [])
      .filter((item) => item.type === "message")
      .flatMap((item) => item.content ?? [])
      .filter((content) => content.type === "output_text" || content.type === "text")
      .map((content) => content.text ?? "")
      .join("");
    if (typeof text !== "string") throw new ProviderOutcomeError("PROVIDER_OUTPUT_INVALID", this.name, model, "invalid_text", usage);
    validateCompletionText(text, options, this.name, model, usage);
    return {
      text,
      model: data.model ?? model,
      tokensUsed: usage?.outputTokens,
      stopReason: data.status,
      finishReason: data.status,
      usage,
      outputContract: { api: "responses", mode: options?.jsonSchema ? useStrict ? "native_strict" : "local_validation" : options?.jsonMode ? "json" : "text",
        capabilityVersion: providerCapability(this.name, model, options?.capability)?.version ?? null,
        ...(fallbackReason ? { fallbackReason } : {}) },
    };
  }
}

export async function completeWithNativeTools(config: ArchitectLlmConfig, messages: LlmToolLoopMessage[], tools: LlmToolDefinition[], options: { signal?: AbortSignal } = {}): Promise<LlmToolLoopResponse> {
  const role=config.admissionPolicy?.policy.role??"architect";
  if(role!=="architect"&&role!=="computer_use")throw new Error("NATIVE_TOOL_ROLE_UNSUPPORTED");
  let run = nativeRuns.get(config);
  if (!run) { run = new ModelExecution(config, role, config.admissionPolicy); nativeRuns.set(config, run); }
  return run.complete(() => completeWithNativeToolsRaw(config, messages, tools, options));
}

async function completeWithNativeToolsRaw(
  config: ArchitectLlmConfig, messages: LlmToolLoopMessage[], tools: LlmToolDefinition[], options: { signal?: AbortSignal } = {},
): Promise<LlmToolLoopResponse> {
  const signal = completionSignal(config.timeoutMs, options.signal);
  const capabilities = getModelCapabilities(config.provider, config.model, config.reasoningEffort, config.capability);
  const api = config.provider === "anthropic" ? "anthropic-messages" : config.api ?? capabilities.api;
  assertReasoningEffort(config.provider, config.model, config.reasoningEffort);
  assertProviderRequest(config.provider, config.model, api, config.reasoningEffort, false, tools.length > 0, config.capability);
  if (!["openai", "lmstudio", "anthropic"].includes(config.provider)) throw new Error("NATIVE_TOOL_ADAPTER_UNSUPPORTED");
  for (const message of messages) if (Array.isArray(message.content)) {
    const images = message.content.filter((block): block is Extract<LlmToolContentBlock, { type: "image" }> => block.type === "image");
    if (images.length && message.role !== "user") throw new Error("PROVIDER_IMAGE_ROLE_UNSUPPORTED");
    validateProviderImages(config.provider, config.model, images, config.capability);
  }
  const validators = new Map<string, (value: unknown) => boolean>();
  for (const tool of tools) {
    if (!tool.name || validators.has(tool.name)) throw new Error("DUPLICATE_OR_INVALID_TOOL_NAME");
    validators.set(tool.name, compileOutputValidator(normalizeToolInputSchema(tool.inputSchema)));
  }
  const response = config.provider === "anthropic" ? await callAnthropicWithTools(config, messages, tools, signal)
    : api === "responses" ? await callOpenAiResponsesWithTools(config, messages, tools, signal)
    : await callOpenAiCompatibleWithTools(config, messages, tools, signal);
  const ids = new Set<string>();
  for (const tool of response.toolCalls) {
    if (!tool.id || ids.has(tool.id) || !validators.get(tool.name)?.(tool.input)) throw new ProviderOutcomeError("TOOL_ARGUMENTS_INVALID", config.provider, config.model, "unadvertised_duplicate_or_invalid_tool", response.usage);
    ids.add(tool.id);
  }
  return response;
}

async function callOpenAiCompatibleWithTools(
  config: ArchitectLlmConfig,
  messages: LlmToolLoopMessage[],
  tools: LlmToolDefinition[],
  signal: AbortSignal,
): Promise<LlmToolLoopResponse> {
  const capabilities = getModelCapabilities(config.provider, config.model, config.reasoningEffort, config.capability);
  const useNewTokenParam = /^(o[1-9]|gpt-[4-9]\.[1-9]|gpt-5)/i.test(config.model);
  const body: Record<string, unknown> = {
    model: config.model,
    messages: toOpenAiMessages(messages),
    ...(capabilities.supportsTemperature ? { temperature: config.temperature } : {}),
    ...(config.reasoningEffort ? { reasoning_effort: config.reasoningEffort } : {}),
    ...(config.store !== undefined ? { store: config.store } : {}),
    ...(useNewTokenParam
      ? { max_completion_tokens: config.maxTokens }
      : { max_tokens: config.maxTokens }),
    tools: tools.map(toOpenAiTool),
    tool_choice: "auto",
  };

  const res = await admittedModelFetch(config.provider, `${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "unknown");
    throw new Error(`OpenAI-compatible tool call ${res.status}`);
  }

  const data = await res.json() as {
    choices?: Array<{
      message?: { content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> };
      finish_reason?: string;
    }>;
    model?: string;
  };
  const usage = providerUsage(config.provider, (data as any).usage);
  assertProviderOutcome(config.provider, config.model, data, usage);
  const choice = data.choices?.[0];
  const toolCalls = (choice?.message?.tool_calls ?? []).map((toolCall) => ({
    id: toolCall.id,
    name: toolCall.function.name,
    input: parseToolArguments(toolCall.function.arguments, config.provider, config.model, usage),
  }));
  return {
    usage,
    text: choice?.message?.content ?? "",
    model: data.model ?? config.model,
    stopReason: choice?.finish_reason === "tool_calls" ? "tool_use" : (choice?.finish_reason ?? "stop"),
    toolCalls,
  };
}

async function callOpenAiResponsesWithTools(
  config: ArchitectLlmConfig,
  messages: LlmToolLoopMessage[],
  tools: LlmToolDefinition[],
  signal: AbortSignal,
): Promise<LlmToolLoopResponse> {
  const capabilities = getModelCapabilities(config.provider, config.model, config.reasoningEffort, config.capability);
  const systemText = messages
    .filter((message) => message.role === "system")
    .map((message) => typeof message.content === "string" ? message.content : blocksToText(message.content))
    .filter(Boolean)
    .join("\n\n");
  const body: Record<string, unknown> = {
    model: config.model,
    input: toOpenAiResponsesInput(messages.filter((message) => message.role !== "system")),
    store: config.store ?? false,
    include: ["reasoning.encrypted_content"],
    tools: tools.map(toOpenAiResponsesTool),
    tool_choice: "auto",
    max_output_tokens: config.maxTokens,
    ...(config.textVerbosity ? { text: { verbosity: config.textVerbosity } } : {}),
    ...(capabilities.supportsTemperature ? { temperature: config.temperature } : {}),
    ...(config.reasoningEffort ? { reasoning: { effort: config.reasoningEffort } } : {}),
  };
  if (systemText) {
    body.instructions = systemText;
  }

  const res = await admittedModelFetch(config.provider, `${config.baseUrl}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "unknown");
    throw new Error(`OpenAI Responses tool call ${res.status}`);
  }

  const data = await res.json() as {
    id?: string;
    model?: string;
    output_text?: string;
    status?: string;
    output?: Array<{
      id?: string;
      type?: string;
      status?: string;
      role?: string;
      content?: Array<{ type?: string; text?: string }>;
      name?: string;
      call_id?: string;
      arguments?: string;
    }>;
  };
  const usage = providerUsage(config.provider, (data as any).usage);
  assertProviderOutcome(config.provider, config.model, data, usage);
  const output = data.output ?? [];
  assertClientFunctionOutput(config.provider,config.model,output,"responses",usage);
  const text = data.output_text ?? output
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((content) => content.type === "output_text" || content.type === "text")
    .map((content) => content.text ?? "")
    .join("");
  const toolCalls = output
    .filter((item) => item.type === "function_call" && item.name && item.call_id)
    .map((item) => ({
      id: item.call_id!,
      name: item.name!,
      input: parseToolArguments(item.arguments ?? "{}", config.provider, config.model, usage),
    }));
  return {
    usage,
    text,
    model: data.model ?? config.model,
    stopReason: toolCalls.length > 0 ? "tool_use" : (data.status ?? "stop"),
    toolCalls,
    providerRawAssistant: output,
  };
}

/**
 * Anthropic caches a prompt only up to explicit cache_control breakpoints (order: tools, system, messages). Three are
 * set: the last tool, the system prompt, and the last content block of the latest message. The last one rolls: each
 * tool-loop call reads the prefix the previous call cached and writes only the new suffix. DreamGraph keeps the
 * managed context byte-identical between calls, so that prefix stays valid. Thinking blocks cannot carry a
 * breakpoint. DREAMGRAPH_ANTHROPIC_PROMPT_CACHE=0 turns it off.
 */
export function withAnthropicPromptCache(body: Record<string, unknown>): Record<string, unknown> {
  const mark = { type: "ephemeral" };
  const tools = Array.isArray(body.tools) ? body.tools as Array<Record<string, unknown>> : [];
  if (tools.length) tools[tools.length - 1] = { ...tools[tools.length - 1], cache_control: mark };
  if (typeof body.system === "string" && body.system) body.system = [{ type: "text", text: body.system, cache_control: mark }];
  const messages = Array.isArray(body.messages) ? body.messages as Array<Record<string, unknown>> : [];
  const last = messages[messages.length - 1];
  if (last) {
    const blocks: Array<Record<string, unknown>> = typeof last.content === "string"
      ? (last.content ? [{ type: "text", text: last.content }] : [])
      : Array.isArray(last.content) ? [...last.content as Array<Record<string, unknown>>] : [];
    for (let index = blocks.length - 1; index >= 0; index--) {
      const type = String(blocks[index].type);
      if (type === "thinking" || type === "redacted_thinking" || type === "text" && !blocks[index].text) continue;
      blocks[index] = { ...blocks[index], cache_control: mark };
      messages[messages.length - 1] = { ...last, content: blocks };
      break;
    }
  }
  return body;
}

async function callAnthropicWithTools(
  config: ArchitectLlmConfig,
  messages: LlmToolLoopMessage[],
  tools: LlmToolDefinition[],
  signal: AbortSignal,
): Promise<LlmToolLoopResponse> {
  const systemText = messages
    .filter((message) => message.role === "system")
    .map((message) => typeof message.content === "string" ? message.content : blocksToText(message.content))
    .filter(Boolean)
    .join("\n\n");

  const body: Record<string, unknown> = {
    model: config.model,
    max_tokens: config.maxTokens,
    ...(config.reasoningEffort ? { output_config: { effort: config.reasoningEffort } } : {}),
    ...anthropicThinkingOptions(config.model),
    ...(getModelCapabilities("anthropic", config.model).supportsTemperature ? { temperature: config.temperature } : {}),
    messages: messages
      .filter((message) => message.role !== "system")
      .map(toAnthropicToolMessage),
    tools: tools.map(toAnthropicTool),
  };
  if (systemText) {
    body.system = systemText;
  }
  if (process.env.DREAMGRAPH_ANTHROPIC_PROMPT_CACHE !== "0") withAnthropicPromptCache(body);

  const res = await admittedModelFetch(config.provider, `${config.baseUrl}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
      ...anthropicThinkingHeaders(config.model),
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "unknown");
    throw new Error(`Anthropic tool call ${res.status}`);
  }

  const data = await res.json() as {
    content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
    model?: string;
    stop_reason?: string;
    input_transformations?: unknown[];
  };
  const usage = providerUsage("anthropic", (data as any).usage);
  assertProviderOutcome("anthropic", config.model, data, usage);
  logAnthropicThinkingDrops(config.model, data.input_transformations);
  const blocks = data.content ?? [];
  assertClientFunctionOutput("anthropic",config.model,blocks,"anthropic",usage);
  return {
    usage,
    text: blocks.filter((block) => block.type === "text").map((block) => block.text ?? "").join(""),
    model: data.model ?? config.model,
    stopReason: data.stop_reason ?? "stop",
    providerRawAssistant: blocks,
    toolCalls: blocks
      .filter((block) => block.type === "tool_use" && block.id && block.name)
      .map((block) => ({
        id: block.id!,
        name: block.name!,
        input: isRecord(block.input) ? block.input : {},
      })),
  };
}

function toOpenAiResponsesInput(messages: LlmToolLoopMessage[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const message of messages) {
    if (message.role === "assistant" && message.providerRawAssistant?.length) {
      out.push(...message.providerRawAssistant);
      continue;
    }
    if (typeof message.content === "string") {
      out.push({ role: message.role === "assistant" ? "assistant" : "user", content: message.content });
      continue;
    }
    for (const block of message.content) {
      if (block.type === "text" && block.text) {
        out.push({ role: message.role === "assistant" ? "assistant" : "user", content: block.text });
      } else if (block.type === "image") {
        out.push({ role: "user", content: [{ type: "input_image", image_url: `data:${block.mimeType};base64,${block.dataBase64}` }] });
      } else if (block.type === "tool_use") {
        out.push({ type: "function_call", call_id: block.id, name: block.name, arguments: JSON.stringify(block.input ?? {}) });
      } else if (block.type === "tool_result") {
        out.push({ type: "function_call_output", call_id: block.tool_use_id, output: block.content });
      }
    }
  }
  return out;
}

function toOpenAiMessages(messages: LlmToolLoopMessage[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const message of messages) {
    if (typeof message.content === "string") {
      out.push({ role: message.role, content: message.content });
      continue;
    }

    const text = blocksToText(message.content);
    const toolUses = message.content.filter((block): block is Extract<LlmToolContentBlock, { type: "tool_use" }> => block.type === "tool_use");
    const toolResults = message.content.filter((block): block is Extract<LlmToolContentBlock, { type: "tool_result" }> => block.type === "tool_result");

    if (message.role === "assistant") {
      out.push({
        role: "assistant",
        content: text || null,
        ...(toolUses.length > 0
          ? {
              tool_calls: toolUses.map((block) => ({
                id: block.id,
                type: "function",
                function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
              })),
            }
          : {}),
      });
      continue;
    }

    const images = message.content.filter((block): block is Extract<LlmToolContentBlock, { type: "image" }> => block.type === "image");
    if (text || images.length) {
      out.push({ role: message.role, content: providerImageContent(text, images, "chat-completions") });
    }
    for (const result of toolResults) {
      out.push({ role: "tool", tool_call_id: result.tool_use_id, content: result.content });
    }
  }
  return out;
}

function toAnthropicToolMessage(message: LlmToolLoopMessage): Record<string, unknown> {
  if (message.role === "assistant" && message.providerRawAssistant?.length) {
    return { role: message.role, content: message.providerRawAssistant };
  }
  if (typeof message.content === "string") {
    return { role: message.role, content: message.content };
  }
  return {
    role: message.role,
    content: message.content.map((block) => {
      if (block.type === "text") return { type: "text", text: block.text };
      if (block.type === "image") return { type: "image", source: { type: "base64", media_type: block.mimeType, data: block.dataBase64 } };
      if (block.type === "tool_use") return { type: "tool_use", id: block.id, name: block.name, input: block.input ?? {} };
      return {
        type: "tool_result",
        tool_use_id: block.tool_use_id,
        content: block.content,
        ...(block.is_error ? { is_error: true } : {}),
      };
    }),
  };
}

function toOpenAiTool(tool: LlmToolDefinition): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description ?? "DreamGraph MCP tool",
      parameters: normalizeToolInputSchema(tool.inputSchema),
    },
  };
}

function toOpenAiResponsesTool(tool: LlmToolDefinition): Record<string, unknown> {
  return {
    type: "function",
    name: tool.name,
    description: tool.description ?? "DreamGraph MCP tool",
    parameters: normalizeToolInputSchema(tool.inputSchema),
  };
}

function toAnthropicTool(tool: LlmToolDefinition): Record<string, unknown> {
  return {
    name: tool.name,
    description: tool.description ?? "DreamGraph MCP tool",
    input_schema: normalizeToolInputSchema(tool.inputSchema),
  };
}

function normalizeToolInputSchema(schema: unknown): Record<string, unknown> {
  if (schema === undefined) return { type: "object", properties: {}, additionalProperties: true };
  if (!isRecord(schema) || schema.type !== undefined && schema.type !== "object") throw new Error("TOOL_SCHEMA_INVALID");
  return { type: "object", ...structuredClone(schema) };
}

function parseToolArguments(raw: string, provider: string, model: string, usage?: TokenUsage): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || "{}");
    if (!isRecord(parsed)) throw new Error("TOOL_ARGUMENTS_INVALID");
    return parsed;
  } catch {
    throw new ProviderOutcomeError("TOOL_ARGUMENTS_INVALID", provider, model, "invalid_json_object", usage);
  }
}

function blocksToText(blocks: LlmToolContentBlock[]): string {
  return blocks
    .filter((block): block is Extract<LlmToolContentBlock, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Anthropic Provider — native Claude API
// ---------------------------------------------------------------------------

/**
 * Native Anthropic Messages API provider.
 * Uses /v1/messages endpoint with x-api-key auth and anthropic-version header.
 * System messages are extracted and sent as the top-level `system` param.
 */
class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";

  constructor(
    private baseUrl: string,
    private model: string,
    private apiKey: string,
    private defaultTemperature: number,
    private defaultMaxTokens: number,
    private timeoutMs: number = 120_000,
    private requestDefaults: Pick<LlmConfig, "reasoningEffort" | "capability"> = {},
  ) {}

  async isAvailable(): Promise<boolean> {
    // Anthropic doesn't have a lightweight ping endpoint;
    // just verify we have an API key configured.
    return !!this.apiKey;
  }

  async complete(messages: LlmMessage[], options?: LlmCompletionOptions): Promise<LlmResponse> {
    options = { ...this.requestDefaults, ...options };
    const model = options.model ?? this.model;
    const evidence = assertProviderRequest("anthropic", model, "anthropic-messages", options.reasoningEffort, Boolean(options.jsonSchema && options.schemaFallback !== "local_validation"), false, options.capability);
    if (options.jsonSchema) compileOutputValidator(options.jsonSchema.schema);
    const signal = completionSignal(this.timeoutMs, options.signal);
    messages = withCognitiveRole(messages, options.cognitiveRole);
    const systemText = messages.filter(m => m.role === "system").map(m => m.content).join("\n\n");
    validateProviderImages("anthropic", model, options.images ?? [], options.capability);
    if (options.images?.length && !messages.some(m => m.role === "user")) throw new Error("PROVIDER_IMAGE_USER_MESSAGE_REQUIRED");
    const nativeSchema = Boolean(options.jsonSchema && evidence?.strict_schema);
    const body: Record<string, unknown> = { model, max_tokens: options.maxTokens ?? this.defaultMaxTokens,
      ...anthropicThinkingOptions(model),
      ...(getModelCapabilities("anthropic", model, options.reasoningEffort).supportsTemperature ? { temperature: options.temperature ?? this.defaultTemperature } : {}),
      messages: messages.filter(m => m.role !== "system").map((m, index, values) => ({ ...m, content: m.role === "user" && index === values.map(value => value.role).lastIndexOf("user") ? providerImageContent(m.content, options!.images ?? [], "anthropic-messages") : m.content })),
      ...(systemText ? { system: systemText } : {}) };
    if (nativeSchema || options.reasoningEffort) body.output_config = {
      ...(options.reasoningEffort ? { effort: options.reasoningEffort } : {}),
      ...(nativeSchema ? { format: { type: "json_schema", schema: anthropicOutputSchema(options.jsonSchema!.schema) } } : {}) };
    if ((options.jsonMode || options.jsonSchema) && !nativeSchema) body.system = (systemText + "\n\nRespond with valid JSON only. No markdown or explanation.").trim();
    const res = await admittedModelFetch("anthropic", this.baseUrl + "/messages", { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": this.apiKey, "anthropic-version": "2023-06-01", ...anthropicThinkingHeaders(model) }, body: JSON.stringify(body), signal });
    if (!res.ok) throw new Error("Anthropic " + res.status);
    const data = await res.json() as any;
    const usage = providerUsage("anthropic", data.usage);
    assertProviderOutcome("anthropic", model, data, usage);
    logAnthropicThinkingDrops(model, data.input_transformations);
    const text = (data.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text ?? "").join("");
    validateCompletionText(text, options, "anthropic", model, usage);
    return { text, model: data.model ?? model, tokensUsed: usage?.outputTokens, stopReason: data.stop_reason, finishReason: data.stop_reason, usage,
      outputContract: { api: "anthropic-messages", mode: options.jsonSchema ? nativeSchema ? "native_strict" : "local_validation" : options.jsonMode ? "json" : "text", capabilityVersion: evidence?.version ?? null,
        ...(options.jsonSchema && !nativeSchema ? { fallbackReason: "native_schema_unqualified; explicitly authorized local validation" } : {}) } };
  }

}

// ---------------------------------------------------------------------------
// MCP Sampling Provider — uses the connected client's LLM
// ---------------------------------------------------------------------------

/**
 * MCP Sampling provider — asks the connected client's LLM via the
 * MCP sampling/createMessage protocol.
 *
 * Requires:
 * - A connected client that supports sampling capability
 * - Human-in-the-loop approval from the client side
 * - Server reference set via setMcpServer()
 *
 * Use this when DreamGraph is connected to an AI IDE (VS Code + Copilot).
 * For autonomous daemon dreaming, prefer Ollama or OpenAI provider.
 */
class McpSamplingProvider implements LlmProvider {
  readonly name = "sampling";
  private _server: unknown = null;

  /** Inject the MCP Server instance after connection */
  setServer(server: unknown): void {
    this._server = server;
  }

  async isAvailable(): Promise<boolean> {
    if (!this._server) return false;
    try {
      // Check if the low-level Server has client capabilities with sampling
      const srv = this._server as {
        getClientCapabilities?: () => { sampling?: unknown } | undefined;
      };
      const caps = srv.getClientCapabilities?.();
      return !!caps?.sampling;
    } catch {
      return false;
    }
  }

  async complete(messages: LlmMessage[], options?: LlmCompletionOptions): Promise<LlmResponse> {
    if (options?.images?.length) throw new Error("SAMPLING_IMAGES_UNQUALIFIED");
    if (!this._server) {
      throw new Error("MCP Sampling: No server connected");
    }
    messages = withCognitiveRole(messages, options?.cognitiveRole);

    const srv = this._server as {
      createMessage: (params: Record<string, unknown>, options?: { signal?: AbortSignal }) => Promise<{
        content: { type: string; text?: string } | Array<{ type: string; text?: string }>;
        model?: string;
        stopReason?: string;
      }>;
    };

    // Convert our messages to MCP sampling format
    // MCP sampling expects: messages array + optional systemPrompt
    const systemText = messages.filter(m => m.role === "system").map(m => m.content).join("\n\n");
    const nonSystemMsgs = messages.filter(m => m.role !== "system");

    const params: Record<string, unknown> = {
      messages: nonSystemMsgs.map(m => ({
        role: m.role,
        content: { type: "text", text: m.content },
      })),
      maxTokens: options?.maxTokens ?? 2048,
    };

    if (systemText) {
      params.systemPrompt = systemText;
    }

    if (options?.temperature !== undefined) params.temperature = options.temperature;

    if (options?.reasoningEffort) throw new Error("SAMPLING_EFFORT_UNQUALIFIED");
    if (options?.jsonSchema) compileOutputValidator(options.jsonSchema.schema);
    const signal = completionSignal(120000, options?.signal);
    const result = await currentModelExecution().request({ provider: "sampling", model: options?.model ?? "client",
      payload: JSON.stringify(params), output_tokens: Number(params.maxTokens), signal }, async admittedSignal => ({
        result: await srv.createMessage(params, { signal: admittedSignal }), acknowledged: true }));

    // Extract text from response content
    const content = Array.isArray(result.content)
      ? result.content
      : [result.content];
    const text = content
      .filter(c => c.type === "text")
      .map(c => c.text ?? "")
      .join("");

    validateCompletionText(text, options, "sampling", result.model ?? "client-llm");
    assertProviderOutcome("sampling", result.model ?? "client-llm", { stop_reason: result.stopReason });
    return {
      text,
      model: result.model ?? "client-llm",
      stopReason: result.stopReason,
    };
  }
}

// ---------------------------------------------------------------------------
// Null Provider — structural-only fallback (degraded mode)
// ---------------------------------------------------------------------------

class NullProvider implements LlmProvider {
  readonly name = "none";

  async isAvailable(): Promise<boolean> {
    return false;
  }

  async complete(): Promise<LlmResponse> {
    throw new Error(
      "LLM provider not configured. Dreams require an LLM. " +
      "Set DREAMGRAPH_LLM_PROVIDER=ollama and ensure Ollama is running, " +
      "or set DREAMGRAPH_LLM_PROVIDER=openai/anthropic with DREAMGRAPH_LLM_API_KEY."
    );
  }
}

// ---------------------------------------------------------------------------
// Config parsing
// ---------------------------------------------------------------------------

export function parseLlmConfig(): LlmConfig {
  const provider = (process.env.DREAMGRAPH_LLM_PROVIDER ?? "ollama") as LlmProviderType;

  // Base settings are fallbacks; independent role policy and per-component
  // overrides remain authoritative for their executions.
  const temperature = 0.7;
  const maxTokens = 2048;
  const timeoutEnv = Number(process.env.DREAMGRAPH_LLM_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(timeoutEnv) && timeoutEnv > 0 ? timeoutEnv : 120_000;

  let model: string;
  let baseUrl: string;
  let apiKey: string;

  switch (provider) {
    case "ollama":
      model = "qwen3:8b";
      baseUrl = process.env.DREAMGRAPH_LLM_URL ?? "http://localhost:11434";
      apiKey = "";
      break;
    case "lmstudio":
      model = process.env.DREAMGRAPH_LLM_MODEL ?? "";
      baseUrl = process.env.DREAMGRAPH_LLM_URL ?? "http://localhost:1234/v1";
      // LM Studio ignores the auth header, but the OpenAI-compat code path
      // still sends one. A literal placeholder keeps both sides happy and
      // avoids special-casing the request layer.
      apiKey = process.env.DREAMGRAPH_LLM_API_KEY ?? "lm-studio";
      break;
    case "openai":
      model = "gpt-4o-mini";
      baseUrl = process.env.DREAMGRAPH_LLM_URL ?? "https://api.openai.com/v1";
      apiKey = process.env.DREAMGRAPH_LLM_API_KEY ?? "";
      break;
    case "anthropic":
      model = "claude-sonnet-5-5";
      baseUrl = process.env.DREAMGRAPH_LLM_URL ?? "https://api.anthropic.com/v1";
      apiKey = process.env.DREAMGRAPH_LLM_API_KEY ?? "";
      break;
    case "sampling":
      model = "client";
      baseUrl = "";
      apiKey = "";
      break;
    default: // "none"
      model = "";
      baseUrl = "";
      apiKey = "";
      break;
  }

  const reasoningEffort = process.env.DREAMGRAPH_LLM_REASONING_EFFORT?.trim();
  const api = process.env.DREAMGRAPH_LLM_API;
  const retention = process.env.DREAMGRAPH_LLM_RETENTION;
  return { provider, model: process.env.DREAMGRAPH_LLM_MODEL ?? model, baseUrl, apiKey,
    temperature: process.env.DREAMGRAPH_LLM_TEMPERATURE === undefined ? temperature : Number(process.env.DREAMGRAPH_LLM_TEMPERATURE),
    maxTokens: process.env.DREAMGRAPH_LLM_MAX_TOKENS === undefined ? maxTokens : Number(process.env.DREAMGRAPH_LLM_MAX_TOKENS), timeoutMs,
    ...(api === "responses" ? { api: "responses" as const } : api === "chat_completions" ? { api: "chat-completions" as const } : {}),
    ...(retention === "store_false" ? { store: false } : retention === "store_true" ? { store: true } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}) };
}

// ---------------------------------------------------------------------------
// Per-component config — dreamer and normalizer can have different settings
// ---------------------------------------------------------------------------

/**
 * Parse per-component LLM settings.
 * Reads DREAMGRAPH_LLM_{COMPONENT}_MODEL / TEMPERATURE / MAX_TOKENS,
 * falling back to provider-specific defaults from the base LlmConfig.
 * The `defaultTemperature` override allows the normalizer to default to
 * low temperature (0.1) for consistent, deterministic validation even
 * when no env var is set.
 */
export interface CognitiveLlmConfig { model: string; temperature: number; maxTokens: number; reasoningEffort?: string }
function parseComponentConfig(
  component: "DREAMER" | "NORMALIZER",
  base: LlmConfig,
  defaultTemperature?: number,
): CognitiveLlmConfig {
  const prefix = `DREAMGRAPH_LLM_${component}`;
  const model = process.env[`${prefix}_MODEL`] ?? base.model;
  const temperature = process.env[`${prefix}_TEMPERATURE`]
    ? parseFloat(process.env[`${prefix}_TEMPERATURE`]!)
    : (defaultTemperature ?? base.temperature);
  const maxTokens = process.env[`${prefix}_MAX_TOKENS`]
    ? parseInt(process.env[`${prefix}_MAX_TOKENS`]!, 10)
    : base.maxTokens;
  const reasoningEffort = process.env[`${prefix}_REASONING_EFFORT`]?.trim() || base.reasoningEffort;
  return { model, temperature, maxTokens, ...(reasoningEffort ? { reasoningEffort } : {}) };
}

const LLM_PROVIDER_TYPES: readonly LlmProviderType[] = ["ollama", "lmstudio", "openai", "anthropic", "sampling", "none"];

function envText(key: string): string | null {
  const value = process.env[key]?.trim();
  return value && value.length > 0 ? value : null;
}

function envNumber(key: string, fallback: number): number {
  const raw = envText(key);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseProviderOverride(raw: string | null): LlmProviderType | null {
  const normalized = raw?.toLowerCase() as LlmProviderType | undefined;
  return normalized && LLM_PROVIDER_TYPES.includes(normalized) ? normalized : null;
}

function providerDefaults(provider: LlmProviderType, base: LlmConfig): Pick<LlmConfig, "model" | "baseUrl" | "apiKey"> {
  switch (provider) {
    case "ollama":
      return { model: "qwen3:8b", baseUrl: "http://localhost:11434", apiKey: "" };
    case "lmstudio":
      return { model: envText("DREAMGRAPH_LLM_MODEL") ?? "", baseUrl: "http://localhost:1234/v1", apiKey: "lm-studio" };
    case "openai":
      return { model: "gpt-4o-mini", baseUrl: "https://api.openai.com/v1", apiKey: process.env.DREAMGRAPH_LLM_API_KEY ?? "" };
    case "anthropic":
      return { model: "claude-sonnet-5-5", baseUrl: "https://api.anthropic.com/v1", apiKey: process.env.DREAMGRAPH_LLM_API_KEY ?? "" };
    case "sampling":
      return { model: "client", baseUrl: "", apiKey: "" };
    default:
      return { model: base.model, baseUrl: base.baseUrl, apiKey: base.apiKey };
  }
}

let _dreamerConfig: CognitiveLlmConfig | null = null;
let _normalizerConfig: CognitiveLlmConfig | null = null;
let _architectConfig: ArchitectLlmConfig | null = null;

/** Get dreamer-specific LLM settings (model, temperature, maxTokens) */
export function getDreamerLlmConfig(): CognitiveLlmConfig {
  if (!_dreamerConfig) {
    _dreamerConfig = parseComponentConfig("DREAMER", getLlmConfig());
    const base = getLlmConfig();
    if (_dreamerConfig.model !== base.model || _dreamerConfig.temperature !== base.temperature) {
      logger.info(
        `LLM dreamer config: model=${_dreamerConfig.model}, temp=${_dreamerConfig.temperature}, maxTokens=${_dreamerConfig.maxTokens}`
      );
    }
  }
  return _dreamerConfig;
}

/**
 * Get normalizer-specific LLM settings (model, temperature, maxTokens).
 * Normalizer defaults to temperature 0.1 (low) for consistent, deterministic
 * validation judgments. This is intentionally different from the dreamer's
 * creative 0.7-0.9 temperature — the normalizer is a strict critic.
 */
export function getNormalizerLlmConfig(): CognitiveLlmConfig {
  if (!_normalizerConfig) {
    _normalizerConfig = parseComponentConfig("NORMALIZER", getLlmConfig(), 0.1);
    const base = getLlmConfig();
    if (_normalizerConfig.model !== base.model || _normalizerConfig.temperature !== 0.1) {
      logger.info(
        `LLM normalizer config: model=${_normalizerConfig.model}, temp=${_normalizerConfig.temperature}, maxTokens=${_normalizerConfig.maxTokens}`
      );
    }
  }
  return _normalizerConfig;
}

/**
 * Architect-only provider defaults (Ashoka). Used only when neither an Architect
 * model nor a general DREAMGRAPH_LLM_MODEL is configured; other roles keep the
 * cheaper generic provider defaults.
 */
export const ARCHITECT_PROVIDER_DEFAULT_MODELS: Readonly<Partial<Record<LlmProviderType, string>>> = Object.freeze({
  openai: "gpt-6.1-sol",
});

/**
 * Get Architect chat LLM settings and expose the exact fallback source.
 * Model order: ARCHITECT -> general -> normalizer -> dreamer.
 */
export function getArchitectLlmConfig(): ArchitectLlmConfig {
  const session = getSessionContext();
  if (session && Object.keys(session.environment).length) {
    const env = sessionEnvironment(), base = getLlmConfig();
    const provider = parseProviderOverride(env.DREAMGRAPH_LLM_ARCHITECT_PROVIDER || null) ?? base.provider;
    const defaults = providerDefaults(provider, base);
    return { component: "architect", provider, providerSource: "architect", model: env.DREAMGRAPH_LLM_ARCHITECT_MODEL || ARCHITECT_PROVIDER_DEFAULT_MODELS[provider] || defaults.model,
      modelSource: "architect", baseUrl: env.DREAMGRAPH_LLM_ARCHITECT_URL || (provider === base.provider ? base.baseUrl : defaults.baseUrl),
      apiKey: process.env.DREAMGRAPH_LLM_ARCHITECT_API_KEY || (provider === base.provider ? base.apiKey : defaults.apiKey),
      temperature: Number(env.DREAMGRAPH_LLM_ARCHITECT_TEMPERATURE ?? base.temperature),
      maxTokens: Number(env.DREAMGRAPH_LLM_ARCHITECT_MAX_TOKENS ?? base.maxTokens), timeoutMs: base.timeoutMs,
      reasoningEffort: env.DREAMGRAPH_LLM_ARCHITECT_REASONING_EFFORT || base.reasoningEffort };
  }
  if (!_architectConfig) {
    const base = getLlmConfig();
    const requestedProvider = parseProviderOverride(envText("DREAMGRAPH_LLM_ARCHITECT_PROVIDER"));
    const provider = requestedProvider ?? base.provider;
    const providerSource: ArchitectLlmConfig["providerSource"] = requestedProvider ? "architect" : "general";
    const defaults = providerDefaults(provider, base);
    const modelCandidates: Array<{ value: string | null; source: LlmConfigSource }> = [
      { value: envText("DREAMGRAPH_LLM_ARCHITECT_MODEL"), source: "architect" },
      { value: envText("DREAMGRAPH_LLM_MODEL") ? null : ARCHITECT_PROVIDER_DEFAULT_MODELS[provider] ?? null, source: "provider_default" },
      { value: envText("DREAMGRAPH_LLM_MODEL") ?? base.model ?? defaults.model, source: "general" },
      { value: envText("DREAMGRAPH_LLM_NORMALIZER_MODEL"), source: "normalizer" },
      { value: envText("DREAMGRAPH_LLM_DREAMER_MODEL"), source: "dreamer" },
      { value: defaults.model, source: "provider_default" },
    ];
    const selected = modelCandidates.find((candidate) => candidate.value != null && candidate.value.length > 0) ?? {
      value: "",
      source: "provider_default" as const,
    };

    _architectConfig = {
      component: "architect",
      provider,
      providerSource,
      model: selected.value ?? "",
      modelSource: selected.source,
      baseUrl: envText("DREAMGRAPH_LLM_ARCHITECT_URL") ?? (provider === base.provider ? base.baseUrl : defaults.baseUrl),
      apiKey: process.env.DREAMGRAPH_LLM_ARCHITECT_API_KEY ?? (provider === base.provider ? base.apiKey : defaults.apiKey),
      temperature: envNumber("DREAMGRAPH_LLM_ARCHITECT_TEMPERATURE", base.temperature),
      maxTokens: Math.trunc(envNumber("DREAMGRAPH_LLM_ARCHITECT_MAX_TOKENS", base.maxTokens)),
      timeoutMs: base.timeoutMs,
      reasoningEffort: envText("DREAMGRAPH_LLM_ARCHITECT_REASONING_EFFORT") ?? base.reasoningEffort,
    };
    logger.info(
      `LLM architect config: provider=${_architectConfig.provider} (${_architectConfig.providerSource}), ` +
        `model=${_architectConfig.model || "n/a"} (${_architectConfig.modelSource}), ` +
        `temp=${_architectConfig.temperature}, maxTokens=${_architectConfig.maxTokens}`,
    );
  }
  return _architectConfig;
}

/** Update Architect chat LLM settings at runtime. */
export function updateArchitectLlmConfig(
  partial: Partial<Pick<ArchitectLlmConfig, "provider" | "model" | "baseUrl" | "temperature" | "maxTokens">>,
): ArchitectLlmConfig {
  const current = getArchitectLlmConfig();
  const base = getLlmConfig();
  const provider = partial.provider ?? current.provider;
  const providerChanged = provider !== current.provider;
  const defaults = providerDefaults(provider, base);
  const model = partial.model ?? current.model;

  _architectConfig = {
    ...current,
    provider,
    providerSource: partial.provider != null ? "architect" : current.providerSource,
    model,
    modelSource: partial.model != null ? "architect" : current.modelSource,
    baseUrl: partial.baseUrl ?? (providerChanged ? defaults.baseUrl : current.baseUrl),
    apiKey: providerChanged ? defaults.apiKey : current.apiKey,
    temperature: partial.temperature ?? current.temperature,
    maxTokens: Math.trunc(partial.maxTokens ?? current.maxTokens),
  };
  logger.info(
    `LLM architect config updated: provider=${_architectConfig.provider}, ` +
      `model=${_architectConfig.model || "n/a"}, temp=${_architectConfig.temperature}, ` +
      `maxTokens=${_architectConfig.maxTokens}`,
  );
  return _architectConfig;
}

/** Update dreamer-specific LLM settings at runtime. */
export function updateDreamerLlmConfig(
  partial: Partial<{ model: string; temperature: number; maxTokens: number }>,
): void {
  const current = getDreamerLlmConfig();
  _dreamerConfig = { ...current, ...partial };
  logger.info(
    `LLM dreamer config updated: model=${_dreamerConfig.model}, temp=${_dreamerConfig.temperature}, maxTokens=${_dreamerConfig.maxTokens}`,
  );
}

/** Update normalizer-specific LLM settings at runtime. */
export function updateNormalizerLlmConfig(
  partial: Partial<{ model: string; temperature: number; maxTokens: number }>,
): void {
  const current = getNormalizerLlmConfig();
  _normalizerConfig = { ...current, ...partial };
  logger.info(
    `LLM normalizer config updated: model=${_normalizerConfig.model}, temp=${_normalizerConfig.temperature}, maxTokens=${_normalizerConfig.maxTokens}`,
  );
}

// ---------------------------------------------------------------------------
// Singleton — the active LLM provider
// ---------------------------------------------------------------------------

let _provider: LlmProvider | null = null;
let _samplingProvider: McpSamplingProvider | null = null;
let _config: LlmConfig | null = null;

function createRawLlmProvider(c: LlmConfig): LlmProvider {
  switch (c.provider) {
    case "ollama":
      return new OllamaProvider(c.baseUrl, c.model, c.temperature, c.maxTokens, c.timeoutMs);
    case "openai":
      if (!c.apiKey) {
        logger.warn("LLM: OpenAI provider configured but no API key set (DREAMGRAPH_LLM_API_KEY)");
      }
      return new OpenAiCompatibleProvider(c.baseUrl, c.model, c.apiKey, c.temperature, c.maxTokens, "openai", c.timeoutMs, { api: c.api, reasoningEffort: c.reasoningEffort, store: c.store, capability: c.capability });
    case "lmstudio":
      return new OpenAiCompatibleProvider(c.baseUrl, c.model, c.apiKey, c.temperature, c.maxTokens, "lmstudio", c.timeoutMs, { api: c.api, reasoningEffort: c.reasoningEffort, store: c.store, capability: c.capability });
    case "anthropic":
      if (!c.apiKey) {
        logger.warn("LLM: Anthropic provider configured but no API key set (DREAMGRAPH_LLM_API_KEY)");
      }
      return new AnthropicProvider(c.baseUrl, c.model, c.apiKey, c.temperature, c.maxTokens, c.timeoutMs, { reasoningEffort: c.reasoningEffort, capability: c.capability });
    case "sampling": {
      const provider = new McpSamplingProvider();
      provider.setServer(getSessionContext()?.sampling_server ?? null); return provider;
    }
    default:
      return new NullProvider();
  }
}

/** Each provider binding owns an immutable, physically pinned run allocation. */
function bindLlmProvider(raw: LlmProvider, config: LlmConfig): LlmProvider {
  const runs = new Map<string, ModelExecution>();
  return { name: raw.name, isAvailable: () => raw.isAvailable(), complete: async (messages, options) => {
    const { currentJob } = await import("./job-context.js");
    const role = options?.cognitiveRole ?? config.admissionPolicy?.policy.role ?? "enrichment";
    const effective = { ...config, model: options?.model ?? config.model, api: options?.api ?? config.api,
      reasoningEffort: options?.reasoningEffort ?? config.reasoningEffort, store: options?.store ?? config.store };
    const key = JSON.stringify([sessionNamespace(), currentJob()?.id, role, effective.model, effective.api, effective.reasoningEffort, effective.store, options?.admissionRunId]);
    let run = runs.get(key);
    if (!run) { run = new ModelExecution(effective, role, config.admissionPolicy, options?.admissionRunId); runs.set(key, run); }
    return run.complete(() => raw.complete(messages, options));
  } };
}
export function createLlmProviderForConfig(config: LlmConfig): LlmProvider {
  const copy = Object.freeze({ ...config });
  const raw = createRawLlmProvider(copy);
  return config.provider === "none" ? raw : bindLlmProvider(raw, copy);
}
const nativeRuns = new WeakMap<LlmConfig, ModelExecution>();

/** Initialize the LLM provider based on config. Call once at startup. */
export function initLlmProvider(cfg?: LlmConfig): LlmProvider {
  const c = cfg ?? parseLlmConfig();
  _config = c;

  // Clear per-component caches so they re-parse from the new base config
  // on next access. Without this, a provider change (e.g., ollama→openai)
  // via dashboard would leave stale model/temp values in memory.
  _dreamerConfig = null;
  _normalizerConfig = null;
  _architectConfig = null;

  switch (c.provider) {
    case "ollama":
      _provider = new OllamaProvider(c.baseUrl, c.model, c.temperature, c.maxTokens, c.timeoutMs);
      break;
    case "openai":
      if (!c.apiKey) {
        logger.warn("LLM: OpenAI provider configured but no API key set (DREAMGRAPH_LLM_API_KEY)");
      }
      _provider = new OpenAiCompatibleProvider(c.baseUrl, c.model, c.apiKey, c.temperature, c.maxTokens, "openai", c.timeoutMs, { api: c.api, reasoningEffort: c.reasoningEffort, store: c.store, capability: c.capability });
      break;
    case "lmstudio":
      _provider = new OpenAiCompatibleProvider(c.baseUrl, c.model, c.apiKey, c.temperature, c.maxTokens, "lmstudio", c.timeoutMs, { api: c.api, reasoningEffort: c.reasoningEffort, store: c.store, capability: c.capability });
      break;
    case "anthropic":
      if (!c.apiKey) {
        logger.warn("LLM: Anthropic provider configured but no API key set (DREAMGRAPH_LLM_API_KEY)");
      }
      _provider = new AnthropicProvider(c.baseUrl, c.model, c.apiKey, c.temperature, c.maxTokens, c.timeoutMs, { reasoningEffort: c.reasoningEffort, capability: c.capability });
      break;
    case "sampling":
      _samplingProvider = new McpSamplingProvider();
      _provider = _samplingProvider;
      break;
    default:
      _provider = new NullProvider();
      break;
  }

  if (c.provider !== "none") _provider = bindLlmProvider(_provider!, c);

  logger.info(`LLM provider: ${c.provider} (model: ${c.model || "n/a"})`);
  return _provider;
}

/**
 * Inject the MCP Server reference for the sampling provider.
 * Call this after server.connect() when using provider="sampling".
 */
export function setMcpServerForSampling(server: unknown): void {
  const owner = getSessionContext();
  if (owner) { owner.sampling_server = server; return; }
  if (_samplingProvider) {
    _samplingProvider.setServer(server);
  }
}

/** Get the active LLM provider. Initializes with defaults if not yet set. */
export function getLlmProvider(): LlmProvider {
  if (getSessionContext() && _config?.provider === "sampling") return createLlmProviderForConfig(_config);
  if (!_provider) {
    return initLlmProvider();
  }
  return _provider;
}

/** Get the current LLM config */
export function getLlmConfig(): LlmConfig {
  if (!_config) {
    _config = parseLlmConfig();
  }
  return _config;
}

/** Slice 7 policy port. Provider/job adapters consume this without reinterpreting role settings. */
export async function getRoleModelPolicy(role: ModelRole, session?: RoleSettings): Promise<ResolvedRolePolicy> {
  const { currentJob } = await import("./job-context.js");
  const pinned = currentJob()?.role_policies[role];
  if (pinned) {
    if (session && Object.keys(session).length) throw new Error("JOB_ROLE_OVERRIDE_REQUIRES_NEW_ADMISSION");
    return structuredClone(pinned);
  }
  const profiles = await readRoleProfiles();
  return resolveRolePolicy({ role, env: role === "architect" ? sessionEnvironment() : process.env, legacy: getLlmConfig(), saved: profiles.roles[role], revision: profiles.revision, session });
}

/** Bind one immutable role policy to one provider without changing the shared singleton. */
export async function getRoleLlmProvider(role: ModelRole, session?: RoleSettings): Promise<{ provider: LlmProvider; policy: Readonly<ResolvedRolePolicy>; config: LlmConfig }> {
  const policy = snapshotRolePolicy(await getRoleModelPolicy(role, session));
  if (policy.status !== "configured") throw new Error(`ROLE_POLICY_BLOCKED: ${role}: ${policy.diagnostics.map(value => value.code).join(",")}`);
  if (policy.effective.api === "native_cli") throw new Error(`ROLE_NATIVE_CLI_REQUIRED: ${role} must use its native CLI execution adapter`);
  const config: LlmConfig = { admissionPolicy: policy, provider: policy.policy.provider as LlmProviderType, model: policy.effective.model,
    baseUrl: policy.connection.base_url, apiKey: policy.connection.api_key_env ? process.env[policy.connection.api_key_env] ?? "" : "",
    temperature: policy.requested.temperature, maxTokens: policy.effective.output_tokens, timeoutMs: policy.effective.timeout_ms,
    ...(policy.effective.api === "responses" ? { api: "responses" } : policy.effective.api === "chat_completions" ? { api: "chat-completions" } : {}),
    ...(policy.effective.effort ? { reasoningEffort: policy.effective.effort } : {}),
    ...(policy.effective.retention === "store_false" ? { store: false } : policy.effective.retention === "store_true" ? { store: true } : {}),
    ...(policy.capability ? { capability: policy.capability } : {}) };
  if (!config.apiKey && policy.connection.api_key_env === "DREAMGRAPH_LLM_API_KEY" && policy.origins.api_key_env === "legacy" && getLlmConfig().provider === config.provider) config.apiKey = getLlmConfig().apiKey;
  if (![`${config.provider}-api`, config.provider === "sampling" ? "mcp-sampling" : "none"].includes(policy.effective.adapter)) throw new Error("ROLE_ADAPTER_UNSUPPORTED");
  Object.freeze(config);
  // Keep client-selected sampling attached to its actual session transport.
  const raw = createLlmProviderForConfig(config);
  const provider: LlmProvider = { name: raw.name, isAvailable: () => ["openai", "anthropic"].includes(config.provider) && !config.apiKey ? Promise.resolve(false) : raw.isAvailable(), complete: async (messages, options) => {
    if (["openai", "anthropic"].includes(config.provider) && !config.apiKey) throw new Error("ROLE_CREDENTIAL_REQUIRED");
    if (options?.model && options.model !== config.model || options?.api && options.api !== config.api
      || options?.reasoningEffort && options.reasoningEffort !== config.reasoningEffort || options?.store !== undefined && options.store !== config.store
      || options?.capability && JSON.stringify(options.capability) !== JSON.stringify(config.capability)) throw new Error("ROLE_POLICY_REQUEST_MISMATCH");
    if (policy.effective.strict_schema && !options?.jsonSchema) throw new Error("ROLE_STRICT_SCHEMA_REQUIRED");
    if (policy.effective.strict_schema && options?.schemaFallback) throw new Error("ROLE_SCHEMA_FALLBACK_DISALLOWED");
    try {
    const response = await raw.complete(messages, { ...options, model: config.model, cognitiveRole: role,
      ...(config.api ? { api: config.api } : {}), ...(config.reasoningEffort ? { reasoningEffort: config.reasoningEffort } : {}),
      ...(config.store !== undefined ? { store: config.store } : {}), maxTokens: Math.min(options?.maxTokens ?? config.maxTokens, config.maxTokens) });
    recordRoleQualification(role, policy.fingerprint); return response;
    } catch (failure) { revokeRoleQualification(role, policy.fingerprint); throw failure; }
  } };
  return { provider, policy, config };
}

function taskDefaultTemperature(task: LlmRouteTask): number {
  switch (task) {
    case "normalization":
      return 0.1;
    case "task_preamble_compilation":
      return 0.2;
    case "remediation_drafting":
      return 0.3;
    case "graph_enrichment":
      return 0.4;
    case "dream_generation":
      return 0.7;
    default:
      return getDreamerLlmConfig().temperature;
  }
}

function componentConfig(component: "dreamer" | "normalizer"): CognitiveLlmConfig {
  return component === "normalizer" ? getNormalizerLlmConfig() : getDreamerLlmConfig();
}

function fallbackSelection(
  request: LlmRouteRequest,
  fallbackReason: LlmRouteFallbackReason,
): LlmRouteSelection {
  return {
    layer: "deterministic_fallback",
    provider: null,
    model: null,
    options: {},
    provenance: {
      task: request.task,
      layer: "deterministic_fallback",
      provider: null,
      model: null,
      source: "deterministic_fallback",
      fallback_reason: fallbackReason,
    },
  };
}

/**
 * Select the ADR-203 model route for an LLM-enabled tool.
 *
 * Order is connected/caller model, daemon-side configured model, then deterministic fallback.
 * The returned provenance is intentionally compact and never includes prompt content or secrets.
 */
export async function selectLlmRoute(request: LlmRouteRequest): Promise<LlmRouteSelection> {
  const maxTokens = request.max_tokens;

  if (request.connected) {
    const available = await request.connected.provider.isAvailable().catch(() => false);
    if (available) {
      const connectedModel = request.connected.model?.trim();
      const model = connectedModel || request.connected.provider.name;
      return {
        layer: "connected",
        provider: request.connected.provider,
        model,
        options: { model, maxTokens },
        provenance: {
          task: request.task,
          layer: "connected",
          provider: request.connected.provider.name,
          model,
          source: request.connected.source,
        },
      };
    }
  }

  const role: ModelRole = request.task === "graph_enrichment" ? "enrichment" : request.daemon_component ?? (request.task === "normalization" ? "normalizer" : "dreamer");
  let bound: Awaited<ReturnType<typeof getRoleLlmProvider>>;
  try { bound = await getRoleLlmProvider(role); }
  catch (failure) { logger.warn("LLM role route blocked: " + (failure instanceof Error ? failure.message : "invalid configuration")); return fallbackSelection(request, "role_policy_blocked"); }
  const { provider, config: cfg, policy } = bound;
  if (cfg.provider === "none") return fallbackSelection(request, request.connected ? "connected_model_unavailable" : "no_connected_model");
  if (!cfg.model.trim()) return fallbackSelection(request, "no_daemon_model");
  if (!await provider.isAvailable().catch(() => false)) return fallbackSelection(request, "daemon_model_unavailable");
  const temperature = request.daemon_temperature ?? cfg.temperature;
  const temperatureOptions = policy.effective.temperature !== null ? { temperature } : {};
  const sampling = cfg.provider === "sampling";
  return { layer: sampling ? "connected" : "daemon", provider, model: sampling ? "client" : cfg.model,
    options: { model: cfg.model, ...temperatureOptions, cognitiveRole: role, ...(cfg.api ? { api: cfg.api } : {}),
      ...(cfg.reasoningEffort ? { reasoningEffort: cfg.reasoningEffort } : {}), ...(cfg.store !== undefined ? { store: cfg.store } : {}), maxTokens: Math.min(maxTokens ?? cfg.maxTokens, cfg.maxTokens) },
    provenance: { task: request.task, layer: sampling ? "connected" : "daemon", provider: provider.name, model: sampling ? "client" : cfg.model, source: sampling ? "sampling" : "daemon",
      ...temperatureOptions, cognitive_role: role, role_policy_fingerprint: policy.fingerprint, role_policy_revision: policy.policy.revision,
      ...(policy.effective.temperature === null ? { temperature_omitted: policy.temperature_control.reason } : {}) } };

}

/** Normalize an LLM route failure into compact fallback provenance. */
export function llmRouteFailureReason(kind: "provider" | "invalid_output" | "validation"): LlmRouteFallbackReason {
  switch (kind) {
    case "provider":
      return "provider_failed";
    case "invalid_output":
      return "invalid_output";
    case "validation":
      return "validation_failed";
  }
}

/** Check if LLM dreaming is available */
export async function isLlmAvailable(): Promise<boolean> {
  const provider = getLlmProvider();
  return provider.isAvailable();
}
