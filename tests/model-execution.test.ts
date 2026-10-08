import { describe, expect, it, vi, afterEach } from "vitest";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createLlmProviderForConfig,completeWithNativeTools,getRoleModelPolicy } from "../src/cognitive/llm.js";
import {withEngineJob,EngineJobs} from "../src/cognitive/jobs.js";
import {DaemonHttpAuthority} from "../src/server/http-authority.js";
import {HostModelAdmission} from "../src/server/host-model-admission.js";
import { ModelAdmission } from "../src/cognitive/model-admission.js";
import { nativeCliModelExecution } from "../src/cognitive/model-execution.js";
import { getDataDir } from "../src/utils/paths.js";
import { installOfflineAdmissionFixtures } from "./helpers/offline-admission.js";

installOfflineAdmissionFixtures();
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const config = { provider: "openai" as const, model: "gpt-4.1", baseUrl: "https://offline.invalid/v1", apiKey: "fixture",
  temperature: .2, maxTokens: 100, timeoutMs: 10000 };
const messages = [{ role: "user" as const, content: "Classify supplied fixture" }];
const ledger = async () => JSON.parse(await readFile(`${getDataDir()}/spend_ledger.json`, "utf8"));
const answer = (extra = {}) => Response.json({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }], ...extra });

describe("physical inference admission", () => {
  it("admits explicit CLI Default without restoring an incompatible saved effort", async () => {
    vi.stubEnv("DREAMGRAPH_LLM_ARCHITECT_REASONING_EFFORT", "xhigh");
    const execution = await nativeCliModelExecution({...config,provider:"none"}, "claude-cli", "claude-opus-4-6", undefined);
    const dispatch = vi.fn(async()=>({result:"done",acknowledged:true,usage:{inputTokens:1,outputTokens:1}}));
    expect(await execution.request({provider:"none",model:"claude-opus-4-6",payload:"fixture",output_tokens:10},dispatch)).toBe("done");
    expect(dispatch).toHaveBeenCalledOnce();
    const refused = await nativeCliModelExecution({...config,provider:"none"}, "claude-cli", "claude-opus-4-6", "xhigh");
    await expect(refused.request({provider:"none",model:"claude-opus-4-6",payload:"fixture",output_tokens:10},dispatch)).rejects.toThrow("ADMISSION_ROLE_POLICY_BLOCKED");
    expect(dispatch).toHaveBeenCalledOnce();
  });
  it("native computer-role tools share the actual job and role allocation instead of the Architect route",async()=>{
    vi.stubEnv("DREAMGRAPH_INSTANCE_UUID","");const instance=new EngineJobs().instance_id;
    expect(new DaemonHttpAuthority(1,{}).sessions.instance_id).toBe(instance);expect(new HostModelAdmission("fixture",new Date(Date.now()+30000).toISOString(),new AbortController().signal).instanceId).toBe(instance);
    const computer=await getRoleModelPolicy("computer_use",{provider:"openai",model:"gpt-4.1",base_url:config.baseUrl,api:"chat_completions",output_tokens:100,timeout_ms:10000});
    const architect=await getRoleModelPolicy("architect",{provider:"openai",model:"gpt-5.5",base_url:config.baseUrl,api:"responses"});
    const fetch=vi.fn(async()=>answer({model:"gpt-4.1",usage:{prompt_tokens:20,completion_tokens:3}}));vi.stubGlobal("fetch",fetch);
    const result=await withEngineJob({operation_id:"computer-native-model",action:"qualification-fixture",owner:"fixture",scope:["controlled-target"],
      role_policies:{computer_use:computer,architect},budget:computer.policy.budget},signal=>completeWithNativeTools({...config,component:"architect",providerSource:"computer_use",modelSource:"computer_use",admissionPolicy:computer},messages,[],{signal}));
    expect(result.text).toBe("{}");expect(fetch).toHaveBeenCalledOnce();const state=await ledger(),attempt=Object.values(state.attempts)[0] as any;
    expect(attempt.policy_fingerprint).toBe(computer.fingerprint);expect(state.runs[attempt.run_id].parent_run_id).toMatch(/^job:/);expect(attempt.state).toBe("settled");
  });
  it("makes no HTTP request for zero allocation, unpriced API or context/reasoning bounds", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    vi.stubEnv("DREAMGRAPH_LLM_ENRICHMENT_RUN_BUDGET", "0");
    await expect(createLlmProviderForConfig(config).complete(messages)).rejects.toThrow("ZERO_PAID_ALLOCATION");
    vi.stubEnv("DREAMGRAPH_LLM_ENRICHMENT_RUN_BUDGET", "10"); vi.stubEnv("DREAMGRAPH_LLM_PRICING", "[]");
    await expect(createLlmProviderForConfig(config).complete(messages)).rejects.toThrow("EXACT_PRICING_REQUIRED");
    vi.stubEnv("DREAMGRAPH_LLM_ENRICHMENT_CONTEXT_TOKENS", "100");
    await expect(createLlmProviderForConfig(config).complete(messages)).rejects.toThrow("CONTEXT_LIMIT");
    vi.stubEnv("DREAMGRAPH_LLM_ENRICHMENT_CONTEXT_TOKENS", "32768"); vi.stubEnv("DREAMGRAPH_LLM_ENRICHMENT_MAX_REASONING_TOKENS", "0");
    await expect(createLlmProviderForConfig({ ...config, model: "gpt-6.1-sol" }).complete(messages)).rejects.toThrow("REASONING_TOKENS_LIMIT");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("preserves refusal usage and bounds a continued run even with another provider object", async () => {
    vi.stubEnv("DREAMGRAPH_LLM_ENRICHMENT_MAX_CALLS", "1");
    const fetch = vi.fn(async () => Response.json({ choices: [{ message: { refusal: "declined", content: "" }, finish_reason: "content_filter" }],
      usage: { prompt_tokens: 20, completion_tokens: 3 } })); vi.stubGlobal("fetch", fetch);
    await expect(createLlmProviderForConfig(config).complete(messages, { admissionRunId: "stable-job" })).rejects.toThrow("PROVIDER_REFUSAL");
    await expect(createLlmProviderForConfig(config).complete(messages, { admissionRunId: "stable-job" })).rejects.toThrow("REQUEST_LIMIT");
    const attempts = Object.values((await ledger()).attempts) as any[];
    expect(attempts).toHaveLength(1); expect(attempts[0]).toMatchObject({ state: "settled", usage: { inputTokens: 20, outputTokens: 3 }, acknowledged: true });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("counts schema fallback as an admitted retry and cannot dispatch it with zero retry allocation", async () => {
    vi.stubEnv("DREAMGRAPH_LLM_ENRICHMENT_MAX_RETRIES", "0");
    const fetch = vi.fn(async () => Response.json({ error: { message: "response_format json_schema unsupported" } }, { status: 400 }));
    vi.stubGlobal("fetch", fetch);
    await expect(createLlmProviderForConfig(config).complete(messages, { jsonSchema: { name: "fixture", schema: { type: "object" } }, schemaFallback: "local_validation" })).rejects.toThrow("RETRY_LIMIT");
    expect(fetch).toHaveBeenCalledOnce();
    const attempts = Object.values((await ledger()).attempts) as any[];
    expect(attempts[0]).toMatchObject({ state: "uncertain", acknowledged: true, usage: null });
    expect(attempts[0].accounted_nanounits).toBe(attempts[0].reserved_nanounits);
  });
  it("retains a cancelled request liability and prevents overlapping account work", async () => {
    let actualSignal: AbortSignal | undefined;
    let ready!:()=>void;const dispatched=new Promise<void>(resolve=>ready=resolve);
    const fetch = vi.fn((_url, init) => new Promise<Response>((_resolve, reject) => { actualSignal = init.signal;
      actualSignal!.addEventListener("abort", () => reject(actualSignal!.reason), { once: true });ready(); })); vi.stubGlobal("fetch", fetch);
    const controller = new AbortController(), first = createLlmProviderForConfig(config).complete(messages, { signal: controller.signal });
    await Promise.race([dispatched,first.then(()=>{throw new Error("Unexpected response before cancellation fixture dispatch");})]);
    controller.abort(new Error("cancelled")); await expect(first).rejects.toThrow("cancelled");
    await expect(createLlmProviderForConfig(config).complete(messages)).rejects.toThrow("CONCURRENCY_LIMIT");
    const attempts = Object.values((await ledger()).attempts) as any[];
    expect(attempts[0]).toMatchObject({ state: "uncertain", acknowledged: false, usage: null }); expect(fetch).toHaveBeenCalledOnce();
  });
  it("records usage before rejecting malformed output and blocks measured reservation variance", async () => {
    const fetch = vi.fn(async () => answer({ usage: { prompt_tokens: 99999, completion_tokens: 101, completion_tokens_details: { reasoning_tokens: 10 } } })); vi.stubGlobal("fetch", fetch);
    await expect(createLlmProviderForConfig(config).complete(messages, { jsonSchema: { name: "invalid_shape", schema: { type: "array" } } })).rejects.toThrow("PROVIDER_OUTPUT_INVALID");
    await expect(createLlmProviderForConfig(config).complete(messages)).rejects.toThrow("BILLING_VARIANCE_REQUIRES_REVIEW");
    const attempt = Object.values((await ledger()).attempts)[0] as any;
    expect(attempt.usage.outputTokens).toBe(101); expect(attempt.variance).toContain("output_tokens_exceeded_reservation"); expect(fetch).toHaveBeenCalledOnce();
  });
  it("bounds simultaneous factories through one ledger and never turns an unknown reply into zero usage", async () => {
    let unblock!: () => void;
    const gate = new Promise<void>(resolve => { unblock = resolve; });let ready!:()=>void;const dispatched=new Promise<void>(resolve=>ready=resolve);
    const fetch = vi.fn(async () => { ready(); await gate; return answer(); }); vi.stubGlobal("fetch", fetch);
    const a = createLlmProviderForConfig(config).complete(messages);
    await Promise.race([dispatched,a.then(()=>{throw new Error("Unexpected response before overlap fixture dispatch");})]);
    await expect(createLlmProviderForConfig(config).complete(messages)).rejects.toThrow("CONCURRENCY_LIMIT");
    unblock(); await a;
    const attempt = Object.values((await ledger()).attempts)[0] as any;
    expect(attempt).toMatchObject({ state: "uncertain", usage: null, acknowledged: true });
    const directory = getDataDir(), service = new ModelAdmission(`directory:${createHash("sha256").update(directory).digest("hex")}`, directory);
    expect((await service.inspect()).attempts[attempt.id].reserved_nanounits).toBe(attempt.accounted_nanounits);
  });
});
