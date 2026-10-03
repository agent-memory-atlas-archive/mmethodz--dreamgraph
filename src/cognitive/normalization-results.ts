/** Full immutable outcomes live beside the atomic stores; receipts remain small. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dataPath } from "../utils/paths.js";
import { stripBom } from "../utils/read-json.js";
import { publicationContentHash } from "../graph/publication.js";
import type { OperationReceipt } from "../graph/contracts.js";

export const NORMALIZATION_RESULT_LIMIT = 16 * 1024 * 1024;
export const normalizationResultFile = (operation: string): string => `normalization-result-${createHash("sha256").update(operation).digest("hex")}.json`;
export async function readNormalizationResult(receipt: OperationReceipt): Promise<Record<string, unknown>> {
  const result = receipt.result as Record<string, unknown> | undefined;
  if (!result || receipt.actor !== "normalizer") throw new Error("NORMALIZATION_RESULT_UNAVAILABLE");
  if (!result.result_file) return result; // Original small inline outcomes remain readable.
  const file = normalizationResultFile(receipt.operation_id);
  if (result.result_file !== file || !receipt.affected_files.includes(file)) throw new Error("NORMALIZATION_RESULT_RECEIPT_MISMATCH");
  const body = await readFile(dataPath(file), "utf8");
  if (Buffer.byteLength(body) > NORMALIZATION_RESULT_LIMIT || publicationContentHash(body) !== result.result_hash) throw new Error("NORMALIZATION_RESULT_HASH_MISMATCH");
  const parsed = JSON.parse(stripBom(body));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("NORMALIZATION_RESULT_INVALID");
  return parsed;
}
