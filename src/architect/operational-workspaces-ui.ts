/** Architect tabs retain the existing configuration/scheduler/runtime owners and drafts. */
export const ARCHITECT_OPERATIONAL_WORKSPACES_SCRIPT = String.raw`
    const architectOperationalWorkspaces = { config: { title: 'Config', path: '/config' }, schedules: { title: 'Schedules', path: '/schedules' }, status: { title: 'Status', path: '/status' } };
    function mountArchitectOperationalWorkspace(tab, panel) {
      if (panel.querySelector('iframe')) return;
      const descriptor = architectOperationalWorkspaces[tab.type];
      if (!descriptor) return;
      panel.classList.add('architect-operational-workspace');
      const frame = document.createElement('iframe');
      frame.title = descriptor.title + ' workspace';
      const params = new URLSearchParams(tab.workspaceSearch || '');
      params.set('embed', 'architect');
      frame.src = descriptor.path + '?' + params.toString();
      panel.appendChild(frame);
    }
    function openArchitectOperationalWorkspace(type, search) {
      if (type === 'chat') { setArchitectCenterTab('chat'); return; }
      if (!architectOperationalWorkspaces[type]) return;
      const tab = architectCenterTabs.find(function(candidate) { return candidate.id === type; });
      if (!tab) return;
      if (search) {
        const params = new URLSearchParams(search); params.delete('embed'); params.delete('workspace');
        const next = params.toString();
        if (next !== tab.workspaceSearch) {
          tab.workspaceSearch = next;
          const panel = document.getElementById(tab.panelId);
          const frame = panel && panel.querySelector('iframe');
          // Ordinary tab switching retains drafts. An explicit schedule target changes that view.
          if (frame && params.has('schedule')) frame.src = architectOperationalWorkspaces[type].path + '?' + next + '&embed=architect';
        }
      }
      setArchitectCenterTab(type);
    }
    window.addEventListener('message', function(event) {
      if (event.origin !== window.location.origin || !event.data || event.data.type !== 'dreamgraph:open-workspace') return;
      const owned = Array.from(architectCenterPanelContainer.querySelectorAll('.architect-operational-workspace iframe')).some(function(frame) { return frame.contentWindow === event.source; });
      if (owned) openArchitectOperationalWorkspace(event.data.workspace, event.data.search);
    });
    document.addEventListener('click', function(event) {
      const link = event.target.closest && event.target.closest('a[href]');
      if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || link.target === '_blank') return;
      const url = new URL(link.href, window.location.href);
      const type = url.pathname.slice(1);
      if (url.origin === window.location.origin && architectOperationalWorkspaces[type]) { event.preventDefault(); openArchitectOperationalWorkspace(type, url.search); }
    });
`;

export const ARCHITECT_OPERATIONAL_WORKSPACES_CSS = `
.architect-center-tab-strip { min-width:0; }
.architect-center-tabs { min-width:0; flex:1; overflow-x:auto; }
.architect-open-explorer { flex:none; color:#9ac7ed; font-size:11px; white-space:nowrap; text-decoration:none; }
.architect-open-explorer:hover { color:#b8dcff; text-decoration:underline; }
.architect-open-explorer:focus-visible { outline:1px solid #cdb172; outline-offset:3px; }
.architect-tab-panel.architect-operational-workspace { padding:0; min-width:0; min-height:0; width:100%; height:100%; overflow:hidden; }
.architect-operational-workspace iframe { display:block; width:100%; height:100%; min-height:0; border:0; background:#121212; }
`;
