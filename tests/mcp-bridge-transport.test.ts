/** Real stdio bridge process, paged upstream and cancellation; no provider/CLI inference. */

import { it, expect } from "vitest";
import { resolveArchitectCliBridgeToolNames } from "../src/architect/cli-bridge.js";
import { validateClaudeInit } from "../src/architect/claude-cli-profile.js";
import { createServer } from "node:http";
import { mkdtemp, writeFile, unlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

it("Claude admission rejects pre-init and queued calls after revocation without forwarding them", async () => {
  const root = await mkdtemp(join(tmpdir(), "dg-bridge-admission-"));
  const gate = join(root, "gate"), token = "a".repeat(64);
  const upstream = new Server({ name: "fixture", version: "1" }, { capabilities: { tools: {} } });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID });
  let calls = 0, release!: () => void;
  const held = new Promise<void>(done => { release = done; });
  upstream.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [{ name: "commit", inputSchema: { type: "object" } }] }));
  upstream.setRequestHandler(CallToolRequestSchema, async () => { calls++; await held; return { content: [{ type: "text", text: "owner receipt" }] }; });
  await upstream.connect(transport);
  const http = createServer(async (req, res) => { try { await transport.handleRequest(req, res); } catch { if (!res.headersSent) res.writeHead(500); res.end(); } });
  await new Promise<void>(done => http.listen(0, "127.0.0.1", done));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("DREAMGRAPH_"))) as Record<string, string>;
  Object.assign(env, { DREAMGRAPH_HOST_MCP_URL: "http://127.0.0.1:" + (http.address() as { port: number }).port + "/mcp",
    DREAMGRAPH_BRIDGE_ADMISSION_PATH: gate, DREAMGRAPH_BRIDGE_ADMISSION_TOKEN: token, DREAMGRAPH_BRIDGE_DEADLINE_MS: String(Date.now() + 20000) });
  const client = new Client({ name: "gate-fixture", version: "1" });
  const bridge = new StdioClientTransport({ command: process.execPath,
    args: ["--import", pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href, resolve("src/architect/cli-mcp-bridge.ts")],
    cwd: root, env, stderr: "pipe" });
  try {
    await client.connect(bridge);
    expect((await client.listTools()).tools.some(t => t.name === "commit")).toBe(true);
    await expect(client.callTool({ name: "commit", arguments: {} })).rejects.toThrow("CLI_ADMISSION_NOT_READY");
    expect(calls).toBe(0);
    await writeFile(gate, token);
    const first = client.callTool({ name: "commit", arguments: {} });
    for (let i = 0; !calls && i < 100; i++) await new Promise(done => setTimeout(done, 10));
    expect(calls).toBe(1);
    const second = client.callTool({ name: "commit", arguments: {} });
    const rejected = expect(second).rejects.toThrow("CLI_ADMISSION_NOT_READY");
    await unlink(gate); release();
    expect((await first).content).toEqual([{ type: "text", text: "owner receipt" }]);
    await rejected; expect(calls).toBe(1);
  } finally {
    release(); await client.close(); await upstream.close(); http.closeAllConnections();
    await new Promise<void>(done => http.close(() => done())); await rm(root, { recursive: true, force: true });
  }
}, 20000);

it.each(["codex-cli","claude-cli"])("%s reads retain literal results without context refresh; failed effect refresh still closes dispatch",async adapter=>{
 const root=await mkdtemp(join(tmpdir(),"dg-bridge-context-failure-")),upstream=new Server({name:"fixture",version:"1"},{capabilities:{tools:{}}});
 const transport=new StreamableHTTPServerTransport({sessionIdGenerator:randomUUID});let calls=0,refreshes=0,recovered=false;
 upstream.setRequestHandler(ListToolsRequestSchema,()=>({tools:[{name:"commit",inputSchema:{type:"object"}}]}));
 upstream.setRequestHandler(CallToolRequestSchema,()=>{calls++;return {content:[{type:"text",text:"literal committed result"}],structuredContent:{receipt:{operation_id:"original-commit",revision:7}},_meta:{owner:"fixture"}};});
 await upstream.connect(transport);
 const http=createServer(async(req,res)=>{
  if(req.url?.endsWith('/context/deliver')){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({receipt_id:'refreshed',delivery:'delivered'}));return;}
  if(req.url?.endsWith('/context/refresh')){refreshes++;res.writeHead(recovered?200:503,{'Content-Type':'application/json'});res.end(JSON.stringify(recovered?{receipt_id:'refreshed',block:'Current graph evidence',delivery:'unattested'}:{error:'fixture-context-unavailable'}));return;}
  try{await transport.handleRequest(req,res);}catch{if(!res.headersSent)res.writeHead(500);res.end();}});
 await new Promise<void>(done=>http.listen(0,'127.0.0.1',done));
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('DREAMGRAPH_'))) as Record<string,string>;
 Object.assign(env,{DREAMGRAPH_HOST_MCP_URL:`http://127.0.0.1:${(http.address() as {port:number}).port}/mcp`,DREAMGRAPH_BRIDGE_SESSION_BEARER:'dgexec.fixture'});
 if(adapter==="claude-cli"){
  const gate=join(root,"admitted"),token="a".repeat(64);await writeFile(gate,token);
  Object.assign(env,{DREAMGRAPH_BRIDGE_ADMISSION_PATH:gate,DREAMGRAPH_BRIDGE_ADMISSION_TOKEN:token,DREAMGRAPH_BRIDGE_DEADLINE_MS:String(Date.now()+20000)});
 }
 const client=new Client({name:'fixture-client',version:'1'}),bridge=new StdioClientTransport({command:process.execPath,args:['--import',pathToFileURL(resolve('node_modules/tsx/dist/loader.mjs')).href,resolve('src/architect/cli-mcp-bridge.ts')],cwd:root,env,stderr:'pipe'});
 try{await client.connect(bridge);
  const advertised=(await client.listTools()).tools.map(tool=>tool.name);
  const expected=resolveArchitectCliBridgeToolNames(["commit"],{managedContext:true});
  expect(advertised).toEqual(expected);
  const init={type:"system",subtype:"init",permissionMode:"dontAsk",claude_code_version:"2.1.293",
    model:"claude-opus-5-5",session_id:"fixture",mcp_servers:[{name:"dreamgraph",status:"connected"}],
    tools:advertised.map(name=>"mcp__dreamgraph__"+name),plugins:[],skills:[],agents:[]};
  expect(validateClaudeInit(init,{version:"2.1.293",model:init.model,tools:expected})).toBe("fixture");
  expect(()=>validateClaudeInit({...init,tools:[...init.tools,"Bash"]},{version:"2.1.293",model:init.model,tools:expected})).toThrow("CLAUDE_INIT_TOOL_MISMATCH");
  for(const name of ["search_source_code","read_source_code"]){
   const read=await client.callTool({name,arguments:{}});
   expect(read.isError).not.toBe(true);
   expect(read.content).toEqual([{type:"text",text:"literal committed result"}]);
   expect(read.structuredContent).toEqual({receipt:{operation_id:"original-commit",revision:7}});
  }
  expect(refreshes).toBe(0);expect(calls).toBe(2);
  const result=await client.callTool({name:'commit',arguments:{}});
  expect(result.isError).toBe(true);expect(result.structuredContent).toEqual({receipt:{operation_id:'original-commit',revision:7}});
  expect(result.content).toContainEqual({type:'text',text:'literal committed result'});expect(JSON.stringify(result.content)).toContain('CLI_CONTEXT_REFRESH_FAILED');
  await expect(client.callTool({name:'commit',arguments:{}})).rejects.toThrow('CLI_CONTEXT_RECOVERY_REQUIRED');expect(calls).toBe(3);expect(refreshes).toBe(1);
  expect((await client.callTool({name:'read_source_code',arguments:{}})).isError).not.toBe(true);expect(calls).toBe(4);
  recovered=true;
  const recovery=await client.callTool({name:'refresh_execution_context',arguments:{}});
  expect(recovery.isError).not.toBe(true);expect(recovery.content).toContainEqual({type:'text',text:'Current graph evidence'});
  expect((await client.callTool({name:'commit',arguments:{}})).isError).not.toBe(true);
  expect(calls).toBe(5);expect(refreshes).toBe(3);
 }finally{await client.close();await transport.close();await upstream.close();http.closeAllConnections();await new Promise<void>(done=>http.close(()=>done()));await rm(root,{recursive:true,force:true});}
});

it("retains page cursors, structured/meta/media, one session, scoped bearer and abort forwarding", async () => {
  const root = await mkdtemp(join(tmpdir(), "dg-real-bridge-"));
  const upstream = new Server({ name: "fixture-upstream", version: "1" }, { capabilities: { tools: {} } });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID });
  let calls = 0, cancelled = false, initializations = 0;
  const tool = (name: string) => ({ name, inputSchema: { type: "object" as const }, _meta: { marker: name } });
  upstream.setRequestHandler(ListToolsRequestSchema, async req => req.params?.cursor === "second"
    ? { tools: [tool("beta")] } : { tools: [tool("alpha")], nextCursor: "second" });
  const literal = { content: [{ type: "text" as const, text: "original" }, { type: "image" as const, mimeType: "image/png", data: "AA==" }],
    structuredContent: { complete: false, continuation: "next", receipt: { operation_id: "owned", revision: 3 } }, _meta: { owner: "fixture", retained: true } };
  upstream.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
    calls++;
    if (req.params.name === "wait") {
      await new Promise<void>(done => { extra.signal.addEventListener("abort", () => { cancelled = true; done(); }, { once: true }); });
    }
    return literal;
  });
  await upstream.connect(transport);
  const http = createServer(async (req, res) => {
    if (req.headers["x-dreamgraph-session"] !== "fixture-bearer") { res.writeHead(403); res.end(); return; }
    if (req.method === "POST" && !req.headers["mcp-session-id"]) initializations++;
    try { await transport.handleRequest(req, res); } catch { if (!res.headersSent) res.writeHead(500); res.end(); }
  });
  await new Promise<void>(done => http.listen(0, "127.0.0.1", done));
  const port = (http.address() as { port: number }).port;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("DREAMGRAPH_"))) as Record<string, string>;
  Object.assign(env, { DREAMGRAPH_HOST_MCP_URL: `http://127.0.0.1:${port}/mcp`, DREAMGRAPH_BRIDGE_SESSION_BEARER: "fixture-bearer" });
  const client = new Client({ name: "bridge-fixture", version: "1" });
  const bridge = new StdioClientTransport({ command: process.execPath, args: ["--import", pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href, resolve("src/architect/cli-mcp-bridge.ts")], cwd: root, env, stderr: "pipe" });
  try {
    await client.connect(bridge);
    const first = await client.listTools(), second = await client.listTools({ cursor: first.nextCursor });
    expect(first.tools.map(t => t.name)).toEqual(["alpha"]); expect(first.nextCursor).toBe("second");
    expect(second.tools.map(t => t.name)).toEqual(["beta", "run_command"]); expect(second.tools[0]._meta).toEqual({ marker: "beta" });
    expect(await client.callTool({ name: "alpha", arguments: {} })).toEqual(literal);
    expect(await client.callTool({ name: "beta", arguments: {} })).toEqual(literal);
    const abort = new AbortController();
    const wait = client.callTool({ name: "wait", arguments: {} }, undefined, { signal: abort.signal });
    for (let i = 0; calls < 3 && i < 100; i++) await new Promise(done => setTimeout(done, 10));
    abort.abort(); await expect(wait).rejects.toThrow();
    for (let i = 0; !cancelled && i < 100; i++) await new Promise(done => setTimeout(done, 10));
    expect(cancelled).toBe(true); expect(initializations).toBe(1);
  } finally {
    await client.close(); await upstream.close(); http.closeAllConnections();
    await new Promise<void>(done => http.close(() => done())); await rm(root, { recursive: true, force: true });
  }
}, 20000);

it.each([false, true])("Computer Use ask request is a capability request only; requestable=%s", async requestable => {
  const root = await mkdtemp(join(tmpdir(), "dg-bridge-cu-policy-"));
  const upstream = new Server({ name: "fixture", version: "1" }, { capabilities: { tools: {} } });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID });
  let calls = 0;
  upstream.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [] }));
  upstream.setRequestHandler(CallToolRequestSchema, () => { calls++; return { content: [] }; });
  await upstream.connect(transport);
  const http = createServer(async (req, res) => {
    try { await transport.handleRequest(req, res); } catch { if (!res.headersSent) res.writeHead(500); res.end(); }
  });
  await new Promise<void>(done => http.listen(0, "127.0.0.1", done));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("DREAMGRAPH_"))) as Record<string, string>;
  Object.assign(env, { DREAMGRAPH_HOST_MCP_URL: "http://127.0.0.1:" + (http.address() as { port: number }).port + "/mcp",
    DREAMGRAPH_BRIDGE_COMPUTER_USE_REQUESTABLE: requestable ? "1" : "0" });
  const client = new Client({ name: "grant-fixture", version: "1" });
  const bridge = new StdioClientTransport({ command: process.execPath,
    args: ["--import", pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href, resolve("src/architect/cli-mcp-bridge.ts")],
    cwd: root, env, stderr: "pipe" });
  try {
    await client.connect(bridge);
    expect((await client.listTools()).tools.some(t => t.name === "request_computer_use")).toBe(requestable);
    if (requestable) {
      const result = await client.callTool({ name: "request_computer_use", arguments: { reason: "Save the fixture" } });
      expect(JSON.stringify(result)).toContain("Do not attempt Computer Use now");
    } else {
      await expect(client.callTool({ name: "request_computer_use", arguments: { reason: "Invented approval" } }))
        .rejects.toThrow("COMPUTER_USE_REQUEST_NOT_ALLOWED");
    }
    expect(calls).toBe(0);
  } finally {
    await client.close(); await upstream.close(); http.closeAllConnections();
    await new Promise<void>(done => http.close(() => done())); await rm(root, { recursive: true, force: true });
  }
}, 20000);
