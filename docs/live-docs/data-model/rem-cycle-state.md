# REM Cycle State

> This node represents the REM-specific state boundary inside the cognitive engine's larger cycle, marking the phase where speculative dreaming is allowed but outputs must remain isolated from validated facts. In the neighborhood it is tightly coupled to `rem_isolation_protocol`, `rem_output_quarantine`, `quarantine_record`, and `rem_cycle_quarantine`, which together define how REM work is contained until normalization or recovery occurs. It exists to make the most safety-sensitive phase of cognition explicit, so dreaming, audit, promotion gating, and interruption handling can all key off a clear state boundary.

**Table:** `N/A`  
**Storage:** N/A  

