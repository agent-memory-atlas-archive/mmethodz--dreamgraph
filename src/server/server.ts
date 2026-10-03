import { getSessionContext, withSessionContext, withoutSessionContext, type SessionContext } from "./session-context.js";
import { registerCoreCatalog } from "./core-catalog.js";
import { invokeToolBoundary, toolBoundaryError } from "./tool-boundary.js";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { coreToolPolicy } from "./tool-policy.js";
import { z, type ZodRawShape } from "zod";
import { updateConfig as updateEventConfig } from "../cognitive/event-router.js";
import { updateNarrativeConfig } from "../cognitive/narrator.js";
/**
 * DreamGraph MCP Server — Server setup and orchestration.
 *
 * Creates the McpServer instance and registers all resources and tools.
 * Transport-agnostic: callers provide the transport (Stdio, SSE, etc.)
 * and call `server.connect(transport)` themselves.
 *
 * The server sends `instructions` on initialization so AI agents know
 * how to use every tool from the first message — no trial-and-error.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { config } from "../config/config.js";
import { registerResources } from "../resources/register.js";
import { registerTools } from "../tools/register.js";
import {
  registerCognitiveResources,
  registerCognitiveTools,
} from "../cognitive/register.js";
import { registerDisciplineResource } from "../discipline/register.js";
import { registerPluginContributions } from "../plugins/contributions.js";
import { startScheduler, stopScheduler } from "../cognitive/scheduler.js";
import { startLlmReadinessWatcher, stopLlmReadinessWatcher } from "../cognitive/llm-readiness.js";
import { wireBootstrapOnReady } from "../cognitive/bootstrap-driver.js";
import { startWebhookWorker, stopWebhookWorker } from "../webhooks/worker.js";
import { recordToolCall } from "../instance/index.js";
import { recordToolCall as recordToolMetric } from "../utils/metrics.js";
import { logger } from "../utils/logger.js";
import { EngineJobs } from "../cognitive/jobs.js";

function buildInstructions(): string {
  const repoNames = Object.keys(config.repos);
  const repoList = repoNames.length > 0
    ? repoNames.map((r) => `- ${r}: ${config.repos[r]}`).join("\n")
    : "- none configured; run init_graph/scan_project or set DREAMGRAPH_REPOS";

  const defaultRepo = repoNames[0] ?? "REPO_NAME";
  const dbLine = config.database.connectionString.length > 0
    ? "\n- Database: query_db_schema(search?, table_name?) is available."
    : "";

  return `DreamGraph MCP Server v${config.server.version}

Purpose: project-aware cognitive knowledge graph for code, architecture, workflows, data models, ADRs, UI semantics, runtime senses, and dream/insight analysis.

Repos usable with repo-scoped tools:
${repoList}
Default repo hint: ${defaultRepo}

Core workflow:
1. Before substantial architectural work, inspect semantic quality with graph_health_report(); explain reasoning-impacting gaps instead of silently assuming graph completeness.
2. Recommend the smallest evidence-backed maintenance action: enrich_parser_nodes() before scan_project() when structure is current, and scan_project() before bootstrap_instance() when it is not. Execute maintenance only after the user requests or approves it.
3. Read code with list_directory(repo, dirPath?) and read_source_code(repo, filePath, entity?/range?). Prefer entity/range reads over full files.
4. Inspect graph/resources with query_resource(uri) and focused tools such as get_workflow(), search_data_model(), query_api_surface(), graph_rag_retrieve(), shortest_path().
5. Enrich durable facts with enrich_seed_data(), register_ui_element(), record_architecture_decision(), or solidify_cognitive_insight() when new knowledge is confirmed.
6. Explore speculative cognition with dream_cycle(), cognitive_status(), get_dream_insights(), get_temporal_insights(), get_causal_insights(), and get_remediation_plan().
7. After a major implementation or graph change, record richer semantics and schedule_dream() over the affected entities with at least two focus hops.

Common resources:
- System: system://overview, system://features, system://workflows, system://data-model, system://capabilities (runtime), system://capability-entities (project graph), system://index
- Core resources use revisioned whole-record pages. Follow query_resource continuation with the same URI/filter; an expired or changed-revision cursor requires restarting. Never treat a partial page or unavailable scope as complete evidence.
- Cognitive: dream://graph, dream://status, dream://tensions, dream://validated, dream://history, dream://adrs, dream://ui-registry, dream://story
- Discipline: discipline://manifest

Tool use rules:
- Prefer the narrowest factual tool for the question; avoid broad reads unless needed.
- Core graph output uses whole records and explicit paging/completeness. Follow continuation before claiming completeness; a result limit or prompt omission is never a complete empty result. Legacy source-text previews disclose their limits.
- Tool contract version 1 preserves structuredContent, content and provenance metadata. Refresh tools/list for owner schemas/effects; never automatically retry a mutation after an uncertain dispatch.
- For code edits, inspect the target/API first, preserve behavior unless asked to change it, then run the relevant build/test command when possible.${dbLine}
`;
}

let daemonRuntimeStarted = false;
let daemonRuntimeReady:Promise<void>=Promise.resolve();

/** Internal composition seam shared by the real server and transport qualification. */
export function configureToolBoundary(server:McpServer,identity?:SessionContext):void {
  // ---- Wrap server.tool() to auto-count every MCP tool invocation ----
  // The handler is always the last argument regardless of which overload
  // is used:  tool(name, cb) | tool(name, desc, cb) | tool(name, schema, cb)
  //          | tool(name, desc, schema, cb)
  const _originalTool = server.tool.bind(server);
  const shapes = new Map<string, ZodRawShape>();
  // SDK validation strips undeclared keys before callbacks. Fence original
  // wire arguments first, and normalize SDK errors through this same contract.
  const setHandler = server.server.setRequestHandler.bind(server.server);
  (server.server as any).setRequestHandler = (schema: unknown, handler: (...args: any[]) => any) => {
    if (schema !== CallToolRequestSchema) return (setHandler as any)(schema, handler);
    return (setHandler as any)(schema, async (request: any, extra: any) => {
      const name = request.params.name, shape = shapes.get(name);
      if (!shape) return toolBoundaryError(name, "TOOL_NOT_FOUND", "Tool is not registered on this session.");
      const dispatch = async () => {await daemonRuntimeReady;return invokeToolBoundary({ name, shape, args: request.params.arguments ?? {}, extra,
        handler: () => handler(request, extra) });};
      const owner = identity ?? getSessionContext();
      return owner ? withSessionContext(owner, dispatch) : dispatch();
    });
  };
  // Resources (including discipline://manifest and plugin callbacks) carry the
  // same captured owner as tools, even if the transport loses its async context.
  const originalResource = server.resource.bind(server);
  (server as any).resource = (...args: unknown[]) => {
    const last = args.length - 1, handler = args[last];
    if (typeof handler === "function") args[last] = (...handlerArgs: unknown[]) => {
      const owner = identity ?? getSessionContext();
      return owner ? withSessionContext(owner, () => handler(...handlerArgs)) : handler(...handlerArgs);
    };
    return (originalResource as any)(...args);
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server as any).tool = (...args: unknown[]) => {
    const lastIdx = args.length - 1;
    const originalHandler = args[lastIdx];
    const toolName = typeof args[0] === "string" ? args[0] : "unknown";
    const schemaIndex = typeof args[1] === "string" ? 2 : 1;
    const candidate = args[schemaIndex];
    const shape = candidate && typeof candidate === "object" && Object.values(candidate).every(value => value instanceof z.ZodType) ? candidate as ZodRawShape : null;
    shapes.set(toolName, shape ?? {});
    if (typeof originalHandler === "function") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      args[lastIdx] = async (...handlerArgs: any[]) => {
        // Fire-and-forget — don't block the tool response on counter I/O
        recordToolCall().catch(() => {});
        const startedAt = Date.now();
        let failed = false;
        let errorMsg: string | undefined;
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const owner = identity ?? getSessionContext();
          // Original wire arguments are fenced once by setRequestHandler, before
          // SDK validation. A callback fence would consume the same allowance again.
          const dispatch = async () => {await daemonRuntimeReady;return (originalHandler as any)(...handlerArgs);};
          const result = await (owner ? withSessionContext(owner, dispatch) : dispatch());
          failed = result.isError === true;
          return result;
        } catch (err) {
          failed = true;
          errorMsg = err instanceof Error ? err.message : String(err);
          throw err;
        } finally {
          try {
            recordToolMetric(toolName, Date.now() - startedAt, failed, errorMsg);
          } catch {
            // never let metrics break tool execution
          }
        }
      };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const registered = (_originalTool as any)(...args), policy = coreToolPolicy(toolName);
    registered.update({ annotations: { readOnlyHint: policy.read_only, destructiveHint: !policy.read_only, idempotentHint: policy.read_only },
      _meta: { dreamgraph: { contract_version: 1, policy } } });
    return registered;
  };

  // Modern SDK/plugin registrations use the same boundary as legacy .tool().
  const originalRegisterTool = server.registerTool.bind(server);
  (server as any).registerTool = (name: string, definition: any, handler: (...args: any[]) => any) => {
    const schema = definition.inputSchema;
    const shape = schema instanceof z.ZodObject ? schema.shape : schema ?? {};
    if (!Object.values(shape).every(value => value instanceof z.ZodType)) throw new Error("TOOL_SCHEMA_UNSUPPORTED");
    const policy = coreToolPolicy(name);
    shapes.set(name, shape);
    return originalRegisterTool(name, { ...definition,
      annotations: { ...definition.annotations, readOnlyHint: policy.read_only, destructiveHint: !policy.read_only, idempotentHint: policy.read_only },
      _meta: { ...definition._meta, dreamgraph: { contract_version: 1, policy } },
    }, async (...handlerArgs: any[]) => {
      recordToolCall().catch(() => {});
      const started = Date.now(), owner = identity ?? getSessionContext();
      const dispatch = async () => {await daemonRuntimeReady;return handler(...handlerArgs);};
      const result = await (owner ? withSessionContext(owner, dispatch) : dispatch());
      try { recordToolMetric(name, Date.now() - started, result.isError === true); } catch { /* Metrics never change outcomes. */ }
      return result;
    });
  };
}

export function createServer(identity?: SessionContext): McpServer {
  const server=new McpServer({name:config.server.name,version:config.server.version},{instructions:buildInstructions()});
  logger.info(`Initializing ${config.server.name} v${config.server.version}`);
  configureToolBoundary(server,identity);

  // Register all MCP resources (READ-ONLY context data)
  registerCoreCatalog(server);

  // M4 — Wire any plugin-contributed MCP tools/resources from the
  // manager's contribution registry onto this session's server.
  registerPluginContributions(server);

  // Daemon background work has no connecting client authority or sampling transport.
  if (!daemonRuntimeStarted) {
  daemonRuntimeStarted = true;
  daemonRuntimeReady=withoutSessionContext(async () => {
  // Recovery is independent of whether scheduled cognition is enabled.
  await new EngineJobs().recover();
  await (await import("../cognitive/lucid.js")).recoverLucidSession();
  // v5.2 — Start the dream scheduler
  updateEventConfig(config.events);
  updateNarrativeConfig(config.narrative);
  startScheduler(config.scheduler);

  // Readiness observes capability without allocating inference or bootstrap work.
  startLlmReadinessWatcher();

  // First ready fingerprints are recorded as pending explicit job admission.
  wireBootstrapOnReady();

  // M5 — Start outbound webhook delivery worker. Subscribes to the
  // graph event bus and fans events out to registered subscriptions.
  startWebhookWorker();

  // Clean shutdown — flush logs before exiting so daemon can verify
  const gracefulExit = async () => {
    stopLlmReadinessWatcher();
    stopScheduler();
    await new EngineJobs().cancelOwnedRunning();
    await stopWebhookWorker();
    logger.info("Shutdown requested; unresolved effects retain their recovery records");
    // Allow stderr to flush to the log file descriptor before exiting
    setTimeout(() => process.exit(0), 200);
  };
  const requestExit=()=>{void gracefulExit().catch(error=>logger.error(`Shutdown requires recovery: ${String(error)}`));};
  process.on("SIGINT", requestExit);
  process.on("SIGTERM", requestExit);
  });
  void daemonRuntimeReady.catch(error=>logger.error(`Daemon job recovery unavailable: ${String(error)}`));
  }

  return server;
}
