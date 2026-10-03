/**
 * Daemon-owned host for the Codex app's `cua_repl` Computer Use MCP server.
 *
 * Codex CLI on Windows kills its MCP server processes outright when it exits
 * (verified: no stdin close, `notify` fires only after exit), so nothing that
 * runs under Codex can perform the turn-end cleanup that releases claimed
 * browser tabs. DreamGraph therefore starts `cua_repl` itself, outside Codex's
 * process tree, and exposes it to Codex as a local Streamable-HTTP MCP server.
 * When the Architect run ends (completed, failed or cancelled) the daemon sends
 * the same hidden `turn_ended` call the Codex app's plugin hook would send, then
 * shuts the server down.
 *
 * The relay is message-for-message: Codex's JSON-RPC goes to the server's stdin
 * unchanged; responses return on the HTTP request that carried the call, and
 * server-initiated messages go out on the optional GET event stream.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { turnEndedRequest, turnIdsFromClientLine, type CodexTurnIds } from "./codex-cua-proxy.js";

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30 * 60 * 1000;

type JsonRpcMessage = { jsonrpc?: string; id?: string | number | null; method?: string; params?: unknown; result?: unknown; error?: unknown };

export interface CodexCuaHost {
  /** URL Codex connects to (`[mcp_servers.cua_repl] url = …`). */
  url: string;
  /** Codex turn last seen on a tool call. */
  readonly turn: CodexTurnIds | null;
  /** Diagnostic log lines. */
  readonly log: readonly string[];
  /** Send `turn_ended` (if a turn was seen), then stop the server. Idempotent. */
  end(reason: string): Promise<void>;
}

export interface CodexCuaHostOptions {
  command: string;
  args: readonly string[];
  env: Record<string, string>;
  /** Milliseconds to wait for the `turn_ended` answer. */
  turnEndedTimeoutMs?: number;
}

export async function startCodexCuaHost(options: CodexCuaHostOptions): Promise<CodexCuaHost> {
  const log: string[] = [];
  const note = (text: string) => { log.push(`[${new Date().toISOString()}] ${text}`); if (log.length > 500) log.shift(); };
  const child: ChildProcessWithoutNullStreams = spawn(options.command, [...options.args], {
    stdio: ["pipe", "pipe", "pipe"], env: options.env, windowsHide: true,
  });
  note(`start ${options.command}`);
  let exited = false;
  child.on("exit", (code, signal) => { exited = true; note(`server exit ${code ?? signal}`); failAllPending("server exited"); });
  child.on("error", (error) => { exited = true; note(`server error ${error.message}`); failAllPending("server failed to start"); });
  child.stderr.on("data", () => { /* cua_repl logs to stderr; not relayed */ });

  let turn: CodexTurnIds | null = null;
  /** Set when Codex's own Stop/Interrupt hook already called turn_ended for the current turn. */
  let hookEnded = false;
  const pending = new Map<string, (message: JsonRpcMessage) => void>();
  const streams = new Set<ServerResponse>();
  const backlog: string[] = [];
  const key = (id: unknown) => JSON.stringify(id);

  function failAllPending(reason: string) {
    for (const [id, resolve] of pending) resolve({ jsonrpc: "2.0", id: JSON.parse(id) as string | number, error: { code: -32000, message: `cua_repl: ${reason}` } });
    pending.clear();
  }

  let outBuffer = "";
  child.stdout.on("data", (chunk: Buffer) => {
    outBuffer += chunk.toString("utf8");
    let nl: number;
    while ((nl = outBuffer.indexOf("\n")) >= 0) {
      const line = outBuffer.slice(0, nl).trim();
      outBuffer = outBuffer.slice(nl + 1);
      if (!line) continue;
      let message: JsonRpcMessage;
      try { message = JSON.parse(line) as JsonRpcMessage; } catch { continue; }
      const isResponse = message.method === undefined && message.id !== undefined && message.id !== null;
      const waiter = isResponse ? pending.get(key(message.id)) : undefined;
      if (waiter) { pending.delete(key(message.id)); waiter(message); continue; }
      // Server-initiated request/notification: deliver on the event stream (or hold until one opens).
      const frame = `event: message\ndata: ${line}\n\n`;
      if (streams.size === 0) { backlog.push(frame); if (backlog.length > 200) backlog.shift(); }
      for (const stream of streams) stream.write(frame);
    }
  });

  const send = (message: JsonRpcMessage) => {
    if (exited || child.stdin.destroyed) return false;
    child.stdin.write(JSON.stringify(message) + "\n");
    return true;
  };

  const token = randomBytes(16).toString("hex");
  const path = `/mcp/${token}`;
  const server: Server = createServer((req, res) => { void handle(req, res); });

  async function handle(req: IncomingMessage, res: ServerResponse) {
    if ((req.url ?? "").split("?")[0] !== path) { res.writeHead(404).end(); return; }
    if (req.method === "GET") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      streams.add(res);
      for (const frame of backlog.splice(0)) res.write(frame);
      req.on("close", () => streams.delete(res));
      return;
    }
    if (req.method === "DELETE") { res.writeHead(200).end(); return; }
    if (req.method !== "POST") { res.writeHead(405).end(); return; }

    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX_BODY_BYTES) { res.writeHead(413).end(); return; }
      chunks.push(chunk as Buffer);
    }
    const body = Buffer.concat(chunks).toString("utf8");
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch {
      res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }));
      return;
    }
    const batch = Array.isArray(parsed);
    const messages = (batch ? parsed : [parsed]) as JsonRpcMessage[];
    const waits: Array<Promise<JsonRpcMessage>> = [];
    for (const message of messages) {
      const found = turnIdsFromClientLine(JSON.stringify(message));
      if (found && (found.turn_id !== turn?.turn_id || found.session_id !== turn?.session_id)) { turn = found; hookEnded = false; note(`turn ${found.session_id}/${found.turn_id}`); }
      const params = message.params as { name?: unknown; arguments?: { turn_id?: unknown; session_id?: unknown } } | undefined;
      if (message.method === "tools/call" && params?.name === "turn_ended") {
        hookEnded = true;
        note(`turn_ended via Codex hook (${String(params.arguments?.session_id ?? "?")}/${String(params.arguments?.turn_id ?? "?")})`);
      }
      const isRequest = typeof message.method === "string" && message.id !== undefined && message.id !== null;
      if (isRequest) {
        waits.push(new Promise<JsonRpcMessage>((resolve) => {
          pending.set(key(message.id), resolve);
          setTimeout(() => { if (pending.delete(key(message.id))) resolve({ jsonrpc: "2.0", id: message.id ?? null, error: { code: -32001, message: "cua_repl: request timed out" } }); }, REQUEST_TIMEOUT_MS).unref();
        }));
      }
      if (!send(message) && isRequest) failAllPending("server not running");
    }
    if (waits.length === 0) { res.writeHead(202).end(); return; }
    const replies = await Promise.all(waits);
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(batch ? replies : replies[0]));
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}${path}`;
  note(`listening ${url.replace(token, "…")}`);

  let ending: Promise<void> | null = null;
  return {
    url,
    get turn() { return turn; },
    log,
    end(reason: string) {
      ending ??= (async () => {
        if (hookEnded) {
          note(`end (${reason}): Codex hook already ended the turn`);
        } else if (turn && !exited) {
          note(`end (${reason}): turn_ended ${turn.session_id}/${turn.turn_id}`);
          const request = JSON.parse(turnEndedRequest(turn)) as JsonRpcMessage;
          const answer = await new Promise<JsonRpcMessage | null>((resolve) => {
            pending.set(key(request.id), resolve);
            setTimeout(() => { if (pending.delete(key(request.id))) resolve(null); }, options.turnEndedTimeoutMs ?? 8000).unref();
            send(request);
          });
          note(answer == null ? "turn_ended: no answer" : answer.error ? `turn_ended error ${JSON.stringify(answer.error).slice(0, 300)}` : "turn_ended ok");
        } else {
          note(`end (${reason}): ${turn ? "server already gone" : "no Computer Use turn seen"}`);
        }
        for (const stream of streams) stream.end();
        streams.clear();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        if (!exited) {
          child.stdin.end();
          await new Promise<void>((resolve) => {
            const timer = setTimeout(() => { try { child.kill(); } catch { /* ignore */ } resolve(); }, 4000);
            timer.unref();
            child.once("exit", () => { clearTimeout(timer); resolve(); });
          });
        }
      })();
      return ending;
    },
  };
}
