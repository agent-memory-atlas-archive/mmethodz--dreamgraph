/** Bounded whole-record queries share the MCP resources/read URI authority. */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceQuerySchema, ResourceQueryError, queryResourceLegacy, queryResourcePage } from "../resources/resolver.js";

export const QueryResourceInputSchema = {
  ...ResourceQuerySchema.shape,
  uri: ResourceQuerySchema.shape.uri.describe("Registered resource URI. system://capabilities describes runtime; system://capability-entities contains project capabilities."),
  filter: ResourceQuerySchema.shape.filter.describe("Top-level entity payload fields; strings match case-insensitively. The same filter is required on continuation."),
  limit: ResourceQuerySchema.shape.limit.describe("Maximum whole records per page (1–1000; default 50). Byte limits may return fewer."),
  max_bytes: ResourceQuerySchema.shape.max_bytes.describe("Maximum serialized page bytes including metadata (1024–65536; default 8192). Individual records are never clipped or skipped."),
  cursor: ResourceQuerySchema.shape.cursor.describe("Opaque continuation from the same URI/filter/revision. Changed state, daemon restart, scope change or expiry requires restarting the query."),
  contract_version: z.enum(["v1", "legacy"]).default("v1").describe("v1 returns revisioned record pages; legacy is an explicit bounded presentation adapter without paging."),
};

export function registerQueryResourceTool(server: McpServer): void {
  server.tool("query_resource",
    "Read any listed DreamGraph resource with canonical identity, evidence, revision, currency, completeness and whole-record continuation. Follow every cursor before claiming complete retrieval. Empty matches are successful empty results; invalid/unavailable resources are explicit errors. Runtime and graph capability URIs have distinct meanings.",
    QueryResourceInputSchema, async ({ contract_version, ...input }) => {
      try {
        const data = contract_version === "legacy" ? await queryResourceLegacy(input) : await queryResourcePage(input);
        const unavailable = contract_version !== "legacy" && (data as { state: { availability: string } }).state.availability === "unavailable";
        const result = { success: !unavailable, data,
          ...(unavailable ? { error: { code: "RESOURCE_UNAVAILABLE", message: "Requested scope is unavailable. Inspect result state/reasons; no empty success was fabricated." } } : {}),
          ...(contract_version === "legacy" ? { compatibility: { version: "legacy", bounded: true, paging: false, capability_entities_uri: "system://capability-entities" } } : {}) };
        return { isError: unavailable, content: [{ type: "text" as const, text: JSON.stringify(result) }], structuredContent: result };
      } catch (failure) {
        const code = failure instanceof ResourceQueryError ? failure.code : failure instanceof z.ZodError ? "INVALID_ARGUMENT" : "RESOURCE_UNAVAILABLE";
        const result = { success: false, error: { code, message: failure instanceof Error ? failure.message : String(failure) } };
        return { isError: true, content: [{ type: "text" as const, text: JSON.stringify(result) }], structuredContent: result };
      }
    });
}
