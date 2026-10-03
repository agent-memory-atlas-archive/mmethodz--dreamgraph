/** Fail closed before route dispatch; local machine trust is explicit. */
import type { IncomingMessage } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const names = z.array(z.string().min(1).max(512)).max(32);
const loopback = (host: string): boolean => ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host.toLowerCase());
export const isLoopbackAddress = (address: string | undefined): boolean => !!address && (loopback(address) || address === "::ffff:127.0.0.1");
export interface HttpPolicy { bind: string; remote: boolean; token: string | null; principal: string;
  hosts: string[]; origins: string[]; port: number; }
export function resolveHttpPolicy(port: number, env: Record<string, string | undefined> = process.env): HttpPolicy {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("HTTP_PORT_INVALID");
  const bind = env.DREAMGRAPH_HTTP_BIND?.trim() || "127.0.0.1";
  const remote = env.DREAMGRAPH_REMOTE_ENABLED === "true", token = env.DREAMGRAPH_REMOTE_TOKEN?.trim() || null;
  if (env.DREAMGRAPH_REMOTE_ENABLED && !["true", "false"].includes(env.DREAMGRAPH_REMOTE_ENABLED)) throw new Error("HTTP_REMOTE_SETTING_INVALID");
  const hosts = names.parse(JSON.parse(env.DREAMGRAPH_HTTP_ALLOWED_HOSTS || "[]"));
  const origins = names.parse(JSON.parse(env.DREAMGRAPH_HTTP_ALLOWED_ORIGINS || "[]"));
  if (!loopback(bind) && !remote) throw new Error("HTTP_REMOTE_REQUIRES_EXPLICIT_ENABLEMENT");
  if (remote && (!token || token.length < 32)) throw new Error("HTTP_REMOTE_REQUIRES_AUTHENTICATION");
  if (remote && !hosts.length) throw new Error("HTTP_REMOTE_REQUIRES_ALLOWED_HOSTS");
  if (hosts.some(host => host.includes("*") || host.includes("/") || host.includes("@"))) throw new Error("HTTP_ALLOWED_HOST_INVALID");
  for (const origin of origins) {
    const value = new URL(origin); if (!['http:', 'https:'].includes(value.protocol) || value.origin !== origin || value.username || value.password) throw new Error("HTTP_ALLOWED_ORIGIN_INVALID");
  }
  return { bind, remote, token, hosts: hosts.map(host => host.toLowerCase()), origins, port,
    principal: remote ? `operator:${createHash("sha256").update(token!).digest("hex")}` : "local-machine" };
}
export function tokenMatches(value: string | undefined, token: string | null): boolean {
  if (!value || !token || value.length > 16384) return false;
  const first = createHash("sha256").update(value).digest(), second = createHash("sha256").update(token).digest();
  return timingSafeEqual(first, second);
}
export function checkHttpRequest(req: IncomingMessage, policy: HttpPolicy, upgrade = false): { allowed: boolean; status: number; reason: string; origin: string | null } {
  const reject = (reason: string) => ({ allowed: false, status: 403, reason, origin: null });
  if (!policy.remote && !isLoopbackAddress(req.socket.remoteAddress)) return reject("HTTP_LOOPBACK_ONLY");
  const host = req.headers.host;
  if (!host || Array.isArray(host) || /[\s/@\\?#]/.test(host)) return reject("HTTP_HOST_INVALID");
  let parsed: URL; try { parsed = new URL(`http://${host}`); } catch { return reject("HTTP_HOST_INVALID"); }
  const expectedPort = req.socket.localPort || policy.port;
  if (Number(parsed.port || 80) !== expectedPort) return reject("HTTP_HOST_PORT_MISMATCH");
  if (policy.remote ? !policy.hosts.includes(parsed.hostname.toLowerCase()) : !loopback(parsed.hostname)) return reject("HTTP_HOST_REJECTED");
  const origin = req.headers.origin;
  if (Array.isArray(origin) || origin === "null") return reject("HTTP_ORIGIN_REJECTED");
  if (origin && origin !== `http://${host}` && !policy.origins.includes(origin)) return reject("HTTP_ORIGIN_REJECTED");
  if (req.headers["sec-fetch-site"] === "cross-site" || upgrade && !origin) return reject("HTTP_BROWSER_SCOPE_REJECTED");
  return { allowed: true, status: 200, reason: "allowed", origin: origin || null };
}
export function publicHttpPolicy(policy: HttpPolicy) {
  return { bind: policy.bind, remote_enabled: policy.remote, authenticated: policy.remote, allowed_hosts: policy.hosts,
    allowed_origins: policy.origins, local_trust: policy.remote ? "authenticated operator plus session bearer" : "local machine plus session bearer" };
}
