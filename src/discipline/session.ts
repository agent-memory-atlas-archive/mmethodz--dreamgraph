import { getSessionContext, sessionNamespace, sessionStates } from "../server/session-context.js";
/**
 * DreamGraph MCP Server — Disciplinary Task Session Manager.
 *
 * Manages the lifecycle of disciplinary task sessions: creation,
 * phase transitions, tool-call tracking, and persistence to disk.
 *
 * Sessions are persisted as JSON files in the data directory under
 * `discipline_sessions/`. Each session corresponds to one complete
 * Ingest → Audit → Plan → Execute → Verify cycle.
 *
 * TDD Phase 4 Task 4.6: Task session persistence.
 */

import { randomUUID } from "node:crypto";
import { readFile, mkdir, readdir } from "node:fs/promises";
import { atomicWriteFile } from "../utils/atomic-write.js";
import { resolve } from "node:path";
import { getDataDir } from "../utils/paths.js";
import { logger } from "../utils/logger.js";
import { canTransition } from "./state-machine.js";
import { getToolClassification } from "./manifest.js";
import { MANDATORY_TOOL_RULES } from "./manifest.js";
import { disciplineArtifactGate } from "./approval.js";
import type {
  DisciplinePhase,
  TaskType,
  TaskSession,
  ToolCallRecord,
  BlockedActionRecord,
  ViolationRecord,
  PhaseTransitionRecord,
  DeltaTable,
  ImplementationPlan,
  VerificationReport,
} from "./types.js";

// ---------------------------------------------------------------------------
// Session directory
// ---------------------------------------------------------------------------

function sessionsDir(): string {
  return resolve(getDataDir(), "discipline_sessions");
}

function sessionPath(sessionId: string): string {
  return resolve(sessionsDir(), `${sessionId}.json`);
}

// ---------------------------------------------------------------------------
// Active session (private transport namespace)
// ---------------------------------------------------------------------------

const disciplineStates = sessionStates(() => ({ activeSession: null as TaskSession | null }));
const scopedDiscipline = new Proxy({ activeSession: null as TaskSession | null }, {
  get: (_target, key) => disciplineStates.current()[key as "activeSession"],
  set: (_target, key, value) => { disciplineStates.current()[key as "activeSession"] = value; return true; },
});

export function getActiveSession(): TaskSession | null {
  return scopedDiscipline.activeSession;
}

// ---------------------------------------------------------------------------
// Session CRUD
// ---------------------------------------------------------------------------

/**
 * Start a new disciplinary task session.
 * Creates the session file and sets it as the process-wide active session.
 */
export async function startSession(opts: {
  type: TaskType;
  description: string;
  target_scope: string[];
  requires_ground_truth?: boolean;
  instance_uuid?: string;
}): Promise<TaskSession> {
  if (scopedDiscipline.activeSession && scopedDiscipline.activeSession.status === "active") {
    throw new Error(
      `Session ${scopedDiscipline.activeSession.id} is still active. ` +
      `Complete or abandon it before starting a new one.`
    );
  }

  const now = new Date().toISOString();
  const session: TaskSession = {
    schema_version: "1.0.0",
    owner_namespace: getSessionContext() ? sessionNamespace() : undefined,
    id: randomUUID(),
    instance_uuid: opts.instance_uuid ?? process.env.DREAMGRAPH_INSTANCE_UUID ?? "legacy",
    task: {
      type: opts.type,
      description: opts.description,
      target_scope: opts.target_scope,
      requires_ground_truth: opts.requires_ground_truth ?? true,
    },
    current_phase: "ingest",
    phase_history: [
      {
        from: "start",
        to: "ingest",
        timestamp: now,
        guard_check: { passed: true, reason: "Session started" },
      },
    ],
    tool_calls: [],
    blocked_actions: [],
    violations: [],
    artifacts: {
      delta_tables: [],
      plans: [],
      verification_reports: [],
    },
    started_at: now,
    status: "active",
  };

  scopedDiscipline.activeSession = session;
  await persistSession(session);
  logger.info(`Discipline session started: ${session.id} (${opts.type}: ${opts.description})`);
  return session;
}

/**
 * Transition the active session to a new phase.
 * Validates mandatory tool rules and state machine guards.
 */
export async function transitionPhase(
  targetPhase: DisciplinePhase,
  justification?: string,
): Promise<{ success: boolean; session: TaskSession; reason: string }> {
  if (!scopedDiscipline.activeSession || scopedDiscipline.activeSession.status !== "active") {
    return { success: false, session: scopedDiscipline.activeSession!, reason: "No active session" };
  }

  const currentPhase = scopedDiscipline.activeSession.current_phase;

  // Check state machine
  const transition = canTransition(currentPhase, targetPhase);
  if (!transition.allowed) {
    const blocked: BlockedActionRecord = {
      timestamp: new Date().toISOString(),
      phase: currentPhase,
      action: `transition:${currentPhase}→${targetPhase}`,
      reason: transition.reason,
      rule_triggered: "state_machine",
    };
    scopedDiscipline.activeSession.blocked_actions.push(blocked);
    await persistSession(scopedDiscipline.activeSession);
    return { success: false, session: scopedDiscipline.activeSession, reason: transition.reason };
  }

  // Check mandatory tool rules for outgoing phase
  const mandatoryFailures = checkMandatoryTools(scopedDiscipline.activeSession, currentPhase);
  if (mandatoryFailures.length > 0) {
    const reason = mandatoryFailures.join("; ");
    const blocked: BlockedActionRecord = {
      timestamp: new Date().toISOString(),
      phase: currentPhase,
      action: `transition:${currentPhase}→${targetPhase}`,
      reason,
      rule_triggered: "mandatory_tools",
    };
    scopedDiscipline.activeSession.blocked_actions.push(blocked);
    await persistSession(scopedDiscipline.activeSession);
    return { success: false, session: scopedDiscipline.activeSession, reason };
  }

  const artifactFailure = disciplineArtifactGate(scopedDiscipline.activeSession, targetPhase);
  if (artifactFailure) {
    scopedDiscipline.activeSession.blocked_actions.push({ timestamp: new Date().toISOString(), phase: currentPhase,
      action: `transition:${currentPhase}→${targetPhase}`, reason: artifactFailure, rule_triggered: "current_artifact_approval" });
    await persistSession(scopedDiscipline.activeSession);
    return { success: false, session: scopedDiscipline.activeSession, reason: artifactFailure };
  }
  // Entering PLAN revokes historical-wave approval even if a new submission
  // subsequently fails wire validation before the artifact owner is called.
  if (targetPhase === "plan") scopedDiscipline.activeSession.approval_generation = (scopedDiscipline.activeSession.approval_generation ?? 0) + 1;

  // Transition
  const record: PhaseTransitionRecord = {
    from: currentPhase,
    to: targetPhase,
    timestamp: new Date().toISOString(),
    guard_check: {
      passed: true,
      reason: justification ?? `Transition approved: ${currentPhase} → ${targetPhase}`,
    },
  };

  scopedDiscipline.activeSession.current_phase = targetPhase;
  scopedDiscipline.activeSession.phase_history.push(record);
  await persistSession(scopedDiscipline.activeSession);
  logger.info(`Phase transition: ${currentPhase} → ${targetPhase} (session ${scopedDiscipline.activeSession.id})`);
  return { success: true, session: scopedDiscipline.activeSession, reason: record.guard_check.reason! };
}

/**
 * Record a tool call within the active session.
 * Returns whether the tool is permitted in the current phase.
 */
export async function recordToolCall(
  toolName: string,
  parameters: Record<string, unknown>,
  resultSummary: string,
  durationMs: number,
): Promise<{ allowed: boolean; reason: string }> {
  if (!scopedDiscipline.activeSession || scopedDiscipline.activeSession.status !== "active") {
    return { allowed: true, reason: "No active discipline session — tool permitted" };
  }

  const classification = getToolClassification(toolName);
  const phase = scopedDiscipline.activeSession.current_phase;

  // Check if tool is permitted in current phase
  const allowed = classification
    ? classification.allowed_phases.includes(phase) ||
      classification.allowed_phases.length === 0 // cognitive tools have empty allowed_phases
    : true; // Unknown tools are allowed (wrapper can override)

  const record: ToolCallRecord = {
    id: `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    phase,
    tool_name: toolName,
    tool_class: classification?.tool_class ?? "truth",
    parameters,
    result_summary: resultSummary,
    allowed,
    duration_ms: durationMs,
  };

  scopedDiscipline.activeSession.tool_calls.push(record);

  if (!allowed) {
    const reason = `Tool '${toolName}' (class: ${classification?.tool_class}) not permitted in phase '${phase}'`;
    scopedDiscipline.activeSession.blocked_actions.push({
      timestamp: record.timestamp,
      phase,
      action: `tool_call:${toolName}`,
      reason,
      rule_triggered: "phase_permissions",
    });
    await persistSession(scopedDiscipline.activeSession);
    return { allowed: false, reason };
  }

  await persistSession(scopedDiscipline.activeSession);
  return { allowed: true, reason: `Tool '${toolName}' permitted in phase '${phase}'` };
}

/**
 * Record a discipline violation.
 */
export async function recordViolation(violation: ViolationRecord): Promise<void> {
  if (!scopedDiscipline.activeSession) return;
  scopedDiscipline.activeSession.violations.push(violation);
  await persistSession(scopedDiscipline.activeSession);
}

/**
 * Attach a delta table to the active session.
 */
export async function attachDeltaTable(delta: DeltaTable): Promise<void> {
  if (!scopedDiscipline.activeSession) throw new Error("No active session");
  scopedDiscipline.activeSession.artifacts.delta_tables.push(delta);
  await persistSession(scopedDiscipline.activeSession);
}

/**
 * Attach an implementation plan to the active session.
 */
export async function attachPlan(plan: ImplementationPlan): Promise<void> {
  if (!scopedDiscipline.activeSession) throw new Error("No active session");
  scopedDiscipline.activeSession.artifacts.plans.push(plan);
  await persistSession(scopedDiscipline.activeSession);
}

/**
 * Attach a verification report to the active session.
 */
export async function attachVerificationReport(report: VerificationReport): Promise<void> {
  if (!scopedDiscipline.activeSession) throw new Error("No active session");
  scopedDiscipline.activeSession.artifacts.verification_reports.push(report);
  await persistSession(scopedDiscipline.activeSession);
}

/**
 * Complete the active session.
 */
export async function completeSession(
  status: "completed" | "failed" | "abandoned" = "completed",
): Promise<TaskSession> {
  if (!scopedDiscipline.activeSession) throw new Error("No active session");
  scopedDiscipline.activeSession.status = status;
  scopedDiscipline.activeSession.completed_at = new Date().toISOString();
  const finished = { ...scopedDiscipline.activeSession };
  await persistSession(scopedDiscipline.activeSession);
  scopedDiscipline.activeSession = null;
  logger.info(`Discipline session ${status}: ${finished.id}`);
  return finished;
}

/**
 * Load a session from disk and optionally resume it.
 */
export async function loadSession(sessionId: string, resume = false): Promise<TaskSession> {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(sessionId)) throw new Error("DISCIPLINE_SESSION_ID_INVALID");
  const filePath = sessionPath(sessionId);
  const raw = await readFile(filePath, "utf-8");
  const session = JSON.parse(raw) as TaskSession;
  if (getSessionContext() && session.owner_namespace !== sessionNamespace()) throw new Error("DISCIPLINE_SESSION_OWNER_REJECTED");
  if (resume && session.status === "active") {
    scopedDiscipline.activeSession = session;
    logger.info(`Resumed discipline session: ${sessionId}`);
  }
  return session;
}

/**
 * List all sessions (most recent first).
 */
export async function listSessions(): Promise<{ id: string; status: string; task: string; phase: string; started_at: string }[]> {
  const dir = sessionsDir();
  try {
    const files = await readdir(dir);
    const sessions: { id: string; status: string; task: string; phase: string; started_at: string }[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await readFile(resolve(dir, file), "utf-8");
        const s = JSON.parse(raw) as TaskSession;
        if (getSessionContext() && s.owner_namespace !== sessionNamespace()) continue;
        sessions.push({
          id: s.id,
          status: s.status,
          task: s.task.description,
          phase: s.current_phase,
          started_at: s.started_at,
        });
      } catch { /* skip corrupt files */ }
    }
    return sessions.sort((a, b) => b.started_at.localeCompare(a.started_at));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function persistSession(session: TaskSession): Promise<void> {
  const dir = sessionsDir();
  await mkdir(dir, { recursive: true });
  await atomicWriteFile(sessionPath(session.id), JSON.stringify(session, null, 2));
}

/**
 * Check mandatory tool rules for the current phase.
 * Returns a list of failure messages (empty if all rules pass).
 */
function checkMandatoryTools(session: TaskSession, phase: DisciplinePhase): string[] {
  const failures: string[] = [];

  for (const rule of MANDATORY_TOOL_RULES) {
    if (rule.phase !== phase) continue;

    const requiredTools = rule.required_tool.split("|").map((t) => t.trim());
    const callsInPhase = session.tool_calls.filter(
      (tc) => tc.phase === phase && tc.allowed && requiredTools.includes(tc.tool_name),
    );

    if (callsInPhase.length < rule.min_calls) {
      failures.push(
        `Mandatory rule: ${rule.required_tool} must be called ≥${rule.min_calls} time(s) in ${phase} phase. ` +
        `Found ${callsInPhase.length}. Rationale: ${rule.rationale}`,
      );
    }
  }

  return failures;
}
