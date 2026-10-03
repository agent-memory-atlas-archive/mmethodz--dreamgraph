/**
 * DreamGraph MCP Client — Layer 3.
 *
 * Wraps @modelcontextprotocol/sdk to connect to the daemon's /mcp endpoint
 * over Streamable HTTP. Provides typed helpers for tool calls and resource reads.
 *
 * @see TDD §1.4 (Communication Protocol)
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { LoggingMessageNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import type * as vscode from "vscode";
import { EXTENSION_VERSION } from "./version.js";

/* ------------------------------------------------------------------ */
/*  MCP Client Wrapper                                                */
/* ------------------------------------------------------------------ */

export class McpClient implements vscode.Disposable {
  private _client: Client | null = null;
  private _transport: StreamableHTTPClientTransport | null = null;
  private _baseUrl: string;
  private _connecting: Promise<void> | null = null;
  private _pendingClient: Client | null = null;
  private _generation = 0;

  /** External listener for server log/progress messages (set by ChatPanel). */
  public onServerLog: ((level: string, message: string) => void) | null = null;

  constructor(baseUrl: string, private readonly authority?: { readonly sessionBearer: string }) {
    this._baseUrl = baseUrl;
  }

  /* ---- Connection ---- */

  get isConnected(): boolean {
    return this._client !== null;
  }

  /**
   * Establish an MCP session with the daemon.
   */
  async connect(): Promise<void> {
    if (this._client) return;
    if (this._connecting) return this._connecting;
    const generation = this._generation;
    const transport = new StreamableHTTPClientTransport(
      new URL(`${this._baseUrl}/mcp`),
      this.authority ? { requestInit: { headers: { "X-DreamGraph-Session": this.authority.sessionBearer } } } : undefined,
    );
    const client = new Client(
      { name: "dreamgraph-vscode", version: EXTENSION_VERSION },
      { capabilities: {} },
    );
    this._pendingClient = client;
    client.onclose = () => {
      if (this._client === client) { this._client = null; this._transport = null; }
    };
    client.setNotificationHandler(
      LoggingMessageNotificationSchema,
      (notification) => {
        if (generation === this._generation && this.onServerLog) {
          const p = notification.params;
          const msg = typeof p.data === 'string' ? p.data : JSON.stringify(p.data);
          this.onServerLog(p.level, msg);
        }
      },
    );
    const connecting = (async () => {
      try {
        await client.connect(transport);
        if (generation !== this._generation) throw new Error("MCP_CONNECTION_SUPERSEDED");
        this._client = client;
        this._transport = transport;
      } catch (error) {
        await client.close().catch(() => undefined);
        throw error;
      }
    })();
    this._connecting = connecting;
    try { await connecting; }
    finally {
      if (this._connecting === connecting) this._connecting = null;
      if (this._pendingClient === client) this._pendingClient = null;
    }
  }

  /**
   * Close the MCP session gracefully.
   */
  async disconnect(): Promise<void> {
    this._generation++;
    const clients = new Set([this._client, this._pendingClient]);
    // Invalidate before awaiting close so an old handshake cannot overwrite a new one.
    this._client = null;
    this._pendingClient = null;
    this._transport = null;
    this._connecting = null;
    await Promise.all([...clients].map(client => client?.close().catch(() => undefined)));
  }

  /**
   * Update the MCP endpoint URL (e.g. after port change).
   */
  updateBaseUrl(url: string): void {
    if (url === this._baseUrl) return;
    if (this.authority) throw new Error("MCP_WORKER_AUTHORITY_ENDPOINT_BOUND");
    this._baseUrl = url;
    void this.disconnect();
  }

  /**
   * Daemon base URL the client is currently configured against
   * (e.g. `http://127.0.0.1:7321`). Does NOT include the `/mcp`
   * path suffix.
   */
  get baseUrl(): string {
    return this._baseUrl;
  }

  /**
   * Fully qualified MCP endpoint (`<baseUrl>/mcp`). Use this when
   * handing the URL to other MCP clients (e.g. the Copilot CLI
   * inheritance bridge) so they connect to the SAME daemon session
   * the extension host is already using.
   */
  get mcpUrl(): string {
    return `${this._baseUrl}/mcp`;
  }

  /* ---- Tool Calls ---- */

  /**
   * List all available MCP tools on the daemon.
   */
  async listTools(): Promise<
    Array<{ name: string; description?: string; inputSchema: unknown }>
  > {
    this._ensureConnected();
    const result = await this._client!.listTools();
    return result.tools;
  }

  /**
   * Call an MCP tool by name with the given arguments.
   * @param timeoutMs Override request timeout (default 300 000 ms = 5 min).
   * @param onprogress Callback invoked with progress messages from the tool.
   */
  async callTool(
    name: string,
    args: Record<string, unknown> = {},
    timeoutMs = 300_000,
    onprogress?: (message: string, progress: number, total?: number) => void,
  ): Promise<unknown> {
    const result = await this.callToolRaw(name, args, timeoutMs, onprogress);
    // Convenience projection for legacy UI readers. Agent execution must use callToolRaw.
    if (result.content && Array.isArray(result.content)) {
      const textParts = result.content
        .filter((c: { type: string }) => c.type === "text")
        .map((c: { type: string; text: string }) => c.text);
      if (textParts.length === 1) {
        try { return JSON.parse(textParts[0]); } catch { return textParts[0]; }
      }
      return textParts.length > 0 ? textParts : result.content;
    }
    return result;
  }

  /** Whole owner result, including errors, metadata, structured content and receipts. */
  async callToolRaw(name: string, args: Record<string, unknown> = {}, timeoutMs = 300_000,
    onprogress?: (message: string, progress: number, total?: number) => void, signal?: AbortSignal) {
    this._ensureConnected(); signal?.throwIfAborted();
    return this._client!.callTool(
      { name, arguments: args },
      undefined,
      {
        timeout: timeoutMs,
        ...(signal ? { signal } : {}),
        ...(onprogress
          ? {
              onprogress: (p: { progress: number; total?: number; message?: string }) => {
                onprogress(p.message ?? `Step ${p.progress}`, p.progress, p.total);
              },
            }
          : {}),
      },
    );
  }

  /* ---- Resource Reads ---- */

  /**
   * List all available MCP resources on the daemon.
   */
  async listResources(): Promise<
    Array<{ uri: string; name: string; description?: string }>
  > {
    this._ensureConnected();
    const result = await this._client!.listResources();
    return result.resources;
  }

  /**
   * Read an MCP resource by URI.
   */
  async readResource(uri: string): Promise<string | null> {
    this._ensureConnected();
    const result = await this._client!.readResource({ uri });
    if (result.contents && result.contents.length > 0) {
      const first = result.contents[0];
      if ("text" in first) {
        return first.text as string;
      }
    }
    return null;
  }

  /* ---- Convenience: DreamGraph-specific helpers ---- */

  /**
   * Get cognitive status from the daemon.
   */
  async getCognitiveStatus(): Promise<unknown> {
    return this.callTool("cognitive_status");
  }

  /**
   * Query a DreamGraph resource by URI and optional top-level field filter.
   *
   * Examples:
   * - queryResource("system://features")
   * - queryResource("dream://adrs", { status: "accepted" })
   */
  async queryResource(
    uri: string,
    filter?: Record<string, unknown>,
  ): Promise<unknown> {
    return this.callTool("query_resource", {
      uri,
      ...(filter && Object.keys(filter).length > 0 ? { filter } : {}),
    });
  }

  /**
   * Query architecture decisions.
   */
  async queryAdrs(status?: string): Promise<unknown> {
    return this.callTool("query_architecture_decisions", {
      ...(status ? { status } : {}),
    });
  }

  /* ---- Internal ---- */

  private _ensureConnected(): void {
    if (!this._client) {
      throw new Error(
        "MCP client is not connected. Call connect() first.",
      );
    }
  }

  /* ---- Dispose ---- */

  dispose(): void {
    void this.disconnect();
  }
}
