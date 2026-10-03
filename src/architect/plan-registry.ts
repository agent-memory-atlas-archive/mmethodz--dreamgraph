import { appendFile, readdir, readFile, stat, realpath } from "node:fs/promises";
import { basename, resolve, relative, sep, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { getActiveScope } from "../instance/lifecycle.js";
import { loadJsonArray } from "../utils/cache.js";
import { getDataDir } from "../utils/paths.js";
import { withGraphRead } from "../utils/graph-reconciliation-barrier.js";
import { replayPlanRequest, applyPlanCommand, importPlanAuthority, readPlanAuthority, bytesHash } from "../discipline/plan-authority.js";
import { initialPlanState, planDefinitionDigest, projectPlanState } from "../discipline/plan-workflow.js";
import { approvalHash } from "../discipline/approval.js";
import type { PlanDefinition, PlanWorkflowState, PlanExecutionIntent } from "../graph/contracts.js";
import { checkPlanRuntimeSource } from "../discipline/plan-runtime.js";

export interface ArchitectHeading {
  level: number;
  title: string;
  path: string;
  startIndex: number;
}

export interface ArchitectSemanticAnchor {
  kind:
    | "adr"
    | "feature"
    | "workflow"
    | "capability"
    | "data_model"
    | "resource"
    | "api_route"
    | "tool"
    | "file_path";
  id: string;
  label: string;
  href: string | null;
  source: "frontmatter" | "markdown" | "catalog" | "log";
}

export interface ArchitectPlanSlice {
  id: string;
  title: string;
  category: "phase" | "slice";
  heading_path: string;
  /** UTF-16 offset into this exact markdown snapshot, shared with the browser review. */
  source_offset?: number;
  status: string | null;
  adr_bindings: string[];
  graph_bindings: ArchitectSemanticAnchor[];
  depends_on?: string[];
  priority?: number;
  acceptance_hash?: string;
  raw_status?: string | null;
  running?: boolean;
  verification_fresh?: boolean;
  status_source?: "typed_plan_authority" | "markdown" | "implementation_log";
}

export interface ArchitectPlanCheckpoint {
  id: string;
  timestamp: string;
  slice_id: string;
  status: string;
  label: string;
  resume_note: string | null;
  body: string;
}

export type ArchitectPlanLifecycle =
  | "draft"
  | "planning"
  | "reviewed"
  | "implementation_ready"
  | "implementing"
  | "verifying"
  | "blocked"
  | "completed"
  | "archived"
  | "superseded";

export type ArchitectExecutionState = "idle" | "running" | "recovery_required" | "partial" | "failed" | "timed_out" | "cancelled" | "complete";

export interface ArchitectPlanSliceRef {
  id: string;
  title: string;
  status: string | null;
}

export interface ArchitectTaskMemoryBinding {
  authority: "dreamgraph";
  source: "implementation_log_projection" | "typed_plan_authority" | "legacy_review_projection";
  binding_status: "projected" | "governed" | "review_required" | "recovery_required";
  plan_state_owner: "daemon";
  current_slice_id: string | null;
  current_checkpoint_id: string | null;
  current_status: string | null;
  last_event_at: string | null;
  resume_hint: string | null;
  plan_lifecycle: ArchitectPlanLifecycle;
  execution_state: ArchitectExecutionState;
  active_slice_id: string | null;
  last_completed_slice_id: string | null;
  next_slice_id: string | null;
}

export interface ArchitectOperationalPlanState {
  source: "implementation_log_projection" | "typed_plan_authority" | "legacy_review_projection";
  revision?: number;
  definition_hash?: string;
  current_slice_ids?: string[];
  running_slice_ids?: string[];
  next_eligibility?: { can_start: boolean; reasons: string[] } | null;
  resume_action?: string;
  reconciliation?: PlanWorkflowState["reconciliation"];
  verified_slice_ids?: string[];
  progress?: { required: number; verified: number; implemented: number; current: number; blocked: number; deferred: number; unknown_legacy: number };
  /** Compatibility claims remain separate from C14 verification and execution authority. */
  reported_progress?: { required: number; completed: number; verified: number; implemented: number; current: number; blocked: number; deferred: number };
  phase: string | null;
  active_phase: string | null;
  current_slice_id: string | null;
  current_slice_title: string | null;
  current_status: string | null;
  plan_lifecycle: ArchitectPlanLifecycle;
  execution_state: ArchitectExecutionState;
  partial: boolean;
  active_slice: ArchitectPlanSliceRef | null;
  last_completed_slice: ArchitectPlanSliceRef | null;
  next_slice: ArchitectPlanSliceRef | null;
  last_checkpoint_at: string | null;
  checkpoint_count: number;
  verified_checkpoint_count: number;
  completed_checkpoint_count: number;
  resume_hint: string | null;
  task_memory_binding: ArchitectTaskMemoryBinding;
}

export interface ArchitectEvidenceLink {
  kind: "file" | "heading" | "route" | "resource" | "tool";
  label: string;
  target: string;
  hint: string | null;
}

export type LivingPlanConfidence = "low" | "medium" | "high";
export type LivingPlanReviewState = "draft" | "reviewed" | "implementation_ready";

export interface LivingPlanBranch {
  id: string;
  title: string;
  status: "conceptual_candidate";
  validates_with: string | null;
  falsified_by: string | null;
  adr_bindings: string[];
}

export interface LivingPlanState {
  source: "markdown_log_projection";
  pulse: string;
  confidence: LivingPlanConfidence;
  current_slice: ArchitectPlanSliceRef | null;
  current_hypothesis: string | null;
  open_questions: string[];
  evidence_anchors: ArchitectSemanticAnchor[];
  nervous_points: string[];
  /** Content-addressed source anchors; positions are never mutation identities. */
  concerns: Array<{ id: string; kind: "open_question" | "nervous_point"; label: string; source_hash: string; definition_hash: string | null }>;
  branches: LivingPlanBranch[];
  plan_asks: string[];
  adr_bindings: string[];
  last_changed_because: string | null;
  review_state: LivingPlanReviewState;
  next_review_prompt: string | null;
}

export type ArchitectPlanActionKind = "plan_action" | "review_gate";

export type ArchitectPlanActionAuditStatus = "recorded" | "completed" | "implemented" | "verified" | "partial" | "failed" | "timed_out" | "cancelled";

export interface ArchitectPlanActionAuditInput {
  kind: ArchitectPlanActionKind;
  action: string;
  audit_reason: string;
  actor?: string | null;
  slice_id?: string | null;
  status?: ArchitectPlanActionAuditStatus | null;
  gate_id?: string | null;
  decision?: string | null;
  evidence?: string | null;
  content?: string | null;
  resume_note?: string | null;
}

export interface ArchitectPlanActionAuditResult {
  plan_id: string;
  plan_path: string;
  log_path: string;
  status: "recorded";
  changed: true;
  audit_id: string;
  action_kind: ArchitectPlanActionKind;
  action: string;
  audit_reason: string;
  markdown_refs: string[];
  graph_refs: string[];
  warnings: string[];
  next_actions: string[];
}

export interface ArchitectPlanRegistry {
  source: "markdown_projection";
  summary: {
    heading_count: number;
    adr_binding_count: number;
    graph_binding_count: number;
    slice_count: number;
    checkpoint_count: number;
  };
  adr_bindings: string[];
  graph_bindings: ArchitectSemanticAnchor[];
  slices: ArchitectPlanSlice[];
  checkpoints: ArchitectPlanCheckpoint[];
  operational_state: ArchitectOperationalPlanState;
  evidence_links: ArchitectEvidenceLink[];
}

export interface ArchitectPlanSummary {
  id: string;
  title: string;
  path: string;
  log_path: string | null;
  status: string | null;
  active_phase: string | null;
  updated_at: string;
  adr_bindings: string[];
  graph_binding_count: number;
  slice_count: number;
  checkpoint_count: number;
  operational_state: ArchitectOperationalPlanState;
}

export interface ArchitectPlanDetail extends ArchitectPlanSummary {
  markdown: string;
  headings: Array<{ level: number; title: string; path: string }>;
  resume_state: {
    last_log_heading: string | null;
    last_resume_note: string | null;
    log_excerpt: string | null;
  };
  living_state: LivingPlanState;
  registry: ArchitectPlanRegistry;
}

interface GraphCatalogEntry {
  kind: "feature" | "workflow" | "capability" | "data_model";
  id: string;
  name: string;
  pattern: RegExp;
}

interface ParsedFrontmatter {
  attributes: Record<string, string | string[]>;
}

const FALLBACK_PROJECT_ROOT = resolve(
  fileURLToPath(import.meta.url),
  "..",
  "..",
  "..",
);

export function getArchitectProjectRoot(): string {
  return getActiveScope()?.projectRoot ?? FALLBACK_PROJECT_ROOT;
}

export function getArchitectPlansRoot(): string {
  return resolve(getArchitectProjectRoot(), "plans");
}

export async function getPlanAuthorityScope(id: string) {
  let root = getArchitectProjectRoot();
  try { root = await realpath(root); } catch { /* source reads surface an unavailable root */ }
  if (process.platform === "win32") root = root.toLowerCase();
  return { id, instance_id: getActiveScope()?.uuid ?? process.env.DREAMGRAPH_INSTANCE_UUID ?? "legacy", project_id: approvalHash(root) };
}

const KNOWN_TOOL_NAMES = new Set([
  "append_to_file",
  "create_file",
  "edit_entity",
  "edit_file",
  "enrich_seed_data",
  "graph_rag_retrieve",
  "list_markdown_chapters",
  "patch_file",
  "planning:append_plan",
  "planning:archive_plan",
  "planning:get_plan_state",
  "planning:get_resume_packet",
  "planning:list_slices",
  "planning:next_slice",
  "planning:resume_plan",
  "planning:review_gate",
  "planning:sanitize_plan",
  "planning:start_plan",
  "planning:sync_plan_graph",
  "planning:update_slice_status",
  "query_architecture_decisions",
  "query_resource",
  "read_markdown_chapter",
  "read_source_code",
  "record_architecture_decision",
  "register_ui_element",
  "run_command",
  "schedule_dream",
  "search_data_model",
  "update_schedule",
]);

const graphCatalogReads = new Map<string, { stamp: string; value: Promise<GraphCatalogEntry[]> }>();

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseFirstMatch(markdown: string, pattern: RegExp): string | null {
  const match = markdown.match(pattern);
  return match?.[1]?.trim() ?? null;
}

function normalizeHeadingTitle(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function parseFrontmatter(markdown: string): ParsedFrontmatter {
  if (!markdown.startsWith("---\n") && !markdown.startsWith("---\r\n")) {
    return { attributes: {} };
  }

  const normalized = markdown.replace(/\r\n/g, "\n");
  const end = normalized.indexOf("\n---\n", 4);
  if (end < 0) {
    return { attributes: {} };
  }

  const block = normalized.slice(4, end);
  const attributes: Record<string, string | string[]> = {};
  for (const line of block.split("\n")) {
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    if (!key || !rawValue) continue;
    if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
      const items = rawValue
        .slice(1, -1)
        .split(",")
        .map((item) => item.trim().replace(/^['\"]|['\"]$/g, ""))
        .filter(Boolean);
      attributes[key] = items;
      continue;
    }
    attributes[key] = rawValue.replace(/^['\"]|['\"]$/g, "");
  }

  return { attributes };
}

function parseHeadings(markdown: string): ArchitectHeading[] {
  const headings: ArchitectHeading[] = [];
  const stack: string[] = [];
  for (const match of markdown.matchAll(/^(#{1,6})\s+(.+)$/gm)) {
    const level = match[1].length;
    const title = normalizeHeadingTitle(match[2]);
    stack[level - 1] = title;
    stack.length = level;
    headings.push({
      level,
      title,
      path: stack.join(" / "),
      startIndex: match.index ?? 0,
    });
  }
  return headings;
}

function sectionBody(markdown: string, headings: ArchitectHeading[], index: number): string {
  const current = headings[index];
  const bodyStart = markdown.indexOf("\n", current.startIndex);
  if (bodyStart < 0) return "";

  let end = markdown.length;
  for (let cursor = index + 1; cursor < headings.length; cursor += 1) {
    if (headings[cursor].level <= current.level) {
      end = headings[cursor].startIndex;
      break;
    }
  }

  return markdown.slice(bodyStart + 1, end).trim();
}

function extractLastLogHeading(logMarkdown: string): string | null {
  const matches = Array.from(logMarkdown.matchAll(/^###\s+(.+)$/gm));
  return matches.length > 0 ? matches[matches.length - 1][1].trim() : null;
}

function extractLastResumeNote(logMarkdown: string): string | null {
  const matches = Array.from(logMarkdown.matchAll(/^- Resume note:\s*(.+)$/gm));
  return matches.length > 0 ? matches[matches.length - 1][1].trim() : null;
}

function extractLogExcerpt(logMarkdown: string): string | null {
  const lines = logMarkdown.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return null;
  return lines.slice(-8).join("\n");
}

async function loadOptionalFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

function uniqueStrings(values: Iterable<string>): string[] {
  return [...new Set([...values].filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function extractMarkdownListItems(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*(?:[-*]|\d+[.)])\s+(.+)$/)?.[1]?.trim() ?? null)
    .filter((item): item is string => Boolean(item));
}

const RESOLVED_REVIEW_ITEM_STATUSES = new Set(["addressed", "resolved", "solved", "closed", "complete", "completed", "done", "fixed", "mitigated"]);

function normalizeReviewItemStatusMarker(value: string): string {
  return value.trim().toLowerCase().replace(/^\((.+)\)$/, "$1").replace(/[.:;]+$/, "");
}

function isResolvedReviewItem(item: string): boolean {
  const normalized = item.trim();
  if (/^\[[xX]\]\s+/.test(normalized)) return true;
  const leadingStatus = normalized.match(/^\(?([A-Za-z]+)\)?\s*(?::|-)\s+/)?.[1];
  if (leadingStatus != null && RESOLVED_REVIEW_ITEM_STATUSES.has(normalizeReviewItemStatusMarker(leadingStatus))) return true;
  const trailingStatus = normalized.match(/(?:\s+|^)\(?([A-Za-z]+)\)?[.:;]*\s*$/)?.[1];
  return trailingStatus != null && RESOLVED_REVIEW_ITEM_STATUSES.has(normalizeReviewItemStatusMarker(trailingStatus));
}

function findSectionItems(markdown: string, headings: ArchitectHeading[], titlePattern: RegExp): string[] {
  const headingIndex = headings.findIndex((heading) => titlePattern.test(heading.title));
  if (headingIndex < 0) return [];
  return extractMarkdownListItems(sectionBody(markdown, headings, headingIndex));
}

function findActiveReviewSectionItems(markdown: string, headings: ArchitectHeading[], titlePattern: RegExp): string[] {
  return findSectionItems(markdown, headings, titlePattern).filter((item) => !isResolvedReviewItem(item));
}

function parseLabeledBranchValue(body: string, label: string): string | null {
  const pattern = new RegExp("^\\s*(?:[-*]\\s*)?" + escapeRegExp(label) + ":\\s*(.+)", "im");
  return body.match(pattern)?.[1]?.trim() ?? null;
}

function deriveLivingPlanConfidence(operationalState: ArchitectOperationalPlanState, openQuestions: string[]): LivingPlanConfidence {
  if (operationalState.verified_checkpoint_count > 0 && openQuestions.length === 0) return "high";
  if (operationalState.completed_checkpoint_count > 0 || operationalState.checkpoint_count > 1) return "medium";
  return "low";
}

function deriveLivingPlanReviewState(lifecycle: ArchitectPlanLifecycle): LivingPlanReviewState {
  if (["implementation_ready", "implementing", "verifying", "completed"].includes(lifecycle)) return "implementation_ready";
  if (lifecycle === "reviewed") return "reviewed";
  return "draft";
}

export function buildLivingPlanState(input: {
  markdown: string;
  headings: ArchitectHeading[];
  checkpoints: ArchitectPlanCheckpoint[];
  graphBindings: ArchitectSemanticAnchor[];
  adrBindings: string[];
  operationalState: ArchitectOperationalPlanState;
}): LivingPlanState {
  const openQuestions = findSectionItems(input.markdown, input.headings, /^(?:\d+\.\s*)?Open Questions$/i);
  const nervousPoints = uniqueStrings([
    ...findActiveReviewSectionItems(input.markdown, input.headings, /^(?:\d+\.\s*)?(?:Nervous Points|Risks?|Risk Register)$/i),
    ...findActiveReviewSectionItems(input.markdown, input.headings, /^(?:\d+\.\s*)?Design Guardrails$/i),
  ]);
  const planAsks = findSectionItems(input.markdown, input.headings, /^(?:\d+\.\s*)?Plan Asks$/i);
  const candidateHeadings = input.headings.filter((heading) =>
    /^Slice\s+[A-Za-z0-9]+[.:]?\s*/i.test(heading.title) && /Candidate Slices/i.test(heading.path),
  );
  const activeSliceId = input.operationalState.active_slice?.id ?? null;
  const completedSliceId = input.operationalState.last_completed_slice?.id ?? null;
  const completedBranchIds = new Set(
    (input.operationalState.verified_slice_ids ?? []).map(slugifySliceSegment),
  );
  const branches = candidateHeadings
    .map((heading) => {
      const index = input.headings.indexOf(heading);
      const classified = classifySlice(heading.title);
      const body = index < 0 ? "" : sectionBody(input.markdown, input.headings, index);
      return classified ? {
        id: classified.sortId,
        title: heading.title,
        status: "conceptual_candidate" as const,
        validates_with: parseLabeledBranchValue(body, "Validates with"),
        falsified_by: parseLabeledBranchValue(body, "Falsified by"),
        adr_bindings: extractAdrBindings(body, { attributes: {} }),
      } : null;
    })
    .filter((branch): branch is LivingPlanBranch => branch != null && branch.id !== activeSliceId && branch.id !== completedSliceId)
    .filter((branch) => !completedBranchIds.has(slugifySliceSegment(branch.id)));
  const currentHypothesis = parseFirstMatch(input.markdown, /^Current review stance:\s*(.+)$/m);
  const latestCheckpoint = input.checkpoints.at(-1) ?? null;
  const currentSlice = input.operationalState.current_slice_id ? { id: input.operationalState.current_slice_id,
    title: input.operationalState.current_slice_title ?? input.operationalState.current_slice_id, status: input.operationalState.current_status } : null;
  const pulse = `${input.operationalState.plan_lifecycle}/${input.operationalState.execution_state}; slice=${currentSlice?.title ?? "none"}; questions=${openQuestions.length}; branches=${branches.length}`;

  return {
    source: "markdown_log_projection",
    pulse,
    confidence: deriveLivingPlanConfidence(input.operationalState, openQuestions),
    current_slice: currentSlice,
    current_hypothesis: currentHypothesis,
    open_questions: openQuestions,
    evidence_anchors: [
      ...input.graphBindings.filter((binding) => binding.kind === "adr"),
      ...input.graphBindings.filter((binding) => binding.kind !== "adr"),
    ].slice(0, 24),
    nervous_points: nervousPoints,
    concerns: [...openQuestions.map(label => ({kind:"open_question" as const,label})),...nervousPoints.map(label => ({kind:"nervous_point" as const,label}))].map(record => ({...record,
      id: `${record.kind}:${bytesHash(record.label)}`, source_hash: bytesHash(input.markdown), definition_hash: input.operationalState.definition_hash ?? null})),
    branches,
    plan_asks: planAsks,
    adr_bindings: input.adrBindings,
    last_changed_because: latestCheckpoint?.label ?? null,
    review_state: deriveLivingPlanReviewState(input.operationalState.plan_lifecycle),
    next_review_prompt: planAsks[0] ?? openQuestions[0] ?? null,
  };
}

function pushBinding(store: Map<string, ArchitectSemanticAnchor>, binding: ArchitectSemanticAnchor): void {
  store.set(`${binding.kind}:${binding.id.toLowerCase()}`, binding);
}

function extractAdrBindings(markdown: string, frontmatter: ParsedFrontmatter): string[] {
  const found = new Set<string>();
  const frontmatterBindings = frontmatter.attributes.adr_bindings;
  if (typeof frontmatterBindings === "string") {
    for (const match of frontmatterBindings.matchAll(/ADR-\d{3}/g)) {
      found.add(match[0]);
    }
  }
  if (Array.isArray(frontmatterBindings)) {
    for (const binding of frontmatterBindings) {
      if (/^ADR-\d{3}$/i.test(binding)) {
        found.add(binding.toUpperCase());
      }
    }
  }
  for (const match of markdown.matchAll(/ADR-\d{3}/g)) {
    found.add(match[0]);
  }
  return [...found].sort((left, right) => left.localeCompare(right));
}

function extractResourceBindings(markdown: string): ArchitectSemanticAnchor[] {
  const store = new Map<string, ArchitectSemanticAnchor>();
  for (const match of markdown.matchAll(/\b(?:system|dream|ops):\/\/[A-Za-z0-9./_-]+\b/g)) {
    pushBinding(store, {
      kind: "resource",
      id: match[0],
      label: match[0],
      href: match[0],
      source: "markdown",
    });
  }
  return [...store.values()];
}

function extractRouteBindings(markdown: string): ArchitectSemanticAnchor[] {
  const store = new Map<string, ArchitectSemanticAnchor>();
  for (const match of markdown.matchAll(/(^|[\s`(])((?:\/architect|\/api\/architect|\/explorer)[A-Za-z0-9_./{}-]*)/gm)) {
    const route = match[2];
    pushBinding(store, {
      kind: "api_route",
      id: route,
      label: route,
      href: route,
      source: "markdown",
    });
  }
  return [...store.values()];
}

function extractToolBindings(markdown: string): ArchitectSemanticAnchor[] {
  const store = new Map<string, ArchitectSemanticAnchor>();
  for (const match of markdown.matchAll(/`([A-Za-z][A-Za-z0-9_-]*(?::[A-Za-z][A-Za-z0-9_-]*)+)`/g)) {
    const toolName = match[1];
    pushBinding(store, {
      kind: "tool",
      id: toolName,
      label: toolName,
      href: null,
      source: "markdown",
    });
  }
  for (const match of markdown.matchAll(/`([A-Za-z][A-Za-z0-9_-]+)`/g)) {
    const toolName = match[1];
    if (!KNOWN_TOOL_NAMES.has(toolName)) continue;
    pushBinding(store, {
      kind: "tool",
      id: toolName,
      label: toolName,
      href: null,
      source: "markdown",
    });
  }
  return [...store.values()];
}

function extractFileBindings(markdown: string): ArchitectSemanticAnchor[] {
  const store = new Map<string, ArchitectSemanticAnchor>();
  for (const match of markdown.matchAll(/`((?:plans|src|extensions|explorer|docs|tests)\/[^`\r\n]+?\.(?:md|ts|tsx|js|mjs|cjs|json))`/g)) {
    const filePath = match[1];
    pushBinding(store, {
      kind: "file_path",
      id: filePath,
      label: filePath,
      href: filePath,
      source: "markdown",
    });
  }
  return [...store.values()];
}

async function loadGraphCatalog(): Promise<GraphCatalogEntry[]> {
  return withGraphRead(async () => {
    let directory = getDataDir();
    try { directory = await realpath(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const key = process.platform === "win32" ? directory.toLowerCase() : directory;
    const files = ["features.json", "workflows.json", "capabilities.json", "data_model.json"];
    const stamp = (await Promise.all(files.map(async file => {
      try { const s = await stat(resolve(directory, file), { bigint: true }); return `${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return "absent"; throw error; }
    }))).join("|");
    const cached = graphCatalogReads.get(key); if (cached?.stamp === stamp) return cached.value;
    const value = Promise.all([
      loadJsonArray<{ id?: string; name?: string }>("features.json"),
      loadJsonArray<{ id?: string; name?: string }>("workflows.json"),
      loadJsonArray<{ id?: string; name?: string }>("capabilities.json"),
      loadJsonArray<{ id?: string; name?: string }>("data_model.json"),
    ]).then(([features, workflows, capabilities, dataModels]) => {
      const catalog: GraphCatalogEntry[] = [];
      for (const entry of features) {
        if (entry.id && entry.name) catalog.push({ kind: "feature", id: entry.id, name: entry.name, pattern: tokenPattern(entry.id) });
      }
      for (const entry of workflows) {
        if (entry.id && entry.name) catalog.push({ kind: "workflow", id: entry.id, name: entry.name, pattern: tokenPattern(entry.id) });
      }
      for (const entry of capabilities) {
        if (entry.id && entry.name) catalog.push({ kind: "capability", id: entry.id, name: entry.name, pattern: tokenPattern(entry.id) });
      }
      for (const entry of dataModels) {
        if (entry.id && entry.name) catalog.push({ kind: "data_model", id: entry.id, name: entry.name, pattern: tokenPattern(entry.id) });
      }
      return catalog;
    });
    const entry = { stamp, value }; graphCatalogReads.delete(key); graphCatalogReads.set(key, entry);
    if (graphCatalogReads.size > 16) graphCatalogReads.delete(graphCatalogReads.keys().next().value!);
    try { return await value; } catch (error) { if (graphCatalogReads.get(key) === entry) graphCatalogReads.delete(key); throw error; }
  });
}

function tokenPattern(token: string): RegExp { return new RegExp(`(^|[^A-Za-z0-9_-])${escapeRegExp(token)}($|[^A-Za-z0-9_-])`, "i"); }
function containsToken(markdown: string, token: string): boolean {
  return tokenPattern(token).test(markdown);
}

function extractCatalogBindings(markdown: string, catalog: GraphCatalogEntry[]): ArchitectSemanticAnchor[] {
  const store = new Map<string, ArchitectSemanticAnchor>();
  const lower = markdown.toLowerCase();
  for (const entry of catalog) {
    // Native substring search cheaply excludes absent ASCII IDs. Keep the
    // original token-boundary expression for matches and non-ASCII identities.
    const idMatch = (!/^[\x00-\x7f]+$/.test(entry.id) || lower.includes(entry.id.toLowerCase())) && entry.pattern.test(markdown);
    const nameMatch = entry.name.length >= 14 && lower.includes(entry.name.toLowerCase());
    if (!idMatch && !nameMatch) continue;
    pushBinding(store, {
      kind: entry.kind,
      id: entry.id,
      label: entry.name,
      href: entry.id,
      source: "catalog",
    });
  }
  return [...store.values()];
}

function collectGraphBindings(markdown: string, adrBindings: string[], catalog: GraphCatalogEntry[]): ArchitectSemanticAnchor[] {
  const store = new Map<string, ArchitectSemanticAnchor>();
  for (const adr of adrBindings) {
    pushBinding(store, {
      kind: "adr",
      id: adr,
      label: adr,
      href: adr,
      source: "markdown",
    });
  }
  for (const binding of extractCatalogBindings(markdown, catalog)) {
    pushBinding(store, binding);
  }
  for (const binding of extractResourceBindings(markdown)) {
    pushBinding(store, binding);
  }
  for (const binding of extractRouteBindings(markdown)) {
    pushBinding(store, binding);
  }
  for (const binding of extractToolBindings(markdown)) {
    pushBinding(store, binding);
  }
  for (const binding of extractFileBindings(markdown)) {
    pushBinding(store, binding);
  }
  return [...store.values()].sort((left, right) => {
    const leftKey = `${left.kind}:${left.label}`.toLowerCase();
    const rightKey = `${right.kind}:${right.label}`.toLowerCase();
    return leftKey.localeCompare(rightKey);
  });
}

function slugifySliceSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function classifySlice(title: string): { category: "phase" | "slice"; sortId: string } | null {
  const phaseMatch = title.match(/^Phase\s+(\d+)\s+[—-]\s+(.+)$/i);
  if (phaseMatch) {
    return { category: "phase", sortId: `phase-${phaseMatch[1]}` };
  }
  const numericSliceMatch = title.match(/^Slice\s+(\d+)[.:]?\s*(.*)$/i);
  if (numericSliceMatch) {
    const ordinal = numericSliceMatch[1].toLowerCase();
    const titleSlug = slugifySliceSegment(numericSliceMatch[2] ?? "");
    return { category: "slice", sortId: titleSlug ? `slice-${ordinal}-${titleSlug}` : `slice-${ordinal}` };
  }
  const letterSliceMatch = title.match(/^Slice\s+([A-Z])(?:[.:]|\s+[—-])\s*(.*)$/i);
  if (letterSliceMatch) {
    const ordinal = letterSliceMatch[1].toLowerCase();
    const titleSlug = slugifySliceSegment(letterSliceMatch[2] ?? "");
    return { category: "slice", sortId: titleSlug ? `slice-${ordinal}-${titleSlug}` : `slice-${ordinal}` };
  }
  return null;
}

function phaseNumber(title: string): number | null {
  const match = title.match(/^Phase\s+(\d+)\b/i);
  return match ? Number.parseInt(match[1], 10) : null;
}

function derivePhaseStatus(title: string, activePhase: string | null): string | null {
  if (!activePhase) return null;
  if (title === activePhase) return "active";
  const current = phaseNumber(activePhase);
  const candidate = phaseNumber(title);
  if (current == null || candidate == null) return null;
  if (candidate < current) return "completed";
  if (candidate > current) return "pending";
  return null;
}

function extractInlineStatus(section: string): string | null {
  const backtick = section.match(/^-\s*status:\s*`([^`]+)`$/im);
  if (backtick?.[1]) return backtick[1].trim();
  const plain = section.match(/^-\s*status:\s*([^\n]+)$/im);
  return plain?.[1]?.trim() ?? null;
}

function extractSlices(
  markdown: string,
  headings: ArchitectHeading[],
  activePhase: string | null,
  catalog: GraphCatalogEntry[],
): ArchitectPlanSlice[] {
  const slices: ArchitectPlanSlice[] = [];
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const classification = classifySlice(heading.title);
    if (!classification) continue;
    const section = sectionBody(markdown, headings, index);
    const adrBindings = extractAdrBindings(section, { attributes: {} });
    const graphBindings = collectGraphBindings(section, adrBindings, catalog);
    slices.push({
      id: parseFirstMatch(section, /^-\s*(?:id|slice-id):\s*`?([A-Za-z0-9_.-]+)`?\s*$/im) ?? classification.sortId,
      title: heading.title,
      category: classification.category,
      heading_path: heading.path,
      source_offset: heading.startIndex,
      status:
        classification.category === "phase"
          ? derivePhaseStatus(heading.title, activePhase)
          : extractInlineStatus(section),
      adr_bindings: adrBindings,
      graph_bindings: graphBindings,
      depends_on: (parseFirstMatch(section, /^-\s*Depends on:\s*(.+)$/im) ?? "").split(/,\s*/).map(value => value.trim()).filter(Boolean),
      priority: Number(parseFirstMatch(section, /^-\s*Priority:\s*P?(\d+)$/im) ?? "1"),
      acceptance_hash: approvalHash(section.replace(/^\s*-\s*(?:status|id|slice-id|depends on|priority):.*$/gim, "").replace(/\s+/g, " ").trim()),
    });
  }
  return slices;
}

function extractCheckpoints(logMarkdown: string | null): ArchitectPlanCheckpoint[] {
  if (!logMarkdown) return [];
  const checkpoints: ArchitectPlanCheckpoint[] = [];
  const pattern = /^###\s+(.+?)\s+[—-]\s+slice:\s+(.+?)\s+[—-]\s+status:\s+(.+)$/gm;
  const matches = Array.from(logMarkdown.matchAll(pattern));
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const timestamp = match[1].trim();
    const sliceId = match[2].trim();
    const status = match[3].trim();
    const nextIndex = matches[index + 1]?.index ?? logMarkdown.length;
    const block = logMarkdown.slice(match.index ?? 0, nextIndex);
    checkpoints.push({
      id: `${sliceId}@${timestamp}`,
      timestamp,
      slice_id: sliceId,
      status,
      label: `${sliceId} — ${status}`,
      resume_note: parseFirstMatch(block, /^- Resume note:\s*(.+)$/m),
      body: block,
    });
  }
  return checkpoints.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

function sliceRef(slice: ArchitectPlanSlice | null | undefined): ArchitectPlanSliceRef | null {
  return slice ? { id: slice.id, title: slice.title, status: slice.status } : null;
}
function deriveProjectedPlanStatus(_rawStatus: string | null, lifecycle: ArchitectPlanLifecycle): string { return lifecycle; }

function buildEvidenceLinks(
  planPath: string,
  logPath: string | null,
  headings: ArchitectHeading[],
  graphBindings: ArchitectSemanticAnchor[],
): ArchitectEvidenceLink[] {
  const links: ArchitectEvidenceLink[] = [
    {
      kind: "file",
      label: "Plan markdown",
      target: planPath,
      hint: "durable source of truth",
    },
  ];

  if (logPath) {
    links.push({
      kind: "file",
      label: "Implementation log",
      target: logPath,
      hint: "append-only resume ledger",
    });
  }

  for (const heading of headings.slice(0, 10)) {
    links.push({
      kind: "heading",
      label: heading.title,
      target: heading.path,
      hint: "semantic chapter anchor",
    });
  }

  for (const binding of graphBindings.slice(0, 12)) {
    if (binding.kind === "resource") {
      links.push({ kind: "resource", label: binding.label, target: binding.id, hint: "graph resource anchor" });
      continue;
    }
    if (binding.kind === "api_route") {
      links.push({ kind: "route", label: binding.label, target: binding.id, hint: "daemon route anchor" });
      continue;
    }
    if (binding.kind === "tool") {
      links.push({ kind: "tool", label: binding.label, target: binding.id, hint: "tool authority anchor" });
    }
  }

  const unique = new Map<string, ArchitectEvidenceLink>();
  for (const link of links) {
    unique.set(`${link.kind}:${link.target}`, link);
  }
  return [...unique.values()];
}

interface ProjectPlanOptions {
  id?: string;
  path?: string;
  logFileName?: string | null;
  logPath?: string | null;
  summaryOnly?: boolean;
}

function definitionFromSlices(scope: Awaited<ReturnType<typeof getPlanAuthorityScope>>, markdown: string, logMarkdown: string | null,
  title: string, phase: string | null, slices: ArchitectPlanSlice[], prior?: PlanWorkflowState): PlanDefinition {
  // Ordinals are identity hints only. They never imply state or completion.
  const implemented = slices.filter(slice => slice.category === "slice");
  for (const slice of implemented) {
    if (!prior || prior.definition.slices.some(entry => entry.id === slice.id)) continue;
    const ordinal = slice.id.match(/^slice-([a-z0-9]+)(?:-|$)/i)?.[1];
    const candidates = prior.definition.slices.filter(entry => entry.id.match(/^slice-([a-z0-9]+)(?:-|$)/i)?.[1] === ordinal);
    if (ordinal && candidates.length === 1 && implemented.filter(entry => entry.id.match(/^slice-([a-z0-9]+)(?:-|$)/i)?.[1] === ordinal).length === 1) slice.id = candidates[0].id;
  }
  const resolveDependency = (raw: string) => {
    const clean = raw.replace(/`/g, "").trim();
    const exact = implemented.filter(slice => slice.id === clean);
    if (exact.length === 1) return exact[0].id;
    const ordinal = /^Slice\s+([A-Za-z0-9]+)$/i.exec(clean)?.[1]?.toLowerCase();
    const matches = ordinal ? implemented.filter(slice => slice.id.match(/^slice-([a-z0-9]+)(?:-|$)/i)?.[1] === ordinal) : [];
    return matches.length === 1 ? matches[0].id : `unresolved:${clean}`;
  };
  const definition: PlanDefinition = { ...scope, revision: prior?.definition.revision ?? 1, definition_hash: "pending", source_hash: bytesHash(markdown),
    log_hash: logMarkdown === null ? null : bytesHash(logMarkdown), title, phase,
    slices: implemented.map((slice, order) => ({ id: slice.id, title: slice.title, order, priority: slice.priority ?? 1, required: true,
      depends_on: (slice.depends_on ?? []).map(resolveDependency), acceptance_hash: slice.acceptance_hash ?? approvalHash(slice.heading_path) })) };
  definition.definition_hash = planDefinitionDigest(definition); return definition;
}
function operationalFromAuthority(view: ReturnType<typeof projectPlanState>, slices: ArchitectPlanSlice[], checkpoints: ArchitectPlanCheckpoint[],
  source: "typed_plan_authority" | "legacy_review_projection", phase: string | null, unknownLegacy: number): ArchitectOperationalPlanState {
  const { state } = view, byId = new Map(slices.map(slice => [slice.id, slice]));
  const ref = (id: string | null) => {
    if (!id) return null;
    const visible = sliceRef(byId.get(id)); if (visible) return visible;
    const def = state.definition.slices.find(s => s.id === id), row = state.slices.find(s => s.id === id);
    return def && row ? { id, title: def.title, status: row.status } : null;
  };
  const current = ref(view.current_slice_id), running = ref(view.running_slice_id), next = ref(view.next_slice?.id ?? null), last = ref(state.last_verified_slice_id);
  const verified = state.slices.filter(slice => slice.status === "verified" && slice.verification?.fresh).map(slice => slice.id);
  const binding = state.reconciliation.state === "recovery_required" ? "recovery_required" : source === "typed_plan_authority" ? "governed" : "review_required";
  const execution = view.execution === "running" ? "running" : view.execution === "recovery_required" ? "recovery_required" : state.lifecycle === "completed" ? "complete" : "idle";
  const resume = view.resume_action.replace(/_/g, " ");
  return { source, revision: state.revision, definition_hash: state.definition_hash, current_slice_ids: state.current_slice_ids, running_slice_ids: state.running_slice_ids,
    verified_slice_ids: verified, next_eligibility: view.next_slice ? { can_start: view.next_slice.can_start, reasons: view.next_slice.reasons } : null,
    resume_action: view.resume_action, reconciliation: state.reconciliation, progress: { ...view.progress, unknown_legacy: unknownLegacy },
    phase, active_phase: phase, current_slice_id: current?.id ?? null, current_slice_title: current?.title ?? null, current_status: current?.status ?? null,
    plan_lifecycle: state.lifecycle, execution_state: execution, partial: view.execution === "recovery_required", active_slice: running,
    last_completed_slice: last, next_slice: next, last_checkpoint_at: source === "typed_plan_authority" ? state.updated_at : null,
    checkpoint_count: checkpoints.length, verified_checkpoint_count: verified.length, completed_checkpoint_count: verified.length, resume_hint: resume,
    task_memory_binding: { authority: "dreamgraph", source, binding_status: binding, plan_state_owner: "daemon", current_slice_id: current?.id ?? null,
      current_checkpoint_id: null, current_status: current?.status ?? null, last_event_at: source === "typed_plan_authority" ? state.updated_at : null,
      resume_hint: resume, plan_lifecycle: state.lifecycle, execution_state: execution, active_slice_id: running?.id ?? null,
      last_completed_slice_id: last?.id ?? null, next_slice_id: next?.id ?? null } };
}

/** A read-only compatibility view. Its claims never enter the reducer or authorize work. */
function applyLegacyProgress(op: ArchitectOperationalPlanState, slices: ArchitectPlanSlice[], checkpoints: ArchitectPlanCheckpoint[],
  rawStatus: string | null, definition: PlanDefinition): void {
  const rows = slices.filter(slice => slice.category === "slice");
  const normalize = (status: string | null) => status?.trim().toLowerCase().replace(/[ -]+/g, "_") ?? "pending";
  const completed = (slice: ArchitectPlanSlice) => ["verified", "completed", "complete", "done"].includes(normalize(slice.status));
  const current = (slice: ArchitectPlanSlice) => ["in_progress", "implementing", "implemented", "verifying", "blocked", "partial", "failed", "timed_out", "cancelled"].includes(normalize(slice.status));
  const resolveCheckpoint = (checkpoint: ArchitectPlanCheckpoint) => {
    const exact = rows.filter(slice => slice.id === checkpoint.slice_id || slice.title === checkpoint.slice_id);
    if (exact.length === 1) return exact[0];
    const ordinal = /^Slice\s+([A-Za-z0-9]+)$/i.exec(checkpoint.slice_id)?.[1]?.toLowerCase();
    const matches = ordinal ? rows.filter(slice => slice.id.match(/^slice-([a-z0-9]+)(?:-|$)/i)?.[1] === ordinal) : [];
    return matches.length === 1 ? matches[0] : null;
  };
  for (const slice of rows) {
    slice.raw_status = slice.status; slice.status_source = "markdown"; slice.running = false; slice.verification_fresh = false;
    // Explicit definition statuses win over historical log entries. Never infer ranges or prose success.
    if (slice.status == null) {
      const checkpoint = [...checkpoints].reverse().find(entry => Number.isFinite(Date.parse(entry.timestamp)) && resolveCheckpoint(entry) === slice
        && ["pending", "in_progress", "implemented", "verifying", "verified", "completed", "blocked", "deferred", "failed", "partial", "cancelled", "timed_out"].includes(normalize(entry.status)));
      if (checkpoint) { slice.status = checkpoint.status.trim(); slice.status_source = "implementation_log"; }
    }
    slice.status = normalize(slice.status);
  }
  const byId = new Map(rows.map(slice => [slice.id, slice]));
  const currentRows = rows.filter(current), completedRows = rows.filter(completed);
  const dated = checkpoints.filter(entry => Number.isFinite(Date.parse(entry.timestamp)));
  const latestCurrent = [...dated].reverse().map(resolveCheckpoint).find(slice => slice && current(slice));
  const currentRow = currentRows.length === 1 ? currentRows[0] : latestCurrent ?? null;
  const last = [...dated].reverse().map(resolveCheckpoint).find(slice => slice && completed(slice)) ?? completedRows.at(-1) ?? null;
  const pending = [...definition.slices].sort((a, b) => a.priority - b.priority || a.order - b.order || a.id.localeCompare(b.id))
    .filter(def => normalize(byId.get(def.id)?.status ?? null) === "pending");
  const dependenciesResolved = (def: PlanDefinition["slices"][number]) => def.depends_on.every(id => byId.has(id) && completed(byId.get(id)!));
  const next = pending.find(dependenciesResolved) ?? pending[0];
  const reported = normalize(rawStatus);
  const lifecycle: ArchitectPlanLifecycle = ["draft", "planning", "reviewed", "implementation_ready", "implementing", "verifying", "blocked", "completed", "archived", "superseded"].includes(reported)
    ? reported as ArchitectPlanLifecycle : currentRows.length || completedRows.length ? "implementing" : "draft";
  op.current_slice_ids = currentRows.map(slice => slice.id); op.running_slice_ids = []; op.verified_slice_ids = [];
  op.current_slice_id = currentRow?.id ?? null; op.current_slice_title = currentRow?.title ?? null; op.current_status = currentRow?.status ?? null;
  op.plan_lifecycle = lifecycle; op.active_slice = null; op.last_completed_slice = sliceRef(last); op.next_slice = sliceRef(next ? byId.get(next.id) : null);
  op.next_eligibility = next ? { can_start: false, reasons: ["legacy_progress_requires_review", "awaiting_implementation_approval",
    ...next.depends_on.filter(id => !byId.has(id) || !completed(byId.get(id)!)).map(id => `dependency_unresolved:${id}`)] } : null;
  op.reported_progress = { required: rows.length, completed: completedRows.length, verified: rows.filter(slice => slice.status === "verified").length,
    implemented: rows.filter(slice => ["implemented", "verifying"].includes(normalize(slice.status))).length,
    current: currentRows.length, blocked: rows.filter(slice => slice.status === "blocked").length, deferred: rows.filter(slice => slice.status === "deferred").length };
  // The original resume note remains available in resume_state. It cannot direct
  // governed work until the recorded progress has been reviewed and imported.
  op.resume_action = "review_legacy_progress"; op.resume_hint = "Review recorded progress before importing governed lifecycle state";
  op.last_checkpoint_at = dated.at(-1)?.timestamp ?? null;
  op.task_memory_binding = { ...op.task_memory_binding, current_slice_id: op.current_slice_id, current_status: op.current_status,
    current_checkpoint_id: dated.at(-1)?.id ?? null, last_event_at: op.last_checkpoint_at, resume_hint: op.resume_hint,
    plan_lifecycle: lifecycle, active_slice_id: null, last_completed_slice_id: last?.id ?? null, next_slice_id: op.next_slice?.id ?? null };
}

async function projectPlan(fileName: string, options?: ProjectPlanOptions): Promise<ArchitectPlanDetail> {
  const plansRoot = getArchitectPlansRoot();
  const planPath = resolve(plansRoot, fileName);
  const markdown = await readFile(planPath, "utf-8");
  const fileStat = await stat(planPath);
  const id = options?.id ?? basename(fileName, ".md");
  const logFileName = options?.logFileName === undefined ? `${id}.implementation-log.md` : options.logFileName;
  const logPath = logFileName == null ? null : resolve(plansRoot, logFileName);
  const logMarkdown = logPath == null ? null : await loadOptionalFile(logPath);
  const frontmatter = parseFrontmatter(markdown);
  const headings = parseHeadings(markdown);
  const title = parseFirstMatch(markdown, /^#\s+(.+)$/m) ?? id;
  const rawStatus =
    (typeof frontmatter.attributes.status === "string" ? frontmatter.attributes.status : null) ??
    parseFirstMatch(markdown, /^- Status:\s+`([^`]+)`$/m) ??
    parseFirstMatch(markdown, /^Status:\s+([^\n]+)$/m);
  const activePhase = parseFirstMatch(markdown, /^- Active phase:\s+`([^`]+)`$/m);
  const adrBindings = extractAdrBindings(markdown, frontmatter);
  const catalog = await loadGraphCatalog();
  const graphBindings = collectGraphBindings(markdown, adrBindings, catalog);
  // The rail needs lifecycle/counts, not per-slice graph-anchor scans. Those
  // belong to the selected detail and do not participate in the C14 definition.
  const slices = extractSlices(markdown, headings, activePhase, options?.summaryOnly ? [] : catalog);
  const checkpoints = extractCheckpoints(logMarkdown);
  const path = options?.path ?? `plans/${fileName}`;
  const logPathRelative = logMarkdown == null ? null : (options?.logPath ?? (logFileName == null ? null : `plans/${logFileName}`));
  const resumeState = {
    last_log_heading: logMarkdown == null ? null : extractLastLogHeading(logMarkdown),
    last_resume_note: logMarkdown == null ? null : extractLastResumeNote(logMarkdown),
    log_excerpt: logMarkdown == null ? null : extractLogExcerpt(logMarkdown),
  };
  const authorityScope = await getPlanAuthorityScope(id);
  let authority: Awaited<ReturnType<typeof readPlanAuthority>> = null, authorityFailure: string | null = null;
  try { authority = await readPlanAuthority(authorityScope); } catch (failure) { authorityFailure = failure instanceof Error ? failure.message : "Plan authority unavailable"; }
  let definition: PlanDefinition;
  try {
    definition = definitionFromSlices(authorityScope, markdown, logMarkdown, title, activePhase, slices, authority?.state);
    initialPlanState(definition, fileStat.mtime.toISOString());
  } catch (error) {
    authorityFailure = `Plan definition requires review: ${String(error instanceof Error ? error.message : error)}`;
    definition = authority?.state.definition ?? definitionFromSlices(authorityScope, markdown, logMarkdown, title, activePhase, [], undefined);
  }
  const workflow = authority ? structuredClone(authority.state) : initialPlanState(definition, fileStat.mtime.toISOString());
  const unknownLegacy = checkpoints.length + slices.filter(slice => slice.category === "slice" && slice.status && slice.status !== "pending").length;
  if (!authority) {
    workflow.reconciliation = { state: unknownLegacy || rawStatus && !["draft", "planning"].includes(rawStatus) ? "legacy_review_required" : "current",
      reasons: unknownLegacy ? ["Legacy statuses and audit/prose checkpoints are not typed verification evidence"] : [] };
    workflow.lifecycle = rawStatus === "planning" ? "planning" : "draft";
  } else if (authority.state.definition_hash !== definition.definition_hash) {
    workflow.reconciliation = { state: "definition_changed", reasons: ["External definition changes require a content-bound reconciliation preview"] };
  }
  if (authorityFailure) workflow.reconciliation = { state: "recovery_required", reasons: [authorityFailure] };
  const workflowSlices = new Map(workflow.slices.map(slice => [slice.id, slice]));
  for (const slice of slices.filter(slice => authority && slice.category === "slice")) {
    const record = workflowSlices.get(slice.id); slice.raw_status = slice.status; slice.status = record?.status ?? "pending";
    slice.status_source = "typed_plan_authority";
    slice.running = workflow.running_slice_ids.includes(slice.id); slice.verification_fresh = record?.verification?.fresh === true;
  }
  const operationalState = operationalFromAuthority(projectPlanState(workflow, new Date().toISOString()), slices, checkpoints,
    authority ? "typed_plan_authority" : "legacy_review_projection", activePhase, authority ? 0 : unknownLegacy);
  if (!authority) applyLegacyProgress(operationalState, slices, checkpoints, rawStatus, definition);
  const livingState = buildLivingPlanState({ markdown, headings, checkpoints, graphBindings, adrBindings, operationalState });
  const status = deriveProjectedPlanStatus(rawStatus, operationalState.plan_lifecycle);

  return {
    id,
    title,
    path,
    log_path: logPathRelative,
    status,
    active_phase: activePhase,
    updated_at: fileStat.mtime.toISOString(),
    adr_bindings: adrBindings,
    graph_binding_count: graphBindings.length,
    slice_count: slices.length,
    checkpoint_count: checkpoints.length,
    operational_state: operationalState,
    markdown,
    headings: headings.map((heading) => ({ level: heading.level, title: heading.title, path: heading.path })),
    resume_state: resumeState,
    living_state: livingState,
    registry: {
      source: "markdown_projection",
      summary: {
        heading_count: headings.length,
        adr_binding_count: adrBindings.length,
        graph_binding_count: graphBindings.length,
        slice_count: slices.length,
        checkpoint_count: checkpoints.length,
      },
      adr_bindings: adrBindings,
      graph_bindings: graphBindings,
      slices,
      checkpoints,
      operational_state: operationalState,
      evidence_links: buildEvidenceLinks(path, logPathRelative, headings, graphBindings),
    },
  };
}

function isSafePlanId(planId: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(planId) && !planId.endsWith(".implementation-log");
}

export async function listPlanFiles(): Promise<string[]> {
  let entries: Array<{ isFile(): boolean; name: string }>;
  try {
    entries = await readdir(getArchitectPlansRoot(), { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.endsWith(".md") && !name.endsWith(".implementation-log.md"))
    .sort((left, right) => left.localeCompare(right));
}

export async function buildPlanSummary(fileName: string): Promise<ArchitectPlanSummary> {
  const detail = await projectPlan(fileName, {summaryOnly:true});
  return {
    id: detail.id,
    title: detail.title,
    path: detail.path,
    log_path: detail.log_path,
    status: detail.status,
    active_phase: detail.active_phase,
    updated_at: detail.updated_at,
    adr_bindings: detail.adr_bindings,
    graph_binding_count: detail.graph_binding_count,
    slice_count: detail.slice_count,
    checkpoint_count: detail.checkpoint_count,
    operational_state: detail.operational_state,
  };
}

async function resolveArchivedPlanSnapshot(planId: string): Promise<{
  fileName: string;
  path: string;
  logFileName: string | null;
  logPath: string | null;
} | null> {
  const archiveRoot = resolve(getArchitectPlansRoot(), "archive");
  let entries: Array<{ isFile(): boolean; name: string }>;
  try {
    entries = await readdir(archiveRoot, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw error;
  }

  const prefix = `${planId}.`;
  const planFile = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".md") && !name.endsWith(".implementation-log.md"))
    .sort((left, right) => right.localeCompare(left))[0];
  if (!planFile) return null;

  const snapshotId = basename(planFile, ".md");
  const logFileName = entries.some((entry) => entry.isFile() && entry.name === `${snapshotId}.implementation-log.md`)
    ? `archive/${snapshotId}.implementation-log.md`
    : null;
  return {
    fileName: `archive/${planFile}`,
    path: `plans/archive/${planFile}`,
    logFileName,
    logPath: logFileName == null ? null : `plans/${logFileName}`,
  };
}

export async function loadPlanDetail(planId: string): Promise<ArchitectPlanDetail | null> {
  if (!isSafePlanId(planId)) return null;
  try {
    return await projectPlan(`${planId}.md`);
  } catch {
    const archived = await resolveArchivedPlanSnapshot(planId);
    if (!archived) return null;
    try {
      return await projectPlan(archived.fileName, {
        id: planId,
        path: archived.path,
        logFileName: archived.logFileName,
        logPath: archived.logPath,
      });
    } catch {
      return null;
    }
  }
}

function compactAuditValue(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  return normalized.length > 0 ? normalized.replace(/`/g, "'") : null;
}

function auditLine(label: string, value: string | null | undefined): string | null {
  const compact = compactAuditValue(value);
  return compact == null ? null : `- ${label}: ${compact}`;
}

function buildPlanActionLogEntry(
  planId: string,
  timestamp: string,
  input: ArchitectPlanActionAuditInput,
): string {
  const action = compactAuditValue(input.action) ?? "unspecified";
  const sliceId = compactAuditValue(input.slice_id) ?? "standalone-architect-project-bound-chat-shell";
  const explicitStatus = compactAuditValue(input.status);
  const status = explicitStatus ?? (input.kind === "review_gate" ? "review_gate_recorded" : "action_recorded");
  const chatPlanUpdate = input.kind === "plan_action" && action === "chat_plan_update";
  const architectPassCompletion = input.kind === "plan_action" && action === "architect_pass_completed";
  const lines = [
    `### ${timestamp} — slice: ${sliceId} — status: ${status}`,
    "",
    `- Plan id: \`${planId}\``,
    "- Actor/session id: `standalone-architect-browser`",
    `- Action: recorded daemon-governed ${input.kind.replace("_", " ")} through \`/api/architect/v1\` without exposing direct filesystem authority`,
    `- Request action: \`${action}\``,
    `- Audit reason: ${compactAuditValue(input.audit_reason) ?? "not supplied"}`,
    auditLine("Actor", input.actor),
    auditLine("Gate id", input.gate_id),
    auditLine("Decision", input.decision),
    auditLine("Evidence", input.evidence),
    auditLine("Content", input.content),
    chatPlanUpdate
      ? "- Tool groups used: `/api/architect/v1/chat`, selected-plan markdown update, implementation-log projection"
      : architectPassCompletion
        ? "- Tool groups used: `/api/architect/v1/chat`, continuation envelope parsing, implementation-log projection"
        : "- Tool groups used: `/api/architect/v1/plans/{planId}/actions`, `/api/architect/v1/plans/{planId}/review-gates`, implementation-log projection",
    chatPlanUpdate
      ? "- Result: selected plan markdown was updated by the daemon and the request was captured in the append-only implementation log"
      : architectPassCompletion
        ? "- Result: successful Architect pass was captured as a completed implementation checkpoint for cursor projection"
        : "- Result: request captured in the append-only implementation log; no source patch was applied by the browser endpoint",
    `- Resume note: ${compactAuditValue(input.resume_note) ?? "continue from the project-bound Architect browser surface with daemon-governed chat, plan, review, and scheduler controls"}`,
  ].filter((line): line is string => line != null);

  return `${lines.join("\n")}\n`;
}

export async function recordPlanActionAudit(
  planId: string,
  input: ArchitectPlanActionAuditInput,
): Promise<ArchitectPlanActionAuditResult | null> {
  const detail = await loadPlanDetail(planId);
  if (!detail) return null;

  const timestamp = new Date().toISOString();
  const logFileName = `${planId}.implementation-log.md`;
  const logPath = resolve(getArchitectPlansRoot(), logFileName);
  const auditId = `${input.kind}:${timestamp}`;
  await appendFile(logPath, `\n${buildPlanActionLogEntry(planId, timestamp, input)}`, "utf-8");

  return {
    plan_id: detail.id,
    plan_path: detail.path,
    log_path: `plans/${logFileName}`,
    status: "recorded",
    changed: true,
    audit_id: auditId,
    action_kind: input.kind,
    action: compactAuditValue(input.action) ?? "unspecified",
    audit_reason: compactAuditValue(input.audit_reason) ?? "not supplied",
    markdown_refs: [detail.path, `plans/${logFileName}`],
    graph_refs: detail.registry.graph_bindings.slice(0, 8).map((binding) => `${binding.kind}:${binding.id}`),
    warnings: [],
    next_actions: [
      "Refresh the plan detail snapshot before presenting follow-up review controls.",
      "Require a separate governed endpoint before applying any source patch or graph mutation.",
    ],
  };
}

/** Content-bound preview; reading a legacy plan never writes status or imports claims. */
export async function previewArchitectPlanAuthority(planId: string) {
  if (!isSafePlanId(planId)) throw new Error("PLAN_ID_INVALID");
  const scope = await getPlanAuthorityScope(planId), path = resolve(getArchitectPlansRoot(), `${planId}.md`);
  const markdown = await readFile(path, "utf8"), logPath = resolve(getArchitectPlansRoot(), `${planId}.implementation-log.md`);
  const log_markdown = await loadOptionalFile(logPath), headings = parseHeadings(markdown);
  const title = parseFirstMatch(markdown, /^#\s+(.+)$/m) ?? planId;
  const phase = parseFirstMatch(markdown, /^- Active phase:\s+`([^`]+)`$/m);
  const slices = extractSlices(markdown, headings, phase, []), current = await readPlanAuthority(scope);
  const definition = definitionFromSlices(scope, markdown, log_markdown, title, phase, slices, current?.state);
  definition.revision = current ? current.state.definition.revision + 1 : 1;
  initialPlanState(definition, new Date().toISOString()); // rejects duplicate/malformed identities
  const old = current?.state.definition;
  const carry_forward_slice_ids = definition.slices.filter(fresh => old?.slices.some(prior => prior.id === fresh.id
    && prior.acceptance_hash === fresh.acceptance_hash && approvalHash([...prior.depends_on].sort()) === approvalHash([...fresh.depends_on].sort()))).map(s => s.id);
  const unknown_legacy = extractCheckpoints(log_markdown).length + slices.filter(s => s.status && s.status !== "pending").length;
  const preview_hash = approvalHash({ definition, revision: current?.state.revision ?? null, carry_forward_slice_ids });
  return { scope, definition, markdown, log_markdown, preview_hash, carry_forward_slice_ids,
    existing_revision: current?.state.revision ?? null, unknown_legacy, imported_completion_claims: 0 as const,
    state: current?.state ?? initialPlanState(definition, new Date().toISOString()) };
}
/** Resolve the explicit task against this daemon's original physical project, never a caller's path. */
export async function captureArchitectPlanRuntimeSource(intent: PlanExecutionIntent, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const preview = await previewArchitectPlanAuthority(intent.scope.id);
  if (approvalHash(preview.scope) !== approvalHash(intent.scope)) throw new Error("PLAN_RUNTIME_PROJECT_SCOPE_REJECTED");
  if (preview.existing_revision !== intent.expected_revision || preview.state.definition_hash !== intent.expected_definition_hash)
    throw new Error("PLAN_STATE_REVISION_CONFLICT");
  if (preview.definition.definition_hash !== intent.expected_definition_hash) throw new Error("PLAN_DEFINITION_RECONCILIATION_REQUIRED");
  const root = await realpath(getArchitectPlansRoot()), requested = resolve(root, `${intent.scope.id}.md`), physical = await realpath(requested);
  const inside = relative(root, physical);
  if (!inside || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) throw new Error("PLAN_RUNTIME_SOURCE_SCOPE_REJECTED");
  const source = { path: requested, physical_path: physical, content_hash: preview.definition.source_hash };
  await checkPlanRuntimeSource(source, signal); return source;
}
export async function reviewArchitectPlanDefinition(input: { plan_id: string; operation_id: string; preview_hash: string; review_id: string;
  actor: import("../discipline/plan-workflow.js").PlanActor }) {
  const request_reference = approvalHash(input);
  const replay = await replayPlanRequest(input.actor, input.operation_id, request_reference); if (replay) return replay;
  const preview = await previewArchitectPlanAuthority(input.plan_id);
  if (input.preview_hash !== preview.preview_hash) throw new Error("PLAN_IMPORT_PREVIEW_CONFLICT");
  const check_sources = async () => {
    const current = await readFile(resolve(getArchitectPlansRoot(), `${input.plan_id}.md`), "utf8");
    const log = await loadOptionalFile(resolve(getArchitectPlansRoot(), `${input.plan_id}.implementation-log.md`));
    if (bytesHash(current) !== preview.definition.source_hash || (log === null ? null : bytesHash(log)) !== preview.definition.log_hash) throw new Error("PLAN_IMPORT_PREVIEW_CONFLICT");
  };
  if (preview.existing_revision === null) return importPlanAuthority({ actor: input.actor, definition: preview.definition, markdown: preview.markdown,
    log_markdown: preview.log_markdown, operation_id: input.operation_id, review_id: input.review_id, request_reference, check_sources });
  return applyPlanCommand({ actor: input.actor, plan_id: input.plan_id, operation_id: input.operation_id,
    expected_revision: preview.state.revision, expected_definition_hash: preview.state.definition_hash, request_reference, check_sources,
    definition_backup: { markdown: preview.markdown, log_markdown: preview.log_markdown },
    command: { type: "reconcile_definition", definition: preview.definition, review_id: input.review_id,
      carry_forward_slice_ids: preview.carry_forward_slice_ids, source_hash: preview.definition.source_hash, log_hash: preview.definition.log_hash } });
}
export async function executeArchitectPlanCommand(input: { plan_id: string; operation_id: string; expected_revision: number; expected_definition_hash: string;
  command: unknown; actor: import("../discipline/plan-workflow.js").PlanActor }) {
  let preview: Awaited<ReturnType<typeof previewArchitectPlanAuthority>> | undefined;
  const check_sources = async () => {
    if (!preview) {
      preview = await previewArchitectPlanAuthority(input.plan_id);
      if (preview.existing_revision === null) throw new Error("PLAN_NOT_IMPORTED");
      if (preview.definition.definition_hash !== preview.state.definition_hash) throw new Error("PLAN_DEFINITION_RECONCILIATION_REQUIRED");
    }
    const current = await readFile(resolve(getArchitectPlansRoot(), `${input.plan_id}.md`), "utf8");
    if (bytesHash(current) !== preview.definition.source_hash) throw new Error("PLAN_IMPORT_PREVIEW_CONFLICT");
  };
  return applyPlanCommand({ ...input, check_sources });
}
