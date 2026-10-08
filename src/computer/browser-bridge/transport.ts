/**
 * DreamGraph browser bridge (docs/ashoka/computer-use-contract.md, backend `dreamgraph-browser`).
 * The transport is the thin part: it attaches the Chrome debugger to a tab and relays CDP commands and events.
 * Production transport: DreamGraph Chrome extension → native messaging host → daemon (client.ts).
 * Test transport: a direct CDP connection to Chromium (tests).
 */

export interface BrowserTab {
  tab_id: number;
  window_id: number;
  url: string;
  title: string;
  active: boolean;
  /** Attached by this session (DreamGraph controls it). */
  controlled: boolean;
}

/** A JavaScript dialog the browser is showing on a tab. While one is open the tab's page cannot run anything. */
export interface BrowserDialog {
  type: "alert" | "confirm" | "prompt" | "beforeunload";
  message: string;
  default_prompt: string;
  url: string;
}

export type BrowserEventListener = (tabId: number, method: string, params: Record<string, unknown>) => void;
export type BrowserDetachListener = (tabId: number, reason: string) => void;

export interface BrowserTransport {
  listTabs(): Promise<BrowserTab[]>;
  openTab(url: string): Promise<BrowserTab>;
  closeTab(tabId: number): Promise<void>;
  activateTab(tabId: number): Promise<void>;
  /** Attach the debugger and keep it attached for the whole session. Enables the Page domain and dialog tracking. */
  attach(tabId: number): Promise<void>;
  detach(tabId: number): Promise<void>;
  /** Send a CDP command to an attached tab. Rejects with BrowserTimeoutError when it does not answer in time. */
  send<T = Record<string, unknown>>(tabId: number, method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<T>;
  /**
   * The dialog the attachment holder has seen open on this tab, if any. Kept by the attachment holder from
   * Page.javascriptDialogOpening/Closed, because a later attachment can neither see nor answer a dialog that
   * opened before it (verified on Chromium 141: Page.enable blocks and Page.handleJavaScriptDialog reports
   * "No dialog is showing").
   */
  dialog(tabId: number): Promise<BrowserDialog | null>;
  /**
   * Answers the OS file dialog (save/open/folder) the browser is showing, through the desktop (Windows UI
   * Automation in the browser host). Optional: transports without desktop access do not offer it.
   */
  fileDialog?(request: FileDialogRequest): Promise<FileDialogResult>;
  /** Browser-owned file-type warning after an authorized Save picker; not a JavaScript dialog. */
  confirmSave?(request: { tab_id: number; path: string; origin: string }): Promise<FileDialogResult>;
  onEvent(listener: BrowserEventListener): () => void;
  onDetach(listener: BrowserDetachListener): () => void;
  close(): Promise<void>;
}

export class BrowserTimeoutError extends Error {
  constructor(readonly method: string, readonly timeoutMs: number) {
    super(`BROWSER_COMMAND_TIMEOUT: ${method} did not answer within ${timeoutMs} ms`);
  }
}

export function dialogFromEvent(params: Record<string, unknown>): BrowserDialog {
  const type = String(params.type ?? "alert");
  return {
    type: type === "confirm" || type === "prompt" || type === "beforeunload" ? type : "alert",
    message: String(params.message ?? "").slice(0, 2000),
    default_prompt: String(params.defaultPrompt ?? "").slice(0, 2000),
    url: String(params.url ?? "").slice(0, 2000),
  };
}

export interface FileDialogRequest { action: "choose" | "cancel"; path?: string; overwrite?: boolean }
export interface FileDialogResult {
  /** done: the dialog accepted the path; cancelled; needs_confirmation: e.g. the file exists (retry with overwrite);
   *  not_found: no browser file dialog is open; still_open / failed: see message; unsupported: no desktop access here. */
  status: "done" | "cancelled" | "needs_confirmation" | "not_found" | "still_open" | "failed" | "unsupported";
  message?: string;
}
/** A File System Access picker the page opened (reported by the page hook). */
export interface BrowserFileDialog { id: number; kind: "save" | "open" | "folder"; suggested_name: string | null; types: Array<{ description: string; accept: string[] }>; multiple: boolean }
