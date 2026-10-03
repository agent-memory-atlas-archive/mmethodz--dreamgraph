/**
 * M5 — Webhook subscription + dead-letter store.
 *
 * Persistent state for outbound HTTP webhook delivery:
 *
 *   data/webhook_subscriptions.json   { subscriptions: WebhookSubscription[] }
 *   data/webhook_dead_letter.json     { entries: DeadLetterEntry[] }
 *
 * Both files use the daemon publication writer and verified reads. Corrupt or
 * unpublished data is unavailable; accepted delivery evidence is never silently
 * discarded at capacity.
 *
 * See plans/DREAMGRAPH_SDK_ROADMAP.md §7 (Webhooks) for wire format.
 */

import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dataPath } from "../utils/paths.js";
import { atomicWriteFile } from "../utils/atomic-write.js";
import { z } from "zod";
import { withGraphRead, withGraphReconciliation } from "../utils/graph-reconciliation-barrier.js";
import { loadPublicationState, publicationContentHash, recoverGraphPublication } from "../graph/publication.js";
import { stripBom } from "../utils/read-json.js";
import type { GraphEventKind } from "../graph/events.js";

export const SUBSCRIPTIONS_FILE = "webhook_subscriptions.json";
export const DEAD_LETTER_FILE = "webhook_dead_letter.json";

export interface WebhookSubscription {
  /** Stable id (uuid v4). */
  id: string;
  /** Destination HTTPS (or HTTP for localhost) URL. */
  url: string;
  /** Shared HMAC-SHA256 secret used to sign delivery bodies. */
  secret: string;
  /**
   * Event kinds to deliver. `["*"]` means all kinds.
   * Empty array is illegal — fail registration up front.
   */
  events: (GraphEventKind | "*")[];
  /** Optional human label. */
  label?: string;
  /** ISO timestamp. */
  created_at: string;
  /** Operator can pause delivery without losing config. */
  enabled: boolean;
  /** Delivery health rollups (best-effort, updated by the worker). */
  stats: {
    delivered: number;
    failed: number;
    dead_lettered: number;
    last_delivery_at: string | null;
    last_status: number | null;
    last_error: string | null;
  };
}

export interface DeadLetterEntry {
  delivery_id: string;
  subscription_id: string;
  url: string;
  event_kind: GraphEventKind;
  event_seq: number;
  attempts: number;
  last_error: string;
  last_status: number | null;
  body: string;
  failed_at: string;
}

interface SubscriptionsFile {
  subscriptions: WebhookSubscription[];
}

interface DeadLetterFile {
  entries: DeadLetterEntry[];
}

const StatsSchema=z.object({delivered:z.number().int().nonnegative(),failed:z.number().int().nonnegative(),dead_lettered:z.number().int().nonnegative(),
 last_delivery_at:z.string().nullable(),last_status:z.number().int().nullable(),last_error:z.string().nullable()}).strict();
const SubscriptionSchema=z.object({id:z.string().min(1),url:z.string().url(),secret:z.string().min(16),events:z.array(z.string().min(1)).min(1).max(100),
 label:z.string().optional(),created_at:z.string(),enabled:z.boolean(),stats:StatsSchema}).strict();
const DeadLetterSchema=z.object({delivery_id:z.string().min(1),subscription_id:z.string().min(1),url:z.string().url(),event_kind:z.string().min(1),event_seq:z.number().int().nonnegative(),
 attempts:z.number().int().nonnegative(),last_error:z.string(),last_status:z.number().int().nullable(),body:z.string(),failed_at:z.string()}).strict();
async function checkedLoad<T>(name:string,schema:z.ZodTypeAny,empty:T):Promise<T>{
 return withGraphRead(async()=>{const publication=await loadPublicationState();try{const body=await readFile(dataPath(name),"utf8");
  if(publication.stores[name]&&publication.stores[name].hash!==publicationContentHash(body))throw new Error("UNPUBLISHED_WEBHOOK_CHANGE");
  if(Buffer.byteLength(body)>16*1024*1024)throw new Error("WEBHOOK_STORE_BYTE_LIMIT");return schema.parse(JSON.parse(stripBom(body))) as T;
 }catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT"&&!publication.stores[name])return empty;throw new Error(`WEBHOOK_STORE_UNAVAILABLE: ${String(error)}`);}});
}
async function withStoreWrite<T>(_name:string,work:()=>Promise<T>):Promise<T>{
 return withGraphReconciliation(async()=>{await recoverGraphPublication();return work();});
}
async function loadSubscriptionsFile():Promise<SubscriptionsFile>{return checkedLoad(SUBSCRIPTIONS_FILE,z.object({subscriptions:z.array(SubscriptionSchema).max(1024)}).strict(),{subscriptions:[]});}
async function saveSubscriptionsFile(file:SubscriptionsFile):Promise<void>{
 const body=JSON.stringify(file);if(Buffer.byteLength(body)>16*1024*1024||file.subscriptions.length>1024)throw new Error("WEBHOOK_CAPACITY_REQUIRES_ARCHIVE");
 await atomicWriteFile(dataPath(SUBSCRIPTIONS_FILE),body);
}
async function loadDeadLetterFile():Promise<DeadLetterFile>{return checkedLoad(DEAD_LETTER_FILE,z.object({entries:z.array(DeadLetterSchema).max(10000)}).strict(),{entries:[]});}
async function saveDeadLetterFile(file:DeadLetterFile):Promise<void>{
 const body=JSON.stringify(file);if(Buffer.byteLength(body)>16*1024*1024||file.entries.length>10000)throw new Error("WEBHOOK_CAPACITY_REQUIRES_ARCHIVE");
 await atomicWriteFile(dataPath(DEAD_LETTER_FILE),body);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function listSubscriptions(): Promise<WebhookSubscription[]> {
  const file = await loadSubscriptionsFile();
  return file.subscriptions;
}

export async function getSubscription(id: string): Promise<WebhookSubscription | null> {
  const file = await loadSubscriptionsFile();
  return file.subscriptions.find((s) => s.id === id) ?? null;
}

export interface RegisterSubscriptionInput {
  url: string;
  secret: string;
  events: (GraphEventKind | "*")[];
  label?: string;
  enabled?: boolean;
}

export async function registerSubscription(
  input: RegisterSubscriptionInput,
): Promise<WebhookSubscription> {
  const url = input.url.trim();
  if (!url) throw new Error("webhook url is required");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`webhook url is not a valid URL: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`webhook url protocol must be http(s), got ${parsed.protocol}`);
  }
  if (!input.secret || input.secret.length < 16) {
    throw new Error("webhook secret must be at least 16 characters");
  }
  if (!Array.isArray(input.events) || input.events.length === 0) {
    throw new Error("webhook must subscribe to at least one event kind (or '*')");
  }

  const subscription: WebhookSubscription = {
    id: randomUUID(),
    url,
    secret: input.secret,
    events: input.events,
    label: input.label,
    created_at: new Date().toISOString(),
    enabled: input.enabled ?? true,
    stats: {
      delivered: 0,
      failed: 0,
      dead_lettered: 0,
      last_delivery_at: null,
      last_status: null,
      last_error: null,
    },
  };

  await withStoreWrite(SUBSCRIPTIONS_FILE, async () => {
    const file = await loadSubscriptionsFile();
    file.subscriptions.push(subscription);
    await saveSubscriptionsFile(file);
  });

  return subscription;
}

export async function removeSubscription(id: string): Promise<boolean> {
  let removed = false;
  await withStoreWrite(SUBSCRIPTIONS_FILE, async () => {
    const file = await loadSubscriptionsFile();
    const before = file.subscriptions.length;
    file.subscriptions = file.subscriptions.filter((s) => s.id !== id);
    removed = file.subscriptions.length < before;
    if (removed) await saveSubscriptionsFile(file);
  });
  return removed;
}

export async function setEnabled(id: string, enabled: boolean): Promise<boolean> {
  let updated = false;
  await withStoreWrite(SUBSCRIPTIONS_FILE, async () => {
    const file = await loadSubscriptionsFile();
    const sub = file.subscriptions.find((s) => s.id === id);
    if (!sub) return;
    sub.enabled = enabled;
    updated = true;
    await saveSubscriptionsFile(file);
  });
  return updated;
}

export interface RecordDeliveryOutcome {
  status: number | null;
  error: string | null;
}

/**
 * Update aggregate stats on a subscription after a delivery attempt.
 * Best-effort — if the subscription was removed mid-flight, silently no-op.
 */
export async function recordDeliveryOutcome(
  subscriptionId: string,
  outcome:
    | { kind: "delivered"; status: number }
    | { kind: "failed"; status: number | null; error: string }
    | { kind: "dead_lettered"; status: number | null; error: string },
): Promise<void> {
  await withStoreWrite(SUBSCRIPTIONS_FILE, async () => {
    const file = await loadSubscriptionsFile();
    const sub = file.subscriptions.find((s) => s.id === subscriptionId);
    if (!sub) return;
    sub.stats.last_delivery_at = new Date().toISOString();
    if (outcome.kind === "delivered") {
      sub.stats.delivered += 1;
      sub.stats.last_status = outcome.status;
      sub.stats.last_error = null;
    } else if (outcome.kind === "failed") {
      sub.stats.failed += 1;
      sub.stats.last_status = outcome.status;
      sub.stats.last_error = outcome.error;
    } else {
      sub.stats.dead_lettered += 1;
      sub.stats.last_status = outcome.status;
      sub.stats.last_error = outcome.error;
    }
    await saveSubscriptionsFile(file);
  });
}

export async function listDeadLetter(): Promise<DeadLetterEntry[]> {
  const file = await loadDeadLetterFile();
  return file.entries;
}

export async function getDeadLetter(deliveryId: string): Promise<DeadLetterEntry | null> {
  const file = await loadDeadLetterFile();
  return file.entries.find((e) => e.delivery_id === deliveryId) ?? null;
}

export async function appendDeadLetter(entry: DeadLetterEntry): Promise<void> {
  await withStoreWrite(DEAD_LETTER_FILE, async () => {
    const file = await loadDeadLetterFile();
    const prior=file.entries.find(old=>old.delivery_id===entry.delivery_id);
    if(prior){if(JSON.stringify(prior)!==JSON.stringify(entry))throw new Error("WEBHOOK_DELIVERY_IDENTITY_CONFLICT");return;}
    file.entries.push(entry);
    await saveDeadLetterFile(file);
  });
}

export async function removeDeadLetter(deliveryId: string): Promise<boolean> {
  let removed = false;
  await withStoreWrite(DEAD_LETTER_FILE, async () => {
    const file = await loadDeadLetterFile();
    const before = file.entries.length;
    file.entries = file.entries.filter((e) => e.delivery_id !== deliveryId);
    removed = file.entries.length < before;
    if (removed) await saveDeadLetterFile(file);
  });
  return removed;
}
