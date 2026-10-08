import { open } from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";

/** Optional for existing adapters; Claude supplies both values from its private host invocation. */
export async function assertCliAdmissionGate(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const path = env.DREAMGRAPH_BRIDGE_ADMISSION_PATH, token = env.DREAMGRAPH_BRIDGE_ADMISSION_TOKEN;
  if (path === undefined && token === undefined) return;
  if (!path || !token || !/^[a-f0-9]{64}$/.test(token)) throw new Error("CLI_ADMISSION_GATE_INVALID");
  let handle;
  try {
    handle = await open(path, "r");
    const buffer = Buffer.alloc(65);
    const { bytesRead } = await handle.read(buffer, 0, 65, 0);
    if (bytesRead !== 64 || !timingSafeEqual(buffer.subarray(0, 64), Buffer.from(token))) throw new Error("closed");
  } catch { throw new Error("CLI_ADMISSION_NOT_READY"); }
  finally { await handle?.close(); }
}
