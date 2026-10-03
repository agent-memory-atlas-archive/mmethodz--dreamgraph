/** Provider replies are evidence of an attempt, not automatically usable completions. */
import { Ajv } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import { Ajv2019 } from "ajv/dist/2019.js";
import addFormats from "ajv-formats";
import type { LlmCompletionOptions, TokenUsage } from "./llm.js";

export type ProviderOutcomeCode = "PROVIDER_REFUSAL" | "PROVIDER_INCOMPLETE" | "PROVIDER_FAILED" | "PROVIDER_OUTPUT_INVALID" | "OUTPUT_SCHEMA_INVALID" | "TOOL_ARGUMENTS_INVALID";
export class ProviderOutcomeError extends Error {
  constructor(readonly code: ProviderOutcomeCode, readonly provider: string, readonly model: string,
    readonly stopReason: string | null, readonly usage?: TokenUsage) {
    super(`${code}: ${provider}/${model}${stopReason ? ` (${stopReason})` : ""}`);
    this.name = "ProviderOutcomeError";
  }
}
const record = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
const count = (value: unknown): number | undefined => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

/** Missing usage remains unknown. Cache/reasoning tokens are components, never added twice. */
export function providerUsage(provider: string, value: unknown): TokenUsage | undefined {
  const raw = record(value), usage: TokenUsage = {};
  if (provider === "anthropic") {
    const uncached = count(raw.input_tokens), cached = count(raw.cache_read_input_tokens), created = count(raw.cache_creation_input_tokens);
    if (uncached !== undefined) usage.inputTokens = uncached + (cached ?? 0) + (created ?? 0);
    if (cached !== undefined) usage.cachedInputTokens = cached;
    if (created !== undefined) usage.cacheCreationInputTokens = created;
    usage.outputTokens = count(raw.output_tokens);
  } else if (provider === "ollama") {
    usage.inputTokens = count(raw.prompt_eval_count); usage.outputTokens = count(raw.eval_count);
  } else {
    usage.inputTokens = count(raw.input_tokens ?? raw.prompt_tokens);
    usage.outputTokens = count(raw.output_tokens ?? raw.completion_tokens);
    usage.totalTokens = count(raw.total_tokens);
    usage.cachedInputTokens = count(record(raw.input_tokens_details ?? raw.prompt_tokens_details).cached_tokens);
    usage.reasoningTokens = count(record(raw.output_tokens_details ?? raw.completion_tokens_details).reasoning_tokens);
  }
  for (const key of Object.keys(usage) as Array<keyof TokenUsage>) if (usage[key] === undefined) delete usage[key];
  return Object.keys(usage).length ? usage : undefined;
}

export function assertProviderOutcome(provider: string, model: string, value: unknown, usage?: TokenUsage): void {
  const data = record(value), choice = record(data.choices?.[0]);
  const invalid = () => { throw new ProviderOutcomeError("PROVIDER_OUTPUT_INVALID", provider, model, "invalid_envelope", usage); };
  if (!value || typeof value !== "object" || Array.isArray(value) || data.output !== undefined && !Array.isArray(data.output)
    || data.choices !== undefined && !Array.isArray(data.choices) || data.content !== undefined && !Array.isArray(data.content)) invalid();
  for (const item of [...(data.output ?? []), ...(data.content ?? []), ...(data.choices ?? [])]) {
    if (!item || typeof item !== "object" || Array.isArray(item)) invalid();
    if (item.content !== undefined && !Array.isArray(item.content)) invalid();
    if (Array.isArray(item.content) && item.content.some((part: unknown) => !part || typeof part !== "object" || Array.isArray(part))) invalid();
  }
  const message = record(choice.message);
  if (message.tool_calls !== undefined && !Array.isArray(message.tool_calls)) invalid();
  if (message.tool_calls?.some((tool: any) => !tool || typeof tool.id !== "string" || typeof tool.function?.name !== "string" || typeof tool.function?.arguments !== "string")) invalid();
  const reason = data.status ?? data.stop_reason ?? choice.finish_reason ?? data.done_reason ?? null;
  const refusal = Boolean(message.refusal) || (data.content ?? []).some((item: any) => item.type === "refusal") || (data.output ?? []).some((item: any) =>
    record(item).type === "refusal" || (record(item).content ?? []).some((part: any) => record(part).type === "refusal"));
  if (refusal || reason === "refusal" || reason === "content_filter") throw new ProviderOutcomeError("PROVIDER_REFUSAL", provider, model, reason, usage);
  if (["incomplete", "length", "max_tokens", "maxTokens", "model_context_window_exceeded", "pause_turn", "in_progress", "queued", "cancelled"].includes(reason)) {
    throw new ProviderOutcomeError("PROVIDER_INCOMPLETE", provider, model, reason, usage);
  }
  if (reason === "failed" || data.error) throw new ProviderOutcomeError("PROVIDER_FAILED", provider, model, reason, usage);
  if (reason !== null && !["completed", "stop", "tool_calls", "function_call", "end_turn", "tool_use", "stop_sequence", "endTurn", "stopSequence", "eos"].includes(reason)) invalid();
  if ((data.output ?? []).some((item: any) => record(item).status && record(item).status !== "completed")) {
    throw new ProviderOutcomeError("PROVIDER_INCOMPLETE", provider, model, "output_item_incomplete", usage);
  }
}

/** These adapters advertise client function tools only. Never drop an unmapped native action and report a final reply. */
export function assertClientFunctionOutput(provider:string,model:string,blocks:unknown[],format:"responses"|"anthropic",usage?:TokenUsage):void {
  const allowed=format==="responses"?new Set(["message","function_call","reasoning","compaction"]):new Set(["text","tool_use","thinking","redacted_thinking"]);
  const invalid=(reason:string):never=>{throw new ProviderOutcomeError("PROVIDER_OUTPUT_INVALID",provider,model,reason,usage);};
  for(const raw of blocks){
    const block=record(raw);if(typeof block.type!=="string"||!allowed.has(block.type))invalid("unmapped_tool_output");
    if(block.type==="function_call"&&(typeof block.call_id!=="string"||!block.call_id||typeof block.name!=="string"||!block.name||typeof block.arguments!=="string"))invalid("incomplete_function_call");
    if(block.type==="tool_use"&&(typeof block.id!=="string"||!block.id||typeof block.name!=="string"||!block.name||!block.input||typeof block.input!=="object"||Array.isArray(block.input)))invalid("incomplete_function_call");
    if(block.type==="text"&&typeof block.text!=="string")invalid("incomplete_text_block");
    if(block.type==="message"){
      if(!Array.isArray(block.content))invalid("incomplete_message_block");
      for(const part of block.content)if(!["output_text","text"].includes(part?.type)||typeof part.text!=="string")invalid("unmapped_message_output");
    }
  }
}

/** Compile before sending a request. Unsupported/invalid schemas never spend provider tokens. */
export function compileOutputValidator(schema: Record<string, unknown>): (value: unknown) => boolean {
  try {
    if (Buffer.byteLength(JSON.stringify(schema)) > 256 * 1024) throw new Error("schema too large");
    const draft = String(schema.$schema ?? "");
    const settings = { strictSchema: true, strictTypes: false, strictTuples: false, allowUnionTypes: true };
    const validator = draft.includes("2020-12") ? new Ajv2020(settings)
      : draft.includes("2019-09") ? new Ajv2019(settings) : new Ajv(settings);
    addFormats.default(validator);
    const validate = validator.compile(schema);
    return value => Boolean(validate(value));
  } catch { throw new ProviderOutcomeError("OUTPUT_SCHEMA_INVALID", "local_validation", "none", null); }
}
export function validateCompletionText(text: string, options: LlmCompletionOptions | undefined, provider: string, model: string, usage?: TokenUsage): void {
  if (!options?.jsonSchema && !options?.jsonMode) return;
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new ProviderOutcomeError("PROVIDER_OUTPUT_INVALID", provider, model, "invalid_json", usage); }
  if (options.jsonSchema && !compileOutputValidator(options.jsonSchema.schema)(parsed)) throw new ProviderOutcomeError("PROVIDER_OUTPUT_INVALID", provider, model, "schema_mismatch", usage);
}
/** One shared signal covers all attempts, including a permitted schema fallback. */
export function completionSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  signal?.throwIfAborted();
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/** Claude's grammar subset omits numeric/length limits; original AJV validation retains them. */
export function anthropicOutputSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const unsupported = new Set(["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "minItems", "maxItems"]);
  const visit = (value: unknown, schemaNode = true): any => {
    if (Array.isArray(value)) return value.map(item => visit(item, schemaNode));
    if (!value || typeof value !== "object") return value;
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (schemaNode && unsupported.has(key)) continue;
      output[key] = key === "properties" || key === "$defs" || key === "definitions"
        ? Object.fromEntries(Object.entries(record(item)).map(([name, child]) => [name, visit(child)]))
        : ["items", "anyOf", "allOf", "oneOf", "not", "additionalProperties", "if", "then", "else"].includes(key) ? visit(item) : structuredClone(item);
    }
    return output;
  };
  return visit(schema);
}
