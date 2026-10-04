# Tools

> This node represents the shared tooling-layer contracts and helpers around repository scanning in `src/tools`, centered here on the reusable `ProjectScan`/`ScannedFile` scan contract and the directory-skip policy that prevents traversal into hidden or generated artifacts. It exists so scan-oriented helpers can reason over a consistent repository snapshot shape while applying a deterministic exclusion policy for dot-directories, build outputs, caches, virtual environments, and other generated paths before downstream extraction or enrichment runs. In practice it participates in the broader `dreamgraph_src_tools_flow` and supports repository discovery by combining the cached scan-type contract from `dreamgraph_src_tools_scan_types` with `shouldSkipScanDirectory`, which normalizes relative paths and rejects entries by name, path segment, or suffix. The evidence boundary is that only `scan-types.ts` and `scanner-artifact-policy.ts` are grounded here, so this node should be understood as the scan-support subset of the tools surface rather than the entirety of every tool in `src/tools`.

**Table:** `dreamgraph_src_tools`  
**Storage:** unknown  

