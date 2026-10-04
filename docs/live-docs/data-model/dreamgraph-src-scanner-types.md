# Types

> This module defines the core extractor contract for DreamGraph's parser-backed scanner, covering per-file extractor input, extracted entities and edges, synthesized data shapes, diagnostics, and aggregate extractor output. It exists to keep language-specific extractors pure and interchangeable while the orchestrator handles file discovery, dispatch, and later emission into graph stores such as features, workflows, data models, and links. The types also encode stable entity-id conventions, evidence-bearing edges, and shape participation metadata, making this the semantic bridge between low-level parsing and higher-level graph projection used by scanner orchestration and native data-model extraction.

**Table:** `N/A`  
**Storage:** N/A  

