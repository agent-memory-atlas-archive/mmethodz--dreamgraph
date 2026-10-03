/** Pure, bounded task context over the canonical graph. No provider calls or graph writes. */
import { createHash } from "node:crypto";
import { getRetrievalIndex, indexedRelevance, lexicalTerms as terms, knowledgeText as textual, type RetrievalIndex } from "./retrieval-index.js";
import { CANONICAL_FAMILIES, exactGraphEntity, type CanonicalGraphRead } from "./read-model.js";
import {
  ContextPackSchema, ContextQuerySchema, graphIdentityKey,
  type ContextQuery, type ContextPack, type GraphEntity, type GraphIdentity, type GraphRelationship, type ResultState,
} from "./contracts.js";

export { ContextQuerySchema, type ContextQuery } from "./contracts.js";

/** Model-independent bound for byte-tokenizing adapters, including non-Latin text and JSON syntax. */
export const contextTokenUpperBound = (text: string): number => Buffer.byteLength(text, "utf8");
const key = (entity: GraphEntity): string => graphIdentityKey(entity.identity);

interface Unit {
  record: ContextPack["records"][number]; text: string; score: number;
  entity?: GraphEntity; relation?: GraphRelationship; detail_parent?: string;
}
const DETAIL_FIELDS = ["fields", "members", "parameters", "steps", "flows", "constraints", "relationships", "data_bindings", "layout", "interactions", "api_surface", "actions", "inputs", "outputs", "tools", "schema", "restrictions", "history", "postconditions", "risks", "capabilities", "consequences", "alternatives", "key_discoveries", "checks", "evidence_ancestry"];
function entityUnit(entity: GraphEntity, mandatory: boolean, reason: string, score: number): Unit {
  // Whole assertions and their evidence travel together. Long assertions are omitted, never clipped into a different claim.
  const evidence = entity.evidence;
  const fields = ["lifecycle", "status", "current_slice_ids", "running_slice_ids", "next_slice_ids", "depends_on", "plan_id", "source_files", "application", "workflow_id",
    ...(["plan", "slice"].includes(entity.identity.kind) ? ["source", "project_id", "slice_id", "revision", "event_sequence", "definition_hash", "plan_projection", "owner", "blockers", "prior_status", "required_stages", "verification", "evidence_ids", "implementation_revision", "implementation_receipt_ids", "effect_obligation_ids", "acceptance_hash", "deferral", "last_attempt"] : [])];
  const structural = Object.fromEntries(fields.filter(name => entity.payload[name] !== undefined).map(name => [name, entity.payload[name]]));
  return { entity, score, record: { id: key(entity), record_type: "entity", identity: entity.identity,
    assertion_class: entity.assertion_class, evidence_ids: entity.evidence.map(ref => ref.id), mandatory, selection_reason: reason },
    text: JSON.stringify({ entity: key(entity), label: entity.label, assertion: entity.assertion_class,
      confidence: entity.confidence, ...structural, ...(textual(entity.payload) ? { knowledge: textual(entity.payload) } : {}), evidence }) };
}
function relationshipUnit(relation: GraphRelationship, score: number): Unit {
  return { relation, score, record: { id: relation.id, record_type: "relationship", identity: null,
    assertion_class: relation.assertion_class, evidence_ids: relation.evidence.map(ref => ref.id), mandatory: false, selection_reason: "bounded_relationship" },
    text: JSON.stringify({ relationship: relation.id, from: relation.source ? graphIdentityKey(relation.source) : null,
      to: relation.target ? graphIdentityKey(relation.target) : null, relation: relation.relation,
      assertion: relation.assertion_class, confidence: relation.confidence, evidence: relation.evidence }) };
}
const metadataBytes = (pack: ContextPack): number => Buffer.byteLength(JSON.stringify({ ...pack, context_text: "" }), "utf8");

/** Refresh callers recompute from a new snapshot; receipt revision binds the exact context that was assembled. */
export function buildContextPack(snapshot: CanonicalGraphRead, request: ContextQuery, now = new Date(), index = getRetrievalIndex(snapshot)): ContextPack {
  const input = ContextQuerySchema.parse(request);
  const issued_at = now.toISOString(), queryTerms = terms(input.query);
  const relevance = (entity: GraphEntity, query: string, queryTerms: Set<string>) => indexedRelevance(index, entity, query, queryTerms);
  const omissions = new Map<string, number>();
  const omit = (reason: string, count = 1): void => { if (count) omissions.set(reason, (omissions.get(reason) ?? 0) + count); };
  const required = new Map<string, string>();
  const missing: string[] = [];
  const fallback: ContextPack["source_fallback"] = [];
  const allowEntity = (entity: GraphEntity): boolean =>
    (!input.kinds || input.kinds.includes(entity.identity.kind)) &&
    (!input.domains || input.domains.includes(String(entity.payload.domain ?? ""))) &&
    (!input.repositories || (!!entity.identity.repository_id && input.repositories.includes(entity.identity.repository_id))) &&
    (!input.assertion_classes || input.assertion_classes.includes(entity.assertion_class)) &&
    (input.include_tensions || entity.identity.kind !== "tension") &&
    (input.include_narrative || entity.identity.kind !== "narrative");
  function requireEntity(identity: GraphIdentity, reason: string): void {
    const entity = exactGraphEntity(snapshot, identity); // Cross-instance/ambiguous identity is an error, not a guessed seed.
    if (!entity || !allowEntity(entity)) { missing.push(graphIdentityKey(identity));
      fallback.push({ identity, source_repo: identity.repository_id ?? null, source_path: null, reason: entity ? "REQUIRED_FILTER_CONFLICT" : "REQUIRED_ENTITY_MISSING" });
    } else required.set(key(entity), reason);
  }
  for (const identity of input.mandatory_identities) requireEntity(identity, "required_identity");
  if (input.plan_id) requireEntity({ instance_id: snapshot.instance_id, kind: "plan", id: input.plan_id }, "selected_plan");
  if (input.slice_id) {
    const slices = snapshot.entities.filter(entity => entity.identity.kind === "slice"
      && (entity.identity.id === input.slice_id || entity.payload.slice_id === input.slice_id)
      && (!input.plan_id || entity.payload.plan_id === input.plan_id));
    if (slices.length === 1) requireEntity(slices[0].identity, "selected_slice");
    else {
      missing.push(input.slice_id);
      fallback.push({ identity: null, source_repo: null, source_path: null,
        reason: slices.length ? "REQUIRED_SLICE_ID_AMBIGUOUS" : "REQUIRED_ENTITY_MISSING" });
    }
  }
  for (const evidenceId of input.mandatory_evidence_ids) {
    const entities = [...(index.by_evidence.get(evidenceId) ?? [])]
      .sort((a, b) => Number(allowEntity(b)) - Number(allowEntity(a)) || relevance(b, input.query, queryTerms) - relevance(a, input.query, queryTerms) || key(a).localeCompare(key(b)));
    if (!entities.length) { missing.push(evidenceId); fallback.push({ identity: null, source_repo: null, source_path: null, reason: "REQUIRED_EVIDENCE_MISSING" }); }
    else requireEntity(entities[0].identity, "required_evidence");
  }
  const sourceKeys = new Set(input.changed_files.map(file => `${file.repository_id}/${file.path}`));
  const eligible = snapshot.entities.filter(allowEntity);
  omit("filtered", snapshot.entities.length - eligible.length);
  const ranked = eligible.map(entity => ({ entity, score: relevance(entity, input.query, queryTerms) }))
    .sort((a, b) => b.score - a.score || key(a.entity).localeCompare(key(b.entity)));
  // Explicit task dependencies reserve decision anchors before optional expansion, without importing unrelated ADRs.
  for (const { entity, score } of ranked) {
    if (entity.identity.kind === "adr" && score > 0) required.set(key(entity), "relevant_decision");
    if (entity.evidence.some(ref => ref.source_path && sourceKeys.has(`${ref.source_repo ?? "unknown"}/${ref.source_path}`))) required.set(key(entity), "changed_source_dependency");
  }
  for (const file of input.changed_files) if (!snapshot.source_dependents.has(`${file.repository_id}/${file.path}`)) {
    fallback.push({ identity: null, source_repo: file.repository_id, source_path: file.path, reason: "SOURCE_NOT_MAPPED" });
  }
  const rankedSeeds = ranked.filter(({ entity, score }) =>
    (input.mode !== "tension_focused" || entity.identity.kind === "tension") &&
    (input.mode !== "narrative_focused" || ["narrative", "temporal", "causal"].includes(entity.identity.kind)) &&
    (score > 0 || !input.query));
  const seeds = rankedSeeds.slice(0, 10);
  omit("seed_limit", rankedSeeds.length - seeds.length);
  const candidates = new Map<string, Unit>();
  for (const { entity, score } of seeds) candidates.set(key(entity), entityUnit(entity, required.has(key(entity)), required.get(key(entity)) ?? "query_match", score));
  for (const [entityKey, reason] of required) {
    const entity = snapshot.by_identity.get(entityKey)!;
    candidates.set(entityKey, entityUnit(entity, true, reason, relevance(entity, input.query, queryTerms)));
  }
  const adjacency = index.adjacency;
  let frontier = [...candidates.keys()];
  const visited = new Set(frontier);
  const relations = new Map<string, Unit>();
  for (let hop = 0; hop < input.depth && frontier.length; hop++) {
    const next: string[] = [];
    for (const origin of frontier) {
      const edges = (adjacency.get(origin) ?? []).filter(edge => !input.assertion_classes || input.assertion_classes.includes(edge.assertion_class));
      let examined = 0;
      for (const edge of edges) {
        const endpoint = [edge.source, edge.target].find(identity => identity && graphIdentityKey(identity) !== origin);
        const entity = endpoint ? snapshot.by_identity.get(graphIdentityKey(endpoint)) : undefined;
        if (!entity || !allowEntity(entity)) { omit("unresolved_or_filtered_relationship"); continue; }
        if (examined >= input.max_neighbors) { omit("neighbor_limit"); continue; }
        examined++;
        if (!visited.has(key(entity)) && visited.size >= input.max_records) { omit("record_expansion_limit"); continue; }
        relations.set(edge.id, relationshipUnit(edge, relevance(entity, input.query, queryTerms)));
        if (!visited.has(key(entity))) {
          visited.add(key(entity)); next.push(key(entity));
          candidates.set(key(entity), entityUnit(entity, false, "bounded_neighbor", relevance(entity, input.query, queryTerms) / (hop + 2)));
        }
      }
    }
    frontier = next;
  }
  const candidateKeys = new Set(candidates.keys());
  const scopedKinds = new Set(input.kinds ?? eligible.map(entity => entity.identity.kind));
  const scopedFiles = new Set(CANONICAL_FAMILIES.filter(family => scopedKinds.has(family.kind)).map(family => family.file));
  const reasons = snapshot.state.reasons.filter(reason => !reason.scope.length || reason.scope.some(scope =>
    candidateKeys.has(scope) || scopedFiles.has(scope) || input.mandatory_evidence_ids.includes(scope) ||
    input.changed_files.some(file => scope === `source:${encodeURIComponent(file.repository_id)}/${file.path.replace(/\\/g, "/").split("/").map(encodeURIComponent).join("/")}`)));
  const scope = [...new Set([...candidateKeys, ...missing])];
  const state: ResultState = { availability: eligible.length || !reasons.length ? "available" : "unavailable",
    completeness: reasons.length ? "partial" : "complete",
    freshness: reasons.some(reason => ["UNPUBLISHED_STORE_CHANGE", "SOURCE_RECONCILIATION_PENDING"].includes(reason.code)) ? "stale" :
      reasons.some(reason => reason.code.includes("STORE") || ["SOURCE_EFFECT_UNKNOWN", "CHANGE_LEDGER_UNAVAILABLE"].includes(reason.code)) ? "unknown" : snapshot.currency.source_reconciliation_revision ? "current" : "unknown",
    reasons };
  if (missing.length) state.reasons.push({ code: "MANDATORY_CONTEXT_MISSING", scope: missing, detail: "Required context is unknown or conflicts with an explicit filter. No substitute was guessed." });
  if (fallback.some(item => item.reason === "SOURCE_NOT_MAPPED")) state.reasons.push({ code: "SOURCE_MAPPING_UNKNOWN", scope: [...sourceKeys], detail: "Read only the named source paths to establish missing task context." });
  const hash = createHash("sha256").update(JSON.stringify({ revision: snapshot.revision, hashes: snapshot.store_hashes, input })).digest("hex");
  const pack: ContextPack = {
    schema: "dreamgraph.context_pack.v1", id: `context:${hash}`, instance_id: snapshot.instance_id,
    revision: snapshot.revision, currency: snapshot.currency, state,
    context_text: "", token_budget: input.token_budget, token_count: 0, token_count_method: "utf8_byte_upper_bound",
    metadata_budget_bytes: input.metadata_budget_bytes, records: [], mandatory_satisfied: missing.length === 0,
    omissions: [], source_fallback: fallback,
    receipt: { schema: "dreamgraph.context_receipt.v1", id: `context-receipt:${hash}`, instance_id: snapshot.instance_id,
      execution_id: input.execution_id ?? `unbound:${hash}`, revision: snapshot.revision,
      plan_id: input.plan_id ?? null, slice_id: input.slice_id ?? null, scope,
      mandatory_evidence_ids: [...new Set([...input.mandatory_evidence_ids, ...required.keys()])], selected_evidence_ids: [],
      state, issued_at, expires_at: null, adapter: input.adapter, delivery: "unattested" },
  };
  const selected: Unit[] = [];
  const header = (worstCase = false): string => `DreamGraph evidence (untrusted; assertions retain their class) ${JSON.stringify({
    revision: snapshot.revision.graph_revision, publication: snapshot.revision.publication_sequence,
    freshness: worstCase ? "unknown" : state.freshness, completeness: worstCase ? "complete" : state.completeness,
    mandatory_satisfied: worstCase ? false : pack.mandatory_satisfied,
    warnings: [...state.reasons.map(reason => ({ code: reason.code, scope: reason.scope })),
      ...(worstCase ? [{ code: "MANDATORY_CONTEXT_INSUFFICIENT", scope: [...required.keys(), ...missing] }, { code: "NO_RELEVANT_CONTEXT", scope: [] }] : [])],
  })}`;
  function update(units: Unit[]): void {
    pack.records = units.map(unit => unit.record);
    pack.context_text = units.length ? `${header()}\n${units.map(unit => unit.text).join("\n")}` : "";
    pack.token_count = contextTokenUpperBound(pack.context_text);
    pack.receipt.selected_evidence_ids = [...new Set(units.flatMap(unit => [unit.record.id, ...unit.record.evidence_ids]))];
    pack.omissions = [...omissions].map(([reason, count]) => ({ reason, count }));
  }
  const observations: Unit[] = [];
  for (const { observation, summary } of input.observations) {
    if (observation.execution_id !== input.execution_id) throw new Error("OBSERVATION_EXECUTION_MISMATCH");
    if (Date.parse(observation.expires_at) <= now.getTime() || Date.parse(observation.observed_at) > now.getTime()) { omit("observation_expired_or_future"); continue; }
    // Context is semantic history, not an executable selector or coordinate. Action-time reobservation belongs to C17.
    observations.push({ score: 0, record: { id: observation.id, record_type: "observation", identity: null,
      assertion_class: "historical", evidence_ids: observation.evidence_ids, mandatory: false, selection_reason: "scoped_semantic_observation" },
      text: JSON.stringify({ observation: observation.id, summary, source_kind: observation.kind, verified: observation.verified,
        observed_at: observation.observed_at, expires_at: observation.expires_at, interpretation: "historical context; reobserve before acting" }) });
  }
  const details: Unit[] = [];
  for (const unit of candidates.values()) {
    const entity = unit.entity!;
    for (const field of DETAIL_FIELDS) if (entity.payload[field] !== undefined) {
      const id = `${key(entity)}#field:${field}`;
      const score = [...terms(`${field} ${JSON.stringify(entity.payload[field])}`)].filter(term => queryTerms.has(term)).length / Math.max(1, queryTerms.size);
      details.push({ detail_parent: key(entity), score, record: { ...unit.record, id, record_type: "entity_detail", mandatory: false, selection_reason: "whole_semantic_field" },
        text: JSON.stringify({ detail: id, entity: key(entity), field, value: entity.payload[field], assertion: entity.assertion_class, evidence_ids: unit.record.evidence_ids }) });
    }
  }
  const optionalClass = (unit: Unit): number => unit.detail_parent ? 1 : unit.relation ? 2 : unit.record.record_type === "observation" ? 3 : 0;
  const units = [...candidates.values(), ...details, ...relations.values(), ...observations].sort((a, b) =>
    Number(b.record.mandatory) - Number(a.record.mandatory) ||
    optionalClass(a) - optionalClass(b) || b.score - a.score || a.record.id.localeCompare(b.record.id));
  for (const unit of units) {
    if (unit.detail_parent && !selected.some(parent => parent.record.id === unit.detail_parent)) { omit("detail_parent_omitted"); continue; }
    // Relationships never outlive either endpoint in the emitted context.
    if (unit.relation && [unit.relation.source, unit.relation.target].some(identity => !identity || !selected.some(item => item.record.identity && graphIdentityKey(item.record.identity) === graphIdentityKey(identity)))) {
      omit("relationship_endpoint_omitted"); continue;
    }
    update([...selected, unit]);
    // Reserve final uncertainty/insufficiency header growth before selecting any unit.
    const reservedHeaderGrowth = Math.max(0, contextTokenUpperBound(header(true)) - contextTokenUpperBound(header()));
    const failure = selected.length >= input.max_records ? "record_limit" : pack.token_count + reservedHeaderGrowth > input.token_budget ? "context_budget" : metadataBytes(pack) > input.metadata_budget_bytes ? "metadata_budget" : null;
    if (failure) { omit(failure); if (unit.record.mandatory) pack.mandatory_satisfied = false; }
    else selected.push(unit);
    update(selected);
  }
  if (!pack.mandatory_satisfied) state.reasons.push({ code: "MANDATORY_CONTEXT_INSUFFICIENT", scope: [...required.keys(), ...missing], detail: "Required whole evidence units cannot all be supplied. Increase the budget or retrieve the named anchors; do not execute as though context were complete." });
  if (!units.length) { omit("no_relevant_context"); state.reasons.push({ code: "NO_RELEVANT_CONTEXT", scope: [], detail: "No graph evidence answered this task. Targeted source retrieval is required; absence is not a project fact." }); }
  if ([...omissions.keys()].some(reason => reason !== "filtered") || state.reasons.length) state.completeness = "partial";
  update(selected);
  const observationExpiry = selected.filter(unit => unit.record.record_type === "observation")
    .flatMap(unit => input.observations.filter(item => item.observation.id === unit.record.id).map(item => item.observation.expires_at)).sort();
  pack.receipt.expires_at = observationExpiry[0] ?? null;
  // Effective projections can change without a store write (expired plan leases
  // or observations). Bind the receipt to the actual emitted semantic content.
  const effectiveHash = createHash("sha256").update(JSON.stringify({ base: hash, currency: snapshot.currency,
    context_text: pack.context_text, records: pack.records, state, mandatory_satisfied: pack.mandatory_satisfied,
    omissions: pack.omissions, source_fallback: pack.source_fallback, expires_at: pack.receipt.expires_at })).digest("hex");
  pack.id = `context:${effectiveHash}`; pack.receipt.id = `context-receipt:${effectiveHash}`;
  if (!input.execution_id) pack.receipt.execution_id = `unbound:${effectiveHash}`;
  // Reserve room for final insufficiency/omission metadata too, rather than quietly clipping JSON.
  if (metadataBytes(pack) > input.metadata_budget_bytes) throw new Error("CONTEXT_METADATA_INSUFFICIENT: increase metadata_budget_bytes or narrow required scope");
  return ContextPackSchema.parse(pack);
}
