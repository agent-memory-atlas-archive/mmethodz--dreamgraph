# Native Data Model

> This module is the parser-backed bridge that runs native extractors over scanned source files, links their outputs across the project, and converts type-like code entities into `DataModelEntity`-shaped records ready to merge into `data_model.json`. It exists to improve repository modeling beyond heuristic structural generation by reusing language-specific extractors for C, C++, Rust, Java, Kotlin, Python, C#, Go, Gradle, and Swift while keeping failures non-fatal and preserving provenance about parser-backed coverage. The bridge depends on `dreamgraph_src_scanner_types` contracts and `dreamgraph_src_tools_scan_types` scan inputs, and its tests show it emits relationships such as `OWNS` with language-specific `via` hints like `unique_ptr` while tracking parser coverage and diagnostics.

**Table:** `N/A`  
**Storage:** N/A  

