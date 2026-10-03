/**
 * Plugin contributions adapter — bridges plugin-registered MCP tools and
 * resources (M4) onto a per-session McpServer instance.
 *
 * The DreamGraph daemon creates a fresh `McpServer` per client session.
 * This module is invoked from `createServer()` after the static tools and
 * resources are wired, iterating the manager's contribution registry and
 * binding each entry into the new session.
 *
 * Important semantics:
 *   - Contributions registered AFTER a session opens are not visible to
 *     that session (MCP has no live tool list mutation). New sessions
 *     pick them up.
 *   - When a plugin is unloaded/reloaded, contributions are marked
 *     inactive. The wrapper handlers below short-circuit with an error
 *     so existing sessions don't invoke a torn-down plugin.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolResultSchema, ReadResourceResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { z, type ZodRawShape, type ZodTypeAny } from "zod";
import {
  buildHandlerCompleted,
  buildHandlerStarted,
  type TelemetryEmitter,
} from "@dreamgraph/host";
import {
  getContributedResources,
  getContributedTools,
  getPluginTelemetry,
  type ContributedResource,
  type ContributedTool,
} from "./manager.js";
import { logger } from "../utils/logger.js";
import { normalizeToolResult, toolBoundaryError } from '../server/tool-boundary.js';
import { getSessionContext } from '../server/session-context.js';

/** Forward cancellation without racing away from an unconfirmed private handler. */
function contributionSignal(unload?:AbortSignal,request?:AbortSignal) {
  const policy=getSessionContext()?.execution_policy?.signal;
  const signals=[unload,request,policy].filter((signal):signal is AbortSignal=>!!signal);
  return signals.length?AbortSignal.any(signals):new AbortController().signal;
}

function correlationFor(pluginId: string, target: string): string {
  return `${pluginId}:${target}:${Date.now().toString(36)}`;
}

/**
 * Convert a JSON-Schema property descriptor into a Zod schema. Supports the
 * subset that plugin tools realistically declare today: scalar types
 * (string/number/integer/boolean), enums, arrays of any of the above, and
 * nested objects. Anything outside that subset falls back to `z.unknown()`,
 * which lets the request pass through untyped rather than failing
 * validation.
 */
function jsonSchemaPropToZod(prop: Record<string, unknown>): ZodTypeAny {
  const type = prop?.["type"];
  const description = typeof prop?.["description"] === "string"
    ? (prop["description"] as string)
    : undefined;
  const enumVals = Array.isArray(prop?.["enum"]) ? (prop["enum"] as unknown[]) : undefined;

  let schema: ZodTypeAny;
  if (enumVals && enumVals.every((v) => typeof v === "string")) {
    schema = z.enum(enumVals as [string, ...string[]]);
  } else if (type === "string") {
    schema = z.string();
  } else if (type === "integer") {
    schema = z.number().int();
  } else if (type === "number") {
    schema = z.number();
  } else if (type === "boolean") {
    schema = z.boolean();
  } else if (type === "array") {
    const items = (prop["items"] as Record<string, unknown> | undefined) ?? {};
    schema = z.array(jsonSchemaPropToZod(items));
  } else if (type === "object") {
    const shape = jsonSchemaToZodShape(prop);
    schema = Object.keys(shape).length ? z.object(shape).passthrough() : z.record(z.unknown());
  } else {
    schema = z.unknown();
  }
  return description ? schema.describe(description) : schema;
}

/**
 * Convert a plugin tool's `inputSchema` (JSON Schema object form) into a
 * Zod raw shape suitable for `McpServer.tool(name, desc, shape, cb)`.
 * Properties not listed in `required` are wrapped in `.optional()` so MCP
 * preserves them when present and omits them otherwise.
 */
function jsonSchemaToZodShape(input: Record<string, unknown> | undefined): ZodRawShape {
  if (!input || typeof input !== "object") return {};
  const props = input["properties"];
  if (!props || typeof props !== "object") return {};
  const required = new Set(
    Array.isArray(input["required"])
      ? (input["required"] as unknown[]).filter((v): v is string => typeof v === "string")
      : [],
  );
  const shape: ZodRawShape = {};
  for (const [key, raw] of Object.entries(props as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const field = jsonSchemaPropToZod(raw as Record<string, unknown>);
    shape[key] = required.has(key) ? field : field.optional();
  }
  return shape;
}

function bindTool(
  server: McpServer,
  c: ContributedTool,
  telemetry: TelemetryEmitter,
): void {
  const { definition } = c;
  const description =
    definition.description?.trim() ||
    `Plugin tool '${definition.name}' contributed by ${c.pluginId}@${c.pluginVersion}`;
  const identity = {
    plugin_id: c.pluginId,
    plugin_version: c.pluginVersion,
  };
  // Translate the plugin's JSON-Schema `inputSchema` into a Zod raw
  // shape so the MCP SDK exposes the parameters in `tools/list` and
  // forwards validated arguments to the handler. Unsupported schema
  // fragments degrade to `z.unknown()` rather than failing the
  // registration.
  const shape = jsonSchemaToZodShape(
    definition.inputSchema as Record<string, unknown> | undefined,
  );
  server.tool(definition.name, description, shape, async (args, _extra) => {
    if (!c.active) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: "tool_unavailable",
              detail: `Plugin ${c.pluginId} has been unloaded; restart your MCP session to refresh tool list.`,
            }),
          },
        ],
      };
    }
    const signal=contributionSignal(c.signal,_extra?.signal);
    if(signal.aborted)return toolBoundaryError(definition.name,'PLUGIN_REQUEST_CANCELLED_BEFORE_DISPATCH','Plugin handler did not run.');
    const correlation_id = correlationFor(c.pluginId, definition.name);
    telemetry.emit(
      "plugin.handler.started",
      buildHandlerStarted({
        identity,
        correlation_id,
        seam: "tool",
        target: definition.name,
      }),
    );
    const startedAt = Date.now();
    let ok = true;
    try {
      const result = await definition.handler(args, {
        pluginId: c.pluginId,
        signal,
      });
      const object=result&&typeof result==='object'?result as Record<string,unknown>:undefined;
      let owner;
      if(object&&Array.isArray(object.content)){
        if(!CallToolResultSchema.safeParse(object).success)throw new Error('PLUGIN_TOOL_RESULT_INVALID');
        owner=object;
      }else{
        const text=typeof result==='string'?result:JSON.stringify(result,null,2);
        if(typeof text!=='string')throw new Error('PLUGIN_TOOL_RESULT_UNSERIALIZABLE');
        owner={content:[{type:'text' as const,text}],...(object?.isError===true||object?.success===false?{isError:true}:{})};
      }
      const normalized=normalizeToolResult(definition.name,owner);
      ok=normalized.isError!==true;
      return {...normalized,_meta:{...normalized._meta,plugin_handler:{plugin_id:c.pluginId,
        callback_settled:true,cancellation_requested:signal.aborted,private_effects:'unattested; consult owner receipts'}}};
    } catch (err) {
      ok = false;
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(
        `Plugin tool ${definition.name} threw: ${msg}`,
      );
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ error: "handler_threw", message: msg,
              ...(signal.aborted?{cancellation_requested:true,effect_status:'unconfirmed; consult owner receipts'}:{}) }),
          },
        ],
      };
    } finally {
      telemetry.emit(
        "plugin.handler.completed",
        buildHandlerCompleted({
          identity,
          correlation_id,
          seam: "tool",
          target: definition.name,
          duration_ms: Date.now() - startedAt,
          ok,
        }),
      );
    }
  });
}

function bindResource(
  server: McpServer,
  c: ContributedResource,
  telemetry: TelemetryEmitter,
): void {
  const { definition } = c;
  const identity = {
    plugin_id: c.pluginId,
    plugin_version: c.pluginVersion,
  };
  const safeName = definition.uriNamespace
    .replace(/^plugin:\/\//, "plugin-")
    .replace(/[^\w.-]+/g, "-");
  server.resource(
    safeName,
    definition.uriNamespace,
    {
      description:
        definition.description ||
        `Plugin resource '${definition.uriNamespace}' contributed by ${c.pluginId}@${c.pluginVersion}`,
      mimeType: "application/json",
    },
    async (uri,extra) => {
      if (!c.active) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify({
                error: "resource_unavailable",
                detail: `Plugin ${c.pluginId} has been unloaded.`,
              }),
            },
          ],
        };
      }
      const signal=contributionSignal(c.signal,extra?.signal);
      if(signal.aborted)return {contents:[{uri:uri.href,mimeType:'application/json',text:JSON.stringify({error:'request_cancelled_before_dispatch',handler_ran:false})}]};
      const correlation_id = correlationFor(c.pluginId, definition.uriNamespace);
      telemetry.emit(
        "plugin.handler.started",
        buildHandlerStarted({
          identity,
          correlation_id,
          seam: "resource",
          target: definition.uriNamespace,
        }),
      );
      const startedAt = Date.now();
      let ok = true;
      try {
        const result = await definition.handler(
          { uri: uri.href },
          { pluginId: c.pluginId,signal },
        );
        const object=result&&typeof result==='object'?result as Record<string,unknown>:undefined;
        const owner=object&&Array.isArray(object.contents)?object:{contents:[{uri:uri.href,mimeType:'application/json',text:typeof result==='string'?result:JSON.stringify(result,null,2)}]};
        if(Buffer.byteLength(JSON.stringify(owner),'utf8')>8*1024*1024)throw new Error('PLUGIN_RESOURCE_BYTE_BOUND: whole result refused, no clipping');
        const parsed=ReadResourceResultSchema.safeParse(owner);if(!parsed.success)throw new Error('PLUGIN_RESOURCE_RESULT_INVALID');
        return {...parsed.data,...owner,_meta:{...(object?._meta as object??{}),plugin_handler:{plugin_id:c.pluginId,
          callback_settled:true,cancellation_requested:signal.aborted,private_effects:'unattested; consult owner receipts'}}};
      } catch (err) {
        ok = false;
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(
          `Plugin resource ${definition.uriNamespace} threw: ${msg}`,
        );
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify({ error: "handler_threw", message: msg,...(signal.aborted?{cancellation_requested:true,effect_status:'unconfirmed'}:{}) }),
            },
          ],
        };
      } finally {
        telemetry.emit(
          "plugin.handler.completed",
          buildHandlerCompleted({
            identity,
            correlation_id,
            seam: "resource",
            target: definition.uriNamespace,
            duration_ms: Date.now() - startedAt,
            ok,
          }),
        );
      }
    },
  );
}

/**
 * Bind every currently-contributed plugin tool and resource onto the
 * given session McpServer. Called once per session from `createServer()`.
 */
export function registerPluginContributions(server: McpServer): void {
  const telemetry = getPluginTelemetry();
  const tools = getContributedTools();
  const resources = getContributedResources();
  for (const t of tools) bindTool(server, t, telemetry);
  for (const r of resources) bindResource(server, r, telemetry);
  if (tools.length || resources.length) {
    logger.info(
      `Plugin contributions wired into session: ${tools.length} tool(s), ${resources.length} resource(s)`,
    );
  }
}
