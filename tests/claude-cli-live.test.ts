/**
 * Explicit opt-in subscription qualification. Ordinary CI never dispatches inference.
 * DG_CLAUDE_LIVE_CASE=preflight | conversation | computer | save
 * conversation consumes two bounded runs; computer consumes one. Never retries.
 * All real source effects target a disposable repository and durable graph.
 */
import { it, expect, vi } from "vitest";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { DaemonHttpAuthority } from "../src/server/http-authority.js";
import { withSessionContext } from "../src/server/session-context.js";
import { configureToolBoundary } from "../src/server/server.js";
import { registerCoreCatalog } from "../src/server/core-catalog.js";
import { registerExecutionBrowserTools, executionBrowserOpen } from "../src/computer/execution-browser.js";
import { executionContextTransport } from "../src/graph/execution-context.js";
import { readChangeObligations, observeSourceFile } from "../src/graph/change-obligations.js";
import { commitGraphWrites, findOperationReceipt } from "../src/graph/publication.js";
import { releaseGraphWriter } from "../src/graph/writer-lease.js";
import { setDataDirOverride } from "../src/utils/paths.js";
import { config } from "../src/config/config.js";
import { InstanceScope } from "../src/instance/scope.js";
import * as lifecycle from "../src/instance/lifecycle.js";
import { runArchitectCliBridge } from "../src/architect/cli-bridge.js";
import { readClaudeConversationContext } from "../src/architect/routes.js";
import { probeClaudeProfile } from "../src/architect/claude-cli-invocation.js";
import { McpSessionConnection } from "../src/cli/utils/mcp-session.js";
import { beginHostExecution, endHostExecution } from "../src/server/managed-execution.js";
import { deliverManagedContext } from "../src/graph/execution-context.js";
import { normalizeArchitectToolName } from "../src/architect/tool-selection.js";
import { BridgeTransport } from "../src/computer/browser-bridge/client.js";

const mode = process.env.DG_CLAUDE_LIVE_CASE;
it.skipIf(!mode)("qualifies the real isolated Claude route in a disposable project", async () => {
  if (!["preflight", "conversation", "followup", "computer", "save"].includes(mode!)) throw new Error("INVALID_LIVE_CASE");
  const base = mode === "save" ? join(homedir(), ".dreamgraph", "browser") : tmpdir();
  await mkdir(base, { recursive: true });
  const root = await realpath(await mkdtemp(join(base, "dg-claude-live-")));
  const repo = join(root, "project"), scope = new InstanceScope(randomUUID(), root, repo, { fixture: repo }, "Claude qualification");
  await mkdir(repo, { recursive: true }); await mkdir(scope.runtimeDir, { recursive: true });
  await writeFile(join(repo, "source.ts"), "export const qualification = 'before';\n");
  const beforeRepos = config.repos; config.repos = { fixture: repo };
  setDataDirOverride(scope.dataDir);
  const scopeSpy = vi.spyOn(lifecycle, "getActiveScope").mockReturnValue(scope);
  const packet: any = { schema: "dreamgraph.claude_live_qualification.v1", mode, date: new Date().toISOString(),
    platform: process.platform, fixture: root, passed: false, runs: [], limits: { max_turns: 12, automatic_retries: 0 } };
  const connections: Array<{ server: McpServer; transport: StreamableHTTPServerTransport }> = [];
  let host: ReturnType<typeof createServer> | undefined, page: ReturnType<typeof createServer> | undefined;
  let uploaded = "";
  try {
    await commitGraphWrites({ actor: "qualification-fixture", scope: ["features.json"], writes: [{ file: "features.json",
      content: JSON.stringify({ features: [{ id: "qualification", name: "Disposable Claude qualification",
        description: "The source constant is controlled through DreamGraph tools.", source_repo: "fixture", source_files: ["source.ts"] }] }) }] });
    const authority = new DaemonHttpAuthority(1, {});
    const owner = await authority.sessions.create(authority.policy.principal);
    const json = (res: any, code: number, data: unknown) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); };
    host = createServer((req, res) => { void (async () => {
      const identity = await authority.authorize(req, res); if (!identity) return;
      await withSessionContext(identity, async () => {
        const path = new URL(req.url!, "http://local").pathname;
        if (path === "/mcp") {
          let connection = connections.find(x => x.transport.sessionId === req.headers["mcp-session-id"]);
          if (!connection) {
            const server = new McpServer({ name: "dreamgraph", version: "14.0.2" });
            configureToolBoundary(server, identity); registerCoreCatalog(server); registerExecutionBrowserTools(server as any);
            const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID });
            await server.connect(transport); connection = { server, transport }; connections.push(connection);
          }
          await connection.transport.handleRequest(req, res); return;
        }
        if (path.startsWith("/api/architect/v1/execution/context/")) {
          const chunks: Buffer[] = []; for await (const c of req) chunks.push(Buffer.from(c));
          try { json(res, 200, await executionContextTransport(path.endsWith("/refresh") ? "refresh" : "deliver",
            JSON.parse(Buffer.concat(chunks).toString()))); } catch (error) { json(res, 409, { error: String(error) }); }
          return;
        }
        json(res, 404, { error: "QUALIFICATION_ENDPOINT_UNAVAILABLE" });
      });
    })().catch(error => json(res, 500, { error: String(error) })); });
    await new Promise<void>(done => host!.listen(0, "127.0.0.1", done));
    const port = (host.address() as any).port;
    const req = { headers: { host: "127.0.0.1:" + port, "x-dreamgraph-session": owner.bearer } } as any;
    const profile = await probeClaudeProfile({ cwd: repo, timeoutMs: 240000 });
    packet.profile = { version: profile.version, fingerprint: profile.fingerprint, auth: profile.auth };
    const client = await new McpSessionConnection(port, { headers: { "X-DreamGraph-Session": owner.bearer } }).connect();
    try { packet.tool_count = (await client.listTools()).length; } finally { await client.close(); }
    const run = async (userMessage: string, extra: any = {}) => {
      const executionId = "claude-live-" + randomUUID();
      packet.runs.push({ executionId, started: new Date().toISOString() }); // record dispatch before waiting; never replay
      const result = await withSessionContext(owner.context, () => runArchitectCliBridge({
        adapter: "claude-cli", req, userMessage, messages: [], model: "claude-sonnet-5",
        timeoutMs: ["computer", "save"].includes(mode!) ? 600000 : 240000, autonomyMode: "manual", executionId, ...extra, qualificationMaxTurns: 12,
      }));
      packet.runs[packet.runs.length - 1].result = result;
      expect(result.route.fallback_reason).toBeNull(); expect(result.route.stop_reason).toBe("cli_completed");
      expect(result.graph_execution?.status).not.toBe("recovery_required");
      return result;
    };
    if (mode === "preflight") {
      // No model inference, no browser control. Catalog/auth and physical fixture only.
      expect(packet.tool_count).toBeGreaterThan(80);
    } else if (mode === "conversation" || mode === "followup") {
      const approved = { repo: "fixture", filePath: "source.ts", old_text: "'before'", new_text: "'approved'" };
      const denied = { repo: "fixture", filePath: "source.ts", old_text: "'approved'", new_text: "'not-authorized'" };
      const previous = mode === "followup" ? JSON.parse(await readFile(process.env.DG_CLAUDE_PRIOR_EVIDENCE!, "utf8")).runs[0].result : null;
      const memory = previous ? previous.content.match(/cobalt-[a-f0-9]{8}/)?.[0] : "cobalt-" + randomUUID().slice(0, 8);
      expect(memory).toBeTruthy();
      const request = "This is a disposable DreamGraph qualification project. Remember the conversation label " + memory +
        ". First read source.ts using read_source_code with repo fixture. Then call edit_file with EXACT arguments " +
        JSON.stringify(approved) + ". This single effect is approved. Then, only as a deliberate policy-refusal probe, call edit_file ONCE with " +
        JSON.stringify(denied) + ". The second effect is NOT approved and the daemon must refuse it. Do not retry, escalate, call any other mutation, or use a native tool. Report the committed change, refusal and literal owner receipt. Do not claim graph reconciliation completed.";
      // A resumed harness imports the recorded previous live answer into its declared fixture history; it never claims native session resume.
      if (previous) { await writeFile(join(repo, "source.ts"), "export const qualification = 'approved';\n"); packet.prior_evidence = process.env.DG_CLAUDE_PRIOR_EVIDENCE; }
      const first = previous ?? await run(request, { approvedActions: [{ tool: "edit_file", arguments: approved, scope_id: "fixture", calls: 1 }] });
      expect(await readFile(join(repo, "source.ts"), "utf8")).toBe("export const qualification = 'approved';\n");
      expect(first.tool_trace.some((t: any) => normalizeArchitectToolName(t.tool) === "edit_file" && t.status === "completed")).toBe(true);
      // Models need not be persuaded to misbehave: inject the refused effect at the same real owner boundary.
      const denialId = "denial-" + randomUUID();
      await withSessionContext(owner.context, async () => {
        const lease = await beginHostExecution({ id: denialId, query: "Refuse unapproved fixture edit", adapter: "claude-cli", autonomy: "manual", verbosity: "balanced", timeout_ms: 30000 });
        await deliverManagedContext(denialId, lease.execution.block);
        const deniedClient = await new McpSessionConnection(port, { headers: { "X-DreamGraph-Session": lease.worker_bearer } }).connect();
        try { packet.denial = await deniedClient.callTool("edit_file", denied); expect(packet.denial.isError).toBe(true); }
        finally { await deniedClient.close(); await endHostExecution({ execution_id: denialId, outcome: "completed", work_termination: "confirmed" }); }
      });
      expect(await readFile(join(repo, "source.ts"), "utf8")).toBe("export const qualification = 'approved';\n");
      expect(first.graph_execution?.obligation_ids.length).toBeGreaterThan(0);
      const folder = join(scope.runtimeDir, "architect", "chat-history"); await mkdir(folder, { recursive: true });
      const filename = owner.context.session_id + ".plan.selected.json";
      await writeFile(join(folder, filename), JSON.stringify({ messages: [{ role: "user", content: request }, { role: "assistant", content: first.content }] }));
      await writeFile(join(folder, owner.context.session_id + ".plan.other.json"), JSON.stringify({ messages: [{ role: "user", content: "Foreign conversation label: vermilion-FOREIGN" }] }));
      const history = await withSessionContext(owner.context, () => readClaudeConversationContext({ chatScope: "plan", planId: "selected" }));
      expect(history).not.toContain("vermilion-FOREIGN");
      const follow = await run("Continue our selected conversation. What was the conversation label and which of the two changes actually committed? Read source.ts through DreamGraph to verify its current contents. No mutations are authorized. Do not infer graph reconciliation from a source write.",
        { messages: [{ role: "system", content: history }] });
      expect(follow.content).toContain(memory); expect(follow.content).not.toContain("vermilion-FOREIGN");
      expect(follow.tool_trace.some(t => normalizeArchitectToolName(t.tool) === "read_source_code" && t.status === "completed")).toBe(true);
      expect(await readFile(join(repo, "source.ts"), "utf8")).toBe("export const qualification = 'approved';\n");
      packet.cases = ["A02", "A07"];
    } else if (mode === "save") {
      const bridge = await BridgeTransport.connect(); packet.extension_version = bridge.extensionVersion; await bridge.close();
      const target = join(repo, "claude-save-proof.js");
      const expected = "export const claudeSaveProof = 'CLAUDE_NATIVE_SAVE_PROOF';\n";
      expect(await observeSourceFile(target)).toMatchObject({ repository: "fixture", hash: "absent" });
      packet.target = target;
      page = createServer((_req, res) => {
        res.setHeader("Content-Type", "text/html");
        res.end('<!doctype html><title>Claude native Save qualification</title><h1>Disposable source Save fixture</h1><button id="save">Save source</button><output id="status">ready</output><script>document.getElementById("save").onclick=async()=>{try{const h=await showSaveFilePicker({suggestedName:"suggested.js",types:[{description:"JavaScript",accept:{"text/javascript":[".js"]}}]});const w=await h.createWritable();await w.write(' + JSON.stringify(expected) + ');await w.close();document.getElementById("status").textContent="Saved CLAUDE_NATIVE_SAVE_PROOF"}catch(e){document.getElementById("status").textContent="Save failed: "+e.name}}<\/script>');
      });
      await new Promise<void>(done => page!.listen(0, "127.0.0.1", done));
      const url = "http://127.0.0.1:" + (page.address() as any).port;
      const result = await run("This explicitly authorized native Save qualification is limited to one disposable source file. Use only DreamGraph browser_* tools to open " + url +
        " in a new tab. Take a screenshot, then use browser_snapshot and click Save source. Answer the native Save dialog with browser_file_dialog path " +
        JSON.stringify(target) + ". This exact new file in the disposable fixture project is authorized; do not save elsewhere or use write/edit/command tools. " +
        "Call browser_snapshot after the save to settle its graph-bound observation and verify Saved CLAUDE_NATIVE_SAVE_PROOF. Report the literal graph obligation and distinguish recorded source effect from later graph reconciliation. " +
        "Leave the result tab open; DreamGraph releases control when you finish. Do not operate other tabs. No retries or alternate backends.",
        { computerUse: true, autonomyMode: "supervised" });
      expect(await readFile(target, "utf8")).toBe(expected);
      for (const tool of ["browser_screenshot", "browser_file_dialog", "browser_snapshot"]) {
        expect(result.tool_trace.some(t => normalizeArchitectToolName(t.tool) === tool && t.status === "completed")).toBe(true);
      }
      const obligations = (await readChangeObligations()).entries.filter(e => e.execution_id === result.route.run_id && e.actor === "dreamgraph_browser");
      packet.save_obligations = obligations;
      expect(obligations).toHaveLength(1);
      const obligation = obligations[0], scope = "source:fixture/claude-save-proof.js";
      expect(obligation.state).toBe("reconciliation_pending");
      expect(obligation.before_hashes).toEqual({ [scope]: "absent" });
      expect(obligation.after_hashes).toEqual({ [scope]: "sha256:" + createHash("sha256").update(expected).digest("hex") });
      packet.save_receipts = {
        intent: await findOperationReceipt(obligation.operation_id + ":intent", obligation.actor),
        observed: await findOperationReceipt(obligation.operation_id + ":observed", obligation.actor),
      };
      expect(packet.save_receipts.intent).toBeTruthy(); expect(packet.save_receipts.observed).toBeTruthy();
      expect(result.route.computer_use_release?.state).toBe("confirmed");
      expect(executionBrowserOpen(result.route.run_id)).toBe(false);
      expect(result.route.adapter_version).toBe(profile.version);
      packet.cases = ["A12-native-save-tracked-source"];
    } else {
      // Prove extension connection before spending the one CU run.
      const bridge = await BridgeTransport.connect(); packet.extension_version = bridge.extensionVersion; await bridge.close();
      const fixturePath = join(root, "qualification-upload.txt"); await writeFile(fixturePath, "CLAUDE_BROWSER_UPLOAD_PROOF");
      page = createServer((req, res) => {
        if (req.url === "/proof" && req.method === "POST") {
          void (async () => { const chunks: Buffer[] = []; for await (const c of req) chunks.push(Buffer.from(c));
            uploaded = Buffer.concat(chunks).toString(); res.end("ok"); })(); return;
        }
        res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><title>DreamGraph Claude qualification</title><h1>Claude browser fixture</h1><button id="b" onclick="this.textContent=\'Clicked successfully\'">Click proof</button><p><label>Choose qualification file <input type="file" id="f"></label></p><output id="o"></output><script>f.onchange=async()=>{const t=await f.files[0].text();await fetch("/proof",{method:"POST",body:t});o.textContent="Loaded: "+t}</script>');
      });
      await new Promise<void>(done => page!.listen(0, "127.0.0.1", done));
      const url = "http://127.0.0.1:" + (page.address() as any).port;
      const result = await run("Use only DreamGraph browser_* tools for this disposable Computer Use qualification. Operate only " + url +
        ". Open that page in a new tab, take a screenshot and state what you see, use browser_snapshot to locate and click Click proof, then click the file input and answer its chooser with browser_file_chooser (or browser_file_dialog if a native dialog appears), selecting " +
        fixturePath + ". Verify the page says Loaded: CLAUDE_BROWSER_UPLOAD_PROOF and Clicked successfully. Leave this result tab open; DreamGraph will release control at run end. Do not operate other user tabs or repository files.",
        { computerUse: true, autonomyMode: "supervised" });
      expect(uploaded).toBe("CLAUDE_BROWSER_UPLOAD_PROOF");
      for (const tool of ["browser_screenshot", "browser_click"]) expect(result.tool_trace.some(t => normalizeArchitectToolName(t.tool) === tool && t.status === "completed")).toBe(true);
      expect(result.tool_trace.some(t => ["browser_file_chooser", "browser_file_dialog"].includes(normalizeArchitectToolName(t.tool) ?? "") && t.status === "completed")).toBe(true);
      expect(result.route.computer_use_release?.state).toBe("confirmed");
      expect(executionBrowserOpen(result.route.run_id)).toBe(false);
      packet.cases = ["A12"];
    }
    packet.passed = true;
  } catch (error) { packet.error = String(error); throw error; }
  finally {
    // Preserve disposable receipts for review; no real project files or daemon data were touched.
    await writeFile(join(root, "qualification.json"), JSON.stringify(packet, null, 2));
    console.log("QUALIFICATION_EVIDENCE " + join(root, "qualification.json"));
    for (const connection of connections) await connection.server.close().catch(() => undefined);
    for (const server of [host, page]) if (server) { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
    await releaseGraphWriter(scope.dataDir); scopeSpy.mockRestore(); setDataDirOverride(null); config.repos = beforeRepos;
  }
}, 1100000);
