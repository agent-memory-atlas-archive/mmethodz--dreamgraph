/** Authenticated transport identity flows through async work, never process.env. */
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { getDataDir, withDataDirectory } from "../utils/paths.js";

export interface SessionContext {
  principal: string; session_id: string; directory: string; channel: "browser" | "mcp" | "stdio";
  environment: Record<string, string>; continuation_key: string;
  saveEnvironment?: (updates: Record<string, string>) => Promise<void>;
  sampling_server?: unknown;
  execution_policy?: import("./execution-policy.js").ExecutionPolicy;
}
const context = new AsyncLocalStorage<SessionContext>();
export const getSessionContext = (): SessionContext | undefined => context.getStore();
export const withoutSessionContext = <T>(work: () => T): T => context.run(undefined as unknown as SessionContext, work);
export function withSessionContext<T>(identity: SessionContext, work: () => T): T {
  return withDataDirectory(identity.directory, () => context.run(identity, work));
}
export function sessionNamespace(): string {
  const current = getSessionContext();
  return createHash("sha256").update(JSON.stringify([getDataDir(), current?.principal ?? "internal", current?.session_id ?? "internal"])).digest("hex");
}
export const sessionEnvironment = (): Record<string, string | undefined> => ({ ...process.env, ...getSessionContext()?.environment });
export async function saveSessionEnvironment(updates: Record<string, string>): Promise<boolean> {
  const current = getSessionContext(); if (!current) return false;
  if (!current.saveEnvironment) throw new Error("SESSION_PREFERENCE_PERSISTENCE_UNAVAILABLE");
  await current.saveEnvironment(updates); Object.assign(current.environment, updates); return true;
}
/** Private state stays bound even after later calls enter another client's scope. */
export function sessionStates<T>(factory: () => T) {
  const states = new Map<string, T>();
  return { current: (): T => {
    const key = sessionNamespace(); let state = states.get(key);
    if (!state) { if (states.size >= 1024) throw new Error("SESSION_STATE_CAPACITY"); state = factory(); states.set(key, state); }
    return state;
  }, values: () => [...states.values()] };
}
export function sealSessionContinuation(token: string): string {
  const current = getSessionContext(); if (!current) return token;
  const encoded = Buffer.from(token).toString("base64url");
  const signature = createHmac("sha256", current.continuation_key).update(`${sessionNamespace()}:${encoded}`).digest("base64url");
  return `dg2.${encoded}.${signature}`;
}
export function openSessionContinuation(token: string): string {
  const current = getSessionContext(); if (!current) return token;
  const parts = token.split("."); if (parts.length !== 3 || parts[0] !== "dg2" || token.length > 128 * 1024) throw new Error("CONTINUATION_SESSION_MISMATCH");
  const expected = createHmac("sha256", current.continuation_key).update(`${sessionNamespace()}:${parts[1]}`).digest();
  const actual = Buffer.from(parts[2], "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("CONTINUATION_SESSION_MISMATCH");
  return Buffer.from(parts[1], "base64url").toString("utf8");
}
