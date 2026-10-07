/**
 * DreamGraph browser host: the native messaging host Chrome starts for the DreamGraph extension
 * (see protocol.ts). Relays daemon requests to the extension and the extension's CDP events to the daemon
 * connection that controls the tab. Run by Chrome as: node host.js <origin> [--parent-window=…].
 */
import { createServer, type Server, type Socket } from "node:net";
import { appendFile, chmod, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { homedir } from "node:os";
import { answerOsFileDialog } from "./file-dialog.js";
import type { FileDialogRequest } from "./transport.js";
import {
  BROWSER_BRIDGE_PROTOCOL, LineReader, NativeMessageReader, bridgeRunDirectory, browserHostEndpoint, encodeLine, encodeNativeMessage,
  type BridgeEvent, type BridgeRequest, type BridgeResponse, type BrowserHostInfo,
} from "./protocol.js";

export interface BrowserHostOptions {
  home?: string;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  endpoint?: string;
  log?: (line: string) => void;
}

interface Connection { socket: Socket; authenticated: boolean; tabs: Set<number> }
interface Relay { connection: Connection | null; id: number; resolve?: (value: unknown) => void; reject?: (error: Error) => void }

export function browserHostsDirectory(home = homedir()) { return join(bridgeRunDirectory(home), "browser-hosts"); }

export class BrowserHost {
  private server?: Server;
  private readonly relays = new Map<number, Relay>();
  private readonly owners = new Map<number, Connection>();
  private readonly connections = new Set<Connection>();
  private sequence = 0;
  private extensionVersion: string | null = null;
  readonly token = randomBytes(32).toString("hex");
  /** Desktop file dialog driver (replaceable in tests). */
  fileDialog: (request: FileDialogRequest) => ReturnType<typeof answerOsFileDialog> = request => answerOsFileDialog(request, { home: this.home });
  readonly endpoint: string;
  readonly infoFile: string;
  private closed = false;
  private readonly home: string;
  private readonly input: NodeJS.ReadableStream;
  private readonly output: NodeJS.WritableStream;
  private readonly log: (line: string) => void;

  constructor(options: BrowserHostOptions = {}) {
    this.home = options.home ?? homedir();
    this.input = options.input ?? process.stdin;
    this.output = options.output ?? process.stdout;
    this.endpoint = options.endpoint ?? `${browserHostEndpoint(this.home)}-${process.pid}`;
    this.infoFile = join(browserHostsDirectory(this.home), `${process.pid}.json`);
    this.log = options.log ?? (() => undefined);
  }

  async start(): Promise<void> {
    const reader = new NativeMessageReader(message => this.fromExtension(message as Record<string, unknown>), error => this.log(`extension message: ${error.message}`));
    this.input.on("data", (chunk: Buffer) => reader.push(chunk));
    this.input.on("end", () => void this.stop("extension disconnected"));
    await mkdir(browserHostsDirectory(this.home), { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") await rm(this.endpoint, { force: true });
    this.server = createServer(socket => this.accept(socket));
    await new Promise<void>((resolve, reject) => { this.server!.once("error", reject); this.server!.listen(this.endpoint, () => resolve()); });
    if (process.platform !== "win32") await chmod(this.endpoint, 0o600);
    await this.writeInfo();
    this.log(`listening on ${this.endpoint}`);
  }

  private async writeInfo() {
    const info: BrowserHostInfo = { protocol: BROWSER_BRIDGE_PROTOCOL, pid: process.pid, endpoint: this.endpoint, token: this.token,
      extension_version: this.extensionVersion, started_at: new Date().toISOString() };
    const temporary = `${this.infoFile}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(temporary, JSON.stringify(info), { mode: 0o600 });
    await rename(temporary, this.infoFile);
  }

  async stop(reason: string): Promise<void> {
    if (this.closed) return; this.closed = true;
    this.log(`stopping: ${reason}`);
    for (const connection of this.connections) connection.socket.destroy();
    for (const relay of this.relays.values()) relay.reject?.(new Error("BROWSER_HOST_STOPPED"));
    await new Promise<void>(resolve => this.server ? this.server.close(() => resolve()) : resolve());
    await rm(this.infoFile, { force: true });
    if (process.platform !== "win32") await rm(this.endpoint, { force: true });
  }

  /** Sends a request to the extension. */
  private toExtension(method: string, params: Record<string, unknown>, relay: Omit<Relay, "id"> & { id?: number }): number {
    const id = ++this.sequence;
    this.relays.set(id, { ...relay, id: relay.id ?? id } as Relay);
    this.output.write(encodeNativeMessage({ id, method, params }));
    return id;
  }
  private ask(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return new Promise((resolve, reject) => { this.toExtension(method, params, { connection: null, resolve, reject }); });
  }

  private fromExtension(message: Record<string, unknown>) {
    if (message.hello && typeof message.hello === "object") {
      this.extensionVersion = String((message.hello as Record<string, unknown>).version ?? "") || null;
      void this.writeInfo().catch(error => this.log(`info: ${String(error)}`));
      return;
    }
    if (typeof message.event === "string") { this.event(message as unknown as BridgeEvent); return; }
    const id = Number(message.id), relay = this.relays.get(id);
    if (!relay) return;
    this.relays.delete(id);
    const error = message.error as BridgeResponse["error"] | undefined;
    if (relay.connection) {
      if (!this.connections.has(relay.connection)) return;
      relay.connection.socket.write(encodeLine({ id: relay.id, ...(error ? { error } : { result: message.result }) } satisfies BridgeResponse));
    } else if (error) relay.reject?.(new Error(`${error.code}: ${error.message}`));
    else relay.resolve?.(message.result);
  }

  private event(event: BridgeEvent) {
    const owner = this.owners.get(event.tab_id);
    if (event.event === "detach" || event.event === "tab_removed") {
      this.owners.delete(event.tab_id); owner?.tabs.delete(event.tab_id);
    }
    if (owner && this.connections.has(owner)) owner.socket.write(encodeLine(event));
  }

  private accept(socket: Socket) {
    const connection: Connection = { socket, authenticated: false, tabs: new Set() };
    this.connections.add(connection);
    const reader = new LineReader(message => this.fromDaemon(connection, message as BridgeRequest), () => socket.destroy());
    socket.on("data", chunk => reader.push(chunk));
    socket.on("error", () => undefined);
    socket.on("close", () => {
      this.connections.delete(connection);
      // Control ends with the run: detach every tab this connection held, even if the daemon crashed.
      for (const tabId of connection.tabs) {
        this.owners.delete(tabId);
        void this.ask("debugger.detach", { tab_id: tabId }).catch(() => undefined);
      }
    });
  }

  private reply(connection: Connection, id: number, result?: unknown, error?: { code: string; message: string }) {
    connection.socket.write(encodeLine({ id, ...(error ? { error } : { result }) } satisfies BridgeResponse));
  }

  private fromDaemon(connection: Connection, request: BridgeRequest) {
    const params = request.params ?? {};
    if (!connection.authenticated) {
      if (request.method === "hello" && params.token === this.token) {
        connection.authenticated = true;
        this.reply(connection, request.id, { protocol: BROWSER_BRIDGE_PROTOCOL, extension_version: this.extensionVersion, pid: process.pid });
      } else { this.reply(connection, request.id, undefined, { code: "BROWSER_HOST_UNAUTHORIZED", message: "hello with the host token first" }); connection.socket.end(); }
      return;
    }
    const tabId = Number(params.tab_id);
    if (request.method === "os.file_dialog") {
      // Desktop work for the run that controls a tab; never relayed to the extension.
      if (!connection.tabs.size) { this.reply(connection, request.id, undefined, { code: "BROWSER_TAB_NOT_CONTROLLED", message: "control a tab first" }); return; }
      const fileRequest: FileDialogRequest = { action: params.action === "cancel" ? "cancel" : "choose",
        ...(typeof params.path === "string" ? { path: params.path } : {}), ...(params.overwrite === true ? { overwrite: true } : {}) };
      void this.fileDialog(fileRequest).then(result => this.reply(connection, request.id, result),
        error => this.reply(connection, request.id, undefined, { code: "BROWSER_FILE_DIALOG_FAILED", message: String(error) }));
      return;
    }
    if (request.method === "status") { this.reply(connection, request.id, { extension_version: this.extensionVersion, controlled_tabs: [...connection.tabs] }); return; }
    if (["debugger.send", "debugger.detach", "dialog.get"].includes(request.method) && this.owners.get(tabId) !== connection) {
      this.reply(connection, request.id, undefined, { code: "BROWSER_TAB_NOT_CONTROLLED", message: `tab ${tabId} is not controlled by this run` }); return;
    }
    if (request.method === "debugger.attach") {
      const owner = this.owners.get(tabId);
      if (owner && owner !== connection) { this.reply(connection, request.id, undefined, { code: "BROWSER_TAB_IN_USE", message: `tab ${tabId} is controlled by another DreamGraph run` }); return; }
      if (owner === connection) { this.reply(connection, request.id, {}); return; }
      // Claim before relaying so events that arrive with the attach reach this connection.
      this.owners.set(tabId, connection); connection.tabs.add(tabId);
      this.toExtension(request.method, params, { connection: null, resolve: result => this.reply(connection, request.id, result),
        reject: error => { this.owners.delete(tabId); connection.tabs.delete(tabId); this.reply(connection, request.id, undefined, codeOf(error)); } });
      return;
    }
    if (request.method === "debugger.detach") { this.owners.delete(tabId); connection.tabs.delete(tabId); }
    if (!["tabs.list", "tabs.open", "tabs.close", "tabs.activate", "debugger.detach", "debugger.send", "dialog.get"].includes(request.method)) {
      this.reply(connection, request.id, undefined, { code: "BROWSER_METHOD_UNKNOWN", message: request.method }); return;
    }
    this.toExtension(request.method, params, { connection, id: request.id });
  }
}

function codeOf(error: Error): { code: string; message: string } {
  const [code, ...rest] = error.message.split(": ");
  return /^[A-Z_]+$/.test(code) ? { code, message: rest.join(": ") } : { code: "BROWSER_EXTENSION_ERROR", message: error.message };
}

/** Removes info files of hosts that are no longer running. */
export async function pruneBrowserHostInfo(home = homedir()): Promise<void> {
  const directory = browserHostsDirectory(home);
  for (const name of await readdir(directory).catch(() => [] as string[])) {
    const pid = Number(name.replace(/\.json$/, ""));
    if (!Number.isInteger(pid)) continue;
    try { process.kill(pid, 0); } catch { await rm(join(directory, name), { force: true }); }
  }
}

/** Entry point when Chrome starts the host. */
export async function runBrowserHostMain(): Promise<void> {
  const home = homedir(), logFile = join(bridgeRunDirectory(home), "browser-host.log");
  await mkdir(bridgeRunDirectory(home), { recursive: true });
  const log = (line: string) => { void appendFile(logFile, `[${new Date().toISOString()}] ${process.pid} ${line}\n`).catch(() => undefined); };
  await pruneBrowserHostInfo(home);
  const host = new BrowserHost({ home, log });
  process.on("uncaughtException", error => log(`uncaught: ${error.stack ?? error.message}`));
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => void host.stop(signal).then(() => process.exit(0)));
  process.stdin.on("end", () => void host.stop("stdin closed").then(() => process.exit(0)));
  await host.start();
  log(`started for ${process.argv[2] ?? "unknown origin"}`);
}
