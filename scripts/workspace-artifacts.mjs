/** Shared by both installers. Package identity includes emitted bytes, not only release version. */
import { createHash } from 'node:crypto';
import { readFile, readdir, rename } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function addressWorkspaceTarball(file) {
  const absolute = resolve(file);
  if (!absolute.endsWith('.tgz')) throw new Error('WORKSPACE_TARBALL_REQUIRED');
  const hash = createHash('sha256').update(await readFile(absolute)).digest('hex');
  const name = basename(absolute).replace(/(?:-[a-f0-9]{64})?\.tgz$/, `-${hash}.tgz`);
  const addressed = join(dirname(absolute), name);
  if (absolute !== addressed) await rename(absolute, addressed);
  return name;
}

async function artifactFiles(directory, relative = '') {
  const result = new Map();
  for (const entry of await readdir(join(directory, relative), { withFileTypes: true })) {
    const key = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) for (const [name, hash] of await artifactFiles(directory, key)) result.set(name, hash);
    else if (entry.isFile()) result.set(key, createHash('sha256').update(await readFile(join(directory, key))).digest('hex'));
    else throw new Error(`WORKSPACE_ARTIFACT_NOT_REGULAR: ${key}`);
  }
  return result;
}

export async function verifyWorkspaceArtifacts(sourceRoot, installRoot) {
  const release = JSON.parse(await readFile(join(sourceRoot, 'package.json'), 'utf8')).version;
  const evidence = [];
  for (const name of ['sdk', 'host', 'token-economy']) {
    const source = join(sourceRoot, 'packages', name), installed = join(installRoot, 'node_modules', '@dreamgraph', name);
    const expected = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
    const actual = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
    for (const field of ['name', 'version', 'type', 'main', 'types', 'exports']) {
      if (JSON.stringify(actual[field]) !== JSON.stringify(expected[field])) throw new Error(`WORKSPACE_MANIFEST_MISMATCH: ${name}/${field}`);
    }
    if (actual.version !== release) throw new Error(`WORKSPACE_RELEASE_MISMATCH: ${name}`);
    const expectedFiles = await artifactFiles(join(source, 'dist')), actualFiles = await artifactFiles(join(installed, 'dist'));
    if (!expectedFiles.size || expectedFiles.size !== actualFiles.size) throw new Error(`WORKSPACE_ARTIFACT_SET_MISMATCH: ${name}`);
    for (const [file, hash] of expectedFiles) {
      if (actualFiles.get(file) !== hash) throw new Error(`WORKSPACE_ARTIFACT_MISMATCH: ${name}/dist/${file}`);
    }
    evidence.push({ name: actual.name, version: actual.version, files: actualFiles.size });
  }
  // Load the actual installed ESM consumer: version output alone never loaded the daemon's imports.
  const consumer = await import(pathToFileURL(join(installRoot, 'dist', 'utils', 'mcp-result.js')).href);
  if (typeof consumer.boundedMachineResult !== 'function') throw new Error('DAEMON_MACHINE_RESULT_EXPORT_MISSING');
  return evidence;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv[2] === 'address' && process.argv.length === 4) console.log(await addressWorkspaceTarball(process.argv[3]));
    else if (process.argv[2] === 'verify' && process.argv.length === 5) console.log(JSON.stringify(await verifyWorkspaceArtifacts(process.argv[3], process.argv[4])));
    else throw new Error('Usage: workspace-artifacts.mjs address <tarball> | verify <source> <installation>');
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
