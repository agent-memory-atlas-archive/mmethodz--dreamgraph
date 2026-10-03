/** Private fallback identity for a runtime without a named instance UUID. Persisted mismatches are never rewritten. */
import {createHash} from "node:crypto";
export function directoryInstanceId(directory:string){return `directory:${createHash("sha256").update(directory,"utf8").digest("hex")}`;}
