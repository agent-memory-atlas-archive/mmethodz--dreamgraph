/** Independently hash scan-visible material before/after a scoped native process. */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { config } from "../config/config.js";
import { getDataDir } from "../utils/paths.js";
import { shouldSkipScanDirectory } from "../tools/scanner-artifact-policy.js";
import { STORE_REGISTRY } from "./store-registry.js";
import { beginObservedSourceEffect, settleObservedSourceEffect } from "./change-obligations.js";

const fold=(value:string)=>process.platform==="win32"?value.toLowerCase():value;
const contains=(root:string,file:string)=>{const rel=path.relative(fold(root),fold(file));return rel!==".."&&!rel.startsWith(`..${path.sep}`)&&!path.isAbsolute(rel);};
async function snapshot(root:string,repo:string):Promise<Record<string,string>> {
  const hashes:Record<string,string>={},directory=await fs.realpath(getDataDir());let bytes=0,entries=0;
  const walk=async(dir:string,depth:number):Promise<void>=>{
    if(depth>32)throw new Error("COMMAND_SOURCE_DEPTH_BOUND");
    for(const entry of (await fs.readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
      if(++entries>12000)throw new Error("COMMAND_SOURCE_ENTRY_BOUND");
      const file=path.join(dir,entry.name),rel=path.relative(root,file).replace(/\\/g,"/");
      // Instance metadata must never be classified as a project mutation.
      if(fold(directory)!==fold(root)&&contains(directory,file))continue;
      if(fold(directory)===fold(root)&&(STORE_REGISTRY[entry.name]||/^(publication|reconciliation|normalization-result-|job-result-|execution-context-archive-)/.test(entry.name)))continue;
      if(/^\.env(?:\.|$)|^\.npmrc$|^\.pypirc$|\.(?:pem|key)$/i.test(entry.name))continue;
      // Excluded generated links (for example node_modules) need no traversal qualification.
      if((entry.isDirectory()||entry.isSymbolicLink())&&! [".github",".vscode",".devcontainer"].includes(entry.name)
        &&shouldSkipScanDirectory({repoRoot:root,absDir:file,entryName:entry.name}))continue;
      if(entry.isSymbolicLink())throw new Error("COMMAND_SOURCE_LINK_UNQUALIFIED: explicit linked-source scope required");
      if(entry.isDirectory()){
        if(![".github",".vscode",".devcontainer"].includes(entry.name)&&shouldSkipScanDirectory({repoRoot:root,absDir:file,entryName:entry.name}))continue;
        await walk(file,depth+1);continue;
      }
      if(!entry.isFile())throw new Error("COMMAND_SOURCE_KIND_UNQUALIFIED");
      const before=await fs.stat(file);bytes+=before.size;if(bytes>128*1024*1024||before.size>16*1024*1024)throw new Error("COMMAND_SOURCE_BYTE_BOUND");
      const content=await fs.readFile(file),after=await fs.stat(file);
      if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||content.length!==after.size)throw new Error("COMMAND_SOURCE_OBSERVATION_CHANGED");
      const key=`source:${encodeURIComponent(repo)}/${rel.split("/").map(encodeURIComponent).join("/")}`;
      hashes[key]="sha256:"+createHash("sha256").update(content).digest("hex");
    }
  };
  await walk(root,0);return hashes;
}
export async function observeCommandSource(input:{execution_id:string;workspace:string;before_intent?:()=>Promise<void>}) {
  const root=await fs.realpath(input.workspace),candidates=await Promise.all(Object.entries(config.repos).map(async([repo,value])=>({repo,root:await fs.realpath(value)})));
  // Observe the whole containing configured repository, including additions/renames/deletions.
  const selected=candidates.filter(item=>contains(item.root,root)).sort((a,b)=>b.root.length-a.root.length)[0];
  if(!selected)throw new Error("COMMAND_SOURCE_REPOSITORY_UNAVAILABLE");
  const before=await snapshot(selected.root,selected.repo);
  await input.before_intent?.();
  const intent=await beginObservedSourceEffect({operation_id:`command:${randomUUID()}`,execution_id:input.execution_id,actor:"scoped_command",
    repositories:[selected.repo],before_hashes:before});
  return {id:intent.id,settle:async(terminated:boolean)=>{
    if(!terminated)return settleObservedSourceEffect(intent.id,null);
    try{return await settleObservedSourceEffect(intent.id,await snapshot(selected.root,selected.repo));}
    catch(error){await settleObservedSourceEffect(intent.id,null);throw error;}
  }};
}
