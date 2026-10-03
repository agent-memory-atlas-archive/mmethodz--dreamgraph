import {readFile} from 'node:fs/promises';
import {resolve,basename} from 'node:path';
import {setDataDirOverride} from '../src/utils/paths.ts';
import {captureAnalyticsSnapshot} from '../src/observability/analytics-snapshot.ts';
import {STORE_REGISTRY} from '../src/graph/store-registry.ts';
import {atomicWriteFile} from '../src/utils/atomic-write.ts';
const option=name=>{const at=process.argv.indexOf(name);return at<0?null:process.argv[at+1];};
const directory=option('--data-dir'),output=option('--output');
if(!directory||!output)throw new Error('Usage: node --import tsx scripts/export-analytics-snapshot.mjs --data-dir <instance data> --output <snapshot.json>');
setDataDirOverride(resolve(directory));
if(basename(output) in STORE_REGISTRY||['publication_state.json','reconciliation_journal.json'].includes(basename(output)))throw Error('ANALYTICS_AUTHORITY_TARGET_FORBIDDEN');
try{if(JSON.parse(await readFile(resolve(output),'utf8')).schema!=='dreamgraph.analytics_export.v1')throw Error('ANALYTICS_OUTPUT_REPLACEMENT_DENIED');}catch(error){if(error.code!=='ENOENT')throw error;}
const snapshot=await captureAnalyticsSnapshot();await atomicWriteFile(resolve(output),JSON.stringify(snapshot));
console.log(`Saved coherent analytics export: ${resolve(output)}`);
