/** Shared local catalog for CLI launch attestation and actual MCP discovery. */
export function cliBridgeLocalToolNames(options: { managedContext?: boolean; computerUseRequestable?: boolean } = {}): string[] {
  return ["run_command", ...(options.managedContext ? ["refresh_execution_context"] : []),
    ...(options.computerUseRequestable ? ["request_computer_use"] : [])];
}
export function cliBridgeToolNames(upstream: readonly string[], options: Parameters<typeof cliBridgeLocalToolNames>[0] = {}): string[] {
  return [...new Set([...upstream, ...cliBridgeLocalToolNames(options)])];
}
