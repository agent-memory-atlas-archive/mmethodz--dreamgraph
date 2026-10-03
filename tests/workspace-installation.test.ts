import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, cp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { addressWorkspaceTarball } from "../scripts/workspace-artifacts.mjs";

const run = promisify(execFile);
const npmCli = process.env.npm_execpath ? join(dirname(process.env.npm_execpath), "npm-cli.js") : join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
let fixture: string;
afterEach(async () => { if (fixture) await rm(fixture, { recursive: true, force: true }); });

it("refreshes changed workspace bytes at the same release and rejects a stale installed daemon dependency", async () => {
  fixture = await mkdtemp(join(tmpdir(), "dg-workspace-install-"));
  const source = join(fixture, "source"), bin = join(fixture, "bin"), vendor = join(bin, "vendor");
  await mkdir(vendor, { recursive: true });
  const release = JSON.parse(await readFile("package.json", "utf8")).version;
  await mkdir(source, { recursive: true });
  await writeFile(join(source, "package.json"), JSON.stringify({ version: release }));
  await mkdir(join(bin, "dist/utils"), { recursive: true });
  await cp("dist/utils/mcp-result.js", join(bin, "dist/utils/mcp-result.js"));
  const dependencies: Record<string, string> = {};
  const pack = async (name: string) => {
    const directory = join(source, "packages", name);
    const result = await run(process.execPath, [npmCli, "pack", "--json", "--pack-destination", vendor, "--ignore-scripts"], { cwd: directory });
    const filename = JSON.parse(result.stdout)[0].filename;
    return `file:./vendor/${await addressWorkspaceTarball(join(vendor, filename))}`;
  };
  for (const name of ["sdk", "host", "token-economy"]) {
    const directory = join(source, "packages", name);
    await cp(join("packages", name, "dist"), join(directory, "dist"), { recursive: true });
    const manifest = JSON.parse(await readFile(join("packages", name, "package.json"), "utf8"));
    manifest.dependencies = {}; // Offline packaging fixture; no registry or native postinstall work.
    await writeFile(join(directory, "package.json"), JSON.stringify(manifest));
    if (name === "token-economy") await writeFile(join(directory, "dist/index.js"), "exports.compressToolResult = () => {};\n");
    dependencies[manifest.name] = await pack(name);
  }
  const install = async () => {
    await writeFile(join(bin, "package.json"), JSON.stringify({ type: "module", dependencies }));
    await run(process.execPath, [npmCli, "install", "--offline", "--ignore-scripts", "--omit=dev", "--package-lock=false", "--no-audit", "--no-fund"], { cwd: bin });
  };
  const verify = () => run(process.execPath, ["scripts/workspace-artifacts.mjs", "verify", source, bin]);
  await install();
  await expect(verify()).rejects.toThrow(/Named export 'boundMachineResult' not found|does not provide an export named 'boundMachineResult'/);
  const prior = dependencies["@dreamgraph/token-economy"];
  await cp("packages/token-economy/dist/index.js", join(source, "packages/token-economy/dist/index.js"));
  dependencies["@dreamgraph/token-economy"] = await pack("token-economy");
  expect(dependencies["@dreamgraph/token-economy"]).not.toBe(prior);
  await install(); // Preserve node_modules; exactly the same release, a changed file: identity.
  expect(JSON.parse((await verify()).stdout)).toHaveLength(3);
  await writeFile(join(bin, "node_modules/@dreamgraph/token-economy/dist/index.js"), "exports.compressToolResult = () => {};\n");
  await expect(verify()).rejects.toThrow("WORKSPACE_ARTIFACT_MISMATCH: token-economy/dist/index.js");
}, 60000);
