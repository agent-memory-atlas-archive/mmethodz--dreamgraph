import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { LineReader, NativeMessageReader, encodeLine, encodeNativeMessage, extensionIdFromKey } from "../src/computer/browser-bridge/protocol.js";
import { parseKeyChord } from "../src/computer/browser-bridge/keys.js";
import { browserCallTitle, dreamgraphUiProtector } from "../src/computer/dreamgraph-browser.js";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computerUseBackendPreference } from "../src/computer/computer-use-backend.js";

describe("browser bridge wire protocol", () => {
  it("frames native messages with a 32-bit little-endian length and splits them across chunks", () => {
    const messages: unknown[] = [];
    const reader = new NativeMessageReader(message => messages.push(message));
    const bytes = Buffer.concat([encodeNativeMessage({ id: 1, method: "tabs.list" }), encodeNativeMessage({ event: "cdp", tab_id: 7, method: "Page.loadEventFired", params: { ü: "ä" } })]);
    expect(bytes.readUInt32LE(0)).toBe(Buffer.byteLength(JSON.stringify({ id: 1, method: "tabs.list" })));
    for (let index = 0; index < bytes.length; index += 5) reader.push(bytes.subarray(index, index + 5));
    expect(messages).toEqual([{ id: 1, method: "tabs.list" }, { event: "cdp", tab_id: 7, method: "Page.loadEventFired", params: { ü: "ä" } }]);
  });

  it("reads JSON lines split across chunks", () => {
    const messages: unknown[] = [];
    const reader = new LineReader(message => messages.push(message));
    const text = encodeLine({ id: 1 }) + encodeLine({ id: 2, result: { a: "x\ny" } });
    reader.push(text.slice(0, 7)); reader.push(text.slice(7));
    expect(messages).toEqual([{ id: 1 }, { id: 2, result: { a: "x\ny" } }]);
  });

  it("derives the extension id from the manifest key, as Chrome does", async () => {
    const manifest = JSON.parse(await readFile(new URL("../browser-extension/manifest.json", import.meta.url), "utf8")) as { key: string; permissions: string[]; manifest_version: number };
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual(["debugger", "tabs", "nativeMessaging", "alarms"]);
    expect(extensionIdFromKey(manifest.key)).toMatch(/^[a-p]{32}$/);
    expect(extensionIdFromKey(manifest.key)).toBe("aakildkcmiknihocanjgiainbhgbengl");
  });
});

describe("browser keys", () => {
  it("parses chords into modifiers and CDP keys", () => {
    expect(parseKeyChord("Enter").keys[0]).toMatchObject({ key: "Enter", code: "Enter", keyCode: 13, text: "\r" });
    const save = parseKeyChord("Control+S");
    expect(save.modifiers).toBe(2); expect(save.keys[0]).toMatchObject({ key: "s", code: "KeyS", keyCode: 83 }); expect(save.keys[0].text).toBeUndefined();
    expect(parseKeyChord("Shift+a").keys[0]).toMatchObject({ key: "A", text: "A" });
    expect(parseKeyChord("F5").keys[0]).toMatchObject({ key: "F5", keyCode: 116 });
    expect(() => parseKeyChord("Hyper+X")).toThrow("BROWSER_KEY_UNKNOWN");
  });
});

describe("backend choice and trace titles", () => {
  it("defaults to auto and accepts the two backends", () => {
    expect(computerUseBackendPreference({})).toBe("auto");
    expect(computerUseBackendPreference({ DREAMGRAPH_COMPUTER_USE_BACKEND: "dreamgraph-browser" })).toBe("dreamgraph-browser");
    expect(computerUseBackendPreference({ DREAMGRAPH_COMPUTER_USE_BACKEND: "CUA-RUNTIME" })).toBe("cua-runtime");
    expect(computerUseBackendPreference({ DREAMGRAPH_COMPUTER_USE_BACKEND: "other" })).toBe("auto");
  });
  it("titles browser calls for the tool trace", () => {
    expect(browserCallTitle("browser_click", { ref: "e12" })).toBe("Click e12");
    expect(browserCallTitle("browser_dialog", { accept: true, text: "src/hello.asm" })).toBe("Accept dialog with \"src/hello.asm\"");
    expect(browserCallTitle("browser_type", { ref: "e8", text: "lda #$00", submit: true })).toBe("Type \"lda #$00\" into e8 and submit");
    expect(browserCallTitle("browser_snapshot", {})).toBe("Read the page");
  });
});

describe("DreamGraph's own pages", () => {
  it("are recognised from every running instance's server port, and only on this computer", async () => {
    const master = await mkdtemp(join(tmpdir(), "dg-master-"));
    await mkdir(join(master, "instance-a", "runtime"), { recursive: true });
    await writeFile(join(master, "instance-a", "runtime", "server.json"), JSON.stringify({ pid: 1, transport: "http", port: 6401 }));
    await mkdir(join(master, "bin"), { recursive: true });
    const protectedUrl = await dreamgraphUiProtector(master);
    expect(protectedUrl("http://127.0.0.1:6401/architect")).toMatch(/DreamGraph's own page/);
    expect(protectedUrl("http://localhost:6401/config")).toMatch(/DreamGraph's own page/);
    expect(protectedUrl("http://localhost:5173/ide")).toBeNull();
    expect(protectedUrl("https://example.com:6401/")).toBeNull();
    expect(protectedUrl("not a url")).toBeNull();
    await rm(master, { recursive: true, force: true });
  });
});
