import { installOfflineAdmissionFixtures } from "./helpers/offline-admission.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLlmProviderForConfig, completeWithNativeTools, type ArchitectLlmConfig } from "../src/cognitive/llm.js";
afterEach(() => vi.unstubAllGlobals());
const image = { mimeType: "image/png" as const, dataBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMv0AAAAASUVORK5CYII=" };
// Envelope tests include real durable admission; they do not test a one-second
// inference deadline. Keep a finite allowance for filesystem admission/settlement.
const config = (provider: "openai" | "anthropic", model: string): ArchitectLlmConfig => ({ provider, model, baseUrl: "https://fixture.invalid", apiKey: "fixture", temperature: 0.2, maxTokens: 100, timeoutMs: 5000, component: "architect", providerSource: "architect", modelSource: "architect" });
installOfflineAdmissionFixtures();

describe("bounded image transport", () => {
  it.each(["responses", "chat-completions", "anthropic-messages"] as const)("uses the %s native image envelope", async api => {
    const anthropic = api === "anthropic-messages";
    let body: any;
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => { body = JSON.parse(init.body); return Response.json(anthropic ? { content: [{ type: "text", text: "observed" }], stop_reason: "end_turn" } : api === "responses" ? { output_text: "observed", status: "completed" } : { choices: [{ message: { content: "observed" }, finish_reason: "stop" }] }); }));
    await createLlmProviderForConfig(config(anthropic ? "anthropic" : "openai", anthropic ? "claude-sonnet-5-5" : "gpt-4.1")).complete([{ role: "user", content: "Inspect this supplied image" }], { images: [image], ...(!anthropic ? { api } : {}) });
    const content = api === "responses" ? body.input[0].content : body.messages[0].content;
    expect(content[0]).toMatchObject({ text: "Inspect this supplied image" });
    expect(content[1].type).toBe(anthropic ? "image" : api === "responses" ? "input_image" : "image_url");
  });
  it.each(["gpt-7", "o3-mini"])("does not assume vision for %s", async model => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(createLlmProviderForConfig(config("openai", model)).complete([{ role: "user", content: "inspect" }], { images: [image] })).rejects.toThrow("PROVIDER_IMAGES_UNQUALIFIED");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("preserves supplied images in the native tool loop", async () => {
    let body: any;
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => { body = JSON.parse(init.body); return Response.json({ status: "completed", output_text: "observed" }); }));
    await completeWithNativeTools(config("openai", "gpt-6.1-sol"), [{ role: "user", content: [{ type: "text", text: "inspect" }, { type: "image", ...image }] }], []);
    expect(body.input[1].content[0]).toMatchObject({ type: "input_image", image_url: expect.stringContaining(image.dataBase64) });
  });
  it("rejects excess/invalid images before inference", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const provider = createLlmProviderForConfig(config("openai", "gpt-4.1"));
    await expect(provider.complete([{ role: "user", content: "inspect" }], { images: Array(9).fill(image) })).rejects.toThrow("PROVIDER_IMAGE_LIMIT");
    await expect(provider.complete([{ role: "user", content: "inspect" }], { images: [{ ...image, dataBase64: "https://remote.invalid" }] })).rejects.toThrow("PROVIDER_IMAGE_INVALID");
    await expect(provider.complete([], { images: [image] })).rejects.toThrow("PROVIDER_IMAGE_USER_MESSAGE_REQUIRED");
    expect(fetch).not.toHaveBeenCalled();
  });
});
