import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), meta: vi.fn(), alive: vi.fn(), call: vi.fn() }));
vi.mock("../src/cli/utils/daemon.js", () => ({
  resolveInstanceForCommand: mocks.resolve, readServerMeta: mocks.meta, isProcessAlive: mocks.alive,
}));
vi.mock("../src/cli/utils/mcp-call.js", () => ({ mcpCallTool: mocks.call }));
import { cmdScan } from "../src/cli/commands/scan.js";
import { cmdEnrich } from "../src/cli/commands/enrich.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  mocks.resolve.mockResolvedValue({ entry: { name: "fixture" }, instanceRoot: "/fixture" });
  mocks.meta.mockResolvedValue({ pid: 1, port: 6401 });
  mocks.alive.mockReturnValue(true);
  mocks.call.mockResolvedValue({ content: [{ text: JSON.stringify({ data: {} }) }] });
});
afterEach(() => vi.restoreAllMocks());

describe("CLI enrichment hop budget", () => {
  it.each([0, 1, 6])("forwards scan --max-hops %s to scan_project", async (hops) => {
    await cmdScan(["fixture"], { "max-hops": String(hops), json: true });
    expect(mocks.call.mock.calls[0].slice(0, 3)).toEqual([6401, "scan_project", { depth: "deep", context_hops: hops }]);
  });

  it.each([0, 1, 6])("forwards enrich --max-hops %s to both the scan and enrichment passes", async (hops) => {
    await cmdEnrich(["fixture"], { "max-hops": String(hops), json: true });
    expect(mocks.call.mock.calls.map((call) => [call[1], call[2].context_hops]))
      .toEqual([["scan_project", hops], ["enrich_parser_nodes", hops]]);
  });

  it("supports a one-hop enrichment-only pass", async () => {
    await cmdEnrich(["fixture"], { "skip-scan": true, "max-hops": "1", json: true });
    expect(mocks.call).toHaveBeenCalledTimes(1);
    expect(mocks.call.mock.calls[0].slice(0, 3)).toEqual([6401, "enrich_parser_nodes", { target: "all", context_hops: 1 }]);
  });

  it("keeps the server default when no hop option is supplied", async () => {
    await cmdScan(["fixture"], { json: true });
    await cmdEnrich(["fixture"], { "skip-scan": true, json: true });
    expect(mocks.call.mock.calls.every((call) => !("context_hops" in call[2]))).toBe(true);
  });

  it.each(["-1", "7", "1.5", "invalid", "", true])("rejects invalid hop budget %s before any daemon lookup or MCP call", async (value) => {
    for (const command of [cmdScan, cmdEnrich]) {
      await expect(command(["fixture"], { "max-hops": value })).rejects.toThrow(/Invalid --max-hops.*integer from 0 to 6/);
    }
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it("documents the flag in both command help screens", async () => {
    await cmdScan([], { help: true });
    await cmdEnrich([], { help: true });
    expect(vi.mocked(console.log).mock.calls.every(([text]) => String(text).includes("--max-hops"))).toBe(true);
    expect(mocks.call).not.toHaveBeenCalled();
  });
});
