/** Shared dashboard authorities inside Architect: no duplicated save or execution endpoints. */
export function embedArchitectWorkspace(html: string, workspace: "config" | "schedules" | "status" | "health"): string {
  const navigation = workspace === "status" || workspace === "health"
    ? `<nav class="workspace-subnav" aria-label="Status views"><a href="/status?embed=architect"${workspace === "status" ? ' aria-current="page"' : ""}>Operational status</a><a href="/health?embed=architect"${workspace === "health" ? ' aria-current="page"' : ""}>Health</a></nav>` : "";
  return html.replace("<body ", '<body data-architect-workspace="' + workspace + '" ')
    .replace("<main>", "<main>" + navigation)
    .replace("</body>", `<style>${WORKSPACE_FILL_CSS}</style><script>
      document.addEventListener('click', function(event) {
        const link = event.target.closest && event.target.closest('a[href]');
        if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || link.target === '_blank') return;
        const url = new URL(link.href, location.href);
        if (url.origin !== location.origin) return;
        const workspaces = { '/config':'config', '/schedules':'schedules', '/status':'status' };
        const target = workspaces[url.pathname];
        const current = document.body.dataset.architectWorkspace;
        const sameStatusWorkspace = target === 'status' && current === 'health';
        if (target && target !== current && !sameStatusWorkspace && window.parent !== window) {
          event.preventDefault(); window.parent.postMessage({type:'dreamgraph:open-workspace',workspace:target,search:url.search},location.origin);
        } else if (target || url.pathname === '/health') {
          event.preventDefault(); url.searchParams.set('embed','architect'); location.assign(url.pathname + url.search + url.hash);
        } else if (url.pathname === '/architect' && window.parent !== window) {
          event.preventDefault(); window.parent.postMessage({type:'dreamgraph:open-workspace',workspace:'chat'},location.origin);
        }
      });
    </script></body>`);
}

const WORKSPACE_FILL_CSS = `
html, body { width:100%; height:100%; min-width:0; margin:0; overflow:hidden; }
body { display:flex; flex-direction:column; background:#121212; color:#ccc; font:12px/1.4 system-ui,sans-serif; }
:root { --bg:#121212; --surface:#1b1b1b; --border:#3a3a3a; --text:#ccc; --text-dim:#aaa; --font:system-ui,sans-serif; }
body > .topbar, body > footer { display:none; }
body > main { flex:1; display:flex; flex-direction:column; min-width:0; min-height:0; width:100%; max-width:none; margin:0; padding:8px; overflow:auto; }
body[data-architect-workspace=config] > main, body[data-architect-workspace=schedules] > main { overflow:hidden; }
h1 { font-size:18px; margin:0 0 6px; } h2 { font-size:14px; } h3 { font-size:12px; }
.workspace-subnav { display:flex; flex:none; gap:2px; margin:-8px -8px 8px; padding:0 8px; min-height:29px; border-bottom:1px solid #3a3a3a; background:#181818; }
.workspace-subnav a { display:flex; align-items:center; padding:5px 10px; color:#aaa; border-bottom:2px solid transparent; font-size:11px; }
.workspace-subnav a[aria-current=page] { color:#ddd; border-bottom-color:#cdb172; background:#242424; }
#configuration-workspace { flex:1; display:flex; flex-direction:column; min-width:0; min-height:0; }
.cw-heading,.cw-toolbar,#cw-tabs,#cw-message,#cw-diagnostics,.cw-savebar { flex:none; }
.cw-heading { gap:8px; } .cw-heading p { font-size:11px; }
.cw-layout { flex:1; min-width:0; min-height:0; overflow:hidden; align-items:stretch; grid-template-columns:minmax(0,1fr) clamp(220px,29%,285px); }
#cw-panel,.cw-inspector { min-width:0; min-height:0; overflow:auto; position:static; max-height:none; }
.cw-edit>input,.cw-edit>select { max-width:none; }
#cw-tabs { flex-wrap:nowrap; overflow-x:auto; } #cw-tabs button { flex-shrink:0; white-space:nowrap; }
.cw-savebar { margin-top:6px; padding:6px 0; position:static; }
#cw-message { min-height:24px; padding:4px 0; }
button,.btn { font-size:11px; border-radius:3px; } input,select,textarea { font-size:12px; border-radius:3px; }
@media(max-width:650px) { .cw-layout { display:block; overflow:auto; } #cw-panel,.cw-inspector { overflow:visible; } }
`;
