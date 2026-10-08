import { expect, it } from "vitest";
import { computerUseEvidence, isRequiredArchitectToolSatisfied, normalizeArchitectToolName } from "../src/architect/tool-selection.js";
const browser = (name: string) => name.startsWith("browser_");
it("normalizes Claude MCP names without granting foreign servers DreamGraph evidence", () => {
  for (const prefix of ["", "dreamgraph:", "mcp__dreamgraph__", "mcp__dreamgraph."]) {
    expect(normalizeArchitectToolName(prefix + "patch_file")).toBe("patch_file");
    expect(isRequiredArchitectToolSatisfied("patch_file", [prefix + "patch_file"])).toBe(true);
    expect(computerUseEvidence([prefix + "browser_screenshot"], browser)).toEqual({ acted: false, observed: true });
    expect(computerUseEvidence([prefix + "browser_click"], browser)).toEqual({ acted: true, observed: false });
  }
  for (const name of ["mcp__evil__browser_click", "mcp__dreamgraph_evil__browser_click", "mcp__evil__patch_file"]) {
    expect(normalizeArchitectToolName(name)).toBeNull();
    expect(isRequiredArchitectToolSatisfied("patch_file", [name])).toBe(false);
    expect(computerUseEvidence([name], browser)).toEqual({ acted: false, observed: false });
  }
});
