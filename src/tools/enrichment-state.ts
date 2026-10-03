import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { atomicWriteFile } from "../utils/atomic-write.js";
import { z } from "zod";
import { stripBom } from "../utils/read-json.js";
import type { SemanticState } from "./coverage-ledger.js";

export const ENRICHMENT_RUN_SCHEMA = "dreamgraph.enrichment_run.v1" as const;

export type EnrichmentFailureKind =
  | "admission_limit"
  | "provider_unavailable"
  | "context_overflow"
  | "unsupported_evidence"
  | "transient_timeout"
  | "validation_failure"
  | "cancelled";

export interface EnrichmentAttempt {
  state: SemanticState;
  attempts: number;
  updated_at: string;
  reason?: EnrichmentFailureKind | string;
}

export interface EnrichmentRunState {
  schema: typeof ENRICHMENT_RUN_SCHEMA;
  run_id: string;
  scan_revision: string;
  provider_fingerprint: string;
  created_at: string;
  updated_at: string;
  nodes: Record<string, EnrichmentAttempt>;
}

export const EnrichmentRunSchema = z.object({
  schema: z.literal(ENRICHMENT_RUN_SCHEMA), run_id: z.string().min(1), scan_revision: z.string().min(1),
  provider_fingerprint: z.string().min(1), created_at: z.string().datetime({ offset: true }), updated_at: z.string().datetime({ offset: true }),
  nodes: z.record(z.object({ state: z.enum(["not_eligible", "pending", "enriched", "skipped", "failed_retryable", "failed_terminal"]),
    attempts: z.number().int().nonnegative(), updated_at: z.string().datetime({ offset: true }), reason: z.string().optional() }).strict()),
}).strict();

export function createEnrichmentRun(scanRevision: string, providerFingerprint: string, eligibleIds: string[]): EnrichmentRunState {
  const now = new Date().toISOString();
  return {
    schema: ENRICHMENT_RUN_SCHEMA,
    run_id: randomUUID(),
    scan_revision: scanRevision,
    provider_fingerprint: providerFingerprint,
    created_at: now,
    updated_at: now,
    nodes: Object.fromEntries([...new Set(eligibleIds)].sort().map((id) => [id, { state: "pending" as const, attempts: 0, updated_at: now }])),
  };
}

export function resumableNodeIds(state: EnrichmentRunState, maxAttempts = 3): string[] {
  return Object.entries(state.nodes)
    .filter(([, node]) => node.state === "pending" || (
      (node.state === "failed_retryable" || isLegacyFallback(node)) && node.attempts < maxAttempts
    ))
    .map(([id]) => id)
    .sort();
}

function isLegacyFallback(node: EnrichmentAttempt): boolean {
  return node.state === "enriched" && node.reason === "evidence_only_fallback";
}

/** Unfinished work includes exhausted retries and legacy fallback-as-success records. */
export function unfinishedEnrichmentNodeIds(state: EnrichmentRunState): string[] {
  return Object.entries(state.nodes)
    .filter(([, node]) => (node.state !== "enriched" && node.state !== "skipped") || isLegacyFallback(node))
    .map(([id]) => id)
    .sort();
}

export function classifyEnrichmentFailure(error: unknown): { state: "failed_retryable" | "failed_terminal"; reason: EnrichmentFailureKind } {
  const message = String(error instanceof Error ? error.message : error).toLowerCase();
  if (/admission_/.test(message)) return { state: "failed_retryable", reason: "admission_limit" };
  if (/abort|cancel/.test(message)) return { state: "failed_retryable", reason: "cancelled" };
  if (/timeout|timed out|econnreset|temporar/.test(message)) return { state: "failed_retryable", reason: "transient_timeout" };
  if (/unavailable|econnrefused|no provider|model.*not.*loaded/.test(message)) return { state: "failed_retryable", reason: "provider_unavailable" };
  if (/context|token.*limit|too large/.test(message)) return { state: "failed_terminal", reason: "context_overflow" };
  if (/unsupported|no evidence/.test(message)) return { state: "failed_terminal", reason: "unsupported_evidence" };
  return { state: "failed_terminal", reason: "validation_failure" };
}

export function recordEnrichmentOutcome(
  state: EnrichmentRunState,
  id: string,
  outcome: { state: "enriched" | "skipped" | "failed_retryable" | "failed_terminal"; reason?: string },
  now = new Date().toISOString(),
): EnrichmentRunState {
  const prior = state.nodes[id];
  if (!prior) throw new Error(`ENRICHMENT_NODE_NOT_ELIGIBLE: ${id}`);
  if (prior.state === "enriched" && !isLegacyFallback(prior)) return state;
  return {
    ...state,
    updated_at: now,
    nodes: {
      ...state.nodes,
      [id]: { state: outcome.state, attempts: prior.attempts + 1, updated_at: now, ...(outcome.reason ? { reason: outcome.reason } : {}) },
    },
  };
}

export async function persistEnrichmentRun(filePath: string, state: EnrichmentRunState): Promise<void> {
  EnrichmentRunSchema.parse(state);
  await atomicWriteFile(filePath, JSON.stringify(state, null, 2));
}

export async function loadEnrichmentRun(filePath: string): Promise<EnrichmentRunState | null> {
  try {
    return EnrichmentRunSchema.parse(JSON.parse(stripBom(await readFile(filePath, "utf-8"))));
  } catch (failure) {
    if ((failure as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`ENRICHMENT_CHECKPOINT_UNAVAILABLE: ${String(failure)}`);
  }
}
