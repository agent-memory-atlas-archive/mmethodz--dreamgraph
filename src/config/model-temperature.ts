/** Request-level sampling compatibility. Unknown models never inherit an assumed capability. */
export interface TemperatureCapability {
  support: "supported" | "unsupported" | "unknown";
  reason: string;
  source: string;
}
const OPENAI = "https://developers.openai.com/api/docs/guides/latest-model";
const ANTHROPIC = "https://platform.claude.com/docs/en/about-claude/model-deprecations";
/** Never replace an unsupported requested effort with a more expensive one. */
export function assertReasoningEffort(provider: string, model: string, effort?: string | null): void {
  if (provider !== "openai" || !effort) return;
  const id = model.trim().toLowerCase();
  if (effort === "none" && /^(?:gpt-6-astra|gpt-6\.1-sol|gpt-5(?:-mini|-nano|-pro)?|gpt-5\.[124]-pro|o[134](?:-mini|-pro)?)(?:$|[-_])/.test(id)) {
    throw new Error(`REASONING_EFFORT_UNSUPPORTED: ${model} does not support none. Select a supported effort explicitly; no automatic escalation.`);
  }
}
export function modelTemperatureCapability(provider: string, model: string, effort?: string | null, adapter?: string): TemperatureCapability {
  const id = model.trim().toLowerCase();
  if (adapter?.endsWith("-cli")) return { support: "unsupported", reason: "Native CLI adapters do not expose an API temperature control.", source: "native_cli_contract" };
  if (provider === "ollama" || provider === "lmstudio") return { support: "supported", reason: "Local completion adapter accepts sampling temperature.", source: `${provider}_adapter` };
  if (provider === "openai") {
    if (/^gpt-(?:4\.1(?:-(?:mini|nano))?|4o(?:-mini)?|4(?:-turbo)?|3\.5-turbo)(?:-\d{4}-\d{2}-\d{2})?$/.test(id)) return { support: "supported", reason: "This non-reasoning model accepts temperature.", source: OPENAI };
    if (/^(?:gpt-6-astra|gpt-6\.1-sol)(?:$|[-_])/.test(id)) return { support: "unsupported", reason: "This model requires reasoning; temperature is unsupported with reasoning enabled.", source: `${OPENAI}#gpt-6-astra-update-api-and-model-parameters` };
    // Only named, documented generations are qualified. A future/custom ID is not matched by a >= version heuristic.
    if (/^gpt-5\.[56](?:$|[-_])/.test(id)) return { support: effort === "none" ? "unknown" : "unsupported", reason: "Omit sampling while preserving configured reasoning. Explicit none does not by itself qualify sampling support for this model generation.", source: `${OPENAI}?model=${id.match(/^gpt-5\.\d/)?.[0]}` };
    if (/^(?:gpt-5\.[124]|gpt-6(?:-sol|-luna)?)(?:$|[-_])/.test(id) && !/(?:-pro|-codex)(?:$|[-_])/.test(id)) return {
      support: effort === "none" ? "supported" : "unsupported",
      reason: effort === "none" ? "Temperature is compatible with explicit reasoning effort none." : "Temperature is omitted unless reasoning effort is explicitly none; configured/provider-default reasoning is preserved.",
      source: id.startsWith("gpt-6") ? `${OPENAI}#gpt-6-astra-update-api-and-model-parameters` : `${OPENAI}?model=${id.match(/^gpt-5\.\d/)?.[0]}`,
    };
    if (/^(?:gpt-5(?:-mini|-nano|-pro)?|gpt-5\.[12345]-codex|gpt-5\.[124]-pro|o[134](?:-mini|-pro)?)(?:$|[-_])/.test(id)) return { support: "unsupported", reason: "This reasoning model does not expose sampling temperature.", source: `${OPENAI}?model=gpt-5.4` };
  }
  if (provider === "anthropic") {
    if (/^claude-(?:(?:opus|sonnet|haiku)-4-[78]|(?:opus|sonnet|fable|mythos)-5)(?:$|[-_])/.test(id) || id === "claude-mythos-preview") return { support: "unsupported", reason: "Sampling parameters are deprecated; non-default temperature can return a 400 error.", source: ANTHROPIC };
    if (/^claude-(?:(?:opus|sonnet|haiku)-4(?:-[156])?|3(?:-[57])?-(?:opus|sonnet|haiku))(?:$|[-_])/.test(id)) return { support: "supported", reason: "This legacy Messages model accepts temperature when thinking is disabled.", source: ANTHROPIC };
  }
  return { support: "unknown", reason: "Temperature support is unqualified for this provider/model. Omit it without changing model, reasoning or cognitive role.", source: "unqualified_model" };
}
