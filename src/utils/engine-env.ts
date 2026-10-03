/**
 * DreamGraph — engine.env loader.
 *
 * Parses a simple KEY=VALUE env file (no dependencies — no dotenv needed).
 * Supports:
 *   - `KEY=VALUE` and `KEY="VALUE"` and `KEY='VALUE'`
 *   - Comments: lines starting with `#`
 *   - Empty lines are ignored
 *   - Inline comments are NOT supported (values may contain `#`)
 *
 * Explicit deployment overrides captured at module load outrank persisted instance
 * intent. Versioned documents use JSON quoted strings; v0 quotes remain literal.
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync, renameSync, unlinkSync, openSync, fdatasyncSync, closeSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { parseEngineEnvDocument, renderEngineEnvUpdates, formatEngineEnvAssignment } from "../config/engine-env-document.js";
import { validateEngineEnvValues } from "../config/engine-setting-catalogue.js";
import { logger } from "./logger.js";
import { ROLE_ENV_FIELDS } from "../config/role-env-fields.js";



/**
 * Write a set of KEY=VALUE pairs to an engine.env file.
 *
 * Creates a documented scaffold, or merges into an existing file. Groups
 * values by purpose (base LLM, dreamer, normalizer).
 *
 * @param envPath  Absolute path to the engine.env file.
 * @param vars     Record of env-var names → values to write.  Empty/null
 *                 values are written as commented-out lines.
 */
export function writeEngineEnv(
  envPath: string,
  vars: Record<string, string>,
): void {
  try {
    if (existsSync(envPath)) { updateEngineEnvValues(envPath, vars); return; }
    validateEngineEnvValues(vars);
    mkdirSync(dirname(envPath), { recursive: true });

    const template: Array<{ key: string; defaultValue: string; description: string; section: string }> = [
      {
        key: "DREAMGRAPH_INSTANCE_UUID",
        defaultValue: "",
        description: "Stable instance identifier. Usually auto-generated when the instance is created.",
        section: "Instance",
      },
      {
        key: "DREAMGRAPH_MASTER_DIR",
        defaultValue: "./.dreamgraph/master",
        description: "Master storage directory for shared DreamGraph state and exported data.",
        section: "Instance",
      },
      {
        key: "DREAMGRAPH_DATA_DIR",
        defaultValue: "./.dreamgraph/data",
        description: "Instance data directory for seed files, dreams, ADRs, and registry data.",
        section: "Instance",
      },
      {
        key: "DREAMGRAPH_REPOS",
        defaultValue: '{"dashboard":"C:/path/to/dashboard","api":"C:/path/to/api"}',
        description: "JSON object mapping additional repository IDs to absolute local paths for code, git, and scan tools. The attached project_root is auto-registered separately.",
        section: "Repository Mapping",
      },
      {
        key: "DREAMGRAPH_LLM_PROVIDER",
        defaultValue: "ollama",
        description: "Provider: ollama (local, default) | openai (API) | anthropic (Claude API) | sampling (MCP client) | none",
        section: "LLM Provider",
      },
      {
        key: "DREAMGRAPH_LLM_URL",
        defaultValue: "http://localhost:11434",
        description: "API base URL",
        section: "LLM Provider",
      },
      {
        key: "DREAMGRAPH_LLM_API_KEY",
        defaultValue: "",
        description: "API key (for openai/anthropic providers)",
        section: "LLM Provider",
      },
      {
        key: "DREAMGRAPH_LLM_MODEL",
        defaultValue: "qwen3:8b",
        description: "Base model defaults — used unless Dreamer / Normalizer overrides are set",
        section: "Base LLM Defaults",
      },
      {
        key: "DREAMGRAPH_LLM_TEMPERATURE",
        defaultValue: "0.7",
        description: "Base temperature defaults — used unless Dreamer / Normalizer overrides are set",
        section: "Base LLM Defaults",
      },
      {
        key: "DREAMGRAPH_LLM_MAX_TOKENS",
        defaultValue: "2048",
        description: "Base max token defaults — used unless Dreamer / Normalizer overrides are set",
        section: "Base LLM Defaults",
      },
      {
        key: "DREAMGRAPH_LLM_ARCHITECT_PROVIDER",
        defaultValue: "ollama",
        description: "Architect chat provider override. Falls back to DREAMGRAPH_LLM_PROVIDER when unset.",
        section: "Architect",
      },
      {
        key: "DREAMGRAPH_LLM_ARCHITECT_ADAPTER",
        defaultValue: "native_api_tool_loop",
        description: "Architect adapter: native_api_tool_loop | codex-cli | copilot-cli | deterministic_fallback.",
        section: "Architect",
      },
      {
        key: "DREAMGRAPH_ARCHITECT_SELECTED_PLAN_ID",
        defaultValue: "",
        description: "architect selected plan id restored when the daemon/browser restarts.",
        section: "Architect",
      },
      {
        key: "DREAMGRAPH_LLM_ARCHITECT_MODEL",
        defaultValue: "qwen3:8b",
        description: "Architect chat model override. Fallback order: Architect -> general -> Normalizer -> Dreamer.",
        section: "Architect",
      },
      {
        key: "DREAMGRAPH_LLM_ARCHITECT_TEMPERATURE",
        defaultValue: "0.7",
        description: "Architect chat temperature",
        section: "Architect",
      },
      {
        key: "DREAMGRAPH_LLM_ARCHITECT_MAX_TOKENS",
        defaultValue: "4096",
        description: "Architect chat max tokens",
        section: "Architect",
      },
      {
        key: "DREAMGRAPH_LLM_DREAMER_MODEL",
        defaultValue: "qwen3:8b",
        description: "Dreamer — creative dream cycle generation",
        section: "Dreamer",
      },
      {
        key: "DREAMGRAPH_LLM_DREAMER_TEMPERATURE",
        defaultValue: "0.9",
        description: "Dreamer temperature",
        section: "Dreamer",
      },
      {
        key: "DREAMGRAPH_LLM_DREAMER_MAX_TOKENS",
        defaultValue: "10240",
        description: "Dreamer max tokens",
        section: "Dreamer",
      },
      {
        key: "DREAMGRAPH_LLM_NORMALIZER_MODEL",
        defaultValue: "qwen3:8b",
        description: "Normalizer — validation / truth-filter pass",
        section: "Normalizer",
      },
      {
        key: "DREAMGRAPH_LLM_NORMALIZER_TEMPERATURE",
        defaultValue: "0.1",
        description: "Normalizer temperature",
        section: "Normalizer",
      },
      {
        key: "DREAMGRAPH_LLM_NORMALIZER_MAX_TOKENS",
        defaultValue: "4096",
        description: "Normalizer max tokens",
        section: "Normalizer",
      },
      {
        key: "DG_PROMOTION_CONFIDENCE",
        defaultValue: "0.62",
        description: "Minimum combined confidence for edge promotion to validated graph",
        section: "Promotion & Retention Thresholds",
      },
      {
        key: "DG_PROMOTION_PLAUSIBILITY",
        defaultValue: "0.45",
        description: "Minimum plausibility score for promotion",
        section: "Promotion & Retention Thresholds",
      },
      {
        key: "DG_PROMOTION_EVIDENCE",
        defaultValue: "0.4",
        description: "Minimum evidence score for promotion",
        section: "Promotion & Retention Thresholds",
      },
      {
        key: "DG_PROMOTION_EVIDENCE_COUNT",
        defaultValue: "2",
        description: "Minimum distinct evidence signals for promotion",
        section: "Promotion & Retention Thresholds",
      },
      {
        key: "DG_RETENTION_PLAUSIBILITY",
        defaultValue: "0.35",
        description: "Minimum plausibility for retention as latent (below = rejected)",
        section: "Promotion & Retention Thresholds",
      },
      {
        key: "DG_MAX_CONTRADICTION",
        defaultValue: "0.3",
        description: "Maximum contradiction score before rejection",
        section: "Promotion & Retention Thresholds",
      },
      {
        key: "DG_DECAY_TTL",
        defaultValue: "8",
        description: "Edge time-to-live in dream cycles (removed when TTL reaches 0)",
        section: "Dream Decay",
      },
      {
        key: "DG_DECAY_RATE",
        defaultValue: "0.05",
        description: "Confidence reduction per cycle if not reinforced",
        section: "Dream Decay",
      },
      {
        key: "DG_MEMORY_TTL_CYCLES",
        defaultValue: "30",
        description: "Reinforcement memory TTL (cycles of inactivity before forgetting)",
        section: "Dream Decay",
      },
      {
        key: "DG_MAX_ACTIVE_TENSIONS",
        defaultValue: "200",
        description: "Max active (unresolved) tensions",
        section: "Tension System",
      },
      {
        key: "DG_TENSION_TTL",
        defaultValue: "30",
        description: "Default TTL for new tensions (cycles before auto-expire)",
        section: "Tension System",
      },
      {
        key: "DG_TENSION_URGENCY_DECAY",
        defaultValue: "0.01",
        description: "Urgency decay per cycle for non-recurring tensions",
        section: "Tension System",
      },
      {
        key: "DG_BARREN_THRESHOLD",
        defaultValue: "3",
        description: "Consecutive 0-yield cycles before a strategy gets benched",
        section: "Adaptive Dream Strategy",
      },
      {
        key: "DG_PROBE_INTERVAL",
        defaultValue: "6",
        description: "Cycles between probe runs for benched strategies",
        section: "Adaptive Dream Strategy",
      },
      {
        key: "DG_STRATEGY_HISTORY",
        defaultValue: "12",
        description: "Strategy yield history length",
        section: "Adaptive Dream Strategy",
      },
      {
        key: "DG_LLM_BUDGET",
        defaultValue: "0.35",
        description: "LLM dream budget as fraction of total (0.0-1.0)",
        section: "Adaptive Dream Strategy",
      },
      {
        key: "DG_PGO_BUDGET",
        defaultValue: "0.15",
        description: "PGO wave budget as fraction of total (0.0-1.0)",
        section: "Adaptive Dream Strategy",
      },
      {
        key: "DG_ORPHAN_BUDGET",
        defaultValue: "20",
        description: "Max edges the orphan_bridging strategy may propose per dream cycle",
        section: "Adaptive Dream Strategy",
      },
      {
        key: "DG_NORMALIZER_BATCH_SIZE",
        defaultValue: "20",
        description: "Max edges per LLM semantic validation batch",
        section: "Normalizer Tuning",
      },
      {
        key: "DG_NORMALIZER_LLM_THRESHOLD",
        defaultValue: "0.35",
        description: "Minimum confidence for LLM semantic evaluation of latent edges",
        section: "Normalizer Tuning",
      },
      {
        key: "DATABASE_URL",
        defaultValue: "postgresql://user:password@host:5432/dbname",
        description: "PostgreSQL connection string used by database schema/query tools",
        section: "Database",
      },
      {
        key: "DG_DB_MAX_CONNECTIONS",
        defaultValue: "3",
        description: "Max concurrent PostgreSQL connections",
        section: "Database",
      },
      {
        key: "DG_DB_STATEMENT_TIMEOUT",
        defaultValue: "5000",
        description: "Statement timeout (ms)",
        section: "Database",
      },
      {
        key: "DG_DB_OPERATION_TIMEOUT",
        defaultValue: "10000",
        description: "Operation timeout (ms) — hard cap on entire query_db_schema",
        section: "Database",
      },
    ];

    // Add independently configurable roles without activating defaults or paid limits.
    for (const field of ROLE_ENV_FIELDS) if (!template.some(entry => entry.key === field.key)) {
      template.push({ key: field.key, defaultValue: "", description: field.description, section: `Role Policy — ${field.role}` });
    }

    const lines: string[] = [
      "# DreamGraph Engine Configuration",
      "# Per-instance environment settings. Uncomment and edit as needed.",
      "# Explicit deployment overrides take precedence over these persisted settings.",
      "# dreamgraph.engine_env.v1 — JSON quoted strings",
      "",
    ];

    let currentSection = "";
    let advancedHeaderWritten = false;
    for (const entry of template) {
      if (entry.section !== currentSection) {
        if (currentSection !== "") lines.push("");
        if ([
          "Promotion & Retention Thresholds",
          "Dream Decay",
          "Tension System",
          "Adaptive Dream Strategy",
          "Normalizer Tuning",
          "Database",
        ].includes(entry.section) && !advancedHeaderWritten) {
          lines.push("# ===================================================================");
          lines.push("# ADVANCED TUNING — for experienced users only.");
          lines.push("# These control cognitive engine internals. The defaults work well");
          lines.push("# for most projects. Only change them if you know what you're doing.");
          lines.push("# ===================================================================");
          lines.push("");
          advancedHeaderWritten = true;
        }
        if (!["LLM Provider", "Base LLM Defaults", "Dreamer", "Normalizer"].includes(entry.section)) {
          lines.push(`# --- ${entry.section} ---`);
        }
        currentSection = entry.section;
      }

      lines.push(`# ${entry.description}`);
      const value = vars[entry.key] ?? "";
      if (!(entry.key in vars)) {
        lines.push(`# ${entry.key}=${entry.defaultValue}`);
      } else {
        lines.push(formatEngineEnvAssignment(entry.key, value));
      }
    }

    const remainingKeys = Object.keys(vars).filter(
      key => !template.some(entry => entry.key === key),
    );
    if (remainingKeys.length > 0) {
      lines.push("");
      lines.push("# Additional persisted values");
      for (const key of remainingKeys.sort()) {
        const value = vars[key] ?? "";
        if (value === "" || value == null) {
          lines.push(`# ${key}=`);
        } else {
          lines.push(formatEngineEnvAssignment(key, value));
        }
      }
    }

    lines.push("");
    // Atomic write: temp file + fdatasync + rename. Mirrors atomicWriteFile()
    // for the sync path so a crash mid-write cannot truncate engine.env.
    const tmp = envPath + `.${randomUUID()}.tmp`;
    let fd: number | undefined;
    try {
      fd = openSync(tmp, "wx", 0o600);
      writeFileSync(fd, lines.join("\n"), "utf-8");
      fdatasyncSync(fd);
      closeSync(fd);
      fd = undefined;
      renameSync(tmp, envPath);
    } catch (writeErr) {
      if (fd !== undefined) {
        try { closeSync(fd); } catch { /* ignore */ }
      }
      try { unlinkSync(tmp); } catch { /* ignore */ }
      throw writeErr;
    }
    logger.info(`engine.env: persisted ${Object.keys(vars).length} keys to ${envPath}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`engine.env: failed to write ${envPath}: ${msg}`);
    throw err;
  }
}

/** Compatibility writer; daemon endpoints use revision-checked configuration authority. */
export function updateEngineEnvValues(envPath: string, updates: Record<string, string>): void {
  mkdirSync(dirname(envPath), { recursive: true });
  const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const next = renderEngineEnvUpdates(existing, updates);
  validateEngineEnvValues(parseEngineEnvDocument(next), Object.keys(updates));
  const tmp = envPath + `.${randomUUID()}.tmp`;
  let fd: number | undefined;
  try {
    fd = openSync(tmp, "wx", 0o600); writeFileSync(fd, next, "utf8"); fdatasyncSync(fd); closeSync(fd); fd = undefined;
    renameSync(tmp, envPath);
  } finally {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(tmp); } catch { /* renamed or never created */ }
  }
}
/** Captured before an instance file is loaded; runtime changes are not deployment overrides. */
export const ENGINE_DEPLOYMENT_OVERRIDES: Readonly<Record<string, string | undefined>> = Object.freeze({ ...process.env });
export function loadEngineEnv(envPath: string): number {
  if (!existsSync(envPath)) return 0;
  const values = parseEngineEnvDocument(readFileSync(envPath, "utf8"));
  validateEngineEnvValues(values);
  for (const [key, value] of Object.entries(values)) process.env[key] = ENGINE_DEPLOYMENT_OVERRIDES[key] ?? value;
  return Object.keys(values).length;
}
