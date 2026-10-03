#!/usr/bin/env node

/**
 * DreamGraph MCP Server — Entry point.
 *
 * Supports two transport modes:
 *   --transport stdio   (default) JSON-RPC over stdin/stdout
 *   --transport http    Streamable HTTP (MCP 2025-03-26 spec) on a given port
 *
 * Options:
 *   --port <number>     Port for HTTP mode (default: 8100)
 *
 * Examples:
 *   dreamgraph                               # stdio (default)
 *   dreamgraph --transport http              # Streamable HTTP on :8100
 *   dreamgraph --transport http --port 9000  # Streamable HTTP on :9000
 */

import type { Socket } from "node:net";
import { DaemonHttpAuthority } from "./server/http-authority.js";
import { withSessionContext, type SessionContext } from "./server/session-context.js";
import { getDataDir } from "./utils/paths.js";
import { createServer } from "./server/server.js";
import { handleDashboardRoute, setDashboardContext } from "./server/dashboard.js";
import { handleApiRoute } from "./api/routes.js";
import { handleExplorerRoute } from "./explorer/routes.js";
import { startDataDirWatcher } from "./graph/watcher.js";
import { resolveInstanceAtStartup, updateInstanceCounters } from "./instance/index.js";
import { engine } from "./cognitive/engine.js";
import { initLlmProvider } from "./cognitive/llm.js";
import { logger } from "./utils/logger.js";
import { getRuntimeMetricsSnapshotV1 } from "./observability/runtime-metrics.js";
import { bootstrapPlugins } from "./plugins/manager.js";
import { recoverGraphPublication } from "./graph/publication.js";
import { recoverSourceEffects } from "./graph/change-obligations.js";

/* ------------------------------------------------------------------ */
/*  CLI argument parsing                                              */
/* ------------------------------------------------------------------ */

type TransportMode = "stdio" | "http";

interface CLIOptions {
  transport: TransportMode;
  port: number;
}

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  let transport: TransportMode = "stdio";
  let port = 8100;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--transport": {
        const val = args[++i];
        if (val === "stdio" || val === "http") {
          transport = val;
        } else {
          console.error(`Unknown transport "${val}". Use "stdio" or "http".`);
          process.exit(1);
        }
        break;
      }
      case "--port": {
        port = parseInt(args[++i], 10);
        if (isNaN(port) || port < 1 || port > 65535) {
          console.error("--port must be a valid port number (1–65535).");
          process.exit(1);
        }
        break;
      }
      case "--help":
      case "-h":
        console.log(
          [
            "Usage: dreamgraph [options]",
            "",
            "Options:",
            "  --transport <stdio|http>  Transport mode (default: stdio)",
            "  --port <number>           Port for HTTP mode  (default: 8100)",
            "  --help, -h                Show this help message",
          ].join("\n"),
        );
        process.exit(0);
        break;
      default:
        console.error(`Unknown option: ${args[i]}`);
        process.exit(1);
    }
  }

  return { transport, port };
}

/* ------------------------------------------------------------------ */
/*  Transport launchers                                               */
/* ------------------------------------------------------------------ */

/** Start in STDIO mode — JSON-RPC over stdin/stdout. */
async function startStdio(): Promise<void> {
  const { StdioServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/stdio.js"
  );

  const { randomUUID } = await import("node:crypto");
  const identity: SessionContext = { principal: "local-machine", session_id: `stdio:${randomUUID()}`, directory: getDataDir(), channel: "stdio", environment: {}, continuation_key: randomUUID() };
  const server = createServer(identity);
  identity.sampling_server = server.server;
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("DreamGraph MCP Server running on stdio");
}

/**
 * Start in Streamable HTTP mode (MCP 2025-03-26 spec).
 *
 * Single endpoint:  POST /mcp  — JSON-RPC messages (response may be SSE stream or JSON)
 *                   GET  /mcp  — open standalone SSE stream for server-initiated notifications
 *                   DELETE /mcp — close session
 *
 * Each connecting client gets its own transport + McpServer instance
 * so sessions are fully isolated.
 */
async function startHTTP(port: number): Promise<void> {
  const http = await import("node:http");
  const crypto = await import("node:crypto");
  const { StreamableHTTPServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/streamableHttp.js"
  );

  const authority = new DaemonHttpAuthority(port);

  // Map sessionId → { server, transport } for multi-client support
  const sessions = new Map<
    string,
    {
      transport: InstanceType<typeof StreamableHTTPServerTransport>;
      server: ReturnType<typeof createServer>;
      identity: SessionContext;
      browser_session_id: string | null;
    }
  >();

  // Start the data dir watcher before accepting requests so explorer,
  // dashboard, and SSE surfaces all bind to the active instance-scoped
  // data directory resolved during startup.
  startDataDirWatcher();

  // Provide runtime context to dashboard (session count, port)
  setDashboardContext({ getSessionCount: () => sessions.size, port, authority: authority.publicStatus() });

  const httpServer = http.createServer(async (req, res) => {
    try {
      const identity = await authority.authorize(req, res);
      if (!identity) return;
      await withSessionContext(identity, async () => {
      if (await authority.handle(req, res, identity)) return;
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    if (req.method === "GET" && url.pathname === "/api/contracts/v1/mcp") {
      const { coreCatalog } = await import("./server/core-catalog.js");
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(coreCatalog())); return;
    }

    // ---- /mcp — the single Streamable HTTP endpoint ----------------
    // Accept both "/mcp" and "/mcp/" so clients (e.g. VS Code Copilot Chat)
    // that append a trailing slash to the configured URL still resolve.
    if (url.pathname === "/mcp" || url.pathname === "/mcp/") {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      // Existing session? Route to its transport.
      if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId)!;
        if (session.identity.principal !== identity.principal || session.browser_session_id && session.browser_session_id !== identity.session_id
          || session.identity.execution_policy?.id !== identity.execution_policy?.id) {
          res.writeHead(403, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "MCP_SESSION_OWNER_MISMATCH" })); return;
        }
        await withSessionContext(session.identity, () => session.transport.handleRequest(req, res));
        return;
      }

      if (sessionId) { res.writeHead(404, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "MCP_SESSION_UNKNOWN" })); return; }
      // Only sessionless POST may initialize a new transport.
      // Create a new transport + server pair.
      if (req.method === "POST") {
        if (sessions.size >= 256) { res.writeHead(503); res.end(); return; }
        const nativeId = crypto.randomUUID();
        const sessionIdentity: SessionContext = { ...identity, channel: "mcp",
          session_id: identity.channel === "browser" ? identity.session_id : nativeId,
          continuation_key: identity.channel === "browser" ? identity.continuation_key : crypto.randomBytes(32).toString("base64url") };
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => nativeId,
          onsessioninitialized: (id) => {
            logger.info(`Streamable HTTP session initialized: ${id}`);
            sessions.set(id, { transport, server, identity: sessionIdentity, browser_session_id: identity.channel === "browser" ? identity.session_id : null });
          },
        });

        // Clean up on transport close
        transport.onclose = () => {
          const id = transport.sessionId;
          if (id) {
            logger.info(`Session closed: ${id}`);
            const closed = sessions.get(id); sessions.delete(id);
            if(closed)void withSessionContext(closed.identity,async()=>{
              try{await (await import("./cognitive/lucid.js")).cancelLucidSession();}
              finally{await closed.server.close();}
            }).catch(error=>logger.error(`Session closure requires recovery: ${String(error)}`));
          }
        };

        // Create a dedicated McpServer for this session
        const server = withSessionContext(sessionIdentity, () => createServer(sessionIdentity));
        sessionIdentity.sampling_server = server.server;
        await server.connect(transport);

        // Now handle the original request (the initialize message)
        try { await withSessionContext(sessionIdentity, () => transport.handleRequest(req, res)); }
        finally { if (!transport.sessionId) await server.close(); }
        return;
      }

      // GET or DELETE without a valid session
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid or missing session" }));
      return;
    }

    // ---- /metrics — canonical runtime observability snapshot ------------
    if (req.method === "GET" && url.pathname === "/metrics") {
      const enabled =
        process.env.DREAMGRAPH_ENABLE_RUNTIME_METRICS === "1" ||
        process.env.DREAMGRAPH_ENABLE_RUNTIME_METRICS === "true" ||
        process.env.DREAMGRAPH_METRICS_ENABLED === "1" ||
        process.env.DREAMGRAPH_METRICS_ENABLED === "true";
      if (!enabled) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Runtime metrics endpoint is disabled. Set DREAMGRAPH_METRICS_ENABLED=true (or DREAMGRAPH_ENABLE_RUNTIME_METRICS=true) to enable /metrics." }));
        return;
      }

      const hostHeader = req.headers.host ?? "";
      const isLocalHost = hostHeader.startsWith("localhost") || hostHeader.startsWith("127.0.0.1") || hostHeader.startsWith("[::1]");
      if (!isLocalHost) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Runtime metrics endpoint is restricted to local/private access in M1." }));
        return;
      }

      const snapshot = await getRuntimeMetricsSnapshotV1();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(snapshot));
      return;
    }

    // ---- /health — JSON for programmatic clients, HTML for browsers --
    if (req.method === "GET" && url.pathname === "/health") {
      const accept = req.headers.accept ?? "";
      const wantsJSON =
        accept.includes("application/json") ||
        !accept.includes("text/html");
      if (wantsJSON) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "ok",
            transport: "streamable-http",
            sessions: sessions.size,
            authority: authority.publicStatus(),
          }),
        );
        return;
      }
      // Fall through to dashboard for HTML rendering
    }

    // ---- /architect + /api/architect/* — Standalone Architect Phase 1 ----
    if (
      url.pathname === "/architect" ||
      url.pathname.startsWith("/architect/") ||
      url.pathname === "/api/architect" ||
      url.pathname === "/api/architect/" ||
      url.pathname.startsWith("/api/architect/")
    ) {
      const { handleArchitectRoute } = await import("./architect/routes.js");
      const handled = await handleArchitectRoute(req, res, url.pathname);
      if (handled) return;
    }

    // ---- /api/* — REST API endpoints for extension / HTTP clients ----
    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApiRoute(req, res, url.pathname);
      if (handled) return;
    }

    // ---- /explorer + /explorer/* — DreamGraph Explorer ----
    if (url.pathname === "/explorer" || url.pathname.startsWith("/explorer/")) {
      const handled = await handleExplorerRoute(req, res, url.pathname);
      if (handled) return;
    }

    // ---- Dashboard pages: /, /status, /schedules, /config, /docs, /health --
    if (req.method === "GET" || (req.method === "POST" && (url.pathname === "/config" || url.pathname === "/config/test-db" || url.pathname === "/config/clear-db" || url.pathname === "/datastores/scan" || url.pathname === "/schedules" || url.pathname === "/restart"))) {
      const handled = await handleDashboardRoute(req, res, url.pathname);
      if (handled) return;
    }

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      });
    } catch (error) {
      logger.error(`HTTP request failed (${req.method ?? "UNKNOWN"} ${req.url ?? "/"}): ${(error as Error).message}`);
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
      if (!res.writableEnded) res.end(JSON.stringify({ error: "internal_error" }));
    }
  });

  httpServer.on("upgrade", async (req, socket: Socket, head) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    if (!url.pathname.startsWith("/api/architect/v1/terminal/")) {
      socket.destroy();
      return;
    }
    try {
      const identity = await authority.authorize(req, undefined, true);
      if (!identity) { socket.destroy(); return; }
      const { handleArchitectTerminalUpgrade } = await import("./architect/routes.js");
      const handled = await withSessionContext(identity, () => handleArchitectTerminalUpgrade(req, socket, head, url.pathname));
      if (!handled) socket.destroy();
    } catch (error) {
      logger.error(`Architect terminal WebSocket upgrade failed: ${(error as Error).message}`);
      socket.destroy();
    }
  });

  httpServer.listen(port, authority.policy.bind, () => {
    logger.info(
      `DreamGraph MCP Server running on ${authority.policy.bind}:${port} — remote=${authority.policy.remote}, authentication=${authority.policy.remote ? "required" : "local-machine"}`,
    );
  });
}

/* ------------------------------------------------------------------ */
/*  Main                                                              */
/* ------------------------------------------------------------------ */

const opts = parseArgs();

// Resolve instance scope before starting any transport.
// In instance mode this sets the active InstanceScope and wires
// all three resolvers (dataDir, paths, mutex).  In legacy mode
// (no DREAMGRAPH_INSTANCE_UUID env var) this is a harmless no-op.
resolveInstanceAtStartup()
  .then(async () => {
    // Establish sole physical-store ownership and recover before accepting readers/jobs.
    const recovered = await recoverGraphPublication();
    const effects = await recoverSourceEffects();
    if (effects.unknown.length) logger.warn(`${effects.unknown.length} source effect(s) require recovery; their dirty scope remains explicit.`);
    if (recovered !== "clean") logger.warn(`Recovered graph publication: ${recovered}`);
    // Hydrate cognitive engine counters from persisted dream graph
    await engine.hydrate();

    // Initialize the LLM provider for dream cycles
    const llm = initLlmProvider();
    const available = await llm.isAvailable();
    if (available) {
      logger.info(`LLM provider "${llm.name}" is online — dreams will use LLM`);
    } else {
      logger.warn(`LLM provider "${llm.name}" is NOT reachable — dreams will be structural-only (degraded)`);
    }

    // Sync instance.json counters with actual persisted values
    const cycles = engine.getCurrentDreamCycle();
    if (cycles > 0) {
      await updateInstanceCounters({ total_dream_cycles: cycles });
    }

    // M3 — Discover and load plugins. Bootstrap is idempotent and safely
    // no-ops in legacy mode (no active scope).
    try {
      const result = await bootstrapPlugins();
      if (!result.ran && result.reason && result.reason !== "no-active-scope") {
        logger.debug(`Plugin bootstrap skipped: ${result.reason}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`Plugin bootstrap failed: ${msg}`);
    }

    // Start transport
    const transportPromise = opts.transport === "http" ? startHTTP(opts.port) : startStdio();
    await transportPromise;
  })
  .catch((err) => {
    logger.error("Fatal error:", err);
    process.exit(1);
  });
