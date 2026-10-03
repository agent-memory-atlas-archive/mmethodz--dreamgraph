import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

import { atomicWriteFile } from "../utils/atomic-write.js";
import { dataPath } from "../utils/paths.js";
import { withFileLock } from "../utils/mutex.js";
import { stripBom } from "../utils/read-json.js";
import { CurationSchema, type CurationState } from "./curation.js";
import { loadPublicationState, publicationContentHash } from "../graph/publication.js";
import { withGraphRead, withGraphReconciliation } from "../utils/graph-reconciliation-barrier.js";

const FILE_NAME = "graph_maintenance.json";
const execFileAsync = promisify(execFile);

export interface GraphMaintenanceState {
  schema_version: "1.0.0";
  last_scan_at: string | null;
  last_enrichment_at: string | null;
  last_datastore_scan_at: string | null;
  last_major_graph_change_at: string | null;
  current_scan_state_revision: string | null;
  last_scan_git_heads: Record<string, string>;
  datastore_connection_fingerprint: string | null;
  targeted_dream_schedule_ids: string[];
  curation?: CurationState;
  digestion?: import("zod").z.infer<typeof import("./digestion.js").DigestionLedgerSchema>;
}

function emptyState(): GraphMaintenanceState {
  return {
    schema_version: "1.0.0",
    last_scan_at: null,
    last_enrichment_at: null,
    last_datastore_scan_at: null,
    last_major_graph_change_at: null,
    current_scan_state_revision: null,
    last_scan_git_heads: {},
    datastore_connection_fingerprint: null,
    targeted_dream_schedule_ids: [],
  };
}

export async function loadGraphMaintenanceState(): Promise<GraphMaintenanceState> {
  return withGraphRead(async () => {
  try {
    const body = await readFile(dataPath(FILE_NAME), "utf-8");
    const publication = await loadPublicationState();
    if (publication.stores[FILE_NAME] && publication.stores[FILE_NAME].hash !== publicationContentHash(body)) throw new Error("UNPUBLISHED_MAINTENANCE_CHANGE");
    const parsed = JSON.parse(stripBom(body)) as Partial<GraphMaintenanceState>;
    if (!parsed || typeof parsed !== "object" || parsed.schema_version !== "1.0.0") throw new Error("GRAPH_MAINTENANCE_INVALID");
    if (parsed.curation !== undefined) parsed.curation = CurationSchema.parse(parsed.curation);
    if(parsed.digestion!==undefined)parsed.digestion=(await import("./digestion.js")).DigestionLedgerSchema.parse(parsed.digestion);
    const fallback = emptyState();
    return {
      ...fallback,
      ...parsed,
      schema_version: "1.0.0",
      last_scan_git_heads: parsed.last_scan_git_heads && typeof parsed.last_scan_git_heads === "object"
        ? parsed.last_scan_git_heads
        : {},
      targeted_dream_schedule_ids: Array.isArray(parsed.targeted_dream_schedule_ids)
        ? parsed.targeted_dream_schedule_ids.filter((id): id is string => typeof id === "string")
        : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && !(await loadPublicationState()).stores[FILE_NAME]) return emptyState();
    throw error;
  }
  });
}

export async function updateGraphMaintenanceState(
  patch: Partial<Omit<GraphMaintenanceState, "schema_version">>,
): Promise<GraphMaintenanceState> {
  return withGraphReconciliation(() => withFileLock(FILE_NAME, async () => {
    const current = await loadGraphMaintenanceState();
    const next: GraphMaintenanceState = {
      ...current,
      ...patch,
      schema_version: "1.0.0",
      last_scan_git_heads: patch.last_scan_git_heads ?? current.last_scan_git_heads,
      targeted_dream_schedule_ids: patch.targeted_dream_schedule_ids ?? current.targeted_dream_schedule_ids,
    };
    await atomicWriteFile(dataPath(FILE_NAME), JSON.stringify(next, null, 2));
    return next;
  }));
}

/** Stable, secret-free marker used only to detect a newly configured datastore. */
export function datastoreConnectionFingerprint(connectionString: string | undefined): string | null {
  const value = connectionString?.trim();
  if (!value) return null;
  return `sha256:${createHash("sha256").update(value).digest("hex").slice(0, 20)}`;
}

export async function captureRepositoryGitHeads(repos: Record<string, string>): Promise<Record<string, string>> {
  const heads: Record<string, string> = {};
  for (const [name, root] of Object.entries(repos)) {
    try {
      const { stdout } = await execFileAsync("git", ["-C", root, "rev-parse", "HEAD"], { timeout: 5_000, windowsHide: true });
      const head = stdout.trim();
      if (/^[0-9a-f]{7,40}$/i.test(head)) heads[name] = head;
    } catch {
      // Non-Git repositories remain valid scan targets.
    }
  }
  return heads;
}
