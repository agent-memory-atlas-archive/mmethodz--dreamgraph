/** Rebuildable read-only indexes. Content, instance and revision all bind reuse. */
import { createHash } from "node:crypto";
import type { CanonicalGraphRead } from "./read-model.js";
import { graphIdentityKey, type GraphEntity, type GraphRelationship } from "./contracts.js";

export function lexicalTokens(text: string): string[] {
  const original = text.normalize("NFC"), normalized = original.toLowerCase();
  const split = original.replace(/([\p{Ll}\p{N}])([\p{Lu}])/gu, "$1 $2").toLowerCase();
  const words = normalized.match(/[\p{L}\p{N}_]+(?:\+\+|#)?/gu) ?? [];
  const symbols = normalized.match(/[\p{L}\p{N}_]+(?:(?:::|\.|\/|-)[\p{L}\p{N}_]+)+/gu) ?? [];
  return [...words, ...symbols, ...(split === normalized ? [] : split.match(/[\p{L}\p{N}_]+(?:\+\+|#)?/gu) ?? [])];
}
export const lexicalTerms = (text: string): Set<string> => new Set(lexicalTokens(text));
export function knowledgeText(raw: Record<string, unknown>): string {
  return [...new Set(["description", "summary", "decision", "context", "rationale", "narrative_text", "hypothesis", "title", "statement", "meaning"]
    .flatMap(name => typeof raw[name] === "string" && raw[name] ? [raw[name] as string] : []))].join("\n");
}
export interface RetrievalIndex {
  key: string;
  documents: Map<string, Set<string>>;
  postings: Map<string, Set<string>>;
  document_frequency: Map<string, number>;
  by_evidence: Map<string, GraphEntity[]>;
  adjacency: Map<string, GraphRelationship[]>;
  cached: boolean;
}
const cache = new Map<string, RetrievalIndex>();
const MAX_INDEXES = 8, MAX_CACHE_BYTES = 16 * 1024 * 1024;
let cacheBytes = 0;
const sizes = new Map<string, number>();
export function retrievalContentKey(snapshot: CanonicalGraphRead): { key: string; bytes: number } {
  // Include actual content even for unpublished/disposable projections with reused revisions.
  // Revision alone cannot certify a caller-created or externally changed snapshot.
  const content = JSON.stringify({ instance: snapshot.instance_id, revision: snapshot.revision,
    stores: snapshot.store_hashes, entities: snapshot.entities, relationships: snapshot.relationships });
  return { key: createHash("sha256").update(content).digest("hex"), bytes: Buffer.byteLength(content) };
}
export function buildRetrievalIndex(snapshot: CanonicalGraphRead, key = retrievalContentKey(snapshot).key): RetrievalIndex {
  const index: RetrievalIndex = { key, documents: new Map(), postings: new Map(), document_frequency: new Map(),
    by_evidence: new Map(), adjacency: new Map(), cached: false };
  for (const entity of snapshot.entities) {
    const id = graphIdentityKey(entity.identity);
    const document = lexicalTerms(`${entity.identity.id} ${entity.label} ${knowledgeText(entity.payload)} ${JSON.stringify(entity.payload.keywords ?? [])} ${entity.payload.domain ?? ""}`);
    index.documents.set(id, document);
    for (const term of document) {
      const posting = index.postings.get(term) ?? new Set<string>(); posting.add(id); index.postings.set(term, posting);
      index.document_frequency.set(term, posting.size);
    }
    for (const evidence of entity.evidence) {
      const list = index.by_evidence.get(evidence.id) ?? []; list.push(entity); index.by_evidence.set(evidence.id, list);
    }
  }
  for (const relationship of snapshot.relationships) for (const endpoint of [relationship.source, relationship.target]) if (endpoint) {
    const id = graphIdentityKey(endpoint);
    const list = index.adjacency.get(id) ?? []; list.push(relationship); index.adjacency.set(id, list);
  }
  for (const edges of index.adjacency.values()) edges.sort((a, b) => a.id.localeCompare(b.id));
  return index;
}
export function getRetrievalIndex(snapshot: CanonicalGraphRead): RetrievalIndex {
  const { key, bytes } = retrievalContentKey(snapshot), previous = cache.get(key);
  if (previous) { cache.delete(key); cache.set(key, previous); return previous; }
  const index = buildRetrievalIndex(snapshot, key);
  // Large snapshots still have a correct transient index; they cannot evict all
  // other instances or cause unbounded retained memory. Approximate overhead conservatively.
  const size = bytes + [...index.documents.values()].reduce((sum, terms) => sum + [...terms].reduce((n, term) => n + Buffer.byteLength(term) + 80, 0), 0);
  if (size > MAX_CACHE_BYTES) return index;
  while (cache.size >= MAX_INDEXES || cacheBytes + size > MAX_CACHE_BYTES) {
    const oldest = cache.keys().next().value!; cache.delete(oldest); cacheBytes -= sizes.get(oldest) ?? 0; sizes.delete(oldest);
  }
  index.cached = true; cache.set(key, index); sizes.set(key, size); cacheBytes += size;
  return index;
}
export function indexedRelevance(index: RetrievalIndex, entity: GraphEntity, query: string, queryTerms: Set<string>): number {
  const id = graphIdentityKey(entity.identity);
  if (query === id || query === entity.identity.id) return 1;
  if (query && query.normalize("NFC").toLowerCase() === entity.label.normalize("NFC").toLowerCase()) return 0.95;
  const document = index.documents.get(id) ?? new Set();
  return [...queryTerms].filter(term => document.has(term)).length / Math.max(1, queryTerms.size);
}
