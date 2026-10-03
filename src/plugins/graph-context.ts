/** Capability-gated read port over the canonical owner; no plugin-defined graph semantics. */
import type { GraphContextPort, PluginManifest } from "@dreamgraph/sdk";
import { ContextPackSchema, ContextQuerySchema } from "../graph/contracts.js";
import { buildContextPack } from "../graph/context-pack.js";
import { loadCanonicalGraph } from "../graph/read-model.js";

export function createPluginGraphContext(manifest: PluginManifest, instanceId: string, unload: AbortSignal): GraphContextPort {
  const permitted = manifest.capabilities.includes("resources:read") && manifest.expectedEffects.includes("read_internal_graph");
  return {
    availability: permitted ? "available" : "unavailable",
    reasons: permitted ? [] : ["PLUGIN_GRAPH_CONTEXT_CAPABILITY_REQUIRED: resources:read and read_internal_graph"],
    async retrieve(request, options) {
      const signal = options?.signal ? AbortSignal.any([options.signal, unload]) : unload;
      signal.throwIfAborted();
      if (!permitted) throw new Error("PLUGIN_GRAPH_CONTEXT_CAPABILITY_REQUIRED");
      const query = ContextQuerySchema.parse({ ...request, adapter: `plugin:${manifest.id}` });
      const snapshot = await loadCanonicalGraph(instanceId); signal.throwIfAborted();
      // Parse/copy the result so caller mutation cannot alter cached core identities or evidence.
      return ContextPackSchema.parse(buildContextPack(snapshot, query));
    },
  };
}
