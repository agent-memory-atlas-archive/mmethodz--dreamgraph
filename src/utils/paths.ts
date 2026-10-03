/**
 * DreamGraph v7.0 "El Alarife" — Data path resolver.
 *
 * Provides a lazy-evaluated data directory that works in both fallback
 * and UUID-scoped instance modes.
 *
 * Module-scope code should use `dataPath("file.json")` instead of
 * `resolve(config.dataDir, "file.json")` — the path is resolved at
 * call time, not import time, so it picks up the correct instance
 * data directory even if set after module loading.
 */

import { resolve } from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { config } from "../config/config.js";

/**
 * Override set by the instance lifecycle at startup.
 * null = fallback mode (use config.dataDir).
 */
let dataDirOverride: string | null = null;
const scopedDirectory = new AsyncLocalStorage<string>();
/** Internal execution pin. This is not a user-supplied transport selector or authority grant. */
export function withDataDirectory<T>(directory: string, work: () => T): T {
  return scopedDirectory.run(resolve(directory), work);
}
export const getScopedDataDirectory = (): string | undefined => scopedDirectory.getStore();

/**
 * Set the data directory override.
 * Called once at startup by resolveInstanceAtStartup().
 */
export function setDataDirOverride(dir: string | null): void {
  dataDirOverride = dir;
}

/**
 * Get the effective data directory.
 * Instance mode → UUID-scoped dir under the DreamGraph master directory.
 * Fallback mode → config.dataDir.
 */
export function getDataDir(): string {
  return scopedDirectory.getStore() ?? dataDirOverride ?? config.dataDir;
}

/**
 * Resolve a filename within the effective data directory.
 *
 * Use this instead of `resolve(config.dataDir, filename)` in any
 * code path that may run under instance mode.
 *
 * @example
 *   // Before (eager, breaks in instance mode):
 *   const META_LOG_PATH = resolve(config.dataDir, "meta_log.json");
 *
 *   // After (lazy, works in both modes):
 *   const metaLogPath = () => dataPath("meta_log.json");
 */
export function dataPath(filename: string): string {
  return resolve(getDataDir(), filename);
}
