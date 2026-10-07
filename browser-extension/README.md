# DreamGraph Computer Use browser extension

Version 14.0.2. Install the matching DreamGraph runtime first; its installer registers the native messaging host. If needed, run `dg browser setup` under the same operating-system user as your browser.

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode**, choose **Load unpacked**, and select this folder containing `manifest.json`.
3. Enable **DreamGraph Computer Use**. Open its popup and check for **Connected to DreamGraph**. It connects automatically; no API key or daemon port is required.
4. Run `dg browser status`. If disconnected, rerun `dg browser setup`, reload the extension, and press **Try again** in its popup.
5. In Architect, save your permission under **Config → Computer Use**. Connection alone does not authorize control.

After an update, restart the relevant DreamGraph instances and reload the extension. Codex CLI and native API routes use this backend when connected. Native Save/Open dialog handling is available on Windows; Linux/macOS dialogs require operator action.

Full instructions: https://dreamgraph.nofs.ai/guide/computer-use
