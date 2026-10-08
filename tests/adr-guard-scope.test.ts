import { it, expect } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerADRTools } from "../src/tools/adr-historian.js";
import { getDataDir, setDataDirOverride } from "../src/utils/paths.js";

it("a targeted guard check returns only applicable decisions and all their warnings", async () => {
  const prior = getDataDir(), root = await mkdtemp(join(tmpdir(), "dg-adr-guard-"));
  setDataDirOverride(root);
  try {
    await writeFile(join(root, "adr_log.json"), JSON.stringify({ decisions: [
      { id: "ADR-target", title: "Plan selection", status: "accepted", context: { affected_entities: ["plan-rail"] }, guard_rails: ["Use daemon selection", "Keep draft state"], tags: [] },
      ...Array.from({ length: 1000 }, (_, i) => ({ id: "ADR-other-" + i, title: "Other feature", status: "accepted", context: { affected_entities: ["unrelated"] }, guard_rails: ["Unrelated rule"], tags: [] })),
    ] }));
    let query!: (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>;
    registerADRTools({ tool(name: string, ...args: unknown[]) { if (name === "query_architecture_decisions") query = args.at(-1) as typeof query; } } as unknown as McpServer);
    const response = await query({ guard_check_entity_id: "plan-rail", guard_check_proposed_change: "Select a newly created plan" });
    const result = JSON.parse(response.content[0].text);
    expect(result.success).toBe(true);
    expect(result.data.total).toBe(1);
    expect(result.data.decisions.map((d: { id: string }) => d.id)).toEqual(["ADR-target"]);
    expect(result.data.guard_rail_warnings).toHaveLength(2);
    expect(Buffer.byteLength(response.content[0].text)).toBeLessThan(2000);
  } finally { setDataDirOverride(prior); await rm(root, { recursive: true, force: true }); }
});
