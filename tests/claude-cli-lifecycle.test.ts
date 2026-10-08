import { expect, it } from "vitest";
import { mkdtemp, readFile, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { runClaudeProcess } from "../src/architect/claude-cli-process.js";
const expected = { version: "2.1.293", model: "claude-sonnet-5", tools: ["query_resource"] };
const init = { type: "system", subtype: "init", permissionMode: "dontAsk", claude_code_version: expected.version,
  model: expected.model, session_id: "fixture", mcp_servers: [{ name: "dreamgraph", status: "connected" }],
  tools: ["mcp__dreamgraph__query_resource"], plugins: [], agents: [], skills: [] };
const result = { type: "result", subtype: "success", is_error: false, result: "actual terminal", session_id: "fixture" };
const fixture = async (code: string, work: (input: Parameters<typeof runClaudeProcess>[0], root: string) => Promise<void>) => {
  const root = await mkdtemp(join(tmpdir(), "dg-claude-process-"));
  try { await work({ command: process.execPath, args: ["-e", code], cwd: root,
    env: Object.fromEntries(Object.entries(process.env).filter((x): x is [string, string] => typeof x[1] === "string")),
    stdin: "", timeoutMs: 5000, expected, gatePath: join(root, "gate"), gateToken: randomBytes(32).toString("hex") }, root); }
  finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
};
it.each([100, 15000])("observes the registered proxy after parent exit (proxy duration %i ms)", async duration => {
  const code = "const fs=require('node:fs');const p=require('node:child_process').spawn(process.execPath,['-e','setTimeout(()=>{},'+process.env.PROXY_LIFE+')'],{stdio:'ignore',detached:true});p.unref();fs.writeFileSync(process.env.GATE+'.proxy',String(p.pid));console.log(" + JSON.stringify(JSON.stringify(init)) + ");console.log(" + JSON.stringify(JSON.stringify(result)) + ")";
  await fixture(code, async input => {
    try {
      const result = await runClaudeProcess({ ...input, timeoutMs: 10000, env: { ...input.env, GATE: input.gatePath, PROXY_LIFE: String(duration) }, requireProxyTermination: true });
      expect(result.terminationConfirmed).toBe(duration === 100);
      if (duration !== 100) { expect(result.claude.error).toBe("CLAUDE_TERMINATION_UNCONFIRMED"); expect(result.claude.recovery?.proxy_pid).toBeGreaterThan(0); }
      await expect(access(input.gatePath)).rejects.toThrow();
    } finally {
      const pid = Number(await readFile(input.gatePath + ".proxy", "utf8"));
      try { process.kill(pid); } catch { /* Owned fixture already exited. */ }
    }
  });
}, 15000);
it("requires a real terminal and revokes admission on normal close", async () => {
  await fixture("console.log(" + JSON.stringify(JSON.stringify(init)) + ");console.log(" + JSON.stringify(JSON.stringify(result)) + ")", async input => {
    const value = await runClaudeProcess(input);
    expect(value.claude).toEqual({ content: "actual terminal", terminal: { subtype: "success", is_error: false } }); expect(value.exitCode).toBe(0);
    await expect(access(input.gatePath)).rejects.toThrow();
  });
});
it("aborts an admitted process before its late effect and confirms the Windows tree stop", async () => {
  const code = "console.log(" + JSON.stringify(JSON.stringify(init)) + ");setTimeout(()=>require('node:fs').writeFileSync('late-effect','bad'),3000);setInterval(()=>{},1000)";
  await fixture(code, async (input, root) => {
    const controller = new AbortController(); const running = runClaudeProcess({ ...input, signal: controller.signal });
    for (let i = 0; i < 100; i++) {
      try { if (await readFile(input.gatePath, "utf8") === input.gateToken) break; } catch {}
      await new Promise(done => setTimeout(done, 10));
    }
    expect(await readFile(input.gatePath, "utf8")).toBe(input.gateToken); controller.abort();
    const value = await running;
    expect(value.claude.error).toBe("CLAUDE_CANCELLED");
    if (process.platform === "win32") expect(value.terminationConfirmed).toBe(true);
    await expect(access(input.gatePath)).rejects.toThrow();
    await expect(access(join(root, "late-effect"))).rejects.toThrow();
  });
}, 15000);
it("refuses spawn failure, malformed stdout and missing terminal instead of echoing diagnostics as an answer", async () => {
  for (const code of ["console.log('not-json')", "console.log(" + JSON.stringify(JSON.stringify(init)) + ")"]) {
    await fixture(code, async input => { const result = await runClaudeProcess(input);
      expect(result.claude.content).toBe(""); expect(result.claude.error).toMatch(/INVALID|MISSING/); });
  }
  await fixture("", async input => {
    const result = await runClaudeProcess({ ...input, command: join(input.cwd, "absent.exe") });
    expect(result.claude.error).toBe("CLAUDE_SPAWN_FAILED"); expect(result.terminationConfirmed).toBe(true);
  });
});

it("preserves failed terminal reason, turns and usage even without a final newline and with exit zero", async () => {
  const terminal = { ...result, subtype: "error_max_turns_reached", is_error: true, num_turns: 12,
    usage: { input_tokens: 100, output_tokens: 10 }, errors: ["private body"] };
  await fixture("console.log(" + JSON.stringify(JSON.stringify(init)) + ");process.stdout.write(" + JSON.stringify(JSON.stringify(terminal)) + ")", async input => {
    const value = await runClaudeProcess(input);
    expect(value.exitCode).toBe(0);
    expect(value.claude.error).toBe("CLAUDE_MAX_TURNS_REACHED");
    expect(value.claude.content).toBe("");
    expect(value.claude.usage).toBeDefined();
    expect(value.claude.terminal).toEqual({ subtype: "error_max_turns_reached", is_error: true, num_turns: 12, error_count: 1 });
    expect(JSON.stringify(value)).not.toContain("private body");
    await expect(access(input.gatePath)).rejects.toThrow();
  });
});

it("drains long stdout and stderr streams without killing a healthy investigative run", async () => {
  const event = { type: "user", message: { content: [{ type: "tool_result", content: "evidence ".repeat(1024) }] } };
  const code = "const {once}=require('node:events');(async()=>{console.log(" + JSON.stringify(JSON.stringify(init)) +
    ");const event=" + JSON.stringify(JSON.stringify(event) + "\n") +
    ";for(let i=0;i<150;i++){if(!process.stdout.write(event))await once(process.stdout,'drain');}" +
    "if(!process.stderr.write('diagnostic '.repeat(7000)))await once(process.stderr,'drain');" +
    "console.log(" + JSON.stringify(JSON.stringify(result)) + ");})()";
  await fixture(code, async input => {
    const value = await runClaudeProcess(input);
    expect(value.exitCode).toBe(0);
    expect(value.terminationConfirmed).toBe(true);
    expect(value.claude.error).toBeUndefined();
    expect(value.claude.content).toBe("actual terminal");
    expect(value.stdout).toBe(""); expect(value.stderr).toBe("");
    await expect(access(input.gatePath)).rejects.toThrow();
  });
});
