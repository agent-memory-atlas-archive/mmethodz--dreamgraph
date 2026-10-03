/**
 * M5 — Webhook delivery worker tests.
 *
 * Uses a mocked global fetch to drive the retry path without touching
 * the network. Backoff is small (BASE=1s, max attempts 5) so we accept
 * a small real wall-clock cost for the failure-path test rather than
 * fighting timer mocking with Promise microtasks.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setDataDirOverride } from "../../src/utils/paths.js";
import { registerSubscription, listSubscriptions, listDeadLetter } from "../../src/webhooks/store.js";
import { deliver } from "../../src/webhooks/worker.js";
import type { GraphEvent } from "../../src/graph/events.js";
import { EngineJobs } from "../../src/cognitive/jobs.js";

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "dg-webhook-worker-"));
  setDataDirOverride(dataDir);
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await rm(dataDir, { recursive: true, force: true });
});

function makeEvent(kind: GraphEvent["kind"] = "snapshot.changed"): GraphEvent {
  return {
    seq: 1,
    kind,
    affected_ids: [],
    etag: null,
    ts: new Date().toISOString(),
    payload: {},
  };
}

describe("deliver()", () => {
  it("succeeds on first 2xx response and updates stats", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200 } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const sub = await registerSubscription({
      url: "https://example.test/hook",
      secret: "topsecrettopsecret",
      events: ["*"],
    });

    await deliver(sub, makeEvent());
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const updated = (await listSubscriptions())[0];
    expect(updated.stats.delivered).toBe(1);
    expect(updated.stats.last_status).toBe(200);

    const dlq = await listDeadLetter();
    expect(dlq).toHaveLength(0);
  });

  it("sends required signature headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 204 } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const sub = await registerSubscription({
      url: "https://example.test/hook",
      secret: "topsecrettopsecret",
      events: ["*"],
    });
    await deliver(sub, makeEvent());

    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Record<string, string>;
    expect(headers["X-DreamGraph-Signature"]).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(headers["X-DreamGraph-Event"]).toBe("snapshot.changed");
    expect(headers["X-DreamGraph-Event-Id"]).toBe("1");
    // Backwards-compatible alias retained until receivers migrate.
    expect(headers["X-DreamGraph-Event-Seq"]).toBe("1");
    expect(headers["X-DreamGraph-Instance"]).toBeDefined();
    expect(headers["X-DreamGraph-Timestamp"]).toMatch(/^\d+$/);
    expect(headers["X-DreamGraph-Delivery"]).toBeDefined();
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("flat body shape per spec \u00a77.1 (no wrapper, no subscription_id)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 204 } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const sub = await registerSubscription({
      url: "https://example.test/hook",
      secret: "topsecrettopsecret",
      events: ["*"],
    });
    await deliver(sub, makeEvent());
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body).toHaveProperty("id", 1);
    expect(body).toHaveProperty("kind", "snapshot.changed");
    expect(body).toHaveProperty("ts");
    expect(body).toHaveProperty("instance_uuid");
    expect(body).toHaveProperty("affected_ids");
    expect(body).toHaveProperty("payload");
    expect(body).not.toHaveProperty("subscription_id");
    expect(body).not.toHaveProperty("delivery_id");
  });

  it("persists send intent before fetch and exact envelope replay returns one delivery",async()=>{
    const jobs=new EngineJobs();let observedId="";
    const fetchMock=vi.fn().mockImplementation(async(_url:string,init:RequestInit)=>{
      const record=(await jobs.inspect()).records[0];observedId=record.job.id;
      expect(record.external_effects[0]).toMatchObject({state:"dispatched",kind:"http_webhook"});
      expect(record.parameters.body).toBe(init.body);expect(record.parameters).not.toHaveProperty("secret");
      return {status:204} as Response;
    });vi.stubGlobal("fetch",fetchMock);
    const sub=await registerSubscription({url:"https://example.test/hook",secret:"topsecrettopsecret",events:["*"]});const event=makeEvent();
    const result=await deliver(sub,event);expect(await deliver(sub,event)).toEqual(result);
    expect(result.delivery_id).toBe(observedId);expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await jobs.inspect()).records[0]).toMatchObject({work_settled:true,job:{state:"succeeded"},external_effects:[{state:"acknowledged"}]});
  });

  it("uncertain transport is preserved without automatically resending or erasing delivery intent",async()=>{
    const fetchMock=vi.fn().mockRejectedValue(new Error("socket lost after send"));vi.stubGlobal("fetch",fetchMock);
    const sub=await registerSubscription({url:"https://example.test/hook",secret:"topsecrettopsecret",events:["*"]});const event=makeEvent();
    await expect(deliver(sub,event)).rejects.toThrow("WEBHOOK_DELIVERY_UNCONFIRMED");
    const record=(await new EngineJobs().inspect()).records[0];expect(record.job.state).toBe("recovery_required");
    expect(record.job.unknown_effects).toEqual([`${record.job.id}:attempt:1`]);
    await expect(deliver(sub,event)).rejects.toThrow("JOB_NOT_DISPATCHABLE");expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await listSubscriptions())[0].stats.delivered).toBe(0);
  });
}, 30_000);
