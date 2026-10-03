import { providerCapability, type ProviderCapability } from "../config/provider-capabilities.js";
export interface LlmImage { mimeType: "image/png" | "image/jpeg" | "image/webp"; dataBase64: string }
/** Attachments are caller-supplied evidence; this boundary never fetches external URLs. */
export function validateProviderImages(provider: string, model: string, images: readonly LlmImage[], override?: ProviderCapability): void {
  if (!images.length) return;
  if (!providerCapability(provider, model, override)?.images) throw new Error("PROVIDER_IMAGES_UNQUALIFIED");
  if (images.length > 8) throw new Error("PROVIDER_IMAGE_LIMIT");
  let bytes = 0;
  for (const image of images) {
    if (!["image/png", "image/jpeg", "image/webp"].includes(image.mimeType) || !image.dataBase64 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image.dataBase64)) throw new Error("PROVIDER_IMAGE_INVALID");
    bytes += Buffer.byteLength(image.dataBase64, "base64");
  }
  if (bytes > 10 * 1024 * 1024) throw new Error("PROVIDER_IMAGE_LIMIT");
}
export function providerImageContent(text: string, images: readonly LlmImage[], api: "responses" | "chat-completions" | "anthropic-messages"): unknown {
  if (!images.length) return text;
  return api === "anthropic-messages" ? [{ type: "text", text }, ...images.map(image => ({ type: "image", source: { type: "base64", media_type: image.mimeType, data: image.dataBase64 } }))]
    : [{ type: api === "responses" ? "input_text" : "text", text }, ...images.map(image => api === "responses"
      ? { type: "input_image", image_url: `data:${image.mimeType};base64,${image.dataBase64}` }
      : { type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.dataBase64}` } })];
}
