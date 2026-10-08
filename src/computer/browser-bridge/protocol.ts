/**
 * Wire protocol of the DreamGraph browser bridge.
 *
 *   Chrome extension ⇄ (native messaging, 4-byte length + JSON) ⇄ browser host ⇄ (local socket, JSON lines) ⇄ daemon
 *
 * One host per Chrome profile, started by Chrome itself. It serves every DreamGraph instance on the machine over a
 * per-user local socket (Windows named pipe / POSIX socket in ~/.dreamgraph/run) and requires the token from its
 * info file, which only the user can read. A tab is controlled by one daemon connection at a time; when that
 * connection closes, the host detaches its tabs, so control always ends with the run, even if the daemon crashed.
 */
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

export const BROWSER_HOST_NAME = "io.dreamgraph.browser";
export const BROWSER_BRIDGE_PROTOCOL = "dreamgraph.browser-bridge.v1";
/** Chrome caps host → extension messages at 1 MiB; commands are tiny, results flow the other way (64 MiB cap). */
export const NATIVE_MESSAGE_MAX_BYTES = 64 * 1024 * 1024;

export interface BridgeRequest { id: number; method: string; params?: Record<string, unknown> }
export interface BridgeResponse { id: number; result?: unknown; error?: { code: string; message: string } }
export interface BridgeEvent { event: "cdp" | "detach" | "tab_removed"; tab_id: number; method?: string; params?: Record<string, unknown>; reason?: string }

/** Host methods the daemon may call (the host relays most of them to the extension). */
export type BridgeMethod = "hello" | "tabs.list" | "tabs.open" | "tabs.close" | "tabs.activate" | "debugger.attach" | "debugger.detach"
  | "debugger.send" | "dialog.get" | "os.file_dialog" | "os.save_confirmation" | "status";

export function bridgeRunDirectory(home = homedir()): string { return join(home, ".dreamgraph", "run"); }
/** Info file the host writes when it starts: { protocol, pid, endpoint, token, extension_version, started_at }. */
export function browserHostInfoPath(home = homedir()): string { return join(bridgeRunDirectory(home), "browser-host.json"); }

export function browserHostEndpoint(home = homedir(), platform = process.platform): string {
  if (platform === "win32") {
    const user = createHash("sha256").update(`${userInfo().username}|${home}`).digest("hex").slice(0, 16);
    return `\\\\.\\pipe\\dreamgraph-browser-${user}`;
  }
  return join(bridgeRunDirectory(home), "browser-host.sock");
}

export interface BrowserHostInfo { protocol: string; pid: number; endpoint: string; token: string; extension_version: string | null; started_at: string }

/** Native messaging framing: 32-bit length in native byte order (little-endian on supported platforms) + UTF-8 JSON. */
export function encodeNativeMessage(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4); header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

export class NativeMessageReader {
  private buffer: Buffer = Buffer.alloc(0);
  constructor(private readonly onMessage: (message: unknown) => void, private readonly onError: (error: Error) => void = () => undefined) {}
  push(chunk: Buffer) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0);
      if (length > NATIVE_MESSAGE_MAX_BYTES) { this.onError(new Error("NATIVE_MESSAGE_TOO_LARGE")); this.buffer = Buffer.alloc(0); return; }
      if (this.buffer.length < 4 + length) return;
      const body = this.buffer.subarray(4, 4 + length); this.buffer = this.buffer.subarray(4 + length);
      try { this.onMessage(JSON.parse(body.toString("utf8"))); } catch (error) { this.onError(error as Error); }
    }
  }
}

/** JSON-lines framing for the local socket. */
export class LineReader {
  private pending = "";
  constructor(private readonly onMessage: (message: unknown) => void, private readonly onError: (error: Error) => void = () => undefined) {}
  push(chunk: Buffer | string) {
    this.pending += chunk.toString();
    let index: number;
    while ((index = this.pending.indexOf("\n")) >= 0) {
      const line = this.pending.slice(0, index); this.pending = this.pending.slice(index + 1);
      if (!line.trim()) continue;
      try { this.onMessage(JSON.parse(line)); } catch (error) { this.onError(error as Error); }
    }
    if (this.pending.length > NATIVE_MESSAGE_MAX_BYTES) { this.pending = ""; this.onError(new Error("BRIDGE_LINE_TOO_LARGE")); }
  }
}
export const encodeLine = (message: unknown) => `${JSON.stringify(message)}\n`;

/** Chrome extension id from the public key in manifest.json "key" (base64 DER SubjectPublicKeyInfo). */
export function extensionIdFromKey(base64Key: string): string {
  const digest = createHash("sha256").update(Buffer.from(base64Key, "base64")).digest("hex").slice(0, 32);
  return [...digest].map(char => String.fromCharCode("a".charCodeAt(0) + parseInt(char, 16))).join("");
}
