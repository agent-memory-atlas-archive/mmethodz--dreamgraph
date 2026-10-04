# Policy Profile

> This node represents the per-instance policy profile contract loaded from `src/instance/policies.ts`, where DreamGraph defines built-in `strict`, `balanced`, and `creative` profiles plus the active-profile selection inside a `PoliciesFile`. It exists to govern how much evidence, planning, verification, file protection, and creative latitude an instance is allowed at runtime, including limits such as `max_verify_loops` and required tool classes. The module validates the profile schema leniently, rejecting unsupported schema versions or unknown profile names while warning on extra keys, and it also allows profiles to carry `cognitive_tuning` overrides that affect cognitive thresholds. In the wider instance flow, this contract belongs to instance-scoped configuration managed through the instance subsystem and is a core input to policy enforcement and isolation-oriented behavior.

**Table:** `policy_profile`  
**Storage:** sqlite  

## Fields

| Field | Type | Description |
|-------|------|-------------|
| id | string | Unique identifier for the policy profile. |
| name | string | Human-readable name for the policy profile. |

## Relationships

| Target | Type | Description |
|--------|------|-------------|
| instance | belongs_to | - |

