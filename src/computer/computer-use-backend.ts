/**
 * Backend choice for the common Computer Use contract on the API engines (docs/ashoka/computer-use-contract.md).
 * DREAMGRAPH_COMPUTER_USE_BACKEND: auto (default) | dreamgraph-browser | cua-runtime.
 * auto = DreamGraph's own browser bridge when its extension is connected, otherwise the installed Computer Use
 * runtime, otherwise "unavailable" with both reasons.
 */
import type { LlmToolContentBlock, LlmToolDefinition } from "../cognitive/llm.js";
import { CUA_RUNTIME_GRANTED_GUIDANCE, openCuaRuntimeSession } from "./cua-runtime.js";
import { openDreamgraphBrowserSession } from "./dreamgraph-browser.js";

export type ComputerUseBackendName = "dreamgraph-browser" | "cua-runtime";
type Image = Extract<LlmToolContentBlock, { type: "image" }>;

export interface ComputerUseBackendSession {
  readonly backend: ComputerUseBackendName;
  readonly sessionId: string;
  readonly tools: LlmToolDefinition[];
  /** Executor guidance for a granted pass on this backend. */
  readonly guidance: string;
  has(name: string): boolean;
  call(name: string, args: unknown, signal?: AbortSignal): Promise<{ text: string; images: Image[]; isError: boolean }>;
  /** Readable trace title for one call. */
  title(name: string, args: unknown): string;
  release(reason: string): Promise<string | null>;
}

export function computerUseBackendPreference(env: NodeJS.ProcessEnv = process.env): "auto" | ComputerUseBackendName {
  const value = (env.DREAMGRAPH_COMPUTER_USE_BACKEND ?? "auto").trim().toLowerCase();
  return value === "dreamgraph-browser" || value === "cua-runtime" ? value : "auto";
}

async function openRuntime(signal?: AbortSignal): Promise<ComputerUseBackendSession> {
  const session = await openCuaRuntimeSession({ signal });
  return { backend: "cua-runtime", sessionId: session.sessionId, tools: session.tools, guidance: CUA_RUNTIME_GRANTED_GUIDANCE,
    has: name => session.has(name), call: (name, args, callSignal) => session.call(name, args, callSignal),
    title: (_name, args) => runtimeCallTitle(args), release: reason => session.release(reason) };
}

async function openBrowser(signal?: AbortSignal, executionId?: string): Promise<ComputerUseBackendSession> {
  const session = await openDreamgraphBrowserSession({ signal, executionId });
  return { backend: "dreamgraph-browser", sessionId: session.sessionId, tools: session.tools, guidance: session.guidance,
    has: name => session.has(name), call: (name, args, callSignal) => session.call(name, args, callSignal),
    title: (name, args) => session.title(name, args), release: reason => session.release(reason) };
}

export type PlannedComputerUseRoute = { backend: "dreamgraph-browser" | "codex-native" | "cua-runtime" | "unavailable"; summary: string };

/**
 * Which Computer Use route a granted pass on this adapter takes now (shown on the Architect page; the run decides
 * again when it starts). Mirrors cli-bridge.ts (Codex CLI) and openComputerUseBackend (API engines).
 */
export function plannedComputerUseRoute(adapter: string, extension: { connected: boolean; version?: string | null },
  preference: "auto" | ComputerUseBackendName = computerUseBackendPreference()): PlannedComputerUseRoute {
  const browser = `DreamGraph's browser extension${extension.version ? ` ${extension.version}` : ""}`;
  const pinned = (value: string) => ` (DREAMGRAPH_COMPUTER_USE_BACKEND=${value})`;
  if (adapter === "codex-cli") {
    if (preference === "cua-runtime") return { backend: "codex-native", summary: `Codex CLI uses its own Computer Use${pinned("cua-runtime")}.` };
    if (extension.connected) return { backend: "dreamgraph-browser", summary: `Computer Use runs through ${browser} (connected). `
      + (preference === "dreamgraph-browser" ? `It is required${pinned("dreamgraph-browser")}.` : "Codex's own Computer Use is used only when the extension is not connected.") };
    return preference === "dreamgraph-browser"
      ? { backend: "unavailable", summary: `Computer Use is unavailable: DreamGraph's browser extension is required${pinned("dreamgraph-browser")} but not connected.` }
      : { backend: "codex-native", summary: "DreamGraph's browser extension is not connected, so Codex CLI uses its own Computer Use." };
  }
  if (adapter === "native_api_tool_loop") {
    if (preference === "cua-runtime") return { backend: "cua-runtime", summary: `The API engine uses the Computer Use runtime installed with the Codex app${pinned("cua-runtime")}.` };
    if (extension.connected) return { backend: "dreamgraph-browser", summary: `Computer Use runs through ${browser} (connected).` };
    return preference === "dreamgraph-browser"
      ? { backend: "unavailable", summary: `Computer Use is unavailable: DreamGraph's browser extension is required${pinned("dreamgraph-browser")} but not connected.` }
      : { backend: "cua-runtime", summary: "DreamGraph's browser extension is not connected, so the API engine uses the Computer Use runtime installed with the Codex app, if present." };
  }
  return { backend: "unavailable", summary: "This engine has no Computer Use yet." };
}

/** Opens the Computer Use backend for a granted API pass. Throws with a plain reason when none is available. */
export async function openComputerUseBackend(input: { signal?: AbortSignal; preference?: "auto" | ComputerUseBackendName; executionId?: string } = {}): Promise<ComputerUseBackendSession> {
  const preference = input.preference ?? computerUseBackendPreference();
  if (preference === "dreamgraph-browser") return openBrowser(input.signal, input.executionId);
  if (preference === "cua-runtime") return openRuntime(input.signal);
  const reasons: string[] = [];
  try { return await openBrowser(input.signal, input.executionId); } catch (error) { reasons.push(error instanceof Error ? error.message : String(error)); }
  try { return await openRuntime(input.signal); } catch (error) { reasons.push(error instanceof Error ? error.message : String(error)); }
  throw new Error(`COMPUTER_USE_UNAVAILABLE: ${reasons.join("; ")}`);
}

function runtimeCallTitle(input: unknown): string {
  const args = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const title = typeof args.title === "string" ? args.title.trim() : "";
  if (title) return title.slice(0, 160);
  const code = typeof args.code === "string" ? args.code.replace(/\s+/g, " ").trim() : "";
  return code ? code.slice(0, 160) : "Computer Use";
}
