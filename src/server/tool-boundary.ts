/** Shared machine-result/permission boundary; never retries or invents rollback. */
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
export { serializeMcpResult } from "../utils/mcp-result.js";
import { coreToolPolicy } from "./tool-policy.js";
import { getSessionContext } from "./session-context.js";
import { getActiveSession } from "../discipline/session.js";
import { currentApprovedPlan } from "../discipline/approval.js";
import { checkToolPermission } from "../discipline/tool-proxy.js";
import type { ZodRawShape } from "zod";
import { z } from "zod";
import { reserveExecutionAction, reviewExecutionAction } from "./execution-policy.js";
import { assertManagedContext, recordManagedEffect } from "../graph/execution-context.js";
import { loadPublicationState } from "../graph/publication.js";
import { withGraphReconciliation } from "../utils/graph-reconciliation-barrier.js";
import { storeDefinition } from "../graph/store-registry.js";
export const TOOL_CONTRACT_VERSION = 1;
const MAX_RESULT_BYTES = 8 * 1024 * 1024;
// These owners stage slow work outside their own atomic publication/lease boundaries.
const stagedOwners = new Set(["scan_project", "scan_database", "enrich_parser_nodes", "bootstrap_instance", "lucid_dream", "lucid_action", "export_living_docs", "webhook_test", "webhook_replay"]);
export function toolBoundaryError(tool: string, code: string, message: string): CallToolResult {
  const payload = { success: false, error: { code, message } };
  return { isError: true, structuredContent: payload, content: [{ type: "text", text: JSON.stringify(payload) }],
    _meta: { dreamgraph: { schema: "dreamgraph.tool_result_metadata.v1", contract_version: 1, tool, outcome: "failed", effect: coreToolPolicy(tool).effect } } };
}
/** Text/media/resource blocks and original structured data remain literal. */
export function normalizeToolResult(tool: string, input: unknown): CallToolResult {
  if (!input || typeof input !== "object" || !Array.isArray((input as CallToolResult).content)) return toolBoundaryError(tool, "TOOL_RESULT_INVALID", "Owner returned an invalid MCP result.");
  const result = input as CallToolResult;
  if (Buffer.byteLength(JSON.stringify(result)) > MAX_RESULT_BYTES) return toolBoundaryError(tool, "OUTPUT_LIMIT_EXCEEDED", "Complete result exceeds the machine-result limit; use bounded owner queries. No data was clipped.");
  let structured = result.structuredContent;
  if (!structured && result.content.length === 1 && result.content[0].type === "text") {
    try { const candidate = JSON.parse(result.content[0].text); if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) structured = candidate; } catch { /* Plain source/text is literal. */ }
  }
  const failed = result.isError === true || structured?.success === false;
  return { ...result, ...(structured ? { structuredContent: structured } : {}), ...(failed ? { isError: true } : {}),
    _meta: { ...result._meta, dreamgraph: { ...(result._meta?.dreamgraph as object ?? {}), schema: "dreamgraph.tool_result_metadata.v1",
      contract_version: TOOL_CONTRACT_VERSION, tool, outcome: failed ? "failed" : "completed", effect: coreToolPolicy(tool).effect,
      session_id: getSessionContext()?.session_id ?? null, execution: "owner_specific", receipt: "owner_specific; no generic commit attestation" } } };
}
export async function invokeToolBoundary(input: { name: string; shape: ZodRawShape; args: unknown;
  extra?: { signal?: AbortSignal; _meta?: Record<string, unknown> }; handler: () => unknown | Promise<unknown> }) {
  const { name, extra } = input;
  if (extra?.signal?.aborted) return toolBoundaryError(name, "REQUEST_CANCELLED", "Request cancelled before dispatch; no owner handler ran.");
  const requested = (extra?._meta?.dreamgraph as { contract_version?: unknown } | undefined)?.contract_version;
  if (requested !== undefined && requested !== TOOL_CONTRACT_VERSION) return toolBoundaryError(name, "CONTRACT_VERSION_UNSUPPORTED", "This daemon accepts tool contract version 1; refresh capabilities.");
  if (!z.object(input.shape).strict().safeParse(input.args ?? {}).success) return toolBoundaryError(name, "INVALID_INPUT", "Arguments do not match the registered owner schema.");
  const session = getActiveSession();
  if (session?.status === "active" && !name.startsWith("discipline_")) {
    const args = (input.args ?? {}) as Record<string, unknown>;
    const target = typeof args.filePath === "string" ? args.filePath : typeof args.file_path === "string" ? args.file_path : undefined;
    const permission = checkToolPermission(name, target);
    if (!permission.permitted) return toolBoundaryError(name, "PERMISSION_DENIED", permission.reason);
    const approved = permission.requires_plan_entry ? currentApprovedPlan(session) : null;
    if (permission.requires_plan_entry && (!approved || (target && !approved.items.some(item => item.target_file.replace(/\\/g, "/") === target.replace(/\\/g, "/")))))
      return toolBoundaryError(name, "APPROVED_PLAN_REQUIRED", "A current, content-bound applicable approved plan is required before dispatch.");
  }
  let releaseAction: (() => void) | undefined;
  try {
    const engineActions=new Set(["dream_cycle","normalize_dreams","nightmare_cycle","metacognitive_analysis","generate_narrative","import_dream_archetypes"]);
    const policy=getSessionContext()?.execution_policy;
    const effect = !coreToolPolicy(name).read_only;
    // Never hold a graph writer or admit a durable job while waiting for an operator.
    try { await reviewExecutionAction(policy, name, input.args, extra?.signal); }
    catch (error) { throw new Error(`EXECUTION_POLICY_DENIED: ${String(error)}`); }
    const admit=async()=>{
      try {
        if (effect && policy?.context_id) await assertManagedContext(policy.context_id, {
          repair_source: name === "scan_project" && (input.args as Record<string, unknown>)?.mode === "incremental"
            && (input.args as Record<string, unknown>)?.enrich !== true && (input.args as Record<string, unknown>)?.dry_run !== true,
        });
        releaseAction = reserveExecutionAction(policy, name, input.args);
      } catch (error) { throw new Error(`EXECUTION_POLICY_DENIED: ${String(error)}`); }
    };
    const dispatch=async(admitted=false)=>{
      if (!admitted) await admit();
      else {
        policy?.signal.throwIfAborted();
        if (effect && policy?.context_id) await assertManagedContext(policy.context_id);
      }
      const before = effect && policy?.context_id ? await loadPublicationState() : null;
      try {
        const raw = await input.handler();
        if (before && policy?.context_id) {
          const after = await loadPublicationState();
          const receipts = Object.entries(after.receipts).filter(([key, receipt]) => !before.receipts[key]
            && receipt.scope.includes(`execution:${policy.id}`)).map(([, receipt]) => receipt);
          const receipt_ids = receipts.filter(receipt => receipt.affected_files.some(file => storeDefinition(file).graph)).map(receipt => receipt.operation_id);
          const state_receipt_ids = receipts.filter(receipt => receipt.affected_files.some(file => file !== "execution_contexts.json" && !storeDefinition(file).graph))
            .map(receipt => receipt.operation_id);
          const failed = (raw as CallToolResult)?.isError || (raw as CallToolResult)?.structuredContent?.success === false;
          await recordManagedEffect(policy.context_id, { tool: name, outcome: failed ? "unknown" : "owner_returned", receipt_ids, state_receipt_ids });
        }
        return raw;
      } catch (error) {
        if (before && policy?.context_id) {
          try { await recordManagedEffect(policy.context_id, { tool: name, outcome: "unknown", receipt_ids: [] }); }
          catch (recordError) { throw new Error(`EFFECT_CONTEXT_RECORD_UNAVAILABLE: ${String(recordError)}; original effect outcome: ${String(error)}`); }
        }
        throw error;
      }
    };
    let raw: unknown;
    if (engineActions.has(name)) {
      // Reject an unapproved/context-deficient action before admitting any durable engine job.
      await admit();
      raw = await (await import("../cognitive/jobs.js")).withEngineJob({
      operation_id:`mcp:${name}:${crypto.randomUUID()}`, action:name, owner:getSessionContext()?.principal??"mcp",
      session_id:getSessionContext()?.session_id, scope:["engine"], parameters:input.args as Record<string,unknown>,
      ...(policy?{execution_id:policy.id,authority:{id:policy.id,revision:policy.revision,scope:policy.scope,expires_at:policy.expires_at,autonomy:policy.autonomy}}:{}),
      roles:name==="dream_cycle"?["dreamer","normalizer"]:["normalizer"], lifetime:"session_bound",
      },()=>dispatch(true),policy?AbortSignal.any([policy.signal,...(extra?.signal?[extra.signal]:[])]):extra?.signal);
    } else raw = effect && policy?.context_id && !stagedOwners.has(name) ? await withGraphReconciliation(dispatch) : await dispatch();
    const result = normalizeToolResult(name, raw);
    if (extra?.signal?.aborted) result._meta = { ...result._meta, request_cancelled_after_dispatch: true, effect_status: "consult_owner_receipt; cancellation_is_not_rollback" };
    return result;
  } catch (error) {
    return toolBoundaryError(name, extra?.signal?.aborted ? "REQUEST_CANCELLED_EFFECT_UNKNOWN" : error instanceof Error && error.message.startsWith("EXECUTION_POLICY_DENIED:") ? "EXECUTION_POLICY_DENIED" : "OWNER_FAILURE",
      error instanceof Error ? error.message : "Owner dependency failed; effect status must be recovered from its receipt.");
  } finally {
    releaseAction?.();
  }
}
