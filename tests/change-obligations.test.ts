import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setDataDirOverride } from "../src/utils/paths.js";
import { releaseGraphWriter } from "../src/graph/writer-lease.js";
import { config } from "../src/config/config.js";
import { managedSourceEffect, managedSourceWrite, readChangeObligations, readDirtyPartitions, recoverSourceEffects, beginObservedSourceEffect, settleObservedSourceEffect } from "../src/graph/change-obligations.js";
import { commitGraphWrites, loadPublicationState } from "../src/graph/publication.js";
import { ComputerActionSchema, ComputerObservationSchema, ComputerReceiptSchema } from "../src/graph/contracts.js";
import { createHash } from "node:crypto";
import { withReconciliationTransaction } from "../src/tools/reconciliation-transaction.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerCodeSensesTools } from "../src/tools/code-senses.js";
import { EngineJobs } from "../src/cognitive/jobs.js";

let root: string, source: string;
const originalRepos = { ...config.repos };
beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), "dg-change-effect-"));
  const data = join(root, "data"); await fs.mkdir(data); setDataDirOverride(data);
  const repo = join(root, "repo"); await fs.mkdir(repo); config.repos = { fixture: repo };
  source = join(repo, "a.ts"); await fs.writeFile(source, "before");
});
afterEach(async () => { await releaseGraphWriter(join(root, "data")); setDataDirOverride(null); config.repos = { ...originalRepos }; await fs.rm(root, { recursive: true, force: true }); });
const effect = (fault?: "intent_committed" | "effect_applied" | "effect_recorded") => ({
  operation_id: "effect:1", changes: [{ file: source, content: "after", expected_content: "before" }],
  apply: () => fs.writeFile(source, "after"), fault_inject: (stage: string) => { if (stage === fault) throw new Error("simulated crash"); },
});
describe("durable source change obligations", () => {
  it("an unchanged managed edit settles source debt without graph mutation or repeated input", async () => {
    let writes = 0;
    const input = { operation_id: "noop-edit", changes: [{ file: source, content: "before", expected_content: "before" }],
      apply: async () => { writes++; await fs.writeFile(source, "before"); } };
    const first = await managedSourceEffect(input);
    expect(first.state).toBe("failed");
    expect(await managedSourceEffect(input)).toEqual(first);
    expect(writes).toBe(1);
    expect((await readDirtyPartitions()).partitions).toEqual([expect.objectContaining({ state: "settled", pending_stages: [], root_cause_ids: [] })]);
    expect((await loadPublicationState()).currency.last_graph_mutation_at).toBeNull();
  });
  it("a lost no-op result recovers without scheduling enrichment or repeating the write", async () => {
    let writes = 0;
    const input = { operation_id: "noop-lost", changes: [{ file: source, content: "before" }],
      apply: async () => { writes++; await fs.writeFile(source, "before"); },
      fault_inject: (stage: string) => { if (stage === "effect_applied") throw new Error("lost acknowledgement"); } };
    await expect(managedSourceEffect(input)).rejects.toThrow("RECOVERY_REQUIRED");
    expect((await recoverSourceEffects()).unknown).toEqual([]);
    expect((await managedSourceEffect(input)).state).toBe("failed");
    expect(writes).toBe(1);
    expect((await readDirtyPartitions()).partitions[0].pending_stages).toEqual([]);
  });
  it("an exact observed acknowledgement replays after reconciliation and an observation failure cannot erase it", async () => {
    const before = { "source:fixture/a.ts": "before-hash", "source:fixture/unchanged.ts": "same-hash" };
    const after = { "source:fixture/unchanged.ts": "same-hash", "source:fixture/a.ts": "sha256:" + createHash("sha256").update("before").digest("hex") };
    const intent = await beginObservedSourceEffect({ operation_id: "observed-replay", execution_id: "fixture-execution", actor: "fixture", repositories: ["fixture"], before_hashes: before });
    await settleObservedSourceEffect(intent.id, after);
    await withReconciliationTransaction({ expected_revision: null, next_revision: "observed-repaired", operation_id: "observed-repair", read_current_revision: async () => null,
      change_obligation_ids: [intent.id], writes: [{ file: "features.json", content: '[{"id":"a","source_repo":"fixture","source_files":["a.ts"]}]' }] });
    const first = (await readChangeObligations()).entries[0], publication = await loadPublicationState();
    expect(first.state).toBe("graph_committed");
    expect(await settleObservedSourceEffect(intent.id, { ...after })).toEqual(first);
    expect(await settleObservedSourceEffect(intent.id, null)).toEqual(first);
    expect((await loadPublicationState()).revision).toEqual(publication.revision);
    await expect(settleObservedSourceEffect(intent.id, { ...after, "source:fixture/new.ts": "new-hash" })).rejects.toThrow("REPLAY_CONFLICT");
    expect((await readChangeObligations()).entries[0]).toEqual(first);
  });
  it("exact managed source replay preserves the implicit parent execution binding and writes once",async()=>{
    const jobs=new EngineJobs(join(root,"data"));const record=await jobs.accept({operation_id:"managed-parent",owner:"fixture",action:"source_write",scope:["fixture"],roles:["normalizer"]});
    let writes=0;
    const result=await jobs.run(record.job.id,async()=>{
      const input={...effect(),apply:async()=>{writes++;await fs.writeFile(source,"after");}};
      const first=await managedSourceEffect(input);expect(first.execution_id).toBe(record.job.id);
      expect(await managedSourceEffect(input)).toEqual(first);return first.id;
    });
    expect(writes).toBe(1);expect((await readChangeObligations()).entries.map(entry=>entry.id)).toEqual([result]);
  });
  it("retains C17 effect-double evidence across a lost action result without repeating input or claiming graph reconciliation", async () => {
    const now = new Date().toISOString(), expires = new Date(Date.now() + 60_000).toISOString();
    const observation = ComputerObservationSchema.parse({ schema: "dreamgraph.computer_observation.v1", id: "observed:before", target_id: "fixture-target", target_generation: 1,
      execution_id: "fixture-execution", kind: "api_state", observed_at: now, expires_at: expires, artifact_ref: null,
      content_hash: "sha256:" + createHash("sha256").update(await fs.readFile(source)).digest("hex"), evidence_ids: [], verified: true });
    const action = ComputerActionSchema.parse({ schema: "dreamgraph.computer_action.v1", id: "fixture-click", execution_id: "fixture-execution", target_id: observation.target_id,
      target_generation: 1, observation_id: observation.id, grant_id: "fixture-grant", operation: "click", parameters: { locator: "fixture:save" }, postcondition: "source bytes equal after", fence: 1 });
    const receipt = ComputerReceiptSchema.parse({ schema: "dreamgraph.computer_receipt.v1", id: "fixture-receipt", action_id: action.id, state: "dispatched", observed_at: now,
      observation_ids: [observation.id], change_obligation_ids: [], graph_receipt_id: null, reason: null });
    await commitGraphWrites({ writes: [{ file: "computer_effect_fixture.json", content: JSON.stringify({ action, observations: [observation], receipt }) }], actor: "fixture-worker", operation_id: "fixture:dispatch" });
    let inputs = 0;
    const input = { ...effect("effect_applied"), operation_id: action.id, execution_id: action.execution_id, actor: "fixture-worker",
      apply: async () => { inputs++; await fs.writeFile(source, "after"); } };
    await expect(managedSourceEffect(input)).rejects.toThrow("RECOVERY_REQUIRED");
    receipt.state = "unknown"; receipt.change_obligation_ids = [(await readChangeObligations()).entries[0].id]; receipt.reason = "Lost external result; observe, never repeat input.";
    await commitGraphWrites({ writes: [{ file: "computer_effect_fixture.json", content: JSON.stringify({ action, observations: [observation], receipt }) }], operation_id: "fixture:unknown" });
    expect((await loadPublicationState()).currency.last_graph_mutation_at).toBeNull();
    await expect(managedSourceEffect(input)).rejects.toThrow("RECOVERY_REQUIRED"); expect(inputs).toBe(1);
    await recoverSourceEffects();
    const postcondition = ComputerObservationSchema.parse({ ...observation, id: "observed:after", kind: "postcondition",
      content_hash: "sha256:" + createHash("sha256").update(await fs.readFile(source)).digest("hex") });
    receipt.state = "verified"; receipt.observation_ids.push(postcondition.id); receipt.reason = null;
    await commitGraphWrites({ writes: [{ file: "computer_effect_fixture.json", content: JSON.stringify({ action, observations: [observation, postcondition], receipt }) }], operation_id: "fixture:verified" });
    const entry = await managedSourceEffect(input); expect(inputs).toBe(1); expect(entry.state).toBe("reconciliation_pending");
    expect(receipt.graph_receipt_id).toBeNull(); expect((await readDirtyPartitions()).partitions[0].pending_stages).toContain("reconciliation");
    const reconciledReceipt = ComputerReceiptSchema.parse({ ...receipt, graph_receipt_id: "fixture:reconcile" });
    const result = await withReconciliationTransaction({ expected_revision: null, next_revision: "fixture:source:1", operation_id: "fixture:reconcile", read_current_revision: async () => null,
      change_obligation_ids: [entry.id], reconciliation_scope: entry.scope, writes: [
        { file: "features.json", content: '[{"id":"a","source_repo":"fixture","source_files":["a.ts"],"description":"after"}]' },
        { file: "computer_effect_fixture.json", content: JSON.stringify({ action, observations: [observation, postcondition], receipt: reconciledReceipt }) },
      ] });
    const persisted = JSON.parse(await fs.readFile(join(root, "data", "computer_effect_fixture.json"), "utf8"));
    expect(persisted.receipt.graph_receipt_id).toBe(result.receipt.operation_id);
    expect((await readChangeObligations()).entries[0]).toMatchObject({ state: "graph_committed", graph_receipt_id: result.receipt.operation_id });
    expect(inputs).toBe(1);
  });
  it("tracks real MCP create/edit/rename/delete commands through durable obligations", async () => {
    const server = new McpServer({ name: "source-effect-fixture", version: "1" }); registerCodeSensesTools(server);
    const client = new Client({ name: "source-client", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
    try {
      for (const [name, args] of [
        ["create_file", { filePath: "new.ts", content: "export const value = 1;", repo: "fixture" }],
        ["edit_file", { filePath: "new.ts", old_text: "value = 1", new_text: "value = 2", repo: "fixture" }],
        ["rename_file", { oldPath: "new.ts", newPath: "renamed.ts", repo: "fixture" }],
        ["delete_file", { filePath: "renamed.ts", repo: "fixture" }],
      ] as const) {
        const response = await client.callTool({ name, arguments: args });
        expect(JSON.parse((response.content as Array<{ text: string }>)[0].text), name).toMatchObject({ success: true, data: expect.stringContaining("Graph reconciliation pending") });
      }
      const ledger = await readChangeObligations(); expect(ledger.entries).toHaveLength(4);
      expect(ledger.entries.every(entry => entry.state === "reconciliation_pending")).toBe(true);
    } finally { await client.close(); await server.close(); }
  });
  it("the actual MCP edit tool reports an unchanged write without requesting reconciliation", async () => {
    const server = new McpServer({ name: "source-noop-fixture", version: "1" }); registerCodeSensesTools(server);
    const client = new Client({ name: "source-client", version: "1" });
    const [a,b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
    try {
      const result = await client.callTool({ name: "edit_file", arguments: { filePath: "a.ts", old_text: "before", new_text: "before", repo: "fixture" } });
      const payload = JSON.parse((result.content as Array<{text:string}>)[0].text);
      expect(payload).toMatchObject({ success: true, data: expect.stringContaining("Source unchanged; no graph reconciliation required") });
      expect((await readChangeObligations()).entries[0].state).toBe("failed");
      expect((await readDirtyPartitions()).partitions[0]).toMatchObject({ state: "settled", pending_stages: [] });
    } finally { await client.close(); await server.close(); }
  });
  it("publishes the reconciled obligation at the same graph boundary and retains later enrichment/digestion debt", async () => {
    const entry = await managedSourceEffect(effect());
    await expect(withReconciliationTransaction({ expected_revision: null, next_revision: "scan:1", operation_id: "reconcile:1",
      writes: [{ file: "features.json", content: '[{"id":"a","source_repo":"fixture","source_files":["a.ts"]}]' }],
      read_current_revision: async () => null, change_obligation_ids: [entry.id],
      fault_inject: stage => { if (stage === "after_replace:0:features.json") throw new Error("disk fault"); },
    })).rejects.toThrow("disk fault");
    expect((await readChangeObligations()).entries[0].state).toBe("reconciliation_pending");
    const result = await withReconciliationTransaction({ expected_revision: null, next_revision: "scan:1", operation_id: "reconcile:1",
      writes: [{ file: "features.json", content: '[{"id":"a","source_repo":"fixture","source_files":["a.ts"]}]' }],
      read_current_revision: async () => null, change_obligation_ids: [entry.id] });
    expect((await readChangeObligations()).entries[0]).toMatchObject({ state: "graph_committed", graph_receipt_id: result.receipt.operation_id });
    expect((await readDirtyPartitions()).partitions[0]).toMatchObject({ state: "ready", pending_stages: ["enrichment", "digestion"], stage_receipt_ids: ["reconcile:1"] });
  });
  it("records intent before touching source, retains dirty scope and does not pretend to mutate graph time", async () => {
    let seen = false;
    const entry = await managedSourceEffect({ ...effect(), apply: async () => {
      expect((await readChangeObligations()).entries[0].state).toBe("intent");
      expect((await readDirtyPartitions()).partitions[0].state).toBe("awaiting_reconciliation");
      seen = true; await fs.writeFile(source, "after");
    } });
    expect(seen).toBe(true); expect(entry.state).toBe("reconciliation_pending");
    expect(entry.scope).toEqual(["source:fixture/a.ts"]);
    expect((await readDirtyPartitions()).partitions[0].generation).toBe(1);
    expect((await loadPublicationState()).currency.last_graph_mutation_at).toBeNull();
  });
  it("rejects stale source input before creating an effect", async () => {
    await expect(managedSourceWrite(source, "after", "wrong baseline")).rejects.toThrow("SOURCE_REVISION_CONFLICT");
    expect((await readChangeObligations()).entries).toEqual([]);
    expect(await fs.readFile(source, "utf8")).toBe("before");
  });
  it('binds reviewed source hashes to intent and exact replay without repeating a write',async()=>{
    const expected_hash='sha256:'+createHash('sha256').update('before').digest('hex');let writes=0;
    const input={operation_id:'hash-bound-review',changes:[{file:source,content:'after',expected_hash}],apply:async()=>{writes++;await fs.writeFile(source,'after');}};
    const first=await managedSourceEffect(input);expect(first.state).toBe('reconciliation_pending');
    expect(await managedSourceEffect(input)).toEqual(first);expect(writes).toBe(1);
    await expect(managedSourceEffect({...input,changes:[{...input.changes[0],expected_hash:'sha256:'+'0'.repeat(64)}]})).rejects.toThrow('IDENTITY_CONFLICT');
    expect(writes).toBe(1);
  });
  it('hash and content preconditions must both hold before any durable intent',async()=>{
    const expected_hash='sha256:'+createHash('sha256').update('before').digest('hex');let touched=false;
    await expect(managedSourceEffect({changes:[{file:source,content:'after',expected_hash,expected_content:'different'}],apply:async()=>{touched=true;}})).rejects.toThrow('REVISION_CONFLICT');
    await expect(managedSourceEffect({changes:[{file:source,content:'after',expected_hash:null}],apply:async()=>{touched=true;}})).rejects.toThrow('REVISION_CONFLICT');
    await expect(managedSourceEffect({changes:[{file:source,content:'after',expected_hash:'not-a-hash'}],apply:async()=>{touched=true;}})).rejects.toThrow('HASH_PRECONDITION_INVALID');
    expect(touched).toBe(false);expect((await readChangeObligations()).entries).toEqual([]);
  });
  it('an absent hash precondition restores only a still-deleted path',async()=>{
    await fs.unlink(source);
    const restored=await managedSourceEffect({changes:[{file:source,content:'before',expected_hash:null}],apply:()=>fs.writeFile(source,'before')});
    expect(restored.before_hashes['source:fixture/a.ts']).toBe('absent');expect(restored.state).toBe('reconciliation_pending');
    await expect(managedSourceEffect({changes:[{file:source,content:'different',expected_hash:null}],apply:()=>fs.writeFile(source,'different')})).rejects.toThrow('REVISION_CONFLICT');
    expect(await fs.readFile(source,'utf8')).toBe('before');expect((await readChangeObligations()).entries).toHaveLength(1);
  });
  it.each(['create_file','delete_file'] as const)('actual %s refuses bytes changed after operator review without creating an obligation',async name=>{
    const server=new McpServer({name:'review-conflict-fixture',version:'1'});registerCodeSensesTools(server);
    const client=new Client({name:'review-client',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
    const reviewed='sha256:'+createHash('sha256').update('before').digest('hex');await fs.writeFile(source,'newer user change');
    try{const result=await client.callTool({name,arguments:{filePath:'a.ts',repo:'fixture',expected_hash:reviewed,...(name==='create_file'?{content:'old baseline'}:{})}});
      expect(JSON.parse((result.content as Array<{text:string}>)[0].text)).toMatchObject({success:false,error:{message:expect.stringContaining('REVISION_CONFLICT')}});
      expect(await fs.readFile(source,'utf8')).toBe('newer user change');expect((await readChangeObligations()).entries).toEqual([]);
    }finally{await client.close();await server.close();}
  });
  it('actual reviewed create/delete restores exact Unicode/BOM/line endings and preserves independent source debt',async()=>{
    const server=new McpServer({name:'review-restore-fixture',version:'1'});registerCodeSensesTools(server);
    const client=new Client({name:'review-client',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
    const original='\uFEFF// é 漢🙂\r\nexport const restored = true;\n',reviewed='sha256:'+createHash('sha256').update('before').digest('hex');
    try{
      const restored=await client.callTool({name:'create_file',arguments:{filePath:'a.ts',repo:'fixture',content:original,expected_hash:reviewed}});
      expect(JSON.parse((restored.content as Array<{text:string}>)[0].text).success).toBe(true);expect(await fs.readFile(source)).toEqual(Buffer.from(original));
      const deleted=await client.callTool({name:'delete_file',arguments:{filePath:'a.ts',repo:'fixture',expected_hash:'sha256:'+createHash('sha256').update(original).digest('hex')}});
      expect(JSON.parse((deleted.content as Array<{text:string}>)[0].text).success).toBe(true);await expect(fs.stat(source)).rejects.toMatchObject({code:'ENOENT'});
      const recreated=await client.callTool({name:'create_file',arguments:{filePath:'a.ts',repo:'fixture',content:original,expected_hash:null}});
      expect(JSON.parse((recreated.content as Array<{text:string}>)[0].text).success).toBe(true);expect(await fs.readFile(source)).toEqual(Buffer.from(original));
      expect((await readChangeObligations()).entries).toHaveLength(3);expect((await readChangeObligations()).entries.every(entry=>entry.state==='reconciliation_pending')).toBe(true);
    }finally{await client.close();await server.close();}
  });
  it.each(["intent_committed", "effect_applied", "effect_recorded"] as const)("recovers the exact effect after %s without repeating input", async stage => {
    await expect(managedSourceEffect(effect(stage))).rejects.toThrow(/crash|UNAVAILABLE/);
    let repeated = false;
    if (stage !== "effect_recorded") await expect(managedSourceEffect({ ...effect(), apply: async () => { repeated = true; } })).rejects.toThrow("RECOVERY_REQUIRED");
    const recovery = await recoverSourceEffects();
    expect(recovery.unknown).toEqual([]);
    const entry = (await readChangeObligations()).entries[0];
    expect(entry.state).toBe(stage === "intent_committed" ? "failed" : "reconciliation_pending");
    expect(repeated).toBe(false);
    if (stage === "intent_committed") expect((await readDirtyPartitions()).partitions[0]).toMatchObject({ state: "settled", pending_stages: [] });
    else expect((await managedSourceEffect({ ...effect(), apply: async () => { repeated = true; } })).id).toBe(entry.id);
    expect(repeated).toBe(false);
  });
  it("retains mixed rename effects as unknown rather than repeating or claiming reconciliation", async () => {
    const target = join(config.repos.fixture, "b.ts");
    await expect(managedSourceEffect({ operation_id: "rename:1", changes: [{ file: source, content: null }, { file: target, content: "before", expected_content: null }],
      apply: async () => { await fs.writeFile(target, "before"); throw new Error("crash before delete"); } })).rejects.toThrow("RECOVERY_REQUIRED");
    expect((await recoverSourceEffects()).unknown).toHaveLength(1);
    expect((await readChangeObligations()).entries[0].state).toBe("unknown");
    expect((await readDirtyPartitions()).partitions.map(p => p.state)).toEqual(["awaiting_reconciliation", "awaiting_reconciliation"]);
  });
  it("rejects sibling-prefix path escape and changed operation identity", async () => {
    await expect(managedSourceWrite(join(root, "repo-elsewhere", "a.ts"), "outside")).rejects.toThrow("SOURCE_SCOPE_DENIED");
    await managedSourceEffect(effect());
    await expect(managedSourceEffect({ ...effect(), changes: [{ file: source, content: "different" }] })).rejects.toThrow("OPERATION_IDENTITY_CONFLICT");
  });
});
