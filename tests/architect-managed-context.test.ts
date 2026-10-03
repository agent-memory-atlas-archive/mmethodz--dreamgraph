/** Real offline HTTP/MCP and actual native adapter. Model/scan answers are declared fixture oracles. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createServer, type IncomingMessage } from "node:http";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { installOfflineAdmissionFixtures } from "./helpers/offline-admission.js";
import { config } from "../src/config/config.js";
import { getDataDir, setDataDirOverride } from "../src/utils/paths.js";
import { releaseGraphWriter } from "../src/graph/writer-lease.js";
import { commitGraphWrites } from "../src/graph/publication.js";
import { managedSourceEffect, readChangeObligations, prepareChangeReconciliation } from "../src/graph/change-obligations.js";
import { withSessionContext } from "../src/server/session-context.js";
import { DaemonHttpAuthority } from "../src/server/http-authority.js";
import { invokeToolBoundary } from "../src/server/tool-boundary.js";
import { runArchitectNativeToolLoop } from "../src/architect/native-tool-loop.js";
import { readHostExecution, approveHostExecution } from "../src/server/managed-execution.js";
import { readManagedContext } from "../src/graph/execution-context.js";

installOfflineAdmissionFixtures({ directory: false });
let root: string, previous: string, repos: Record<string, string>;
beforeEach(async () => {
  previous = getDataDir(); repos = { ...config.repos }; root = await mkdtemp(join(tmpdir(), "dg-native-managed-"));
  setDataDirOverride(join(root, "data")); config.repos = { fixture: root };
  await writeFile(join(root, "source.ts"), "export const initial = true;\n");
  await commitGraphWrites({ actor: "fixture", scope: ["features.json"], writes: [{ file: "features.json", content: JSON.stringify({ features: [
    { id: "source-context", name: "Execution context", description: "Initial source boundary", source_repo: "fixture", source_files: ["source.ts"] },
  ] }) }] });
});
afterEach(async () => { vi.restoreAllMocks(); await releaseGraphWriter(join(root, "data")); setDataDirOverride(previous); config.repos = repos; await rm(root, { recursive: true, force: true }); });

it("native API delivers current whole evidence, performs exact governed source/graph effects, refreshes, and closes with its durable receipt", async () => {
  const authority = new DaemonHttpAuthority(1, {}), operator = await authority.sessions.create("local-machine");
  const requests: Array<Record<string, any>> = [], connections: Array<{ server: Server; transport: StreamableHTTPServerTransport }> = [];
  const edit = { filePath: "source.ts", text: "export const changed = true;\n" }, scan = { mode: "incremental" };
  const shapes = { query_resource: {}, query_architecture_decisions: {}, edit_file: { filePath: z.string(), text: z.string() }, scan_project: { mode: z.enum(["full", "incremental"]) } };
  const body = async (req: IncomingMessage) => { const parts: Buffer[] = []; for await (const chunk of req) parts.push(Buffer.from(chunk)); return JSON.parse(Buffer.concat(parts).toString("utf8")); };
  const http = createServer(async (req, res) => {
    if (req.url === "/v1/chat/completions") {
      requests.push(await body(req));
      const calls = requests.length === 1 ? ["query_resource", "query_architecture_decisions", "edit_file"] : requests.length === 2 ? ["scan_project"] : [];
      res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ model: "gpt-4.1", usage: { prompt_tokens: 100, completion_tokens: 10 }, choices: [{
        finish_reason: calls.length ? "tool_calls" : "stop", message: { content: calls.length ? null : 'Source reconciled.\n```architect_continuation\n{"schema":"dreamgraph.architect.continuation.v1","status":"completed"}\n```',
          tool_calls: calls.map((name, index) => ({ id: `call-${requests.length}-${index}`, type: "function", function: { name, arguments: JSON.stringify(name === "edit_file" ? edit : name === "scan_project" ? scan : {}) } })) },
      }] })); return;
    }
    const owner = await authority.authorize(req, res); if (!owner) return;
    await withSessionContext(owner, async () => {
      const known = connections.find(connection => connection.transport.sessionId === req.headers["mcp-session-id"]);
      if (known) { await known.transport.handleRequest(req, res); return; }
      const server = new Server({ name: "declared-offline-source-owners", version: "1" }, { capabilities: { tools: {} } });
      server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: Object.entries(shapes).map(([name, shape]) => ({ name, inputSchema: { type: "object" as const,
        properties: Object.fromEntries(Object.keys(shape).map(key => [key, { type: "string" }])), required: Object.keys(shape), additionalProperties: false } })) }));
      server.setRequestHandler(CallToolRequestSchema, async call => invokeToolBoundary({ name: call.params.name, shape: shapes[call.params.name as keyof typeof shapes], args: call.params.arguments,
        handler: async () => {
          if (call.params.name === "edit_file") {
            const obligation = await managedSourceEffect({ changes: [{ file: join(root, "source.ts"), content: edit.text }], apply: () => writeFile(join(root, "source.ts"), edit.text) });
            return { content: [{ type: "text", text: JSON.stringify({ obligation }) }] };
          }
          if (call.params.name === "scan_project") {
            const obligations = (await readChangeObligations()).entries;
            const writes = await prepareChangeReconciliation(obligations.map(item => item.id), "offline-source-repair");
            const result = await commitGraphWrites({ actor: "declared-fixture-reconciliation", operation_id: "offline-source-repair", scope: ["source:fixture/source.ts"], writes: [...writes,
              { file: "features.json", content: JSON.stringify({ features: [{ id: "source-context", name: "Execution context", description: "Reconciled source boundary", source_repo: "fixture", source_files: ["source.ts"] }] }) }],
              source_reconciliation: { revision: "fixture-reconciled", scope: ["source:fixture/source.ts"], full: false } });
            return { content: [{ type: "text", text: JSON.stringify(result.receipt) }] };
          }
          return { content: [{ type: "text", text: "Literal source fixture evidence; no independent model/task usefulness claim." }] };
        } }));
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID }); connections.push({ server, transport }); await server.connect(transport); await transport.handleRequest(req, res);
    });
  });
  await new Promise<void>(done => http.listen(0, "127.0.0.1", done)); const port = (http.address() as { port: number }).port;
  try {
    const result = await withSessionContext(operator.context, () => runArchitectNativeToolLoop({ req: { headers: { host: `127.0.0.1:${port}` } } as IncomingMessage,
      config: { component: "architect", provider: "openai", model: "gpt-4.1", api: "chat-completions", apiKey: "offline-fixture", baseUrl: `http://127.0.0.1:${port}/v1`, temperature: .2, maxTokens: 100, timeoutMs: 30000, providerSource: "architect", modelSource: "architect" },
      provider: { name: "fixture", isAvailable: async () => true, complete: async () => { throw new Error("UNEXPECTED_PLAIN_COMPLETION"); } },
      messages: [{ role: "user", content: "Inspect Execution context" }], userMessage: "Inspect Execution context", executionId: "native:offline:execution", autonomyMode: "supervised", verbosityMode: "concise",
      toolManifest: { required_tools: ["query_resource", "query_architecture_decisions", "edit_file", "scan_project"], preferred_tools: [] },
      approvedActions: [{ tool: "edit_file", arguments: edit, scope_id: "fixture", calls: 1 }, { tool: "scan_project", arguments: scan, scope_id: "fixture", calls: 1 }],
    }));
    expect(requests).toHaveLength(3);
    const contextAt = (index: number) => requests[index].messages.find((message: any) => message.role === "system" && message.content.startsWith("DreamGraph required execution context.")).content;
    expect(contextAt(0)).toContain("Initial source boundary"); expect(contextAt(1)).toContain("SOURCE_RECONCILIATION_PENDING");
    expect(contextAt(2)).toContain("Reconciled source boundary"); expect(contextAt(2)).not.toContain("SOURCE_RECONCILIATION_PENDING");
    expect(result.graph_execution).toMatchObject({ status: "graph_committed", pack: { receipt: { delivery: "delivered" } } });
    expect(result.graph_execution?.effects.flatMap(effect => effect.receipt_ids)).toEqual(["offline-source-repair"]);
    expect(result.route.effective_controls).toMatchObject({ effective: { autonomy: "supervised", verbosity: "concise" }, support: "enforced" });
    expect(await withSessionContext(operator.context,()=>readHostExecution("native:offline:execution"))).toMatchObject({status:"graph_committed",authority_active:false});
    expect(await readFile(join(root, "source.ts"), "utf8")).toBe(edit.text);
  } finally { for (const connection of connections) await connection.server.close(); http.closeAllConnections(); await new Promise<void>(done => http.close(() => done())); }
}, 30000);

it("the actual native API pass shares original-host review and reports remaining controls before revocation",async()=>{
 const authority=new DaemonHttpAuthority(1,{}),operator=await authority.sessions.create("local-machine");
 const result=await withSessionContext(operator.context,()=>runArchitectNativeToolLoop({req:{headers:{}} as IncomingMessage,
  config:{component:"architect",provider:"none",model:"fixture",temperature:.2,maxTokens:100,timeoutMs:10000,providerSource:"architect",modelSource:"architect"},
  messages:[{role:"user",content:"Inspect Execution context"}],userMessage:"Inspect Execution context",executionId:"native-host-review",
  provider:{name:"declared-offline-callback",isAvailable:async()=>true,complete:async()=>{
   await withSessionContext(operator.context,async()=>{
    const checkpoint=await readHostExecution("native-host-review");expect(checkpoint.authority_active).toBe(true);
    expect(checkpoint.pack.receipt.delivery).toBe("delivered");
    await approveHostExecution({execution_id:checkpoint.execution_id,approval_id:"native-reviewed-call",expected_record_revision:checkpoint.record_revision,
     context_receipt_id:checkpoint.pack.receipt.id,approved_actions:[{tool:"edit_file",arguments:{filePath:"source.ts",text:"export const initial = true;\n"},scope_id:"fixture",calls:1}]});
   });
   return {text:"Inspected; no mutation performed.",model:"fixture"};
  }},
 }));
 expect(result.route.effective_controls).toMatchObject({approved_effects:1});
 expect(result.graph_execution).toMatchObject({status:"no_change",approval_reviews:[{id:"native-reviewed-call"}]});
 expect(await withSessionContext(operator.context,()=>readHostExecution("native-host-review"))).toMatchObject({authority_active:false});
});

it("native API late completion after cancellation closes with termination uncertainty",async()=>{
 const authority=new DaemonHttpAuthority(1,{}),operator=await authority.sessions.create("local-machine"),controller=new AbortController();
 let observed:AbortSignal|undefined;
 await expect(withSessionContext(operator.context,()=>runArchitectNativeToolLoop({req:{headers:{}} as IncomingMessage,
  config:{component:"architect",provider:"none",model:"fixture",temperature:.2,maxTokens:100,timeoutMs:10000,providerSource:"architect",modelSource:"architect"},
  messages:[{role:"user",content:"Inspect Execution context"}],userMessage:"Inspect Execution context",executionId:"native-late-cancel",signal:controller.signal,
  provider:{name:"declared-noncooperative-callback",isAvailable:async()=>true,complete:async(_messages,options)=>{
   observed=options?.signal;controller.abort(new Error("operator cancellation"));
   return {text:"Late callback result; termination unconfirmed.",model:"fixture"};
  }},
 }))).rejects.toThrow("operator cancellation");
 expect(observed?.aborted).toBe(true);
 const closed=await withSessionContext(operator.context,()=>readManagedContext("native-late-cancel"));
 expect(closed).toMatchObject({status:"recovery_required",effects:[{tool:"host_adapter_termination",outcome:"unknown"}]});
 expect(await withSessionContext(operator.context,()=>readHostExecution("native-late-cancel"))).toMatchObject({authority_active:false});
});
