import type { IncomingMessage } from "node:http";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants as FS, existsSync } from "node:fs";
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { nativeCliModelExecution } from "../cognitive/model-execution.js";
import { NATIVE_CLI_PROMPT_MAX_BYTES, ARCHITECT_PASS_MAX_MS, ARCHITECT_PASS_DEFAULT_MS } from "../config/request-bounds.js";
import { getArchitectLlmConfig } from "../cognitive/llm.js";
import { providerUsage } from "../cognitive/provider-outcome.js";
import type { LlmMessage, TokenUsage } from "../cognitive/llm.js";
import { mcpListTools, architectMcpHeaders } from "../cli/utils/mcp-call.js";
import { getArchitectProjectRoot } from "./plan-registry.js";
import { createArchitectToolResultPreview, type ArchitectToolTraceEntry } from "./native-tool-loop.js";
import { resolveArchitectNarrativeDensity, type ArchitectVerbosityMode } from "./verbosity.js";
import { getSessionContext } from "../server/session-context.js";
import { executionPolicyProjection, type ExecutionApproval } from "../server/execution-policy.js";
import { beginHostExecution, endHostExecution, withHostExecution } from "../server/managed-execution.js";
import type { PlanExecutionIntent } from "../graph/contracts.js";
import { deliverManagedContext, readManagedContext, type ManagedExecutionContext } from "../graph/execution-context.js";
import { startCodexCuaHost, type CodexCuaHost } from "./codex-cua-host.js";
import { codexComputerUseServersToml, codexTurnEndHooksToml, codexNativeToolTrace, createCodexItemClock, createCodexTranscriptWriter, createCodexSessionGrantWatcher, readCodexNotify, discoverCodexComputerUseServers, resolveCodexSourceHome, widenCodexComputerUseSurfaces, type CodexComputerUseServer } from "./codex-computer-use.js";

export type ArchitectCliAdapter = "codex-cli" | "copilot-cli";

/** Concrete controller-derived tool needs for one CLI execution. */
export interface ArchitectCliToolRequirements {
  required_tools: string[];
  preferred_tools: string[];
}

export interface ArchitectCliBridgeRoute {
  enabled: true;
  provider: ArchitectCliAdapter;
  mcp_port: number;
  available_tool_count: number;
  advertised_tool_count: number;
  advertised_tools: string[];
  required_tools: string[];
  unavailable_required_tools: string[];
  iterations: number;
  stop_reason: string;
  fallback_reason: string | null;
  run_id: string;
  executable: string;
  bridge_entry: string;
  duration_ms: number;
  exit_code: number | null;
  signal: NodeJS.Signals | null;
  timed_out: boolean;
  adapter_version?: string;
  /** Codex native Computer Use MCP servers wired into this granted pass (names only). */
  computer_use_servers?: string[];
  /** Codex thread whose browser session was pre-approved under the Computer Use grant. */
  computer_use_session?: string;
  /** Raw Codex JSONL transcript of the granted Computer Use run (local diagnostic file). */
  computer_use_transcript?: string;
  /** Log of DreamGraph's cua_repl host (turn-end cleanup) for this run. */
  computer_use_cleanup_log?: string;
  effective_controls?: ReturnType<typeof executionPolicyProjection>;
  output_controls?: { provider: "configured_optional" | "unsupported"; prompt: "guided"; presentation: "enforced"; exact_density: "not_guaranteed" };
}

export interface ArchitectCliBridgeProvenance {
  authority: "dreamgraph_mcp";
  route: ArchitectCliAdapter;
  provider: ArchitectCliAdapter;
  model: string;
  run_id: string;
  tool_calls: Array<{
    iteration: number;
    tool: string;
    status: ArchitectToolTraceEntry["status"];
    duration_ms: number;
  }>;
}

export interface ArchitectCliBridgeResult {
  content: string;
  model: string;
  route: ArchitectCliBridgeRoute;
  provenance: ArchitectCliBridgeProvenance;
  tool_trace: ArchitectToolTraceEntry[];
  usage?: TokenUsage;
  usage_provenance: "native_reported" | "unavailable";
  graph_execution?: ManagedExecutionContext;
  /** The executor asked for Computer Use (policy "ask"); the operator must answer before a re-run. */
  computer_use_request?: { reason: string };
}

export interface RunArchitectCliBridgeInput {
  adapter: ArchitectCliAdapter;
  req: IncomingMessage;
  messages: LlmMessage[];
  userMessage: string;
  model: string;
  timeoutMs: number;
  verbosityMode?: ArchitectVerbosityMode;
  autonomyMode?: "manual" | "supervised" | "autonomous";
  approvedActions?: ExecutionApproval;
  operatorReviewEnabled?: boolean;
  reasoningEffort?: string;
  toolRequirements?: ArchitectCliToolRequirements | null;
  signal?: AbortSignal;
  onToolTrace?: (entry: ArchitectToolTraceEntry) => void;
  executionId?: string;
  planId?: string;
  sliceId?: string;
  planExecution?: PlanExecutionIntent;
  /** Local operator allowed native Computer Use for this pass (codex-cli only). */
  computerUse?: boolean;
  /** Policy is "ask" and no grant exists: expose request_computer_use to the executor. */
  computerUseRequestable?: boolean;
}

interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  durationMs: number;
}

interface AuditRecord {
  server?: string;
  tool?: string;
  inputJson?: string;
  resultJson?: string;
  isError?: boolean;
  status?: ArchitectToolTraceEntry["status"];
  durationMs?: number;
  startedAtEpochMs?: number;
}

const OUTPUT_LIMIT = 512 * 1024;
const CLI_DEFAULT_TIMEOUT_MS = ARCHITECT_PASS_DEFAULT_MS;
const CODEX_HOME_AUTH_ARTIFACTS = Object.freeze(["auth.json", "version.json", "installation_id"] as const);
const BRIDGE_LOCAL_DREAMGRAPH_TOOLS = Object.freeze(["run_command"] as const);
const BRIDGE_MCP_CONFIG_ENV_KEYS = Object.freeze([
  "DREAMGRAPH_HOST_MCP_URL",
  "DREAMGRAPH_BRIDGE_SESSION_BEARER",
  "DREAMGRAPH_BRIDGE_AUDIT_DIR",
  "DREAMGRAPH_AUDIT_PATH",
  "DREAMGRAPH_RUN_ID",
  "DREAMGRAPH_WORKSPACE_ROOT",
  "DREAMGRAPH_ARCHITECT_VERBOSITY_MODE",
  "DREAMGRAPH_ARCHITECT_STORY_VISIBILITY",
  "DREAMGRAPH_ARCHITECT_PROMPT_PROFILE",
  "DREAMGRAPH_BRIDGE_COMPUTER_USE_REQUESTABLE",
  "ELECTRON_RUN_AS_NODE",
] as const);
const REQUIRED_DREAMGRAPH_TOOLS = Object.freeze(["query_resource", "query_architecture_decisions", "read_source_code", "search_source_code", "run_command"] as const);
const CLI_BINARY_ENV_KEY_BY_ADAPTER: Record<ArchitectCliAdapter, string> = Object.freeze({
  "codex-cli": "DREAMGRAPH_ARCHITECT_CODEX_CLI_BINARY",
  "copilot-cli": "DREAMGRAPH_ARCHITECT_COPILOT_CLI_BINARY",
});
const CLI_DEFAULT_BINARY_BY_ADAPTER: Record<ArchitectCliAdapter, string> = Object.freeze({
  "codex-cli": "codex",
  "copilot-cli": "copilot",
});
const IS_WINDOWS = process.platform === "win32";
const WINDOWS_PATH_EXTS: readonly string[] = IS_WINDOWS
  ? Array.from(new Set([...(process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";"), ".PS1"]
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)))
  : [];

export async function runArchitectCliBridge(input: RunArchitectCliBridgeInput): Promise<ArchitectCliBridgeResult> {
  input.signal?.throwIfAborted();
  if (input.reasoningEffort && input.adapter !== "codex-cli") throw new Error("CLI_EFFORT_UNQUALIFIED");
  const mcpPort = architectMcpPort(input.req);
  if (mcpPort == null) {
    throw new Error("ARCHITECT_CLI_BRIDGE_MCP_PORT_UNAVAILABLE: request host did not expose a local MCP port");
  }

  const headers = architectMcpHeaders(input.req);
  const upstreamTools = await mcpListTools(mcpPort, { headers, signal: input.signal });
  const availableToolNames = resolveArchitectCliBridgeToolNames(upstreamTools.map((tool) => tool.name));
  const toolRequirements = resolveCliToolRequirements(input.toolRequirements, availableToolNames);
  const missingTools = REQUIRED_DREAMGRAPH_TOOLS.filter((name) => !availableToolNames.includes(name));
  if (missingTools.length > 0) {
    throw new Error(`ARCHITECT_CLI_BRIDGE_MCP_TOOL_MISMATCH: missing required DreamGraph MCP tool(s): ${missingTools.join(", ")}`);
  }

  const runId = input.executionId ?? `architect-${input.adapter}-${randomUUID()}`;
  const scratchDir = await mkdtemp(join(tmpdir(), `dreamgraph-architect-${input.adapter}-`));
  const auditDir = join(scratchDir, "audit");
  // Logical execution IDs are opaque; a browser session ID may contain Windows-invalid colons.
  const auditPath = join(auditDir, `${createHash("sha256").update(runId).digest("hex")}.ndjson`);
  const bridgeSpawn = resolveBridgeSpawn();
  let prompt = serializeCliPrompt(input.messages, input.userMessage, input.adapter, toolRequirements.requirements, { autonomy: input.autonomyMode ?? "manual", verbosity: input.verbosityMode ?? "balanced", computerUse: input.adapter !== "codex-cli" ? "off" : input.computerUse === true ? "granted" : input.computerUseRequestable === true ? "requestable" : "off" });
  const model = input.model && input.model !== "auto" ? input.model : undefined;
  const timeoutMs = Number.isFinite(input.timeoutMs) && input.timeoutMs > 0
    ? Math.max(30_000, Math.min(input.timeoutMs, ARCHITECT_PASS_MAX_MS))
    : CLI_DEFAULT_TIMEOUT_MS;
  const startedAt = Date.now();
  const context = getSessionContext();
  if (!context) { await rm(scratchDir, { recursive: true, force: true }); throw new Error("CLI_EXECUTION_SESSION_REQUIRED"); }
  let lease: Awaited<ReturnType<typeof beginHostExecution>> | undefined;
  let executionSignal: AbortSignal;
  let renewExecution: () => boolean = () => false;
  let dispatched = false, finished = false;
  try {
    lease = await beginHostExecution({ id: runId, query: input.userMessage, adapter: input.adapter,
      plan_id: input.planId, slice_id: input.sliceId, plan_execution: input.planExecution,
      autonomy: input.autonomyMode ?? "manual", verbosity: input.verbosityMode ?? "balanced",
      approved_actions: input.approvedActions, timeout_ms: Math.trunc(timeoutMs) }, input.signal, input.operatorReviewEnabled === true);
    prompt += "\n\n" + lease.execution.block;
    if (Buffer.byteLength(prompt) > NATIVE_CLI_PROMPT_MAX_BYTES) throw new Error("CLI_REQUIRED_PROMPT_BYTE_BOUND: narrow the task without clipping required evidence");
    const executionPolicy = await withHostExecution(runId, async () => getSessionContext()!.execution_policy!);
    executionSignal = executionPolicy.signal; renewExecution = executionPolicy.renew;
    executionSignal.throwIfAborted();
  }
  catch (error) {
    try { if (lease) await endHostExecution({ execution_id: runId, outcome: "failed", work_termination: "confirmed" }); }
    finally { await rm(scratchDir, { recursive: true, force: true }); }
    throw error;
  }

  const cuaHosts: CodexCuaHost[] = [];
  const endCuaHosts = (reason: string) => Promise.all(cuaHosts.map((host) => host.end(reason).catch(() => undefined)));
  try {
    const capability = await probeCliControlCapability(input.adapter, executionSignal);
    await mkdir(auditDir, { recursive: true, mode: 0o700 });
    const envBase = buildBridgeEnv({
      mcpPort,
      runId,
      auditDir,
      auditPath,
      workspaceRoot: getArchitectProjectRoot(),
      verbosityMode: input.verbosityMode,
      sessionBearer: lease.worker_bearer,
      computerUseRequestable: input.adapter === "codex-cli" && input.computerUse !== true && input.computerUseRequestable === true,
    });
    const invocation = input.adapter === "codex-cli"
      ? await prepareCodexInvocation({ scratchDir, prompt, model, bridgeSpawn, envBase, runId, availableToolNames, verbosityMode: input.verbosityMode, reasoningEffort: input.reasoningEffort, computerUse: input.computerUse === true, registerCuaHost: (host) => { cuaHosts.push(host); } })
      : await prepareCopilotInvocation({ scratchDir, prompt, model, bridgeSpawn, envBase, runId, availableToolNames });

    await deliverManagedContext(runId, prompt);

    const auditTail = startAuditTraceTail(auditPath, input.onToolTrace);
    // Granted Computer Use: pre-approve browser access for this Codex session only.
    const sessionGrant = invocation.computerUseServers ? createCodexSessionGrantWatcher(resolveCodexSourceHome()) : null;
    const itemClock = invocation.computerUseServers ? createCodexItemClock() : null;
    const transcript = invocation.computerUseServers
      ? await createCodexTranscriptWriter(join(tmpdir(), "dreamgraph-codex-transcripts"), createHash("sha256").update(runId).digest("hex").slice(0, 32))
      : null;
    let processResult: ProcessResult;
    try {
      const baseConfig = getArchitectLlmConfig();
      const admitted = await nativeCliModelExecution({ ...baseConfig, maxTokens: baseConfig.maxTokens, timeoutMs }, input.adapter, input.model, input.reasoningEffort, "architect", runId);
      processResult = await admitted.request({ provider: baseConfig.provider, model: input.model, payload: prompt,
        output_tokens: baseConfig.maxTokens, signal: executionSignal }, async signal => {
        signal.throwIfAborted(); dispatched = true;
        const result = await runProcess({ command: invocation.command, args: invocation.args, cwd: invocation.cwd,
          env: invocation.env, stdin: invocation.stdin, timeoutMs, signal, onActivity: () => { renewExecution(); },
          ...(sessionGrant || transcript ? { onStdout: (chunk: string) => { sessionGrant?.onStdout(chunk); transcript?.write(chunk); itemClock?.onStdout(chunk); } } : {}) });
        return { result, usage: input.adapter === "codex-cli" ? extractArchitectCodexUsage(result.stdout) : undefined,
          // runProcess resolves only on the child's close event: the native CLI is no longer running,
          // even when it was stopped (timeout/cancel/stale). It must not keep holding admission concurrency.
          acknowledged: true };
      });
    } finally {
      await auditTail.stop();
    }
    const audit = await readAuditTrace(auditPath);
    const auditToolTrace = auditRecordsToToolTrace(audit);
    // Codex's own Computer Use actions (cua_repl) are invisible to DreamGraph's audit; take them from its JSON stream.
    const transcriptText = transcript ? await transcript.close() : "";
    const nativeToolTrace = invocation.computerUseServers && input.adapter === "codex-cli"
      ? codexNativeToolTrace(transcriptText || processResult.stdout, auditToolTrace.length + 1, 500, itemClock?.durations) : [];
    const toolTrace: ArchitectToolTraceEntry[] = [...auditToolTrace, ...nativeToolTrace];
    const computerUseTranscript = transcript && transcriptText ? transcript.path : null;
    let computerUseCleanupLog: string | null = null;
    if (cuaHosts.length > 0) {
      await endCuaHosts(executionSignal.aborted ? "cancelled" : "run finished");
      if (transcript) {
        try {
          computerUseCleanupLog = transcript.path.replace(/\.jsonl$/, ".cua-host.log");
          await writeFile(computerUseCleanupLog, cuaHosts.flatMap((host) => host.log).join("\n") + "\n", { mode: 0o600 });
        } catch { computerUseCleanupLog = null; }
      }
    }
    const computerUseRequestRecord = audit.find((record) => record.tool === "request_computer_use");
    let computerUseRequest: { reason: string } | undefined;
    if (computerUseRequestRecord) { let reason = ""; try { reason = String((JSON.parse(computerUseRequestRecord.inputJson ?? "{}") as { reason?: unknown }).reason ?? ""); } catch { /* bounded audit body */ }
      computerUseRequest = { reason: reason.slice(0, 500) }; }
    auditTail.emitEntries(toolTrace);

    const content = await extractAssistantContent(input.adapter, processResult, invocation.outputPath);
    const usage = input.adapter === "codex-cli" ? extractArchitectCodexUsage(processResult.stdout) : undefined;
    const completedTools = toolTrace.filter((entry) => entry.status === "completed").length;
    const abortReason = executionSignal.aborted ? String((executionSignal.reason as Error | undefined)?.message ?? "") : "";
    const failureReason = /^EXECUTION_(STALE|CEILING_REACHED)/.test(abortReason) ? abortReason
      : executionSignal.aborted ? "ARCHITECT_CLI_CANCELLED" : processResult.timedOut
      ? `${input.adapter.toUpperCase()}_BRIDGE_TIMEOUT: timeout after ${timeoutMs}ms; completed tools ${completedTools}/${toolTrace.length}`
      : processResult.exitCode !== 0
        ? `${input.adapter.toUpperCase()}_BRIDGE_NONZERO_EXIT: exit=${processResult.exitCode}; stderr=${compact(processResult.stderr)}`
        : !content.trim()
          ? `${input.adapter.toUpperCase()}_BRIDGE_EMPTY_RESPONSE: CLI completed without assistant text`
          : null;

    const expired = /^EXECUTION_(STALE|CEILING_REACHED)/.test(abortReason);
    const cancelled = executionSignal.aborted && !expired;
    const effectiveControls = executionSignal.aborted ? lease.controls : await withHostExecution(runId, async () => executionPolicyProjection(getSessionContext()!.execution_policy!));
    await endHostExecution({ execution_id: runId, outcome: cancelled ? "cancelled" : failureReason ? "failed" : "completed",
      work_termination: !failureReason && !processResult.signal ? "confirmed" : "unconfirmed" }); finished = true;
    return {
      ...(computerUseRequest ? { computer_use_request: computerUseRequest } : {}),
      graph_execution: await readManagedContext(runId),
      content: failureReason || cancelled ? "" : content.trim(),
      ...(usage ? { usage } : {}),
      usage_provenance: usage ? "native_reported" : "unavailable",
      model: input.model,
      route: {
        enabled: true,
        provider: input.adapter,
        mcp_port: mcpPort,
        available_tool_count: availableToolNames.length,
        advertised_tool_count: availableToolNames.length,
        advertised_tools: availableToolNames,
        required_tools: toolRequirements.requirements?.required_tools ?? [],
        unavailable_required_tools: toolRequirements.unavailable_required_tools,
        iterations: 1,
        stop_reason: expired ? (abortReason.startsWith("EXECUTION_STALE") ? "execution_stale" : "execution_ceiling_reached") : cancelled ? "cli_cancelled" : processResult.timedOut ? "cli_timed_out" : processResult.exitCode !== 0 ? "cli_failed" : failureReason ? "cli_empty_response" : "cli_completed",
        fallback_reason: failureReason,
        run_id: runId,
        executable: invocation.command,
        bridge_entry: bridgeSpawn.entryPath,
        duration_ms: Math.max(0, Date.now() - startedAt),
        exit_code: processResult.exitCode,
        signal: processResult.signal,
        timed_out: processResult.timedOut,
        adapter_version: capability.version,
        ...(invocation.computerUseServers ? { computer_use_servers: invocation.computerUseServers } : {}),
        ...(sessionGrant?.threadId ? { computer_use_session: sessionGrant.threadId } : {}),
        ...(computerUseTranscript ? { computer_use_transcript: computerUseTranscript } : {}),
        ...(computerUseCleanupLog ? { computer_use_cleanup_log: computerUseCleanupLog } : {}),
        effective_controls: effectiveControls,
        output_controls: { provider: input.adapter === "codex-cli" ? "configured_optional" : "unsupported", prompt: "guided", presentation: "enforced", exact_density: "not_guaranteed" },
      },
      provenance: {
        authority: "dreamgraph_mcp",
        route: input.adapter,
        provider: input.adapter,
        model: input.model,
        run_id: runId,
        tool_calls: toolTrace.map((entry) => ({
          iteration: entry.iteration,
          tool: entry.tool,
          status: entry.status,
          duration_ms: entry.duration_ms,
        })),
      },
      tool_trace: toolTrace,
    };
  } finally {
    try { if (!finished) await endHostExecution({ execution_id: runId, outcome: executionSignal.aborted ? "cancelled" : "failed",
      work_termination: dispatched ? "unconfirmed" : "confirmed" }); }
    finally {
      await endCuaHosts(finished ? "run finished" : "run failed");
      await rm(scratchDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

function architectMcpPort(req: IncomingMessage): number | null {
  const host = req.headers.host;
  if (!host) return null;
  try {
    const url = new URL(`http://${host}`);
    const port = Number(url.port);
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

function resolveBridgeSpawn(): { entryPath: string; command: string; args: string[] } {
  const compiled = fileURLToPath(new URL("./cli-mcp-bridge.js", import.meta.url));
  if (existsSync(compiled)) {
    return { entryPath: compiled, command: process.execPath, args: [compiled] };
  }
  const source = fileURLToPath(new URL("./cli-mcp-bridge.ts", import.meta.url));
  if (existsSync(source)) {
    return { entryPath: source, command: process.execPath, args: [...process.execArgv, "--import", pathToFileURL(createRequire(import.meta.url).resolve("tsx/esm")).href, source] };
  }
  throw new Error("ARCHITECT_CLI_BRIDGE_ENTRY_MISSING: cli-mcp-bridge entry file was not found");
}

function buildBridgeEnv(input: {
  mcpPort: number;
  runId: string;
  auditDir: string;
  auditPath: string;
  workspaceRoot: string;
  verbosityMode?: ArchitectVerbosityMode;
  reasoningEffort?: string;
  sessionBearer?: string;
  computerUseRequestable?: boolean;
}): Record<string, string> {
  const env = stringEnv(process.env);
  const density = resolveArchitectNarrativeDensity(input.verbosityMode);
  return {
    ...env,
    DREAMGRAPH_HOST_MCP_URL: `http://127.0.0.1:${input.mcpPort}/mcp`,
    DREAMGRAPH_BRIDGE_SESSION_BEARER: input.sessionBearer ?? "",
    DREAMGRAPH_BRIDGE_AUDIT_DIR: input.auditDir,
    DREAMGRAPH_AUDIT_PATH: input.auditPath,
    DREAMGRAPH_RUN_ID: input.runId,
    DREAMGRAPH_WORKSPACE_ROOT: input.workspaceRoot,
    DREAMGRAPH_ARCHITECT_VERBOSITY_MODE: density.verbosity_mode,
    DREAMGRAPH_ARCHITECT_STORY_VISIBILITY: density.story_visibility,
    DREAMGRAPH_ARCHITECT_PROMPT_PROFILE: density.prompt_profile,
    DREAMGRAPH_BRIDGE_COMPUTER_USE_REQUESTABLE: input.computerUseRequestable ? "1" : "0",
    ELECTRON_RUN_AS_NODE: "1",
  };
}

function bridgeMcpConfigEnv(env: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of BRIDGE_MCP_CONFIG_ENV_KEYS) {
    out[key] = env[key] ?? "";
  }
  return out;
}

async function resolveArchitectCliExecutable(adapter: ArchitectCliAdapter): Promise<string> {
  const envKey = CLI_BINARY_ENV_KEY_BY_ADAPTER[adapter];
  const configured = process.env[envKey]?.trim();
  const binaryName = configured && configured.length > 0
    ? configured
    : CLI_DEFAULT_BINARY_BY_ADAPTER[adapter];
  const resolved = await resolveArchitectCliBridgeExecutablePath(binaryName, process.env);
  if (resolved) return resolved;
  const label = adapter === "codex-cli" ? "CODEX_CLI_NOT_FOUND" : "COPILOT_CLI_NOT_FOUND";
  throw new Error(`${label}: binary "${binaryName}" was not found on PATH; set ${envKey} to the full CLI executable path`);
}

export async function resolveArchitectCliBridgeExecutablePath(
  binaryName: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<string | null> {
  if (typeof binaryName !== "string" || binaryName.trim().length === 0) {
    throw new Error("resolveArchitectCliBridgeExecutablePath: binaryName must be a non-empty string");
  }
  const normalized = binaryName.trim();
  let resolved: string | null = null;
  if (IS_WINDOWS) {
    resolved = await resolveViaPowerShell(normalized, env);
  }
  return resolved ?? await resolveOnPath(normalized, env);
}

async function resolveViaPowerShell(
  binaryName: string,
  env: Readonly<Record<string, string | undefined>>,
): Promise<string | null> {
  if (!IS_WINDOWS) return null;
  if (/[\u0000-\u001f]/.test(binaryName)) return null;
  const quoted = binaryName.replace(/'/g, "''");
  const script =
    `$ErrorActionPreference='SilentlyContinue';` +
    `$commands=Get-Command -Name '${quoted}' -CommandType Application,ExternalScript -All -ErrorAction SilentlyContinue;` +
    `if($commands){[Console]::Out.Write(($commands|ForEach-Object{$_.Source}) -join [char]0)}`;
  const result = await runProcess({
    command: "powershell.exe",
    args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    cwd: process.cwd(),
    env: stringEnv(env),
    stdin: "",
    timeoutMs: 5_000,
  }).catch(() => null);
  if (!result || result.exitCode !== 0) return null;
  const live: string[] = [];
  for (const candidate of result.stdout.split("\u0000").map((value) => value.trim()).filter(Boolean)) {
    if (await isExecutableFile(candidate)) live.push(candidate);
  }
  if (live.length === 0) return null;
  live.sort((a, b) => rankWindowsShimByExtension(a) - rankWindowsShimByExtension(b));
  return live[0] ?? null;
}

async function resolveOnPath(
  binaryName: string,
  env: Readonly<Record<string, string | undefined>>,
): Promise<string | null> {
  if (isAbsolute(binaryName)) {
    if (await isExecutableFile(binaryName)) {
      if (!IS_WINDOWS || hasWindowsExecutableExtension(binaryName)) return binaryName;
      for (const ext of WINDOWS_PATH_EXTS) {
        const candidate = binaryName + ext.toLowerCase();
        if (await isExecutableFile(candidate)) return candidate;
      }
      return null;
    }
    if (IS_WINDOWS) {
      for (const ext of WINDOWS_PATH_EXTS) {
        const candidate = binaryName + ext.toLowerCase();
        if (await isExecutableFile(candidate)) return candidate;
      }
    }
    return null;
  }

  const pathVar = env.PATH ?? env.Path ?? env.path ?? "";
  if (!pathVar) return null;
  const candidates: string[] = [];
  for (const dir of pathVar.split(delimiter)) {
    if (!dir) continue;
    if (IS_WINDOWS) {
      for (const ext of WINDOWS_PATH_EXTS) candidates.push(join(dir, binaryName + ext.toLowerCase()));
      if (hasWindowsExecutableExtension(binaryName)) candidates.push(join(dir, binaryName));
    } else {
      candidates.push(join(dir, binaryName));
    }
  }

  const live: string[] = [];
  for (const candidate of candidates) {
    if (await isExecutableFile(candidate)) live.push(candidate);
  }
  if (live.length === 0) return null;
  if (IS_WINDOWS) live.sort((a, b) => rankWindowsShimByExtension(a) - rankWindowsShimByExtension(b));
  return live[0] ?? null;
}

async function isExecutableFile(absPath: string): Promise<boolean> {
  try {
    await access(absPath, IS_WINDOWS ? FS.F_OK : FS.X_OK);
    return true;
  } catch {
    return false;
  }
}

function hasWindowsExecutableExtension(sourcePath: string): boolean {
  const lower = sourcePath.toLowerCase();
  return WINDOWS_PATH_EXTS.some((ext) => lower.endsWith(ext));
}

function rankWindowsShimByExtension(sourcePath: string): number {
  const lower = sourcePath.toLowerCase();
  if (lower.endsWith(".exe")) return 0;
  if (lower.endsWith(".cmd")) return 1;
  if (lower.endsWith(".com")) return 2;
  if (lower.endsWith(".bat")) return 3;
  if (lower.endsWith(".ps1")) return 4;
  return 5;
}

async function prepareCodexInvocation(input: {
  scratchDir: string;
  prompt: string;
  model: string | undefined;
  bridgeSpawn: { entryPath: string; command: string; args: string[] };
  envBase: Record<string, string>;
  runId: string;
  availableToolNames: string[];
  verbosityMode?: ArchitectVerbosityMode;
  reasoningEffort?: string;
  computerUse?: boolean;
  /** Receives each daemon-owned cua_repl host as soon as it starts (so it is always ended). */
  registerCuaHost?: (host: CodexCuaHost) => void;
}): Promise<{ command: string; args: string[]; cwd: string; env: Record<string, string>; stdin: string; outputPath: string | null; computerUseServers?: string[]; cuaControlDir?: string }> {
  const command = await resolveArchitectCliExecutable("codex-cli");
  // Granted Computer Use: wire the Codex app's own Computer Use MCP server(s) into the
  // isolated home. Fail before the model is admitted if the runtime is not installed.
  let computerUseServers: CodexComputerUseServer[] = [];
  let cuaControlDir: string | null = null;
  let codexNotify: string[] | null = null;
  if (input.computerUse === true) {
    const discovery = await discoverCodexComputerUseServers(resolveCodexSourceHome());
    if (discovery.servers.length === 0) {
      throw new Error(`CODEX_COMPUTER_USE_RUNTIME_UNAVAILABLE: Computer Use was allowed, but the Codex app's Computer Use runtime was not found (${discovery.diagnostics.join("; ") || "no candidates"}). Install or enable Computer Use in the Codex desktop app, keep the app running, and try again.`);
    }
    computerUseServers = widenCodexComputerUseSurfaces(discovery.servers);
    // Turn-end cleanup: Codex kills its MCP servers outright on exit, so the daemon hosts cua_repl
    // itself (outside Codex's process tree) and Codex connects over local HTTP. After the run the
    // daemon sends `turn_ended` (what the Codex app's plugin hook does) and stops the server.
    const hosted: CodexComputerUseServer[] = [];
    for (const server of computerUseServers) {
      const host = await startCodexCuaHost({ command: server.command, args: server.args, env: { ...stringEnv(process.env), ...server.env } });
      input.registerCuaHost?.(host);
      hosted.push({ ...server, url: host.url });
    }
    computerUseServers = hosted;
    // Keep the operator's own Codex notify (the desktop Computer Use helper's turn-ended).
    const operatorNotify = await readCodexNotify(resolveCodexSourceHome());
    if (operatorNotify.length > 0) codexNotify = operatorNotify;
  }
  const codexHome = join(input.scratchDir, "codex-home");
  const artifactsDir = join(input.scratchDir, "artifacts");
  await mkdir(codexHome, { recursive: true, mode: 0o700 });
  await mkdir(artifactsDir, { recursive: true, mode: 0o700 });
  await copyCodexHomeAuthArtifacts(codexHome);
  await writeFile(join(codexHome, "config.toml"), createArchitectCodexConfigToml({
    bridgeCommand: input.bridgeSpawn.command,
    bridgeArgs: input.bridgeSpawn.args,
    env: bridgeMcpConfigEnv(input.envBase),
    tools: input.availableToolNames,
    modelVerbosity: resolveArchitectNarrativeDensity(input.verbosityMode).provider_text_verbosity,
    computerUse: input.computerUse === true,
    computerUseServers,
    ...(codexNotify ? { notify: codexNotify } : {}),
  }), { mode: 0o600 });

  const outputPath = join(artifactsDir, "last-message.txt");
  const args = [
    "exec",
    "--json",
    "--cd",
    input.scratchDir,
    "--sandbox",
    "read-only",
    "--output-last-message",
    outputPath,
    "--skip-git-repo-check",
    "--ignore-rules",
    "--ephemeral",
  ];
  if (input.model) args.push("--model", input.model);
  if (input.reasoningEffort) args.push("-c", "model_reasoning_effort=" + JSON.stringify(input.reasoningEffort));
  args.push("-");

  return {
    command,
    args,
    cwd: input.scratchDir,
    env: {
      ...input.envBase,
      CODEX_HOME: codexHome,
      RUST_LOG: input.envBase.RUST_LOG || "info,codex_mcp_server=info,rmcp=warn",
    },
    stdin: input.prompt,
    outputPath,
    ...(computerUseServers.length > 0 ? { computerUseServers: computerUseServers.map((server) => server.name) } : {}),
    ...(cuaControlDir ? { cuaControlDir } : {}),
  };
}

export function createArchitectCopilotPromptFileDirective(promptFilePath: string): string {
  return "The full DreamGraph Architect request is stored verbatim in the file at this path: "
    + promptFilePath
    + ". Use your read tool to load the file's full contents before responding. Treat that file as the request envelope, respond only to its CURRENT USER REQUEST section, and use DreamGraph MCP for repository facts, mutations, and verification. Do not mention this transport directive.";
}

async function prepareCopilotInvocation(input: {
  scratchDir: string;
  prompt: string;
  model: string | undefined;
  bridgeSpawn: { entryPath: string; command: string; args: string[] };
  envBase: Record<string, string>;
  runId: string;
  availableToolNames: string[];
}): Promise<{ command: string; args: string[]; cwd: string; env: Record<string, string>; stdin: string; outputPath: string | null; computerUseServers?: string[]; cuaControlDir?: string }> {
  const command = await resolveArchitectCliExecutable("copilot-cli");
  const copilotHome = join(input.scratchDir, "copilot-home");
  const promptFilePath = join(input.scratchDir, "prompt.md");
  await mkdir(copilotHome, { recursive: true, mode: 0o700 });
  await copyCopilotHome(copilotHome);
  await writeFile(promptFilePath, input.prompt, { mode: 0o600 });
  await writeFile(join(copilotHome, "mcp-config.json"), copilotMcpConfigJson({
    bridgeCommand: input.bridgeSpawn.command,
    bridgeArgs: input.bridgeSpawn.args,
    env: bridgeMcpConfigEnv(input.envBase),
    tools: input.availableToolNames,
    runId: input.runId,
  }), { mode: 0o600 });

  const args = [];
  if (input.model) args.push("--model", input.model);
  args.push("--allow-all-tools", "--disable-builtin-mcps", "--output-format", "json", "--deny-tool", "shell", "--deny-tool", "write");
  for (const tool of input.availableToolNames) {
    args.push("--allow-tool", `dreamgraph(${tool})`);
  }
  args.push("--add-dir", input.scratchDir, "--prompt", createArchitectCopilotPromptFileDirective(promptFilePath));

  return {
    command,
    args,
    cwd: getArchitectProjectRoot(),
    env: { ...input.envBase, COPILOT_HOME: copilotHome },
    stdin: "",
    outputPath: null,
  };
}

export function createArchitectCodexConfigToml(input: {
  bridgeCommand: string;
  bridgeArgs: string[];
  env: Record<string, string>;
  tools: string[];
  modelVerbosity?: "low" | "medium" | "high";
  /** Set only from the local operator's Computer Use policy/answer for this pass. */
  computerUse?: boolean;
  /** Codex app Computer Use MCP servers; written only when computerUse is allowed. */
  computerUseServers?: readonly CodexComputerUseServer[];
  /** Top-level Codex `notify` argv (granted Computer Use turn-end cleanup). */
  notify?: readonly string[];
}): string {
  const allow = input.computerUse === true;
  const flag = allow ? "true" : "false";
  const lines = [
    "# Generated by DreamGraph for an isolated standalone Architect Codex CLI run.",
    ...(allow && input.notify && input.notify.length > 0 ? [`notify = ${tomlArray(input.notify)}`] : []),
    ...(input.modelVerbosity ? [`model_verbosity = ${tomlString(input.modelVerbosity)}`, ""] : []),
    // Codex owns its native Computer Use. It is enabled only when the local
    // operator's policy (allow) or explicit per-request answer (ask) permits it.
    "[computer_use]",
    `default_app_access = ${tomlString(allow ? "allow" : "deny")}`,
    "",
    "[features]",
    `computer_use = ${flag}`,
    `browser_use = ${flag}`,
    `browser_use_external = ${flag}`,
    "browser_use_full_cdp_access = false",
    `in_app_browser = ${flag}`,
    "",
    "[mcp_servers.dreamgraph]",
    `command = ${tomlString(input.bridgeCommand)}`,
    `args = ${tomlArray(input.bridgeArgs)}`,
    `trust_level = ${tomlString("trusted")}`,
    "disabled_tools = []",
    "default_tools_enabled = true",
    `default_tools_approval_mode = ${tomlString("approve")}`,
    "",
    "[mcp_servers.dreamgraph.env]",
  ];
  for (const key of Object.keys(input.env).sort()) {
    lines.push(`${tomlKey(key)} = ${tomlString(input.env[key] ?? "")}`);
  }
  for (const tool of input.tools) {
    lines.push("", `[mcp_servers.dreamgraph.tools.${tomlKey(tool)}]`, `approval_mode = ${tomlString("approve")}`);
  }
  if (allow && input.computerUseServers && input.computerUseServers.length > 0) {
    lines.push(...codexComputerUseServersToml(input.computerUseServers));
    // Same turn-end hooks as the Codex app's unified-computer-use plugin (cleanup inside Codex's lifecycle).
    if (input.computerUseServers.some((server) => server.name === "cua_repl")) lines.push(...codexTurnEndHooksToml("cua_repl"));
  }
  return `${lines.join("\n")}\n`;
}

function copilotMcpConfigJson(input: {
  bridgeCommand: string;
  bridgeArgs: string[];
  env: Record<string, string>;
  tools: string[];
  runId: string;
}): string {
  return `${JSON.stringify({
    mcpServers: {
      dreamgraph: {
        type: "stdio",
        command: input.bridgeCommand,
        args: input.bridgeArgs,
        env: input.env,
      },
    },
    _dreamgraph_meta: {
      runId: input.runId,
      authoritativeServer: "dreamgraph",
      allowlist: input.tools,
    },
  }, null, 2)}\n`;
}

export function serializeCliPrompt(
  messages: LlmMessage[],
  userMessage: string,
  adapter: ArchitectCliAdapter,
  toolRequirements?: ArchitectCliToolRequirements | null,
  controls?: { autonomy: "manual" | "supervised" | "autonomous"; verbosity: ArchitectVerbosityMode; computerUse?: ComputerUseMode },
): string {
  const contextMessages = messages.filter((message) => message.role !== "user");
  return [
    `You are running inside DreamGraph architect through the real ${adapter} bridge.`,
    "Use the dreamgraph MCP server as the authoritative source for repository facts, graph context, ADR guard rails, mutations, and verification.",
    "Graph-bound execution contract: every repository-specific pass must ground itself with dreamgraph:query_resource and dreamgraph:query_architecture_decisions before acting; use graph_rag_retrieve, query_api_surface, search_data_model, workflows, or data-model resources when they fit the task.",
    "Cognitive-health contract: before substantial architectural work, call dreamgraph:graph_health_report and explain any evidence-backed reasoning risk. Recommend the smallest repair (enrich before scan; scan before bootstrap), but do not execute maintenance unless the current user request approves it. Approved maintenance runs through DreamGraph MCP, never by redirecting the user to a CLI.",
    "Mutation contract: source, docs, UI, data-model, or plan changes must be recorded back into DreamGraph evidence using the appropriate governed graph tool, such as enrich_seed_data, modify_api_surface, register_ui_element, solidify_cognitive_insight, or another exposed graph-write tool.",
    "Living-graph contract: record governed source effects and targeted reconciliation/digestion obligations. Keep hypotheses separate from facts. Run only approved bounded cognition over affected focus_entities; hop depth is a configured maximum, never a mandatory minimum.",
    "ADR contract: if the pass introduces a new durable architectural policy, reverses a guard rail, or creates a lasting cross-module decision, record it with record_architecture_decision; otherwise report the ADRs consulted and why no new ADR was needed.",
    "Do not use provider-native shell/read/write routes; use dreamgraph:run_command, read_source_code, patch_file, query_resource, query_architecture_decisions, and related DreamGraph MCP tools.",
    "The user request appears only in CURRENT USER REQUEST. Do not reconstruct it from prior sections.",
    createArchitectCliToolRequirementsSection(toolRequirements),
    createCliControlInstructions(controls?.autonomy ?? "manual", controls?.verbosity ?? "balanced", controls?.computerUse ?? "off"),
    "",
    ...contextMessages.map((message) => `## ${message.role.toUpperCase()}\n${message.content}`),
    "",
    "## CURRENT USER REQUEST",
    userMessage,
  ].join("\n\n");
}
export type ComputerUseMode = "granted" | "requestable" | "off";
export function createCliControlInstructions(autonomy: "manual" | "supervised" | "autonomous", verbosity: ArchitectVerbosityMode, computerUse: ComputerUseMode = "off"): string {
  const action = autonomy === "manual" ? "Inspect/propose. Execute at most one specifically approved bounded effect, then return control. Do not continue to another slice."
    : autonomy === "supervised" ? "Execute only the approved checkpoint scope. Stop at its review checkpoint, unresolved question, scope change or governance gate."
    : "Continue eligible work within the approved task scope until task completion, a governance gate, resource limit, contradiction or user stop. Completing an intermediate slice does not complete the task.";
  const density = verbosity === "concise" ? "Give a brief outcome and essential evidence. Keep supporting diagnostics compact."
    : verbosity === "detailed" ? "Explain the outcome, relevant rationale, alternatives and uncertainty, with evidence links and diagnostic summary."
    : "Give the outcome with focused evidence and useful reasoning summary.";
  return `Effective controls: autonomy=${autonomy}; verbosity=${verbosity}. ${action} ${density} All modes preserve graph/ADR anchors, provenance, failures, scoped currency/completeness warnings and reconciliation obligations. Output density is guidance, never permission or guaranteed word count. The daemon enforces approved effect arguments and finite limits; ${computerUse === "granted"
    ? "the local operator has GRANTED full native Computer Use for this pass: use your own tools (in Codex: the cua_repl MCP server, browser and desktop surfaces) to operate any web page or application on this machine to fulfil the request. Site and app access is pre-approved for this run; do not stop to ask for permission. If the request concerns a page or app that is already open, take over that existing tab or window (for a browser tab: cua.getTab({ url }) or browser.user.openTabs() then claimTab) instead of opening a new one. Native page dialogs (alert/confirm/prompt) block the page until answered: answer them with the browser dialog API (accept(), accept(text) or dismiss()) or the desktop surface, then continue. Computer Use is for operating web pages and applications only: never use it (or cua_repl JavaScript, editors, terminals or file dialogs) to read, write, run or change this project's repository; every project read, mutation and command still goes exclusively through the DreamGraph MCP tools. Report what you did and observed."
    : computerUse === "requestable"
      ? "Computer Use is NOT granted for this pass. If the request genuinely requires operating this computer (browser, apps, screen), call the DreamGraph tool request_computer_use with a one-sentence reason, then end your turn; the operator will be asked and the request re-run with Computer Use if allowed. Otherwise do not ask."
      : "no native Computer Use permission is implied."}`;
}

export function createArchitectCliToolRequirementsSection(toolRequirements?: ArchitectCliToolRequirements | null): string {
  if (!toolRequirements) return "Execution tool requirements: none beyond the adapter baseline.";
  const required = toolRequirements.required_tools.length > 0 ? toolRequirements.required_tools.join(", ") : "none";
  const preferred = toolRequirements.preferred_tools.length > 0 ? toolRequirements.preferred_tools.join(", ") : "none";
  return [
    "Concrete tool requirements for this execution:",
    `- required_tools: ${required}`,
    `- preferred_tools: ${preferred}`,
    "These are controller-derived execution requirements. If a required tool is unavailable, report registry or policy evidence instead of using a provider-native substitute.",
  ].join("\n");
}

function resolveCliToolRequirements(
  requirements: ArchitectCliToolRequirements | null | undefined,
  availableToolNames: readonly string[],
): { requirements: ArchitectCliToolRequirements | null; unavailable_required_tools: string[] } {
  if (!requirements) return { requirements: null, unavailable_required_tools: [] };
  const available = new Set(availableToolNames);
  const required = normalizeCliRequirementTools(requirements.required_tools);
  const preferred = normalizeCliRequirementTools(requirements.preferred_tools);
  const unavailable = required.filter((tool) => !available.has(tool));
  return { requirements: { required_tools: required, preferred_tools: preferred }, unavailable_required_tools: unavailable };
}

function normalizeCliRequirementTools(names: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(name) || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

async function copyCodexHomeAuthArtifacts(runHomeDir: string): Promise<void> {
  const sourceHome = resolveCodexSourceHome();
  for (const filename of CODEX_HOME_AUTH_ARTIFACTS) {
    const source = join(sourceHome, filename);
    try {
      await copyFile(source, join(runHomeDir, filename));
    } catch {
      // Missing auth artifacts are reported by Codex during the login probe/run.
    }
  }
}

async function copyCopilotHome(runHomeDir: string): Promise<void> {
  const sourceHome = process.env.COPILOT_HOME && process.env.COPILOT_HOME.length > 0
    ? process.env.COPILOT_HOME
    : join(homedir(), ".copilot");
  await copyDirRecursive(sourceHome, runHomeDir, new Set(["mcp-config.json"]));
}

async function copyDirRecursive(source: string, target: string, excludeNames: Set<string>): Promise<void> {
  let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
  try {
    entries = await readdir(source, { withFileTypes: true });
  } catch {
    return;
  }
  await mkdir(target, { recursive: true, mode: 0o700 });
  for (const entry of entries) {
    if (excludeNames.has(entry.name)) continue;
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive(from, to, excludeNames);
    } else if (entry.isFile()) {
      await copyFile(from, to).catch(() => undefined);
    }
  }
}

export function createArchitectCliBridgeSpawnPlan(command: string, args: readonly string[]): {
  command: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
} {
  if (IS_WINDOWS && /\.ps1$/i.test(command)) {
    return {
      command: "powershell.exe",
      args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", command, ...args],
    };
  }
  if (IS_WINDOWS && /\.(?:cmd|bat)$/i.test(command)) {
    for (let index = 0; index < args.length; index += 1) {
      if (/[\r\n]/.test(args[index] ?? "")) {
        throw new Error(`runProcess: argv[${index}] for Windows command shim contains a newline; pass payloads via stdin or a file`);
      }
    }
    const tokens = [command, ...args]
      .map((token) => quoteForCommandLineToArgvW(token))
      .map((token) => escapeForCmdExe(token))
      .join(" ");
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", `"${tokens}"`],
      windowsVerbatimArguments: true,
    };
  }
  return { command, args: [...args] };
}

function quoteForCommandLineToArgvW(arg: string): string {
  if (arg.length > 0 && !/[ \t\n\v"]/.test(arg)) return arg;
  let out = "\"";
  for (let index = 0; index <= arg.length; index += 1) {
    let backslashes = 0;
    while (index < arg.length && arg[index] === "\\") {
      backslashes += 1;
      index += 1;
    }
    if (index === arg.length) {
      out += "\\".repeat(backslashes * 2);
      break;
    }
    if (arg[index] === "\"") {
      out += "\\".repeat(backslashes * 2 + 1) + "\"";
    } else {
      out += "\\".repeat(backslashes);
      out += arg[index] ?? "";
    }
  }
  return `${out}"`;
}

function escapeForCmdExe(token: string): string {
  return token.replace(/[()%!^<>&|]/g, (value) => `^${value}`);
}

function runProcess(input: {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  stdin: string;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Called on any process output; used as execution liveness evidence. */
  onActivity?: () => void;
  /** Raw stdout chunks as they arrive (bounded consumers only). */
  onStdout?: (chunk: string) => void;
}): Promise<ProcessResult> {
  return new Promise((resolvePromise, reject) => {
    const startedAt = Date.now();
    const spawnPlan = createArchitectCliBridgeSpawnPlan(input.command, input.args);
    const child = spawn(spawnPlan.command, spawnPlan.args, {
      cwd: input.cwd,
      env: input.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      windowsVerbatimArguments: spawnPlan.windowsVerbatimArguments,
      detached: !IS_WINDOWS,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const terminateChild = () => {
      if (!child.pid) return;
      if (IS_WINDOWS) { const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); killer.on("error", () => undefined); }
      else try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminateChild();
    }, input.timeoutMs);
    timer.unref?.();
    const abortListener = () => terminateChild();
    if (input.signal?.aborted) {
      abortListener();
    } else {
      input.signal?.addEventListener("abort", abortListener, { once: true });
    }

    child.stdout.on("data", (chunk) => {
      stdout = appendLimited(stdout, String(chunk));
      try { input.onStdout?.(String(chunk)); } catch { /* observer must not break the run */ }
      input.onActivity?.();
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendLimited(stderr, String(chunk));
      input.onActivity?.();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", abortListener);
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", abortListener);
      if (settled) return;
      settled = true;
      resolvePromise({
        stdout,
        stderr,
        exitCode,
        signal,
        timedOut,
        durationMs: Math.max(0, Date.now() - startedAt),
      });
    });

    child.stdin.end(input.stdin);
  });
}
/** Read-only native discovery is distinct from scope/control/receipt qualification. */
export function parseCodexComputerDiscovery(versionOutput:string,featureOutput:string) {
  if(Buffer.byteLength(versionOutput,"utf8")>1024||Buffer.byteLength(featureOutput,"utf8")>32768)throw new Error("COMPUTER_CLI_PROBE_BYTE_BOUND");
  const version=versionOutput.trim().match(/^codex-cli (\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?)$/)?.[1];
  if(!version)throw new Error("COMPUTER_CLI_VERSION_UNVERIFIED");
  const names=["computer_use","browser_use","browser_use_external","browser_use_full_cdp_access","in_app_browser"];
  const features:Record<string,{stage:string;enabled:boolean}>={};
  for(const line of featureOutput.split(/\r?\n/)){
    const name=line.trim().split(/\s+/)[0];if(!names.includes(name))continue;
    const match=line.trim().match(/^(\S+)\s+(.+?)\s+(true|false)$/);
    if(!match||features[name])throw new Error("COMPUTER_CLI_FEATURE_UNVERIFIED");
    features[name]={stage:match[2],enabled:match[3]==="true"};
  }
  return {adapter:"codex-cli",version,features,checked_at:new Date().toISOString(),
    native_feature_detected:Object.keys(features).length>0,qualified:false as const,
    qualification_missing:["scoped_target_grant","bounded_native_actions","privacy_and_disclosure","independent_physical_stop","durable_normalized_receipts"]};
}
const codexComputerProbes=new Map<string,{expires:number;value:Promise<ReturnType<typeof parseCodexComputerDiscovery>>}>();
export async function inspectCodexNativeComputer() {
  const command=await resolveArchitectCliExecutable("codex-cli"),cached=codexComputerProbes.get(command);
  if(cached&&cached.expires>Date.now())return structuredClone(await cached.value);
  const value=(async()=>{
    const env=Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string]=>typeof entry[1]==="string"));
    const version=await runProcess({command,args:["--version"],cwd:process.cwd(),env,stdin:"",timeoutMs:6000});
    if(version.exitCode!==0||version.timedOut)throw new Error("COMPUTER_CLI_VERSION_PROBE_FAILED");
    const features=await runProcess({command,args:["features","list"],cwd:process.cwd(),env,stdin:"",timeoutMs:6000});
    if(features.exitCode!==0||features.timedOut)throw new Error("COMPUTER_CLI_FEATURE_PROBE_FAILED");
    return parseCodexComputerDiscovery(version.stdout,features.stdout);
  })();
  codexComputerProbes.set(command,{expires:Date.now()+300000,value});
  try{return structuredClone(await value);}catch(error){codexComputerProbes.delete(command);throw error;}
}
export function qualifyCliControlHelp(adapter: ArchitectCliAdapter, versionOutput: string, help: string) {
  const version = /\b(\d+\.\d+\.\d+)\b/.exec(versionOutput)?.[1];
  const flags = adapter === "codex-cli" ? ["--sandbox", "--json", "--output-last-message", "--ephemeral", "--ignore-rules"]
    : ["--allow-all-tools", "--deny-tool", "--disable-builtin-mcps", "--output-format", "--prompt"];
  if (!version || flags.some(flag => !help.includes(flag))) throw new Error("CLI_CONTROL_CAPABILITY_UNQUALIFIED");
  return { version, verified_flags: flags, source: "installed_read_only_version_and_help", output_density: "optional_provider_config_and_prompt_guidance" };
}
async function probeCliControlCapability(adapter: ArchitectCliAdapter, signal?: AbortSignal) {
  const command = await resolveArchitectCliExecutable(adapter), env = stringEnv(process.env);
  const version = await runProcess({ command, args: ["--version"], cwd: process.cwd(), env, stdin: "", timeoutMs: 10000, signal });
  const help = await runProcess({ command, args: adapter === "codex-cli" ? ["exec", "--help"] : ["--help"], cwd: process.cwd(), env, stdin: "", timeoutMs: 10000, signal });
  if (version.exitCode !== 0 || help.exitCode !== 0 || version.timedOut || help.timedOut) throw new Error("CLI_CONTROL_CAPABILITY_PROBE_FAILED");
  return qualifyCliControlHelp(adapter, version.stdout, help.stdout);
}

/** Report token components only when the native worker supplies them. */
export function extractArchitectCodexUsage(stdout: string): TokenUsage | undefined {
  let usage: TokenUsage | undefined;
  for (const line of stdout.split(/\r?\n/)) {
    try { const event = JSON.parse(line); if (event.type === "turn.completed") usage = providerUsage("openai", { input_tokens: event.usage?.input_tokens, output_tokens: event.usage?.output_tokens, input_tokens_details: { cached_tokens: event.usage?.cached_input_tokens } }); } catch { /* No inferred usage from prose/diagnostics. */ }
  }
  return usage;
}

async function extractAssistantContent(adapter: ArchitectCliAdapter, result: ProcessResult, outputPath: string | null): Promise<string> {
  if (outputPath) {
    const fromFile = await readFile(outputPath, "utf8").catch(() => "");
    if (fromFile.trim()) return fromFile;
  }
  if (adapter === "copilot-cli") {
    const parsed = extractCopilotAssistantText(result.stdout);
    if (parsed.trim()) return parsed;
  }
  return compact(result.stdout);
}

export function resolveArchitectCliBridgeToolNames(upstreamToolNames: readonly string[]): string[] {
  const names = [...upstreamToolNames];
  for (const localToolName of BRIDGE_LOCAL_DREAMGRAPH_TOOLS) {
    if (!names.includes(localToolName)) names.push(localToolName);
  }
  return names;
}

function extractCopilotAssistantText(stdout: string): string {
  const chunks: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim().startsWith("{")) continue;
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (event.type === "assistant.message_delta" && typeof event.deltaContent === "string") {
        chunks.push(event.deltaContent);
      } else if (event.type === "assistant.message" && typeof event.content === "string") {
        chunks.length = 0;
        chunks.push(event.content);
      }
    } catch {
      // ignore non-event lines
    }
  }
  return chunks.join("");
}

async function readAuditTrace(auditPath: string): Promise<AuditRecord[]> {
  const text = await readFile(auditPath, "utf8").catch(() => "");
  const out: AuditRecord[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as AuditRecord;
      out.push(parsed);
    } catch {
      // ignore malformed audit lines
    }
  }
  return out;
}

function auditTraceKey(record: AuditRecord, fallbackIndex: number): string {
  return [record.server ?? "dreamgraph", record.tool ?? "unknown", String(record.startedAtEpochMs ?? fallbackIndex)].join(":");
}

function auditRecordsToToolTrace(records: AuditRecord[]): ArchitectToolTraceEntry[] {
  const order = new Map<string, number>();
  const byKey = new Map<string, ArchitectToolTraceEntry>();
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const key = auditTraceKey(record, index);
    if (!order.has(key)) order.set(key, order.size + 1);
    byKey.set(key, auditToToolTrace(record, order.get(key) ?? order.size + 1, key));
  }
  return [...byKey.entries()]
    .sort((left, right) => (order.get(left[0]) ?? 0) - (order.get(right[0]) ?? 0))
    .map(([, entry]) => entry);
}

function startAuditTraceTail(
  auditPath: string,
  onToolTrace: ((entry: ArchitectToolTraceEntry) => void) | undefined,
): { stop: () => Promise<void>; emitEntries: (entries: ArchitectToolTraceEntry[]) => void } {
  if (!onToolTrace) {
    return { stop: async () => undefined, emitEntries: () => undefined };
  }
  const emitted = new Map<string, string>();
  let flushing = false;
  const emitEntries = (entries: ArchitectToolTraceEntry[]): void => {
    for (const entry of entries) {
      const key = entry.trace_id ?? `${entry.tool}:${entry.iteration}`;
      const signature = [entry.status, entry.duration_ms, entry.result_preview].join("|");
      if (emitted.get(key) === signature) continue;
      emitted.set(key, signature);
      onToolTrace(entry);
    }
  };
  const flush = async (): Promise<void> => {
    if (flushing) return;
    flushing = true;
    try {
      emitEntries(auditRecordsToToolTrace(await readAuditTrace(auditPath)));
    } finally {
      flushing = false;
    }
  };
  const timer = setInterval(() => {
    void flush();
  }, 250);
  timer.unref?.();
  void flush();
  return {
    stop: async () => {
      clearInterval(timer);
      await flush();
    },
    emitEntries,
  };
}

function auditToToolTrace(record: AuditRecord, iteration: number, traceId: string): ArchitectToolTraceEntry {
  const status = record.status ?? (record.isError ? "failed" : "completed");
  return {
    iteration,
    tool: `${record.server ?? "dreamgraph"}:${record.tool ?? "unknown"}`,
    args_summary: compact(record.inputJson ?? "{}"),
    status,
    duration_ms: typeof record.durationMs === "number" ? Math.max(0, Math.trunc(record.durationMs)) : 0,
    result_preview: createArchitectToolResultPreview(record.resultJson ?? ""),
    trace_id: traceId,
  };
}

function appendLimited(current: string, next: string): string {
  const combined = current + next;
  if (combined.length <= OUTPUT_LIMIT) return combined;
  return `${combined.slice(0, OUTPUT_LIMIT)}\n[output truncated]`;
}

function compact(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 4_000);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringEnv(source: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlKey(value: string): string {
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : tomlString(value);
}

function tomlArray(values: readonly string[]): string {
  return `[${values.map(tomlString).join(", ")}]`;
}
