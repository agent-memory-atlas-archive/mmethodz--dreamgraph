import type { ContextPack, ContextQuery } from "../graph-contracts.js";

/** Read-only evidence port. Assembly never attests execution delivery or private plugin effects. */
export interface GraphContextPort {
  readonly availability: "available" | "unavailable";
  readonly reasons: readonly string[];
  retrieve(request: ContextQuery, options?: { signal?: AbortSignal }): Promise<ContextPack>;
}
