# Test Case

> This node represents the concrete verification scenarios exercised in `tests/instance-isolation.test.ts`, where Vitest cases check instance-scope boundary behavior, cross-instance rejection, project-path allowances, and guard failures. The file shows that a DreamGraph test case is not just a label; it encodes expected outcomes for `InstanceScope`, `ScopeViolationError`, policy validation, instance scaffolding, and UUID-prefixed mutex behavior so regressions in isolation guarantees are caught early. In the broader testing flow, these cases realize the repository test process through the `test_instance_isolation` feature and validate behavior relied on by the `instance_management` workflow and the cross-cutting `instance_boundary_contract`.

**Table:** `test_case`  
**Storage:** json  

## Fields

| Field | Type | Description |
|-------|------|-------------|
| test_id | string | Unique identifier for the test case. |
| description | string | Description of the test case and its purpose. |

