// G0 preflight only: no model call, login, credential-file read or adapter enablement.
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { claudeProfileEnvironment, claudeSubscriptionStatus, defaultClaudeConfigDirectory,
  resolveClaudeExecutable, CLAUDE_CLI_PROFILE } from "../src/architect/claude-cli-profile.ts";

const configDirectory = defaultClaudeConfigDirectory();
const executable = await resolveClaudeExecutable();
const env = claudeProfileEnvironment({ parent: process.env, configDirectory, timeoutMs: 30000 });
const scratch = await mkdtemp(join(tmpdir(), "dreamgraph-claude-preflight-"));
const packet = { profile: CLAUDE_CLI_PROFILE, platform: process.platform, executable,
  configDirectory, qualified: false, modelRequests: 0, checks: {}, remaining: [
    "Live init/catalog/permission and subscription canary",
    "Startup configuration and managed-policy behavioral qualification",
    "G0 approval before selectable adapter dispatch",
  ] };
function run(args) {
  const result = spawnSync(executable, args, { env, cwd: scratch, windowsHide: true,
    encoding: "utf8", timeout: 15000, maxBuffer: 32768, shell: false });
  if (result.error || result.signal) throw new Error("CLAUDE_PREFLIGHT_PROCESS_FAILED");
  return result;
}
try {
  const version = run(["--version"]);
  if (version.status !== 0 || !/^\d+\.\d+\.\d+ \(Claude Code\)\s*$/.test(version.stdout))
    throw new Error("CLAUDE_VERSION_UNVERIFIED");
  packet.checks.version = version.stdout.trim();
  const help = run(["--help"]);
  if (help.status !== 0) throw new Error("CLAUDE_HELP_UNAVAILABLE");
  const required = ["--tools", "--strict-mcp-config", "--setting-sources", "--settings",
    "--permission-mode", "--allowedTools", "--disable-slash-commands",
    "--no-session-persistence", "--no-chrome", "--output-format"];
  packet.checks.hiddenFlagEvidence = "--max-turns accepted by real 2.1.293 G0 canary";
  packet.checks.missingFlags = required.filter(flag => !help.stdout.includes(flag));
  // Presence is reported, never silently bypassed. Effective managed policy still needs G0 review.
  const systemDirectory = process.platform === "win32" ? "C:/Program Files/ClaudeCode"
    : process.platform === "darwin" ? "/Library/Application Support/ClaudeCode" : "/etc/claude-code";
  packet.checks.managedFilesPresent = [];
  for (const name of ["managed-settings.json", "managed-settings.d", "managed-mcp.json"]) {
    try { await access(join(systemDirectory, name)); packet.checks.managedFilesPresent.push(name); }
    catch (error) { if (error.code !== "ENOENT") throw new Error("CLAUDE_MANAGED_POLICY_UNREADABLE"); }
  }
  try { await access(configDirectory); } catch { throw new Error("CLAUDE_DEDICATED_LOGIN_REQUIRED"); }
  const auth = run(["--setting-sources", "", "--settings", '{"disableAllHooks":true}', "auth", "status", "--json"]);
  if (auth.status !== 0) throw new Error("CLAUDE_SUBSCRIPTION_LOGIN_REQUIRED");
  packet.checks.auth = claudeSubscriptionStatus(auth.stdout, configDirectory);
} catch (error) {
  packet.blocker = error.message;
  process.exitCode = 1;
} finally {
  await rm(scratch, { recursive: true, force: true });
  console.log(JSON.stringify(packet, null, 2));
}
