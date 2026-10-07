/**
 * `cua-runtime` Computer Use backend for API-engine passes (docs/ashoka/computer-use-contract.md, stage 1).
 *
 * DreamGraph hosts the installed Computer Use runtime (`cua_repl`, shipped with the Codex app) itself and gives
 * its tools to the native tool loop, so an API model gets the same Computer Use as Codex CLI: the user's Chrome,
 * already-open tabs, the runtime's own cursor/banner, no per-task setup. The Codex CLI path does not use this
 * module and is unchanged; discovery and the release protocol are reused read-only.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  discoverCodexComputerUseServers, resolveCodexSourceHome, writeCodexBrowserSessionGrant, type CodexComputerUseServer,
} from "../architect/codex-computer-use.js";
import { codexBrowserTabIdsFromTranscript, releaseCodexBrowserSession } from "../architect/codex-cua-release.js";
import type { LlmToolContentBlock, LlmToolDefinition } from "../cognitive/llm.js";

export const CUA_RUNTIME_SERVER = "cua_repl";
/** The first browser call in a fresh runtime fails while a remote flag loads; it always succeeds on retry. */
const RETRYABLE = /request-header policy|Retry the browser command/i;
const CALL_TIMEOUT_MS = 180_000;
const RESULT_TEXT_MAX = 64_000;
const CONFIDENTIAL_ENV = /^DREAMGRAPH_|KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH/i;

type Image = Extract<LlmToolContentBlock, { type: "image" }>;
export interface CuaRuntimeCallResult { text: string; images: Image[]; isError: boolean }
export interface CuaRuntimeSession {
  readonly sessionId: string;
  readonly turnId: string;
  readonly tools: LlmToolDefinition[];
  readonly version: string | null;
  has(name: string): boolean;
  call(name: string, args: unknown, signal?: AbortSignal): Promise<CuaRuntimeCallResult>;
  /** Run-once: ends the turn, releases every tab the session touched, stops the runtime. Returns the log path. */
  release(reason: string): Promise<string | null>;
}

/** Same executor rules as the Codex CLI grant (cli-bridge.ts createCliControlInstructions), for the API engine. */
export const CUA_RUNTIME_GRANTED_GUIDANCE =
  "The local operator has GRANTED full Computer Use for this pass. Use the cua_repl tool (JavaScript against the `cua` API; start with " +
  "`await cua.getState();` and read the documentation it points to) to operate any web page in the user's Chrome to fulfil the request. " +
  "Site access is pre-approved for this pass; do not stop to ask for permission. If the request concerns a page that is already open, take over " +
  "that existing tab (cua.getTab({ url }) or browser.user.openTabs() then claimTab) instead of opening a new one. Pages often ask for input " +
  "in a native JavaScript dialog (alert/confirm/prompt, e.g. a file name after New file); it blocks the page until answered and does not " +
  "show in page snapshots. After any click or key that may open one, and whenever an action times out or the page stops responding, check " +
  "`const dialog = await tab.getJsDialog();` and answer it yourself: `await dialog.accept(\"text\")` for a prompt (type the value the task " +
  "needs), `await dialog.accept()` for a confirm, `await dialog.dismiss()` to cancel. Never leave a dialog for the operator. " +
  "Errors that say to retry are transient: retry the same call. Never call tab.markDeliverable() or tab.markHandoff(); the session is released " +
  "when this pass ends, so keep a result page open in a claimed user tab instead of an agent-created tab. Computer Use is for operating web " +
  "pages only: never use it (or cua_repl JavaScript) to read, write, run or change this project's repository; every project read, mutation and " +
  "command still goes exclusively through the DreamGraph MCP tools. Report what you did and observed.";

export interface CuaRuntimeDetection { server: CodexComputerUseServer | null; reason: string | null }
export async function detectCuaRuntime(codexHome = resolveCodexSourceHome()): Promise<CuaRuntimeDetection> {
  try {
    const discovery = await discoverCodexComputerUseServers(codexHome);
    const server = discovery.servers.find(item => item.name === CUA_RUNTIME_SERVER) ?? null;
    return server ? { server, reason: null }
      : { server: null, reason: discovery.diagnostics[0] ?? "The Computer Use runtime is not installed (it comes with the Codex app)." };
  } catch (error) {
    return { server: null, reason: `Computer Use runtime discovery failed: ${(error as Error).message}` };
  }
}

/** Model-facing name: the runtime documents itself as `cua_repl`. */
export function cuaRuntimeToolName(tool: string): string { return tool === "js" ? CUA_RUNTIME_SERVER : `${CUA_RUNTIME_SERVER}_${tool}`.slice(0, 64); }

type Rpc = { id?: unknown; method?: string; result?: { content?: Array<Record<string, unknown>>; isError?: boolean; tools?: Array<Record<string, unknown>>;
  serverInfo?: { version?: unknown } }; error?: { message?: string } };

export async function openCuaRuntimeSession(input: { server?: CodexComputerUseServer; codexHome?: string; signal?: AbortSignal;
  logDir?: string; retryDelayMs?: number } = {}): Promise<CuaRuntimeSession> {
  const codexHome = input.codexHome ?? resolveCodexSourceHome();
  const server = input.server ?? (await detectCuaRuntime(codexHome)).server;
  if (!server) throw new Error("COMPUTER_USE_RUNTIME_UNAVAILABLE");
  const sessionId = randomUUID(), turnId = randomUUID(), retryDelayMs = input.retryDelayMs ?? 2000;
  const log: string[] = [], note = (text: string) => log.push(`[${new Date().toISOString()}] ${text}`);
  const grantHome = server.env.CODEX_HOME || codexHome;
  const grantFile = await writeCodexBrowserSessionGrant(grantHome, sessionId);

  // The runtime executes model-written JavaScript: it never inherits DreamGraph's credentials or settings.
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (typeof value === "string" && !CONFIDENTIAL_ENV.test(key)) env[key] = value;
  Object.assign(env, server.env, { CUA_REPL_ENABLED_SURFACES: "browser" });
  const child = spawn(server.command, [...server.args], { stdio: ["pipe", "pipe", "pipe"], env, windowsHide: true });
  let exited = false;
  child.on("exit", (code, signal) => { exited = true; note(`runtime exit ${code ?? signal}`); for (const done of waiters.values()) done(null); waiters.clear(); });
  child.on("error", error => { exited = true; note(`runtime error ${error.message}`); });
  child.stderr.on("data", () => { /* runtime diagnostics only */ });

  const waiters = new Map<number, (reply: Rpc | null) => void>();
  let buffer = "", nextId = 1;
  const send = (message: unknown) => { if (!exited) child.stdin.write(JSON.stringify(message) + "\n"); };
  child.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim(); buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let message: Rpc;
      try { message = JSON.parse(line) as Rpc; } catch { continue; }
      if (typeof message.method === "string") {
        // Server-initiated request: DreamGraph offers no client capabilities; answer so it never waits.
        if (message.id !== undefined) send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } });
        continue;
      }
      if (typeof message.id === "number") { const done = waiters.get(message.id); if (done) { waiters.delete(message.id); done(message); } }
    }
  });
  const request = (method: string, params: unknown, signal?: AbortSignal, timeoutMs = CALL_TIMEOUT_MS) => new Promise<Rpc | null>(resolve => {
    if (exited || signal?.aborted) { resolve(null); return; }
    const id = nextId++;
    const finish = (reply: Rpc | null) => { clearTimeout(timer); signal?.removeEventListener("abort", abort); resolve(reply); };
    const abort = () => { if (waiters.delete(id)) finish(null); };
    const timer = setTimeout(() => { if (waiters.delete(id)) finish(null); }, timeoutMs);
    timer.unref?.();
    signal?.addEventListener("abort", abort, { once: true });
    waiters.set(id, finish);
    send({ jsonrpc: "2.0", id, method, params });
  });
  const stop = async () => {
    try { child.stdin.end(); } catch { /* ignore */ }
    if (!exited) await new Promise<void>(resolve => {
      const timer = setTimeout(() => { try { child.kill(); } catch { /* ignore */ } resolve(); }, 4000);
      timer.unref?.();
      child.once("exit", () => { clearTimeout(timer); resolve(); });
    });
  };

  const init = await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "dreamgraph-architect", version: "1" } }, input.signal, 30_000);
  if (!init || init.error) { await stop(); await unlink(grantFile).catch(() => undefined); throw new Error("COMPUTER_USE_RUNTIME_START_FAILED"); }
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  const listed = await request("tools/list", {}, input.signal, 30_000);
  const runtimeTools = (listed?.result?.tools ?? []).filter(tool => typeof tool.name === "string" && tool.name !== "turn_ended");
  if (!runtimeTools.length) { await stop(); await unlink(grantFile).catch(() => undefined); throw new Error("COMPUTER_USE_RUNTIME_TOOLS_UNAVAILABLE"); }
  const byName = new Map(runtimeTools.map(tool => [cuaRuntimeToolName(String(tool.name)), String(tool.name)]));
  const tools: LlmToolDefinition[] = runtimeTools.map(tool => ({ name: cuaRuntimeToolName(String(tool.name)),
    description: `[Computer Use] ${typeof tool.description === "string" ? tool.description : "Computer Use runtime tool."}`,
    inputSchema: tool.inputSchema ?? { type: "object" } }));
  const version = typeof init.result?.serverInfo?.version === "string" ? init.result.serverInfo.version : null;
  note(`session ${sessionId} turn ${turnId}; runtime ${version ?? "unknown"} from ${server.source}; tools ${[...byName.keys()].join(", ")}`);
  const meta = { "x-codex-turn-metadata": JSON.stringify({ session_id: sessionId, turn_id: turnId, thread_source: "user" }) };
  const seen: string[] = [];

  const call = async (name: string, args: unknown, signal?: AbortSignal): Promise<CuaRuntimeCallResult> => {
    const tool = byName.get(name);
    if (!tool) return { text: `Unknown Computer Use tool ${name}.`, images: [], isError: true };
    for (let attempt = 1; ; attempt++) {
      const reply = await request("tools/call", { name: tool, arguments: args && typeof args === "object" ? args : {}, _meta: meta }, signal);
      if (!reply) return { text: exited ? "The Computer Use runtime stopped." : signal?.aborted ? "Cancelled." : "No answer from the Computer Use runtime (timed out).", images: [], isError: true };
      if (reply.error) return { text: String(reply.error.message ?? "Computer Use runtime error"), images: [], isError: true };
      const texts: string[] = [], images: Image[] = [];
      for (const part of reply.result?.content ?? []) {
        if (part.type === "text" && typeof part.text === "string") texts.push(part.text);
        else if (part.type === "image" && typeof part.data === "string" && ["image/png", "image/jpeg", "image/webp"].includes(String(part.mimeType)))
          images.push({ type: "image", mimeType: part.mimeType as Image["mimeType"], dataBase64: part.data });
      }
      let text = texts.join("\n");
      seen.push(text);
      if (RETRYABLE.test(text) && attempt < 4 && !signal?.aborted) { note(`retry ${attempt} after start-up flag error`); await new Promise(r => setTimeout(r, retryDelayMs)); continue; }
      if (text.length > RESULT_TEXT_MAX) text = text.slice(0, RESULT_TEXT_MAX) + `\n[DreamGraph: ${text.length - RESULT_TEXT_MAX} more characters omitted; request a narrower read]`;
      return { text: text || (images.length ? "(image)" : "(no output)"), images, isError: reply.result?.isError === true };
    }
  };

  let released: Promise<string | null> | undefined;
  const release = (reason: string) => released ??= (async () => {
    note(`release (${reason})`);
    const ended = await request("tools/call", { name: "turn_ended", arguments: { hook_event_name: "Stop", session_id: sessionId, turn_id: turnId } }, undefined, 30_000);
    note(`turn_ended: ${!ended ? "no answer" : ended.error || ended.result?.isError ? "error" : "ok"}`);
    await stop();
    const tabIds = codexBrowserTabIdsFromTranscript(seen.join("\n"));
    if (tabIds.length) {
      // The verified recovery (new turn, bind each tab, end that turn) guarantees no claim outlives the pass.
      const result = await releaseCodexBrowserSession({ server, sessionId, tabIds }).catch(error => ({ log: [`release failed: ${(error as Error).message}`] }));
      log.push(...result.log);
    }
    await unlink(grantFile).catch(() => undefined);
    try {
      const dir = input.logDir ?? join(tmpdir(), "dreamgraph-codex-transcripts");
      await mkdir(dir, { recursive: true });
      const path = join(dir, `${sessionId}.cua-release.log`);
      await writeFile(path, log.join("\n") + "\n", { mode: 0o600 });
      return path;
    } catch { return null; }
  })();

  return { sessionId, turnId, tools, version, has: name => byName.has(name), call, release };
}
