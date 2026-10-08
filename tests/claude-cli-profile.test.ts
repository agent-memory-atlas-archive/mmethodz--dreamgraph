import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeProfileEnvironment, claudeProfileArgs, claudeSubscriptionStatus, resolveClaudeExecutable, validateClaudeInit, parseClaudeVersion } from "../src/architect/claude-cli-profile.js";

describe("Claude G0 candidate launch boundary", () => {
  const config = join(tmpdir(), "dreamgraph-claude-test-config");
  it("excludes planted credentials, selectors and injection without changing the parent", () => {
    const parent = { Path: "C:/bin", USERPROFILE: "C:/user", ANTHROPIC_API_KEY: "planted",
      ANTHROPIC_AUTH_TOKEN: "planted", CLAUDE_CODE_OAUTH_TOKEN: "planted", NODE_OPTIONS: "--import evil",
      ANTHROPIC_PROFILE: "api", CLAUDE_CODE_USE_BEDROCK: "1", HTTPS_PROXY: "ambient",
      CLAUDE_CONFIG_DIR: "wrong", ENABLE_CLAUDEAI_MCP_SERVERS: "true", UNLISTED: "injection" };
    const env = claudeProfileEnvironment({ parent, configDirectory: config, timeoutMs: 240000 });
    expect(env.Path).toBe("C:/bin");
    for (const key of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "NODE_OPTIONS",
      "ANTHROPIC_PROFILE", "CLAUDE_CODE_USE_BEDROCK", "HTTPS_PROXY", "UNLISTED"]) expect(env).not.toHaveProperty(key);
    expect(env.CLAUDE_CONFIG_DIR).toBe(config);
    expect(env.ENABLE_CLAUDEAI_MCP_SERVERS).toBe("false");
    expect(parent.NODE_OPTIONS).toBe("--import evil");
    expect(() => claudeProfileEnvironment({ parent, configDirectory: config, timeoutMs: Infinity })).toThrow("BOUND");
    expect(() => claudeProfileEnvironment({ parent, configDirectory: config, timeoutMs: 1000,
      connection: { NODE_OPTIONS: "bad" } })).toThrow("UNSUPPORTED");
  });
  it("passes actual empty arguments without permission bypass, resume or fallback", () => {
    const args = claudeProfileArgs({ mcpConfig: join(config, "mcp.json"), settings: join(config, "settings.json"),
      model: "claude-sonnet-5", maxTurns: 12 });
    expect(args[args.indexOf("--tools") + 1]).toBe("");
    expect(args[args.indexOf("--setting-sources") + 1]).toBe("");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("dontAsk");
    expect(args).not.toContain("--dangerously-skip-permissions");
    expect(args).not.toContain("--resume");
    expect(args).not.toContain("--fallback-model");
  });
  it("never converts API, imported OAuth, missing or wrong-directory auth into subscription admission", () => {
    const status = { loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", subscriptionType: "max", configDirectory: config, email: "private" };
    expect(claudeSubscriptionStatus(JSON.stringify(status), config)).toEqual({
      authenticated: true, billing: "subscription", configDirectory: config });
    for (const authMethod of ["api_key", "oauth_token", "third_party", "none", undefined])
      expect(() => claudeSubscriptionStatus(JSON.stringify({ ...status, authMethod }), config)).toThrow("LOGIN_REQUIRED");
    expect(() => claudeSubscriptionStatus(JSON.stringify({ ...status, configDirectory: join(config, "other") }), config)).toThrow("MISMATCH");
    expect(() => claudeSubscriptionStatus(JSON.stringify({ ...status, configDirectory: undefined }), config)).toThrow("UNVERIFIED");
  });
  it("discovers the Windows native install with a stale PATH, but never ignores an invalid explicit override", async () => {
    const home = await mkdtemp(join(tmpdir(), "dg-claude-discovery-"));
    try {
      await mkdir(join(home, ".local", "bin"), { recursive: true });
      const binary = join(home, ".local", "bin", "claude.exe");
      await writeFile(binary, "fake discovery fixture");
      expect(await resolveClaudeExecutable({ home, platform: "win32", env: { Path: "" } })).toBe(binary);
      await expect(resolveClaudeExecutable({ home, platform: "win32", env: {}, override: join(home, "missing.exe") })).rejects.toThrow("OVERRIDE_UNAVAILABLE");
    } finally { await rm(home, { recursive: true, force: true }); }
  });
  const expected = { version: "2.1.293", model: "claude-sonnet-5", tools: ["query_resource"] };
  const init = { type: "system", subtype: "init", permissionMode: "dontAsk", claude_code_version: "2.1.293",
    model: expected.model, session_id: "fixture", mcp_servers: [{ name: "dreamgraph", status: "connected" }],
    tools: ["mcp__dreamgraph__query_resource"], plugins: [], skills: [], agents: [] };
  it.each(["claude-sonnet-5", "claude-opus-5-5", "claude-fable-5-1", "claude-future-model"])("accepts user-selected %s through the same authority contract", model => {
    const args = claudeProfileArgs({ mcpConfig: join(config, "mcp.json"), settings: join(config, "settings.json"), model, maxTurns: 12 });
    expect(args[args.indexOf("--model") + 1]).toBe(model);
    expect(validateClaudeInit({ ...init, model }, { ...expected, model })).toBe("fixture");
    expect(() => validateClaudeInit({ ...init, model: "claude-wrong-model" }, { ...expected, model })).toThrow("IDENTITY_MISMATCH");
  });
  it("requires an explicit model ID rather than silently resolving an alias or fallback", () => {
    for (const model of ["", "auto", "opus", "--model", "claude-opus --dangerously-skip-permissions"]) {
      expect(() => claudeProfileArgs({ mcpConfig: join(config, "mcp.json"), settings: join(config, "settings.json"), model, maxTurns: 12 })).toThrow("MODEL_ID_REQUIRED");
    }
  });
  it("accepts baseline and newer releases only with matching observed startup identity", () => {
    for (const version of ["2.1.293", "2.1.294", "2.2.0", "3.0.0", "10.0.0"]) {
      expect(parseClaudeVersion(version + " (Claude Code)\n")).toBe(version);
      expect(validateClaudeInit({ ...init, claude_code_version: version }, { ...expected, version })).toBe("fixture");
      expect(() => validateClaudeInit({ ...init, tools: [...init.tools, "Bash"], claude_code_version: version },
        { ...expected, version })).toThrow("TOOL_MISMATCH");
    }
    for (const version of ["2.1.292", "2.0.999", "1.99.999"]) {
      expect(() => parseClaudeVersion(version + " (Claude Code)")).toThrow("BELOW_BASELINE");
    }
    for (const version of ["latest", "2.1.294-beta (Claude Code)", "2.1.294", "999999999999999999.1.1 (Claude Code)"]) {
      expect(() => parseClaudeVersion(version)).toThrow("UNRECOGNIZED");
    }
  });
  it("requires the exact connected catalog and no additional execution capability", () => {
    expect(validateClaudeInit(init, expected)).toBe("fixture");
    for (const patch of [
      { tools: [...init.tools, "Bash"] }, { tools: ["mcp__foreign__query_resource"] },
      { tools: [] }, { plugins: ["extra"] }, { agents: ["general-purpose"] },
      { skills: ["local-skill"] }, { skills: undefined }, { permissionMode: "bypassPermissions" },
      { claude_code_version: "2.1.294" }, { mcp_servers: [{ name: "dreamgraph", status: "failed" }] },
    ]) expect(() => validateClaudeInit({ ...init, ...patch }, expected)).toThrow("CLAUDE_INIT");
  });
});

it("confines the twelve-turn limit to explicitly bounded qualification runs", () => {
  const input = { mcpConfig: join(tmpdir(), "mcp.json"), settings: join(tmpdir(), "settings.json"), model: "claude-sonnet-5" };
  expect(claudeProfileArgs(input)).not.toContain("--max-turns");
  const qualification = claudeProfileArgs({ ...input, maxTurns: 12 });
  expect(qualification[qualification.indexOf("--max-turns") + 1]).toBe("12");
  for (const maxTurns of [0, 13, Infinity, NaN]) expect(() => claudeProfileArgs({ ...input, maxTurns })).toThrow("RUN_BOUND");
});
