/** The native CLI bridge independently refuses required prompts above this transport bound. */
export const NATIVE_CLI_PROMPT_MAX_BYTES = 128 * 1024;
/** Conservative model admission framing allocation; wire bytes are not measured tokens. */
export const MODEL_REQUEST_FRAMING_RESERVE_BYTES = 2048;
/** Default only: explicit role, global, session and saved allocations retain authority. */
export const NATIVE_CLI_DEFAULT_CONTEXT_ALLOCATION = NATIVE_CLI_PROMPT_MAX_BYTES + MODEL_REQUEST_FRAMING_RESERVE_BYTES;
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
