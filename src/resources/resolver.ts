/** One scope/revision-aware URI authority for MCP resources and query_resource. */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { getActiveScope } from "../instance/index.js";
import { dataPath, getDataDir } from "../utils/paths.js";
import { stripBom } from "../utils/read-json.js";
import { withGraphRead } from "../utils/graph-reconciliation-barrier.js";
import { CANONICAL_FAMILIES, loadCanonicalGraph } from "../graph/read-model.js";
import { loadPublicationState, publicationContentHash } from "../graph/publication.js";
import { ContextPackSchema, ResourcePageSchema, graphIdentityKey, classifySchemaMajor, type ResourcePage, type GraphIdentity, type ResultState } from "../graph/contracts.js";
import { storeDefinition } from "../graph/store-registry.js";

type Backend = (uri: URL) => Promise<ReadResourceResult>;
const backends = new Map<string, Map<string, Backend>>();
const scopeKey = (): string => {
  let key = resolve(getDataDir());
  try { key = realpathSync(key); }
  catch (failure) { if ((failure as NodeJS.ErrnoException).code !== "ENOENT") throw failure; }
  return process.platform === "win32" ? key.toLowerCase() : key;
};
const FILE_RESOURCES: Record<string, string> = {
  "system://overview": "system_overview.json", "system://index": "index.json",
  "dream://history": "dream_history.json", "dream://threats": "threat_log.json",
  "dream://archetypes": "dream_archetypes.json", "dream://metacognition": "meta_log.json",
  "dream://events": "event_log.json", "dream://schedules": "schedules.json",
  "dream://schedule-history": "schedules.json", "dream://lucid": "lucid_log.json",
  "ops://api-surface": "api_surface.json",
};
const GRAPH_RESOURCES: Record<string, GraphIdentity["kind"]> = {
  "system://features": "feature", "system://workflows": "workflow", "system://data-model": "data_model",
  "system://datastores": "datastore", "system://capability-entities": "capability",
  "dream://graph": "dream_node", "dream://candidates": "candidate", "dream://validated": "validated",
  "dream://tensions": "tension", "dream://adrs": "adr", "dream://ui-registry": "ui_element",
  "dream://story": "narrative",
};
const cursorKey = randomBytes(32);
const CursorSchema = z.object({
  version: z.literal(1), instance_id: z.string(), authority_scope: z.string(), uri: z.string(), filter_hash: z.string(),
  content_revision: z.string(), publication_sequence: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(), expires_at: z.number().int(),
}).strict();
type Cursor = z.infer<typeof CursorSchema>;
const stable = (value: unknown): string => value === null || typeof value !== "object" ? JSON.stringify(value)
  : Array.isArray(value) ? "[" + value.map(stable).join(",") + "]"
  : "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + stable((value as Record<string, unknown>)[key])).join(",") + "}";
const hash = (value: unknown): string => "sha256:" + createHash("sha256").update(stable(value)).digest("hex");
function encodeCursor(value: Cursor): string {
  const body = Buffer.from(JSON.stringify(value)).toString("base64url");
  return body + "." + createHmac("sha256", cursorKey).update(body).digest("base64url");
}
function decodeCursor(value: string): Cursor {
  try {
    if (value.length > 4096) throw new Error("oversized");
    const [body, signature, extra] = value.split(".");
    const expected = createHmac("sha256", cursorKey).update(body).digest();
    const supplied = Buffer.from(signature, "base64url");
    if (extra || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error("signature");
    const cursor = CursorSchema.parse(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
    if (cursor.expires_at < Date.now()) throw new Error("expired");
    return cursor;
  } catch { throw new ResourceQueryError("CURSOR_INVALID_OR_EXPIRED", "Cursor is invalid, expired, or belongs to a previous daemon process. Restart the bounded query."); }
}
export class ResourceQueryError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}
export const ResourceQuerySchema = z.object({
  uri: z.string().min(1).max(1024), filter: z.record(z.unknown()).optional(),
  limit: z.number().int().min(1).max(1000).default(50),
  max_bytes: z.number().int().min(1024).max(65536).default(8192),
  cursor: z.string().max(4096).optional(),
}).strict();
export type ResourceQueryInput = z.input<typeof ResourceQuerySchema>;

/** Registers the same meaning for the listed resource and the query tool. */
export function registerPagedResource(server: McpServer, name: string, uri: string,
  metadata: { description?: string; mimeType?: string }, backend: Backend): void {
  const registry = backends.get(scopeKey()) ?? new Map<string, Backend>();
  registry.set(uri, backend);
  backends.set(scopeKey(), registry);
  server.resource(name, uri, { ...metadata, mimeType: "application/json" }, async requested => {
    const page = await queryResourcePage({ uri: requested.href });
    return { contents: [{ uri: requested.href, mimeType: "application/json", text: JSON.stringify(page) }] };
  });
}
export function listedResourceUris(): string[] { return [...(backends.get(scopeKey())?.keys() ?? [])].sort(); }
export function clearResourceBackendsForTest(): void { backends.delete(scopeKey()); }

function matches(payload: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, required]) => {
    if (!Object.hasOwn(payload, key)) return false;
    const actual = payload[key];
    if (typeof actual === "string" && typeof required === "string") return actual.toLocaleLowerCase().includes(required.toLocaleLowerCase());
    if (Array.isArray(actual) && !Array.isArray(required)) return actual.some(item => typeof item === "string" && typeof required === "string" ? item.toLocaleLowerCase().includes(required.toLocaleLowerCase()) : stable(item) === stable(required));
    return stable(actual) === stable(required);
  });
}
/** Whole entries with their collection/key retained; no substring clipping or arbitrary first array. */
function resourceRecords(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.map((payload, index) => ({ record_type: "resource_entry", collection: null, key: String(index), payload }));
  if (value === null) return [];
  if (typeof value !== "object") return [{ record_type: "resource_entry", collection: null, key: null, payload: value }];
  const entries: Array<Record<string, unknown>> = [];
  for (const [collection, field] of Object.entries(value)) {
    if (Array.isArray(field)) field.forEach((payload, index) => entries.push({ record_type: "resource_entry", collection, key: String(index), payload }));
    else if (collection === "entities" && field && typeof field === "object") for (const [key, payload] of Object.entries(field)) entries.push({ record_type: "resource_entry", collection, key, payload });
    else entries.push({ record_type: "resource_entry", collection: null, key: collection, payload: field });
  }
  return entries;
}
async function rawResource(uri: string): Promise<unknown> {
  const file = FILE_RESOURCES[uri] ?? CANONICAL_FAMILIES.find(f => f.kind === GRAPH_RESOURCES[uri])?.file;
  if (file) {
    try {
      const body = await readFile(dataPath(file), "utf8");
      const state = await loadPublicationState();
      if (state.stores[file] && state.stores[file].hash !== publicationContentHash(body)) throw new ResourceQueryError("UNPUBLISHED_STORE_CHANGE", `The published ${file} has a concrete mismatch. Reconcile this scope.`);
      const parsed = JSON.parse(stripBom(body));
      const declared = parsed && !Array.isArray(parsed) ? parsed.schema_version ?? parsed.metadata?.schema_version : undefined;
      if (declared !== undefined) {
        const compatibility = classifySchemaMajor(String(declared), storeDefinition(file).schema_major);
        if (compatibility !== "current" && compatibility !== "previous") throw new ResourceQueryError("UNSUPPORTED_STORE_SCHEMA", `${file} declares unsupported schema ${declared}; no semantic interpretation was attempted.`);
      }
      if (uri === "dream://schedule-history" || uri === "dream://schedules") {
        const field = uri === "dream://schedules" ? "schedules" : "executions";
        if (!parsed || !Array.isArray(parsed[field])) throw new ResourceQueryError("INVALID_STORE_SHAPE", `${file} lacks ${field}.`);
        return parsed[field];
      }
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if ((await loadPublicationState()).stores[file]) throw new ResourceQueryError("PUBLISHED_STORE_MISSING", `Published ${file} is unavailable; empty success is forbidden.`);
      return [];
    }
  }
  const backend = backends.get(scopeKey())?.get(uri);
  if (!backend) throw new ResourceQueryError("INVALID_URI", `Unknown resource URI ${uri}. Read system://capabilities or resources/list.`);
  const response = await backend(new URL(uri));
  const block = response.contents[0];
  if (!block || !("text" in block)) throw new ResourceQueryError("RESOURCE_UNAVAILABLE", "Resource does not provide JSON text.");
  return JSON.parse(block.text);
}

/** Explicit bounded compatibility adapter; URI meaning agrees with MCP resource reads. */
export async function queryResourceLegacy(input: ResourceQueryInput): Promise<unknown> {
  const request = ResourceQuerySchema.parse(input);
  if (request.cursor) throw new ResourceQueryError("LEGACY_PAGING_UNSUPPORTED", "Use contract v1 for continuation and complete record metadata.");
  return withGraphRead(async () => {
    if (!listedResourceUris().includes(request.uri)) throw new ResourceQueryError("INVALID_URI", `Unknown resource URI ${request.uri}.`);
    let raw = await rawResource(request.uri);
    if (request.filter && Object.keys(request.filter).length) {
      const rows = resourceRecords(raw).filter(row => row.payload && typeof row.payload === "object" && matches(row.payload as Record<string, unknown>, request.filter!));
      raw = rows.map(row => row.payload);
    }
    if (Buffer.byteLength(JSON.stringify(raw), "utf8") > request.max_bytes) throw new ResourceQueryError("LEGACY_OUTPUT_TOO_LARGE", "Legacy reads are bounded whole JSON. Use contract v1 and follow its cursor.");
    return raw;
  });
}

export async function queryResourcePage(input: ResourceQueryInput): Promise<ResourcePage> {
  const request = ResourceQuerySchema.parse(input);
  return withGraphRead(async () => {
    if (!listedResourceUris().includes(request.uri)) throw new ResourceQueryError("INVALID_URI", `Unknown resource URI ${request.uri}.`);
    const publication = await loadPublicationState();
    const instance_id = getActiveScope()?.uuid ?? "legacy";
    const authority_scope = hash(scopeKey());
    const filter_hash = hash(request.filter ?? {});
    const cursor = request.cursor ? decodeCursor(request.cursor) : null;
    if (cursor && (cursor.uri !== request.uri || cursor.instance_id !== instance_id || cursor.authority_scope !== authority_scope || cursor.filter_hash !== filter_hash)) throw new ResourceQueryError("CURSOR_SCOPE_MISMATCH", "Cursor belongs to another resource, instance or filter.");
    let records: Array<Record<string, unknown>>, state: ResultState;
    const kind = GRAPH_RESOURCES[request.uri];
    if (kind) {
      const graph = await loadCanonicalGraph(instance_id);
      const entities = graph.entities.filter(e => e.identity.kind === kind);
      const relationships = graph.relationships.filter(r => request.uri === "dream://graph" ? r.kind === "dream" : request.uri === "dream://validated" ? r.kind === "validated" : request.uri === "dream://candidates" ? r.kind === "candidate" : r.source?.kind === kind);
      records = [...entities.map(e => ({ record_type: "entity", ...e })), ...relationships.map(r => ({ record_type: "relationship", ...r }))];
      const file = CANONICAL_FAMILIES.find(f => f.kind === kind)!.file;
      const ids = new Set([...relationships.map(r => r.id), ...entities.map(e => graphIdentityKey(e.identity))]);
      const reasons = graph.state.reasons.filter(r => !r.scope.length || r.scope.includes(file) || r.scope.some(id => ids.has(id)) || r.code === "DUPLICATE_DREAM_EDGE_ID" && kind === "dream_node");
      state = { availability: reasons.some(r => r.scope.includes(file)) && !entities.length ? "unavailable" : "available", completeness: reasons.length ? "partial" : "complete", freshness: reasons.some(r => ["UNPUBLISHED_STORE_CHANGE", "SOURCE_RECONCILIATION_PENDING"].includes(r.code)) ? "stale" : reasons.length ? "unknown" : publication.currency.source_reconciliation_revision ? "current" : "unknown", reasons };
    } else {
      try {
        const raw = await rawResource(request.uri);
        if (request.uri === "dream://context" && raw && typeof raw === "object" && (raw as { schema?: unknown }).schema === "dreamgraph.context_pack.v1") {
          const pack = ContextPackSchema.parse(raw);
          records = [{ record_type: "context_pack", payload: pack }]; state = pack.state;
        } else {
          records = resourceRecords(raw);
          state = { availability: "available", completeness: "complete", freshness: "unknown", reasons: [] };
          if (request.uri === "dream://context") state = { ...state, completeness: "unknown", reasons: [{ code: "LEGACY_CONTEXT_LIMITATION", scope: [request.uri], detail: "Explicit legacy comparison has incomplete families, raw ID ambiguity and estimated counts." }] };
        }
      } catch (failure) {
        records = [];
        state = { availability: "unavailable", completeness: "unknown", freshness: failure instanceof ResourceQueryError && failure.code === "UNPUBLISHED_STORE_CHANGE" ? "stale" : "unknown",
          reasons: [{ code: failure instanceof ResourceQueryError ? failure.code : "RESOURCE_UNAVAILABLE", scope: [request.uri], detail: failure instanceof Error ? failure.message : String(failure) }] };
      }
      if (request.uri === "dream://status") {
        const graph = await loadCanonicalGraph(instance_id);
        if (state.availability === "available") state = { ...graph.state, availability: "available" };
      }
    }
    if (request.filter && Object.keys(request.filter).length) records = records.filter(row => row.payload && typeof row.payload === "object" && matches(row.payload as Record<string, unknown>, request.filter!));
    const content_revision = hash({ records, state });
    if (cursor && (cursor.content_revision !== content_revision || cursor.publication_sequence !== publication.revision.publication_sequence)) throw new ResourceQueryError("CURSOR_REVISION_CHANGED", "Resource changed after the previous page. Restart this query; records from different revisions cannot be combined.");
    const start = cursor?.offset ?? 0;
    if (start > records.length) throw new ResourceQueryError("CURSOR_INVALID_OR_EXPIRED", "Cursor position is outside this resource.");
    const expires_at = cursor?.expires_at ?? Date.now() + 30 * 60_000;
    const selected: typeof records = [];
    const page = (end: number): ResourcePage => {
      const remaining = records.length - end;
      return { schema: "dreamgraph.resource_result.v1", uri: request.uri, representation: kind ? "canonical" : "resource", instance_id,
        revision: publication.revision, currency: publication.currency, content_revision, scope: [request.uri], generated_at: new Date().toISOString(),
        state: { ...state, completeness: remaining ? "partial" : state.completeness, reasons: [...state.reasons, ...(remaining ? [{ code: "PAGE_WINDOW", scope: [request.uri], detail: `${remaining} whole records remain; follow continuation before claiming complete retrieval.` }] : [])] },
        records: selected, count: selected.length, total: state.availability === "unavailable" ? null : records.length, page_start: start, omitted_count: state.availability === "unavailable" ? null : records.length - selected.length,
        continuation: remaining ? encodeCursor({ version: 1, uri: request.uri, instance_id, authority_scope, filter_hash, content_revision, publication_sequence: publication.revision.publication_sequence, offset: end, expires_at }) : null };
    };
    if (Buffer.byteLength(JSON.stringify(page(start)), "utf8") > request.max_bytes) throw new ResourceQueryError("ENVELOPE_BUDGET_TOO_SMALL", "Metadata cannot fit this byte limit; increase max_bytes or narrow the scope.");
    let end = start;
    while (end < records.length && selected.length < request.limit) {
      selected.push(records[end]);
      if (Buffer.byteLength(JSON.stringify(page(end + 1)), "utf8") > request.max_bytes) {
        selected.pop();
        if (!selected.length) throw new ResourceQueryError("RESOURCE_RECORD_TOO_LARGE", "The next whole record cannot fit. Increase max_bytes or request a narrower projection; no record was clipped or skipped.");
        break;
      }
      end++;
    }
    return ResourcePageSchema.parse(page(end));
  });
}
