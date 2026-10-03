import { describe, expect, it } from "vitest";

import { extractArchitectCodexUsage, createArchitectCliToolRequirementsSection, serializeCliPrompt,parseCodexComputerDiscovery } from "../src/architect/cli-bridge.js";

describe('Codex native computer discovery',()=>{
  it('reports an enabled native feature without converting detection into scope or Stop qualification',()=>{
    const value=parseCodexComputerDiscovery('codex-cli 0.159.2\n','computer_use\tstable\ttrue\nbrowser_use\tstable\tfalse\nunrelated\tstable\ttrue\n');
    expect(value).toMatchObject({version:'0.159.2',native_feature_detected:true,qualified:false,features:{computer_use:{stage:'stable',enabled:true},browser_use:{enabled:false}}});
    expect(value.features).not.toHaveProperty('unrelated');expect(value.qualification_missing).toContain('independent_physical_stop');
  });
  it('distinguishes absent discovery fields from a supported or permitted native route',()=>{
    const value=parseCodexComputerDiscovery('codex-cli 0.100.0','unrelated\tstable\ttrue');
    expect(value.native_feature_detected).toBe(false);expect(value.features).toEqual({});expect(value.qualified).toBe(false);
  });
  it('refuses ambiguous, duplicate and oversized probe data rather than trusting a partial native advertisement',()=>{
    expect(()=>parseCodexComputerDiscovery('not a verified version','computer_use stable true')).toThrow('VERSION_UNVERIFIED');
    expect(()=>parseCodexComputerDiscovery('codex-cli 0.159.2','computer_use stable yes')).toThrow('FEATURE_UNVERIFIED');
    expect(()=>parseCodexComputerDiscovery('codex-cli 0.159.2','computer_use stable true\ncomputer_use stable false')).toThrow('FEATURE_UNVERIFIED');
    expect(()=>parseCodexComputerDiscovery('codex-cli 0.159.2','x'.repeat(32769))).toThrow('BYTE_BOUND');
  });
});

describe("Architect CLI bridge execution requirements", () => {
  it("serializes concrete governed MCP tool requirements without continuation semantics", () => {
    const section = createArchitectCliToolRequirementsSection({
      required_tools: ["read_source_code", "patch_file"],
      preferred_tools: ["run_command", "register_ui_element"],
    });

    expect(section).toContain("Concrete tool requirements for this execution:");
    expect(section).toContain("required_tools: read_source_code, patch_file");
    expect(section).toContain("preferred_tools: run_command, register_ui_element");
    expect(section).toContain("controller-derived execution requirements");
    expect(section).not.toContain("Continuation tool manifest");
    expect(section).toContain("instead of using a provider-native substitute");
  });

  it("keeps ordinary CLI prompts free of continuation-envelope expectations", () => {
    expect(createArchitectCliToolRequirementsSection(null)).toBe("Execution tool requirements: none beyond the adapter baseline.");
  });

  it("does not duplicate the user request in the CLI bridge prompt", () => {
    const request = "Investigate token economy without loading all dreams.";
    const prompt = serializeCliPrompt([
      { role: "system", content: "System context" },
      { role: "user", content: request },
    ], request, "codex-cli", null);

    expect(prompt).toContain("## CURRENT USER REQUEST\n\n" + request);
    expect(prompt).not.toContain("## USER\n" + request);
    expect(prompt.match(/Investigate token economy without loading all dreams\./g)).toHaveLength(1);
  });
});

it('reports actual native Codex token components without inventing missing usage', () => {
  expect(extractArchitectCodexUsage('diagnostic\n'+JSON.stringify({type:'turn.completed',usage:{input_tokens:50,cached_input_tokens:30,output_tokens:8}}))).toEqual({inputTokens:50,cachedInputTokens:30,outputTokens:8});
  expect(extractArchitectCodexUsage('done without telemetry')).toBeUndefined();
  expect(extractArchitectCodexUsage(JSON.stringify({type:'turn.completed',usage:{output_tokens:-1}}))).toBeUndefined();
});
