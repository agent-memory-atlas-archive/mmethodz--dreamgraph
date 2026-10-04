// Probe: free a Chrome tab still claimed by a dead Codex Computer Use session.
//
// Theory (from the cua runtime docs/code): browser marks (markDeliverable /
// markHandoff) are turn-scoped and are cleared when the same browser session
// resumes in a later turn; at turn end, unmarked claimed tabs are released.
// So: open the OLD session id with a NEW turn id, touch the browser once,
// then send turn_ended for that new turn.
//
// Usage (PowerShell, from the repo root; optional 2nd arg = exact tab URL):
//   & "$env:LOCALAPPDATA\OpenAI\Codex\runtimes\cua_node\1b30f7d4d73226ca\bin\node.exe" scripts\codex-cu-release-probe.mjs 01a1043b-6548-7932-9f40-c4226b0481ef
import { spawn } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const staleSession = process.argv[2];
const tabUrl = process.argv[3] || "https://web64.nofs.ai/ide/";
if (!/^[A-Za-z0-9._:-]{8,128}$/.test(staleSession ?? "")) { console.error("usage: <stale session id>"); process.exit(2); }

const codexHome = process.env.CODEX_HOME || join(process.env.USERPROFILE, ".codex");
const pluginRoot = join(codexHome, "plugins", "cache", "openai-bundled", "unified-computer-use");
const version = readdirSync(pluginRoot).map((v) => ({ v, t: statSync(join(pluginRoot, v)).mtimeMs })).sort((a, b) => b.t - a.t)[0].v;
const server = JSON.parse(readFileSync(join(pluginRoot, version, ".mcp.json"), "utf8")).mcpServers.cua_repl;
const env = { ...process.env, ...server.env, CUA_REPL_ENABLED_SURFACES: "browser" };

const child = spawn(server.command, server.args, { stdio: ["pipe", "pipe", "pipe"], env, windowsHide: true });
child.stderr.on("data", (d) => process.stderr.write(`[cua stderr] ${d}`));
const waiters = new Map();
let buf = "";
child.stdout.on("data", (chunk) => {
  buf += chunk.toString("utf8");
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id != null && waiters.has(msg.id)) { waiters.get(msg.id)(msg); waiters.delete(msg.id); }
    else console.log("[server→client]", line.slice(0, 300));
  }
});
let nextId = 1;
const call = (method, params, timeoutMs = 120000) => new Promise((resolve) => {
  const id = nextId++;
  waiters.set(id, resolve);
  setTimeout(() => { if (waiters.delete(id)) resolve({ error: { message: `timeout ${method}` } }); }, timeoutMs);
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
});
const show = (label, r) => console.log(`\n=== ${label} ===\n` + JSON.stringify(r.error ?? r.result, null, 1).slice(0, 3000));

const turn = randomUUID();
const meta = { "x-codex-turn-metadata": JSON.stringify({ session_id: staleSession, turn_id: turn, thread_source: "user" }) };

show("initialize", await call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "dreamgraph-release-probe", version: "1" } }));
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
show("tools/list", await call("tools/list", {}));
// The runtime loads a remote feature flag at start-up; early browser calls fail with
// "Unable to load browser request-header policy" until it is ready, so retry.
for (let attempt = 1; attempt <= 8; attempt++) {
  const r = await call("tools/call", {
    name: "js", _meta: meta,
    arguments: { code: `var tab = await cua.getTab({ url: ${JSON.stringify(tabUrl)} }, { browser: 'chrome' });` },
  });
  const text = JSON.stringify(r.result ?? r.error ?? {});
  show(`js attempt ${attempt}: bind the claimed tab as the stale session`, r);
  if (!/request-header policy|Retry the browser command/.test(text) && !r.error && !r.result?.isError) break;
  await new Promise((res) => setTimeout(res, 3000));
}
show("turn_ended (stale session, new turn)", await call("tools/call", {
  name: "turn_ended",
  arguments: { hook_event_name: "Stop", session_id: staleSession, turn_id: turn },
}, 30000));
console.log("\nDone. Check whether the cursor left the Web64 tab.");
child.stdin.end();
setTimeout(() => { child.kill(); process.exit(0); }, 3000);
