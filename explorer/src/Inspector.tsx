import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { fetchNode, fetchAgentContext } from "./api";
import type { ExplorerEdge, ExplorerNode, NodeRecord, StatsResult } from "./types";

interface Props {
  selected: ExplorerNode | null;
  stats: StatsResult | null;
  onNavigate: (id: string) => void;
  etag?:string;
  onRefresh?:()=>void;
}

/**
 * Right-hand inspector. Shows snapshot stats when nothing is selected.
 * On selection, fetches the full NodeRecord (entity + outgoing/incoming
 * edges) and renders the type-specific entity payload + adjacency lists.
 */
export function Inspector({selected,stats,onNavigate,etag,onRefresh}:Props){
  const [loadedRecord, setRecord] = useState<NodeRecord | null>(null);
  const record=loadedRecord?.id===selected?.id?loadedRecord:null;
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [offset,setOffset]=useState(0);
  const [context,setContext]=useState<Awaited<ReturnType<typeof fetchAgentContext>>|null>(null);
  const contextGeneration=useRef(0);
  useEffect(()=>{contextGeneration.current++;setOffset(0);setContext(null);},[selected?.id,etag]);

  useEffect(() => {
    if (!selected) {
      setRecord(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setRecord(previous=>previous?.id===selected.id?previous:null);
    setLoading(true);
    setError(null);
    fetchNode(selected.id,etag,offset)
      .then((r) => {
        if (cancelled) return;
        setRecord(r);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected?.id,etag,offset]);

  if (!selected) {
    return (
      <div className="inspector">
        <div className="rail-heading">
          <span className="eyebrow">At a glance</span>
          <h2>Graph overview</h2>
          <p>Select a node to explore its story.</p>
        </div>
        {stats ? (
          <>
          <div className="graph-totals">
            <div><span>Nodes</span><strong>{stats.totals.nodes.toLocaleString()}</strong></div>
            <div><span>Connections</span><strong>{stats.totals.edges.toLocaleString()}</strong></div>
          </div>
          <div className="health-summary">
            <div><span>Topology coverage proxy</span><strong>{Math.round(stats.health_mean * 100)}%</strong></div>
            <progress value={stats.health_mean} max={1} aria-label="Topology coverage proxy, not correctness" />
          </div>
          <dl className="kv overview-details">
            <dt>Tensions (active)</dt><dd>{stats.totals.tensions_active}</dd>
            <dt>Tensions (resolved)</dt><dd>{stats.totals.tensions_resolved}</dd>
            <dt>Topology proxy</dt><dd>{stats.health_mean.toFixed(2)}</dd>
            <dt>Recorded confidence</dt><dd>{stats.confidence_mean===null?"Unknown":stats.confidence_mean.toFixed(2)} · not truth</dd>
          </dl>
          {stats.validation_pipeline ? (() => { const p = stats.validation_pipeline; return (
            <>
              <h3 className="inspector-subtitle">Validation pipeline</h3>
              <dl className="kv" title="Per dream, latest assessment: the same counts as the Status board and dg status">
                <dt>Assessed dreams</dt><dd>{p.assessed.toLocaleString()}</dd>
                <dt>Validated</dt><dd>{p.validated.toLocaleString()} <small>(edges {p.by_type.edge.validated.toLocaleString()} · nodes {p.by_type.node.validated.toLocaleString()})</small></dd>
                <dt>Rejected</dt><dd>{p.rejected.toLocaleString()}</dd>
                <dt>Latent</dt><dd>{p.latent.toLocaleString()}</dd>
                <dt>Validation rate</dt><dd>{p.validation_rate === null ? "n/a" : `${(p.validation_rate * 100).toFixed(1)}%`} <small>validated ÷ decided</small></dd>
                <dt>Promoted edge store</dt><dd>{(p.promoted_edges ?? 0).toLocaleString()}</dd>
              </dl>
            </>
          ); })() : null}
          </>
        ) : (
          <p className="inspector-empty">Loading stats…</p>
        )}
        {stats ? (
          <>
            <h3 className="inspector-subtitle">By type</h3>
            <dl className="kv">
              {Object.entries(stats.nodes_by_type).map(([k, v]) => (
                <Fragment key={k}>
                  <dt>{k.replaceAll("_", " ")}</dt>
                  <dd>{v}</dd>
                </Fragment>
              ))}
            </dl>
            <h3 className="inspector-subtitle" title="Connections drawn in this view, not pipeline counts">Rendered connections by kind</h3>
            <dl className="kv">
              {Object.entries(stats.edges_by_kind).map(([k, v]) => (
                <Fragment key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </Fragment>
              ))}
            </dl>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div className="inspector">
      <h2 className="inspector-title">{selected.label}</h2>
      <p className="inspector-id">{selected.identity?.kind??selected.type} · {selected.identity?.id??selected.id}</p>
      <p className={`trust-badge trust-${selected.assertion_class??"unknown"}`}>{(record?.canonical?.assertion_class??selected.assertion_class??"unknown").replaceAll("_"," ")}</p>
      <dl className="kv">
        <dt>Degree</dt><dd>{selected.degree}</dd>
        {selected.type !== "tension" ? (
          <>
            <dt>Topology proxy</dt><dd>{selected.health.toFixed(2)} · not correctness</dd>
          </>
        ) : null}
        {selected.type === "dream_node" ? (
          <>
            <dt>Confidence</dt><dd>{selected.confidence_known===false?"Unknown":selected.confidence.toFixed(2)}</dd>
          </>
        ) : null}
      </dl>
      {loading ? <p className="inspector-empty">{record?'Updating details…':'Loading…'}</p> : null}
      {record && record.etag!==etag ? <p className="inspector-empty">Showing revision {record.revision?.publication_sequence??'unknown'} while the displayed snapshot updates.</p> : null}
      {error ? <p className="inspector-error">{error}{onRefresh?<button type="button" onClick={onRefresh}>Refresh snapshot</button>:null}</p> : null}
      {record ? (
        <>
          <details className="evidence-details"><summary>Evidence and current applicability</summary>
            <p>Revision {record.revision?.publication_sequence??"unknown"} · {record.state?.freshness??"unknown"} · {record.state?.completeness??"unknown"}</p>
            <StructuredValue value={record.canonical?.evidence??[]} path={["evidence"]} onNavigate={onNavigate}/>
            <StructuredValue value={record.canonical?.payload.current_evidence_assessment??"No independent validation claim recorded"} path={["assessment"]} onNavigate={onNavigate}/>
          </details>
          <button type="button" disabled={loading} onClick={()=>{const generation=contextGeneration.current;setError(null);void fetchAgentContext(selected.id,record.etag).then(value=>{if(contextGeneration.current===generation)setContext(value);}).catch((e:Error)=>{if(contextGeneration.current===generation)setError(e.message);});}}>View agent context</button>
          {context?<details className="evidence-details" open><summary>Bounded agent context</summary><p>{context.state.freshness} · {context.state.completeness} · revision {context.revision.publication_sequence}</p>
            <p>{context.token_count} UTF-8 byte upper bound · {context.omissions.reduce((sum,o)=>sum+o.count,0)} omitted records</p>
            <pre className="agent-context">{context.context_text}</pre><button type="button" onClick={()=>{void navigator.clipboard.writeText(context.context_text).catch((e:Error)=>setError(e.message));}}>Copy context</button></details>:null}
          <EntityBlock record={record} onNavigate={onNavigate} />
          {record.relationships?.length?<details className="evidence-details"><summary>Connection claims and original evidence</summary><StructuredValue value={record.relationships} path={["relationships"]} onNavigate={onNavigate}/></details>:null}
          <EdgeList
            title="Outgoing"
            edges={record.outgoing}
            otherKey="t"
            onNavigate={onNavigate}
          />
          {record.adjacency && (record.adjacency.next_offset!==null||record.adjacency.offset>0)?<nav className="adjacency-pages" aria-label="Connection pages"><span>{record.adjacency.offset+1}–{record.adjacency.offset+Math.max(record.outgoing.length,record.incoming.length)} of {Math.max(record.adjacency.outgoing_total,record.adjacency.incoming_total)}</span>
            <button type="button" disabled={loading||!offset} onClick={()=>setOffset(Math.max(0,offset-50))}>Previous</button>
            <button type="button" disabled={loading||record.adjacency.next_offset===null} onClick={()=>setOffset(record.adjacency!.next_offset!)}>Next</button></nav>:null}
          <EdgeList
            title="Incoming"
            edges={record.incoming}
            otherKey="s"
            onNavigate={onNavigate}
          />
        </>
      ) : null}
    </div>
  );
}

export function EntityBlock({
  record,
  onNavigate,
}: {
  record: NodeRecord;
  onNavigate: (id: string) => void;
}) {
  const parsedEntity = parseStructuredJson(record.entity);
  if (!isRecord(parsedEntity)) {
    if (parsedEntity === null || parsedEntity === undefined) return null;
    return (
      <>
        <h3 className="inspector-subtitle">Entity</h3>
        <StructuredValue value={parsedEntity} path={["entity"]} onNavigate={onNavigate} />
      </>
    );
  }

  const preferred = [
    "category",
    "tags",
    "domain",
    "urgency",
    "status",
    "strategy",
    "reason",
    "description",
    "intent",
    "purpose",
    "data_contract",
    "interactions",
    "visual_semantics",
    "layout_semantics",
    "implementations",
    "used_by",
    "children",
    "flows",
    "links",
    "enrichment",
    "source_repo",
    "source_files",
    "key_fields",
    "steps",
    "entities",
    "relationships",
    "state",
    "error_states",
    "rendering_capabilities",
    "provenance",
    "meta",
  ];
  const excluded = new Set(["id", "name"]);
  const orderedKeys = [
    ...preferred,
    ...Object.keys(parsedEntity).filter((key) => !preferred.includes(key) && !excluded.has(key)),
  ];
  const rows = orderedKeys
    .map((key) => [key, parsedEntity[key]] as const)
    .filter(([, value]) => value !== undefined && value !== null);
  if (rows.length === 0) return null;
  return (
    <>
      <h3 className="inspector-subtitle">Entity</h3>
      <div className="entity-fields">
        {rows.map(([key, value]) => {
          const fullWidth = isStructuredValue(value) ||
            ["description", "description_raw", "intent", "reason"].includes(key);
          return (
            <section
              className={`entity-field${fullWidth ? " entity-field--full" : ""}`}
              key={key}
            >
              <h4 className="entity-field-label">{humanizeKey(key)}</h4>
              <div className="entity-field-value">
                <StructuredValue value={value} path={[key]} onNavigate={onNavigate} />
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Parse JSON containers supplied as strings without changing ordinary prose. */
export function parseStructuredJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!(trimmed.startsWith("{") && trimmed.endsWith("}")) &&
      !(trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    return value;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return isRecord(parsed) || Array.isArray(parsed) ? parsed : value;
  } catch {
    return value;
  }
}

function isStructuredValue(value: unknown): boolean {
  const parsed = parseStructuredJson(value);
  return isRecord(parsed) || Array.isArray(parsed);
}

function humanizeKey(key: string): string {
  const abbreviations = new Map([
    ["ui", "UI"], ["llm", "LLM"], ["api", "API"], ["id", "ID"],
    ["mcp", "MCP"], ["adr", "ADR"], ["url", "URL"],
  ]);
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((part) => abbreviations.get(part.toLowerCase()) ?? `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function summaryForRecord(value: Record<string, unknown>): string | null {
  for (const key of ["name", "target", "action", "platform", "region", "state", "id"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate;
    if (typeof candidate === "number") return String(candidate);
  }
  return null;
}

function isNavigablePath(path: string[]): boolean {
  const leaf = path[path.length - 1];
  const root = path[0];
  if (leaf === "target" || leaf === "source") return true;
  return path.length === 1 &&
    ["links", "used_by", "children", "flows", "entities", "relationships"].includes(root);
}

function ScalarValue({
  value,
  path,
  onNavigate,
}: {
  value: string | number | boolean;
  path: string[];
  onNavigate: (id: string) => void;
}) {
  if (typeof value === "boolean") {
    return <span className={`structured-boolean ${value ? "is-true" : "is-false"}`}>{value ? "Yes" : "No"}</span>;
  }
  if (typeof value === "number") return <span className="structured-number">{value}</span>;
  if (isNavigablePath(path)) {
    return (
      <button type="button" className="structured-entity-link" onClick={() => onNavigate(value)}>
        {value}
      </button>
    );
  }
  const leaf = path[path.length - 1];
  const codeLike = /(?:^|_)(?:id|repo|file|files|model|enricher|uri|kind)$/.test(leaf) ||
    /^(?:source_repo|source_file|source_files)$/.test(path[0]);
  return <span className={codeLike ? "structured-code" : "structured-text"}>{value}</span>;
}

export function StructuredValue({
  value,
  path,
  onNavigate,
  depth = 0,
}: {
  value: unknown;
  path: string[];
  onNavigate: (id: string) => void;
  depth?: number;
}): ReactNode {
  const parsed = parseStructuredJson(value);
  if(depth>8)return <span className="structured-empty">Nested details available in the canonical API response.</span>;

  if (parsed === null || parsed === undefined) return <span className="structured-empty">Not set</span>;
  if (typeof parsed === "string" || typeof parsed === "number" || typeof parsed === "boolean") {
    return <ScalarValue value={parsed} path={path} onNavigate={onNavigate} />;
  }

  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return <span className="structured-empty">None</span>;
    const scalarOnly = parsed.every((item) =>
      typeof item === "string" || typeof item === "number" || typeof item === "boolean",
    );
    if (scalarOnly) {
      return (
        <ul className="structured-chips">
          {parsed.slice(0,100).map((item, index) => (
            <li key={`${String(item)}-${index}`}>
              <ScalarValue value={item as string | number | boolean} path={path} onNavigate={onNavigate} />
            </li>
          ))}
          {parsed.length>100?<li>{parsed.length-100} further values in the API response</li>:null}
        </ul>
      );
    }
    return (
      <div className="structured-list">
        {parsed.slice(0,100).map((item, index) => {
          const itemRecord = isRecord(item) ? item : null;
          const summary = itemRecord ? summaryForRecord(itemRecord) : null;
          return (
            <article className="structured-card" key={`${summary ?? "item"}-${index}`}>
              {summary ? <div className="structured-card-title">{summary}</div> : null}
              <StructuredValue
                value={item}
                path={[...path, String(index)]}
                onNavigate={onNavigate}
                depth={depth + 1}
              />
            </article>
          );
        })}
        {parsed.length>100?<p>{parsed.length-100} further records in the API response</p>:null}
      </div>
    );
  }

  if (isRecord(parsed)) {
    const entries = Object.entries(parsed).filter(([, child]) => child !== undefined && child !== null);
    if (entries.length === 0) return <span className="structured-empty">No structured data</span>;
    return (
      <dl className={`structured-object structured-object--depth-${Math.min(depth, 2)}`}>
        {entries.map(([key, child]) => (
          <Fragment key={key}>
            <dt>{humanizeKey(key)}</dt>
            <dd>
              <StructuredValue
                value={child}
                path={[...path, key]}
                onNavigate={onNavigate}
                depth={depth + 1}
              />
            </dd>
          </Fragment>
        ))}
      </dl>
    );
  }

  return <span className="structured-text">{String(parsed)}</span>;
}

function EdgeList({
  title,
  edges,
  otherKey,
  onNavigate,
}: {
  title: string;
  edges: ExplorerEdge[];
  otherKey: "s" | "t";
  onNavigate: (id: string) => void;
}) {
  if (edges.length === 0) return null;
  return (
    <>
      <h3 className="inspector-subtitle">{title} ({edges.length})</h3>
      <ul className="edgelist">
        {edges.map((e, i) => {
          const id = e[otherKey];
          return (
            <li key={`${id}-${e.kind}-${i}`} className={`edgelist-item k-${e.kind}`}>
              <button className="edgelist-link" onClick={() => onNavigate(id)}>
                <span className={`edgelist-kind k-${e.kind}`}>{e.kind}</span>
                <span className="edgelist-target">{id}</span>
                <span className="edgelist-conf">{e.conf.toFixed(2)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
