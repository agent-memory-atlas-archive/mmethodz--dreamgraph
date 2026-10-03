/** Portable compiled-suite discovery; shell wildcards do not work consistently on Windows. */
import {readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const directory=fileURLToPath(new URL('../extensions/vscode/dist/test/',import.meta.url));
const workspace=fileURLToPath(new URL('../extensions/vscode/',import.meta.url));
const files=(await readdir(directory)).filter(name=>name.endsWith('.test.js')).sort().map(name=>resolve(directory,name));
if(!files.length)throw new Error('ASHOKA_COMPILED_EDITOR_TESTS_MISSING');
const child=spawn(process.execPath,['--test',...files],{cwd:workspace,windowsHide:true,stdio:'inherit'});
child.once('error',()=>{process.exitCode=1;});
child.once('close',(code,signal)=>{process.exitCode=signal?1:code??1;});
