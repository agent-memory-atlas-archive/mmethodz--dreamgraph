/** Cookies are shared across TCP ports; identities and forwarding remain instance-bound. */
import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";

export const LEGACY_SESSION_COOKIE = "dg_session";
export const sessionCookieName = (instanceId: string) => `${LEGACY_SESSION_COOKIE}_${createHash("sha256").update(instanceId).digest("hex").slice(0, 32)}`;
export function readSessionCookie(req: IncomingMessage, name: string): string | undefined {
  return req.headers.cookie?.split(";").map(value => value.trim()).find(value => value.startsWith(`${name}=`))?.slice(name.length + 1);
}
// The bearer belongs to this authenticated request, including the first request
// that creates or upgrades a cookie. Never select an arbitrary cookie to forward.
const authenticated = new WeakMap<IncomingMessage, string>();
export function bindAuthenticatedSessionBearer(req: IncomingMessage, token: string): void { authenticated.set(req, token); }
export function authenticatedSessionBearer(req: IncomingMessage): string | undefined { return authenticated.get(req); }
