/** Pure canonical projection. Never repairs stores, fabricates scan dates, or merges names. */
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { z } from "zod";
import { dataPath } from "../utils/paths.js";
import { stripBom } from "../utils/read-json.js";
import { withGraphRead } from "../utils/graph-reconciliation-barrier.js";
import { loadPublicationState, publicationContentHash, type PublicationState } from "./publication.js";
import { storeDefinition } from "./store-registry.js";
import { readChangeObligations } from "./change-obligations.js";
import { assessClaimEvidence, claimCurrencyReasons, claimEvidenceReferences, emptyClaimEvidenceSnapshot, loadClaimEvidence, normalizationClaimKey, NormalizationClaimSchema, type NormalizationClaim } from "../cognitive/normalization-evidence.js";
import { readNormalizationResult } from "../cognitive/normalization-results.js";
import { loadGraphMaintenanceState } from "../cognitive/graph-maintenance-state.js";
import { curationSuppressions, emptyCuration } from "../cognitive/curation.js";
import { projectPlanAuthorityEntities } from "../discipline/plan-authority.js";
import { storeRows, validationPipelineCounts, type ValidationPipelineCounts } from "../cognitive/validation-pipeline.js";
import {
  GraphEntitySchema, GraphKindSchema, GraphRelationshipSchema, graphIdentityKey, classifySchemaMajor,
  type GraphEntity, type GraphIdentity, type GraphRelationship, type ResultState, type GraphEnvelope,
} from "./contracts.js";

type Kind = GraphIdentity["kind"];
type Raw = Record<string, unknown>;
interface Family { file: string; kind: Kind; arrays: string[]; id_field?: string }
export const CANONICAL_FAMILIES: readonly Family[] = [
  { file: "features.json", kind: "feature", arrays: ["features", "entities"] },
  { file: "workflows.json", kind: "workflow", arrays: ["workflows", "entities"] },
  { file: "data_model.json", kind: "data_model", arrays: ["data_model", "entities"] },
  { file: "capabilities.json", kind: "capability", arrays: ["capabilities", "entities"] },
  { file: "datastores.json", kind: "datastore", arrays: ["datastores", "entities"] },
  { file: "auxiliary_entities.json", kind: "auxiliary", arrays: ["entries"] },
  { file: "ui_registry.json", kind: "ui_element", arrays: ["elements"] },
  { file: "dream_graph.json", kind: "dream_node", arrays: ["nodes"] },
  { file: "candidate_edges.json", kind: "candidate", arrays: ["results"], id_field: "dream_id" },
  { file: "validated_edges.json", kind: "validated", arrays: ["edges"] },
  { file: "tension_log.json", kind: "tension", arrays: ["signals", "tensions"] },
  { file: "adr_log.json", kind: "adr", arrays: ["decisions"] },
  { file: "temporal_graph.json", kind: "temporal", arrays: ["events"] },
  { file: "causal_graph.json", kind: "causal", arrays: ["hypotheses"] },
  { file: "dream_archetypes.json", kind: "candidate", arrays: ["archetypes"] },
  { file: "system_story.json", kind: "narrative", arrays: ["chapters"] },
  { file: "plan_state.json", kind: "plan", arrays: ["plans"], id_field: "plan_id" },
  { file: "slice_state.json", kind: "slice", arrays: ["slices"], id_field: "slice_id" },
];
export interface CanonicalGraphRead {
  schema: "dreamgraph.graph_snapshot.v1";
  instance_id: string;
  revision: PublicationState["revision"];
  currency: PublicationState["currency"];
  state: ResultState;
  entities: GraphEntity[];
  relationships: GraphRelationship[];
  store_hashes: Record<string, string | null>;
  /** Normalization pipeline counts from the raw stores (per dream, latest assessment): the same definition the Status board and `dg status` use. Null when candidate_edges.json is unavailable. */
  validation_pipeline?: ValidationPipelineCounts | null;
  /** Exact keys only; ambiguous legacy IDs are never guessed. */
  by_identity: Map<string, GraphEntity>;
  source_dependents: Map<string, Set<string>>;
  evidence_dependents: Map<string, Set<string>>;
  entity_dependents: Map<string, Set<string>>;
}
const record = z.record(z.unknown());
const legacyConflictHash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
/** Historical source rows withheld from active projection by an explicit legacy migration. */
export const LegacyConflictEntrySchema = z.object({
  schema: z.literal("dreamgraph.legacy_conflict.v1"), group_id: legacyConflictHash,
  file: z.string().min(1), collection: z.string().min(1), index: z.number().int().nonnegative(),
  original_id: z.string().nullable(), row_hash: legacyConflictHash, row: record,
  /** "superseded": an older revision with a recorded order (validated_at / normalization_cycle); the newest stays active. Absent: unresolved conflict. */
  disposition: z.literal("superseded").optional(),
}).strict();
const stableConflictRow = (value: unknown): string => value === null || typeof value !== "object" ? JSON.stringify(value)
  : Array.isArray(value) ? "[" + value.map(stableConflictRow).join(",") + "]"
  : "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + stableConflictRow((value as Raw)[key])).join(",") + "}";
export function legacyConflicts(raw: unknown, file: string): z.infer<typeof LegacyConflictEntrySchema>[] {
  if (Array.isArray(raw) || !raw || typeof raw !== "object" || !("legacy_conflicts" in raw)) return [];
  const entries = z.array(LegacyConflictEntrySchema).max(100_000).parse((raw as Raw).legacy_conflicts);
  const locations = new Set<string>();
  for (const entry of entries) {
    if (entry.file !== file || createHash("sha256").update(stableConflictRow(entry.row)).digest("hex") !== entry.row_hash.slice(7))
      throw new Error(`INVALID_LEGACY_CONFLICT_HISTORY: ${file}`);
    const location = `${entry.group_id}:${entry.collection}:${entry.index}:${entry.row_hash}`;
    if (locations.has(location)) throw new Error(`INVALID_LEGACY_CONFLICT_HISTORY: ${file}`);
    locations.add(location);
  }
  return entries;
}
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.length > 0) : [];
const text = (value: unknown): string | null => typeof value === "string" && value.length > 0 ? value : null;
const confidence = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
const digest = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const utc = (value: unknown): string | null => typeof value === "string" && z.string().datetime({ offset: true }).safeParse(value).success ? value : null;
function classify(kind: Kind, raw: Raw): GraphEntity["assertion_class"] {
  if (["plan", "slice"].includes(kind) && raw.source === "typed_plan_authority") return "historical";
  if (kind === "tension" && text(raw.tension_id) && text(raw.resolved_at)) return "historical";
  if (kind === "tension") return "tension";
  if (kind === "adr") return "decision";
  if (kind === "narrative" || kind === "temporal") return "historical";
  if (kind === "validated") return "hypothesis"; // Historical label alone is not present applicability.
  if (["dream_node", "candidate", "causal"].includes(kind) || raw.origin === "rem") return "hypothesis";
  const provenance = raw.provenance as Raw | undefined;
  if (raw.source_kind === "manual" || provenance?.kind === "manual" || raw.origin === "lucid") return "human_assertion";
  return strings(raw.source_files).length && text(raw.source_repo) ? "source_assertion" : "unknown";
}
function evidence(identity: GraphIdentity, raw: Raw, state: PublicationState): GraphEntity["evidence"] {
  const ancestry = strings(raw.evidence_ancestry ?? raw.inspiration);
  const result: GraphEntity["evidence"] = [];
  if (["plan", "slice"].includes(identity.kind) && raw.source === "typed_plan_authority") result.push({
    id: `plan-state:${digest([identity.instance_id, raw.project_id, raw.plan_id, raw.slice_id ?? null])}`,
    origin: "derived", ancestry: strings(raw.evidence_ids), revision: String(raw.revision), observed_at: utc(raw.updated_at),
    content_hash: digest(raw), semantic_anchor: identity.id, validation: "unreviewed",
  });
  if(raw.origin==="derived" || ["temporal","causal"].includes(identity.kind)) result.push({id:`derived:${identity.id}`,origin:"derived",ancestry,
    revision:text(raw.input_fingerprint??raw.source_digest),observed_at:utc(raw.observed_at),validation:identity.kind==="causal"?"hypothesis":"unreviewed"});
  const foreign=raw.origin as Raw|undefined;
  if(foreign&&typeof foreign==="object"&&text(foreign.namespace))result.push({id:`foreign:${foreign.namespace}:${foreign.claim_id}`,origin:"imported",
    ancestry:strings(foreign.ancestry),revision:text(foreign.source_digest),observed_at:utc(raw.imported_at),content_hash:text(foreign.evidence_digest)??undefined,validation:"hypothesis"});
  const source_repo = text(raw.source_repo);
  for (const source_path of strings(raw.source_files)) {
    const hashes = raw.source_hashes as Raw | undefined;
    result.push({ id: `source:${source_repo ?? "unknown"}:${source_path}`, origin: "source", ancestry,
      revision: text(raw.source_revision), observed_at: utc(raw.source_observed_at),
      ...(source_repo ? { source_repo } : {}), source_path,
      ...(text(hashes?.[source_path]) ? { content_hash: text(hashes?.[source_path])! } : {}),
      validation: raw.source_verified === true ? "validated" : "unreviewed" });
  }
  const enrichment = raw.enrichment as Raw | undefined;
  if (raw.origin === "rem" || enrichment?.model) result.push({
    id: `model:${graphIdentityKey(identity)}`, origin: "model", ancestry,
    revision: state.revision.graph_revision, observed_at: utc(enrichment?.enriched_at ?? raw.created_at),
    validation: "hypothesis",
  });
  if (raw.human_asserted === true || classify(identity.kind, raw) === "human_assertion" || (identity.kind === "adr" && raw.decided_by !== "system")) result.push({
    id: `human:${graphIdentityKey(identity)}`, origin: "human", ancestry,
    revision: null, observed_at: utc(raw.date), validation: "unreviewed",
  });
  if (identity.kind === "validated") result.push({
    id: `validation:${graphIdentityKey(identity)}`, origin: "validation", ancestry,
    revision: text(raw.validation_revision), observed_at: utc(raw.validated_at), validation: "unreviewed",
  });
  return result;
}
function arrayFrom(raw: unknown, family: Family): unknown[] {
  if (Array.isArray(raw)) return raw;
  const object = record.parse(raw);
  const matching = family.arrays.filter(key => Array.isArray(object[key]));
  if (matching.length !== 1) throw new Error(`INVALID_STORE_SHAPE: ${family.file}: expected one of ${family.arrays.join(", ")}`);
  const values = object[matching[0]] as unknown[];
  if(family.file==="dream_archetypes.json")return values.map(value=>{
    const row=record.parse(value),origin=row.origin as Raw|undefined;
    const receipt=(Array.isArray(object.imports)?object.imports:[]).map(i=>record.parse(i)).find(i=>i.source_instance===origin?.namespace);
    return {...row,imported_at:receipt?.observed_at??null};
  });
  if (family.kind === "candidate" && family.file !== "dream_archetypes.json") {
    // The store is immutable assessment history; the entity is its latest typed artifact.
    // Equal-cycle duplicates remain ambiguous instead of choosing an arbitrary assessment.
    const latest = new Map<string, Raw>(), selected: unknown[] = [];
    for (const value of values) {
      const row = record.parse(value);
      if (!text(row.dream_id) || !["edge", "node"].includes(String(row.dream_type)) || !Number.isSafeInteger(row.normalization_cycle)) { selected.push(row); continue; }
      const key = `${row.dream_type}:${row.dream_id}`, prior = latest.get(key);
      if (!prior || Number(row.normalization_cycle) > Number(prior.normalization_cycle)) latest.set(key, row);
      else if (row.normalization_cycle === prior.normalization_cycle) throw new Error(`DUPLICATE_TYPED_ID: assessment ${key}@${row.normalization_cycle}`);
    }
    return [...selected, ...latest.values()];
  }
  if (family.kind === "tension") return [...values, ...(Array.isArray(object.resolved_tensions) ? object.resolved_tensions : [])];
  if (family.kind === "narrative") return [...values, ...(Array.isArray(object.digests) ? object.digests : []), ...(Array.isArray(object.weekly_digests) ? object.weekly_digests : [])];
  return values;
}
export function legacyIdentity(family: Family, payload: Raw): string | null {
  if(family.file==="dream_archetypes.json"&&text(payload.id)&&!String(payload.id).startsWith("foreign:"))
    return `foreign:${text(payload.source_instance)??"unknown"}:${payload.id}`;
  if (family.kind === "candidate" && !text(payload.id) && text(payload.dream_id) && ["edge", "node"].includes(String(payload.dream_type))) return `${payload.dream_type}:${payload.dream_id}`;
  const explicit = text(payload.id ?? payload[family.id_field ?? "id"]);
  if (explicit) return explicit;
  if (family.kind === "narrative" && Number.isSafeInteger(payload.chapter_number) && Number(payload.chapter_number) >= 0) return `chapter:${payload.chapter_number}`;
  if (family.kind === "tension" && text(payload.tension_id) && utc(payload.resolved_at)) return `${payload.tension_id}@resolved:${payload.resolved_at}`;
  return null;
}

export async function loadCanonicalGraph(instance_id: string): Promise<CanonicalGraphRead> {
  if (!instance_id) throw new Error("INSTANCE_ID_REQUIRED");
  return withGraphRead(async () => {
    const publication = await loadPublicationState();
    const reasons: ResultState["reasons"] = [];
    let curation = emptyCuration(), curationAvailable = true;
    try { curation = (await loadGraphMaintenanceState()).curation ?? emptyCuration(); }
    catch (error) { curationAvailable = false; reasons.push({ code: "CURATION_UNAVAILABLE", scope: ["graph_maintenance.json"], detail: String(error) }); }
    const suppressedClaims = curationSuppressions(curation);
    let claimEvidence = emptyClaimEvidenceSnapshot();
    try { claimEvidence = await loadClaimEvidence(); }
    catch (error) { reasons.push({ code: "CLAIM_LEDGER_UNAVAILABLE", scope: ["normalization_evidence.json"], detail: String(error) }); }
    const normalizerReceipts = new Map(Object.values(publication.receipts).filter(r => r.actor === "normalizer").map(r => [r.operation_id, r]));
    const curationReceipts = new Map(Object.values(publication.receipts).filter(r => r.actor === "graph_curation").map(r => [r.operation_id, r]));
    const restorationNeedsEvaluation = (claim: NormalizationClaim, operation: unknown): boolean => {
      const key = normalizationClaimKey(claim), decision = [...curation.decisions].reverse().find(d => d.action !== "expire" && d.keys.includes(key));
      if (!decision || !["reopen", "restore"].includes(decision.action)) return false;
      const reviewed = curationReceipts.get(decision.id), normalized = normalizerReceipts.get(String(operation));
      return !reviewed || !normalized || normalized.revision.publication_sequence <= reviewed.revision.publication_sequence;
    };
    const normalizerResults = new Map<string, Raw>();
    const entities: GraphEntity[] = [], relationships: GraphRelationship[] = [];
    const by_identity = new Map<string, GraphEntity>();
    const by_legacy_id = new Map<string, GraphIdentity[]>();
    const rawStores = new Map<string, unknown>();
    const store_hashes: CanonicalGraphRead["store_hashes"] = {};
    const unavailable = new Set<string>();
    const asOf = new Date().toISOString();
    for (const family of CANONICAL_FAMILIES) {
      let raw: unknown;
      const addedKeys = new Set<string>();
      try {
        const body = await fs.readFile(dataPath(family.file), "utf8");
        raw = JSON.parse(stripBom(body));
        if (!Array.isArray(raw)) {
          const header = record.parse(raw);
          const metadata = header.metadata as Raw | undefined;
          const declared = text(header.schema_version ?? metadata?.schema_version);
          if (declared) {
            const compatibility = classifySchemaMajor(declared, storeDefinition(family.file).schema_major);
            if (compatibility !== "current" && compatibility !== "previous") throw new Error(`UNSUPPORTED_STORE_SCHEMA: ${family.file}: ${declared}`);
          }
        }
        const hash = publicationContentHash(body);
        store_hashes[family.file] = hash;
        if (publication.stores[family.file] && publication.stores[family.file].hash !== hash) throw new Error("UNPUBLISHED_STORE_CHANGE");
        rawStores.set(family.file, raw);
        const historicalConflicts = legacyConflicts(raw, family.file);
        const typedPlans = family.file === "plan_state.json" && (raw as Raw)?.schema === "dreamgraph.plan_authority.v1";
        if (typedPlans && Buffer.byteLength(body, "utf8") > 32 * 1024 * 1024) throw new Error("PLAN_AUTHORITY_CAPACITY_EXHAUSTED");
        const items = typedPlans ? projectPlanAuthorityEntities(raw, instance_id, publication.epoch, asOf)
          : arrayFrom(raw, family).map(payload => ({ kind: family.kind, payload }));
        for (const item of items) {
          const payload = record.parse(item.payload), entityKind = item.kind;
          if (entityKind === "candidate") {
            const decision = [...curation.decisions].reverse().find(d => d.target_id === payload.dream_id && d.target_type === payload.dream_type && d.action !== "expire");
            if (decision && ["reject", "retire"].includes(decision.action)) Object.assign(payload, { status: "rejected", human_disposition: decision });
          }
          if (payload._schema || payload._note) continue; // Explicit documented template placeholders.
          const id = legacyIdentity({ ...family, kind: entityKind }, payload);
          if (!id) throw new Error("MISSING_ENTITY_ID");
          const identity = { instance_id, kind: entityKind, id, ...(text(payload.source_repo) ? { repository_id: String(payload.source_repo) } : {}) };
          const key = graphIdentityKey(identity);
          if (by_identity.has(key)) throw new Error(`DUPLICATE_TYPED_ID: ${key}`);
          const entity = GraphEntitySchema.parse({ identity, label: text(payload.name ?? payload.title) ?? id,
            assertion_class: classify(entityKind, payload), confidence: confidence(payload.confidence),
            evidence: evidence(identity, payload, publication), payload });
          entities.push(entity);
          by_identity.set(key, entity);
          addedKeys.add(key);
          by_legacy_id.set(id, [...(by_legacy_id.get(id) ?? []), identity]);
        }
        const historicalGroups = new Map<string, number>();
        // Superseded revisions are resolved history, not a defect: only unresolved conflict groups are reported.
        for (const entry of historicalConflicts) if (entry.disposition !== "superseded") historicalGroups.set(entry.group_id, (historicalGroups.get(entry.group_id) ?? 0) + 1);
        for (const [group_id, variants] of historicalGroups) reasons.push({ code: "LEGACY_CONFLICT_PRESERVED",
          scope: [family.file, group_id], detail: `${variants} historical variants are withheld from active graph authority; no winner was selected.` });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT" && !publication.stores[family.file]) {
          store_hashes[family.file] = null;
          continue; // ADR-095 known optional bootstrap absence, not a fabricated data repair.
        }
        unavailable.add(family.file);
        const code = (error as NodeJS.ErrnoException).code === "ENOENT" ? "PUBLISHED_STORE_MISSING"
          : error instanceof SyntaxError ? "INVALID_STORE_JSON" : error instanceof z.ZodError ? "INVALID_STORE_SHAPE"
          : error instanceof Error ? /^[A-Z_]+(?=:|$)/.exec(error.message)?.[0] ?? "STORE_UNAVAILABLE" : "STORE_UNAVAILABLE";
        reasons.push({ code, scope: [family.file], detail: String(error) });
        // Do not expose a partial, malformed family as if it was a complete store.
        for (let index = entities.length - 1; index >= 0; index--) {
          if (addedKeys.has(graphIdentityKey(entities[index].identity))) {
            by_identity.delete(graphIdentityKey(entities[index].identity));
            entities.splice(index, 1);
          }
        }
      }
    }
    // Rebuild legacy lookup after excluding failed families.
    for (const operation of new Set(entities.map(e => e.payload.normalization_operation_id).filter((v): v is string => typeof v === "string"))) {
      const receipt = normalizerReceipts.get(operation);
      if (receipt) try { normalizerResults.set(operation, await readNormalizationResult(receipt)); }
      catch (error) { reasons.push({ code: "NORMALIZATION_RESULT_UNAVAILABLE", scope: [operation], detail: String(error) }); }
    }
    by_legacy_id.clear();
    for (const entity of entities) by_legacy_id.set(entity.identity.id, [...(by_legacy_id.get(entity.identity.id) ?? []), entity.identity]);
    function endpoint(id: string, kind?: unknown, repository_id?: string): GraphIdentity | null {
      let matches = by_legacy_id.get(id) ?? [];
      if (kind !== undefined) {
        const parsed = GraphKindSchema.safeParse(kind);
        if (!parsed.success) return null;
        matches = matches.filter(identity => identity.kind === parsed.data);
      }
      if (repository_id !== undefined) matches = matches.filter(identity => identity.repository_id === repository_id);
      return matches.length === 1 ? matches[0] : null;
    }
    const relationshipIds = new Set<string>();
    function edge(kind: GraphRelationship["kind"], source_ref: string, target_ref: string, payload: Raw,
      sourceKind?: unknown, targetKind?: unknown, evidenceRefs: GraphEntity["evidence"] = [], sourceRepo?: string, targetRepo?: string, assertion?: GraphRelationship["assertion_class"]): void {
      const source = endpoint(source_ref, sourceKind, sourceRepo), target = endpoint(target_ref, targetKind, targetRepo);
      let applicability: ReturnType<typeof assessClaimEvidence> | undefined;
      if (kind === "validated" && source && target) {
        const claim: NormalizationClaim = { type: "edge", from: source, to: target, relation: text(payload.relation) ?? "related" };
        const result = normalizerResults.get(String(payload.normalization_operation_id));
        const recorded = (Array.isArray(result?.promotedEdges) ? result.promotedEdges : []).find(e => (e as Raw).id === payload.id) as Raw | undefined;
        const assessment = recorded?.evidence_assessment as Raw | undefined;
        if (assessment && NormalizationClaimSchema.safeParse(assessment.claim).success && normalizationClaimKey(assessment.claim as NormalizationClaim) === normalizationClaimKey(claim)
          && Number.isSafeInteger(assessment.minimum_roots) && Number(assessment.minimum_roots) >= 1) {
          applicability = assessClaimEvidence(claim, claimEvidence, Number(assessment.minimum_roots));
          if (!curationAvailable || suppressedClaims.has(normalizationClaimKey(claim)) || restorationNeedsEvaluation(claim, payload.normalization_operation_id)) {
            applicability.state = "unproven"; applicability.reasons.push(!curationAvailable ? "curation_unavailable" : suppressedClaims.has(normalizationClaimKey(claim)) ? "human_disposition_requires_reopen" : "restoration_requires_current_normalization");
          }
          evidenceRefs = [...evidenceRefs, ...claimEvidenceReferences(applicability, claimEvidence)];
        }
      }
      const id = `${kind}:${digest([instance_id, sourceKind, sourceRepo, source_ref, targetKind, targetRepo, target_ref, payload])}`;
      if (relationshipIds.has(id)) {
        reasons.push({ code: "DUPLICATE_RELATIONSHIP", scope: [id], detail: "Repeated relationship retained once; no duplicate traversal or corroboration." });
        return;
      }
      relationshipIds.add(id);
      relationships.push(GraphRelationshipSchema.parse({ id, kind, source, target, source_ref, target_ref,
        relation: text(payload.relationship ?? payload.relation ?? payload.type) ?? "related",
        assertion_class: assertion ?? (kind === "validated" && payload.human_asserted === true ? "human_assertion" : kind === "fact" ? "source_assertion" : kind === "validated" && applicability?.state === "supported" ? "validated_insight" : kind === "tension" ? "tension" : "hypothesis"),
        confidence: confidence(payload.confidence), evidence: evidenceRefs.map(ref => kind === "validated" ? { ...ref, validation: applicability?.state === "supported" ? "validated" as const : applicability?.state === "disputed" ? "disputed" as const : "unreviewed" as const } : ref), payload: applicability ? { ...payload, current_evidence_assessment: applicability } : payload }));
      if (!source || !target) reasons.push({ code: "UNRESOLVED_ENDPOINT", scope: [id], detail: "A missing or ambiguous legacy endpoint needs an explicit kind; no entity was synthesized or merged." });
    }
    for (const entity of entities) {
      const raw = entity.payload;
      for (const link of Array.isArray(raw.links) ? raw.links : []) {
        const parsed = record.safeParse(link);
        if (!parsed.success || !text(parsed.data.target)) { reasons.push({ code: "INVALID_INLINE_LINK", scope: [graphIdentityKey(entity.identity)], detail: "Inline relationship lacks a target." }); continue; }
        edge("fact", entity.identity.id, String(parsed.data.target), parsed.data, entity.identity.kind, parsed.data.type, entity.evidence, entity.identity.repository_id, text(parsed.data.target_repository_id) ?? undefined,
          raw.source === "typed_plan_authority" ? "historical" : undefined);
      }
      if (entity.identity.kind === "data_model" && text(raw.datastore)) edge("fact", entity.identity.id, String(raw.datastore), { relationship: "stored_in" }, "data_model", "datastore", entity.evidence, entity.identity.repository_id);
      // Legacy storage is accepted only as an exact datastore ID, never a fuzzy name/kind match.
      if (entity.identity.kind === "data_model" && !text(raw.datastore) && text(raw.storage) && endpoint(String(raw.storage), "datastore")) edge("fact", entity.identity.id, String(raw.storage), { relationship: "stored_in", storage: raw.storage }, "data_model", "datastore", entity.evidence, entity.identity.repository_id);
      if (entity.identity.kind === "data_model") for (const relation of Array.isArray(raw.relationships) ? raw.relationships : []) {
        const parsed = record.safeParse(relation);
        if (!parsed.success || !text(parsed.data.target)) continue;
        edge("fact", entity.identity.id, String(parsed.data.target), { ...parsed.data, relationship: parsed.data.type }, "data_model", "data_model", entity.evidence, entity.identity.repository_id, text(parsed.data.target_repository_id) ?? undefined);
      }
      if (entity.identity.kind === "ui_element") {
        for (const owner of strings(raw.used_by)) edge("fact", entity.identity.id, owner, { relationship: "used_by" }, "ui_element", undefined, entity.evidence, entity.identity.repository_id);
        for (const child of strings(raw.children)) edge("fact", entity.identity.id, child, { relationship: "contains" }, "ui_element", "ui_element", entity.evidence, entity.identity.repository_id);
        for (const flow of strings(raw.flows)) edge("fact", entity.identity.id, flow, { relationship: "participates_in" }, "ui_element", "workflow", entity.evidence, entity.identity.repository_id);
      }
      if (entity.identity.kind === "validated" && text(raw.from) && text(raw.to)) edge("validated", String(raw.from), String(raw.to), raw, raw.from_kind, raw.to_kind, entity.evidence, text(raw.from_repository_id) ?? undefined, text(raw.to_repository_id) ?? undefined);
      if (entity.identity.kind === "tension") for (const id of strings(raw.entities)) edge("tension", entity.identity.id, id, { relationship: "affects" }, "tension", undefined, entity.evidence, entity.identity.repository_id);
    }
    // Promoted nodes keep REM provenance; present applicability requires the real normalizer receipt.
    for (const entity of entities) {
      const raw = entity.payload, result = normalizerResults.get(String(raw.normalization_operation_id));
      if (entity.identity.kind === "validated") {
        const relation = relationships.find(edge => edge.kind === "validated" && edge.payload.id === entity.identity.id);
        entity.assertion_class = relation?.assertion_class ?? "hypothesis";
        if (relation) entity.evidence = relation.evidence;
        if (relation?.payload.current_evidence_assessment) entity.payload = { ...raw, current_evidence_assessment: relation.payload.current_evidence_assessment };
      } else if (raw.origin === "rem" && ["feature", "workflow", "data_model"].includes(entity.identity.kind)) {
        const claim: NormalizationClaim = { type: "node", identity: entity.identity, label: entity.label, description: text(raw.description) ?? "" };
        const recorded = (Array.isArray(result?.promotedNodeClaims) ? result.promotedNodeClaims : []).find(c => NormalizationClaimSchema.safeParse(c).success && normalizationClaimKey(c as NormalizationClaim) === normalizationClaimKey(claim));
        const promo = (result?.receipt as Raw | undefined)?.applied_promotion_config as Raw | undefined;
        if (recorded && Number.isSafeInteger(promo?.promotion_evidence_count) && Number(promo?.promotion_evidence_count) >= 1) {
          const assessment = assessClaimEvidence(claim, claimEvidence, Number(promo!.promotion_evidence_count));
          if (!curationAvailable || suppressedClaims.has(normalizationClaimKey(claim)) || restorationNeedsEvaluation(claim, raw.normalization_operation_id)) {
            assessment.state = "unproven"; assessment.reasons.push(!curationAvailable ? "curation_unavailable" : suppressedClaims.has(normalizationClaimKey(claim)) ? "human_disposition_requires_reopen" : "restoration_requires_current_normalization");
          }
          entity.assertion_class = assessment.state === "supported" ? "validated_insight" : "hypothesis";
          entity.evidence.push(...claimEvidenceReferences(assessment, claimEvidence));
          entity.payload = { ...raw, current_evidence_assessment: assessment };
        }
      }
    }
    const dreamStore = rawStores.get("dream_graph.json") as Raw | undefined;
    const dreams = new Map<string, Raw>();
    const dreamEdges = Array.isArray(dreamStore?.edges) ? dreamStore.edges : [];
    const dreamIds = new Map<string, number>();
    for (const raw of dreamEdges) {
      const parsed = record.safeParse(raw);
      const id = parsed.success ? text(parsed.data.id) : null;
      if (id) dreamIds.set(id, (dreamIds.get(id) ?? 0) + 1);
    }
    if (!unavailable.has("dream_graph.json")) for (const raw of dreamEdges) {
      const parsed = record.safeParse(raw);
      if (!parsed.success || !text(parsed.data.id) || !text(parsed.data.from) || !text(parsed.data.to)) {
        reasons.push({ code: "INVALID_DREAM_EDGE", scope: ["dream_graph.json"], detail: "Dream relationship lacks stable identity/endpoints." }); continue;
      }
      if (dreamIds.get(String(parsed.data.id)) !== 1) {
        reasons.push({ code: "DUPLICATE_DREAM_EDGE_ID", scope: [String(parsed.data.id)], detail: "Ambiguous relationship identity excluded; candidate lookup cannot choose an arbitrary edge." });
        continue;
      }
      dreams.set(String(parsed.data.id), parsed.data);
      edge("dream", String(parsed.data.from), String(parsed.data.to), parsed.data, parsed.data.from_kind, parsed.data.to_kind, [], text(parsed.data.from_repository_id) ?? undefined, text(parsed.data.to_repository_id) ?? undefined);
    }
    for (const candidate of entities.filter(e => e.identity.kind === "candidate")) {
      if (candidate.payload.dream_type !== "edge") continue;
      const dream = dreams.get(String(candidate.payload.dream_id ?? candidate.identity.id));
      if (dream) edge("candidate", String(dream.from), String(dream.to), { ...dream, ...candidate.payload }, dream.from_kind, dream.to_kind, candidate.evidence, text(dream.from_repository_id) ?? undefined, text(dream.to_repository_id) ?? undefined);
      else reasons.push({ code: "CANDIDATE_ENDPOINTS_UNKNOWN", scope: [graphIdentityKey(candidate.identity)], detail: "Underlying dream edge is unavailable; candidate retained without invented endpoints." });
    }
    const state: ResultState = {
      availability: entities.length === 0 && unavailable.size ? "unavailable" : "available",
      completeness: reasons.length ? "partial" : "complete",
      freshness: reasons.some(r => r.code === "UNPUBLISHED_STORE_CHANGE") ? "stale" : unavailable.size ? "unknown" : publication.currency.source_reconciliation_revision ? "current" : "unknown",
      reasons,
    };
    const source_dependents = new Map<string, Set<string>>(), evidence_dependents = new Map<string, Set<string>>(), entity_dependents = new Map<string, Set<string>>();
    function dependency(index: Map<string, Set<string>>, input: string, dependent: string): void {
      const values = index.get(input) ?? new Set<string>();
      values.add(dependent);
      index.set(input, values);
    }
    for (const entity of entities) {
      const key = graphIdentityKey(entity.identity);
      for (const reference of entity.evidence) {
        dependency(evidence_dependents, reference.id, key);
        for (const parent of reference.ancestry) dependency(evidence_dependents, parent, key);
        if (reference.source_path) dependency(source_dependents, `${reference.source_repo ?? "unknown"}/${reference.source_path}`, key);
      }
    }
    for (const relationship of relationships) {
      for (const reference of relationship.evidence) {
        dependency(evidence_dependents, reference.id, relationship.id);
        for (const parent of reference.ancestry) dependency(evidence_dependents, parent, relationship.id);
        if (reference.source_path) dependency(source_dependents, `${reference.source_repo ?? "unknown"}/${reference.source_path}`, relationship.id);
      }
      if (relationship.source && relationship.target) {
        dependency(entity_dependents, graphIdentityKey(relationship.source), graphIdentityKey(relationship.target));
        dependency(entity_dependents, graphIdentityKey(relationship.target), graphIdentityKey(relationship.source));
      }
    }
    // Activity time alone says nothing about currency. Only durable, concrete source effects affect their dependents.
    try {
      for (const obligation of (await readChangeObligations()).entries.filter(entry => !["graph_committed", "failed"].includes(entry.state))) {
        const affected = new Set<string>();
        for (const scope of obligation.scope) {
          if (scope.startsWith("repository:")) {
            const repo=decodeURIComponent(scope.slice(11));
            for(const entity of entities) if(entity.identity.repository_id===repo || entity.evidence.some(ref=>ref.source_repo===repo)) affected.add(graphIdentityKey(entity.identity));
            continue;
          }
          if (!scope.startsWith("source:")) continue;
          const [repo, ...parts] = scope.slice(7).split("/").map(decodeURIComponent);
          const wanted = `${repo}/${parts.join("/")}`;
          const normalize = (value: string): string => {
            const path = value.replace(/\\/g, "/"); return process.platform === "win32" ? path.toLowerCase() : path;
          };
          for (const [source, dependents] of source_dependents) if (normalize(source) === normalize(wanted)) for (const dependent of dependents) affected.add(dependent);
        }
        const known = ["source_applied", "reconciliation_pending"].includes(obligation.state);
        reasons.push({ code: known ? "SOURCE_RECONCILIATION_PENDING" : "SOURCE_EFFECT_UNKNOWN", scope: [...obligation.scope, ...affected],
          detail: known ? "A managed source change awaits reconciliation in this scope; optional cognition is separate." : "Managed source effect outcome is unresolved in this scope; do not infer a current source postcondition." });
      }
    } catch (failure) {
      reasons.push({ code: "CHANGE_LEDGER_UNAVAILABLE", scope: [], detail: String(failure) });
    }
    state.completeness = reasons.length ? "partial" : "complete";
    if (reasons.some(reason => reason.code === "SOURCE_RECONCILIATION_PENDING")) state.freshness = "stale";
    else if (reasons.some(reason => ["SOURCE_EFFECT_UNKNOWN", "CHANGE_LEDGER_UNAVAILABLE"].includes(reason.code))) state.freshness = "unknown";
    for (const record of [...entities, ...relationships]) {
      const assessment = record.payload.current_evidence_assessment as ReturnType<typeof assessClaimEvidence> | undefined;
      if (assessment?.state !== "supported") continue;
      const gaps = claimCurrencyReasons(assessment.claim, state, "id" in record ? [record.id] : [graphIdentityKey(record.identity)]);
      if (!gaps.length) continue;
      record.assertion_class = "hypothesis";
      record.payload = { ...record.payload, current_evidence_assessment: { ...assessment, state: "unproven", reasons: [...assessment.reasons, ...gaps] } };
      record.evidence = record.evidence.map(ref => ({ ...ref, validation: "unreviewed" }));
    }
    const validation_pipeline = rawStores.has("candidate_edges.json")
      ? validationPipelineCounts(storeRows(rawStores.get("candidate_edges.json"), "results"),
        rawStores.has("validated_edges.json") ? storeRows(rawStores.get("validated_edges.json"), "edges") : null)
      : null;
    return { schema: "dreamgraph.graph_snapshot.v1", instance_id, revision: publication.revision,
      currency: publication.currency, state, entities, relationships, store_hashes, validation_pipeline, by_identity,
      source_dependents, evidence_dependents, entity_dependents };
  });
}

/** Role-specific callers select context, never reinterpret the selected record's truth class. */
export function projectGraphContext(snapshot: CanonicalGraphRead, input: {
  role: "task" | "dreamer" | "normalizer"; identities: GraphIdentity[];
}): { role: typeof input.role; graph: GraphEnvelope } {
  const selected = new Map<string, GraphEntity>();
  const missing: string[] = [];
  for (const identity of input.identities) {
    const entity = exactGraphEntity(snapshot, identity);
    if (entity) selected.set(graphIdentityKey(entity.identity), entity);
    else missing.push(graphIdentityKey(identity));
  }
  const records = [...selected.values()].map(entity => ({ record_type: "entity", ...entity }));
  const graph: GraphEnvelope = {
    schema: "dreamgraph.graph_result.v1", instance_id: snapshot.instance_id,
    revision: snapshot.revision, currency: snapshot.currency,
    state: { ...snapshot.state, completeness: missing.length ? "partial" : snapshot.state.completeness,
      reasons: [...snapshot.state.reasons, ...(missing.length ? [{ code: "MISSING_REQUIRED_ENTITY", scope: missing, detail: "Requested context is incomplete; no replacement entity was guessed." }] : [])] },
    records, scope: input.identities.map(graphIdentityKey), count: records.length, total: input.identities.length,
    continuation: null, generated_at: new Date().toISOString(),
  };
  return { role: input.role, graph };
}

export function exactGraphEntity(snapshot: CanonicalGraphRead, identity: GraphIdentity): GraphEntity | null {
  if (identity.instance_id !== snapshot.instance_id) throw new Error("INSTANCE_SCOPE_MISMATCH");
  const exact = snapshot.by_identity.get(graphIdentityKey(identity));
  if (exact || identity.repository_id !== undefined) return exact ?? null;
  const matches = snapshot.entities.filter(entity => entity.identity.kind === identity.kind && entity.identity.id === identity.id);
  if (matches.length > 1) throw new Error("AMBIGUOUS_ENTITY_ID: specify repository_id");
  return matches[0] ?? null;
}
