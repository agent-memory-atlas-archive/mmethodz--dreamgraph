import { describe, expect, it } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startCodexCuaHost } from "../src/architect/codex-cua-host.js";
import { codexComputerUseServersToml, codexTurnEndHooksToml } from "../src/architect/codex-computer-use.js";

const fakeServer = (rec: string) => `import { appendFileSync } from "node:fs"; let b=""; process.stdin.on("data",c=>{b+=c;let i;while((i=b.indexOf("\\n"))>=0){const l=b.slice(0,i);b=b.slice(i+1);appendFileSync(${JSON.stringify(rec)},l+"\\n");const m=JSON.parse(l);
 if(m.method==="initialize"){process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:m.id,result:{protocolVersion:"2025-06-18",capabilities:{},serverInfo:{name:"fake"}}})+"\\n");process.stdout.write(JSON.stringify({jsonrpc:"2.0",method:"notifications/message",params:{data:"hello"}})+"\\n");}
 else if(m.id!==undefined)process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:m.id,result:{content:[{type:"text",text:"ok "+(m.params?.name??m.method)}]}})+"\\n");}});
 process.stdin.on("end",()=>{appendFileSync(${JSON.stringify(rec)},"STDIN_CLOSED\\n");process.exit(0);});`;

describe("daemon-owned cua_repl host (Codex connects over HTTP; DreamGraph ends the turn)", () => {
  it("relays MCP traffic, tracks the Codex turn and sends turn_ended before stopping the server", async () => {
    const rec = join(await mkdtemp(join(tmpdir(), "dg-cua-host-")), "rec.txt");
    const host = await startCodexCuaHost({ command: process.execPath, args: ["--input-type=module", "-e", fakeServer(rec)], env: process.env as Record<string, string> });
    try {
    const post = async (body: unknown) => {
      const r = await fetch(host.url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(body) });
      return { status: r.status, json: r.status === 202 ? null : await r.json() };
    };
    expect((await post({ jsonrpc: "2.0", id: 0, method: "initialize", params: {} })).json).toMatchObject({ id: 0, result: { serverInfo: { name: "fake" } } });
    expect((await post({ jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);

    const events = await fetch(host.url, { headers: { accept: "text/event-stream" } });
    const reader = events.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('"notifications/message"');

    const meta = JSON.stringify({ session_id: "01a1040e-771e-7072-9f19-676ef8bb8b9f", turn_id: "turn-1" });
    const call = (await post({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "js", arguments: {}, _meta: { "x-codex-turn-metadata": meta } } })).json as { id: number; result: { content: Array<{ text: string }> } };
    expect(call.id).toBe(5);
    expect(call.result.content[0]!.text).toBe("ok js");
    expect(host.turn).toEqual({ session_id: "01a1040e-771e-7072-9f19-676ef8bb8b9f", turn_id: "turn-1" });
    expect((await fetch(host.url + "x", { method: "POST", body: "{}" })).status).toBe(404);
    await reader.cancel().catch(() => undefined);

    await host.end("run finished");
    await host.end("again");
    const received = (await readFile(rec, "utf8")).trim().split("\n");
    expect(JSON.parse(received[3]!)).toMatchObject({ id: "dreamgraph-turn-ended", params: { name: "turn_ended", arguments: { session_id: "01a1040e-771e-7072-9f19-676ef8bb8b9f", turn_id: "turn-1" } } });
    expect(received[4]).toBe("STDIN_CLOSED");
    expect(host.log.join("\n")).toContain("turn_ended ok");
    } finally {
      await host.end("test cleanup");
    }
  });

  it("points Codex at the hosted URL instead of a command", () => {
    const toml = codexComputerUseServersToml([{ name: "cua_repl", command: "node.exe", args: ["x"], env: { SECRET_PIPE: "p" }, env_vars: ["A"], source: "s", url: "http://127.0.0.1:1234/mcp/abc", enabled_tools: ["js"] }]).join("\n");
    expect(toml).toContain('url = "http://127.0.0.1:1234/mcp/abc"');
    expect(toml).not.toContain("command =");
    expect(toml).not.toContain("SECRET_PIPE");
    expect(toml).toContain('enabled_tools = ["js"]');
  });

  it("stands down when Codex's own Stop hook already called turn_ended", async () => {
    const rec = join(await mkdtemp(join(tmpdir(), "dg-cua-host-")), "rec.txt");
    const host = await startCodexCuaHost({ command: process.execPath, args: ["--input-type=module", "-e", fakeServer(rec)], env: process.env as Record<string, string> });
    try {
      const post = (body: unknown) => fetch(host.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const meta = JSON.stringify({ session_id: "s-1", turn_id: "t-1" });
      await post({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "js", arguments: {}, _meta: { "x-codex-turn-metadata": meta } } });
      await post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "turn_ended", arguments: { hook_event_name: "Stop", session_id: "s-1", turn_id: "t-1" } } });
      await host.end("run finished");
      const received = (await readFile(rec, "utf8")).trim().split("\n");
      expect(received.filter((line) => line.includes("turn_ended")).length).toBe(1);
      expect(host.log.join("\n")).toContain("Codex hook already ended the turn");
    } finally {
      await host.end("test cleanup");
    }
  });

  it("declares the same turn-end hooks as the Codex app's Computer Use plugin", () => {
    const toml = codexTurnEndHooksToml().join("\n");
    expect(toml).toContain("[[hooks.Stop]]");
    expect(toml).toContain("[[hooks.Interrupt.hooks]]");
    expect(toml).toContain('tool = "turn_ended"');
    expect(toml).toContain('session_id = "${agent_id}"');
    expect(toml).toContain('input = { hook_event_name = "${hook_event_name}", session_id = "${session_id}", turn_id = "${turn_id}" }');
  });
});

