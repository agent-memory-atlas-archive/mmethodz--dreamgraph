import { withGraphRead, withGraphReconciliation } from "../utils/graph-reconciliation-barrier.js";
import { commitGraphWrites,loadPublicationState,publicationContentHash,recoverGraphPublication } from "../graph/publication.js";
import { withEngineJob } from "./jobs.js";
import { stripBom } from "../utils/read-json.js";
import { EventSettingsSchema, mergeEngineSettings } from "../config/engine-settings.js";
/**
 * DreamGraph v5.1 — Event-Driven Dreaming
 *
 * Dream cycles are currently triggered on-demand.  The most valuable time
 * to think is *when something changes*.  This module creates a reactive
 * event layer that classifies events, resolves affected entities, and
 * delegates to the appropriate cognitive action.
 *
 * Two intake mechanisms:
 * 1. Internal triggers (always active): after dream_cycle, runtime metrics, imports
 * 2. dispatch_cognitive_event MCP tool (manual / external triggers)
 *
 * HTTP sidecar is intentionally deferred (opt-in, future).
 *
 * Safety guarantees:
 * - Cooldown timer + max cycles per hour (prevent runaway)
 * - Events are advisory — all actions follow existing state-machine rules
 * - Full audit trail in data/event_log.json
 */

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { engine } from "./engine.js";
import { logger } from "../utils/logger.js";
import { dataPath } from "../utils/paths.js";
import { DEFAULT_EVENT_ROUTER_CONFIG } from "./types.js";
import type {
  EventSource,
  EventSeverity,
  CognitiveEvent,
  EntityScope,
  EventLogEntry,
  EventLogFile,
  EventRouterConfig,
  ValidatedEdge,
} from "./types.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const eventLogPath = () => dataPath("event_log.json");

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let config: EventRouterConfig = { ...DEFAULT_EVENT_ROUTER_CONFIG };

// ---------------------------------------------------------------------------
// Event Log I/O
// ---------------------------------------------------------------------------

function emptyEventLog(): EventLogFile {
  return {
    metadata: {
      description: "Event-Driven Dreaming — cognitive event audit trail.",
      schema_version: "1.0.0",
      total_events: 0,
      last_event: null,
    },
    events: [],
  };
}

async function loadEventLog(): Promise<EventLogFile> {
 return withGraphRead(async()=>{
  const publication=await loadPublicationState();
  try{const body=await readFile(eventLogPath(),"utf8");if(publication.stores["event_log.json"]&&publication.stores["event_log.json"].hash!==publicationContentHash(body))throw new Error("UNPUBLISHED_EVENT_CHANGE");
   const log=JSON.parse(stripBom(body));if(!log||typeof log!=="object"||!log.metadata||!Array.isArray(log.events)||log.events.some((entry:EventLogEntry)=>!entry?.event?.id))throw new Error("EVENT_LOG_INVALID");return log;
  }catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT"&&!publication.stores["event_log.json"])return emptyEventLog();throw new Error(`EVENT_LOG_UNAVAILABLE: ${String(error)}`);}
 });
}

async function saveEventLog(log: EventLogFile): Promise<void> {
  log.metadata.total_events = log.events.length;
  log.metadata.last_event =
    log.events.length > 0
      ? log.events[log.events.length - 1].timestamp
      : null;
  const body=JSON.stringify(log);if(log.events.length>20000||Buffer.byteLength(body)>16*1024*1024)throw new Error("EVENT_CAPACITY_REQUIRES_ARCHIVE");
  await commitGraphWrites({actor:"event_router",scope:["event_log.json"],cause:"event_intake",writes:[{file:"event_log.json",content:body}]});
}

// ---------------------------------------------------------------------------
// Entity Scoping
// ---------------------------------------------------------------------------

/**
 * Resolve the scope of affected entities from an event.
 * Primary = directly mentioned; Secondary = 1-hop via validated edges.
 */
async function resolveEntityScope(
  primaryIds: string[]
): Promise<EntityScope> {
  const primary = [...new Set(primaryIds)];

  // Load validated edges for 1-hop expansion
  const validatedFile = await engine.loadValidatedEdges();
  const edges: ValidatedEdge[] = validatedFile.edges;

  const secondary = new Set<string>();
  for (const id of primary) {
    for (const edge of edges) {
      if (edge.from === id && !primary.includes(edge.to)) {
        secondary.add(edge.to);
      }
      if (edge.to === id && !primary.includes(edge.from)) {
        secondary.add(edge.from);
      }
    }
  }

  const secondaryArr = [...secondary].slice(0,100);
  return {
    primary,
    secondary: secondaryArr,
    all: [...primary, ...secondaryArr],
  };
}

// ---------------------------------------------------------------------------
// Event Classification
// ---------------------------------------------------------------------------

interface EventClassification {
  response_type: string;
  strategy: string;
  entity_scope: EntityScope;
}

/**
 * Classify an event and determine the appropriate cognitive response.
 */
async function classifyEvent(
  event: CognitiveEvent
): Promise<EventClassification> {
  const scope = await resolveEntityScope(event.affected_entities);

  switch (event.source) {
    case "git_webhook":
      return {
        response_type: "scoped_dream_cycle",
        strategy: "tension_directed",
        entity_scope: scope,
      };

    case "ci_cd": {
      const isFailure =
        event.severity === "critical" || event.severity === "high";
      return {
        response_type: isFailure
          ? "scoped_nightmare_cycle"
          : "scoped_dream_cycle",
        strategy: isFailure ? "all" : "gap_detection",
        entity_scope: scope,
      };
    }

    case "runtime_anomaly":
      return {
        response_type: "scoped_dream_cycle",
        strategy: "causal_replay",
        entity_scope: scope,
      };

    case "tension_threshold":
      return {
        response_type: "remediation_plan",
        strategy: "tension_directed",
        entity_scope: scope,
      };

    case "federation_import":
      return {
        response_type: "scoped_dream_cycle",
        strategy: "cross_domain",
        entity_scope: scope,
      };

    case "manual":
    default:
      return {
        response_type: (event.payload?.["response_type"] as string) ?? "scoped_dream_cycle",
        strategy: (event.payload?.["strategy"] as string) ?? "gap_detection",
        entity_scope: scope,
      };
  }
}

// ---------------------------------------------------------------------------
// Rate Limiting
// ---------------------------------------------------------------------------

/**
 * Check whether an auto-triggered cycle is allowed under cooldown rules.
 */
async function canAutoTrigger():Promise<boolean>{
 const now=Date.now(),automatic=(await loadEventLog()).events.filter(e=>e.event.source==="tension_threshold"&&e.event.id.startsWith("auto_tension_"));
 const recent=automatic.filter(e=>Date.parse(e.timestamp)>now-3600000),last=automatic.reduce((at,e)=>Math.max(at,Date.parse(e.timestamp)),0);
 return (!last||now-last>=config.cooldown_ms)&&recent.length<config.max_auto_cycles_per_hour;
}

// ---------------------------------------------------------------------------
// Action Execution
// ---------------------------------------------------------------------------

/**
 * Execute the cognitive action determined by classification.
 * Returns a human-readable outcome summary.
 *
 * Note: This module does NOT import dream_cycle / nightmare_cycle directly
 * (those are registered as MCP tools). Instead, it returns a structured
 * recommendation. The register.ts tool handler orchestrates execution.
 */
function describeAction(classification: EventClassification): string {
  const scope = classification.entity_scope;
  const entities = scope.primary.length > 0
    ? scope.primary.slice(0, 5).join(", ")
    : "scope unavailable; no whole-graph execution authorized";

  switch (classification.response_type) {
    case "scoped_dream_cycle":
      return `Recommending dream_cycle (strategy: ${classification.strategy}) scoped to [${entities}]`;
    case "scoped_nightmare_cycle":
      return `Recommending nightmare_cycle scoped to [${entities}] — critical event detected`;
    case "remediation_plan":
      return `Recommending get_remediation_plan for tensions involving [${entities}]`;
    default:
      return `Recommending ${classification.response_type} (strategy: ${classification.strategy})`;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Dispatch a cognitive event — classify, scope, log, and return recommendation.
 */
export async function dispatchEvent(event:CognitiveEvent):Promise<EventLogEntry>{
 if(!event.id||!Array.isArray(event.affected_entities)||event.affected_entities.length>100||Buffer.byteLength(JSON.stringify(event))>65536)throw new Error("EVENT_INPUT_BOUND_EXCEEDED");
 const snapshot=structuredClone(event);
 return withEngineJob({operation_id:`event:${event.id}`,owner:"event_router",action:"event_intake",scope:event.affected_entities,lanes:["event_intake"],parameters:snapshot as unknown as Record<string,unknown>,roles:["normalizer"]},()=>executeDispatchEvent(snapshot));
}
async function executeDispatchEvent(event:CognitiveEvent):Promise<EventLogEntry>{
  logger.info(
    `Event dispatch: source=${event.source}, severity=${event.severity}, ` +
    `entities=${event.affected_entities.length}`
  );

  const startMs = Date.now();
  const classification = await classifyEvent(event);
  const actionDescription = describeAction(classification);
  const durationMs = Date.now() - startMs;

  const entry: EventLogEntry = {
    event,
    classification: {
      response_type: classification.response_type,
      entity_scope: classification.entity_scope,
      strategy: classification.strategy,
    },
    result: {
      action_taken: `Advisory: ${actionDescription}`,
      execution_status: "advisory",
      duration_ms: durationMs,
      outcome_summary: actionDescription,
    },
    timestamp: new Date().toISOString(),
  };

  return withGraphReconciliation(async()=>{
   await recoverGraphPublication();const log=await loadEventLog();const prior=log.events.find(old=>old.event.id===event.id);
   if(prior){if(JSON.stringify(prior.event)!==JSON.stringify(event))throw new Error("EVENT_IDENTITY_CONFLICT");return prior;}
   log.events.push(entry);await saveEventLog(log);return entry;
  });
}

/**
 * Check for internal tension threshold triggers.
 * Called after each dream_cycle completion.
 */
export async function checkTensionThresholds(): Promise<EventLogEntry | null> {
 return withGraphReconciliation(async()=>{
  await recoverGraphPublication();if (!await canAutoTrigger()) return null;

  const tensionFile = await engine.loadTensions();
  const criticalTensions = tensionFile.signals.filter(
    (t) => !t.resolved && t.urgency > config.tension_threshold
  );

  if (criticalTensions.length === 0) return null;

  // Auto-trigger for the most urgent tension
  const mostUrgent = criticalTensions.sort(
    (a, b) => b.urgency - a.urgency
  )[0];

  const eventId=`auto_tension_${createHash("sha256").update(JSON.stringify({id:mostUrgent.id,urgency:mostUrgent.urgency,entities:mostUrgent.entities})).digest("hex")}`;
  const prior=(await loadEventLog()).events.find(entry=>entry.event.id===eventId);
  if(prior)return prior;

  const event: CognitiveEvent = {
    id: eventId,
    source: "tension_threshold",
    severity: mostUrgent.urgency > 0.9 ? "critical" : "high",
    timestamp: new Date().toISOString(),
    payload: {
      tension_id: mostUrgent.id,
      urgency: mostUrgent.urgency,
      domain: mostUrgent.domain,
    },
    affected_entities: mostUrgent.entities,
    description: `Auto-triggered: tension "${mostUrgent.id}" exceeded urgency threshold (${mostUrgent.urgency.toFixed(2)} > ${config.tension_threshold})`,
  };

  logger.info(
    `Internal trigger: tension "${mostUrgent.id}" urgency ${mostUrgent.urgency.toFixed(2)} > ${config.tension_threshold}`
  );

  return dispatchEvent(event);
 });
}

/**
 * Update the event router configuration at runtime.
 */
export function updateConfig(newConfig: Partial<EventRouterConfig>): void {
  config = mergeEngineSettings(EventSettingsSchema, config, newConfig);
  logger.info(`Event router config updated: ${JSON.stringify(config)}`);
}

/**
 * Get current router config (for diagnostics).
 */
export function getConfig(): EventRouterConfig {
  return { ...config };
}

/**
 * Load the full event log for resource serving.
 */
export async function getEventLog(): Promise<EventLogFile> {
  return loadEventLog();
}
