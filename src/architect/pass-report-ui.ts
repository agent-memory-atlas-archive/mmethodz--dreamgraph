/** Readable evidence presentation. All model text is untrusted; never insert HTML. */
export const PASS_REPORT_CSS = String.raw`
.continuation-report { display:block; padding:0 6px; border:0; border-left:2px solid var(--line); border-radius:0; background:transparent; }
.continuation-report > h4 { margin:0; padding:4px 6px; }
.continuation-report .continuation-report-section { display:block; margin:0; padding:0; min-width:0; border:0; border-top:1px solid var(--line); border-radius:0; background:transparent; }
.continuation-report .continuation-report-section > summary { display:flex; align-items:center; gap:6px; box-sizing:border-box; height:34px; min-height:34px; margin:0; padding:0 6px; border:0; list-style:none; cursor:pointer; color:#9bcdff; font-size:12px; line-height:16px; font-weight:600; }
.continuation-report-section > summary::-webkit-details-marker { display:none; }
.continuation-report-section > summary::before { content:'▸'; flex:0 0 10px; color:var(--muted); }
.continuation-report-section[open] > summary::before { content:'▾'; }
.continuation-report .report-section-label { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.continuation-report .continuation-report-section > .report-content { padding:2px 6px 6px 22px; min-width:0; overflow-wrap:anywhere; font-size:12px; line-height:1.4; }
.continuation-report .report-blockers > summary { color:#e4b55e; }
.continuation-report .report-work > summary { color:#80c8a0; }
.continuation-report .report-count { flex:0 0 auto; margin-left:auto; padding:0 5px; border-radius:3px; background:rgba(150,170,190,.1); font:10px/16px var(--font-mono,monospace); color:var(--muted); }
.continuation-report .report-content ul { margin:0; padding-left:16px; }
.continuation-report .report-content li { margin:2px 0; }
.continuation-report .report-content a { color:#8acaff; text-decoration:underline; text-underline-offset:2px; }
.continuation-report .report-content code { color:#c4b5fd; background:rgba(150,130,200,.1); padding:0 3px; border-radius:2px; overflow-wrap:anywhere; }
.continuation-report pre { max-height:320px; max-width:100%; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; margin:2px 0; padding:6px; border:1px solid var(--line); background:rgba(0,0,0,.15); color:#bad8ed; font:11px/1.4 var(--font-mono,monospace); }
.continuation-report .report-content > :first-child { margin-top:0; }
.continuation-report .report-content > :last-child { margin-bottom:0; }
`;
export const PASS_REPORT_SCRIPT = String.raw`
    function appendReconciliationStatus(panel, executionId) {
      const section = document.createElement('details'); section.className = 'continuation-report-section';
      const heading = document.createElement('summary');
      const label = document.createElement('span'); label.className = 'report-section-label'; label.textContent = 'Graph reconciliation';
      const badge = document.createElement('span'); badge.className = 'report-count'; badge.textContent = 'Checking';
      heading.append(label, badge); section.appendChild(heading);
      const content = document.createElement('div'); content.className = 'report-content';
      const status = document.createElement('div'); status.setAttribute('role', 'status');
      const checked = document.createElement('div'); checked.style.color = 'var(--muted)';
      const evidence = document.createElement('div');
      const refresh = document.createElement('button'); refresh.type = 'button'; refresh.textContent = 'Check status';
      content.append(status, checked, refresh, evidence); section.appendChild(content); panel.appendChild(section);
      let busy = false;
      async function check() {
        if (busy) return; busy = true; refresh.disabled = true;
        try {
          const response = await fetch('/api/executions/v1/reconciliation/read', {
            method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({execution_id:executionId}), signal:AbortSignal.timeout(15000)
          });
          if (!response.ok) throw new Error('HTTP ' + response.status);
          const result = await response.json();
          if (result.execution_id !== executionId || !['pending','reconciled','recovery_required','no_changes'].includes(result.status)) throw new Error('Unexpected reconciliation response');
          badge.textContent = {pending:'Pending',reconciled:'Confirmed',recovery_required:'Recovery required',no_changes:'No source changes'}[result.status];
          badge.style.color = result.status === 'reconciled' ? '#80c8a0' : result.status === 'recovery_required' ? '#ed9999' : result.status === 'pending' ? '#e4b55e' : 'var(--muted)';
          const c = result.counts;
          status.textContent = c.reconciled + ' reconciled · ' + c.pending + ' pending · ' + c.recovery_required + ' need recovery. ' +
            (result.status === 'pending' ? 'Source changes are saved; graph reconciliation is not yet confirmed. Pending does not mean a background job is scheduled. Scoped source reconciliation must complete before these entries can be confirmed.' :
             result.status === 'recovery_required' ? 'The daemon cannot confirm the source outcome. Inspect the original execution before retrying effects.' :
             result.status === 'reconciled' ? 'Confirmed by the daemon’s recorded reconciliation receipts. Optional enrichment and dreaming are separate.' :
             'No outstanding source changes are recorded for this execution.');
          checked.textContent = 'Last successful check: ' + new Date(result.checked_at).toLocaleString() + ' · Check status again after reconciliation.';
          evidence.replaceChildren();
          const list = document.createElement('ul');
          result.changes.forEach(function(change) {
            const item = document.createElement('li'); item.textContent = change.id + ' · ' + change.state + (change.receipt_id ? ' · receipt ' + change.receipt_id : '');
            list.appendChild(item);
          });
          evidence.appendChild(list);
          if (result.total > result.changes.length) { const more = document.createElement('div'); more.textContent = 'Showing ' + result.changes.length + ' of ' + result.total + ' records; counts include all records.'; evidence.appendChild(more); }
        } catch (_) {
          badge.textContent = 'Unavailable'; badge.style.color = '#e4b55e'; evidence.replaceChildren();
          status.textContent = 'Current reconciliation status could not be read. No completion is confirmed; use Check status to retry.';
        } finally { busy = false; refresh.disabled = false; }
      }
      refresh.addEventListener('click', check);
      void check();
    }

    function appendReportText(parent, value) {
      const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
      // JSON stays formatted in a frame; strings cannot introduce HTML or executable URLs.
      try {
        const data = JSON.parse(text);
        if (data && typeof data === 'object') {
          const pre = document.createElement('pre'); pre.textContent = JSON.stringify(data, null, 2); parent.appendChild(pre); return;
        }
      } catch (_) {}
      const pattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>]+)|\x60([^\x60]+)\x60/g;
      let cursor = 0, match;
      while ((match = pattern.exec(text))) {
        parent.appendChild(document.createTextNode(text.slice(cursor, match.index)));
        if (match[4]) { const code = document.createElement('code'); code.textContent = match[4]; parent.appendChild(code); }
        else {
          const link = document.createElement('a'); link.textContent = match[1] || match[3];
          link.href = match[2] || match[3]; link.target = '_blank'; link.rel = 'noopener noreferrer'; parent.appendChild(link);
        }
        cursor = match.index + match[0].length;
      }
      parent.appendChild(document.createTextNode(text.slice(cursor)));
    }
    function appendContinuationReportSection(panel, title, value) {
      const values = Array.isArray(value) ? value.filter(function(item) {
        if (item == null || (typeof item === 'string' && item.trim() === '')) return false;
        if (title === 'Blockers And Uncertainty' && /^uncertainty:\s*0(?:\.0+)?\s*$/i.test(String(item))) return false;
        return typeof item !== 'string' || typeof isRenderableContinuationReportText !== 'function' || isRenderableContinuationReportText(item);
      }) : null;
      const empty = values ? values.length === 0 : value == null || String(value).trim() === '';
      if (empty) return;
      const section = document.createElement('details');
      section.className = 'continuation-report-section';
      if (title === 'Executive Summary') { section.classList.add('report-outcome'); section.open = true; }
      if (title === 'Work Completed') section.classList.add('report-work');
      if (title === 'Blockers And Uncertainty') {
        section.classList.add('report-blockers');
        section.open = !!values && values.some(function(item) {
          const uncertainty = /^uncertainty:\s*(.*)$/i.exec(String(item));
          return !uncertainty || Number(uncertainty[1]) > 0;
        });
      }
      const heading = document.createElement('summary');
      const label = document.createElement('span'); label.className = 'report-section-label'; label.textContent = title; heading.appendChild(label);
      if (values) { const count = document.createElement('span'); count.className = 'report-count'; count.textContent = String(values.length); heading.appendChild(count); }
      section.appendChild(heading);
      const content = document.createElement('div'); content.className = 'report-content';
      let rendered = false;
      const renderContent = function() {
      if (rendered) return; rendered = true;
      if (empty) { content.classList.add('report-empty'); content.textContent = 'None recorded.'; }
      else if (values) {
        const list = document.createElement('ul');
        values.forEach(function(item) {
          const li = document.createElement('li');
          const tool = title === 'Tool Trace' && typeof item === 'string' ? parseContinuationToolLine(item) : null;
          if (tool) appendContinuationToolRow(li, tool); else appendReportText(li, item);
          list.appendChild(li);
        });
        content.appendChild(list);
      } else appendReportText(content, value);
      };
      // Closed evidence/raw sections allocate their DOM only when inspected.
      section.addEventListener('toggle', function() { if (section.open) renderContent(); });
      if (section.open) renderContent();
      section.appendChild(content); panel.appendChild(section);
    }
`;
