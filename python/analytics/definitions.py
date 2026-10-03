"""Independent calculations over the versioned core snapshot; definitions are generated."""
from __future__ import annotations
from collections import Counter
from datetime import datetime
from functools import wraps
import json
import math
from pathlib import Path
from statistics import median
from . import loader

DEFINITIONS = json.loads(Path(__file__).with_name("metric-definitions.json").read_text(encoding="utf-8"))

def _time(value):
    if not isinstance(value, str): return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.timestamp() if parsed.tzinfo is not None else None
    except (ValueError, OverflowError): return None

def _count(value): return value if type(value) is int and value >= 0 else 0
def _ratio(n, d): return round(n / d, 6) if d else None

def measure(module: str, p: dict) -> dict:
    entities, relationships = p["entities"], p["relationships"]
    facts = [e for e in entities if e["identity"]["kind"] in loader.FACT_KINDS]
    candidates = [e for e in entities if e["identity"]["kind"] == "candidate" and e["payload"].get("dream_type")]
    validated = [e for e in entities if e["identity"]["kind"] == "validated"]
    active = [e for e in entities if e["identity"]["kind"] == "tension" and e["assertion_class"] == "tension" and not e["payload"].get("resolved")]
    supported = sum(e["assertion_class"] == "validated_insight" for e in candidates)
    domains = Counter(e["payload"]["domain"] for e in facts if isinstance(e["payload"].get("domain"), str) and e["payload"]["domain"].strip())
    known = sum(domains.values()); unknown_domains = len(facts) - known
    keys = {loader.identity_key(e["identity"]) for e in facts}; connected = set(); dangling = 0
    for r in relationships:
        if r["kind"] != "fact": continue
        if not r.get("source") or not r.get("target"): dangling += 1; continue
        a, b = loader.identity_key(r["source"]), loader.identity_key(r["target"])
        if a in keys and b in keys: connected.update((a, b))
    def total(field): return sum(_count(row.get(field)) for row in p["history"])
    if module == "tension_flow":
        return dict(sessions=len(p["history"]), created=total("tension_signals_created"), closed=total("tension_signals_resolved"), expired=total("tensions_expired"), decayed=total("tensions_decayed"), net_change=total("tension_signals_created")-total("tension_signals_resolved")-total("tensions_expired"), active_now=len(active), initial_active=None)
    if module == "tension_halflife":
        lifetimes=[]; unknown=0; dispositions=Counter()
        for row in p["resolved_tensions"]:
            a, b = _time((row.get("original") or {}).get("first_seen")), _time(row.get("resolved_at"))
            dispositions[row.get("resolution_state") or "unknown"] += 1
            if a is None or b is None or b < a: unknown += 1
            else: lifetimes.append(b-a)
        return dict(closures=len(p["resolved_tensions"]), known_lifetimes=len(lifetimes), unknown_lifetimes=unknown, median_seconds=median(lifetimes) if lifetimes else None, dispositions=dict(dispositions))
    if module == "reappearance_rate":
        known_rows=[r for r in p["resolved_tensions"] if isinstance(r.get("tension_id"),str) and r["tension_id"]]
        reopened=sum(_time(r.get("reopened_at")) is not None for r in known_rows)
        return dict(closure_events=len(known_rows), unknown_identity=len(p["resolved_tensions"])-len(known_rows), reopened_events=reopened, reappearance_ratio=_ratio(reopened,len(known_rows)))
    if module == "domain_saturation": return dict(facts=len(facts),known_domains=known,unknown_domains=unknown_domains,by_domain=dict(domains),by_kind={k:sum(e["identity"]["kind"]==k for e in facts) for k in loader.FACT_KINDS})
    if module == "hub_health":
        described=sum(loader.identity_key(e["identity"]) in connected and isinstance(e["payload"].get("description"),str) and len(e["payload"]["description"].strip())>=60 for e in facts)
        return dict(facts=len(facts),connected=len(connected),substantively_described=described,description_coverage=_ratio(described,len(connected)))
    if module == "confidence_integrity": return dict(entities=len(entities),known_confidence=sum(e["confidence"] is not None for e in entities),unknown_confidence=sum(e["confidence"] is None for e in entities),assertion_classes=dict(Counter(e["assertion_class"] for e in entities)))
    if module == "promotion_funnel": return dict(latest_candidates=len(candidates),current_supported=supported,retained_promotions=len(validated),current_supported_promotions=sum(e["assertion_class"]=="validated_insight" for e in validated),human_assertions=sum(e["assertion_class"]=="human_assertion" for e in validated),support_ratio=_ratio(supported,len(candidates)))
    if module == "orphan_pressure": return dict(facts=len(facts),connected=len(connected),isolated=len(facts)-len(connected),unresolved_endpoints=dangling,orphan_ratio=_ratio(len(facts)-len(connected),len(facts)))
    if module == "model_impact":
        artifacts=[e["payload"] for e in entities if e["identity"]["kind"]=="dream_node"]+p["dream_edges"]; models=Counter(); unknown=0
        for row in artifacts:
            provenance=row.get("model_provenance") or (row.get("meta") or {}).get("model_provenance")
            model=(provenance.get("reported_model") or provenance.get("requested_model")) if isinstance(provenance,dict) else None
            if not isinstance(provenance,dict) or not isinstance(model,str) or not isinstance(provenance.get("provider"),str): unknown+=1;continue
            models[json.dumps([provenance["provider"],model,provenance.get("adapter")],separators=(",",":"),ensure_ascii=False)]+=1
        return dict(artifacts=len(artifacts),known_provenance=len(artifacts)-unknown,unknown_provenance=unknown,by_model=dict(models),task_usefulness=None)
    if module == "maturity_score": return dict(availability=p["state"]["availability"],completeness=p["state"]["completeness"],freshness=p["state"]["freshness"],defect_count=len(p["state"]["reasons"]),latest_candidates=len(candidates),current_supported=supported,evidence_coverage=_ratio(supported,len(candidates)),project_maturity=None)
    if module == "meaningful_edges":
        accepted=sum(e["payload"].get("status")=="validated" for e in candidates); rejected=sum(e["payload"].get("status")=="rejected" for e in candidates)
        return dict(accepted_decisions=accepted,rejected_decisions=rejected,decided=accepted+rejected,accepted_decision_ratio=_ratio(accepted,accepted+rejected),current_supported=supported,task_meaningfulness=None)
    if module == "domain_entropy":
        h=sum(-(n/known)*math.log2(n/known) for n in domains.values()) if known else None
        if h == 0: h = 0
        return dict(known_entities=known,unknown_domains=unknown_domains,distinct_domains=len(domains),entropy_bits=round(h,6) if h is not None else None,normalized_entropy=None if h is None else 0 if len(domains)<=1 else round(h/math.log2(len(domains)),6),population_state="empty" if not facts else "unknown" if not known else "concentrated" if len(domains)==1 else "distributed")
    if module == "cognitive_load": return dict(open_risks=len(active),unproven_candidates=len(candidates)-supported,dirty_regions=sum(r["state"]!="settled" for r in p["dirty_regions"]),required_reconciliation_regions=sum("reconciliation" in r.get("pending_stages",[]) for r in p["dirty_regions"]),agent_understanding=None)
    raise ValueError("ANALYTICS_MODULE_UNKNOWN")

def qualified(module: str):
    def decorate(fn):
        @wraps(fn)
        def run(data_dir, *args, **kwargs):
            with loader.pinned(Path(data_dir)) as p:
                result=fn(data_dir,*args,**kwargs)
                result["definition"]={"version":"2.0.0","module":module,**DEFINITIONS[module]}
                result["interpretation"]="heuristic_diagnostics; canonical measurement is separate; no task-usefulness claim"
                result["snapshot"]={k:p[k] for k in ("instance_id","revision","currency","state","generated_at","dependency_hashes")} if p else {"state":{"availability":"available","completeness":"unknown","freshness":"unknown"},"mode":"explicit_legacy_unverified","revision":None,"currency":None}
                result["measurement"]=measure(module,p) if p else None
                return result
        return run
    return decorate
