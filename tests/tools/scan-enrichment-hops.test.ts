import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const enrich = vi.hoisted(() => vi.fn());
vi.mock("../../src/tools/enrich-parser-nodes.js", async (original) => ({
  ...await original<typeof import("../../src/tools/enrich-parser-nodes.js")>(),
  enrichParserNodesProgrammatic: enrich,
}));
vi.mock("../../src/cognitive/llm.js", async (original) => ({
  ...await original<typeof import("../../src/cognitive/llm.js")>(),
  isLlmAvailable: async () => false,
}));
import { runScanProject, registerScanProjectTool } from "../../src/tools/scan-project.js";
import { registerEnrichParserNodesTool } from "../../src/tools/enrich-parser-nodes.js";
import { buildScanState } from "../../src/tools/scan-state.js";
import { config } from "../../src/config/config.js";
import { setDataDirOverride } from "../../src/utils/paths.js";
import { invalidateCache, setDataDirResolver } from "../../src/utils/cache.js";
import { withGraphOperation } from "../../src/utils/graph-operation.js";

const originalRepos = { ...config.repos };
const originalDatabase = config.database.connectionString;
let root: string;
let data: string;
let repo: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "dg-scan-hop-budget-"));
  data = join(root, "data");
  repo = join(root, "repo");
  await mkdir(data);
  await mkdir(join(repo, "src"), { recursive: true });
  await writeFile(join(repo, "src", "first.ts"), "export const first = 1;\n");
  for (const key of Object.keys(config.repos)) delete config.repos[key];
  config.repos.fixture = repo;
  config.database.connectionString = "";
  setDataDirOverride(data);
  setDataDirResolver(() => data);
  invalidateCache();
  enrich.mockReset().mockResolvedValue({ success: false, error: { code: "TEST", message: "Provider-free test seam" } });
});
afterEach(async () => {
  for (const key of Object.keys(config.repos)) delete config.repos[key];
  Object.assign(config.repos, originalRepos);
  config.database.connectionString = originalDatabase;
  setDataDirOverride(null);
  setDataDirResolver(() => config.dataDir);
  invalidateCache();
  await rm(root, { recursive: true, force: true, maxRetries: 5 });
});

describe("scan enrichment hop budget", () => {
  it("rejects a scan while an independent enrichment owns the instance", async () => {
    let release!: () => void;
    const running = withGraphOperation("enrichment", () => new Promise<void>((resolve) => { release = resolve; }));
    try {
      await expect(runScanProject({ repos: ["fixture"] })).rejects.toThrow(/enrichment is already running/);
      expect(enrich).not.toHaveBeenCalled();
    } finally {
      release();
      await running;
    }
  });

  it.each([undefined, 0, 1, 2, 3])("passes full scan context_hops=%s through to mandatory enrichment", async (hops) => {
    await runScanProject({ repos: ["fixture"], targets: ["features"], context_hops: hops });
    expect(enrich).toHaveBeenCalledTimes(1);
    expect(enrich.mock.calls[0][0]).toMatchObject({ target: "all", contextHops: hops ?? 2 });
  });

  it("passes a zero-hop budget through explicit incremental enrichment", async () => {
    const baseline = await buildScanState({ repos: { fixture: repo }, depth: "deep", targets: ["features"], operation: "full" });
    await writeFile(join(data, "scan_state.json"), JSON.stringify(baseline));
    await writeFile(join(repo, "src", "second.ts"), "export const second = 2;\n");
    invalidateCache();
    await runScanProject({ repos: ["fixture"], targets: ["features"], mode: "incremental", enrich: true, context_hops: 0 });
    expect(enrich).toHaveBeenCalledTimes(1);
    expect(enrich.mock.calls[0][0]).toMatchObject({ contextHops: 0 });
  });

  it("validates the budget before filesystem or enrichment work", async () => {
    await expect(runScanProject({ context_hops: 1.5 })).rejects.toThrow(/integer from 0 to 6/);
    expect(enrich).not.toHaveBeenCalled();
  });

  it("exposes zero- and one-hop budgets and the two-hop default through both MCP schemas", () => {
    for (const register of [registerScanProjectTool, registerEnrichParserNodesTool]) {
      const tool = vi.fn();
      register({ tool } as unknown as McpServer);
      const schema = tool.mock.calls[0][2].context_hops;
      expect(schema.parse(undefined)).toBe(2);
      expect(schema.parse(0)).toBe(0);
      expect(schema.parse(1)).toBe(1);
      expect(schema.safeParse(7).success).toBe(false);
    }
  });
});
