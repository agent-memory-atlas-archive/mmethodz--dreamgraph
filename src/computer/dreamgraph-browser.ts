/**
 * Computer Use backend `dreamgraph-browser` (docs/ashoka/computer-use-contract.md, stage 2): DreamGraph's own
 * browser bridge — the DreamGraph Chrome extension, the native browser host and the controller in this process.
 * Provider-neutral tools (browser_*), dialogs handled by the backend, control released when the pass ends.
 */
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { LlmToolContentBlock, LlmToolDefinition } from "../cognitive/llm.js";
import { BridgeTransport } from "./browser-bridge/client.js";
import { BrowserController } from "./browser-bridge/controller.js";
import { BROWSER_TOOLS, BROWSER_TOOL_NAMES, DREAMGRAPH_BROWSER_GRANTED_GUIDANCE, callBrowserTool } from "./browser-bridge/tools.js";
import type { BrowserTransport } from "./browser-bridge/transport.js";
import { resolveMasterDir } from "../instance/registry.js";
import { getActiveScope } from "../instance/lifecycle.js";
import { beginObservedSourceEffect, observeSourceFile, settleObservedSourceEffect } from "../graph/change-obligations.js";

/** The change-obligation ledger calls the session uses (injectable for tests). */
export interface SourceLedger {
  observe: typeof observeSourceFile;
  begin: typeof beginObservedSourceEffect;
  settle: typeof settleObservedSourceEffect;
}
const LEDGER: SourceLedger = { observe: observeSourceFile, begin: beginObservedSourceEffect, settle: settleObservedSourceEffect };

type Image = Extract<LlmToolContentBlock, { type: "image" }>;
export interface DreamgraphBrowserCallResult { text: string; images: Image[]; isError: boolean }
export interface DreamgraphBrowserSession {
  readonly sessionId: string;
  readonly tools: LlmToolDefinition[];
  readonly guidance: string;
  readonly extensionVersion: string | null;
  has(name: string): boolean;
  call(name: string, args: unknown, signal?: AbortSignal): Promise<DreamgraphBrowserCallResult>;
  title(name: string, args: unknown): string;
  /** Run-once: gives every controlled tab back to the user and closes the bridge connection. Returns the log path. */
  release(reason: string): Promise<string | null>;
}

const LOG_DIR = () => join(tmpdir(), "dreamgraph-codex-transcripts");

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1", "0.0.0.0"]);

/**
 * DreamGraph's own pages (Architect, Config, Explorer of any running instance) are never operated by Computer Use:
 * a run that navigates its own Architect tab reloads it mid-pass. Ports come from each instance's runtime/server.json.
 */
/** Loopback ports of every DreamGraph instance's HTTP UI (from `<master>/<uuid>/runtime/server.json`). */
async function dreamgraphUiPorts(masterDir?: string): Promise<Set<string>> {
  const root = masterDir ?? resolveMasterDir(), ports = new Set<string>();
  for (const entry of await readdir(root).catch(() => [] as string[])) {
    try {
      const server = JSON.parse(await readFile(join(root, entry, "runtime", "server.json"), "utf8")) as { port?: unknown };
      if (typeof server.port === "number" && Number.isInteger(server.port)) ports.add(String(server.port));
    } catch { /* not an instance, or not serving HTTP */ }
  }
  return ports;
}

/** DreamGraph's own page origins (for executors whose browser DreamGraph does not control, e.g. Codex's fallback). */
export async function dreamgraphUiOrigins(masterDir?: string): Promise<string[]> {
  return [...await dreamgraphUiPorts(masterDir)].flatMap(port => [`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
}

export async function dreamgraphUiProtector(masterDir?: string): Promise<(url: string) => string | null> {
  const ports = await dreamgraphUiPorts(masterDir);
  return url => {
    try {
      const parsed = new URL(url);
      return LOOPBACK.has(parsed.hostname) && ports.has(parsed.port || (parsed.protocol === "https:" ? "443" : "80"))
        ? `this is DreamGraph's own page (${parsed.host})` : null;
    } catch { return null; }
  };
}

/** Where files go on this instance, for the model: the default save folder and the bound project's root. */
function fileLocations(): string {
  const scope = getActiveScope();
  if (!scope) return "";
  return `\nFILE LOCATIONS: a save without a location named by the user goes to ${join(scope.runtimeDir, "temp")} (omit path).`
    + (scope.projectRoot ? ` When the user asks to save in the project, use a full path under the project root ${scope.projectRoot}.` : "");
}

export async function openDreamgraphBrowserSession(input: { signal?: AbortSignal; home?: string; transport?: BrowserTransport; logDir?: string; masterDir?: string;
  executionId?: string; ledger?: SourceLedger; settleWaitMs?: number; controller?: BrowserController } = {}): Promise<DreamgraphBrowserSession> {
  input.signal?.throwIfAborted();
  const transport = input.transport ?? await BridgeTransport.connect({ home: input.home });
  const protectedUrl = await dreamgraphUiProtector(input.masterDir);
  // Save dialogs answered without a path go to the instance's runtime/temp (outside the project and system folders).
  const defaultFileFolder = () => { const scope = getActiveScope(); return scope ? join(scope.runtimeDir, "temp") : null; };
  const controller = input.controller ?? new BrowserController(transport, { maxScreenshotWidth: 1600, protectedUrl, defaultFileFolder });
  const sessionId = randomUUID(), logDir = input.logDir ?? LOG_DIR(), logFile = join(logDir, `${sessionId}.browser.log`);
  const extensionVersion = transport instanceof BridgeTransport ? transport.extensionVersion : null;
  const log = async (line: string) => { await mkdir(logDir, { recursive: true }).catch(() => undefined); await appendFile(logFile, `[${new Date().toISOString()}] ${line}\n`).catch(() => undefined); };
  await log(`session ${sessionId}; backend dreamgraph-browser; extension ${extensionVersion ?? "unknown"}`);
  let released: Promise<string | null> | null = null;

  // A source file the page saves inside a project repository (a file type the project scanner tracks) is a source
  // change made by the browser, not by a governed tool. It is recorded in the change-obligation ledger like any other
  // source effect: an observed intent with the file's hash before the dialog is answered, then the observed hash once
  // the page has finished writing (at the model's next browser action or at release). The ledger marks it
  // reconciliation_pending, so the graph learns about it; such a save is refused when the intent cannot be recorded.
  // Other files (outside the repositories, or not source, e.g. an application's own project file such as .web64proj)
  // record nothing here; their meaning belongs in the graph as a feature or evidence entry.
  const ledger = input.ledger ?? LEDGER, settleWaitMs = input.settleWaitMs ?? 250;
  const pending: Array<{ id: string; file: string; scope: string; before: string }> = [];
  let operations = 0;
  /** The page writes after the dialog closes (Chrome creates the file, then the page writes and closes it): wait
   * until the file differs from its state before the save and holds still, up to about 24 waits. */
  const writtenHash = async (file: string, before: string) => {
    let last = (await ledger.observe(file))?.hash ?? null;
    for (let attempt = 0; attempt < 24; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, settleWaitMs));
      const next = (await ledger.observe(file))?.hash ?? null;
      if (next === last && next !== before && next !== "absent") return next;
      last = next;
    }
    return last;
  };
  const settlePending = async (): Promise<string[]> => {
    const notes: string[] = [];
    while (pending.length) {
      const item = pending.shift()!;
      try {
        const hash = await writtenHash(item.file, item.before);
        const settled = await ledger.settle(item.id, hash ? { [item.scope]: hash } : null);
        notes.push(`graph: ${item.file} → ${settled.state === "reconciliation_pending" ? "recorded for graph reconciliation" : settled.state === "failed" ? "unchanged, nothing to reconcile" : settled.state} (obligation ${item.id})`);
      } catch (error) {
        notes.push(`graph: recording ${item.file} failed: ${error instanceof Error ? error.message : String(error)} (obligation ${item.id} stays open for recovery)`);
      }
    }
    for (const note of notes) await log(note);
    return notes;
  };
  /** Before a save dialog is answered with a path inside a repository: the observed intent. */
  const observeSave = async (name: string, args: Record<string, unknown>): Promise<string | null> => {
    if (name !== "browser_file_dialog" || args.cancel === true || typeof args.path !== "string") return null;
    const tab = controller.currentTab;
    if (tab === null || controller.fileDialogState(tab).open?.kind !== "save") return null;
    const observed = await ledger.observe(args.path);
    if (!observed) return null;
    if (!input.executionId) throw new Error("BROWSER_SAVE_NOT_GRAPH_BOUND: this pass has no managed execution, so a save inside the project cannot be recorded; save outside the project or ask the user");
    operations += 1;
    const intent = await ledger.begin({ operation_id: `browser-save:${sessionId}:${operations}`, execution_id: input.executionId, actor: "dreamgraph_browser",
      repositories: [observed.repository], before_hashes: { [observed.scope]: observed.hash } });
    pending.push({ id: intent.id, file: args.path, scope: observed.scope, before: observed.hash });
    return `graph: the saved file is recorded for graph reconciliation once the page has written it (obligation ${intent.id})`;
  };

  return {
    sessionId, tools: BROWSER_TOOLS, guidance: DREAMGRAPH_BROWSER_GRANTED_GUIDANCE + fileLocations(), extensionVersion,
    has: name => BROWSER_TOOL_NAMES.has(name),
    title: (name, args) => browserCallTitle(name, args),
    async call(name, args, signal) {
      signal?.throwIfAborted();
      if (released) return { text: "COMPUTER_USE_SESSION_RELEASED", images: [], isError: true };
      const settled = await settlePending();
      const record = args && typeof args === "object" ? args as Record<string, unknown> : {};
      let observed: string | null;
      try { observed = await observeSave(name, record); }
      catch (error) { return { text: `${[...settled, ""].join("\n")}${error instanceof Error ? error.message : String(error)}`.trim(), images: [], isError: true }; }
      const called = await callBrowserTool(controller, name, args);
      const result = { ...called, text: [...settled, called.text, ...(observed ? [observed] : [])].join("\n") };
      await log(`${browserCallTitle(name, args)} → ${result.isError ? "ERROR " : ""}${result.text.split("\n").slice(0, 3).join(" | ").slice(0, 300)}`);
      return { text: result.text, isError: result.isError, images: result.images.map(image => ({ type: "image", mimeType: image.mimeType as Image["mimeType"], dataBase64: image.dataBase64 })) };
    },
    release(reason) {
      released ??= (async () => {
        await log(`release (${reason}); tabs ${controller.controlledTabs.join(",") || "none"}`);
        await settlePending();
        await controller.release().catch(error => log(`release error: ${String(error)}`));
        await transport.close().catch(() => undefined);
        await log("released");
        return logFile;
      })();
      return released;
    },
  };
}

/** Readable trace titles for the browser tools. */
export function browserCallTitle(name: string, input: unknown): string {
  const args = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const at = typeof args.ref === "string" ? args.ref : typeof args.x === "number" ? `${Math.round(args.x)},${Math.round(Number(args.y))}` : "";
  const short = (value: unknown, max = 60) => { const text = String(value ?? "").replace(/\s+/g, " ").trim(); return text.length > max ? `${text.slice(0, max)}…` : text; };
  switch (name) {
    case "browser_tabs": return `Tabs: ${args.action ?? "list"}${args.tab_id !== undefined ? ` ${args.tab_id}` : ""}${args.url ? ` ${short(args.url)}` : ""}`;
    case "browser_snapshot": return "Read the page";
    case "browser_screenshot": return at ? `Screenshot of ${at}` : "Screenshot";
    case "browser_click": return `${Number(args.click_count) === 2 ? "Double-click" : args.button === "right" ? "Right-click" : "Click"} ${at}`.trim();
    case "browser_type": return `Type "${short(args.text, 40)}"${at ? ` into ${at}` : ""}${args.submit ? " and submit" : ""}`;
    case "browser_press_key": return `Press ${short(args.key, 30)}${Number(args.repeat) > 1 ? ` ×${args.repeat}` : ""}`;
    case "browser_hover": return `Hover ${at}`.trim();
    case "browser_drag": return "Drag";
    case "browser_scroll": return `Scroll ${args.delta_y ?? 0}`;
    case "browser_navigate": return args.url ? `Open ${short(args.url)}` : `Go ${args.action ?? ""}`.trim();
    case "browser_dialog": return `${args.accept ? "Accept" : "Dismiss"} dialog${typeof args.text === "string" ? ` with "${short(args.text, 40)}"` : ""}`;
    case "browser_file_chooser": return Array.isArray(args.files) && args.files.length ? `Choose ${args.files.length} file(s)` : "Cancel file chooser";
    case "browser_wait": return args.text ? `Wait for "${short(args.text, 40)}"` : `Wait ${args.ms ?? 1000} ms`;
    case "browser_evaluate": return `Run page script: ${short(args.expression, 80)}`;
    default: return name;
  }
}
