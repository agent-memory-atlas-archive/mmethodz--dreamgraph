/** Shared compiled production loader for root and editor qualification. */
import {createRequire} from 'node:module';
const shared=createRequire(import.meta.url)('./compiled-editor.cjs');
export function compiledEditor():any{return shared.compiledEditor();}
