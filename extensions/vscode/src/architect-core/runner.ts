// SPDX-License-Identifier: AGPL-3.0-or-later
//
// architect-core/runner.ts — Phase 3a (ADR-089).
//
// Top-level wiring for the v1 architect-core seam. Builds the full
// `ArchitectCorePorts` bag from a `ChatPanelHost` and runs one pass.
// Returns the typed `PassResult` to the caller; the host renders it.
//
// Ordinary API chat uses the managed inline loop. Standalone API callers
// of this seam supply the same original ManagedNativePass; CLI adapters
// keep their native invocation hooks and continuation semantics.

import { runPass, type RunPassInput } from "./pass.js";
import type { ArchitectCorePorts } from "./ports.js";
import type { PassResult, PassStopReason, ToolDefinition } from "./types.js";
import type { ManagedNativePass } from "../managed-native-pass.js";
import type { ManagedExecutionSnapshot } from "../generated/graph-contracts.js";
import type { ChatPanelHost } from "./adapters/host.js";
import { SYSTEM_CLOCK } from "./adapters/clock.js";
import {
  createAttachmentPort,
  createAutonomyPort,
  createContextBuilderPort,
  createMemoryPort,
  createPromptComposerPort,
  createProviderPort,
  createToolExecutorPort,
} from "./adapters/v1.js";

export interface RunPassViaCoreInput {
  readonly host: ChatPanelHost;
  readonly text: string;
  readonly tools?: readonly ToolDefinition[];
  readonly onStreamChunk?: (chunk: string) => void;
  readonly abortSignal?: AbortSignal;
  /** Required for API dispatch; native CLI runners use their own original invocation hooks. */
  readonly managedPass?: ManagedNativePass;
}

/**
 * Build the v1-bound port set for `host`. Pure construction — performs
 * no I/O. Exposed so callers can introspect or replace individual ports
 * during integration tests; production callers should use `runPassViaCore`.
 */
export function buildV1Ports(host: ChatPanelHost, managedPass?: ManagedNativePass): ArchitectCorePorts {
  return Object.freeze({
    contextBuilder: createContextBuilderPort(host),
    promptComposer: createPromptComposerPort(host),
    provider: createProviderPort(host, managedPass),
    toolExecutor: createToolExecutorPort(host, managedPass),
    memory: createMemoryPort(host),
    attachments: createAttachmentPort(host),
    autonomy: createAutonomyPort(host),
    clock: SYSTEM_CLOCK,
  });
}

/**
 * Drive one pass through `runPass()` with the v1-bound port set.
 *
 * The host is the source of truth for envelope, context, autonomy state,
 * and attachment decisions — those are computed once in `handleUserMessage`
 * and projected through `ChatPanelHost`. The runner only orchestrates.
 */
export async function runPassViaCore(input: RunPassViaCoreInput): Promise<PassResult & { readonly execution: ManagedExecutionSnapshot }> {
  const pass = input.managedPass;
  if (!pass) throw new Error("MANAGED_CORE_PASS_REQUIRED");
  const signal = input.abortSignal ? AbortSignal.any([pass.signal, input.abortSignal]) : pass.signal;
  const base = buildV1Ports(input.host, pass);
  let closure: Promise<ManagedExecutionSnapshot> | undefined;
  let execution: ManagedExecutionSnapshot | undefined;
  let modelStop: PassStopReason | undefined;
  // Capture one disposition before sending. A lost closure reply retains the
  // original ID and is never retried here as a different outcome or fresh pass.
  const close = (reason?: PassStopReason) => {
    if (!closure) {
      const outcome = signal.aborted ? "cancelled" : reason === "complete" ? "completed" : "failed";
      closure = pass.finish(outcome).then(value => execution = value);
    }
    return closure;
  };
  const settled = () => execution && ["no_change", "state_committed", "graph_committed"].includes(execution.status);
  const ports: ArchitectCorePorts = Object.freeze({
    ...base,
    memory: Object.freeze({
      persistUserMessage: base.memory.persistUserMessage,
      async persistAssistantMessage(args: Parameters<ArchitectCorePorts["memory"]["persistAssistantMessage"]>[0]) {
        modelStop = args.stopReason;
        const snapshot = await close(modelStop);
        await input.host.persistAssistantMessage({ content: args.content,
          providerRawAssistant: args.providerRawAssistant, stopReason: modelStop, execution: snapshot });
      },
    }),
    autonomy: Object.freeze({
      contractForTurn: base.autonomy.contractForTurn,
      async recordPassCompleted(args: Parameters<ArchitectCorePorts["autonomy"]["recordPassCompleted"]>[0]) {
        if (modelStop === "complete" && settled()) await base.autonomy.recordPassCompleted(args);
      },
    }),
  });
  const driverInput: RunPassInput = {
    userIntent: {
      text: input.text,
      contentBlocks: input.host.contentBlocks,
      stopContextBlock: input.host.stopContextBlock,
    },
    ports,
    priorMessages: input.host.priorMessages,
    task: input.host.task,
    provider: input.host.architectLlm.provider ?? "anthropic",
    tools: input.tools,
    budgetCoordinator: input.host.budgetCoordinator,
    onStreamChunk: input.onStreamChunk,
    abortSignal: signal,
  };
  try {
    const result = await runPass(driverInput);
    return Object.freeze({ ...result, execution: execution ?? await close(result.stopReason) });
  } catch (error) {
    try { await close("error"); }
    catch (closureError) { throw new Error(`MANAGED_CORE_CLOSURE_UNCONFIRMED: retain ${pass.executionId}; ${String(closureError)}; original outcome: ${String(error)}`, { cause: error }); }
    throw new Error(`MANAGED_CORE_PASS_FAILED: retain ${pass.executionId}; ${String(error)}`, { cause: error });
  }
}

// ---------------------------------------------------------------------------
// Copilot CLI surface — Slice 4 host wiring.
//
// Same architect-core seam, but the `provider` port routes the turn to
// the Copilot CLI orchestrator instead of `ArchitectLlm`. Every other
// port (context builder, prompt composer, tool executor, memory,
// attachments, autonomy, clock) reuses the v1 host wiring so the
// chat-panel persistence, autonomy gates, and tool-trace channel
// behave identically regardless of which surface produced the
// assistant turn.
//
// The router (chat panel) chooses between `runPassViaCore` and
// `runPassViaCopilotCli` per turn based on the user's provider
// selection. This file does NOT implement that selection — it only
// makes both wirings available behind matching entry points.
// ---------------------------------------------------------------------------

import {
  createCopilotCliProviderPort,
  type CopilotCliProviderPortOptions,
} from "./adapters/copilot-cli/index.js";
import {
  createCodexCliProviderPort,
  type CodexCliProviderPortOptions,
} from "./adapters/codex-cli/index.js";

export interface CopilotCliPortBundleOptions {
  readonly host: ChatPanelHost;
  readonly providerOptions: CopilotCliProviderPortOptions;
}

/**
 * Build a port set where the provider port is the Copilot CLI wrapper.
 * Every other port is reused from the v1 wiring. Pure construction —
 * performs no I/O.
 */
export function buildCopilotCliPorts(
  options: CopilotCliPortBundleOptions,
): ArchitectCorePorts {
  const v1 = buildV1Ports(options.host);
  return Object.freeze({
    ...v1,
    provider: createCopilotCliProviderPort(options.providerOptions),
  });
}

export interface RunPassViaCopilotCliInput extends RunPassViaCoreInput {
  readonly providerOptions: CopilotCliProviderPortOptions;
}

/**
 * Drive one pass through `runPass()` with the Copilot CLI provider
 * port wired in. Returns the typed `PassResult` to the caller exactly
 * like `runPassViaCore`.
 */
export async function runPassViaCopilotCli(
  input: RunPassViaCopilotCliInput,
): Promise<PassResult> {
  const ports = buildCopilotCliPorts({
    host: input.host,
    providerOptions: input.providerOptions,
  });
  const driverInput: RunPassInput = {
    userIntent: {
      text: input.text,
      contentBlocks: input.host.contentBlocks,
      stopContextBlock: input.host.stopContextBlock,
    },
    ports,
    priorMessages: input.host.priorMessages,
    task: input.host.task,
    provider: input.host.architectLlm.provider ?? "anthropic",
    tools: input.tools,
    budgetCoordinator: input.host.budgetCoordinator,
    onStreamChunk: input.onStreamChunk,
    abortSignal: input.abortSignal,
  };
  return runPass(driverInput);
}

export interface CodexCliPortBundleOptions {
  readonly host: ChatPanelHost;
  readonly providerOptions: CodexCliProviderPortOptions;
}

/**
 * Build a port set where the provider port is the Codex CLI wrapper.
 * Every other port is reused from the v1 wiring. Pure construction -
 * performs no I/O.
 */
export function buildCodexCliPorts(
  options: CodexCliPortBundleOptions,
): ArchitectCorePorts {
  const v1 = buildV1Ports(options.host);
  return Object.freeze({
    ...v1,
    provider: createCodexCliProviderPort(options.providerOptions),
  });
}

export interface RunPassViaCodexCliInput extends RunPassViaCoreInput {
  readonly providerOptions: CodexCliProviderPortOptions;
}

/**
 * Drive one pass through `runPass()` with the Codex CLI provider port
 * wired in. Chat routing remains a separate integration step; this
 * function exposes the provider-neutral seam for that route.
 */
export async function runPassViaCodexCli(
  input: RunPassViaCodexCliInput,
): Promise<PassResult> {
  const ports = buildCodexCliPorts({
    host: input.host,
    providerOptions: input.providerOptions,
  });
  const driverInput: RunPassInput = {
    userIntent: {
      text: input.text,
      contentBlocks: input.host.contentBlocks,
      stopContextBlock: input.host.stopContextBlock,
    },
    ports,
    priorMessages: input.host.priorMessages,
    task: input.host.task,
    provider: input.host.architectLlm.provider ?? "anthropic",
    tools: input.tools,
    budgetCoordinator: input.host.budgetCoordinator,
    onStreamChunk: input.onStreamChunk,
    abortSignal: input.abortSignal,
  };
  return runPass(driverInput);
}
