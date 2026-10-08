/**
 * Browser controller for one Computer Use session: the tabs it controls, their dialog and file-chooser state,
 * DreamGraph's isolated world per page (element refs), and the actions. Provider- and transport-neutral.
 *
 * Dialog rule (field finding 2026-10-04, see docs/ashoka/computer-use-contract.md): while a JavaScript dialog is
 * open, every page-bound CDP command blocks. The controller therefore keeps dialog state per tab from events,
 * returns at once when an action opens one, refuses page actions while one is open (DIALOG_OPEN), and answers it
 * with Page.handleJavaScriptDialog on the attachment that saw it.
 */
import { access, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { BrowserTimeoutError, dialogFromEvent, type BrowserDialog, type BrowserFileDialog, type BrowserTab, type BrowserTransport, type FileDialogRequest } from "./transport.js";
import { FILE_PICKER_BINDING, FILE_PICKER_HOOK, FOCUS_SCRIPT, RESOLVE_SCRIPT, SNAPSHOT_SCRIPT, WAIT_TEXT_SCRIPT } from "./page-scripts.js";
import { parseKeyChord } from "./keys.js";

export interface BrowserControllerOptions {
  commandTimeoutMs?: number;
  navigationTimeoutMs?: number;
  settleMs?: number;
  maxScreenshotWidth?: number;
  snapshotMaxChars?: number;
  /** Pages DreamGraph must never operate (its own UI); returns the reason, or null. */
  protectedUrl?: (url: string) => string | null;
  /** Folder for a save dialog answered without a path (the instance's runtime/temp); null when there is none. */
  defaultFileFolder?: () => string | null;
}

export class BrowserActionError extends Error {
  constructor(readonly code: string, message: string, readonly dialog?: BrowserDialog) { super(`${code}: ${message}`); }
}

export interface PageState { tab_id: number; url: string; title: string }
export interface ActionResult {
  tab: PageState | null;
  /** A dialog the action opened (or that is still open). The page is blocked until it is answered. */
  dialog?: BrowserDialog;
  /** An OS file dialog (File System Access save/open/folder picker) the page opened; answer it with browser_file_dialog. */
  file_dialog?: BrowserFileDialog;
  /** A file chooser the page opened; set its files with browser_file_chooser. */
  file_chooser?: { mode: string };
  navigated?: boolean;
  note?: string;
  snapshot?: string;
}
export interface SnapshotResult extends PageState {
  viewport: Record<string, number>;
  focused: string | null;
  lines: string;
  elements: number;
  truncated: boolean;
}
export type Target = { ref: string } | { x: number; y: number };

interface Point { x: number; y: number }
type Waiter = (dialog: BrowserDialog) => void;

export class BrowserController {
  private readonly attached = new Set<number>();
  private current: number | null = null;
  private readonly dialogs = new Map<number, BrowserDialog>();
  private readonly dialogWaiters = new Map<number, Set<Waiter>>();
  private readonly choosers = new Map<number, { backend_node_id: number; mode: string }>();
  private readonly worlds = new Map<number, number>();
  private readonly mainFrames = new Map<number, string>();
  private readonly navigations = new Map<number, number>();
  private readonly loads = new Map<number, number>();
  private readonly detachReasons = new Map<number, string>();
  private readonly fileDialogs = new Map<number, BrowserFileDialog>();
  private readonly fileDialogOutcomes = new Map<number, { id: number; outcome: string; names?: string[]; message?: string }>();
  private readonly unsubscribe: Array<() => void> = [];
  private readonly options: Required<BrowserControllerOptions>;

  constructor(private readonly transport: BrowserTransport, options: BrowserControllerOptions = {}) {
    this.options = { commandTimeoutMs: 10_000, navigationTimeoutMs: 15_000, settleMs: 200, maxScreenshotWidth: 1920, snapshotMaxChars: 24_000,
      protectedUrl: () => null, defaultFileFolder: () => null, ...options };
    this.unsubscribe.push(transport.onEvent((tabId, method, params) => this.event(tabId, method, params)));
    this.unsubscribe.push(transport.onDetach((tabId, reason) => { this.forget(tabId); this.detachReasons.set(tabId, reason); }));
  }

  get currentTab(): number | null { return this.current; }
  get controlledTabs(): number[] { return [...this.attached]; }
  openDialog(tabId: number): BrowserDialog | undefined { return this.dialogs.get(tabId); }
  /** The OS file dialog the page has open, and how the last one ended (from the page hook). */
  fileDialogState(tabId: number) { return { open: this.fileDialogs.get(tabId) ?? null, last: this.fileDialogOutcomes.get(tabId) ?? null }; }

  private event(tabId: number, method: string, params: Record<string, unknown>) {
    if (method === "Page.javascriptDialogOpening") {
      const dialog = dialogFromEvent(params);
      this.dialogs.set(tabId, dialog);
      for (const waiter of this.dialogWaiters.get(tabId) ?? []) waiter(dialog);
    } else if (method === "Page.javascriptDialogClosed") {
      this.dialogs.delete(tabId);
    } else if (method === "Page.fileChooserOpened") {
      // Only <input type=file> choosers have an element to fill.
      if (typeof params.backendNodeId === "number") this.choosers.set(tabId, { backend_node_id: params.backendNodeId, mode: String(params.mode ?? "selectSingle") });
    } else if (method === "Page.frameNavigated") {
      const frame = params.frame as { id?: string; parentId?: string } | undefined;
      if (frame && !frame.parentId) { this.worlds.delete(tabId); if (frame.id) this.mainFrames.set(tabId, frame.id); this.choosers.delete(tabId); }
    } else if (method === "Page.frameStartedLoading") {
      if (params.frameId === this.mainFrames.get(tabId)) this.navigations.set(tabId, (this.navigations.get(tabId) ?? 0) + 1);
    } else if (method === "Page.loadEventFired" || method === "Page.frameStoppedLoading" && params.frameId === this.mainFrames.get(tabId)) {
      this.loads.set(tabId, (this.loads.get(tabId) ?? 0) + 1);
    } else if (method === "Runtime.executionContextsCleared") {
      this.worlds.delete(tabId);
    } else if (method === "Runtime.bindingCalled" && params.name === FILE_PICKER_BINDING) {
      try {
        const data = JSON.parse(String(params.payload)) as Record<string, unknown>;
        if (data.phase === "open") {
          this.fileDialogs.set(tabId, { id: Number(data.id), kind: data.kind === "open" || data.kind === "folder" ? data.kind : "save",
            suggested_name: typeof data.suggested_name === "string" ? data.suggested_name.slice(0, 300) : null,
            types: Array.isArray(data.types) ? (data.types as BrowserFileDialog["types"]).slice(0, 10) : [], multiple: data.multiple === true });
          this.fileDialogOutcomes.delete(tabId);
          void this.letPickerThrough(tabId, Number(data.id));
        } else if (data.phase === "closed") {
          void this.transport.send(tabId, "Page.setInterceptFileChooserDialog", { enabled: true }, this.options.commandTimeoutMs).catch(() => undefined);
          if (this.fileDialogs.get(tabId)?.id === Number(data.id)) this.fileDialogs.delete(tabId);
          this.fileDialogOutcomes.set(tabId, { id: Number(data.id), outcome: String(data.outcome), ...(Array.isArray(data.names) ? { names: data.names.map(String) } : {}),
            ...(data.message ? { message: String(data.message).slice(0, 300) } : {}) });
        }
      } catch { /* malformed report from the page: ignore */ }
    }
  }

  private forget(tabId: number) {
    // The selection stays, so the next call explains why the tab is no longer controlled.
    this.attached.delete(tabId); this.worlds.delete(tabId); this.choosers.delete(tabId); this.mainFrames.delete(tabId);
  }

  /** Takes control of a tab (the user's already-open tab or one DreamGraph opened). */
  private refuseProtected(url: string) {
    const reason = url ? this.options.protectedUrl(url) : null;
    if (reason) throw new BrowserActionError("BROWSER_TAB_PROTECTED", `${reason}; DreamGraph never operates its own pages. Use the tab of the app or site the task is about`);
  }

  async control(tabId: number): Promise<void> {
    if (!this.attached.has(tabId)) {
      const tab = (await this.transport.listTabs().catch(() => [] as BrowserTab[])).find(item => item.tab_id === tabId);
      if (tab) this.refuseProtected(tab.url);
      this.detachReasons.delete(tabId);
      await this.transport.attach(tabId);
      this.attached.add(tabId);
      const known = await this.transport.dialog(tabId);
      if (known) this.dialogs.set(tabId, known);
      if (!known) {
        await this.transport.send(tabId, "Page.setInterceptFileChooserDialog", { enabled: true }, this.options.commandTimeoutMs).catch(() => undefined);
        // OS file dialogs (File System Access pickers) are reported by a page hook through a Runtime binding.
        await this.transport.send(tabId, "Runtime.enable", {}, this.options.commandTimeoutMs).catch(() => undefined);
        await this.transport.send(tabId, "Runtime.addBinding", { name: FILE_PICKER_BINDING }, this.options.commandTimeoutMs).catch(() => undefined);
        await this.transport.send(tabId, "Page.addScriptToEvaluateOnNewDocument", { source: FILE_PICKER_HOOK }, this.options.commandTimeoutMs).catch(() => undefined);
        await this.transport.send(tabId, "Runtime.evaluate", { expression: FILE_PICKER_HOOK }, this.options.commandTimeoutMs).catch(() => undefined);
        const tree = await this.transport.send<{ frameTree?: { frame?: { id?: string } } }>(tabId, "Page.getFrameTree", {}, this.options.commandTimeoutMs).catch(() => null);
        const frameId = tree?.frameTree?.frame?.id;
        if (frameId) this.mainFrames.set(tabId, frameId);
      }
    }
    this.current = tabId;
  }

  private tab(tabId?: number): number {
    const id = tabId ?? this.current;
    if (id === null || id === undefined) throw new BrowserActionError("BROWSER_NO_TAB", "no tab is selected; use browser_tabs to list and select one, or open one");
    if (!this.attached.has(id)) {
      const reason = this.detachReasons.get(id);
      if (reason === "canceled_by_user") throw new BrowserActionError("BROWSER_CONTROL_CANCELLED_BY_USER",
        `the user stopped DreamGraph's control of tab ${id} (Cancel on the browser's debugging bar); do not take it again unless the user asks`);
      throw new BrowserActionError("BROWSER_TAB_NOT_CONTROLLED", `tab ${id} is not controlled${reason ? ` (${reason})` : ""}; select it with browser_tabs first`);
    }
    return id;
  }

  /** Refuses page-bound work while a dialog is open. */
  private guard(tabId: number) {
    const dialog = this.dialogs.get(tabId);
    if (dialog) throw new BrowserActionError("DIALOG_OPEN",
      `a ${dialog.type} dialog is open on this tab (${JSON.stringify(dialog.message)}); answer it with browser_dialog before anything else`, dialog);
  }

  /** A page-bound command that returns early when a dialog opens and classifies timeouts. */
  private async page<T>(tabId: number, method: string, params: Record<string, unknown> = {}, timeoutMs = this.options.commandTimeoutMs): Promise<{ value?: T; dialog?: BrowserDialog }> {
    this.guard(tabId);
    let release: (() => void) | undefined;
    const opened = new Promise<BrowserDialog>(resolve => {
      const waiters = this.dialogWaiters.get(tabId) ?? new Set<Waiter>(); this.dialogWaiters.set(tabId, waiters);
      const waiter: Waiter = dialog => resolve(dialog); waiters.add(waiter); release = () => waiters.delete(waiter);
    });
    try {
      const sent = this.transport.send<T>(tabId, method, params, timeoutMs);
      // The command may never answer while the dialog is open; it is left to settle on its own.
      sent.catch(() => undefined);
      const outcome = await Promise.race([sent.then(value => ({ value })), opened.then(dialog => ({ dialog }))]);
      return outcome;
    } catch (error) {
      if (error instanceof BrowserTimeoutError) {
        const dialog = this.dialogs.get(tabId) ?? await this.transport.dialog(tabId).catch(() => null) ?? undefined;
        if (dialog) { this.dialogs.set(tabId, dialog); return { dialog }; }
        throw new BrowserActionError("TAB_UNRESPONSIVE", `${method} got no answer within ${timeoutMs} ms; the page may be busy or blocked `
          + "by a dialog that opened before DreamGraph took control. Take a screenshot, wait, or use another tab");
      }
      throw error;
    } finally { release?.(); }
  }

  private async world(tabId: number): Promise<number> {
    const known = this.worlds.get(tabId);
    if (known !== undefined) return known;
    let frameId = this.mainFrames.get(tabId);
    if (!frameId) {
      const tree = await this.page<{ frameTree: { frame: { id: string } } }>(tabId, "Page.getFrameTree");
      if (tree.dialog) throw new BrowserActionError("DIALOG_OPEN", "a dialog opened", tree.dialog);
      frameId = tree.value?.frameTree?.frame?.id;
      if (!frameId) throw new BrowserActionError("BROWSER_PAGE_UNAVAILABLE", "the page has no main frame yet; wait and try again");
      this.mainFrames.set(tabId, frameId);
    }
    const created = await this.page<{ executionContextId: number }>(tabId, "Page.createIsolatedWorld", { frameId, worldName: "dreamgraph", grantUniveralAccess: false });
    if (created.dialog) throw new BrowserActionError("DIALOG_OPEN", "a dialog opened", created.dialog);
    this.worlds.set(tabId, created.value!.executionContextId);
    return created.value!.executionContextId;
  }

  /** Runs one of the page scripts in DreamGraph's isolated world. */
  private async script<T>(tabId: number, source: string, args: unknown[], timeoutMs = this.options.commandTimeoutMs): Promise<{ value?: T; dialog?: BrowserDialog }> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const contextId = await this.world(tabId);
      const outcome = await this.page<{ result?: { value?: T }; exceptionDetails?: { text?: string; exception?: { description?: string } } }>(tabId, "Runtime.evaluate", {
        expression: `(${source})(${args.map(arg => JSON.stringify(arg)).join(",")})`, contextId, returnByValue: true, awaitPromise: true }, timeoutMs)
        .catch((error: unknown) => {
          if (attempt === 0 && error instanceof Error && /context|Cannot find/i.test(error.message)) { this.worlds.delete(tabId); return null; }
          throw error;
        });
      if (outcome === null) continue;
      if (outcome.dialog) return { dialog: outcome.dialog };
      const details = outcome.value?.exceptionDetails;
      if (details) {
        const message = details.exception?.description ?? details.text ?? "script failed";
        if (attempt === 0 && /context|Cannot find/i.test(message)) { this.worlds.delete(tabId); continue; }
        throw new BrowserActionError("BROWSER_SCRIPT_FAILED", message.slice(0, 500));
      }
      return { value: outcome.value?.result?.value as T };
    }
    throw new BrowserActionError("BROWSER_SCRIPT_FAILED", "DreamGraph's page context could not be created");
  }

  async state(tabId?: number): Promise<PageState | null> {
    const id = tabId ?? this.current;
    if (id === null || id === undefined) return null;
    const tabs = await this.transport.listTabs().catch(() => [] as BrowserTab[]);
    const tab = tabs.find(item => item.tab_id === id);
    return tab ? { tab_id: id, url: tab.url, title: tab.title } : { tab_id: id, url: "", title: "" };
  }

  private async result(tabId: number, extra: Partial<ActionResult> = {}): Promise<ActionResult> {
    const dialog = this.dialogs.get(tabId);
    const chooser = this.choosers.get(tabId), fileDialog = this.fileDialogs.get(tabId);
    return { tab: await this.state(tabId), ...(dialog ? { dialog } : {}), ...(fileDialog ? { file_dialog: fileDialog } : {}),
      ...(chooser ? { file_chooser: { mode: chooser.mode } } : {}), ...extra };
  }

  /** After an input: a short settle, and when a navigation started, wait (bounded) for it to load. */
  private async settle(tabId: number, navigationsBefore: number, loadsBefore: number): Promise<boolean> {
    await sleep(this.options.settleMs);
    const navigated = (this.navigations.get(tabId) ?? 0) > navigationsBefore;
    if (navigated) {
      const deadline = Date.now() + this.options.navigationTimeoutMs;
      while (Date.now() < deadline && (this.loads.get(tabId) ?? 0) <= loadsBefore && !this.dialogs.has(tabId)) await sleep(100);
    }
    return navigated;
  }

  private async point(tabId: number, target: Target): Promise<{ point?: Point; dialog?: BrowserDialog; note?: string; box?: { x: number; y: number; width: number; height: number } }> {
    if ("ref" in target) {
      const resolved = await this.script<{ error?: string; x: number; y: number; covered: boolean; cover: string | null; box: { x: number; y: number; width: number; height: number } }>(tabId, RESOLVE_SCRIPT, [target.ref]);
      if (resolved.dialog) return { dialog: resolved.dialog };
      const value = resolved.value!;
      if (value.error) throw new BrowserActionError(value.error, `element ${target.ref} is ${value.error === "BROWSER_REF_STALE" ? "gone; take a new snapshot" : "not visible"}`);
      return { point: { x: value.x, y: value.y }, box: value.box, note: value.covered ? `another element (${value.cover}) covers ${target.ref} at its centre` : undefined };
    }
    if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) throw new BrowserActionError("BROWSER_ARGUMENTS", "x and y must be numbers (CSS pixels)");
    return { point: { x: target.x, y: target.y } };
  }

  /** Chrome's chooser interception would abort a File System Access picker: switch it off for this picker. */
  private async letPickerThrough(tabId: number, id: number) {
    await this.transport.send(tabId, "Page.setInterceptFileChooserDialog", { enabled: false }, this.options.commandTimeoutMs).catch(() => undefined);
    await this.transport.send(tabId, "Runtime.evaluate", { expression: `window.__dreamgraphPickerGo && window.__dreamgraphPickerGo(${Number.isInteger(id) ? id : 0})` },
      this.options.commandTimeoutMs).catch(() => undefined);
  }

  /** The page waits for the OS file dialog; input to it would act behind the dialog's back. */
  private guardFileDialog(tabId: number) {
    const picker = this.fileDialogs.get(tabId);
    if (picker) throw new BrowserActionError("FILE_DIALOG_OPEN", `the page opened an OS ${picker.kind} file dialog${picker.suggested_name ? ` (suggested ${JSON.stringify(picker.suggested_name)})` : ""}; `
      + "answer it with browser_file_dialog (a full path, or cancel) before anything else");
  }

  private async withInput(tabId: number, run: () => Promise<{ dialog?: BrowserDialog; note?: string } | void>): Promise<ActionResult> {
    this.guardFileDialog(tabId);
    const navigations = this.navigations.get(tabId) ?? 0, loads = this.loads.get(tabId) ?? 0;
    const outcome = await run() ?? {};
    if (outcome.dialog) return this.result(tabId, { note: "the action opened a dialog; the page is blocked until you answer it with browser_dialog" });
    const navigated = await this.settle(tabId, navigations, loads);
    return this.result(tabId, { ...(navigated ? { navigated } : {}), ...(outcome.note ? { note: outcome.note } : {}) });
  }

  private async mouse(tabId: number, type: string, point: Point, extra: Record<string, unknown> = {}): Promise<BrowserDialog | undefined> {
    const outcome = await this.page(tabId, "Input.dispatchMouseEvent", { type, x: point.x, y: point.y, ...extra });
    return outcome.dialog;
  }

  async click(target: Target, options: { button?: "left" | "right" | "middle"; click_count?: number; modifiers?: string[] } = {}, tabId?: number): Promise<ActionResult> {
    const id = this.tab(tabId);
    return this.withInput(id, async () => {
      const resolved = await this.point(id, target);
      if (resolved.dialog) return { dialog: resolved.dialog };
      const button = options.button ?? "left", clickCount = Math.min(Math.max(options.click_count ?? 1, 1), 3);
      const modifiers = modifierBits(options.modifiers);
      let dialog = await this.mouse(id, "mouseMoved", resolved.point!, { modifiers });
      for (let count = 1; !dialog && count <= clickCount; count += 1) {
        dialog = await this.mouse(id, "mousePressed", resolved.point!, { button, clickCount: count, modifiers })
          ?? await this.mouse(id, "mouseReleased", resolved.point!, { button, clickCount: count, modifiers });
      }
      return { dialog, note: resolved.note };
    });
  }

  async hover(target: Target, tabId?: number): Promise<ActionResult> {
    const id = this.tab(tabId);
    return this.withInput(id, async () => {
      const resolved = await this.point(id, target);
      if (resolved.dialog) return { dialog: resolved.dialog };
      return { dialog: await this.mouse(id, "mouseMoved", resolved.point!), note: resolved.note };
    });
  }

  async drag(from: Target, to: Target, steps = 12, tabId?: number): Promise<ActionResult> {
    const id = this.tab(tabId);
    return this.withInput(id, async () => {
      const start = await this.point(id, from); if (start.dialog) return { dialog: start.dialog };
      const end = await this.point(id, to); if (end.dialog) return { dialog: end.dialog };
      const a = start.point!, b = end.point!, count = Math.min(Math.max(Math.round(steps), 1), 100);
      let dialog = await this.mouse(id, "mouseMoved", a) ?? await this.mouse(id, "mousePressed", a, { button: "left", clickCount: 1, buttons: 1 });
      for (let step = 1; !dialog && step <= count; step += 1) {
        dialog = await this.mouse(id, "mouseMoved", { x: a.x + (b.x - a.x) * step / count, y: a.y + (b.y - a.y) * step / count }, { button: "left", buttons: 1 });
      }
      dialog ??= await this.mouse(id, "mouseReleased", b, { button: "left", clickCount: 1 });
      return { dialog };
    });
  }

  async scroll(target: Target | null, delta: { x?: number; y?: number }, tabId?: number): Promise<ActionResult> {
    const id = this.tab(tabId);
    return this.withInput(id, async () => {
      let point: Point = { x: 200, y: 200 };
      if (target) { const resolved = await this.point(id, target); if (resolved.dialog) return { dialog: resolved.dialog }; point = resolved.point!; }
      return { dialog: await this.mouse(id, "mouseWheel", point, { deltaX: delta.x ?? 0, deltaY: delta.y ?? 0 }) };
    });
  }

  async type(text: string, options: { ref?: string; clear?: boolean; submit?: boolean } = {}, tabId?: number): Promise<ActionResult> {
    const id = this.tab(tabId);
    return this.withInput(id, async () => {
      if (options.ref) {
        const focused = await this.script<{ error?: string; focused?: boolean }>(id, FOCUS_SCRIPT, [options.ref, options.clear === true]);
        if (focused.dialog) return { dialog: focused.dialog };
        if (focused.value?.error) throw new BrowserActionError(focused.value.error, `element ${options.ref} is gone; take a new snapshot`);
        if (options.clear) { const removed = await this.keys(id, "Delete"); if (removed) return { dialog: removed }; }
      }
      if (text) {
        const typed = await this.page(id, "Input.insertText", { text });
        if (typed.dialog) return { dialog: typed.dialog };
      }
      if (options.submit) { const submitted = await this.keys(id, "Enter"); if (submitted) return { dialog: submitted }; }
      return {};
    });
  }

  private async keys(tabId: number, chord: string): Promise<BrowserDialog | undefined> {
    const parsed = parseKeyChord(chord);
    let modifiers = 0;
    for (const key of parsed.modifierKeys) {
      modifiers |= MODIFIER_BITS[key.key] ?? 0;
      const down = await this.page(tabId, "Input.dispatchKeyEvent", { type: "rawKeyDown", modifiers, key: key.key, code: key.code, windowsVirtualKeyCode: key.keyCode, location: key.location });
      if (down.dialog) return down.dialog;
    }
    for (const key of parsed.keys) {
      const common = { modifiers, key: key.key, code: key.code, windowsVirtualKeyCode: key.keyCode, nativeVirtualKeyCode: key.keyCode };
      const down = await this.page(tabId, "Input.dispatchKeyEvent", { ...common, type: key.text ? "keyDown" : "rawKeyDown", ...(key.text ? { text: key.text, unmodifiedText: key.text } : {}) });
      if (down.dialog) return down.dialog;
      const up = await this.page(tabId, "Input.dispatchKeyEvent", { ...common, type: "keyUp" });
      if (up.dialog) return up.dialog;
    }
    for (const key of [...parsed.modifierKeys].reverse()) {
      modifiers &= ~(MODIFIER_BITS[key.key] ?? 0);
      const up = await this.page(tabId, "Input.dispatchKeyEvent", { type: "keyUp", modifiers, key: key.key, code: key.code, windowsVirtualKeyCode: key.keyCode, location: key.location });
      if (up.dialog) return up.dialog;
    }
    return undefined;
  }

  async press(chord: string, repeat = 1, tabId?: number): Promise<ActionResult> {
    const id = this.tab(tabId);
    return this.withInput(id, async () => {
      for (let count = 0; count < Math.min(Math.max(Math.round(repeat), 1), 50); count += 1) {
        const dialog = await this.keys(id, chord); if (dialog) return { dialog };
      }
      return {};
    });
  }

  async snapshot(tabId?: number): Promise<SnapshotResult | { dialog: BrowserDialog; tab: PageState | null }> {
    const id = this.tab(tabId);
    const outcome = await this.script<Omit<SnapshotResult, "tab_id">>(id, SNAPSHOT_SCRIPT, [{ maxLines: 800, maxChars: this.options.snapshotMaxChars }]);
    if (outcome.dialog) return { dialog: outcome.dialog, tab: await this.state(id) };
    return { tab_id: id, ...outcome.value! };
  }

  async screenshot(options: { ref?: string } = {}, tabId?: number): Promise<{ result: ActionResult; image?: { mimeType: string; dataBase64: string; width: number; height: number; scale: number } }> {
    const id = this.tab(tabId);
    this.guard(id);
    const metrics = await this.page<{ cssVisualViewport: { pageX: number; pageY: number; clientWidth: number; clientHeight: number }; visualViewport?: { clientWidth: number } }>(id, "Page.getLayoutMetrics");
    if (metrics.dialog) return { result: await this.result(id) };
    const viewport = metrics.value!.cssVisualViewport;
    let clip = { x: viewport.pageX, y: viewport.pageY, width: viewport.clientWidth, height: viewport.clientHeight };
    if (options.ref) {
      const resolved = await this.point(id, { ref: options.ref });
      if (resolved.dialog) return { result: await this.result(id) };
      const fresh = await this.page<{ cssVisualViewport: { pageX: number; pageY: number } }>(id, "Page.getLayoutMetrics");
      const origin = fresh.value?.cssVisualViewport ?? viewport;
      clip = { x: origin.pageX + resolved.box!.x, y: origin.pageY + resolved.box!.y, width: resolved.box!.width, height: resolved.box!.height };
    }
    const ratio = await this.script<number>(id, "(function(){return devicePixelRatio;})", []);
    if (ratio.dialog) return { result: await this.result(id) };
    const dpr = Number(ratio.value) || 1, scale = Math.min(1, this.options.maxScreenshotWidth / Math.max(clip.width, 1));
    const shot = await this.page<{ data: string }>(id, "Page.captureScreenshot", { format: "jpeg", quality: 70, captureBeyondViewport: false,
      clip: { ...clip, scale: scale / dpr } }, 20_000);
    if (shot.dialog) return { result: await this.result(id) };
    return { result: await this.result(id, scale < 1 ? { note: `image is scaled ${scale.toFixed(3)}×; divide image pixels by this to get page (CSS) pixels` } : {}),
      image: { mimeType: "image/jpeg", dataBase64: shot.value!.data, width: Math.round(clip.width * scale), height: Math.round(clip.height * scale), scale } };
  }

  async navigate(input: { url?: string; action?: "back" | "forward" | "reload" }, tabId?: number): Promise<ActionResult> {
    const id = this.tab(tabId);
    return this.withInput(id, async () => {
      if (input.action === "reload") return { dialog: (await this.page(id, "Page.reload", {})).dialog };
      if (input.action === "back" || input.action === "forward") {
        const history = await this.page<{ currentIndex: number; entries: Array<{ id: number }> }>(id, "Page.getNavigationHistory");
        if (history.dialog) return { dialog: history.dialog };
        const entry = history.value!.entries[history.value!.currentIndex + (input.action === "back" ? -1 : 1)];
        if (!entry) return { note: `there is no ${input.action} entry` };
        return { dialog: (await this.page(id, "Page.navigateToHistoryEntry", { entryId: entry.id })).dialog };
      }
      if (!input.url) throw new BrowserActionError("BROWSER_ARGUMENTS", "url is required");
      this.refuseProtected(input.url);
      const outcome = await this.page<{ errorText?: string }>(id, "Page.navigate", { url: input.url }, this.options.navigationTimeoutMs);
      if (outcome.value?.errorText) throw new BrowserActionError("BROWSER_NAVIGATION_FAILED", outcome.value.errorText);
      return { dialog: outcome.dialog };
    });
  }

  /** Answers the open dialog on the tab. Uses the attachment that saw it (a new attachment cannot). */
  async answerDialog(accept: boolean, text?: string, tabId?: number): Promise<ActionResult> {
    const id = this.tab(tabId);
    const dialog = this.dialogs.get(id) ?? await this.transport.dialog(id);
    if (!dialog) return this.result(id, { note: "no dialog is open on this tab" });
    await this.transport.send(id, "Page.handleJavaScriptDialog", { accept, ...(text !== undefined ? { promptText: text } : {}) }, this.options.commandTimeoutMs);
    this.dialogs.delete(id);
    const navigations = this.navigations.get(id) ?? 0, loads = this.loads.get(id) ?? 0;
    const navigated = await this.settle(id, navigations, loads);
    return this.result(id, { note: `${accept ? "accepted" : "dismissed"} the ${dialog.type} dialog`, ...(navigated ? { navigated } : {}) });
  }

  /**
   * Answers the OS file dialog the page opened (File System Access picker). The browser host drives the dialog
   * on the desktop; the page hook then reports which file the page received.
   */
  async answerFileDialog(request: FileDialogRequest, tabId?: number): Promise<ActionResult> {
    const id = this.tab(tabId);
    if (!this.transport.fileDialog) throw new BrowserActionError("BROWSER_FILE_DIALOG_UNSUPPORTED", "this connection cannot operate OS file dialogs; ask the user to answer it");
    const picker = this.fileDialogs.get(id);
    let defaulted = false;
    if (request.action === "choose" && !request.path) {
      const folder = picker?.kind === "save" ? this.options.defaultFileFolder?.() ?? null : null;
      if (!folder) throw new BrowserActionError("BROWSER_ARGUMENTS", picker?.kind === "save" ? "path is required (a full path), or cancel" : "path is required for an open or folder dialog (a full path), or cancel");
      await mkdir(folder, { recursive: true });
      request = { ...request, path: await freePath(folder, defaultFileName(picker!)) };
      defaulted = true;
    }
    let answered = await this.transport.fileDialog(request);
    const stillPending = () => picker && this.fileDialogs.get(id)?.id === picker.id;
    if (request.action === "choose" && request.path && picker?.kind === "save" &&
        ["done", "not_found"].includes(answered.status) && this.transport.confirmSave) {
      // Chrome may add a browser-owned file-type warning after the OS picker.
      // It is not Page.handleJavaScriptDialog and must not be answered with an unscoped Enter.
      const quickDeadline = Date.now() + 500;
      while (Date.now() < quickDeadline && stillPending()) await sleep(50);
      if (stillPending()) {
        const tab = (await this.transport.listTabs()).find(tab => tab.tab_id === id);
        if (tab) answered = await this.transport.confirmSave({ tab_id: id, path: request.path, origin: new URL(tab.url).origin });
      }
    }
    if (answered.status === "done" || answered.status === "cancelled") {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline && stillPending()) await sleep(100);
      if (stillPending()) answered = { status: "needs_confirmation", message: "The picker or browser confirmation is still pending; no completed Save is claimed." };
    }
    const outcome = this.fileDialogOutcomes.get(id);
    const page = outcome && picker && outcome.id === picker.id
      ? outcome.outcome === "chosen" ? `the page received ${outcome.names?.join(", ") || "the file"}` : `the page reports ${outcome.outcome}${outcome.message ? `: ${outcome.message}` : ""}`
      : picker ? "the page has not reported the result yet" : "no file dialog was known to be open";
    const where = defaulted ? `; no path was given, so DreamGraph's default folder was used: ${request.path}` : "";
    return this.result(id, { note: `file dialog: ${answered.status}${answered.message ? ` (${answered.message})` : ""}; ${page}${where}` });
  }

  async fileChooser(files: string[] | null, tabId?: number): Promise<ActionResult> {
    const id = this.tab(tabId);
    const chooser = this.choosers.get(id);
    if (!chooser) return this.result(id, { note: "no file chooser is open; click the file input or upload button first" });
    this.choosers.delete(id);
    if (!files || !files.length) return this.result(id, { note: "file chooser cancelled; no files were set" });
    const outcome = await this.page(id, "DOM.setFileInputFiles", { files, backendNodeId: chooser.backend_node_id });
    return this.result(id, { note: `set ${files.length} file(s)`, ...(outcome.dialog ? {} : {}) });
  }

  /** Page JavaScript in the page's own main world (escape hatch). The page is untrusted; so is the result. */
  async evaluate(expression: string, tabId?: number): Promise<{ result: ActionResult; value?: string }> {
    const id = this.tab(tabId);
    this.guardFileDialog(id);
    const outcome = await this.page<{ result?: { value?: unknown; type?: string; description?: string }; exceptionDetails?: { text?: string; exception?: { description?: string } } }>(id,
      "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true }, 30_000);
    if (outcome.dialog) return { result: await this.result(id, { note: "the script opened a dialog; answer it with browser_dialog" }) };
    const details = outcome.value?.exceptionDetails;
    if (details) throw new BrowserActionError("BROWSER_SCRIPT_FAILED", (details.exception?.description ?? details.text ?? "script failed").slice(0, 2000));
    const result = outcome.value?.result;
    const value = result && "value" in result ? JSON.stringify(result.value) ?? "undefined" : result?.description ?? result?.type ?? "undefined";
    return { result: await this.result(id), value: value.length > 16_000 ? `${value.slice(0, 16_000)}… [${value.length} chars]` : value };
  }

  async waitFor(input: { ms?: number; text?: string }, tabId?: number): Promise<ActionResult> {
    const id = this.tab(tabId);
    if (input.text) {
      const timeout = Math.min(Math.max(input.ms ?? 10_000, 0), 30_000);
      const outcome = await this.script<{ found: boolean; waited_ms: number }>(id, WAIT_TEXT_SCRIPT, [input.text, timeout], timeout + 2_000);
      if (outcome.dialog) return this.result(id, { note: "a dialog opened while waiting" });
      return this.result(id, { note: outcome.value!.found ? `found after ${outcome.value!.waited_ms} ms` : `not found within ${timeout} ms` });
    }
    await sleep(Math.min(Math.max(input.ms ?? 1000, 0), 30_000));
    return this.result(id);
  }

  async listTabs(): Promise<Array<BrowserTab & { protected?: string }>> {
    const tabs = await this.transport.listTabs();
    return tabs.map(tab => { const reason = this.options.protectedUrl(tab.url);
      return { ...tab, controlled: this.attached.has(tab.tab_id), ...(reason ? { protected: reason } : {}) }; });
  }

  async openTab(url: string): Promise<ActionResult> {
    this.refuseProtected(url);
    const tab = await this.transport.openTab(url);
    await this.control(tab.tab_id);
    const loads = this.loads.get(tab.tab_id) ?? 0;
    const deadline = Date.now() + this.options.navigationTimeoutMs;
    while (Date.now() < deadline && (this.loads.get(tab.tab_id) ?? 0) <= loads && !this.dialogs.has(tab.tab_id)) await sleep(100);
    return this.result(tab.tab_id);
  }

  async selectTab(tabId: number): Promise<ActionResult> {
    await this.control(tabId);
    await this.transport.activateTab(tabId).catch(() => undefined);
    return this.result(tabId);
  }

  async closeTab(tabId: number): Promise<void> {
    if (this.attached.has(tabId)) await this.transport.detach(tabId).catch(() => undefined);
    this.forget(tabId);
    if (this.current === tabId) this.current = null;
    await this.transport.closeTab(tabId);
  }

  /** Ends control of every tab. Open dialogs stay in the browser for the user. */
  async release(): Promise<void> {
    const unconfirmed: number[] = [];
    for (const tabId of [...this.attached]) {
      // Pickers in pages that stay open no longer wait for DreamGraph.
      if (!this.dialogs.has(tabId)) await this.transport.send(tabId, "Runtime.evaluate", { expression: "window.__dreamgraphPickerOff = true" }, 2000).catch(() => undefined);
      await this.transport.detach(tabId).catch(() => { unconfirmed.push(tabId); });
    }
    this.attached.clear(); this.current = null;
    for (const stop of this.unsubscribe.splice(0)) stop();
    if (unconfirmed.length) throw new BrowserActionError("BROWSER_RELEASE_UNCONFIRMED", `Detach unconfirmed for ${unconfirmed.length} tab(s)`);
  }
}

const MODIFIER_BITS: Record<string, number> = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };
function modifierBits(names: string[] | undefined): number {
  let bits = 0;
  for (const name of names ?? []) { const key = name.toLowerCase(); bits |= key === "alt" ? 1 : key === "control" || key === "ctrl" ? 2 : key === "meta" || key === "cmd" ? 4 : key === "shift" ? 8 : 0; }
  return bits;
}
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** The page's suggested name (made safe for a file name), else "untitled" with the first accepted extension. */
export function defaultFileName(picker: BrowserFileDialog): string {
  const cleaned = (picker.suggested_name ?? "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/^[\s.]+|[\s.]+$/g, "");
  if (cleaned) return cleaned;
  const extension = picker.types.flatMap(type => type.accept).find(accept => /^\.[\w-]+$/.test(accept)) ?? "";
  return `untitled${extension}`;
}

/** name, or name-2, name-3 ... before the extension, whichever does not exist yet in folder. */
async function freePath(folder: string, name: string): Promise<string> {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name, extension = dot > 0 ? name.slice(dot) : "";
  for (let attempt = 1; ; attempt += 1) {
    const candidate = join(folder, attempt === 1 ? name : `${stem}-${attempt}${extension}`);
    if (!(await access(candidate).then(() => true, () => false))) return candidate;
  }
}
