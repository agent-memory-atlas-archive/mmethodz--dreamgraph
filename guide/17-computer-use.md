# Computer Use: install and connect the browser

DreamGraph v14.0.2 gives Architect a shared browser backend for both **Codex CLI** and **native OpenAI/Anthropic API** routes. Install the DreamGraph browser extension, connect its native host, then choose your Computer Use permission in Architect. A connected extension is not itself permission to act.

## 1. Install the matching DreamGraph runtime

From the v14.0.2 repository checkout:

```powershell
# Windows
.\scripts\install.ps1 -Force
```

```bash
# Linux / accepted WSL installer test bed
bash scripts/install.sh --force
```

The installer copies `browser-extension/` into the shared installation and registers the native messaging host. Restart the instances you want to use, then check the installed version:

```bash
dg --version
dg restart <instance>
dg browser status
```

If the host is not registered, run `dg browser setup` under the same operating-system user as your browser. This also prints the exact **Extension folder**. The default is:

- Windows: `%USERPROFILE%\.dreamgraph\bin\browser-extension`
- Linux/macOS: `~/.dreamgraph/bin/browser-extension`

Use the printed path for a custom installation. A Windows Chrome profile needs the Windows installation and native host; installing only inside WSL does not register the Windows host.

## 2. Load the extension in your browser

The extension is distributed **unpacked**, not through a browser store in this release.

1. Open Chrome's extensions page (`chrome://extensions`). In Edge, use `edge://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and select the **Extension folder** printed by `dg browser setup`. Select the folder containing `manifest.json`, not a ZIP file or the repository root.
4. Confirm that **DreamGraph Computer Use**, version **14.0.2**, is enabled. Pin it to the toolbar if you want easy access to connection status.

The extension uses browser debugging and native messaging to observe and control granted tabs. Chrome may display a debugging banner while a tab is controlled. Cancelling that banner revokes control for that run; Architect must stop rather than silently reattach.

Chrome is the practical reference browser. Registration also covers Chromium-family browsers supported by the setup command; registration alone is not a claim that every browser/platform combination has been field-tested.

## 3. Verify the connection

Keep the browser open. The extension connects automatically to the local native host; there is no daemon-port field or API key to paste into the extension.

Open its toolbar popup. It should say **Connected to DreamGraph**. Then run:

```bash
dg browser status
```

If the popup says **Not connected**, run `dg browser setup`, reload the extension from the extensions page, and press **Try again** in the popup. Check that the browser and host run under the same operating-system user. After updating DreamGraph, reload the extension so its background worker uses the new code.

Multiple daemon instances keep their own execution and permission scope. Browser connection is shared discovery, not permission for one instance to take over another instance's work.

## 4. Allow a task in Architect

Open your instance's `/architect` page. In **Config → Computer Use**, choose:

- **Allow:** Architect can use Computer Use when the task needs it.
- **Ask every time:** approve when Architect asks, or pre-approve the next message.
- **Deny:** no computer operation.

Save the setting. In **Config → Architect**, select Codex CLI or the native API engine and the model you want. Ask for a concrete task and target, for example: “Open this application, create a small example and save it to this project folder.” Keep the browser open throughout the task.

You do not need to select workers or target profiles for each browser task. The adapter prepares the available backend automatically and reports the effective route. Use Architect's Stop control to cancel; if release cannot be confirmed, follow the reported recovery state rather than assuming control was released.

## Backend selection and limits

| Route or action | v14.0.2 behavior |
|---|---|
| Codex CLI with extension connected | DreamGraph browser tools through the MCP bridge, including Windows dialog handling. |
| Native OpenAI/Anthropic API with extension connected | The same DreamGraph browser backend through the daemon tool loop. |
| Extension unavailable in automatic mode | Codex CUA runtime fallback where available. This fallback does not provide DreamGraph's Windows dialog handling or hard protection of DreamGraph's own pages. |
| Copilot CLI | Computer Use unavailable. |
| JavaScript alert, confirm and prompt | Reported and answered through browser tools. |
| Native Windows Save/Open dialogs | Supported path entry and confirmation. Overwriting an existing file requires explicit overwrite intent. |
| Native Linux/macOS dialogs | Operator action required. Desktop automation on those platforms is not qualified by this release. |

The advanced setting `DREAMGRAPH_COMPUTER_USE_BACKEND` accepts `auto`, `dreamgraph-browser` or `cua-runtime`. Use `dreamgraph-browser` when you want connection failure reported instead of choosing the fallback. Browser authorization remains required whichever backend is selected.

DreamGraph's own Architect, Config and Explorer pages are protected from agent control by the DreamGraph backend. On the Codex CUA fallback, that restriction is instruction-based. Saving into browser-protected locations such as Windows, Program Files, AppData or the operating-system temporary directory can be refused; use an ordinary project folder or the instance runtime's suggested save location.

## Optional local connection test

```bash
dg browser selftest
```

This performs browser actions against a test page, including a prompt, confirmation and a Windows Save dialog. It makes **no model request**. Run it when you are ready for the browser/dialog interaction. `dg browser selftest --no-file-dialog` skips the native save step. A passing self-test checks the browser connection and tool path; it does not establish model quality or every application's compatibility.

For backend details and field evidence, see the [current Computer Use contract](../docs/ashoka/computer-use-contract.md) and [v14.0.2 release notes](../RELEASE_NOTES_v14.0.2.md).
