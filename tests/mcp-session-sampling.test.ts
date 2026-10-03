import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { withSessionContext, type SessionContext } from "../src/server/session-context.js";
import { initLlmProvider, getRoleLlmProvider, getLlmProvider, setMcpServerForSampling } from "../src/cognitive/llm.js";
import { setDataDirOverride } from "../src/utils/paths.js";
import { releaseGraphWriter } from "../src/graph/writer-lease.js";
let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "dg-scoped-sampling-")); setDataDirOverride(root); initLlmProvider({ provider: "sampling", model: "client", baseUrl: "", apiKey: "", temperature: 0, maxTokens: 1024, timeoutMs: 1000 }); });
afterEach(async () => { vi.unstubAllEnvs(); await releaseGraphWriter(root); setDataDirOverride(null); await rm(root, { recursive: true, force: true }); });
it("routes concurrent MCP sampling to its exact transport and leaves autonomous daemon sampling unavailable", async () => {
  vi.stubEnv("DREAMGRAPH_LLM_PROVIDER", "sampling");
  vi.stubEnv("DREAMGRAPH_LLM_DREAMER_CONCURRENCY", "2");
  const callers = ["a", "b"].map(label => {
    const createMessage = vi.fn(async () => { await new Promise(resolve => setTimeout(resolve, label === "a" ? 8 : 2)); return { content: { type: "text", text: label }, model: `native-${label}` }; });
    const identity: SessionContext = { principal: "local-machine", session_id: label, directory: root, channel: "mcp", environment: {}, continuation_key: label,
      sampling_server: { getClientCapabilities: () => ({ sampling: {} }), createMessage } };
    return { identity, createMessage };
  });
  const replies = await Promise.all(callers.map(caller => withSessionContext(caller.identity, async () => {
    setMcpServerForSampling(caller.identity.sampling_server);
    const { provider } = await getRoleLlmProvider("dreamer"); expect(await provider.isAvailable()).toBe(true);
    return provider.complete([{ role: "user", content: `private-${caller.identity.session_id}` }]);
  })));
  expect(replies.map(reply => reply.text)).toEqual(["a", "b"]);
  expect(callers[0].createMessage.mock.calls[0][0]).not.toEqual(callers[1].createMessage.mock.calls[0][0]);
  expect(await getLlmProvider().isAvailable()).toBe(false);
  await withSessionContext({ ...callers[0].identity, sampling_server: null }, async () => {
    expect(await getLlmProvider().isAvailable()).toBe(false);
  });
});
