/**
 * v14.0.2 file handling of DreamGraph's browser backend: Chrome's blocked folders, the default save folder, and
 * graph-bound saves (a browser save of project source is recorded in the change-obligation ledger; other files are not).
 */
import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { createHash } from "node:crypto";
import { chromeBlockedLocation } from "../src/computer/browser-bridge/file-dialog.js";
import { BrowserController, defaultFileName } from "../src/computer/browser-bridge/controller.js";
import type { BrowserFileDialog, BrowserTransport, FileDialogRequest, FileDialogResult } from "../src/computer/browser-bridge/transport.js";
import { openDreamgraphBrowserSession, type SourceLedger } from "../src/computer/dreamgraph-browser.js";

const WINDOWS_ENV = { USERPROFILE: "C:\\Users\\Mika Jussila", APPDATA: "C:\\Users\\Mika Jussila\\AppData\\Roaming",
  LOCALAPPDATA: "C:\\Users\\Mika Jussila\\AppData\\Local", windir: "C:\\WINDOWS", ProgramFiles: "C:\\Program Files" };

/** A transport whose OS file dialog "saves" by writing the requested path shortly after answering. */
function savingTransport(onDialog: (request: FileDialogRequest) => void = () => {}): BrowserTransport {
  return {
    onEvent: () => () => {}, onDetach: () => () => {}, send: async () => ({}) as never, close: async () => {},
    listTabs: async () => [], openTab: async () => { throw new Error("unused"); }, closeTab: async () => {}, activateTab: async () => {},
    attach: async () => {}, detach: async () => {},
    fileDialog: async (request: FileDialogRequest): Promise<FileDialogResult> => {
      onDialog(request);
      if (request.path) setTimeout(() => { void writeFile(request.path!, "{\"saved\":true}"); }, 60);
      return { status: "done", message: request.path ?? "" };
    },
  } as unknown as BrowserTransport;
}

/** A controller with tab 7 selected and a save picker open on it. */
function controllerWithSavePicker(transport: BrowserTransport, picker: Partial<BrowserFileDialog> = {}, defaultFileFolder?: () => string | null) {
  const controller = new BrowserController(transport, { settleMs: 0, ...(defaultFileFolder ? { defaultFileFolder } : {}) });
  const internals = controller as unknown as { current: number; tab: () => number; state: () => Promise<unknown>; fileDialogs: Map<number, BrowserFileDialog> };
  internals.current = 7; internals.tab = () => 7; internals.state = async () => ({ tab_id: 7, url: "http://localhost:5173/ide", title: "IDE" });
  internals.fileDialogs.set(7, { id: 1, kind: "save", suggested_name: "main.web64proj", types: [], multiple: false, ...picker });
  const original = transport.fileDialog!;
  transport.fileDialog = async request => { internals.fileDialogs.delete(7); return original(request); };
  return controller;
}

describe("Chrome's blocked folders", () => {
  it("refuses system folders before the dialog is touched and allows user folders", () => {
    expect(chromeBlockedLocation("C:\\Users\\Mika Jussila\\AppData\\Local\\Temp\\x\\a.web64proj", WINDOWS_ENV)).toBe("c:\\users\\mika jussila\\appdata\\local");
    expect(chromeBlockedLocation("c:/program files/x.txt", WINDOWS_ENV)).toBe("c:\\program files");
    expect(chromeBlockedLocation("C:\\Users\\Mika Jussila\\.ssh\\id", WINDOWS_ENV)).toBe("c:\\users\\mika jussila\\.ssh");
    expect(chromeBlockedLocation("C:\\Users\\Mika Jussila\\.dreamgraph\\browser\\selftest-1\\a.web64proj", WINDOWS_ENV)).toBeNull();
    expect(chromeBlockedLocation("C:\\Users\\Mika Jussila\\Documents\\Web64\\a.web64proj", WINDOWS_ENV)).toBeNull();
  });
});

describe("default save folder", () => {
  it("names the file from the page's suggestion, made safe, else untitled with the first accepted extension", () => {
    expect(defaultFileName({ id: 1, kind: "save", suggested_name: "my:game?.web64proj", types: [], multiple: false })).toBe("my_game_.web64proj");
    expect(defaultFileName({ id: 1, kind: "save", suggested_name: null, types: [{ description: "", accept: [".prg"] }], multiple: false })).toBe("untitled.prg");
  });

  it("saves without a path into the default folder, next to an existing file instead of over it", async () => {
    const folder = await mkdtemp(join(tmpdir(), "dg-default-save-"));
    await writeFile(join(folder, "main.web64proj"), "existing");
    const requests: FileDialogRequest[] = [];
    const controller = controllerWithSavePicker(savingTransport(request => requests.push(request)), {}, () => folder);
    const result = await controller.answerFileDialog({ action: "choose" });
    expect(requests[0].path).toBe(join(folder, "main-2.web64proj"));
    expect(result.note).toMatch(/default folder was used/);
  }, 15_000);

  it("still requires a path for an open dialog", async () => {
    const controller = controllerWithSavePicker(savingTransport(), { kind: "open" }, () => tmpdir());
    await expect(controller.answerFileDialog({ action: "choose" })).rejects.toThrow(/path is required for an open or folder dialog/);
  });
});

describe("graph-bound browser saves", () => {
  async function run(executionId: string | undefined, inProject: boolean) {
    const project = await mkdtemp(join(tmpdir(), "dg-project-")), outside = await mkdtemp(join(tmpdir(), "dg-outside-"));
    const target = join(inProject ? project : outside, "main.ts");
    const hash = async (file: string) => { try { return "sha256:" + createHash("sha256").update(await readFile(file)).digest("hex"); } catch { return "absent"; } };
    const events: unknown[][] = [];
    const ledger: SourceLedger = {
      observe: async file => file.startsWith(project + sep) ? { repository: "app", scope: `source:app/${file.slice(project.length + 1)}`, hash: await hash(file) } : null,
      begin: (async (input: { before_hashes: Record<string, string> }) => { events.push(["begin", input.before_hashes]); return { id: "obligation-1", state: "intent" }; }) as unknown as SourceLedger["begin"],
      settle: (async (id: string, after: Record<string, string> | null) => { events.push(["settle", id, after]); return { id, state: "reconciliation_pending" }; }) as unknown as SourceLedger["settle"],
    };
    const transport = savingTransport();
    const controller = controllerWithSavePicker(transport);
    const session = await openDreamgraphBrowserSession({ transport, controller, executionId, ledger, settleWaitMs: 40, logDir: tmpdir(), masterDir: tmpdir() });
    const result = await session.call("browser_file_dialog", { path: target });
    await session.release("test");
    return { result, events, expected: await hash(target) };
  }

  it("records a save of project source before and after the page writes it", async () => {
    const { result, events, expected } = await run("exec-1", true);
    expect(result.isError).toBeFalsy();
    expect(result.text).toMatch(/recorded for graph reconciliation/);
    expect(events[0]).toEqual(["begin", { "source:app/main.ts": "absent" }]);
    expect(events[1]).toEqual(["settle", "obligation-1", { "source:app/main.ts": expected }]);
    expect(expected).not.toBe("absent");
  }, 15_000);

  it("records nothing for files the ledger does not track", async () => {
    const { result, events } = await run("exec-1", false);
    expect(result.isError).toBeFalsy();
    expect(events).toEqual([]);
  }, 15_000);

  it("refuses a project-source save that no managed execution can record", async () => {
    const { result, events } = await run(undefined, true);
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/BROWSER_SAVE_NOT_GRAPH_BOUND/);
    expect(events).toEqual([]);
  }, 15_000);
});
