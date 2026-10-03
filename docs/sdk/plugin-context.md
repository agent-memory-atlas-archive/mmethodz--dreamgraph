# Plugin Context

Ashoka SDK model callback adoption has scoped offline qualification. `ManagedGraphPass.runModel` joins the original host's existing graph pass and spend ledger after a whole `prepare` handoff. The caller supplies the logical request ID, final wire payload and exact native binding; its callback receives the captured request and permit deadline signal and must explicitly report protocol termination, acknowledgement and any available usage. Credentials and transport remain native. Lost admission/report replies retain the original request for `inspectModel` and exact `retryModelReport`, with no redispatch or stronger termination assertion. The ordinary `run` callback does not attest private inference/spend; use `runModel` for supported model execution. Model admission stays outside PluginContext and worker authority. Actual local HTTP/core/SDK cases pass within the1,799-case frozen root regression, with declared offline provider/termination fixtures. This is not paid-model understanding or arbitrary private-callback attestation; full Ashoka conformance remains open.

`PluginContext` is the shipped trusted in-process runtime surface handed to loaded plugins. It is an API boundary, not a sandbox.

## Allow surface

The host exposes namespaced identity, logging, events, tools, resources, canonical graph context, semantic UI metadata, discipline proposals, archetype providers, markdown fences, declarative Architect tabs, daemon-owned Architect plan state, and an unload-aware `AbortSignal`.

`ctx.graph.retrieve(request, { signal })` uses the generated core context-query/pack contract. The manifest must declare `resources:read` and `read_internal_graph`; `ctx.graph.availability` and `reasons` disclose capability gaps. Unload/caller cancellation fences the read/result. Whole evidence, assertion classes, typed identities, omissions and receipts retain core semantics. Returned receipts are `unattested`: a read does not prove model consumption or private plugin filesystem effects. Host integrations lacking the port report `GRAPH_CONTEXT_PORT_UNAVAILABLE` rather than silently inventing legacy data.

Architect plugins use:

```ts
ctx.architect.tabs.register(definition);
await ctx.architect.planState.read(key, context);
await ctx.architect.planState.write(key, value, { ...context, revision });
```

Architect state is namespaced by instance, plugin id, plan id, tab type id, and key. Plan-bound operations require an explicit `planId`; project scope does not silently bind to a selected or first plan. Browser clients receive validated snapshots through `/api/architect/v1/plugin-tabs`, never raw store paths or plugin modules.

## Deny list

`PluginContext` deliberately does not expose raw filesystem paths, internal graph writers, tension or graph mutation, arbitrary network primitives, process helpers, browser DOM access, plugin browser JavaScript, iframes, or browser-local authoritative state.

Trusted plugin code runs in the daemon process and can reach Node globals if it deliberately bypasses `ctx`. Doing so is a trust violation and grounds for quarantine, not a sandbox escape. Supported workflows must stay on host-mediated seams so capability checks, effect checks, telemetry, lifecycle cleanup, and persistence rules remain enforceable.

See the [PluginContext API reference](plugin-reference/05-context-api.md) and [Architect tabs guide](plugin-developer-guide/13-architect-tabs.md).
`ManagedExecutionClient` and `GraphExecutionPort` are SDK host transports over the generated canonical execution contracts. A trusted editor/SDK host can begin, retrieve, refresh, acknowledge and finish an execution while keeping its own native model/CLI adapter. Session and ephemeral worker credentials stay in memory. The worker cannot issue approvals; unconfirmed termination retains recovery. `dispose()` cancels transport waits and cannot establish that underlying work stopped. This client is not injected as a new approval/network capability into `ctx`; plugin effects still require their existing declared and mediated host ports. Ordinary plugin executor and editor-loop adoption remain in Ashoka Slice25.

The standalone SDK ManagedExecutionClient copies its endpoint/transport configuration and captures exact begin/approval requests before session initialization. Cancellation of one initialization wait does not cancel other callers; dispose prevents late credentials or queued execution from reviving authority. These controls are host-owned transport, not inherited plugin approval capability. Plugin ctx.graph remains the capability-gated canonical read port; complete plugin executor adoption is still an Ashoka integration obligation.
Contributed tool/resource handlers receive a combined `context.signal` from the original MCP request, execution policy and contribution lifecycle. Unregister and plugin unload request cancellation of in-flight handlers; they do not prove private subprocesses, network requests or ignored signals stopped. The host does not race a handler away and invent a successful closure. A returned callback is marked separately from cancellation requested, and private effects still need their owner receipts. Seven manager/MCP/modern-boundary cases qualify these additions, including a noncooperative callback continuing after its cancelled client wait rejects; full plugin executor/usefulness qualification remains open.

Handlers may return a complete MCP tool/resource result: literal content/media, structured data, error flags and owner metadata are preserved. Plain strings/JSON objects retain the legacy text form; explicit failure objects remain failures. Invalid/unserializable results are rejected. Tool responses use the shared 8 MiB whole-result ceiling; resource responses have a distinct 8 MiB UTF-8 byte ceiling. Oversized results are refused whole, never clipped into apparently complete evidence. Plugin handlers do not inherit host approvals or new execution/network capabilities.

`ManagedGraphPass` adds a portable trusted-host lifecycle above `GraphExecutionPort`. Construct it with the captured request before calling `begin()`, retaining the object/ID if admission acknowledgement is lost. `prepare()` hands the whole canonical block/pack to the native adapter and checks its exact acknowledgement before notifying the daemon. Each `run()` consumes that preparation; a continuation must prepare a refreshed pack. The trusted worker callback receives its ephemeral credential outside the prompt. The helper neither selects models nor invents an API continuation protocol for CLIs; the native harness retains its own request/spend admission and effect owners.

`run()` requires an explicit `{ result, workTermination }` native-harness return; promise settlement or successful prose cannot attest private task termination. It returns the literal result unchanged. `cancel()` ends waiting and requests cancellation. Noncooperative callbacks remain counted until they actually settle; interrupted/failed work retains termination uncertainty and cannot dispatch again. `inspect()` only reads the captured execution. `finish()` closes that original ID with a captured outcome/termination disposition; uncertain retries cannot repeat work or strengthen termination. An inactive `reconciliation_pending`, `work_pending` or `recovery_required` result must remain visible as such, never be promoted to graph completion. This host helper is not injected into `PluginContext` and cannot attest private plugin effects. SDK lifecycle conformance is under qualification in Slice25.

For a trusted host with its existing `nativeAdapter` (whose execution path performs request/spend admission), the successful path is:

```ts
import { ManagedExecutionClient, ManagedGraphPass } from "@dreamgraph/sdk";

const host = new ManagedExecutionClient({ baseUrl: capturedDaemonUrl });
const pass = new ManagedGraphPass(host, capturedExecutionRequest, {
  signal: operatorSignal, expectedInstanceId: capturedInstanceId,
});
// Retain pass before begin: a lost reply must still be inspected by its original ID.
await pass.begin();
await pass.prepare(async (context, signal) => {
  await nativeAdapter.handoff(context, signal); // Whole block; credential is absent.
  return { receiptId: context.pack.receipt.id, block: context.block };
});
const result = await pass.run(worker => nativeAdapter.execute(worker));
const execution = await pass.finish("completed");
// Present the literal result together with the actual closure, including pending debt.
return { result, execution };
```

The host must handle failures by retaining `pass.executionId`, cancelling owned work, and closing or inspecting that same pass. A failed closure remains unconfirmed; do not construct a replacement to retry the old action. The adapter supplies `{ result, workTermination }` from its actual owner evidence and keeps `workerBearer` out of model input. `host.dispose()` only cancels transport waits, so disposal alone is not execution closure. Canonical plugin resource reads remain separately `unattested`; the managed host delivery receipt does not promote a plugin read or private effect to attested execution.

If the original native worker later supplies independent termination evidence, `pass.observeModelStop({ acknowledged: true, workTermination: "confirmed", usage })` reports that observation with the captured original model identity. This is separate from replaying the first settlement: it can release stopped C14 ownership after all attempts stop, while retaining the first closure and other unresolved effects. It grants no new permit or execution authority. Missing usage keeps the conservative spend liability. Cancelling a wait or disposing a client is never this observation.

The SDK lifecycle checkpoint is qualified by thirteen actual local HTTP/core/worker/manager cases in the 91-case focused run, plus 1,751 full engine passes. It includes physical source effects/reconciliation debt and a canonical plugin resource read. Native adapter callbacks/termination declarations are explicit fixtures, not paid model usefulness or private process evidence. Complete token/cost admission and the broader eight-surface task matrix remain Ashoka gates.

`ManagedExecutionClient` also implements the separate original-host `ModelAdmissionPort` under qualification: `admitModel`, `settleModel` and `readModel` consume generated core contracts and the same instance ledger. This accounting port is not exposed in `PluginContext` or granted to worker credentials. Native harness integration must obtain its one-time permit before dispatch, keep credentials native, and explicitly report owned-work termination/optional usage. A permit records possible liability; it cannot prove a model processed the graph or authorize source actions. Lost replies require same-ID read-only recovery, never launch retry. The portable lifecycle helper's callback still owns this admission adoption; full SDK/native conformance is pending.
