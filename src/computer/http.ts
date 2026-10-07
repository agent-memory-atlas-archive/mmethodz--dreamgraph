/** Original operator controls. The worker bearer cannot reach these ports or supply a backend. */
import {browserBridgeStatus} from "./browser-bridge/setup.js";
import {plannedComputerUseRoute} from "./computer-use-backend.js";
import type {IncomingMessage,ServerResponse} from "node:http";
import {z} from "zod";
import {getSessionContext} from "../server/session-context.js";
import {inspectComputerSetup,prepareConfiguredComputer,confirmConfiguredComputer,assertNativeComputerPreparation,cancelNativeComputerPreparation} from "./browser-registry.js";
import {activeComputerBroker} from "./broker.js";
import {readComputerJournal} from "./journal.js";
import {listManagedComputerSessions} from "../graph/execution-context.js";
import {computerConfigurationSchemas,listComputerConfiguration,inspectComputerConfiguration,applyComputerConfiguration} from "./configuration.js";
import {NativeComputerPrepareRequestSchema} from './native-pass-schema.js';
const pair=z.object({execution_id:z.string().min(1).max(1024),id:z.string().min(1).max(256)}).strict();
async function body(req:IncomingMessage,maximum=16384){const chunks:Buffer[]=[];let bytes=0;for await(const chunk of req){const part=Buffer.from(chunk);bytes+=part.length;if(bytes>maximum)throw new Error("COMPUTER_CONTROL_BYTE_BOUND");chunks.push(part);}
  return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks)));}
const json=(res:ServerResponse,status:number,value:unknown)=>{res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});res.end(JSON.stringify(value));};
function authorityOrigins(req:IncomingMessage){const port=req.socket.localPort;if(!port)throw new Error("COMPUTER_AUTHORITY_ORIGIN_UNKNOWN");
  return [...new Set(["127.0.0.1","localhost","[::1]",req.headers.host?.replace(/:\d+$/,"")].filter((host):host is string=>!!host).flatMap(host=>["http","https"].map(scheme=>`${scheme}://${host}:${port}`)))];}
export function isNativeComputerOperator(req:IncomingMessage){
  const context=getSessionContext(),token=req.headers['x-dreamgraph-session'];
  return !!context&&context.channel==='browser'&&!context.execution_policy&&typeof token==='string'&&token.length>0&&token.length<=2048&&!token.startsWith('dgexec.')
    &&!req.headers.origin&&!req.headers.cookie&&!req.headers['sec-fetch-site'];
}
export async function handleComputerHttp(req:IncomingMessage,res:ServerResponse,pathname:string){
  const nativePrefix="/api/executions/v1/computer/",evidencePrefix="/api/executions/v1/computer-evidence/",preparationPrefix='/api/executions/v1/computer-preparation/',browserPrefix="/api/architect/v1/computer/";
  const nativeEvidence=pathname.startsWith(evidencePrefix),nativePreparation=pathname.startsWith(preparationPrefix),native=nativeEvidence||nativePreparation||pathname.startsWith(nativePrefix);
  if(!native&&!pathname.startsWith(browserPrefix))return false;
  const context=getSessionContext();if(!context||context.channel!=="browser"||context.execution_policy){json(res,403,{error:"COMPUTER_OPERATOR_PORT_REQUIRED"});return true;}
  if(native){
    // Native hosts retain their private owner bearer; never forge browser-origin
    // headers or accept a cookie/worker credential as an operator control port.
    if(!isNativeComputerOperator(req)){json(res,403,{error:"COMPUTER_NATIVE_OPERATOR_PORT_REQUIRED"});return true;}
    const suffix=pathname.slice(nativeEvidence?evidencePrefix.length:nativePreparation?preparationPrefix.length:nativePrefix.length);
    if(!(nativeEvidence?["observation"]:nativePreparation?['setup','prepare','confirm','cancel']:["setup","sessions","status","pause","resume","stop","recover-stop"]).includes(suffix)){json(res,404,{error:"COMPUTER_NATIVE_CONTROL_ROUTE_UNKNOWN"});return true;}
    if(nativeEvidence&&req.method!=="GET"){json(res,405,{error:"COMPUTER_EVIDENCE_READ_ONLY"});return true;}
    // The original control seam still exposes no pixels. Evidence is a separate,
    // explicit read of the original broker's ephemeral capture, never a new observation.
    pathname=browserPrefix+suffix;
  }
  const projection=(journal:Pick<Awaited<ReturnType<typeof readComputerJournal>>,'session'|'targets'|'capability'|'limits'|'usage'>&Partial<Pick<Awaited<ReturnType<typeof readComputerJournal>>,'actions'>>)=>({session:journal.session,targets:journal.targets,capability:journal.capability,
    worker_available:!!activeComputerBroker(journal.session.execution_id,journal.session.id),pause_supported:activeComputerBroker(journal.session.execution_id,journal.session.id)?.pauseSupported??false,
    limits:journal.limits,usage:journal.usage,last_receipt:journal.actions?.at(-1)?.receipt??null});
  try{
    const url=new URL(req.url!,"http://local");
    if(req.method==="GET"&&pathname===browserPrefix+"browser-bridge"){json(res,200,{ok:true,...await browserBridgeStatus()});return true;}
    if(req.method==="GET"&&pathname.endsWith("/profiles")){json(res,200,{ok:true,schemas:computerConfigurationSchemas(),profiles:await listComputerConfiguration()});return true;}
    if(req.method==="GET"&&pathname.endsWith("/profiles/read")){json(res,200,{ok:true,result:await inspectComputerConfiguration(Object.fromEntries(url.searchParams))});return true;}
    if(req.method==="GET"&&pathname.endsWith("/sessions")){
      const query=Object.fromEntries(url.searchParams),result=await listManagedComputerSessions({...query,...(query.limit?{limit:Number(query.limit)}:{})});
      json(res,200,{ok:true,...result,sessions:result.sessions.map(row=>native?projection(row.journal):({...row,worker_available:!!activeComputerBroker(row.execution_id,row.journal.session.id)}))});return true;}
    if(req.method==="GET"&&pathname.endsWith("/setup")){
      // The route a granted pass on this adapter takes now (DreamGraph's browser, Codex's own, the runtime), for the page.
      const bridge=await browserBridgeStatus().catch(()=>null),adapter=nativePreparation?'native_api_tool_loop':url.searchParams.get("adapter")??"native_api_tool_loop";
      const computer_use_route=plannedComputerUseRoute(adapter,{connected:!!bridge?.connected,version:bridge?.hosts[0]?.extension_version??null});
      json(res,200,{ok:true,computer_use_route,...await inspectComputerSetup(nativePreparation?'native_api_tool_loop':url.searchParams.get("adapter")??"native_api_tool_loop",authorityOrigins(req),nativePreparation?'computer_use':url.searchParams.get("model_role")??"architect")});return true;}
    if(req.method==="GET"&&["/status","/observation"].some(route=>pathname.endsWith(route))){
      const request=pair.parse(Object.fromEntries(url.searchParams)),journal=await readComputerJournal(request.execution_id,request.id);
      if(pathname.endsWith("/status")){const broker=activeComputerBroker(request.execution_id,request.id);json(res,200,native?{ok:true,...projection(journal)}:{ok:true,journal,worker_available:!!broker,pause_supported:broker?.pauseSupported??false});return true;}
      const observed=activeComputerBroker(request.execution_id,request.id)?.inspectLatestObservation();
      if(nativeEvidence){
        if(observed?.image&&observed.image.bytes.byteLength>1024*1024)throw new Error("COMPUTER_EVIDENCE_IMAGE_BYTE_BOUND");
        const observation=observed?{observation:observed.observation,summary:observed.summary,expired:observed.expired,
          ...(observed.image_observation?{image_observation:observed.image_observation}:{}),
          ...(!observed.expired&&observed.image?{image:{mime_type:observed.image.mime_type,content_hash:observed.image.content_hash,data_base64:Buffer.from(observed.image.bytes).toString("base64")}}:{})}:null;
        json(res,200,{ok:true,schema:"dreamgraph.computer_evidence.v1",instance_id:journal.session.instance_id,execution_id:journal.session.execution_id,
          computer_session_id:journal.session.id,fence:journal.session.fence,worker_available:!!activeComputerBroker(request.execution_id,request.id),observation});return true;
      }
      json(res,200,{ok:true,observation:observed?{observation:observed.observation,summary:observed.summary,expired:observed.expired,image_observation:observed.image_observation,
        ...(observed.image?{image:{mime_type:observed.image.mime_type,content_hash:observed.image.content_hash,data_base64:Buffer.from(observed.image.bytes).toString("base64")}}:{})}:null});return true;
    }
    if(req.method!=="POST"||!native&&(!req.headers.origin||!req.headers["sec-fetch-mode"])||!req.headers["content-type"]?.startsWith("application/json")){
      json(res,403,{error:"COMPUTER_HUMAN_BROWSER_CONTROL_REQUIRED"});return true;}
    let input=await body(req,pathname.endsWith("/profiles/apply")?128*1024:16384);
    if(nativePreparation&&pathname.endsWith('/prepare'))input={...NativeComputerPrepareRequestSchema.parse(input),adapter:'native_api_tool_loop',model_role:'computer_use'};
    if(nativePreparation&&pathname.endsWith('/confirm')){const request=z.object({id:z.string().uuid(),human_confirmed:z.literal(true)}).strict().parse(input);await assertNativeComputerPreparation(request.id);}
    if(nativePreparation&&pathname.endsWith('/cancel')){const request=z.object({id:z.string().uuid()}).strict().parse(input);json(res,200,{ok:true,result:await cancelNativeComputerPreparation(request.id)});}
    else if(pathname.endsWith("/profiles/apply"))json(res,200,{ok:true,...await applyComputerConfiguration(input)});
    else if(pathname.endsWith("/prepare"))json(res,200,{ok:true,result:await prepareConfiguredComputer(input,authorityOrigins(req))});
    else if(pathname.endsWith("/confirm"))json(res,200,{ok:true,result:await confirmConfiguredComputer(input)});
    else if(pathname.endsWith("/pause")||pathname.endsWith("/resume")){
      const request=pair.extend({fence:z.number().int().min(1)}).strict().parse(input),broker=activeComputerBroker(request.execution_id,request.id);if(!broker)throw new Error("COMPUTER_ORIGINAL_WORKER_UNAVAILABLE");
      if(pathname.endsWith("/pause"))await broker.pause(request.fence);else await broker.resume(request.fence);const journal=await readComputerJournal(request.execution_id,request.id);json(res,200,native?{ok:true,...projection(journal)}:{ok:true,journal});
    }else if(pathname.endsWith("/stop")||pathname.endsWith("/recover-stop")){
      const request=pair.parse(input),broker=activeComputerBroker(request.execution_id,request.id);
      if(!broker)throw new Error("COMPUTER_ORIGINAL_WORKER_UNAVAILABLE");
      if(pathname.endsWith("/recover-stop"))await broker.recoverStop();else await broker.stop();const journal=await readComputerJournal(request.execution_id,request.id);json(res,200,native?{ok:true,...projection(journal)}:{ok:true,journal});
    }else json(res,404,{error:"COMPUTER_CONTROL_ROUTE_UNKNOWN"});
  }catch(error){const code=error instanceof Error?error.message.split(":",1)[0]:"",known=/^(?:COMPUTER|CONFIG|EXECUTION|GRANT)_[A-Z0-9_]+$/.test(code);
    json(res,error instanceof z.ZodError?400:known?(code.includes("CONFLICT")?409:400):500,{error:error instanceof z.ZodError?"COMPUTER_INVALID_CONTROL_REQUEST":known?code:"COMPUTER_CONTROL_REJECTED",
      ...(error instanceof z.ZodError?{fields:error.issues.map(issue=>({field:issue.path.join("."),message:issue.message}))}:{})});}
  return true;
}
