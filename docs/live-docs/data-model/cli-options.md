# CLI Options

> This node is the startup-time command-line options contract for the DreamGraph entrypoint, representing the validated `transport` and `port` values parsed from `process.argv` in `src/index.ts`. It exists so the server can choose between stdio and Streamable HTTP launch modes with clear validation, defaults, and help output before any transport-specific startup work begins. The parser defaults to `stdio` and port `8100`, rejects unknown transports and invalid port ranges, and returns a small `CLIOptions` object that drives later launch behavior. In the neighborhood it feeds `startup_initialization` and `startup_process`, configures `dreamgraph_server`, and complements the broader environment-based runtime settings modeled by `config` and `configuration`.

**Table:** `cli_options`  
**Storage:** memory  

## Fields

| Field | Type | Description |
|-------|------|-------------|
| transport | string | The transport mode for the server, either 'stdio' or 'http'. |
| port | number | The port number for HTTP mode. |

