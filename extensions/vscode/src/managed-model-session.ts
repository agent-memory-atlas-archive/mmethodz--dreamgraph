/** Original-host accounting only. Provider credentials, transport and streaming remain native. */
import { randomUUID } from 'node:crypto';
import type { DaemonClient } from './daemon-client.js';
import type { ManagedModelBinding, ManagedModelPermit, ManagedModelSettlement, ManagedExecutionSnapshot } from './generated/graph-contracts.js';
import type { TokenUsage } from './generated/provider-outcome.js';

type Port = Pick<DaemonClient, 'baseUrl' | 'admitModel' | 'settleModel' | 'readModel'> & Partial<Pick<DaemonClient, 'observeModelStop'>>;
export interface NativeModelTicket { readonly permit: ManagedModelPermit; readonly signal: AbortSignal; }

export class ManagedModelSession {
  private pending?: { requestId: string; ticket?: NativeModelTicket; report?: ManagedModelSettlement };
  private uncertain = false;
  private readonly originals = new Map<NativeModelTicket, { requestId: string; attemptId: string; reported: boolean }>();
  constructor(private readonly port: Port, readonly executionId: string, private readonly endpoint: string, private readonly parent?: AbortSignal) {}
  get unknown() { return this.uncertain || this.pending !== undefined; }
  private assertOwner() { if (this.port.baseUrl !== this.endpoint) throw new Error('NATIVE_MODEL_OWNER_CHANGED'); }
  async admit(binding: ManagedModelBinding, payload: string, outputTokens: number, signal?: AbortSignal, retry = false): Promise<NativeModelTicket> {
    this.assertOwner(); this.parent?.throwIfAborted(); signal?.throwIfAborted();
    if (this.unknown) throw new Error('NATIVE_MODEL_RECOVERY_REQUIRED');
    if (this.originals.size >= 128) throw new Error('NATIVE_MODEL_SESSION_CAPACITY');
    const pending = { requestId: `native:${randomUUID()}` } as NonNullable<ManagedModelSession['pending']>;
    this.pending = pending; // Retain the original identity before the request can yield or lose its reply.
    try {
      const permit = await this.port.admitModel({ execution_id: this.executionId, request_id: pending.requestId,
        binding, payload, output_tokens: outputTokens, retry }, signal);
      this.assertOwner();
      const deadline = AbortSignal.timeout(Math.max(1, Date.parse(permit.expires_at) - Date.now()));
      pending.ticket = Object.freeze({ permit, signal: AbortSignal.any([deadline, ...(this.parent ? [this.parent] : []), ...(signal ? [signal] : [])]) });
      this.originals.set(pending.ticket, { requestId: pending.requestId, attemptId: permit.attempt_id, reported: false });
      return pending.ticket;
    } catch (error) {
      this.uncertain = true;
      let refused = false;
      try {
        this.assertOwner();
        const observed = await this.port.readModel(this.executionId, pending.requestId);
        this.assertOwner();
        refused = observed.state === 'refused' && observed.permit === null;
      } catch { /* No durable original outcome means the lost reply remains uncertain. */ }
      if (refused) { this.uncertain = false; if (this.pending === pending) this.pending = undefined; }
      throw new Error(`NATIVE_MODEL_ADMISSION_${refused ? 'REFUSED' : 'UNCONFIRMED'}: ${this.executionId}/${pending.requestId}; ${String(error)}; never redispatch this request`, { cause: error });
    }
  }
  async settle(ticket: NativeModelTicket, usage: TokenUsage | undefined, termination: 'confirmed' | 'unconfirmed', acknowledged: boolean) {
    const pending = this.pending;
    if (!pending || pending.ticket !== ticket) throw new Error('NATIVE_MODEL_TICKET_MISMATCH');
    this.assertOwner();
    pending.report ??= { execution_id: this.executionId, request_id: pending.requestId, attempt_id: this.originals.get(ticket)!.attemptId,
      usage: usage ?? null, acknowledged, work_termination: termination };
    this.originals.get(ticket)!.reported = true;
    try {
      // Reporting is independent of caller cancellation. It cannot renew execution authority.
      const outcome = await this.port.settleModel(pending.report);
      this.assertOwner();
      if (outcome.state !== 'host_reported') this.uncertain = true;
      if (this.pending === pending) this.pending = undefined;
      return outcome;
    } catch (error) {
      this.uncertain = true;
      throw new Error(`NATIVE_MODEL_SETTLEMENT_UNCONFIRMED: ${this.executionId}/${pending.requestId}; retain the exact report`, { cause: error });
    }
  }
  /** Independent original-worker evidence after closure. Never strengthen/replay the first report as new work. */
  async observeStop(ticket: NativeModelTicket, observation: { usage?: TokenUsage; acknowledged: boolean; workTermination: 'confirmed' | 'unconfirmed' }): Promise<ManagedExecutionSnapshot> {
    this.assertOwner();
    const original = this.originals.get(ticket);
    if (!original?.reported) throw new Error('NATIVE_MODEL_ORIGINAL_TICKET_REQUIRED');
    if (!this.port.observeModelStop) throw new Error('NATIVE_MODEL_STOP_RECOVERY_UNAVAILABLE');
    if (!observation.acknowledged || observation.workTermination !== 'confirmed') throw new Error('INDEPENDENT_NATIVE_STOP_OBSERVATION_REQUIRED');
    const result = await this.port.observeModelStop({ execution_id: this.executionId, request_id: original.requestId, attempt_id: original.attemptId,
      usage: observation.usage ?? null, acknowledged: true, work_termination: 'confirmed' });
    this.assertOwner();
    if (result.execution_id !== this.executionId || result.authority_active) throw new Error('NATIVE_MODEL_STOP_AUTHORITY_MISMATCH');
    // Keep uncertainty/admission closed: observed stop cannot make this session launchable again.
    return result;
  }
  /** Inspection can recover knowledge, never a second launch or stronger termination assertion. */
  async inspect(signal?: AbortSignal) {
    this.assertOwner(); const pending = this.pending;
    if (!pending) throw new Error('NATIVE_MODEL_REQUEST_NOT_PENDING');
    const result = await this.port.readModel(this.executionId, pending.requestId, signal);
    this.assertOwner(); signal?.throwIfAborted(); return result;
  }
}
