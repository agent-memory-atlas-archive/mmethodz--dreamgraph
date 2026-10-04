import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonHttpAuthority } from "../src/server/http-authority.js";
import { withSessionContext } from "../src/server/session-context.js";
import { withDataDirectory } from "../src/utils/paths.js";
import { releaseGraphWriter } from "../src/graph/writer-lease.js";
import { architectMcpHeaders } from "../src/cli/utils/mcp-session.js";

interface Fixture { data: string; server: Server; base: string }
let root: string;
let daemons: Fixture[] = [];

async function startDaemon(name: string, env: Record<string, string> = {}): Promise<Fixture> {
  const data = join(root, name, "data");
  await mkdir(data, { recursive: true });
  const authority = withDataDirectory(data, () => new DaemonHttpAuthority(0, { DREAMGRAPH_INSTANCE_UUID: `cookie-fixture-${name}`, ...env }));
  const server = createServer(async (req, res) => {
    try {
      const context = await authority.authorize(req, res);
      if (!context) return;
      await withSessionContext(context, async () => {
        if (await authority.handle(req, res, context)) return;
        if (req.url === "/architect/forwarded") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ forwarded: architectMcpHeaders(req)["X-DreamGraph-Session"], session_id: context.session_id }));
          return;
        }
        if (req.url === "/architect/") { res.writeHead(200, { "Content-Type": "text/html" }); res.end("<!doctype html><title>Architect</title>"); return; }
        res.writeHead(404); res.end();
      });
    } catch (error) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(error instanceof Error ? error.message : "fixture error");
    }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const fixture = { data, server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
  daemons.push(fixture);
  return fixture;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "dg-instance-cookies-"));
  daemons = [];
});
afterEach(async () => {
  for (const daemon of daemons) await new Promise<void>(resolve => daemon.server.close(() => resolve()));
  for (const daemon of daemons) await releaseGraphWriter(daemon.data);
  await rm(root, { recursive: true, force: true });
});

/** Browser cookies are keyed by host/path/name, not by TCP port. */
class HostCookieJar {
  readonly values = new Map<string, string>();
  header(): string { return [...this.values].map(([name, value]) => `${name}=${value}`).join("; "); }
  keep(response: Response): string | null {
    const set = response.headers.get("set-cookie");
    if (!set) return null;
    const pair = set.split(";", 1)[0], separator = pair.indexOf("=");
    if (separator < 1) throw new Error("INVALID_SET_COOKIE");
    const name = pair.slice(0, separator);
    this.values.set(name, pair.slice(separator + 1));
    return name;
  }
}

async function status(daemon: Fixture, cookie?: string, headers: Record<string, string> = {}) {
  const response = await fetch(daemon.base + "/api/authority/v1/status", { headers: {
    Accept: "text/html", ...(cookie ? { Cookie: cookie } : {}), ...headers,
  } });
  return { response, state: await response.json() as { session_id?: string; error?: string } };
}
async function forwarded(daemon: Fixture, cookie: string) {
  const response = await fetch(daemon.base + "/architect/forwarded", { headers: { Accept: "text/html", Cookie: cookie } });
  return { response, body: await response.json() as { forwarded?: string; session_id?: string; error?: string } };
}

describe("browser session cookies across local DreamGraph instances", () => {
  it("retains separate sessions for two ports on the same hostname with a shared browser cookie jar", async () => {
    const [first, second] = await Promise.all([startDaemon("first"), startDaemon("second")]);
    const jar = new HostCookieJar();
    const a = await status(first, jar.header()); expect(a.response.status).toBe(200);
    const firstCookie = jar.keep(a.response); expect(firstCookie).toBeTruthy();
    const b = await status(second, jar.header()); expect(b.response.status).toBe(200);
    const secondCookie = jar.keep(b.response); expect(secondCookie).toBeTruthy();
    expect(secondCookie).not.toBe(firstCookie);
    expect(b.state.session_id).not.toBe(a.state.session_id);

    const resumedA = await status(first, jar.header());
    const resumedB = await status(second, jar.header());
    expect(resumedA.response.status).toBe(200);
    expect(resumedB.response.status).toBe(200);
    expect(resumedA.state.session_id).toBe(a.state.session_id);
    expect(resumedB.state.session_id).toBe(b.state.session_id);
    const reversed = [...jar.values].reverse().map(([name, value]) => `${name}=${value}`).join("; ");
    const forwardedA = await forwarded(first, reversed), forwardedB = await forwarded(second, reversed);
    expect(forwardedA.response.status).toBe(200);
    expect(forwardedB.response.status).toBe(200);
    expect(forwardedA.body.session_id).toBe(a.state.session_id);
    expect(forwardedB.body.session_id).toBe(b.state.session_id);
    expect(forwardedA.body.forwarded).toBe(a.response.headers.get("X-DreamGraph-Session"));
    expect(forwardedB.body.forwarded).toBe(b.response.headers.get("X-DreamGraph-Session"));
  }, 15_000);

  it("ignores another instance's stale legacy cookie on fresh navigation, but never an explicit bad bearer", async () => {
    const [first, second] = await Promise.all([startDaemon("first"), startDaemon("second")]);
    const openedA = await status(first);
    expect(openedA.response.status).toBe(200);
    const foreignBearer = openedA.response.headers.get("X-DreamGraph-Session");
    expect(foreignBearer).toBeTruthy();
    const foreignLegacyCookie = `dg_session=${foreignBearer}`;
    const apiWithForeignCookie = await fetch(second.base + "/api/authority/v1/status", {
      headers: { Accept: "application/json", Cookie: foreignLegacyCookie },
    });
    expect(apiWithForeignCookie.status).toBe(401);
    const apiWithHtmlAccept = await fetch(second.base + "/api/authority/v1/status", {
      headers: { Accept: "text/html", Cookie: foreignLegacyCookie },
    });
    expect(apiWithHtmlAccept.status).toBe(401);
    const postedWithForeignCookie = await fetch(second.base + "/api/authority/v1/status", {
      method: "POST", headers: { Cookie: foreignLegacyCookie },
    });
    expect(postedWithForeignCookie.status).toBe(401);

    const navigation = await fetch(second.base + "/architect/forwarded", { headers: { Accept: "text/html", Cookie: foreignLegacyCookie } });
    expect(navigation.status).toBe(200);
    const navigationBody = await navigation.json() as { forwarded?: string };
    expect(navigationBody.forwarded).toBe(navigation.headers.get("X-DreamGraph-Session"));
    expect(navigationBody.forwarded).not.toBe(foreignBearer);
    const secondCookie = new HostCookieJar();
    expect(secondCookie.keep(navigation)).toBeTruthy();
    const openedB = await status(second, `${foreignLegacyCookie}; ${secondCookie.header()}`);
    expect(openedB.response.status).toBe(200);
    expect(openedB.state.session_id).not.toBe(openedA.state.session_id);

    const badHeader = await status(second, secondCookie.header(), { "X-DreamGraph-Session": "forged.token" });
    expect(badHeader.response.status).toBe(401);
    expect(badHeader.state.error).toBe("SESSION_BEARER_REJECTED");
    const scopedName = [...secondCookie.values.keys()][0];
    const badScoped = await status(second, `${scopedName}=forged.token; ${foreignLegacyCookie}`);
    expect(badScoped.response.status).toBe(401);
    expect(badScoped.state.error).toBe("SESSION_BEARER_REJECTED");
  }, 15_000);

  it("replaces an expired or invalid scoped cookie on page navigation instead of locking the UI, but never for API calls", async () => {
    const daemon = await startDaemon("expired");
    const first = await fetch(daemon.base + "/architect/forwarded", { headers: { Accept: "text/html" } });
    expect(first.status).toBe(200);
    const jar = new HostCookieJar();
    expect(jar.keep(first)).toBeTruthy();
    const scopedName = [...jar.values.keys()][0];
    // A cookie the session store no longer accepts (expired after 12 h, or garbage).
    const stale = `${scopedName}=00000000-0000-4000-8000-000000000000.expired`;
    const page = await fetch(daemon.base + "/architect/forwarded", { headers: { Accept: "text/html", Cookie: stale } });
    expect(page.status).toBe(200);
    const body = await page.json() as { forwarded?: string };
    expect(body.forwarded).toBe(page.headers.get("X-DreamGraph-Session"));
    expect(page.headers.get("set-cookie")).toContain(`${scopedName}=`);
    const api = await status(daemon, stale);
    expect(api.response.status).toBe(401);
    expect(api.state.error).toBe("SESSION_BEARER_REJECTED");
  }, 15_000);

  it("accepts a valid same-instance legacy cookie and issues its scoped replacement without losing the session", async () => {
    const daemon = await startDaemon("first");
    const original = await status(daemon);
    expect(original.response.status).toBe(200);
    const bearer = original.response.headers.get("X-DreamGraph-Session");
    expect(bearer).toBeTruthy();

    const migrated = await status(daemon, `dg_session=${bearer}`);
    expect(migrated.response.status).toBe(200);
    expect(migrated.state.session_id).toBe(original.state.session_id);
    const bridge = await forwarded(daemon, `dg_session=${bearer}`);
    expect(bridge.response.status).toBe(200);
    expect(bridge.body.forwarded).toBe(bearer);
    const jar = new HostCookieJar();
    const scopedName = jar.keep(migrated.response);
    expect(scopedName).toBeTruthy();
    expect(scopedName).not.toBe("dg_session");
    const resumed = await status(daemon, jar.header());
    expect(resumed.response.status).toBe(200);
    expect(resumed.state.session_id).toBe(original.state.session_id);
  }, 15_000);

  it("does not turn a foreign legacy cookie into a remote operator session without authentication", async () => {
    const local = await startDaemon("local");
    const remote = await startDaemon("remote", {
      DREAMGRAPH_REMOTE_ENABLED: "true",
      DREAMGRAPH_REMOTE_TOKEN: "fixture-remote-token-" + "x".repeat(32),
      DREAMGRAPH_HTTP_ALLOWED_HOSTS: '["127.0.0.1"]',
    });
    const localResponse = await status(local);
    const foreign = localResponse.response.headers.get("X-DreamGraph-Session");
    expect(foreign).toBeTruthy();
    const navigation = await fetch(remote.base + "/architect/", {
      headers: { Accept: "text/html", Cookie: `dg_session=${foreign}` },
    });
    expect(navigation.status).toBe(401);
    expect(navigation.headers.get("set-cookie")).toBeNull();
  }, 15_000);
});
