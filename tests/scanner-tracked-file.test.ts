/** Which files get a source obligation when something other than DreamGraph's tools writes them: the scanner's own rule. */
import { describe, expect, it } from "vitest";
import { isScannerTrackedFile } from "../src/tools/scanner-artifact-policy.js";

const ROOT = "C:/Users/Mika Jussila/source/repos/vice-3.10/build/web/react";
const tracked = (file: string) => isScannerTrackedFile(ROOT, `${ROOT}/${file}`);

describe("isScannerTrackedFile", () => {
  it("tracks code and auxiliary files the scanner reads", () => {
    for (const file of ["src/App.tsx", "web64-ide/browser-files.mjs", "package.json", "config/app.yml"]) expect({ file, tracked: tracked(file) }).toEqual({ file, tracked: true });
  });

  it("ignores application artifacts, unscanned types and generated or hidden folders", () => {
    for (const file of ["hello-world.web64proj", "README.md", "dist/x.js", "temp/a.ts", "node_modules/a/b.js", ".git/x.ts"]) expect({ file, tracked: tracked(file) }).toEqual({ file, tracked: false });
  });

  it("judges only the part inside the repository (a 'build' in the root path does not matter)", () => {
    expect(tracked("src/main.ts")).toBe(true);
    expect(isScannerTrackedFile(ROOT, "C:/elsewhere/src/main.ts")).toBe(false);
  });
});
