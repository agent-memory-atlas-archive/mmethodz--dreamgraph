/** Shared UI/dispatch effort policy. CLI defaults remain the official CLI's defaults.
 * Sources: https://code.claude.com/docs/en/model-config and /cli-reference (2026-10-08).
 * API capabilities are separately owned by provider-capabilities.ts.
 */
import { providerCapability, providerCapabilityRecords } from "./provider-capabilities.js";
export const CODEX_CLI_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
const claudeAll = ["low", "medium", "high", "xhigh", "max"];
const claudeModels = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1", "claude-fable-5", "claude-mythos-5-1", "claude-mythos-5", "claude-opus-5", "claude-sonnet-5", "claude-opus-4-8", "claude-opus-4-7"];
export function cliModelEfforts(adapter: string, model: string): string[] {
  if (adapter === "codex-cli") return [...CODEX_CLI_EFFORTS];
  if (adapter !== "claude-cli") return [];
  if (claudeModels.includes(model)) return [...claudeAll];
  if (["claude-opus-4-6", "claude-sonnet-4-6", "claude-mythos-preview"].includes(model)) return ["low", "medium", "high", "max"];
  return [];
}
export function routeEfforts(adapter: string, provider: string, model: string): string[] {
  return adapter.endsWith("-cli") ? cliModelEfforts(adapter, model)
    : adapter === "deterministic_fallback" ? [] : providerCapability(provider, model)?.efforts ?? [];
}
export function assertRouteEffort(adapter: string, provider: string, model: string, effort?: string | null): void {
  if (effort && !routeEfforts(adapter, provider, model).includes(effort))
    throw new Error("REASONING_EFFORT_UNSUPPORTED: " + adapter + "/" + model + "/" + effort);
}
/** Serializable evidence, used in both browser surfaces; no browser-side guessed model families. */
export function architectEffortChoices() {
  const table: Record<string, Record<string, string[]>> = { "codex-cli": { "*": [...CODEX_CLI_EFFORTS] }, "claude-cli": {}, "copilot-cli": {} };
  for (const record of providerCapabilityRecords()) {
    (table[record.provider] ??= {})[record.model] = record.efforts;
    if (record.provider === "anthropic") table["claude-cli"][record.model] = cliModelEfforts("claude-cli", record.model);
  }
  for (const model of claudeModels) table["claude-cli"][model] = cliModelEfforts("claude-cli", model);
  return table;
}
export function architectModelChoices(): Record<string, string[]> {
  return {
    anthropic: [...claudeModels, "claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"],
    openai: ["gpt-6.1-sol", "gpt-6-astra", "gpt-6-sol", "gpt-6-luna", "gpt-5.6", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-5", "gpt-5.4", "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "gpt-4o-mini", "o3", "o4-mini"],
    ollama: ["qwen3:8b", "llama3.1", "mistral", "codellama"], lmstudio: ["local-model"], sampling: ["client"], none: [""],
    "claude-cli": ["claude-sonnet-5", ...claudeModels.filter(model => model !== "claude-sonnet-5"), "claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"],
    "copilot-cli": ["claude-opus-4.7", "claude-opus-4.6", "gpt-5.5", "gpt-5.4", "gpt-4o", "claude-sonnet-4.6", "auto"],
    "codex-cli": ["gpt-6.1-sol", "gpt-6-astra", "gpt-6-sol", "gpt-6-luna", "gpt-5.6", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-5.4", "gpt-5.3-codex", "gpt-5.2-codex", "gpt-5.2", "gpt-5-mini", "auto"],
  };
}
