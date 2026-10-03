import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {newerSnapshot,resolveViewIdentity} from "./view-contract";
import { version as explorerVersion } from "../package.json";
import {
  DEFAULT_EXPLORER_PREFS,
  fetchExplorerPrefs,
  fetchSnapshot,
  fetchStats,
  patchExplorerPrefs,
  SnapshotVersionError,
  type ExplorerPrefs,
  type ExplorerRenderMode,
} from "./api";
import { GraphCanvas } from "./GraphCanvas";

// 3D canvas is split into its own chunk so the Three.js + OrbitControls
// payload is only paid by users who actually flip the toggle.
const Graph3DCanvas = lazy(() => import("./Graph3DCanvas"));
import { SearchBar } from "./SearchBar";
import { FiltersPanel } from "./FiltersPanel";
import { Inspector } from "./Inspector";
import { TensionsPanel } from "./TensionsPanel";
import { CandidatesPanel } from "./CandidatesPanel";
import { defaultFilters, type ExplorerMode, type FilterState } from "./filters";
import { EDGE_STYLES, NODE_COLORS } from "./theme";
import type { ExplorerEdgeKind, ExplorerNodeType, GraphSnapshot, StatsResult } from "./types";
import { useEventStream } from "./sse";
import { EventDock } from "./EventDock";

type RightTab = "inspector" | "tensions" | "candidates";

const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 640;
const COLLAPSED_W = 24;
const LEFT_DEFAULT = 240;
const RIGHT_DEFAULT = 360;

function readNum(key: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : fallback;
}
function readBool(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  if (raw === null) return fallback;
  return raw === "1";
}

export function App() {
  const [snapshot, setSnapshot] = useState<GraphSnapshot | null>(null);
  const snapshotCurrent=useRef(snapshot);snapshotCurrent.current=snapshot;
  const [stats, setStats] = useState<StatsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [versionError, setVersionError] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(() => defaultFilters());
  const [mode, setMode] = useState<ExplorerMode>("atlas");
  const [rightTab, setRightTab] = useState<RightTab>("inspector");
  const [conflictBanner, setConflictBanner] = useState(false);
  const [prefs, setPrefs] = useState<ExplorerPrefs>(DEFAULT_EXPLORER_PREFS);
  const [render3dError, setRender3dError] = useState<string | null>(null);
  const { events: liveEvents, pulses, connected: sseConnected } = useEventStream();
  const refreshBusy=useRef(false);
  const refreshQueued=useRef(false);

  // Hydrate the renderer mode from the daemon on mount. Defaults stand
  // until the prefs file roundtrips so first paint is never blocked.
  useEffect(() => {
    let cancelled = false;
    void fetchExplorerPrefs().then((p) => {
      if (!cancelled) setPrefs(p);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setRenderMode = (next: ExplorerRenderMode) => {
    if (next === prefs.renderMode) return;
    setRender3dError(null);
    setPrefs((p) => ({ ...p, renderMode: next }));
    void patchExplorerPrefs({ renderMode: next });
  };

  const [leftWidth, setLeftWidth] = useState<number>(() => readNum("dg.explorer.leftWidth", LEFT_DEFAULT));
  const [rightWidth, setRightWidth] = useState<number>(() => readNum("dg.explorer.rightWidth", RIGHT_DEFAULT));
  const [leftCollapsed, setLeftCollapsed] = useState<boolean>(() => readBool("dg.explorer.leftCollapsed", false));
  const [rightCollapsed, setRightCollapsed] = useState<boolean>(() => readBool("dg.explorer.rightCollapsed", false));
  const [dragging, setDragging] = useState<"left" | "right" | null>(null);
  const dragStartRef = useRef<{ x: number; startWidth: number } | null>(null);

  useEffect(() => { window.localStorage.setItem("dg.explorer.leftWidth", String(leftWidth)); }, [leftWidth]);
  useEffect(() => { window.localStorage.setItem("dg.explorer.rightWidth", String(rightWidth)); }, [rightWidth]);
  useEffect(() => { window.localStorage.setItem("dg.explorer.leftCollapsed", leftCollapsed ? "1" : "0"); }, [leftCollapsed]);
  useEffect(() => { window.localStorage.setItem("dg.explorer.rightCollapsed", rightCollapsed ? "1" : "0"); }, [rightCollapsed]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const start = dragStartRef.current;
      if (!start) return;
      const dx = e.clientX - start.x;
      // Right rail grows when dragged left (negative dx), left rail grows when dragged right.
      const next = dragging === "left"
        ? start.startWidth + dx
        : start.startWidth - dx;
      const clamped = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, next));
      if (dragging === "left") setLeftWidth(clamped);
      else setRightWidth(clamped);
    };
    const onUp = () => {
      dragStartRef.current = null;
      setDragging(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);

  const beginDrag = (side: "left" | "right") => (e: React.MouseEvent) => {
    e.preventDefault();
    dragStartRef.current = { x: e.clientX, startWidth: side === "left" ? leftWidth : rightWidth };
    setDragging(side);
  };

  const refreshSnapshot = useCallback(() => {
    if(refreshBusy.current){refreshQueued.current=true;return;}
    refreshBusy.current=true;
    const t0 = performance.now();
    fetchSnapshot()
      .then(async(s) => {
        setSnapshot(previous=>newerSnapshot(previous,s));
        setError(null);setVersionError(false);
        try{setStats(await fetchStats(s.etag));}catch(err){setStats(null);setError(`Overview unavailable for this revision: ${err instanceof Error?err.message:String(err)}`);}
        const ms = Math.round(performance.now() - t0);
        void fetch("/explorer/api/metrics/client", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ "snapshot.fetch_ms": ms }),
        }).catch(() => undefined);
      })
      .catch((err: unknown) => {
        if (err instanceof SnapshotVersionError) setVersionError(true);
        else setError(err instanceof Error ? err.message : String(err));
      }).finally(()=>{refreshBusy.current=false;if(refreshQueued.current){refreshQueued.current=false;refreshSnapshot();}});
  },[]);

  useEffect(() => {
    refreshSnapshot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ordinary store activity stays behind the manual refresh boundary. Autonomous
  // dreaming and explicit snapshot publication remain live update signals.
  const changeEvent=liveEvents.find(event=>["snapshot.changed","dream.cycle.completed"].includes(event.kind));
  const changeSeq=changeEvent?.kind==='snapshot.changed'&&changeEvent.etag===snapshot?.etag?undefined:changeEvent?.seq;
  useEffect(()=>{if(changeSeq===undefined)return;const timer=window.setTimeout(refreshSnapshot,750);return()=>window.clearTimeout(timer);},[changeSeq,refreshSnapshot]);
  useEffect(()=>{if(sseConnected)refreshSnapshot();},[sseConnected,refreshSnapshot]);
  const navigate=useCallback((id:string|null)=>{if(!id){setSelected(null);return;}const current=snapshotCurrent.current;if(!current)return;
    try{const target=resolveViewIdentity(current,id);if(!target){setError("This entity is outside the current render scope. Use its canonical context API or refresh.");return;}setSelected(target);}
    catch(err){setError(err instanceof Error?err.message:String(err));}},[]);

  const selectedNode = useMemo(() => {
    if (!snapshot || !selected) return null;
    return snapshot.nodes.find((n) => n.id === selected) ?? null;
  }, [snapshot, selected]);
  const eventIdentities=useMemo(()=>{const aliases=new Map<string,string[]>();for(const node of snapshot?.nodes??[]){for(const alias of [node.id,node.identity?.id].filter((id):id is string=>!!id)){const matches=aliases.get(alias)??[];if(!matches.includes(node.id))matches.push(node.id);aliases.set(alias,matches);}}return aliases;},[snapshot]);
  const mappedPulses=useMemo(()=>pulses.flatMap(pulse=>{const matches=eventIdentities.get(pulse.id);return matches?.length===1?[{...pulse,id:matches[0]}]:[];}),[pulses,eventIdentities]);
  const mappedEvents=useMemo(()=>liveEvents.map(event=>({...event,affected_ids:event.affected_ids.flatMap(id=>{const matches=eventIdentities.get(id);return matches?.length===1?matches:[];})})),[liveEvents,eventIdentities]);

  const nodeColors = NODE_COLORS as Record<ExplorerNodeType, string>;
  const edgeColors = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(EDGE_STYLES)) out[k] = v.color;
    return out as Record<ExplorerEdgeKind, string>;
  }, []);

  return (
    <div
      className="app"
      style={{
        gridTemplateColumns: `${leftCollapsed ? COLLAPSED_W : leftWidth}px 6px 1fr 6px ${rightCollapsed ? COLLAPSED_W : rightWidth}px`,
      }}
    >
      <div className="topbar" style={{ gridColumn: "1 / 6" }}>
        <a className="brand" href="/" title="DreamGraph landing page"><span className="brand-mark" aria-hidden="true">◈</span><span>DreamGraph<small>EXPLORER</small></span></a>
        <span className="meta version">v{explorerVersion}</span>
        <SearchBar onPick={navigate} />
        <div className="mode-toggle">
          <button
            className={`mode-btn${mode === "atlas" ? " active" : ""}`}
            onClick={() => setMode("atlas")}
            title="Show the entire graph"
            aria-pressed={mode === "atlas"}
          >
            Atlas
          </button>
          <button
            className={`mode-btn${mode === "focus" ? " active" : ""}`}
            onClick={() => setMode("focus")}
            disabled={!selected}
            title={selected ? "Show only the selected node and its 2-hop neighborhood" : "Select a node first"}
            aria-pressed={mode === "focus"}
          >
            Focus
          </button>
        </div>
        <div className="mode-toggle" role="group" aria-label="Renderer">
          <button
            className={`mode-btn${prefs.renderMode === "2d" ? " active" : ""}`}
            onClick={() => setRenderMode("2d")}
            title="Explore on a two-dimensional map"
            aria-pressed={prefs.renderMode === "2d"}
          >
            2D
          </button>
          <button
            className={`mode-btn${prefs.renderMode === "3d" ? " active" : ""}`}
            onClick={() => setRenderMode("3d")}
            title="Explore the spatial glass atlas"
            aria-pressed={prefs.renderMode === "3d"}
          >
            3D
          </button>
        </div>
        {snapshot ? (
          <span className="meta">
            instance <strong>{snapshot.instance_uuid.slice(0, 8)}</strong>
          </span>
        ) : null}
        {snapshot?.state?<details className="snapshot-state"><summary>Graph {snapshot.canonical_state?.freshness??snapshot.state.freshness} · {snapshot.canonical_state?.completeness??snapshot.state.completeness} · r{snapshot.revision?.publication_sequence}</summary>
          <p>Rendered view: {snapshot.state.completeness}. View exclusions do not change canonical graph completeness.</p>
          <p>Graph updated: {snapshot.currency?.last_graph_mutation_at??"unknown"}</p><p>Last inclusive scan: {snapshot.currency?.last_full_scan_at??"unknown"} (history only)</p>
          <p>Source reconciled: {snapshot.currency?.last_source_reconciliation_at??"unknown"}</p>
          {snapshot.state.reasons.map((reason,i)=><p key={i}><strong>{reason.code}</strong>: {reason.detail}</p>)}
          <p>Render {snapshot.nodes.length}/{snapshot.scope?.eligible_nodes??"?"} nodes · {snapshot.scope?.omitted_edges??0} relationships outside the render · {snapshot.scope?.excluded_families.join(", ")||"no excluded families"}</p>
        </details>:null}
        {snapshot ? (
          <span className="meta connection-state" title={`Snapshot ${snapshot.etag}`}>
            <i className={sseConnected ? "connected" : ""} />{sseConnected ? "Live" : "Reconnecting"}
          </span>
        ) : null}
      </div>

      {leftCollapsed ? (
        <button
          className="sidebar-reopen"
          onClick={() => setLeftCollapsed(false)}
          title="Expand filters panel"
          aria-label="Expand filters panel"
        >
          Filters
        </button>
      ) : (
        <aside className="left">
          <button
            className="sidebar-collapse left"
            onClick={() => setLeftCollapsed(true)}
            title="Collapse filters panel"
            aria-label="Collapse filters panel"
          >
            &lt;
          </button>
          <FiltersPanel
            filters={filters}
            onChange={setFilters}
            nodeColors={nodeColors}
            edgeColors={edgeColors}
          />
          {versionError ? (
            <div className="error-banner">
              Daemon snapshot version is newer than this Explorer build — please
              update the SPA assets.
            </div>
          ) : null}
          {error ? <div className="error-banner">{error}</div> : null}
        </aside>
      )}

      <div
        className={`resizer${dragging === "left" ? " dragging" : ""}`}
        onMouseDown={beginDrag("left")}
        role="separator"
        aria-orientation="vertical"
        tabIndex={0}
        aria-label="Resize filters"
        aria-valuemin={SIDEBAR_MIN} aria-valuemax={SIDEBAR_MAX} aria-valuenow={leftWidth}
        onKeyDown={event=>{if(event.key==="ArrowLeft"||event.key==="ArrowRight"){event.preventDefault();setLeftWidth(width=>Math.max(SIDEBAR_MIN,Math.min(SIDEBAR_MAX,width+(event.key==="ArrowRight"?10:-10))));}}}
      />

      <div className="canvas-host">
        {snapshot ? (
          prefs.renderMode === "3d" && !render3dError ? (
            <Suspense
              fallback={
                <div className="canvas-wrap">
                  <div className="status">loading 3D renderer…</div>
                </div>
              }
            >
              <Graph3DCanvas
                prefs={prefs}
                mode={mode}
                snapshot={snapshot}
                selected={selected}
                onSelect={navigate}
                liveEvents={mappedEvents}
                filters={filters}
                onFatal={(msg) => {
                  setRender3dError(msg);
                  setRenderMode("2d");
                }}
              />
            </Suspense>
          ) : (
            <GraphCanvas
              snapshot={snapshot}
              onSelect={navigate}
              filters={filters}
              mode={mode}
              selected={selected}
              pulses={mappedPulses}
            />
          )
        ) : (
          <div className="canvas-wrap">
            <div className="status">
              {error || versionError ? "snapshot unavailable" : "loading snapshot…"}
            </div>
          </div>
        )}
        {/*
         * Snapshot refresh overlay. Mirrors the 3D camera button in
         * Graph3DCanvas (top-right, translucent monochrome glyph, hover
         * fade-up). VS Code webviews cannot be hard-refreshed by the
         * user, so this gives an explicit re-fetch path. Offset to the
         * left of the camera glyph so both can coexist in 3D mode.
         */}
        <button
          type="button"
          className="overlay-refresh"
          onClick={refreshSnapshot}
          title="Refresh snapshot"
          aria-label="Refresh snapshot"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21 12a9 9 0 1 1-3.5-7.1" />
            <polyline points="21 4 21 10 15 10" />
          </svg>
        </button>
      </div>

      <div
        className={`resizer${dragging === "right" ? " dragging" : ""}`}
        onMouseDown={beginDrag("right")}
        role="separator"
        aria-orientation="vertical"
        tabIndex={0}
        aria-label="Resize inspector"
        aria-valuemin={SIDEBAR_MIN} aria-valuemax={SIDEBAR_MAX} aria-valuenow={rightWidth}
        onKeyDown={event=>{if(event.key==="ArrowLeft"||event.key==="ArrowRight"){event.preventDefault();setRightWidth(width=>Math.max(SIDEBAR_MIN,Math.min(SIDEBAR_MAX,width+(event.key==="ArrowLeft"?10:-10))));}}}
      />

      {rightCollapsed ? (
        <button
          className="sidebar-reopen right"
          onClick={() => setRightCollapsed(false)}
          title="Expand inspector panel"
          aria-label="Expand inspector panel"
        >
          Inspector
        </button>
      ) : (
        <aside className="right">
          <button
            className="sidebar-collapse right"
            onClick={() => setRightCollapsed(true)}
            title="Collapse inspector panel"
            aria-label="Collapse inspector panel"
          >
            &gt;
          </button>
          <div className="right-tabs">
          <button
            className={`right-tab${rightTab === "inspector" ? " active" : ""}`}
            onClick={() => setRightTab("inspector")}
          >
            Inspector
          </button>
          <button
            className={`right-tab${rightTab === "tensions" ? " active" : ""}`}
            onClick={() => setRightTab("tensions")}
          >
            Tensions
            {stats && stats.totals.tensions_active > 0 ? (
              <span className="right-tab-badge">{stats.totals.tensions_active}</span>
            ) : null}
          </button>
          <button
            className={`right-tab${rightTab === "candidates" ? " active" : ""}`}
            onClick={() => setRightTab("candidates")}
          >
            Candidates
          </button>
        </div>
        {conflictBanner ? (
          <div className="conflict-banner">
            Graph moved on. Snapshot refreshed — please retry.
          </div>
        ) : null}
        {rightTab === "inspector" ? (
          <Inspector
            onRefresh={refreshSnapshot}
            selected={selectedNode}
            stats={stats}
            etag={snapshot?.etag}
            onNavigate={navigate}
          />
        ) : rightTab === "tensions" && snapshot ? (
          <TensionsPanel
            instanceUuid={snapshot.instance_uuid}
            etag={snapshot.etag}
            onConflict={() => {
              setConflictBanner(true);
              refreshSnapshot();
              setTimeout(() => setConflictBanner(false), 4000);
            }}
            onApplied={() => {
              refreshSnapshot();
            }}
            onInspect={(id) => {
              navigate(id);
              setRightTab("inspector");
            }}
          />
        ) : rightTab === "candidates" && snapshot ? (
          <CandidatesPanel
            instanceUuid={snapshot.instance_uuid}
            etag={snapshot.etag}
            onConflict={() => {
              setConflictBanner(true);
              refreshSnapshot();
              setTimeout(() => setConflictBanner(false), 4000);
            }}
            onApplied={() => {
              refreshSnapshot();
            }}
            onInspect={(id) => {
              navigate(id);
              setRightTab("inspector");
            }}
          />
        ) : (
          <div className="panel-empty">Loading…</div>
        )}
        </aside>
      )}
      <EventDock events={liveEvents} connected={sseConnected} />
    </div>
  );
}
