# Ashoka role policies and cognitive intent

Six independent roles are resolved by the daemon: initial scan, enrichment, dreamer, normalizer, Architect and Computer Use. Session settings override role environment fields, then saved role settings, shared legacy settings and provider defaults. Models are explicit preferences without a generation ceiling or automatic upgrade. Changing provider does not inherit another provider's model, endpoint or credential. The field catalogue in `src/config/role-env-fields.ts` also generates commented role options in engine.env; dashboard editing belongs to Slice 10/23.

Saved profiles use versioned publication, expected-revision checks, durable operation identity and explicit restore. Inspection shows requested/effective settings, origin, fingerprint, cognitive instructions, capability diagnostics and independent billing/retention controls. Secret values are excluded; only environment variable names are exposed. Paid run/day allocations default to zero. Configuration is not job admission, and a storage flag is not provider/account Zero Data Retention.

## Temperature and cognitive roles

Dreamer explores source-grounded hypotheses and missing concepts. Normalizer applies stable evidence criteria as a strict critic. These roles live in instructions and evidence validation rather than relying on a high/low temperature. The original task prompt and response schema remain alongside the role instructions in Responses, Chat Completions, Messages and local completion requests. MCP sampling retains all system instructions instead of only the first one.

| Model/route | Effective temperature behavior |
|---|---|
| GPT-4.1/4o and qualified legacy non-reasoning models | Requested sampling value retained |
| GPT-5.1/5.2/5.4 and GPT-6 Sol/Luna | Retained only with explicit effort `none`; omitted with reasoning/default effort |
| GPT-5.5/5.6 | Omitted; explicit `none` alone does not qualify sampling support |
| GPT-5/mini/nano, o-series reasoning models, GPT-6 Astra, GPT-6.1 Sol | Omitted |
| Claude 4.7+ and Mythos Preview | Omitted; non-default sampling is deprecated |
| Native CLI adapters | No API temperature setting; native adapter controls remain separate |
| Future/custom provider model without qualified capability evidence | Omitted conservatively; model and role unchanged |

Compatibility was reviewed against official documentation on 2026-09-30: [GPT-5.4 parameter compatibility](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.4), [GPT-6 migration parameters](https://developers.openai.com/api/docs/guides/latest-model#gpt-6-astra-update-api-and-model-parameters) and [Claude parameter deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations). GPT-5.4 and earlier are not universally temperature-compatible: original GPT-5 reasoning models reject it. Unsupported effort `none` fails before dispatch; DreamGraph never silently substitutes a costlier effort to make it work.

Requested temperature remains saved for a later compatible model; effective temperature is null with a support/reason/source record. Explicit capability evidence for an arbitrary model must name the adapter, API and exact model. No provider request is made to infer temperature support, and omission never retries or escalates to another model. Candidates remain hypotheses until independently validated; more model confidence is not more evidence.

For example, `DREAMGRAPH_LLM_DREAMER_MODEL=gpt-6.1-sol` preserves dreamer instructions and omits temperature. `DREAMGRAPH_LLM_NORMALIZER_MODEL=gpt-5.4` with `DREAMGRAPH_LLM_NORMALIZER_REASONING_EFFORT=high` preserves normalizer instructions and omits temperature. Explicit `none` on GPT-5.4 permits the saved sampling value. Select effort independently according to the workload.

## Current implementation boundary

Policy persistence/inspection and completion parameter handling are implemented and checked with offline provider doubles. Slice 8 must adopt the complete policy across all provider/CLI/job paths; Slice 6 enforces reservations and paid admission, and Slice 10/23 consumes the field catalogue in configuration UI. These ports do not claim those later integrations, live provider qualification or a released v14 runtime.

Role `CAPABILITY` accepts source/version-named API evidence bound to an exact provider/model. Native API browser adapter naming is normalized to the corresponding provider adapter; native CLI policy remains separate. Migration previews preserve strict-schema and capability settings. Capability and outcome consumer artifacts are generated from core; see [provider boundaries](providers.md).
