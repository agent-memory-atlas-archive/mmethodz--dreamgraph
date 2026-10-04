# Audit Log

> `audit_log` is the Explorer mutation audit record: an append-only JSONL log at `<dataDir>/explorer_audit.jsonl` that stores one row for every mutation attempt, including successful writes, failures, and dry-run rehearsals. Each row carries mutation identity, timestamp, actor, intent, affected ids, justification, before/after hashes, etag, dry-run state, and outcome fields so graph changes can be reconstructed and reviewed for debugging and compliance. After a successful append, `appendAuditRow` emits `audit.appended` on `graphEventBus`, which allows `event_dock` to surface mutation activity in real time and reinforces the file comment's guarantee that there is no silent graph write. The module lives in the Explorer area (`dreamgraph_src_explorer`) and participates in the broader event and audit pipeline represented by `event_logging` and `audit_management_system`.

**Table:** `audit_log`  
**Storage:** json  

## Fields

| Field | Type | Description |
|-------|------|-------------|
| log_id | string | Unique identifier for the log entry. |
| timestamp | string | Timestamp of the log entry. |

