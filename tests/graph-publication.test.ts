import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setDataDirOverride } from "../src/utils/paths.js";
import { setDataDirResolver, invalidateCache, loadJsonData } from "../src/utils/cache.js";
import { withGraphRead, withGraphMutation } from "../src/utils/graph-reconciliation-barrier.js";
import { assertGraphWriter, releaseGraphWriter } from "../src/graph/writer-lease.js";
import { acknowledgePublicationEvents, drainPublicationEvents, retirePublicationEpoch, commitGraphWrites, findOperationReceipt, loadPublicationState, recoverGraphPublication } from "../src/graph/publication.js";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "dg-publication-"));
  setDataDirOverride(directory);
  setDataDirResolver(() => directory);
  invalidateCache();
});
afterEach(async () => {
  await releaseGraphWriter(directory);
  setDataDirOverride(null);
  invalidateCache();
  await rm(directory, { recursive: true, force: true });
});
const writes = (name = "one") => [{ file: "features.json", content: JSON.stringify([{ id: "feature", name }]) }];

describe("canonical graph publication", () => {
  it("bounds durable result size before touching a store", async () => {
    await expect(commitGraphWrites({ writes: writes(), result: { oversized: "x".repeat(65_536) } })).rejects.toThrow("RECEIPT_RESULT_LIMIT_EXCEEDED");
    expect(await readdir(directory)).toEqual([]);
  });
  it("drains stable notification IDs without losing failures or changing graph currency", async () => {
    await commitGraphWrites({ writes: writes("one"), operation_id: "outbox:1" });
    const last = await commitGraphWrites({ writes: writes("two"), operation_id: "outbox:2" });
    const pending = (await loadPublicationState()).outbox;
    const observed: string[] = [];
    await expect(drainPublicationEvents(async event => { observed.push(event.id); if (event.operation_id === "outbox:2") throw Error("sink unavailable"); })).rejects.toThrow("sink unavailable");
    expect((await loadPublicationState()).outbox.map(event => event.id)).toEqual([pending[1].id]);
    expect(await drainPublicationEvents(async event => { observed.push(event.id); })).toBe(1);
    expect(observed).toEqual([pending[0].id, pending[1].id, pending[1].id]);
    expect((await loadPublicationState()).currency).toEqual(last.receipt.currency);
  });
  it.each(["journal_prepared", "publication_committed"])("recovers notification acknowledgment at %s", async step => {
    const result = await commitGraphWrites({ writes: writes(), operation_id: "outbox" });
    const event = (await loadPublicationState()).outbox[0];
    await expect(acknowledgePublicationEvents([event.id], at => { if (at === step) throw Error("ack lost"); })).rejects.toThrow("ack lost");
    expect((await loadPublicationState()).outbox).toHaveLength(step === "publication_committed" ? 0 : 1);
    expect((await loadPublicationState()).currency).toEqual(result.receipt.currency);
  });
  it("requires delivery and quiescence before explicit epoch retirement; rejects archived and unqualified replay", async () => {
    const committed = await commitGraphWrites({ writes: writes(), actor: "agent", operation_id: "archived" });
    let state = await loadPublicationState();
    const input = { expected_epoch: state.epoch, expected_sequence: state.revision.publication_sequence, retirement_id: "retire:1", reason: "Fixture quiescent receipt rotation", assert_quiescent: async () => {} };
    await expect(retirePublicationEpoch(input)).rejects.toThrow("OUTBOX_DELIVERY_PENDING");
    await drainPublicationEvents(async () => {}); state = await loadPublicationState(); input.expected_sequence = state.revision.publication_sequence;
    await expect(retirePublicationEpoch({ ...input, assert_quiescent: async () => { throw Error("job owns old epoch"); } })).rejects.toThrow("job owns old epoch");
    const retired = await retirePublicationEpoch(input);
    expect(retired.epoch).not.toBe(committed.receipt.epoch);
    expect(JSON.parse(await readFile(join(directory, retired.archive), "utf8")).receipts).toMatchObject(state.receipts);
    expect((await loadPublicationState()).receipts).toEqual({});
    expect((await loadPublicationState()).currency).toEqual(committed.receipt.currency);
    expect((await retirePublicationEpoch(input)).replayed).toBe(true);
    await expect(commitGraphWrites({ writes: writes(), actor: "agent", operation_id: "archived", operation_epoch: committed.receipt.epoch })).rejects.toThrow("RECEIPT_EXPIRED_RECONCILIATION_REQUIRED");
    await expect(findOperationReceipt("archived", "agent", committed.receipt.epoch)).rejects.toThrow("RECEIPT_EXPIRED_RECONCILIATION_REQUIRED");
    await expect(commitGraphWrites({ writes: writes("new"), operation_id: "unqualified" })).rejects.toThrow("OPERATION_EPOCH_REQUIRED");
    await expect(findOperationReceipt("archived", "agent")).rejects.toThrow("OPERATION_EPOCH_REQUIRED");
    expect((await commitGraphWrites({ writes: writes("new"), operation_id: "new", operation_epoch: retired.epoch })).replayed).toBe(false);
  });
  it.each(["after_replace:0:", "publication_committed"])("keeps receipt retirement atomic across %s", async step => {
    const committed = await commitGraphWrites({ writes: writes(), operation_id: "retire-fault" });
    await drainPublicationEvents(async () => {}); const before = await loadPublicationState();
    const input = { expected_epoch: before.epoch, expected_sequence: before.revision.publication_sequence, retirement_id: "retire:fault", reason: "Fixture fault", assert_quiescent: async () => {} };
    await expect(retirePublicationEpoch({ ...input, fault_inject: at => { if (at.startsWith(step)) throw Error("retire lost"); } })).rejects.toThrow("retire lost");
    const after = await loadPublicationState();
    expect(after.currency).toEqual(committed.receipt.currency);
    if (step === "publication_committed") { expect(after.retired_epochs).toContain(before.epoch); expect((await retirePublicationEpoch(input)).replayed).toBe(true); }
    else { expect(after).toEqual(before); expect((await readdir(directory)).filter(file => file.startsWith("receipt_epoch_"))).toEqual([]); }
  });
  it("leaves unknown legacy dates null and does not initialize disk on a read", async () => {
    const state = await loadPublicationState();
    expect(state.revision.graph_revision).toBeNull();
    expect(Object.values(state.currency).filter(v => v !== null && !Array.isArray(v))).toEqual([]);
    expect(await readdir(directory)).toEqual([]);
  });

  it("separates graph mutations, source reconciliation and full scan history", async () => {
    const full = await commitGraphWrites({ writes: writes(), actor: "scan", operation_id: "full",
      source_reconciliation: { revision: "source:1", scope: ["repo:a"], full: true } });
    const dream = await commitGraphWrites({ writes: [{ file: "dream_graph.json", content: '{"nodes":[],"edges":[]}' }], actor: "dream", operation_id: "dream" });
    expect(dream.receipt.currency.last_full_scan_at).toBe(full.receipt.currency.last_full_scan_at);
    expect(dream.receipt.currency.source_reconciliation_revision).toBe("source:1");
    const checkpoint = await commitGraphWrites({ writes: [{ file: "enrichment_state.json", content: '{"job":"waiting"}' }], operation_id: "checkpoint" });
    expect(checkpoint.receipt.revision.graph_revision).toBe(dream.receipt.revision.graph_revision);
    expect(checkpoint.receipt.currency).toEqual(dream.receipt.currency);
    expect(checkpoint.receipt.revision.publication_sequence).toBeGreaterThan(dream.receipt.revision.publication_sequence);
  });

  it("replays a lost reply exactly once, before testing stale expected revisions", async () => {
    const input = { writes: writes(), actor: "agent:a", operation_id: "change:1", expected_graph_revision: null };
    await expect(commitGraphWrites({ ...input, fault_inject: step => {
      if (step === "publication_committed") throw new Error("reply lost");
    } })).rejects.toThrow("reply lost");
    const recovered = await findOperationReceipt("change:1", "agent:a");
    expect(recovered?.outcome).toBe("committed");
    const retry = await commitGraphWrites(input);
    expect(retry.replayed).toBe(true);
    expect(retry.receipt).toEqual(recovered);
    expect((await loadPublicationState()).outbox).toHaveLength(1);
    await expect(commitGraphWrites({ ...input, writes: writes("different") })).rejects.toThrow("OPERATION_IDENTITY_CONFLICT");
  });

  it("persists explicit no-change receipts without advancing graph mutation time", async () => {
    const first = await commitGraphWrites({ writes: writes(), operation_id: "first" });
    const unchanged = await commitGraphWrites({ writes: writes(), operation_id: "noop" });
    expect(unchanged.receipt.outcome).toBe("no_change");
    expect(unchanged.receipt.revision.graph_revision).toBe(first.receipt.revision.graph_revision);
    expect(unchanged.receipt.currency.last_graph_mutation_at).toBe(first.receipt.currency.last_graph_mutation_at);
    expect((await commitGraphWrites({ writes: writes(), operation_id: "noop" })).receipt).toEqual(unchanged.receipt);
  });

  it("fences deleted or altered published stores instead of silently overwriting them", async () => {
    await commitGraphWrites({ writes: writes() });
    await writeFile(join(directory, "features.json"), "[]");
    await expect(commitGraphWrites({ writes: writes("two") })).rejects.toThrow("UNPUBLISHED_STORE_CHANGE");
    await rm(join(directory, "features.json"));
    await expect(commitGraphWrites({ writes: writes("two") })).rejects.toThrow("UNPUBLISHED_STORE_CHANGE");
  });

  it("blocks reads after interrupted rollback until explicit recovery restores the complete set", async () => {
    await writeFile(join(directory, "features.json"), "[]");
    await expect(commitGraphWrites({ writes: writes(), fault_inject: step => {
      if (step === "after_replace:0:features.json" || step === "recovery_before_restore:0:features.json") throw new Error(step);
    } })).rejects.toThrow("RECONCILIATION_RECOVERY_REQUIRED");
    await expect(loadJsonData("features.json")).rejects.toThrow("GRAPH_RECOVERY_REQUIRED");
    expect(await recoverGraphPublication()).toBe("rolled_back");
    expect(await loadJsonData("features.json")).toEqual([]);
    expect((await loadPublicationState()).currency.last_graph_mutation_at).toBeNull();
  });

  it("rejects unsafe journal participants before attempting any restore", async () => {
    await writeFile(join(directory, "reconciliation_journal.json"), JSON.stringify({
      schema: "dreamgraph.reconciliation_journal.v1", transaction_id: "unsafe", status: "committing",
      expected_revision: null, next_revision: "next", writes: [{ file: "../outside.json", next: "[]", previous: "[]" }],
    }));
    await expect(recoverGraphPublication()).rejects.toThrow("UNSAFE_PUBLICATION_PATH");
    expect(await readdir(directory)).toEqual(["reconciliation_journal.json"]);
  });

  it("rejects Windows path aliases and reserved marker names on every platform", async () => {
    for (const file of ["features.json.", "features.json ", "nul.json", "../features.json", "C:features.json"]) {
      await expect(commitGraphWrites({ writes: [{ file, content: "[]" }] })).rejects.toThrow("UNSAFE_PUBLICATION_PATH");
    }
    await expect(commitGraphWrites({ writes: [{ file: "PUBLICATION_STATE.json", content: "{}" }] })).rejects.toThrow("PUBLICATION_INTERNAL_ONLY");
    expect(await readdir(directory)).toEqual([]);
  });

  it("rejects nested mutations and read-to-write upgrades without deadlocking", async () => {
    await expect(withGraphRead(() => withGraphMutation(async () => undefined))).rejects.toThrow("GRAPH_READ_UPGRADE_FORBIDDEN");
    await expect(commitGraphWrites({ writes: writes(), before_commit: () => commitGraphWrites({ writes: writes("nested") }) })).rejects.toThrow("NESTED_PUBLICATION_FORBIDDEN");
    expect((await loadPublicationState()).revision.publication_sequence).toBe(0);
  });

  it("reacquires ownership for asynchronous work that outlives its originating publication", async () => {
    let resume!: () => void;
    const gate = new Promise<void>(resolve => { resume = resolve; });
    let followup!: Promise<unknown>;
    await commitGraphWrites({ writes: writes(), before_commit: async () => {
      followup = (async () => { await gate; return commitGraphWrites({ writes: writes("followup") }); })();
    } });
    resume();
    await followup;
    expect((await loadPublicationState()).revision.publication_sequence).toBe(2);
    expect(await loadJsonData("features.json")).toEqual([{ id: "feature", name: "followup" }]);
  });

  it("leaves malformed recovery input untouched and reports a recovery boundary", async () => {
    await writeFile(join(directory, "reconciliation_journal.json"), "{broken");
    await expect(recoverGraphPublication()).rejects.toThrow("GRAPH_RECOVERY_REQUIRED");
    expect(await readFile(join(directory, "reconciliation_journal.json"), "utf8")).toBe("{broken");
    expect(await readdir(directory)).toEqual(["reconciliation_journal.json"]);
  });

  it("isolates caches by physical instance even for the same file name", async () => {
    await writeFile(join(directory, "features.json"), '[{"id":"first"}]');
    expect(await loadJsonData("features.json")).toEqual([{ id: "first" }]);
    const other = await mkdtemp(join(tmpdir(), "dg-publication-other-"));
    try {
      await writeFile(join(other, "features.json"), '[{"id":"second"}]');
      setDataDirOverride(other);
      setDataDirResolver(() => other);
      expect(await loadJsonData("features.json")).toEqual([{ id: "second" }]);
    } finally {
      setDataDirOverride(directory);
      setDataDirResolver(() => directory);
      await rm(other, { recursive: true, force: true });
    }
  });

  it("holds sole kernel writer ownership across processes and releases it on crash", async () => {
    const moduleUrl = pathToFileURL(resolve("src/graph/writer-lease.ts")).href;
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "--eval",
      `import {assertGraphWriter} from ${JSON.stringify(moduleUrl)}; await assertGraphWriter(${JSON.stringify(directory)}); console.log('leased'); setInterval(()=>{},1000);`],
      { stdio: ["ignore", "pipe", "pipe"] });
    let errors = "";
    child.stderr.on("data", chunk => { errors += chunk; });
    try {
      await new Promise<void>((done, reject) => {
        child.stdout.on("data", chunk => { if (String(chunk).includes("leased")) done(); });
        child.once("error", reject);
        child.once("exit", code => reject(new Error(`lease worker exited ${code}: ${errors}`)));
      });
      await expect(assertGraphWriter(directory)).rejects.toThrow("INSTANCE_WRITER_UNAVAILABLE");
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
      await expect(assertGraphWriter(directory)).resolves.toBeUndefined();
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
  });
});
