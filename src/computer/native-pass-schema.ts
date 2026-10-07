/** Core-owned private operator transport. C17/C05/C14 records remain canonical. */
import {z} from 'zod';
import {BudgetSchema,RolePolicySchema,ComputerCapabilitySchema,ManagedExecutionSnapshotSchema,PlanExecutionIntentSchema} from '../graph/contracts.js';
const id=z.string().min(1).max(1024),count=z.number().int().nonnegative();
export const NativeComputerScopeSchema=z.object({instance_id:id,worker:z.literal('isolated_playwright'),host:id,target_profile:id,origin:z.string().min(1).max(4096),path_prefix:z.string().min(1).max(4096),
 network:z.array(z.object({origin:z.string().min(1).max(4096),path_prefix:z.string().min(1).max(4096),methods:z.array(z.enum(['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'])).min(1).max(7),allow_query:z.boolean()}).strict()).max(64),
 blocked_origins:z.array(z.string().max(4096)).max(64),visual:z.object({enabled:z.boolean(),region:z.string().max(1024).nullable(),mask_selectors:z.array(z.string().max(1024)).max(256)}).strict(),redaction_rules:count,
 model:z.object({role:z.literal('computer_use'),provider:id,model:id,api:id,retention:RolePolicySchema.shape.retention,budget:BudgetSchema,policy_hash:id}).strict(),retention:z.literal('none'),
 limits:z.object({max_actions:count,max_images:count,max_image_bytes:count,expires_at:z.string().datetime({offset:true})}).strict(),
 postconditions:z.array(z.object({id,kind:id}).strict()).max(256),capability:ComputerCapabilitySchema}).strict();
const computerUseRoute=z.object({backend:z.enum(['dreamgraph-browser','codex-native','cua-runtime','unavailable']),summary:z.string().max(4096)}).strict().optional();
export const NativeComputerSetupSchema=z.union([NativeComputerScopeSchema.extend({ok:z.literal(true),available:z.boolean(),computer_use_route:computerUseRoute}),
 z.object({ok:z.literal(true),available:z.literal(false),route:z.literal('unavailable'),reasons:z.array(id).max(32),remedy:z.string().max(4096),computer_use_route:computerUseRoute}).strict()]);
export const NativeComputerPrepareRequestSchema=z.object({interact:z.boolean(),duration_ms:z.number().int().min(1000).max(300000)}).strict();
export const NativeComputerPreparationSchema=NativeComputerScopeSchema.extend({id:z.string().uuid(),execution_id:id,target_id:id,interact:z.boolean()});
export const NativeComputerConfirmationSchema=z.object({id:z.string().uuid(),execution_id:id,grant_id:id,expires_at:z.string().datetime({offset:true})}).strict();
export const NativeComputerCancellationSchema=z.object({id:z.string().uuid(),execution_id:id,status:z.literal('cancelled'),grant_revoked:z.boolean()}).strict();
export const NativeComputerPassRequestSchema=z.object({computer_preparation_id:z.string().uuid(),message:z.string().min(1).max(16384),
 autonomy_mode:z.enum(['manual','supervised','autonomous']),verbosity_mode:z.enum(['concise','balanced','detailed']),plan_id:id.optional(),plan_execution:PlanExecutionIntentSchema.optional()}).strict();
export const NativeComputerPassReplySchema=z.object({ok:z.literal(true),schema:z.literal('dreamgraph.native_computer_pass.v1'),execution_id:id,
 content:z.string().max(200000),provider:id,model:id,execution:ManagedExecutionSnapshotSchema}).strict();
export type NativeComputerSetup=z.infer<typeof NativeComputerSetupSchema>;
export type NativeComputerPreparation=z.infer<typeof NativeComputerPreparationSchema>;
export type NativeComputerConfirmation=z.infer<typeof NativeComputerConfirmationSchema>;
export type NativeComputerCancellation=z.infer<typeof NativeComputerCancellationSchema>;
export type NativeComputerPassRequest=z.infer<typeof NativeComputerPassRequestSchema>;
export type NativeComputerPassReply=z.infer<typeof NativeComputerPassReplySchema>;
