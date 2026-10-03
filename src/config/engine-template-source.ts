import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export type EngineTemplateName = "default" | "ollama" | "lmstudio";

/** Source/npm packages keep templates beside dist; the global installer keeps them beside bin. */
export async function readEngineTemplateSource(
  name: EngineTemplateName,
  packageRoot: string,
  masterDir: string,
): Promise<string> {
  if (name !== "default" && name !== "ollama" && name !== "lmstudio") {
    throw new Error("ENGINE_TEMPLATE_UNKNOWN");
  }
  const paths = [
    resolve(packageRoot, "templates", name, "config", "engine.env"),
    resolve(masterDir, "templates", name, "config", "engine.env"),
  ];
  for (const path of new Set(paths)) {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  throw new Error(`ENGINE_TEMPLATE_NOT_FOUND: ${paths.join(", ")}`);
}
