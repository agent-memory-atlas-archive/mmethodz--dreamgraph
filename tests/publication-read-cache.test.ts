import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitGraphWrites, loadPublicationState, readPublicationStamp, acknowledgePublicationEvents } from "../src/graph/publication.js";
import { releaseGraphWriter } from "../src/graph/writer-lease.js";
import { withDataDirectory } from "../src/utils/paths.js";
let directory: string, other: string;
beforeEach(async () => { directory = await fs.mkdtemp(join(tmpdir(), "dg-publication-cache-")); other = await fs.mkdtemp(join(tmpdir(), "dg-publication-cache-other-")); });
afterEach(async () => { vi.restoreAllMocks(); for (const root of [directory, other]) { await releaseGraphWriter(root); await fs.rm(root, { recursive: true, force: true }); } });
const scope = <T>(work: () => T) => withDataDirectory(directory, work);
it("amortizes large receipt reads across simultaneous plan-size requests while snapshots stay immutable", async () => {
  await scope(() => commitGraphWrites({ operation_id: "original", writes: [{ file: "features.json", content: '[{"id":"one"}]' }] }));
  const state = await scope(loadPublicationState); const spy = vi.spyOn(fs, "readFile");
  const results = await scope(() => Promise.all(Array.from({ length: 92 }, async () => [await readPublicationStamp(), await loadPublicationState()])));
  expect(spy.mock.calls.filter(call => String(call[0]).endsWith("publication_state.json"))).toHaveLength(0);
  expect(results.every(result => result[1] === state)).toBe(true);
  expect(() => { state.revision.publication_sequence = 99; }).toThrow();
  expect(() => { state.outbox[0].scope.push("forged"); }).toThrow();
  expect((await scope(loadPublicationState)).revision.publication_sequence).toBe(1);
});
it("revalidates rewritten bytes even when mtime and size are preserved, and never caches a parse failure", async () => {
  await scope(() => commitGraphWrites({ writes: [{ file: "features.json", content: "[]" }] })); await scope(loadPublicationState);
  const file = join(directory, "publication_state.json"), original = await fs.readFile(file, "utf8"), info = await fs.stat(file);
  await fs.writeFile(file, original.replace('"dreamgraph.publication.v1"', '"dreamgraph.publication.x1"')); await fs.utimes(file, info.atime, info.mtime);
  await expect(scope(loadPublicationState)).rejects.toThrow("GRAPH_RECOVERY_REQUIRED");
  await fs.writeFile(file, original); expect((await scope(loadPublicationState)).schema).toBe("dreamgraph.publication.v1");
});
it("detects atomic replacement, absence, and a journal despite a warm physical version", async () => {
  await scope(() => commitGraphWrites({ writes: [{ file: "features.json", content: "[]" }] })); const original = await scope(loadPublicationState);
  const file = join(directory, "publication_state.json"), body = JSON.parse(await fs.readFile(file, "utf8")); body.revision.publication_sequence++;
  await fs.writeFile(file + ".next", JSON.stringify(body)); await fs.rename(file + ".next", file);
  expect((await scope(loadPublicationState)).revision.publication_sequence).toBe(original.revision.publication_sequence + 1);
  await fs.writeFile(join(directory, "reconciliation_journal.json"), "pending"); await expect(scope(loadPublicationState)).rejects.toThrow("GRAPH_RECOVERY_REQUIRED");
  await fs.unlink(join(directory, "reconciliation_journal.json")); await fs.unlink(file);
  expect((await scope(loadPublicationState)).epoch).toBe("uninitialized");
});
it("isolates equal-sized physical instances and leaves mutable acknowledgement state private to its writer", async () => {
  await scope(() => commitGraphWrites({ operation_id: "same", writes: [{ file: "features.json", content: '[{"id":"one"}]' }] }));
  await withDataDirectory(other, () => commitGraphWrites({ operation_id: "same", writes: [{ file: "features.json", content: '[{"id":"two"}]' }] }));
  const state = await scope(loadPublicationState), second = await withDataDirectory(other, loadPublicationState); expect(second.epoch).not.toBe(state.epoch);
  await scope(() => acknowledgePublicationEvents(state.outbox.map(item => item.id)));
  expect(state.outbox).toHaveLength(1); expect((await scope(loadPublicationState)).outbox).toHaveLength(0);
  expect((await withDataDirectory(other, loadPublicationState)).outbox).toHaveLength(1);
});
