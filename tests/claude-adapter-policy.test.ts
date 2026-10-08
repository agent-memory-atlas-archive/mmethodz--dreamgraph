import { expect, it } from "vitest";
import { plannedComputerUseRoute } from "../src/computer/computer-use-backend.js";
import { missingRequiredArchitectToolCalls, type ArchitectToolTraceEntry } from "../src/architect/native-tool-loop.js";
import { withHostObservedPassEvidence } from "../src/architect/routes.js";
import { resolveRolePolicy } from "../src/config/role-policy.js";

it("routes Claude only to the granted DreamGraph browser, leaving existing fallbacks intact", () => {
  for (const preference of ["auto", "dreamgraph-browser"] as const) {
    expect(plannedComputerUseRoute("claude-cli", { connected: true }, preference).backend).toBe("dreamgraph-browser");
    expect(plannedComputerUseRoute("claude-cli", { connected: false }, preference).backend).toBe("unavailable");
  }
  expect(plannedComputerUseRoute("claude-cli", { connected: true }, "cua-runtime").backend).toBe("unavailable");
  expect(plannedComputerUseRoute("codex-cli", { connected: false }, "auto").backend).toBe("codex-native");
  expect(plannedComputerUseRoute("native_api_tool_loop", { connected: false }, "auto").backend).toBe("cua-runtime");
});
it("counts completed Claude browser actions and graph receipts but not failed calls or foreign servers", () => {
  const trace = (tool: string, status: "completed" | "failed" = "completed") => ({ tool, status, iteration: 1, duration_ms: 1, args_summary: "fixture", result_preview: "owner receipt" }) as ArchitectToolTraceEntry;
  const selection = { required_tools: ["patch_file"], unavailable_required_tools: [] };
  const required = (rows: ArchitectToolTraceEntry[]) => missingRequiredArchitectToolCalls(selection, rows, tool => tool.startsWith("browser_"));
  const observation = trace("mcp__dreamgraph__browser_screenshot");
  expect(required([observation])).toEqual(["patch_file"]);
  expect(required([observation, trace("mcp__dreamgraph__browser_click", "failed")])).toEqual(["patch_file"]);
  expect(required([observation, trace("mcp__foreign__browser_click")])).toEqual(["patch_file"]);
  expect(required([observation, trace("mcp__dreamgraph__browser_click")])).toEqual([]);
  const report = { tool_trace_summary: [], graph_plan_updates: [] } as { tool_trace_summary: string[]; graph_plan_updates: string[] };
  withHostObservedPassEvidence(report, [trace("mcp__dreamgraph__enrich_seed_data"), trace("mcp__foreign__enrich_seed_data"), trace("mcp__dreamgraph__patch_file", "failed")]);
  expect(report.graph_plan_updates).toEqual(["enrich_seed_data: owner receipt"]);
});
it("keeps confirmed CLI subscription policy separate from API money while retaining finite limits", () => {
  const policy = resolveRolePolicy({ role: "architect", env: {
    DREAMGRAPH_LLM_PROVIDER: "openai", DREAMGRAPH_LLM_ARCHITECT_ADAPTER: "claude-cli",
    DREAMGRAPH_LLM_ARCHITECT_MODEL: "claude-sonnet-5", DREAMGRAPH_LLM_ARCHITECT_BUDGET_CURRENCY: "USD",
  }, capabilities: { adapter: "claude-cli", model: "claude-sonnet-5", version: "2.1.293", apis: ["native_cli"], efforts: [], retention: [], strict_schema: false } });
  expect(policy.billing.channel).toBe("subscription");
  expect(policy.policy.budget).toMatchObject({ currency: "subscription_units", run_amount: 0, day_amount: 0 });
  expect(policy.policy.budget.requests).toBeGreaterThan(0);
  expect(policy.diagnostics.map(d => d.code)).not.toContain("BILLING_CHANNEL_MISMATCH");
});
