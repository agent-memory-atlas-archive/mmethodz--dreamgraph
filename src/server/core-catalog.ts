/** Registration is the catalogue authority. Collecting it invokes no handlers or background jobs. */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import { z, type ZodRawShape } from "zod";
import { registerResources } from "../resources/register.js";
import { registerTools } from "../tools/register.js";
import { registerCognitiveResources, registerCognitiveTools } from "../cognitive/register.js";
import { registerDisciplineResource } from "../discipline/register.js";
import { getToolClassification, TOOL_CLASSIFICATIONS } from "../discipline/manifest.js";
import { config } from "../config/config.js";
import { coreToolPolicy } from "./tool-policy.js";
export function registerCoreCatalog(server: McpServer) {
  registerResources(server); registerTools(server); registerCognitiveResources(server); registerCognitiveTools(server); registerDisciplineResource(server);
}
export interface CollectedTool { name: string; description: string; shape: ZodRawShape; handler: (...args: any[]) => any; }
export function collectCoreRegistration() {
  const tools: CollectedTool[] = [], resources: Array<{ name: string; uri: string; description: string; mimeType: string }> = [];
  const server = {
    tool: (name: string, ...args: any[]) => {
      const description = typeof args[0] === "string" ? args.shift() : "";
      const handler = args.pop(); const shape = args[0] && Object.values(args[0]).every(v => v instanceof z.ZodType) ? args[0] : {};
      if (typeof handler !== "function" || tools.some(tool => tool.name === name)) throw new Error(`CORE_TOOL_REGISTRATION_INVALID:${name}`);
      tools.push({ name, description, shape, handler }); return {};
    },
    resource: (name: string, uri: unknown, metadata: any) => {
      if (typeof uri !== "string" || resources.some(resource => resource.uri === uri)) throw new Error(`CORE_RESOURCE_REGISTRATION_INVALID:${name}`);
      resources.push({ name, uri, description: metadata?.description || "", mimeType: metadata?.mimeType || "application/json" }); return {};
    },
  } as unknown as McpServer;
  registerCoreCatalog(server);
  return { tools: tools.sort((a, b) => a.name.localeCompare(b.name)), resources: resources.sort((a, b) => a.uri.localeCompare(b.uri)) };
}
function portableSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(portableSchema);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, field]) =>
    [key, key === "description" && typeof field === "string" && field.startsWith("Repository name") ? "Repository name (configured instance repositories). Path is resolved relative to repo root." : portableSchema(field)]));
  return value;
}
export function coreCatalog(options: { portable?: boolean } = {}) {
  const registration = collectCoreRegistration();
  const names = new Set(registration.tools.map(tool => tool.name));
  const missing = [...names].filter(name => !getToolClassification(name));
  const extras = TOOL_CLASSIFICATIONS.filter(tool => !names.has(tool.tool_name) && tool.tool_name !== "read_local_file");
  if (missing.length || extras.length) throw new Error(`CORE_DISCIPLINE_PARITY:${JSON.stringify({ missing, extras })}`);
  return { schema: "dreamgraph.mcp_catalog.v1", contract_version: 1, server_version: config.server.version,
    compatibility: { accepted_contract_versions: [1], legacy_text: "retained", mutation_retry: "never automatic after uncertain dispatch" },
    tools: registration.tools.map(tool => ({ name: tool.name, description: tool.description,
      inputSchema: (options.portable ? portableSchema(toJsonSchemaCompat(z.object(tool.shape).strict(), { target: "jsonSchema7" })) : toJsonSchemaCompat(z.object(tool.shape).strict(), { target: "jsonSchema7" })) as Record<string, unknown>, policy: coreToolPolicy(tool.name), classification: getToolClassification(tool.name)! })),
    resources: registration.resources, local_extensions: ["read_local_file"],
    future_contributions: "Later owning slices register and test their commands/Computer Use operations; final catalogue is qualified at Slice27." };
}
