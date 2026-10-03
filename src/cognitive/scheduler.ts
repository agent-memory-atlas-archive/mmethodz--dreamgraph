import { createHash, randomUUID } from "node:crypto";
import { withGraphRead, withGraphReconciliation } from "../utils/graph-reconciliation-barrier.js";
import { commitGraphWrites, recoverGraphPublication, loadPublicationState, publicationContentHash } from "../graph/publication.js";
import { ScheduleOccurrenceSchema } from "../graph/contracts.js";
import { getDataDir, withDataDirectory } from "../utils/paths.js";
import { stripBom } from "../utils/read-json.js";
import { EngineJobs } from "./jobs.js";
import { currentJob, withoutJobContext, assertJobCurrent } from "./job-context.js";
import { SCHEDULE_ACTION_VERSION, SchedulePolicySchema, validateScheduleTiming, evaluateSchedule, previewSchedule, emptyScheduleDocument } from "./schedule-definition.js";
export { previewSchedule } from "./schedule-definition.js";
import { SchedulerSettingsSchema, mergeEngineSettings } from "../config/engine-settings.js";
/**
 * DreamGraph v5.2 — Dream Scheduler
 *
 * Policy-driven temporal orchestration for cognitive actions.
 *
 * Scheduling modes:
 * A. Time interval  — run dream_cycle every 6 hours, nightmare_cycle daily
 * B. Cycle-based    — every 10 cycles run metacognition, every 50 generate digest
 * C. Idle-time      — if no manual activity in 30 min, run background dreaming
 * D. Cron-like      — hour/day granularity for predictable schedules
 *
 * Design decisions:
 * - In-process scheduler with persistence (no external daemons)
 * - If DreamGraph restarts, schedules reload; missed jobs logged, not replayed
 * - Deterministic: tick → evaluate → execute → persist
 * - Safety: max runs/hour, global cooldown, error streaks pause schedules
 *
 * "Dream freely. Schedule wisely. Execute deterministically."
 */

import { readFile } from "node:fs/promises";
import { z } from "zod";
import { atomicWriteFile } from "../utils/atomic-write.js";
import { existsSync } from "node:fs";
import { engine } from "./engine.js";
import { dataPath } from "../utils/paths.js";
import { getActiveScope } from "../instance/lifecycle.js";
import { updateInstanceCounters } from "../instance/index.js";
import { dream } from "./dreamer.js";
import {
  normalize,
  recordWeakConnectionTensions,
  resolveTensionsFromPromotedEdges,
} from "./normalizer.js";
import { nightmare } from "./adversarial.js";
import { runMetacognitiveAnalysis } from "./metacognition.js";
import { dispatchEvent } from "./event-router.js";
import { exportArchetypes } from "./federation.js";
import { maybeAutoNarrate, generateDiffChapter } from "./narrator.js";
import { graphEventBus } from "../graph/events.js";
import { logger } from "../utils/logger.js";
import { getLlmReadinessStatus } from "./llm-readiness.js";
import { getRoleLlmProvider } from "./llm.js";
import type { LlmMessage } from "./llm.js";
import type { TensionResolutionCandidate, TensionResolutionStrategy, TensionSignal } from "./types.js";
import { withFileLock } from "../utils/mutex.js";
import { DEFAULT_SCHEDULER_CONFIG } from "./types.js";
import type {
  DreamSchedule,
  ScheduleExecution,
  ScheduleFile,
  SchedulerConfig,
  ScheduleAction,
  ScheduleTriggerType,
  ScheduleStatus,
  DreamHistoryEntry,
  DreamStrategy,
  AdversarialStrategy,
} from "./types.js";

// ---------------------------------------------------------------------------
// Per-action parameter schemas (F-01)
//
// `DreamSchedule.parameters` is an open `Record<string, unknown>` because
// schedules are persisted to JSON. We validate the shape at the top of each
// `executeAction` case so the action body can use strongly-typed values.
// ---------------------------------------------------------------------------

const DREAM_STRATEGIES = [
  "gap_detection",
  "weak_reinforcement",
  "cross_domain",
  "missing_abstraction",
  "symmetry_completion",
  "tension_directed",
  "reflective",
  "causal_replay",
  "pgo_wave",
  "llm_dream",
  "orphan_bridging",
  "schema_grounding",
  "all",
] as const satisfies readonly DreamStrategy[];

const ADVERSARIAL_STRATEGIES = [
  "privilege_escalation",
  "data_leak_path",
  "injection_surface",
  "missing_validation",
  "broken_access_control",
  "all_threats",
] as const satisfies readonly AdversarialStrategy[];

const DreamCycleParamsSchema = z.object({
  strategy: z.enum(DREAM_STRATEGIES).default("all"),
  max_dreams: z.number().int().min(0).max(1000).default(100),
  focus_entities: z.array(z.string().min(1)).max(100).default([]),
  focus_hops: z.number().int().min(0).max(4).default(2),
  focus_reason: z.string().max(500).optional(),
  maintenance_fingerprint: z.string().min(1).max(256).optional(),
  maintenance_origin: z.literal("major_graph_change").optional(),
}).strict();

const NightmareCycleParamsSchema = z.object({
  strategy: z.enum(ADVERSARIAL_STRATEGIES).default("all_threats"),
}).strict();

const MetacognitiveParamsSchema = z.object({
  window_size: z.number().int().min(5).max(500).default(50),
  auto_apply: z.boolean().default(false),
}).strict();

const FederationExportParamsSchema = z.object({
  /** Optional destination override. Absolute or relative to the instance data dir. */
  export_path: z.string().trim().min(1).optional(),
}).strict();

const DispatchEventParamsSchema = z.object({
  source: z
    .enum([
      "git_webhook",
      "ci_cd",
      "runtime_anomaly",
      "tension_threshold",
      "federation_import",
      "manual",
    ])
    .default("manual"),
  severity: z.enum(["critical", "high", "medium", "low", "info"]).default("info"),
  description: z.string().optional(),
  affected_entities: z.array(z.string()).default([]),
  payload: z.record(z.string(), z.unknown()).default({}),
}).strict();

export const ScheduleActionParameterSchemas={dream_cycle:DreamCycleParamsSchema,nightmare_cycle:NightmareCycleParamsSchema,metacognitive_analysis:MetacognitiveParamsSchema,
 dispatch_cognitive_event:DispatchEventParamsSchema,federation_export:FederationExportParamsSchema,narrative_chapter:z.object({}).strict(),graph_maintenance:z.object({}).strict()} as const;
export function scheduleRoles(action:ScheduleAction):Array<"dreamer"|"normalizer">{
 return ["dream_cycle","nightmare_cycle","dispatch_cognitive_event"].includes(action)?["dreamer","normalizer"]:["normalizer"];
}
export function schedulePolicyDigest(schedule:DreamSchedule,fingerprints:string[]):string{
 const fields=["name","action","parameters","trigger_type","interval_ms","cron","cycle_interval","idle_ms","max_runs","timezone","fold_policy","missed_policy","overlap_policy"];
 return createHash("sha256").update(JSON.stringify({definition:Object.fromEntries(fields.filter(key=>(schedule as unknown as Record<string,unknown>)[key]!==undefined).map(key=>[key,(schedule as unknown as Record<string,unknown>)[key]])),policies:fingerprints})).digest("hex");
}
async function scheduledRolePolicies(schedule:DreamSchedule){
 const {getRoleModelPolicy}=await import("./llm.js");const pairs=await Promise.all(scheduleRoles(schedule.action).map(async role=>[role,await getRoleModelPolicy(role)] as const));
 return Object.fromEntries(pairs);
}

/** Invalid parameters block the occurrence; resilience never means broader defaults. */
function parseScheduleParams<S extends z.ZodTypeAny>(schedule: DreamSchedule, schema: S): z.infer<S> {
  return schema.parse(schedule.parameters ?? {});
}
// Scheduling state is persisted below; engine effects run only through EngineJobs.
let config: SchedulerConfig = { ...DEFAULT_SCHEDULER_CONFIG };
let tickTimer: ReturnType<typeof setInterval> | null = null;
let automaticTick: Promise<void> | null = null;
let schedulerGeneration = 0;

async function executeAction(schedule: DreamSchedule): Promise<string> {
  switch (schedule.action) {
    case "dream_cycle": {
      const params = parseScheduleParams(schedule, DreamCycleParamsSchema);
      const strategy = params.strategy;
      const maxDreams = params.max_dreams;

      if (maxDreams === 0) return "dream cycle skipped: zero allocation";
      if (engine.getState() !== "awake") throw new Error("ENGINE_CONFLICT");
      engine.enterRem();
      const decayResult = await engine.applyDecay();
      const tensionDecay = await engine.applyTensionDecay();
      const dreamResult = await dream(strategy, maxDreams, {
        entity_ids: params.focus_entities,
        hops: params.focus_hops,
        reason: params.focus_reason,
      });

      engine.enterNormalizing();
      const normResult = await normalize();

      // --- Tension creation from normalizer's tension candidates ---
      let tensionsCreated = 0;
      let tensionsResolved = 0;

      tensionsCreated = await recordWeakConnectionTensions(
        normResult.tensionCandidates,
        "scheduler"
      );

      // --- Resolve tensions when promoted edges address them ---
      tensionsResolved = await resolveTensionsFromPromotedEdges(
        normResult.promotedEdges,
        "scheduler"
      );

      engine.wake();

      // Record history
      const entry: DreamHistoryEntry = {
        session_id: `sched_${schedule.id}_${Date.now()}`,
        cycle_number: engine.getCurrentDreamCycle(),
        timestamp: new Date().toISOString(),
        strategy,
        duration_ms: 0,
        generated_edges: dreamResult.edges.length,
        generated_nodes: dreamResult.nodes.length,
        duplicates_merged: dreamResult.duplicates_merged,
        decayed_edges: decayResult.decayedEdges,
        decayed_nodes: decayResult.decayedNodes,
        normalization: {
          validated: normResult.validated,
          latent: normResult.latent,
          rejected: normResult.rejected,
          promoted: normResult.promotedEdges.length,
          promoted_entities: normResult.promotedNodes,
          blocked_by_gate: normResult.blockedByGate,
          // Entity-level detail so cycles don't run blind
          promoted_details: normResult.promotedEdges.map(e => ({
            id: e.id,
            from: e.from,
            to: e.to,
            relation: e.relation,
            confidence: e.confidence,
          })),
          tension_details: normResult.tensionCandidates.map(tc => ({
            from: tc.from,
            to: tc.to,
            reason: tc.reason,
            confidence: tc.confidence,
          })),
        },
        tension_signals_created: tensionsCreated,
        tension_signals_resolved: tensionsResolved,
        tensions_expired: tensionDecay.expired,
        tensions_decayed: tensionDecay.decayed,
        per_strategy_yields:
          strategy === "all" && dreamResult.strategy_yields
            ? { ...dreamResult.strategy_yields }
            : undefined,
      };
      await engine.appendHistoryEntry(entry);

      // Persist cycle counter to instance state
      try {
        await updateInstanceCounters({
          total_dream_cycles: engine.getCurrentDreamCycle(),
        });
      } catch { /* non-critical */ }

      // Post-cycle hooks
      try { await maybeAutoNarrate(); } catch { /* swallow */ }

      // Phase 4 #8 — tension resolution lifecycle. Best-effort: never block
      // the dream cycle's success summary on resolver failures.
      // v8.2.6 — when LLM is ready, build a proposer that asks the model for
      // a strategy + rationale; falls back to the heuristic on any error.
      let resolverSummary = "";
      try {
        const llmReady = getLlmReadinessStatus()?.state === "ready";
        const proposer = llmReady
          ? async (sig: TensionSignal) => {
              try {
                const { provider: llm, config: cfg } = await getRoleLlmProvider("normalizer");
                const messages: LlmMessage[] = [
                  {
                    role: "system",
                    content:
                      "You are the DreamGraph tension resolver. Pick the best strategy for closing a tension. " +
                      "Respond ONLY with strict JSON: {\"strategy\":\"merge|mediator|split|reframe|wont_fix\",\"rationale\":\"...\",\"validation_window\":1-5}.",
                  },
                  {
                    role: "user",
                    content:
                      `Tension type: ${sig.type}\n` +
                      `Description: ${sig.description}\n` +
                      `Entities: ${sig.entities.join(", ")}\n` +
                      `Urgency: ${sig.urgency.toFixed(2)}`,
                  },
                ];
                const resp = await llm.complete(messages, {
                  cognitiveRole: "normalizer",
                  ...(cfg.reasoningEffort ? { reasoningEffort: cfg.reasoningEffort } : {}),
                  model: cfg.model,
                  temperature: cfg.temperature,
                  maxTokens: 400,
                  jsonMode: true,
                });
                const parsed = JSON.parse(resp.text) as {
                  strategy?: string;
                  rationale?: string;
                  validation_window?: number;
                };
                const allowed: TensionResolutionStrategy[] = ["merge", "mediator", "split", "reframe", "wont_fix"];
                if (!parsed.strategy || !allowed.includes(parsed.strategy as TensionResolutionStrategy)) {
                  return null;
                }
                const candidate: Omit<TensionResolutionCandidate, "proposed_at"> = {
                  strategy: parsed.strategy as TensionResolutionStrategy,
                  rationale: typeof parsed.rationale === "string" && parsed.rationale.trim()
                    ? parsed.rationale.trim()
                    : "LLM proposal (no rationale provided)",
                  validation_window: Math.min(5, Math.max(1, Math.floor(parsed.validation_window ?? 3))),
                  source: "llm",
                };
                return candidate;
              } catch (err) {
                logger.warn(
                  `dream_cycle: LLM tension proposer failed for ${sig.id} — falling back. ` +
                  `Error: ${err instanceof Error ? err.message : err}`
                );
                return null;
              }
            }
          : undefined;
        const proposeResult = await engine.runTensionResolverCycle({ maxSamples: 5, proposer });
        const validateResult = await engine.validateResolutionCandidates();
        resolverSummary =
          `, resolver(proposed=${proposeResult.proposed}, ` +
          `auto_applied=${proposeResult.auto_applied}, ` +
          `confirmed=${validateResult.confirmed}, ` +
          `wont_fix=${validateResult.accepted_wont_fix}, ` +
          `escalated=${validateResult.escalated})`;
      } catch (err) {
        logger.warn(
          `dream_cycle: tension resolver pass failed — continuing. ` +
          `Error: ${err instanceof Error ? err.message : err}`
        );
      }

      if (engine.getState() !== "awake") throw new Error("ENGINE_CONFLICT");

      return `dream_cycle(${strategy}${dreamResult.focus_entities.length > 0 ? `, focus=${dreamResult.focus_entities.length}` : ""}): ${dreamResult.edges.length} edges, ${normResult.promotedEdges.length} promoted, ${normResult.rejected} rejected${resolverSummary}`;
    }

    case "nightmare_cycle": {
      const params = parseScheduleParams(schedule, NightmareCycleParamsSchema);
      const strategy = params.strategy;

      if (engine.getState() !== "awake") throw new Error("ENGINE_CONFLICT");
      engine.enterNightmare();
      const result = await nightmare(strategy);
      engine.wakeFromNightmare();

      if (engine.getState() !== "awake") throw new Error("ENGINE_CONFLICT");

      return `nightmare_cycle(${strategy}): ${result.threats_found} threats found`;
    }

    case "metacognitive_analysis": {
      const params = parseScheduleParams(schedule, MetacognitiveParamsSchema);
      const entry = await runMetacognitiveAnalysis(params.window_size, params.auto_apply);
      return `metacognition: ${entry.overall_health}, ${entry.threshold_recommendations.length} recommendations`;
    }

    case "dispatch_cognitive_event": {
      const params = parseScheduleParams(schedule, DispatchEventParamsSchema);
      const event = {
        id: `sched_evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        source: params.source,
        severity: params.severity,
        timestamp: new Date().toISOString(),
        payload: params.payload,
        affected_entities: params.affected_entities,
        description: params.description ?? `Scheduled event from ${schedule.name}`,
      };
      const logEntry = await dispatchEvent(event);
      return `event dispatched: ${logEntry.result.action_taken}`;
    }

    case "narrative_chapter": {
      const chapter = await generateDiffChapter();
      if (chapter) {
        return `narrative chapter ${chapter.chapter_number} generated: "${chapter.title}"`;
      }
      return "narrative chapter: no significant changes to narrate";
    }

    case "federation_export": {
      const params = parseScheduleParams(schedule, FederationExportParamsSchema);
      const result = await exportArchetypes(params.export_path);
      return `federation export: ${result.archetypes_exported} archetypes → ${result.file_path}`;
    }

    case "graph_maintenance": {
      // Decay pass + tension decay without new dreaming
      if (engine.getState() !== "awake") throw new Error("ENGINE_CONFLICT");
      engine.enterRem();
      const decayResult = await engine.applyDecay();
      const tensionDecay = await engine.applyTensionDecay();
      await engine.interrupt(); // skip normalization

      return `maintenance: ${decayResult.decayedEdges} edges decayed, ${decayResult.decayedNodes} nodes decayed, ${tensionDecay.expired} tensions expired`;
    }

    default:
      throw new Error(`Unknown schedule action: ${schedule.action}`);
  }
}


const FILE = "schedules.json";
const count = z.number().int().nonnegative(), utc = z.string().datetime({ offset: true });
const ScheduleSchema = z.object({ id: z.string().min(1), name: z.string(), action: z.enum(["dream_cycle","nightmare_cycle","metacognitive_analysis","dispatch_cognitive_event","narrative_chapter","federation_export","graph_maintenance"]),
 parameters: z.record(z.unknown()), trigger_type: z.enum(["interval","cron_like","after_cycles","on_idle"]), interval_ms: z.number().optional(), cron: z.string().optional(),
 cycle_interval: z.number().optional(), idle_ms: z.number().optional(), enabled: z.boolean(), status: z.enum(["active","paused","exhausted","error"]),
 last_run_at: utc.nullable(), next_run_at: utc.nullable(), run_count: count, max_runs: count.nullable(), last_cycle_checked: count, error_count: count,
 last_error: z.string().nullable(), last_skip_reason: z.string().nullable().optional(), created_at: utc, updated_at: utc,
 definition_revision: count.default(1), action_version: z.string().default(SCHEDULE_ACTION_VERSION),
 ...SchedulePolicySchema.shape, archived_at: utc.nullable().default(null) }).passthrough();
const ExecutionSchema = z.object({ id: z.string(), schedule_id: z.string(), schedule_name: z.string(), action: z.string(),
 triggered_at: utc, completed_at: utc, duration_ms: z.number().nonnegative(), success: z.boolean(), result_summary: z.string(), error: z.string().optional() }).passthrough();
const OccurrenceRecordSchema = z.object({ occurrence: ScheduleOccurrenceSchema, definition: ScheduleSchema,
 claimed_at: utc, reason: z.string().nullable(), completed_at: utc.nullable() }).strict();
const ScheduleFileSchema = z.object({ metadata: z.object({ description: z.string(), schema_version: z.string(), total_schedules: count,
 total_executions: count, last_tick: utc.nullable(), instance_uuid: z.string().optional(), revision: count.default(0),
 last_activity_at: utc.default(() => new Date().toISOString()) }).passthrough(), schedules: z.array(ScheduleSchema), executions: z.array(ExecutionSchema),
 occurrences: z.array(OccurrenceRecordSchema).default([]), definition_history: z.array(ScheduleSchema).default([]),
 operation_receipts: z.record(z.object({ intent_hash: z.string(), result: z.unknown() }).strict()).default({}) }).passthrough();
type DurableSchedules = z.infer<typeof ScheduleFileSchema>;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function emptyFile(): DurableSchedules { return ScheduleFileSchema.parse(emptyScheduleDocument()); }
async function loadScheduleFile(): Promise<DurableSchedules> {
 const publication = await loadPublicationState();
 try {
  const body = await readFile(dataPath(FILE),"utf8");
  if (publication.stores[FILE] && publication.stores[FILE].hash !== publicationContentHash(body)) throw new Error("UNPUBLISHED_SCHEDULE_CHANGE");
  return ScheduleFileSchema.parse(JSON.parse(stripBom(body)));
 } catch(error) {
  if ((error as NodeJS.ErrnoException).code === "ENOENT" && !publication.stores[FILE]) return emptyFile();
  throw new Error(`SCHEDULE_STORE_UNAVAILABLE: ${String(error)}`);
 }
}
async function saveScheduleFile(file: DurableSchedules): Promise<void> {
 file.metadata.revision++; file.metadata.schema_version="2.0.0";
 file.metadata.total_schedules=file.schedules.filter(s=>!s.archived_at).length; file.metadata.total_executions=file.executions.length;
 const body=JSON.stringify(ScheduleFileSchema.parse(file));
 if (Buffer.byteLength(body)>16*1024*1024 || file.occurrences.length>20000 || file.definition_history.length>10000) throw new Error("SCHEDULE_CAPACITY_REQUIRES_ARCHIVE");
 await commitGraphWrites({ actor:"scheduler", scope:[FILE], cause:"schedule_state", writes:[{file:FILE,content:body}] });
}
function mutateSchedules<T>(work:(file:DurableSchedules)=>Promise<T>):Promise<T> {
 return withoutJobContext(()=>withGraphReconciliation(async()=>{ await recoverGraphPublication();const file=await loadScheduleFile(),before=JSON.stringify(file);const result=await work(file);
  // A rejected/replayed occurrence is not a new state transition. Publishing
  // unchanged polling results grows the receipt ledger and blocks every reader.
  if(JSON.stringify(file)!==before)await saveScheduleFile(file);return result;
 }));
}
export function validateSchedule(schedule: DreamSchedule): DreamSchedule {
 const candidate = ScheduleSchema.parse(schedule) as DreamSchedule;
 validateScheduleTiming(candidate);
 if (candidate.action_version !== SCHEDULE_ACTION_VERSION) throw new Error("SCHEDULE_ACTION_VERSION_UNAVAILABLE");
 try { candidate.parameters=ScheduleActionParameterSchemas[candidate.action].parse(candidate.parameters); }
 catch(error){if(error instanceof z.ZodError)throw new z.ZodError(error.issues.map(issue=>({...issue,path:["parameters",...issue.path]})));throw error;}
 if (candidate.parameters.strategy === "reflective") throw new Error("SCHEDULE_RETIRED_STRATEGY");
 return candidate;
}
function guard(file:DurableSchedules,schedule:DreamSchedule,now:number,manual=false):string|null {
 try { validateSchedule(schedule); } catch(error) { return `invalid_definition:${String(error)}`; }
 if (schedule.archived_at) return "archived";
 if (!manual && (!config.enabled || !schedule.enabled || schedule.status!=="active")) return "paused";
 if (schedule.max_runs!==null && schedule.run_count>=schedule.max_runs) return "max_runs";
 if (schedule.error_count>=config.max_error_streak) return "error_streak";
 const claimed=file.occurrences.filter(o=>o.occurrence.job_id && Date.parse(o.claimed_at)>now-3600000);
 if (claimed.length>=config.max_runs_per_hour) return "rate_limit";
 const last=claimed.reduce((n,o)=>Math.max(n,Date.parse(o.claimed_at)),0);
 if (last && now-last<config.global_cooldown_ms) return "global_cooldown";
 const nightmare=claimed.filter(o=>o.occurrence.action==="nightmare_cycle").reduce((n,o)=>Math.max(n,Date.parse(o.claimed_at)),0);
 if (schedule.action==="nightmare_cycle" && nightmare && now-nightmare<config.nightmare_cooldown_ms) return "nightmare_cooldown";
 return null;
}
export async function getScheduleSnapshot(now=Date.now()) {
 return withGraphRead(async()=>{const file=await loadScheduleFile();const jobs=await new EngineJobs().inspect();return {
  schema:"dreamgraph.schedule_snapshot.v2", revision:file.metadata.revision, config:structuredClone(config), last_activity_at:file.metadata.last_activity_at,
  schedules:file.schedules.filter(s=>!s.archived_at).map(s=>{const reason=guard(file,s as DreamSchedule,now);return {...s,diagnostics:reason?[reason]:[],
    preview_available:!reason?.startsWith("invalid_definition"),preview_search_horizon_days:32,
    jobs:jobs.records.filter(j=>j.job.scope.includes(`schedule:${s.id}`)).map(j=>j.job)};}),
  occurrences:structuredClone(file.occurrences), history:structuredClone(file.executions.slice(-config.max_history)),
 };});
}
export async function createSchedule(opts: { name:string;action:ScheduleAction;parameters?:Record<string,unknown>;trigger_type:ScheduleTriggerType;
 interval_ms?:number;cron?:string;cycle_interval?:number;idle_ms?:number;enabled?:boolean;max_runs?:number|null;
 timezone?:string;fold_policy?:"once"|"both";missed_policy?:"skip"|"catch_up_once";operation_id?:string }):Promise<DreamSchedule> {
 const now=new Date().toISOString();
 const candidate=validateSchedule({id:`sched_${randomUUID()}`,name:opts.name,action:opts.action,parameters:opts.parameters??{},trigger_type:opts.trigger_type,
  ...(opts.interval_ms!==undefined?{interval_ms:opts.interval_ms}:{}),...(opts.cron!==undefined?{cron:opts.cron}:{}),
  ...(opts.cycle_interval!==undefined?{cycle_interval:opts.cycle_interval}:{}),...(opts.idle_ms!==undefined?{idle_ms:opts.idle_ms}:{}),
  enabled:opts.enabled??false,status:opts.enabled?"active":"paused",last_run_at:null,next_run_at:null,run_count:0,max_runs:opts.max_runs??null,
  last_cycle_checked:0,error_count:0,last_error:null,created_at:now,updated_at:now,definition_revision:1,action_version:SCHEDULE_ACTION_VERSION,
  timezone:opts.timezone??"UTC",fold_policy:opts.fold_policy??"once",missed_policy:opts.missed_policy??"skip",overlap_policy:"queue_one",archived_at:null});
 return mutateSchedules(async file=>{const key=opts.operation_id?`create:${opts.operation_id}`:null,intent=digest(opts);
  if(key&&file.operation_receipts[key]){if(file.operation_receipts[key].intent_hash!==intent)throw new Error("SCHEDULE_OPERATION_CONFLICT");return structuredClone(file.operation_receipts[key].result) as DreamSchedule;}
  file.schedules.push(candidate as z.infer<typeof ScheduleSchema>); if(key)file.operation_receipts[key]={intent_hash:intent,result:candidate}; return structuredClone(candidate);});
}
export async function updateSchedule(scheduleId:string, updates:Partial<DreamSchedule>, controls?:{expected_revision:number;operation_id?:string;reviewed_policy_digest?:string}):Promise<DreamSchedule|null> {
 updates=Object.fromEntries(Object.entries(updates).filter(([,value])=>value!==undefined));
 const allowed=new Set(["name","enabled","parameters","interval_ms","cron","cycle_interval","idle_ms","max_runs","trigger_type","action","timezone","fold_policy","missed_policy","overlap_policy"]);
 if(Object.keys(updates).some(key=>!allowed.has(key)))throw new Error("SCHEDULE_IMMUTABLE_FIELD");
 if(!controls||!Number.isSafeInteger(controls.expected_revision))throw new Error("SCHEDULE_REVISION_REQUIRED");
 return mutateSchedules(async file=>{
  const key=controls.operation_id?`update:${scheduleId}:${controls.operation_id}`:null,intent=digest({updates,expected_revision:controls.expected_revision});
  if(key&&file.operation_receipts[key]){if(file.operation_receipts[key].intent_hash!==intent)throw new Error("SCHEDULE_OPERATION_CONFLICT");return structuredClone(file.operation_receipts[key].result) as DreamSchedule;}
  const index=file.schedules.findIndex(s=>s.id===scheduleId&&!s.archived_at); if(index<0)return null; const old=file.schedules[index];
  if(old.definition_revision!==controls.expected_revision)throw new Error("SCHEDULE_REVISION_CONFLICT");
  const enabled=updates.enabled??old.enabled;
  const next=validateSchedule({...old,...structuredClone(updates),enabled,status:enabled?"active":"paused",definition_revision:old.definition_revision+1,updated_at:new Date().toISOString(),
   ...(updates.enabled===true?{last_error:null,error_count:0}: {})} as DreamSchedule);
  if(controls.reviewed_policy_digest!==undefined){const policies=await scheduledRolePolicies(next);
   if(schedulePolicyDigest(next,Object.values(policies).map(policy=>policy.fingerprint))!==controls.reviewed_policy_digest)throw new Error("SCHEDULE_POLICY_PREVIEW_CONFLICT");}
  file.definition_history.push(structuredClone(old));file.schedules[index]=next as z.infer<typeof ScheduleSchema>;
  if(key)file.operation_receipts[key]={intent_hash:intent,result:next};return structuredClone(next);
 });
}
export async function deleteSchedule(scheduleId:string,controls?:{expected_revision:number;operation_id?:string}):Promise<boolean> {
 if(!controls||!Number.isSafeInteger(controls.expected_revision))throw new Error("SCHEDULE_REVISION_REQUIRED");
 return mutateSchedules(async file=>{
  const key=controls.operation_id?`archive:${scheduleId}:${controls.operation_id}`:null,intent=digest({scheduleId,expected_revision:controls.expected_revision});
  if(key&&file.operation_receipts[key]){if(file.operation_receipts[key].intent_hash!==intent)throw new Error("SCHEDULE_OPERATION_CONFLICT");return file.operation_receipts[key].result as boolean;}
  const schedule=file.schedules.find(s=>s.id===scheduleId);if(!schedule)return false;
  if(schedule.definition_revision!==controls.expected_revision)throw new Error("SCHEDULE_REVISION_CONFLICT");
  if(!schedule.archived_at){file.definition_history.push(structuredClone(schedule));schedule.definition_revision++;schedule.archived_at=new Date().toISOString();schedule.enabled=false;schedule.status="paused";}
  if(key)file.operation_receipts[key]={intent_hash:intent,result:true};return true;});
}

/** Duplicate under the existing writer; source revision and disabled new intent commit together. */
export async function duplicateSchedule(scheduleId:string,controls:{expected_revision:number;operation_id:string}):Promise<DreamSchedule>{
 return mutateSchedules(async file=>{
  const key=`duplicate:${scheduleId}:${controls.operation_id}`,intent=digest({scheduleId,expected_revision:controls.expected_revision});
  const prior=file.operation_receipts[key];if(prior){if(prior.intent_hash!==intent)throw new Error("SCHEDULE_OPERATION_CONFLICT");return structuredClone(prior.result) as DreamSchedule;}
  const original=file.schedules.find(s=>s.id===scheduleId&&!s.archived_at);if(!original)throw new Error("SCHEDULE_NOT_FOUND");
  if(original.definition_revision!==controls.expected_revision)throw new Error("SCHEDULE_REVISION_CONFLICT");
  const now=new Date().toISOString(),copy=validateSchedule({...structuredClone(original),id:`sched_${randomUUID()}`,name:`${original.name} copy`,enabled:false,status:"paused",
   definition_revision:1,last_run_at:null,next_run_at:null,run_count:0,last_cycle_checked:0,error_count:0,last_error:null,last_skip_reason:null,created_at:now,updated_at:now,archived_at:null} as DreamSchedule);
  file.schedules.push(copy as z.infer<typeof ScheduleSchema>);file.operation_receipts[key]={intent_hash:intent,result:copy};return structuredClone(copy);
 });
}

/** Validation is pure and uses precisely the definition accepted by the writer. */
export function validateScheduleDraft(input:Record<string,unknown>,now=new Date()):DreamSchedule{
 return validateSchedule({id:"preview-only",name:"",parameters:{},trigger_type:"interval",last_run_at:null,next_run_at:null,
  run_count:0,max_runs:null,last_cycle_checked:0,error_count:0,last_error:null,created_at:now.toISOString(),updated_at:now.toISOString(),
  definition_revision:1,action_version:SCHEDULE_ACTION_VERSION,timezone:"UTC",fold_policy:"once",missed_policy:"skip",overlap_policy:"queue_one",archived_at:null,...input,
  enabled:false,status:"paused"} as DreamSchedule);
}
async function claim(scheduleId:string,cursor:string,planned_at:string|null,now:number,manual:boolean,missed=false,expected_revision?:number,reviewed_policy_digest?:string):Promise<string|null> {
 return mutateSchedules(async file=>{
  const manualKey=manual?`manual:${scheduleId}:${cursor}`:null;
  if(manualKey&&file.operation_receipts[manualKey]) {
   if(file.operation_receipts[manualKey].intent_hash!==digest({scheduleId,expected_revision}))throw new Error("SCHEDULE_OPERATION_CONFLICT");
   return file.operation_receipts[manualKey].result as string;
  }
  const schedule=file.schedules.find(s=>s.id===scheduleId&&!s.archived_at);if(!schedule)throw new Error("SCHEDULE_NOT_FOUND");
  if(expected_revision!==undefined&&schedule.definition_revision!==expected_revision)throw new Error("SCHEDULE_REVISION_CONFLICT");
  const occurrenceId=digest({scheduleId,revision:schedule.definition_revision,cursor});
  const previous=file.occurrences.find(o=>o.occurrence.id===occurrenceId);if(previous)return previous.occurrence.job_id;
  const reason=guard(file,schedule as DreamSchedule,now,manual);
  if(reason){schedule.last_skip_reason=reason; if(manual)throw new Error(`SCHEDULE_BLOCKED:${reason}`);return null;}
  // One accepted occurrence per definition waits behind the engine lane; no unbounded overlap queue.
  if(file.occurrences.some(o=>o.occurrence.schedule_id===scheduleId&&!["finished","skipped","blocked"].includes(o.occurrence.state))){schedule.last_skip_reason="overlap_queue_one";return null;}
  const definition=validateSchedule(schedule as DreamSchedule) as z.infer<typeof ScheduleSchema>;
  const policies=await scheduledRolePolicies(definition as DreamSchedule);
  if(reviewed_policy_digest!==undefined&&schedulePolicyDigest(definition as DreamSchedule,Object.values(policies).map(policy=>policy.fingerprint))!==reviewed_policy_digest)throw new Error("SCHEDULE_POLICY_PREVIEW_CONFLICT");
  const skipped=missed&&definition.missed_policy==="skip";
  const job=skipped?null:await new EngineJobs().accept({operation_id:`occurrence:${occurrenceId}`,owner:"scheduler",action:definition.action,action_version:definition.action_version,
   parameters:definition.parameters,scope:[`schedule:${scheduleId}`],timeout_ms:config.execution_timeout_ms,roles:scheduleRoles(definition.action),role_policies:policies});
  file.occurrences.push({occurrence:{schema:"dreamgraph.schedule_occurrence.v1",id:occurrenceId,schedule_id:scheduleId,definition_revision:definition.definition_revision,
   planned_at,trigger_cursor:cursor,timezone:definition.timezone,fold_policy:definition.fold_policy,job_id:job?.job.id??null,
   action:definition.action,action_version:definition.action_version,parameters:structuredClone(definition.parameters),state:skipped?"skipped":"queued"},
   definition,claimed_at:new Date(now).toISOString(),reason:skipped?"missed_skip":null,completed_at:skipped?new Date(now).toISOString():null});
  if(manualKey&&job)file.operation_receipts[manualKey]={intent_hash:digest({scheduleId,expected_revision}),result:job.job.id};
  schedule.last_run_at=new Date(now).toISOString();schedule.last_skip_reason=skipped?"missed_skip":null;return job?.job.id??null;
 });
}
async function finishOccurrence(jobId:string):Promise<ScheduleExecution|null>{
 return mutateSchedules(async file=>{
  const item=file.occurrences.find(o=>o.occurrence.job_id===jobId);if(!item)return null;
  const prior=file.executions.find(e=>e.job_id===jobId);if(prior)return prior as unknown as ScheduleExecution;
  const record=(await new EngineJobs().inspect()).records.find(r=>r.job.id===jobId)!;
  if(!["succeeded","failed","cancelled","partial"].includes(record.job.state))return null;
  const completed=new Date().toISOString(),success=record.job.state==="succeeded";
  const execution:ScheduleExecution={id:`exec_${item.occurrence.id}`,schedule_id:item.definition.id,schedule_name:item.definition.name,action:item.definition.action,
   triggered_at:item.claimed_at,completed_at:completed,duration_ms:Math.max(0,Date.parse(completed)-Date.parse(item.claimed_at)),success,
   result_summary:typeof record.result==="string"?record.result:record.error??record.job.terminal_cause??record.job.state,
   ...(record.error?{error:record.error}:{}),occurrence_id:item.occurrence.id,job_id:jobId,definition_revision:item.occurrence.definition_revision,
   action_version:item.occurrence.action_version,parameters:structuredClone(item.occurrence.parameters)};
  file.executions.push(ExecutionSchema.parse(execution));item.occurrence.state="finished";item.completed_at=completed;
  const schedule=file.schedules.find(s=>s.id===item.definition.id);
  if(schedule){schedule.run_count++;
   // Old-definition results do not overwrite a newer client's status or error policy.
   if(schedule.definition_revision===item.occurrence.definition_revision){schedule.error_count=success?0:schedule.error_count+1;schedule.last_error=success?null:execution.result_summary;
    if(schedule.error_count>=config.max_error_streak){schedule.enabled=false;schedule.status="error";}}
   if(schedule.max_runs!==null&&schedule.run_count>=schedule.max_runs){schedule.enabled=false;schedule.status="exhausted";}}
  return execution;
 });
}
async function runOccurrence(jobId:string,signal?:AbortSignal):Promise<ScheduleExecution|null>{
 const jobs=new EngineJobs(),record=(await jobs.inspect()).records.find(r=>r.job.id===jobId)!;
 if(["succeeded","failed","cancelled","partial"].includes(record.job.state))return finishOccurrence(jobId);
 if(!["queued","blocked"].includes(record.job.state))return null;
 const item=await withGraphRead(async()=>(await loadScheduleFile()).occurrences.find(o=>o.occurrence.job_id===jobId));if(!item)throw new Error("SCHEDULE_OCCURRENCE_MISSING");
 try {await jobs.run(jobId,async()=>{
  const definition=validateSchedule(item.definition as DreamSchedule);
  try {await assertJobCurrent();return await executeAction(definition);}
  finally {if(engine.getState()!=="awake")await withoutJobContext(()=>engine.interrupt());}
 },signal);}catch(error){if(!(error instanceof Error))throw error;logger.warn(`Scheduled job ${jobId}: ${error.message}`);}
 return finishOccurrence(jobId);
}
export async function runScheduleNow(scheduleId:string,controls?:{operation_id:string;expected_revision:number;signal?:AbortSignal}):Promise<ScheduleExecution>{
 if(!controls?.operation_id)throw new Error("SCHEDULE_OPERATION_ID_REQUIRED");
 if(!Number.isSafeInteger(controls.expected_revision))throw new Error("SCHEDULE_REVISION_REQUIRED");
 const id=await claim(scheduleId,`manual:${controls.operation_id}`,null,Date.now(),true,false,controls.expected_revision);if(!id)throw new Error("SCHEDULE_NOT_CLAIMED");
 const result=await runOccurrence(id,controls.signal);if(!result){const state=(await new EngineJobs().inspect()).records.find(r=>r.job.id===id)!.job.state;throw new Error(`SCHEDULE_JOB_PENDING:${id}:${state}`);}return result;
}

/** Durable admission finishes before replying; transport lifetime never owns this daemon job. */
export async function enqueueScheduleNow(scheduleId:string,controls:{operation_id:string;expected_revision:number;reviewed_policy_digest?:string}){
 if(!controls.operation_id||!Number.isSafeInteger(controls.expected_revision))throw new Error("SCHEDULE_OPERATION_ID_REQUIRED");
 const jobId=await claim(scheduleId,`manual:${controls.operation_id}`,null,Date.now(),true,false,controls.expected_revision,controls.reviewed_policy_digest);
 if(!jobId)throw new Error("SCHEDULE_NOT_CLAIMED");
 const directory=getDataDir();void withDataDirectory(directory,()=>runOccurrence(jobId)).catch(error=>logger.error(`Scheduled background job ${jobId}: ${String(error)}`));
 return (await new EngineJobs(directory).inspect()).records.find(record=>record.job.id===jobId)!;
}
export async function tickSchedules(now=Date.now(),cycle?:number):Promise<void>{
 const directory=getDataDir(); await withDataDirectory(directory,async()=>{
  const file=await withGraphRead(()=>loadScheduleFile());
  const queued=new Set(file.occurrences.filter(o=>o.occurrence.job_id&&o.occurrence.state!=="finished").map(o=>o.occurrence.job_id!));
  // Admit every proposal before advancing the durable cursor or executing a slow action.
  for(const schedule of file.schedules.filter(s=>config.enabled&&!s.archived_at&&s.enabled&&s.status==="active")){
   try {const proposal=evaluateSchedule(schedule as DreamSchedule,now,{cycle,last_activity_at:file.metadata.last_activity_at,last_tick:file.metadata.last_tick});if(!proposal)continue;
    const id=await claim(schedule.id,proposal.trigger_cursor,proposal.planned_at,now,false,proposal.missed,schedule.definition_revision);if(id)queued.add(id);
   }catch(error){logger.warn(`Schedule ${schedule.id} blocked: ${String(error)}`);}
  }
  await mutateSchedules(async current=>{if(!current.metadata.last_tick||Date.parse(current.metadata.last_tick)<now)current.metadata.last_tick=new Date(now).toISOString();});
  for(const id of queued)await runOccurrence(id);
  if(config.enabled&&!(await import("./job-context.js")).currentJob())await (await import("./digestion.js")).runDirtyDigestion({now});
 });
}
export async function notifyCycleComplete(cycleNumber:number):Promise<void>{await tickSchedules(Date.now(),cycleNumber);}
export function recordActivity():void{
 const directory=getDataDir(),now=new Date().toISOString();
 void withDataDirectory(directory,()=>mutateSchedules(async file=>{file.metadata.last_activity_at=now;})).catch(error=>logger.warn(`Schedule activity unavailable: ${String(error)}`));
}
export async function getSchedules():Promise<DreamSchedule[]>{return withGraphRead(async()=>(await loadScheduleFile()).schedules.filter(s=>!s.archived_at) as DreamSchedule[]);}
export async function getScheduleHistory(scheduleId?:string,limit?:number):Promise<ScheduleExecution[]>{
 if(limit!==undefined&&(!Number.isSafeInteger(limit)||limit<1||limit>10000))throw new Error("SCHEDULE_HISTORY_LIMIT");
 return withGraphRead(async()=>{let entries=(await loadScheduleFile()).executions;if(scheduleId)entries=entries.filter(e=>e.schedule_id===scheduleId);return (limit?entries.slice(-limit):entries) as unknown as ScheduleExecution[];});
}
export async function getScheduleFile():Promise<ScheduleFile>{return withGraphRead(()=>loadScheduleFile()) as unknown as Promise<ScheduleFile>;}
export function startScheduler(cfg?:Partial<SchedulerConfig>):void{
 if(cfg)config=mergeEngineSettings(SchedulerSettingsSchema,config,cfg);stopScheduler();if(!config.enabled)return;
 const directory=getDataDir(),generation=schedulerGeneration;
 const tick=()=>{
  // Timer callbacks are wake-ups, not durable occurrences. Never queue an
  // unbounded backlog while one tick is waiting for a writer or engine job.
  // Keep the active pass across config restarts; accepted work retains its owner.
  if(generation!==schedulerGeneration||automaticTick)return;
  automaticTick=withDataDirectory(directory,()=>tickSchedules()).catch(error=>logger.error(`Scheduler tick: ${String(error)}`)).finally(()=>{automaticTick=null;});
  return automaticTick;
 };
 // Recovery is serialized before all ticks; old running effects are never replayed.
 const recovered=withDataDirectory(directory,()=>new EngineJobs(directory).recover());
 tickTimer=setInterval(()=>{void recovered.then(tick).catch(error=>logger.error(`Scheduler recovery: ${String(error)}`));},config.tick_interval_ms);tickTimer.unref();
 void recovered.then(tick).catch(error=>logger.error(`Scheduler recovery: ${String(error)}`));
}
export function stopScheduler():void{schedulerGeneration++;if(tickTimer){clearInterval(tickTimer);tickTimer=null;}}
export function updateSchedulerConfig(next:Partial<SchedulerConfig>):void{config=mergeEngineSettings(SchedulerSettingsSchema,config,next);if(tickTimer||next.enabled===true)startScheduler();}
export function getSchedulerConfig():SchedulerConfig{return structuredClone(config);}
