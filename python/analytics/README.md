# DreamGraph Analytics v14.0.0

Ashoka's canonical mode requires one immutable core export. From the repository root, run `npm run analytics:export -- --data-dir <instance-data> --output <snapshot.json>`, then from `python/` run `python -m analytics tension_flow --snapshot <snapshot.json> --json`. The daemon also exposes `GET /api/analytics/v1/snapshot` through its authenticated read boundary. All thirteen modules use definition2, exact export hashes, typed identities, one revision, common current trust and explicit unknown denominators. Each report separates its canonical `measurement` from retained heuristic diagnostics. Nested reports reuse the same snapshot. Compare the captured revision with the daemon before treating an export as current; scan age is not currency.

Existing raw-file commands below now require explicit `--legacy` when there is no `analytics-snapshot.json` in the selected data directory. This compatibility mode cannot establish a coherent canonical revision, current proof or freshness. Malformed JSON fails. See [metric definitions](../../docs/contracts/metric-definitions.v2.json) and [scope/limitations](../../docs/ashoka/analytics-observability.md).

Read-only Python scripts that analyze the JSON state of a DreamGraph instance. Pure stdlib (no `pip install` needed).

The suite reads its version from the root `package.json`, matching the daemon, MCP authority, CLI, Architect, Explorer, and Dashboard. From the `python/` directory, run `python -m analytics --version` or `python -m analytics model_impact --version` to check it. Keep the root package metadata with the suite when copying an installation.

## Usage

Every script accepts `--instance` (name or UUID) and resolves it through the master registry at `~/.dreamgraph/instances.json`:

```powershell
# By name
python -m analytics tension_flow --instance dreamgraph

# By UUID
python -m analytics tension_flow --instance ee9ce3b9-0313-4768-b5f1-24b9b3fffc4b

# Override registry root
python -m analytics maturity_score --instance dreamgraph --master-dir D:\dgroot

# Point directly at a data directory (escape hatch)
python -m analytics maturity_score --data-dir "C:\Users\Me\.dreamgraph\<uuid>\data"

# JSON output for piping into jq, charts, dashboards, etc.
python -m analytics tension_flow --instance dreamgraph --json

# List all known instances
python -m analytics list
```

You can also run any analyzer as a standalone script:

```powershell
python python/analytics/tension_flow.py --instance dreamgraph
```

## Analyzers

| Module | What it answers |
|---|---|
| `tension_flow` | Per-cycle active / resolved / new / net tensions over time |
| `tension_halflife` | Average lifetime of resolved tensions; tells you whether sleep is working |
| `reappearance_rate` | Tensions on the same `(entity_a, entity_b)` pair that come back after resolution |
| `domain_saturation` | Promotions / candidates / tensions grouped by domain |
| `hub_health` | High-degree but low-health hubs — important but fuzzy abstractions |
| `confidence_integrity` | status × confidence cross-tab; verifies the v8.2.6 inflation fix is holding |
| `promotion_funnel` | candidate → latent → validated → promoted (and rejected → decayed) by strategy |
| `orphan_pressure` | Degree-0 nodes, source-only / sink-only nodes, dangling edges |
| `model_impact` | Promotions / tensions / resolutions attributable to LLM-driven cycles |
| `maturity_score` | Single aggregate health number combining the metrics above |
| `meaningful_edges` | Promoted edges vs edges rejected for "weak meaning" — signal/noise of dreaming |
| `domain_entropy` | Shannon entropy of attention across domains: dominated / structured / flat |
| `cognitive_load` | Composite "how confused is the system right now" index from tensions, fuzzy hubs, and candidate backlog |

## Output

All analyzers print a human-readable summary by default and a structured JSON document with `--json`. JSON is the format intended for piping into the Explorer, dashboards, or notebooks.
