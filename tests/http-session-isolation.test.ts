import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonHttpAuthority } from "../src/server/http-authority.js";
import { withSessionContext } from "../src/server/session-context.js";
import { resolveHttpPolicy, publicHttpPolicy } from "../src/server/http-policy.js";
import { handleArchitectRoute } from "../src/architect/routes.js";
import * as lifecycle from "../src/instance/lifecycle.js";
import * as cliBridge from "../src/architect/cli-bridge.js";
import { initLlmProvider } from "../src/cognitive/llm.js";
import { setDataDirOverride } from "../src/utils/paths.js";
import { releaseGraphWriter } from "../src/graph/writer-lease.js";
let root: string, server: Server, base: string, authority: DaemonHttpAuthority;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "dg-http-session-")); setDataDirOverride(join(root, "data")); await mkdir(join(root, "plans")); await mkdir(join(root, "data"));
  await mkdir(join(root, "config")); await writeFile(join(root, "config", "engine.env"), "DREAMGRAPH_LLM_PROVIDER=none\n");
  await writeFile(join(root, "plans", "one.md"), "# One\n\nStatus: planning\n\n### Slice 0 — First\n\n- status: pending\n");
  vi.spyOn(lifecycle, "getActiveScope").mockReturnValue({ uuid: "fixture-instance", dataDir: join(root, "data"), runtimeDir: join(root, "runtime"), projectRoot: root,
    engineEnvPath: join(root, "config", "engine.env"), repos: { fixture: root } } as never);
  initLlmProvider({ provider: "none", model: "none", baseUrl: "", apiKey: "", temperature: 0, maxTokens: 1024, timeoutMs: 1000 });
  authority = new DaemonHttpAuthority(0, {});
  server = createServer(async (req, res) => {
    try {
      const identity = await authority.authorize(req, res); if (!identity) return;
      await withSessionContext(identity, async () => {
        if (await authority.handle(req, res, identity)) return;
        if (await handleArchitectRoute(req, res, new URL(req.url || "/", base).pathname)) return;
        res.statusCode = 404; res.end();
      });
    } catch { res.statusCode = 500; res.end("fixture error"); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => { await new Promise<void>(resolve => server.close(() => resolve())); vi.restoreAllMocks(); await releaseGraphWriter(join(root, "data")); setDataDirOverride(null); await rm(root, { recursive: true, force: true }); });
const rawStatus = (headers: Record<string, string>) => new Promise<number>((resolve, reject) => {
  const req = request(base + "/api/authority/v1/status", { headers }, res => { res.resume(); res.on("end", () => resolve(res.statusCode!)); });
  req.on("error", reject); req.end();
});
const post = (path: string, token: string, body: unknown) => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", "X-DreamGraph-Session": token, Origin: base, "Sec-Fetch-Mode": "cors" }, body: JSON.stringify(body) });
async function client() { const response = await fetch(base + "/api/authority/v1/status"); return { token: response.headers.get("X-DreamGraph-Session")!, state: await response.json() }; }
describe("actual local HTTP session boundaries", () => {
  it("defaults to loopback, refuses unsafe remote combinations and redacts authentication", () => {
    expect(resolveHttpPolicy(8100, {}).bind).toBe("127.0.0.1");
    expect(() => resolveHttpPolicy(8100, { DREAMGRAPH_HTTP_BIND: "0.0.0.0" })).toThrow("EXPLICIT_ENABLEMENT");
    expect(() => resolveHttpPolicy(8100, { DREAMGRAPH_REMOTE_ENABLED: "true" })).toThrow("AUTHENTICATION");
    const policy = resolveHttpPolicy(8100, { DREAMGRAPH_HTTP_BIND: "0.0.0.0", DREAMGRAPH_REMOTE_ENABLED: "true", DREAMGRAPH_REMOTE_TOKEN: "x".repeat(40), DREAMGRAPH_HTTP_ALLOWED_HOSTS: '["example.test"]' });
    expect(JSON.stringify(publicHttpPolicy(policy))).not.toContain("x".repeat(40));
  });
  it("rejects hostile origin/host/fetch metadata before creating session state", async () => {
    expect((await fetch(base + "/api/authority/v1/status", { headers: { Origin: "https://evil.test" } })).status).toBe(403);
    expect(await rawStatus({ Host: `localhost.evil.test:${(server.address() as AddressInfo).port}` })).toBe(403);
    expect(await rawStatus({ "Sec-Fetch-Site": "cross-site" })).toBe(403);
    const valid = await client(); expect(valid.token).toBeTruthy(); expect(valid.state.remote_enabled).toBe(false);
  });
  it("keeps Architect selection/model/history private across overlapping clients and reload", async () => {
    const [a, b] = await Promise.all([client(), client()]); expect(a.state.session_id).not.toBe(b.state.session_id);
    const before = await readFile(join(root, "config", "engine.env"), "utf8");
    expect((await post("/api/architect/v1/selection", a.token, { plan_id: "one" })).status).toBe(200);
    expect((await post("/api/architect/v1/config", a.token, { adapter: "codex-cli", model: "gpt-6.1-sol", verbosity_mode: "detailed" })).status).toBe(200);
    const stateA = await (await fetch(base + "/api/architect/v1", { headers: { "X-DreamGraph-Session": a.token } })).json();
    const stateB = await (await fetch(base + "/api/architect/v1", { headers: { "X-DreamGraph-Session": b.token } })).json();
    expect(stateA.architect_runtime.model).toBe("gpt-6.1-sol"); expect(stateB.architect_runtime.model).not.toBe("gpt-6.1-sol");
    expect(await readFile(join(root, "config", "engine.env"), "utf8")).toBe(before);
    expect((await post("/api/architect/v1/chat-history", a.token, { messages: [{ role: "user", content: "private-a" }] })).status).toBe(200);
    const aHistory = await (await fetch(base + "/api/architect/v1/chat-history", { headers: { "X-DreamGraph-Session": a.token } })).json();
    const bHistory = await (await fetch(base + "/api/architect/v1/chat-history", { headers: { "X-DreamGraph-Session": b.token } })).json();
    expect(JSON.stringify(aHistory)).toContain("private-a"); expect(JSON.stringify(bHistory)).not.toContain("private-a");
    expect((await post("/api/architect/v1/chat-history", b.token, { session_id: a.state.session_id, clear: true })).status).toBe(403);
    expect((await fetch(base + "/api/architect/v1/chat-history", { headers: { "X-DreamGraph-Session": "forged.token" } })).status).toBe(401);
  });
  it("authenticates explicit remote mode and resumes only the authenticated principal", async () => {
    const token = "fixture-operator-token-" + "x".repeat(32);
    authority = new DaemonHttpAuthority(0, { DREAMGRAPH_REMOTE_ENABLED: "true", DREAMGRAPH_REMOTE_TOKEN: token, DREAMGRAPH_HTTP_ALLOWED_HOSTS: '["127.0.0.1"]' });
    expect((await fetch(base + "/api/authority/v1/status")).status).toBe(401);
    expect((await fetch(base + "/api/authority/v1/status", { headers: { Authorization: "Bearer incorrect" } })).status).toBe(401);
    const response = await fetch(base + "/api/authority/v1/status", { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200); const bearer = response.headers.get("X-DreamGraph-Session")!;
    const first = await response.json(); expect(JSON.stringify(first)).not.toContain(token);
    const resumed = await (await fetch(base + "/api/authority/v1/status", { headers: { "X-DreamGraph-Session": bearer } })).json();
    expect(resumed.session_id).toBe(first.session_id);
    authority = new DaemonHttpAuthority(0, { DREAMGRAPH_REMOTE_ENABLED: "true", DREAMGRAPH_REMOTE_TOKEN: token + "rotated", DREAMGRAPH_HTTP_ALLOWED_HOSTS: '["127.0.0.1"]' });
    expect((await fetch(base + "/api/authority/v1/status", { headers: { "X-DreamGraph-Session": bearer } })).status).toBe(401);
  });
  it("isolates overlapping execution and cancellation, and reconnects to its own running pass", async () => {
    const [a, b] = await Promise.all([client(), client()]);
    const signals = new Map<string, AbortSignal>();
    vi.spyOn(cliBridge, "runArchitectCliBridge").mockImplementation(input => new Promise((_resolve, reject) => {
      signals.set(input.userMessage, input.signal!);
      input.signal!.addEventListener("abort", () => reject(new Error("fixture-stopped")), { once: true });
    }));
    const runningA = post("/api/architect/v1/chat", a.token, { message: "private-a", adapter: "codex-cli" });
    const runningB = post("/api/architect/v1/chat", b.token, { message: "private-b", adapter: "codex-cli" });
    try {
      await vi.waitFor(() => expect(signals.size).toBe(2), { timeout: 5000 });
      const state = await (await fetch(base + "/api/architect/v1", { headers: { "X-DreamGraph-Session": a.token } })).json();
      expect(state.execution_control.state).toBe("running");
      expect((await post("/api/architect/v1/chat", a.token, { message: "duplicate", adapter: "codex-cli" })).status).toBe(409);
      expect(signals.size).toBe(2);
      expect((await post("/api/architect/v1/commands", b.token, { command: "stop", args: [] })).status).toBe(200);
      expect(signals.get("private-b")!.aborted).toBe(true); expect(signals.get("private-a")!.aborted).toBe(false);
      expect((await post("/api/architect/v1/commands", a.token, { command: "stop", args: [] })).status).toBe(200);
      expect(signals.get("private-a")!.aborted).toBe(true);
    } finally {
      await post("/api/architect/v1/commands", b.token, { command: "stop", args: [] });
      await post("/api/architect/v1/commands", a.token, { command: "stop", args: [] });
      await Promise.all([runningA, runningB]);
    }
  });
  it("requires the human browser control port for full-access confirmation", async () => {
    const a = await client(); const input = { execution_id: "e", scope: ["fixture"], capabilities: ["computer_use"], duration_ms: 5000, human_confirmed: true };
    const denied = await fetch(base + "/api/authority/v1/full-access/begin", { method: "POST", headers: { "Content-Type": "application/json", "X-DreamGraph-Session": a.token }, body: JSON.stringify(input) }); expect(denied.status).toBe(403);
    const challenge = await (await post("/api/authority/v1/full-access/begin", a.token, input)).json(); expect(challenge.ok).toBe(true);
    const grant = await (await post("/api/authority/v1/full-access/confirm", a.token, { ...challenge.result, human_confirmed: true })).json(); expect(grant.result.confirmations).toHaveLength(2);
    expect((await post("/api/authority/v1/grants/revoke", a.token, { grant_id: grant.result.id })).status).toBe(200);
  });
  it("keeps scoped computer permission on the human control port and reports unavailable native routes without substitution",async()=>{
    const a=await client(),b=await client(),input={operation_id:"scoped:Å日本語",execution_id:"future-original",target_id:"target",profile_hash:"sha256:"+"a".repeat(64),
      backend_source_hash:"sha256:"+"b".repeat(64),interact:false,duration_ms:10000,human_confirmed:true};
    expect((await fetch(base+"/api/authority/v1/scoped-computer/confirm",{method:"POST",headers:{"Content-Type":"application/json","X-DreamGraph-Session":a.token},body:JSON.stringify(input)})).status).toBe(403);
    const response=await post("/api/authority/v1/scoped-computer/confirm",a.token,input),grant=(await response.json()).result;
    expect(response.status).toBe(200);expect(grant.confirmations[0].id).toBe(input.operation_id);expect(grant.capabilities).not.toContain("computer_interact");
    expect((await (await post("/api/authority/v1/scoped-computer/confirm",a.token,input)).json()).result).toEqual(grant);
    expect((await post("/api/authority/v1/grants/revoke",b.token,{grant_id:grant.id})).status).toBe(400);
    const unavailable=await (await fetch(base+"/api/architect/v1/computer/setup?adapter=codex-cli",{headers:{"X-DreamGraph-Session":a.token}})).json();
    expect(unavailable).toMatchObject({available:false,route:"native_cli",reasons:["COMPUTER_NATIVE_CLI_CONFORMANCE_UNAVAILABLE"]});
    expect((await post("/api/architect/v1/computer/prepare",a.token,{adapter:"native_api_tool_loop",interact:false,duration_ms:30000,worker:{source:"untrusted"}})).status).toBe(400);
    expect((await post("/api/architect/v1/computer/confirm",a.token,{id:"forged",human_confirmed:true})).status).toBe(400);
  });
});
