/**
 * LLM bootstrap fingerprint registry (ADR-098, Slice 2B).
 *
 * Persistent record of which `(provider, base_url, dreamer_model,
 * normalizer_model)` fingerprints have already triggered the auto-bootstrap
 * chain for this instance. Backs the ADR-098 guard rail:
 *
 *   "Bootstrap must run exactly once per (provider, model, endpoint)
 *    configuration."
 *
 * Storage: `<data>/llm_bootstrap_log.json`. Append-only — entries record the
 * fingerprint, when it was first observed ready, what kind of bootstrap was
 * fired (full | re-enrich | skipped), and a brief outcome string. Designed
 * to be cheap to read on every readiness transition and forensic-friendly
 * after the fact.
 *
 * The file is intentionally NOT in templates/default — it's per-instance
 * runtime state, not seed data.
 */

import { readFile } from "node:fs/promises";
import { dataPath } from "../utils/paths.js";
import { atomicWriteFile } from "../utils/atomic-write.js";
import { z } from "zod";
import { withGraphRead,withGraphReconciliation } from "../utils/graph-reconciliation-barrier.js";
import { loadPublicationState,publicationContentHash,recoverGraphPublication } from "../graph/publication.js";
import { stripBom } from "../utils/read-json.js";

export type BootstrapKind = "full" | "re_enrich_skipped" | "manual" | "skipped_not_fresh" | "pending_admission";

export interface BootstrapHistoryEntry {
  fingerprint: string;
  /** The effective config snapshot at the time of bootstrap (forensic only). */
  effective: {
    provider: string;
    base_url: string;
    dreamer_model: string;
    normalizer_model: string;
  };
  kind: BootstrapKind;
  /** When the daemon first saw this fingerprint go ready. */
  observed_at: string;
  /** Human-readable outcome — error message on failure, summary on success. */
  outcome: string;
  success: boolean;
}

interface BootstrapHistoryFile {
  entries: BootstrapHistoryEntry[];
}

const FILENAME = "llm_bootstrap_log.json";

const HistorySchema=z.object({entries:z.array(z.object({fingerprint:z.string().min(1),effective:z.object({provider:z.string(),base_url:z.string(),dreamer_model:z.string(),normalizer_model:z.string()}).strict(),
 kind:z.enum(["full","re_enrich_skipped","manual","skipped_not_fresh","pending_admission"]),observed_at:z.string(),outcome:z.string(),success:z.boolean()}).strict()).max(10000)}).strict();
async function loadHistory():Promise<BootstrapHistoryFile>{
 return withGraphRead(async()=>{const publication=await loadPublicationState();try{const body=await readFile(dataPath(FILENAME),"utf8");
  if(publication.stores[FILENAME]&&publication.stores[FILENAME].hash!==publicationContentHash(body))throw new Error("UNPUBLISHED_BOOTSTRAP_CHANGE");
  if(Buffer.byteLength(body)>16*1024*1024)throw new Error("BOOTSTRAP_HISTORY_BYTE_LIMIT");return HistorySchema.parse(JSON.parse(stripBom(body)));
 }catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT"&&!publication.stores[FILENAME])return {entries:[]};throw new Error(`BOOTSTRAP_HISTORY_UNAVAILABLE: ${String(error)}`);}});
}

async function saveHistory(history: BootstrapHistoryFile): Promise<void> {
  await atomicWriteFile(dataPath(FILENAME), JSON.stringify(HistorySchema.parse(history), null, 2));
}

/** True if this fingerprint has already been observed ready and recorded. */
export async function hasFingerprintBeenSeen(fingerprint: string): Promise<boolean> {
  const history = await loadHistory();
  return history.entries.some((e) => e.fingerprint === fingerprint);
}

/** Append a new history entry under the file lock. */
export async function recordBootstrap(entry: BootstrapHistoryEntry): Promise<void> {
  await withGraphReconciliation(async () => {
    await recoverGraphPublication();
    const history = await loadHistory();
    // Defensive: dedupe — a second concurrent ready transition for the same
    // fingerprint should produce at most one entry.
    if (history.entries.some((e) => e.fingerprint === entry.fingerprint && e.kind === entry.kind)) {
      return;
    }
    history.entries.push(entry);
    await saveHistory(history);
  });
}

/** Read-only history accessor for `cognitive_status` etc. */
export async function getBootstrapHistory(): Promise<BootstrapHistoryEntry[]> {
  const history = await loadHistory();
  return history.entries;
}
