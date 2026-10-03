/** Qualification-only frozen wall clock, loading the original worker with no browser or input. */
import {pathToFileURL} from 'node:url';
const value=Number(process.argv[3]);if(!Number.isFinite(value))throw new Error('Fixture clock required');
Date.now=()=>value;
await import(pathToFileURL(process.argv[2]).href);
