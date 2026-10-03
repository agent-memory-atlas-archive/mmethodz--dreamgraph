import { afterEach, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { ARCHITECT_OPERATIONAL_WORKSPACES_SCRIPT } from "../src/architect/operational-workspaces-ui.js";
import { embedArchitectWorkspace } from "../src/server/architect-workspace-shell.js";

let dom: JSDOM;
afterEach(() => dom?.window.close());
function fixture() {
  dom = new JSDOM(`<div id="panels"><div id="config-panel"></div><div id="schedules-panel"></div></div><a id="config-link" href="/config">Config</a><a id="explorer-link" href="/explorer/" target="_blank">Open Explorer ↗</a>`, { url: "http://localhost:8100/architect", runScripts: "outside-only" });
  dom.window.eval(`const architectCenterPanelContainer=document.getElementById('panels'); const architectCenterTabs=[{id:'config',type:'config',panelId:'config-panel'},{id:'schedules',type:'schedules',panelId:'schedules-panel'}];
    function setArchitectCenterTab(id) { window.active=id; const tab=architectCenterTabs.find(t=>t.id===id); if(tab)mountArchitectOperationalWorkspace(tab,document.getElementById(tab.panelId)); }
    ${ARCHITECT_OPERATIONAL_WORKSPACES_SCRIPT}`);
  return dom.window;
}
it("opens on demand and retains the same frame/draft lifetime through tab switches", () => {
  const window = fixture(), doc = window.document;
  expect(doc.querySelector("iframe")).toBeNull();
  (doc.getElementById("config-link") as HTMLAnchorElement).click();
  const frame = doc.querySelector("#config-panel iframe") as HTMLIFrameElement;
  expect(frame.src).toBe("http://localhost:8100/config?embed=architect");
  window.eval("openArchitectOperationalWorkspace('schedules'); openArchitectOperationalWorkspace('config');");
  expect(doc.querySelector("#config-panel iframe")).toBe(frame);
  expect(doc.querySelectorAll("iframe")).toHaveLength(2);
});
it("accepts navigation only from an owned same-origin workspace and leaves Explorer as a separate link", () => {
  const window = fixture();
  window.eval("openArchitectOperationalWorkspace('config');");
  const frame = window.document.querySelector("iframe") as HTMLIFrameElement;
  const send = (origin: string, source: any) => window.dispatchEvent(new window.MessageEvent("message", { origin, source, data: { type: "dreamgraph:open-workspace", workspace: "schedules" } }));
  send("http://elsewhere.invalid", frame.contentWindow); expect((window as any).active).toBe("config");
  send(window.location.origin, window); expect((window as any).active).toBe("config");
  send(window.location.origin, frame.contentWindow); expect((window as any).active).toBe("schedules");
  const explorer = window.document.getElementById("explorer-link") as HTMLAnchorElement;
  expect(explorer.target).toBe("_blank");
  const event = new window.MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true });
  window.document.getElementById("config-link")!.dispatchEvent(event); expect(event.defaultPrevented).toBe(false);
});
it("keeps health within the Status workspace and routes configuration links to the parent", () => {
  dom = new JSDOM(embedArchitectWorkspace('<html><head></head><body data-dg-active-tab="status"><nav class="topbar"></nav><main>Status</main><footer></footer></body></html>', "status"), { url: "http://localhost:8100/status?embed=architect", runScripts: "outside-only" });
  expect(dom.window.document.body.dataset.architectWorkspace).toBe("status");
  expect((dom.window.document.querySelector('.workspace-subnav a[href^="/health"]') as HTMLAnchorElement).href).toBe("http://localhost:8100/health?embed=architect");
});
