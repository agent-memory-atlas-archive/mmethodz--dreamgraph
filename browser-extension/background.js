// DreamGraph Computer Use — Chrome extension service worker.
// A thin relay: the DreamGraph browser host (native messaging, started by Chrome) sends tab and debugger
// commands; this worker runs them with chrome.tabs / chrome.debugger and sends CDP events back.
// It keeps one debugger attachment per controlled tab and the dialog state of each, because a dialog that opened
// before an attachment cannot be seen or answered by a later one.

const HOST = "io.dreamgraph.browser";
const VERSION = chrome.runtime.getManifest().version;
let port = null;
let lastError = null;
let connectedAt = null;
const attached = new Set();
const dialogs = new Map();

function post(message) { if (port) { try { port.postMessage(message); } catch (error) { lastError = String(error); } } }

function connect() {
  if (port) return;
  try { port = chrome.runtime.connectNative(HOST); }
  catch (error) { lastError = String(error && error.message || error); port = null; return; }
  port.onMessage.addListener(message => { void handle(message); });
  port.onDisconnect.addListener(() => {
    lastError = chrome.runtime.lastError ? chrome.runtime.lastError.message : "host disconnected";
    port = null; connectedAt = null;
    // Without the host nobody can answer for these tabs: give control back to the user.
    for (const tabId of attached) chrome.debugger.detach({ tabId }).catch(() => undefined);
    attached.clear(); dialogs.clear(); badge();
  });
  connectedAt = new Date().toISOString(); lastError = null;
  post({ hello: { version: VERSION } });
}

function badge() {
  chrome.action.setBadgeText({ text: attached.size ? "ON" : "" }).catch(() => undefined);
  chrome.action.setBadgeBackgroundColor({ color: "#2f6f5e" }).catch(() => undefined);
}

function errorOf(error) {
  const message = String(error && error.message || error);
  const code = /Cannot access|chrome:\/\/|chrome-extension:\/\//i.test(message) ? "BROWSER_TAB_RESTRICTED"
    : /Another debugger is already attached/i.test(message) ? "BROWSER_TAB_DEBUGGED_ELSEWHERE"
    : /No tab with id|No target with given id/i.test(message) ? "BROWSER_TAB_GONE"
    : /not attached/i.test(message) ? "BROWSER_TAB_NOT_CONTROLLED"
    : "BROWSER_EXTENSION_ERROR";
  return { code, message };
}

const tabInfo = tab => ({ tab_id: tab.id, window_id: tab.windowId, url: tab.url || tab.pendingUrl || "", title: tab.title || "",
  active: !!tab.active, controlled: attached.has(tab.id) });

async function run(method, params) {
  switch (method) {
    case "tabs.list": return (await chrome.tabs.query({})).filter(tab => tab.id !== undefined).map(tabInfo);
    case "tabs.open": return tabInfo(await chrome.tabs.create({ url: params.url, active: true }));
    case "tabs.close": await chrome.tabs.remove(params.tab_id); return {};
    case "tabs.activate": {
      const tab = await chrome.tabs.update(params.tab_id, { active: true });
      if (tab && tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => undefined);
      return {};
    }
    case "debugger.attach": {
      const tabId = params.tab_id;
      if (!attached.has(tabId)) {
        await chrome.debugger.attach({ tabId }, "1.3");
        attached.add(tabId); badge();
      }
      await chrome.debugger.sendCommand({ tabId }, "Page.enable", {});
      return {};
    }
    case "debugger.detach": {
      const tabId = params.tab_id;
      if (attached.has(tabId)) { attached.delete(tabId); dialogs.delete(tabId); badge(); await chrome.debugger.detach({ tabId }).catch(() => undefined); }
      return {};
    }
    case "debugger.send":
      return (await chrome.debugger.sendCommand({ tabId: params.tab_id }, params.method, params.params || {})) || {};
    case "dialog.get": return { dialog: dialogs.get(params.tab_id) || null };
    default: throw new Error(`unknown method ${method}`);
  }
}

async function handle(message) {
  if (!message || typeof message.id !== "number") return;
  try { post({ id: message.id, result: await run(message.method, message.params || {}) }); }
  catch (error) { post({ id: message.id, error: errorOf(error) }); }
}

// Only what DreamGraph uses: page events, the file-dialog binding and context resets (not console traffic).
const FORWARDED = new Set(["Runtime.bindingCalled", "Runtime.executionContextsCleared", "Inspector.targetCrashed"]);
chrome.debugger.onEvent.addListener((source, method, params) => {
  if (source.tabId === undefined || !attached.has(source.tabId) || source.sessionId) return;
  if (!method.startsWith("Page.") && !FORWARDED.has(method)) return;
  if (method === "Page.javascriptDialogOpening") dialogs.set(source.tabId, { type: params.type, message: params.message || "",
    default_prompt: params.defaultPrompt || "", url: params.url || "" });
  if (method === "Page.javascriptDialogClosed") dialogs.delete(source.tabId);
  post({ event: "cdp", tab_id: source.tabId, method, params: params || {} });
});

chrome.debugger.onDetach.addListener((source, reason) => {
  if (source.tabId === undefined || !attached.has(source.tabId)) return;
  attached.delete(source.tabId); dialogs.delete(source.tabId); badge();
  post({ event: "detach", tab_id: source.tabId, reason });
});

chrome.tabs.onRemoved.addListener(tabId => {
  if (!attached.has(tabId)) return;
  attached.delete(tabId); dialogs.delete(tabId); badge();
  post({ event: "tab_removed", tab_id: tabId });
});

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message && message.type === "status") { reply({ connected: !!port, connected_at: connectedAt, last_error: lastError, controlled_tabs: [...attached], version: VERSION }); return; }
  if (message && message.type === "reconnect") { connect(); reply({ connected: !!port }); }
});

// Stay connected: the open native port keeps this worker alive; the alarm reconnects after a host restart.
chrome.alarms.create("dreamgraph-reconnect", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === "dreamgraph-reconnect") connect(); });
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
connect();
