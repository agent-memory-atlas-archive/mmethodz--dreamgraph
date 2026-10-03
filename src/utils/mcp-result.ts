/** Shared result serialization; human previews must not replace machine data. */
import { boundMachineResult } from "@dreamgraph/token-economy";
import type { CallToolResult, ContentBlock } from "@modelcontextprotocol/sdk/types.js";
export function serializeMcpResult(result: Pick<CallToolResult, "content" | "isError" | "structuredContent" | "_meta">): string {
  if (result.structuredContent || result._meta || result.isError || result.content.some(item => item.type !== "text")) return JSON.stringify(result);
  return result.content.map(item => (item as Extract<ContentBlock, { type: "text" }>).text).join("\n");
}
/** Over-budget JSON becomes a whole explicit omission, never an invalid fragment. */
export function boundedMachineResult(text: string, maxChars: number): { content: string; originalChars: number; finalChars: number; mode: string } | null {
  return boundMachineResult(text, maxChars);
}
