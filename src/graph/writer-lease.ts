/**
 * Kernel-owned, process-lifetime lease for one local physical data directory.
 * Private native IPC on Windows/Linux; loopback lease on macOS/older Node.
 * There is no API: incoming connections are immediately closed.
 * Kernel ownership disappears on crash, so restart needs no racy PID-file steal.
 * An unavailable endpoint fails closed with a diagnostic. Shared network storage
 * across machines is not an advertised writer configuration.
 */
import { createServer, type Server } from "node:net";
import { realpath, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { getDataDir } from "../utils/paths.js";

const leases = new Map<string, Promise<Server>>();
export function writerLeasePort(directory: string): number {
  const normalized = process.platform === "win32" ? directory.toLowerCase() : directory;
  return 32000 + createHash("sha256").update(normalized).digest().readUInt32BE(0) % 29000;
}
export function writerLeaseEndpoint(directory: string): { path: string; exclusive: true } | { host: string; port: number; exclusive: true } {
  const digest = createHash("sha256").update(directory).digest("hex");
  if (process.platform === "win32") return { path: `\\\\.\\pipe\\dreamgraph-writer-${digest}`, exclusive: true };
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (process.platform === "linux" && (major > 20 || (major === 20 && minor >= 8))) {
    // Abstract namespace is kernel-owned and disappears on process exit.
    return { path: `\0dreamgraph-writer-${digest}`, exclusive: true };
  }
  // Do not use a filesystem socket with a racy stale-path unlink on restart.
  return { host: "127.0.0.1", port: writerLeasePort(directory), exclusive: true };
}
export async function assertGraphWriter(directory = getDataDir()): Promise<void> {
  await mkdir(directory, { recursive: true });
  const physical = await realpath(directory);
  const key = process.platform === "win32" ? physical.toLowerCase() : physical;
  let held = leases.get(key);
  if (!held) {
    held = new Promise<Server>((resolve, reject) => {
      const server = createServer(socket => socket.destroy());
      server.once("error", error => reject(new Error(`INSTANCE_WRITER_UNAVAILABLE: ${key}: ${error.message}`)));
      server.listen(writerLeaseEndpoint(key), () => {
        server.unref();
        resolve(server);
      });
    });
    leases.set(key, held);
    held.catch(() => { if (leases.get(key) === held) leases.delete(key); });
  }
  await held;
}
/** Only a quiescent daemon/test may release; ordinary requests never do. */
export async function releaseGraphWriter(directory = getDataDir()): Promise<void> {
  const physical = await realpath(directory);
  const key = process.platform === "win32" ? physical.toLowerCase() : physical;
  const lease = leases.get(key);
  if (!lease) return;
  const server = await lease;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  leases.delete(key);
}
