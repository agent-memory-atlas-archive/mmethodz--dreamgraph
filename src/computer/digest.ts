/** Pure descriptor hashing. Workers must not import daemon configuration or its graph owners. */
import {createHash} from "node:crypto";
const stable=(v:unknown):string=>v===null||typeof v!=="object"?JSON.stringify(v):Array.isArray(v)?`[${v.map(stable).join(",")}]`
  :`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${stable((v as Record<string,unknown>)[k])}`).join(",")}}`;
export const computerDigest=(value:unknown)=>"sha256:"+createHash("sha256").update(stable(value)).digest("hex");
