/** Normalized ownership/stop fence port. Native qualification and seat arbitration are Slice 31. */
import { ComputerSessionSchema, ComputerTargetSchema } from "../graph/contracts.js";
import type { SessionContext } from "./session-context.js";
import { SessionAuthority } from "./session-authority.js";
import { z } from "zod";

type Binding = { session: z.infer<typeof ComputerSessionSchema>; target: z.infer<typeof ComputerTargetSchema>;
  controller: AbortController; stop: () => Promise<void>; stop_state: "not_requested" | "requested" | "acknowledged" | "unknown";
  capability:string;
  expiry?: NodeJS.Timeout; unsubscribe?: () => void; stopping?: Promise<void> };
export class ComputerControlBindings {
  private bindings = new Map<string, Binding>();
  constructor(private readonly authority: SessionAuthority) {}
  async bind(context: SessionContext, input: { session: z.infer<typeof ComputerSessionSchema>; target: z.infer<typeof ComputerTargetSchema>;
    independently_stoppable: boolean; stop: () => Promise<void>; capability?:"computer_use"|"computer_observe"|"computer_interact" }) {
    const session = ComputerSessionSchema.parse(input.session), target = ComputerTargetSchema.parse(input.target);
    if (!input.independently_stoppable) throw new Error("COMPUTER_INDEPENDENT_STOP_REQUIRED");
    if (session.instance_id !== this.authority.instance_id || session.session_id !== context.session_id || session.owner !== context.principal
      || target.instance_id !== session.instance_id || target.session_id !== session.session_id || !session.target_ids.includes(target.id)
      || target.host_id !== session.host_id) throw new Error("COMPUTER_BINDING_OWNER_REJECTED");
    const capability=input.capability??"computer_use";
    const grant = await this.authority.assertGrant(context, session.grant_id, session.execution_id, target.id, capability);
    if (this.bindings.has(session.id) || this.bindings.size >= 128) throw new Error("COMPUTER_BINDING_CONFLICT");
    const controller = new AbortController();
    const binding: Binding = { session: structuredClone(session), target: structuredClone(target), controller, stop: input.stop, capability, stop_state: "not_requested" };
    this.bindings.set(session.id, binding);
    binding.unsubscribe = await this.authority.onGrantRevoked(async id => {
      if (id === session.grant_id) await this.stopBinding(binding, "COMPUTER_GRANT_REVOKED");
    });
    binding.expiry = setTimeout(() => { void this.stopBinding(binding, "COMPUTER_GRANT_EXPIRED"); }, this.authority.remainingGrantMs(grant.expires_at));
    binding.expiry.unref();
    // Close the grant-check/registration race: a concurrent revocation cannot
    // leave a ready worker without its external stop signal.
    try { await this.authority.assertGrant(context, session.grant_id, session.execution_id, target.id, capability); }
    catch (error) { await this.stopBinding(binding, "COMPUTER_GRANT_REJECTED"); throw error; }
    return { id: session.id, signal: controller.signal, fence: session.fence };
  }
  private owned(context: SessionContext, id: string): Binding {
    const binding = this.bindings.get(id);
    if (!binding || binding.session.session_id !== context.session_id || binding.session.owner !== context.principal) throw new Error("COMPUTER_CONTROL_OWNER_REJECTED");
    return binding;
  }
  async assertInput(context: SessionContext, id: string, fence: number, generation: number) {
    const binding = this.owned(context, id);
    binding.controller.signal.throwIfAborted();
    if (binding.session.state !== "ready" && binding.session.state !== "running" || binding.session.fence !== fence || binding.target.generation !== generation) throw new Error("COMPUTER_CONTROL_FENCE_REJECTED");
    try { await this.authority.assertGrant(context, binding.session.grant_id, binding.session.execution_id, binding.target.id, binding.capability); }
    catch (error) { await this.stopBinding(binding, "COMPUTER_GRANT_REJECTED"); throw error; }
    return { execution_id: binding.session.execution_id, target_id: binding.target.id, fence };
  }
  async stop(context: SessionContext, id: string) {
    const binding = this.owned(context, id);
    await this.stopBinding(binding, "COMPUTER_STOP_REQUESTED");
    return this.status(context, id);
  }
  /** Trusted observer only; models cannot turn an old coordinate reference into a new generation. */
  updateObservedTarget(context:SessionContext,id:string,input:z.infer<typeof ComputerTargetSchema>){
    const binding=this.owned(context,id),target=ComputerTargetSchema.parse(input);
    binding.controller.signal.throwIfAborted();
    if(target.id!==binding.target.id||target.instance_id!==binding.target.instance_id||target.session_id!==binding.target.session_id
      ||target.host_id!==binding.target.host_id||target.surface!==binding.target.surface||target.generation<binding.target.generation)
      throw new Error("COMPUTER_OBSERVED_TARGET_REJECTED");
    binding.target=target;
  }
  /** The journal owns observed-boundary acknowledgement; this volatile port fences input immediately. */
  pause(context:SessionContext,id:string){const binding=this.owned(context,id);binding.controller.signal.throwIfAborted();
    if(binding.stop_state!=="not_requested"||!["ready","running"].includes(binding.session.state))throw new Error("COMPUTER_PAUSE_STATE_REJECTED");
    binding.session.state="paused";binding.session.fence++;return binding.session.fence;}
  resume(context:SessionContext,id:string,fence:number){const binding=this.owned(context,id);binding.controller.signal.throwIfAborted();
    if(binding.stop_state!=="not_requested"||binding.session.state!=="paused"||fence!==binding.session.fence+1)throw new Error("COMPUTER_RESUME_FENCE_REJECTED");
    binding.session.state="ready";binding.session.fence=fence;}
  private async stopBinding(binding: Binding, reason: string) {
    if (binding.stop_state !== "not_requested") return binding.stopping;
    binding.stop_state = "requested"; binding.session.fence++; binding.session.state = "stopping";
    clearTimeout(binding.expiry); binding.unsubscribe?.();
    binding.controller.abort(new Error(reason));
    binding.stopping = (async () => {
      let timeout: NodeJS.Timeout | undefined;
      try {
        await Promise.race([Promise.resolve().then(binding.stop), new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error("COMPUTER_STOP_ACK_TIMEOUT")), 5000); timeout.unref();
        })]);
        binding.stop_state = "acknowledged"; binding.session.state = "stopped";
      } catch { binding.stop_state = "unknown"; binding.session.state = "recovery_required"; }
      finally { clearTimeout(timeout); binding.session.updated_at = new Date().toISOString(); }
    })();
    return binding.stopping;
  }
  status(context: SessionContext, id: string) {
    const binding = this.owned(context, id);
    return { id, execution_id: binding.session.execution_id, state: binding.session.state, fence: binding.session.fence,
      stop_state: binding.stop_state, physical_seat_qualification: "not_established_by_control_port" };
  }
}
