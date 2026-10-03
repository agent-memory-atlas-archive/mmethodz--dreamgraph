import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveRolePolicy, type RoleAdapterCapabilities } from "../src/config/role-policy.js";
import { NATIVE_CLI_DEFAULT_CONTEXT_ALLOCATION, MODEL_REQUEST_FRAMING_RESERVE_BYTES,
  NATIVE_CLI_PROMPT_MAX_BYTES } from "../src/config/request-bounds.js";
import { ModelExecution } from "../src/cognitive/model-execution.js";
import { ModelAdmissionError } from "../src/cognitive/model-admission.js";
import { withDataDirectory } from "../src/utils/paths.js";
import { releaseGraphWriter } from "../src/graph/writer-lease.js";
import type { LlmConfig } from "../src/cognitive/llm.js";

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "dg-native-cli-context-")); });
afterEach(async () => { await releaseGraphWriter(root); await rm(root, { recursive: true, force: true }); });

const config: LlmConfig = { provider: "openai", model: "gpt-6.1-sol", baseUrl: "https://api.openai.com/v1",
  apiKey: "", temperature: 0, maxTokens: 256, timeoutMs: 10_000 };
const capabilities: RoleAdapterCapabilities = { adapter: "codex-cli", version: "offline-test.v1", model: config.model,
  apis: ["native_cli"], efforts: ["low", "medium", "high"], retention: [], strict_schema: false };
const baseEnv = { DREAMGRAPH_LLM_PROVIDER: "openai" };
function cliPolicy(input: { env?: Record<string, string | undefined>; saved?: { context_tokens: number }; session_context_tokens?: number } = {}) {
  return resolveRolePolicy({ role: "architect", env: input.env ?? baseEnv, saved: input.saved,
    session: { provider: "openai", model: config.model, adapter: "codex-cli", api: "native_cli",
      output_tokens: config.maxTokens, ...(input.session_context_tokens ? { context_tokens: input.session_context_tokens } : {}) },
    capabilities });
}

describe("native CLI request allocation", () => {
  it("admits an own-instance-sized 24.8 KB metadata block plus 10 KB prompt under the native transport default, with no paid call", async () => {
    const policy = cliPolicy();
    expect(policy.status).toBe("configured");
    expect(policy.origins.context_tokens).toBe("default");
    expect(policy.effective.context_tokens).toBe(NATIVE_CLI_DEFAULT_CONTEXT_ALLOCATION);
    expect(NATIVE_CLI_DEFAULT_CONTEXT_ALLOCATION).toBe(NATIVE_CLI_PROMPT_MAX_BYTES + MODEL_REQUEST_FRAMING_RESERVE_BYTES);

    const payload = "m".repeat(24_819) + "p".repeat(10_000);
    expect(Buffer.byteLength(payload) + MODEL_REQUEST_FRAMING_RESERVE_BYTES).toBeGreaterThan(32_768);
    expect(Buffer.byteLength(payload)).toBeLessThan(NATIVE_CLI_PROMPT_MAX_BYTES);
    let dispatched = 0;
    const outcome = await withDataDirectory(root, async () => {
      const execution = new ModelExecution(config, "architect", policy, "offline-native-cli-allocation");
      return execution.request({ provider: "openai", model: config.model, payload, output_tokens: 256 }, async () => {
        dispatched++;
        return { result: "offline-stub", acknowledged: true };
      });
    });
    expect(outcome).toBe("offline-stub");
    expect(dispatched).toBe(1);
    const ledger = JSON.parse(await readFile(join(root, "spend_ledger.json"), "utf8"));
    const attempts = Object.values(ledger.attempts) as Array<{ channel: string; resources: { input_tokens: number }; accounted_nanounits: string }>;
    expect(attempts).toHaveLength(1);
    expect(attempts[0].channel).toBe("subscription");
    expect(attempts[0].resources.input_tokens).toBe(Buffer.byteLength(payload) + MODEL_REQUEST_FRAMING_RESERVE_BYTES);
    expect(attempts[0].accounted_nanounits).toBe("0");
  });

  it("honors explicit 32 KB saved, role, global and session caps and refuses before dispatch with numeric guidance", async () => {
    const saved = cliPolicy({ saved: { context_tokens: 32_768 } });
    const roleEnv = cliPolicy({ env: { ...baseEnv, DREAMGRAPH_LLM_ARCHITECT_CONTEXT_TOKENS: "32768" } });
    const globalEnv = cliPolicy({ env: { ...baseEnv, DREAMGRAPH_LLM_CONTEXT_TOKENS: "32768" } });
    const session = cliPolicy({ session_context_tokens: 32_768 });
    for (const policy of [saved, roleEnv, globalEnv, session]) expect(policy.effective.context_tokens).toBe(32_768);
    expect(saved.origins.context_tokens).toBe("saved");
    expect(roleEnv.origins.context_tokens).toBe("role_env");
    expect(globalEnv.origins.context_tokens).toBe("legacy");
    expect(session.origins.context_tokens).toBe("session");

    const payload = "m".repeat(24_819) + "p".repeat(10_000);
    let dispatched = 0;
    const execution = withDataDirectory(root, () => new ModelExecution(config, "architect", saved,
      "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:1791051095917"));
    let failure: unknown;
    try {
      await execution.request({ provider: "openai", model: config.model, payload, output_tokens: 256 }, async () => {
        dispatched++;
        return { result: "unexpected", acknowledged: true };
      });
    } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(ModelAdmissionError);
    expect((failure as ModelAdmissionError).code).toBe("ADMISSION_CONTEXT_LIMIT");
    expect((failure as Error).message).toContain("required_allocation=36867");
    expect((failure as Error).message).toContain("context_allocation=32768");
    expect((failure as Error).message).toContain("DREAMGRAPH_LLM_ARCHITECT_CONTEXT_TOKENS");
    expect((failure as Error).message).toContain("origin=saved");
    const routeReason = `architect_provider_failed: ${(failure as Error).message.slice(0, 240)}`.slice(0, 240);
    expect(routeReason).toContain("DREAMGRAPH_LLM_ARCHITECT_CONTEXT_TOKENS");
    expect(routeReason).toContain("required_allocation=36867");
    expect(routeReason).toContain("context_allocation=32768");
    expect(dispatched).toBe(0);
  });

  it("keeps the API adapter's context allocation default at 32,768", () => {
    const policy = resolveRolePolicy({ role: "architect", env: baseEnv,
      session: { provider: "openai", model: config.model, adapter: "openai-api", api: "responses", output_tokens: 256 } });
    expect(policy.status).toBe("configured");
    expect(policy.effective.context_tokens).toBe(32_768);
    expect(policy.origins.context_tokens).toBe("default");
  });
});
