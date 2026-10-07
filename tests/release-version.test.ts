import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDataDir, setDataDirOverride } from "../src/utils/paths.js";
import { releaseGraphWriter } from "../src/graph/writer-lease.js";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { CLI_VERSION } from "../src/cli/version.js";
import { EXTENSION_VERSION } from "../extensions/vscode/src/version.js";
import { config } from "../src/config/config.js";
import { createServer } from "../src/server/server.js";

// Exercise the daemon's real MCP identity and resources without starting
// background workers or making provider calls.
vi.mock("../src/cognitive/scheduler.js", () => ({ startScheduler: vi.fn(), stopScheduler: vi.fn() }));
vi.mock("../src/cognitive/llm-readiness.js", () => ({ startLlmReadinessWatcher: vi.fn(), stopLlmReadinessWatcher: vi.fn() }));
vi.mock("../src/cognitive/bootstrap-driver.js", () => ({ wireBootstrapOnReady: vi.fn() }));
vi.mock("../src/webhooks/worker.js", () => ({ startWebhookWorker: vi.fn(), stopWebhookWorker: vi.fn() }));
vi.mock("../src/tools/register.js", () => ({ registerTools: vi.fn() }));
vi.mock("../src/cognitive/register.js", () => ({ registerCognitiveResources: vi.fn(), registerCognitiveTools: vi.fn() }));
vi.mock("../src/discipline/register.js", () => ({ registerDisciplineResource: vi.fn() }));
vi.mock("../src/plugins/contributions.js", () => ({ registerPluginContributions: vi.fn() }));

const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const release = readJson("package.json").version;

let isolatedDirectory: string, priorDirectory: string;
beforeEach(async () => { priorDirectory = getDataDir(); isolatedDirectory = await mkdtemp(join(tmpdir(), "dg-release-identity-")); setDataDirOverride(isolatedDirectory); });
afterEach(async () => { await releaseGraphWriter(isolatedDirectory); setDataDirOverride(priorDirectory); await rm(isolatedDirectory, { recursive: true, force: true }); });

describe("synchronized release version", () => {
  it("keeps package manifests, lockfiles, CLI and VS Code identities aligned", () => {
    for (const file of [
      "package.json", "packages/sdk/package.json", "packages/host/package.json",
      "packages/token-economy/package.json", "explorer/package.json", "extensions/vscode/package.json",
    ]) expect(readJson(file).version, file).toBe(release);

    for (const file of ["package-lock.json", "explorer/package-lock.json", "extensions/vscode/package-lock.json"]) {
      const lock = readJson(file);
      expect(lock.version, file).toBe(release);
      expect(lock.packages[""].version, file).toBe(release);
    }
    const root = readJson("package.json");
    for (const name of ["@dreamgraph/sdk", "@dreamgraph/host", "@dreamgraph/token-economy"]) {
      expect(root.dependencies[name], name).toBe(release);
    }
    expect(CLI_VERSION).toBe(release);
    expect(EXTENSION_VERSION).toBe(release);
    expect(config.server.version).toBe(release);
    expect(readJson("browser-extension/manifest.json").version, "browser-extension/manifest.json").toBe(release);
  });

  it("exposes the same version through MCP initialization, instructions and capabilities", async () => {
    const priorSignals = new Map(["SIGINT", "SIGTERM"].map((signal) => [signal, process.listeners(signal)]));
    const server = createServer();
    const client = new Client({ name: "release-version-test", version: release });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      expect(client.getServerVersion()?.version).toBe(release);
      expect(client.getInstructions()).toContain(`DreamGraph MCP Server v${release}`);
      const result = await client.readResource({ uri: "system://capabilities" });
      const text = result.contents[0];
      expect("text" in text).toBe(true);
      if (!("text" in text)) throw new Error("Expected capabilities JSON");
      const page = JSON.parse(text.text);
      expect(page.schema).toBe("dreamgraph.resource_result.v1");
      expect(page.records.find((record: { key: string }) => record.key === "server").payload.version).toBe(release);
    } finally {
      await client.close();
      await server.close();
      for (const [signal, before] of priorSignals) {
        for (const listener of process.listeners(signal)) {
          if (!before.includes(listener)) process.removeListener(signal, listener);
        }
      }
    }
  });
});
