import { spawn as spawnChild } from "node:child_process";
import { CLI_VERSION } from "../cli/version.js";
import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type CallToolResult,
  type ServerCapabilities,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";

const HOST_MCP_URL = process.env.DREAMGRAPH_HOST_MCP_URL ?? "";
const AUDIT_DIR = process.env.DREAMGRAPH_BRIDGE_AUDIT_DIR ?? "";
const RUN_ID = process.env.DREAMGRAPH_RUN_ID ?? "";
const AUDIT_PATH = process.env.DREAMGRAPH_AUDIT_PATH
  ?? (AUDIT_DIR.length > 0 && RUN_ID.length > 0
    ? join(AUDIT_DIR, `${RUN_ID.replace(/[^A-Za-z0-9._-]/g, "_")}.ndjson`)
    : "");
const SERVER_NAME = process.env.DREAMGRAPH_BRIDGE_SERVER_NAME ?? "dreamgraph";
const WORKSPACE_ROOT = process.env.DREAMGRAPH_WORKSPACE_ROOT ?? process.cwd();
const HEALTH_TIMEOUT_MS = Number.parseInt(process.env.DREAMGRAPH_BRIDGE_HEALTH_TIMEOUT_MS ?? "", 10);
const HEALTH_BUDGET_MS = Number.isFinite(HEALTH_TIMEOUT_MS) && HEALTH_TIMEOUT_MS > 0
  ? HEALTH_TIMEOUT_MS
  : 15_000;
const AUDIT_BODY_LIMIT = 16 * 1024;
const AUDIT_QUEUE_LIMIT = 256;
const AUDIT_SHUTDOWN_BUDGET_MS = 2_000;
const MANAGED_CONTEXT = process.env.DREAMGRAPH_BRIDGE_SESSION_BEARER?.startsWith("dgexec.") === true;
/** DreamGraph's Computer Use browser tools (served by the daemon for an execution with Computer Use granted). */
const COMPUTER_USE_TOOL = /^browser_[a-z_]+$/;
/** Set only when the instance policy is "ask" and this pass has no grant: the executor may request it. */
const COMPUTER_USE_REQUESTABLE = process.env.DREAMGRAPH_BRIDGE_COMPUTER_USE_REQUESTABLE === "1";
type ContextDelivery = { receipt_id: string; block: string; delivery: "unattested" };
const deliveries = new Map<string | number, ContextDelivery>();
const transportReleases = new Map<string | number, () => void>();
const pendingAcknowledgements = new Set<Promise<unknown>>();
let contextUnavailable = false;
let precedingToolTransport = Promise.resolve();
let queuedToolCalls = 0;

async function contextTransport(action: "refresh" | "deliver", body: unknown, signal?: AbortSignal) {
  const response = await fetch(new URL(`/api/architect/v1/execution/context/${action}`, HOST_MCP_URL), {
    method: "POST", headers: { "Content-Type": "application/json", "X-DreamGraph-Session": process.env.DREAMGRAPH_BRIDGE_SESSION_BEARER ?? "" },
    body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
  });
  const bytes = Number(response.headers.get("content-length"));
  if (Number.isFinite(bytes) && bytes > 256 * 1024) throw new Error("CLI_CONTEXT_RESPONSE_BYTE_BOUND");
  const reader = response.body?.getReader(); if (!reader) throw new Error("CLI_CONTEXT_RESPONSE_MISSING");
  const chunks: Uint8Array[] = []; let consumed = 0;
  try { for (;;) { const next = await reader.read(); if (next.done) break;
    consumed += next.value.byteLength; if (consumed > 256 * 1024) throw new Error("CLI_CONTEXT_RESPONSE_BYTE_BOUND"); chunks.push(next.value); } }
  finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!response.ok) throw new Error(`CLI_CONTEXT_TRANSPORT_FAILED:${response.status}`);
  const result = JSON.parse(raw);
  if (typeof result.receipt_id !== "string" || !["unattested", "delivered"].includes(result.delivery)
    || action === "refresh" && (typeof result.block !== "string" || Buffer.byteLength(result.block) > 65536)) throw new Error("CLI_CONTEXT_RESPONSE_INVALID");
  return result;
}

function bail(code: number, message: string): never {
  try {
    process.stderr.write(`[architect-cli-mcp-bridge] ${message}\n`);
  } catch {
    // ignore stderr failures during shutdown
  }
  process.exit(code);
}

if (HOST_MCP_URL.length === 0) {
  bail(2, "DREAMGRAPH_HOST_MCP_URL is required; refusing to start without an upstream DreamGraph MCP endpoint.");
}

let upstreamUrl: URL;
try {
  upstreamUrl = new URL(HOST_MCP_URL);
} catch (error) {
  bail(2, `DREAMGRAPH_HOST_MCP_URL is not a valid URL: ${(error as Error).message}`);
}

if (AUDIT_PATH.length > 0) {
  try {
    mkdirSync(dirname(AUDIT_PATH), { recursive: true });
  } catch (error) {
    process.stderr.write(`[architect-cli-mcp-bridge] failed to ensure audit dir: ${(error as Error).message}\n`);
  }
}

const upstream = new Client(
  { name: "dreamgraph-architect-cli-mcp-bridge", version: CLI_VERSION },
  { capabilities: {} },
);
const upstreamTransport = new StreamableHTTPClientTransport(upstreamUrl, { requestInit: { headers:
  process.env.DREAMGRAPH_BRIDGE_SESSION_BEARER ? { "X-DreamGraph-Session": process.env.DREAMGRAPH_BRIDGE_SESSION_BEARER } : {} } });

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let handle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    handle = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    handle.unref?.();
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (handle) clearTimeout(handle);
  }
}

async function main(): Promise<void> {
  let started = false;
  upstreamTransport.onclose = () => {
    if (!started) {
      bail(3, `upstream MCP transport closed before initialize completed: ${HOST_MCP_URL}`);
    }
    void shutdown(0);
  };

  try {
    await withTimeout(upstream.connect(upstreamTransport), HEALTH_BUDGET_MS, "upstream MCP connect");
  } catch (error) {
    bail(3, `failed to connect to upstream DreamGraph MCP at ${HOST_MCP_URL}: ${(error as Error).message}`);
  }

  started = true;
  const upstreamCaps: ServerCapabilities = upstream.getServerCapabilities() ?? {};
  const upstreamInstructions = upstream.getInstructions();
  const server = new Server(
    { name: SERVER_NAME, version: CLI_VERSION },
    {
      capabilities: upstreamCaps,
      ...(upstreamInstructions !== undefined ? { instructions: upstreamInstructions } : {}),
    },
  );

  const toolPages = new Map<string, ReturnType<typeof upstream.listTools>>();
  server.setRequestHandler(ListToolsRequestSchema, async (req, extra) => {
    const key = req.params?.cursor ?? "";
    if (!toolPages.has(key)) {
      if (toolPages.size >= 256) throw new Error("MCP_DISCOVERY_PAGE_LIMIT");
      toolPages.set(key, upstream.listTools(req.params, { signal: extra.signal }));
    }
    let result;
    try {
      result = await toolPages.get(key)!;
    } catch (error) {
      toolPages.delete(key);
      throw error;
    }
    // A local extension appears once, on the final page, never on every page.
    if (result.nextCursor || result.tools.some((tool) => tool.name === RUN_COMMAND_TOOL.name)) return result;
    return { ...result, tools: [...result.tools, RUN_COMMAND_TOOL, ...(COMPUTER_USE_REQUESTABLE ? [REQUEST_COMPUTER_USE_TOOL] : [])] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
    if (queuedToolCalls >= 128) throw new Error("CLI_TOOL_TRANSPORT_QUEUE_BOUND");
    queuedToolCalls++;
    const preceding = precedingToolTransport;
    let release!: () => void;
    precedingToolTransport = new Promise<void>(done => { release = () => { queuedToolCalls--; done(); }; });
    await preceding;
    try { extra.signal.throwIfAborted(); if (contextUnavailable) throw new Error("CLI_CONTEXT_RECOVERY_REQUIRED: previous owner result retained; restart only after reviewing its receipts and context failure"); }
    catch (error) { release(); throw error; }
    transportReleases.set(extra.requestId, release);
    const startedAtEpochMs = Date.now();
    const correlationId = randomUUID();
    const inputJson = safeStringify(req.params.arguments ?? {});
    auditCallResult({
      tool: req.params.name,
      inputJson,
      resultJson: "",
      isError: false,
      status: "running",
      durationMs: 0,
      startedAtEpochMs,
      correlationId,
    });
    try {
      let result = req.params.name === RUN_COMMAND_TOOL.name
        ? await runLocalCommand(req.params.arguments ?? {}, extra.signal)
        : req.params.name === REQUEST_COMPUTER_USE_TOOL.name
          ? requestComputerUse(req.params.arguments ?? {})
          : await upstream.callTool(req.params, undefined, { signal: extra.signal });
      // A Computer Use browser action changes no graph context: no context block after every click and screenshot.
      if (MANAGED_CONTEXT && !COMPUTER_USE_TOOL.test(req.params.name)) {
        try {
          const delivery = await contextTransport("refresh", {}, extra.signal) as ContextDelivery;
          if (!Array.isArray(result.content)) throw new Error("CLI_OWNER_RESULT_CONTENT_INVALID");
          result = { ...result, content: [...result.content, { type: "text", text: delivery.block }],
            _meta: { ...result._meta, dreamgraph_required_context: { receipt_id: delivery.receipt_id,
              delivery: "unattested", mechanism: "whole CLI MCP tool-result transport; provider retention/understanding unconfirmed" } } };
          deliveries.set(extra.requestId, delivery);
        } catch (error) {
          contextUnavailable = true;
          if (!Array.isArray(result.content)) throw error;
          // Refresh failure cannot hide a committed owner's literal result or receipts.
          result = { ...result, isError: true, content: [...result.content, { type: "text", text: JSON.stringify({
            error: { code: "CLI_CONTEXT_REFRESH_FAILED", message: String(error) },
            effect_status: "Original owner result retained. Consult its receipts; refresh failure is not rollback. Further dispatch is stopped.",
          }) }], _meta: { ...result._meta, dreamgraph_context_failure: "recovery_required; no replacement context was delivered" } };
        }
      }
      const isError = Boolean((result as { isError?: unknown }).isError);
      auditCallResult({
        tool: req.params.name,
        inputJson,
        resultJson: safeStringify(result),
        isError,
        status: isError ? "failed" : "completed",
        durationMs: Math.max(0, Date.now() - startedAtEpochMs),
        startedAtEpochMs,
        correlationId,
      });
      return result;
    } catch (error) {
      transportReleases.delete(extra.requestId); release();
      auditCallResult({
        tool: req.params.name,
        inputJson,
        resultJson: safeStringify({ message: (error as Error).message }),
        isError: true,
        status: "failed",
        durationMs: Math.max(0, Date.now() - startedAtEpochMs),
        startedAtEpochMs,
        correlationId,
      });
      throw error;
    }
  });

  if (upstreamCaps.resources) {
    server.setRequestHandler(ListResourcesRequestSchema, async (req, extra) => upstream.listResources(req.params, { signal: extra.signal }));
    server.setRequestHandler(ListResourceTemplatesRequestSchema, async (req, extra) => upstream.listResourceTemplates(req.params, { signal: extra.signal }));
    server.setRequestHandler(ReadResourceRequestSchema, async (req, extra) => upstream.readResource(req.params, { signal: extra.signal }));
  }

  if (upstreamCaps.prompts) {
    server.setRequestHandler(ListPromptsRequestSchema, async (req, extra) => upstream.listPrompts(req.params, { signal: extra.signal }));
    server.setRequestHandler(GetPromptRequestSchema, async (req, extra) => upstream.getPrompt(req.params, { signal: extra.signal }));
  }

  const transport = new StdioServerTransport();
  const send = transport.send.bind(transport);
  transport.send = async message => {
    const candidateId = "result" in message || "error" in message ? message.id : undefined;
    const responseId = typeof candidateId === "string" || typeof candidateId === "number" ? candidateId : undefined;
    const delivery = responseId === undefined ? undefined : deliveries.get(responseId);
    const release = responseId === undefined ? undefined : transportReleases.get(responseId);
    if (responseId !== undefined) { deliveries.delete(responseId); transportReleases.delete(responseId); }
    try {
      await send(message);
      // This acknowledges exact bytes handed to the CLI's stdio transport, not opaque provider compaction.
      if (delivery) {
        const acknowledgement = contextTransport("deliver", { receipt_id: delivery.receipt_id, block: delivery.block });
        pendingAcknowledgements.add(acknowledgement);
        try { await acknowledgement; } catch (error) { contextUnavailable = true; throw error; }
        finally { pendingAcknowledgements.delete(acknowledgement); }
      }
    } finally { release?.(); }
  };
  transport.onclose = () => {
    void shutdown(0);
  };
  await server.connect(transport);
}

let shuttingDown = false;
async function shutdown(code: number): Promise<void> {
  if (shuttingDown) return; shuttingDown = true;
  await withTimeout(Promise.allSettled([...pendingAcknowledgements]), AUDIT_SHUTDOWN_BUDGET_MS, "context acknowledgement settlement")
    .catch(error => process.stderr.write(`[architect-cli-mcp-bridge] final context acknowledgement unconfirmed: ${String(error)}\n`));
  try {
    if (upstreamTransport.sessionId) await upstreamTransport.terminateSession();
    await upstream.close();
  } catch {
    // ignore shutdown failures
  }
  await withTimeout(flushAuditQueue(), AUDIT_SHUTDOWN_BUDGET_MS, "bridge audit flush").catch((error) => {
    process.stderr.write(`[architect-cli-mcp-bridge] audit flush incomplete: ${(error as Error).message}\n`);
  });
  process.exit(code);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void shutdown(0);
  });
}

main().catch((error) => {
  bail(1, `bridge fatal error: ${(error as Error).message}`);
});

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify(String(value));
  }
}

const RUN_COMMAND_TOOL: Tool = Object.freeze({
  name: "run_command",
  description:
    "[DreamGraph bridge support tool] Execute a shell command inside the workspace for build/test/verification tasks. " +
    "Use this instead of provider-inline shell tools; cwd is constrained to the workspace root.",
  inputSchema: {
    type: "object" as const,
    properties: {
      command: { type: "string", description: "Shell command to execute, for example npm run build." },
      cwd: { type: "string", description: "Working directory, relative to the workspace root. Defaults to the workspace root." },
      timeoutMs: { type: "number", description: "Timeout in milliseconds. Defaults to 60000, capped at 300000." },
    },
    required: ["command"],
  },
});

/**
 * Capability request, not a grant. The call is recorded in the audit trace; DreamGraph ends the pass
 * as "computer use requested", asks the local operator and, if allowed, re-runs the request with
 * Codex's native Computer Use enabled. Nothing is operated by this tool.
 */
const REQUEST_COMPUTER_USE_TOOL: Tool = Object.freeze({
  name: "request_computer_use",
  description:
    "[DreamGraph] Ask the local operator for permission to use Computer Use (operate this computer's browser/apps). " +
    "Call this ONLY when the task truly requires operating the computer, then stop and end your turn with one short sentence saying what you need it for. " +
    "If the operator allows it, the same request is run again with Computer Use enabled.",
  inputSchema: {
    type: "object" as const,
    properties: { reason: { type: "string", description: "One sentence: what you need to do on the computer and why." } },
    required: ["reason"],
  },
});
function requestComputerUse(args: unknown): LocalToolResult {
  const reason = typeof (args as { reason?: unknown })?.reason === "string" ? String((args as { reason: string }).reason).slice(0, 500) : "";
  return { content: [{ type: "text", text: `Computer Use requested from the local operator: ${(reason || "no reason given").replace(/[.\s]+$/, "")}. `
    + "Do not attempt Computer Use now. End your turn with one short sentence describing what you need to do on the computer." }] };
}

const RUN_COMMAND_DEFAULT_TIMEOUT_MS = 60_000;
const RUN_COMMAND_MAX_TIMEOUT_MS = 300_000;
const RUN_COMMAND_OUTPUT_LIMIT = 64 * 1024;

type LocalToolResult = CallToolResult;

async function runLocalCommand(args: unknown, signal: AbortSignal): Promise<LocalToolResult> {
  const target = new URL("/api/architect/v1/execution/command", HOST_MCP_URL);
  const response = await fetch(target, { method: "POST", headers: { "Content-Type": "application/json",
    "X-DreamGraph-Session": process.env.DREAMGRAPH_BRIDGE_SESSION_BEARER ?? "" }, body: JSON.stringify(args),
    signal: AbortSignal.any([signal, AbortSignal.timeout(RUN_COMMAND_MAX_TIMEOUT_MS + 10000)]) });
  const result = await response.json();
  return localTextResult(result, !response.ok || result.timedOut || result.exitCode !== 0);
}

function appendLimited(current: string, next: string): string {
  const combined = current + next;
  if (combined.length <= RUN_COMMAND_OUTPUT_LIMIT) return combined;
  return `${combined.slice(0, RUN_COMMAND_OUTPUT_LIMIT)}\n[output truncated]`;
}

function localTextResult(value: unknown, isError: boolean): LocalToolResult {
  return {
    content: [{ type: "text", text: `${JSON.stringify(value, null, 2)}\n` }],
    ...(isError ? { isError: true } : {}),
  };
}

interface AuditRecord {
  tool: string;
  inputJson: string;
  resultJson: string;
  isError: boolean;
  status: "running" | "completed" | "failed";
  durationMs: number;
  startedAtEpochMs: number;
  correlationId: string;
}

const auditQueue: string[] = [];
let auditDrain: Promise<void> | undefined;

function boundedAuditBody(value: string): { body: string; bytes: number; sha256: string; truncated: boolean } {
  const bytes = Buffer.byteLength(value, "utf8");
  const sha256 = createHash("sha256").update(value).digest("hex");
  if (bytes <= AUDIT_BODY_LIMIT) return { body: value, bytes, sha256, truncated: false };
  const encoded = Buffer.from(value, "utf8");
  let end = AUDIT_BODY_LIMIT;
  while (end > 0 && (encoded[end] & 0xc0) === 0x80) end--;
  return { body: encoded.subarray(0, end).toString("utf8"), bytes, sha256, truncated: true };
}

function auditCallResult(record: AuditRecord): void {
  if (AUDIT_PATH.length === 0) return;
  const input = boundedAuditBody(record.inputJson);
  const result = boundedAuditBody(record.resultJson);
  const line = `${JSON.stringify({
    server: SERVER_NAME,
    ...record,
    inputJson: input.body,
    resultJson: result.body,
    inputBytes: input.bytes,
    resultBytes: result.bytes,
    inputSha256: input.sha256,
    resultSha256: result.sha256,
    inputTruncated: input.truncated,
    resultTruncated: result.truncated,
  })}\n`;
  if (auditQueue.length >= AUDIT_QUEUE_LIMIT) {
    const replaceable = auditQueue.findIndex((queued) => queued.includes('"status":"running"'));
    if (replaceable >= 0) auditQueue.splice(replaceable, 1);
    else {
      process.stderr.write("[architect-cli-mcp-bridge] audit queue overflow; preserving existing terminal records\n");
      return;
    }
  }
  auditQueue.push(line);
  auditDrain ??= drainAuditQueue();
}

async function drainAuditQueue(): Promise<void> {
  try {
    while (auditQueue.length > 0) {
      const line = auditQueue.shift()!;
      await new Promise<void>((resolvePromise, reject) => {
        appendFile(AUDIT_PATH, line, { encoding: "utf8" }, (error) => error ? reject(error) : resolvePromise());
      });
    }
  } catch (error) {
    process.stderr.write(`[architect-cli-mcp-bridge] failed to write audit record: ${(error as Error).message}\n`);
  } finally {
    auditDrain = undefined;
    if (auditQueue.length > 0) auditDrain = drainAuditQueue();
  }
}

async function flushAuditQueue(): Promise<void> {
  while (auditDrain || auditQueue.length > 0) {
    if (auditDrain) await auditDrain;
    else auditDrain = drainAuditQueue();
  }
}
