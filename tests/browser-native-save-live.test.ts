/** Opt-in Windows extension/native Save regression. No model calls or installed-daemon mutation. */
import { it, expect, vi } from "vitest";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { config } from "../src/config/config.js";
import { InstanceScope } from "../src/instance/scope.js";
import * as lifecycle from "../src/instance/lifecycle.js";
import { setDataDirOverride } from "../src/utils/paths.js";
import { commitGraphWrites, findOperationReceipt } from "../src/graph/publication.js";
import { readChangeObligations } from "../src/graph/change-obligations.js";
import { releaseGraphWriter } from "../src/graph/writer-lease.js";
import { openDreamgraphBrowserSession } from "../src/computer/dreamgraph-browser.js";
import { BridgeTransport } from "../src/computer/browser-bridge/client.js";
import { answerSaveConfirmation } from "../src/computer/browser-bridge/save-confirmation.js";
import { answerOsFileDialog } from "../src/computer/browser-bridge/file-dialog.js";

it.skipIf(process.env.DG_NATIVE_SAVE_LIVE !== "1")("saves tracked JavaScript through the real Windows confirmation and records the settled effect", async () => {
  const base = join(homedir(), ".dreamgraph", "browser"); await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, "save-confirmation-")), repo = join(root, "project");
  await mkdir(repo);
  const scope = new InstanceScope(randomUUID(), root, repo, { fixture: repo }, "Native Save qualification");
  const beforeRepos = config.repos; config.repos = { fixture: repo }; setDataDirOverride(scope.dataDir);
  const scopeSpy = vi.spyOn(lifecycle, "getActiveScope").mockReturnValue(scope);
  const content = "export const nativeSaveProof = 'DREAMGRAPH_AUTHORIZED_SAVE';\n", target = join(repo, "native-save-proof.js");
  const evidence: any = { date: new Date().toISOString(), mode: "backend_without_model", target, passed: false, calls: [] };
  const page = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end('<!doctype html><title>Authorized native Save test</title><button id="save">Save source</button><output id="status">ready</output><script>save.onclick=async()=>{try{const h=await showSaveFilePicker({suggestedName:"native-save-proof.js",types:[{description:"JavaScript",accept:{"text/javascript":[".js"]}}]});const w=await h.createWritable();await w.write('+JSON.stringify(content)+');await w.close();document.getElementById("status").textContent="Saved DREAMGRAPH_AUTHORIZED_SAVE"}catch(e){document.getElementById("status").textContent="Save failed: "+e.name}}<\/script>');
  });
  let session: Awaited<ReturnType<typeof openDreamgraphBrowserSession>> | undefined;
  try {
    await commitGraphWrites({ actor: "save-fixture", scope: ["features.json"], writes: [{ file: "features.json", content: '{"features":[]}' }] });
    await new Promise<void>(done => page.listen(0, "127.0.0.1", done));
    const url = "http://127.0.0.1:" + (page.address() as any).port;
    const transport = await BridgeTransport.connect();
    // Exercise this checkout's native helper with the installed extension; do not reinstall/restart a user's host.
    transport.fileDialog = request => answerOsFileDialog(request);
    transport.confirmSave = async request => {
      const mismatched = await answerSaveConfirmation({ ...request, origin: "https://unrelated.example" });
      evidence.wrong_origin = mismatched;
      expect(mismatched.status).toBe("needs_confirmation");
      const confirmed = await answerSaveConfirmation(request);
      evidence.browser_confirmation = confirmed;
      return confirmed;
    };
    const executionId = "native-save-" + randomUUID();
    session = await openDreamgraphBrowserSession({ transport, executionId, logDir: root });
    const call = async (name: string, args: unknown = {}) => {
      const result = await session!.call(name, args);
      evidence.calls.push({ name, args, text: result.text, isError: result.isError });
      expect(result.isError).toBe(false);
      return result;
    };
    await call("browser_tabs", { action: "open", url });
    const snapshot = await call("browser_snapshot");
    const ref = snapshot.text.match(/button "Save source" \[ref=(e\d+)\]/)?.[1];
    expect(ref).toBeTruthy();
    await call("browser_click", { ref });
    await call("browser_file_dialog", { path: target });
    for (let i = 0; i < (process.env.DG_SAVE_INSPECT ? 120 : 20); i++) {
      if ((await readFile(target, "utf8").catch(() => "")) === content) break;
      await new Promise(done => setTimeout(done, 1000));
    }
    expect(await readFile(target, "utf8")).toBe(content);
    await call("browser_wait", { text: "Saved DREAMGRAPH_AUTHORIZED_SAVE", ms: 5000 });
    expect((await call("browser_snapshot")).text).toContain("Saved DREAMGRAPH_AUTHORIZED_SAVE");
    evidence.obligations = (await readChangeObligations()).entries;
    expect(evidence.obligations).toHaveLength(1);
    const obligation = evidence.obligations[0];
    expect(obligation.state).toBe("reconciliation_pending");
    expect(obligation.after_hashes).toEqual({ "source:fixture/native-save-proof.js": "sha256:" + createHash("sha256").update(content).digest("hex") });
    evidence.intent = await findOperationReceipt(obligation.operation_id + ":intent", obligation.actor);
    evidence.observed = await findOperationReceipt(obligation.operation_id + ":observed", obligation.actor);
    expect(evidence.intent).toBeTruthy(); expect(evidence.observed).toBeTruthy();
    await session.release("native Save test completed"); evidence.release = "confirmed"; evidence.passed = true;
  } catch (error) { evidence.error = String(error); throw error; }
  finally {
    await session?.release("native Save test cleanup").catch(error => { evidence.release_error = String(error); });
    evidence.final_obligations = await readChangeObligations().catch(() => null);
    await writeFile(join(root, "evidence.json"), JSON.stringify(evidence, null, 2));
    console.log("NATIVE_SAVE_EVIDENCE " + join(root, "evidence.json"));
    page.closeAllConnections(); await new Promise<void>(done => page.close(() => done()));
    await releaseGraphWriter(scope.dataDir); scopeSpy.mockRestore(); config.repos = beforeRepos; setDataDirOverride(null);
  }
}, 200000);
