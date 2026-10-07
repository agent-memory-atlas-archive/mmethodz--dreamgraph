/** Actual entry-point process; all data is disposable and inference is disabled. */
import { it, expect,vi } from "vitest";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { McpSessionConnection } from "../src/cli/utils/mcp-session.js";
import { ManagedExecutionClient } from "../packages/sdk/src/seams/graph-execution.js";
import { BROWSER_TOOL_NAMES } from "../src/computer/browser-bridge/tools.js";
const textResult = (result: any) => JSON.parse(result.content.find((item: any) => item.type === "text").text);
it("isolates real native MCP transports, rejects foreign browser binding and removes closed sessions", async () => {
  const root = await mkdtemp(join(tmpdir(), "dg-real-transport-"));
  const reservation = createServer(); await new Promise<void>(done => reservation.listen(0, "127.0.0.1", done));
  const port = (reservation.address() as { port: number }).port; await new Promise<void>(done => reservation.close(() => done()));
  const base = `http://127.0.0.1:${port}`;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("DREAMGRAPH_") && key !== "DATABASE_URL"));
  Object.assign(env, { DREAMGRAPH_DATA_DIR: root, DREAMGRAPH_LLM_PROVIDER: "none", DREAMGRAPH_SCHEDULER: '{"enabled":false}', DREAMGRAPH_REPOS: JSON.stringify({ fixture: root }) });
  const child = spawn(process.execPath, ["--import", pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href, resolve("src/index.ts"), "--transport", "http", "--port", String(port)], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = ""; child.stderr!.on("data", chunk => { stderr = (stderr + chunk).slice(-12000); });
  const clients: Client[] = [];
  try {
    await new Promise<void>((done, reject) => {
      const timer = setTimeout(() => reject(new Error(`daemon startup timeout: ${stderr}`)), 12000);
      child.stderr!.on("data", chunk => { if (String(chunk).includes("Server running on")) { clearTimeout(timer); done(); } });
      child.once("exit", code => { clearTimeout(timer); reject(new Error(`daemon exited ${code}: ${stderr}`)); });
      child.once("error", reject);
    });
    // Actual entry-point liveness must not consume the 512 durable identities.
    const authorityBefore=await readFile(join(root,"session_authority.json"),"utf8").catch(error=>{if(error.code==="ENOENT")return null;throw error;});
    const publicationBefore=await readFile(join(root,"publication_state.json"),"utf8").catch(error=>{if(error.code==="ENOENT")return null;throw error;});
    for(let batch=0;batch<33;batch++)await Promise.all(Array.from({length:16},async()=>{const response=await fetch(base+"/health");expect(response.status).toBe(200);
      expect(response.headers.get("set-cookie")).toBeNull();expect(response.headers.get("x-dreamgraph-session")).toBeNull();expect((await response.json()).status).toBe("ok");}));
    expect(await readFile(join(root,"session_authority.json"),"utf8").catch(error=>{if(error.code==="ENOENT")return null;throw error;})).toBe(authorityBefore);
    expect(await readFile(join(root,"publication_state.json"),"utf8").catch(error=>{if(error.code==="ENOENT")return null;throw error;})).toBe(publicationBefore);
    const open = async (browserToken?: string) => {
      const transport = new StreamableHTTPClientTransport(new URL(base + "/mcp"), { requestInit: { headers: browserToken ? { "X-DreamGraph-Session": browserToken } : {} } });
      const client = new Client({ name: "fixture", version: "1" }); clients.push(client); await client.connect(transport); return { client, transport };
    };
    const [a, b] = await Promise.all([open(), open()]);
    const catalog = await (await fetch(base + "/api/contracts/v1/mcp")).json();
    const advertised = await a.client.listTools();
    // The core catalogue plus DreamGraph's Computer Use browser tools (outside the discipline catalogue; governed by an
    // execution's Computer Use grant, effect computer_use).
    const computerUse = advertised.tools.filter(t => (t._meta?.dreamgraph as any)?.policy?.effect === "computer_use").map(t => t.name).sort();
    expect(computerUse).toEqual([...BROWSER_TOOL_NAMES].sort());
    expect(advertised.tools.map(t => t.name).filter(name => !computerUse.includes(name)).sort()).toEqual(catalog.tools.map((t: any) => t.name).sort());
    expect(advertised.tools.every(t => t._meta?.dreamgraph)).toBe(true);
    const invalid = await a.client.callTool({ name: "graph_health_report", arguments: { __undeclared: true } });
    expect(invalid.structuredContent?.error).toMatchObject({ code: "INVALID_INPUT" });
    const incompatible = await a.client.callTool({ name: "graph_health_report", arguments: {}, _meta: { dreamgraph: { contract_version: 999 } } });
    expect(incompatible.structuredContent?.error).toMatchObject({ code: "CONTRACT_VERSION_UNSUPPORTED" });
    const write = await a.client.callTool({ name: "create_file", arguments: { repo: "fixture", filePath: "effect.txt", content: "bounded physical effect" } });
    expect(write.isError).not.toBe(true); expect(await readFile(join(root, "effect.txt"), "utf8")).toBe("bounded physical effect");
    expect(write.structuredContent).toEqual(textResult(write));
    const lucid=await open();
    const exploration=await lucid.client.callTool({name:"lucid_dream",arguments:{hypothesis:"Explore source ownership and architectural responsibilities"}});
    expect(exploration.isError).not.toBe(true);
    expect(JSON.parse(await readFile(join(root,"lucid_log.json"),"utf8")).active).toBeTruthy();
    const exported=await (await fetch(base+"/api/analytics/v1/snapshot")).json();expect(exported,JSON.stringify(exported)).toHaveProperty("schema","dreamgraph.analytics_export.v1");expect(exported.derived).toBe(true);
    await lucid.transport.terminateSession();
    await vi.waitFor(async()=>{const log=JSON.parse(await readFile(join(root,"lucid_log.json"),"utf8"));expect(log.active).toBeNull();expect(log.sessions[0].termination).toBe("cancelled");const jobs=JSON.parse(await readFile(join(root,"jobs.json"),"utf8"));expect(jobs.records.filter((r:any)=>r.action==="lucid_session").every((r:any)=>r.work_settled&&r.lease===null)).toBe(true);},{timeout:5000});
    const sessions = await Promise.all([a, b].map(({ client }, i) => client.callTool({ name: "discipline_start_session", arguments: { type: "audit", description: `private-${i}`, target_scope: [root] } }).then(textResult)));
    expect(sessions.every(session => session.success)).toBe(true); expect(sessions[0].session_id).not.toBe(sessions[1].session_id);
    const states = await Promise.all([a, b].map(({ client }) => client.callTool({ name: "discipline_get_session", arguments: {} }).then(textResult)));
    expect(JSON.stringify(states[0])).not.toContain(sessions[1].session_id); expect(JSON.stringify(states[1])).not.toContain(sessions[0].session_id);
    const unknown = await fetch(base + "/mcp", { method: "DELETE", headers: { "mcp-session-id": "forged", Accept: "application/json, text/event-stream" } }); expect(unknown.status).toBe(404);
    const browser = async () => (await fetch(base + "/api/authority/v1/status")).headers.get("X-DreamGraph-Session")!;
    const [first, other] = await Promise.all([browser(), browser()]); const bound = await open(first);
    const pass = await new McpSessionConnection(port, { headers: { "X-DreamGraph-Session": first } }).connect();
    try {
      const started = await pass.callTool("discipline_start_session", { type: "audit", description: "browser-owned-pass", target_scope: [root] });
      expect(started.structuredContent?.success).toBe(true);
      expect(JSON.stringify(await pass.callTool("discipline_get_session"))).toContain(started.structuredContent?.session_id);
      expect(JSON.stringify(await bound.client.callTool({ name: "discipline_get_session", arguments: {} }))).toContain(started.structuredContent?.session_id);
    } finally { await pass.close(); }
    const secondPass = await new McpSessionConnection(port, { headers: { "X-DreamGraph-Session": first } }).connect();
    try { expect(JSON.stringify(await secondPass.callTool("discipline_get_session"))).toContain("browser-owned-pass"); } finally { await secondPass.close(); }
    expect((await fetch(base + "/mcp", { method: "DELETE", headers: { "mcp-session-id": bound.transport.sessionId!, "X-DreamGraph-Session": other } })).status).toBe(403);
    await bound.transport.terminateSession(); await a.transport.terminateSession(); await b.transport.terminateSession();
    expect((await (await fetch(base + "/health")).json()).sessions).toBe(0);
  } finally {
    await Promise.allSettled(clients.map(client => client.close()));
    if (child.exitCode === null && child.signalCode === null) { const exited = once(child, "exit"); child.kill("SIGKILL"); await exited; }
    await rm(root, { recursive: true, force: true });
  }
}, 25000);
it("carries its stdio stream owner through tools and resources", async () => {
  const root = await mkdtemp(join(tmpdir(), "dg-real-stdio-"));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("DREAMGRAPH_") && key !== "DATABASE_URL")) as Record<string, string>;
  Object.assign(env, { DREAMGRAPH_DATA_DIR: root, DREAMGRAPH_LLM_PROVIDER: "none", DREAMGRAPH_SCHEDULER: '{"enabled":false}', DREAMGRAPH_REPOS: '{}' });
  const transport = new StdioClientTransport({ command: process.execPath, args: ["--import", pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href, resolve("src/index.ts")],
    cwd: root, env, stderr: "pipe" });
  const client = new Client({ name: "stdio-fixture", version: "1" });
  try {
    await client.connect(transport);
    const session = textResult(await client.callTool({ name: "discipline_start_session", arguments: { type: "audit", description: "private-stdio", target_scope: [root] } }));
    expect(session.success).toBe(true);
    expect(JSON.stringify(textResult(await client.callTool({ name: "discipline_get_session", arguments: {} })))).toContain(session.session_id);
    const resource = await client.readResource({ uri: "discipline://manifest" }); expect(resource.contents[0].mimeType).toBe("application/json");
    expect(() => JSON.parse(String(resource.contents[0].text))).not.toThrow();
  } finally { await client.close(); await rm(root, { recursive: true, force: true }); }
}, 20000);

it('the actual daemon admits one exact managed MCP action once, retains source debt and refuses consumed replay',async()=>{
 const root=await mkdtemp(join(tmpdir(),'dg-managed-daemon-')),reservation=createServer();
 await writeFile(join(root,'source.ts'),'original managed source');
 await writeFile(join(root,'features.json'),JSON.stringify({features:[{id:'managed',name:'Managed fixture',description:'Canonical managed source context',source_repo:'fixture',source_files:['source.ts']}]}));
 await new Promise<void>(done=>reservation.listen(0,'127.0.0.1',done));const port=(reservation.address() as {port:number}).port;await new Promise<void>(done=>reservation.close(()=>done()));
 const base=`http://127.0.0.1:${port}`,env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('DREAMGRAPH_')&&key!=='DATABASE_URL'));
 Object.assign(env,{DREAMGRAPH_DATA_DIR:root,DREAMGRAPH_LLM_PROVIDER:'none',DREAMGRAPH_SCHEDULER:'{"enabled":false}',DREAMGRAPH_REPOS:JSON.stringify({fixture:root})});
 const child=spawn(process.execPath,['--import',pathToFileURL(resolve('node_modules/tsx/dist/loader.mjs')).href,resolve('src/index.ts'),'--transport','http','--port',String(port)],{cwd:root,env,stdio:['ignore','pipe','pipe']});
 let stderr='';child.stderr!.on('data',chunk=>{stderr=(stderr+chunk).slice(-12000);});
 const host=new ManagedExecutionClient({baseUrl:base,timeoutMs:15000}),worker=new Client({name:'actual-managed-worker',version:'1'});
 try{
  await new Promise<void>((done,reject)=>{
   // Bound cold source-loader startup independently of the unchanged host request deadline.
   const timer=setTimeout(()=>reject(new Error(`daemon startup timeout: ${stderr}`)),30000);
   child.stderr!.on('data',chunk=>{if(String(chunk).includes('Server running on')){clearTimeout(timer);done();}});
   child.once('exit',code=>{clearTimeout(timer);reject(new Error(`daemon exited ${code}: ${stderr}`));});child.once('error',reject);
  });
  const args={repo:'fixture',filePath:'source.ts',content:'exact managed source'},lease=await host.begin({id:'real-managed-action',adapter:'sdk/native',query:'Managed fixture',approved_actions:[{tool:'create_file',arguments:args,scope_id:'fixture',calls:1}]});
  await host.deliver(lease.workerBearer,lease.execution.pack.receipt.id,lease.execution.block);
  await worker.connect(new StreamableHTTPClientTransport(new URL(base+'/mcp'),{requestInit:{headers:{'X-DreamGraph-Session':lease.workerBearer}}}));
  const result=await worker.callTool({name:'create_file',arguments:args});
  expect(result.isError,JSON.stringify(result)).not.toBe(true);expect(result.structuredContent).toEqual(textResult(result));
  expect(await readFile(join(root,'source.ts'),'utf8')).toBe(args.content);
  const replay=await worker.callTool({name:'create_file',arguments:args});expect(replay.isError).toBe(true);expect(JSON.stringify(replay)).toContain('EXECUTION_POLICY_DENIED');
  expect(await readFile(join(root,'source.ts'),'utf8')).toBe(args.content);
  const closed=await host.finish(lease.execution.execution_id,'completed','confirmed');
  expect(closed).toMatchObject({status:'reconciliation_pending',authority_active:false,obligation_ids:[expect.any(String)]});
  expect(closed.pack.receipt.delivery).toBe('delivered');expect(closed.graph_receipt_ids).toEqual([]);
 }finally{
  await worker.close();host.dispose();if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGKILL');await exited;}
  await rm(root,{recursive:true,force:true});
 }
},65000);
