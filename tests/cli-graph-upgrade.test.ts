import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const daemon = vi.hoisted(() => ({ resolve: vi.fn(), meta: vi.fn(), alive: vi.fn() }));
vi.mock("../src/cli/utils/daemon.js", () => ({
  resolveInstanceForCommand: daemon.resolve,
  readServerMeta: daemon.meta,
  isProcessAlive: daemon.alive,
}));

import { cmdGraphUpgrade } from "../src/cli/commands/graph-upgrade.js";
import { GraphUpgradePreviewSchema, LegacyGraphUpgrade } from "../src/graph/legacy-upgrade.js";
import { releaseGraphWriter } from "../src/graph/writer-lease.js";

let temporary: string, instanceRoot: string, masterDir: string, data: string;
const output = () => vi.mocked(console.log).mock.calls.map(([value]) => String(value)).join("\n");

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  temporary = await fs.mkdtemp(join(tmpdir(), "dg-cli-upgrade-"));
  instanceRoot = join(temporary, "instance");
  masterDir = join(temporary, "master");
  data = join(instanceRoot, "data");
  await fs.mkdir(data, { recursive: true });
  await fs.mkdir(join(instanceRoot, "config"));
  daemon.resolve.mockResolvedValue({ entry: { uuid: "fixture", name: "fixture" }, instanceRoot, masterDir });
  daemon.meta.mockResolvedValue(null);
  daemon.alive.mockReturnValue(false);
});

afterEach(async () => {
  await releaseGraphWriter(data);
  await fs.rm(temporary, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function danglingFixture(count = 1200, missingIdentity = false) {
  const rows = [{ id: "source", source_repo: "fixture", links: Array.from({ length: count }, (_, index) => ({
    target: `absent-${index}`, type: "feature", relationship: "references",
  })) }];
  const content = JSON.stringify(rows);
  await fs.writeFile(join(data, "features.json"), content);
  if (missingIdentity) await fs.writeFile(join(data, "workflows.json"), JSON.stringify([{ name: "Legacy workflow requiring identity", source_repo: "fixture" }]));
  return content;
}

async function savedRecovery() {
  const reviews = join(masterDir, "graph-upgrade-reviews");
  const name = (await fs.readdir(reviews)).find(value => value.endsWith(".recovery.json"))!;
  return JSON.parse(await fs.readFile(join(reviews, name), "utf8"));
}

async function resume(recovery: { resume_arguments: string[] }) {
  const args = recovery.resume_arguments;
  await cmdGraphUpgrade([args[1], args[2]], { ...Object.fromEntries(Array.from({ length: (args.length - 3) / 2 }, (_, index) =>
    [args[3 + index * 2].slice(2), args[4 + index * 2]])), json: true });
  return JSON.parse(output());
}

describe("graph-upgrade preview CLI output", () => {
  it("keeps --dry-run read-only and bounds many existing dangling links", async () => {
    const original = await danglingFixture();
    await cmdGraphUpgrade(["fixture"], { "dry-run": true });
    const printed = output();
    expect(printed.length).toBeLessThan(12_000);
    expect(printed).toContain("1,200");
    expect(printed).not.toContain("fact:");
    expect(printed).not.toContain("absent-1199");
    expect(await fs.readFile(join(data, "features.json"), "utf8")).toBe(original);
    expect(await fs.readdir(data)).toEqual(["features.json"]);
  });

  it("keeps full diagnostics and digest in explicit JSON mode", async () => {
    await danglingFixture();
    await cmdGraphUpgrade(["fixture"], { "dry-run": true, json: true });
    const preview = GraphUpgradePreviewSchema.parse(JSON.parse(output()));
    expect(preview.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(preview.before.unresolved_endpoints).toBe(1200);
    expect(preview.before.state.reasons.filter(reason => reason.code === "UNRESOLVED_ENDPOINT")).toHaveLength(1200);
  });

  it("writes the exact full review while keeping ordinary stdout bounded, and preserves JSON plus out mode", async () => {
    await danglingFixture();
    const review = join(temporary, "review.json");
    await cmdGraphUpgrade(["fixture"], { "dry-run": true, out: review });
    const saved = GraphUpgradePreviewSchema.parse(JSON.parse(await fs.readFile(review, "utf8")));
    expect(saved.before.unresolved_endpoints).toBe(1200);
    expect(saved.before.state.reasons.filter(reason => reason.code === "UNRESOLVED_ENDPOINT")).toHaveLength(1200);
    expect(output().length).toBeLessThan(12_000);
    expect(output()).toContain(saved.digest);
    expect(output()).not.toContain("fact:");

    vi.mocked(console.log).mockClear();
    const jsonReview = join(temporary, "json-review.json");
    await cmdGraphUpgrade(["fixture"], { "dry-run": true, json: true, out: jsonReview });
    const summary = JSON.parse(output());
    const written = GraphUpgradePreviewSchema.parse(JSON.parse(await fs.readFile(jsonReview, "utf8")));
    expect(summary).toMatchObject({ action: "preview", instance_id: "fixture", preview_path: await fs.realpath(jsonReview), digest: written.digest });
    expect(summary.before.unresolved_endpoints).toBe(1200);
    expect(summary.before.state.reasons.filter((reason: { code: string }) => reason.code === "UNRESOLVED_ENDPOINT")).toHaveLength(1200);
  });

  it("distinguishes real structural blockers from existing dangling links and documents --json", async () => {
    await danglingFixture(1);
    await fs.writeFile(join(data, "tension_log.json"), '{"schema_version":"99.0.0","signals":[]}');
    await expect(cmdGraphUpgrade(["fixture"], { "dry-run": true })).resolves.toBeUndefined();
    expect(output()).toContain("UNSUPPORTED_STORE_SCHEMA");
    expect(output()).toContain("1");
    vi.mocked(console.log).mockClear();
    await cmdGraphUpgrade([], { help: true });
    expect(output()).toContain("--json");
    expect(output()).toContain("--dry-run");
  });

  it("applies a missing identity by default, preserves 1,200 unresolved links, and saves an exact resumable review", async () => {
    const original = await danglingFixture(1200, true);
    await cmdGraphUpgrade(["fixture"], {});
    const printed = output();
    expect(printed.length).toBeLessThan(15_000);
    expect(printed).toContain("Checking instance");
    expect(printed).toContain("Analyzing legacy graph");
    expect(printed).toContain("Creating verified backup");
    expect(printed).toContain("Migration complete");
    expect(printed).toContain("1,200");
    expect(printed).not.toContain("fact:");
    const migrated = JSON.parse(await fs.readFile(join(data, "workflows.json"), "utf8"));
    expect(migrated[0].id).toMatch(/^legacy:workflow:/);
    expect(JSON.parse(await fs.readFile(join(data, "features.json"), "utf8"))[0].links).toHaveLength(1200);
    expect(await fs.readFile(join(data, "features.json"), "utf8")).toBe(original);

    const reviewDir = join(masterDir, "graph-upgrade-reviews");
    const names = await fs.readdir(reviewDir);
    expect(names).toHaveLength(2);
    const reviewName = names.find(name => name.endsWith(".json") && !name.endsWith(".recovery.json"))!;
    const reviewPath = join(reviewDir, reviewName);
    const review = GraphUpgradePreviewSchema.parse(JSON.parse(await fs.readFile(reviewPath, "utf8")));
    expect(review.before.unresolved_endpoints).toBe(1200);
    expect(review.after.unresolved_endpoints).toBe(1200);
    expect(review.writes).toHaveLength(1);
    const recovery = JSON.parse(await fs.readFile(reviewPath + ".recovery.json", "utf8"));
    expect(recovery).toMatchObject({ schema: "dreamgraph.graph_upgrade_cli_recovery.v1", instance_id: "fixture",
      preview_path: await fs.realpath(reviewPath), reviewed_digest: review.digest });
    expect(recovery.resume_arguments.slice(0, 3)).toEqual(["graph-upgrade", "fixture", "apply"]);
    vi.mocked(console.log).mockClear();
    expect((await resume(recovery)).replayed).toBe(true);
  });

  it("refuses an active daemon before default migration writes and saves no review", async () => {
    const original = await danglingFixture(1, true);
    daemon.meta.mockResolvedValue({ pid: 42 });
    daemon.alive.mockReturnValue(true);
    await expect(cmdGraphUpgrade(["fixture"], {})).rejects.toThrow(/Stop instance.*before upgrading/);
    expect(await fs.readFile(join(data, "features.json"), "utf8")).toBe(original);
    await expect(fs.stat(join(masterDir, "graph-upgrade-reviews"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps a direct upgrade JSON receipt bounded while reporting the unchanged graph diagnostics", async () => {
    await danglingFixture(1200, true);
    await cmdGraphUpgrade(["fixture"], { json: true });
    const printed = output();
    expect(printed.length).toBeLessThan(15_000);
    expect(printed).not.toContain("fact:");
    const result = JSON.parse(printed);
    expect(result).toMatchObject({ action: "upgrade", status: "committed", instance_id: "fixture", replayed: false });
    expect(result.stats).toMatchObject({ before: { unresolved_endpoints: 1200 }, after: { unresolved_endpoints: 1200 }, changed_files: 1 });
    expect(result.receipt.result.changed_files).toBe(1);
  });

  it("saves a blocked direct upgrade review but does not apply it", async () => {
    const original = await danglingFixture(1, true);
    const unsupported = '{"schema_version":"99.0.0","signals":[]}';
    await fs.writeFile(join(data, "tension_log.json"), unsupported);
    await expect(cmdGraphUpgrade(["fixture"], {})).rejects.toThrow("GRAPH_UPGRADE_RESOLUTIONS_REQUIRED");
    expect(output()).toContain("UNSUPPORTED_STORE_SCHEMA");
    expect(output()).toContain("Migration blocked");
    expect(await fs.readFile(join(data, "features.json"), "utf8")).toBe(original);
    expect(await fs.readFile(join(data, "tension_log.json"), "utf8")).toBe(unsupported);
    const reviews = await fs.readdir(join(masterDir, "graph-upgrade-reviews"));
    expect(reviews).toHaveLength(1);
    const review = GraphUpgradePreviewSchema.parse(JSON.parse(await fs.readFile(join(masterDir, "graph-upgrade-reviews", reviews[0]), "utf8")));
    expect(review.blockers.some(value => value.includes("UNSUPPORTED_STORE_SCHEMA"))).toBe(true);
    expect(await fs.readdir(data)).toEqual(["features.json", "tension_log.json", "workflows.json"]);
  });

  it("prints immediate progress before asynchronous instance lookup resolves", async () => {
    await danglingFixture(1);
    let resolveLookup!: (value: unknown) => void;
    daemon.resolve.mockReturnValue(new Promise(resolve => { resolveLookup = resolve; }));
    const pending = cmdGraphUpgrade(["fixture"], { "dry-run": true });
    expect(output()).toContain("Checking instance 'fixture'");
    resolveLookup({ entry: { uuid: "fixture", name: "fixture" }, instanceRoot, masterDir });
    await pending;
    expect(output()).toContain("Analyzing legacy graph");
  });

  it("upgrades conflicting history only with explicit preservation and keeps normal output bounded", async () => {
    const rows = [
      { dream_type: "node", dream_id: "collision", normalization_cycle: 1, status: "latent", confidence: 0.3 },
      { dream_type: "node", dream_id: "collision", normalization_cycle: 1, status: "latent", confidence: 0.8 },
      { dream_type: "node", dream_id: "unrelated", normalization_cycle: 1, status: "latent", confidence: 0.4 },
    ];
    await fs.writeFile(join(data, "candidate_edges.json"), JSON.stringify({ results: rows }));
    await cmdGraphUpgrade(["fixture"], { "preserve-conflicts": true });
    expect(output()).toContain("Migration complete.");
    expect(output()).toContain("Conflicting revisions preserved in quarantined history: 2");
    expect(output().length).toBeLessThan(15_000);
    expect(output()).not.toContain('"confidence"');
    const stored = JSON.parse(await fs.readFile(join(data, "candidate_edges.json"), "utf8"));
    expect(stored.results).toEqual([rows[2]]);
    expect(stored.legacy_conflicts.map((entry: { row: unknown }) => entry.row)).toEqual(rows.slice(0, 2));
    const recovery = await savedRecovery();
    const review = GraphUpgradePreviewSchema.parse(JSON.parse(await fs.readFile(recovery.preview_path, "utf8")));
    expect(review.preserve_conflicts).toBe(true);
    expect(review.blockers).toEqual([]);
    vi.mocked(console.log).mockClear();
    expect((await resume(recovery)).replayed).toBe(true);
  });

  it("rejects history policy flags on apply/restore before accessing an instance", async () => {
    await expect(cmdGraphUpgrade(["fixture", "apply"], { "preserve-conflicts": true })).rejects.toThrow("policy bound in its saved preview");
    expect(daemon.resolve).not.toHaveBeenCalled();
  });

  it("cancels during backup without claiming completion or publishing source changes", async () => {
    const features = await danglingFixture(8, true);
    const workflows = await fs.readFile(join(data, "workflows.json"), "utf8");
    let interrupted = false;
    vi.mocked(console.log).mockImplementation(value => {
      if (!interrupted && String(value).includes("Creating verified backup")) {
        interrupted = true;
        process.listeners("SIGINT").at(-1)?.();
      }
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(cmdGraphUpgrade(["fixture"], {})).rejects.toThrow("GRAPH_UPGRADE_CANCELLED");
    expect(interrupted).toBe(true);
    expect(output()).not.toContain("Migration complete");
    expect(output().length).toBeLessThan(15_000);
    expect(error.mock.calls.flat().join(" ")).toContain("Migration stopped before publication");
    expect(await fs.readFile(join(data, "features.json"), "utf8")).toBe(features);
    expect(await fs.readFile(join(data, "workflows.json"), "utf8")).toBe(workflows);
    await expect(fs.stat(join(data, "graph_upgrade_log.json"))).rejects.toMatchObject({ code: "ENOENT" });
    const recovery = await savedRecovery();
    const review = GraphUpgradePreviewSchema.parse(JSON.parse(await fs.readFile(recovery.preview_path, "utf8")));
    expect(recovery.reviewed_digest).toBe(review.digest);
    expect(recovery.resume_arguments.slice(0, 3)).toEqual(["graph-upgrade", "fixture", "apply"]);
  });

  it("recovers a lost reply after a real commit by replaying the exact saved operation", async () => {
    await danglingFixture(8, true);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const originalApply = LegacyGraphUpgrade.prototype.apply;
    const apply = vi.spyOn(LegacyGraphUpgrade.prototype, "apply").mockImplementation(async function(this: LegacyGraphUpgrade, raw, approval) {
      const result = await originalApply.call(this, raw, approval);
      if (!result.replayed) throw new Error("LOST_REPLY_AFTER_COMMIT");
      return result;
    });
    try {
      await expect(cmdGraphUpgrade(["fixture"], {})).rejects.toThrow("LOST_REPLY_AFTER_COMMIT");
    } finally { apply.mockRestore(); }
    expect(output()).not.toContain("Migration complete");
    expect(output().length).toBeLessThan(15_000);
    expect(error.mock.calls.flat().join(" ")).toContain("Migration completion is unconfirmed");
    expect(JSON.parse(await fs.readFile(join(data, "workflows.json"), "utf8"))[0].id).toMatch(/^legacy:workflow:/);
    const before = JSON.parse(await fs.readFile(join(data, "graph_upgrade_log.json"), "utf8"));
    expect(before.entries).toHaveLength(1);
    const recovery = await savedRecovery();
    vi.mocked(console.log).mockClear();
    const replayed = await resume(recovery);
    expect(replayed.replayed).toBe(true);
    expect(replayed.receipt.operation_id).toBe(recovery.operation_id);
    const after = JSON.parse(await fs.readFile(join(data, "graph_upgrade_log.json"), "utf8"));
    expect(after).toEqual(before);
  });
});
