/** One owned connection per Architect pass; no uncertain mutation retries. */
import type { IncomingMessage } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult, ContentBlock, Tool } from "@modelcontextprotocol/sdk/types.js";
import { CLI_VERSION } from "../version.js";
import { authenticatedSessionBearer } from "../../server/session-bearer.js";
export type McpCallResult = Omit<CallToolResult, "content"> & { content: Array<ContentBlock & { text?: string }> };
export interface McpCallProgress { progress: number; total?: number; message?: string; }
export interface McpConnectionOptions { headers?: Record<string, string>; signal?: AbortSignal; }
/** Forward only the authenticated daemon bearer, never arbitrary headers. */
export function architectMcpHeaders(req: IncomingMessage): Record<string, string> {
  const header = req.headers["x-dreamgraph-session"];
  const token = authenticatedSessionBearer(req) ?? (typeof header === "string" ? header : undefined);
  return token ? { "X-DreamGraph-Session": token } : {};
}
/** Bounded discovery retains annotations, schemas and metadata on every page. */
export async function listAllMcpTools(client: Pick<Client, "listTools">, signal?: AbortSignal): Promise<Tool[]> {
  const tools: Tool[] = [], names = new Set<string>(), cursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 256; page++) {
    signal?.throwIfAborted();
    const result = await client.listTools(cursor ? { cursor } : undefined, { signal });
    for (const tool of result.tools) {
      if (names.has(tool.name)) throw new Error("MCP_DISCOVERY_DUPLICATE_TOOL");
      names.add(tool.name); tools.push(tool);
      if (tools.length > 4096) throw new Error("MCP_DISCOVERY_TOOL_LIMIT");
    }
    if (!result.nextCursor) return tools;
    if (cursors.has(result.nextCursor)) throw new Error("MCP_DISCOVERY_CURSOR_CYCLE");
    cursors.add(result.nextCursor); cursor = result.nextCursor;
  }
  throw new Error("MCP_DISCOVERY_PAGE_LIMIT");
}
export class McpSessionConnection {
  private readonly client = new Client({ name: "dreamgraph-cli", version: CLI_VERSION });
  private readonly transport: StreamableHTTPClientTransport;
  private closed = false;
  constructor(port: number, private readonly options: McpConnectionOptions = {}) {
    this.transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), { requestInit: { headers: options.headers ?? {} } });
  }
  async connect(): Promise<this> {
    this.options.signal?.throwIfAborted();
    try { await this.client.connect(this.transport, { signal: this.options.signal }); return this; }
    catch (error) { await this.close(); throw error; }
  }
  listTools(): Promise<Tool[]> { this.assertOpen(); return listAllMcpTools(this.client, this.options.signal); }
  async callTool(tool: string, args: Record<string, unknown> = {}, timeoutMs = 300_000,
    onProgress?: (progress: McpCallProgress) => void): Promise<McpCallResult> {
    this.assertOpen(); this.options.signal?.throwIfAborted();
    return await this.client.callTool({ name: tool, arguments: args, _meta: { dreamgraph: { contract_version: 1 } } }, undefined, {
      timeout: timeoutMs, resetTimeoutOnProgress: true, signal: this.options.signal,
      onprogress: progress => onProgress?.(progress as McpCallProgress),
    }) as McpCallResult;
  }
  private assertOpen() { if (this.closed) throw new Error("MCP_CONNECTION_CLOSED"); }
  async close(): Promise<void> {
    if (this.closed) return; this.closed = true;
    try { if (this.transport.sessionId) await this.transport.terminateSession(); } catch { /* Closing is not rollback. */ }
    try { await this.client.close(); } catch { /* Transport may already be closed. */ }
  }
}
