#!/usr/bin/env node
/**
 * DreamGraph stdio proxy between Codex CLI and the Codex app's `cua_repl`
 * Computer Use MCP server.
 *
 * In the Codex app, the `unified-computer-use` plugin ends every turn with a
 * hook that calls the hidden `cua_repl` tool `turn_ended`. That runs the
 * browser service's turn cleanup inside the same process (claimed tabs are
 * released, agent tabs closed). Codex does not load that plugin from
 * DreamGraph's isolated CODEX_HOME, so DreamGraph wires `cua_repl` directly and
 * the hook never fires: every run would leave its tab claims behind.
 *
 * This proxy forwards MCP traffic unchanged, remembers the Codex turn metadata
 * (`x-codex-turn-metadata` on tool calls), and sends `turn_ended` to the real
 * server itself when the turn ends: on Codex's `notify` (agent-turn-complete),
 * when Codex closes the connection, or on a termination signal.
 *
 * Modes:
 *   node codex-cua-proxy.js --proxy  <controlDir> -- <command> [args...]
 *   node codex-cua-proxy.js --notify <controlDir> [-- <chained notify command...>] <notify-json>
 */
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const TURN_COMPLETE_FILE = "turn-complete.json";
export const PROXY_LOG_FILE = "cua-proxy.log";
const TURN_ENDED_REQUEST_ID = "dreamgraph-turn-ended";

export interface CodexTurnIds { session_id: string; turn_id: string }

function idString(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : null;
}

/** Turn ids from a Codex → server JSON-RPC line (tools/call `_meta`). */
export function turnIdsFromClientLine(line: string): CodexTurnIds | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const message = JSON.parse(trimmed) as { method?: unknown; params?: { _meta?: Record<string, unknown> } };
    if (message.method !== "tools/call") return null;
    let meta: unknown = message.params?._meta?.["x-codex-turn-metadata"];
    if (typeof meta === "string") meta = JSON.parse(meta);
    if (!meta || typeof meta !== "object") return null;
    const m = meta as Record<string, unknown>;
    const session = idString(m.thread_source === "subagent" ? m.thread_id : m.session_id) ?? idString(m.thread_id);
    const turn = idString(m.turn_id);
    return session && turn ? { session_id: session, turn_id: turn } : null;
  } catch {
    return null;
  }
}

/** Turn ids from Codex's `notify` payload (agent-turn-complete). */
export function turnIdsFromNotify(json: string): CodexTurnIds | null {
  try {
    const p = JSON.parse(json) as Record<string, unknown>;
    const session = idString(p["thread-id"] ?? p.thread_id ?? p.session_id);
    const turn = idString(p["turn-id"] ?? p.turn_id);
    return session && turn ? { session_id: session, turn_id: turn } : null;
  } catch {
    return null;
  }
}

export function turnEndedRequest(ids: CodexTurnIds, hookEvent = "Stop"): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: TURN_ENDED_REQUEST_ID,
    method: "tools/call",
    params: { name: "turn_ended", arguments: { hook_event_name: hookEvent, session_id: ids.session_id, turn_id: ids.turn_id } },
  });
}

function log(controlDir: string, text: string): void {
  try { appendFileSync(join(controlDir, PROXY_LOG_FILE), `[${new Date().toISOString()}] ${text}\n`); } catch { /* best effort */ }
}

function readTurnComplete(controlDir: string): CodexTurnIds | null {
  try { return turnIdsFromNotify(readFileSync(join(controlDir, TURN_COMPLETE_FILE), "utf8")); } catch { return null; }
}

async function runProxy(controlDir: string, command: string, args: string[]): Promise<void> {
  mkdirSync(controlDir, { recursive: true });
  log(controlDir, `start ${command} ${args.length} arg(s)`);
  const child = spawn(command, args, { stdio: ["pipe", "pipe", "inherit"], env: process.env, windowsHide: true });
  let ids: CodexTurnIds | null = null;
  let ended = false;
  let ending: Promise<void> | null = null;
  let responseWaiter: ((ok: boolean) => void) | null = null;

  let inBuffer = "";
  process.stdin.on("data", (chunk: Buffer) => {
    child.stdin.write(chunk);
    inBuffer = (inBuffer + chunk.toString("utf8")).slice(-1_048_576);
    let nl: number;
    while ((nl = inBuffer.indexOf("\n")) >= 0) {
      const line = inBuffer.slice(0, nl);
      inBuffer = inBuffer.slice(nl + 1);
      const found = turnIdsFromClientLine(line);
      if (found && (ids?.turn_id !== found.turn_id || ids.session_id !== found.session_id)) {
        ids = found;
        log(controlDir, `turn ${found.session_id}/${found.turn_id}`);
      }
    }
  });

  let outBuffer = "";
  child.stdout.on("data", (chunk: Buffer) => {
    outBuffer += chunk.toString("utf8");
    let nl: number;
    while ((nl = outBuffer.indexOf("\n")) >= 0) {
      const line = outBuffer.slice(0, nl + 1);
      outBuffer = outBuffer.slice(nl + 1);
      if (line.includes(`"${TURN_ENDED_REQUEST_ID}"`)) {
        try {
          const msg = JSON.parse(line) as { id?: unknown; error?: unknown };
          if (msg.id === TURN_ENDED_REQUEST_ID) {
            log(controlDir, msg.error ? `turn_ended error ${JSON.stringify(msg.error).slice(0, 300)}` : "turn_ended ok");
            responseWaiter?.(!msg.error);
            continue; // our own request: never forwarded to Codex
          }
        } catch { /* not ours */ }
      }
      process.stdout.write(line);
    }
  });

  const endTurn = (reason: string): Promise<void> => {
    if (ending) return ending;
    ending = (async () => {
      if (ended) return;
      ended = true;
      const target = ids ?? readTurnComplete(controlDir);
      if (!target) { log(controlDir, `end (${reason}): no turn ids seen; nothing to release`); return; }
      if (child.exitCode !== null || child.stdin.destroyed) { log(controlDir, `end (${reason}): server already gone`); return; }
      log(controlDir, `end (${reason}): turn_ended ${target.session_id}/${target.turn_id}`);
      const answered = new Promise<boolean>((resolve) => {
        responseWaiter = resolve;
        setTimeout(() => resolve(false), 8000).unref();
      });
      child.stdin.write(turnEndedRequest(target) + "\n");
      if (!(await answered)) log(controlDir, "turn_ended: no answer within 8s");
    })();
    return ending;
  };

  // Codex `notify` (agent-turn-complete) drops a marker; release right away while Codex is still alive.
  const poll = setInterval(() => {
    if (!ended && existsSync(join(controlDir, TURN_COMPLETE_FILE))) void endTurn("notify");
  }, 200);
  poll.unref();

  const shutdown = async (reason: string, code: number) => {
    await endTurn(reason);
    try { child.stdin.end(); } catch { /* ignore */ }
    const timer = setTimeout(() => { try { child.kill(); } catch { /* ignore */ } }, 4000);
    timer.unref();
    child.once("exit", () => process.exit(code));
  };

  process.stdin.on("end", () => { void shutdown("stdin closed", 0); });
  for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"] as const) {
    try { process.on(signal, () => { void shutdown(signal, 0); }); } catch { /* unsupported on this platform */ }
  }
  child.on("exit", (code, signal) => {
    clearInterval(poll);
    log(controlDir, `server exit ${code ?? signal}`);
    process.exit(code ?? 0);
  });
  child.on("error", (error) => { log(controlDir, `spawn error ${error.message}`); process.exit(1); });
}

async function runNotify(controlDir: string, chain: string[], payload: string): Promise<void> {
  try {
    mkdirSync(controlDir, { recursive: true });
    const tmp = join(controlDir, `${TURN_COMPLETE_FILE}.tmp`);
    writeFileSync(tmp, payload);
    renameSync(tmp, join(controlDir, TURN_COMPLETE_FILE));
    log(controlDir, `notify ${payload.slice(0, 200)}`);
  } catch { /* best effort */ }
  if (chain.length > 0) {
    // Keep the operator's own Codex notify (e.g. the desktop Computer Use helper's turn-ended).
    await new Promise<void>((resolve) => {
      const c = spawn(chain[0]!, [...chain.slice(1), payload], { stdio: "ignore", windowsHide: true });
      c.on("error", () => resolve());
      c.on("exit", () => resolve());
      setTimeout(resolve, 5000).unref();
    });
  }
  // Give the proxy a moment to release before Codex tears the server down.
  await new Promise((r) => setTimeout(r, 1500));
}

export async function main(argv: string[]): Promise<void> {
  const [mode, controlDir, ...rest] = argv;
  if (!controlDir) throw new Error("usage: --proxy|--notify <controlDir> ...");
  const sep = rest.indexOf("--");
  if (mode === "--proxy") {
    const cmd = sep >= 0 ? rest.slice(sep + 1) : rest;
    if (cmd.length === 0) throw new Error("missing server command");
    await runProxy(controlDir, cmd[0]!, cmd.slice(1));
  } else if (mode === "--notify") {
    const payload = rest[rest.length - 1] ?? "";
    const chain = sep >= 0 ? rest.slice(sep + 1, rest.length - 1) : [];
    await runNotify(controlDir, chain, payload);
  } else {
    throw new Error(`unknown mode ${mode ?? ""}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`codex-cua-proxy: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
