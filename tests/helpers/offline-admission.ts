/** Explicit synthetic allocation for mocked inference tests; never a production admission bypass. */
import { beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { providerCapabilityRecords } from "../../src/config/provider-capabilities.js";
import { MODEL_ROLES, roleEnvKey } from "../../src/config/role-env-fields.js";
import { getDataDir, setDataDirOverride } from "../../src/utils/paths.js";
import { releaseGraphWriter } from "../../src/graph/writer-lease.js";

export function installOfflineAdmissionFixtures(options: { directory?: boolean } = {}) {
  let root: string | undefined, previous: string, originals: Record<string, string | undefined>;
  beforeEach(async () => {
    originals = {};
    const values: Record<string, string> = { DREAMGRAPH_LLM_PRICING: JSON.stringify(providerCapabilityRecords().map(record => ({
      provider: record.provider, model: record.model, currency: "USD", version: "offline-fixture.v1", source: "synthetic mocked inference fixture; not provider prices",
      input_per_million: 1, output_per_million: 1, input_includes_images: true, output_includes_reasoning: true }))) };
    for (const role of MODEL_ROLES) for (const [suffix, value] of Object.entries({ RUN_BUDGET: "10", DAY_BUDGET: "10", PRICING_VERSION: "offline-fixture.v1" })) values[roleEnvKey(role, suffix)] = value;
    for (const [key, value] of Object.entries(values)) { originals[key] = process.env[key]; process.env[key] = value; }
    if (options.directory !== false) { previous = getDataDir(); root = await mkdtemp(join(tmpdir(), "dg-offline-inference-")); setDataDirOverride(root); }
  });
  afterEach(async () => {
    for (const [key, value] of Object.entries(originals)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    if (root) { await releaseGraphWriter(root); setDataDirOverride(previous); await rm(root, { recursive: true, force: true }); root = undefined; }
  });
}
