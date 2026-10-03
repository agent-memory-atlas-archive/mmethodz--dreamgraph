/**
 * DreamGraph Explorer — Phase 0 + Phase 2 routes.
 *
 * Surface (per plans/DREAMGRAPH_EXPLORER.md §4):
 *   GET  /explorer/api/graph-snapshot
 *   GET  /explorer/api/metrics
 *   POST /explorer/api/metrics/client
 *   GET  /explorer/api/node/:id
 *   GET  /explorer/api/neighborhood/:id?depth=N&limit=M
 *   GET  /explorer/api/search?q=...&types=...&limit=
 *   GET  /explorer/api/edges?kind=...&min_conf=&limit=
 *   GET  /explorer/api/tensions[?status=active|resolved]
 *   GET  /explorer/api/stats
 *
 * Read-only. Loopback-only auth inherits from the daemon. No SSE, no
 * mutations yet — Phase 3+.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { getGraphSnapshot } from "../graph/snapshot.js";
import {
  getMetricsView,
  recordClientMetrics,
  timeRoute,
} from "../graph/metrics.js";
import { handleSpaRequest } from "./static.js";
import { handleEventsStream } from "./events.js";
import { graphMutationService } from "./mutations.js";
import { handleReasonSuggest } from "./reason-suggest.js";
import { loadExplorerPrefs, patchExplorerPrefs } from "./prefs.js";
import { coerceWindowSeconds, getHeatmap } from "./heatmap.js";
import {
  getNeighborhood,
  getExplorerContext,
  getCandidateView,
  getNodeRecord,
  getStats,
  getTensionView,
  listEdges,
  parseEdgeKindSet,
  parseNodeTypeSet,
  search,
} from "./queries.js";
import { logger } from "../utils/logger.js";

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function jsonError(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
): void {
  json(res, status, { ok: false, error: code, message });
}

async function readJsonBody<T = unknown>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf-8");
        resolve(raw.length > 0 ? JSON.parse(raw) : ({} as T));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

/* ------------------------------------------------------------------ */
/*  Handlers                                                          */
/* ------------------------------------------------------------------ */

async function handleSnapshot(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const snapshot = await timeRoute("snapshot", () => getGraphSnapshot());

  // ETag conditional GET — saves a re-render on the client.
  const incoming = req.headers["if-none-match"];
  if (typeof incoming === "string" && incoming === snapshot.etag) {
    res.writeHead(304, { ETag: snapshot.etag });
    res.end();
    return;
  }

  res.writeHead(200, {
    "Content-Type": "application/json",
    ETag: snapshot.etag,
    "Cache-Control": "no-cache",
  });
  res.end(JSON.stringify(snapshot));
}

function handleMetrics(_req: IncomingMessage, res: ServerResponse): void {
  json(res, 200, getMetricsView());
}

async function handleClientMetrics(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const body = await readJsonBody<Record<string, unknown>>(req);
    const result = recordClientMetrics(body);
    json(res, 202, { ok: true, ...result });
  } catch (err) {
    jsonError(res, 400, "bad_request", (err as Error).message);
  }
}

/* ------------------------------------------------------------------ */
/*  Phase 2 query handlers                                            */
/* ------------------------------------------------------------------ */

function parseQuery(url: string): URLSearchParams {
  const idx = url.indexOf("?");
  return new URLSearchParams(idx >= 0 ? url.slice(idx + 1) : "");
}

function parseInt32(value: string | null, fallback: number, max: number): number {
  if (value == null) return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

function parseFloat01(value: string | null, fallback: number): number {
  if (value == null) return fallback;
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

async function handleNode(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
): Promise<void> {
  const qs=parseQuery(req.url??"");
  const record = await timeRoute("node", () => getNodeRecord(id,qs.get("etag")??undefined,Number(qs.get("offset")??0),Number(qs.get("limit")??50)));
  if (!record) {
    jsonError(res, 404, "not_found", `No node with id: ${id}`);
    return;
  }
  if(Buffer.byteLength(JSON.stringify(record),"utf8")>4*1024*1024)throw new Error("EXPLORER_DETAIL_BYTE_LIMIT: use bounded agent context or canonical resource pages");
  json(res, 200, record);
}

async function handleNeighborhood(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
): Promise<void> {
  const qs = parseQuery(req.url ?? "");
  const depth = parseInt32(qs.get("depth"), 1, 4);
  const limit = parseInt32(qs.get("limit"), 200, 2000);
  const result = await timeRoute("neighborhood", () =>
    getNeighborhood(id, depth, limit),
  );
  if (!result) {
    jsonError(res, 404, "not_found", `No node with id: ${id}`);
    return;
  }
  json(res, 200, result);
}

async function handleSearch(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const qs = parseQuery(req.url ?? "");
  const q = qs.get("q") ?? "";
  const types = parseNodeTypeSet(qs.get("types") ?? undefined);
  const limit = parseInt32(qs.get("limit"), 25, 200);
  const result = await timeRoute("search", () => search(q, types, limit));
  json(res, 200, result);
}

async function handleEdgesQuery(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const qs = parseQuery(req.url ?? "");
  const kinds = parseEdgeKindSet(qs.get("kind") ?? undefined);
  const minConf = parseFloat01(qs.get("min_conf"), 0);
  const limit = parseInt32(qs.get("limit"), 500, 5000);
  const result = await timeRoute("edges", () =>
    listEdges(kinds, minConf, limit),
  );
  json(res, 200, result);
}

async function handleTensions(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const qs = parseQuery(req.url ?? "");
  const status = qs.get("status");
  const filter: "active" | "resolved" | "all" =
    status === "resolved" ? "resolved"
    : status === "all" ? "all"
    : "active";
  const view = await timeRoute("tensions", () => getTensionView(filter,qs.get("etag")??undefined));
  if(qs.get("etag")&&qs.get("etag")!==view.etag)throw new Error("EXPLORER_REVISION_CONFLICT");
  json(res, 200, view);
}

async function handleStatsRoute(req:IncomingMessage,res: ServerResponse): Promise<void> {
  const expected=parseQuery(req.url??"").get("etag");
  const stats = await timeRoute("stats", () => getStats(expected??undefined));
  if(expected&&expected!==stats.etag)throw new Error("EXPLORER_REVISION_CONFLICT");
  json(res, 200, stats);
}

async function handleCandidates(req:IncomingMessage,res:ServerResponse):Promise<void>{const expected=parseQuery(req.url??"").get("etag");const view=await getCandidateView(expected??undefined);if(expected&&expected!==view.etag)throw new Error("EXPLORER_REVISION_CONFLICT");json(res,200,view);}

/* ------------------------------------------------------------------ */
/*  Dispatcher                                                        */
/* ------------------------------------------------------------------ */

/**
 * Returns true if the request was handled (response sent).
 *
 * Caller in src/index.ts is expected to test for `/explorer` or a
 * `pathname.startsWith("/explorer/")` match before dispatching.
 */
export async function handleExplorerRoute(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  try {
    if (req.method === "GET" && pathname === "/explorer/api/graph-snapshot") {
      await handleSnapshot(req, res);
      return true;
    }

    if (req.method === "GET" && pathname === "/explorer/api/metrics") {
      handleMetrics(req, res);
      return true;
    }

    if (req.method === "POST" && pathname === "/explorer/api/metrics/client") {
      await handleClientMetrics(req, res);
      return true;
    }

    // Phase 2 read-only queries.
    if(req.method==="GET"&&pathname.startsWith("/explorer/api/context/")){
      const id=decodeURIComponent(pathname.slice("/explorer/api/context/".length)),qs=parseQuery(req.url??"");
      json(res,200,await getExplorerContext(id,qs.get("etag")??undefined));return true;
    }
    if (req.method === "GET" && pathname.startsWith("/explorer/api/node/")) {
      const id = decodeURIComponent(pathname.slice("/explorer/api/node/".length));
      if (!id) {
        jsonError(res, 400, "bad_request", "Missing node id");
        return true;
      }
      await handleNode(req,res,id);
      return true;
    }

    if (
      req.method === "GET" &&
      pathname.startsWith("/explorer/api/neighborhood/")
    ) {
      const id = decodeURIComponent(
        pathname.slice("/explorer/api/neighborhood/".length).split("?")[0],
      );
      if (!id) {
        jsonError(res, 400, "bad_request", "Missing node id");
        return true;
      }
      await handleNeighborhood(req, res, id);
      return true;
    }

    if (req.method === "GET" && pathname === "/explorer/api/search") {
      await handleSearch(req, res);
      return true;
    }

    if (req.method === "GET" && pathname === "/explorer/api/edges") {
      await handleEdgesQuery(req, res);
      return true;
    }

    if (req.method === "GET" && pathname === "/explorer/api/tensions") {
      await handleTensions(req, res);
      return true;
    }

    if (req.method === "GET" && pathname === "/explorer/api/stats") {
      await handleStatsRoute(req,res);
      return true;
    }

    // Slice E1 (Explorer 3D heatmap mode):
    // recent traffic per entity, derived from event_log.json.
    if (req.method === "GET" && pathname === "/explorer/api/heatmap") {
      const qs = parseQuery(req.url ?? "");
      const windowSeconds = coerceWindowSeconds(qs.get("window"));
      const result = await timeRoute("heatmap", () => getHeatmap(windowSeconds));
      json(res, 200, result);
      return true;
    }

    // Phase 4 / Slice 1 (frontend): list candidate edges awaiting a
    // promote/reject decision. Returns the latent (= not-yet-decided)
    // entries from candidate_edges.json.
    if (req.method === "GET" && pathname === "/explorer/api/candidates") {
      await handleCandidates(req,res);
      return true;
    }

    // Phase 4 / Slice 1 (frontend): LLM-backed reason suggester for
    // curated mutations. Read-only from the graph perspective.
    if (req.method === "POST" && pathname === "/explorer/api/reason-suggest") {
      await handleReasonSuggest(req, res);
      return true;
    }

    // Explorer 3D mode (plans/EXPLORER_3D_MODE.md §9):
    // tiny per-instance UI preference store. Loopback-only, never read by
    // the cognitive engine. Defaults silently if the file is missing/corrupt.
    if (req.method === "GET" && pathname === "/explorer/api/prefs") {
      const prefs = await loadExplorerPrefs();
      json(res, 200, prefs);
      return true;
    }

    if (req.method === "POST" && pathname === "/explorer/api/prefs") {
      let patch: unknown;
      try {
        patch = await readJsonBody(req);
      } catch (err) {
        jsonError(res, 400, "bad_request", (err as Error).message);
        return true;
      }
      const next = await patchExplorerPrefs(patch);
      json(res, 200, next);
      return true;
    }

    // Phase 3 / Slice 1: live event stream.
    if (req.method === "GET" && pathname === "/explorer/events") {
      handleEventsStream(req, res);
      return true;
    }

    // Phase 4 / Slice 1: curated mutation pipeline. Only the `ping`
    // intent is registered today — real intents land in Slice 2.
    if (req.method === "POST" && pathname.startsWith("/explorer/mutations/")) {
      const intent = pathname.slice("/explorer/mutations/".length);
      if (!intent) {
        jsonError(res, 400, "bad_request", "Missing mutation intent");
        return true;
      }
      await graphMutationService.execute(req, res, intent);
      return true;
    }

    // Anything else under /explorer/api/* is a 404.
    if (pathname.startsWith("/explorer/api/")) {
      jsonError(res, 404, "not_found", `No Explorer endpoint: ${pathname}`);
      return true;
    }

    // Phase 1: SPA shell + static assets at /explorer/ and /explorer/assets/*.
    // Returns false when the SPA bundle is missing so the outer router can
    // emit its standard 404.
    return handleSpaRequest(req, res, pathname);
  } catch (err) {
    logger.error(`/explorer route error (${pathname}):`, err);
    const message=(err as Error).message;
    jsonError(res,message==="EXPLORER_REVISION_CONFLICT"||message==="EXPLORER_AMBIGUOUS_ID"?409:500,message.startsWith("EXPLORER_")?message:"internal_error",message);
    return true;
  }
}
