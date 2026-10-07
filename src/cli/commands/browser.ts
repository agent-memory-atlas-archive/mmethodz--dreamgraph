/** dg browser — set up and check DreamGraph's browser bridge for Computer Use (Codex CLI and the API engines). */
import type { ParsedArgs } from "../dg.js";
import { browserBridgeStatus, setupBrowserBridge } from "../../computer/browser-bridge/setup.js";
import { runBrowserSelftest } from "../../computer/browser-bridge/selftest.js";

const help = `
dg browser — DreamGraph's Chrome extension for Computer Use (Codex CLI and the API engines)

Usage:
  dg browser setup     Register the DreamGraph browser host with Chrome, Edge, Chromium and Brave
                       (the installer runs this) and show how to load the extension
  dg browser status    Show whether the extension is connected
  dg browser selftest  Check browser control end to end, without any model call: opens a test
                       tab in Chrome, answers a prompt and a confirm, saves through the OS save
                       dialog into a temporary file, then closes the tab (--no-file-dialog skips the save)

The extension is loaded once: chrome://extensions → Developer mode → Load unpacked →
the folder shown by these commands. It connects by itself whenever Chrome runs.
`;

export async function cmdBrowser(positional: string[], flags: ParsedArgs["flags"]) {
  if (flags.help || flags.h || !positional.length) { console.log(help); return; }
  const json = flags.json === true;
  if (positional[0] === "setup") {
    const result = await setupBrowserBridge();
    const status = await browserBridgeStatus();
    if (json) { console.log(JSON.stringify({ ...result, connected: status.connected }, null, 2)); return; }
    console.log(`Browser host registered (${result.registered.length} browser${result.registered.length === 1 ? "" : "s"}).`);
    for (const warning of result.warnings) console.log(`  warning: ${warning}`);
    console.log(`Extension folder: ${result.extension_dir}`);
    console.log(`Extension id:     ${result.extension_id}`);
    console.log(status.connected ? "The extension is connected." : `Next: ${status.next_step}`);
    return;
  }
  if (positional[0] === "status") {
    const status = await browserBridgeStatus();
    if (json) { console.log(JSON.stringify(status, null, 2)); return; }
    console.log(`Host registered:  ${status.host_registered ? "yes" : "no"}`);
    console.log(`Extension:        ${status.connected ? `connected (version ${status.hosts[0]?.extension_version ?? "unknown"})` : "not connected"}`);
    console.log(`Extension folder: ${status.extension_dir}`);
    if (status.next_step) console.log(`Next: ${status.next_step}`);
    return;
  }
  if (positional[0] === "selftest") {
    const result = await runBrowserSelftest({ skipFileDialog: flags["no-file-dialog"] === true,
      log: json ? undefined : step => console.log(`${step.ok ? "ok  " : "FAIL"} ${step.step}${step.detail ? ` — ${step.detail.replace(/\s*\n\s*/g, " | ")}` : ""}`) });
    if (json) console.log(JSON.stringify(result, null, 2));
    else console.log(result.ok ? "Browser self-test passed." : "Browser self-test failed.");
    if (!result.ok) process.exitCode = 1;
    return;
  }
  throw new Error("Run dg browser --help for the browser commands.");
}
