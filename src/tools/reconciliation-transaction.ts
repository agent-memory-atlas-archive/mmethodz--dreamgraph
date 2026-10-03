/** Scan-revision compatibility adapter over the canonical publication authority. */
import {
  commitGraphWrites, recoverGraphPublication, type PublicationRecovery,
} from "../graph/publication.js";
import type { OperationReceipt } from "../graph/contracts.js";
import { randomUUID } from "node:crypto";
import { withGraphReconciliation } from "../utils/graph-reconciliation-barrier.js";
import { prepareChangeReconciliation } from "../graph/change-obligations.js";

export interface ReconciliationWrite { file: string; content: string }

export function recoverReconciliationTransaction(): Promise<PublicationRecovery> {
  return recoverGraphPublication();
}

export async function withReconciliationTransaction<T>(input: {
  expected_revision: string | null;
  next_revision: string;
  writes: ReconciliationWrite[];
  read_current_revision: () => Promise<string | null>;
  before_commit?: () => Promise<T>;
  operation_id?: string;
  operation_epoch?: string;
  reconciliation_scope?: string[];
  full_scan?: boolean;
  /** Only obligations whose source scopes this transaction actually reconciles. */
  change_obligation_ids?: string[];
  /** Deterministic disposable-state test seam; production callers omit it. */
  fault_inject?: (step: string) => Promise<void> | void;
}): Promise<{ transaction_id: string; result: T | undefined; receipt: OperationReceipt; replayed: boolean }> {
  return withGraphReconciliation(async () => {
  await recoverGraphPublication();
  const operation_id = input.operation_id ?? randomUUID();
  const obligationWrites = input.change_obligation_ids?.length ? await prepareChangeReconciliation(input.change_obligation_ids, operation_id) : [];
  const committed = await commitGraphWrites({
    actor: "source_reconciliation", cause: input.full_scan ? "full_scan" : "incremental_scan",
    operation_id, operation_epoch: input.operation_epoch,
    intent: { expected_revision: input.expected_revision, next_revision: input.next_revision,
      writes: input.writes, change_obligation_ids: input.change_obligation_ids ?? [], full_scan: input.full_scan ?? false,
      reconciliation_scope: input.reconciliation_scope ?? [] },
    writes: [
      ...input.writes.filter(w => w.file !== "scan_state.json"),
      ...obligationWrites,
      ...input.writes.filter(w => w.file === "scan_state.json"),
    ],
    source_reconciliation: { revision: input.next_revision, scope: input.reconciliation_scope ?? [], full: input.full_scan ?? false },
    check_expected: async () => {
      const current = await input.read_current_revision();
      if (current !== input.expected_revision) {
        throw new Error(`RECONCILIATION_REVISION_CONFLICT: expected ${input.expected_revision ?? "none"}, found ${current ?? "none"}`);
      }
    },
    before_commit: input.before_commit, fault_inject: input.fault_inject,
  });
  return { transaction_id: committed.receipt.transaction_id, result: committed.result as T | undefined,
    receipt: committed.receipt, replayed: committed.replayed };
  });
}
