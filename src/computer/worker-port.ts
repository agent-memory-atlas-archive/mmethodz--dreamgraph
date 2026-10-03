/** Ephemeral executor-local port. Platform handles and unfiltered screenshots never enter graph JSON. */
import type {z} from "zod";
import type {ComputerActionSchema,ComputerTargetSchema} from "../graph/contracts.js";
import type {ComputerQualification,ComputerWorkerProbe} from "./capabilities.js";
export type ComputerAction=z.infer<typeof ComputerActionSchema>;
export type ComputerTarget=z.infer<typeof ComputerTargetSchema>;
export interface ComputerWorkerObservation {
  epoch:string;target:ComputerTarget;kind:"dom"|"accessibility"|"pixels"|"api_state";
  summary:string;content_hash:string;captured_at:string;
  /** Already filtered within the worker, before it crosses the private channel. */
  image?:{mime_type:"image/png"|"image/jpeg";bytes:Uint8Array;content_hash?:string};
}
export interface ComputerWorkerPort {
  probe:ComputerWorkerProbe;qualification:ComputerQualification;
  open(target:ComputerTarget,signal:AbortSignal):Promise<void>;
  observe(target:ComputerTarget,signal:AbortSignal):Promise<ComputerWorkerObservation>;
  /** A resolved result describes independently checked target state, not successful graph reconciliation. */
  act(action:ComputerAction,signal:AbortSignal):Promise<{input_delivered:boolean;postcondition_met:boolean;observation:ComputerWorkerObservation}>;
  /** Optional observed-boundary pause. Unsupported backends keep independent Stop available. */
  pause?():Promise<{epoch:string;input_released:boolean;paused:boolean}>;
  /** Original peer only: refreshed target evidence, no new epoch or renewed grant. */
  resume?(target:ComputerTarget,signal:AbortSignal):Promise<ComputerWorkerObservation>;
  /** Original worker acknowledgement of input release, distinct from process termination. */
  releaseInput?():Promise<{epoch:string;input_released:boolean}>;
  /** Separate priority channel; it must not enqueue behind capture, model, action or approval. */
  stop():Promise<{epoch:string;input_released:boolean;terminated:boolean}>;
}
