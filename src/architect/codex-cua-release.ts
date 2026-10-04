/**
 * Releases the Chrome tabs a finished Codex Computer Use session still holds.
 *
 * Every DreamGraph pass is a fresh `codex exec` session. In the Codex app, the
 * plugin's Stop hook sends `turn_ended` so the browser releases the session's
 * claimed tabs (the Computer Use cursor and the "debugging this browser"
 * banner go away). Under `codex exec` that release does not happen, so the
 * tab stays claimed by a session that no longer exists and no later run can
 * claim it.
 *
 * Verified recovery (2026-10-04, scripts/codex-cu-release-probe.mjs): start
 * `cua_repl` on its own, act as the finished session in a new turn, bind each
 * tab it held with `cua.getTab(id)`, then send `turn_ended` for that turn.
 * The browser clears the session's marks for the new turn and releases the
 * unmarked tabs. The first browser call in a fresh cua_repl process always
 * fails with "Unable to load browser request-header policy" (a remote flag
 * that loads in the background), so every browser call is retried.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import type { CodexComputerUseServer } from "./codex-computer-use.js";

const ID = /^[A-Za-z0-9._:-]{1,128}$/;
const TAB_ID = /^\d{1,20}$/;

/** Browser tab ids a Codex Computer Use run operated, read from its JSON transcript. */
export function codexBrowserTabIdsFromTranscript(transcript: string): string[] {
  const ids = new Set<string>();
  for (const match of transcript.matchAll(/Browser tab: (\d{1,20})\b/g)) ids.add(match[1]!);
  for (const match of transcript.matchAll(/tabId: '(\d{1,20})'/g)) ids.add(match[1]!);
  return [...ids];
}

export interface CodexBrowserReleaseResult {
  session_id: string;
  turn_id: string;
  tabs: Array<{ tab_id: string; outcome: "bound" | "gone" | "failed"; detail: string }>;
  turn_ended: "ok" | "error" | "no_answer" | "skipped";
  log: string[];
}

export interface CodexBrowserReleaseOptions {
  server: CodexComputerUseServer;
  sessionId: string;
  tabIds: readonly string[];
  /** Attempts per browser call (the first one in a fresh process always fails). */
  attempts?: number;
  retryDelayMs?: number;
  callTimeoutMs?: number;
  /** Overall ceiling for the whole release. */
  totalTimeoutMs?: number;
}

type RpcReply = { result?: { content?: Array<{ type?: string; text?: string }>; isError?: boolean }; error?: { message?: string } };

function replyText(reply: RpcReply): string {
  if (reply.error) return String(reply.error.message ?? "error");
  return (reply.result?.content ?? []).map((part) => (part.type === "text" ? part.text ?? "" : "")).join(" ").replace(/\s+/g, " ").trim();
}

const RETRYABLE = /request-header policy|Retry the browser command/i;
const GONE = /not found|no longer exists|stale|missing|closed|does not exist|unavailable/i;

export async function releaseCodexBrowserSession(options: CodexBrowserReleaseOptions): Promise<CodexBrowserReleaseResult> {
  const log: string[] = [];
  const note = (text: string) => log.push(`[${new Date().toISOString()}] ${text}`);
  const turnId = randomUUID();
  const result: CodexBrowserReleaseResult = { session_id: options.sessionId, turn_id: turnId, tabs: [], turn_ended: "skipped", log };
  const tabIds = [...new Set(options.tabIds)].filter((id) => TAB_ID.test(id));
  if (!ID.test(options.sessionId)) { note("invalid session id; nothing released"); return result; }
  if (tabIds.length === 0) { note("no browser tabs recorded for this session; nothing to release"); return result; }
  if (!options.server.command) { note("Computer Use server has no local command; release skipped"); return result; }

  const attempts = options.attempts ?? 6;
  const retryDelayMs = options.retryDelayMs ?? 2000;
  const callTimeoutMs = options.callTimeoutMs ?? 30_000;
  const deadline = Date.now() + (options.totalTimeoutMs ?? 90_000);

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (typeof value === "string") env[key] = value;
  Object.assign(env, options.server.env, { CUA_REPL_ENABLED_SURFACES: "browser" });
  const child = spawn(options.server.command, [...options.server.args], { stdio: ["pipe", "pipe", "pipe"], env, windowsHide: true });
  let exited = false;
  child.on("exit", (code, signal) => { exited = true; note(`server exit ${code ?? signal}`); });
  child.on("error", (error) => { exited = true; note(`server error ${error.message}`); });
  child.stderr.on("data", () => { /* runtime warnings only */ });

  const waiters = new Map<number, (reply: RpcReply) => void>();
  let buffer = "";
  child.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try {
        const message = JSON.parse(line) as RpcReply & { id?: unknown };
        if (typeof message.id === "number") { const waiter = waiters.get(message.id); if (waiter) { waiters.delete(message.id); waiter(message); } }
      } catch { /* not JSON-RPC */ }
    }
  });
  let nextId = 1;
  const call = (method: string, params: unknown): Promise<RpcReply | null> => new Promise((resolve) => {
    if (exited || Date.now() > deadline) { resolve(null); return; }
    const id = nextId++;
    waiters.set(id, (reply) => resolve(reply));
    setTimeout(() => { if (waiters.delete(id)) resolve(null); }, Math.min(callTimeoutMs, Math.max(1000, deadline - Date.now()))).unref();
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const meta = { "x-codex-turn-metadata": JSON.stringify({ session_id: options.sessionId, turn_id: turnId, thread_source: "user" }) };

  try {
    const init = await call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "dreamgraph-cua-release", version: "1" } });
    if (!init || init.error) { note(`initialize failed: ${init ? replyText(init) : "no answer"}`); return result; }
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    note(`release session ${options.sessionId} via turn ${turnId}; tabs ${tabIds.join(", ")}`);

    for (const tabId of tabIds) {
      let outcome: "bound" | "gone" | "failed" = "failed";
      let detail = "";
      for (let attempt = 1; attempt <= attempts; attempt++) {
        const reply = await call("tools/call", {
          name: "js", _meta: meta,
          arguments: { code: `var tab = await cua.getTab(${JSON.stringify(tabId)}, { browser: "chrome" });` },
        });
        detail = reply ? replyText(reply).slice(0, 300) : "no answer";
        const failed = !reply || Boolean(reply.error) || reply.result?.isError === true || RETRYABLE.test(detail);
        if (!failed) { outcome = "bound"; break; }
        // Only the start-up flag error and a missing answer are worth retrying.
        if (reply && !RETRYABLE.test(detail)) { outcome = GONE.test(detail) ? "gone" : "failed"; break; }
        if (attempt < attempts) await sleep(retryDelayMs);
      }
      note(`tab ${tabId}: ${outcome}${outcome === "bound" ? "" : ` (${detail})`}`);
      result.tabs.push({ tab_id: tabId, outcome, detail: outcome === "bound" ? "" : detail });
    }

    if (result.tabs.some((tab) => tab.outcome === "bound")) {
      const ended = await call("tools/call", { name: "turn_ended", arguments: { hook_event_name: "Stop", session_id: options.sessionId, turn_id: turnId } });
      result.turn_ended = !ended ? "no_answer" : ended.error || ended.result?.isError ? "error" : "ok";
      note(`turn_ended: ${result.turn_ended}${ended && result.turn_ended !== "ok" ? ` (${replyText(ended).slice(0, 300)})` : ""}`);
    } else {
      note("no tab could be bound; turn_ended skipped");
    }
    return result;
  } finally {
    try { child.stdin.end(); } catch { /* ignore */ }
    if (!exited) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => { try { child.kill(); } catch { /* ignore */ } resolve(); }, 4000);
        timer.unref();
        child.once("exit", () => { clearTimeout(timer); resolve(); });
      });
    }
  }
}
