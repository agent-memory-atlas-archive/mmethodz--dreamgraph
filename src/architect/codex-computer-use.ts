/**
 * Codex CLI native Computer Use for isolated Architect runs.
 *
 * DreamGraph runs Codex with a per-run, isolated CODEX_HOME. Codex's native
 * Computer Use / browser control is NOT provided by the `[features]` flags in
 * config.toml: on the Codex desktop app it is an MCP server (`cua_repl`)
 * contributed by the bundled `unified-computer-use` plugin, which talks to the
 * running Codex app over a native pipe. Codex's plugin loader does not load
 * that plugin from an isolated home, so when the local operator has granted
 * Computer Use for a pass, DreamGraph reads the plugin's own `.mcp.json` from
 * the operator's real Codex home and writes those servers into the isolated
 * config as ordinary `[mcp_servers.*]` entries.
 *
 * Nothing in the real Codex home is modified. Servers are re-read on every
 * granted run, so Codex app updates (new runtime hashes, pipe names) are
 * followed automatically.
 */
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

/** Codex plugins whose MCP servers provide native Computer Use / browser control. */
export const CODEX_COMPUTER_USE_PLUGINS = Object.freeze(["unified-computer-use"] as const);

/** Server names DreamGraph owns in the generated config and never takes from a plugin. */
const RESERVED_SERVER_NAMES = new Set(["dreamgraph"]);

const MCP_JSON_MAX_BYTES = 256 * 1024;

export interface CodexComputerUseServer {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  env_vars: string[];
  startup_timeout_sec?: number;
  enabled_tools?: string[];
  /** Plugin `.mcp.json` the server was read from (provenance only). */
  source: string;
}

export interface CodexComputerUseDiscovery {
  servers: CodexComputerUseServer[];
  /** Human-readable reasons a candidate was skipped; empty when everything loaded. */
  diagnostics: string[];
}

export function resolveCodexSourceHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.CODEX_HOME && env.CODEX_HOME.length > 0 ? env.CODEX_HOME : join(homedir(), ".codex");
}

/**
 * Find the newest installed version of each Computer Use plugin under
 * `<codexHome>/plugins/cache/<marketplace>/<plugin>/<version>/.mcp.json`
 * and return its MCP server definitions.
 */
export async function discoverCodexComputerUseServers(codexHome: string = resolveCodexSourceHome()): Promise<CodexComputerUseDiscovery> {
  const diagnostics: string[] = [];
  const cacheRoot = join(codexHome, "plugins", "cache");
  const disabled = await readDisabledPlugins(join(codexHome, "config.toml"));
  const marketplaces = await listDirs(cacheRoot);
  if (marketplaces.length === 0) {
    return { servers: [], diagnostics: [`no Codex plugin cache at ${cacheRoot}`] };
  }

  const servers = new Map<string, CodexComputerUseServer>();
  for (const plugin of CODEX_COMPUTER_USE_PLUGINS) {
    let newest: { file: string; mtimeMs: number; marketplace: string } | null = null;
    for (const marketplace of marketplaces) {
      if (disabled.has(`${plugin}@${marketplace}`)) {
        diagnostics.push(`${plugin}@${marketplace} is disabled in config.toml`);
        continue;
      }
      for (const version of await listDirs(join(cacheRoot, marketplace, plugin))) {
        const file = join(cacheRoot, marketplace, plugin, version, ".mcp.json");
        try {
          const info = await stat(file);
          if (info.isFile() && (!newest || info.mtimeMs > newest.mtimeMs)) newest = { file, mtimeMs: info.mtimeMs, marketplace };
        } catch { /* version without MCP servers */ }
      }
    }
    if (!newest) {
      diagnostics.push(`${plugin} plugin with .mcp.json not found under ${cacheRoot}`);
      continue;
    }
    for (const server of await readPluginServers(newest.file, diagnostics)) {
      if (!servers.has(server.name)) servers.set(server.name, server);
    }
  }
  return { servers: [...servers.values()], diagnostics };
}

async function readPluginServers(file: string, diagnostics: string[]): Promise<CodexComputerUseServer[]> {
  let parsed: unknown;
  try {
    const info = await stat(file);
    if (info.size > MCP_JSON_MAX_BYTES) { diagnostics.push(`${file} exceeds ${MCP_JSON_MAX_BYTES} bytes`); return []; }
    parsed = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    diagnostics.push(`${file} unreadable: ${(error as Error).message}`);
    return [];
  }
  const record = asRecord(parsed);
  const mcpServers = asRecord(record?.mcpServers);
  if (!mcpServers) { diagnostics.push(`${file} has no mcpServers`); return []; }

  const out: CodexComputerUseServer[] = [];
  for (const [name, raw] of Object.entries(mcpServers)) {
    const spec = asRecord(raw);
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(name) || RESERVED_SERVER_NAMES.has(name)) { diagnostics.push(`${file}: server name ${JSON.stringify(name)} not usable`); continue; }
    if (!spec) continue;
    if (spec.enabled === false) { diagnostics.push(`${file}: ${name} disabled by plugin`); continue; }
    const command = typeof spec.command === "string" ? spec.command : "";
    // stdio servers only; the Codex app writes absolute runtime paths.
    if (!command || !isAbsolute(command)) { diagnostics.push(`${file}: ${name} has no absolute command`); continue; }
    if (!existsSync(command)) { diagnostics.push(`${file}: ${name} command missing (${command}); is the Codex app installed and up to date?`); continue; }
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(asRecord(spec.env) ?? {})) {
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && (typeof value === "string" || typeof value === "number" || typeof value === "boolean")) env[key] = String(value);
    }
    const rawTimeout = spec.startup_timeout_sec;
    const timeout = typeof rawTimeout === "number" && Number.isFinite(rawTimeout) && rawTimeout > 0
      ? Math.min(Math.trunc(rawTimeout), 600) : undefined;
    const enabledTools = stringArray(spec.enabled_tools);
    out.push({
      name,
      command,
      args: stringArray(spec.args),
      env,
      env_vars: stringArray(spec.env_vars).filter((key) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)),
      ...(timeout ? { startup_timeout_sec: timeout } : {}),
      ...(enabledTools.length > 0 ? { enabled_tools: enabledTools } : {}),
      source: file,
    });
  }
  return out;
}

/**
 * DreamGraph policy: a Computer Use grant is full control. The Codex app ships
 * cua_repl with the browser surface only; a granted Architect run also gets the
 * desktop ("computer") surface backed by the Sky service.
 */
export const CODEX_GRANTED_SURFACES = "browser,computer";
const SKY_SERVICE = "@oai/sky/service";

export function widenCodexComputerUseSurfaces(servers: readonly CodexComputerUseServer[]): CodexComputerUseServer[] {
  return servers.map((server) => {
    if (!("CUA_REPL_ENABLED_SURFACES" in server.env)) return server;
    const env: Record<string, string> = { ...server.env, CUA_REPL_ENABLED_SURFACES: CODEX_GRANTED_SURFACES };
    let services: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(env.NODE_REPL_TRUSTED_SERVICES ?? "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) services = parsed as Record<string, unknown>;
    } catch { /* replace an unreadable value */ }
    if (typeof services.sky !== "string") services.sky = SKY_SERVICE;
    env.NODE_REPL_TRUSTED_SERVICES = JSON.stringify(services);
    return { ...server, env };
  });
}

/**
 * Codex's browser layer stores site/transfer approvals per Codex session in
 * `<codexHome>/browser/sessions/<thread-id>.toml` (`[origins] allowed = [...]`,
 * glob patterns allowed). A headless `codex exec` cannot show the approval
 * prompt, so an unapproved site is declined. For a granted run DreamGraph
 * pre-approves everything for that one Codex session only, as soon as Codex
 * announces its thread id; the operator's Codex app settings are untouched.
 */
export const CODEX_SESSION_GRANT_PATTERNS = Object.freeze(["*", "https://*", "http://*"] as const);

export function codexBrowserSessionGrantToml(): string {
  const allowed = `allowed = [${CODEX_SESSION_GRANT_PATTERNS.map((p) => JSON.stringify(p)).join(", ")}]`;
  return [
    "# Written by DreamGraph: the local operator granted Computer Use for this Architect run.",
    "[origins]", allowed, "",
    "[downloads]", allowed, "",
    "[uploads]", allowed, "",
    "[full_cdp]", allowed, "",
  ].join("\n");
}

const CODEX_THREAD_ID = /^[0-9A-Za-z][0-9A-Za-z-]{7,63}$/;

export async function writeCodexBrowserSessionGrant(codexHome: string, threadId: string): Promise<string> {
  if (!CODEX_THREAD_ID.test(threadId)) throw new Error("CODEX_THREAD_ID_INVALID");
  const dir = join(codexHome, "browser", "sessions");
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${threadId}.toml`);
  await writeFile(file, codexBrowserSessionGrantToml(), { mode: 0o600 });
  return file;
}

/** Extract the Codex thread id from `codex exec --json` output lines. */
export function codexThreadIdFromJsonLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const event = JSON.parse(trimmed) as { type?: unknown; thread_id?: unknown; session_id?: unknown };
    const id = event.type === "thread.started" ? event.thread_id
      : event.type === "session.created" || event.type === "session_configured" ? (event.session_id ?? event.thread_id) : undefined;
    return typeof id === "string" && CODEX_THREAD_ID.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** Watches Codex stdout and writes the session grant once, on the first thread id. */
export function createCodexSessionGrantWatcher(codexHome: string) {
  let buffer = "";
  let threadId: string | null = null;
  let written: Promise<string | null> = Promise.resolve(null);
  return {
    onStdout(chunk: string): void {
      if (threadId) return;
      buffer = (buffer + chunk).slice(-65536);
      let end: number;
      while (!threadId && (end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        const id = codexThreadIdFromJsonLine(line);
        if (id) {
          threadId = id;
          written = writeCodexBrowserSessionGrant(codexHome, id).catch(() => null);
        }
      }
    },
    get threadId(): string | null { return threadId; },
    settled(): Promise<string | null> { return written; },
  };
}

/** `[plugins."name@marketplace"]` tables with `enabled = false` in the real config. */
async function readDisabledPlugins(configPath: string): Promise<Set<string>> {
  const disabled = new Set<string>();
  let text: string;
  try { text = await readFile(configPath, "utf8"); } catch { return disabled; }
  let current: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    const header = /^\s*\[\s*plugins\.(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_@.-]+))\s*\]\s*$/.exec(line);
    if (header) { current = header[1] ?? header[2] ?? header[3] ?? null; continue; }
    if (/^\s*\[/.test(line)) { current = null; continue; }
    if (current && /^\s*enabled\s*=\s*false\s*(#.*)?$/.test(line)) disabled.add(current);
  }
  return disabled;
}

/** TOML for `[mcp_servers.<name>]` entries; values are JSON-escaped basic strings. */
export function codexComputerUseServersToml(servers: readonly CodexComputerUseServer[]): string[] {
  const s = (value: string) => JSON.stringify(value);
  const arr = (values: readonly string[]) => `[${values.map(s).join(", ")}]`;
  const lines: string[] = [];
  for (const server of servers) {
    lines.push(
      "",
      `# Codex native Computer Use (from ${server.source}).`,
      `[mcp_servers.${server.name}]`,
      `command = ${s(server.command)}`,
      `args = ${arr(server.args)}`,
    );
    if (server.env_vars.length > 0) lines.push(`env_vars = ${arr(server.env_vars)}`);
    if (server.startup_timeout_sec) lines.push(`startup_timeout_sec = ${server.startup_timeout_sec}`);
    if (server.enabled_tools) lines.push(`enabled_tools = ${arr(server.enabled_tools)}`);
    lines.push(`default_tools_approval_mode = ${s("approve")}`);
    const keys = Object.keys(server.env).sort();
    if (keys.length > 0) {
      lines.push("", `[mcp_servers.${server.name}.env]`);
      for (const key of keys) lines.push(`${key} = ${s(server.env[key] ?? "")}`);
    }
  }
  return lines;
}

async function listDirs(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    // Codex keeps a `latest` symlink next to versioned dirs; the versioned dirs are enough.
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch {
    return [];
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** Trace entry shape shared with the Architect tool trace (structural copy, no import cycle). */
export interface CodexNativeToolTraceEntry {
  iteration: number;
  tool: string;
  args_summary: string;
  status: "pending" | "running" | "completed" | "failed";
  duration_ms: number;
  result_preview: string;
  trace_id?: string;
}

function textOfToolResult(result: unknown): string {
  if (result == null) return "";
  if (typeof result === "string") return result;
  const record = result as { content?: unknown };
  if (Array.isArray(record.content)) {
    const texts = record.content.flatMap((part) => {
      const p = part as { type?: unknown; text?: unknown };
      return p && p.type === "text" && typeof p.text === "string" ? [p.text] : p && p.type === "image" ? ["[image]"] : [];
    });
    if (texts.length > 0) return texts.join("\n");
  }
  try { return JSON.stringify(result); } catch { return String(result); }
}

/**
 * Codex's own (non-DreamGraph) MCP tool calls from `codex exec --json`, e.g. the
 * cua_repl Computer Use actions. DreamGraph's audit only sees its own tools, so
 * without this the Architect report shows no evidence of what Codex did on screen.
 */
export function codexNativeToolTrace(stdout: string, firstIteration = 1, maxPreview = 500, durations?: ReadonlyMap<string, number>): CodexNativeToolTraceEntry[] {
  const byId = new Map<string, CodexNativeToolTraceEntry>();
  let next = firstIteration;
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let event: { type?: unknown; item?: unknown };
    try { event = JSON.parse(trimmed) as { type?: unknown; item?: unknown }; } catch { continue; }
    if (event.type !== "item.started" && event.type !== "item.updated" && event.type !== "item.completed") continue;
    const item = event.item as { id?: unknown; type?: unknown; server?: unknown; tool?: unknown; arguments?: unknown; result?: unknown; error?: unknown; status?: unknown } | undefined;
    if (!item || item.type !== "mcp_tool_call" || item.server === "dreamgraph") continue;
    const id = typeof item.id === "string" ? item.id : `codex-${next}`;
    const error = item.error && typeof item.error === "object" ? (item.error as { message?: unknown }).message : item.error;
    const failed = item.status === "failed" || (typeof error === "string" && error.length > 0);
    const done = event.type === "item.completed" || item.status === "completed" || item.status === "failed";
    const previous = byId.get(id);
    let args = "";
    try { args = typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments ?? {}); } catch { args = ""; }
    const preview = failed && typeof error === "string" ? error : textOfToolResult(item.result);
    byId.set(id, {
      iteration: previous?.iteration ?? next++,
      tool: `${typeof item.server === "string" ? item.server : "codex"}:${typeof item.tool === "string" ? item.tool : "unknown"}`,
      args_summary: args.replace(/\s+/g, " ").trim().slice(0, 4000),
      status: failed ? "failed" : done ? "completed" : "running",
      duration_ms: durations?.get(id) ?? 0,
      result_preview: preview.replace(/\s+/g, " ").trim().slice(0, maxPreview),
      trace_id: `codex:${id}`,
    });
  }
  return [...byId.values()].sort((a, b) => a.iteration - b.iteration);
}

/** Keep the raw Codex transcript of a granted Computer Use run for diagnosis. */
export async function saveCodexTranscript(dir: string, runKey: string, stdout: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(runKey) || stdout.length === 0) return null;
  try {
    await mkdir(dir, { recursive: true });
    const file = join(dir, `${runKey}.jsonl`);
    await writeFile(file, stdout, { mode: 0o600 });
    return file;
  } catch {
    return null;
  }
}

/**
 * Streams the raw Codex transcript of a granted run to disk as it arrives.
 * The in-memory process buffer is capped (DreamGraph tool results are large),
 * so the native tool trace is parsed from this file, not from that buffer.
 */
export async function createCodexTranscriptWriter(dir: string, runKey: string): Promise<{ path: string; write(chunk: string): void; close(): Promise<string> } | null> {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(runKey)) return null;
  try {
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${runKey}.jsonl`);
    const stream = createWriteStream(path, { flags: "w", mode: 0o600 });
    let failed = false;
    stream.on("error", () => { failed = true; });
    return {
      path,
      write(chunk: string) { if (!failed) stream.write(chunk); },
      close: () => new Promise<string>((resolve) => {
        stream.end(() => { readFile(path, "utf8").then(resolve, () => resolve("")); });
      }),
    };
  } catch {
    return null;
  }
}

/**
 * Route granted Computer Use servers through DreamGraph's stdio proxy
 * (codex-cua-proxy), which performs the turn-end cleanup (`turn_ended`) that
 * the Codex app's plugin hook would otherwise do.
 */
export function wrapCodexServersWithProxy(servers: readonly CodexComputerUseServer[], nodePath: string, proxyScript: string, controlDir: string): CodexComputerUseServer[] {
  return servers.map((server) => ({
    ...server,
    command: nodePath,
    args: [proxyScript, "--proxy", controlDir, "--", server.command, ...server.args],
  }));
}

/** Top-level `notify = [...]` from the operator's real Codex config (single-line array), if any. */
export async function readCodexNotify(codexHome: string): Promise<string[]> {
  let text: string;
  try { text = await readFile(join(codexHome, "config.toml"), "utf8"); } catch { return []; }
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) break; // top-level keys only
    const match = /^\s*notify\s*=\s*(\[.*\])\s*(#.*)?$/.exec(line);
    if (!match) continue;
    try {
      const parsed: unknown = JSON.parse(match[1]!);
      return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed as string[] : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Codex `notify` argv for a granted run: DreamGraph marker first, then the operator's own notify. */
export function codexGrantedNotify(nodePath: string, proxyScript: string, controlDir: string, chain: readonly string[]): string[] {
  return [nodePath, proxyScript, "--notify", controlDir, ...(chain.length > 0 ? ["--", ...chain] : [])];
}

/** Times Codex's own tool calls from the live `--json` stream (the stream carries no durations). */
export function createCodexItemClock(now: () => number = Date.now) {
  const started = new Map<string, number>();
  const durations = new Map<string, number>();
  let buffer = "";
  return {
    onStdout(chunk: string): void {
      buffer = (buffer + chunk).slice(-1_048_576);
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        if (!line.includes('"mcp_tool_call"')) continue;
        const id = /"id"\s*:\s*"([^"]{1,128})"/.exec(line)?.[1];
        if (!id) continue;
        if (line.includes('"item.started"') && !started.has(id)) started.set(id, now());
        else if (line.includes('"item.completed"') && started.has(id)) durations.set(id, Math.max(1, now() - started.get(id)!));
      }
    },
    durations,
  };
}
