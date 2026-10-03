/**
 * DreamGraph MCP Server — In-memory cache layer.
 *
 * Mtime-aware Map-based cache: on each read we check the file's last-
 * modified time and only re-parse when the file has actually changed.
 * Physical paths isolate instance entries; the enclosing publication stamp
 * rejects interrupted or concurrently changed snapshots.
 *
 * v7.0 El Alarife: The cache resolves data files through a pluggable
 * `resolveDataPath` function so it works in both legacy (flat data/)
 * and UUID-scoped instance modes.
 */

import { readFile, stat, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { getDataDir, getScopedDataDirectory } from "./paths.js";
import { logger } from "./logger.js";
import { withGraphRead } from "./graph-reconciliation-barrier.js";
import { stripBom } from "./read-json.js";

/**
 * Pluggable data directory resolver.
 * Default resolution follows the same active physical instance as publication.
 * In instance mode, lifecycle.ts overrides it at startup.
 */
let dataDirResolver: () => string = () => getDataDir();

/**
 * Set the data directory resolver.
 * Called once at startup by the instance lifecycle module.
 */
export function setDataDirResolver(resolver: () => string): void {
  dataDirResolver = resolver;
}

interface CacheEntry<T = unknown> {
  data: T;
  mtimeMs: number;      // file mtime when data was read
  checkedAt: number;     // Date.now() of last stat() check
}

const cache = new Map<string, CacheEntry>();

/**
 * Load a JSON file from the data directory.
 * Results are cached in memory and automatically refreshed when the
 * underlying file changes (detected via mtime).
 */
export async function loadJsonData<T = unknown>(filename: string): Promise<T> {
  return withGraphRead(() => loadJsonDataUnlocked<T>(filename));
}

async function loadJsonDataUnlocked<T = unknown>(filename: string): Promise<T> {
  const filePath = resolve(getScopedDataDirectory() ?? dataDirResolver(), filename);
  const physical = await realpath(filePath);
  const key = process.platform === "win32" ? physical.toLowerCase() : physical;
  const now = Date.now();
  const entry = cache.get(key) as CacheEntry<T> | undefined;

  // Check file mtime
  try {
    const fileStat = await stat(filePath);
    const mtimeMs = fileStat.mtimeMs;

    // If cached and mtime hasn't changed, just update checkedAt
    if (entry && entry.mtimeMs === mtimeMs) {
      entry.checkedAt = now;
      logger.debug(`Cache hit (mtime unchanged): ${filename}`);
      return entry.data;
    }

    // File is new or modified — read and parse
    logger.debug(`Loading from disk (${entry ? "mtime changed" : "first load"}): ${filePath}`);
    const raw = await readFile(filePath, "utf-8");
    const data = JSON.parse(stripBom(raw)) as T;
    cache.set(key, { data, mtimeMs, checkedAt: now });
    return data;
  } catch (err) {
    // If file doesn't exist and we have stale data, clear it
    if (entry) {
      cache.delete(key);
    }
    throw err;
  }
}

/**
 * Invalidate a specific cache entry or the entire cache.
 */
export function invalidateCache(filename?: string): void {
  if (filename) {
    const suffix = "/" + filename.replace(/\\/g, "/");
    for (const key of cache.keys()) {
      const normalized = key.replace(/\\/g, "/");
      if (normalized.endsWith(process.platform === "win32" ? suffix.toLowerCase() : suffix)) cache.delete(key);
    }
  } else {
    cache.clear();
  }
}

/**
 * Load a JSON file that is expected to be a flat array.
 *
 * Defensively coerces: if an agent wrote the file as a wrapper object
 * (e.g. `{ "entities": [...] }` instead of `[...]`), we extract the
 * first array-valued property as a legacy presentation adapter. Missing optional
 * bootstrap files return []; corruption and missing published stores propagate.
 *
 * Use this for seed files: features.json, workflows.json, data_model.json.
 */
export async function loadJsonArray<T>(filename: string): Promise<T[]> {
  try {
    const raw = await loadJsonData<unknown>(filename);
    if (Array.isArray(raw)) return raw as T[];

    // Object wrapper — find the first array-valued property
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const val of Object.values(raw as Record<string, unknown>)) {
        if (Array.isArray(val)) {
          logger.warn(
            `${filename}: expected flat array, found wrapper object. Auto-extracting array property.`
          );
          return val as T[];
        }
      }
    }

    throw new Error(`INVALID_STORE_SHAPE: ${filename}: expected array`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const { loadPublicationState } = await import("../graph/publication.js");
    if ((await loadPublicationState()).stores[filename]) throw new Error(`PUBLISHED_STORE_MISSING: ${filename}`);
    return [];
  }
}
