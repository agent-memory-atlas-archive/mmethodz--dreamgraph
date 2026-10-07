/**
 * Daemon side of the browser bridge: a BrowserTransport over the browser host's local socket.
 * Finds a running host (one per Chrome profile with the DreamGraph extension), authenticates with its token
 * and relays commands. Closing the transport makes the host detach every tab this run controlled.
 */
import { connect, type Socket } from "node:net";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { BROWSER_BRIDGE_PROTOCOL, LineReader, encodeLine, type BridgeEvent, type BridgeResponse, type BrowserHostInfo } from "./protocol.js";
import { browserHostsDirectory } from "./host.js";
import { BrowserTimeoutError, type BrowserDetachListener, type BrowserDialog, type BrowserEventListener, type BrowserTab, type BrowserTransport, type FileDialogRequest, type FileDialogResult } from "./transport.js";

interface Pending { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout; method: string }

export class BrowserBridgeUnavailableError extends Error {
  constructor(message: string) { super(`DREAMGRAPH_BROWSER_UNAVAILABLE: ${message}`); }
}

/** Running hosts, newest first. */
export async function listBrowserHosts(home = homedir()): Promise<BrowserHostInfo[]> {
  const directory = browserHostsDirectory(home), hosts: BrowserHostInfo[] = [];
  for (const name of await readdir(directory).catch(() => [] as string[])) {
    if (!name.endsWith(".json")) continue;
    try {
      const info = JSON.parse(await readFile(join(directory, name), "utf8")) as BrowserHostInfo;
      if (info.protocol !== BROWSER_BRIDGE_PROTOCOL) continue;
      try { process.kill(info.pid, 0); } catch { continue; }
      hosts.push(info);
    } catch { /* a host is writing it */ }
  }
  return hosts.sort((a, b) => b.started_at.localeCompare(a.started_at));
}

export class BridgeTransport implements BrowserTransport {
  private socket!: Socket;
  private sequence = 0;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Set<BrowserEventListener>();
  private readonly detachListeners = new Set<BrowserDetachListener>();
  private closed = false;
  host!: BrowserHostInfo;
  extensionVersion: string | null = null;

  /** Connects to the newest running host that answers. */
  static async connect(options: { home?: string; timeoutMs?: number } = {}): Promise<BridgeTransport> {
    const hosts = await listBrowserHosts(options.home);
    if (!hosts.length) throw new BrowserBridgeUnavailableError("the DreamGraph Chrome extension is not connected (no browser host is running). "
      + "Open Chrome with the DreamGraph extension installed (Config → Computer Use shows how).");
    let last: unknown;
    for (const host of hosts) {
      const transport = new BridgeTransport();
      try { await transport.open(host, options.timeoutMs ?? 5000); return transport; }
      catch (error) { last = error; await transport.close().catch(() => undefined); }
    }
    throw new BrowserBridgeUnavailableError(`no browser host answered (${last instanceof Error ? last.message : String(last)})`);
  }

  private async open(host: BrowserHostInfo, timeoutMs: number) {
    this.host = host;
    this.socket = connect(host.endpoint);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("BROWSER_HOST_CONNECT_TIMEOUT")), timeoutMs);
      this.socket.once("connect", () => { clearTimeout(timer); resolve(); });
      this.socket.once("error", error => { clearTimeout(timer); reject(error); });
    });
    const reader = new LineReader(message => this.message(message as BridgeResponse & BridgeEvent));
    this.socket.on("data", chunk => reader.push(chunk));
    this.socket.on("error", () => undefined);
    this.socket.on("close", () => {
      this.closed = true;
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error("BROWSER_HOST_DISCONNECTED")); }
      this.pending.clear();
    });
    const hello = await this.request<{ extension_version: string | null }>("hello", { token: host.token, protocol: BROWSER_BRIDGE_PROTOCOL }, timeoutMs);
    this.extensionVersion = hello.extension_version;
  }

  private message(message: BridgeResponse & BridgeEvent) {
    if (typeof message.event === "string") {
      if (message.event === "cdp" && message.method) for (const listener of this.listeners) listener(message.tab_id, message.method, message.params ?? {});
      if (message.event === "detach" || message.event === "tab_removed") for (const listener of this.detachListeners) listener(message.tab_id, message.reason ?? message.event);
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id); clearTimeout(pending.timer);
    if (message.error) pending.reject(new Error(`${message.error.code}: ${message.error.message}`));
    else pending.resolve(message.result ?? {});
  }

  private request<T>(method: string, params: Record<string, unknown> = {}, timeoutMs = 10_000, label = method): Promise<T> {
    if (this.closed) return Promise.reject(new Error("BROWSER_HOST_DISCONNECTED"));
    return new Promise<T>((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new BrowserTimeoutError(label, timeoutMs)); }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer, method });
      this.socket.write(encodeLine({ id, method, params }));
    });
  }

  listTabs(): Promise<BrowserTab[]> { return this.request<BrowserTab[]>("tabs.list"); }
  openTab(url: string): Promise<BrowserTab> { return this.request<BrowserTab>("tabs.open", { url }); }
  async closeTab(tabId: number): Promise<void> { await this.request("tabs.close", { tab_id: tabId }); }
  async activateTab(tabId: number): Promise<void> { await this.request("tabs.activate", { tab_id: tabId }); }
  async attach(tabId: number): Promise<void> { await this.request("debugger.attach", { tab_id: tabId }, 15_000); }
  async detach(tabId: number): Promise<void> { await this.request("debugger.detach", { tab_id: tabId }); }
  send<T>(tabId: number, method: string, params: Record<string, unknown> = {}, timeoutMs = 10_000): Promise<T> {
    return this.request<T>("debugger.send", { tab_id: tabId, method, params }, timeoutMs, method);
  }
  async dialog(tabId: number): Promise<BrowserDialog | null> {
    return (await this.request<{ dialog: BrowserDialog | null }>("dialog.get", { tab_id: tabId })).dialog;
  }
  fileDialog(request: FileDialogRequest): Promise<FileDialogResult> { return this.request<FileDialogResult>("os.file_dialog", { ...request }, 45_000); }
  onEvent(listener: BrowserEventListener) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  onDetach(listener: BrowserDetachListener) { this.detachListeners.add(listener); return () => { this.detachListeners.delete(listener); }; }
  async close(): Promise<void> {
    if (!this.socket) return;
    await new Promise<void>(resolve => { if (this.socket.destroyed) return resolve(); this.socket.end(() => resolve()); setTimeout(resolve, 1000); });
    this.socket.destroy();
  }
}
