// Review probes against v14.0.1. No live daemon writes, model calls or real browser control.
// Run from the repository root: node --import tsx docs/audits/2026-10-04-v14.0.1-review/reproduce.mjs
// These observations demonstrate defects; they are not passing product acceptance tests.
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { releaseCodexBrowserSession, codexBrowserReleaseConfirmed } from '../../../src/architect/codex-cua-release.ts';
import { renderConfigurationWorkspace, CONFIGURATION_WORKSPACE_SCRIPT } from '../../../src/server/configuration-workspace.ts';
import { resolveRolePolicy } from '../../../src/config/role-policy.ts';

const observations = [];
const directory = await mkdtemp(join(tmpdir(), 'dg-review-14-0-1-'));
const fake = join(directory, 'fake-cua.mjs');
try {
  await writeFile(fake, `
import readline from 'node:readline';
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', line => {
  const m = JSON.parse(line);
  if (m.id === undefined) return;
  const result = m.method === 'initialize' ? { protocolVersion: '2025-06-18', capabilities: {} }
    : { isError: true, content: [{ type: 'text', text: 'Browser connection unavailable' }] };
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\\n');
});
`);
  const release = await releaseCodexBrowserSession({
    server: { name: 'cua_repl', command: process.execPath, args: [fake], env: {}, env_vars: [], source: 'review fixture' },
    sessionId: 'review-fixture', tabIds: ['123'], attempts: 1, callTimeoutMs: 1000, totalTimeoutMs: 3000,
  });
  observations.push({ probe: 'unavailable_browser_is_not_proof_of_release', tabs: release.tabs,
    turn_ended: release.turn_ended, reported_confirmed: codexBrowserReleaseConfirmed(release) });
} finally { await unlink(fake); await rmdir(directory); }

async function settled(check) {
  for (let i = 0; i < 150; i++) { if (check()) return; await new Promise(r => setTimeout(r, 10)); }
  throw Error('Review fixture did not settle');
}
async function workspace(tab = 'models') {
  const dom = new JSDOM(renderConfigurationWorkspace('fixture', 'dg restart fixture'), {
    url: 'http://localhost/config?tab=' + tab, runScripts: 'outside-only',
  });
  let failRead = false, confirms = 0, stateReads = 0, applied = null;
  const { window } = dom;
  window.confirm = () => { confirms++; return false; };
  window.structuredClone = structuredClone;
  window.fetch = async (path, request) => {
    let value;
    if (path === '/api/config/v1') {
      stateReads++;
      if (failRead) throw Error('injected readback failure');
      value = { ok: true, result: { revision: 'fixture', settings: [], diagnostics: [], effective_components: {} } };
    } else if (path === '/api/config/v1/apply') {
      applied = JSON.parse(request.body);
      value = { ok: true, receipt: { status: 'committed', operation_id: applied.operation_id, restart_required: [] },
        activation: { status: 'restart_required', message: 'Saved, but runtime activation was not fully confirmed.' } };
    } else if (path === '/api/architect/v1/repo-setup') {
      value = { repo_setup: { repositories: [{ name: 'original', path: '/fixture', role: 'primary' }] } };
    } else value = { ok: true, result: [] };
    return { ok: true, status: 200, json: async () => value };
  };
  window.eval(CONFIGURATION_WORKSPACE_SCRIPT);
  await settled(() => window.document.querySelector('#configuration-workspace').dataset.loading === 'false');
  return { dom, window, document: window.document, failReads: () => { failRead = true; }, confirms: () => confirms, stateReads: () => stateReads, applied: () => applied };
}
{
  const w = await workspace();
  try {
    w.failReads(); w.document.querySelector('#cw-refresh').click();
    await settled(() => w.stateReads() >= 2 && w.document.querySelector('#cw-message').textContent.includes('Reloaded'));
    observations.push({ probe: 'failed_config_reload', displayed: w.document.querySelector('#cw-message').textContent,
      class: w.document.querySelector('#cw-message').className });
  } finally { w.dom.window.close(); }
}
{
  const w = await workspace('architect');
  try {
    const input = w.document.querySelector('#f-DREAMGRAPH_ARCHITECT_PASS_TIMEOUT_MS');
    input.value = '45'; input.dispatchEvent(new w.window.Event('input', { bubbles: true }));
    w.document.querySelector('#cw-save').click();
    await settled(() => !!w.applied() && w.document.querySelector('#cw-message').textContent.startsWith('Saved'));
    observations.push({ probe: 'unconfirmed_config_activation', server_activation: 'restart_required',
      displayed: w.document.querySelector('#cw-message').textContent, class: w.document.querySelector('#cw-message').className });
  } finally { w.dom.window.close(); }
}
{
  const w = await workspace('repos');
  try {
    const selector = '[aria-label="Repository name"]';
    await settled(() => !!w.document.querySelector(selector));
    const input = w.document.querySelector(selector);
    input.value = 'unsaved-draft'; input.dispatchEvent(new w.window.Event('input', { bubbles: true }));
    const before = w.document.querySelector('#cw-draft-count').textContent;
    w.document.querySelector('#cw-refresh').click();
    await settled(() => w.stateReads() >= 2 && w.document.querySelector(selector)?.value === 'original');
    observations.push({ probe: 'repository_only_draft_reload', before, confirmations: w.confirms(),
      after: w.document.querySelector('#cw-draft-count').textContent, repository_name: w.document.querySelector(selector).value });
  } finally { w.dom.window.close(); }
}
{
  const input = { role: 'architect', env: {}, session: { provider: 'none', adapter: 'codex-cli', model: 'gpt-6.1-sol', effort: 'xhigh' } };
  const inspected = resolveRolePolicy(input);
  const qualified = resolveRolePolicy({ ...input, capabilities: {
    adapter: 'codex-cli', version: 'dreamgraph.native_cli_invocation.v1', model: 'gpt-6.1-sol',
    apis: ['native_cli'], efforts: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
    retention: [], strict_schema: false,
  } });
  observations.push({ probe: 'cli_inspection_vs_execution_capabilities', inspected: inspected.status,
    diagnostics: inspected.diagnostics, with_execution_capabilities: qualified.status, execution_diagnostics: qualified.diagnostics });
}
console.log(JSON.stringify({ reviewed_version: '14.0.1', generated_at: new Date().toISOString(), observations }, null, 2));
