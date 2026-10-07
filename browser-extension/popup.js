const state = document.getElementById("state"), label = document.getElementById("label"), detail = document.getElementById("detail"), retry = document.getElementById("retry");
function render(status) {
  const connected = !!(status && status.connected);
  state.classList.toggle("ok", connected);
  label.textContent = connected ? "Connected to DreamGraph" : "Not connected";
  if (connected) {
    const tabs = status.controlled_tabs.length;
    detail.textContent = tabs ? `DreamGraph is controlling ${tabs} tab${tabs === 1 ? "" : "s"} for a Computer Use run.` : "Ready. DreamGraph uses this browser only when you grant Computer Use in the Architect.";
    retry.hidden = true;
  } else {
    const missing = status && /not found|not registered|Specified native messaging host/i.test(status.last_error || "");
    detail.textContent = missing ? "The DreamGraph host is not registered on this computer. Run the DreamGraph installer (or dg browser setup), then try again."
      : `The DreamGraph host is not running${status && status.last_error ? ` (${status.last_error})` : ""}.`;
    retry.hidden = false;
  }
}
retry.addEventListener("click", () => chrome.runtime.sendMessage({ type: "reconnect" }, () => setTimeout(load, 500)));
function load() { chrome.runtime.sendMessage({ type: "status" }, render); }
load();
