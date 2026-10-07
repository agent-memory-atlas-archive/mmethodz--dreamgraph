/**
 * BrowserTransport over a direct Chrome DevTools Protocol connection (a Chromium started with
 * --remote-debugging-port). Used by tests and for local diagnostics; production uses the extension transport.
 * Mirrors the extension's semantics: one attachment per tab, Page enabled, dialog state kept from events.
 */
import { BrowserTimeoutError, dialogFromEvent, type BrowserDetachListener, type BrowserDialog, type BrowserEventListener, type BrowserTab, type BrowserTransport } from "./transport.js";

interface Pending { resolve: (value: unknown) => void; reject: (error: Error) => void; timer?: NodeJS.Timeout }

export class CdpDirectTransport implements BrowserTransport {
  private socket!: WebSocket;
  private sequence = 0;
  private readonly pending = new Map<number, Pending>();
  private readonly tabIds = new Map<string, number>();
  private readonly targets = new Map<number, string>();
  private readonly sessions = new Map<number, string>();
  private readonly tabsBySession = new Map<string, number>();
  private readonly dialogs = new Map<number, BrowserDialog>();
  private readonly listeners = new Set<BrowserEventListener>();
  private readonly detachListeners = new Set<BrowserDetachListener>();
  private nextTab = 1;

  static async connect(browserWebSocketUrl: string): Promise<CdpDirectTransport> {
    const transport = new CdpDirectTransport();
    await transport.open(browserWebSocketUrl);
    return transport;
  }

  private async open(url: string) {
    this.socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => { this.socket.onopen = () => resolve(); this.socket.onerror = () => reject(new Error("CDP_CONNECT_FAILED")); });
    this.socket.onmessage = message => this.message(JSON.parse(String(message.data)));
    this.socket.onclose = () => { for (const pending of this.pending.values()) pending.reject(new Error("CDP_CLOSED")); this.pending.clear(); };
  }

  private message(data: { id?: number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { message: string }; sessionId?: string }) {
    if (data.id !== undefined) {
      const pending = this.pending.get(data.id); if (!pending) return;
      this.pending.delete(data.id); if (pending.timer) clearTimeout(pending.timer);
      if (data.error) pending.reject(new Error(data.error.message)); else pending.resolve(data.result ?? {});
      return;
    }
    if (data.method === "Target.detachedFromTarget") {
      const tabId = this.tabsBySession.get(String(data.params?.sessionId));
      if (tabId !== undefined) { this.sessions.delete(tabId); this.tabsBySession.delete(String(data.params?.sessionId)); for (const listener of this.detachListeners) listener(tabId, "target_detached"); }
      return;
    }
    const tabId = data.sessionId ? this.tabsBySession.get(data.sessionId) : undefined;
    if (tabId === undefined || !data.method) return;
    if (data.method === "Page.javascriptDialogOpening") this.dialogs.set(tabId, dialogFromEvent(data.params ?? {}));
    if (data.method === "Page.javascriptDialogClosed") this.dialogs.delete(tabId);
    for (const listener of this.listeners) listener(tabId, data.method, data.params ?? {});
  }

  private raw<T>(method: string, params: Record<string, unknown> = {}, sessionId?: string, timeoutMs = 10_000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = ++this.sequence;
      const pending: Pending = { resolve: resolve as (value: unknown) => void, reject };
      pending.timer = setTimeout(() => { this.pending.delete(id); reject(new BrowserTimeoutError(method, timeoutMs)); }, timeoutMs);
      this.pending.set(id, pending);
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  private idFor(targetId: string): number {
    let id = this.tabIds.get(targetId);
    if (id === undefined) { id = this.nextTab++; this.tabIds.set(targetId, id); this.targets.set(id, targetId); }
    return id;
  }

  async listTabs(): Promise<BrowserTab[]> {
    const { targetInfos } = await this.raw<{ targetInfos: Array<{ targetId: string; type: string; url: string; title: string; attached: boolean }> }>("Target.getTargets");
    return targetInfos.filter(info => info.type === "page").map(info => ({ tab_id: this.idFor(info.targetId), window_id: 1, url: info.url, title: info.title,
      active: false, controlled: this.sessions.has(this.idFor(info.targetId)) }));
  }
  async openTab(url: string): Promise<BrowserTab> {
    const { targetId } = await this.raw<{ targetId: string }>("Target.createTarget", { url });
    return { tab_id: this.idFor(targetId), window_id: 1, url, title: "", active: true, controlled: false };
  }
  async closeTab(tabId: number): Promise<void> { await this.raw("Target.closeTarget", { targetId: this.target(tabId) }); }
  async activateTab(tabId: number): Promise<void> { await this.raw("Target.activateTarget", { targetId: this.target(tabId) }); }
  private target(tabId: number): string { const target = this.targets.get(tabId); if (!target) throw new Error("BROWSER_TAB_UNKNOWN"); return target; }

  async attach(tabId: number): Promise<void> {
    if (this.sessions.has(tabId)) return;
    const { sessionId } = await this.raw<{ sessionId: string }>("Target.attachToTarget", { targetId: this.target(tabId), flatten: true });
    this.sessions.set(tabId, sessionId); this.tabsBySession.set(sessionId, tabId);
    await this.raw("Page.enable", {}, sessionId);
  }
  async detach(tabId: number): Promise<void> {
    const sessionId = this.sessions.get(tabId); if (!sessionId) return;
    this.sessions.delete(tabId); this.tabsBySession.delete(sessionId); this.dialogs.delete(tabId);
    await this.raw("Target.detachFromTarget", { sessionId }).catch(() => undefined);
  }
  async send<T>(tabId: number, method: string, params: Record<string, unknown> = {}, timeoutMs = 10_000): Promise<T> {
    const sessionId = this.sessions.get(tabId); if (!sessionId) throw new Error("BROWSER_TAB_NOT_ATTACHED");
    return this.raw<T>(method, params, sessionId, timeoutMs);
  }
  async dialog(tabId: number): Promise<BrowserDialog | null> { return this.dialogs.get(tabId) ?? null; }
  onEvent(listener: BrowserEventListener) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  onDetach(listener: BrowserDetachListener) { this.detachListeners.add(listener); return () => { this.detachListeners.delete(listener); }; }
  async close(): Promise<void> { this.socket.close(); }
}
