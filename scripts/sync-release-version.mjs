import { readFile, writeFile } from 'node:fs/promises';
const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error('Usage: sync-release-version.mjs <version>');
const manifests = ['package.json', 'packages/sdk/package.json', 'packages/host/package.json',
  'packages/token-economy/package.json', 'explorer/package.json', 'extensions/vscode/package.json'];
const old = JSON.parse(await readFile('package.json', 'utf8')).version;
for (const file of manifests) {
  const pkg = JSON.parse(await readFile(file, 'utf8')); pkg.version = version;
  for (const group of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const name of Object.keys(pkg[group] ?? {})) {
      if (name.startsWith('@dreamgraph/') && pkg[group][name] === old) pkg[group][name] = version;
    }
  }
  await writeFile(file, JSON.stringify(pkg, null, 2) + '\n');
}
for (const file of ['package-lock.json', 'explorer/package-lock.json', 'extensions/vscode/package-lock.json']) {
  const lock = JSON.parse(await readFile(file, 'utf8')); lock.version = version;
  for (const [path, pkg] of Object.entries(lock.packages)) {
    if (path === '' || /^(?:packages\/(?:sdk|host|token-economy)|(?:\.\.\/)*packages\/(?:sdk|host|token-economy)|node_modules\/@dreamgraph\/(?:sdk|host|token-economy))$/.test(path)) {
      if (pkg.version) pkg.version = version;
    }
    for (const group of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      for (const name of Object.keys(pkg[group] ?? {})) if (name.startsWith('@dreamgraph/') && pkg[group][name] === old) pkg[group][name] = version;
    }
  }
  await writeFile(file, JSON.stringify(lock, null, 2) + '\n');
}
for (const file of ['src/cli/version.ts', 'extensions/vscode/src/version.ts']) {
  await writeFile(file, (await readFile(file, 'utf8')).replace(old, version));
}
const prompt = 'extensions/vscode/src/prompts/architect-core.ts';
if (version === '14.0.0') await writeFile('src/cli/version.ts', (await readFile('src/cli/version.ts', 'utf8')).replace('CLI_RELEASE_NAME = "Glass Atlas"', 'CLI_RELEASE_NAME = "Ashoka"'));
await writeFile(prompt, (await readFile(prompt, 'utf8')).replace('v' + old + ' Glass Atlas', 'v' + version + ' Ashoka'));
console.log('Synchronized product versions to ' + version + '; schema versions unchanged.');
