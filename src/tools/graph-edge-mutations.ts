/**
 * DreamGraph MCP Server — direct validated-edge mutation tools.
 *
 * Provides an operator-facing escape hatch for maintaining the validated
 * edge store when legacy/speculative edges should be retired or redirected.
 *
 * Scope in v1:
 *   - mutate VALIDATED edges only (validated_edges.json)
 *   - actions: delete, retarget
 *
 * Why not entity visibility here?
 *   Graph-entity visibility is not currently a first-class persisted concept
 *   in the fact graph schema. Direct validated-edge mutation is the strongly
 *   grounded capability the system already models and persists.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { curateGraph } from "../cognitive/curation.js";
import { loadCanonicalGraph } from "../graph/read-model.js";
import { getActiveScope } from "../instance/index.js";
import { withGraphReconciliation } from "../utils/graph-reconciliation-barrier.js";
import type { DreamEdge } from "../cognitive/types.js";
import { engine } from "../cognitive/engine.js";
import { invalidateCache, loadJsonArray } from "../utils/cache.js";
import { success, error, safeExecute } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import type {
  Feature,
  Workflow,
  DataModelEntity,
  CapabilityEntity,
  ToolResponse,
  ValidatedEdge,
} from "../types/index.js";

interface GraphEdgeMutationResult {
  action: "delete" | "retarget";
  edge_id: string;
  affected_ids: string[];
  updated?: ValidatedEdge;
  removed?: ValidatedEdge;
  total_validated: number;
  message: string;
  receipt?: unknown;
  assertion_class?: string;
}

function normalizeRelation(input?: string | null): string | undefined {
  const s = typeof input === "string" ? input.trim() : "";
  return s.length > 0 ? s : undefined;
}

export async function executeGraphEdgeMutation(params: {
  action: "delete" | "retarget";
  edge_id: string;
  new_from?: string;
  new_to?: string;
  relation?: string;
  allow_dangling_target?: boolean;
  reason?: string; expected_revision?: string | null; operation_id?: string; dry_run?: boolean;
}): Promise<ToolResponse<GraphEdgeMutationResult>> {
  return safeExecute<GraphEdgeMutationResult>(() => withGraphReconciliation(async () => {
    if (!params.reason?.trim() || params.expected_revision === undefined) return error("VALIDATION_ERROR", "reason and expected_revision are required for reversible curation");
    const validated = await engine.loadValidatedEdges(), existing = validated.edges.find(e => e.id === params.edge_id);
    if (!existing) return error("NOT_FOUND", `Validated edge not found: ${params.edge_id}`);
    let replacement: DreamEdge | undefined;
    if (params.action === "retarget") {
      if (params.allow_dangling_target) return error("VALIDATION_ERROR", "Retarget requires resolved typed canonical endpoints; external references must use a separate explicit assertion");
      const graph = await loadCanonicalGraph(getActiveScope()?.uuid ?? "legacy");
      const from = params.new_from ?? existing.from, to = params.new_to ?? existing.to;
      const matches = (id: string) => graph.entities.filter(e => e.identity.id === id && !["candidate", "validated", "dream_node"].includes(e.identity.kind));
      const a = matches(from), b = matches(to);
      if (a.length !== 1 || b.length !== 1 || from === to) return error("UNKNOWN_ENTITY", "Retarget endpoints are missing, ambiguous or identical");
      replacement = { id: `curated_${params.operation_id ?? Date.now()}`, from, to, relation: normalizeRelation(params.relation) ?? existing.relation,
        from_kind: a[0].identity.kind, to_kind: b[0].identity.kind, from_repository_id: a[0].identity.repository_id ?? undefined, to_repository_id: b[0].identity.repository_id ?? undefined,
        type: "hypothetical", reason: params.reason, confidence: existing.confidence, origin: "rem", created_at: new Date().toISOString(), dream_cycle: 0,
        strategy: existing.strategy ?? "gap_detection", ttl: 8, decay_rate: .05, reinforcement_count: 0, last_reinforced_cycle: 0,
        status: "candidate", activation_score: 0, plausibility: 0, evidence_score: 0, contradiction_score: 0 };
    }
    const committed = await curateGraph({ target_id: params.edge_id, target_type: "edge", action: "retire", actor: "operator", reason: params.reason,
      expected_revision: params.expected_revision, operation_id: params.operation_id, replacement, dry_run: params.dry_run });
    invalidateCache("validated_edges.json");
    return success({ action: params.action, edge_id: params.edge_id, removed: existing,
      affected_ids: [...new Set([existing.from, existing.to, replacement?.from, replacement?.to].filter(Boolean))] as string[],
      total_validated: (await engine.loadValidatedEdges()).edges.length,
      receipt: committed.receipt, assertion_class: replacement ? "human_assertion_pending_revalidation" : "retired",
      message: params.dry_run ? "Curation preview; no graph write" : replacement ? "Original relationship archived and suppressed; replacement is an explicit human proposal requiring revalidation" : "Relationship reversibly retired; rediscovery requires reopen" });
  }), "executeGraphEdgeMutation");
}

export function registerGraphEdgeMutationTools(server: McpServer): void {
  server.tool(
    "mutate_validated_edge",
    "Directly mutate a validated graph edge in validated_edges.json. Supports deleting a stale edge or retargeting an existing edge to new canonical endpoints. Use sparingly for graph hygiene and ADR-backed canonicalization work.",
    {
      action: z.enum(["delete", "retarget"]).describe("Mutation to apply to the validated edge."),
      edge_id: z.string().min(1).describe("Validated edge id to mutate."),
      reason: z.string().min(1).max(2048).describe("Operator reason retained in the immutable curation decision."),
      expected_revision: z.string().nullable().describe("Current canonical graph revision; null only before the first publication."),
      operation_id: z.string().min(1).optional().describe("Stable id for retry recovery."),
      dry_run: z.boolean().optional().describe("Preview archives and affected records without writing."),
      new_from: z.string().optional().describe("New source entity id for retarget action."),
      new_to: z.string().optional().describe("New target entity id for retarget action."),
      relation: z.string().optional().describe("Optional replacement relation for retarget action."),
      allow_dangling_target: z.boolean().optional().describe("Allow new_to to point outside known seed entities. Defaults to false."),
    },
    async ({ action, edge_id, new_from, new_to, relation, allow_dangling_target, reason, expected_revision, operation_id, dry_run }) => {
      if (action === "retarget" && !new_from && !new_to && !normalizeRelation(relation)) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                error("VALIDATION_ERROR", "retarget requires at least one of new_from, new_to, or relation"),
                null,
                2,
              ),
            },
          ],
        };
      }

      const result = await executeGraphEdgeMutation({
        action,
        edge_id,
        new_from,
        new_to,
        relation,
        allow_dangling_target, reason, expected_revision, operation_id, dry_run,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );
}
