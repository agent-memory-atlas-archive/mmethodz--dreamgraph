/** Execution scope shared by publication, source effects and inference. No second job store. */
import { AsyncLocalStorage } from "node:async_hooks";
import type { ResourceBudget } from "../graph/contracts.js";
import type { ModelRole, ResolvedRolePolicy } from "../config/role-policy.js";

export interface JobExecutionContext {
  id: string;
  fence: number;
  directory: string;
  signal: AbortSignal;
  role_policies: Partial<Record<ModelRole, Readonly<ResolvedRolePolicy>>>;
  pricing: string;
  parent_admission: { run_id: string; fingerprint: string; budget: ResourceBudget };
  assert_current: () => Promise<void>;
}
const execution = new AsyncLocalStorage<JobExecutionContext>();
export const currentJob = (): JobExecutionContext | undefined => execution.getStore();
export const withinJob = <T>(context: JobExecutionContext, work: () => T): T => execution.run(context, work);
/** Only control/settlement bookkeeping may leave the cancelled execution scope. */
export const withoutJobContext = <T>(work: () => T): T => execution.exit(work);
export async function assertJobCurrent(): Promise<void> {
  const job = currentJob();
  if (!job) return;
  job.signal.throwIfAborted();
  await job.assert_current();
  job.signal.throwIfAborted();
}
