/** Original-host action review; captured identity and literal arguments, never automatic approval. */
export const EXECUTION_REVIEW_CSS = String.raw`
  .execution-review { margin: 0 10px 6px; padding: 7px 9px; border: 1px solid #6e6241; border-radius: 4px; background: #25231e; }
  .execution-review[hidden] { display: none; }
  .execution-review summary { cursor: pointer; font-size: 12px; font-weight: 600; }
  .execution-review pre { max-height: 160px; margin: 6px 0; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font: 11px/1.4 var(--font-mono,monospace); }
  .execution-review .review-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-top: 5px; }
  .execution-review .review-status { margin: 4px 0 0; font-size: 11px; color: #d9cba3; }
`;
export const EXECUTION_REVIEW_MARKUP = String.raw`
  <section id="execution-review-panel" class="execution-review" aria-label="Exact action review" hidden>
    <details open><summary id="execution-review-title">Action review</summary><pre id="execution-review-detail" tabindex="0"></pre></details>
    <div class="review-actions"><button id="execution-review-approve" type="button">Approve once</button><button id="execution-review-decline" type="button">Decline</button><button id="execution-review-inspect" type="button">Check outcome</button></div>
    <p id="execution-review-status" class="review-status" role="status" aria-live="polite"></p>
  </section>
`;
export const EXECUTION_REVIEW_SCRIPT = String.raw`
    const executionReviewPanelEl = document.getElementById('execution-review-panel');
    const executionReviewTitleEl = document.getElementById('execution-review-title');
    const executionReviewDetailEl = document.getElementById('execution-review-detail');
    const executionReviewStatusEl = document.getElementById('execution-review-status');
    const executionReviewApproveEl = document.getElementById('execution-review-approve');
    const executionReviewDeclineEl = document.getElementById('execution-review-decline');
    const executionReviewInspectEl = document.getElementById('execution-review-inspect');
    let executionReviewId = null, executionReviewTimer = 0, executionReviewPolling = false;
    let displayedExecutionReview = null, executionReviewSubmitting = false;
    let reviewAcknowledgementUnconfirmed = false;
    let executionReviewInspection = null;
    async function executionReviewRequest(route, request) {
      const signal = AbortSignal.timeout(10000);
      const response = await fetch('/api/executions/v1/' + route, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(request), signal });
      if (!response.body) throw new Error('Execution review response unavailable.');
      const reader = response.body.getReader(), parts = []; let bytes = 0;
      try { while (true) { signal.throwIfAborted(); const next = await reader.read(); signal.throwIfAborted(); if (next.done) break;
        bytes += next.value.byteLength; if (bytes > 256 * 1024) throw new Error('Execution review response exceeds the 256 KiB UTF-8 byte ceiling; no evidence was clipped.'); parts.push(next.value); }
      } catch (error) { await reader.cancel().catch(function(){}); throw error; } finally { reader.releaseLock(); }
      const body = new Uint8Array(bytes); let offset = 0; for (const part of parts) { body.set(part, offset); offset += part.byteLength; }
      const result = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body));
      if (!response.ok) throw new Error(result.message || result.error || ('HTTP ' + response.status));
      return result;
    }
    function showExecutionReview(request) {
      displayedExecutionReview = JSON.parse(JSON.stringify(request));
      executionReviewInspection = null;
      executionReviewApproveEl.disabled = false; executionReviewDeclineEl.disabled = false; executionReviewInspectEl.disabled = false;
      const action = request.approved_actions[0];
      executionReviewTitleEl.textContent = 'Review ' + action.tool + ' · ' + action.calls + ' call';
      // Put the proposed work first while retaining every original field and value.
      executionReviewDetailEl.textContent = JSON.stringify({approved_actions:request.approved_actions,...request}, null, 2);
      executionReviewStatusEl.textContent = 'Waiting before dispatch. Only the exact arguments and scope shown will be authorized; expiry and effect limits stay unchanged.';
      executionReviewPanelEl.hidden = false;
    }
    async function pollExecutionReviews() {
      if (!executionReviewId || executionReviewPolling || executionReviewSubmitting || reviewAcknowledgementUnconfirmed) return;
      const id = executionReviewId; executionReviewPolling = true;
      try {
        const queue = await executionReviewRequest('reviews/read', {execution_id:id});
        if (id !== executionReviewId || executionReviewSubmitting || reviewAcknowledgementUnconfirmed) return;
        if (queue.execution_id !== id || !Array.isArray(queue.requests) || queue.requests.length > 1) throw new Error('Review queue identity is unconfirmed.');
        const request = queue.authority_active && queue.requests[0];
        if (request && request.execution_id === id && Array.isArray(request.approved_actions) && request.approved_actions.length === 1) {
          if (!displayedExecutionReview || displayedExecutionReview.approval_id !== request.approval_id) showExecutionReview(request);
        } else { displayedExecutionReview = null; executionReviewPanelEl.hidden = true; }
      } catch (error) {
        // The start event may precede assembly. An unavailable read can never authorize an action.
        if (displayedExecutionReview && id === executionReviewId) executionReviewStatusEl.textContent = 'Review unavailable: ' + error.message + '. Stop the pass if it cannot recover.';
      } finally { executionReviewPolling = false; }
    }
    function trackExecutionReviews(control) {
      if (!control || control.state !== 'running' || !control.active_execution_id || reviewAcknowledgementUnconfirmed) return;
      if (executionReviewInspection && !executionReviewInspection.authority_active && control.active_execution_id === executionReviewInspection.execution_id) return;
      if (executionReviewId !== control.active_execution_id) {
        displayedExecutionReview = null; executionReviewPanelEl.hidden = true; executionReviewId = control.active_execution_id;
      }
      if (!executionReviewTimer) executionReviewTimer = window.setInterval(pollExecutionReviews, 1000);
      void pollExecutionReviews();
    }
    function stopExecutionReviewPolling() {
      window.clearInterval(executionReviewTimer); executionReviewTimer = 0; executionReviewId = null;
      if (!reviewAcknowledgementUnconfirmed) { displayedExecutionReview = null; executionReviewPanelEl.hidden = true; }
    }
    executionReviewApproveEl.addEventListener('click', async function() {
      if (!displayedExecutionReview || executionReviewSubmitting) return;
      if (executionReviewInspection && !executionReviewInspection.authority_active) { executionReviewStatusEl.textContent = 'Authority revoked. Inspection cannot renew the historical approval.'; return; }
      const captured = JSON.parse(JSON.stringify(displayedExecutionReview)); executionReviewSubmitting = true;
      reviewAcknowledgementUnconfirmed = true; executionReviewApproveEl.disabled = true; executionReviewDeclineEl.disabled = true; executionReviewInspectEl.disabled = true;
      executionReviewStatusEl.textContent = 'Recording review ' + captured.approval_id + '…';
      try {
        const result = await executionReviewRequest('approve', captured);
        if (result.approval_id !== captured.approval_id || !result.execution || result.execution.execution_id !== captured.execution_id || result.review_activated !== true) throw new Error('Approval acknowledgement identity is unconfirmed.');
        reviewAcknowledgementUnconfirmed = false; displayedExecutionReview = null; executionReviewPanelEl.hidden = true;
        if (chatStatusEl.textContent.indexOf('Resolve the unconfirmed action review') === 0) chatStatusEl.textContent = 'Review confirmed for ' + captured.execution_id + '. No uncertain action was redispatched by this acknowledgement retry.';
      } catch (error) {
        executionReviewStatusEl.textContent = 'Approval acknowledgement unconfirmed: ' + error.message + '. Retry this same review ID or inspect execution ' + captured.execution_id + '; do not repeat uncertain effects. Automatic continuation is paused.';
        executionReviewApproveEl.textContent = 'Retry same review';
      } finally {
        executionReviewSubmitting = false; executionReviewApproveEl.disabled = false; executionReviewDeclineEl.disabled = reviewAcknowledgementUnconfirmed; executionReviewInspectEl.disabled = !displayedExecutionReview;
        if (!reviewAcknowledgementUnconfirmed) { executionReviewApproveEl.textContent = 'Approve once'; void pollExecutionReviews(); }
      }
    });
    executionReviewDeclineEl.addEventListener('click', async function() {
      if (!displayedExecutionReview || executionReviewSubmitting || reviewAcknowledgementUnconfirmed) return;
      if (executionReviewInspection && !executionReviewInspection.authority_active) return;
      const captured = JSON.parse(JSON.stringify(displayedExecutionReview)); executionReviewSubmitting = true;
      executionReviewApproveEl.disabled = true; executionReviewDeclineEl.disabled = true; executionReviewInspectEl.disabled = true;
      try {
        const result = await executionReviewRequest('reviews/decline', {execution_id:captured.execution_id,approval_id:captured.approval_id});
        if (result.execution_id !== captured.execution_id || result.approval_id !== captured.approval_id || !['declined','not_pending'].includes(result.status)) throw new Error('Decline acknowledgement identity is unconfirmed.');
        displayedExecutionReview = null; executionReviewPanelEl.hidden = true;
      } catch (error) { executionReviewStatusEl.textContent = 'Decline unconfirmed: ' + error.message + '. No approval was issued by this action.'; }
      finally { executionReviewSubmitting = false; executionReviewApproveEl.disabled = false; executionReviewDeclineEl.disabled = false; executionReviewInspectEl.disabled = !displayedExecutionReview; void pollExecutionReviews(); }
    });
    executionReviewInspectEl.addEventListener('click', async function() {
      if (!displayedExecutionReview || executionReviewSubmitting) return;
      const captured = JSON.parse(JSON.stringify(displayedExecutionReview)); executionReviewSubmitting = true;
      executionReviewApproveEl.disabled = true; executionReviewDeclineEl.disabled = true; executionReviewInspectEl.disabled = true;
      executionReviewStatusEl.textContent = 'Reading original execution ' + captured.execution_id + '; no action will be repeated.';
      try {
        const result = await executionReviewRequest('read', {execution_id:captured.execution_id});
        if (!displayedExecutionReview || displayedExecutionReview.execution_id !== captured.execution_id || displayedExecutionReview.approval_id !== captured.approval_id
          || result.execution_id !== captured.execution_id || typeof result.instance_id !== 'string' || typeof result.authority_active !== 'boolean'
          || !Number.isSafeInteger(result.record_revision) || result.record_revision < 0 || !Array.isArray(result.graph_receipt_ids) || !Array.isArray(result.obligation_ids)
          || !['assembled','running','no_change','state_committed','graph_committed','reconciliation_pending','work_pending','recovery_required'].includes(result.status))
          throw new Error('Original execution inspection identity is unconfirmed.');
        executionReviewInspection = result;
        executionReviewDetailEl.textContent = JSON.stringify({request:captured,inspection:result}, null, 2);
        const closed = !result.authority_active && ['no_change','state_committed','graph_committed','reconciliation_pending'].includes(result.status);
        if (closed) {
          reviewAcknowledgementUnconfirmed = false; displayedExecutionReview = null; stopExecutionReviewPolling();
          executionReviewPanelEl.hidden = false; executionReviewTitleEl.textContent = 'Original execution · ' + result.status;
          executionReviewStatusEl.textContent = 'Execution ' + result.execution_id + ' closed at revision ' + result.record_revision + '. Inspection neither repeated work nor confirmed the old approval. Graph reconciliation is separate.';
          if (chatStatusEl.textContent.indexOf('Resolve the unconfirmed action review') === 0) chatStatusEl.textContent = executionReviewStatusEl.textContent;
        } else {
          if (!result.authority_active) reviewAcknowledgementUnconfirmed = true;
          executionReviewStatusEl.textContent = 'Original execution: ' + result.status + '. Authority ' + (result.authority_active ? 'active' : 'revoked') + '. Outcome remains unresolved; inspection issued no approval or effect.';
        }
      } catch (error) { executionReviewStatusEl.textContent = 'Inspection unconfirmed: ' + error.message + '. No action was repeated; retain the original execution.'; }
      finally {
        executionReviewSubmitting = false;
        executionReviewApproveEl.disabled = !displayedExecutionReview || !!executionReviewInspection && !executionReviewInspection.authority_active;
        executionReviewDeclineEl.disabled = !displayedExecutionReview || reviewAcknowledgementUnconfirmed || !!executionReviewInspection && !executionReviewInspection.authority_active;
        executionReviewInspectEl.disabled = !displayedExecutionReview;
      }
    });
`;
