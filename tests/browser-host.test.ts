/** Browser host ⇄ daemon client, with a scripted extension on the native messaging streams (no browser). */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PassThrough } from "node:stream";
import { connect } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { BrowserHost } from "../src/computer/browser-bridge/host.js";
import { BridgeTransport, listBrowserHosts } from "../src/computer/browser-bridge/client.js";
import { NativeMessageReader, encodeLine, encodeNativeMessage } from "../src/computer/browser-bridge/protocol.js";

interface FakeExtension { requests: Array<{ method: string; params: Record<string, unknown> }>; emit(message: unknown): void }

let home: string, host: BrowserHost, extension: FakeExtension;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "dg-browser-host-"));
  const toHost = new PassThrough(), fromHost = new PassThrough();
  const requests: FakeExtension["requests"] = [];
  extension = { requests, emit: message => { toHost.write(encodeNativeMessage(message)); } };
  const reader = new NativeMessageReader(raw => {
    const message = raw as { id: number; method: string; params: Record<string, unknown> };
    requests.push({ method: message.method, params: message.params });
    const result = message.method === "tabs.list" ? [{ tab_id: 1, window_id: 1, url: "http://localhost:5173/ide", title: "Web64 IDE", active: true, controlled: false }]
      : message.method === "debugger.send" ? { echo: message.params.method } : message.method === "dialog.get" ? { dialog: null } : {};
    extension.emit({ id: message.id, result });
  });
  fromHost.on("data", chunk => reader.push(chunk));
  const endpoint = process.platform === "win32" ? `\\\\.\\pipe\\dreamgraph-browser-test-${randomBytes(6).toString("hex")}` : join(home, "host.sock");
  host = new BrowserHost({ home, input: toHost, output: fromHost, endpoint });
  await host.start();
  extension.emit({ hello: { version: "14.0.2" } });
  await sleep(50);
});
afterEach(async () => { await host.stop("test end"); await rm(home, { recursive: true, force: true }); });

describe("DreamGraph browser host", () => {
  it("publishes itself for the daemon and refuses connections without its token", async () => {
    const [info] = await listBrowserHosts(home);
    expect(info).toMatchObject({ protocol: "dreamgraph.browser-bridge.v1", pid: process.pid, extension_version: "14.0.2" });
    const reply = await new Promise<string>(resolve => {
      const socket = connect(info.endpoint, () => socket.write(encodeLine({ id: 1, method: "tabs.list" })));
      let data = ""; socket.on("data", chunk => { data += chunk; }); socket.on("close", () => resolve(data)); socket.on("error", () => resolve(data));
    });
    expect(reply).toMatch(/BROWSER_HOST_UNAUTHORIZED/);
    expect(extension.requests).toEqual([]);
  });

  it("relays commands, gives a tab to one run at a time and routes its events only to that run", async () => {
    const a = await BridgeTransport.connect({ home }), b = await BridgeTransport.connect({ home });
    expect(a.extensionVersion).toBe("14.0.2");
    expect((await a.listTabs())[0].title).toBe("Web64 IDE");
    await a.attach(1);
    await expect(b.attach(1)).rejects.toThrow("BROWSER_TAB_IN_USE");
    await expect(b.send(1, "Runtime.evaluate", {})).rejects.toThrow("BROWSER_TAB_NOT_CONTROLLED");
    expect(await a.send(1, "Runtime.evaluate", { expression: "1+1" })).toEqual({ echo: "Runtime.evaluate" });
    const seenA: string[] = [], seenB: string[] = [];
    a.onEvent((_tab, method) => seenA.push(method)); b.onEvent((_tab, method) => seenB.push(method));
    extension.emit({ event: "cdp", tab_id: 1, method: "Page.javascriptDialogOpening", params: { type: "prompt", message: "Virtual file path" } });
    await sleep(50);
    expect(seenA).toEqual(["Page.javascriptDialogOpening"]); expect(seenB).toEqual([]);
    await a.close(); await b.close();
  });

  it("detaches every tab of a run whose connection closes, so control always ends with the run", async () => {
    const run = await BridgeTransport.connect({ home });
    await run.attach(1);
    await run.close();
    await sleep(100);
    expect(extension.requests.filter(request => request.method === "debugger.detach")).toEqual([{ method: "debugger.detach", params: { tab_id: 1 } }]);
    const next = await BridgeTransport.connect({ home });
    await next.attach(1);
    await next.close();
  });

  it("tells the run when the user takes a tab back", async () => {
    const run = await BridgeTransport.connect({ home });
    await run.attach(1);
    const reasons: string[] = [];
    run.onDetach((_tab, reason) => reasons.push(reason));
    extension.emit({ event: "detach", tab_id: 1, reason: "canceled_by_user" });
    await sleep(50);
    expect(reasons).toEqual(["canceled_by_user"]);
    await expect(run.send(1, "Runtime.evaluate", {})).rejects.toThrow("BROWSER_TAB_NOT_CONTROLLED");
    await run.close();
  });

  it("answers the OS file dialog on the desktop for a run that controls a tab", async () => {
    const requests: unknown[] = [];
    host.fileDialog = async request => { requests.push(request); return { status: "done", message: "C:\\work\\main.web64proj" }; };
    const run = await BridgeTransport.connect({ home });
    await expect(run.fileDialog({ action: "choose", path: "C:\\work\\main.web64proj" })).rejects.toThrow("BROWSER_TAB_NOT_CONTROLLED");
    await run.attach(1);
    expect(await run.fileDialog({ action: "choose", path: "C:\\work\\main.web64proj", overwrite: true })).toEqual({ status: "done", message: "C:\\work\\main.web64proj" });
    expect(requests).toEqual([{ action: "choose", path: "C:\\work\\main.web64proj", overwrite: true }]);
    expect(extension.requests.map(request => request.method)).not.toContain("os.file_dialog");
    await run.close();
  });

  it("checks tab ownership and current origin before answering a browser Save confirmation", async () => {
    const requests: unknown[] = [];
    host.confirmSave = async request => { requests.push(request); return { status: "done" }; };
    const run = await BridgeTransport.connect({ home }), other = await BridgeTransport.connect({ home });
    const request = { tab_id: 1, path: "C:/work/proof.js", origin: "http://localhost:5173" };
    await run.attach(1);
    await expect(other.confirmSave(request)).rejects.toThrow("BROWSER_TAB_NOT_CONTROLLED");
    await expect(run.confirmSave({ ...request, origin: "https://unrelated.example" })).rejects.toThrow("SCOPE_MISMATCH");
    expect(requests).toEqual([]);
    expect(await run.confirmSave(request)).toEqual({ status: "done" });
    expect(requests).toEqual([{ path: request.path, origin: request.origin }]);
    await run.close(); await other.close();
  });

  it("reports a plain reason when no browser host is running", async () => {
    const empty = await mkdtemp(join(tmpdir(), "dg-browser-none-"));
    await expect(BridgeTransport.connect({ home: empty })).rejects.toThrow("DREAMGRAPH_BROWSER_UNAVAILABLE");
    await rm(empty, { recursive: true, force: true });
  });
});
