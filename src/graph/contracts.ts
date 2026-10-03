/** Canonical Ashoka semantic contracts. SDK copies are generated, never edited. */
import { z } from "zod";

export const CONTRACT_FAMILY_VERSION = 1;
const id = z.string().min(1).max(1024);
const utc = z.string().datetime({ offset: true });
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const GraphKindSchema = z.enum([
  "feature", "workflow", "data_model", "capability", "datastore", "ui_element",
  "auxiliary", "dream_node", "candidate", "validated", "tension", "adr",
  "temporal", "causal", "narrative", "plan", "slice",
]);
export const GraphIdentitySchema = z.object({
  instance_id: id, kind: GraphKindSchema, repository_id: id.optional(), id,
}).strict();
export type GraphIdentity = z.infer<typeof GraphIdentitySchema>;

export const EvidenceReferenceSchema = z.object({
  id, origin: z.enum(["source", "human", "model", "validation", "imported", "derived"]),
  ancestry: z.array(id), revision: id.nullable(), observed_at: utc.nullable(),
  source_repo: id.optional(), source_path: id.optional(), content_hash: id.optional(),
  semantic_anchor: id.optional(), operation_id: id.optional(),
  validation: z.enum(["unreviewed", "hypothesis", "disputed", "validated", "rejected", "withdrawn"]),
}).strict();
export type EvidenceReference = z.infer<typeof EvidenceReferenceSchema>;

export const AssertionClassSchema = z.enum([
  "source_assertion", "human_assertion", "hypothesis", "validated_insight",
  "tension", "decision", "historical", "unknown",
]);
export const GraphEntitySchema = z.object({
  identity: GraphIdentitySchema, label: z.string(), assertion_class: AssertionClassSchema,
  confidence: z.number().min(0).max(1).nullable(), evidence: z.array(EvidenceReferenceSchema),
  payload: z.record(z.unknown()),
}).strict();
export type GraphEntity = z.infer<typeof GraphEntitySchema>;
export const GraphRelationshipSchema = z.object({
  id, kind: z.enum(["fact", "dream", "candidate", "validated", "tension"]),
  source: GraphIdentitySchema.nullable(), target: GraphIdentitySchema.nullable(),
  source_ref: id, target_ref: id, relation: z.string(),
  assertion_class: AssertionClassSchema, confidence: z.number().min(0).max(1).nullable(),
  evidence: z.array(EvidenceReferenceSchema), payload: z.record(z.unknown()),
}).strict();
export type GraphRelationship = z.infer<typeof GraphRelationshipSchema>;

export const GraphCurrencySchema = z.object({
  last_graph_mutation_at: utc.nullable(),
  last_full_scan_at: utc.nullable(),
  last_source_reconciliation_at: utc.nullable(),
  source_reconciliation_scope: z.array(id),
  source_reconciliation_revision: id.nullable(),
}).strict();
export type GraphCurrency = z.infer<typeof GraphCurrencySchema>;

export const RevisionVectorSchema = z.object({
  publication_sequence: count,
  graph_revision: id.nullable(),
  domains: z.record(id, count),
}).strict();
export type RevisionVector = z.infer<typeof RevisionVectorSchema>;

export const ResultStateSchema = z.object({
  availability: z.enum(["available", "unavailable"]),
  completeness: z.enum(["complete", "partial", "unknown"]),
  freshness: z.enum(["current", "stale", "unknown"]),
  reasons: z.array(z.object({ code: id, scope: z.array(id), detail: z.string() }).strict()),
}).strict();
export type ResultState = z.infer<typeof ResultStateSchema>;

export const GraphEnvelopeSchema = z.object({
  schema: z.literal("dreamgraph.graph_result.v1"), instance_id: id,
  revision: RevisionVectorSchema, currency: GraphCurrencySchema,
  state: ResultStateSchema, records: z.array(z.unknown()),
  scope: z.array(id), count: count.nullable(), total: count.nullable(),
  continuation: z.string().nullable(), generated_at: utc,
}).strict();
export type GraphEnvelope = z.infer<typeof GraphEnvelopeSchema>;

export const ResourcePageSchema = GraphEnvelopeSchema.extend({
  schema: z.literal("dreamgraph.resource_result.v1"), uri: id,
  content_revision: id, page_start: count, omitted_count: count.nullable(),
  representation: z.enum(["canonical", "resource"]),
}).strict();
export type ResourcePage = z.infer<typeof ResourcePageSchema>;

export const OperationReceiptSchema = z.object({
  schema: z.literal("dreamgraph.operation_receipt.v1"),
  operation_id: id, epoch: id, payload_digest: id, actor: id, scope: z.array(id),
  transaction_id: id, revision: RevisionVectorSchema,
  committed_at: utc, affected_files: z.array(id),
  outcome: z.enum(["committed", "no_change"]), currency: GraphCurrencySchema,
  result: z.record(z.unknown()).optional(),
}).strict();
export type OperationReceipt = z.infer<typeof OperationReceiptSchema>;

export const JobStateSchema = z.enum([
  "accepted", "queued", "blocked", "running", "cancelling", "cancelled",
  "partial", "succeeded", "failed", "recovery_required",
]);
export const JobSchema = z.object({
  schema: z.literal("dreamgraph.job.v1"), id, operation_id: id, instance_id: id,
  owner: id, session_id: id.nullable(), execution_id: id.nullable(),
  state: JobStateSchema, fence: count, config_revision: id,
  input_revision: RevisionVectorSchema, scope: z.array(id),
  lifetime: z.enum(["daemon_durable", "session_bound"]),
  created_at: utc, updated_at: utc, cancel_requested_at: utc.nullable(),
  terminal_cause: id.nullable(), receipt_ids: z.array(id), unknown_effects: z.array(id),
}).strict();
export type CanonicalJob = z.infer<typeof JobSchema>;

export const BudgetSchema = z.object({
  requests: count, input_tokens: count, output_tokens: count, reasoning_tokens: count.default(100_000), retries: count,
  elapsed_ms: count, concurrency: count, max_hops: count, max_neighbors: count,
  run_amount: z.number().nonnegative().finite(), day_amount: z.number().nonnegative().finite(),
  currency: id, pricing_version: id.nullable(), billing_principal: id,
}).strict();
export type ResourceBudget = z.infer<typeof BudgetSchema>;

export const AuthorityGrantSchema = z.object({
  schema: z.literal("dreamgraph.authority_grant.v1"), id, instance_id: id,
  session_id: id.nullable(), execution_id: id.nullable(), actor: id,
  mode: z.enum(["scoped", "full_access"]), scope: z.array(id), capabilities: z.array(id),
  issued_at: utc, expires_at: utc, revoked_at: utc.nullable(),
  confirmations: z.array(z.object({ id, actor: id, confirmed_at: utc, scope_digest: id }).strict()),
}).strict();
export const ConfigSnapshotSchema = z.object({
  schema: z.literal("dreamgraph.config_snapshot.v1"), instance_id: id, revision: id,
  values: z.record(z.unknown()), origins: z.record(z.enum(["deployment", "instance", "default", "session"])),
  diagnostics: z.array(z.object({ field: id, code: id, message: z.string() }).strict()),
  captured_at: utc,
}).strict();
export const CommandTargetSchema = z.object({
  instance_id: id, kind: z.enum(["plan", "slice", "nervous_point", "schedule", "adr", "graph_entity"]),
  id, parent_id: id.nullable(), expected_revision: id, definition_hash: id.nullable(),
}).strict();
export const CommandAvailabilitySchema = z.object({
  id, target: CommandTargetSchema, effect: z.enum(["view", "mutation"]), available: z.boolean(),
  reasons: z.array(id), required_capabilities: z.array(id),
}).strict();

export const RolePolicySchema = z.object({
  schema: z.literal("dreamgraph.role_policy.v1"), id, revision: count,
  role: z.enum(["initial_scan", "enrichment", "dreamer", "normalizer", "architect", "computer_use"]),
  provider: id, model: id, adapter: id,
  api: z.enum(["responses", "chat_completions", "messages", "native_cli", "local"]),
  effort: id.nullable(), context_tokens: count, budget: BudgetSchema,
  retention: z.object({ requested: id, effective: id.nullable(), source: id }).strict(),
  fallbacks: z.array(z.object({ provider: id, model: id, adapter: id, approved: z.boolean() }).strict()),
}).strict();

export const PlanLifecycleSchema = z.enum([
  "draft", "reviewing", "approved", "implementing", "verifying", "completed",
  "blocked", "archived", "superseded",
]);
export const SliceStateSchema = z.enum([
  "pending", "ready", "assigned", "running", "implemented", "verifying",
  "verified", "blocked", "failed", "reopened", "deferred",
]);
export const PlanStateV1Schema = z.object({
  schema: z.literal("dreamgraph.plan_state.v1"), id, instance_id: id,
  revision: count, definition_hash: id, lifecycle: PlanLifecycleSchema,
  underlying_lifecycle: PlanLifecycleSchema.nullable(),
  current_slice_ids: z.array(id), running_slice_ids: z.array(id), next_slice_ids: z.array(id),
  last_verified_slice_id: id.nullable(),
  slices: z.array(z.object({
    id, status: SliceStateSchema, depends_on: z.array(id),
    evidence_ids: z.array(id), blockers: z.array(id),
  }).strict()), updated_at: utc,
}).strict();
/** C14: the legacy v1 record stays readable; new transitions use v2. */
export const PlanDefinitionSchema = z.object({
  id, instance_id: id, project_id: id, revision: count, definition_hash: id, source_hash: id, log_hash: id.nullable(),
  title: id, phase: id.nullable(),
  slices: z.array(z.object({ id, title: id, order: count, priority: count, depends_on: z.array(id), acceptance_hash: id, required: z.boolean() }).strict()).max(2000),
}).strict();
export const PlanWorkflowLifecycleSchema = z.enum(["draft", "planning", "reviewed", "implementation_ready", "implementing", "verifying", "blocked", "completed", "archived", "superseded"]);
export const PlanWorkflowSliceSchema = z.enum(["pending", "in_progress", "blocked", "implemented", "verifying", "verified", "deferred"]);
export const PlanStateV2Schema = z.object({
  schema: z.literal("dreamgraph.plan_state.v2"), id, instance_id: id, project_id: id,
  revision: count, event_sequence: count, definition_hash: id, definition: PlanDefinitionSchema,
  lifecycle: PlanWorkflowLifecycleSchema, underlying_lifecycle: PlanWorkflowLifecycleSchema.nullable(),
  primary_current_slice_id: id.nullable(), current_slice_ids: z.array(id), running_slice_ids: z.array(id), next_slice_ids: z.array(id),
  last_verified_slice_id: id.nullable(), plan_blockers: z.array(id), successor_id: id.nullable(),
  approval: z.object({ id, owner: id, definition_hash: id, scope: z.array(id), parallel_limit: count, approved_at: utc }).strict().nullable(),
  leases: z.array(z.object({ id, slice_id: id.nullable(), owner: id, execution_id: id, kind: z.enum(["implementation", "verification", "final_verification"]),
    expires_at: utc, state: z.enum(["running", "recovery_required"]), generation: count }).strict()),
  slices: z.array(z.object({ id, status: PlanWorkflowSliceSchema, prior_status: PlanWorkflowSliceSchema.nullable(), depends_on: z.array(id),
    evidence_ids: z.array(id), blockers: z.array(id), owner: id.nullable(),
    implementation_revision: count.nullable(), implementation_receipt_ids: z.array(id), effect_obligation_ids: z.array(id),
    required_stages: z.array(z.enum(["reconciliation", "enrichment", "digestion"])),
    verification: z.object({ acceptance_hash: id, implementation_revision: count, evidence_ids: z.array(id), review_id: id,
      sequence: count, fresh: z.boolean() }).strict().nullable(),
    deferral: z.object({ reason: id, owner: id, impact: id, review_id: id, dependency_waiver: z.boolean() }).strict().nullable(),
    last_attempt: z.object({ execution_id: id, outcome: z.enum(["paused", "cancelled", "failed", "timed_out", "completed", "recovery_required"]), reason: id }).strict().nullable(),
  }).strict()).max(2000),
  final_verification: z.object({ definition_hash: id, evidence_ids: z.array(id), review_id: id, sequence: count, passed: z.boolean() }).strict().nullable(),
  reconciliation: z.object({ state: z.enum(["current", "definition_changed", "legacy_review_required", "recovery_required"]), reasons: z.array(id) }).strict(),
  updated_at: utc,
}).strict();
export const PlanStateSchema = z.union([PlanStateV1Schema, PlanStateV2Schema]);
export type CanonicalPlanState = z.infer<typeof PlanStateSchema>;
export type PlanDefinition = z.infer<typeof PlanDefinitionSchema>;
export type PlanWorkflowState = z.infer<typeof PlanStateV2Schema>;

export const ContextReceiptSchema = z.object({
  schema: z.literal("dreamgraph.context_receipt.v1"), id, instance_id: id,
  execution_id: id, revision: RevisionVectorSchema, plan_id: id.nullable(), slice_id: id.nullable(),
  scope: z.array(id), mandatory_evidence_ids: z.array(id), selected_evidence_ids: z.array(id),
  state: ResultStateSchema, issued_at: utc, expires_at: utc.nullable(),
  adapter: id, delivery: z.enum(["delivered", "acknowledged", "unattested"]),
}).strict();

/** Text is budgeted independently of transport metadata; records attest exactly what text contains. */
export const ContextRecordSchema = z.object({
  id, record_type: z.enum(["entity", "entity_detail", "relationship", "observation"]),
  identity: GraphIdentitySchema.nullable(), assertion_class: AssertionClassSchema,
  evidence_ids: z.array(id), mandatory: z.boolean(), selection_reason: id,
}).strict();
export const ContextPackSchema = z.object({
  schema: z.literal("dreamgraph.context_pack.v1"), id, instance_id: id,
  revision: RevisionVectorSchema, currency: GraphCurrencySchema, state: ResultStateSchema,
  context_text: z.string(), token_budget: count, token_count: count,
  token_count_method: z.literal("utf8_byte_upper_bound"), metadata_budget_bytes: count,
  records: z.array(ContextRecordSchema), mandatory_satisfied: z.boolean(),
  omissions: z.array(z.object({ reason: id, count }).strict()),
  source_fallback: z.array(z.object({
    identity: GraphIdentitySchema.nullable(), source_repo: id.nullable(), source_path: id.nullable(), reason: id,
  }).strict()),
  receipt: ContextReceiptSchema,
}).strict();
export type ContextPack = z.infer<typeof ContextPackSchema>;

export const ChangeObligationSchema = z.object({
  schema: z.literal("dreamgraph.change_obligation.v1"), id, instance_id: id,
  execution_id: id.nullable(), operation_id: id, actor: id, scope: z.array(id),
  state: z.enum(["intent", "source_applied", "reconciliation_pending", "graph_committed", "unknown", "failed"]),
  before_hashes: z.record(z.string()), after_hashes: z.record(z.string()),
  graph_receipt_id: id.nullable(), created_at: utc, updated_at: utc,
}).strict();

export const DirtyPartitionSchema = z.object({
  schema: z.literal("dreamgraph.dirty_partition.v1"), id, scope: z.array(id),
  generation: count, running_generation: count.nullable(), root_cause_ids: z.array(id),
  input_fingerprint: id, pending_stages: z.array(id),
  state: z.enum(["awaiting_reconciliation", "ready", "queued", "running", "partial", "budget_blocked", "failed", "settled"]),
  first_changed_at: utc, last_changed_at: utc, stage_receipt_ids: z.array(id),
}).strict();

export const ScheduleOccurrenceSchema = z.object({
  schema: z.literal("dreamgraph.schedule_occurrence.v1"), id, schedule_id: id,
  definition_revision: count, planned_at: utc.nullable(), trigger_cursor: id,
  timezone: id, fold_policy: z.enum(["once", "both"]),
  job_id: id.nullable(), action: id, action_version: id, parameters: z.record(z.unknown()),
  state: z.enum(["planned", "claimed", "skipped", "blocked", "queued", "running", "finished"]),
}).strict();

export const AutonomySchema = z.enum(["manual", "supervised", "autonomous"]);
export const VerbositySchema = z.enum(["concise", "balanced", "detailed"]);
export const EffectiveControlsSchema = z.object({
  autonomy: AutonomySchema, verbosity: VerbositySchema,
  adapter: id, adapter_version: id, native_label: id.nullable(),
  support: z.enum(["enforced", "prompt_guided", "unsupported"]), mechanism: id,
  reasons: z.array(id), scope: z.array(id), policy_revision: id,
}).strict();

export const ComputerCapabilitySchema = z.object({
  schema: z.literal("dreamgraph.computer_capability.v1"), id, adapter: id,
  adapter_version: id, backend_version: id.nullable(),
  route: z.enum(["native_cli", "dreamgraph_harness", "unavailable"]),
  requested: z.array(id), supported: z.array(id), permitted: z.array(id), effective: z.array(id),
  evidence_granularity: z.enum(["action", "aggregate", "none"]),
  independent_stop: z.boolean(), reasons: z.array(id), qualified_at: utc.nullable(),
}).strict();
export const ComputerTargetSchema = z.object({
  schema: z.literal("dreamgraph.computer_target.v1"), id, instance_id: id,
  session_id: id, host_id: id, surface: z.enum(["browser", "desktop", "application"]),
  generation: count, origin: id.nullable(), application: id.nullable(),
}).strict();
export const ComputerSessionSchema = z.object({
  schema: z.literal("dreamgraph.computer_session.v1"), id, instance_id: id, session_id: id,
  execution_id: id, job_id: id, owner: id, host_id: id, target_ids: z.array(id), grant_id: id,
  capability_id: id, fence: count, policy_revision: id,
  state: z.enum(["created", "ready", "running", "paused", "stopping", "stopped", "failed", "recovery_required"]),
  created_at: utc, updated_at: utc, terminal_reason: id.nullable(),
}).strict();
export const ComputerObservationSchema = z.object({
  schema: z.literal("dreamgraph.computer_observation.v1"), id, target_id: id,
  target_generation: count, execution_id: id,
  kind: z.enum(["pixels", "dom", "accessibility", "api_state", "interpretation", "postcondition"]),
  observed_at: utc, expires_at: utc, artifact_ref: id.nullable(), content_hash: id,
  evidence_ids: z.array(id), verified: z.boolean(),
}).strict();
export const ComputerActionSchema = z.object({
  schema: z.literal("dreamgraph.computer_action.v1"), id, execution_id: id,
  target_id: id, target_generation: count, observation_id: id,
  grant_id: id, operation: z.enum(["observe", "click", "double_click", "pointer_move", "drag", "scroll", "type", "key", "navigate", "select", "set_checked", "focus", "close_target", "wait", "native_task"]),
  parameters: z.object({
    x: z.number().finite().optional(), y: z.number().finite().optional(),
    to_x: z.number().finite().optional(), to_y: z.number().finite().optional(),
    delta_x: z.number().finite().optional(), delta_y: z.number().finite().optional(),
    button: z.enum(["left", "middle", "right"]).optional(),
    text: z.string().optional(), key: id.optional(), url: id.optional(),
    locator: id.optional(), value: z.string().optional(), checked: z.boolean().optional(),
    elapsed_ms: count.optional(), instruction: z.string().optional(),
  }).strict(),
  postcondition: id, fence: count,
}).strict();
export const ComputerReceiptSchema = z.object({
  schema: z.literal("dreamgraph.computer_receipt.v1"), id, action_id: id,
  state: z.enum(["dispatched", "unknown", "verified", "failed", "cancelled"]),
  observed_at: utc, observation_ids: z.array(id), change_obligation_ids: z.array(id),
  graph_receipt_id: id.nullable(), reason: id.nullable(),
}).strict();

/** Shared request semantics accompany the result across HTTP, MCP, editor and SDK ports. */
export const ContextQuerySchema = z.object({
  query: z.string().max(16000), mode: z.enum(["entity_focused", "tension_focused", "narrative_focused", "comprehensive"]).default("comprehensive"),
  token_budget: z.number().int().min(1).max(10000).default(2000),
  metadata_budget_bytes: z.number().int().min(4096).max(65536).default(32768),
  depth: z.number().int().min(0).max(5).default(2), max_neighbors: z.number().int().min(0).max(100).default(20),
  max_records: z.number().int().min(1).max(128).default(40),
  kinds: z.array(GraphKindSchema).max(17).optional(), domains: z.array(z.string().min(1)).max(32).optional(),
  repositories: z.array(z.string().min(1)).max(32).optional(), assertion_classes: z.array(AssertionClassSchema).max(8).optional(),
  include_tensions: z.boolean().default(true), include_narrative: z.boolean().default(true),
  mandatory_identities: z.array(GraphIdentitySchema).max(32).default([]),
  mandatory_evidence_ids: z.array(z.string().min(1).max(1024)).max(32).default([]),
  changed_files: z.array(z.object({ repository_id: z.string().min(1), path: z.string().min(1) }).strict()).max(32).default([]),
  plan_id: z.string().min(1).max(1024).optional(), slice_id: z.string().min(1).max(1024).optional(),
  execution_id: z.string().min(1).max(1024).optional(), adapter: z.string().min(1).max(1024).default("unbound"),
  observations: z.array(z.object({ observation: ComputerObservationSchema, summary: z.string().min(1).max(2000) }).strict()).max(12).default([]),
}).strict();
export type ContextQuery = z.input<typeof ContextQuerySchema>;

/** Host-control contracts. Models receive execution credentials, never approval issuance authority. */
export const ExecutionApprovalSchema = z.array(z.object({
  tool: z.string().min(1).max(256), arguments: z.record(z.unknown()), scope_id: z.string().min(1).max(512),
  calls: z.number().int().min(1).max(128).default(1),
}).strict()).max(128);
/** Explicit original-host purpose. Selecting a plan or mentioning a slice grants no execution ownership. */
export const PlanExecutionIntentSchema = z.object({
  scope: z.object({ instance_id: id, project_id: id, id }).strict(),
  kind: z.enum(["implementation", "verification", "final_verification"]), slice_id: id.nullable(),
  expected_revision: count, expected_definition_hash: id, approval_id: id,
}).strict();
export type PlanExecutionIntent = z.infer<typeof PlanExecutionIntentSchema>;
export const ManagedExecutionRequestSchema = z.object({
  id: z.string().min(1).max(1024), adapter: z.string().min(1).max(256), query: z.string().max(16000),
  plan_id: z.string().min(1).max(1024).optional(), slice_id: z.string().min(1).max(1024).optional(),
  plan_execution: PlanExecutionIntentSchema.optional(),
  token_budget: z.number().int().min(1).max(10000).default(6000),
  autonomy: AutonomySchema.default("manual"), verbosity: VerbositySchema.default("balanced"),
  timeout_ms: z.number().int().min(1).max(300000).default(300000), approved_actions: ExecutionApprovalSchema.default([]),
}).strict();
export const ManagedExecutionStatusSchema = z.enum(["assembled", "running", "no_change", "state_committed", "graph_committed", "work_pending", "reconciliation_pending", "recovery_required"]);
export const ManagedExecutionSnapshotSchema = z.object({
  schema: z.literal("dreamgraph.managed_execution.v1"), execution_id: id, instance_id: id,
  status: ManagedExecutionStatusSchema, record_revision: count, pack: ContextPackSchema, block: z.string().max(65536),
  graph_receipt_ids: z.array(id), state_receipt_ids: z.array(id), obligation_ids: z.array(id),
  authority_active: z.boolean(), delivery_attests: z.literal("host_transport_only"),
  // The shared C14 projector supplies effective lease expiry and lifecycle; this is not another status writer.
  plan_execution: z.object({ intent: PlanExecutionIntentSchema, state: PlanStateV2Schema }).strict().optional(),
}).strict();
export type ManagedExecutionRequest = z.input<typeof ManagedExecutionRequestSchema>;
export type ManagedExecutionSnapshot = z.infer<typeof ManagedExecutionSnapshotSchema>;
/** Only the original operator host can review exact effects against a delivered context. */
export const ManagedExecutionApprovalRequestSchema = z.object({
  execution_id: id, approval_id: id, expected_record_revision: count, context_receipt_id: id,
  approved_actions: ExecutionApprovalSchema.min(1),
}).strict();
export type ManagedExecutionApprovalRequest = z.input<typeof ManagedExecutionApprovalRequestSchema>;

/** Native hosts keep their secrets and transport. Only the original host can reserve inference. */
export const ManagedModelBindingSchema = z.object({
  // `none` on native CLI means no direct API provider is attested by the invocation.
  provider: z.enum(["openai", "anthropic", "ollama", "lmstudio", "none"]), model: z.string().min(1).max(256),
  adapter: z.enum(["native_api", "codex-cli", "copilot-cli"]),
  api: z.enum(["responses", "chat_completions", "messages", "local", "native_cli"]),
  base_url: z.string().max(2048).default(""), effort: z.string().min(1).max(32).nullable().default(null),
  retention: z.enum(["provider_default", "store_false", "store_true", "zero_retention", "local_only"]).default("provider_default"),
  strict_schema: z.boolean().default(false), output_tokens: z.number().int().min(1).max(1000000),
}).strict();
export const ManagedModelAdmissionRequestSchema = z.object({
  execution_id: id, request_id: id, binding: ManagedModelBindingSchema,
  payload: z.string().max(8 * 1024 * 1024), output_tokens: z.number().int().min(1).max(1000000),
  retry: z.boolean().default(false),
}).strict();
export const ManagedModelPermitSchema = z.object({
  execution_id: id, request_id: id, attempt_id: id, run_id: id, policy_fingerprint: id, expires_at: utc,
  billing_channel: z.enum(["api", "local", "subscription"]),
  input_token_allowance: count, output_token_allowance: count,
  attests: z.literal("possible_dispatch_liability_only"),
}).strict();
const ManagedModelUsageSchema = z.object({
  inputTokens: count.optional(), outputTokens: count.optional(), totalTokens: count.optional(), cachedInputTokens: count.optional(),
  cacheCreationInputTokens: count.optional(), reasoningTokens: count.optional(),
}).strict();
export const ManagedModelSettlementSchema = z.object({
  execution_id: id, request_id: id, attempt_id: id, usage: ManagedModelUsageSchema.nullable().default(null),
  acknowledged: z.boolean(), work_termination: z.enum(["confirmed", "unconfirmed"]),
}).strict();
export const ManagedModelOutcomeSchema = z.object({
  execution_id: id, request_id: id, permit: ManagedModelPermitSchema.nullable(),
  state: z.enum(["admitting", "awaiting_host", "host_reported", "unknown", "refused"]),
  settlement: ManagedModelSettlementSchema.nullable(), error: z.string().max(2048).nullable(),
  report_attests: z.literal("trusted_host_observation_only"),
}).strict();
export type ManagedModelBinding = z.input<typeof ManagedModelBindingSchema>;
export type ManagedModelAdmissionRequest = z.input<typeof ManagedModelAdmissionRequestSchema>;
export type ManagedModelPermit = z.infer<typeof ManagedModelPermitSchema>;
export type ManagedModelSettlement = z.input<typeof ManagedModelSettlementSchema>;
export type ManagedModelOutcome = z.infer<typeof ManagedModelOutcomeSchema>;

/** This registry is the sole source for generated SDK and JSON Schema artifacts. */
export const CANONICAL_CONTRACTS = {
  graph_identity: GraphIdentitySchema, evidence_reference: EvidenceReferenceSchema,
  graph_entity: GraphEntitySchema, graph_relationship: GraphRelationshipSchema,
  graph_currency: GraphCurrencySchema, revision_vector: RevisionVectorSchema,
  result_state: ResultStateSchema, graph_result: GraphEnvelopeSchema, resource_result: ResourcePageSchema,
  operation_receipt: OperationReceiptSchema, job: JobSchema, budget: BudgetSchema,
  authority_grant: AuthorityGrantSchema, config_snapshot: ConfigSnapshotSchema,
  command_target: CommandTargetSchema, command_availability: CommandAvailabilitySchema,
  role_policy: RolePolicySchema, plan_state: PlanStateSchema, context_receipt: ContextReceiptSchema,
  context_record: ContextRecordSchema, context_pack: ContextPackSchema, context_query: ContextQuerySchema,
  execution_approval: ExecutionApprovalSchema, managed_execution_request: ManagedExecutionRequestSchema, managed_execution_snapshot: ManagedExecutionSnapshotSchema,
  plan_execution_intent: PlanExecutionIntentSchema,
  managed_execution_approval_request: ManagedExecutionApprovalRequestSchema,
  managed_model_binding: ManagedModelBindingSchema, managed_model_admission_request: ManagedModelAdmissionRequestSchema,
  managed_model_permit: ManagedModelPermitSchema, managed_model_settlement: ManagedModelSettlementSchema, managed_model_outcome: ManagedModelOutcomeSchema,
  change_obligation: ChangeObligationSchema, dirty_partition: DirtyPartitionSchema,
  schedule_occurrence: ScheduleOccurrenceSchema, effective_controls: EffectiveControlsSchema,
  computer_capability: ComputerCapabilitySchema, computer_target: ComputerTargetSchema,
  computer_session: ComputerSessionSchema,
  computer_observation: ComputerObservationSchema, computer_action: ComputerActionSchema,
  computer_receipt: ComputerReceiptSchema,
} as const;

export function classifySchemaMajor(version: string, current: number): "current" | "previous" | "migration_required" | "unknown" | "newer" {
  const match = /^(\d+)(?:\.\d+(?:\.\d+)?)?$/.exec(version);
  if (!match) return "unknown";
  const major = Number(match[1]);
  return major === current ? "current" : major === current - 1 ? "previous" : major > current ? "newer" : "migration_required";
}

/** Typed identity preserves legacy IDs and namespaces collisions instead of name merging. */
export function graphIdentityKey(identity: GraphIdentity): string {
  const value = GraphIdentitySchema.parse(identity);
  return [value.instance_id, value.kind, ...(value.repository_id ? [value.repository_id] : []), value.id].map(encodeURIComponent).join("/");
}
