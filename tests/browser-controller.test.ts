/** The dialog rules of the dreamgraph-browser controller, with a scripted transport (no browser). */
import { describe, expect, it } from "vitest";
import { BrowserController } from "../src/computer/browser-bridge/controller.js";
import { callBrowserTool } from "../src/computer/browser-bridge/tools.js";
import { BrowserTimeoutError, type BrowserDetachListener, type BrowserDialog, type BrowserEventListener, type BrowserTab, type BrowserTransport, type FileDialogRequest, type FileDialogResult } from "../src/computer/browser-bridge/transport.js";

type Handler = (method: string, params: Record<string, unknown>) => unknown | Promise<unknown>;

/** Mimics Chrome: page-bound commands never answer while a dialog is open; Page.handleJavaScriptDialog does. */
class ScriptedTransport implements BrowserTransport {
  readonly sent: Array<{ method: string; params: Record<string, unknown> }> = [];
  readonly attached = new Set<number>();
  dialogOpen: BrowserDialog | null = null;
  fileDialog?: (request: FileDialogRequest) => Promise<FileDialogResult>;
  confirmSave?: BrowserTransport["confirmSave"];
  private readonly listeners = new Set<BrowserEventListener>();
  private readonly detachListeners = new Set<BrowserDetachListener>();
  private blocked: Array<() => void> = [];
  constructor(private readonly handler: Handler = () => ({})) {}
  emit(method: string, params: Record<string, unknown>) {
    if (method === "Page.javascriptDialogOpening") this.dialogOpen = { type: params.type as BrowserDialog["type"], message: String(params.message), default_prompt: String(params.defaultPrompt ?? ""), url: "" };
    if (method === "Page.javascriptDialogClosed") this.dialogOpen = null;
    for (const listener of this.listeners) listener(1, method, params);
  }
  detachByUser() { this.attached.delete(1); for (const listener of this.detachListeners) listener(1, "canceled_by_user"); }
  async listTabs(): Promise<BrowserTab[]> { return [{ tab_id: 1, window_id: 1, url: "http://localhost:5173/ide", title: "Web64 IDE", active: true, controlled: this.attached.has(1) }]; }
  async openTab(): Promise<BrowserTab> { throw new Error("not used"); }
  async closeTab() {}
  async activateTab() {}
  async attach(tabId: number) { this.attached.add(tabId); }
  async detach(tabId: number) { this.attached.delete(tabId); }
  async send<T>(_tabId: number, method: string, params: Record<string, unknown> = {}, timeoutMs = 1000): Promise<T> {
    this.sent.push({ method, params });
    if (method === "Page.handleJavaScriptDialog") {
      if (!this.dialogOpen) throw new Error("No dialog is showing");
      this.emit("Page.javascriptDialogClosed", { result: params.accept, userInput: params.promptText ?? "" });
      const waiting = this.blocked; this.blocked = []; for (const resume of waiting) resume();
      return {} as T;
    }
    const run = async () => (await this.handler(method, params)) as T;
    if (!this.dialogOpen) {
      return Promise.race([run(), new Promise<T>((_, reject) => setTimeout(() => reject(new BrowserTimeoutError(method, timeoutMs)), timeoutMs))]);
    }
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new BrowserTimeoutError(method, timeoutMs)), timeoutMs);
      this.blocked.push(() => { clearTimeout(timer); void run().then(resolve, reject); });
    });
  }
  async dialog() { return this.dialogOpen; }
  onEvent(listener: BrowserEventListener) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  onDetach(listener: BrowserDetachListener) { this.detachListeners.add(listener); return () => { this.detachListeners.delete(listener); }; }
  async close() {}
}

/** A page with one button that opens a prompt when clicked. */
function promptPage(): ScriptedTransport {
  const transport: ScriptedTransport = new ScriptedTransport((method, params) => {
    if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "main" } } };
    if (method === "Page.createIsolatedWorld") return { executionContextId: 9 };
    if (method === "Runtime.evaluate" && String(params.expression).includes("scrollIntoView")) return { result: { value: { x: 40, y: 20, box: { x: 0, y: 0, width: 80, height: 40 }, covered: false, cover: null } } };
    if (method === "Runtime.evaluate") return { result: { value: { url: "http://localhost:5173/ide", title: "Web64 IDE", viewport: { width: 800, height: 600, scroll_x: 0, scroll_y: 0 }, focused: null, lines: "- button \"New file\" [ref=e1]", elements: 1, truncated: false } } };
    if (method === "Input.dispatchMouseEvent" && params.type === "mouseReleased") {
      // The page's click handler calls prompt(): the dialog opens and this command blocks until it is answered.
      setTimeout(() => transport.emit("Page.javascriptDialogOpening", { type: "prompt", message: "Virtual file path", defaultPrompt: "includes/new-file.asm" }), 5);
      return new Promise(() => undefined);
    }
    return {};
  });
  return transport;
}

describe("dreamgraph-browser controller dialogs", () => {
  it("returns at once when a click opens a dialog, refuses page actions until it is answered, then continues", async () => {
    const transport = promptPage(), controller = new BrowserController(transport, { commandTimeoutMs: 500, settleMs: 1 });
    await callBrowserTool(controller, "browser_tabs", { action: "select", tab_id: 1 });
    const started = Date.now();
    const clicked = await callBrowserTool(controller, "browser_click", { ref: "e1" });
    expect(Date.now() - started).toBeLessThan(400);
    expect(clicked.isError).toBe(false);
    expect(clicked.text).toMatch(/DIALOG OPEN \(prompt\): "Virtual file path" default "includes\/new-file.asm"/);

    const refused = await callBrowserTool(controller, "browser_click", { x: 5, y: 5 });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/^DIALOG_OPEN: a prompt dialog is open/);
    const sentBefore = transport.sent.length;
    await callBrowserTool(controller, "browser_snapshot", {});
    expect(transport.sent.length).toBe(sentBefore);

    const answered = await callBrowserTool(controller, "browser_dialog", { accept: true, text: "src/hello.asm" });
    expect(answered.text).toMatch(/accepted the prompt dialog/);
    expect(transport.sent.find(item => item.method === "Page.handleJavaScriptDialog")?.params).toEqual({ accept: true, promptText: "src/hello.asm" });
    const snapshot = await callBrowserTool(controller, "browser_snapshot", {});
    expect(snapshot.isError).toBe(false);
    expect(snapshot.text).toMatch(/button "New file" \[ref=e1\]/);
  });

  it("classifies a timed-out command: a dialog the attachment holder saw is reported, otherwise the tab is unresponsive", async () => {
    const transport = new ScriptedTransport(method => method === "Page.getLayoutMetrics" ? new Promise(() => undefined) : {});
    const controller = new BrowserController(transport, { commandTimeoutMs: 50, settleMs: 1 });
    await controller.selectTab(1);
    const hung = await callBrowserTool(controller, "browser_screenshot", {});
    expect(hung.isError).toBe(true);
    expect(hung.text).toMatch(/^BROWSER_COMMAND_TIMEOUT|^TAB_UNRESPONSIVE/);

    // A dialog the event stream missed is still known to the attachment holder (the extension).
    const missed = new ScriptedTransport(() => ({}));
    const other = new BrowserController(missed, { commandTimeoutMs: 50, settleMs: 1 });
    await other.selectTab(1);
    missed.dialogOpen = { type: "confirm", message: "Delete main.asm?", default_prompt: "", url: "" };
    const blocked = await callBrowserTool(other, "browser_press_key", { key: "Enter" });
    expect(blocked.text).toMatch(/DIALOG OPEN \(confirm\): "Delete main.asm\?"/);
    expect((await callBrowserTool(other, "browser_dialog", { accept: false })).text).toMatch(/dismissed the confirm dialog/);
  });

  it("reports a dialog that was already open when control started", async () => {
    const transport = new ScriptedTransport();
    transport.dialogOpen = { type: "beforeunload", message: "", default_prompt: "", url: "" };
    const controller = new BrowserController(transport, { commandTimeoutMs: 50, settleMs: 1 });
    const selected = await callBrowserTool(controller, "browser_tabs", { action: "select", tab_id: 1 });
    expect(selected.text).toMatch(/DIALOG OPEN \(beforeunload\)/);
    expect(transport.sent.map(item => item.method)).not.toContain("Page.getFrameTree");
  });

  it("stops using a tab the user took back and says so", async () => {
    const transport = promptPage(), controller = new BrowserController(transport, { commandTimeoutMs: 200, settleMs: 1 });
    await controller.selectTab(1);
    transport.detachByUser();
    const result = await callBrowserTool(controller, "browser_snapshot", {});
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/^BROWSER_CONTROL_CANCELLED_BY_USER/);
  });

  it("never operates DreamGraph's own pages", async () => {
    const transport = promptPage();
    const controller = new BrowserController(transport, { commandTimeoutMs: 200, settleMs: 1,
      protectedUrl: url => url.startsWith("http://127.0.0.1:6401") ? "this is DreamGraph's own page (127.0.0.1:6401)" : null });
    const opened = await callBrowserTool(controller, "browser_tabs", { action: "open", url: "http://127.0.0.1:6401/config" });
    expect(opened.isError).toBe(true);
    expect(opened.text).toMatch(/^BROWSER_TAB_PROTECTED: this is DreamGraph's own page/);
    await controller.selectTab(1);
    const navigated = await callBrowserTool(controller, "browser_navigate", { url: "http://127.0.0.1:6401/architect" });
    expect(navigated.text).toMatch(/^BROWSER_TAB_PROTECTED/);
    expect(transport.sent.map(item => item.method)).not.toContain("Page.navigate");
  });

  it("reports an OS file dialog the page opened, holds input until it is answered and reports what the page received", async () => {
    const transport = promptPage();
    const answers: unknown[] = [];
    transport.fileDialog = async request => {
      answers.push(request);
      setTimeout(() => transport.emit("Runtime.bindingCalled", { name: "__dreamgraphPicker", payload: JSON.stringify({ phase: "closed", id: 1, outcome: "chosen", names: ["main.web64proj"] }) }), 5);
      return { status: "done", message: String(request.path) };
    };
    const controller = new BrowserController(transport, { commandTimeoutMs: 200, settleMs: 20 });
    await controller.selectTab(1);
    expect(transport.sent.map(item => item.method)).toContain("Runtime.addBinding");
    transport.emit("Runtime.bindingCalled", { name: "__dreamgraphPicker", payload: JSON.stringify({ phase: "open", id: 1, kind: "save", suggested_name: "main.web64proj",
      types: [{ description: "Web64 project", accept: [".web64proj"] }], multiple: false }) });
    const blocked = await callBrowserTool(controller, "browser_press_key", { key: "Enter" });
    expect(blocked.isError).toBe(true);
    expect(blocked.text).toMatch(/^FILE_DIALOG_OPEN: the page opened an OS save file dialog \(suggested "main.web64proj"\)/);
    const snapshot = await callBrowserTool(controller, "browser_snapshot", {});
    expect(snapshot.isError).toBe(false);
    const answered = await callBrowserTool(controller, "browser_file_dialog", { path: "C:\\Users\\me\\demo\\main.web64proj" });
    expect(answers).toEqual([{ action: "choose", path: "C:\\Users\\me\\demo\\main.web64proj", overwrite: false }]);
    expect(answered.text).toMatch(/file dialog: done .*the page received main.web64proj/);
    expect(controller.fileDialogState(1).open).toBeNull();
  });

  it("answers the separate Chrome file-type warning only for the pending Save and observes completion", async () => {
    const transport = promptPage(), controller = new BrowserController(transport, { settleMs: 1 });
    await controller.selectTab(1);
    transport.emit("Runtime.bindingCalled", { name: "__dreamgraphPicker", payload: JSON.stringify({ phase: "open", id: 4, kind: "save", suggested_name: "proof.js", types: [], multiple: false }) });
    transport.fileDialog = async () => ({ status: "done" });
    const confirmations: unknown[] = [];
    transport.confirmSave = async request => {
      confirmations.push(request);
      transport.emit("Runtime.bindingCalled", { name: "__dreamgraphPicker", payload: JSON.stringify({ phase: "closed", id: 4, outcome: "chosen", names: ["proof.js"] }) });
      return { status: "done" };
    };
    const result = await controller.answerFileDialog({ action: "choose", path: "C:/work/proof.js" });
    expect(confirmations).toEqual([{ tab_id: 1, path: "C:/work/proof.js", origin: "http://localhost:5173" }]);
    expect(result.note).toContain("the page received proof.js");
    expect(transport.sent.some(command => command.method === "Page.handleJavaScriptDialog")).toBe(false);
  });

  it("keeps an unmatched browser confirmation pending without reporting Save complete", async () => {
    const transport = promptPage(), controller = new BrowserController(transport, { settleMs: 1 });
    await controller.selectTab(1);
    transport.emit("Runtime.bindingCalled", { name: "__dreamgraphPicker", payload: JSON.stringify({ phase: "open", id: 5, kind: "save", suggested_name: "proof.js", types: [], multiple: false }) });
    transport.fileDialog = async () => ({ status: "not_found" });
    transport.confirmSave = async () => ({ status: "needs_confirmation", message: "No unique matching confirmation" });
    const result = await controller.answerFileDialog({ action: "choose", path: "C:/work/proof.js" });
    expect(result.note).toContain("needs_confirmation");
    expect(result.note).toContain("not reported the result");
    expect(controller.fileDialogState(1).open?.id).toBe(5);
  });

  it("says plainly when the connection cannot operate OS file dialogs", async () => {
    const transport = promptPage(), controller = new BrowserController(transport, { commandTimeoutMs: 200, settleMs: 1 });
    await controller.selectTab(1);
    const result = await callBrowserTool(controller, "browser_file_dialog", { cancel: true });
    expect(result.text).toMatch(/^BROWSER_FILE_DIALOG_UNSUPPORTED/);
  });

  it("does not turn a failed detach into successful release", async () => {
    const transport = promptPage(), controller = new BrowserController(transport);
    await controller.selectTab(1);
    transport.detach = async () => { throw new Error("extension disconnected"); };
    await expect(controller.release()).rejects.toThrow("Detach unconfirmed");
  });

  it("releases every controlled tab", async () => {
    const transport = promptPage(), controller = new BrowserController(transport);
    await controller.selectTab(1);
    expect(transport.attached.has(1)).toBe(true);
    await controller.release();
    expect(transport.attached.has(1)).toBe(false);
  });
});
