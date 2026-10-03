# Ashoka resource contract

The 31 core resource URIs share [one resolver](../../src/resources/resolver.ts). This includes all 30 audit-baseline URIs and `system://capability-entities`. MCP `resources/read` returns the first page; `query_resource` continues it with the same URI/filter and its opaque cursor. Plugin resources retain their host contract until the catalogue-adoption slice.

`system://capabilities` always describes the daemon runtime. Project capability entities use `system://capability-entities`. The previous query-tool interpretation of the runtime URI as a file of project entities is retired. The explicit `contract_version: legacy` adapter preserves bounded raw presentation, with the same URI meanings as MCP resource reads; oversized legacy results require v1 paging.

## Query and result

`query_resource` accepts `uri`, optional payload `filter`, `limit` (1–1000, default 50), `max_bytes` (1024–65536, default 8192), `cursor` and `contract_version` (`v1` by default). String filters are case-insensitive substring matches; arrays support membership; other values match exactly. Wrapper arrays and index dictionaries are explicit collections. Empty matches are successful empty results.

The generated `dreamgraph.resource_result.v1` contract includes typed whole records, URI, representation, graph/publication/domain revisions, independent currency, availability/completeness/freshness, scope, content revision, actual count, total, page start, omitted count and continuation. `count + omitted_count = total` for an available page. Remaining records after it are `total - page_start - count`. Unavailable totals/omissions are null, never a fabricated zero. Generic entries retain their collection/key/payload so pages can reconstruct a dataset without losing middle records. Canonical entries retain identity, assertion class, evidence and literal payload; relationship records preserve unresolved endpoints.

`max_bytes` bounds compact serialized page JSON including metadata. The tool wrapper adds a small fixed framing overhead. No entity/relationship is sliced or skipped to fit. If the next whole record or metadata cannot fit, the result explicitly requests a larger limit or narrower projection. Arbitrary tool JSON uses a valid `OUTPUT_LIMIT_EXCEEDED` error rather than clipping JSON text; plain-text clipping remains a separate presentation function.

## Continuation and failure

Signed cursors bind the daemon process, instance, resource, filter, content revision, publication sequence and offset. They expire after 30 minutes. Changing data, filters, instance, URI or daemon process requires restarting the query. A client cannot combine changed-revision pages and claim completeness. This favors an explicit restart over hidden duplication or missing records.

Invalid input/URI, incompatible cursor and oversized records produce structured errors; `query_resource` also sets MCP `isError`. A malformed or unavailable resource can return a typed unavailable page with scoped reasons and unknown totals. MCP resource protocol errors propagate through its error channel. Optional missing bootstrap files differ from missing published files. Neither graph nor full-scan age is a staleness rule.

Some dynamic consumers remain transitional: `dream://context` states its legacy completeness limitation until Slice 3 replaces retrieval; status reports canonical dependency failures even if an old helper suppresses them. Later client/catalogue adoption must consume the envelope and finish those owners; it is not qualified by a reachable URI.

## Verification

The nine tests in `tests/resource-query.test.ts` exercise all 31 registered core meanings, pure reads, MCP resource/tool parity, 83-record page union with Unicode byte limits, wrapper filters and empty matches, all 62 history entries, actual schedule executions, physical-instance cursor isolation, expiry/tampering/revision rejection, candidate uncertainty, incompatible formats, oversized/malformed records, bounded legacy presentation and the MCP error flag. Canonical history tests also preserve real chapter numbers, current and legacy digests, and resolved tensions separately from active records. The complete offline root suite passes with 950 tests, two existing skips and no failures; [actual evidence](resource-tests.json). No provider, installed daemon migration or release activation is implied.
