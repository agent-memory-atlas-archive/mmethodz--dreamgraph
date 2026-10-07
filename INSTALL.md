# Installing DreamGraph

One-command install from source. Builds the MCP server, deploys the `dg` CLI globally, serves the architect beta through the daemon, and installs the VS Code extension with DreamGraph Explorer.

> Prefer a guided walkthrough with screenshots? See the install page on the website: **[dreamgraph.nofs.ai/guide/installation](https://dreamgraph.nofs.ai/guide/installation)**.

---

## Prerequisites

| Requirement | Minimum | Check |
|-------------|---------|-------|
| **Node.js** | v20+ | `node --version` |
| **npm** | 8+ | `npm --version` |
| **Git** | any | `git --version` |
| **VS Code** | 1.100+ | Optional -- extension install is skipped if `code` is not in PATH |

---

## Quick Install

### Windows (PowerShell)

```powershell
git clone https://github.com/mmethodz/dreamgraph.git
cd dreamgraph
.\scripts\install.ps1
```

### Linux / macOS (Bash)

The v14 qualification includes the accepted WSL2 Ubuntu 24.04 / Node 20 installer and isolated-browser-worker pass. The Bash script also retains macOS paths, but macOS and additional native desktop environments are not qualified by this release. See the [release scope](docs/ashoka/v14-release-scope.md).

```bash
git clone https://github.com/mmethodz/dreamgraph.git
cd dreamgraph
bash scripts/install.sh
```

That's it. After install, open a **new terminal** and run:

```bash
dg --version          # Shows the installed release
dg --help             # Show all commands
```

---

## What the Installer Does

1. **Checks prerequisites** -- Node.js >= 20, npm available
2. **Builds** -- Runs `npm install` + `npm run build` (TypeScript compilation)
3. **Deploys to `~/.dreamgraph/bin/`** -- Copies compiled `dist/`, retains runtime and optional dependencies, runs `npm install --omit=dev`, and verifies installed workspace bytes and daemon imports
4. **Copies templates** -- Default instance templates to `~/.dreamgraph/templates/`
5. **Installs VS Code extension** -- Packages a VSIX, installs via `code --install-extension`, then installs runtime dependencies
6. **Registers DreamGraph's browser host** -- copies the Chrome extension to `~/.dreamgraph/bin/browser-extension` and runs `dg browser setup` (see *Computer Use browser extension* below)
7. **Creates command shims** -- `dg` and `dreamgraph` wrappers on PATH
8. **Configures PATH** -- Windows: adds to user PATH. Linux/macOS: creates shims in `~/.local/bin` or `/usr/local/bin`
9. **Verifies** -- Runs `dg --version` to confirm everything works

The optional isolated browser runtime is pinned to `playwright-core@1.62.1`. Installation does not download a browser or enable Computer Use. An explicitly selected browser must pass the installed [worker qualification](docs/ashoka/computer-use.md) before activation.

### Computer Use browser extension

Computer Use (Codex CLI and the API engines) operates your Chrome through DreamGraph's own extension. It stays idle until you grant Computer Use for a pass.

1. Load it once: `chrome://extensions` → **Developer mode** → **Load unpacked** → the folder `dg browser setup` prints (`~/.dreamgraph/bin/browser-extension`). Edge, Chromium and Brave work the same way.
2. `dg browser status` (or Config → Computer Use → *Browser for Computer Use*) shows whether it is connected.
3. `dg browser selftest` checks it end to end without a model: a prompt, a confirm, and a save through the operating system's Save dialog (Windows; `--no-file-dialog` skips the save).

After an upgrade, reload the extension (↻ on `chrome://extensions`) when the release notes say it changed. While DreamGraph controls a tab, Chrome shows a "started debugging this browser" bar; **Cancel** there takes control back.

WSL uses Linux Node/npm and its own `$HOME/.dreamgraph` installation. Keep the source checkout on the Linux filesystem and check any `DREAMGRAPH_MASTER_DIR` override. Installing there does not update the Windows daemon. WSL browser proof does not establish native desktop support on a separate Linux machine.

---

## Upgrade

Re-run the installer with `--force` (or `-Force` on PowerShell) to overwrite an existing installation:

```powershell
# Windows
.\scripts\install.ps1 -Force

# Linux / macOS
bash scripts/install.sh --force
```

The installer updates the shared `~/.dreamgraph/bin` runtime. Restart each running instance to use the new version. If an instance still has a legacy graph, stop it, run `dg graph-upgrade <instance>`, then restart it. The upgrade saves a verified backup and review; see the [v14.0.1 patch notes](RELEASE_NOTES_v14.0.1.md) for the recovery behavior and known limitations.

---

## Uninstall

### Windows

```powershell
# Remove the installation directory
Remove-Item -Recurse -Force "$env:USERPROFILE\.dreamgraph"

# Remove from user PATH (edit manually or run)
$path = [Environment]::GetEnvironmentVariable("Path", "User")
$path = ($path -split ';' | Where-Object { $_ -notlike '*\.dreamgraph\bin*' }) -join ';'
[Environment]::SetEnvironmentVariable("Path", $path, "User")

# Remove VS Code extension
code --uninstall-extension siteledger-solutions.dreamgraph-vscode
```

### Linux / macOS

```bash
rm -rf ~/.dreamgraph
rm -f ~/.local/bin/dg ~/.local/bin/dreamgraph
# or if installed to /usr/local/bin:
# sudo rm -f /usr/local/bin/dg /usr/local/bin/dreamgraph

code --uninstall-extension siteledger.dreamgraph-vscode
```

---

## Custom Install Location

Set `DREAMGRAPH_MASTER_DIR` before running the installer to change the install directory:

```powershell
# Windows
$env:DREAMGRAPH_MASTER_DIR = "D:\tools\dreamgraph"
.\scripts\install.ps1

# Linux / macOS
DREAMGRAPH_MASTER_DIR=/opt/dreamgraph bash scripts/install.sh
```

---

## Installer Options

### `install.ps1` (Windows)

| Parameter | Description |
|-----------|-------------|
| `-SourceDir <path>` | Path to the DreamGraph source repo (default: current directory) |
| `-Force` | Overwrite existing installation without prompting |

### `install.sh` (Linux / macOS)

| Flag | Description |
|------|-------------|
| `--source <dir>` | Path to the DreamGraph source repo (default: parent of `scripts/`) |
| `--force` | Overwrite existing installation without prompting |
| `--help` | Show usage |

---

## Browser extension and Computer Use

The installer registers the native messaging host and deploys `browser-extension/`. Load that folder using **Developer mode → Load unpacked** at `chrome://extensions` or `edge://extensions`. `dg browser setup` prints the exact folder; `dg browser status` and the extension popup verify the connection. Then set the permission in **Architect → Config → Computer Use**. After updates, reload the extension and restart the relevant instances. See the [complete installation and connection guide](guide/17-computer-use.md), including Windows dialog support and fallback limits.

## Post-Install: First Run

```bash
# 1. Create your first instance
dg init --name my-project --project /path/to/your/repo

# 2. Start the daemon
dg start my-project

# 3. Open VS Code -- the DreamGraph sidebar appears automatically
code /path/to/your/repo
```

---

## Troubleshooting

### `dg` command not found after install

Open a **new terminal**. The PATH change only takes effect in new sessions.

On Linux/macOS, if `~/.local/bin` is not in your PATH, add to your shell rc file:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

### VS Code extension not activating

1. Check the extension is installed: Extensions sidebar > search "DreamGraph"
2. If missing, the installer may have skipped it (VS Code `code` CLI not in PATH)
3. Manual install after packaging: `code --install-extension extensions/vscode/dreamgraph-vscode-14.0.2.vsix`
4. Reload VS Code: `Ctrl+Shift+P` > "Reload Window"

### Extension activation error (missing modules)

The v14.0.2 VSIX bundles its runtime and vendors its webview libraries. Reinstall the v14.0.2 VSIX and reload VS Code rather than installing npm dependencies inside the installed extension. If activation still fails, retain the exact missing-module message and report it with the extension and VS Code versions. Physical VS Code activation is not implied by the compiled-suite/package checks.

### PowerShell execution policy error

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

### Build fails

Make sure you have Node.js 20+ and npm installed. Run manually to see errors:

```bash
npm install
npm run build
```

### Sidebar / dashboard view disappeared

VS Code occasionally hides the DreamGraph sidebar after a layout change or window-state shuffle. The extension no longer auto-restores it on every editor focus event (that auto-restore was the cause of multi-second cursor stalls in v7.1.0). Instead, when the chat panel and dashboard are both hidden a small **DreamGraph** indicator appears in the status bar — click it to bring the activity-bar container back. You can also run **DreamGraph: Show Dashboard** or **DreamGraph: Open Chat** from the command palette (`Ctrl+Shift+P`).
