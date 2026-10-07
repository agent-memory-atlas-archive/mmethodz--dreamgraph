/**
 * The dreamgraph-browser controller against a real Chromium (no model, no extension: direct CDP with the same
 * one-attachment-per-tab semantics). Runs when a Chromium is available: DREAMGRAPH_TEST_CHROMIUM, or the
 * playwright-core browser if installed; otherwise skipped.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { CdpDirectTransport } from "../src/computer/browser-bridge/cdp-direct.js";
import { BrowserController } from "../src/computer/browser-bridge/controller.js";
import { callBrowserTool } from "../src/computer/browser-bridge/tools.js";

async function findChromium(): Promise<string | null> {
  const candidates = [process.env.DREAMGRAPH_TEST_CHROMIUM];
  // Optional dependency; imported by name so the suite compiles without it.
  const optional = "playwright-core";
  try { const playwright = await import(optional) as { chromium: { executablePath(): string } }; candidates.push(playwright.chromium.executablePath()); } catch { /* optional */ }
  for (const candidate of candidates) if (candidate && await access(candidate).then(() => true, () => false)) return candidate;
  return null;
}
const executable = await findChromium();
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

let chrome: ChildProcess | undefined, server: Server, profile: string, fixture: string, transport: CdpDirectTransport, controller: BrowserController;

describe("dreamgraph-browser on Chromium", () => {
  beforeAll(async () => {
    if (!executable) return;
    const html = await readFile(new URL("./fixtures/browser-ide.html", import.meta.url), "utf8");
    server = createServer((_req, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end(html); });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    fixture = `http://127.0.0.1:${(server.address() as AddressInfo).port}/ide`;
    profile = await mkdtemp(join(tmpdir(), "dg-chromium-"));
    chrome = spawn(executable, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
      ...(process.platform === "linux" ? ["--no-sandbox"] : []), "about:blank"], { stdio: "ignore" });
    let port = "";
    for (let attempt = 0; attempt < 100 && !port; attempt += 1) {
      await sleep(100);
      port = await readFile(join(profile, "DevToolsActivePort"), "utf8").then(text => text, () => "");
    }
    const [portLine, path] = port.trim().split(/\r?\n/);
    transport = await CdpDirectTransport.connect(`ws://127.0.0.1:${portLine}${path}`);
    controller = new BrowserController(transport, { commandTimeoutMs: 5000 });
  }, 30_000);
  afterAll(async () => {
    await controller?.release().catch(() => undefined); await transport?.close().catch(() => undefined);
    chrome?.kill(); server?.close(); await sleep(300);
    if (profile) await rm(profile, { recursive: true, force: true }).catch(() => undefined);
  });

  const call = (name: string, args: Record<string, unknown> = {}) => callBrowserTool(controller, name, args);
  const ref = (text: string, pattern: RegExp) => /\[ref=(e\d+)\]/.exec(text.split("\n").find(line => pattern.test(line)) ?? "")?.[1] ?? "";
  const status = async () => (await call("browser_evaluate", { expression: "document.getElementById('status').textContent" })).text;

  it.skipIf(!executable)("takes over an already-open tab, handles a prompt the IDE opens, types into the code editor", async () => {
    const tab = await transport.openTab(fixture); await sleep(800);
    expect((await call("browser_tabs", { action: "list" })).text).toMatch(/Fixture IDE/);
    await call("browser_tabs", { action: "select", tab_id: tab.tab_id });
    const snapshot = (await call("browser_snapshot")).text;
    expect(snapshot).toMatch(/button "New file" \[ref=e\d+\]/);

    const clicked = await call("browser_click", { ref: ref(snapshot, /button "New file"/) });
    expect(clicked.text).toMatch(/DIALOG OPEN \(prompt\): "Virtual file path" default "includes\/new-file.asm"/);
    expect((await call("browser_click", { x: 5, y: 5 })).text).toMatch(/^DIALOG_OPEN/);
    expect((await call("browser_dialog", { accept: true, text: "src/hello.asm" })).text).toMatch(/accepted the prompt dialog/);
    expect(await status()).toMatch(/created src\/hello.asm/);

    const editor = ref(snapshot, /textbox "Source code"/);
    await call("browser_type", { ref: editor, text: "lda #$00" });
    await call("browser_type", { ref: editor, text: "lda #$01\nsta $d021", clear: true });
    expect((await call("browser_evaluate", { expression: "document.getElementById('editor').innerText" })).text).toMatch(/lda #\$01\\nsta \$d021/);
  }, 60_000);

  it.skipIf(!executable)("confirms, draws on a canvas, fills a file chooser without the OS picker and answers 'leave page?'", async () => {
    const snapshot = (await call("browser_snapshot")).text;
    expect((await call("browser_click", { ref: ref(snapshot, /button "Delete"/) })).text).toMatch(/DIALOG OPEN \(confirm\)/);
    await call("browser_dialog", { accept: false });
    expect(await status()).not.toMatch(/deleted/);

    const box = JSON.parse((await call("browser_evaluate", { expression: "(() => { const r = document.getElementById('sprite').getBoundingClientRect(); return { x: r.left, y: r.top }; })()" })).text.split("result: ")[1]);
    await call("browser_drag", { from_x: box.x + 10, from_y: box.y + 10, to_x: box.x + 80, to_y: box.y + 70, steps: 20 });
    expect(Number(JSON.parse((await call("browser_evaluate", { expression: "document.getElementById('sprite').dataset.painted" })).text.split("result: ")[1]))).toBeGreaterThan(10);
    const shot = await call("browser_screenshot", { ref: ref(snapshot, /canvas "Sprite canvas"/) });
    expect(shot.images[0]?.mimeType).toBe("image/jpeg");

    const file = join(profile, "upload.prg"); await writeFile(file, "PRG");
    expect((await call("browser_click", { ref: ref(snapshot, /file-input "Import file"/) })).text).toMatch(/FILE CHOOSER OPEN/);
    await call("browser_file_chooser", { files: [file] }); await sleep(300);
    expect(await status()).toMatch(/upload upload.prg/);

    // OS file dialog: the page hook reports it (headless Chromium cancels the picker at once).
    expect((await call("browser_evaluate", { expression: "window.showSaveFilePicker.name + ' ' + window.__dreamgraphPickerHook" })).text).toMatch(/"showSaveFilePicker true"/);
    await call("browser_click", { ref: ref(snapshot, /button "Save project"/) }); await sleep(300);
    // The picker reached Chrome (not swallowed by the chooser interception); headless has no UI and cancels it.
    expect(controller.fileDialogState(controller.currentTab!).last).toMatchObject({ outcome: "cancelled" });
    expect(controller.fileDialogState(controller.currentTab!).last?.message ?? "").not.toMatch(/Intercepted/);
    expect(await status()).toMatch(/save AbortError/);

    await call("browser_click", { ref: ref(snapshot, /checkbox "Unsaved changes"/) });
    expect((await call("browser_navigate", { url: "about:blank" })).text).toMatch(/DIALOG OPEN \(beforeunload\)/);
    expect((await call("browser_dialog", { accept: true })).text).toMatch(/about:blank/);
  }, 60_000);
});
