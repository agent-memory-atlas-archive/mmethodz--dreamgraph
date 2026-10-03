/** Bridge commands are admitted and stopped by the daemon, never a child-side permission bypass. */
import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { z } from "zod";
import { reserveExecutionAction, reviewExecutionAction, type ExecutionPolicy } from "./execution-policy.js";
import { assertManagedContext, recordManagedEffect } from "../graph/execution-context.js";
import { observeCommandSource } from "../graph/observed-command.js";
export const ScopedCommandSchema = z.object({ command: z.string().min(1).max(32768), cwd: z.string().max(4096).optional(), timeoutMs: z.number().int().min(1000).max(300000).optional() }).strict();
export async function executeScopedCommand(policy: ExecutionPolicy | undefined, args: unknown, workspace: string, requestSignal?: AbortSignal) {
  if (!policy) throw new Error("COMMAND_EXECUTION_POLICY_REQUIRED");
  const signal = requestSignal ? AbortSignal.any([policy.signal, requestSignal]) : policy.signal;
  signal.throwIfAborted();
  const input = ScopedCommandSchema.parse(args);
  const root = await realpath(workspace), cwd = await realpath(resolve(root, input.cwd ?? ".")), rel = relative(root, cwd);
  if (rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(rel)) throw new Error("COMMAND_WORKSPACE_SCOPE_REJECTED");
  if (policy.context_id) await assertManagedContext(policy.context_id);
  await reviewExecutionAction(policy, "run_command", args, signal);
  if (policy.context_id) await assertManagedContext(policy.context_id);
  const releaseAction = reserveExecutionAction(policy, "run_command", args);
  try {
  const timeout = Math.min(input.timeoutMs ?? 60000, Date.parse(policy.expires_at) - Date.now());
  signal.throwIfAborted();
  const observation = policy.context_id ? await observeCommandSource({ execution_id: policy.id, workspace: root,
    before_intent: async () => { signal.throwIfAborted(); await assertManagedContext(policy.context_id!); } }) : null;
  let processStarted = false, processTerminated = false, observationAttempted = false;
  try {
  signal.throwIfAborted();
  const result = await new Promise<{ exitCode: number | null; signal: string | null; timedOut: boolean; stdout: string; stderr: string; execution_id: string; effect_status: string }>((done, reject) => {
    const win = process.platform === "win32";
    const child = spawn(win ? process.env.ComSpec ?? "cmd.exe" : "/bin/sh", win ? ["/d", "/s", "/c", `"${input.command}"`] : ["-c", input.command],
      { cwd, windowsHide: true, windowsVerbatimArguments: win, detached: !win, stdio: ["ignore", "pipe", "pipe"] });
    processStarted = true;
    let stdout = "", stderr = "", bytes = 0, timedOut = false, stopping = false, stopDeadline: NodeJS.Timeout | undefined;
    const stop = () => {
      if (stopping) return; stopping = true;
      if (child.pid) {
        if (win) { const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); killer.on("error", () => undefined); }
        else try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
      }
      stopDeadline = setTimeout(() => reject(new Error("COMMAND_STOP_UNCONFIRMED_EFFECT_UNKNOWN")), 5000); stopDeadline.unref();
    };
    const timer = setTimeout(() => { timedOut = true; stop(); }, Math.max(1, timeout)); timer.unref();
    signal.addEventListener("abort", stop, { once: true });
    const cleanup = () => { clearTimeout(timer); clearTimeout(stopDeadline); signal.removeEventListener("abort", stop); };
    for (const [stream, key] of [[child.stdout, "stdout"], [child.stderr, "stderr"]] as const) stream.on("data", chunk => {
      bytes += chunk.length;
      if (bytes > 65536) { stop(); return; }
      if (key === "stdout") stdout += chunk.toString(); else stderr += chunk.toString();
    });
    child.on("error", error => { cleanup(); reject(error); });
    child.on("close", (exitCode, signal) => { processTerminated = true; cleanup();
      if (bytes > 65536) { reject(new Error("COMMAND_OUTPUT_LIMIT_EFFECT_UNKNOWN")); return; }
      done({ exitCode, signal, timedOut, stdout, stderr, execution_id: policy.id,
        effect_status: "process_exit_observed; source_or_external_effects_require_owner_reconciliation_receipt" }); });
    if (signal.aborted) stop();
  });
  observationAttempted = true;
  const source_obligation = await observation?.settle(true);
  if (policy.context_id) await recordManagedEffect(policy.context_id, {tool:"run_command",outcome:"owner_returned",receipt_ids:[]});
  return {...result,...(source_obligation?{source_obligation,source_observation:"complete_in_declared_scan_visible_scope; secrets/generated paths excluded; external effects unattested"}:{})};
  } catch(error) {
    let recoveryError: unknown;
    try { if (observation && !observationAttempted) await observation.settle(processTerminated || !processStarted); }
    catch (failure) { recoveryError = failure; }
    try { if (policy.context_id && processStarted) await recordManagedEffect(policy.context_id,{tool:"run_command",outcome:"unknown",receipt_ids:[]}); }
    catch (failure) { recoveryError ??= failure; }
    if (recoveryError) throw new Error(`COMMAND_RECOVERY_RECORD_UNAVAILABLE: ${String(recoveryError)}; original outcome: ${String(error)}`, { cause: error });
    throw error;
  }
  } finally { releaseAction?.(); }
}
