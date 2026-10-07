/**
 * `dg browser selftest`: checks DreamGraph's browser bridge end to end on this computer without any model call.
 * Opens a small local test page in the user's Chrome through the extension, answers a prompt and a confirm,
 * saves through the OS save dialog into a temporary file and checks the file, then closes the tab.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { BridgeTransport } from "./client.js";
import { BrowserController } from "./controller.js";
import { callBrowserTool } from "./tools.js";

const PAGE = `<!doctype html><html><head><title>DreamGraph browser self-test</title></head><body style="font:16px system-ui;padding:24px">
<h1>DreamGraph browser self-test</h1><p>DreamGraph is checking its browser control. This tab closes by itself.</p>
<button id="ask" onclick="const v=prompt('File name','selftest.asm');document.getElementById('status').textContent='prompt '+v">Ask</button>
<button id="confirm" onclick="document.getElementById('status').textContent='confirm '+confirm('Continue?')">Confirm</button>
<button id="save" onclick="showSaveFilePicker({suggestedName:'selftest.web64proj',types:[{description:'Web64 project',accept:{'application/json':['.web64proj']}}]})
  .then(h=>h.createWritable()).then(w=>w.write('{&quot;selftest&quot;:true}').then(()=>w.close())).then(()=>document.getElementById('status').textContent='saved',e=>document.getElementById('status').textContent='save '+e.name)">Save</button>
<p id="status">ready</p></body></html>`;

/** Diagnostics when the saved file is not where it was asked to go: the test folder and fresh test files in Documents. */
async function whereSaved(folder: string): Promise<string> {
  const listing = await readdir(folder).then(names => names.join(", ") || "empty", () => "unreadable");
  const found: string[] = [];
  for (const documents of [join(homedir(), "Documents"), join(homedir(), "OneDrive", "Documents"), join(homedir(), "OneDrive", "Tiedostot")]) {
    const names = await readdir(documents).catch(() => [] as string[]);
    for (const name of names.filter(name => /selftest.*\.web64proj$/i.test(name))) {
      const info = await stat(join(documents, name)).catch(() => null);
      if (info && Date.now() - info.mtimeMs < 5 * 60_000) found.push(join(documents, name));
    }
  }
  return `test folder kept: ${folder} (contains: ${listing}); fresh test files in Documents: ${found.join(", ") || "none"}`;
}

export interface SelftestStep { step: string; ok: boolean; detail: string }

export async function runBrowserSelftest(options: { home?: string; skipFileDialog?: boolean; log?: (step: SelftestStep) => void } = {}): Promise<{ ok: boolean; steps: SelftestStep[] }> {
  const steps: SelftestStep[] = [];
  const record = (step: string, ok: boolean, detail: string) => { const item = { step, ok, detail: detail.slice(0, 3000) }; steps.push(item); options.log?.(item); return ok; };
  const server = createServer((_request, response) => { response.writeHead(200, { "content-type": "text/html; charset=utf-8" }); response.end(PAGE); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/selftest`;
  // Under DreamGraph's own folder: the browser refuses to let sites save in system folders such as AppData\Local\Temp.
  // realpath gives the long form a user would type (no 8.3 short names).
  const base = join(options.home ?? homedir(), ".dreamgraph", "browser");
  await mkdir(base, { recursive: true });
  const folder = await realpath(await mkdtemp(join(base, "selftest-")));
  let keepFolder = false;
  let transport: BridgeTransport | undefined, controller: BrowserController | undefined, tabId: number | undefined;
  const call = (name: string, args: Record<string, unknown> = {}) => callBrowserTool(controller!, name, args);
  const status = async () => (await call("browser_evaluate", { expression: "document.getElementById('status').textContent" })).text.split("result: ")[1] ?? "";
  const refOf = (text: string, label: string) => new RegExp(`button "${label}" \\[ref=(e\\d+)\\]`).exec(text)?.[1] ?? "";
  try {
    transport = await BridgeTransport.connect({ home: options.home });
    record("extension", true, `connected (extension ${transport.extensionVersion ?? "unknown"})`);
    controller = new BrowserController(transport, { commandTimeoutMs: 8000 });
    const opened = await controller.openTab(url); tabId = opened.tab?.tab_id;
    if (!record("open tab", !!tabId, opened.tab?.url ?? "no tab")) return { ok: false, steps };
    const snapshot = (await call("browser_snapshot")).text;
    record("read page", /button "Ask"/.test(snapshot), snapshot.split("\n").slice(0, 3).join(" | "));

    const asked = await call("browser_click", { ref: refOf(snapshot, "Ask") });
    record("prompt reported", /DIALOG OPEN \(prompt\)/.test(asked.text), asked.text);
    const answered = await call("browser_dialog", { accept: true, text: "hello.asm" });
    record("prompt answered", /prompt "?hello\.asm/.test(await status()), answered.text);

    await call("browser_click", { ref: refOf(snapshot, "Confirm") });
    await call("browser_dialog", { accept: true });
    record("confirm answered", /confirm true/.test(await status()), "");

    if (!options.skipFileDialog) {
      // A name other than the suggested one, so a dialog that ignores the given path cannot pass.
      const target = join(folder, `dreamgraph-selftest-${Date.now().toString(36)}.web64proj`);
      const saved = await call("browser_click", { ref: refOf(snapshot, "Save") });
      if (record("save dialog reported", /FILE DIALOG OPEN \(save\)/.test(saved.text), saved.text)) {
        const answer = await call("browser_file_dialog", { path: target });
        // The page writes after the dialog closes; Chrome finishes the file when the page closes it (with its own
        // checks, which can take seconds). Wait for the page to report the outcome, then check the file.
        let pageStatus = "", written = "";
        for (let waited = 0; waited < 20_000 && /: done/.test(answer.text); waited += 250) {
          pageStatus = await status().catch(() => "");
          if (/saved|save \w/.test(pageStatus)) break;
          await new Promise(resolve => setTimeout(resolve, 250));
        }
        for (let attempt = 0; attempt < 8 && !written.includes("selftest"); attempt += 1) {
          written = await readFile(target, "utf8").catch(() => "");
          if (!written.includes("selftest")) await new Promise(resolve => setTimeout(resolve, 250));
        }
        const ok = record("save dialog answered", written.includes("selftest") && /saved/.test(pageStatus),
          `${answer.text} | page: ${pageStatus || "no report"} | file ${written.includes("selftest") ? "written" : "missing"}`);
        if (!ok) {
          keepFolder = true;
          if (!/: done/.test(answer.text)) await call("browser_file_dialog", { cancel: true }).catch(() => undefined);
          record("where the file went", false, await whereSaved(folder));
        }
      }
    }
  } catch (error) {
    record("error", false, error instanceof Error ? error.message : String(error));
  } finally {
    if (controller && tabId !== undefined) await controller.closeTab(tabId).catch(() => undefined);
    await controller?.release().catch(() => undefined);
    await transport?.close().catch(() => undefined);
    server.close();
    if (!keepFolder) await rm(folder, { recursive: true, force: true }).catch(() => undefined);
  }
  return { ok: steps.every(step => step.ok), steps };
}
