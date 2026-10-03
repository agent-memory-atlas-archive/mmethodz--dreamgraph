/** Attribution is not independent evidence or a promotion grant. */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { ResolvedRolePolicy } from "../config/role-policy.js";
import type { LlmMessage, LlmResponse } from "./llm.js";
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const UsageSchema = z.object({ inputTokens: count.optional(), outputTokens: count.optional(), totalTokens: count.optional(),
  reasoningTokens: count.optional(), cachedInputTokens: count.optional(), cacheCreationInputTokens: count.optional() }).strict();
const AdmissionSchema = z.object({ run_id: z.string().min(1), attempt_ids: z.array(z.string().min(1)), calls: count,
  usage: UsageSchema.optional(), usage_by_call: z.array(UsageSchema.nullable()),
  usage_provenance: z.enum(["unavailable", "partial", "provider_reported"]) }).strict();

export const cognitiveHash = (value: unknown): string => "sha256:" + createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const CognitiveProvenanceSchema = z.object({
  schema: z.literal("dreamgraph.cognitive_provenance.v1"), role: z.enum(["dreamer", "normalizer"]),
  prompt_version: z.string().min(1), prompt_hash: z.string().min(1), schema_version: z.string().min(1), schema_hash: z.string().min(1),
  source_manifest_hash: z.string().min(1), source_ids: z.array(z.string().min(1)), ancestry_ids: z.array(z.string().min(1)),
  policy_fingerprint: z.string().min(1), provider: z.string().min(1), requested_model: z.string().min(1), reported_model: z.string().nullable(),
  adapter: z.string().min(1), api: z.string().min(1), effort: z.string().nullable(), retention: z.string().nullable(),
  output_contract: z.string().nullable(), response_hash: z.string().nullable(), outcome: z.enum(["completed", "failed"]),
  elapsed_ms: z.number().finite().nonnegative(), recorded_at: z.string().datetime(),
  admission: AdmissionSchema.nullable(),
  independence: z.literal("model_assessment_not_independent_evidence"),
}).strict();
export type CognitiveProvenance = z.infer<typeof CognitiveProvenanceSchema>;

/** Content-address the exact supplied context; source IDs do not attest source truth. */
export function cognitiveProvenance(input: {
  role: "dreamer" | "normalizer"; prompt_version: string; schema_version: string; messages: LlmMessage[];
  output_schema: Record<string, unknown>; source_context: unknown; source_ids: string[]; ancestry_ids?: string[];
  policy: Readonly<ResolvedRolePolicy>; elapsed_ms: number; response?: LlmResponse;
}): CognitiveProvenance {
  return Object.freeze(CognitiveProvenanceSchema.parse({ schema: "dreamgraph.cognitive_provenance.v1", role: input.role,
    prompt_version: input.prompt_version, prompt_hash: cognitiveHash(input.messages), schema_version: input.schema_version,
    schema_hash: cognitiveHash(input.output_schema), source_manifest_hash: cognitiveHash(input.source_context),
    source_ids: [...new Set(input.source_ids)].sort(), ancestry_ids: [...new Set(input.ancestry_ids ?? input.source_ids)].sort(),
    policy_fingerprint: input.policy.fingerprint, provider: input.policy.effective.provider,
    requested_model: input.policy.effective.model, reported_model: input.response?.model ?? null,
    adapter: input.policy.effective.adapter, api: input.policy.effective.api, effort: input.policy.effective.effort,
    retention: input.policy.effective.retention, output_contract: input.response?.outputContract?.mode ?? null,
    response_hash: input.response ? cognitiveHash(input.response.text) : null, outcome: input.response ? "completed" : "failed",
    elapsed_ms: input.elapsed_ms, recorded_at: new Date().toISOString(), admission: input.response?.admission ?? null,
    independence: "model_assessment_not_independent_evidence" }));
}
