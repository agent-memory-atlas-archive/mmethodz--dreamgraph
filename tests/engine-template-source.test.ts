import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readEngineTemplateSource } from "../src/config/engine-template-source.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

it("reads the global install's sibling templates when bin has none", async () => {
  const masterDir = await mkdtemp(join(tmpdir(), "dg-template-installed-"));
  roots.push(masterDir);
  const packageRoot = join(masterDir, "bin");
  const templateDir = join(masterDir, "templates", "default", "config");
  await mkdir(templateDir, { recursive: true });
  await writeFile(join(templateDir, "engine.env"), "DREAMGRAPH_LLM_MODEL=gpt-4.1\n");
  expect(await readEngineTemplateSource("default", packageRoot, masterDir)).toBe("DREAMGRAPH_LLM_MODEL=gpt-4.1\n");
});

it("retains source and packaged layouts where templates sit beside dist", async () => {
  const masterDir = await mkdtemp(join(tmpdir(), "dg-template-source-"));
  roots.push(masterDir);
  const packageRoot = join(masterDir, "package");
  const templateDir = join(packageRoot, "templates", "ollama", "config");
  await mkdir(templateDir, { recursive: true });
  await writeFile(join(templateDir, "engine.env"), "DREAMGRAPH_LLM_PROVIDER=ollama\n");
  expect(await readEngineTemplateSource("ollama", packageRoot, masterDir)).toBe("DREAMGRAPH_LLM_PROVIDER=ollama\n");
});
