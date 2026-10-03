/** Readiness is configuration, reachability and observed successful role work.
 * No scheduled completion is sent merely to test a provider. Qualification is
 * fingerprint-bound and disappears on failure/restart until real work succeeds. */

import { createHash } from "node:crypto";
import { logger } from "../utils/logger.js";
import { getRoleLlmProvider } from "./llm.js";
import { roleQualification } from "./role-qualification.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LlmReadinessState = "unknown" | "not_ready" | "ready";

export type LlmReadinessReason =
  | "missing_base_model"
  | "missing_dreamer_model"
  | "missing_normalizer_model"
  | "completion_failed"
  | "role_policy_blocked"
  | "provider_unavailable"
  | "completion_unqualified"
  | "ok";

export interface LlmReadinessEffectiveConfig {
  provider: string;
  base_url: string;
  base_model: string;
  dreamer_model: string;
  normalizer_model: string;
  roles?: Array<{ role: string; provider: string; model: string; fingerprint: string; qualified_at: string | null; available: boolean }>;
}

export interface LlmReadinessStatus {
  state: LlmReadinessState;
  /** sha256 over provider+url+dreamer_model+normalizer_model. */
  fingerprint: string | null;
  /** Snapshot of resolved models — useful for dashboards. */
  effective: LlmReadinessEffectiveConfig | null;
  /** Last machine-readable reason. */
  reason: LlmReadinessReason;
  /** Last human-readable error (provider message), if any. */
  last_error: string | null;
  last_check_at: string | null;
  /** ISO timestamp of the last state CHANGE (not every probe). */
  transitioned_at: string | null;
  /** Consecutive failed probes since the last successful one. */
  consecutive_failures: number;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let _status: LlmReadinessStatus | null = null;
let _timer: NodeJS.Timeout | null = null;
let _inFlight = false;

/**
 * Subscribers fired on every transition INTO the `ready` state OR while
 * already ready when the fingerprint changes. They receive both the new and
 * previous status so they can decide between "first-time bootstrap" and
 * "config change while populated". Errors thrown by subscribers are caught
 * and logged so one bad subscriber can't stall the watcher.
 */
export type ReadyTransitionHandler = (
  current: LlmReadinessStatus,
  previous: LlmReadinessStatus | null,
) => void | Promise<void>;

const _readySubscribers: ReadyTransitionHandler[] = [];

const DEFAULT_INTERVAL_MS = 30_000;
const MIN_INTERVAL_MS = 5_000;


// ---------------------------------------------------------------------------
// Fingerprint
// ---------------------------------------------------------------------------

export function computeLlmFingerprint(cfg: LlmReadinessEffectiveConfig): string {
  const material = JSON.stringify([cfg.provider, cfg.base_url, cfg.dreamer_model, cfg.normalizer_model, cfg.roles?.map(value => value.fingerprint)]);
  return createHash("sha256").update(material).digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// Probe
// ---------------------------------------------------------------------------

/**
 * Run one readiness probe. Pure-ish: mutates the singleton status and logs
 * transitions, but does not fire any side effects (events, bootstrap chain).
 * Returns the resulting status.
 */
export async function probeLlmReadiness(): Promise<LlmReadinessStatus> {
  const now = new Date().toISOString(), previous = _status;
  let effective: LlmReadinessEffectiveConfig = { provider: "independent_roles", base_url: "", base_model: "role_policy", dreamer_model: "", normalizer_model: "", roles: [] };
  let reason: LlmReadinessReason = "ok", lastError: string | null = null;
  let state: LlmReadinessState = "not_ready";
  try {
    // Sequential ownership; only read-only endpoint checks, never inference.
    for (const role of ["dreamer", "normalizer"] as const) {
      const bound = await getRoleLlmProvider(role);
      const available = await bound.provider.isAvailable().catch(() => false);
      effective[role === "dreamer" ? "dreamer_model" : "normalizer_model"] = bound.config.model;
      effective.roles!.push({ role, provider: bound.config.provider, model: bound.config.model, fingerprint: bound.policy.fingerprint,
        qualified_at: roleQualification(role, bound.policy.fingerprint), available });
    }
    if (effective.roles!.some(value => !value.available)) reason = "provider_unavailable";
    else if (effective.roles!.some(value => !value.qualified_at)) { state = "unknown"; reason = "completion_unqualified"; }
    else state = "ready";
  } catch { reason = "role_policy_blocked"; lastError = "A cognitive role requires valid configuration/capability evidence."; }
  const fingerprint = computeLlmFingerprint(effective);

  const consecutiveFailures =
    state === "ready" ? 0 : (previous?.consecutive_failures ?? 0) + 1;

  const transitioned =
    !previous ||
    previous.state !== state ||
    previous.fingerprint !== fingerprint;

  const next: LlmReadinessStatus = {
    state,
    fingerprint,
    effective,
    reason,
    last_error: lastError,
    last_check_at: now,
    transitioned_at: transitioned ? now : (previous?.transitioned_at ?? now),
    consecutive_failures: consecutiveFailures,
  };

  _status = next;

  // Fire ready-transition subscribers (ADR-098 Slice 2B). We notify on:
  //   (a) any ↑ ready transition (was not ready, now ready), AND
  //   (b) ready → ready when the fingerprint changed (config rotation).
  // Subscribers are fire-and-forget; their errors are logged, not propagated.
  const becameReady = state === "ready" && previous?.state !== "ready";
  const fingerprintRotated =
    state === "ready" &&
    previous?.state === "ready" &&
    previous.fingerprint !== fingerprint;
  if (becameReady || fingerprintRotated) {
    for (const handler of _readySubscribers) {
      Promise.resolve()
        .then(() => handler(next, previous))
        .catch((err) => {
          logger.error(
            `LLM readiness subscriber error: ${err instanceof Error ? err.message : err}`,
          );
        });
    }
  }

  if (transitioned) {
    if (previous) {
      logger.info(
        `LLM readiness: ${previous.state} → ${state} ` +
          `(reason=${reason}, fingerprint=${fingerprint}, models=${effective.dreamer_model}/${effective.normalizer_model})` +
          (lastError ? ` — ${lastError}` : "")
      );
    } else {
      logger.info(
        `LLM readiness: initial state=${state} ` +
          `(reason=${reason}, fingerprint=${fingerprint}, models=${effective.dreamer_model}/${effective.normalizer_model})` +
          (lastError ? ` — ${lastError}` : "")
      );
    }
  }

  return next;
}

// ---------------------------------------------------------------------------
// Public getters
// ---------------------------------------------------------------------------

/** Returns the most recent readiness status, or null if no probe has run yet. */
export function getLlmReadinessStatus(): LlmReadinessStatus | null {
  return _status;
}

/**
 * Register a handler invoked whenever the watcher observes a transition into
 * `ready` (or a fingerprint rotation while already ready). Returns an
 * unsubscribe function. Subscribers are not invoked retroactively for
 * transitions that happened before they registered.
 */
export function onLlmReadinessReady(handler: ReadyTransitionHandler): () => void {
  _readySubscribers.push(handler);
  return () => {
    const idx = _readySubscribers.indexOf(handler);
    if (idx >= 0) _readySubscribers.splice(idx, 1);
  };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Start the periodic readiness watcher. Idempotent — calling twice replaces
 * the existing timer. Runs an immediate probe (non-blocking) on start.
 */
export function startLlmReadinessWatcher(intervalMs?: number): void {
  const envInterval = process.env.DREAMGRAPH_LLM_READINESS_INTERVAL_MS
    ? parseInt(process.env.DREAMGRAPH_LLM_READINESS_INTERVAL_MS, 10)
    : undefined;
  const requested = intervalMs ?? envInterval ?? DEFAULT_INTERVAL_MS;
  const interval = Math.max(MIN_INTERVAL_MS, requested);

  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }

  const runOnce = (): void => {
    if (_inFlight) return;
    _inFlight = true;
    probeLlmReadiness()
      .catch((err) => {
        logger.error(`LLM readiness probe error: ${err instanceof Error ? err.message : err}`);
      })
      .finally(() => {
        _inFlight = false;
      });
  };

  // Immediate probe so cognitive_status reflects state on first call.
  runOnce();

  _timer = setInterval(runOnce, interval);
  if (typeof _timer === "object" && _timer && "unref" in _timer) {
    _timer.unref();
  }

  logger.info(`LLM readiness watcher started (interval=${interval}ms)`);
}

export function stopLlmReadinessWatcher(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
    logger.info("LLM readiness watcher stopped");
  }
}
