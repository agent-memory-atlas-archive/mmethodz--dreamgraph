import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cuaRuntimeToolName, openCuaRuntimeSession } from "../src/computer/cua-runtime.js";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "dg-cua-runtime-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

// Stand-in for the installed Computer Use runtime: the first browser call fails like the real start-up flag check,
// a later call returns a tab id and a screenshot, and every message is recorded.
const FAKE = `
import { appendFileSync } from "node:fs";
const record = process.argv[2];
let calls = 0, buf = "";
process.stdin.on("data", (c) => {
  buf += c.toString();
  let nl;
  while ((nl = buf.indexOf("\\n")) >= 0) {
    const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
    if (!line) continue;
    const m = JSON.parse(line);
    appendFileSync(record, line + "\\n");
    if (m.id === undefined) continue;
    const reply = (result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: m.id, result }) + "\\n");
    if (m.method === "initialize") reply({ protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "cua_repl", version: "9.9.9" } });
    else if (m.method === "tools/list") reply({ tools: [
      { name: "js", description: "Run JavaScript against the cua API.", inputSchema: { type: "object", properties: { code: { type: "string" } } } },
      { name: "turn_ended", description: "hook", inputSchema: { type: "object" } } ] });
    else if (m.params?.name === "js") {
      calls++;
      if (calls === 1) reply({ content: [{ type: "text", text: "Unable to load browser request-header policy. Retry the browser command." }] });
      else reply({ content: [{ type: "text", text: "Browser tab: 4242, Title: \\"Web64 IDE\\"" }, { type: "image", mimeType: "image/jpeg", data: "AAAA" }] });
    } else if (m.params?.name === "turn_ended") reply({ content: [{ type: "text", text: "{}" }] });
  }
});
process.stdin.on("end", () => process.exit(0));
`;

describe("cua-runtime Computer Use backend for API engines", () => {
  it("exposes the runtime's own tools, retries the start-up flag error, forwards images, and releases the session", async () => {
    const script = join(dir, "fake-cua.mjs"), record = join(dir, "record.jsonl"), codexHome = join(dir, "codex");
    await writeFile(script, FAKE);
    const server = { name: "cua_repl", command: process.execPath, args: [script, record], env: { CODEX_HOME: codexHome }, env_vars: [], source: "test" };
    const session = await openCuaRuntimeSession({ server, codexHome, retryDelayMs: 10, logDir: dir });
    expect(session.tools.map(tool => tool.name)).toEqual([cuaRuntimeToolName("js")]);
    expect(session.tools[0].name).toBe("cua_repl");
    expect(session.version).toBe("9.9.9");
    const grant = join(codexHome, "browser", "sessions", `${session.sessionId}.toml`);
    expect(existsSync(grant)).toBe(true);

    const result = await session.call("cua_repl", { code: "await cua.getState();", title: "Find tab" });
    expect(result.isError).toBe(false);
    expect(result.text).toContain("Browser tab: 4242");
    expect(result.images).toEqual([{ type: "image", mimeType: "image/jpeg", dataBase64: "AAAA" }]);

    const logPath = await session.release("test");
    expect(await session.release("again")).toBe(logPath); // run-once
    expect(existsSync(grant)).toBe(false);
    const sent = (await readFile(record, "utf8")).trim().split("\n").map(line => JSON.parse(line));
    const js = sent.filter(m => m.params?.name === "js");
    expect(js.length).toBeGreaterThanOrEqual(2);
    const meta = JSON.parse(js[0].params._meta["x-codex-turn-metadata"]);
    expect(meta).toMatchObject({ session_id: session.sessionId, turn_id: session.turnId });
    expect(sent.some(m => m.params?.name === "turn_ended" && m.params.arguments.session_id === session.sessionId)).toBe(true);
    expect(await readFile(logPath!, "utf8")).toContain("turn_ended: ok");
  });

  it("never passes DreamGraph credentials or settings to the runtime that executes model-written code", async () => {
    const script = join(dir, "env.mjs"), out = join(dir, "env.json"), codexHome = join(dir, "codex");
    await writeFile(script, `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(out)}, JSON.stringify(process.env)); process.exit(0);`);
    process.env.DREAMGRAPH_LLM_API_KEY = "secret-value"; process.env.OPENAI_API_KEY = "secret-value";
    try {
      await expect(openCuaRuntimeSession({ server: { name: "cua_repl", command: process.execPath, args: [script], env: { CODEX_HOME: codexHome }, env_vars: [], source: "test" }, codexHome, logDir: dir }))
        .rejects.toThrow("COMPUTER_USE_RUNTIME_START_FAILED");
      const seen = JSON.parse(await readFile(out, "utf8"));
      expect(JSON.stringify(seen)).not.toContain("secret-value");
      expect(seen.CUA_REPL_ENABLED_SURFACES).toBe("browser");
    } finally { delete process.env.DREAMGRAPH_LLM_API_KEY; delete process.env.OPENAI_API_KEY; }
  });

  it("reports an unknown tool as a failed call instead of throwing", async () => {
    const script = join(dir, "fake-cua.mjs"), record = join(dir, "record.jsonl"), codexHome = join(dir, "codex");
    await writeFile(script, FAKE);
    const session = await openCuaRuntimeSession({ server: { name: "cua_repl", command: process.execPath, args: [script, record], env: { CODEX_HOME: codexHome }, env_vars: [], source: "test" }, codexHome, logDir: dir });
    expect(await session.call("not_a_tool", {})).toMatchObject({ isError: true });
    await session.release("test");
  });
});
