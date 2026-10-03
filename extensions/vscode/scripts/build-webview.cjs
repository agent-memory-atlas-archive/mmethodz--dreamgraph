/** Assemble trusted repository script generators during build, never in the CSP-bound browser. */
const {buildSync}=require('esbuild');
const {resolve}=require('node:path');
const root=resolve(__dirname,'..');
const compiled=buildSync({entryPoints:[resolve(root,'src/webview/index.ts')],bundle:true,write:false,platform:'node',format:'cjs',target:'node18'});
const generator={exports:{}};
// This runs only at build time over local repository code. Model/user content is never an input.
new Function('module','exports',compiled.outputFiles[0].text)(generator,generator.exports);
const source=generator.exports.getWebviewSource();
buildSync({stdin:{contents:source,loader:'js',sourcefile:'assembled-webview.js'},outfile:resolve(root,'dist/webview.js'),
 bundle:false,format:'iife',platform:'browser',target:'es2020',logLevel:'info'});
