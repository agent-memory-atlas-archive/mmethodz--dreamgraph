/**
 * M5 — Webhook delivery worker.
 *
 * Subscribes to `graphEventBus`, fans matching events out to registered
 * subscriptions, signs each request with HMAC-SHA256, retries with
 * exponential backoff, and writes terminal failures to the dead-letter
 * store.
 *
 * Lifecycle:
 *   - `startWebhookWorker()` is called once from `createServer()`.
 *   - `stopWebhookWorker()` is called from the daemon's graceful exit
 *     handler. In-flight deliveries are awaited up to a small grace
 *     window before the process exits.
 *
 * Delivery semantics:
 *   - A subscription with `events: ["*"]` receives every event kind
 *     except the webhook telemetry events themselves (no feedback loops).
 *   - Each delivery has its own retry chain: up to MAX_ATTEMPTS,
 *     backoff = BASE_BACKOFF_MS * 2^(attempt - 1), capped at MAX_BACKOFF_MS.
 *   - Non-2xx, network errors, and timeouts all retry. After exhausting
 *     attempts, the entry is appended to `webhook_dead_letter.json` and
 *     a `webhook.dead_letter` event is emitted on the bus.
 *   - Disabled subscriptions are skipped entirely.
 */

import { createHash } from "node:crypto";
import { EngineJobs } from "../cognitive/jobs.js";
import { assertJobCurrent, currentJob, withoutJobContext } from "../cognitive/job-context.js";
import { getDataDir, withDataDirectory } from "../utils/paths.js";
import { setTimeout as delay } from "node:timers/promises";
import { graphEventBus, type GraphEvent, type GraphEventKind } from "../graph/events.js";
import {
  appendDeadLetter,
  listSubscriptions,
  getSubscription,
  recordDeliveryOutcome,
  type WebhookSubscription,
} from "./store.js";
import { signBody } from "./sign.js";
import { logger } from "../utils/logger.js";
import { getActiveScope } from "../instance/lifecycle.js";

const MAX_ATTEMPTS = 5;
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Spec backoff schedule (§7.2): 5s, 30s, 2m, 10m, 1h.
 * Tests and local smoke runs may set `WEBHOOK_FAST_BACKOFF=1` to compress
 * the schedule to milliseconds without rebuilding.
 */
const SPEC_BACKOFF_MS: readonly number[] = [
  5_000,
  30_000,
  2 * 60_000,
  10 * 60_000,
  60 * 60_000,
];
const FAST_BACKOFF_MS: readonly number[] = [10, 20, 40, 80, 160];
function backoffSchedule(): readonly number[] {
  return process.env.WEBHOOK_FAST_BACKOFF === "1" ? FAST_BACKOFF_MS : SPEC_BACKOFF_MS;
}

/**
 * Telemetry event kinds emitted by the worker itself. We never deliver
 * these via webhook even when a subscription wildcards on "*", because
 * doing so would create a self-amplifying feedback loop on every failure.
 */
const TELEMETRY_KINDS: ReadonlySet<GraphEventKind> = new Set([
  "webhook.delivered",
  "webhook.failed",
  "webhook.dead_letter",
]);

interface PendingDelivery {
  promise: Promise<unknown>;
}

let unsubscribe: (() => void) | null = null;
let inflight = new Set<PendingDelivery>();
let stopping = false;
let shutdown = new AbortController();

export function startWebhookWorker(): void {
  if (unsubscribe !== null) return;
  stopping = false;
  shutdown = new AbortController();
  unsubscribe = graphEventBus.subscribe((event) => {
    if (stopping) return;
    if (TELEMETRY_KINDS.has(event.kind)) return;
    if (isWebhookStoreEvent(event)) return;
    dispatchEvent(event).catch((err) => {
      logger.error(
        `Webhook dispatchEvent threw for ${event.kind}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });
  });
  logger.info("Webhook worker started");
  const directory=getDataDir();
  void withDataDirectory(directory,()=>resumeQueuedDeliveries()).catch(error=>logger.error(`Webhook queue recovery: ${String(error)}`));
}

/** Resume only undispatched accepted intents; running/uncertain remote effects stay fenced. */
async function resumeQueuedDeliveries():Promise<void>{
 const jobs=new EngineJobs(),queued=(await jobs.inspect()).records.filter(record=>record.job.owner==="webhook"&&record.action==="webhook_delivery"
  &&["queued","blocked"].includes(record.job.state));
 for(const record of queued){
  if(stopping)return;
  const sub=await getSubscription(String(record.parameters.subscription_id));
  if(!sub?.enabled||sub.url!==record.parameters.url){await jobs.cancel(record.job.id,"webhook_subscription_unavailable");continue;}
  const body=String(record.parameters.body),wire=JSON.parse(body),event:GraphEvent={seq:wire.id,kind:wire.kind,ts:wire.ts,affected_ids:wire.affected_ids,etag:null,payload:wire.payload};
  try{await jobs.run(record.job.id,context=>executeDelivery(sub,event,body,context.id,String(record.parameters.instance_uuid),Number(record.parameters.start_attempt),context.signal),shutdown.signal);}
  catch(error){logger.warn(`Webhook accepted delivery ${record.job.id}: ${String(error)}`);}
 }
}

export async function stopWebhookWorker(graceMs = 5_000): Promise<void> {
  stopping = true;
  shutdown.abort(new Error("WEBHOOK_WORKER_STOPPED"));
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  if (inflight.size === 0) return;
  const all = Promise.all(Array.from(inflight, (d) => d.promise));
  await Promise.race([
    all,
    delay(graceMs).then(() =>
      logger.warn(`Webhook worker stop: ${inflight.size} deliveries unfinished after ${graceMs}ms`),
    ),
  ]);
}

async function dispatchEvent(event: GraphEvent): Promise<void> {
  let subs: WebhookSubscription[];
  try {
    subs = await listSubscriptions();
  } catch (err) {
    logger.warn(`Webhook dispatch: cannot read subscriptions (${(err as Error).message})`);
    return;
  }
  for (const sub of subs) {
    if (!sub.enabled) continue;
    if (!matches(sub.events, event.kind)) continue;
    const tracker: PendingDelivery = { promise: Promise.resolve() };
    tracker.promise = deliver(sub, event)
      .catch((err) => {
        // Never let a delivery failure escape into the unhandled-rejection
        // handler — that would crash the daemon.
        logger.error(
          `Webhook delivery threw for ${sub.id} (${event.kind}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      })
      .finally(() => {
        inflight.delete(tracker);
      });
    inflight.add(tracker);
  }
}

function matches(events: WebhookSubscription["events"], kind: GraphEventKind): boolean {
  return events.includes("*") || (events as string[]).includes(kind);
}

/**
 * Filter out cache.invalidated / snapshot.changed events that are
 * triggered by the webhook store's own writes (delivery stats,
 * dead-letter appends). Without this guard, a wildcard subscription
 * keeps redelivering on its own bookkeeping → infinite feedback loop.
 */
function isWebhookStoreEvent(event: GraphEvent): boolean {
  if (event.kind !== "cache.invalidated" && event.kind !== "snapshot.changed") {
    return false;
  }
  const payload = event.payload as Record<string, unknown> | undefined;
  if (!payload) return false;
  const candidates = [payload.path, payload.file, payload.name, payload.store, payload.key];
  for (const c of candidates) {
    if (typeof c === "string" && /webhook_(subscriptions|dead_letter)|jobs\.json|model_admission\.json/.test(c)) {
      return true;
    }
  }
  return false;
}

export interface DeliveryResult {
  delivered: boolean;
  attempts: number;
  status: number | null;
  delivery_id: string;
  error?: string;
}

/**
 * Attempt delivery for one (subscription, event) pair, with retries.
 * Emits webhook.* telemetry events on the bus to surface health to
 * cognitive consumers and the Explorer.
 */
export async function deliver(sub:WebhookSubscription,event:GraphEvent,attemptOverride?:number,signal?:AbortSignal):Promise<DeliveryResult>{
 const directory=getDataDir(),instanceUuid=getActiveScope()?.uuid??"";
 const body=JSON.stringify({id:event.seq,kind:event.kind,ts:event.ts,instance_uuid:instanceUuid,affected_ids:event.affected_ids??[],payload:event.payload??{}});
 if(Buffer.byteLength(body)>65536)throw new Error("WEBHOOK_BODY_BYTE_LIMIT");
 if(attemptOverride!==undefined&&(!Number.isSafeInteger(attemptOverride)||attemptOverride<1||attemptOverride>MAX_ATTEMPTS))throw new Error("WEBHOOK_ATTEMPT_INVALID");
 const digest=createHash("sha256").update(body).digest("hex");
 // Async graph-event callbacks must not borrow their emitting job's authority.
 return withDataDirectory(directory,()=>withoutJobContext(async()=>{
  const jobs=new EngineJobs(directory),record=await jobs.accept({operation_id:`webhook:${sub.id}:${digest}`,owner:"webhook",action:"webhook_delivery",
   scope:[`webhook:${sub.id}`],lanes:[`webhook:${sub.id}`],parameters:{subscription_id:sub.id,url:sub.url,body,instance_uuid:instanceUuid,start_attempt:attemptOverride??1},
   role_policies:{},budget:{requests:5,input_tokens:0,output_tokens:0,reasoning_tokens:0,retries:4,elapsed_ms:18*60*1000,concurrency:1,max_hops:0,max_neighbors:0,
    run_amount:0,day_amount:0,currency:"USD",pricing_version:null,billing_principal:"webhook"}});
  return jobs.run(record.job.id,context=>executeDelivery(sub,event,body,context.id,instanceUuid,attemptOverride,context.signal),signal??shutdown.signal);
 }));
}
async function executeDelivery(sub:WebhookSubscription,event:GraphEvent,body:string,deliveryId:string,instanceUuid:string,attemptOverride:number|undefined,signal:AbortSignal):Promise<DeliveryResult>{
  const startAttempt = attemptOverride ?? 1;
  let lastError = "";
  let lastStatus: number | null = null;

  for (let attempt = startAttempt; attempt <= MAX_ATTEMPTS; attempt++) {
    signal.throwIfAborted();await assertJobCurrent();
    const jobs=new EngineJobs(),context=currentJob()!,effectId=`${deliveryId}:attempt:${attempt}`;
    await jobs.beginExternalEffect(deliveryId,context.fence,{id:effectId,kind:"http_webhook",target:sub.url,
      payload_hash:createHash("sha256").update(body).digest("hex")});
    const timestamp = String(Date.now());
    const sig = signBody(body, sub.secret, timestamp, deliveryId);
    let acknowledged=false;
    try {
      await assertJobCurrent();
      const response = await postWithTimeout(sub.url, body, {
        "Content-Type": "application/json",
        "X-DreamGraph-Timestamp": timestamp,
        "X-DreamGraph-Signature": sig.header,
        "X-DreamGraph-Event": event.kind,
        "X-DreamGraph-Event-Id": String(event.seq),
        // Backwards-compatible alias for receivers written against the
        // pre-spec header name. Will be removed in a future release.
        "X-DreamGraph-Event-Seq": String(event.seq),
        "X-DreamGraph-Instance": instanceUuid,
        "X-DreamGraph-Delivery": deliveryId,
        "User-Agent": "dreamgraph-webhook/1",
      },signal);
      await jobs.settleExternalEffect(deliveryId,effectId,true,`http_status:${response.status}`);
      acknowledged=true;
      await assertJobCurrent();
      lastStatus = response.status;
      if (response.status >= 200 && response.status < 300) {
        await recordDeliveryOutcome(sub.id, { kind: "delivered", status: response.status });
        graphEventBus.emit("webhook.delivered", {
          payload: {
            subscription_id: sub.id,
            delivery_id: deliveryId,
            event_kind: event.kind,
            event_seq: event.seq,
            status: response.status,
            attempts: attempt,
          },
        });
        return { delivered: true, attempts: attempt, status: response.status, delivery_id: deliveryId };
      }
      lastError = `non-2xx status ${response.status}`;
    } catch (err) {
      if(acknowledged)throw err;
      lastStatus = null;
      lastError = err instanceof Error ? err.message : String(err);
      await jobs.settleExternalEffect(deliveryId,effectId,false,lastError);
      // A transport error cannot establish whether the receiver accepted the request.
      // Preserve the same delivery intent for explicit recovery, never redispatch it.
      throw new Error(`WEBHOOK_DELIVERY_UNCONFIRMED: ${deliveryId}: ${lastError}`);
    }

    graphEventBus.emit("webhook.failed", {
      payload: {
        subscription_id: sub.id,
        delivery_id: deliveryId,
        event_kind: event.kind,
        event_seq: event.seq,
        attempt,
        max_attempts: MAX_ATTEMPTS,
        status: lastStatus,
        error: lastError,
      },
    });
    await recordDeliveryOutcome(sub.id, { kind: "failed", status: lastStatus, error: lastError });

    if (attempt >= MAX_ATTEMPTS) break;
    const schedule = backoffSchedule();
    const backoff = schedule[Math.min(attempt - 1, schedule.length - 1)];
    await delay(backoff,undefined,{signal});
  }

  await appendDeadLetter({
    delivery_id: deliveryId,
    subscription_id: sub.id,
    url: sub.url,
    event_kind: event.kind,
    event_seq: event.seq,
    attempts: MAX_ATTEMPTS,
    last_error: lastError,
    last_status: lastStatus,
    body,
    failed_at: new Date().toISOString(),
  });
  await recordDeliveryOutcome(sub.id, {
    kind: "dead_lettered",
    status: lastStatus,
    error: lastError,
  });
  graphEventBus.emit("webhook.dead_letter", {
    payload: {
      subscription_id: sub.id,
      delivery_id: deliveryId,
      event_kind: event.kind,
      event_seq: event.seq,
      attempts: MAX_ATTEMPTS,
      status: lastStatus,
      error: lastError,
    },
  });
  return { delivered: false, attempts: MAX_ATTEMPTS, status: lastStatus, delivery_id: deliveryId, error: lastError };
}

async function postWithTimeout(
  url: string,
  body: string,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<{ status: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.any([controller.signal,signal]),
    });
    await res.body?.cancel();
    return { status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

/** Test seam — drain in-flight deliveries without stopping the worker. */
export async function _flushForTest(): Promise<void> {
  await Promise.all(Array.from(inflight, (d) => d.promise));
}

/** Test seam — reset module state between tests. */
export function _resetForTest(): void {
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
  inflight = new Set();
  stopping = false;
  shutdown = new AbortController();
}
