/** Core owns provider evidence/outcomes. Consumers use generated artifacts; --check detects drift. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { providerCapabilityRecords, PROVIDER_CAPABILITY_VERSION } from '../src/config/provider-capabilities.ts';
const root = resolve(import.meta.dirname, '..');
const banner = '// Generated from core provider contracts. Run npm run providers:generate; do not edit.\n';
const records = providerCapabilityRecords();
const manifest = banner + `export const PROVIDER_CAPABILITY_VERSION = ${JSON.stringify(PROVIDER_CAPABILITY_VERSION)};\n`
  + `export const PROVIDER_CAPABILITIES = ${JSON.stringify(records, null, 2)} as const;\n`
  + `export type ProviderCapabilityRecord = (typeof PROVIDER_CAPABILITIES)[number] & { tool_api_efforts?: Record<string, readonly string[] | null> };\n`
  + `export function resolveProviderCapability(provider: string, model: string): ProviderCapabilityRecord | null { return PROVIDER_CAPABILITIES.find(value => value.provider === provider && value.model === model.toLowerCase()) ?? null; }\n`;
const source = await readFile(resolve(root, 'src/cognitive/provider-outcome.ts'), 'utf8');
const outcome = banner + source.replace('import type { LlmCompletionOptions, TokenUsage } from "./llm.js";',
  'export interface TokenUsage { inputTokens?: number; outputTokens?: number; totalTokens?: number; cachedInputTokens?: number; cacheCreationInputTokens?: number; reasoningTokens?: number }\n'
  + 'interface LlmCompletionOptions { jsonMode?: boolean; jsonSchema?: { name: string; schema: Record<string, unknown> } }');
let changed = false;
for (const [path, text] of [
  ['packages/sdk/src/provider-capabilities.ts', manifest],
  ['extensions/vscode/src/generated/provider-capabilities.ts', manifest],
  ['extensions/vscode/src/generated/provider-outcome.ts', outcome],
]) {
  const absolute = resolve(root, path), existing = await readFile(absolute, 'utf8').catch(() => null);
  if (existing === text) continue;
  if (process.argv.includes('--check')) { console.error('Provider contract drift: ' + path); changed = true; }
  else { await mkdir(dirname(absolute), { recursive: true }); await writeFile(absolute, text); }
}
if (changed) process.exitCode = 1;
