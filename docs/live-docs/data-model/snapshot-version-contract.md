# Snapshot Version Contract

> This node is the compatibility contract governing whether an Explorer client may accept a daemon-provided graph snapshot, centered on the snapshot `version` field and the client's `EXPECTED_SNAPSHOT_VERSION`. The supplied source-backed neighborhood shows that `fetchSnapshot()` checks the returned `GraphSnapshot` version and throws `SnapshotVersionError` with an explicit 'Update the SPA' message when the daemon is newer, so version matching is a hard runtime boundary rather than a soft hint. In the broader architecture it belongs to the client-facing contract layer, constrains the `graph_snapshot_api` surface, and participates in the extension/UI boundary where clients must safely consume daemon-owned graph state. Because the direct source excerpt is attached to neighboring API nodes rather than this node itself, the record is grounded but moderately inferential.

**Table:** `N/A`  
**Storage:** N/A  

