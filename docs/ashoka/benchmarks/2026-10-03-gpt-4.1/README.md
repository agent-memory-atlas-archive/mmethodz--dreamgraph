# Ashoka supplied-context pilot — 2026-10-03

[Results and original public replies](results.json) record fourteen paired comparisons: twelve frozen tasks across DreamGraph and Web64, plus two exploratory established-graph pairs. All 28 calls used `gpt-4.1-2025-04-14` through OpenAI Responses, with one call per arm, no retries or escalation, and `store:false`. The observed usage was 38,971 input and 16,538 output tokens. The reviewed tariff estimate before cache discount was $0.210246; it is not an invoice. Provider storage flags do not establish account retention policy.

This pilot **does not establish an improvement in agent understanding**. It found omitted lifecycle fields, trust/independence confusion, invented mutation/readback claims, age-only staleness claims and unsupported architecture guarantees. Web64 architecture and the two narrow subsystem-retrieval pairs met their supplied-excerpt outcomes. The review was performed by the implementing agent, without blinding or an independent judge. No aggregate success percentage or cost-saving claim is justified.

Eight pairs are identical-input contract controls. Four use frozen historical source/retrieval inputs with synthetic distractors. The two established-graph pairs contain private context: their answer hashes, resource measurements and review are public, but their raw contexts/replies are withheld. Read-only AT05 completions are not mutation execution evidence. Actual functional authority/recovery tests are separately recorded in the Slice 27 closure.

## Reproduce or contribute a comparison

The twelve files in [requests](requests) are complete public replay specifications. Use the [admitted collector workflow](../../admitted-agent-evaluation.md): build the server, initialize one private ledger, preview each specification, review the exact context/model/tariff/retention/spend disclosures, then collect with your own explicit approval and credential environment variable. Reading these results or running ordinary CI makes no paid request.

```sh
node scripts/collect-agent-pair.mjs init --ledger-dir /absolute/new/private-ledger
node scripts/collect-agent-pair.mjs preview --ledger-dir /absolute/private-ledger --spec /absolute/public-request.json --out /absolute/new-preview.json
node scripts/collect-agent-pair.mjs collect --ledger-dir /absolute/private-ledger --spec /absolute/public-request.json --approval /absolute/reviewed-approval.json --out /absolute/new-answers.json
```

Use absolute Windows paths in PowerShell. Preview does not grant approval; follow the linked workflow to produce the original operator's exact digest and expiry. Reuse one ledger for the intended shared daily cap. Check current provider availability/prices before any paid replay. A changed model, tariff, context or policy requires a new reviewed specification and approval. Never reuse another person's approval or private ledger.

Publish your exact public specification, provider-reported model and token usage, context byte measurements, arm order, original answer hashes, operating environment and rubric review. Remove credentials/private context. Label changed source/preamble/model runs as new comparisons; preserve the original failed results. The harness's answer hash is SHA-256 of the JSON-encoded answer string, not the raw UTF-8 answer bytes. Context byte counts are not tokenizer measurements.

Community runs across configurations can improve confidence through replication. Tool-enabled tasks, richer applicable ADR evidence, production trust/currency preambles and repeated independent reviews are follow-up work driven by field feedback, not additional platform qualification required for 14.0.0.
