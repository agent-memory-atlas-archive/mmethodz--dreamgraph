/** The native CLI bridge independently refuses required prompts above this transport bound. */
export const NATIVE_CLI_PROMPT_MAX_BYTES = 128 * 1024;
/** Conservative model admission framing allocation; wire bytes are not measured tokens. */
export const MODEL_REQUEST_FRAMING_RESERVE_BYTES = 2048;
/** Default only: explicit role, global, session and saved allocations retain authority. */
export const NATIVE_CLI_DEFAULT_CONTEXT_ALLOCATION = NATIVE_CLI_PROMPT_MAX_BYTES + MODEL_REQUEST_FRAMING_RESERVE_BYTES;
/**
 * Default context allocation (UTF-8 wire bytes, which over-count tokens) for hosted OpenAI/Anthropic APIs when no
 * context size is configured. 512 KiB stays below the context window of every listed tool-capable hosted model at
 * realistic byte/token ratios; the provider itself rejects (unbilled) anything larger. Local servers (Ollama,
 * LM Studio) keep the small default because they may silently truncate instead of rejecting.
 */
export const HOSTED_API_DEFAULT_CONTEXT_ALLOCATION = 512 * 1024;
/** Fallback allocation for local providers and roles without a hosted API. */
export const LOCAL_DEFAULT_CONTEXT_ALLOCATION = 32768;
/**
 * Default per-pass resource ceilings for the Architect on a hosted API. One native tool-loop pass resends the
 * growing conversation on every iteration, so the generic role defaults (250k input / 100k output and
 * reasoning) end a pass after two or three requests. Money stays governed by the mandatory run/day amounts.
 */
export const ARCHITECT_API_DEFAULT_BUDGET = { input_tokens: 8 * HOSTED_API_DEFAULT_CONTEXT_ALLOCATION, output_tokens: 262_144, reasoning_tokens: 262_144 } as const;
/**
 * Whole Architect pass (CLI process or native tool loop) wall-clock bounds.
 * A pass is an agent run with many tool calls, not one model request, so it
 * must not inherit the per-request model timeout.
 */
export const ARCHITECT_PASS_MIN_MS = 60_000;
export const ARCHITECT_PASS_MAX_MS = 4 * 60 * 60 * 1000;
export const ARCHITECT_PASS_DEFAULT_MS = 30 * 60 * 1000;
export function architectPassTimeoutMs(env: Record<string, string | undefined> = process.env): number {
  const raw = env.DREAMGRAPH_ARCHITECT_PASS_TIMEOUT_MS?.trim();
  const value = raw ? Number(raw) : NaN;
  if (!Number.isFinite(value) || value <= 0) return ARCHITECT_PASS_DEFAULT_MS;
  return Math.trunc(Math.min(ARCHITECT_PASS_MAX_MS, Math.max(ARCHITECT_PASS_MIN_MS, value)));
}
/** An execution with no activity (worker calls, CLI output) for this long is stale/dead. */
export const ARCHITECT_PASS_IDLE_DEFAULT_MS = 15 * 60 * 1000;
export function architectPassIdleMs(env: Record<string, string | undefined> = process.env): number {
  const raw = env.DREAMGRAPH_ARCHITECT_PASS_IDLE_MS?.trim();
  const value = raw ? Number(raw) : NaN;
  if (!Number.isFinite(value) || value <= 0) return ARCHITECT_PASS_IDLE_DEFAULT_MS;
  return Math.trunc(Math.min(ARCHITECT_PASS_MAX_MS, Math.max(ARCHITECT_PASS_MIN_MS, value)));
}
