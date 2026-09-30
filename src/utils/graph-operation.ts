import { AsyncLocalStorage } from "node:async_hooks";
import { resolve } from "node:path";
import { getDataDir } from "./paths.js";

type GraphOperationKind = "scan" | "enrichment";
interface OperationOwner { key: string; token: symbol; kind: GraphOperationKind }
const active = new Map<string, OperationOwner>();
const ownership = new AsyncLocalStorage<OperationOwner>();

export class GraphOperationBusyError extends Error {
  readonly code = "GRAPH_OPERATION_BUSY";
  constructor(kind: GraphOperationKind) {
    super(`A ${kind} is already running for this instance. Wait for it to finish before starting another scan or enrichment pass.`);
    this.name = "GraphOperationBusyError";
  }
}

/** Fail before paid calls or graph writes; allow enrichment within its owning scan. */
export async function withGraphOperation<T>(kind: GraphOperationKind, fn: () => Promise<T>): Promise<T> {
  const directory = resolve(getDataDir());
  const key = process.platform === "win32" ? directory.toLowerCase() : directory;
  const existing = active.get(key);
  if (existing) {
    if (ownership.getStore()?.token === existing.token) return fn();
    throw new GraphOperationBusyError(existing.kind);
  }
  const owner: OperationOwner = { key, kind, token: Symbol(kind) };
  active.set(key, owner);
  try {
    return await ownership.run(owner, fn);
  } finally {
    if (active.get(key) === owner) active.delete(key);
  }
}
