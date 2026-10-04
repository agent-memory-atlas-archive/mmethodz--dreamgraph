# Scan Types

> This module defines the shared scan-time data contracts used by `scan-project` helpers so they can consume project-scan structure without importing the main orchestrator. It models discovered files, auxiliary file buckets, and the aggregate `ProjectScan` shape, including optional captured file content and content hashes for incremental extraction. The auxiliary classification fields also show that the scan pipeline distinguishes ordinary code discovery from test suites, configuration, automation scripts, and MCP tool sources, which downstream generators and bridges can consume consistently.

**Table:** `N/A`  
**Storage:** N/A  

