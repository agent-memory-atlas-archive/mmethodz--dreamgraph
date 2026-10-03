/** Human-owned profile documents reuse C07 CAS/backup/recovery, never worker/model authority. */
import {mkdir,realpath,readdir} from "node:fs/promises";
import {dirname,isAbsolute,join,relative,sep} from "node:path";
import {z} from "zod";
import {getActiveScope} from "../instance/lifecycle.js";
import {getSessionContext} from "../server/session-context.js";
import {applyConfigurationDocument,inspectConfigurationDocument} from "../config/engine-configuration.js";
import {settingSchema} from "../config/setting-schema.js";
import {BrowserInstallSchema,BrowserTargetDefinitionSchema} from "./browser-registry.js";
import {BrowserWorkerProfileSchema} from "./browser-profile.js";
import {browserWorkerSourceHash} from "./browser-harness.js";
import {computerDigest} from "./digest.js";
const identifier=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/).refine(value=>!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(value));
const selection=z.object({kind:z.enum(["worker","target"]),id:identifier}).strict();
const owner=()=>{const context=getSessionContext(),scope=getActiveScope();if(!context||context.channel!=="browser"||context.execution_policy||!scope||scope.dataDir!==context.directory)throw new Error("COMPUTER_CONFIGURATION_OPERATOR_REQUIRED");return scope;};
const contained=(root:string,path:string)=>{const rel=relative(root,path);return !!rel&&!isAbsolute(rel)&&rel!==".."&&!rel.startsWith(".."+sep);};
async function location(input:z.infer<typeof selection>){
 const config=await realpath(dirname(owner().engineEnvPath)),directory=join(config,"computer-use",input.kind==="worker"?"workers":"targets");
 // Check each existing parent physically before creating a child; a symlink cannot redirect writes outside configuration.
 let parent=config;for(const name of ["computer-use",input.kind==="worker"?"workers":"targets"]){const child=join(parent,name);try{const physical=await realpath(child);if(!contained(config,physical))throw new Error("COMPUTER_CONFIGURATION_PHYSICAL_SCOPE_REJECTED");parent=physical;}
  catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;await mkdir(child,{mode:0o700});parent=await realpath(child);if(!contained(config,parent))throw new Error("COMPUTER_CONFIGURATION_PHYSICAL_SCOPE_REJECTED");}}
 const path=join(parent,input.id+".json");try{const physical=await realpath(path);if(physical!==path)throw new Error("COMPUTER_CONFIGURATION_LINK_REJECTED");}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
 return {path,directory,config};
}
function validateValue(kind:"worker"|"target",input:unknown){const value=(kind==="worker"?BrowserInstallSchema:BrowserTargetDefinitionSchema).parse(input);
 if(kind==="target")BrowserWorkerProfileSchema.parse({...value,schema:"dreamgraph.browser_worker_profile.v1",browser_executable:"validation-only",browser_version:"validation-only",runtime_version:"1.62.1",expires_at:new Date(Date.now()+30000).toISOString()});return value;}
function document(kind:"worker"|"target",id:string){return {format:kind==="worker"?"computer_worker" as const:"computer_target" as const,validate:(content:string)=>{
 if(!content)return;if(Buffer.byteLength(content,"utf8")>64*1024)throw new Error("COMPUTER_CONFIGURATION_BYTE_BOUND");
 const value=validateValue(kind,JSON.parse(content.replace(/^\uFEFF/,"")));if(value.id!==id)throw new Error("COMPUTER_CONFIGURATION_ID_MISMATCH");
}};}
export function computerConfigurationSchemas(){owner();return {worker:settingSchema(BrowserInstallSchema),target:settingSchema(BrowserTargetDefinitionSchema),
 constraints:{max_document_bytes:65536,max_profiles:128},note:"Operator configuration only. Import an exact local qualification, review target scope, then select named profiles in engine settings. Saving neither enables a worker nor grants control."};}
export async function inspectComputerConfiguration(input:unknown){const selected=selection.parse(input),where=await location(selected),state=await inspectConfigurationDocument(where.path,document(selected.kind,selected.id));
 const value=state.content?JSON.parse(state.content.replace(/^\uFEFF/,"")):null;let runtime_current:boolean|null=null;
 if(selected.kind==="worker"&&value){const worker=BrowserInstallSchema.parse(value);runtime_current=worker.qualification.evidence_scope==="actual_runtime"&&worker.qualification.source_hash===await browserWorkerSourceHash()
  &&worker.qualification.platform===process.platform&&worker.qualification.architecture===process.arch&&worker.qualification.protocol_hash===computerDigest("dreamgraph.computer_worker.v1")
  &&worker.qualification.backend_version===`playwright-core@1.62.1/chromium@${worker.browser_version}/node@${process.versions.node}`;}
 return {kind:selected.kind,id:selected.id,revision:state.revision,value,runtime_current};
}
export async function listComputerConfiguration(){const scope=owner(),root=await realpath(dirname(scope.engineEnvPath)),result:Array<{kind:"worker"|"target";id:string}>=[];
 for(const [kind,folder]of [["worker","workers"],["target","targets"]] as const){let directory:string;try{directory=await realpath(join(root,"computer-use",folder));}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")continue;throw error;}
  if(!contained(root,directory))throw new Error("COMPUTER_CONFIGURATION_PHYSICAL_SCOPE_REJECTED");const files=await readdir(directory,{withFileTypes:true});if(files.length>256)throw new Error("COMPUTER_CONFIGURATION_PROFILE_CAPACITY");
  for(const file of files){if(!file.isFile()||!file.name.endsWith(".json"))continue;const id=file.name.slice(0,-5);if(identifier.safeParse(id).success)result.push({kind,id});}
 }if(result.length>128)throw new Error("COMPUTER_CONFIGURATION_PROFILE_CAPACITY");return result.sort((a,b)=>a.kind.localeCompare(b.kind)||a.id.localeCompare(b.id));}
export async function applyComputerConfiguration(input:unknown,onStep?:(step:string)=>void){
 const request=selection.extend({expected_revision:z.string().regex(/^sha256:[a-f0-9]{64}$/),operation_id:z.string().min(1).max(256),value:z.unknown()}).strict().parse(input);
 const value=validateValue(request.kind,request.value);if(value.id!==request.id)throw new Error("COMPUTER_CONFIGURATION_ID_MISMATCH");
 const where=await location(request),existing=await listComputerConfiguration();if(existing.length>=128&&!existing.some(row=>row.kind===request.kind&&row.id===request.id))throw new Error("COMPUTER_CONFIGURATION_PROFILE_CAPACITY");
 const receipt=await applyConfigurationDocument(where.path,document(request.kind,request.id),{expected_revision:request.expected_revision,operation_id:request.operation_id,
  content:JSON.stringify(value,null,2)+"\n",key:`computer_use:${request.kind}:${request.id}`},onStep);
 return {receipt,result:await inspectComputerConfiguration({kind:request.kind,id:request.id}),effective_state:"Saved for new preparation. Existing passes retain their original profile; no activation or grant was issued."};
}
