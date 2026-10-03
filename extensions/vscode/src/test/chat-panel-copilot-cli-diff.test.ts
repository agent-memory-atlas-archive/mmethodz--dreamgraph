// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Physical snapshot check plus source-level audit for Plan A: workspace review bookends
// around copilot-cli runs, so the change-review pending list (and thus
// the architect Diff view) populates for copilot-cli the same way it
// does for the native API adapters.
//
// Plan A's correctness rests on three things being present in
// chat-panel.ts:
//
//   1. Both copilot-cli call sites (`handleUserMessage` and
//      `_runAutonomyContinuationPass`) capture a snapshot via
//      `changeReviewService.captureWorkspaceSnapshot()` BEFORE
//      `runPassViaCopilotCli` runs, gated on `copilotCliRoute`.
//   2. The capture is paired with `recordWorkspaceChanges` in a
//      `finally` so the pending list is reconciled even on errors.
//   3. When recorded paths exist, the webview is notified via
//      `_postPendingReviews()` so the Diff button lights up.
//
// The shared compiled production loader supplies only VSCode API doubles.
// Full execution/authority qualification is recorded by the root HTTP/MCP tests;
// the remaining source audits cover the two CLI review notification bookends.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';

const chatPanelSource = readFileSync(
  join(process.cwd(), 'src', 'chat-panel.ts'),
  'utf8',
);

test('Plan A: an owned workspace snapshot retains the original authority and resulting source baseline', async () => {
  const {changeReviewService:service}=require(join(process.cwd(),'../../tests/helpers/compiled-editor.cjs')).compiledEditor();
  const root=await mkdtemp(join(tmpdir(),'dg-editor-owned-review-')),file=join(root,'source.ts');
  const authority={endpoint:'http://original-instance',instanceId:'original-instance'};
  service.listReviewableWorkspacePaths=async()=>[file];
  try{
    await writeFile(file,'baseline 🌿\r\n');const snapshot=await service.captureWorkspaceSnapshot(authority);
    authority.endpoint='http://changed-selection';await writeFile(file,'changed source');await service.recordWorkspaceChanges(snapshot);
    const review=service.getPendingReview(file);
    assert.equal(review.authority.endpoint,'http://original-instance');assert.equal(Buffer.from(review.baselineContent).toString('utf8'),'baseline 🌿\r\n');
    assert.notEqual(review.lastReviewHash,review.baselineHash);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('Plan A: copilot-cli turn reconciles via recordWorkspaceChanges in finally', () => {
  const occurrences = chatPanelSource.match(
    /if \(copilotCliReviewSnapshot\) \{[\s\S]*?changeReviewService\.recordWorkspaceChanges\(copilotCliReviewSnapshot\)/g,
  );
  assert.ok(
    occurrences && occurrences.length === 2,
    `expected 2 recordWorkspaceChanges reconciliation blocks, found ${occurrences?.length ?? 0}`,
  );
});

test('Plan A: when changed paths exist the pending-review webview push fires', () => {
  // Anchor on the copilot-cli bookend specifically: the
  // recordWorkspaceChanges call must be immediately followed by the
  // post-pending sequence in the same block. Both bookend sites
  // (handleUserMessage + autonomy continuation) must satisfy this.
  const occurrences = chatPanelSource.match(
    /changeReviewService\.recordWorkspaceChanges\(copilotCliReviewSnapshot\);\s*if \(changedReviewPaths\.length > 0\) \{\s*this\._pendingReviewsCollapsed = true;\s*await this\._postPendingReviews\(\);\s*\}/g,
  );
  assert.ok(
    occurrences && occurrences.length === 2,
    `expected 2 copilot-cli pending-review post sites, found ${occurrences?.length ?? 0}`,
  );
});

test('Plan A: review reconciliation errors are swallowed (do not break the turn)', () => {
  // Both reconciliation blocks must wrap the record/post pair in a
  // try/catch that only warns — review-tracking failures must never
  // tear down a copilot-cli turn.
  const occurrences = chatPanelSource.match(
    /catch \(reviewErr\) \{\s*console\.warn\(\s*'\[DreamGraph\] Failed to record pending review changes for copilot-cli/g,
  );
  assert.ok(
    occurrences && occurrences.length === 2,
    `expected 2 swallowed-error sites, found ${occurrences?.length ?? 0}`,
  );
});
