# Admitted matched answer collection

This workspace helper collects two native API answers over frozen supplied contexts. It is one component of Slice27's agent-usefulness work, not GE16 acceptance or a complete AT01–AT06 execution benchmark. No source-reading tools, governed mutation, native CLI or computer interaction run through this collector. Actual answers remain `pending_review`; mandatory outcome, assessment and material-understanding gain remain null.

The ordinary `evaluatePairedTask` callback harness still rejects `real_model` before calling any executor or assessor. Only `evaluateAuthorizedCompletionPair` constructs the closed native provider and uses the original core job, role policy and monetary admission. This internal operator helper has no daemon HTTP/MCP endpoint and is not an installed `dg` command. Offline tests intercept official HTTP with declared answers and synthetic tariffs; they prove admission/transport/recovery, not model quality or current provider pricing.

## Prepare and review

Build the current server with `npm run build:server`. In a new private directory outside a running instance, create one fixed evaluation ledger:

```sh
node scripts/collect-agent-pair.mjs init --ledger-dir /absolute/new/evaluation-ledger
node scripts/collect-agent-pair.mjs preview --ledger-dir /absolute/evaluation-ledger --spec /absolute/pair.json --out /absolute/new-preview.json
```

Use absolute Windows paths in PowerShell. The helper requires a new directory for `init`, refuses ordinary project stores, binds later commands to the original local OS operator and physical ledger, and refuses existing output files or output inside the ledger. It does not load an installed `engine.env`, take provider credentials from a JSON file or grant paid allocation at initialization/preview.

The strict `dreamgraph.completion_pair_specification.v1` record contains:

| Field | Required review |
| --- | --- |
| `task` | Frozen ID, project, exact prompt, required outcomes, mandatory evidence IDs and forbidden assertions. |
| `execution` | Exact provider/model/API/effort/prompt/source-manifest identities, independent per-arm token and UTF-8 byte ceilings, one call, finite deadline, retention, currency and maximum amount. |
| `arms` | Exactly one `graph_assisted` and one `source_only` arm; whole context text, exact measured UTF-8 bytes, construction time and the same frozen source-manifest hash. |
| `order` | `graph_first` or `source_first`; alternate across comparisons. |
| `endpoint` / `api_key_env` | Exact official OpenAI or Anthropic API endpoint and named environment-variable reference. Never put the credential in this file. |
| `pricing` | Exact operator-reviewed provider/model/currency/version/source and input/output tariffs, including conservative image and reasoning billing. This helper does not fetch or infer prices. |
| `budget` | One shared two-request run, concurrency1, retries0, hops0 and neighbors0; enough token/time allocation for both arms; positive hard run/day money ceilings and the reviewed pricing version/billing principal. |
| `capability` | Optional explicit qualified capability declaration; unsupported API/model/retention policies refuse. |
| `local_results` / `scope` | Exactly `private_job_artifact` / `read_only_supplied_context_completion`. |

Use an exact model identity that the provider reports back, rather than assuming an alias will equal a dated snapshot. A reported-model mismatch retains the observed first answer and usage, then refuses the second arm. Changing any reviewed context, question, tariff, retention, policy capability/fingerprint or physical ledger changes the approval digest. A manifest label alone does not attest actual source bytes/history; freeze and independently review the source evidence and both complete contexts.

The preview contains a disclosure summary and approval template, not the raw contexts or a credential. Review the specification file itself alongside the preview. Provider request storage flags are separate from account retention/ZDR; an unattested retention request refuses. Raw answers can quote the supplied contexts and are retained locally in private job artifacts. Local answers, source files and the specification require the operator's usual storage/retention discipline.

## Collect and inspect

Only after explicit review, save a separate approval with the exact preview digest, original operator and explicit UTC expiry:

```json
{
  "digest": "sha256:REPLACE_WITH_EXACT_PREVIEW_DIGEST",
  "principal": "REPLACE_WITH_ORIGINAL_LOCAL_OPERATOR",
  "expires_at": "REPLACE_WITH_EXPLICIT_FUTURE_UTC_EXPIRY"
}
```

The expiry must leave enough time for the whole run and cannot exceed24h. Set only the named provider credential in the calling environment. Then run:

```sh
node scripts/collect-agent-pair.mjs collect --ledger-dir /absolute/evaluation-ledger --spec /absolute/pair.json --approval /absolute/reviewed-approval.json --out /absolute/new-answers.json
node scripts/collect-agent-pair.mjs inspect --ledger-dir /absolute/evaluation-ledger --job ORIGINAL_JOB_ID --out /absolute/new-inspection.json
```

Both arms share one durable C05 job, one C06 parent allocation and the exact pinned tariff. The daily cap is across that fixed instance ledger/billing principal; it is not a provider-account-wide cap across other instances or newly created ledgers. Do not create new ledgers to evade the reviewed daily limit. Template zero allocations authorize no request. No fallback, retry, adapter substitution or model escalation is available.

Each successful arm is durably checkpointed before another call. If the second arm refuses, fails, reports an unapproved model or cancellation leaves work uncertain, inspection preserves the known first answer, original job and known/unknown usage. An unchanged successful collection returns its original result without dispatch; a failed/recovery-required original job cannot be replayed as fresh work. Reading or inspecting never dispatches a model or repairs a graph. Output creation is reserved before dispatch, so an existing result cannot be overwritten after money is spent.

Ctrl+C propagates cancellation to the original job/provider. Bounded waiting does not prove remote provider termination; uncertain dispatched liability and recovery remain explicit. A failed output says to inspect the original ledger and never claims zero usage. Byte ceilings are exact UTF-8 memory/transport measurements; whole-request token usage is provider accounting. Context token measurement remains unavailable without a qualified tokenizer.

## Acceptance still required

Independently bind both actual answer hashes to frozen evidence and assess correctness, provenance, history, constraints, uncertainty and improved decisions. Fewer reads, smaller context, a green harness or plausible prose cannot establish material understanding. The frozen twelve project tasks and established-instance GE16 comparisons remain in [the protocol](agent-evaluation-protocol.json) and [the unified plan](../../plans/graph-trust-and-agent-effectiveness.md). AT05 governed execution and complete source/graph/next-agent joins require their real execution owners; this read-only collector does not stand in for them. No real provider run is authorized by this documentation or by the deterministic test fixtures.
