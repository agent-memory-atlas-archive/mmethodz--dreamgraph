/** Actual compiled editor review component in Windows Chromium; host messages are explicit doubles. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const { executionReviewMarkup, executionReviewStyles, installExecutionReview } = require('../extensions/vscode/dist/webview/execution-review.js');
const { getStyles } = require('../extensions/vscode/dist/webview/styles.js');
const { chromium } = await import(pathToFileURL(process.env.ASHOKA_PLAYWRIGHT_MODULE).href);
const out = resolve(process.env.ASHOKA_EDITOR_REVIEW_QUALIFICATION_DIR || 'docs/ashoka/editor-review-browser');
await mkdir(out, { recursive: true });
const report = { scope: 'Compiled editor review component, actual Windows Chrome; host messages are doubles, no native VSCode or paid model claim', checks: [] };
const errors = [];
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.ASHOKA_BROWSER_EXECUTABLE, headless: true });
  report.browser = await browser.version();
  const page = await browser.newPage({ viewport: { width: 720, height: 800 }, reducedMotion: 'reduce' });
  page.on('pageerror', error => errors.push(String(error)));
  await page.setContent(`<!DOCTYPE html><html><head><style>:root{--vscode-font-family:system-ui;--vscode-font-size:12px;--vscode-foreground:#ddd;--vscode-sideBar-background:#1c1c1c;--vscode-panel-border:#444;--vscode-input-background:#222;--vscode-input-foreground:#ddd;--vscode-focusBorder:#80a7d6}${getStyles()}${executionReviewStyles}</style></head><body>
    <div class="header">DreamGraph Architect — captured action review</div><div id="messages"></div>${executionReviewMarkup}
    <div id="composer"><textarea placeholder="Draft remains editable">An existing draft</textarea></div></body></html>`);
  await page.addScriptTag({ content: `window.decisions=[];(${installExecutionReview.toString()})(document,window,message=>window.decisions.push(message));` });
  const request = { execution_id: 'original-pass', approval_id: 'exact-review', expected_record_revision: 4, context_receipt_id: 'delivered-context',
    approved_actions: [{ tool: 'create_file', arguments: { filePath: 'src/🌿.ts', content: '<script>window.literalExecuted=true</script>\n' + 'A long literal line 🌿'.repeat(150) }, scope_id: 'repo:fixture', calls: 1 }] };
  const render = view => page.evaluate(view => new Promise(done => {
    const applied = event => { if (event.data?.type === 'executionReview') { window.removeEventListener('message', applied); done(); } };
    window.addEventListener('message', applied);
    window.postMessage({ type: 'executionReview', view }, '*');
  }), view);
  await render({ status: 'pending', request });
  await page.locator('#execution-review').waitFor({ state: 'visible' });
  assert.deepEqual(JSON.parse(await page.locator('#execution-review-request').textContent()), request);
  assert.equal(await page.evaluate(() => window.literalExecuted), undefined);
  assert.equal(await page.locator('#execution-review-request script').count(), 0);
  assert.equal(await page.locator('textarea').inputValue(), 'An existing draft');
  const box = await page.locator('#execution-review').boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= 720);
  assert.ok((await page.locator('#execution-review-request').boundingBox()).height <= 151);
  await page.locator('#execution-review > details > summary').first().focus(); await page.keyboard.press('Enter'); assert.equal(await page.locator('#execution-review-request').isVisible(), false);
  await page.keyboard.press('Enter'); assert.equal(await page.locator('#execution-review-request').isVisible(), true);
  await page.getByRole('button', { name: 'Approve once', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.decisions), [{ type: 'executionReviewDecision', executionId: 'original-pass', approvalId: 'exact-review', action: 'approve' }]);
  assert.equal(await page.getByRole('button', { name: 'Decline', exact: true }).isDisabled(), true);
  report.checks.push({ name: 'E25-01', detail: 'Actual compiled component keeps complete literal Unicode/source JSON, bounded detail height, draft and native keyboard disclosure at narrow width; decision contains only captured IDs.' });
  await render({ status: 'unconfirmed', request, message: 'Acknowledgement unconfirmed; retry this exact review.' });
  await page.getByRole('button', { name: 'Retry same approval', exact: true }).waitFor();
  await page.evaluate(() => window.postMessage({ type: 'state', state: { selectedPlan: 'different-plan' } }, '*'));
  assert.deepEqual(JSON.parse(await page.locator('#execution-review-request').textContent()), request);
  assert.equal(await page.getByRole('button', { name: 'Decline', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: 'Retry same approval', exact: true }).click();
  assert.deepEqual((await page.evaluate(() => window.decisions))[1], (await page.evaluate(() => window.decisions))[0]);
  await render({ status: 'pending', request: { ...request, execution_id: 'decline-pass', approval_id: 'decline-review' } });
  await page.getByRole('button', { name: 'Decline', exact: true }).click();
  assert.deepEqual((await page.evaluate(() => window.decisions))[2], { type: 'executionReviewDecision', executionId: 'decline-pass', approvalId: 'decline-review', action: 'decline' });
  await render({ status: 'unconfirmed', request, message: 'Acknowledgement unconfirmed; retry this exact review.' });
  await page.screenshot({ path: join(out, 'editor-review-narrow.png') });
  await render({ status: 'idle' }); await page.locator('#execution-review').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('textarea').inputValue(), 'An existing draft');
  report.checks.push({ name: 'E25-02', detail: 'Unconfirmed review survives unrelated selection state, enables only exact-ID retry, declines only captured target, and hides after owner confirmation; draft remains unchanged.' });
  await render({status:'unconfirmed',request,canInspect:true});
  await page.getByRole('button',{name:'Check outcome',exact:true}).click();
  assert.deepEqual((await page.evaluate(()=>window.decisions)).at(-1),{type:'executionReviewInspect',executionId:'original-pass',approvalId:'exact-review'});
  const inspection={execution_id:'original-pass',status:'recovery_required',authority_active:false,graph_receipt_ids:[],obligation_ids:['actual-unresolved-effect'],literal:'<script>window.receiptExecuted=true</script>'};
  await render({status:'unconfirmed',request,canInspect:true,inspection,message:'Termination remains unknown. Historical authority cannot be renewed.'});
  assert.equal(await page.getByRole('button',{name:'Retry same approval',exact:true}).isDisabled(),true);
  assert.equal(await page.getByRole('button',{name:'Decline',exact:true}).isDisabled(),true);
  await page.locator('#execution-review-inspection > summary').focus();await page.keyboard.press('Enter');
  assert.deepEqual(JSON.parse(await page.locator('#execution-review-inspection-detail').textContent()),inspection);assert.equal(await page.evaluate(()=>window.receiptExecuted),undefined);
  await render({status:'closed',request,canInspect:false,inspection:{...inspection,status:'no_change'},message:'Original execution closed. Inspection did not repeat work or confirm the old approval.'});
  assert.equal(await page.getByRole('button',{name:'Approve once',exact:true}).isDisabled(),true);
  assert.equal(await page.locator('#execution-review-inspect').isVisible(),false);
  await page.screenshot({path:join(out,'editor-review-inspection-closed.png')});
  report.checks.push({name:'E25-06',detail:'Actual component sends only original inspection IDs, retains whole literal readback and unknown closure, disables revoked approval, and projects a distinct closed read-only disposition.'});
  assert.deepEqual(errors, []); report.pageErrors = errors; report.success = true;
} catch (error) { report.success = false; report.failure = String(error.stack || error); throw error; }
finally { await writeFile(join(out, 'qualification.json'), JSON.stringify(report, null, 2)); await browser?.close(); }
