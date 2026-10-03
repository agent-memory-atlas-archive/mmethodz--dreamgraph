/** Operator-only review. A webview supplies captured IDs, never replacement actions. */
import type { DaemonClient } from './daemon-client.js';
import { ManagedExecutionApprovalRequestSchema, ManagedExecutionSnapshotSchema, type ManagedExecutionApprovalRequest, type ManagedExecutionSnapshot } from './generated/graph-contracts.js';

type Port = Pick<DaemonClient, 'baseUrl' | 'openExecutionReviews' | 'readExecutionReviews' | 'approveExecution' | 'declineExecutionReview'> & Partial<Pick<DaemonClient,'readExecution'>>;
export interface ExecutionReviewView {
  request?: ManagedExecutionApprovalRequest;
  status: 'idle' | 'pending' | 'approving' | 'unconfirmed' | 'error' | 'closed';
  message?: string;
  canInspect?: boolean;
  inspection?: ManagedExecutionSnapshot;
}
export class ExecutionReviewController {
  private active?: { port: Port; endpoint: string; id: string; controller: AbortController; timer?: ReturnType<typeof setTimeout> };
  private captured?: { port: Port; endpoint: string; request: ManagedExecutionApprovalRequest };
  private state: ExecutionReviewView = { status: 'idle' };
  private deciding = false;
  private inspector?: AbortController;
  private readonly waiters = new Set<() => void>();
  constructor(private readonly publish: (view: ExecutionReviewView) => void, private readonly intervalMs = 1000) {}
  get view(): ExecutionReviewView { return JSON.parse(JSON.stringify({...this.state,canInspect:!!this.captured?.port.readExecution&&!this.deciding&&this.state.status!=='closed'})); }
  get blocksContinuation(): boolean { return this.state.status === 'unconfirmed' || this.state.status === 'approving' || this.state.status === 'error'; }
  private update(view: ExecutionReviewView) { this.state = view; this.publish(this.view); for (const check of [...this.waiters]) check(); }
  /** Pause model continuation only; expiry/Stop still retain an uncertain acknowledgement. */
  async waitForResolution(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted(); if (!this.blocksContinuation) return;
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { this.waiters.delete(check); signal.removeEventListener('abort', abort); };
      const check = () => { if (!this.blocksContinuation) { cleanup(); resolve(); } };
      const abort = () => { cleanup(); reject(signal.reason ?? new Error('EXECUTION_REVIEW_WAIT_ABORTED')); };
      this.waiters.add(check); signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort(); else check();
    });
  }
  private assertEndpoint(port: Port, endpoint: string) { if (port.baseUrl !== endpoint) throw new Error('EXECUTION_REVIEW_ENDPOINT_CHANGED'); }

  async start(port: Port, id: string, signal?: AbortSignal): Promise<void> {
    if (this.active || this.blocksContinuation) throw new Error('EXECUTION_REVIEW_RECOVERY_REQUIRED');
    signal?.throwIfAborted();
    const active = { port, endpoint: port.baseUrl, id, controller: new AbortController(), timer: undefined as ReturnType<typeof setTimeout> | undefined };
    this.active = active;
    const abort = () => active.controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    active.controller.signal.addEventListener('abort', () => signal?.removeEventListener('abort', abort), { once: true });
    try {
      const opened = await port.openExecutionReviews(id, active.controller.signal);
      this.assertEndpoint(port, active.endpoint);
      if (signal?.aborted) abort();
      active.controller.signal.throwIfAborted();
      if (opened.execution_id !== id || !opened.authority_active || !opened.review_enabled) throw new Error('EXECUTION_REVIEW_CHANNEL_UNAVAILABLE');
      this.update({ status: 'idle' });
      this.schedule(active);
    } catch (error) { this.stop(); throw error; }
  }
  private schedule(active: NonNullable<ExecutionReviewController['active']>) {
    if (this.active !== active || active.controller.signal.aborted) return;
    active.timer = setTimeout(() => { void this.poll(active); }, this.intervalMs);
    active.timer.unref?.();
  }
  private async poll(active: NonNullable<ExecutionReviewController['active']>) {
    try {
      this.assertEndpoint(active.port, active.endpoint);
      const result = await active.port.readExecutionReviews(active.id, active.controller.signal);
      if (this.active !== active || active.controller.signal.aborted) return;
      this.assertEndpoint(active.port, active.endpoint);
      if (result.execution_id !== active.id || result.requests.length > 1) throw new Error('EXECUTION_REVIEW_IDENTITY_MISMATCH');
      if (!result.authority_active || !result.review_enabled) throw new Error('EXECUTION_REVIEW_AUTHORITY_UNAVAILABLE');
      if (!this.deciding && this.state.status !== 'unconfirmed') {
        const request = result.requests[0];
        if (request) {
          const reviewed = ManagedExecutionApprovalRequestSchema.parse(JSON.parse(JSON.stringify(request)));
          if (reviewed.execution_id !== active.id) throw new Error('EXECUTION_REVIEW_IDENTITY_MISMATCH');
          this.captured = { port: active.port, endpoint: active.endpoint, request: reviewed };
          this.update({ status: 'pending', request: reviewed });
        } else {
          this.captured = undefined;
          this.update({ status: 'idle' });
        }
      }
    } catch (error) {
      if (this.active === active && !active.controller.signal.aborted && this.state.status !== 'unconfirmed')
        this.update({ ...this.view, status: 'error', message: String(error) });
    } finally { this.schedule(active); }
  }
  async decide(executionId: string, approvalId: string, action: 'approve' | 'decline'): Promise<void> {
    const captured = this.captured;
    if (this.deciding || !captured || captured.request.execution_id !== executionId || captured.request.approval_id !== approvalId)
      throw new Error('EXECUTION_REVIEW_TARGET_CHANGED');
    this.assertEndpoint(captured.port, captured.endpoint);
    if(this.state.inspection?.authority_active===false)throw new Error('EXECUTION_REVIEW_AUTHORITY_REVOKED: inspect closure; a historical review cannot renew it');
    if (action === 'decline' && this.state.status === 'unconfirmed') throw new Error('EXECUTION_REVIEW_RETRY_SAME_APPROVAL');
    this.deciding = true;
    // Mark uncertain before dispatch; loss of a response must never allow another pass.
    this.update({ request: captured.request, status: 'approving' });
    try {
      if (action === 'approve') {
        const result = await captured.port.approveExecution(captured.request);
        this.assertEndpoint(captured.port, captured.endpoint);
        if (result.approvalId !== approvalId || result.execution.execution_id !== executionId || !result.reviewActivated)
          throw new Error('EXECUTION_REVIEW_ACKNOWLEDGEMENT_UNCONFIRMED');
      } else {
        const result = await captured.port.declineExecutionReview(executionId, approvalId);
        this.assertEndpoint(captured.port, captured.endpoint);
        if (result.execution_id !== executionId || result.approval_id !== approvalId || result.status !== 'declined')
          throw new Error('EXECUTION_REVIEW_DECLINE_UNCONFIRMED');
      }
      this.captured = undefined;
      this.update({ status: 'idle' });
    } catch (error) {
      this.update({ request: captured.request, status: action === 'approve' ? 'unconfirmed' : 'error',
        message: action === 'approve' ? `Approval acknowledgement unconfirmed. Retry this exact review; do not repeat the proposed work. ${String(error)}` : String(error) });
      throw error;
    } finally { this.deciding = false; this.update(this.state); }
  }
  /** Read the original closed execution. Never approve, renew, finish or claim underlying termination. */
  async inspect(executionId:string,approvalId:string):Promise<ManagedExecutionSnapshot> {
    const captured=this.captured;
    if(this.deciding||!captured||captured.request.execution_id!==executionId||captured.request.approval_id!==approvalId)
      throw new Error('EXECUTION_REVIEW_TARGET_CHANGED');
    this.assertEndpoint(captured.port,captured.endpoint);
    if(!captured.port.readExecution)throw new Error('EXECUTION_REVIEW_INSPECTION_UNAVAILABLE');
    const controller=new AbortController();this.inspector=controller;this.deciding=true;
    const before=this.view;this.update({...before,message:'Reading the original execution; no action will be repeated.'});
    try{
      const execution=ManagedExecutionSnapshotSchema.parse(await captured.port.readExecution(executionId,controller.signal));
      controller.signal.throwIfAborted();this.assertEndpoint(captured.port,captured.endpoint);
      if(this.captured!==captured||execution.execution_id!==executionId)throw new Error('EXECUTION_REVIEW_TARGET_CHANGED');
      const closed=!execution.authority_active&&['no_change','state_committed','graph_committed','reconciliation_pending'].includes(execution.status);
      if(closed){
        this.inspector=undefined;this.stop();this.captured=undefined;
        this.update({status:'closed',request:captured.request,inspection:execution,
          message:`Original execution ${executionId}: ${execution.status}, revision ${execution.record_revision}. Authority revoked. This inspection neither repeated work nor confirmed the old approval; graph reconciliation is separate.`});
      }else this.update({...before,status:execution.authority_active?before.status:'unconfirmed',inspection:execution,message:`Original execution ${executionId}: ${execution.status}. Authority ${execution.authority_active?'active':'revoked'}. Outcome remains unresolved; no approval or effect was issued by inspection.`});
      return execution;
    }catch(error){
      if(this.captured===captured)this.update({...before,message:`Original execution inspection unconfirmed; do not repeat its work. ${String(error)}`});
      throw error;
    }finally{if(this.inspector===controller)this.inspector=undefined;this.deciding=false;this.update(this.state);}
  }
  /** Stops polling only. In-flight/unconfirmed approval identity remains for exact recovery. */
  stop(closureConfirmed = false) {
    this.inspector?.abort(new Error('EXECUTION_REVIEW_INSPECTION_STOPPED'));
    const active = this.active; this.active = undefined;
    if (active) { clearTimeout(active.timer); active.controller.abort(new Error('EXECUTION_REVIEW_POLL_STOPPED')); }
    if (!this.blocksContinuation || closureConfirmed && this.state.status === 'error') { this.captured = undefined; this.update({ status: 'idle' }); }
  }
}
