/** Named API evidence. Native CLI identifiers and future/custom models do not inherit it. */
import { z } from "zod";
export const PROVIDER_CAPABILITY_VERSION = "2026-09-30.r3";
export const ProviderCapabilitySchema = z.object({
  provider: z.enum(["openai", "anthropic", "lmstudio", "ollama"]), model: z.string().min(1),
  version: z.string().min(1), source: z.string().min(1),
  apis: z.array(z.enum(["responses", "chat-completions", "anthropic-messages", "ollama-chat"])).min(1),
  default_api: z.enum(["responses", "chat-completions", "anthropic-messages", "ollama-chat"]),
  efforts: z.array(z.string()), strict_schema: z.boolean(),
  tools: z.boolean(), images: z.boolean(),
  tool_api_efforts: z.record(z.array(z.string()).nullable()).optional(),
}).strict();
export type ProviderCapability = z.infer<typeof ProviderCapabilitySchema>;
const openaiSource = "https://developers.openai.com/api/docs/guides/latest-model";
const anthropicSource = "https://platform.claude.com/docs/en/build-with-claude/structured-outputs";
const records = new Map<string, ProviderCapability>();
const add = (provider: "openai" | "anthropic", models: string[], values: Omit<ProviderCapability, "provider" | "model" | "version" | "source">) => {
  for (const model of models) records.set(`${provider}:${model}`, { provider, model, version: PROVIDER_CAPABILITY_VERSION,
    source: provider === "openai" ? openaiSource : anthropicSource, ...values });
};
add("openai", ["gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "gpt-4o", "gpt-4o-mini"], {
  apis: ["responses", "chat-completions"], default_api: "chat-completions", efforts: [], strict_schema: true, tools: true, images: true });
add("openai", ["gpt-5", "gpt-5-mini", "gpt-5-nano"], {
  apis: ["responses", "chat-completions"], default_api: "chat-completions", efforts: ["minimal", "low", "medium", "high"], strict_schema: true, tools: true, images: true });
add("openai", ["gpt-5-pro"], {
  apis: ["responses"], default_api: "responses", efforts: ["high"], strict_schema: true, tools: true, images: true });
add("openai", ["o1", "o3", "o4-mini"], {
  apis: ["responses", "chat-completions"], default_api: "chat-completions", efforts: ["low", "medium", "high"], strict_schema: true, tools: true, images: true });
add("openai", ["o3-mini"], {
  apis: ["responses", "chat-completions"], default_api: "chat-completions", efforts: ["low", "medium", "high"], strict_schema: true, tools: true, images: false });
add("openai", ["gpt-5.1"], {
  apis: ["responses", "chat-completions"], default_api: "chat-completions", efforts: ["none", "low", "medium", "high"], strict_schema: true, tools: true, images: true });
add("openai", ["gpt-5.2", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano"], {
  apis: ["responses", "chat-completions"], default_api: "chat-completions", efforts: ["none", "low", "medium", "high", "xhigh"], strict_schema: true, tools: true, images: true });
add("openai", ["gpt-5.5"], {
  apis: ["responses", "chat-completions"], default_api: "responses", efforts: ["none", "low", "medium", "high", "xhigh"], strict_schema: true, tools: true, images: true });
add("openai", ["gpt-5.6", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-6-sol", "gpt-6-luna"], {
  apis: ["responses", "chat-completions"], default_api: "responses", efforts: ["none", "low", "medium", "high", "xhigh", "max"], strict_schema: true, tools: true, images: true });
add("openai", ["gpt-6-astra", "gpt-6.1-sol"], {
  apis: ["responses", "chat-completions"], default_api: "responses", efforts: ["low", "medium", "high", "xhigh", "max"], strict_schema: true, tools: true, images: true, tool_api_efforts: { responses: null } });
for (const model of ["gpt-6-sol", "gpt-6-luna"]) records.get(`openai:${model}`)!.tool_api_efforts = { responses: null, "chat-completions": ["none"] };
add("anthropic", ["claude-opus-4-5", "claude-opus-4-6", "claude-sonnet-4-6"], {
  apis: ["anthropic-messages"], default_api: "anthropic-messages", efforts: ["low", "medium", "high", "max"], strict_schema: true, tools: true, images: true });
add("anthropic", ["claude-sonnet-4-5", "claude-haiku-4-5"], {
  apis: ["anthropic-messages"], default_api: "anthropic-messages", efforts: [], strict_schema: true, tools: true, images: true });
add("anthropic", ["claude-opus-4-7", "claude-opus-4-8", "claude-opus-5", "claude-opus-5-5", "claude-sonnet-5", "claude-sonnet-5-5", "claude-fable-5", "claude-fable-5-1", "claude-mythos-5", "claude-mythos-5-1"], {
  apis: ["anthropic-messages"], default_api: "anthropic-messages", efforts: ["low", "medium", "high", "xhigh", "max"], strict_schema: true, tools: true, images: true });
add("anthropic", ["claude-mythos-preview"], {
  apis: ["anthropic-messages"], default_api: "anthropic-messages", efforts: ["low", "medium", "high", "max"], strict_schema: true, tools: true, images: true });

const snapshots: Record<string, string> = {
  "gpt-4.1-2025-04-14": "gpt-4.1",
  "gpt-4.1-mini-2025-04-14": "gpt-4.1-mini",
  "gpt-4.1-nano-2025-04-14": "gpt-4.1-nano",
  "gpt-4o-2024-08-06": "gpt-4o",
  "gpt-4o-2024-11-20": "gpt-4o",
  "gpt-4o-mini-2024-07-18": "gpt-4o-mini",
  "gpt-5-2025-08-07": "gpt-5",
  "gpt-5-mini-2025-08-07": "gpt-5-mini",
  "gpt-5-nano-2025-08-07": "gpt-5-nano",
  "gpt-5-pro-2025-10-06": "gpt-5-pro",
  "gpt-5.1-2025-11-13": "gpt-5.1",
  "gpt-5.2-2025-12-11": "gpt-5.2",
  "gpt-5.4-2026-03-05": "gpt-5.4",
  "gpt-5.4-mini-2026-03-17": "gpt-5.4-mini",
  "gpt-5.4-nano-2026-03-17": "gpt-5.4-nano",
  "gpt-5.5-2026-04-23": "gpt-5.5"
};

/** Generate consumer artifacts from core-owned evidence, including qualified snapshots. */
export function providerCapabilityRecords(): ProviderCapability[] {
  const values = [...records.values()].map(value => structuredClone(value));
  for (const [model, family] of Object.entries(snapshots)) {
    const value = records.get(`openai:${family}`);
    if (value) values.push({ ...structuredClone(value), model });
  }
  return values.sort((a, b) => `${a.provider}:${a.model}`.localeCompare(`${b.provider}:${b.model}`));
}

/** An override is explicit, source/version named, and bound to exactly one provider/model. */
export function providerCapability(provider: string, model: string, override?: ProviderCapability): ProviderCapability | null {
  if (override) {
    const qualified = ProviderCapabilitySchema.parse(override);
    if (qualified.provider !== provider || qualified.model !== model || !qualified.apis.includes(qualified.default_api)) throw new Error("PROVIDER_CAPABILITY_MISMATCH");
    return structuredClone(qualified);
  }
  // Only source-verified snapshots inherit a record; an invented date is unqualified.
  const id = snapshots[model.toLowerCase()] ?? model.toLowerCase();
  const value = records.get(`${provider}:${id}`);
  return value ? { ...structuredClone(value), model } : null;
}
export function assertProviderRequest(provider: string, model: string, api: string, effort?: string, schemaRequired = false, tools = false, override?: ProviderCapability): ProviderCapability | null {
  const evidence = providerCapability(provider, model, override);
  if (evidence && !evidence.apis.includes(api as ProviderCapability["default_api"])) throw new Error("PROVIDER_API_UNSUPPORTED");
  if (effort && !evidence?.efforts.includes(effort)) throw new Error(`REASONING_EFFORT_UNSUPPORTED: ${provider}/${model}/${effort}`);
  if (schemaRequired && !evidence?.strict_schema) throw new Error(`STRICT_SCHEMA_CAPABILITY_REQUIRED: ${provider}/${model}`);
  if (tools && evidence && !evidence.tools) throw new Error("PROVIDER_TOOLS_UNSUPPORTED");
  if (tools && evidence?.tool_api_efforts && (!(api in evidence.tool_api_efforts) || evidence.tool_api_efforts[api] !== null && !evidence.tool_api_efforts[api].includes(effort ?? "provider_default"))) throw new Error("TOOLS_REQUIRE_RESPONSES: preserve reasoning or explicitly select supported non-reasoning mode");
  return evidence;
}
