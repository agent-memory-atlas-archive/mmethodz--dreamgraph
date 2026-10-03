/// <reference lib="dom" />
import type { ExecutionReviewView } from '../execution-review.js';

export const executionReviewMarkup = `<section id="execution-review" hidden aria-live="polite">
  <details open><summary>Action review</summary><pre id="execution-review-request"></pre></details>
  <div id="execution-review-status"></div>
  <details id="execution-review-inspection" hidden><summary>Execution closure and receipts</summary><pre id="execution-review-inspection-detail"></pre></details>
  <div class="execution-review-actions"><button id="execution-review-approve">Approve once</button><button id="execution-review-decline">Decline</button><button id="execution-review-inspect" hidden>Check outcome</button></div>
</section>`;
export const executionReviewStyles = `#execution-review{margin:2px 8px;padding:6px 8px;border:1px solid var(--vscode-panel-border);border-radius:4px;flex-shrink:0}
#execution-review summary{cursor:pointer;font-weight:600}#execution-review pre{max-height:150px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;margin:5px 0;font-size:11px;user-select:text}
#execution-review-status{font-size:11px;overflow-wrap:anywhere}.execution-review-actions{display:flex;gap:6px;margin-top:5px}
.execution-review-actions button{font:inherit;font-size:11px;padding:3px 8px;border:1px solid var(--vscode-panel-border,#444);border-radius:3px;color:var(--vscode-button-secondaryForeground,var(--vscode-foreground,#ddd));background:var(--vscode-button-secondaryBackground,#303030);cursor:pointer}
.execution-review-actions button:focus-visible{outline:1px solid var(--vscode-focusBorder,#80a7d6);outline-offset:2px}.execution-review-actions button:disabled{opacity:.5;cursor:default}`;

/** A standalone initializer also used by compiled DOM qualification. All proposal text stays literal. */
export function installExecutionReview(document: Document, window: Window, send: (message: unknown) => void) {
  const panel = document.getElementById('execution-review') as HTMLElement;
  const proposal = document.getElementById('execution-review-request') as HTMLElement;
  const status = document.getElementById('execution-review-status') as HTMLElement;
  const approve = document.getElementById('execution-review-approve') as HTMLButtonElement;
  const decline = document.getElementById('execution-review-decline') as HTMLButtonElement;
  const inspect = document.getElementById('execution-review-inspect') as HTMLButtonElement;
  const inspection = document.getElementById('execution-review-inspection') as HTMLElement;
  const inspectionDetail = document.getElementById('execution-review-inspection-detail') as HTMLElement;
  let captured: { executionId: string; approvalId: string } | undefined;
  approve.addEventListener('click', () => { if (captured && !approve.disabled) { approve.disabled = true; decline.disabled = true; send({ type: 'executionReviewDecision', ...captured, action: 'approve' }); } });
  decline.addEventListener('click', () => { if (captured && !decline.disabled) { approve.disabled = true; decline.disabled = true; send({ type: 'executionReviewDecision', ...captured, action: 'decline' }); } });
  inspect.addEventListener('click',()=>{if(captured&&!inspect.disabled){approve.disabled=true;decline.disabled=true;inspect.disabled=true;send({type:'executionReviewInspect',...captured});}});
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.data?.type !== 'executionReview') return;
    const view = event.data.view as ExecutionReviewView;
    panel.hidden = view.status === 'idle';
    status.textContent = view.message ?? (view.status === 'approving' ? 'Waiting for the daemon acknowledgement…' : 'Exact action, scope and context. Preferences do not grant effects.');
    const request = view.request;
    captured = request ? { executionId: request.execution_id, approvalId: request.approval_id } : undefined;
    // Actions first; retain every receipt/revision field and never use innerHTML.
    const { approved_actions, ...metadata } = request ?? { approved_actions: undefined };
    proposal.textContent = request ? JSON.stringify({ approved_actions, ...metadata }, null, 2) : '';
    inspection.hidden=!view.inspection;inspectionDetail.textContent=view.inspection?JSON.stringify(view.inspection,null,2):'';
    inspect.hidden=!view.canInspect;inspect.disabled=!view.canInspect||!captured;
    approve.textContent = view.status === 'unconfirmed' ? 'Retry same approval' : 'Approve once';
    approve.disabled = !captured || !['pending', 'unconfirmed'].includes(view.status) || view.inspection?.authority_active===false;
    decline.disabled = !captured || view.status !== 'pending' || view.inspection?.authority_active===false;
  });
}
export function getExecutionReviewScript() {
  return `(${installExecutionReview.toString()})(document, window, message => vscode.postMessage(message));`;
}
