import { describe, expect, it } from "vitest";
import { resolveRolePolicy } from "../src/config/role-policy.js";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assertRouteEffort, routeEfforts, architectEffortChoices } from "../src/config/architect-model-controls.js";
import { claudeProfileArgs, claudeProfileEnvironment } from "../src/architect/claude-cli-profile.js";

describe("Architect effort admission", () => {
  it("explicit Default suppresses a general or saved effort without changing other roles", () => {
    const env = { DREAMGRAPH_LLM_REASONING_EFFORT:"xhigh", DREAMGRAPH_LLM_ARCHITECT_ADAPTER:"claude-cli", DREAMGRAPH_LLM_ARCHITECT_MODEL:"claude-opus-4-6", DREAMGRAPH_LLM_ARCHITECT_REASONING_EFFORT:"" };
    expect(resolveRolePolicy({role:"architect",env,saved:{effort:"high"}}).effective.effort).toBeNull();
    expect(resolveRolePolicy({role:"dreamer",env}).requested.effort).toBe("xhigh");
  });
  const path = join(tmpdir(), "dg-effort-profile");
  const args = (model: string, effort?: string) => claudeProfileArgs({ model, effort, mcpConfig: join(path,"mcp.json"), settings: join(path,"settings.json"), maxTurns: 12 });
  it.each(["low","medium","high","xhigh","max"])("passes %s as argv without changing the Claude authority profile", effort => {
    const result = args("claude-opus-5-5", effort);
    expect(result[result.indexOf("--effort")+1]).toBe(effort);
    expect(result[result.indexOf("--tools")+1]).toBe("");
    expect(result[result.indexOf("--permission-mode")+1]).toBe("dontAsk");
  });
  it("refuses CLI downshifts and orchestration before launch", () => {
    expect(() => args("claude-opus-4-6","xhigh")).toThrow("REASONING_EFFORT_UNSUPPORTED");
    expect(() => args("claude-sonnet-4-6","xhigh")).toThrow("REASONING_EFFORT_UNSUPPORTED");
    expect(() => args("claude-future","max")).toThrow("REASONING_EFFORT_UNSUPPORTED");
    expect(() => args("claude-opus-5-5","ultracode")).toThrow("REASONING_EFFORT_UNSUPPORTED");
    expect(args("claude-opus-4-6","max")).toContain("max");
    expect(args("claude-future")).not.toContain("--effort");
  });
  it("does not inherit a competing effort environment variable", () => {
    const env = claudeProfileEnvironment({ configDirectory:path, timeoutMs:1000, parent:{ CLAUDE_CODE_EFFORT_LEVEL:"ultracode" } });
    expect(env).not.toHaveProperty("CLAUDE_CODE_EFFORT_LEVEL");
  });
  it("keeps both selectors consistent with dispatch while leaving route defaults implicit", () => {
    const table = architectEffortChoices();
    for (const [model, efforts] of Object.entries(table["claude-cli"])) {
      expect(routeEfforts("claude-cli","none",model)).toEqual(efforts);
      for (const effort of efforts) expect(() => assertRouteEffort("claude-cli","none",model,effort)).not.toThrow();
    }
    expect(routeEfforts("codex-cli","none","gpt-6.1-sol")).toContain("max");
    expect(routeEfforts("copilot-cli","none","auto")).toEqual([]);
    expect(() => assertRouteEffort("claude-cli","none","unknown",null)).not.toThrow();
  });
});
