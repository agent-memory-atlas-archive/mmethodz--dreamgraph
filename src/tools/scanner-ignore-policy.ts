import fs from "node:fs/promises";
import path from "node:path";
import ignore, {type Ignore} from "ignore";
import {logger} from "../utils/logger.js";

/**
 * Build the repository-root .gitignore matcher used by every scan phase.
 * Git paths are always relative POSIX paths; directories include a trailing
 * slash so directory-only patterns (for example `generated/`) behave exactly
 * as they do in Git.
 */
export async function createRootGitignoreFilter(
  repoRoot: string,
): Promise<(relativePath: string, directory?: boolean) => boolean> {
  let matcher: Ignore | null = null;
  try {
    const rules = await fs.readFile(path.join(repoRoot, ".gitignore"), "utf-8");
    matcher = ignore().add(rules);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      logger.warn(`scan_project: could not read ${path.join(repoRoot, ".gitignore")}: ${err instanceof Error ? err.message : err}`);
    }
  }

  return (relativePath: string, directory = false): boolean => {
    if (!matcher) return false;
    const normalized = relativePath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
    if (!normalized || normalized === ".") return false;
    return matcher.ignores(directory && !normalized.endsWith("/") ? `${normalized}/` : normalized);
  };
}
