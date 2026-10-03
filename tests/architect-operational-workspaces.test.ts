import { afterEach, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
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
it("opens Config with the context-budget rationale without dispatching another Architect pass", () => {
  const window = fixture(), doc = window.document;
  const routeSource = readFileSync(new URL("../src/architect/routes.ts", import.meta.url), "utf8");
  const start = routeSource.indexOf("    function renderArchitectContinuationPills(panel, result, runtime) {");
  const end = routeSource.indexOf("    function refreshArchitectContinuationPills() {", start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  window.eval(`let chatProcessing=false, activeContinuationToken=null, activeContinuationOptions=[], activePlanId=null;
    const chatStatusEl=document.createElement('div'); document.body.appendChild(chatStatusEl);
    let dispatched=0; function sendChatMessage() { dispatched++; return Promise.resolve(); }
    ${routeSource.slice(start, end)}
    window.renderBudgetPills=renderArchitectContinuationPills;
    window.dispatchCount=()=>dispatched;`);
  const panel = doc.createElement("div"); doc.body.appendChild(panel);
  (window as any).renderBudgetPills(panel, { continuation_options: [{ id: "review-context-budget", label: "Review context budget",
    rationale: "Required allocation exceeds the configured role limit.", safe: true, recommended: true }] }, {});
  const pill = panel.querySelector(".continuation-pill") as HTMLButtonElement;
  expect(pill.disabled).toBe(false);
  pill.click();
  expect((window as any).dispatchCount()).toBe(0);
  expect((window as any).active).toBe("config");
  expect(doc.querySelector("#config-panel iframe")).not.toBeNull();
  expect(doc.querySelector(".architect-context-budget-notice")?.textContent).toContain("Required allocation exceeds the configured role limit.");
  expect(doc.querySelector("#config-panel .architect-context-budget-notice + iframe")).not.toBeNull();
});
