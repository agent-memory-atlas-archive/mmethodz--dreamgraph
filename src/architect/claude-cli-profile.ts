import { access, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { constants } from "node:fs";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";

/** Controlled MCP-only launch boundary, checked on every pass. */
export const CLAUDE_CLI_PROFILE = "dreamgraph-mcp-only-v1";
/** Live-tested provenance and minimum interface baseline; newer versions still need startup validation. */
export const CLAUDE_LIVE_TESTED_VERSION = "2.1.293";
export const CLAUDE_VERSION_POLICY = "baseline_or_newer_with_launch_validation";
/** Accept stable numeric releases at/above the baseline, never an unparsed version or a prerelease. */
export function parseClaudeVersion(output: string): string {
  const version = output.trim().match(/^(\d+\.\d+\.\d+) \(Claude Code\)$/)?.[1];
  if (!version) throw new Error("CLAUDE_VERSION_UNRECOGNIZED");
  const parts = version.split(".").map(Number);
  if (parts.some(part => !Number.isSafeInteger(part))) throw new Error("CLAUDE_VERSION_UNRECOGNIZED");
  const baseline = CLAUDE_LIVE_TESTED_VERSION.split(".").map(Number);
  const difference = parts.findIndex((part, index) => part !== baseline[index]);
  if (difference >= 0 && parts[difference] < baseline[difference]) throw new Error("CLAUDE_VERSION_BELOW_BASELINE");
  return version;
}
export const CLAUDE_WINDOWS_INSTALL = "irm https://claude.ai/install.ps1 | iex";
export const CLAUDE_PRIVATE_SETTINGS = Object.freeze({
  disableAllHooks: true,
  enabledPlugins: {
    "cc-plugin-agents-md@builtin": false,
    "cc-plugin-telemetry@builtin": false,
    "cc-plugin-plugin-authoring@builtin": false,
  },
});
const PLATFORM_KEYS = new Set([
  "PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "USERPROFILE",
  "HOMEDRIVE", "HOMEPATH", "HOME", "TMP", "TEMP", "TMPDIR", "LOCALAPPDATA",
  "APPDATA", "LANG", "LC_ALL", "LC_CTYPE", "TZ",
]);
const CONNECTION_KEYS = new Set(["HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE"]);
export const defaultClaudeConfigDirectory = () => join(homedir(), ".dreamgraph", "claude-cli", "config");

/** Never inherit provider credentials, runtime injection or unreviewed Claude settings. */
export function claudeProfileEnvironment(input: {
  parent: NodeJS.ProcessEnv; configDirectory: string; timeoutMs: number;
  connection?: Record<string, string>;
}): Record<string, string> {
  if (!isAbsolute(input.configDirectory)) throw new Error("CLAUDE_CONFIG_DIRECTORY_ABSOLUTE_REQUIRED");
  if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1000 || input.timeoutMs > 14_400_000)
    throw new Error("CLAUDE_PROFILE_TIMEOUT_BOUND");
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.parent)) {
    if (value !== undefined && PLATFORM_KEYS.has(key.toUpperCase())) env[key] = value;
  }
  for (const [key, value] of Object.entries(input.connection ?? {})) {
    if (!CONNECTION_KEYS.has(key)) throw new Error("CLAUDE_CONNECTION_SETTING_UNSUPPORTED");
    env[key] = value;
  }
  return Object.assign(env, {
    CLAUDE_CONFIG_DIR: resolve(input.configDirectory),
    ENABLE_CLAUDEAI_MCP_SERVERS: "false",
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
    CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS: "1",
    CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1",
    CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1",
    CLAUDE_CODE_DISABLE_CRON: "1",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: "1",
    CLAUDE_CODE_DISABLE_TERMINAL_TITLE: "1",
    CLAUDE_CODE_MAX_RETRIES: "0",
    DISABLE_AUTOUPDATER: "1",
    MCP_TOOL_TIMEOUT: String(input.timeoutMs),
    MCP_TIMEOUT: String(Math.min(input.timeoutMs, 30_000)),
  });
}

export async function resolveClaudeExecutable(input: {
  override?: string; env?: NodeJS.ProcessEnv; home?: string; platform?: NodeJS.Platform;
} = {}): Promise<string> {
  const platform = input.platform ?? process.platform;
  const env = input.env ?? process.env;
  const binary = platform === "win32" ? "claude.exe" : "claude";
  const executable = async (path: string) => {
    try { await access(path, platform === "win32" ? constants.F_OK : constants.X_OK); return (await stat(path)).isFile() ? resolve(path) : null; }
    catch { return null; }
  };
  if (input.override) {
    if (!isAbsolute(input.override)) throw new Error("CLAUDE_BINARY_OVERRIDE_ABSOLUTE_REQUIRED");
    const found = await executable(input.override);
    if (!found) throw new Error("CLAUDE_BINARY_OVERRIDE_UNAVAILABLE");
    return found;
  }
  const path = Object.entries(env).find(([key]) => key.toUpperCase() === "PATH")?.[1] ?? "";
  for (const directory of path.split(platform === "win32" ? ";" : delimiter).filter(Boolean)) {
    if (!isAbsolute(directory)) continue; // Do not resolve an executable from the task's cwd.
    const found = await executable(join(directory, binary));
    if (found) return found;
  }
  const native = await executable(join(input.home ?? homedir(), ".local", "bin", binary));
  if (native) return native;
  throw new Error("CLAUDE_BINARY_UNAVAILABLE");
}

/** Model choice belongs to the user; explicit IDs keep init matching exact without alias/fallback ambiguity. */
export function assertClaudeModelId(model: unknown): asserts model is string {
  if (typeof model !== "string" || !/^claude-[a-z0-9][a-z0-9._-]{0,239}$/.test(model))
    throw new Error("CLAUDE_MODEL_ID_REQUIRED: use the full Claude model ID supported by your installed CLI/account");
}

export function claudeProfileArgs(input: {
  mcpConfig: string; settings: string; model: string; maxTurns: number;
  effort?: string; jsonSchema?: string;
}): string[] {
  if (!isAbsolute(input.mcpConfig) || !isAbsolute(input.settings)) throw new Error("CLAUDE_PROFILE_PATH_REQUIRED");
  assertClaudeModelId(input.model);
  if (!Number.isSafeInteger(input.maxTurns) || input.maxTurns < 1 || input.maxTurns > 12)
    throw new Error("CLAUDE_PROFILE_RUN_BOUND");
  if (input.effort && !["low", "medium", "high", "xhigh", "max"].includes(input.effort))
    throw new Error("CLAUDE_EFFORT_UNSUPPORTED");
  return ["--print", "--output-format", "stream-json", "--verbose",
    "--tools", "", "--strict-mcp-config", "--mcp-config", input.mcpConfig,
    "--setting-sources", "", "--settings", input.settings,
    "--permission-mode", "dontAsk", "--allowedTools", "mcp__dreamgraph__*",
    "--disable-slash-commands", "--no-session-persistence", "--no-chrome",
    "--model", input.model, "--max-turns", String(input.maxTurns),
    ...(input.effort ? ["--effort", input.effort] : []),
    ...(input.jsonSchema ? ["--json-schema", input.jsonSchema] : [])];
}

/** Only sanitized official status fields leave preflight; never retain account/token fields. */
export function claudeSubscriptionStatus(raw: string, configDirectory: string): {
  authenticated: true; billing: "subscription"; configDirectory: string;
} {
  if (Buffer.byteLength(raw, "utf8") > 32_768) throw new Error("CLAUDE_AUTH_OUTPUT_BOUND");
  let value: any;
  try { value = JSON.parse(raw); } catch { throw new Error("CLAUDE_AUTH_STATUS_INVALID"); }
  if (value?.loggedIn !== true || value?.authMethod !== "claude.ai" || value?.apiProvider !== "firstParty"
    || !["pro", "max"].includes(value?.subscriptionType))
    throw new Error("CLAUDE_SUBSCRIPTION_LOGIN_REQUIRED");
  if (typeof value.configDir !== "string" && typeof value.configDirectory !== "string")
    throw new Error("CLAUDE_AUTH_DIRECTORY_UNVERIFIED");
  const actual = resolve(value.configDirectory ?? value.configDir);
  const expected = resolve(configDirectory);
  if ((process.platform === "win32" ? actual.toLowerCase() !== expected.toLowerCase() : actual !== expected))
    throw new Error("CLAUDE_AUTH_DIRECTORY_MISMATCH");
  return { authenticated: true, billing: "subscription", configDirectory: expected };
}

/** Initial Windows profile refuses unmanaged startup policy instead of overriding an administrator. */
export async function assertClaudeLocalPolicy(): Promise<void> {
  if (process.platform !== "win32") throw new Error("CLAUDE_PLATFORM_UNQUALIFIED");
  for (const name of ["managed-settings.json", "managed-settings.d", "managed-mcp.json"]) {
    try { await access(join("C:/Program Files/ClaudeCode", name)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw new Error("CLAUDE_MANAGED_POLICY_UNREADABLE"); }
    throw new Error("CLAUDE_MANAGED_POLICY_REVIEW_REQUIRED");
  }
  const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
  if (!systemRoot || !isAbsolute(systemRoot)) throw new Error("CLAUDE_SYSTEM_ROOT_UNAVAILABLE");
  const script = "$ErrorActionPreference='Stop'; $found=$false; foreach($p in @('HKLM:\\SOFTWARE\\Policies\\ClaudeCode','HKCU:\\SOFTWARE\\Policies\\ClaudeCode')) { if(Test-Path -LiteralPath $p) { $found=$true } }; if($found) { 'present' } else { 'absent' }";
  let output: string;
  try { output = (await promisify(execFile)(join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
    { timeout: 10000, maxBuffer: 1024, windowsHide: true })).stdout.trim(); }
  catch { throw new Error("CLAUDE_MANAGED_POLICY_UNREADABLE"); }
  if (output !== "absent") throw new Error("CLAUDE_MANAGED_POLICY_REVIEW_REQUIRED");
}

export interface ClaudeInitExpectation {
  version: string;
  model: string;
  tools: readonly string[];
  /** Qualified data-only sentinels, not a wildcard permission exception. */
  sentinels?: readonly string[];
}

/** Actual init shape is a G0 fixture requirement, not an inference synchronization barrier. */
export function validateClaudeInit(event: any, expected: ClaudeInitExpectation): string {
  if (event?.type !== "system" || event.subtype !== "init"
    || event.permissionMode !== "dontAsk" || event.claude_code_version !== expected.version
    || event.model !== expected.model || typeof event.session_id !== "string" || !event.session_id)
    throw new Error("CLAUDE_INIT_IDENTITY_MISMATCH");
  if (!Array.isArray(event.mcp_servers) || event.mcp_servers.length !== 1
    || event.mcp_servers[0]?.name !== "dreamgraph" || event.mcp_servers[0]?.status !== "connected")
    throw new Error("CLAUDE_INIT_MCP_MISMATCH");
  for (const field of ["plugins", "skills", "agents"]) {
    if (!Array.isArray(event[field]) || event[field].length !== 0) throw new Error("CLAUDE_INIT_EXTRA_CAPABILITY");
  }
  const wanted = new Set([...expected.tools.map(name => "mcp__dreamgraph__" + name), ...(expected.sentinels ?? [])]);
  if (!Array.isArray(event.tools) || event.tools.length !== wanted.size
    || event.tools.some((name: unknown) => typeof name !== "string" || !wanted.has(name))
    || new Set(event.tools).size !== event.tools.length) throw new Error("CLAUDE_INIT_TOOL_MISMATCH");
  return event.session_id;
}
