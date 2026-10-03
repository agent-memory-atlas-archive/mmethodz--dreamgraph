import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ health: vi.fn(), update: vi.fn(), metadata: vi.fn(), release: vi.fn(), spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: m.spawn }));
vi.mock("node:fs", () => ({ openSync: () => 12, closeSync: vi.fn(), existsSync: () => false }));
vi.mock("../src/config/config.js", () => ({ config: { server: { version: "13.4.0" } } }));
vi.mock("../src/instance/cli.js", () => ({ updateInstanceEntry: m.update }));
vi.mock("../src/cli/utils/daemon.js", () => ({
  resolveInstanceForCommand: async () => ({ entry: { uuid: "original", name: "dreamgraph" }, instanceRoot: "fixture", masterDir: "fixture" }),
  checkVersionMismatch: () => ({ mismatch: false }), acquireStartLock: async () => m.release, readServerMeta: async () => null,
  cleanRuntimeFiles: vi.fn(), isProcessAlive: vi.fn(), validateOwnership: vi.fn(), findAvailablePort: async () => 8010,
  resolveBinPath: () => "fixture/index.js", serverLogPath: () => "fixture/server.log", rotateLogIfNeeded: vi.fn(),
  writeServerMeta: m.metadata, healthCheck: m.health, readLogTail: async () => "SyntaxError: missing workspace export",
}));
import { cmdStart } from "../src/cli/commands/start.js";
afterEach(() => vi.restoreAllMocks());
beforeEach(() => {
  vi.clearAllMocks(); m.spawn.mockReturnValue({ pid: 29404, unref: vi.fn() });
  vi.spyOn(console, "log").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {});
});
it("does not report startup or update last-active after failed health; retains original metadata and releases lock", async () => {
  m.health.mockResolvedValue(false);
  await expect(cmdStart(["dreamgraph"], { http: true })).rejects.toThrow("startup was not confirmed");
  expect(m.metadata).toHaveBeenCalledWith("fixture", expect.objectContaining({ pid: 29404 }));
  expect(m.update).not.toHaveBeenCalled(); expect(m.release).toHaveBeenCalledOnce();
  expect(vi.mocked(console.log).mock.calls.flat().join(" ")).not.toContain("daemon started");
});
it("reports unhealthy JSON and rejects rather than emitting started after a failed restart", async () => {
  m.health.mockResolvedValue(false); const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  await expect(cmdStart(["dreamgraph"], { http: true, json: true })).rejects.toThrow("startup was not confirmed");
  expect(JSON.parse(String(output.mock.calls[0][0]))).toMatchObject({ status: "unhealthy", pid: 29404, uuid: "original" });
  output.mockRestore();
});
it("reports success only after a confirmed health response", async () => {
  m.health.mockResolvedValue(true); await cmdStart(["dreamgraph"], { http: true });
  expect(m.update).toHaveBeenCalledOnce(); expect(vi.mocked(console.log).mock.calls.flat().join(" ")).toContain("daemon started");
});
