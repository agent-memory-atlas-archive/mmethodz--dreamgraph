# Configuration

> This node is the central runtime configuration object for the DreamGraph server, built from environment variables and a small amount of startup filesystem discovery rather than from static source-level compiler settings. In `src/config/config.ts` it reads the package version from `package.json`, resolves fallback master and data directories, parses JSON-encoded repo and cognitive settings, and assembles server, database, environment, and other runtime sections into one exported `config` object. It exists so startup and operational code can share one authoritative source of resolved settings, including instance-aware data directory behavior and optional PostgreSQL connectivity. In the neighborhood it is implemented by `dreamgraph_src_config`, feeds startup-oriented flows such as `startup_initialization`, and provides configuration surfaces adjacent to `cli_options`, `llm_config`, `cognitive_tuning`, and instance typing in `dreamgraph_src_instance`.

**Table:** `config`  
**Storage:** json  

## Fields

| Field | Type | Description |
|-------|------|-------------|
| compilerOptions | object | Compiler options for TypeScript. |
| include | array | Files to include during compilation. |
| exclude | array | Files to exclude during compilation. |

