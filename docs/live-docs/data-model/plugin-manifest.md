# Plugin Manifest

> This node is best treated as a plugin/extension packaging metadata concept rather than a fully evidenced runtime schema in the supplied source. The only direct source excerpt shows a VS Code build script that copies third-party browser assets into `dist/vendor/` so they ship inside the VSIX, and nearby graph evidence places `plugin_manifest` alongside the VS Code extension, plugin registry, and plugin management/discovery surfaces. Based on that boundary, the manifest's grounded role here is to participate in extension packaging and plugin identification flows, especially where shipped assets and extension metadata must be prepared together for deployment. The supplied evidence does not expose actual manifest fields beyond the parser-detected `id` and `version`, so its deeper contract should be considered only partially evidenced.

**Table:** `plugin_manifest`  
**Storage:** json  

## Fields

| Field | Type | Description |
|-------|------|-------------|
| id | string | Unique identifier for the plugin. |
| version | string | Version of the plugin. |

