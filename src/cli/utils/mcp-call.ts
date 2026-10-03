/** Single-call CLI compatibility helpers; Architect uses one persistent pass connection. */
import { McpSessionConnection, type McpConnectionOptions, type McpCallResult, type McpCallProgress } from "./mcp-session.js";
export { McpSessionConnection, architectMcpHeaders, listAllMcpTools } from "./mcp-session.js";
export type { McpCallResult, McpCallProgress, McpConnectionOptions } from "./mcp-session.js";
export async function mcpCallTool(port: number, tool: string, args: Record<string, unknown> = {}, timeoutMs = 300_000,
  onProgress?: (progress: McpCallProgress) => void, options?: McpConnectionOptions): Promise<McpCallResult> {
  const connection = await new McpSessionConnection(port, options).connect();
  try { return await connection.callTool(tool, args, timeoutMs, onProgress); } finally { await connection.close(); }
}
export async function mcpListTools(port: number, options?: McpConnectionOptions) {
  const connection = await new McpSessionConnection(port, options).connect();
  try { return await connection.listTools(); } finally { await connection.close(); }
}
