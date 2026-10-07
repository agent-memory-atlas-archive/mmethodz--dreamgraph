/**
 * Registers the DreamGraph browser host with Chrome (native messaging) and reports the bridge status.
 * Run by the installers and by `dg browser setup`. The extension itself is loaded once by the user
 * (chrome://extensions → Developer mode → Load unpacked → the folder this reports).
 */
import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { BROWSER_HOST_NAME, extensionIdFromKey } from "./protocol.js";
import { listBrowserHosts } from "./client.js";

const run = promisify(execFile);
const exists = (path: string) => access(path).then(() => true, () => false);

/** Browsers that read Chrome native messaging manifests, per platform. */
const WINDOWS_KEYS = ["Software\\Google\\Chrome", "Software\\Microsoft\\Edge", "Software\\Chromium", "Software\\BraveSoftware\\Brave-Browser"]
  .map(base => `HKCU\\${base}\\NativeMessagingHosts\\${BROWSER_HOST_NAME}`);
function manifestDirectories(home: string, platform: NodeJS.Platform): string[] {
  if (platform === "darwin") return ["Google/Chrome", "Chromium", "Microsoft Edge", "BraveSoftware/Brave-Browser"]
    .map(name => join(home, "Library", "Application Support", name, "NativeMessagingHosts"));
  return ["google-chrome", "chromium", "microsoft-edge", "BraveSoftware/Brave-Browser"].map(name => join(home, ".config", name, "NativeMessagingHosts"));
}

export interface BrowserBridgeLayout { installDir: string; distDir: string; extensionDir: string; hostScript: string; browserDir: string }

/** Where this installation keeps the compiled host and the extension (installed: ~/.dreamgraph/bin; dev: the repository). */
export async function browserBridgeLayout(home = homedir()): Promise<BrowserBridgeLayout> {
  const distDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const installDir = dirname(distDir);
  const extensionDir = join(installDir, "browser-extension");
  return { installDir, distDir, extensionDir, hostScript: join(distDir, "computer", "browser-bridge", "host-main.js"), browserDir: join(home, ".dreamgraph", "browser") };
}

export async function extensionId(extensionDir: string): Promise<string> {
  const manifest = JSON.parse(await readFile(join(extensionDir, "manifest.json"), "utf8")) as { key?: string };
  if (!manifest.key) throw new Error("BROWSER_EXTENSION_KEY_MISSING");
  return extensionIdFromKey(manifest.key);
}

export interface BrowserSetupResult { extension_dir: string; extension_id: string; host_manifest: string; launcher: string; registered: string[]; warnings: string[] }

export async function setupBrowserBridge(options: { home?: string; platform?: NodeJS.Platform; nodePath?: string; layout?: BrowserBridgeLayout; register?: boolean } = {}): Promise<BrowserSetupResult> {
  const home = options.home ?? homedir(), platform = options.platform ?? process.platform, layout = options.layout ?? await browserBridgeLayout(home);
  const warnings: string[] = [];
  if (!await exists(join(layout.extensionDir, "manifest.json"))) throw new Error(`BROWSER_EXTENSION_MISSING: ${layout.extensionDir}`);
  if (!await exists(layout.hostScript)) throw new Error(`BROWSER_HOST_MISSING: ${layout.hostScript} (build DreamGraph first)`);
  const id = await extensionId(layout.extensionDir), node = options.nodePath ?? process.execPath;
  await mkdir(layout.browserDir, { recursive: true });
  const launcher = join(layout.browserDir, platform === "win32" ? "dreamgraph-browser-host.cmd" : "dreamgraph-browser-host");
  if (platform === "win32") await writeFile(launcher, `@echo off\r\n"${node}" "${layout.hostScript}" %*\r\n`, "utf8");
  else await writeFile(launcher, `#!/bin/sh\nexec "${node}" "${layout.hostScript}" "$@"\n`, { encoding: "utf8", mode: 0o755 });
  const manifest = { name: BROWSER_HOST_NAME, description: "DreamGraph Computer Use browser host", path: launcher, type: "stdio",
    allowed_origins: [`chrome-extension://${id}/`] };
  const manifestPath = join(layout.browserDir, `${BROWSER_HOST_NAME}.json`);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const registered: string[] = [];
  if (options.register !== false) {
    if (platform === "win32") {
      for (const key of WINDOWS_KEYS) {
        try { await run("reg", ["add", key, "/ve", "/t", "REG_SZ", "/d", manifestPath, "/f"], { windowsHide: true }); registered.push(key); }
        catch (error) { warnings.push(`could not register ${key}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`); }
      }
    } else {
      for (const directory of manifestDirectories(home, platform)) {
        // Only for browsers that exist for this user; Chrome itself is always prepared.
        if (!await exists(dirname(directory)) && !/google-chrome|Google\/Chrome/.test(directory)) continue;
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, `${BROWSER_HOST_NAME}.json`), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
        registered.push(directory);
      }
    }
  }
  return { extension_dir: layout.extensionDir, extension_id: id, host_manifest: manifestPath, launcher, registered, warnings };
}

export interface BrowserBridgeStatus {
  extension_dir: string;
  extension_id: string | null;
  host_registered: boolean;
  connected: boolean;
  hosts: Array<{ pid: number; extension_version: string | null; started_at: string }>;
  next_step: string | null;
}

export async function browserBridgeStatus(home = homedir()): Promise<BrowserBridgeStatus> {
  const layout = await browserBridgeLayout(home);
  const id = await extensionId(layout.extensionDir).catch(() => null);
  const host_registered = await exists(join(layout.browserDir, `${BROWSER_HOST_NAME}.json`));
  const hosts = (await listBrowserHosts(home)).map(host => ({ pid: host.pid, extension_version: host.extension_version, started_at: host.started_at }));
  const connected = hosts.length > 0;
  const next_step = !host_registered ? "Run `dg browser setup` (the installer does this) to register the DreamGraph browser host."
    : !connected ? `In Chrome open chrome://extensions, turn on Developer mode, choose Load unpacked and select ${layout.extensionDir}. `
      + "Then keep Chrome open; the extension connects by itself."
    : null;
  return { extension_dir: layout.extensionDir, extension_id: id, host_registered, connected, hosts, next_step };
}
