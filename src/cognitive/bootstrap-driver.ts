/**
 * Bootstrap driver (ADR-098, Slice 2B).
 *
 * Records first observed ready fingerprints as pending admission. Capability
 * readiness never grants source effects, inference or a fresh paid allocation.
 * Explicit bootstrap/enrichment commands enter the durable job owner.
 *
 * The driver is stateless (registry is the source of truth); a daemon
 * restart re-evaluates fingerprint history on the next ready transition.
 */

import { logger } from "../utils/logger.js";
import { onLlmReadinessReady, type LlmReadinessStatus } from "./llm-readiness.js";
import {
  hasFingerprintBeenSeen,
  recordBootstrap,
  type BootstrapKind,
} from "./bootstrap-registry.js";

let _wired = false;

/**
 * Subscribe the bootstrap chain to the readiness watcher. Idempotent —
 * calling twice is a no-op so the daemon's startup chain stays safe under
 * test reloads.
 */
export function wireBootstrapOnReady(): void {
  if (_wired) return;
  _wired = true;

  onLlmReadinessReady(async (current, previous) => {
    if (current.state !== "ready" || !current.fingerprint || !current.effective) return;

    const fingerprint = current.fingerprint;
    const eff = current.effective;

    // ADR-098 guard rail #1 — exactly once per fingerprint.
    if (await hasFingerprintBeenSeen(fingerprint)) {
      logger.debug(
        `[bootstrap-driver] fingerprint ${fingerprint} already recorded — skipping`,
      );
      return;
    }

    // Readiness attests capability, never grants new effects or paid allocation.
    // Manual bootstrap/enrichment enters the same EngineJobs owner through runScanProject.
    const kind: BootstrapKind = "pending_admission";
    const success = false;
    const outcome = "readiness observed; bootstrap or re-enrichment requires explicit job admission; no work dispatched";
    logger.info(`[bootstrap-driver] ${fingerprint}: ${outcome}`);

    await recordBootstrap({
      fingerprint,
      effective: {
        provider: eff.provider,
        base_url: eff.base_url,
        dreamer_model: eff.dreamer_model,
        normalizer_model: eff.normalizer_model,
      },
      kind,
      observed_at: current.last_check_at ?? new Date().toISOString(),
      outcome,
      success,
    });
  });

  logger.info("[bootstrap-driver] Subscribed to LLM readiness transitions");
}

/**
 * Test/utility helper — exposes the driver state so tests can reset between
 * cases. Not part of the production surface.
 */
export function _resetBootstrapDriverForTests(): void {
  _wired = false;
}

/**
 * Re-export for convenience: callers that need to know whether the registry
 * has seen a given LLM config can use the registry directly.
 */
export type { LlmReadinessStatus };
