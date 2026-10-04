# Graph Snapshot

> This node is the Explorer-side graph snapshot payload fetched from `/explorer/api/graph-snapshot`, representing the versioned graph state the client consumes before rendering or further node/neighborhood queries. The source shows that snapshot retrieval is not a raw data read: `fetchSnapshot()` validates `body.version` against `EXPECTED_SNAPSHOT_VERSION` and throws `SnapshotVersionError` when the daemon snapshot is newer than the SPA, making compatibility part of the model's operational meaning. In the surrounding graph it is the primary data contract used by `explorer_api`, supports visualization-oriented consumers such as `explorer_ui` and `visual_architect`, and sits in a broader graph-data flow with monitoring and persistence concerns reflected by `graph_watcher` and `graph_data_orchestrator`. Because the supplied excerpt only exposes the client fetch contract, the internal full field shape beyond versioned snapshot transport remains bounded by that evidence.

**Table:** `graph_snapshot`  
**Storage:** json  

## Fields

| Field | Type | Description |
|-------|------|-------------|
| version | number | Version number of the snapshot. |
| nodes | array | List of nodes in the graph snapshot. |

