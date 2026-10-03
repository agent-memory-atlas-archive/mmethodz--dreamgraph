/** Operator-owned setup above the private worker. Requests carry IDs, never executables, ports or qualification claims. */
import {randomUUID} from "node:crypto";
import {open,realpath} from "node:fs/promises";
import {dirname,isAbsolute,join,relative} from "node:path";
import {hostname} from "node:os";
import {z} from "zod";
import {getActiveScope} from "../instance/lifecycle.js";
import {computerUseSettings} from "../config/engine-setting-catalogue.js";
import {getSessionContext,sessionEnvironment,sessionNamespace} from "../server/session-context.js";
import {SessionAuthority} from "../server/session-authority.js";
import {BrowserWorkerProfileSchema,type BrowserWorkerProfile} from "./browser-profile.js";
import {BrowserHarnessWorker,browserWorkerSourceHash} from "./browser-harness.js";
import {ComputerQualificationSchema,negotiateComputerCapability,type ComputerQualification,type ComputerWorkerProbe} from "./capabilities.js";
import {computerDigest} from "./digest.js";
import type {ComputerSessionInput} from "./broker.js";
import type {ComputerTarget} from "./worker-port.js";
import {getRoleLlmProvider,getRoleModelPolicy} from "../cognitive/llm.js";
import type {ResolvedRolePolicy} from "../config/role-policy.js";
import {assertProviderRequest} from "../config/provider-capabilities.js";
import {inspectCodexNativeComputer} from "../architect/cli-bridge.js";
const name=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/);
export const BrowserInstallSchema=z.object({schema:z.literal("dreamgraph.browser_install.v1"),id:name,
  browser_executable:z.string().min(1).max(4096).refine(isAbsolute),browser_version:z.string().min(1).max(256),runtime_version:z.literal("1.62.1"),
  qualification:ComputerQualificationSchema}).strict();
export const BrowserTargetDefinitionSchema=BrowserWorkerProfileSchema.innerType().omit({browser_executable:true,browser_version:true,runtime_version:true,expires_at:true})
  .extend({schema:z.literal("dreamgraph.browser_target_definition.v1"),id:name}).strict();
type Setup={scope_id:string;project_workspace:string|null;source_hash:string;profile:BrowserWorkerProfile;qualification:ComputerQualification;probe:ComputerWorkerProbe;
  seals:Array<{path:string;hash:string}>;settings:ReturnType<typeof computerUseSettings>;model_role:"architect"|"computer_use";model_policy:ResolvedRolePolicy|null};
type Preparation={id:string;namespace:string;execution_id:string;target:ComputerTarget;interact:boolean;duration_ms:number;setup:Setup;grant_id:string|null;claimed:boolean;cancelled:boolean};
const preparations=new Map<string,Preparation>();
const preparationOperations=new WeakMap<Preparation,Promise<void>>();
const owned=(id:string)=>{const value=preparations.get(id);if(!value||value.namespace!==sessionNamespace())throw new Error("COMPUTER_PREPARATION_OWNER_REJECTED");return value;};
function preparationCapacity(){
  for(const [id,value]of preparations)if(Date.parse(value.setup.profile.expires_at)<=Date.now())preparations.delete(id);
  if(preparations.size>=128||[...preparations.values()].filter(value=>value.namespace===sessionNamespace()&&!value.claimed&&!value.cancelled).length>=4)throw new Error('COMPUTER_PREPARATION_CAPACITY');
}
/** Serialize confirmation/claim/revocation of this original preparation, not browser work. */
async function preparationOperation<T>(value:Preparation,operation:()=>Promise<T>):Promise<T>{
  const previous=preparationOperations.get(value)??Promise.resolve();let release!:()=>void;
  const current=new Promise<void>(resolve=>{release=resolve;});preparationOperations.set(value,current);
  await previous;try{if(owned(value.id)!==value)throw new Error('COMPUTER_PREPARATION_OWNER_REJECTED');return await operation();}
  finally{release();if(preparationOperations.get(value)===current)preparationOperations.delete(value);}
}
async function boundedJson(path:string){const file=await open(path,"r");try{const first=await file.stat();if(!first.isFile()||first.size>64*1024)throw new Error("COMPUTER_SETUP_CAPACITY");
  const body=await file.readFile("utf8"),last=await file.stat();if(first.size!==last.size||first.mtimeMs!==last.mtimeMs||first.ctimeMs!==last.ctimeMs||Buffer.byteLength(body)>64*1024)throw new Error("COMPUTER_SETUP_CHANGED");
  return {value:JSON.parse(body.replace(/^\uFEFF/,"")) as unknown,hash:computerDigest(body)};
}finally{await file.close();}}
async function setupFile(configPath:string,kind:string,id:string){
  const root=await realpath(join(configPath,"computer-use")),path=await realpath(join(root,kind,name.parse(id)+".json")),rel=relative(root,path);
  if(!rel||isAbsolute(rel)||rel===".."||rel.startsWith("..\\")||rel.startsWith("../"))throw new Error("COMPUTER_SETUP_PHYSICAL_SCOPE_REJECTED");
  return {path,...await boundedJson(path)};
}
async function loadSetup(duration?:number,authorityOrigins:string[]=[],modelRole:"architect"|"computer_use"="architect"):Promise<Setup>{
  const settings=computerUseSettings(sessionEnvironment()),scope=getActiveScope();
  if(!settings.enabled)throw new Error("COMPUTER_DISABLED");
  if(!scope||scope.dataDir!==getSessionContext()?.directory)throw new Error("COMPUTER_INSTANCE_SCOPE_REQUIRED");
  if(settings.remote_worker_enabled)throw new Error("COMPUTER_REMOTE_WORKER_UNQUALIFIED");
  if(settings.retention!=="none"||settings.retention_ms)throw new Error("COMPUTER_RETAINED_EVIDENCE_UNQUALIFIED");
  if(settings.route==="native_cli")throw new Error("COMPUTER_SELECT_MATCHING_ADAPTER_FOR_ROUTE");
  const model_policy=modelRole==="computer_use"?await getRoleModelPolicy("computer_use"):null;
  if(model_policy&&(model_policy.status!=="configured"||!["openai","anthropic","lmstudio"].includes(model_policy.effective.provider)
    ||model_policy.effective.api==="native_cli"||model_policy.effective.strict_schema||!model_policy.capability?.tools))throw new Error("COMPUTER_MODEL_ROLE_UNQUALIFIED");
  if(model_policy)try{assertProviderRequest(model_policy.effective.provider,model_policy.effective.model,
    model_policy.effective.api==="messages"?"anthropic-messages":model_policy.effective.api==="chat_completions"?"chat-completions":model_policy.effective.api,
    model_policy.effective.effort??undefined,false,true,model_policy.capability??undefined);}catch{throw new Error("COMPUTER_MODEL_TOOLS_UNSUPPORTED");}
  const configPath=dirname(scope.engineEnvPath),installFile=await setupFile(configPath,"workers",settings.worker_profile!),targetFile=await setupFile(configPath,"targets",settings.target_profile!);
  const install=BrowserInstallSchema.parse(installFile.value),definition=BrowserTargetDefinitionSchema.parse(targetFile.value);
  if(install.id!==settings.worker_profile||definition.id!==settings.target_profile)throw new Error("COMPUTER_SETUP_ID_MISMATCH");
  const expires_at=new Date(Date.now()+Math.min(300000,duration??settings.elapsed_ms,settings.elapsed_ms)).toISOString();
  const profile=BrowserWorkerProfileSchema.parse({...definition,schema:"dreamgraph.browser_worker_profile.v1",browser_executable:install.browser_executable,browser_version:install.browser_version,
    runtime_version:install.runtime_version,expires_at,max_actions:Math.min(100,definition.max_actions,settings.max_actions),blocked_origins:[...new Set([...definition.blocked_origins,...authorityOrigins])],
    images:{...definition.images,max_count:Math.min(definition.images.max_count,settings.max_images),total_bytes:Math.min(definition.images.total_bytes,settings.max_image_bytes)}});
  const source_hash=await browserWorkerSourceHash();if(source_hash!==install.qualification.source_hash)throw new Error("COMPUTER_BROWSER_SOURCE_QUALIFICATION_MISMATCH");
  const probe:ComputerWorkerProbe={protocol:"dreamgraph.computer_worker.v1",backend:"isolated_playwright",backend_version:`playwright-core@1.62.1/chromium@${install.browser_version}/node@${process.versions.node}`,
    adapter:"native_api_tool_loop",adapter_version:"1",platform:process.platform as "win32"|"darwin"|"linux",architecture:process.arch,host_id:hostname(),epoch:"preflight-only",route:"dreamgraph_harness",profile_hash:computerDigest(profile),
    supported:["observe",...(profile.navigation?["navigate" as const]:[]),...new Set(profile.elements.flatMap(item=>item.operations))],permitted:["observe",...(profile.navigation?["navigate" as const]:[]),...new Set(profile.elements.flatMap(item=>item.operations))],evidence_granularity:"action",isolated:true,
    scope_enforced:true,bounded_actions:true,privacy_enforced:true,independent_stop:true,physical_seat:"not_used",qualification_hash:computerDigest(install.qualification),reasons:[]};
  if(profile.images.enabled&&model_policy&&!model_policy.capability?.images)throw new Error("COMPUTER_MODEL_IMAGES_UNSUPPORTED");
  return {scope_id:scope.uuid,project_workspace:scope.projectRoot,source_hash,profile,qualification:install.qualification,probe,settings,model_role:modelRole,model_policy,seals:[installFile,targetFile].map(({path,hash})=>({path,hash}))};
}
const publicSetup=(setup:Setup)=>({instance_id:setup.scope_id,worker:"isolated_playwright",host:setup.probe.host_id,target_profile:setup.profile.id,origin:setup.profile.main_origin,path_prefix:setup.profile.main_path_prefix,
  network:setup.profile.network,blocked_origins:setup.profile.blocked_origins,visual:{enabled:setup.profile.images.enabled,region:setup.profile.images.region,mask_selectors:setup.profile.images.mask_selectors},redaction_rules:setup.profile.redactions.length,
  model:{role:setup.model_role,...(setup.model_policy?{provider:setup.model_policy.effective.provider,model:setup.model_policy.effective.model,api:setup.model_policy.effective.api,
    retention:setup.model_policy.policy.retention,budget:setup.model_policy.policy.budget,policy_hash:setup.model_policy.fingerprint}:{selection:"Current Architect model and allocation; no model substitution"})},
  retention:"none",limits:{max_actions:setup.profile.max_actions,max_images:setup.profile.images.max_count,max_image_bytes:setup.profile.images.total_bytes,expires_at:setup.profile.expires_at},
  postconditions:setup.profile.postconditions.map(post=>({id:post.id,kind:post.kind})),capability:negotiateComputerCapability({enabled:true,selected_route:setup.settings.route,adapter_kind:"native_api",
    adapter:setup.probe.adapter,adapter_version:setup.probe.adapter_version,requested:setup.probe.supported,probe:setup.probe,qualification:setup.qualification})});
export async function inspectComputerSetup(adapter:string,authorityOrigins:string[]=[],modelRole:unknown="architect"){
  if(adapter!=="native_api_tool_loop"){
    let native_detection:Awaited<ReturnType<typeof inspectCodexNativeComputer>>|undefined;
    if(adapter==="codex-cli")try{native_detection=await inspectCodexNativeComputer();}catch{/* Detection failure must not invent a missing feature or authorize a route. */}
    return {available:false,route:"native_cli",...(native_detection?{native_detection}:{}),reasons:["COMPUTER_NATIVE_CLI_CONFORMANCE_UNAVAILABLE"],
      remedy:native_detection?.native_feature_detected?"Codex native Computer Use is detected. This adapter still needs qualified scope, limits, privacy, independent Stop and normalized receipts before activation. Ordinary passes disable native computer/browser access.":"Native capability could not be verified for this adapter. Use its qualified native facility when available, or explicitly select a native API adapter for the DreamGraph harness."};
  }
  try{const setup=await loadSetup(undefined,authorityOrigins,z.enum(["architect","computer_use"]).parse(modelRole)),projection=publicSetup(setup);return {available:projection.capability.route!=="unavailable",...projection};}
  catch(error){return {available:false,route:"unavailable",reasons:[error instanceof Error&&/^COMPUTER_[A-Z0-9_]+$/.test(error.message)?error.message:"COMPUTER_SETUP_INVALID"],remedy:"Review the Computer Use settings and the named worker/target definitions. Qualification must match the installed worker, browser, Node, OS and architecture."};}
}
/** Human-only preparation binds a future original-host ID. It neither launches a browser nor issues permission. */
export async function prepareConfiguredComputer(input:unknown,authorityOrigins:string[]=[]){
  const request=z.object({adapter:z.literal("native_api_tool_loop"),interact:z.boolean(),duration_ms:z.number().int().min(1000).max(300000),model_role:z.enum(["architect","computer_use"]).default("architect")}).strict().parse(input),context=getSessionContext();
  if(!context||context.channel!=="browser"||context.execution_policy)throw new Error("COMPUTER_HUMAN_PREPARATION_REQUIRED");
  preparationCapacity();
  const setup=await loadSetup(request.duration_ms,authorityOrigins,request.model_role),projection=publicSetup(setup);if(projection.capability.route==="unavailable")throw new Error("COMPUTER_RUNTIME_UNQUALIFIED");
  // Setup awaits disk/policy reads. Recheck admission at the synchronous insertion boundary.
  preparationCapacity();
  const id=randomUUID(),execution_id=`architect-computer:${randomUUID()}`,target:ComputerTarget={schema:"dreamgraph.computer_target.v1",id:`browser-target:${id}`,instance_id:setup.scope_id,session_id:context.session_id,
    host_id:setup.probe.host_id,surface:"browser",generation:1,origin:setup.profile.main_origin,application:null};
  preparations.set(id,{id,namespace:sessionNamespace(),execution_id,target,interact:request.interact,duration_ms:Math.min(request.duration_ms,setup.settings.elapsed_ms),setup,grant_id:null,claimed:false,cancelled:false});
  return {id,execution_id,target_id:target.id,interact:request.interact,...projection};
}
async function assertPreparationCurrent(value:Preparation){
  if(value.cancelled)throw new Error('COMPUTER_PREPARATION_CANCELLED');
  const scope=getActiveScope();if(scope?.uuid!==value.setup.scope_id||scope.dataDir!==getSessionContext()?.directory||scope.projectRoot!==value.setup.project_workspace)throw new Error("COMPUTER_PREPARATION_INSTANCE_CHANGED");
  if(Date.parse(value.setup.profile.expires_at)<=Date.now())throw new Error("COMPUTER_PREPARATION_EXPIRED");
  if(await browserWorkerSourceHash()!==value.setup.source_hash)throw new Error("COMPUTER_PREPARATION_WORKER_CHANGED");
  for(const seal of value.setup.seals)if(await realpath(seal.path)!==seal.path||(await boundedJson(seal.path)).hash!==seal.hash)throw new Error("COMPUTER_PREPARATION_SETUP_CHANGED");
  const settings=computerUseSettings(sessionEnvironment());if(computerDigest(settings)!==computerDigest(value.setup.settings))throw new Error("COMPUTER_PREPARATION_SETTINGS_CHANGED");
  if(value.setup.model_policy&&(await getRoleModelPolicy("computer_use")).fingerprint!==value.setup.model_policy.fingerprint)throw new Error("COMPUTER_PREPARATION_MODEL_CHANGED");
}
export async function confirmConfiguredComputer(input:unknown){
  const request=z.object({id:z.string().uuid(),human_confirmed:z.literal(true)}).strict().parse(input),context=getSessionContext();
  if(!context||context.channel!=="browser"||context.execution_policy)throw new Error("COMPUTER_HUMAN_CONFIRMATION_REQUIRED");
  const value=owned(request.id);return preparationOperation(value,async()=>{await assertPreparationCurrent(value);if(value.claimed)throw new Error("COMPUTER_PREPARATION_ALREADY_CLAIMED");
  const authority=new SessionAuthority(value.setup.scope_id,context.directory),grant=await authority.grantScopedComputer(context,{operation_id:`computer-confirm:${value.id}`,execution_id:value.execution_id,
    target_id:value.target.id,profile_hash:computerDigest(value.setup.profile),backend_source_hash:value.setup.source_hash,interact:value.interact,
    duration_ms:value.duration_ms,human_confirmed:true});
  // Use a stable request duration for exact uncertain retries; profile expiration remains the tighter dispatch bound.
  value.grant_id=grant.id;return {id:value.id,execution_id:value.execution_id,grant_id:grant.id,expires_at:grant.expires_at};});
}
/** Original unused scope only. Revocation is allowed even after configuration changes or expiry. */
export async function cancelNativeComputerPreparation(id:string){
  const context=getSessionContext();if(!context||context.channel!=='browser'||context.execution_policy)throw new Error('COMPUTER_HUMAN_PREPARATION_REQUIRED');
  const value=owned(z.string().uuid().parse(id));return preparationOperation(value,async()=>{
    if(value.setup.model_role!=='computer_use')throw new Error('COMPUTER_EXPLICIT_DAEMON_ROLE_REQUIRED');
    if(value.claimed)throw new Error('COMPUTER_PREPARATION_ALREADY_CLAIMED');
    // Deny future confirmation/claim before a durable revoke; an uncertain revoke can only be retried on this ID.
    value.cancelled=true;const authority=new SessionAuthority(value.setup.scope_id,context.directory);
    const grant=(await authority.ownGrants(context)).find(grant=>grant.execution_id===value.execution_id&&grant.scope.includes(value.target.id)
      &&grant.confirmations.some(confirmation=>confirmation.id===`computer-confirm:${value.id}`));
    if(grant)await authority.revoke(context,grant.id);
    return {id:value.id,execution_id:value.execution_id,status:'cancelled' as const,grant_revoked:!!grant};
  });
}
export async function claimConfiguredComputer(id:string,adapter:string){
  if(adapter!=="native_api_tool_loop")throw new Error("COMPUTER_ADAPTER_ROUTE_MISMATCH");const value=owned(z.string().uuid().parse(id));
  return preparationOperation(value,async()=>{await assertPreparationCurrent(value);if(value.claimed||!value.grant_id)throw new Error("COMPUTER_ORIGINAL_PREPARATION_REQUIRED");
  const context=getSessionContext()!,authority=new SessionAuthority(value.setup.scope_id,context.directory);
  await authority.assertGrant(context,value.grant_id,value.execution_id,value.target.id,value.interact?"computer_interact":"computer_observe");
  value.claimed=true;return {preparation:structuredClone(value),authority};});
}
export type PreparedComputer=Awaited<ReturnType<typeof claimConfiguredComputer>>;
/** Explicit editor/SDK pass selects the named daemon API role, never its local CLI/model. */
export async function assertNativeComputerPreparation(id:string){
  const value=owned(z.string().uuid().parse(id));await assertPreparationCurrent(value);
  if(value.setup.model_role!=='computer_use'||!value.setup.model_policy)throw new Error('COMPUTER_EXPLICIT_DAEMON_ROLE_REQUIRED');
  return {execution_id:value.execution_id};
}
/** The transport selects a previously confirmed role; it cannot supply a model or policy object. */
export async function preparedComputerModelBinding(value:PreparedComputer){
  const prep=owned(value.preparation.id);if(!prep.claimed||computerDigest(prep)!==computerDigest(value.preparation))throw new Error("COMPUTER_ORIGINAL_PREPARATION_CHANGED");
  await assertPreparationCurrent(prep);if(prep.setup.model_role==="architect")return null;
  const binding=await getRoleLlmProvider("computer_use");
  if(binding.policy.fingerprint!==prep.setup.model_policy?.fingerprint)throw new Error("COMPUTER_PREPARATION_MODEL_CHANGED");return binding;
}
export async function createPreparedWorker(value:PreparedComputer,budget:ComputerSessionInput["budget"],modelPolicy?:Readonly<ResolvedRolePolicy>){
  const prep=owned(value.preparation.id);if(!prep.claimed||computerDigest(prep)!==computerDigest(value.preparation))throw new Error("COMPUTER_ORIGINAL_PREPARATION_CHANGED");
  await assertPreparationCurrent(prep);const profile=prep.setup.profile;
  if(modelPolicy&&(modelPolicy.status!=="configured"||modelPolicy.policy.role!==prep.setup.model_role
    ||prep.setup.model_policy&&modelPolicy.fingerprint!==prep.setup.model_policy.fingerprint))throw new Error("COMPUTER_ORIGINAL_MODEL_POLICY_REQUIRED");
  if(prep.setup.model_role==="computer_use"&&!modelPolicy)throw new Error("COMPUTER_ORIGINAL_MODEL_POLICY_REQUIRED");
  const worker=await BrowserHarnessWorker.create(profile,{adapter:"native_api_tool_loop",adapter_version:"1",host_id:prep.target.host_id},prep.setup.qualification);
  const input:ComputerSessionInput={id:prep.id,execution_id:prep.execution_id,grant_id:prep.grant_id!,target:prep.target,
    settings:{enabled:true,route:prep.setup.settings.route},adapter_kind:"native_api",adapter:"native_api_tool_loop",adapter_version:"1",
    requested:prep.interact?worker.probe.supported:["observe"],limits:{max_actions:profile.max_actions,max_images:profile.images.max_count,max_image_bytes:profile.images.total_bytes,
      observation_bytes:profile.observation_bytes,expires_at:profile.expires_at},profile:{hash:computerDigest(profile),postconditions:profile.postconditions.map(post=>post.id),
        ...(prep.setup.project_workspace?{project_workspace:prep.setup.project_workspace}:{})},budget,...(modelPolicy?{model_policy:structuredClone(modelPolicy)}:{})};
  return {worker,input,authority:new SessionAuthority(prep.setup.scope_id,getSessionContext()!.directory)};
}
export const preparedComputerSummary=(value:PreparedComputer)=>({id:value.preparation.id,execution_id:value.preparation.execution_id,interact:value.preparation.interact,...publicSetup(value.preparation.setup)});
