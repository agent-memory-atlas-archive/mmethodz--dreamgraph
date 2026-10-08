import { execFile } from "node:child_process";
import { assertRouteEffort } from "../config/architect-model-controls.js";
import { promisify } from "node:util";
import { randomBytes, createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { claudeProfileArgs, claudeProfileEnvironment, claudeSubscriptionStatus, defaultClaudeConfigDirectory,
  resolveClaudeExecutable, assertClaudeLocalPolicy, assertClaudeModelId, parseClaudeVersion, CLAUDE_PRIVATE_SETTINGS, CLAUDE_CLI_PROFILE } from "./claude-cli-profile.js";

/** Windows G0–G3 qualified: docs/qualification/claude-cli/qualification.json. Startup is revalidated every pass. */
export const CLAUDE_ADAPTER_QUALIFIED: boolean = true;
export { CLAUDE_LIVE_TESTED_VERSION, CLAUDE_VERSION_POLICY } from "./claude-cli-profile.js";
/** Evidence provenance, not a model allowlist. */
export const CLAUDE_LIVE_TESTED_MODEL = "claude-sonnet-5";
const BRIDGE_KEYS = new Set([
  "DREAMGRAPH_HOST_MCP_URL", "DREAMGRAPH_BRIDGE_SESSION_BEARER", "DREAMGRAPH_BRIDGE_AUDIT_DIR",
  "DREAMGRAPH_AUDIT_PATH", "DREAMGRAPH_RUN_ID", "DREAMGRAPH_WORKSPACE_ROOT",
  "DREAMGRAPH_ARCHITECT_VERBOSITY_MODE", "DREAMGRAPH_ARCHITECT_STORY_VISIBILITY",
  "DREAMGRAPH_ARCHITECT_PROMPT_PROFILE", "DREAMGRAPH_BRIDGE_COMPUTER_USE_REQUESTABLE", "ELECTRON_RUN_AS_NODE",
]);
export async function probeClaudeProfile(input: { cwd: string; timeoutMs: number; signal?: AbortSignal }) {
  input.signal?.throwIfAborted();
  await assertClaudeLocalPolicy();
  const command = await resolveClaudeExecutable({ override: process.env.DREAMGRAPH_ARCHITECT_CLAUDE_CLI_BINARY });
  const env = claudeProfileEnvironment({ parent: process.env, configDirectory: defaultClaudeConfigDirectory(), timeoutMs: input.timeoutMs });
  const run = async (args: string[]) => {
    try { return (await promisify(execFile)(command, args, {
      cwd: input.cwd, env, windowsHide: true, signal: input.signal, timeout: 15000, maxBuffer: 32768,
    })).stdout; } catch { throw new Error("CLAUDE_PREFLIGHT_FAILED"); }
  };
  const version = parseClaudeVersion(await run(["--version"]));
  const auth = claudeSubscriptionStatus(await run(["--setting-sources", "", "--settings",
    JSON.stringify(CLAUDE_PRIVATE_SETTINGS), "auth", "status", "--json"]), env.CLAUDE_CONFIG_DIR);
  const fingerprint = createHash("sha256").update(JSON.stringify({ profile: CLAUDE_CLI_PROFILE, command, version,
    settings: CLAUDE_PRIVATE_SETTINGS, configDirectory: auth.configDirectory, platform: process.platform })).digest("hex");
  return { command, env, version, fingerprint, auth };
}

export async function prepareClaudeInvocation(input: {
  scratchDir: string; prompt: string; model: string | undefined; reasoningEffort?: string;
  timeoutMs: number; signal?: AbortSignal; qualificationMaxTurns?: number;
  bridgeSpawn: { command: string; args: string[] };
  envBase: Record<string, string>; availableToolNames: string[];
}) {
  assertClaudeModelId(input.model);
  assertRouteEffort("claude-cli", "none", input.model, input.reasoningEffort);
  const profile = await probeClaudeProfile({ cwd: input.scratchDir, timeoutMs: input.timeoutMs, signal: input.signal });
  const settings = join(input.scratchDir, "claude-settings.json"), mcpConfig = join(input.scratchDir, "claude-mcp.json");
  const gatePath = join(input.scratchDir, "claude-admitted"), gateToken = randomBytes(32).toString("hex");
  const bridgeEnv = { ...profile.env, ...Object.fromEntries(Object.entries(input.envBase).filter(([key]) => BRIDGE_KEYS.has(key))),
    DREAMGRAPH_BRIDGE_ADMISSION_PATH: gatePath, DREAMGRAPH_BRIDGE_ADMISSION_TOKEN: gateToken,
    DREAMGRAPH_BRIDGE_DEADLINE_MS: String(Date.now() + input.timeoutMs) };
  await writeFile(settings, JSON.stringify(CLAUDE_PRIVATE_SETTINGS), { mode: 0o600, flag: "wx" });
  await writeFile(mcpConfig, JSON.stringify({ mcpServers: { dreamgraph: {
    type: "stdio", command: input.bridgeSpawn.command, args: input.bridgeSpawn.args, env: bridgeEnv,
  } } }), { mode: 0o600, flag: "wx" });
  return { command: profile.command, args: claudeProfileArgs({ settings, mcpConfig, model: input.model, maxTurns: input.qualificationMaxTurns, effort: input.reasoningEffort }),
    cwd: input.scratchDir, env: profile.env, stdin: input.prompt, outputPath: null,
    claude: { expected: { version: profile.version, model: input.model,
      tools: input.availableToolNames },
      gatePath, gateToken, requireProxyTermination: true }, version: profile.version, fingerprint: profile.fingerprint };
}
