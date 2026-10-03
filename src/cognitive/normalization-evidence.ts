/** Claim-specific source observations. Model claims can cite these records, never mint them. */
import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { config } from "../config/config.js";
import { dataPath } from "../utils/paths.js";
import { stripBom } from "../utils/read-json.js";
import { withGraphRead, withGraphReconciliation } from "../utils/graph-reconciliation-barrier.js";
import { commitGraphWrites, findOperationReceipt, loadPublicationState, publicationContentHash } from "../graph/publication.js";
import { GraphIdentitySchema, graphIdentityKey, type GraphIdentity, type ResultState } from "../graph/contracts.js";

export const NORMALIZATION_EVIDENCE_FILE = "normalization_evidence.json";
export const NORMALIZATION_EVIDENCE_POLICY = "ashoka.independent-claims.v1";
const id = z.string().min(1).max(1024);
export const NormalizationClaimSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("edge"), from: GraphIdentitySchema, to: GraphIdentitySchema, relation: id }).strict(),
  z.object({ type: z.literal("node"), identity: GraphIdentitySchema, label: id, description: z.string().max(32768) }).strict(),
]);
export type NormalizationClaim = z.infer<typeof NormalizationClaimSchema>;
const SourceProofSchema = z.object({ repository_id: id, path: id, content_hash: z.string().regex(/^[a-f0-9]{64}$/),
  json_pointer: z.string().max(4096), independence_id: id }).strict();
export type ClaimSourceProof = z.infer<typeof SourceProofSchema>;
export const ClaimObservationSchema = z.object({
  id, claim: NormalizationClaimSchema, verdict: z.enum(["supports", "contradicts"]),
  origin: z.enum(["source", "human", "model", "derived", "imported"]), parents: z.array(id).max(64),
  source: SourceProofSchema.optional(), operation_id: id, observed_at: z.string().datetime({ offset: true }),
}).strict();
export type ClaimObservation = z.infer<typeof ClaimObservationSchema>;
const LedgerSchema = z.object({ schema: z.literal("dreamgraph.normalization_evidence.v1"),
  observations: z.array(ClaimObservationSchema).max(10000),
  withdrawals: z.array(z.object({ observation_id: id, operation_id: id, reason: id,
    at: z.string().datetime({ offset: true }) }).strict()).max(10000) }).strict();
export type ClaimEvidenceLedger = z.infer<typeof LedgerSchema>;
export interface ClaimEvidenceSnapshot {
  ledger: ClaimEvidenceLedger; hash: string | null;
  current_sources: Map<string, boolean>; unavailable: string[];
  physical_paths?: Map<string, string>;
}
export interface EvidenceAssessment {
  policy: typeof NORMALIZATION_EVIDENCE_POLICY; claim: NormalizationClaim;
  state: "supported" | "unproven" | "disputed" | "withdrawn";
  independent_roots: string[]; contradiction_roots: string[]; human_assertions: string[];
  ancestry: string[]; reasons: string[]; minimum_roots: number;
}
const stable = (v: unknown): string => v === null || typeof v !== "object" ? JSON.stringify(v)
  : Array.isArray(v) ? `[${v.map(stable).join(",")}]`
  : `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`;
export const normalizationClaimKey = (claim: NormalizationClaim): string => createHash("sha256").update(stable(NormalizationClaimSchema.parse(claim))).digest("hex");
const proofKey = (entry: ClaimObservation): string => stable([entry.source, normalizationClaimKey(entry.claim), entry.verdict]);
const rootKey = (entry: ClaimObservation): string => `lineage:${entry.source!.independence_id}`;
export const emptyClaimEvidenceSnapshot = (): ClaimEvidenceSnapshot => ({ ledger: { schema: "dreamgraph.normalization_evidence.v1", observations: [], withdrawals: [] }, hash: null, current_sources: new Map(), unavailable: [] });
const empty = (): ClaimEvidenceLedger => emptyClaimEvidenceSnapshot().ledger;

/** Only configured repositories; symlinks and JSON pointers cannot escape the source authority. */
async function sourceBody(source: ClaimSourceProof, budget?: { bytes: number }, resolved?: (relative: string) => void): Promise<Buffer> {
  const root = config.repos[source.repository_id];
  if (!root || path.isAbsolute(source.path) || source.path.split(/[\\/]/).some(p => p === ".." || p === "")) throw new Error("CLAIM_SOURCE_OUT_OF_SCOPE");
  const realRoot = await realpath(root), target = await realpath(path.resolve(realRoot, source.path));
  const relative = path.relative(realRoot, target);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("CLAIM_SOURCE_OUT_OF_SCOPE");
  resolved?.(relative.replace(/\\/g, "/"));
  const info = await stat(target);
  if (!info.isFile() || info.size > 2 * 1024 * 1024) throw new Error("CLAIM_SOURCE_BUDGET");
  if (budget && budget.bytes + info.size > 32 * 1024 * 1024) throw new Error("CLAIM_SOURCE_BUDGET");
  const body = await readFile(target);
  if (budget) budget.bytes += body.byteLength;
  if (body.byteLength > 2 * 1024 * 1024) throw new Error("CLAIM_SOURCE_BUDGET");
  return body;
}
function pointer(value: unknown, address: string): unknown {
  if (address === "") return value;
  if (!address.startsWith("/")) throw new Error("CLAIM_SOURCE_POINTER_INVALID");
  for (const part of address.slice(1).split("/")) {
    if (/~(?![01])/u.test(part)) throw new Error("CLAIM_SOURCE_POINTER_INVALID");
    const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!value || typeof value !== "object" || !Object.hasOwn(value, key)) throw new Error("CLAIM_SOURCE_POINTER_MISSING");
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}
async function checkProof(entry: ClaimObservation, budget?: { bytes: number }, resolved?: (relative: string) => void): Promise<boolean> {
  if (entry.origin !== "source" || !entry.source || entry.parents.length) return false;
  const body = await sourceBody(entry.source, budget, resolved);
  if (createHash("sha256").update(body).digest("hex") !== entry.source.content_hash) return false;
  // A source assertion proves exactly the encoded claim, not adjacent endpoints/keywords.
  const document=JSON.parse(stripBom(body.toString("utf8")));
  // Re-ingested narrator/export/model documents remain derived. Encoding a literal
  // observation inside their JSON cannot erase the original assertion boundary.
  function derived(value:unknown):boolean {
    if(!value||typeof value!=="object")return false;
    const row=value as Record<string,unknown>,projection=row.projection as Record<string,unknown>|undefined,metadata=row.metadata as Record<string,unknown>|undefined;
    return row.derived===true||projection?.derived===true||metadata?.derived===true||["derived","model","rem","imported"].includes(String(row.origin))||["historical","hypothesis"].includes(String(row.assertion_class));
  }
  let ancestor:unknown=document;if(derived(ancestor))return false;
  for(const segment of entry.source.json_pointer.split("/").slice(1,-1)){
    if(!ancestor||typeof ancestor!=="object")break;
    ancestor=(ancestor as Record<string,unknown>)[segment.replace(/~1/g,"/").replace(/~0/g,"~")];if(derived(ancestor))return false;
  }
  const observation = pointer(document, entry.source.json_pointer);
  return stable(observation) === stable({ claim: entry.claim, verdict: entry.verdict });
}
export async function loadClaimEvidence(): Promise<ClaimEvidenceSnapshot> {
  return withGraphRead(async () => {
    let body: string | null = null;
    try { body = await readFile(dataPath(NORMALIZATION_EVIDENCE_FILE), "utf8"); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    if (body && Buffer.byteLength(body) > 16 * 1024 * 1024) throw new Error("CLAIM_LEDGER_BUDGET");
    const ledger = body === null ? empty() : LedgerSchema.parse(JSON.parse(stripBom(body)));
    const hash = body === null ? null : publicationContentHash(body);
    const publication = await loadPublicationState();
    if (publication.stores[NORMALIZATION_EVIDENCE_FILE] && publication.stores[NORMALIZATION_EVIDENCE_FILE].hash !== hash) throw new Error("UNPUBLISHED_CLAIM_LEDGER_CHANGE");
    const seen = new Set<string>();
    for (const entry of ledger.observations) {
      if (seen.has(entry.id)) throw new Error("AMBIGUOUS_CLAIM_OBSERVATION");
      seen.add(entry.id);
    }
    const current_sources = new Map<string, boolean>(), unavailable: string[] = [];
    const physical_paths = new Map<string, string>();
    const budget = { bytes: 0 };
    for (const entry of ledger.observations) {
      if (!entry.source || current_sources.has(proofKey(entry))) continue;
      if (current_sources.size >= 256 || budget.bytes >= 32 * 1024 * 1024) {
        current_sources.set(proofKey(entry), false); unavailable.push(`${entry.id}:source_budget`); continue;
      }
      try {
        if (!publication.stores[NORMALIZATION_EVIDENCE_FILE]) {
          current_sources.set(proofKey(entry), false); unavailable.push(`${entry.id}:unpublished_claim_ledger`); continue;
        }
        const valid = await checkProof(entry, budget, relative => physical_paths.set(proofKey(entry), relative));
        current_sources.set(proofKey(entry), valid);
        if (!valid) unavailable.push(`${entry.id}:source_changed_or_claim_mismatch`);
      } catch (e) { current_sources.set(proofKey(entry), false); unavailable.push(`${entry.id}:${String(e)}`); }
    }
    return { ledger, hash, current_sources, unavailable, physical_paths };
  });
}

const evidenceIndexes = new WeakMap<ClaimEvidenceSnapshot, { byId: Map<string, ClaimObservation>; byClaim: Map<string, ClaimObservation[]>; withdrawn: Set<string> }>();
/** Snapshots are immutable within a read/pass; build the claim/ancestry index once. */
export function assessClaimEvidence(claim: NormalizationClaim, snapshot: ClaimEvidenceSnapshot, minimumRoots: number): EvidenceAssessment {
  NormalizationClaimSchema.parse(claim);
  if (!Number.isSafeInteger(minimumRoots) || minimumRoots < 1) throw new Error("CLAIM_MINIMUM_ROOTS_INVALID");
  let index = evidenceIndexes.get(snapshot);
  if (!index) {
    const byClaim = new Map<string, ClaimObservation[]>();
    for (const entry of snapshot.ledger.observations) { const key = normalizationClaimKey(entry.claim); const rows = byClaim.get(key) ?? []; rows.push(entry); byClaim.set(key, rows); }
    index = { byId: new Map(snapshot.ledger.observations.map(e => [e.id, e])), byClaim, withdrawn: new Set(snapshot.ledger.withdrawals.map(e => e.observation_id)) };
    evidenceIndexes.set(snapshot, index);
  }
  const claimKey = normalizationClaimKey(claim), { byId, withdrawn } = index, matching = index.byClaim.get(claimKey) ?? [];
  const supports = new Set<string>(), contradictions = new Set<string>(), humans = new Set<string>();
  const ancestry = new Set<string>(), reasons = new Set<string>();
  // Independence is producer-attributed lineage, not differing wrapper bytes.
  // Identical content additionally joins lineages so renamed/copied declarations count once.
  const parent = new Map<string, string>(), byContent = new Map<string, string>();
  const find = (key: string): string => { while (parent.has(key)) key = parent.get(key)!; return key; };
  for (const entry of matching) {
    if (entry.origin !== "source" || !entry.source) continue;
    const key = rootKey(entry), other = byContent.get(entry.source.content_hash);
    if (other && find(other) !== find(key)) parent.set(find(key), find(other));
    byContent.set(entry.source.content_hash, key);
  }
  let hadWithdrawal = false;
  // Visit each node once per claim, with at most 64 edges per node. Cycles never expand work.
  const colors = new Map<string, number>();
  for (const entry of matching) {
    const stack: Array<{ id: string; verdict: ClaimObservation["verdict"]; exit?: boolean }> = [{ id: entry.id, verdict: entry.verdict }];
    while (stack.length) {
      const next = stack.pop()!, node = byId.get(next.id);
      ancestry.add(next.id);
      if (next.exit) { colors.set(next.id, 2); continue; }
      if (!node || normalizationClaimKey(node.claim) !== claimKey || node.verdict !== next.verdict) { reasons.add("unknown_or_different_claim_ancestor"); continue; }
      if (colors.get(node.id) === 1) { reasons.add("ancestry_cycle"); continue; }
      if (colors.get(node.id) === 2) continue;
      colors.set(node.id, 1); stack.push({ id: node.id, verdict: node.verdict, exit: true });
      if (withdrawn.has(node.id)) { hadWithdrawal = true; reasons.add("withdrawn_observation"); continue; }
      if (node.origin === "human") { humans.add(node.id); continue; }
      if (node.origin === "source") {
        if (node.parents.length || !node.source || !snapshot.current_sources.get(proofKey(node))) {
          const unknown = node.parents.length || !node.source || snapshot.unavailable.some(reason => reason.startsWith(`${node.id}:`) && !/source_changed_or_claim_mismatch|ENOENT/.test(reason));
          if (!unknown) hadWithdrawal = true;
          reasons.add(unknown ? "source_proof_unavailable" : "source_proof_not_current"); continue;
        }
        (node.verdict === "supports" ? supports : contradictions).add(find(rootKey(node))); continue;
      }
      if (!node.parents.length) { reasons.add("generated_claim_without_source_ancestry"); continue; }
      for (const ancestor of node.parents) stack.push({ id: ancestor, verdict: node.verdict });
    }
  }
  const state = contradictions.size ? "disputed" : supports.size >= minimumRoots ? "supported" : hadWithdrawal ? "withdrawn" : "unproven";
  if (supports.size < minimumRoots) reasons.add("insufficient_independent_claim_roots");
  return { policy: NORMALIZATION_EVIDENCE_POLICY, claim, state, independent_roots: [...supports].sort(),
    contradiction_roots: [...contradictions].sort(), human_assertions: [...humans].sort(), ancestry: [...ancestry].sort(),
    reasons: [...reasons].sort(), minimum_roots: minimumRoots };
}

/** Internal source producer port. No MCP/model input can nominate a validated root. */
export async function publishSourceClaimObservation(input: {
  id: string; claim: NormalizationClaim; verdict: ClaimObservation["verdict"]; source: ClaimSourceProof; operation_id: string;
}): Promise<void> {
  const observation = ClaimObservationSchema.parse({ ...input, origin: "source", parents: [], observed_at: new Date().toISOString() });
  const intent = { ...input, producer: "exact_json_source_observation.v1" };
  await withGraphReconciliation(async () => {
    const prior = await findOperationReceipt(input.operation_id, "normalization_evidence");
    if (prior) { await commitGraphWrites({ writes: [], actor: "normalization_evidence", operation_id: input.operation_id,
      scope: [NORMALIZATION_EVIDENCE_FILE], intent }); return; }
    const current = await loadClaimEvidence();
    if (current.ledger.observations.some(e => e.id === input.id)) throw new Error("CLAIM_OBSERVATION_ID_EXISTS");
    if (!await checkProof(observation)) throw new Error("CLAIM_SOURCE_PROOF_REJECTED");
    const next = LedgerSchema.parse({ ...current.ledger, observations: [...current.ledger.observations, observation] });
    await commitGraphWrites({ writes: [{ file: NORMALIZATION_EVIDENCE_FILE, content: JSON.stringify(next, null, 2) }],
      actor: "normalization_evidence", operation_id: input.operation_id, scope: [NORMALIZATION_EVIDENCE_FILE], intent,
      expected_store_hashes: { [NORMALIZATION_EVIDENCE_FILE]: current.hash },
      check_expected: async () => { if (!await checkProof(observation)) throw new Error("CLAIM_SOURCE_CHANGED_BEFORE_COMMIT"); } });
  });
}
/** Revocation retains the original observation and its publication receipt. */
export async function withdrawClaimObservation(input: { observation_id: string; reason: string; operation_id: string }): Promise<void> {
  await withGraphReconciliation(async () => {
    const prior = await findOperationReceipt(input.operation_id, "normalization_evidence");
    if (prior) { await commitGraphWrites({ writes: [], actor: "normalization_evidence", operation_id: input.operation_id,
      scope: [NORMALIZATION_EVIDENCE_FILE], intent: input }); return; }
    const current = await loadClaimEvidence();
    if (!current.ledger.observations.some(e => e.id === input.observation_id)) throw new Error("CLAIM_OBSERVATION_UNKNOWN");
    const next = LedgerSchema.parse({ ...current.ledger, withdrawals: [...current.ledger.withdrawals, { ...input, at: new Date().toISOString() }] });
    await commitGraphWrites({ writes: [{ file: NORMALIZATION_EVIDENCE_FILE, content: JSON.stringify(next, null, 2) }],
      actor: "normalization_evidence", operation_id: input.operation_id, scope: [NORMALIZATION_EVIDENCE_FILE], intent: input,
      expected_store_hashes: { [NORMALIZATION_EVIDENCE_FILE]: current.hash } });
  });
}

export function sameClaimIdentity(left: GraphIdentity, right: GraphIdentity): boolean { return graphIdentityKey(left) === graphIdentityKey(right); }

/** Known affected scopes are material. Full-scan age and unrelated source debt are not. */
export function claimCurrencyReasons(claim: NormalizationClaim, state: ResultState, additionalScopes: string[] = []): string[] {
  const identities = claim.type === "edge" ? [claim.from, claim.to] : [claim.identity];
  const normalize = (scope: string): string => scope.startsWith("source:") && process.platform === "win32" ? scope.toLowerCase() : scope;
  const keys = new Set([...identities.map(graphIdentityKey), ...additionalScopes].map(normalize));
  return state.reasons.filter(reason => reason.code === "CHANGE_LEDGER_UNAVAILABLE"
    || ["SOURCE_RECONCILIATION_PENDING", "SOURCE_EFFECT_UNKNOWN"].includes(reason.code) && reason.scope.some(scope => keys.has(normalize(scope))))
    .map(reason => reason.code);
}
/** A claim's own witnesses are read dependencies, even before it has graph endpoints. */
export function claimSourceScopes(assessment: EvidenceAssessment, snapshot: ClaimEvidenceSnapshot): string[] {
  return claimEvidenceReferences(assessment, snapshot).filter(ref => ref.source_path && ref.source_repo).map(ref =>
    `source:${encodeURIComponent(ref.source_repo!)}/${ref.source_path!.replace(/\\/g, "/").split("/").map(encodeURIComponent).join("/")}`);
}
/** Literal source provenance, including withdrawn/disputed observations, remains inspectable. */
export function claimEvidenceReferences(assessment: EvidenceAssessment, snapshot: ClaimEvidenceSnapshot): import("../graph/contracts.js").GraphEntity["evidence"] {
  const ancestry = new Set(assessment.ancestry);
  return snapshot.ledger.observations.filter(o => ancestry.has(o.id) && o.origin === "source" && o.source).map(o => ({
    id: o.id, origin: "source" as const, ancestry: o.parents, revision: o.operation_id, observed_at: o.observed_at,
    source_repo: o.source!.repository_id, source_path: snapshot.physical_paths?.get(proofKey(o)) ?? o.source!.path, content_hash: o.source!.content_hash,
    validation: assessment.state === "disputed" ? "disputed" as const : assessment.state === "supported" && snapshot.current_sources.get(proofKey(o)) ? "validated" as const : "unreviewed" as const,
  }));
}
