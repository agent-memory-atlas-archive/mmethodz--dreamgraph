/** Operator-only private transport projection; all graph records use generated core C17 schemas. */
import {z} from 'zod';
import {ComputerSessionSchema,ComputerTargetSchema,ComputerCapabilitySchema,ComputerReceiptSchema,ComputerObservationSchema} from '../graph-contracts.js';
const count=z.number().int().nonnegative();
export const ComputerOperatorSnapshotSchema=z.object({session:ComputerSessionSchema,targets:z.array(ComputerTargetSchema).min(1).max(16),capability:ComputerCapabilitySchema,
 worker_available:z.boolean(),pause_supported:z.boolean(),limits:z.object({max_actions:count,max_images:count,max_image_bytes:count,observation_bytes:count,expires_at:z.string().datetime({offset:true})}).strict(),
 usage:z.object({actions:count,images:count,image_bytes:count,observation_bytes:count}).strict(),last_receipt:ComputerReceiptSchema.nullable()}).strict();
export type ComputerOperatorSnapshot=z.infer<typeof ComputerOperatorSnapshotSchema>;
export const ComputerOperatorPageSchema=z.object({ok:z.literal(true),sessions:z.array(ComputerOperatorSnapshotSchema).max(32),total:count,next_cursor:z.string().nullable(),
 snapshot_hash:z.string().regex(/^sha256:[a-f0-9]{64}$/),history_scope:z.literal('active_execution_store')}).strict();
export const ComputerOperatorStatusSchema=ComputerOperatorSnapshotSchema.extend({ok:z.literal(true)});
/** Optional explicit ephemeral evidence read. The original control port remains image-free. */
export const COMPUTER_EVIDENCE_MAX_IMAGE_BYTES=1024*1024;
export const COMPUTER_EVIDENCE_MAX_RESPONSE_BYTES=2*1024*1024;
const hash=z.string().regex(/^sha256:[a-f0-9]{64}$/),id=z.string().min(1).max(1024);
export const ComputerEvidenceSchema=z.object({schema:z.literal('dreamgraph.computer_evidence.v1'),instance_id:id,execution_id:id,computer_session_id:id,fence:count,
 worker_available:z.boolean(),observation:z.object({observation:ComputerObservationSchema,summary:z.string().max(65536),expired:z.boolean(),image_observation:ComputerObservationSchema.optional(),
  image:z.object({mime_type:z.enum(['image/png','image/jpeg']),content_hash:hash,data_base64:z.string().min(4).max(4*Math.ceil(COMPUTER_EVIDENCE_MAX_IMAGE_BYTES/3)).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)}).strict().optional()}).strict().nullable()}).strict();
export type ComputerEvidence=z.infer<typeof ComputerEvidenceSchema>;
export const ComputerEvidenceReplySchema=ComputerEvidenceSchema.extend({ok:z.literal(true)});
export async function verifyComputerEvidence(value:unknown):Promise<ComputerEvidence>{
 const {ok,...evidence}=ComputerEvidenceReplySchema.parse(value),current=evidence.observation;if(!current)return evidence;
 const descriptor=current.observation,pixels=current.image_observation;
 if(descriptor.execution_id!==evidence.execution_id||pixels&&(pixels.execution_id!==evidence.execution_id||pixels.target_id!==descriptor.target_id
  ||pixels.target_generation!==descriptor.target_generation||pixels.kind!=='pixels'||!pixels.evidence_ids.includes(descriptor.id)))throw new Error('COMPUTER_EVIDENCE_DESCRIPTOR_MISMATCH');
 if(current.image){
  if(current.expired||!pixels||pixels.content_hash!==current.image.content_hash||pixels.expires_at!==descriptor.expires_at)throw new Error('COMPUTER_EVIDENCE_IMAGE_DESCRIPTOR_MISMATCH');
  const decoded=atob(current.image.data_base64),bytes=Uint8Array.from(decoded,char=>char.charCodeAt(0));
  if(bytes.byteLength>COMPUTER_EVIDENCE_MAX_IMAGE_BYTES||btoa(decoded)!==current.image.data_base64)throw new Error('COMPUTER_EVIDENCE_IMAGE_BYTE_BOUND');
  const digest=await globalThis.crypto.subtle.digest('SHA-256',bytes),actual='sha256:'+Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
  if(actual!==current.image.content_hash)throw new Error('COMPUTER_EVIDENCE_IMAGE_HASH_MISMATCH');
 }
 if(Date.parse(descriptor.expires_at)<=Date.now()){current.expired=true;delete current.image;}
 return evidence;
}
export interface ComputerOperatorPort {
 readonly baseUrl:string;
 listComputerSessions(page?:{cursor:string;snapshot_hash:string},signal?:AbortSignal):Promise<z.infer<typeof ComputerOperatorPageSchema>>;
 readComputerStatus(executionId:string,id:string,signal?:AbortSignal):Promise<ComputerOperatorSnapshot>;
 controlComputer(executionId:string,id:string,action:'pause'|'resume'|'stop'|'recover-stop',fence?:number,signal?:AbortSignal):Promise<ComputerOperatorSnapshot>;
 readComputerEvidence?(executionId:string,id:string,signal?:AbortSignal):Promise<ComputerEvidence>;
}
