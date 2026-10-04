import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readFile } from "node:fs/promises";
import { codexBrowserSessionGrantToml, codexNativeToolTrace, createCodexTranscriptWriter, saveCodexTranscript, codexComputerUseServersToml, codexThreadIdFromJsonLine, createCodexSessionGrantWatcher, discoverCodexComputerUseServers, widenCodexComputerUseSurfaces } from "../src/architect/codex-computer-use.js";

let home: string;
let runtime: string;

async function plugin(marketplace: string, name: string, version: string, mcp: unknown, mtime?: Date): Promise<string> {
  const dir = join(home, "plugins", "cache", marketplace, name, version);
  await mkdir(dir, { recursive: true });
  const file = join(dir, ".mcp.json");
  await writeFile(file, typeof mcp === "string" ? mcp : JSON.stringify(mcp));
  if (mtime) await utimes(file, mtime, mtime);
  return file;
}

function cua(command: string, extra: Record<string, unknown> = {}) {
  return { mcpServers: { cua_repl: {
    command, args: [join(runtime, "cua-repl.mjs")], enabled: true,
    enabled_tools: ["js", "js_reset", "turn_ended"], omit_tools_from: ["code_mode"],
    startup_timeout_sec: 120, tools: { js: { output_token_limit: 25000 } },
    env_vars: ["CODEX_WINDOWS_REGISTERED_CORE", "bad key"],
    env: { CODEX_HOME: "C:\\Users\\x\\.codex", SKY_CUA_NATIVE_PIPE_DIRECTORY: "\\\\.\\pipe\\codex-computer-use-1", NODE_REPL_TRUSTED_SERVICES: "{\"browser\":\"svc\"}" },
    ...extra,
  } } };
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "dg-codex-cu-home-"));
  runtime = await mkdtemp(join(tmpdir(), "dg-codex-cu-runtime-"));
  await writeFile(join(runtime, "node.exe"), "");
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
  await rm(runtime, { recursive: true, force: true });
});

describe("Codex native Computer Use discovery for isolated Architect runs", () => {
  it("reads cua_repl from the newest unified-computer-use plugin version", async () => {
    const node = join(runtime, "node.exe");
    await plugin("openai-bundled", "unified-computer-use", "26.900.1", cua(node, { args: ["old"] }), new Date("2026-01-01"));
    const newest = await plugin("openai-bundled", "unified-computer-use", "26.928.20755", cua(node), new Date("2026-09-01"));
    const found = await discoverCodexComputerUseServers(home);
    expect(found.servers).toHaveLength(1);
    expect(found.servers[0]).toMatchObject({
      name: "cua_repl", command: node, args: [join(runtime, "cua-repl.mjs")], source: newest,
      env_vars: ["CODEX_WINDOWS_REGISTERED_CORE"], startup_timeout_sec: 120, enabled_tools: ["js", "js_reset", "turn_ended"],
    });
    expect(found.servers[0]!.env.SKY_CUA_NATIVE_PIPE_DIRECTORY).toBe("\\\\.\\pipe\\codex-computer-use-1");
  });

  it("reports why nothing is available instead of inventing a server", async () => {
    expect((await discoverCodexComputerUseServers(home)).servers).toEqual([]);
    await plugin("openai-bundled", "unified-computer-use", "1", cua(join(runtime, "missing.exe")));
    const missing = await discoverCodexComputerUseServers(home);
    expect(missing.servers).toEqual([]);
    expect(missing.diagnostics.join("\n")).toMatch(/command missing/);
  });

  it("respects a plugin disabled in the operator's config.toml and never takes the dreamgraph name", async () => {
    const node = join(runtime, "node.exe");
    await plugin("openai-bundled", "unified-computer-use", "1", { mcpServers: { ...cua(node).mcpServers, dreamgraph: { command: node } } });
    expect((await discoverCodexComputerUseServers(home)).servers.map((s) => s.name)).toEqual(["cua_repl"]);
    await writeFile(join(home, "config.toml"), '[plugins."unified-computer-use@openai-bundled"]\nenabled = false\n');
    const disabled = await discoverCodexComputerUseServers(home);
    expect(disabled.servers).toEqual([]);
    expect(disabled.diagnostics.join("\n")).toMatch(/disabled in config\.toml/);
  });

  it("ignores malformed plugin manifests", async () => {
    await plugin("openai-bundled", "unified-computer-use", "1", "{not json");
    const found = await discoverCodexComputerUseServers(home);
    expect(found.servers).toEqual([]);
    expect(found.diagnostics.join("\n")).toMatch(/unreadable/);
  });

  it("emits a TOML server table with escaped Windows paths and the pipe env", async () => {
    const node = "C:\\Users\\Mika Jussila\\AppData\\Local\\OpenAI\\Codex\\runtimes\\cua_node\\bin\\node.exe";
    const toml = codexComputerUseServersToml([{
      name: "cua_repl", command: node, args: ["C:\\a b\\cua-repl.mjs"], env_vars: ["CODEX_WINDOWS_REGISTERED_CORE"],
      startup_timeout_sec: 120, enabled_tools: ["js"], source: "x",
      env: { SKY_CUA_NATIVE_PIPE_DIRECTORY: "\\\\.\\pipe\\p", NODE_REPL_TRUSTED_SERVICES: "{\"browser\":\"svc\"}" },
    }]).join("\n");
    expect(toml).toContain("[mcp_servers.cua_repl]");
    expect(toml).toContain(`command = ${JSON.stringify(node)}`);
    expect(toml).toContain('env_vars = ["CODEX_WINDOWS_REGISTERED_CORE"]');
    expect(toml).toContain('default_tools_approval_mode = "approve"');
    expect(toml).toContain("[mcp_servers.cua_repl.env]");
    expect(toml).toContain('SKY_CUA_NATIVE_PIPE_DIRECTORY = "\\\\\\\\.\\\\pipe\\\\p"');
    expect(toml).toContain('NODE_REPL_TRUSTED_SERVICES = "{\\"browser\\":\\"svc\\"}"');
  });
});

describe("Codex Computer Use grant is full control for the granted run", () => {
  const base = { name: "cua_repl", command: "x", args: [], env_vars: [], source: "x",
    env: { CUA_REPL_ENABLED_SURFACES: "browser", NODE_REPL_TRUSTED_SERVICES: "{\"browser\":\"@oai/browser-desktop/service\"}" } };

  it("widens cua_repl from browser-only to browser and desktop with the Sky service", () => {
    const [server] = widenCodexComputerUseSurfaces([base]);
    expect(server!.env.CUA_REPL_ENABLED_SURFACES).toBe("browser,computer");
    expect(JSON.parse(server!.env.NODE_REPL_TRUSTED_SERVICES!)).toEqual({ browser: "@oai/browser-desktop/service", sky: "@oai/sky/service" });
    expect(base.env.CUA_REPL_ENABLED_SURFACES).toBe("browser");
  });

  it("reads the Codex thread id from codex exec --json output only", () => {
    expect(codexThreadIdFromJsonLine('{"type":"thread.started","thread_id":"01a103d0-8f77-7842-a5f1-35a2466afbe1"}')).toBe("01a103d0-8f77-7842-a5f1-35a2466afbe1");
    expect(codexThreadIdFromJsonLine('{"type":"turn.started"}')).toBeNull();
    expect(codexThreadIdFromJsonLine('{"type":"thread.started","thread_id":"../../evil"}')).toBeNull();
    expect(codexThreadIdFromJsonLine("OpenAI Codex v0.159.2")).toBeNull();
  });

  it("pre-approves every site and transfer for that one Codex session as soon as the thread starts", async () => {
    const watcher = createCodexSessionGrantWatcher(home);
    watcher.onStdout('{"type":"thread.st');
    watcher.onStdout('arted","thread_id":"01a103d0-8f77-7842-a5f1-35a2466afbe1"}\n{"type":"turn.started"}\n');
    expect(watcher.threadId).toBe("01a103d0-8f77-7842-a5f1-35a2466afbe1");
    const file = await watcher.settled();
    expect(file).toBe(join(home, "browser", "sessions", "01a103d0-8f77-7842-a5f1-35a2466afbe1.toml"));
    expect(await readFile(file!, "utf8")).toBe(codexBrowserSessionGrantToml());
    expect(codexBrowserSessionGrantToml()).toContain('[origins]\nallowed = ["*", "https://*", "http://*"]');
    expect(codexBrowserSessionGrantToml()).toContain("[downloads]");
  });
});

describe("Codex native Computer Use actions are visible in the Architect trace", () => {
  const lines = [
    '{"type":"thread.started","thread_id":"01a103e7-d896-7472-8f4f-1ba32c5d3178"}',
    '{"type":"item.started","item":{"id":"item_1","type":"mcp_tool_call","server":"dreamgraph","tool":"query_resource","arguments":{},"status":"in_progress"}}',
    '{"type":"item.started","item":{"id":"item_2","type":"mcp_tool_call","server":"cua_repl","tool":"js","arguments":{"code":"await cua.getTab({ url: \\"https://web64.nofs.ai/ide/\\" })"},"status":"in_progress"}}',
    '{"type":"item.completed","item":{"id":"item_2","type":"mcp_tool_call","server":"cua_repl","tool":"js","arguments":{"code":"x"},"result":{"content":[{"type":"text","text":"clicked New > Assembly file"},{"type":"image"}]},"status":"completed"}}',
    '{"type":"item.completed","item":{"id":"item_3","type":"mcp_tool_call","server":"cua_repl","tool":"js","arguments":{"code":"y"},"error":{"message":"Browser use cannot handle the dialog because the permission request was declined"},"status":"failed"}}',
    "not json",
  ].join("\n");

  it("records Codex's own MCP tool calls (not DreamGraph's) with outcome and errors", () => {
    const trace = codexNativeToolTrace(lines, 4);
    expect(trace).toHaveLength(2);
    expect(trace[0]).toMatchObject({ iteration: 4, tool: "cua_repl:js", status: "completed", trace_id: "codex:item_2", result_preview: "clicked New > Assembly file [image]" });
    expect(trace[1]).toMatchObject({ iteration: 5, status: "failed", result_preview: "Browser use cannot handle the dialog because the permission request was declined" });
  });

  it("saves the raw transcript of a granted run under a safe name only", async () => {
    const file = await saveCodexTranscript(join(home, "t"), "0123456789abcdef", lines);
    expect(await readFile(file!, "utf8")).toBe(lines);
    expect(await saveCodexTranscript(join(home, "t"), "../../escape", lines)).toBeNull();
  });
});

it("streams the full transcript to disk regardless of the in-memory output cap", async () => {
  const writer = await createCodexTranscriptWriter(join(home, "s"), "abcdef0123456789");
  const big = "x".repeat(600 * 1024);
  writer!.write('{"type":"thread.started","thread_id":"01a103fb-5b47-7b30-9f96-0efcf6c2ee4a"}\n');
  writer!.write(big + "\n");
  writer!.write('{"type":"turn.completed"}\n');
  const text = await writer!.close();
  expect(text.length > 600 * 1024).toBe(true);
  expect(text.endsWith('{"type":"turn.completed"}\n')).toBe(true);
  expect(await createCodexTranscriptWriter(join(home, "s"), "../x")).toBeNull();
});

it("closes the transcript once even when the normal path and the final cleanup both close it", async () => {
  const writer = await createCodexTranscriptWriter(join(home, "c"), "0123456789abcdef");
  writer!.write('{"type":"thread.started","thread_id":"01a1045d-9282-7c42-8973-eda9105b4604"}\n');
  const [first, second] = await Promise.all([writer!.close(), writer!.close()]);
  expect(first).toBe(second);
  writer!.write("late chunk after close\n");
  expect(await writer!.close()).toBe(first);
});
