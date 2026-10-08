import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { validateClaudeInit, type ClaudeInitExpectation } from "./claude-cli-profile.js";
import { providerUsage } from "../cognitive/provider-outcome.js";
import type { TokenUsage } from "../cognitive/llm.js";

/** Safe terminal metadata only: never persist provider error bodies or repeated tool/context payloads. */
export interface ClaudeTerminalDiagnostic {
  subtype: string;
  is_error: boolean | null;
  num_turns?: number;
  error_count?: number;
}
function terminalFailureCode(subtype: unknown): string {
  switch (subtype) {
    case "error_max_turns":
    case "error_max_turns_reached": return "CLAUDE_MAX_TURNS_REACHED";
    case "error_max_budget_usd": return "CLAUDE_MAX_BUDGET_REACHED";
    case "error_during_execution": return "CLAUDE_EXECUTION_FAILED";
    case "error_max_structured_output_retries": return "CLAUDE_STRUCTURED_OUTPUT_RETRIES_EXHAUSTED";
    default: return "CLAUDE_TERMINAL_FAILED";
  }
}

/** Per-record memory guard: accommodates the 8 MiB MCP result bound plus JSON escaping/framing.
 * It is not a cumulative transcript or model-token allowance. Completed nonterminal records are discarded. */
export const CLAUDE_STREAM_RECORD_MAX_BYTES = 32 * 1024 * 1024;

/** Bounded JSONL parser; partial assistant messages are presentation, never terminal truth. */
export class ClaudeStream {
  private pending = Buffer.alloc(0);
  private pendingBytes = 0;
  private initialized = false;
  private sessionId = "";
  private terminal: any;
  constructor(private expected: ClaudeInitExpectation, private admit: () => void, private settle: () => void = () => {}) {}
  push(chunk: Buffer): void {
    let offset = 0;
    while (offset < chunk.length) {
      const newline = chunk.indexOf(0x0a, offset);
      const end = newline < 0 ? chunk.length : newline;
      const length = end - offset;
      if (this.pendingBytes + length > CLAUDE_STREAM_RECORD_MAX_BYTES)
        throw new Error("CLAUDE_STREAM_RECORD_BYTE_BOUND");
      if (length) {
        // Geometric growth bounds both bytes and allocation count, even for single-byte fragments.
        // Never retain a slice backed by a whole multi-record input chunk.
        const required = this.pendingBytes + length;
        if (required > this.pending.length) {
          const capacity = Math.min(CLAUDE_STREAM_RECORD_MAX_BYTES, Math.max(required, 65536, this.pending.length * 2));
          const next = Buffer.allocUnsafe(capacity);
          this.pending.copy(next, 0, 0, this.pendingBytes);
          this.pending = next;
        }
        chunk.copy(this.pending, this.pendingBytes, offset, end);
        this.pendingBytes = required;
      }
      if (newline < 0) break;
      this.flushRecord();
      offset = newline + 1;
    }
  }
  private flushRecord(): void {
    // Decode once the whole record is present, preserving UTF-8 split across pipe chunks.
    const line = this.pending.toString("utf8", 0, this.pendingBytes);
    this.pending = Buffer.alloc(0); this.pendingBytes = 0;
    if (line.trim()) this.event(line);
  }
  private event(line: string): void {
    let event: any;
    try { event = JSON.parse(line); } catch { throw new Error("CLAUDE_STREAM_JSON_INVALID"); }
    if (typeof event?.type !== "string") throw new Error("CLAUDE_STREAM_EVENT_INVALID");
    if (event.type === "system" && event.subtype === "init") {
      if (this.initialized || this.terminal) throw new Error("CLAUDE_INIT_DUPLICATE");
      this.sessionId = validateClaudeInit(event, this.expected); this.initialized = true; this.admit(); return;
    }
    if (!this.initialized) throw new Error("CLAUDE_EVENT_BEFORE_INIT");
    if (/mcp.*(changed|manifest)/i.test(event.type + ":" + (event.subtype ?? "")))
      throw new Error("CLAUDE_CATALOG_CHANGED");
    if (event.type === "assistant" && Array.isArray(event.message?.content)) {
      const allowed = new Set(this.expected.tools.map(name => "mcp__dreamgraph__" + name));
      for (const block of event.message.content) if (block.type === "tool_use" && !allowed.has(block.name))
        throw new Error("CLAUDE_UNADVERTISED_TOOL");
    }
    if (event.type === "result") {
      if (event.session_id !== this.sessionId) throw new Error("CLAUDE_RESULT_SESSION_MISMATCH");
      if (this.terminal) throw new Error("CLAUDE_RESULT_DUPLICATE");
      this.terminal = event; this.settle();
    } else if (this.terminal && ["assistant", "user", "stream_event"].includes(event.type)) {
      throw new Error("CLAUDE_EVENT_AFTER_RESULT");
    }
  }
  diagnostic(): ClaudeTerminalDiagnostic | undefined {
    const result = this.terminal;
    if (!result) return undefined;
    return {
      subtype: typeof result.subtype === "string" && /^[a-z0-9_]{1,80}$/.test(result.subtype) ? result.subtype : "unrecognized",
      is_error: typeof result.is_error === "boolean" ? result.is_error : null,
      ...(Number.isSafeInteger(result.num_turns) && result.num_turns >= 0 ? { num_turns: result.num_turns } : {}),
      ...(Array.isArray(result.errors) ? { error_count: result.errors.length } : {}),
    };
  }
  usage(): TokenUsage | undefined { return providerUsage("anthropic", this.terminal?.usage); }
  finish(): { content: string; usage?: TokenUsage } {
    this.flushRecord();
    const result = this.terminal;
    if (!result) throw new Error("CLAUDE_TERMINAL_RESULT_MISSING");
    if (result.subtype !== "success" || result.is_error !== false) throw new Error(terminalFailureCode(result.subtype));
    const content = result.structured_output !== undefined ? JSON.stringify(result.structured_output) : result.result;
    if (typeof content !== "string" || !content.trim()) throw new Error("CLAUDE_TERMINAL_CONTENT_MISSING");
    // Anthropic's input, cache-write and cache-read components are additive, not byte estimates.
    const usage = providerUsage("anthropic", result.usage);
    return { content, ...(usage ? { usage } : {}) };
  }
}

export interface ClaudeProcessResult {
  stdout: string; stderr: string; exitCode: number | null; signal: NodeJS.Signals | null;
  timedOut: boolean; durationMs: number; terminationConfirmed: boolean;
  claude: { content: string; usage?: TokenUsage; error?: string; terminal?: ClaudeTerminalDiagnostic; recovery?: { cli_pid?: number; proxy_pid?: number } };
}
export async function runClaudeProcess(input: {
  command: string; args: string[]; cwd: string; env: Record<string, string>; stdin: string;
  timeoutMs: number; signal?: AbortSignal; onActivity?: () => void;
  expected: ClaudeInitExpectation; gatePath: string; gateToken: string; requireProxyTermination?: boolean;
}): Promise<ClaudeProcessResult> {
  input.signal?.throwIfAborted();
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(input.command, input.args, { cwd: input.cwd, env: input.env, shell: false,
      windowsHide: true, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] });
    let failure: string | undefined, timedOut = false, kill: Promise<boolean> | undefined;
    let closed = false, completed = false;
    let proxyPid: number | undefined;
    let stopDeadline: ReturnType<typeof setTimeout> | undefined;
    const revoke = () => { try { unlinkSync(input.gatePath); } catch { /* Absent is closed. */ } };
    const stop = () => {
      revoke();
      if (kill || !child.pid || closed) return; // Never target an exited parent PID during proxy cleanup.
      stopDeadline = setTimeout(() => finish(null, null, false), 6000);
      if (process.platform === "win32") {
        kill = new Promise<boolean>(done => {
          const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
          const timer = setTimeout(() => { killer.kill(); done(false); }, 5000);
          killer.once("error", () => { clearTimeout(timer); done(false); });
          killer.once("exit", code => { clearTimeout(timer); done(code === 0 || code === 128); });
        });
      } else {
        try { process.kill(-child.pid, "SIGKILL"); kill = Promise.resolve(false); }
        catch { kill = Promise.resolve(false); }
        // Linux process-tree confirmation is unqualified; never claim it from sending SIGKILL alone.
      }
    };
    const parser = new ClaudeStream(input.expected, () => {
      if (failure || input.signal?.aborted) throw new Error("CLAUDE_ADMISSION_REVOKED");
      if (input.requireProxyTermination) {
        const value = readFileSync(input.gatePath + ".proxy", "utf8");
        if (!/^\d{1,10}$/.test(value)) throw new Error("CLAUDE_PROXY_IDENTITY_INVALID");
        proxyPid = Number(value);
        if (proxyPid <= 0 || proxyPid === child.pid || proxyPid === process.pid) throw new Error("CLAUDE_PROXY_IDENTITY_INVALID");
      }
      writeFileSync(input.gatePath, input.gateToken, { mode: 0o600, flag: "wx" });
    }, revoke);
    const abort = () => { failure = "CLAUDE_CANCELLED"; stop(); };
    input.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; failure = "CLAUDE_TIMEOUT"; stop(); }, input.timeoutMs);
    // A lost close event cannot keep the host waiting forever after the termination bound.
    const ceiling = setTimeout(() => { stop(); finish(null, null, false); }, input.timeoutMs + 6000);
    const finish = (exitCode: number | null, signal: NodeJS.Signals | null, terminationConfirmed: boolean) => {
      if (completed) return; completed = true; revoke(); clearTimeout(timer); clearTimeout(ceiling);
      if (stopDeadline) clearTimeout(stopDeadline);
      input.signal?.removeEventListener("abort", abort);
      let result: { content: string; usage?: TokenUsage } = { content: "" };
      if (!failure) try { result = parser.finish(); } catch (error) { failure = (error as Error).message; }
      const usage = parser.usage(); if (usage) result.usage = usage;
      const terminal = parser.diagnostic();
      if (exitCode !== 0 && !failure) failure = "CLAUDE_NONZERO_EXIT";
      if (!terminationConfirmed && !failure) failure = "CLAUDE_TERMINATION_UNCONFIRMED";
      resolve({ stdout: "", stderr: "", exitCode, signal, timedOut, durationMs: Date.now() - started, terminationConfirmed,
        claude: { ...result, ...(terminal ? { terminal } : {}), ...(failure ? { content: "", error: failure } : {}),
          ...(!terminationConfirmed ? { recovery: { cli_pid: child.pid, proxy_pid: proxyPid } } : {}) } });
    };
    child.stdout.on("data", (chunk: Buffer) => {
      if (failure || completed) return;
      try { parser.push(chunk); input.onActivity?.(); } catch (error) { failure = (error as Error).message; stop(); }
    });
    // Drain diagnostics without retaining them or imposing a cumulative run-output quota.
    child.stderr.on("data", () => { if (!completed) input.onActivity?.(); });
    child.once("error", error => {
      failure = "CLAUDE_SPAWN_FAILED";
      if (!child.pid) { closed = true; finish(null, null, true); } else stop();
    });
    child.once("close", (code, signal) => {
      closed = true;
      void (async () => {
        const confirmed = await (kill ?? Promise.resolve(true));
        // A parent exit is not evidence that its MCP proxy also stopped.
        // Observe only the registered owned proxy; never kill an arbitrary PID after parent exit.
        let proxyStopped = true;
        if (proxyPid) {
          const deadline = Date.now() + 5000;
          const alive = () => { try { process.kill(proxyPid!, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; } };
          while (alive() && Date.now() < deadline) await new Promise(done => setTimeout(done, 50));
          proxyStopped = !alive();
        }
        finish(code, signal, confirmed && proxyStopped);
      })();
    });
    child.stdin.on("error", () => { if (!closed) { failure = "CLAUDE_STDIN_FAILED"; stop(); } });
    if (input.signal?.aborted) abort();
    child.stdin.end(input.stdin);
  });
}
