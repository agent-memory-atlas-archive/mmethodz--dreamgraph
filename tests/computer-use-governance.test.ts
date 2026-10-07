/**
 * v14.0.2 governance around Computer Use: the Autonomous approval rule, the Pass Report's host-observed evidence,
 * the computer_use tool effect, and the Codex CLI instructions for DreamGraph's browser and the fallback.
 */
import { describe, expect, it } from "vitest";
import { autonomousAutoApproves } from "../src/server/managed-execution.js";
import { withHostObservedPassEvidence } from "../src/architect/routes.js";
import { coreToolPolicy } from "../src/server/tool-policy.js";
import { createCliControlInstructions } from "../src/architect/cli-bridge.js";

describe("Autonomous auto-approval", () => {
  it("approves graph writes and project source edits only in Autonomous mode", () => {
    expect(autonomousAutoApproves("autonomous", "enrich_seed_data")).toBe(true);
    expect(autonomousAutoApproves("autonomous", "patch_file")).toBe(true);
    expect(autonomousAutoApproves("supervised", "patch_file")).toBe(false);
    expect(autonomousAutoApproves("manual", "enrich_seed_data")).toBe(false);
  });

  it("keeps commands, unqualified tools and destructive operations under review", () => {
    for (const tool of ["run_command", "delete_file", "rename_file", "clear_dreams", "delete_schedule", "init_graph", "bootstrap_instance", "browser_click"])
      expect({ tool, approved: autonomousAutoApproves("autonomous", tool) }).toEqual({ tool, approved: false });
  });

  it("can be turned off", () => {
    const previous = process.env.DREAMGRAPH_AUTONOMOUS_AUTO_APPROVE;
    process.env.DREAMGRAPH_AUTONOMOUS_AUTO_APPROVE = "0";
    try { expect(autonomousAutoApproves("autonomous", "patch_file")).toBe(false); }
    finally { if (previous === undefined) delete process.env.DREAMGRAPH_AUTONOMOUS_AUTO_APPROVE; else process.env.DREAMGRAPH_AUTONOMOUS_AUTO_APPROVE = previous; }
  });
});

describe("Pass Report evidence", () => {
  it("fills Tool Trace and Graph / Plan Updates from what the host observed, keeping the model's own lines", () => {
    const report = { tool_trace_summary: [] as string[], graph_plan_updates: ["model: feature recorded"] };
    withHostObservedPassEvidence(report, [
      { tool: "browser_click", status: "completed", args_summary: "Click e6" },
      { tool: "enrich_seed_data", status: "completed", args_summary: "{\"target\":\"features\"}", result_preview: "success" },
      { tool: "run_command", status: "failed", args_summary: "node -e …" },
    ]);
    expect(report.tool_trace_summary).toEqual(["browser_click: completed — Click e6", "enrich_seed_data: completed — {\"target\":\"features\"}", "run_command: failed — node -e …"]);
    expect(report.graph_plan_updates).toEqual(["enrich_seed_data: success", "model: feature recorded"]);
  });

  it("reads CLI traces (dreamgraph: prefix) and replaces their generated duplicates", () => {
    const report = { tool_trace_summary: ["dreamgraph:browser_tabs: completed {\"truncated\":true}", "read_source_code inspected the saved project"], graph_plan_updates: [] as string[] };
    withHostObservedPassEvidence(report, [
      { tool: "dreamgraph:browser_tabs", status: "completed", args_summary: "{\"action\":\"list\"}" },
      { tool: "dreamgraph:enrich_seed_data", status: "completed", result_preview: "{\"success\":true}" },
    ]);
    expect(report.tool_trace_summary).toEqual(["dreamgraph:browser_tabs: completed — {\"action\":\"list\"}", "dreamgraph:enrich_seed_data: completed", "read_source_code inspected the saved project"]);
    expect(report.graph_plan_updates).toEqual(["enrich_seed_data: {\"success\":true}"]);
  });

  it("leaves the report as the model wrote it when the host observed nothing", () => {
    const report = { tool_trace_summary: ["model line"], graph_plan_updates: [] as string[] };
    withHostObservedPassEvidence(report, []);
    expect(report).toEqual({ tool_trace_summary: ["model line"], graph_plan_updates: [] });
  });
});

describe("Computer Use tools", () => {
  it("are governed by the execution's Computer Use grant, not by per-call review", () => {
    expect(coreToolPolicy("browser_click")).toMatchObject({ effect: "computer_use", read_only: false, authority: "computer_use_grant_of_the_execution" });
    expect(coreToolPolicy("browser_file_dialog").effect).toBe("computer_use");
    expect(coreToolPolicy("patch_file").effect).toBe("source_write");
  });
});

describe("Codex CLI Computer Use instructions", () => {
  it("routes Codex to DreamGraph's browser tools when DreamGraph's browser serves the run", () => {
    const text = createCliControlInstructions("autonomous", "balanced", "dreamgraph-browser", { browserGuidance: "GUIDANCE-TEXT" });
    expect(text).toMatch(/DreamGraph's browser tools on the dreamgraph MCP server/);
    expect(text).toMatch(/no other Computer Use route/);
    expect(text).toContain("GUIDANCE-TEXT");
    expect(text).not.toMatch(/cua_repl/);
  });

  it("names DreamGraph's own pages as off limits in Codex's own Computer Use (the fallback)", () => {
    const text = createCliControlInstructions("autonomous", "balanced", "granted", { protectedOrigins: ["http://127.0.0.1:6401", "http://localhost:6401"] });
    expect(text).toMatch(/cua_repl/);
    expect(text).toContain("Never operate DreamGraph's own pages (http://127.0.0.1:6401, http://localhost:6401)");
    expect(createCliControlInstructions("autonomous", "balanced", "granted")).not.toMatch(/Never operate DreamGraph's own pages/);
  });
});
