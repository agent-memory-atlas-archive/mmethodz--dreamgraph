/** Real stdio bridge process, paged upstream and cancellation; no provider/CLI inference. */
import { it, expect } from "vitest";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

it("a failed managed refresh preserves the original committed result and prevents later native CLI dispatch",async()=>{
 const root=await mkdtemp(join(tmpdir(),"dg-bridge-context-failure-")),upstream=new Server({name:"fixture",version:"1"},{capabilities:{tools:{}}});
 const transport=new StreamableHTTPServerTransport({sessionIdGenerator:randomUUID});let calls=0;
 upstream.setRequestHandler(ListToolsRequestSchema,()=>({tools:[{name:"commit",inputSchema:{type:"object"}}]}));
 upstream.setRequestHandler(CallToolRequestSchema,()=>{calls++;return {content:[{type:"text",text:"literal committed result"}],structuredContent:{receipt:{operation_id:"original-commit",revision:7}},_meta:{owner:"fixture"}};});
 await upstream.connect(transport);
 const http=createServer(async(req,res)=>{if(req.url?.endsWith('/context/refresh')){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'fixture-context-unavailable'}));return;}
  try{await transport.handleRequest(req,res);}catch{if(!res.headersSent)res.writeHead(500);res.end();}});
 await new Promise<void>(done=>http.listen(0,'127.0.0.1',done));
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('DREAMGRAPH_'))) as Record<string,string>;
 Object.assign(env,{DREAMGRAPH_HOST_MCP_URL:`http://127.0.0.1:${(http.address() as {port:number}).port}/mcp`,DREAMGRAPH_BRIDGE_SESSION_BEARER:'dgexec.fixture'});
 const client=new Client({name:'fixture-client',version:'1'}),bridge=new StdioClientTransport({command:process.execPath,args:['--import',pathToFileURL(resolve('node_modules/tsx/dist/loader.mjs')).href,resolve('src/architect/cli-mcp-bridge.ts')],cwd:root,env,stderr:'pipe'});
 try{await client.connect(bridge);const result=await client.callTool({name:'commit',arguments:{}});
  expect(result.isError).toBe(true);expect(result.structuredContent).toEqual({receipt:{operation_id:'original-commit',revision:7}});
  expect(result.content).toContainEqual({type:'text',text:'literal committed result'});expect(JSON.stringify(result.content)).toContain('CLI_CONTEXT_REFRESH_FAILED');
  await expect(client.callTool({name:'commit',arguments:{}})).rejects.toThrow('CLI_CONTEXT_RECOVERY_REQUIRED');expect(calls).toBe(1);
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
