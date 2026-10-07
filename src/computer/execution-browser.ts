/**
 * DreamGraph's browser for CLI executors (Codex CLI, Copilot CLI): the same `browser_*` tools the native API loop
 * uses, served by the daemon's MCP server and bound to one managed execution.
 *
 * A CLI run with Computer Use granted opens a browser session keyed by its execution id; the executor reaches the
 * tools through DreamGraph's MCP bridge like every other DreamGraph tool. A call works only inside an execution that
 * holds a session (otherwise COMPUTER_USE_NOT_GRANTED). The Computer Use grant authorizes the actions, so these tools
 * are not execution-reviewed per call (tool-policy effect "computer_use"); saves into project source stay
 * graph-bound through the session's change-obligation recording.
 */
import { z, type ZodRawShape, type ZodTypeAny } from "zod";
import { getSessionContext } from "../server/session-context.js";
import { BROWSER_TOOLS, BROWSER_TOOL_NAMES } from "./browser-bridge/tools.js";
import { openDreamgraphBrowserSession, type DreamgraphBrowserSession } from "./dreamgraph-browser.js";

const sessions = new Map<string, DreamgraphBrowserSession>();

/** Opens the browser session for one execution. Throws when the extension is not connected. */
export async function openExecutionBrowser(executionId: string, signal?: AbortSignal,
  open: typeof openDreamgraphBrowserSession = openDreamgraphBrowserSession): Promise<DreamgraphBrowserSession> {
  if (sessions.has(executionId)) throw new Error("EXECUTION_BROWSER_ALREADY_OPEN");
  const session = await open({ signal, executionId });
  sessions.set(executionId, session);
  return session;
}

/** Releases the execution's browser session (tabs detached, pending saves recorded). Returns the session log path. */
export async function releaseExecutionBrowser(executionId: string, reason: string): Promise<string | null> {
  const session = sessions.get(executionId);
  if (!session) return null;
  sessions.delete(executionId);
  return session.release(reason);
}

export function executionBrowserOpen(executionId: string): boolean { return sessions.has(executionId); }

/** JSON Schema (the subset the browser tools use) → zod, so the MCP boundary validates the exact arguments. */
export function jsonSchemaToZod(schema: Record<string, unknown>): ZodTypeAny {
  const describe = (type: ZodTypeAny): ZodTypeAny => typeof schema.description === "string" ? type.describe(schema.description) : type;
  if (Array.isArray(schema.enum) && schema.enum.length && schema.enum.every(value => typeof value === "string"))
    return describe(z.enum(schema.enum as [string, ...string[]]));
  switch (schema.type) {
    case "string": return describe(z.string());
    case "number": return describe(z.number());
    case "integer": return describe(z.number().int());
    case "boolean": return describe(z.boolean());
    case "array": return describe(z.array(schema.items && typeof schema.items === "object" ? jsonSchemaToZod(schema.items as Record<string, unknown>) : z.unknown()));
    case "object": return describe(z.object(jsonSchemaToZodShape(schema)).strict());
    default: return describe(z.unknown());
  }
}

export function jsonSchemaToZodShape(schema: Record<string, unknown>): ZodRawShape {
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = new Set(Array.isArray(schema.required) ? schema.required as string[] : []);
  return Object.fromEntries(Object.entries(properties).map(([key, property]) => {
    const type = jsonSchemaToZod(property);
    return [key, required.has(key) ? type : type.optional()];
  }));
}

type ToolServer = { tool: (name: string, description: string, shape: ZodRawShape, handler: (args: Record<string, unknown>, extra?: { signal?: AbortSignal }) => Promise<unknown>) => unknown };

/** Registers the browser tools on a DreamGraph MCP server (outside the core catalogue, like plugin tools). */
export function registerExecutionBrowserTools(server: ToolServer): void {
  for (const tool of BROWSER_TOOLS) {
    server.tool(tool.name, `${tool.description} (DreamGraph Computer Use: available only in an Architect pass with Computer Use granted.)`,
      jsonSchemaToZodShape(tool.inputSchema), async (args, extra) => callExecutionBrowserTool(tool.name, args, extra?.signal));
  }
}

/** One browser tool call for the calling execution, as an MCP result (text plus an image for screenshots). */
export async function callExecutionBrowserTool(name: string, args: Record<string, unknown>, signal?: AbortSignal) {
  const executionId = getSessionContext()?.execution_policy?.id;
  const session = executionId ? sessions.get(executionId) : undefined;
  if (!BROWSER_TOOL_NAMES.has(name) || !session) {
    return { isError: true, content: [{ type: "text" as const, text: "COMPUTER_USE_NOT_GRANTED: DreamGraph's browser tools work only inside an Architect pass with Computer Use granted and DreamGraph's browser extension connected." }] };
  }
  const result = await session.call(name, args, signal);
  return {
    ...(result.isError ? { isError: true } : {}),
    content: [{ type: "text" as const, text: result.text }, ...result.images.map(image => ({ type: "image" as const, mimeType: image.mimeType, data: image.dataBase64 }))],
  };
}
