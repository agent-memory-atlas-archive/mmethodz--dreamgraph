# Native Data Model.Test

> This test module is the regression suite for the native data-model bridge, proving that parser-backed extraction can detect native-language files, emit one data-model entry per discovered type, preserve source/provenance metadata, and surface semantic relationships such as `OWNS` with language-specific `via` hints. It also verifies graceful no-op behavior when no native files are present and checks cross-language coherence, including Java owner-qualified-name handling and annotation/class resolution through the same bridge path. That makes it the main verification boundary for `dreamgraph_src_tools_native_data_model` and its integration with scan contracts and scanner extractor semantics.

**Table:** `N/A`  
**Storage:** N/A  

