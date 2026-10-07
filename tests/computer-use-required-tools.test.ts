/**
 * Computer Use work satisfies the source/verification obligations a prompt implies (v14.0.2 proof run: without this,
 * the required-tool correction pushed the model into graph_health_report, a no-op patch_file and a blocked run_command
 * after the task was done). Graph grounding and graph recording stay required.
 */
import { describe, expect, it } from "vitest";
import { computerUseEvidence, isRequiredArchitectToolSatisfied, selectArchitectToolNames } from "../src/architect/tool-selection.js";

const PROMPT = 'Use the existing Web64 IDE local browser tab and create a "HELLO WORLD" demo in c64 assembly, save it as hello-world.web64proj inside the project folder and build/run it and leave it like that';
const AVAILABLE = ["query_resource", "query_architecture_decisions", "graph_rag_retrieve", "read_source_code", "patch_file", "enrich_seed_data", "run_command", "graph_health_report", "schedule_dream", "cognitive_status", "get_cognitive_preamble"];
const isBrowser = (name: string) => name.startsWith("browser_");
const missing = (called: string[]) => {
  const { required_tools } = selectArchitectToolNames({ prompt: PROMPT, availableToolNames: AVAILABLE, autonomy: true });
  return required_tools.filter(tool => !isRequiredArchitectToolSatisfied(tool, called, computerUseEvidence(called, isBrowser)));
};
const GROUNDING = ["query_resource", "query_architecture_decisions", "graph_rag_retrieve"];
const BROWSER_WORK = ["browser_tabs", "browser_snapshot", "browser_type", "browser_click", "browser_file_dialog", "browser_click", "browser_wait", "browser_screenshot"];

describe("Computer Use evidence for required tools", () => {
  it("accepts the proof run's work: browser actions plus observations, grounding and a graph record", () => {
    expect(missing([...GROUNDING, ...BROWSER_WORK, "read_source_code", "enrich_seed_data"])).toEqual([]);
  });

  it("still requires the graph record", () => {
    expect(missing([...GROUNDING, ...BROWSER_WORK])).toEqual(["enrich_seed_data"]);
  });

  it("does not count observation alone as done work", () => {
    const left = missing([...GROUNDING, "browser_snapshot", "browser_screenshot", "enrich_seed_data"]);
    expect(left).toContain("patch_file");
    expect(left).toContain("run_command");
  });

  it("leaves passes without Computer Use unchanged", () => {
    const left = missing([...GROUNDING, "read_source_code", "enrich_seed_data"]);
    expect(left).toContain("patch_file");
    expect(left).toContain("run_command");
    expect(computerUseEvidence(["patch_file", "run_command"], isBrowser)).toEqual({ acted: false, observed: false });
  });
});
