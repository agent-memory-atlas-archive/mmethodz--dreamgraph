import { AsyncLocalStorage } from "node:async_hooks";
import { resolve } from "node:path";
import { realpath } from "node:fs/promises";

import { getDataDir } from "./paths.js";

type BarrierMode = "read" | "write";
interface Waiter { mode: BarrierMode; resolve: () => void }

class ReadWriteBarrier {
  private readers = 0;
  private writer = false;
  private readonly queue: Waiter[] = [];

  async acquire(mode: BarrierMode): Promise<() => void> {
    if (mode === "read" && !this.writer && !this.queue.some((waiter) => waiter.mode === "write")) {
      this.readers++;
      return () => this.releaseRead();
    }
    if (mode === "write" && !this.writer && this.readers === 0 && this.queue.length === 0) {
      this.writer = true;
      return () => this.releaseWrite();
    }
    await new Promise<void>((resolveWaiter) => this.queue.push({ mode, resolve: resolveWaiter }));
    return mode === "read" ? () => this.releaseRead() : () => this.releaseWrite();
  }

  private releaseRead(): void {
    this.readers--;
    if (this.readers === 0) this.drain();
  }

  private releaseWrite(): void {
    this.writer = false;
    this.drain();
  }

  private drain(): void {
    if (this.writer || this.readers > 0 || this.queue.length === 0) return;
    const first = this.queue[0];
    if (first.mode === "write") {
      this.queue.shift();
      this.writer = true;
      first.resolve();
      return;
    }
    while (this.queue[0]?.mode === "read") {
      this.readers++;
      this.queue.shift()!.resolve();
    }
  }
}

const barriers = new Map<string, ReadWriteBarrier>();
const ownership = new AsyncLocalStorage<{ key: string; mode: BarrierMode; active: boolean }>();

async function barrierKey(dataDir = getDataDir()): Promise<string> {
  let absolute = resolve(dataDir);
  try { absolute = await realpath(absolute); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

function barrierFor(key: string): ReadWriteBarrier {
  let barrier = barriers.get(key);
  if (!barrier) {
    barrier = new ReadWriteBarrier();
    barriers.set(key, barrier);
  }
  return barrier;
}

async function withBarrier<T>(mode: BarrierMode, fn: () => Promise<T>): Promise<T> {
  const key = await barrierKey();
  const held = ownership.getStore();
  if (held?.active && held.key === key && (held.mode === "write" || held.mode === mode)) return fn();
  if (held?.active && held.key === key && held.mode === "read" && mode === "write") {
    throw new Error("GRAPH_READ_UPGRADE_FORBIDDEN: release the snapshot and revalidate before mutating");
  }
  const release = await barrierFor(key).acquire(mode);
  const owner = { key, mode, active: true };
  try {
    return await ownership.run(owner, async () => {
      if (mode === "write") return fn();
      const { readPublicationStamp } = await import("../graph/publication.js");
      const before = await readPublicationStamp();
      const result = await fn();
      if (before !== await readPublicationStamp()) throw new Error("GRAPH_REVISION_CONFLICT: read publication changed; retry the whole snapshot");
      return result;
    });
  } finally {
    owner.active = false;
    release();
  }
}

/** Hold a stable committed graph view across every canonical store read in fn. */
export function withGraphRead<T>(fn: () => Promise<T>): Promise<T> {
  return withBarrier("read", fn);
}

/** Serialize one ordinary graph mutation against reconciliation and stable readers. */
export function withGraphMutation<T>(fn: () => Promise<T>): Promise<T> {
  return withBarrier("write", fn);
}

/** Exclusive instance-level boundary for a journaled multi-store reconciliation. */
export function withGraphReconciliation<T>(fn: () => Promise<T>): Promise<T> {
  return withBarrier("write", fn);
}
