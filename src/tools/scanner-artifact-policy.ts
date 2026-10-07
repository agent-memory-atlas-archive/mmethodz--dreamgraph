import path from "node:path";
import { classifyAuxiliaryFile } from "./auxiliary-classifier.js";

const GENERATED_DIRECTORY_NAMES = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "dist-test",
  "build",
  "out",
  "target",
  "bin",
  "obj",
  "coverage",
  ".nyc_output",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".cache",
  ".parcel-cache",
  ".sass-cache",
  ".gradle",
  ".mvn",
  "cmake-build-debug",
  "cmake-build-release",
  "tmp",
  "temp",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".venv",
  "venv",
  ".tox",
  ".nox",
  ".dart_tool",
  ".idea",
  ".vs",
]);

const GENERATED_PATH_SEGMENTS = [
  "/dist/",
  "/dist-test/",
  "/build/",
  "/out/",
  "/target/",
  "/bin/",
  "/obj/",
  "/coverage/",
  "/tmp/",
  "/temp/",
  "/.next/",
  "/.nuxt/",
  "/.svelte-kit/",
  "/.turbo/",
  "/.cache/",
  "/.parcel-cache/",
  "/.sass-cache/",
  "/.gradle/",
  "/cmake-build-debug/",
  "/cmake-build-release/",
  "/__pycache__/",
  "/.pytest_cache/",
  "/.mypy_cache/",
  "/.ruff_cache/",
  "/.venv/",
  "/venv/",
  "/.tox/",
  "/.nox/",
  "/.dart_tool/",
];

const GENERATED_PATH_SUFFIXES = [
  "/dist",
  "/dist-test",
  "/build",
  "/out",
  "/target",
  "/bin",
  "/obj",
  "/coverage",
  "/tmp",
  "/temp",
  "/.next",
  "/.nuxt",
  "/.svelte-kit",
  "/.turbo",
  "/.cache",
  "/.parcel-cache",
  "/.sass-cache",
  "/.gradle",
  "/cmake-build-debug",
  "/cmake-build-release",
  "/__pycache__",
  "/.pytest_cache",
  "/.mypy_cache",
  "/.ruff_cache",
  "/.venv",
  "/venv",
  "/.tox",
  "/.nox",
  "/.dart_tool",
];

export interface ScanDirectoryPolicyInput {
  repoRoot: string;
  absDir: string;
  entryName: string;
}

function normalizeRelativeDir(repoRoot: string, absDir: string): string {
  const relDir = path.relative(repoRoot, absDir).replace(/\\/g, "/");
  if (!relDir || relDir === ".") return "";
  return `/${relDir.toLowerCase()}`;
}

export function shouldSkipScanDirectory({ repoRoot, absDir, entryName }: ScanDirectoryPolicyInput): boolean {
  const normalizedName = entryName.toLowerCase();
  if (normalizedName.startsWith(".")) {
    return true;
  }

  if (GENERATED_DIRECTORY_NAMES.has(normalizedName)) {
    return true;
  }

  const normalizedRelDir = normalizeRelativeDir(repoRoot, absDir);
  if (!normalizedRelDir) {
    return false;
  }

  const pathSegments = normalizedRelDir.split("/").filter(Boolean);
  if (pathSegments.some(segment => GENERATED_DIRECTORY_NAMES.has(segment))) {
    return true;
  }

  if (GENERATED_PATH_SEGMENTS.some(segment => normalizedRelDir.includes(segment))) {
    return true;
  }

  if (GENERATED_PATH_SUFFIXES.some(suffix => normalizedRelDir.endsWith(suffix))) {
    return true;
  }

  return false;
}

/** File extensions the project scanner reads as source code. */
export const SCANNED_CODE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".rb", ".go", ".rs", ".java", ".kt", ".kts", ".cs",
  ".c", ".cc", ".cpp", ".cxx", ".h", ".hh", ".hpp", ".hxx",
  ".swift",
  ".vue", ".svelte", ".xaml", ".razor",
  ".gradle",
]);

/**
 * Whether the project scanner tracks this file (code or auxiliary file outside skipped/generated directories).
 * Used for source effects made outside DreamGraph's file tools (e.g. a file the browser saves): only files the scanner
 * tracks get a source obligation. Gitignore rules are not applied here.
 */
export function isScannerTrackedFile(repoRoot: string, absFile: string): boolean {
  const rel = path.relative(repoRoot, absFile).replace(/\\/g, "/");
  if (!rel || rel.startsWith("../") || rel === ".." || path.isAbsolute(rel)) return false;
  const parts = rel.split("/");
  const name = parts[parts.length - 1];
  let dir = repoRoot;
  for (const segment of parts.slice(0, -1)) {
    dir = path.join(dir, segment);
    if (shouldSkipScanDirectory({ repoRoot, absDir: dir, entryName: segment })) return false;
  }
  return SCANNED_CODE_EXTENSIONS.has(path.extname(name).toLowerCase()) || classifyAuxiliaryFile(rel, name) !== null;
}
