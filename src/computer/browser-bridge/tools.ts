/**
 * The model-facing Computer Use tools of the `dreamgraph-browser` backend. Same tools for every provider.
 * Results are compact text (plus one image for screenshots). An open dialog is reported in every result.
 */
import { BrowserActionError, type ActionResult, type BrowserController, type Target } from "./controller.js";

export interface BrowserToolDefinition { name: string; description: string; inputSchema: Record<string, unknown> }
export interface BrowserToolResult { text: string; images: Array<{ type: "image"; mimeType: string; dataBase64: string }>; isError: boolean }

const ref = { type: "string", description: "Element ref from the latest browser_snapshot, e.g. \"e12\"." };
const xy = { x: { type: "number", description: "Viewport x in CSS pixels (as in the screenshot when its scale is 1)." }, y: { type: "number", description: "Viewport y in CSS pixels." } };
const tab = { type: "number", description: "Tab id; defaults to the selected tab." };
const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });

export const BROWSER_TOOLS: BrowserToolDefinition[] = [
  { name: "browser_tabs", description: "List the user's open browser tabs, select one to control (already-open tabs are fine), open a new tab, or close one. Start here.",
    inputSchema: object({ action: { type: "string", enum: ["list", "select", "open", "close"] }, tab_id: tab, url: { type: "string", description: "For open." } }, ["action"]) },
  { name: "browser_snapshot", description: "Read the selected tab as a list of elements with refs (e1, e2 …), their roles, names, values and states. Use refs with the other tools. Cheaper and more exact than a screenshot for finding controls.",
    inputSchema: object({ tab_id: tab }) },
  { name: "browser_screenshot", description: "Take a JPEG screenshot of the selected tab's viewport, or of one element (ref). Use it to see canvases, layout and visual results.",
    inputSchema: object({ ref, tab_id: tab }) },
  { name: "browser_click", description: "Click an element (ref) or a viewport point (x, y). Double-click with click_count 2. Right-click with button \"right\".",
    inputSchema: object({ ref, ...xy, button: { type: "string", enum: ["left", "right", "middle"] }, click_count: { type: "number" }, modifiers: { type: "array", items: { type: "string", enum: ["Alt", "Control", "Meta", "Shift"] } }, tab_id: tab }) },
  { name: "browser_type", description: "Type text into an element (ref) or into the focused element. clear replaces the current content; submit presses Enter afterwards. Works for inputs, textareas and code editors (contenteditable).",
    inputSchema: object({ text: { type: "string" }, ref, clear: { type: "boolean" }, submit: { type: "boolean" }, tab_id: tab }, ["text"]) },
  { name: "browser_press_key", description: "Press a key or chord on the focused element, e.g. \"Enter\", \"Escape\", \"Tab\", \"F5\", \"Control+S\", \"Shift+ArrowDown\". repeat presses it several times.",
    inputSchema: object({ key: { type: "string" }, repeat: { type: "number" }, tab_id: tab }, ["key"]) },
  { name: "browser_hover", description: "Move the mouse over an element (ref) or point (x, y).", inputSchema: object({ ref, ...xy, tab_id: tab }) },
  { name: "browser_drag", description: "Drag with the left button from one element/point to another, e.g. to draw on a canvas or move a slider. Points are CSS pixels in the viewport.",
    inputSchema: object({ from_ref: ref, from_x: { type: "number" }, from_y: { type: "number" }, to_ref: ref, to_x: { type: "number" }, to_y: { type: "number" }, steps: { type: "number" }, tab_id: tab }) },
  { name: "browser_scroll", description: "Scroll the page or the element under a ref/point by delta_x/delta_y pixels.",
    inputSchema: object({ ref, ...xy, delta_x: { type: "number" }, delta_y: { type: "number" }, tab_id: tab }) },
  { name: "browser_navigate", description: "Open a URL in the selected tab, or go back, forward or reload.",
    inputSchema: object({ url: { type: "string" }, action: { type: "string", enum: ["back", "forward", "reload"] }, tab_id: tab }) },
  { name: "browser_dialog", description: "Answer the JavaScript dialog (alert, confirm, prompt or 'leave page?') that is open on the tab. accept true = OK; for a prompt, text is the value to enter (omit it to keep the default). The page is blocked until you answer.",
    inputSchema: object({ accept: { type: "boolean" }, text: { type: "string" }, tab_id: tab }, ["accept"]) },
  { name: "browser_file_dialog", description: "Answer the operating system's file dialog (Save / Open / folder) the page opened, e.g. after a Save button. Give a full path when the user named a location (always for open and folder dialogs); for a save without a requested location omit path and DreamGraph saves under the page's suggested name in its own instance folder (runtime/temp) and reports the path. Or cancel. overwrite confirms replacing an existing file.",
    inputSchema: object({ path: { type: "string", description: "Absolute path on this computer, e.g. C:\\Users\\me\\project\\main.web64proj. Not in system folders (AppData, Program Files, Windows): the browser refuses those." }, cancel: { type: "boolean" }, overwrite: { type: "boolean" }, tab_id: tab }) },
  { name: "browser_file_chooser", description: "Set the files for a file chooser the page opened (absolute paths on this computer), or cancel it with an empty list.",
    inputSchema: object({ files: { type: "array", items: { type: "string" } }, tab_id: tab }, ["files"]) },
  { name: "browser_wait", description: "Wait for text to appear on the page (up to ms, max 30000), or just wait ms.",
    inputSchema: object({ text: { type: "string" }, ms: { type: "number" }, tab_id: tab }) },
  { name: "browser_evaluate", description: "Run JavaScript in the page itself and return the JSON result (escape hatch for what the other tools cannot do). Prefer the structured tools; never use it to touch the user's files or accounts.",
    inputSchema: object({ expression: { type: "string", description: "An expression; may be an async IIFE." }, tab_id: tab }, ["expression"]) },
];
export const BROWSER_TOOL_NAMES = new Set(BROWSER_TOOLS.map(tool => tool.name));

/** Default executor guidance for this backend (provider-neutral). */
export const DREAMGRAPH_BROWSER_GRANTED_GUIDANCE =
  "The local operator has GRANTED full Computer Use for this pass, through DreamGraph's browser tools (browser_*) in the user's Chrome. "
  + "Site access is pre-approved; do not stop to ask for permission. Start with browser_tabs list; if the request concerns a page that is already "
  + "open, select that tab instead of opening a new one. Never operate DreamGraph's own pages (Architect, Config, Explorer); they are marked "
  + "and refused. To check DreamGraph settings or project state use the DreamGraph MCP tools. Use browser_snapshot to find controls by ref and act with refs; use browser_screenshot "
  + "to see visual results (canvas, layout). Every result reports an open JavaScript dialog: while one is open the page is blocked and only "
  + "browser_dialog works, so answer it yourself (for a prompt, enter the value the task needs). A Save/Open button may open the operating "
  + "system's file dialog instead: it is reported as FILE DIALOG OPEN; answer it with browser_file_dialog: the full path the user asked for, or no path for a save (DreamGraph's instance folder), or cancel; then "
  + "verify in the page that the save or load happened. Computer Use is for operating web pages only: "
  + "never use it (or browser_evaluate) to read, edit, run or change this project's source code; every project read, mutation and command "
  + "still goes exclusively through the DreamGraph MCP tools. A file the page itself saves where the user asked (for example into the project "
  + "folder) is fine; DreamGraph records saved source files for graph reconciliation. Leave result pages open in their tabs. If the user stops DreamGraph's control of "
  + "a tab (BROWSER_CONTROL_CANCELLED_BY_USER), do not take it again; report it. Report what you did and observed.";

function target(args: Record<string, unknown>, refKey = "ref", xKey = "x", yKey = "y"): Target | null {
  if (typeof args[refKey] === "string" && args[refKey]) return { ref: args[refKey] as string };
  if (typeof args[xKey] === "number" && typeof args[yKey] === "number") return { x: args[xKey] as number, y: args[yKey] as number };
  return null;
}
const clip = (value: string, max: number) => value.length > max ? `${value.slice(0, max)}…` : value;
const tabArg = (args: Record<string, unknown>) => typeof args.tab_id === "number" ? args.tab_id : undefined;

function describe(result: ActionResult, extra = ""): string {
  const lines: string[] = [];
  if (result.tab) lines.push(`tab ${result.tab.tab_id}: ${clip(result.tab.title || "(untitled)", 100)} — ${clip(result.tab.url, 300)}`);
  if (result.navigated) lines.push("navigated: yes");
  if (result.note) lines.push(`note: ${result.note}`);
  if (result.dialog) lines.push(`DIALOG OPEN (${result.dialog.type}): ${JSON.stringify(result.dialog.message)}`
    + (result.dialog.type === "prompt" ? ` default ${JSON.stringify(result.dialog.default_prompt)}` : "")
    + " — the page is blocked; answer it with browser_dialog.");
  if (result.file_dialog) lines.push(`FILE DIALOG OPEN (${result.file_dialog.kind})${result.file_dialog.suggested_name ? ` suggested ${JSON.stringify(result.file_dialog.suggested_name)}` : ""}`
    + (result.file_dialog.types.length ? ` types ${result.file_dialog.types.map(type => `${type.description || "file"} ${type.accept.join(" ")}`.trim()).join("; ")}` : "")
    + " — the operating system is showing it; answer it with browser_file_dialog (full path; for a save without a requested location omit it; or cancel).");
  if (result.file_chooser) lines.push(`FILE CHOOSER OPEN (${result.file_chooser.mode}) — set files with browser_file_chooser.`);
  if (extra) lines.push(extra);
  return lines.join("\n");
}

export async function callBrowserTool(controller: BrowserController, name: string, input: unknown): Promise<BrowserToolResult> {
  const args = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const text = (value: string): BrowserToolResult => ({ text: value, images: [], isError: false });
  try {
    switch (name) {
      case "browser_tabs": {
        const action = String(args.action ?? "list");
        if (action === "list") {
          const tabs = await controller.listTabs();
          return text(tabs.map(tab => `${tab.tab_id}${tab.active ? " (active)" : ""}${tab.controlled ? " (controlled)" : ""}${tab.protected ? " (DreamGraph — not operable)" : ""}: ${clip(tab.title || "(untitled)", 100)} — ${clip(tab.url, 160)}`).join("\n") || "no tabs");
        }
        if (action === "select") {
          if (typeof args.tab_id !== "number") throw new BrowserActionError("BROWSER_ARGUMENTS", "tab_id is required");
          return text(describe(await controller.selectTab(args.tab_id), "selected; use browser_snapshot to read it"));
        }
        if (action === "open") {
          if (typeof args.url !== "string" || !args.url) throw new BrowserActionError("BROWSER_ARGUMENTS", "url is required");
          return text(describe(await controller.openTab(args.url), "opened and selected"));
        }
        if (action === "close") {
          if (typeof args.tab_id !== "number") throw new BrowserActionError("BROWSER_ARGUMENTS", "tab_id is required");
          await controller.closeTab(args.tab_id); return text(`closed tab ${args.tab_id}`);
        }
        throw new BrowserActionError("BROWSER_ARGUMENTS", `unknown action ${action}`);
      }
      case "browser_snapshot": {
        const snapshot = await controller.snapshot(tabArg(args));
        if ("dialog" in snapshot) return text(describe({ tab: snapshot.tab, dialog: snapshot.dialog }));
        const dialog = controller.openDialog(snapshot.tab_id);
        return text([`tab ${snapshot.tab_id}: ${snapshot.title || "(untitled)"} — ${snapshot.url}`,
          `viewport ${snapshot.viewport.width}x${snapshot.viewport.height} scroll ${snapshot.viewport.scroll_x},${snapshot.viewport.scroll_y}${snapshot.focused ? ` focused ${snapshot.focused}` : ""}`,
          snapshot.lines || "(no visible elements)", snapshot.truncated ? "[snapshot truncated; scroll or take a screenshot for the rest]" : "",
          dialog ? describe({ tab: null, dialog }) : ""].filter(Boolean).join("\n"));
      }
      case "browser_screenshot": {
        const shot = await controller.screenshot({ ref: typeof args.ref === "string" ? args.ref : undefined }, tabArg(args));
        if (!shot.image) return text(describe(shot.result, "no screenshot: the page is blocked"));
        return { text: describe(shot.result, `screenshot ${shot.image.width}x${shot.image.height}`), isError: false,
          images: [{ type: "image", mimeType: shot.image.mimeType, dataBase64: shot.image.dataBase64 }] };
      }
      case "browser_click": {
        const where = target(args); if (!where) throw new BrowserActionError("BROWSER_ARGUMENTS", "give ref, or x and y");
        return text(describe(await controller.click(where, { button: args.button as "left" | undefined, click_count: args.click_count as number | undefined,
          modifiers: Array.isArray(args.modifiers) ? args.modifiers.map(String) : undefined }, tabArg(args))));
      }
      case "browser_type":
        return text(describe(await controller.type(String(args.text ?? ""), { ref: typeof args.ref === "string" ? args.ref : undefined,
          clear: args.clear === true, submit: args.submit === true }, tabArg(args))));
      case "browser_press_key":
        return text(describe(await controller.press(String(args.key ?? ""), typeof args.repeat === "number" ? args.repeat : 1, tabArg(args))));
      case "browser_hover": {
        const where = target(args); if (!where) throw new BrowserActionError("BROWSER_ARGUMENTS", "give ref, or x and y");
        return text(describe(await controller.hover(where, tabArg(args))));
      }
      case "browser_drag": {
        const from = target(args, "from_ref", "from_x", "from_y"), to = target(args, "to_ref", "to_x", "to_y");
        if (!from || !to) throw new BrowserActionError("BROWSER_ARGUMENTS", "give from_ref or from_x/from_y, and to_ref or to_x/to_y");
        return text(describe(await controller.drag(from, to, typeof args.steps === "number" ? args.steps : 12, tabArg(args))));
      }
      case "browser_scroll":
        return text(describe(await controller.scroll(target(args), { x: Number(args.delta_x ?? 0), y: Number(args.delta_y ?? 0) }, tabArg(args))));
      case "browser_navigate":
        return text(describe(await controller.navigate({ url: typeof args.url === "string" ? args.url : undefined,
          action: args.action as "back" | undefined }, tabArg(args))));
      case "browser_dialog":
        return text(describe(await controller.answerDialog(args.accept === true, typeof args.text === "string" ? args.text : undefined, tabArg(args))));
      case "browser_file_dialog":
        return text(describe(await controller.answerFileDialog(args.cancel === true ? { action: "cancel" }
          : { action: "choose", path: typeof args.path === "string" ? args.path : undefined, overwrite: args.overwrite === true }, tabArg(args))));
      case "browser_file_chooser":
        return text(describe(await controller.fileChooser(Array.isArray(args.files) ? args.files.map(String) : null, tabArg(args))));
      case "browser_wait":
        return text(describe(await controller.waitFor({ ms: typeof args.ms === "number" ? args.ms : undefined, text: typeof args.text === "string" ? args.text : undefined }, tabArg(args))));
      case "browser_evaluate": {
        const outcome = await controller.evaluate(String(args.expression ?? ""), tabArg(args));
        return text(describe(outcome.result, outcome.value !== undefined ? `result: ${outcome.value}` : ""));
      }
      default:
        return { text: `BROWSER_TOOL_UNKNOWN: ${name}`, images: [], isError: true };
    }
  } catch (error) {
    if (error instanceof BrowserActionError) {
      const dialog = error.dialog ?? controller.openDialog(controller.currentTab ?? -1);
      return { text: [error.message, dialog ? describe({ tab: null, dialog }) : ""].filter(Boolean).join("\n"), images: [], isError: true };
    }
    return { text: `BROWSER_TOOL_FAILED: ${error instanceof Error ? error.message : String(error)}`.slice(0, 2000), images: [], isError: true };
  }
}
