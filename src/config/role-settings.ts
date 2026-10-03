/** Pure role setting schemas shared by env validation and policy resolution. */
import { z } from "zod";
import { RolePolicySchema, BudgetSchema } from "../graph/contracts.js";
import { ProviderCapabilitySchema } from "./provider-capabilities.js";
export const ProviderSchema = z.enum(["ollama", "lmstudio", "openai", "anthropic", "sampling", "none"]);
export const ApiSchema = z.enum(["auto", "responses", "chat_completions", "messages", "native_cli", "local"]);
export const RoleSettingsSchema = z.object({
  provider: ProviderSchema.optional(), model: z.string().min(1).optional(), adapter: z.string().min(1).optional(),
  api: ApiSchema.optional(), effort: z.string().min(1).nullable().optional(),
  base_url: z.string().optional(), api_key_env: z.string().regex(/^[A-Z][A-Z0-9_]*$/).optional(),
  temperature: z.number().min(0).max(2).optional(), output_tokens: z.number().int().positive().optional(),
  context_tokens: z.number().int().positive().optional(), timeout_ms: z.number().int().positive().optional(),
  retention: z.enum(["provider_default", "store_false", "store_true", "zero_retention", "local_only"]).optional(),
  strict_schema: z.boolean().optional(), budget: BudgetSchema.partial().optional(),
  fallbacks: RolePolicySchema.shape.fallbacks.optional(),
  capability: ProviderCapabilitySchema.optional(),
}).strict();
export type RoleSettings = z.infer<typeof RoleSettingsSchema>;
