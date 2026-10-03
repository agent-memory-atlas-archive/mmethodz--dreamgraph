/** Private C17 descriptors in the existing execution owner; never raw pixels, DOM or action text. */
import { z } from "zod";
import { ComputerCapabilitySchema, ComputerObservationSchema, ComputerReceiptSchema, ComputerSessionSchema, ComputerTargetSchema } from "../graph/contracts.js";
const id=z.string().min(1).max(1024),digest=z.string().regex(/^sha256:[a-f0-9]{64}$/),count=z.number().int().nonnegative();
export const ComputerLimitsSchema=z.object({max_actions:count.min(1).max(100),max_images:count.max(1000),
  max_image_bytes:count.max(100*1024*1024),observation_bytes:count.min(1).max(65536),
  expires_at:z.string().datetime({offset:true})}).strict();
export const ComputerJournalSchema=z.object({session:ComputerSessionSchema,targets:z.array(ComputerTargetSchema).min(1).max(16),
  capability:ComputerCapabilitySchema,intent_hash:digest,profile_hash:digest,worker_epoch:id,limits:ComputerLimitsSchema,
  stop_state:z.enum(["not_requested","requested","acknowledged","unknown"]),
  pause_state:z.enum(["not_requested","requested","acknowledged","unknown"]).default("not_requested"),
  observations:z.array(ComputerObservationSchema).max(128),
  actions:z.array(z.object({id,action_hash:digest,operation:id,postcondition_hash:digest,
    accepted_at:z.string().datetime({offset:true}),receipt:ComputerReceiptSchema}).strict()).max(100),
  usage:z.object({actions:count,images:count,image_bytes:count,observation_bytes:count}).strict(),
}).strict();
export type ComputerJournal=z.infer<typeof ComputerJournalSchema>;
