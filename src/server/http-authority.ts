import type { IncomingMessage, ServerResponse } from "node:http";
import { getDataDir } from "../utils/paths.js";
import {directoryInstanceId} from "../instance/identity.js";
import { resolveHttpPolicy, checkHttpRequest, publicHttpPolicy, tokenMatches, type HttpPolicy } from "./http-policy.js";
import { SessionAuthority } from "./session-authority.js";
import type { SessionContext } from "./session-context.js";
import { authenticateExecutionPolicy } from "./execution-policy.js";
import { LEGACY_SESSION_COOKIE, sessionCookieName, readSessionCookie, bindAuthenticatedSessionBearer } from "./session-bearer.js";

/** Legacy name only. New browsers use DaemonHttpAuthority.sessionCookie. */
export const SESSION_COOKIE = LEGACY_SESSION_COOKIE;
async function readBody(req: IncomingMessage): Promise<string> {
  const chunks:Buffer[]=[];let bytes=0;for await(const chunk of req){const part=Buffer.from(chunk);bytes+=part.length;
    if(bytes>16384)throw new Error("AUTHORITY_BODY_LIMIT");chunks.push(part);
  }return new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks));
}
function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(body));
}
export class DaemonHttpAuthority {
  readonly policy: HttpPolicy;
  readonly sessions: SessionAuthority;
  readonly sessionCookie: string;
  constructor(port: number, env: Record<string, string | undefined> = process.env) {
    this.policy = resolveHttpPolicy(port, env);
    this.sessions = new SessionAuthority(env.DREAMGRAPH_INSTANCE_UUID || directoryInstanceId(getDataDir()));
    this.sessionCookie = sessionCookieName(this.sessions.instance_id);
  }
  private setSessionCookie(res: ServerResponse, token: string): void {
    res.setHeader("Set-Cookie", `${this.sessionCookie}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`);
  }
  publicStatus() { return publicHttpPolicy(this.policy); }
  async authorize(req: IncomingMessage, res?: ServerResponse, upgrade = false): Promise<SessionContext | null> {
    const gate = checkHttpRequest(req, this.policy, upgrade);
    if (!gate.allowed) { if (res) json(res, gate.status, { error: gate.reason }); return null; }
    if (res) {
      if (gate.origin) { res.setHeader("Access-Control-Allow-Origin", gate.origin); res.setHeader("Access-Control-Allow-Credentials", "true"); res.setHeader("Vary", "Origin"); }
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, mcp-session-id, X-DreamGraph-Session, X-DreamGraph-Instance, X-DreamGraph-Dry-Run, If-Match, If-None-Match, Last-Event-ID");
      res.setHeader("Access-Control-Expose-Headers", "mcp-session-id, X-DreamGraph-Session, ETag");
      if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return null; }
    }
    const path = new URL(req.url || "/", "http://local").pathname;
    const header = req.headers["x-dreamgraph-session"], scoped = readSessionCookie(req, this.sessionCookie);
    const legacy = typeof header !== "string" && scoped === undefined ? readSessionCookie(req, LEGACY_SESSION_COOKIE) : undefined;
    const provided = typeof header === "string" ? header : scoped ?? legacy;
    const health = req.method === "GET" && path === "/health" && !upgrade;
    // Liveness belongs to the instance, not a conversation. Native probes have
    // no cookie jar; minting a durable identity here exhausts the session store.
    const healthContext = (): SessionContext => ({ principal: this.policy.principal, session_id: "stateless-health",
      channel: "stdio", directory: this.sessions.directory, environment: {}, continuation_key: "unbound-health" });
    if (provided !== undefined) {
      const executionPort = ["/api/architect/v1/execution/command", "/api/architect/v1/execution/context/refresh", "/api/architect/v1/execution/context/deliver"].includes(path);
      if (provided.startsWith("dgexec.") && !(["/mcp", "/mcp/"].includes(path) || executionPort && req.method === "POST")) {
        if (res) json(res, 403, { error: "EXECUTION_TRANSPORT_SCOPE_REJECTED" }); return null;
      }
      if (health && !this.policy.remote) return healthContext();
      try { const context = provided.startsWith("dgexec.") ? authenticateExecutionPolicy(provided, this.policy.principal, this.sessions.directory) : await this.sessions.authenticate(provided, this.policy.principal);
        bindAuthenticatedSessionBearer(req, provided);
        if (legacy !== undefined && res && !health) this.setSessionCookie(res, provided);
        return health ? healthContext() : context; }
      catch (error) {
        // A cookie can belong to a different port/instance (global pre-fix cookie) or to an expired session.
        // Only fresh document navigation (or explicit remote login) may disregard it.
        const document = req.method === "GET" && !path.startsWith("/api/") && !["/mcp", "/mcp/"].includes(path)
          && (req.headers.accept?.includes("text/html") || ["/", "/architect", "/architect/", "/explorer", "/explorer/", "/config", "/schedules", "/status", "/docs"].includes(path));
        const login = path === "/auth" && req.method === "POST";
        const rejectedCredential = error instanceof Error && ["SESSION_BEARER_INVALID", "SESSION_AUTHORITY_REJECTED"].includes(error.message);
        // A cookie (legacy or this instance's scoped one) that is merely expired/invalid must not lock the operator out
        // of the UI: fresh document navigation mints a new session, exactly as with no cookie at all. Explicit
        // X-DreamGraph-Session headers, API effects, WebSocket upgrades and execution bearers still fail closed.
        if (!(typeof header !== "string" && !provided.startsWith("dgexec.") && rejectedCredential && !upgrade && (document || login))) {
          if (res) json(res, 401, { error: "SESSION_BEARER_REJECTED" }); return null;
        }
      }
    }
    const authorization = req.headers.authorization;
    let authenticated = !this.policy.remote || tokenMatches(authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined, this.policy.token);
    if (this.policy.remote && path === "/auth" && req.method === "POST" && req.headers["content-type"]?.startsWith("application/x-www-form-urlencoded") && gate.origin) {
      const form = new URLSearchParams(await readBody(req)); authenticated = tokenMatches(form.get("token") || undefined, this.policy.token);
    }
    if (!authenticated) {
      if (res && req.method === "GET" && req.headers.accept?.includes("text/html")) {
        res.writeHead(401, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" });
        res.end('<!doctype html><html lang="en"><meta charset="utf-8"><title>DreamGraph authentication</title><h1>DreamGraph remote access</h1><form action="/auth" method="post"><label>Daemon access token <input type="password" name="token" autocomplete="off" required></label><button>Connect</button></form>');
      } else if (res) json(res, 401, { error: "REMOTE_AUTHENTICATION_REQUIRED" }); return null;
    }
    if (upgrade) return null; // WebSockets require an established session bearer.
    if (health) return healthContext(); // Host/origin and remote authentication already passed.
    // Node's native fetch also sends Sec-Fetch-Mode: cors. It does not carry a
    // browser cookie jar, Origin or Sec-Fetch-Site; don't mint an inaccessible
    // browser owner for a native MCP initialization on that header alone.
    const browser = !!req.headers["sec-fetch-site"] || !!gate.origin || req.headers.accept?.includes("text/html") || path.startsWith("/architect") || path.startsWith("/api/architect");
    if (!browser && (path === "/mcp" || path === "/mcp/")) return {
      principal: this.policy.principal, session_id: "mcp-initialize", channel: "mcp", directory: this.sessions.directory, environment: {}, continuation_key: "unbound" };
    let session: Awaited<ReturnType<SessionAuthority["create"]>>;
    try { session = await this.sessions.create(this.policy.principal); }
    catch (error) {
      const code = error instanceof Error ? error.message.split(":", 1)[0] : "";
      if (!["SESSION_CAPACITY", "SESSION_AUTHORITY_CAPACITY", "GRAPH_RECOVERY_REQUIRED"].includes(code)) throw error;
      if (res) { res.setHeader("Retry-After", "30"); json(res, 503, { error: code, message: code === "GRAPH_RECOVERY_REQUIRED"
        ? "Session authority requires publication recovery. Existing data was preserved."
        : "Session capacity reached. Reuse an existing session or wait for expired sessions to be reclaimed; active identities were preserved." }); }
      return null;
    }
    if (res) {
      this.setSessionCookie(res, session.bearer);
      res.setHeader("X-DreamGraph-Session", session.bearer);
      if (path === "/auth" && req.method === "POST") { res.writeHead(303, { Location: "/" }); res.end(); return null; }
    }
    bindAuthenticatedSessionBearer(req, session.bearer);
    return session.context;
  }
  async handle(req: IncomingMessage, res: ServerResponse, context: SessionContext): Promise<boolean> {
    const path = new URL(req.url || "/", "http://local").pathname;
    if (req.method === "GET" && path === "/api/authority/v1/status") {
      json(res, 200, { ...this.publicStatus(), principal: context.principal, session_id: context.session_id }); return true;
    }
    if (req.method === "GET" && path === "/api/authority/v1/grants") {
      json(res, 200, { ok: true, grants: await this.sessions.ownGrants(context) }); return true;
    }
    if (!path.startsWith("/api/authority/v1/")) return false;
    // Grant issuance is a human browser control port, never an advertised model/MCP tool.
    if (req.method !== "POST" || context.channel !== "browser" || context.execution_policy || !req.headers.origin || !req.headers["sec-fetch-mode"]
      || !req.headers["content-type"]?.startsWith("application/json")) { json(res, 403, { error: "HUMAN_BROWSER_CONTROL_REQUIRED" }); return true; }
    try {
      const body = JSON.parse(await readBody(req));
      let result: unknown;
      if (path === "/api/authority/v1/scoped-computer/confirm") result = await this.sessions.grantScopedComputer(context, body);
      else if (path === "/api/authority/v1/full-access/begin") result = await this.sessions.beginFullAccess(context, body);
      else if (path === "/api/authority/v1/full-access/confirm") result = await this.sessions.confirmFullAccess(context, body);
      else if (path === "/api/authority/v1/grants/revoke") result = await this.sessions.revoke(context, body.grant_id);
      else { json(res, 404, { error: "AUTHORITY_ROUTE_NOT_FOUND" }); return true; }
      json(res, 200, { ok: true, result });
    } catch (error) { json(res, 400, { error: error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "AUTHORITY_REQUEST_REJECTED" }); }
    return true;
  }
}
