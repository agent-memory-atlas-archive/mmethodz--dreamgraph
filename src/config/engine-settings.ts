/** Core configuration schemas. Parse the complete merged candidate before mutating a consumer. */
import { z } from "zod";
const count = z.number().finite().int().min(0).max(Number.MAX_SAFE_INTEGER);
const positive = count.min(1);
const milliseconds = count.max(86_400_000);
const fraction = z.number().finite().min(0).max(1);
export const FederationSettingsSchema = z.object({instance_id:z.string().min(1).max(256).optional(),allow_export:z.boolean().default(true),
  allow_import:z.boolean().default(true),anonymize:z.boolean().default(true)}).strict().refine(value=>!value.allow_export||value.anonymize,
  "Unredacted federation export is unsupported; disable export or retain anonymize=true.");
export const SchedulerSettingsSchema = z.object({
  enabled: z.boolean(), tick_interval_ms: milliseconds.min(100), max_runs_per_hour: count.max(100_000),
  global_cooldown_ms: milliseconds, nightmare_cooldown_ms: milliseconds,
  max_history: positive.max(100_000), max_error_streak: positive.max(100_000),
  execution_timeout_ms: milliseconds.min(1),
}).strict();
export const EventSettingsSchema = z.object({
  tension_threshold: fraction, runtime_error_threshold: fraction, cooldown_ms: milliseconds,
  max_auto_cycles_per_hour: count.max(100_000),
}).strict();
export const NarrativeSettingsSchema = z.object({
  narrative_interval: positive.max(1_000_000), digest_interval: positive.max(1_000_000),
  max_chapters: positive.max(100_000), auto_narrate: z.boolean(),
}).strict().superRefine((value, ctx) => {
  if (value.digest_interval < value.narrative_interval) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["digest_interval"], message: "Digest interval must be at least the chapter interval." });
});
/** Enablement advertises a route; it creates no target grant or execution authority. */
export const ComputerUseSettingsSchema = z.object({
  enabled: z.boolean(), route: z.enum(["auto", "native_cli", "dreamgraph_harness"]),
  worker_profile: z.string().max(256).nullable(), target_profile: z.string().max(256).nullable(),
  max_actions: count.max(10_000), max_images: count.max(1_000), max_image_bytes: count.max(100 * 1024 * 1024),
  elapsed_ms: milliseconds, retention: z.enum(["none", "session", "bounded_local"]),
  retention_ms: milliseconds, remote_worker_enabled: z.boolean(),
}).strict().superRefine((value, ctx) => {
  if (value.enabled && (!value.worker_profile || !value.target_profile || !value.max_actions || !value.elapsed_ms)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enablement requires named worker/target profiles and nonzero finite action/time bounds; a separate scoped grant is still required." });
  if (value.retention === "none" && value.retention_ms !== 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["retention_ms"], message: "No-retention requires zero retained lifetime." });
});
export const DEFAULT_COMPUTER_USE_SETTINGS = ComputerUseSettingsSchema.parse({ enabled: false, route: "auto", worker_profile: null, target_profile: null,
  max_actions: 50, max_images: 20, max_image_bytes: 10 * 1024 * 1024, elapsed_ms: 300_000, retention: "none", retention_ms: 0, remote_worker_enabled: false });
export function mergeEngineSettings<T>(schema: z.ZodType<T>, current: T, patch: Partial<T>): T {
  return schema.parse({ ...current, ...patch });
}
export function parseEngineSettings<T>(schema: z.ZodType<T>, defaults: T, raw?: string): T {
  return schema.parse({ ...defaults, ...(raw ? JSON.parse(raw) : {}) });
}
