import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { engineSettingCatalogue } from '../src/config/engine-setting-catalogue.ts';
import { settingSchema } from '../src/config/setting-schema.ts';
const root = process.cwd(), check = process.argv.includes('--check');
const catalog = new Map(engineSettingCatalogue().map(entry => [entry.key, entry]));
const sources = new Map(), documented = new Map();
async function walk(directory) {
  const files = [];
  for (const entry of await fs.readdir(path.join(root, directory), {withFileTypes:true})) {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory() && !['node_modules','dist','dist-test','.git'].includes(entry.name)) files.push(...await walk(relative)); else if (entry.isFile()) files.push(relative);
  }
  return files;
}
const sourceFiles = (await Promise.all(['src','packages','explorer','extensions/vscode/src','scripts'].map(walk))).flat();
for (const file of sourceFiles.filter(file => /\.(ts|tsx|js|mjs)$/.test(file)).sort()) {
  // Git may materialize the same source with CRLF or LF. Normalize before
  // getText() so multiline expressions have byte-identical inventory output.
  const content = (await fs.readFile(path.join(root, file), 'utf8')).replace(/\r\n?/g, '\n');
  const tree = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
  function visit(node) {
    let key;
    if (ts.isPropertyAccessExpression(node) && node.expression.getText(tree) === 'process.env') key = node.name.text;
    if (ts.isElementAccessExpression(node) && node.expression.getText(tree) === 'process.env' && ts.isStringLiteral(node.argumentExpression)) key = node.argumentExpression.text;
    if (ts.isCallExpression(node) && ['engineEnvNumber','portfolioSetting'].includes(node.expression.getText(tree)) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) key = node.arguments[0].text;
    if (key && /^(DG_|DREAMGRAPH_)[A-Z0-9_]+$/.test(key)) {
      const locations = sources.get(key) ?? [];
      const at = tree.getLineAndCharacterOfPosition(node.getStart(tree));
      locations.push({file, line:at.line + 1, expression:node.parent.getText(tree).slice(0, 400)}); sources.set(key, locations);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
}
for (const file of ['README.md', 'docs/architecture.md', ...await walk('templates')].filter(file => file.endsWith('.md') || file.endsWith('engine.env'))) {
  const lines = (await fs.readFile(path.join(root, file), 'utf8')).split(/\r?\n/);
  for (let index=0; index<lines.length; index++) for (const match of lines[index].matchAll(/\b((?:DG_|DREAMGRAPH_)[A-Z0-9_]+)\b/g)) {
    const key = match[1]; if (key.endsWith('_')) continue;
    const locations = documented.get(key) ?? []; locations.push({file, line:index+1}); documented.set(key, locations);
  }
}
const missing = [...sources.keys()].filter(key => !catalog.has(key));
const missingTemplates = [...documented].filter(([key, locations]) => !catalog.has(key) && locations.some(location => location.file.startsWith('templates/'))).map(([key]) => key);
if (missing.length || missingTemplates.length) throw new Error('Configuration ownership missing: '+[...new Set([...missing,...missingTemplates])].join(', '));
const output = {
  schema:'dreamgraph.configuration_inventory.v1', precedence:['explicit deployment override/secret reference','validated persisted instance','schema/owner defaults'],
  defaults:'Source expressions and template comments below attest owner defaults; no effective credentials or running values are sampled.',
  settings:[...catalog.values()].map(({schema,decode,...entry}) => ({...entry, constraints:settingSchema(schema), consumers:sources.get(entry.key)??[], documented:documented.get(entry.key)??[], default_source: sources.get(entry.key)?.[0]??null})),
  unregistered_documentation:[...documented].filter(([key])=>!catalog.has(key)).map(([key,locations])=>({key,locations,disposition:'documentation-only name/prefix; not an editable configuration field'})),
};
const body=JSON.stringify(output,null,2)+'\n', target=path.join(root,'docs/ashoka/configuration-inventory.json');
if(check){if(await fs.readFile(target,'utf8')!==body)throw new Error('Configuration inventory drift: run npm run config:inventory');}
else await fs.writeFile(target,body);
process.stdout.write(`Configuration inventory: ${catalog.size} typed entries, ${sources.size} literal source keys, ${output.unregistered_documentation.length} documentation-only names\n`);
