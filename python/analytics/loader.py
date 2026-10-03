"""Lazy JSON loaders for a DreamGraph instance data directory."""
from __future__ import annotations

import json
import hashlib
import contextlib
import contextvars
from pathlib import Path
from typing import Any
from urllib.parse import quote


_snapshot = contextvars.ContextVar("analytics_snapshot", default=None)
_legacy = contextvars.ContextVar("analytics_legacy", default=False)
FACT_KINDS = ("feature", "workflow", "data_model", "capability", "datastore", "auxiliary", "ui_element")

def identity_key(identity: dict) -> str:
    parts=[identity["instance_id"],identity["kind"]]+([identity["repository_id"]] if identity.get("repository_id") else [])+[identity["id"]]
    return "/".join(quote(part,safe="-_.!~*'()") for part in parts)

def read_snapshot(path: Path) -> dict:
    doc=json.loads(path.read_text(encoding="utf-8-sig"))
    if doc.get("schema")!="dreamgraph.analytics_export.v1" or not isinstance(doc.get("payload_json"),str): raise ValueError("ANALYTICS_EXPORT_SCHEMA_UNSUPPORTED")
    body=doc["payload_json"]
    if len(body.encode("utf-8"))>32*1024*1024 or hashlib.sha256(body.encode("utf-8")).hexdigest()!=doc.get("payload_sha256"): raise ValueError("ANALYTICS_EXPORT_HASH_MISMATCH")
    p=json.loads(body)
    from .schema import validate
    validate(p,json.loads(Path(__file__).with_name("snapshot-schema.json").read_text(encoding="utf-8")))
    if p.get("schema")!="dreamgraph.analytics_payload.v1" or p.get("definition_version")!="2.0.0": raise ValueError("ANALYTICS_DEFINITION_UNSUPPORTED")
    for field in ("entities","relationships","history","dream_edges","resolved_tensions","dirty_regions"):
        if not isinstance(p.get(field),list) or any(not isinstance(row,dict) for row in p[field]): raise ValueError(f"ANALYTICS_INPUT_INVALID:{field}")
    for field in ("revision","currency","state","dependency_hashes"):
        if not isinstance(p.get(field),dict): raise ValueError(f"ANALYTICS_INPUT_INVALID:{field}")
    if not isinstance(p.get("instance_id"),str) or not p["instance_id"]: raise ValueError("ANALYTICS_INSTANCE_REQUIRED")
    return p

@contextlib.contextmanager
def pinned(data_dir: Path):
    existing=_snapshot.get()
    if existing is not None:
        if existing[0]!=str(data_dir.resolve()): raise ValueError("ANALYTICS_NESTED_INSTANCE_MISMATCH")
        yield existing[1];return
    path=data_dir if data_dir.is_file() else data_dir/"analytics-snapshot.json"
    if not path.exists():
        if not _legacy.get(): raise ValueError("ANALYTICS_SNAPSHOT_REQUIRED: export a core snapshot or explicitly use --legacy; raw files are not a coherent canonical read")
        yield None;return
    payload=read_snapshot(path);token=_snapshot.set((str(data_dir.resolve()),payload))
    try: yield payload
    finally: _snapshot.reset(token)

def current_snapshot():
    current=_snapshot.get();return current[1] if current else None

def allow_legacy(): _legacy.set(True)

def _facts(kind,p):
    out=[]
    for e in p["entities"]:
        if e["identity"]["kind"]!=kind: continue
        key=identity_key(e["identity"])
        links=[{"target":identity_key(r["target"]) if r.get("target") else r["target_ref"],"relationship":r["relation"]} for r in p["relationships"] if r["kind"]=="fact" and r.get("source") and identity_key(r["source"])==key]
        out.append({**e["payload"],"_legacy_id":e["identity"]["id"],"id":key,"name":e["label"],"links":links,"_assertion_class":e["assertion_class"]})
    return out

def _read(data_dir: Path, filename: str) -> Any:
    p=current_snapshot()
    if p is not None:
        families={"features.json":"feature","workflows.json":"workflow","data_model.json":"data_model","capabilities.json":"capability","datastores.json":"datastore"}
        if filename in families: return _facts(families[filename],p)
        if filename=="auxiliary_entities.json":return {"entries":_facts("auxiliary",p)}
        if filename=="ui_registry.json":return {"elements":_facts("ui_element",p)}
        if filename=="dream_history.json":return {"sessions":p["history"]}
        if filename=="tension_log.json":return {"signals":[e["payload"] for e in p["entities"] if e["identity"]["kind"]=="tension" and e["assertion_class"]=="tension" and not e["payload"].get("resolved")],"resolved_tensions":p["resolved_tensions"]}
        if filename=="dream_graph.json":return {"nodes":[e["payload"] for e in p["entities"] if e["identity"]["kind"]=="dream_node"],"edges":p["dream_edges"]}
        if filename in ("candidate_edges.json","validated_edges.json"):
            kind,field=("candidate","results") if filename.startswith("candidate") else ("validated","edges")
            return {field:[{**e["payload"],"_assertion_class":e["assertion_class"]} for e in p["entities"] if e["identity"]["kind"]==kind and (kind!="candidate" or e["payload"].get("dream_type"))]}
        if filename in ("meta_log.json","llm_bootstrap_log.json"):return None
        raise ValueError(f"ANALYTICS_UNDECLARED_STORE:{filename}")
    if not _legacy.get(): raise ValueError("ANALYTICS_UNPINNED_READ")
    p = data_dir / filename
    if not p.exists():
        return None
    with p.open("r", encoding="utf-8") as f:
        return json.load(f)


# --- Entity stores (arrays of {id, name, links, ...}) -----------------------

def features(data_dir: Path) -> list[dict]:
    return _read(data_dir, "features.json") or []


def workflows(data_dir: Path) -> list[dict]:
    return _read(data_dir, "workflows.json") or []


def data_model(data_dir: Path) -> list[dict]:
    return _read(data_dir, "data_model.json") or []


def capabilities(data_dir: Path) -> list[dict]:
    return _read(data_dir, "capabilities.json") or []


def all_fact_entities(data_dir: Path) -> list[dict]:
    """All seven canonical factual families, preserving typed identity."""
    p=current_snapshot()
    if p is not None:return [e for kind in FACT_KINDS for e in _facts(kind,p)]
    out: list[dict] = []
    for fn in (features, workflows, data_model, capabilities):
        out.extend(fn(data_dir))
    out.extend(_read(data_dir,"datastores.json") or [])
    for file,field in (("auxiliary_entities.json","entries"),("ui_registry.json","elements")):
        doc=_read(data_dir,file) or {};out.extend(doc.get(field) or [])
    return out


# --- Cognitive stores -------------------------------------------------------

def tension_log(data_dir: Path) -> dict:
    doc = _read(data_dir, "tension_log.json") or {}
    return {
        "signals": doc.get("signals") or [],
        "resolved_tensions": doc.get("resolved_tensions") or [],
    }


def dream_graph(data_dir: Path) -> dict:
    doc = _read(data_dir, "dream_graph.json") or {}
    return {
        "nodes": doc.get("nodes") or [],
        "edges": doc.get("edges") or [],
    }


def dream_history(data_dir: Path) -> list[dict]:
    doc = _read(data_dir, "dream_history.json") or {}
    return doc.get("sessions") or []


def candidate_edges(data_dir: Path) -> list[dict]:
    doc = _read(data_dir, "candidate_edges.json") or {}
    return doc.get("results") or []


def validated_edges(data_dir: Path) -> list[dict]:
    doc = _read(data_dir, "validated_edges.json") or {}
    return doc.get("edges") or []


def meta_log(data_dir: Path) -> list[dict]:
    doc = _read(data_dir, "meta_log.json") or {}
    return doc.get("entries") or []


def llm_bootstrap_log(data_dir: Path) -> list[dict]:
    doc = _read(data_dir, "llm_bootstrap_log.json")
    if isinstance(doc, list):
        return doc
    if isinstance(doc, dict):
        return doc.get("entries") or doc.get("events") or []
    return []
