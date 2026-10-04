# Manifest Schema.Test

> This test module verifies the SDK plugin manifest schema against both valid and invalid fixture files using `PluginManifestSchema.safeParse`. It exists to lock down the public plugin contract by asserting that a minimal manifest with an id, capability list, tool declaration, and namespaced resource URI is accepted, while malformed ids, invalid capabilities, bad tool names, and out-of-namespace resource URIs are rejected. That makes it a contract-regression test for the shipped SDK surface rather than an implementation module, and it helps protect plugin-facing features in `dreamgraph_packages_sdk` and the broader `feature_plugin_sdk` ecosystem.

**Table:** `N/A`  
**Storage:** N/A  

