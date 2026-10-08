/** Instrumented native executables plus real stdio/HTTP MCP; no inference or user repository effects. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createServer, type IncomingMessage } from "node:http";
import { mkdtemp, writeFile, readFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { setDataDirOverride, getDataDir } from "../src/utils/paths.js";
import { releaseGraphWriter } from "../src/graph/writer-lease.js";
import { withSessionContext, type SessionContext } from "../src/server/session-context.js";
import { DaemonHttpAuthority } from "../src/server/http-authority.js";
import { assertExecutionAction, issueExecutionPolicy, authenticateExecutionPolicy } from "../src/server/execution-policy.js";
import { invokeToolBoundary } from "../src/server/tool-boundary.js";
import { executeScopedCommand } from "../src/server/scoped-command.js";
import { executionContextTransport } from "../src/graph/execution-context.js";
import { runArchitectCliBridge, qualifyCliControlHelp } from "../src/architect/cli-bridge.js";

let root: string, old: string;
beforeEach(async () => { old = getDataDir(); root = await mkdtemp(join(tmpdir(), "dg-cli-controls-")); setDataDirOverride(root); });
afterEach(async () => { vi.unstubAllEnvs(); await releaseGraphWriter(root); setDataDirOverride(old); await rm(root, { recursive: true, force: true }); });
const context = (id = "operator"): SessionContext => ({ session_id: id, principal: "local-machine", directory: root, channel: "browser", environment: {}, continuation_key: "fixture" });
const action = (text: string, scope_id = "slice-one") => ({ tool: "edit_file", arguments: { filePath: "fixture.txt", text }, scope_id, calls: 1 });
it("execution authority cannot borrow another managed context identity",()=>{
 expect(()=>issueExecutionPolicy(context(),{id:"one",context_id:"other",autonomy:"manual",verbosity:"concise",timeout_ms:1000,signal:new AbortController().signal})).toThrow("EXECUTION_CONTEXT_ID_MISMATCH");
});
it("manual admits one invoked effect, supervised stops at one checkpoint, autonomous retains only explicitly approved task scopes", () => {
  for (const mode of ["manual", "supervised", "autonomous"] as const) {
    const lease = issueExecutionPolicy(context(), { id: mode, autonomy: mode, verbosity: "balanced", timeout_ms: 10000,
      signal: new AbortController().signal, approvals: [action("first"), action("second", mode === "autonomous" ? "slice-two" : "slice-one")] });
    assertExecutionAction(lease.policy, "query_resource", {});
    assertExecutionAction(lease.policy, "edit_file", action("first").arguments);
    if (mode === "manual") expect(() => assertExecutionAction(lease.policy, "edit_file", action("second").arguments)).toThrow("EXECUTION_ACTION_APPROVAL_REQUIRED");
    else assertExecutionAction(lease.policy, "edit_file", action("second").arguments);
    expect(() => assertExecutionAction(lease.policy, "edit_file", action("outside").arguments)).toThrow("EXECUTION_ACTION_APPROVAL_REQUIRED");
    lease.close();
  }
  expect(() => issueExecutionPolicy(context(), { id: "cross-checkpoint", autonomy: "supervised", verbosity: "concise", timeout_ms: 10000,
    signal: new AbortController().signal, approvals: [action("first"), action("second", "slice-two")] })).toThrow("EXECUTION_CHECKPOINT_SCOPE_REQUIRED");
});
it("effect reservations survive a failing owner, unknown arguments cannot broaden scope, and cancellation fences subsequent reads/effects", async () => {
  const controller = new AbortController(), lease = issueExecutionPolicy(context(), { id: "failure", autonomy: "autonomous", verbosity: "detailed", timeout_ms: 10000,
    signal: controller.signal, approvals: [action("first")] });
  const owner = vi.fn(() => { throw new Error("uncertain effect"); });
  const invoke = () => withSessionContext(authenticateExecutionPolicy(lease.bearer, "local-machine", root), () => invokeToolBoundary({ name: "edit_file", shape: { filePath: z.string(), text: z.string() }, args: action("first").arguments, handler: owner }));
  expect((await invoke()).isError).toBe(true); expect((await invoke()).structuredContent?.error).toMatchObject({ code: "EXECUTION_POLICY_DENIED" }); expect(owner).toHaveBeenCalledTimes(1);
  controller.abort(new Error("operator stop")); expect(() => authenticateExecutionPolicy(lease.bearer, "local-machine", root)).toThrow("EXECUTION_POLICY_REJECTED");
  expect(() => assertExecutionAction(lease.policy, "query_resource", {})).toThrow("operator stop"); lease.close();
});
it("private execution identity cannot cross principals, directories, sessions or broaden another in-flight policy", () => {
  const one = issueExecutionPolicy(context("one"), { id: "one", autonomy: "manual", verbosity: "concise", timeout_ms: 10000, signal: new AbortController().signal, approvals: [action("first")] });
  const two = issueExecutionPolicy(context("two"), { id: "two", autonomy: "autonomous", verbosity: "detailed", timeout_ms: 10000, signal: new AbortController().signal, approvals: [action("second")] });
  expect(authenticateExecutionPolicy(one.bearer, "local-machine", root).session_id).toBe("one");
  expect(() => authenticateExecutionPolicy(one.bearer, "other", root)).toThrow(); expect(() => authenticateExecutionPolicy(one.bearer, "local-machine", root + "-other")).toThrow();
  expect(() => assertExecutionAction(one.policy, "edit_file", action("second").arguments)).toThrow();
  expect(two.policy.verbosity).toBe("detailed"); one.close(); expect(() => authenticateExecutionPolicy(one.bearer, "local-machine", root)).toThrow(); two.close();
});
it("daemon command perimeter rejects missing/excess grants and observes actual process cancellation", async () => {
  const program = join(root, "wait.mjs"), started = join(root, "started");
  await writeFile(program, `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(started)},'ready');setTimeout(()=>{},30000);`);
  const controller = new AbortController(), args = { command: `node "${program}"` };
  const lease = issueExecutionPolicy(context(), { id: "command", autonomy: "manual", verbosity: "concise", timeout_ms: 10000,
    signal: controller.signal, approvals: [{ tool: "run_command", arguments: args, scope_id: "command", calls: 1 }] });
  await expect(executeScopedCommand(undefined, args, root)).rejects.toThrow("COMMAND_EXECUTION_POLICY_REQUIRED");
  const run = executeScopedCommand(lease.policy, args, root);
  for (let i = 0; i < 100; i++) { try { if (await readFile(started, "utf8") === "ready") break; } catch {} await new Promise(done => setTimeout(done, 20)); }
  expect(await readFile(started, "utf8")).toBe("ready"); controller.abort(new Error("stop"));
  const result = await run; expect(result.exitCode).not.toBe(0); expect(result.effect_status).toContain("reconciliation_receipt"); lease.close();
});
it("missing installed flags/version blocks a selected control instead of silently using a different profile", () => {
  expect(() => qualifyCliControlHelp("copilot-cli", "copilot 1.0.56", "--prompt --allow-all-tools")).toThrow("CLI_CONTROL_CAPABILITY_UNQUALIFIED");
  expect(() => qualifyCliControlHelp("codex-cli", "unknown", "--sandbox --json --output-last-message --ephemeral --ignore-rules")).toThrow();
});

async function fakeExecutable(adapter: "codex-cli" | "copilot-cli") {
  const program = join(root, `${adapter}.mjs`), cli = join(root, process.platform === "win32" ? `${adapter}.cmd` : adapter);
  const clientModule = pathToFileURL(resolve("node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js")).href;
  const stdioModule = pathToFileURL(resolve("node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js")).href;
  await writeFile(program, `import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path'; import {Client} from ${JSON.stringify(clientModule)}; import {StdioClientTransport} from ${JSON.stringify(stdioModule)};
const argv=process.argv.slice(2);
if(argv.includes('--version')) {console.log(${JSON.stringify(adapter === "codex-cli" ? "codex-cli 0.159.2" : "copilot 1.0.56")});process.exit(0);}
if(argv.includes('--help')) {console.log('--sandbox --json --output-last-message --ephemeral --ignore-rules --allow-all-tools --deny-tool --disable-builtin-mcps --output-format --prompt');process.exit(0);}
let env, command, args, prompt='';
if(${JSON.stringify(adapter)}==='codex-cli') {
 const config=await readFile(join(process.env.CODEX_HOME,'config.toml'),'utf8');
 const lines=config.split('\\n'), get=(key)=>JSON.parse(lines.find(l=>l.startsWith(key+' = ')).split(' = ').slice(1).join(' = '));
 command=get('command');args=get('args');env=Object.fromEntries(lines.filter(l=>l.startsWith('DREAMGRAPH_')||l.startsWith('ELECTRON_')).map(l=>{let [k,...v]=l.split(' = ');return [k,JSON.parse(v.join(' = '))];}));
 for await(const chunk of process.stdin) prompt+=chunk;
} else {
 const config=JSON.parse(await readFile(join(process.env.COPILOT_HOME,'mcp-config.json'),'utf8')).mcpServers.dreamgraph;
 ({env,command,args}=config); const directive=argv[argv.indexOf('--prompt')+1];const path=directive.split('at this path: ')[1].split('. Use your read tool')[0];prompt=await readFile(path,'utf8');
}
const client=new Client({name:'instrumented-native-cli',version:'1'}),transport=new StdioClientTransport({command,args,env:{...process.env,...env},stderr:'pipe'});
await client.connect(transport);
const outcomes=[];
for(const [name,arguments_] of [['query_resource',{}],['query_architecture_decisions',{}],...Array.from({length:98},()=>['query_resource',{}]),['edit_file',{filePath:'fixture.txt',text:'first'}],['edit_file',{filePath:'fixture.txt',text:'second'}],['edit_file',{filePath:'fixture.txt',text:'next-checkpoint'}],['edit_file',{filePath:'fixture.txt',text:'outside'}]]) {
 const r=await client.callTool({name,arguments:arguments_});outcomes.push({name,isError:r.isError===true,required_context:r.content?.some(item=>item.type==='text'&&item.text.startsWith('DreamGraph required execution context.'))===true});
}
await client.close();await writeFile(process.env.ASHOKA_FIXTURE_CAPTURE,JSON.stringify({argv,prompt,outcomes,credential:env.DREAMGRAPH_BRIDGE_SESSION_BEARER?.startsWith('dgexec.')?'execution_bound':'incorrect'}));
const content='Outcome with graph anchors, evidence, completeness warning and next review.';
if(argv.includes('--output-last-message')) await writeFile(argv[argv.indexOf('--output-last-message')+1],content);
else console.log(JSON.stringify({type:'assistant.message',content}));
console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:100,output_tokens:12}}));
`, "utf8");
  await writeFile(cli, process.platform === "win32" ? `@echo off\r\n"${process.execPath}" "${program}" %*\r\n` : `#!/bin/sh\nexec '${process.execPath}' '${program}' "$@"\n`); await chmod(cli, 0o700);
  return cli;
}
it.each(["codex-cli", "copilot-cli"] as const)("%s executes real bridge tool fences for all modes and transmits evidence-preserving verbosity", async adapter => {
  const cli = await fakeExecutable(adapter); vi.stubEnv(adapter === "codex-cli" ? "DREAMGRAPH_ARCHITECT_CODEX_CLI_BINARY" : "DREAMGRAPH_ARCHITECT_COPILOT_CLI_BINARY", cli);
  vi.stubEnv("CODEX_HOME", root); vi.stubEnv("COPILOT_HOME", root);
  const capture = join(root, "capture.json"); vi.stubEnv("ASHOKA_FIXTURE_CAPTURE", capture);
  const authority = new DaemonHttpAuthority(1, {}), session = await authority.sessions.create("local-machine");
  const connections: Array<{ transport: StreamableHTTPServerTransport; server: Server }> = [];
  let writes = 0;
  const http = createServer(async (req, res) => {
    const identity = await authority.authorize(req, res); if (!identity) return;
    await withSessionContext(identity, async () => {
      if (req.url?.startsWith("/api/architect/v1/execution/context/")) {
        const chunks: Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
        try { const result=await executionContextTransport(req.url.endsWith("/refresh")?"refresh":"deliver",JSON.parse(Buffer.concat(chunks).toString("utf8")));
          res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify(result)); }
        catch(error){res.writeHead(409,{"Content-Type":"application/json"});res.end(JSON.stringify({error:String(error)}));}return;
      }
      const sid = req.headers["mcp-session-id"], known = connections.find(c => c.transport.sessionId === sid);
      if (known) { await known.transport.handleRequest(req, res); return; }
      const server = new Server({ name: "fixture-tool-owners", version: "1" }, { capabilities: { tools: {} } });
      const names = ["query_resource", "query_architecture_decisions", "read_source_code", "search_source_code", "edit_file"];
      server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: names.map(name => ({ name, inputSchema: { type: "object" as const } })) }));
      server.setRequestHandler(CallToolRequestSchema, async call => invokeToolBoundary({ name: call.params.name, args: call.params.arguments,
        shape: call.params.name === "edit_file" ? { filePath: z.string(), text: z.string() } : {}, handler: async () => {
          if (call.params.name === "edit_file") { writes++; await writeFile(join(root, "fixture.txt"), String(call.params.arguments!.text)); }
          return { content: [{ type: "text", text: "fixture owner with graph anchor and provenance" }], structuredContent: { success: true, complete: true } };
        } }));
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID }); connections.push({ transport, server }); await server.connect(transport);
      await transport.handleRequest(req, res);
    });
  });
  await new Promise<void>(done => http.listen(0, "127.0.0.1", done)); const port = (http.address() as { port: number }).port;
  try {
    for (const [mode, verbosity] of [["manual", "concise"], ["supervised", "balanced"], ["autonomous", "detailed"]] as const) {
      writes = 0;
      const result = await withSessionContext(session.context, () => runArchitectCliBridge({ adapter, req: { headers: { host: `127.0.0.1:${port}`, "x-dreamgraph-session": session.bearer } } as unknown as IncomingMessage,
        executionId:`browser:${session.context.session_id}:${mode}`,
        model: "fixture", messages: [{ role: "system", content: "Mandatory graph/ADR anchors." }], userMessage: "Perform only authorized fixture actions.", timeoutMs: 30000,
        autonomyMode: mode, verbosityMode: verbosity, approvedActions: [action("first"), action("second"), ...(mode === "autonomous" ? [action("next-checkpoint", "slice-two")] : [])] }));
      expect(result.route.fallback_reason).toBeNull(); expect(writes).toBe(mode === "manual" ? 1 : mode === "supervised" ? 2 : 3);
      const recorded = JSON.parse(await readFile(capture, "utf8")); expect(recorded.credential).toBe("execution_bound");
      expect(recorded.outcomes.slice(0, 100).every((r: any) => !r.isError)).toBe(true);
      // Unchanged read results reuse the already-delivered prompt context (prompt-cache cost fix).
      expect(recorded.outcomes.slice(0, 100).every((r:any)=>!r.required_context)).toBe(true);
      expect(recorded.prompt).toContain("DreamGraph required execution context.");
      expect(recorded.outcomes[102].isError).toBe(mode !== "autonomous"); expect(recorded.outcomes[103].isError).toBe(true); expect(recorded.prompt).toContain(`autonomy=${mode}; verbosity=${verbosity}`);
      expect(recorded.prompt).toContain("scoped currency/completeness warnings"); expect(recorded.prompt).not.toContain(session.bearer);
      expect(result.route.effective_controls).toMatchObject({ effective: { autonomy: mode, verbosity }, support: "enforced" });
      expect(result.route.output_controls?.exact_density).toBe("not_guaranteed");
    }
  } finally { for (const connection of connections) await connection.server.close(); http.closeAllConnections(); await new Promise<void>(done => http.close(() => done())); }
}, 90000);

it("100 investigative reads do not consume the shared CLI/API mutation allowance", () => {
  const lease = issueExecutionPolicy(context(), { id: "long-investigation", autonomy: "manual", verbosity: "balanced",
    timeout_ms: 10000, signal: new AbortController().signal, approvals: [action("first")] });
  try {
    for (let index = 0; index < 100; index++) assertExecutionAction(lease.policy, "query_resource", {});
    expect(lease.policy.effects_started).toBe(0);
    assertExecutionAction(lease.policy, "edit_file", action("first").arguments);
    expect(lease.policy.effects_started).toBe(1);
  } finally { lease.close(); }
});
