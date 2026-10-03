import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { ReviewableFileFilter } from './reviewable-file-filter';

export type ReviewFileKind = 'existing' | 'missing' | 'deleted';
export type ReviewStatus = 'pending' | 'kept' | 'undone' | 'conflict';
export interface ReviewAuthority { endpoint: string; instanceId: string }
export interface UndoAction { tool: 'create_file' | 'delete_file'; arguments: Record<string, unknown>; authority: ReviewAuthority }
export type UndoDispatcher = (action: UndoAction) => Promise<{ executionId: string; closureStatus: string }>;
/** Only a host-side pre-dispatch refusal or confirmed no-change closure may use this disposition. */
export class UndoDispatchRefusal extends Error { readonly confirmedNoEffect = true; }
export class UndoOutcomeUnconfirmed extends Error {
  constructor(message: string, readonly executionId: string, options?: ErrorOptions) { super(message, options); }
}

export interface PendingChangeReview {
  id: string;
  authority?: ReviewAuthority;
  undoUnconfirmed?: boolean;
  undoExecutionId?: string;
  filePath: string;
  baselineKind: 'existing' | 'missing';
  currentKind: 'existing' | 'deleted';
  baselineHash: string | null;
  lastReviewHash: string | null;
  currentHash: string | null;
  baselineContent?: Uint8Array;
  createdAt: number;
  updatedAt: number;
  status: ReviewStatus;
}

export interface ReviewActionResult {
  ok: boolean;
  status: ReviewStatus;
  filePath: string;
  message: string;
}

export interface WorkspaceChangeReviewSnapshot {
  authority?: ReviewAuthority;
  capturedAt: number;
  files: Map<string, { kind: 'existing' | 'missing'; hash: string | null; content?: Uint8Array }>;
}

/**
 * Tracks pending agent-created file changes for Copilot-style review UI.
 *
 * Baseline is captured once before the first service-managed write. Repeated
 * service-managed writes update lastReviewHash so they do not look like manual
 * conflicts. Keep/Undo check the disk hash against lastReviewHash first.
 */
export class ChangeReviewService {
  private readonly pending = new Map<string, PendingChangeReview>();

  getPendingReviews(): PendingChangeReview[] {
    return Array.from(this.pending.values()).filter(review => review.status === 'pending' || review.status === 'conflict').map(review => this.copyReview(review));
  }

  getPendingReview(filePath: string): PendingChangeReview | undefined {
    const review = this.pending.get(path.resolve(filePath));
    return review && this.copyReview(review);
  }

  private copyReview(review: PendingChangeReview): PendingChangeReview {
    return { ...review, ...(review.authority ? { authority: { ...review.authority } } : {}),
      ...(review.baselineContent ? { baselineContent: Uint8Array.from(review.baselineContent) } : {}) };
  }

  async captureBeforeWrite(filePath: string): Promise<void> {
    const absPath = path.resolve(filePath);

    if (!ReviewableFileFilter.isReviewablePath(absPath) || this.pending.has(absPath)) {
      return;
    }

    const before = await this.readSnapshot(absPath);
    const now = Date.now();

    this.pending.set(absPath, {
      id: crypto.randomUUID(),
      filePath: absPath,
      baselineKind: before.kind === 'existing' ? 'existing' : 'missing',
      currentKind: before.kind === 'existing' ? 'existing' : 'deleted',
      baselineHash: before.hash,
      lastReviewHash: before.hash,
      currentHash: before.hash,
      baselineContent: before.content,
      createdAt: now,
      updatedAt: now,
      status: 'pending',
    });
  }

  async recordAfterWrite(filePath: string): Promise<void> {
    const absPath = path.resolve(filePath);
    const review = this.pending.get(absPath);

    if (!review) {
      return;
    }

    const reviewId = review.id;
    const after = await this.readSnapshot(absPath);
    if (review.undoUnconfirmed || review.id !== reviewId || this.pending.get(absPath) !== review) {
      review.status = 'conflict';
      return;
    }
    if (review.lastReviewHash !== after.hash) review.id = crypto.randomUUID();
    review.currentKind = after.kind === 'existing' ? 'existing' : 'deleted';
    review.currentHash = after.hash;
    review.lastReviewHash = after.hash;
    review.updatedAt = Date.now();
    review.status = 'pending';
  }

  async captureWorkspaceSnapshot(authority?: ReviewAuthority): Promise<WorkspaceChangeReviewSnapshot> {
    const files = new Map<string, { kind: 'existing' | 'missing'; hash: string | null; content?: Uint8Array }>();
    const paths = await this.listReviewableWorkspacePaths();

    for (const filePath of paths) {
      files.set(filePath, await this.readSnapshot(filePath));
    }

    return { capturedAt: Date.now(), files, ...(authority ? { authority: { ...authority } } : {}) };
  }

  async recordWorkspaceChanges(snapshot: WorkspaceChangeReviewSnapshot): Promise<string[]> {
    const changedPaths: string[] = [];
    const afterPaths = await this.listReviewableWorkspacePaths();
    const candidatePaths = new Set<string>([...snapshot.files.keys(), ...afterPaths]);

    for (const filePath of candidatePaths) {
      if (!ReviewableFileFilter.isReviewablePath(filePath)) {
        continue;
      }

      const before = snapshot.files.get(filePath) ?? { kind: 'missing' as const, hash: null };
      const after = await this.readSnapshot(filePath);

      if (before.hash === after.hash) {
        continue;
      }

      changedPaths.push(filePath);
      const existingReview = this.pending.get(filePath);
      if (existingReview) {
        if (existingReview.undoUnconfirmed || JSON.stringify(existingReview.authority) !== JSON.stringify(snapshot.authority)) {
          existingReview.status = 'conflict';
          continue;
        }
        if (existingReview.lastReviewHash !== after.hash) existingReview.id = crypto.randomUUID();
        existingReview.currentKind = after.kind === 'existing' ? 'existing' : 'deleted';
        existingReview.currentHash = after.hash;
        existingReview.lastReviewHash = after.hash;
        existingReview.updatedAt = Date.now();
        existingReview.status = 'pending';
        continue;
      }

      const now = Date.now();
      this.pending.set(filePath, {
        id: crypto.randomUUID(),
        ...(snapshot.authority ? { authority: { ...snapshot.authority } } : {}),
        filePath,
        baselineKind: before.kind === 'existing' ? 'existing' : 'missing',
        currentKind: after.kind === 'existing' ? 'existing' : 'deleted',
        baselineHash: before.hash,
        lastReviewHash: after.hash,
        currentHash: after.hash,
        baselineContent: before.content,
        createdAt: now,
        updatedAt: now,
        status: 'pending',
      });
    }

    return changedPaths;
  }

  async keep(filePath: string, reviewId: string): Promise<ReviewActionResult> {
    const absPath = path.resolve(filePath);
    const review = this.pending.get(absPath);

    if (!review || review.id !== reviewId || review.undoUnconfirmed) {
      return { ok: false, status: 'conflict', filePath: absPath, message: 'No pending review exists for this file.' };
    }

    const conflict = await this.detectConflict(review);
    if (review.id !== reviewId || this.pending.get(absPath) !== review || review.undoUnconfirmed)
      return { ok: false, status: 'conflict', filePath: absPath, message: 'Review target changed; select the current review.' };
    if (conflict) {
      review.status = 'conflict';
      return { ok: false, status: 'conflict', filePath: absPath, message: conflict };
    }

    review.status = 'kept';
    this.pending.delete(absPath);
    return { ok: true, status: 'kept', filePath: absPath, message: 'Kept current file changes.' };
  }

  async undo(filePath: string, reviewId: string, dispatch: UndoDispatcher): Promise<ReviewActionResult> {
    const absPath = path.resolve(filePath);
    const review = this.pending.get(absPath);

    if (!review || review.id !== reviewId || review.undoUnconfirmed) {
      return { ok: false, status: 'conflict', filePath: absPath, message: 'No pending review exists for this file.' };
    }

    const conflict = await this.detectConflict(review);
    if (review.id !== reviewId || this.pending.get(absPath) !== review || review.undoUnconfirmed)
      return { ok: false, status: 'conflict', filePath: absPath, message: 'Review target changed; select the current review.' };
    if (conflict) {
      review.status = 'conflict';
      return { ok: false, status: 'conflict', filePath: absPath, message: conflict };
    }
    if (review.lastReviewHash === review.baselineHash) {
      review.status = 'undone'; this.pending.delete(absPath);
      return { ok: true, status: 'undone', filePath: absPath, message: 'Original source bytes are already present. Review cleared; graph obligations are unchanged.' };
    }
    if (!review.authority) return { ok: false, status: 'conflict', filePath: absPath, message: 'Undo requires the original managed daemon binding; this review has no execution authority.' };
    // Capture full original bytes and reviewed revision before yielding to host admission.
    let content: string | undefined;
    if (review.baselineKind === 'existing') {
      if (!review.baselineContent) return { ok: false, status: 'conflict', filePath: absPath, message: 'Original file bytes are unavailable; Undo refused.' };
      try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(review.baselineContent); }
      catch { return { ok: false, status: 'conflict', filePath: absPath, message: 'Exact UTF-8 baseline is unavailable; Undo refuses byte conversion.' }; }
    }
    const baselineHash = review.baselineHash;
    const action: UndoAction = { authority: { ...review.authority }, tool: review.baselineKind === 'missing' ? 'delete_file' : 'create_file',
      arguments: { filePath: absPath, ...(content === undefined ? {} : { content }), expected_hash: review.lastReviewHash === null ? null : 'sha256:' + review.lastReviewHash } };
    // A duplicate click or uncertain dispatch must not issue a second source effect.
    review.undoUnconfirmed = true;
    try {
      const result = await dispatch(action);
      review.undoExecutionId = result.executionId;
      if (!['no_change', 'state_committed', 'graph_committed', 'reconciliation_pending'].includes(result.closureStatus)) throw new Error('UNDO_CLOSURE_UNCONFIRMED: ' + result.executionId);
      const after = await this.readSnapshot(absPath);
      if (after.hash !== baselineHash) throw new Error('UNDO_POSTCONDITION_UNCONFIRMED: ' + result.executionId);
      if (this.pending.get(absPath) !== review) throw new Error('UNDO_REVIEW_TARGET_CHANGED');
      review.status = 'undone'; this.pending.delete(absPath);
      return { ok: true, status: 'undone', filePath: absPath, message: `Restored exact file baseline. Execution ${result.executionId}: ${result.closureStatus}. Source restoration does not attest graph reconciliation.` };
    } catch (error) {
      review.status = 'conflict';
      if (error instanceof UndoOutcomeUnconfirmed) review.undoExecutionId = error.executionId;
      if (error instanceof UndoDispatchRefusal) {
        review.undoUnconfirmed = false;
        return { ok: false, status: 'conflict', filePath: absPath, message: `Undo refused with no source effect. ${error.message}` };
      }
      return { ok: false, status: 'conflict', filePath: absPath, message: `Undo outcome requires recovery; do not repeat it. ${String(error)}` };
    }
  }

  /** Inspect the original execution only. This method never dispatches source input again. */
  async recoverUndo(filePath: string, reviewId: string,
    inspect: (executionId: string, authority: ReviewAuthority) => Promise<{ executionId: string; closureStatus: string; authorityActive: boolean }>): Promise<ReviewActionResult> {
    const absPath = path.resolve(filePath), review = this.pending.get(absPath);
    if (!review || review.id !== reviewId || !review.undoUnconfirmed || !review.undoExecutionId || !review.authority)
      return { ok: false, status: 'conflict', filePath: absPath, message: 'No captured Undo execution is available for this review. Do not repeat uncertain work.' };
    const executionId = review.undoExecutionId;
    try {
      const result = await inspect(executionId, { ...review.authority });
      if (this.pending.get(absPath) !== review || review.id !== reviewId || result.executionId !== executionId || result.authorityActive
        || !['no_change', 'state_committed', 'graph_committed', 'reconciliation_pending'].includes(result.closureStatus))
        throw new Error('UNDO_RECOVERY_UNCONFIRMED: ' + executionId);
      const after = await this.readSnapshot(absPath);
      if (this.pending.get(absPath) !== review || review.id !== reviewId) throw new Error('UNDO_REVIEW_TARGET_CHANGED');
      if (after.hash === review.baselineHash) {
        this.pending.delete(absPath);
        return { ok: true, status: 'undone', filePath: absPath, message: `Confirmed exact source restoration from ${executionId}: ${result.closureStatus}. Graph reconciliation is separate.` };
      }
      if (result.closureStatus === 'no_change' && after.hash === review.lastReviewHash) {
        review.undoUnconfirmed = false; review.undoExecutionId = undefined; review.status = 'pending';
        return { ok: true, status: 'pending', filePath: absPath, message: `Execution ${executionId} confirms no source effect. The original file review is available again.` };
      }
      throw new Error('UNDO_RECOVERY_SOURCE_CONFLICT: ' + executionId);
    } catch (error) {
      return { ok: false, status: 'conflict', filePath: absPath, message: `Undo recovery remains unresolved; no effect was repeated. ${String(error)}` };
    }
  }

  private async detectConflict(review: PendingChangeReview): Promise<string | null> {
    const disk = await this.readSnapshot(review.filePath);
    const diskHash = disk.hash;
    review.currentKind = disk.kind === 'existing' ? 'existing' : 'deleted';
    review.currentHash = diskHash;

    if (diskHash !== review.lastReviewHash) {
      return 'File changed on disk after the last service-managed edit. Review before Keep/Undo.';
    }

    return null;
  }

  private async listReviewableWorkspacePaths(): Promise<string[]> {
    const vscode = await import('vscode');
    const uris = await vscode.workspace.findFiles(
      '**/*',
      '{**/.git/**,**/node_modules/**,**/bower_components/**,**/vendor/**,**/dist/**,**/out/**,**/build/**,**/target/**,**/coverage/**,**/.next/**,**/.nuxt/**,**/.turbo/**,**/.cache/**,**/.parcel-cache/**,**/.pytest_cache/**,**/.mypy_cache/**,**/__pycache__/**,**/.gradle/**,**/.idea/**,**/.vscode-test/**}',
      10000,
    );

    const paths = new Set<string>();
    for (const uri of uris) {
      if (ReviewableFileFilter.isReviewableUri(uri)) {
        paths.add(path.resolve(uri.fsPath));
      }
    }

    return Array.from(paths).sort();
  }

  private async readSnapshot(filePath: string): Promise<{ kind: 'existing' | 'missing'; hash: string | null; content?: Uint8Array }> {
    try {
      const content = await fs.readFile(filePath);
      return { kind: 'existing', hash: this.hash(content), content };
    } catch (error: unknown) {
      if (isNodeErrnoException(error) && error.code === 'ENOENT') {
        return { kind: 'missing', hash: null };
      }

      throw error;
    }
  }

  private hash(content: Uint8Array): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }
}

function isNodeErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

export const changeReviewService = new ChangeReviewService();
