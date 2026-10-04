import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { codexBrowserTabIdsFromTranscript, releaseCodexBrowserSession } from "../src/architect/codex-cua-release.js";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "dg-cua-release-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

// Stand-in for cua_repl: the first browser call fails like the real runtime's start-up flag check,
// tab 999 is gone, and every request is recorded so the test can check what was sent.
const FAKE = `
import { appendFileSync } from "node:fs";
const record = process.argv[2];
let browserCalls = 0, buf = "";
process.stdin.on("data", (c) => {
  buf += c.toString();
  let nl;
  while ((nl = buf.indexOf("\\n")) >= 0) {
    const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
    if (!line) continue;
    const m = JSON.parse(line);
    appendFileSync(record, line + "\\n");
    if (m.id === undefined) continue;
    const reply = (result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: m.id, result }) + "\\n");
    if (m.method === "initialize") reply({ protocolVersion: "2025-06-18", capabilities: {} });
    else if (m.params?.name === "js") {
      browserCalls++;
      if (browserCalls === 1) reply({ content: [{ type: "text", text: "Unable to load browser request-header policy. Retry the browser command." }] });
      else if (m.params.arguments.code.includes('"999"')) reply({ content: [{ type: "text", text: "Tab 999 not found" }], isError: true });
      else reply({ content: [{ type: "text", text: "Selected Browser" }] });
    } else if (m.params?.name === "turn_ended") reply({ content: [{ type: "text", text: "{}" }] });
  }
});
process.stdin.on("end", () => process.exit(0));
`;

describe("releasing a finished Codex Computer Use browser session", () => {
  it("reads the tab ids a run operated from its transcript", () => {
    const transcript = [
      '{"type":"thread.started","thread_id":"01a1045d-9282-7c42-8973-eda9105b4604"}',
      'Browser tab: 1198216301, Title: "Web64 IDE", URL: "https://web64.nofs.ai/ide/"',
      "Browser tab: 1198216301, Title: x",
      "Sh { browserId: '1', dialogId: '1', tabId: '1198216299', type: 'prompt' }",
    ].join("\n");
    expect(codexBrowserTabIdsFromTranscript(transcript)).toEqual(["1198216301", "1198216299"]);
    expect(codexBrowserTabIdsFromTranscript("no tabs here")).toEqual([]);
  });

  it("binds each held tab as the finished session in a new turn, retrying the start-up flag error, then ends that turn", async () => {
    const script = join(dir, "fake-cua.mjs"), record = join(dir, "record.jsonl");
    await writeFile(script, FAKE);
    const result = await releaseCodexBrowserSession({
      server: { name: "cua_repl", command: process.execPath, args: [script, record], env: {}, env_vars: [], source: "test" },
      sessionId: "01a1045d-9282-7c42-8973-eda9105b4604", tabIds: ["1198216301", "999"], retryDelayMs: 10,
    });
    expect(result.tabs).toEqual([
      { tab_id: "1198216301", outcome: "bound", detail: "" },
      { tab_id: "999", outcome: "gone", detail: "Tab 999 not found" },
    ]);
    expect(result.turn_ended).toBe("ok");

    const sent = (await readFile(record, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    const js = sent.filter((m) => m.params?.name === "js");
    expect(js).toHaveLength(3); // retry after the start-up flag error, then the gone tab
    const meta = JSON.parse(js[0].params._meta["x-codex-turn-metadata"]);
    expect(meta.session_id).toBe("01a1045d-9282-7c42-8973-eda9105b4604");
    expect(meta.turn_id).toBe(result.turn_id);
    const ended = sent.find((m) => m.params?.name === "turn_ended");
    expect(ended.params.arguments).toEqual({ hook_event_name: "Stop", session_id: "01a1045d-9282-7c42-8973-eda9105b4604", turn_id: result.turn_id });
  });

  it("does nothing without a valid session or any recorded tab", async () => {
    const server = { name: "cua_repl", command: process.execPath, args: [], env: {}, env_vars: [], source: "test" };
    expect((await releaseCodexBrowserSession({ server, sessionId: "../evil", tabIds: ["1"] })).turn_ended).toBe("skipped");
    expect((await releaseCodexBrowserSession({ server, sessionId: "01a1045d", tabIds: [] })).turn_ended).toBe("skipped");
  });
});
