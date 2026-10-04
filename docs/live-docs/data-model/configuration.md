# Configuration

> This node represents the broader application configuration contract embodied by `src/config/config.ts`: a resolved, environment-driven settings surface that covers server identity, repository registration, database connectivity, data-directory resolution, debug flags, and imported cognitive subconfiguration. The file exists to keep DreamGraph's operational behavior configurable without hard-coding deployment-specific values, while also providing safe defaults and fallbacks when environment variables are absent or malformed. It works by parsing JSON and scalar environment variables, merging them with defaults, and exporting a single object that other startup and runtime paths can consume. In the neighborhood it overlaps strongly with `config`, is implemented by `dreamgraph_src_config`, supports startup flows, and provides the configuration substrate that adjacent nodes such as `cognitive_tuning`, `llm_config`, and instance-scoped runtime behavior build on.

**Table:** `configuration`  
**Storage:** json  

## Fields

| Field | Type | Description |
|-------|------|-------------|
| env | string | The environment in which the application is running (development, production, etc.). |
| settings | object | Key-value pairs for application-specific settings. |

