import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyEngineConfiguration, inspectEngineConfiguration, previewEngineTemplate, applyEngineTemplate, undoEngineConfiguration } from "../src/config/engine-configuration.js";
import { parseEngineEnvDocument, renderEngineEnvUpdates } from "../src/config/engine-env-document.js";
import { resolveComponentSettings, validateEngineEnvValues } from "../src/config/engine-setting-catalogue.js";
import { updateEngineEnvValues, loadEngineEnv } from "../src/utils/engine-env.js";
import { releaseGraphWriter } from "../src/graph/writer-lease.js";
import { updateSchedulerConfig, getSchedulerConfig, stopScheduler } from "../src/cognitive/scheduler.js";
import { updateConfig as updateEvents, getConfig as getEvents } from "../src/cognitive/event-router.js";
import { updateNarrativeConfig, getNarrativeConfig } from "../src/cognitive/narrator.js";

let root: string, path: string;
const envBefore = { ...process.env };
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "dg-config-")); path = join(root, "engine.env"); await writeFile(path, "# operator notes\nDREAMGRAPH_LLM_MODEL=gpt-4.1\nDREAMGRAPH_LLM_API_KEY=private-key\nCUSTOM_VALUE=retained\n"); });
afterEach(async () => { stopScheduler(); await releaseGraphWriter(root); await rm(root, { recursive: true, force: true }); for (const key of Object.keys(process.env)) if (!(key in envBefore)) delete process.env[key]; Object.assign(process.env, envBefore); });
const snapshot = () => inspectEngineConfiguration(path, {}, {});
describe("revisioned configuration authority", () => {
  it("commits a complete candidate, preserves custom values and redacts private inspection", async () => {
    const before = await snapshot();
    const receipt = await applyEngineConfiguration(path, { expected_revision: before.revision, operation_id: "save", updates: { DREAMGRAPH_LLM_MODEL: "gpt-6.1-sol" } });
    expect(receipt.status).toBe("committed"); expect(receipt.revision).not.toBe(before.revision);
    const values = parseEngineEnvDocument(await readFile(path, "utf8")); expect(values.CUSTOM_VALUE).toBe("retained"); expect(values.DREAMGRAPH_LLM_API_KEY).toBe("private-key");
    expect(JSON.stringify(await snapshot())).not.toContain("private-key"); expect(JSON.stringify(receipt)).not.toContain("private-key");
  });
  it("rejects concurrent saves and intervening undo rather than overwriting", async () => {
    const expected_revision = (await snapshot()).revision;
    const outcomes = await Promise.allSettled(["one", "two"].map(operation_id => applyEngineConfiguration(path, { expected_revision, operation_id, updates: { DREAMGRAPH_LLM_MODEL: operation_id } })));
    expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect((outcomes.find(result => result.status === "rejected") as PromiseRejectedResult).reason.message).toBe("CONFIG_REVISION_CONFLICT");
    const first = (outcomes.find(result => result.status === "fulfilled") as PromiseFulfilledResult<any>).value;
    const second = await applyEngineConfiguration(path, { expected_revision: first.revision, operation_id: "later", updates: { DREAMGRAPH_DEBUG: "true" } });
    await expect(undoEngineConfiguration(path, { expected_revision: second.revision, operation_id: "undo", undo_operation_id: first.operation_id })).rejects.toThrow("CONFIG_UNDO_CONFLICT");
  });
  it("replays a lost reply and rejects operation-key payload substitution", async () => {
    const input = { expected_revision: (await snapshot()).revision, operation_id: "same", updates: { DREAMGRAPH_LLM_MODEL: "gpt-5.4" } };
    const first = await applyEngineConfiguration(path, input), second = await applyEngineConfiguration(path, input);
    expect(second).toEqual({ ...first, replayed: true });
    await expect(applyEngineConfiguration(path, { ...input, updates: { DREAMGRAPH_LLM_MODEL: "gpt-5.5" } })).rejects.toThrow("CONFIG_OPERATION_REUSE_CONFLICT");
  });
  it.each(["prepared", "file_committed", "receipt_committed"])("recovers a failure at %s without another write", async step => {
    const before = await readFile(path, "utf8"), input = { expected_revision: (await snapshot()).revision, operation_id: "fault", updates: { DREAMGRAPH_LLM_MODEL: "gpt-5.4" } };
    await expect(applyEngineConfiguration(path, input, at => { if (at === step) throw Error("simulated fault"); })).rejects.toThrow("simulated fault");
    const next = await applyEngineConfiguration(path, input);
    expect(next.status).toBe(step === "prepared" ? "aborted" : "committed"); expect(next.replayed).toBe(true);
    if (step === "prepared") expect(await readFile(path, "utf8")).toBe(before);
    else expect(parseEngineEnvDocument(await readFile(path, "utf8")).DREAMGRAPH_LLM_MODEL).toBe("gpt-5.4");
  });
  it("fails closed after an external edit during uncertain commit", async () => {
    await expect(applyEngineConfiguration(path, { expected_revision: (await snapshot()).revision, operation_id: "fault", updates: { DREAMGRAPH_LLM_MODEL: "gpt-5.4" } }, () => { throw Error("fault"); })).rejects.toThrow("fault");
    await writeFile(path, "DREAMGRAPH_LLM_MODEL=external\n"); await expect(snapshot()).rejects.toThrow("CONFIG_RECOVERY_CONFLICT");
    expect(await readFile(path, "utf8")).toContain("external");
  });
  it("detects disk failures before mutating engine.env", async () => {
    const before = await readFile(path, "utf8"), revision = (await snapshot()).revision;
    await mkdir(join(root, ".engine-config")); await writeFile(join(root, ".engine-config", "unrelated"), "exists");
    // Make the intended private backup root unavailable, using an ordinary file rather than OS permissions.
    await rm(join(root, ".engine-config"), { recursive: true }); await writeFile(join(root, ".engine-config"), "blocked");
    await expect(applyEngineConfiguration(path, { expected_revision: revision, operation_id: "disk", updates: { DREAMGRAPH_DEBUG: "true" } })).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe(before);
  });
  it("previews without writes, preserves protected settings and undoes a template", async () => {
    await writeFile(path, (await readFile(path, "utf8")) + "DREAMGRAPH_INSTANCE_UUID=instance\n");
    updateEngineEnvValues(path, { DREAMGRAPH_LLM_DREAMER_RUN_BUDGET: "0", DREAMGRAPH_COMPUTER_USE: JSON.stringify({ enabled: false, route: "auto", worker_profile: null, target_profile: null, max_actions: 50, max_images: 20, max_image_bytes: 10485760, elapsed_ms: 300000, retention: "none", retention_ms: 0, remote_worker_enabled: false }) });
    const before = await readFile(path, "utf8"), template = "DREAMGRAPH_LLM_PROVIDER=ollama\nDREAMGRAPH_LLM_MODEL=qwen3:8b\nDREAMGRAPH_LLM_API_KEY=template-key\nDREAMGRAPH_INSTANCE_UUID=other\nDREAMGRAPH_LLM_DREAMER_RUN_BUDGET=100\n";
    const preview = await previewEngineTemplate(path, template); expect(await readFile(path, "utf8")).toBe(before); expect(await readdir(root)).toEqual(["engine.env"]);
    expect(preview.retained).toContain("DREAMGRAPH_LLM_DREAMER_RUN_BUDGET"); expect(JSON.stringify(preview)).not.toContain("private-key"); expect(JSON.stringify(preview)).not.toContain("template-key");
    const input = { template, expected_revision: preview.revision, expected_template_hash: preview.template_hash, operation_id: "template" };
    const applied = await applyEngineTemplate(path, input); expect((await applyEngineTemplate(path, input)).replayed).toBe(true);
    const values = parseEngineEnvDocument(await readFile(path, "utf8")); expect(values.DREAMGRAPH_LLM_API_KEY).toBe("private-key"); expect(values.DREAMGRAPH_INSTANCE_UUID).toBe("instance"); expect(values.DREAMGRAPH_LLM_DREAMER_RUN_BUDGET).toBe("0"); expect(values.CUSTOM_VALUE).toBe("retained");
    await undoEngineConfiguration(path, { expected_revision: applied.revision, undo_operation_id: "template", operation_id: "undo-template" }); expect(await readFile(path, "utf8")).toBe(before);
  });
  it("shows deployment precedence separately from persisted intent and actual runtime", async () => {
    const state = await inspectEngineConfiguration(path, { DREAMGRAPH_LLM_MODEL: "gpt-5.5" }, { DREAMGRAPH_LLM_MODEL: "gpt-5.5" });
    expect(state.settings.find(row => row.key === "DREAMGRAPH_LLM_MODEL")).toMatchObject({ persisted: "gpt-4.1", effective: "gpt-5.5", source: "deployment", mismatch: true });
  });
  it.each(["NaN", "Infinity", "-1", "1junk"])("rejects %s before any file or runtime change", async invalid => {
    const before = await readFile(path, "utf8"); await expect(applyEngineConfiguration(path, { expected_revision: (await snapshot()).revision, operation_id: "invalid", updates: { DG_SCHEDULER_MAX_RUNS_HR: invalid } })).rejects.toThrow("CONFIG_INVALID_SETTING");
    expect(await readFile(path, "utf8")).toBe(before); expect(await readdir(root)).toEqual(["engine.env"]);
  });
  it("rejects unknown and read-only changes including deletion", async () => {
    const base = { expected_revision: (await snapshot()).revision, operation_id: "invalid" };
    await expect(applyEngineConfiguration(path, { ...base, updates: { CUSTOM_VALUE: null } })).rejects.toThrow("CONFIG_UNKNOWN_KEY");
    await expect(applyEngineConfiguration(path, { ...base, updates: { DREAMGRAPH_RUN_ID: null } })).rejects.toThrow("CONFIG_READ_ONLY");
  });
  it("round-trips Windows paths, JSON, quotes, empty secrets and duplicate keys", async () => {
    const original = 'DREAMGRAPH_LLM_MODEL=old\nDREAMGRAPH_LLM_MODEL=shadow\nCUSTOM_PATH="C:\\new folder\\tree"\n';
    const repos = JSON.stringify({ source: "C:\\Users\\Name With Spaces\\repo" });
    const next = renderEngineEnvUpdates(original, { DREAMGRAPH_LLM_MODEL: "chosen", DREAMGRAPH_REPOS: repos, DREAMGRAPH_LLM_API_KEY: "", DREAMGRAPH_LLM_MODEL_EXTRA: 'say "hello" # yes' });
    const values = parseEngineEnvDocument(next); expect(values.CUSTOM_PATH).toBe("C:\\new folder\\tree"); expect(values.DREAMGRAPH_REPOS).toBe(repos); expect(values.DREAMGRAPH_LLM_MODEL).toBe("chosen"); expect(values.DREAMGRAPH_LLM_API_KEY).toBe(""); expect(values.DREAMGRAPH_LLM_MODEL_EXTRA).toBe('say "hello" # yes');
    updateEngineEnvValues(path, { DREAMGRAPH_REPOS: repos, DREAMGRAPH_LLM_API_KEY: "" }); loadEngineEnv(path); expect(process.env.DREAMGRAPH_REPOS).toBe(repos); expect(process.env.DREAMGRAPH_LLM_API_KEY).toBe("");
  });
  it("preserves valid zero throttles and rejects contradictory narrative intervals", () => {
    expect(resolveComponentSettings("scheduler", { DG_SCHEDULER_MAX_RUNS_HR: "0", DG_SCHEDULER_COOLDOWN: "0" })).toMatchObject({ max_runs_per_hour: 0, global_cooldown_ms: 0 });
    expect(() => validateEngineEnvValues({ DREAMGRAPH_NARRATIVE: JSON.stringify({ narrative_interval: 50, digest_interval: 10 }) })).toThrow("CONFIG_INVALID_COMPONENT");
  });
  it("runtime setters validate the whole candidate before mutation", () => {
    const scheduler = getSchedulerConfig(), events = getEvents(), narrative = getNarrativeConfig();
    expect(() => updateSchedulerConfig({ tick_interval_ms: NaN })).toThrow(); expect(getSchedulerConfig()).toEqual(scheduler);
    expect(() => updateEvents({ cooldown_ms: -1 })).toThrow(); expect(getEvents()).toEqual(events);
    expect(() => updateNarrativeConfig({ digest_interval: 1 })).toThrow(); expect(getNarrativeConfig()).toEqual(narrative);
  });
});
