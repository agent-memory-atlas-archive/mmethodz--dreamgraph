/** DreamGraph's browser tools for CLI executors: exact schemas, and calls bound to the execution holding the session. */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BROWSER_TOOLS } from "../src/computer/browser-bridge/tools.js";
import { callExecutionBrowserTool, executionBrowserOpen, jsonSchemaToZodShape, openExecutionBrowser, releaseExecutionBrowser } from "../src/computer/execution-browser.js";
import type { DreamgraphBrowserSession } from "../src/computer/dreamgraph-browser.js";
import { withSessionContext, type SessionContext } from "../src/server/session-context.js";

const schema = (name: string) => z.object(jsonSchemaToZodShape(BROWSER_TOOLS.find(tool => tool.name === name)!.inputSchema)).strict();
const as = <T>(executionId: string, work: () => T) => withSessionContext({ principal: "test", session_id: "s", directory: process.cwd(), channel: "mcp",
  environment: {}, continuation_key: "k", execution_policy: { id: executionId } } as unknown as SessionContext, work);

describe("browser tool schemas", () => {
  it("converts every tool and validates arguments exactly", () => {
    for (const tool of BROWSER_TOOLS) expect(() => schema(tool.name)).not.toThrow();
    expect(schema("browser_click").safeParse({ x: 10, y: 20, button: "right", modifiers: ["Shift"] }).success).toBe(true);
    expect(schema("browser_click").safeParse({ button: "top" }).success).toBe(false);
    expect(schema("browser_type").safeParse({ ref: "e1" }).success).toBe(false);
    expect(schema("browser_type").safeParse({ text: "lda #$00", clear: true }).success).toBe(true);
    expect(schema("browser_snapshot").safeParse({ undeclared: 1 }).success).toBe(false);
  });
});

describe("execution-bound browser sessions", () => {
  const fake = (): DreamgraphBrowserSession => ({
    sessionId: "fake", tools: BROWSER_TOOLS, guidance: "", extensionVersion: null, has: () => true, title: (name: string) => name,
    call: async (name: string) => ({ text: `did ${name}`, isError: false, images: name === "browser_screenshot" ? [{ type: "image", mimeType: "image/jpeg", dataBase64: "AAA" }] : [] }),
    release: async (reason: string) => `log:${reason}`,
  }) as unknown as DreamgraphBrowserSession;

  it("refuses calls outside an execution with Computer Use granted", async () => {
    const result = await as("run-none", () => callExecutionBrowserTool("browser_snapshot", {}));
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ type: "text" });
    expect((result.content[0] as { text: string }).text).toMatch(/COMPUTER_USE_NOT_GRANTED/);
  });

  it("serves the holding execution only, returns images, and releases once", async () => {
    await openExecutionBrowser("run-1", undefined, async () => fake());
    expect(executionBrowserOpen("run-1")).toBe(true);
    const shot = await as("run-1", () => callExecutionBrowserTool("browser_screenshot", {}));
    expect(shot.content).toEqual([{ type: "text", text: "did browser_screenshot" }, { type: "image", mimeType: "image/jpeg", data: "AAA" }]);
    expect((await as("run-2", () => callExecutionBrowserTool("browser_snapshot", {}))).isError).toBe(true);
    await expect(openExecutionBrowser("run-1", undefined, async () => fake())).rejects.toThrow(/ALREADY_OPEN/);
    expect(await releaseExecutionBrowser("run-1", "done")).toBe("log:done");
    expect(await releaseExecutionBrowser("run-1", "again")).toBeNull();
    expect(executionBrowserOpen("run-1")).toBe(false);
  });
});
