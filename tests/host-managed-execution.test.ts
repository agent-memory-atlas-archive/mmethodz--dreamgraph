/** Actual HTTP authority, editor client and durable core. No provider or native editor UI claim. */
import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {createServer,type Server,type ServerResponse} from "node:http";
import {mkdir,mkdtemp,rm,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {z} from "zod";
import {handleApiRoute} from "../src/api/routes.js";
import {DaemonHttpAuthority} from "../src/server/http-authority.js";
import {withSessionContext,getSessionContext,type SessionContext} from "../src/server/session-context.js";
import {executionContextTransport,assertManagedContext,readManagedContext,recordManagedApproval} from "../src/graph/execution-context.js";
import {readHostExecution,withHostExecution,approveHostExecution} from "../src/server/managed-execution.js";
import {invokeToolBoundary} from "../src/server/tool-boundary.js";
import {managedSourceEffect} from "../src/graph/change-obligations.js";
import {commitGraphWrites,loadPublicationState} from "../src/graph/publication.js";
import {getDataDir,setDataDirOverride} from "../src/utils/paths.js";
import {releaseGraphWriter} from "../src/graph/writer-lease.js";
import {config} from "../src/config/config.js";
import {DaemonClient} from "../extensions/vscode/src/daemon-client.js";
import {ManagedExecutionClient,ManagedGraphPass,type ExecutionContextHandoff} from "../packages/sdk/src/seams/graph-execution.js";
import {ManagedCliPass} from "../extensions/vscode/src/managed-cli-pass.js";
import {ExecutionReviewController} from "../extensions/vscode/src/execution-review.js";
import {prepareExecutionApproval} from "../src/server/execution-policy.js";
import {ManagedNativePass} from "../extensions/vscode/src/managed-native-pass.js";
import {executeScopedCommand} from "../src/server/scoped-command.js";
import {Server as McpServer} from "@modelcontextprotocol/sdk/server/index.js";
import {McpServer as McpOwner} from '@modelcontextprotocol/sdk/server/mcp.js';
import {registerCodeSensesTools} from '../src/tools/code-senses.js';
import {StreamableHTTPServerTransport} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {CallToolRequestSchema} from "@modelcontextprotocol/sdk/types.js";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {compiledEditor} from './helpers/compiled-editor.js';
import {Client as WireClient} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {configureToolBoundary} from '../src/server/server.js';
import {registerPluginContributions} from '../src/plugins/contributions.js';
import {_resetPluginManagerForTest,bootstrapPlugins,unloadPluginById} from '../src/plugins/manager.js';
import * as lifecycle from '../src/instance/lifecycle.js';
import {InstanceScope} from '../src/instance/scope.js';
import type {ManagedModelAdmissionRequest,ManagedModelPermit} from '../src/graph/contracts.js';

let root:string,previous:string,server:Server,port:number,repos:Record<string,string>,authority:DaemonHttpAuthority;
const contexts=new Map<string,SessionContext>();
const clients:DaemonClient[]=[];
const mcpConnections:Array<{server:{close():Promise<void>};transport:StreamableHTTPServerTransport}>=[];
let realSourceOwners=false;
let contributedOwners=false,pluginCleanup:(()=>Promise<void>)|undefined;
const modelRequests:any[]=[];
const modelReplies:Array<(body:any)=>unknown>=[];
const modelHandlers:Array<(body:any,res:ServerResponse)=>Promise<void>|void>=[];
const modelDispatchEvidence:any[]=[];
const client=()=>{const value=new DaemonClient({host:"127.0.0.1",port,timeoutMs:10000});clients.push(value);return value;};
beforeEach(async()=>{
 realSourceOwners=false;
 contributedOwners=false;pluginCleanup=undefined;
 previous=getDataDir();repos={...config.repos};root=await mkdtemp(join(tmpdir(),"dg-host-execution-"));setDataDirOverride(join(root,"data"));config.repos={fixture:root};
 await writeFile(join(root,"source.ts"),"source before");await commitGraphWrites({actor:"fixture",scope:["features.json"],writes:[{file:"features.json",content:JSON.stringify({features:[{id:"host",name:"Host context",description:"Native adapters preserve authority",source_repo:"fixture",source_files:["source.ts"]}]})}]});
 authority=new DaemonHttpAuthority(1,{});
 server=createServer((req,res)=>{void(async()=>{
  if(['/v1/chat/completions','/v1/responses','/v1/messages','/v1/api/chat'].includes(req.url!)){
   const parts:Buffer[]=[];for await(const chunk of req)parts.push(Buffer.from(chunk));const body=JSON.parse(Buffer.concat(parts).toString('utf8'));modelRequests.push(body);
   modelDispatchEvidence.push(JSON.parse(await readFile(join(root,'data/spend_ledger.json'),'utf8')));
   const handler=modelHandlers.shift();if(handler){await handler(body,res);return;}
   const reply=modelReplies.shift();if(!reply){res.writeHead(409);res.end('No declared offline provider reply');return;}
   res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(reply(body)));return;
  }
  const owner=await authority.authorize(req,res);if(!owner)return;if(!owner.execution_policy)contexts.set(owner.session_id,owner);
  await withSessionContext(owner,async()=>{
   const pathname=new URL(req.url!,"http://local").pathname;
   if(await authority.handle(req,res,owner))return;
   if(pathname==="/mcp"){
    let connection=mcpConnections.find(value=>value.transport.sessionId===req.headers['mcp-session-id']);
    if(!connection){
     if(realSourceOwners||contributedOwners){
      const upstream=new McpOwner({name:'actual-source-owners',version:'1'});
      configureToolBoundary(upstream,owner);
      registerCodeSensesTools(upstream);
      if(contributedOwners)registerPluginContributions(upstream);
      const transport=new StreamableHTTPServerTransport({sessionIdGenerator:randomUUID});await upstream.connect(transport);connection={server:upstream,transport};mcpConnections.push(connection);
     }else{
     const upstream=new McpServer({name:'declared-editor-source-owners',version:'1'},{capabilities:{tools:{}}});
     upstream.setRequestHandler(CallToolRequestSchema,(request,extra)=>invokeToolBoundary({name:request.params.name,
      shape:request.params.name==='create_file'?{filePath:z.string(),content:z.string()}:{filePath:z.string()},args:request.params.arguments,extra,
      handler:async()=>{
       const args=request.params.arguments as {filePath:string;content:string};
       return request.params.name==='create_file'
        ?{content:[{type:'text',text:JSON.stringify({obligation:await managedSourceEffect({changes:[{file:join(root,args.filePath),content:args.content}],apply:()=>writeFile(join(root,args.filePath),args.content)})})}]}
        :{content:[{type:'text',text:JSON.stringify({source:await readFile(join(root,args.filePath),'utf8')})}]};
      }}));
     const transport=new StreamableHTTPServerTransport({sessionIdGenerator:randomUUID});await upstream.connect(transport);connection={server:upstream,transport};mcpConnections.push(connection);
     }
    }
    await connection.transport.handleRequest(req,res);return;
   }
   if(pathname==='/api/architect/v1/execution/command'){
    const parts:Buffer[]=[];for await(const chunk of req)parts.push(Buffer.from(chunk));
    try{const result=await executeScopedCommand(owner.execution_policy,JSON.parse(Buffer.concat(parts).toString('utf8')),root);
     res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));}
    catch(error){res.writeHead(409,{'Content-Type':'application/json'});res.end(JSON.stringify({error:String(error)}));}return;
   }
   if(pathname.startsWith("/api/architect/v1/execution/context/")){
    try{const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
     const result=await executionContextTransport(pathname.endsWith("/refresh")?"refresh":"deliver",JSON.parse(Buffer.concat(chunks).toString()));
     res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify(result));
    }catch(error){res.writeHead(409,{"Content-Type":"application/json"});res.end(JSON.stringify({error:String(error)}));}return;
   }
   if(!await handleApiRoute(req,res,pathname)){res.writeHead(404);res.end();}
  });
 })().catch(error=>{if(!res.headersSent)res.writeHead(500);res.end(String(error));});});
 await new Promise<void>(done=>server.listen(0,"127.0.0.1",done));port=(server.address() as {port:number}).port;
});
afterEach(async()=>{for(const value of clients.splice(0))value.dispose();for(const connection of mcpConnections.splice(0))await connection.server.close();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));
 modelHandlers.splice(0);modelDispatchEvidence.splice(0);
 if(pluginCleanup)await pluginCleanup();
 await releaseGraphWriter(join(root,"data"));setDataDirOverride(previous);config.repos=repos;contexts.clear();modelRequests.splice(0);modelReplies.splice(0);vi.unstubAllEnvs();await rm(root,{recursive:true,force:true});});

it("the actual editor client retains one owner, injects an exact block, replays acknowledgement and closes a read-only pass",async()=>{
 const host=client(),before=await loadPublicationState();
 const result=await host.beginExecution({id:"editor-one",adapter:"vscode/native",query:"Host context"});
 expect(result.execution).toMatchObject({status:"assembled",authority_active:true,pack:{receipt:{delivery:"unattested"}},delivery_attests:"host_transport_only"});
 expect(result.execution.block).toContain("Native adapters preserve authority");
 await host.deliverExecution(result.workerBearer,result.execution.pack.receipt.id,result.execution.block);
 await host.deliverExecution(result.workerBearer,result.execution.pack.receipt.id,result.execution.block);
 const current=await host.readExecution("editor-one");expect(current.pack.receipt.delivery).toBe("delivered");
 const owner=[...contexts.values()].find(value=>!value.execution_policy)!;
 await withSessionContext(owner,()=>assertManagedContext("editor-one"));
 const refreshed=await host.refreshExecution(result.workerBearer);expect(refreshed.pack.receipt.delivery).toBe("unattested");
 await host.deliverExecution(result.workerBearer,refreshed.pack.receipt.id,refreshed.block);
 expect(await host.finishExecution("editor-one","completed","confirmed")).toMatchObject({status:"no_change",authority_active:false});
 expect((await loadPublicationState()).revision.graph_revision).toBe(before.revision.graph_revision);
 await expect(host.refreshExecution(result.workerBearer)).rejects.toThrow("UNAVAILABLE");
 await expect(host.beginExecution({id:"editor-one",adapter:"vscode/native",query:"Host context"})).rejects.toThrow("EXECUTION_ID_ALREADY_USED");
});
it("parallel host passes share their authenticated owner while another client cannot read or close them",async()=>{
 const host=client(),other=client();
 const leases=await Promise.all(["a","b"].map(id=>host.beginExecution({id,adapter:"sdk/native",query:"Host context"})));
 expect(leases.map(value=>value.execution.execution_id)).toEqual(["a","b"]);
 await expect(other.readExecution("a")).rejects.toThrow("OWNER_MISMATCH");
 await expect(other.finishExecution("b","cancelled","confirmed")).rejects.toThrow("OWNER_MISMATCH");
 expect((await host.readExecution("b")).authority_active).toBe(true);
 for(const id of ["a","b"])await host.finishExecution(id,"cancelled","confirmed");
});
it("a worker credential cannot issue a new grant, close another host pass or change its chosen identity",async()=>{
 const host=client(),lease=await host.beginExecution({id:"worker",adapter:"vscode/codex-cli",query:"Host context"});
 for(const [route,body] of [["begin",{id:"escalation",adapter:"worker",query:"Host context",approved_actions:[]}],["finish",{execution_id:"worker",outcome:"completed",work_termination:"confirmed"}]] as const){
  const response=await fetch(`http://127.0.0.1:${port}/api/executions/v1/${route}`,{method:"POST",headers:{"Content-Type":"application/json","X-DreamGraph-Session":lease.workerBearer},body:JSON.stringify(body)});
  expect(response.status).toBe(403);
 }
 const response=await fetch(`http://127.0.0.1:${port}/api/architect/v1/execution/context/refresh`,{method:"POST",headers:{"Content-Type":"application/json","X-DreamGraph-Session":lease.workerBearer},body:JSON.stringify({execution_id:"another"})});
 expect(response.status).toBe(409);
 await host.finishExecution("worker","cancelled","confirmed");
});
it("host-mediated effects use the original exact policy and retain source debt; unknown adapter termination is recoverable",async()=>{
 const host=client(),args={filePath:"source.ts",content:"source after"};
 const lease=await host.beginExecution({id:"sdk-write",adapter:"sdk/native",query:"Host context",approved_actions:[{tool:"edit_file",arguments:args,scope_id:"fixture",calls:1}]});
 await host.deliverExecution(lease.workerBearer,lease.execution.pack.receipt.id,lease.execution.block);
 const owner=[...contexts.values()].find(value=>!value.execution_policy)!;
 const result=await withSessionContext(owner,()=>withHostExecution("sdk-write",()=>invokeToolBoundary({name:"edit_file",shape:{filePath:z.string(),content:z.string()},args,handler:async()=>{
  const obligation=await managedSourceEffect({changes:[{file:join(root,"source.ts"),content:args.content}],apply:()=>writeFile(join(root,"source.ts"),args.content)});
  return {content:[{type:"text",text:JSON.stringify({obligation})}]};}})));
 expect(result.isError).not.toBe(true);
 expect(await host.finishExecution("sdk-write","completed","confirmed")).toMatchObject({status:"reconciliation_pending",authority_active:false,obligation_ids:[expect.any(String)]});
 const unknown=await host.beginExecution({id:"lost-provider",adapter:"sdk/native",query:"Host context"});
 expect(unknown.execution.status).toBe("assembled");
 expect(await host.finishExecution("lost-provider","cancelled","unconfirmed")).toMatchObject({status:"recovery_required",authority_active:false});
 expect(await withSessionContext(owner,()=>readHostExecution("lost-provider"))).toMatchObject({status:"recovery_required"});
});
it("the actual portable SDK port uses the generated host contract, retains ownership and cannot acknowledge a clipped block",async()=>{
 const sdk=new ManagedExecutionClient({baseUrl:`http://127.0.0.1:${port}`,timeoutMs:10000});
 try{const lease=await sdk.begin({id:"portable-sdk",adapter:"sdk",query:"Host context"});
  await expect(sdk.deliver(lease.workerBearer,lease.execution.pack.receipt.id,lease.execution.pack.context_text)).rejects.toThrow("DELIVERY_MISMATCH");
  await sdk.deliver(lease.workerBearer,lease.execution.pack.receipt.id,lease.execution.block);
  const updated=await sdk.refresh(lease.workerBearer);await sdk.deliver(lease.workerBearer,updated.pack.receipt.id,updated.block);
  expect(await sdk.read("portable-sdk")).toMatchObject({status:"running",pack:{receipt:{delivery:"delivered"}}});
  expect(await sdk.finish("portable-sdk","completed","confirmed")).toMatchObject({status:"no_change",authority_active:false});
 }finally{sdk.dispose();}
 await expect(sdk.read("portable-sdk")).rejects.toThrow("DISPOSED");
});

/** Delay only session transport; execution routes still use the actual HTTP/core authority. */
function initializingClient(kind:'editor'|'sdk') {
 const nativeFetch=globalThis.fetch,bodies:unknown[]=[];
 let entered!:()=>void,release!:()=>void;
 const started=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve);
 const delayed:typeof fetch=async(url,init)=>{
  if(String(url).endsWith('/api/authority/v1/status')){entered();await gate;return nativeFetch(url,{...init,signal:undefined});}
  if(String(url).endsWith('/api/executions/v1/begin'))bodies.push(JSON.parse(String(init?.body)));
  return nativeFetch(url,init);
 };
 if(kind==='editor')vi.stubGlobal('fetch',delayed);
 const host=kind==='editor'?client():new ManagedExecutionClient({baseUrl:`http://127.0.0.1:${port}`,timeoutMs:10000,fetch:delayed});
 return {port:host,started,release,bodies,
  begin:(request:any,signal?:AbortSignal)=>host instanceof DaemonClient?host.beginExecution(request,signal):host.begin(request,signal),
  read:(id:string)=>host instanceof DaemonClient?host.readExecution(id):host.read(id),
  finish:(id:string)=>host instanceof DaemonClient?host.finishExecution(id,'completed','confirmed'):host.finish(id,'completed','confirmed'),
  cleanup:()=>{release();host.dispose();vi.unstubAllGlobals();}};
}
it.each(['editor','sdk'] as const)('%s initialization cancellation stops only its caller and preserves another caller on the shared handshake',async kind=>{
 const fixture=initializingClient(kind),stop=new AbortController();
 let firstStopped=false;
 const first=fixture.begin({id:'cancelled-initialization',adapter:kind,query:'Host context'},stop.signal).catch(error=>error).then(result=>{firstStopped=true;return result;});
 const second=fixture.begin({id:'retained-initialization',adapter:kind,query:'Host context'});
 try{
  await fixture.started;stop.abort(new Error('caller stopped waiting'));
  await vi.waitFor(()=>expect(firstStopped).toBe(true),{timeout:2000});
  expect(String(await first)).toContain('caller stopped waiting');expect(fixture.bodies).toEqual([]);
  fixture.release();const lease=await second;expect(lease.execution.execution_id).toBe('retained-initialization');
  expect(fixture.bodies).toHaveLength(1);await fixture.finish('retained-initialization');
 }finally{fixture.release();await second.catch(()=>undefined);fixture.cleanup();}
},15000);
it.each(['editor','sdk'] as const)('%s freezes nested exact approvals before the shared session wait',async kind=>{
 const fixture=initializingClient(kind),request={id:'captured-initialization',adapter:kind,query:'Host context',approved_actions:[{tool:'create_file',arguments:{filePath:'source.ts',content:'original proposal'},scope_id:'fixture',calls:1}]};
 const running=fixture.begin(request);
 try{
  await fixture.started;request.id='substituted';request.approved_actions[0].arguments.content='unreviewed replacement';request.approved_actions[0].calls=9;
  fixture.release();const lease=await running;expect(lease.execution.execution_id).toBe('captured-initialization');
  expect(fixture.bodies[0]).toMatchObject({id:'captured-initialization',approved_actions:[{arguments:{content:'original proposal'},calls:1}]});
  await fixture.finish('captured-initialization');
 }finally{fixture.release();await running.catch(()=>undefined);fixture.cleanup();}
},15000);
it.each(['editor','sdk'] as const)('%s disposal prevents a delayed noncooperative handshake from dispatching or restoring authority',async kind=>{
 const nativeFetch=globalThis.fetch;let release!:()=>void,entered!:()=>void;
 const gate=new Promise<void>(resolve=>release=resolve),started=new Promise<void>(resolve=>entered=resolve);let begins=0;
 const delayed:typeof fetch=async(url,init)=>{
  if(String(url).endsWith('/api/authority/v1/status')){entered();await gate;return nativeFetch(url,{...init,signal:undefined});}
  begins++;return nativeFetch(url,init);
 };
 if(kind==='editor')vi.stubGlobal('fetch',delayed);
 const host=kind==='editor'?client():new ManagedExecutionClient({baseUrl:`http://127.0.0.1:${port}`,fetch:delayed,timeoutMs:10000});
 const begin=()=>host instanceof DaemonClient?host.beginExecution({id:'disposed-initialization',adapter:kind,query:'Host context'}):host.begin({id:'disposed-initialization',adapter:kind,query:'Host context'});
 const running=begin().catch(error=>error);
 try{
  await started;host.dispose();release();expect(await running).toBeInstanceOf(Error);expect(begins).toBe(0);
  await expect(begin()).rejects.toThrow('DISPOSED');
  expect(host instanceof DaemonClient?(host as any)._sessionBearer:(host as any).session).toBeUndefined();
 }finally{release();await running;host.dispose();vi.unstubAllGlobals();}
},15000);
it('editor session readiness cannot redirect a queued authority call to a replacement endpoint',async()=>{
 const host=client();await host.beginExecution({id:'original-endpoint',adapter:'editor',query:'Host context'});
 const running=host.readExecution('original-endpoint').catch(error=>error);host.updateEndpoint('127.0.0.1',port+1);
 expect(String(await running)).toContain('ENDPOINT_CHANGED');
 const owner=[...contexts.values()].find(value=>!value.execution_policy)!;
 await withSessionContext(owner,async()=>{const {endHostExecution}=await import('../src/server/managed-execution.js');await endHostExecution({execution_id:'original-endpoint',outcome:'cancelled',work_termination:'confirmed'});});
});
it('editor changed endpoints reject late handshake replies rather than adopting a new owner',async()=>{
 const fixture=initializingClient('editor'),running=fixture.begin({id:'old-handshake',adapter:'editor',query:'Host context'}).catch(error=>error);
 try{await fixture.started;(fixture.port as DaemonClient).updateEndpoint('127.0.0.1',port+1);fixture.release();expect(await running).toBeInstanceOf(Error);expect(fixture.bodies).toEqual([]);expect((fixture.port as any)._sessionBearer).toBeUndefined();}
 finally{fixture.release();await running;fixture.cleanup();}
});
it('SDK constructor options cannot be mutated into a different transport after construction',async()=>{
 let redirected=0;const options={baseUrl:`http://127.0.0.1:${port}`,timeoutMs:10000,fetch:globalThis.fetch};const host=new ManagedExecutionClient(options);
 options.fetch=async()=>{redirected++;throw new Error('mutated transport');};
 try{const lease=await host.begin({id:'captured-sdk-transport',adapter:'sdk',query:'Host context'});expect(lease.execution.execution_id).toBe('captured-sdk-transport');expect(redirected).toBe(0);await host.finish(lease.execution.execution_id,'completed','confirmed');}
 finally{host.dispose();}
});

const wholeHandoff=async(context:ExecutionContextHandoff)=>({receiptId:context.pack.receipt.id,block:context.block});
const sdkHost=(fetchOverride?:typeof fetch)=>new ManagedExecutionClient({baseUrl:`http://127.0.0.1:${port}`,timeoutMs:10000,fetch:fetchOverride});
it('SDK native lifecycle captures request/port identities, refreshes each continuation and preserves whole literal results',async()=>{
 const host=sdkHost(),request={id:'sdk-native-loop',adapter:'sdk/native',query:'Host context'},pass=new ManagedGraphPass(host,request);
 const begin=host.begin;host.begin=async()=>{throw new Error('replacement port must not run');};request.id='replacement-id';
 try{
  const initial=await pass.begin();expect(initial.execution_id).toBe('sdk-native-loop');let prompts:string[]=[];
  const handoff=async(context:ExecutionContextHandoff)=>{prompts.push(context.block);context.pack.context_text='untrusted caller mutation';return wholeHandoff(context);};
  await expect(pass.run(async()=>({result:'no dispatch',workTermination:'confirmed'}))).rejects.toThrow('NOT_DELIVERED');
  await pass.prepare(handoff);expect((await pass.inspect()).pack.receipt.delivery).toBe('delivered');
  const result={isError:true,content:[{type:'text',text:'🌿漢'.repeat(12000)}],structuredContent:{owner_receipt:'literal original'}};
  expect(await pass.run(async worker=>{expect(prompts.join('')).not.toContain(worker.workerBearer);return {result,workTermination:'confirmed'};})).toBe(result);
  await expect(pass.run(async()=>({result:'no continuation',workTermination:'confirmed'}))).rejects.toThrow('NOT_DELIVERED');
  await pass.prepare(handoff);expect((await pass.inspect()).pack.receipt.id).not.toBe(initial.pack.receipt.id);expect(prompts).toHaveLength(2);
  await pass.run(async()=>({result:'read-only continuation',workTermination:'confirmed'}));
  const closed=await pass.finish('completed');expect(closed).toMatchObject({status:'no_change',authority_active:false});
  const returned=pass.lastSnapshot!;returned.execution_id='caller mutation';expect(pass.lastSnapshot?.execution_id).toBe('sdk-native-loop');
  expect(await pass.finish('completed')).toEqual(closed);await expect(pass.prepare(wholeHandoff)).rejects.toThrow();
 }finally{host.begin=begin;await pass.finish('completed').catch(()=>undefined);host.dispose();}
});
it('SDK handoff rejects a clipped exact checkpoint before worker dispatch and never acknowledges it',async()=>{
 const host=sdkHost(),pass=new ManagedGraphPass(host,{id:'sdk-clipped-handoff',adapter:'sdk/cli',query:'Host context'});let dispatched=false;
 try{await pass.begin();await expect(pass.prepare(async context=>({receiptId:context.pack.receipt.id,block:context.pack.context_text}))).rejects.toThrow('HANDOFF_MISMATCH');
  expect((await pass.inspect()).pack.receipt.delivery).toBe('unattested');
  await expect(pass.run(async()=>{dispatched=true;return {result:null,workTermination:'confirmed'};})).rejects.toThrow('NOT_READY');expect(dispatched).toBe(false);
  expect(await pass.finish('failed')).toMatchObject({status:'no_change',authority_active:false});
 }finally{await pass.finish('failed').catch(()=>undefined);host.dispose();}
});
it('SDK native worker performs one actual governed source effect and retains durable source debt rather than graph completion',async()=>{
 realSourceOwners=true;const args={filePath:'source.ts',old_text:'source before',new_text:'SDK physical source 🌿\n'},host=sdkHost(),pass=new ManagedGraphPass(host,{id:'sdk-source-owner',adapter:'sdk/native',query:'Host context',approved_actions:[{tool:'edit_file',arguments:args,scope_id:'fixture',calls:1}]});
 let workerClient:WireClient|undefined;
 try{await pass.begin();await pass.prepare(wholeHandoff);
  const result=await pass.run(async worker=>{
   workerClient=new WireClient({name:'sdk-native-fixture',version:'1'});await workerClient.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`),{requestInit:{headers:{'X-DreamGraph-Session':worker.workerBearer}}}));
   const result=await workerClient.callTool({name:'edit_file',arguments:args},undefined,{signal:worker.signal});
   expect(result.isError,JSON.stringify(result)).not.toBe(true);expect((await workerClient.callTool({name:'edit_file',arguments:args},undefined,{signal:worker.signal})).isError).toBe(true);
   return {result,workTermination:'confirmed'};
  });
  expect(result.content).toBeTruthy();expect(await readFile(join(root,'source.ts'),'utf8')).toBe(args.new_text);
  expect(await pass.finish('completed')).toMatchObject({status:'reconciliation_pending',authority_active:false,graph_receipt_ids:[],obligation_ids:[expect.any(String)]});
 }finally{await workerClient?.close();await pass.finish('completed').catch(()=>undefined);host.dispose();}
});
it('SDK wait cancellation keeps a noncooperative callback and late successful reply termination-unconfirmed',async()=>{
 const host=sdkHost(),pass=new ManagedGraphPass(host,{id:'sdk-noncooperative',adapter:'sdk/native',query:'Host context'});
 let enter!:()=>void,release!:()=>void,finished=false;const entered=new Promise<void>(resolve=>enter=resolve),gate=new Promise<void>(resolve=>release=resolve);
 try{await pass.begin();await pass.prepare(wholeHandoff);
  const waiting=pass.run(async worker=>{enter();await gate;finished=true;expect(worker.signal.aborted).toBe(true);return {result:'late successful prose',workTermination:'confirmed'};}).catch(error=>error);
  await entered;pass.cancel();expect(await waiting).toBeInstanceOf(Error);expect(finished).toBe(false);expect(pass.workTermination).toBe('unconfirmed');
  expect(await pass.finish('cancelled')).toMatchObject({status:'recovery_required',authority_active:false});
  release();await vi.waitFor(()=>expect(finished).toBe(true),{timeout:2000});expect(pass.workTermination).toBe('unconfirmed');
  expect((await pass.inspect()).status).toBe('recovery_required');await expect(pass.run(async()=>({result:'repeat',workTermination:'confirmed'}))).rejects.toThrow();
 }finally{release();await pass.finish('cancelled').catch(()=>undefined);host.dispose();}
});
it('SDK native termination requires explicit harness evidence and never derives it from settled successful prose',async()=>{
 const host=sdkHost(),pass=new ManagedGraphPass(host,{id:'sdk-termination-evidence',adapter:'sdk/cli',query:'Host context'});
 try{await pass.begin();await pass.prepare(wholeHandoff);expect(await pass.run(async()=>({result:'child closed but descendants unverified',workTermination:'unconfirmed'}))).toContain('descendants');
  expect(pass.workTermination).toBe('unconfirmed');await expect(pass.prepare(wholeHandoff)).rejects.toThrow('NOT_READY');
  expect(await pass.finish('completed')).toMatchObject({status:'recovery_required',authority_active:false});
 }finally{await pass.finish('completed').catch(()=>undefined);host.dispose();}
});
it('SDK refuses missing native termination evidence instead of treating callback settlement as confirmation',async()=>{
 const host=sdkHost(),pass=new ManagedGraphPass(host,{id:'sdk-missing-termination',adapter:'sdk/native',query:'Host context'});
 try{await pass.begin();await pass.prepare(wholeHandoff);await expect(pass.run(async()=>({result:'successful prose'}) as any)).rejects.toThrow('TERMINATION_ATTESTATION_REQUIRED');
  expect(await pass.finish('failed')).toMatchObject({status:'recovery_required',authority_active:false});
 }finally{await pass.finish('failed').catch(()=>undefined);host.dispose();}
});
it('SDK total pass deadline cancels a noncooperative native wait without claiming that underlying work stopped',async()=>{
 const host=sdkHost(),pass=new ManagedGraphPass(host,{id:'sdk-native-deadline',adapter:'sdk/native',query:'Host context',timeout_ms:1000});
 let enter!:()=>void,release!:()=>void,finished=false;const entered=new Promise<void>(resolve=>enter=resolve),gate=new Promise<void>(resolve=>release=resolve);
 try{await pass.begin();await pass.prepare(wholeHandoff);
  const waiting=pass.run(async()=>{enter();await gate;finished=true;return {result:'late native result',workTermination:'confirmed'};}).catch(error=>error);
  await entered;await expect(pass.prepare(wholeHandoff)).rejects.toThrow('NOT_READY');expect(await waiting).toBeInstanceOf(Error);expect(pass.signal.aborted).toBe(true);expect(finished).toBe(false);
  expect(await pass.finish('cancelled')).toMatchObject({status:'recovery_required',authority_active:false});release();await vi.waitFor(()=>expect(finished).toBe(true),{timeout:2000});expect(pass.workTermination).toBe('unconfirmed');
 }finally{release();await pass.finish('cancelled').catch(()=>undefined);host.dispose();}
},15000);
it('SDK lost admission retains its original ID, inspects only that owner and can close without repeating admission',async()=>{
 const actualFetch=globalThis.fetch;let admissions=0,dispatches=0;
 const host=sdkHost(async(url,init)=>{const response=await actualFetch(url,init);if(String(url).endsWith('/begin')){admissions++;await response.text();throw new Error('declared lost admission acknowledgement');}return response;}),pass=new ManagedGraphPass(host,{id:'sdk-lost-admission',adapter:'sdk/native',query:'Host context'});
 try{await expect(pass.begin()).rejects.toThrow('lost admission');await expect(pass.begin()).rejects.toThrow('ALREADY_STARTED');
  expect(await pass.inspect()).toMatchObject({execution_id:'sdk-lost-admission',status:'assembled',authority_active:true});
  await expect(pass.run(async()=>{dispatches++;return {result:null,workTermination:'confirmed'};})).rejects.toThrow('NOT_READY');
  expect(await pass.finish('failed')).toMatchObject({status:'no_change',authority_active:false});expect(admissions).toBe(1);expect(dispatches).toBe(0);
 }finally{await pass.finish('failed').catch(()=>undefined);host.dispose();}
});
it.each(['confirmed','unconfirmed'] as const)('SDK lost closure retries only its captured %s termination after actual owner closure, without repeating native work',async termination=>{
 const actualFetch=globalThis.fetch,bodies:unknown[]=[];let calls=0;
 const host=sdkHost(async(url,init)=>{const response=await actualFetch(url,init);if(String(url).endsWith('/finish')){bodies.push(JSON.parse(String(init?.body)));if(bodies.length===1){await response.text();throw new Error('declared lost closure acknowledgement');}}return response;}),pass=new ManagedGraphPass(host,{id:'sdk-lost-closure',adapter:'sdk/native',query:'Host context'});
 try{await pass.begin();await pass.prepare(wholeHandoff);await pass.run(async()=>{calls++;return {result:'native harness outcome',workTermination:termination};});
  const status=termination==='confirmed'?'no_change':'recovery_required';
  await expect(pass.finish('completed')).rejects.toThrow('lost closure');expect(await pass.inspect()).toMatchObject({status,authority_active:false});
  await expect(pass.finish('failed')).rejects.toThrow('CLOSURE_CHANGED');expect(await pass.finish('completed')).toMatchObject({status,authority_active:false});
  expect(bodies).toEqual([{execution_id:pass.executionId,outcome:'completed',work_termination:termination},{execution_id:pass.executionId,outcome:'completed',work_termination:termination}]);expect(calls).toBe(1);
 }finally{await pass.finish('completed').catch(()=>undefined);host.dispose();}
});
it('SDK late inspection cannot replace its confirmed inactive closure with an earlier active snapshot',async()=>{
 const actualFetch=globalThis.fetch;let enter!:()=>void,release!:()=>void;
 const entered=new Promise<void>(resolve=>enter=resolve),gate=new Promise<void>(resolve=>release=resolve);
 const host=sdkHost(async(url,init)=>{const response=await actualFetch(url,init);if(String(url).endsWith('/read')){const text=await response.text();enter();await gate;return new Response(text,{status:response.status,headers:response.headers});}return response;}),pass=new ManagedGraphPass(host,{id:'sdk-late-inspection',adapter:'sdk/native',query:'Host context'});
 try{await pass.begin();const inspecting=pass.inspect().catch(error=>error);await entered;
  const closed=await pass.finish('completed');expect(closed.authority_active).toBe(false);release();expect(String(await inspecting)).toContain('INSPECTION_STALE');
  expect(await pass.finish('completed')).toEqual(closed);expect(pass.lastSnapshot?.authority_active).toBe(false);
 }finally{release();await pass.finish('completed').catch(()=>undefined);host.dispose();}
});
it('SDK refresh rejects a foreign execution receipt before handoff or new worker dispatch',async()=>{
 const host=sdkHost(),refresh=host.refresh.bind(host);host.refresh=async(...args)=>{const result=await refresh(...args);result.pack.receipt.execution_id='foreign-execution';return result;};
 const pass=new ManagedGraphPass(host,{id:'sdk-foreign-refresh',adapter:'sdk/native',query:'Host context'});let handoffs=0;
 try{await pass.begin();await pass.prepare(wholeHandoff);await pass.run(async()=>({result:'first request',workTermination:'confirmed'}));
  await expect(pass.prepare(async context=>{handoffs++;return wholeHandoff(context);})).rejects.toThrow('CONTEXT_INVALID');expect(handoffs).toBe(0);
  expect(await pass.finish('failed')).toMatchObject({status:'no_change',authority_active:false});
 }finally{await pass.finish('failed').catch(()=>undefined);host.dispose();}
});
it('SDK worker reads canonical plugin graph evidence through the actual manager/resource transport without inheriting host authority',async()=>{
 const uuid='11111111-2222-3333-4444-eeeeeeeeeeee',id='fixture.sdk',uri='plugin://fixture.sdk/context',plugin=join(root,uuid,'plugins',id),oldAllow=process.env.DG_ALLOW_INPROCESS_PLUGINS;
 _resetPluginManagerForTest();process.env.DG_ALLOW_INPROCESS_PLUGINS='true';const scopeSpy=vi.spyOn(lifecycle,'getActiveScope').mockReturnValue(new InstanceScope(uuid,root));
 pluginCleanup=async()=>{await unloadPluginById(id);_resetPluginManagerForTest();scopeSpy.mockRestore();if(oldAllow===undefined)delete process.env.DG_ALLOW_INPROCESS_PLUGINS;else process.env.DG_ALLOW_INPROCESS_PLUGINS=oldAllow;};
 await mkdir(plugin,{recursive:true});await writeFile(join(root,uuid,'instance.json'),JSON.stringify({uuid,name:'fixture-sdk',plugins:[{path:'./plugins/'+id,trusted:true}]}));
 await writeFile(join(plugin,'plugin.json'),JSON.stringify({id,version:'1.0.0',displayName:'SDK graph fixture',engine:{dreamgraph:'>=13.4.0'},main:'./index.mjs',intent:'Qualify canonical resource context',capabilities:['resources:register','resources:read'],expectedEffects:['emit_resource','read_internal_graph'],resources:[{uriNamespace:uri}]}));
 await writeFile(join(plugin,'index.mjs'),`export function activate(ctx){ctx.resources.register({uriNamespace:'${uri}',name:'Canonical context',expectedEffects:['emit_resource','read_internal_graph'],handler:async(_request,context)=>({contents:[{uri:'${uri}',mimeType:'application/json',text:JSON.stringify(await ctx.graph.retrieve({query:'Host context',execution_id:'sdk-plugin-read'},{signal:context.signal}))}],_meta:{private_effects:'unattested'}})});}`);
 await bootstrapPlugins();contributedOwners=true;const host=sdkHost(),pass=new ManagedGraphPass(host,{id:'sdk-plugin-read',adapter:'sdk/native',query:'Host context'});let workerClient:WireClient|undefined;
 try{await pass.begin();await pass.prepare(wholeHandoff);
  const result=await pass.run(async worker=>{workerClient=new WireClient({name:'sdk-plugin-reader',version:'1'});await workerClient.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`),{requestInit:{headers:{'X-DreamGraph-Session':worker.workerBearer}}}));
   const result=await workerClient.readResource({uri},undefined,{signal:worker.signal});return {result,workTermination:'confirmed'};});
  const pack=JSON.parse((result.contents[0] as {text:string}).text);expect(pack).toMatchObject({schema:'dreamgraph.context_pack.v1',receipt:{adapter:'plugin:fixture.sdk',delivery:'unattested',execution_id:pass.executionId}});expect(pack.context_text).toContain('Native adapters preserve authority');
  expect(result._meta?.plugin_handler).toMatchObject({callback_settled:true,private_effects:'unattested; consult owner receipts'});
  expect(await pass.finish('completed')).toMatchObject({status:'no_change',authority_active:false});
 }finally{await workerClient?.close();await pass.finish('completed').catch(()=>undefined);host.dispose();}
});

it("editor CLI admission injects the whole current pack after serialization and closes against actual durable receipts",async()=>{
 const host=client(),pass=await ManagedCliPass.begin(host,{id:"editor-cli-prompt",adapter:"vscode/codex-cli",query:"Host context"});
 const prepared=await pass.preparePrompt("[user]\nUnicode: 🌿 é");
 const initial=await host.readExecution(pass.executionId);
 expect(prepared).toContain("Unicode: 🌿 é");expect(prepared).toContain(initial.block);
 expect(prepared).not.toContain(pass.workerBearer);expect(initial.pack.receipt.delivery).toBe("delivered");
 const refreshed=await pass.preparePrompt("[user]\nContinue from the current graph");
 const current=await host.readExecution(pass.executionId);
 expect(current.pack.receipt.id).not.toBe(initial.pack.receipt.id);expect(refreshed).toContain(current.block);
 expect(current.pack.receipt.delivery).toBe("delivered");
 pass.observeRun({ok:true,spawn:{exitCode:0,signal:null,timedOut:false,aborted:false}});
 const closed=await pass.finish();expect(closed).toMatchObject({status:"no_change",authority_active:false});
 expect(await pass.finish()).toEqual(closed);await expect(pass.preparePrompt("again")).rejects.toThrow("CLOSED");
});
it("editor CLI byte admission refuses the whole over-budget request before acknowledging or launching it",async()=>{
 const host=client(),pass=await ManagedCliPass.begin(host,{id:"editor-cli-budget",adapter:"vscode/copilot-cli",query:"Host context"},undefined,1024);
 await expect(pass.preparePrompt("🌿".repeat(500))).rejects.toThrow("PROMPT_BYTE_BOUND");
 expect((await host.readExecution(pass.executionId)).pack.receipt.delivery).toBe("unattested");
 expect(await pass.finish()).toMatchObject({status:"no_change",authority_active:false});
});
it("editor CLI cancellation preserves unconfirmed descendant termination instead of proving a no-change pass",async()=>{
 const host=client(),pass=await ManagedCliPass.begin(host,{id:"editor-cli-cancel",adapter:"vscode/codex-cli",query:"Host context"});
 await pass.preparePrompt("[user]\nInspect host context");
 pass.observeRun({ok:false,failure:{preSpawn:false},spawn:{exitCode:0,signal:null,timedOut:false,aborted:true}});
 const closed=await pass.finish(true);expect(closed).toMatchObject({status:"recovery_required",authority_active:false});
 expect(await pass.finish(true)).toEqual(closed);
});
it("editor CLI pre-launch failure settles without model work; cancellation during acknowledgement cannot yield a launchable prompt",async()=>{
 const host=client(),controller=new AbortController();
 const pass=await ManagedCliPass.begin({...host,
  beginExecution:host.beginExecution.bind(host),refreshExecution:host.refreshExecution.bind(host),finishExecution:host.finishExecution.bind(host),
  deliverExecution:async(...args:Parameters<DaemonClient["deliverExecution"]>)=>{await host.deliverExecution(...args);controller.abort(new Error("stop before launch"));},
 },{id:"editor-cli-before-launch",adapter:"vscode/copilot-cli",query:"Host context"});
 await expect(pass.preparePrompt("[user]\nInspect",controller.signal)).rejects.toThrow("stop before launch");
 expect(await pass.finish(true)).toMatchObject({status:"no_change",authority_active:false});
});

it("the actual editor host records exact review before activation; replay cannot replenish consumed effects",async()=>{
 const host=client(),args={filePath:"source.ts",content:"source before"};
 const lease=await host.beginExecution({id:"review-once",adapter:"vscode/native",query:"Host context"});
 await host.deliverExecution(lease.workerBearer,lease.execution.pack.receipt.id,lease.execution.block);
 const checkpoint=await host.readExecution("review-once"),request={execution_id:"review-once",approval_id:"operator-review-one",
  expected_record_revision:checkpoint.record_revision,context_receipt_id:checkpoint.pack.receipt.id,
  approved_actions:[{tool:"edit_file",arguments:args,scope_id:"fixture",calls:1}]};
 const approved=await host.approveExecution(request);expect(approved).toMatchObject({approvalId:request.approval_id,replayed:false,reviewActivated:true});
 expect(approved.execution.record_revision).toBe(checkpoint.record_revision+1);
 const context=[...contexts.values()].find(value=>!value.execution_policy)!;
 const record=await withSessionContext(context,()=>readManagedContext("review-once"));
 expect(record.approval_reviews).toHaveLength(1);expect(record.approval_reviews[0].actions[0]).toMatchObject({tool:"edit_file",scope_id:"fixture",calls:1,arguments_hash:expect.stringMatching(/^sha256:/)});
 expect(JSON.stringify(record.approval_reviews)).not.toContain("source before");
 let effects=0;
 const invoke=()=>withSessionContext(context,()=>withHostExecution("review-once",()=>invokeToolBoundary({name:"edit_file",shape:{filePath:z.string(),content:z.string()},args,handler:async()=>{
  effects++;const obligation=await managedSourceEffect({changes:[{file:join(root,"source.ts"),content:args.content}],apply:()=>writeFile(join(root,"source.ts"),args.content)});
  return {content:[{type:"text",text:JSON.stringify({obligation})}]};}})));
 expect((await invoke()).isError).not.toBe(true);
 const repeated=await host.approveExecution(request);expect(repeated.replayed).toBe(true);
 expect(repeated.controls).toMatchObject({approved_effects:0,maximum_effects:1});
 expect((await invoke()).isError).toBe(true);expect(effects).toBe(1);
 expect(await host.finishExecution("review-once","completed","confirmed")).toMatchObject({status:"no_change",authority_active:false});
 await expect(host.approveExecution(request)).rejects.toThrow("AUTHORITY_UNAVAILABLE");
});

it("exact review rejects foreign/worker authority, stale revisions, changed receipt and conflicting payloads",async()=>{
 const host=client(),other=client(),lease=await host.beginExecution({id:"review-guards",adapter:"sdk",query:"Host context"});
 const request={execution_id:"review-guards",approval_id:"guard-review",expected_record_revision:lease.execution.record_revision,context_receipt_id:lease.execution.pack.receipt.id,
  approved_actions:[{tool:"edit_file",arguments:{filePath:"source.ts",content:"next"},scope_id:"fixture",calls:1}]};
 await expect(host.approveExecution(request)).rejects.toThrow("NOT_DELIVERED");
 await host.deliverExecution(lease.workerBearer,lease.execution.pack.receipt.id,lease.execution.block);
 request.expected_record_revision=(await host.readExecution("review-guards")).record_revision;
 await expect(other.approveExecution(request)).rejects.toThrow("AUTHORITY_UNAVAILABLE");
 const worker=await fetch(`http://127.0.0.1:${port}/api/executions/v1/approve`,{method:"POST",headers:{"Content-Type":"application/json","X-DreamGraph-Session":lease.workerBearer},body:JSON.stringify(request)});
 expect(worker.status).toBe(403);
 await expect(host.approveExecution({...request,expected_record_revision:request.expected_record_revision+10})).rejects.toThrow("REVISION_CONFLICT");
 await expect(host.approveExecution({...request,context_receipt_id:"different"})).rejects.toThrow("CONTEXT_CHANGED");
 await host.approveExecution(request);
 await expect(host.approveExecution({...request,approved_actions:[{...request.approved_actions[0],arguments:{filePath:"source.ts",content:"conflicting"}}]})).rejects.toThrow("IDENTITY_CONFLICT");
 await host.finishExecution("review-guards","completed","confirmed");
});

it("an authenticated owner fences in-flight review; queued HTTP review cannot bypass the changed checkpoint",async()=>{
 const host=client(),args={filePath:"source.ts",content:"source before"};
 const lease=await host.beginExecution({id:"review-inflight",adapter:"sdk",query:"Host context",autonomy:"supervised",approved_actions:[{tool:"edit_file",arguments:args,scope_id:"fixture",calls:1}]});
 await host.deliverExecution(lease.workerBearer,lease.execution.pack.receipt.id,lease.execution.block);
 const checkpoint=await host.readExecution("review-inflight"),context=[...contexts.values()].find(value=>!value.execution_policy)!;
 let entered!:()=>void,finish!:()=>void;
 const started=new Promise<void>(done=>{entered=done;}),gate=new Promise<void>(done=>{finish=done;});
 const effect=withSessionContext(context,()=>withHostExecution("review-inflight",()=>invokeToolBoundary({name:"edit_file",shape:{filePath:z.string(),content:z.string()},args,handler:async()=>{
  entered();await gate;return {content:[{type:"text",text:"declared owner noop"}]};}})));
 const review={execution_id:"review-inflight",approval_id:"during-owner",expected_record_revision:checkpoint.record_revision,context_receipt_id:checkpoint.pack.receipt.id,
   approved_actions:[{tool:"edit_file",arguments:{...args,content:"new"},scope_id:"fixture",calls:1}]};
 let queued:Promise<unknown>|undefined;
 try{
  await started;
  await expect(withSessionContext(context,()=>approveHostExecution(review))).rejects.toThrow("EFFECT_INFLIGHT");
  // HTTP authentication itself reads a stable graph view; do not promise nonblocking authentication.
  queued=expect(host.approveExecution(review)).rejects.toThrow("REVISION_CONFLICT");
 }finally{finish();await effect;}
 await queued;
 await withSessionContext(context,()=>withHostExecution("review-inflight",async()=>{expect(getSessionContext()!.execution_policy!.effects_inflight).toBe(0);}));
 expect((await withSessionContext(context,()=>readManagedContext("review-inflight"))).approval_reviews).toHaveLength(0);
 await host.finishExecution("review-inflight","completed","confirmed");
});

it("review cannot exceed the original effect ceiling or approve a changed named source",async()=>{
 const host=client(),lease=await host.beginExecution({id:"review-limits",adapter:"vscode/native",query:"Host context"});
 await host.deliverExecution(lease.workerBearer,lease.execution.pack.receipt.id,lease.execution.block);
 const checkpoint=await host.readExecution("review-limits"),request={execution_id:"review-limits",approval_id:"bounded-review",expected_record_revision:checkpoint.record_revision,context_receipt_id:checkpoint.pack.receipt.id,
  approved_actions:[{tool:"edit_file",arguments:{filePath:"source.ts",content:"next"},scope_id:"fixture",calls:2}]};
 await expect(host.approveExecution(request)).rejects.toThrow("ALLOWANCE_EXCEEDED");
 await writeFile(join(root,"source.ts"),"concurrent outside edit");
 await expect(host.approveExecution({...request,approved_actions:[{...request.approved_actions[0],calls:1}]})).rejects.toThrow("REFRESH_REQUIRED");
 const context=[...contexts.values()].find(value=>!value.execution_policy)!;
 expect((await withSessionContext(context,()=>readManagedContext("review-limits"))).approval_reviews).toHaveLength(0);
 await host.finishExecution("review-limits","failed","confirmed");
});

it("the actual portable SDK recovers a lost approval reply without reissuing a grant or extending expiry",async()=>{
 let lose=true;const sdk=new ManagedExecutionClient({baseUrl:`http://127.0.0.1:${port}`,timeoutMs:10000,fetch:async(url,init)=>{
  const reply=await fetch(url,init);if(String(url).endsWith("/approve")&&lose){lose=false;throw new Error("declared approval reply loss after commit");}return reply;
 }});
 try{
  const lease=await sdk.begin({id:"sdk-review-recovery",adapter:"sdk",query:"Host context"});
  await sdk.deliver(lease.workerBearer,lease.execution.pack.receipt.id,lease.execution.block);
  const checkpoint=await sdk.read("sdk-review-recovery"),request={execution_id:"sdk-review-recovery",approval_id:"sdk-exact-review",expected_record_revision:checkpoint.record_revision,context_receipt_id:checkpoint.pack.receipt.id,
   approved_actions:[{tool:"edit_file",arguments:{filePath:"source.ts",content:"next"},scope_id:"fixture",calls:1}]};
  await expect(sdk.approve(request)).rejects.toThrow("reply loss");
  const retry=await sdk.approve(request);expect(retry).toMatchObject({approvalId:request.approval_id,replayed:true,reviewActivated:true});
  expect(retry.controls).toMatchObject({expires_at:(lease.controls as {expires_at:string}).expires_at,maximum_effects:1,approved_effects:1});
  const context=[...contexts.values()].find(value=>!value.execution_policy)!;
  expect((await withSessionContext(context,()=>readManagedContext(request.execution_id))).approval_reviews).toHaveLength(1);
  await sdk.finish(request.execution_id,"completed","confirmed");
 }finally{sdk.dispose();}
});

it("a published review alone grants no effect; the unchanged live host can recover activation exactly once",async()=>{
 const host=client(),lease=await host.beginExecution({id:"review-published-only",adapter:"sdk",query:"Host context"});
 await host.deliverExecution(lease.workerBearer,lease.execution.pack.receipt.id,lease.execution.block);
 const checkpoint=await host.readExecution(lease.execution.execution_id),context=[...contexts.values()].find(value=>!value.execution_policy)!;
 const args={filePath:"source.ts",content:"source before"},review={execution_id:checkpoint.execution_id,approval_id:"published-interruption",
  expected_record_revision:checkpoint.record_revision,context_receipt_id:checkpoint.pack.receipt.id,
  approved_actions:[{tool:"edit_file",arguments:args,scope_id:"fixture",calls:1}]};
 // Declared interruption seam: publish through the real journal owner, omit activation.
 await withSessionContext(context,()=>withHostExecution(checkpoint.execution_id,async()=>{
  const policy=getSessionContext()!.execution_policy!,prepared=prepareExecutionApproval(policy,review.approval_id,review.approved_actions);
  await recordManagedApproval(review,prepared.revision);
  let ran=false;
  const refused=await invokeToolBoundary({name:"edit_file",shape:{filePath:z.string(),content:z.string()},args,handler:()=>{ran=true;return {content:[]};}});
  expect(refused.isError).toBe(true);expect(ran).toBe(false);expect(policy.effects_started).toBe(0);
 }));
 expect(await host.approveExecution(review)).toMatchObject({replayed:true,reviewActivated:true,controls:{approved_effects:1}});
 expect(await host.approveExecution(review)).toMatchObject({replayed:true,controls:{approved_effects:1}});
 expect((await withSessionContext(context,()=>readManagedContext(checkpoint.execution_id))).approval_reviews).toHaveLength(1);
 await host.finishExecution(checkpoint.execution_id,"completed","confirmed");
});

it("a saved review cannot reactivate after the actual lease expires",async()=>{
 const host=client(),lease=await host.beginExecution({id:"review-expired",adapter:"sdk",query:"Host context",timeout_ms:4000});
 await host.deliverExecution(lease.workerBearer,lease.execution.pack.receipt.id,lease.execution.block);
 const checkpoint=await host.readExecution(lease.execution.execution_id),review={execution_id:checkpoint.execution_id,approval_id:"expires-review",
  expected_record_revision:checkpoint.record_revision,context_receipt_id:checkpoint.pack.receipt.id,
  approved_actions:[{tool:"edit_file",arguments:{filePath:"source.ts",content:"source before"},scope_id:"fixture",calls:1}]};
 await host.approveExecution(review);
 await vi.waitFor(async()=>expect((await host.readExecution(checkpoint.execution_id)).authority_active).toBe(false),{timeout:5000,interval:100});
 // Wall-clock expiry can precede the timer's lease-map cleanup; neither path activates authority.
 await expect(host.approveExecution(review)).rejects.toThrow(/AUTHORITY_UNAVAILABLE|EXECUTION_POLICY_EXPIRED/);
 await host.finishExecution(checkpoint.execution_id,"completed","confirmed");
},10000);

it("the actual editor rendezvous waits before the graph writer, then publishes approval before one unchanged source effect",async()=>{
 const host=client(),other=client(),lease=await host.beginExecution({id:"review-rendezvous",adapter:"vscode/native",query:"Host context"});
 await host.deliverExecution(lease.workerBearer,lease.execution.pack.receipt.id,lease.execution.block);
 expect(await host.openExecutionReviews(lease.execution.execution_id)).toMatchObject({review_enabled:true,requests:[]});
 const context=[...contexts.values()].find(value=>!value.execution_policy)!,args={filePath:"source.ts",content:"source before"};let ran=0;
 const effect=withSessionContext(context,()=>withHostExecution(lease.execution.execution_id,()=>invokeToolBoundary({name:"edit_file",shape:{filePath:z.string(),content:z.string()},args,
  handler:async()=>{ran++;const journal=await readManagedContext(lease.execution.execution_id);expect(journal.approval_reviews).toHaveLength(1);
   const obligation=await managedSourceEffect({changes:[{file:join(root,"source.ts"),content:args.content}],apply:()=>writeFile(join(root,"source.ts"),args.content)});
   return {content:[{type:"text",text:JSON.stringify({obligation})}]};}})));
 let pending!:Awaited<ReturnType<DaemonClient["readExecutionReviews"]>>;
 await vi.waitFor(async()=>{pending=await host.readExecutionReviews(lease.execution.execution_id);expect(pending.requests).toHaveLength(1);},{timeout:3000});
 expect(ran).toBe(0);expect(pending.requests[0].approved_actions).toEqual([{tool:"edit_file",arguments:args,scope_id:`execution:${lease.execution.execution_id}`,calls:1}]);
 await expect(other.readExecutionReviews(lease.execution.execution_id)).rejects.toThrow("OWNER_MISMATCH");
 await expect(host.approveExecution({...pending.requests[0],approved_actions:[{...pending.requests[0].approved_actions[0],arguments:{...args,content:"changed after review"}}]})).rejects.toThrow("REVIEW_REQUEST_CHANGED");
 const blockedWorker=await fetch(`http://127.0.0.1:${port}/api/executions/v1/reviews/read`,{method:"POST",headers:{"Content-Type":"application/json","X-DreamGraph-Session":lease.workerBearer},body:JSON.stringify({execution_id:lease.execution.execution_id})});
 expect(blockedWorker.status).toBe(403);
 // A stable unrelated host read succeeds while the worker awaits input; no writer is held.
 expect((await host.readExecution(lease.execution.execution_id)).authority_active).toBe(true);
 await host.approveExecution(pending.requests[0]);expect((await effect).isError).not.toBe(true);expect(ran).toBe(1);
 expect((await host.readExecutionReviews(lease.execution.execution_id)).requests).toEqual([]);
 expect(await host.finishExecution(lease.execution.execution_id,"completed","confirmed")).toMatchObject({status:"no_change"});
});

it("the actual SDK operator decline settles the pending tool without granting or executing an effect",async()=>{
 const sdk=new ManagedExecutionClient({baseUrl:`http://127.0.0.1:${port}`});
 try{const lease=await sdk.begin({id:"review-decline",adapter:"sdk",query:"Host context"});
  await sdk.deliver(lease.workerBearer,lease.execution.pack.receipt.id,lease.execution.block);await sdk.openReviews(lease.execution.execution_id);
  const context=[...contexts.values()].find(value=>!value.execution_policy)!;let ran=false;
  const effect=withSessionContext(context,()=>withHostExecution(lease.execution.execution_id,()=>invokeToolBoundary({name:"edit_file",shape:{filePath:z.string(),content:z.string()},args:{filePath:"source.ts",content:"never apply"},handler:()=>{ran=true;return {content:[]};}})));
  let request!:Awaited<ReturnType<ManagedExecutionClient["readReviews"]>>["requests"][number];
  await vi.waitFor(async()=>{const queue=await sdk.readReviews(lease.execution.execution_id);expect(queue.requests).toHaveLength(1);request=queue.requests[0];},{timeout:3000});
  expect(await sdk.declineReview(lease.execution.execution_id,request.approval_id)).toMatchObject({status:"declined"});
  expect((await effect).isError).toBe(true);expect(ran).toBe(false);
  const journal=await withSessionContext(context,()=>readManagedContext(lease.execution.execution_id));expect(journal.approval_reviews).toHaveLength(0);expect(journal.effects).toHaveLength(0);
  expect(await sdk.finish(lease.execution.execution_id,"completed","confirmed")).toMatchObject({status:"no_change"});
 }finally{sdk.dispose();}
});

it("request cancellation removes an enabled review wait without invoking the effect owner",async()=>{
 const host=client(),lease=await host.beginExecution({id:"review-cancel",adapter:"vscode/native",query:"Host context"});
 await host.deliverExecution(lease.workerBearer,lease.execution.pack.receipt.id,lease.execution.block);await host.openExecutionReviews(lease.execution.execution_id);
 const context=[...contexts.values()].find(value=>!value.execution_policy)!,controller=new AbortController();let ran=false;
 const effect=withSessionContext(context,()=>withHostExecution(lease.execution.execution_id,()=>invokeToolBoundary({name:"edit_file",shape:{filePath:z.string(),content:z.string()},args:{filePath:"source.ts",content:"never apply"},extra:{signal:controller.signal},handler:()=>{ran=true;return {content:[]};}})));
 await vi.waitFor(async()=>expect((await host.readExecutionReviews(lease.execution.execution_id)).requests).toHaveLength(1),{timeout:3000});
 controller.abort(new Error("operator stop"));expect((await effect).isError).toBe(true);expect(ran).toBe(false);
 expect((await host.readExecutionReviews(lease.execution.execution_id)).requests).toEqual([]);
 expect(await host.finishExecution(lease.execution.execution_id,"cancelled","confirmed")).toMatchObject({status:"no_change"});
});


it("the editor review controller retains literal exact proposals and retries lost acknowledgement without repeating effects",async()=>{
 const host=client(),lease=await host.beginExecution({id:"editor-review-retry",adapter:"vscode/codex-cli",query:"Host context"});
 const review=new ExecutionReviewController(()=>undefined,10);
 let failReply=true;
 const port={baseUrl:host.baseUrl,openExecutionReviews:host.openExecutionReviews.bind(host),readExecutionReviews:host.readExecutionReviews.bind(host),
  declineExecutionReview:host.declineExecutionReview.bind(host),approveExecution:async(request:Parameters<DaemonClient["approveExecution"]>[0])=>{
   const result=await host.approveExecution(request);if(failReply){failReply=false;throw new Error("declared lost HTTP acknowledgement after actual durable publication");}return result;
  }};
 await host.deliverExecution(lease.workerBearer,lease.execution.pack.receipt.id,lease.execution.block);
 await review.start(port,lease.execution.execution_id);
 const owner=[...contexts.values()].find(value=>!value.execution_policy)!;
 let ran=0;const args={filePath:"source.ts",content:"source before"};
 const effect=withSessionContext(owner,()=>withHostExecution(lease.execution.execution_id,()=>invokeToolBoundary({name:"edit_file",shape:{filePath:z.string(),content:z.string()},args,handler:async()=>{
  ran++;return {content:[{type:"text",text:JSON.stringify({obligation:await managedSourceEffect({changes:[{file:join(root,"source.ts"),content:args.content}],apply:()=>writeFile(join(root,"source.ts"),args.content)})})}]};
 }})));
 try{
  await vi.waitFor(()=>expect(review.view.status).toBe("pending"),{timeout:3000});
  const captured=review.view.request!;expect(captured.approved_actions[0].arguments).toEqual(args);
  const exposed=review.view;exposed.request!.approved_actions[0].arguments={filePath:"other.ts",content:"never execute"};
  await expect(review.decide("another-pass",captured.approval_id,"approve")).rejects.toThrow("TARGET_CHANGED");expect(ran).toBe(0);
  await expect(review.decide(captured.execution_id,captured.approval_id,"approve")).rejects.toThrow("lost HTTP acknowledgement");
  expect((await effect).isError).not.toBe(true);expect(ran).toBe(1);expect(review.blocksContinuation).toBe(true);
  let continued=false;const stopped=new AbortController(),waiting=review.waitForResolution(stopped.signal).then(()=>{continued=true;});
  review.stop();expect(review.view.request).toEqual(captured);
  await expect(review.start(host,"new-pass")).rejects.toThrow("RECOVERY_REQUIRED");
  await expect(review.decide(captured.execution_id,captured.approval_id,"decline")).rejects.toThrow("RETRY_SAME");
  expect(continued).toBe(false);
  await review.decide(captured.execution_id,captured.approval_id,"approve");await waiting;expect(continued).toBe(true);expect(review.blocksContinuation).toBe(false);expect(ran).toBe(1);
  expect(await host.finishExecution(captured.execution_id,"completed","confirmed")).toMatchObject({status:"no_change"});
  const record=await withSessionContext(owner,()=>readManagedContext(captured.execution_id));expect(record.approval_reviews).toHaveLength(1);
 }finally{review.stop();await host.finishExecution(lease.execution.execution_id,"cancelled","confirmed").catch(()=>undefined);await effect;}
});

it("the editor controller declines the captured daemon action without dispatch or approval publication",async()=>{
 const host=client(),lease=await host.beginExecution({id:"editor-review-decline",adapter:"vscode/native",query:"Host context"});
 const review=new ExecutionReviewController(()=>undefined,10);
 await host.deliverExecution(lease.workerBearer,lease.execution.pack.receipt.id,lease.execution.block);await review.start(host,lease.execution.execution_id);
 const owner=[...contexts.values()].find(value=>!value.execution_policy)!;let ran=0;
 const effect=withSessionContext(owner,()=>withHostExecution(lease.execution.execution_id,()=>invokeToolBoundary({name:"edit_file",shape:{filePath:z.string(),content:z.string()},args:{filePath:"source.ts",content:"not written"},handler:()=>{ran++;return {content:[]};}})));
 try{
  await vi.waitFor(()=>expect(review.view.status).toBe("pending"),{timeout:3000});const request=review.view.request!;
  await review.decide(request.execution_id,request.approval_id,"decline");expect((await effect).isError).toBe(true);expect(ran).toBe(0);
  expect((await withSessionContext(owner,()=>readManagedContext(request.execution_id))).approval_reviews).toHaveLength(0);
 }finally{review.stop();await host.finishExecution(lease.execution.execution_id,"cancelled","confirmed").catch(()=>undefined);await effect;}
});

it("editor review decisions cannot redirect through a changed endpoint",async()=>{
 const host=client(),lease=await host.beginExecution({id:"editor-review-endpoint",adapter:"vscode/native",query:"Host context"});
 const review=new ExecutionReviewController(()=>undefined,10);
 await host.deliverExecution(lease.workerBearer,lease.execution.pack.receipt.id,lease.execution.block);await review.start(host,lease.execution.execution_id);
 const owner=[...contexts.values()].find(value=>!value.execution_policy)!;let ran=0;
 const effect=withSessionContext(owner,()=>withHostExecution(lease.execution.execution_id,()=>invokeToolBoundary({name:"edit_file",shape:{filePath:z.string(),content:z.string()},args:{filePath:"source.ts",content:"not written"},handler:()=>{ran++;return {content:[]};}})));
 const requestPort=host.approveExecution;let dispatched=0;
 try{
  await vi.waitFor(()=>expect(review.view.status).toBe("pending"),{timeout:3000});const request=review.view.request!;
  host.approveExecution=async()=>{dispatched++;throw new Error("must not call changed endpoint");};host.updateEndpoint("127.0.0.1",port+1);
  await expect(review.decide(request.execution_id,request.approval_id,"approve")).rejects.toThrow("ENDPOINT_CHANGED");expect(dispatched).toBe(0);expect(ran).toBe(0);
 }finally{
  review.stop();host.approveExecution=requestPort;
  // The original in-process authority closes its own lease; no replacement host is forged.
  await withSessionContext(owner,async()=>{const {endHostExecution}=await import("../src/server/managed-execution.js");await endHostExecution({execution_id:lease.execution.execution_id,outcome:"cancelled",work_termination:"confirmed"});});await effect;
 }
});


it("native editor admission delivers whole replacement evidence, uses the actual worker MCP fence and closes unchanged source with durable review",async()=>{
 const host=client(),pass=await ManagedNativePass.begin(host,{id:"editor-native-owned",adapter:"vscode/openai",query:"Host context",approved_actions:[]});
 const review=new ExecutionReviewController(()=>undefined,10);
 const args={filePath:"source.ts",content:"source before"};
 try{
  await review.start(host,pass.executionId,pass.signal);
  const first=await pass.prepare([{role:"user",content:"Inspect then edit"}],[],[],pass.signal);
  const delivered=await host.readExecution(pass.executionId);expect(delivered.pack.receipt.delivery).toBe("delivered");
  expect(first.messages.at(-1)!.content).toContain(delivered.block);expect(JSON.stringify(first)).not.toContain('dgexec.');
  const read=await pass.callTool('read_source_code',{filePath:'source.ts'},pass.signal,5000);
  expect(read).toMatchObject({content:[{type:'text',text:JSON.stringify({source:'source before'})}]});
  await expect(pass.callTool('write_file',args,pass.signal,5000)).rejects.toThrow('LOCAL_TOOL_UNAVAILABLE');
  const effect=pass.callTool('create_file',args,pass.signal,5000);const observed=effect.catch(error=>error);
  await vi.waitFor(()=>expect(review.view.status).toBe('pending'),{timeout:3000});
  const request=review.view.request!;expect(request.approved_actions[0]).toMatchObject({tool:'create_file',arguments:args,calls:1});
  await review.decide(request.execution_id,request.approval_id,'approve');expect((await observed).isError).not.toBe(true);
  const next=await pass.prepare([{role:'user',content:'Continue'}],[],[],pass.signal);
  const refreshed=await host.readExecution(pass.executionId);expect(refreshed.pack.receipt.id).not.toBe(delivered.pack.receipt.id);expect(JSON.stringify(next)).toContain(refreshed.pack.receipt.id);
  expect(await pass.finish('completed')).toMatchObject({status:'no_change',authority_active:false});
  await expect(pass.callTool('create_file',args,pass.signal,5000)).rejects.toThrow('PASS_CLOSED');
 }finally{review.stop();await pass.finish('cancelled').catch(()=>undefined);}
});

it("native editor source changes retain reconciliation debt rather than reporting a graph commit",async()=>{
 const host=client(),args={filePath:'source.ts',content:'source after'};
 const pass=await ManagedNativePass.begin(host,{id:'editor-native-source-debt',adapter:'vscode/anthropic',query:'Host context',approved_actions:[{tool:'create_file',arguments:args,scope_id:'fixture',calls:1}]});
 try{
  await pass.prepare([{role:'user',content:'Edit source'}],[],[],pass.signal);
  const returned=await pass.callTool('create_file',args,pass.signal,5000);expect((returned as any).isError).not.toBe(true);
  expect(await readFile(join(root,'source.ts'),'utf8')).toBe('source after');
  expect(await pass.finish('completed')).toMatchObject({status:'reconciliation_pending',authority_active:false,graph_receipt_ids:[],obligation_ids:[expect.any(String)]});
 }finally{await pass.finish('failed').catch(()=>undefined);}
});

it("native editor commands execute at the actual daemon owner with exact review and complete source observation",async()=>{
 const host=client(),pass=await ManagedNativePass.begin(host,{id:'editor-native-command',adapter:'vscode/openai',query:'Host context'});
 const review=new ExecutionReviewController(()=>undefined,10);
 try{
  await review.start(host,pass.executionId,pass.signal);await pass.prepare([{role:'user',content:'Verify source'}],[],[],pass.signal);
  const args={command:'node -e "process.stdout.write(12345..toString())"',timeoutMs:5000};
  const effect=pass.callTool('run_command',args,pass.signal,10000);const observed=effect.catch(error=>error);
  await vi.waitFor(()=>expect(review.view.status).toBe('pending'),{timeout:3000});const request=review.view.request!;
  expect(request.approved_actions[0]).toMatchObject({tool:'run_command',arguments:args});
  await review.decide(request.execution_id,request.approval_id,'approve');const returned=await observed;
  expect(returned.isError).not.toBe(true);const result=JSON.parse(returned.content[0].text);
  expect(result).toMatchObject({execution_id:pass.executionId,exitCode:0,stdout:'12345',source_obligation:{state:'failed'}});
  expect(await pass.finish('completed')).toMatchObject({status:'no_change',authority_active:false});
 }finally{review.stop();await pass.finish('failed').catch(()=>undefined);}
});

it("native editor cancelled waiting closes promptly with underlying callback termination unconfirmed",async()=>{
 const host=client(),parent=new AbortController(),pass=await ManagedNativePass.begin(host,{id:'editor-native-late',adapter:'vscode/openai',query:'Host context'},parent.signal);
 let finish!:()=>void,entered!:()=>void;const started=new Promise<void>(resolve=>entered=resolve),late=new Promise<string>(resolve=>finish=()=>resolve('late result'));
 try{
  await pass.prepare([{role:'user',content:'Read context'}],[],[],pass.signal);
  const operation=pass.run(()=>{entered();return late;},pass.signal).catch(error=>error);await started;parent.abort(new Error('operator stop'));
  expect(await operation).toBeInstanceOf(Error);
  expect(await pass.finish('cancelled')).toMatchObject({status:'recovery_required',authority_active:false});
  finish();await late;await expect(pass.callTool('create_file',{filePath:'source.ts',content:'not applied'},pass.signal,5000)).rejects.toThrow('PASS_CLOSED');
  expect(await readFile(join(root,'source.ts'),'utf8')).toBe('source before');
 }finally{finish();await pass.finish('cancelled').catch(()=>undefined);}
});

it("native editor Unicode request byte refusal happens before delivery and dispatch",async()=>{
 const host=client(),pass=await ManagedNativePass.begin(host,{id:'editor-native-bytes',adapter:'vscode/openai',query:'Host context'});
 try{
  await expect(pass.prepare([{role:'user',content:'🌿'.repeat(2200000)}],[],[],pass.signal)).rejects.toThrow('REQUEST_BYTE_BOUND');
  expect(await host.readExecution(pass.executionId)).toMatchObject({status:'assembled',pack:{receipt:{delivery:'unattested'}}});
  expect(await pass.finish('failed')).toMatchObject({status:'no_change',authority_active:false});
 }finally{await pass.finish('failed').catch(()=>undefined);}
});

it("native editor captured instance mismatch refuses before delivery and revokes the owned lease",async()=>{
 const host=client();await expect(ManagedNativePass.begin(host,{id:'editor-native-instance',adapter:'vscode/openai',query:'Host context'},undefined,'different-instance')).rejects.toThrow('INSTANCE_CHANGED');
 expect(await host.readExecution('editor-native-instance')).toMatchObject({authority_active:false,status:'no_change'});
});


it("an independently cancelled native round blocks fresh dispatch until its unknown outcome closes",async()=>{
 const host=client(),round=new AbortController(),pass=await ManagedNativePass.begin(host,{id:'editor-native-round-unknown',adapter:'vscode/openai',query:'Host context'});
 let entered!:()=>void,release!:()=>void;const started=new Promise<void>(resolve=>entered=resolve),late=new Promise<string>(resolve=>release=()=>resolve('late'));
 try{
  await expect(pass.run(async()=>{throw new Error('must not dispatch without context');},pass.signal)).rejects.toThrow('CONTEXT_NOT_DELIVERED');
  await pass.prepare([{role:'user',content:'Inspect'}],[],[],pass.signal);
  const operation=pass.run(()=>{entered();return late;},round.signal).catch(error=>error);await started;round.abort(new Error('round timeout'));
  expect(await operation).toBeInstanceOf(Error);expect(pass.signal.aborted).toBe(false);
  await expect(pass.prepare([{role:'user',content:'Must not resume unknown work'}],[],[],pass.signal)).rejects.toThrow('OUTCOME_UNCONFIRMED');
  expect(await pass.finish('failed')).toMatchObject({status:'recovery_required',authority_active:false});
 }finally{release();await late;await pass.finish('failed').catch(()=>undefined);}
});


function nativeReply(name?:string,args:Record<string,unknown>={},text='Source observed and context retained.'){
 return ()=>({model:'gpt-4.1',usage:{prompt_tokens:100,completion_tokens:10},choices:[{finish_reason:name?'tool_calls':'stop',message:{content:name?null:JSON.stringify({narrative:text,summary:text,goal_status:'complete',progress_status:'advancing',uncertainty:'low',recommended_next_steps:[]}),
  ...(name?{tool_calls:[{id:'declared-'+name,type:'function',function:{name,arguments:JSON.stringify(args)}}]}:{})}}]});
}
function nativePanelFixture(host:DaemonClient){
 const {ChatPanel,ArchitectLlm,McpClient,changeReviewService}=compiledEditor(),panel=new ChatPanel({}),events:any[]=[];
 const llm=new ArchitectLlm({});llm._config={provider:'openai',model:'gpt-4.1',baseUrl:`http://127.0.0.1:${port}/v1`,apiKey:'declared-offline-fixture'};
 panel.setArchitectLlm(llm);panel.setDaemonClient(host);panel.setMcpClient(new McpClient(host.baseUrl));panel.abortController=new AbortController();
 panel.postMessage=async(event:unknown)=>{events.push(event);};
 const tools=[{name:'read_source_code',description:'Declared source owner',inputSchema:{type:'object',properties:{filePath:{type:'string'}},required:['filePath'],additionalProperties:false}},
  {name:'create_file',description:'Declared source owner',inputSchema:{type:'object',properties:{filePath:{type:'string'},content:{type:'string'}},required:['filePath','content'],additionalProperties:false}}];
 return {panel,events,tools,changeReviewService};
}
it("the compiled ordinary editor loop preserves whole context through actual provider HTTP/MCP and waits for exact lost-ack recovery before continuation",async()=>{
 hostModelAllocation();
 const host=client(),approve=host.approveExecution.bind(host);let lose=true;
 host.approveExecution=async request=>{const result=await approve(request);if(lose){lose=false;throw new Error('declared lost reply after actual review');}return result;};
 const {panel,tools,events}=nativePanelFixture(host);
 modelReplies.push(nativeReply('read_source_code',{filePath:'source.ts'}),nativeReply('create_file',{filePath:'source.ts',content:'source before'}),nativeReply());
 let early:unknown,settled=false;
 const running=panel.runAgenticLoop([{role:'user',content:'Inspect Host context and preserve source'}],tools).catch((error:unknown)=>error).then((result:unknown)=>{early=result;settled=true;return result;});
 try{
  // Two admitted provider rounds, MCP reads and durable context refreshes precede
  // this prompt. Bound fixture startup separately from stop/recovery assertions.
  await vi.waitFor(()=>{expect(settled,String(early)).toBe(false);expect(panel._executionReview.view.status,JSON.stringify({modelRequests:modelRequests.length,trace:panel._lastToolTrace})).toBe('pending');},{timeout:8000});const request=panel._executionReview.view.request;
  expect(modelRequests).toHaveLength(2);const checkpoint=await host.readExecution(request.execution_id);
  expect(checkpoint.pack.receipt.delivery).toBe('delivered');expect(JSON.stringify(modelRequests[1])).toContain(JSON.stringify(checkpoint.block).slice(1,-1));
  expect(JSON.stringify(modelRequests)).not.toContain('dgexec.');
  await expect(panel._executionReview.decide(request.execution_id,request.approval_id,'approve')).rejects.toThrow('lost reply');
  await vi.waitFor(()=>expect(panel._lastToolTrace.find((trace:any)=>trace.tool==='create_file')?.status).toBe('completed'),{timeout:2000});
  expect(modelRequests).toHaveLength(2);expect(panel._executionReview.blocksContinuation).toBe(true);
  await panel._executionReview.decide(request.execution_id,request.approval_id,'approve');
  expect(await running).toContain('Source observed and context retained.');expect(modelRequests).toHaveLength(3);
  expect(await host.readExecution(request.execution_id)).toMatchObject({status:'no_change',authority_active:false});
  expect(events.some(event=>event.type==='tool-progress'&&event.tool==='DreamGraph execution'&&event.message.includes('no_change'))).toBe(true);
 }finally{panel.abortController.abort();await running;panel.dispose();}
},20000);

it("the compiled ordinary editor loop reports confirmed source debt distinctly and refuses successful continuation",async()=>{
 hostModelAllocation();
 const host=client(),{panel,tools}=nativePanelFixture(host);
 modelReplies.push(nativeReply('create_file',{filePath:'source.ts',content:'source after'}),nativeReply(undefined,{},'The source changed.'));
 let early:unknown,settled=false;
 const running=panel.runAgenticLoop([{role:'user',content:'Change source with Host context'}],tools).catch((error:unknown)=>error).then((result:unknown)=>{early=result;settled=true;return result;});
 try{
  await vi.waitFor(()=>{expect(settled,String(early)).toBe(false);expect(panel._executionReview.view.status).toBe('pending');},{timeout:4000});const request=panel._executionReview.view.request;
  await panel._executionReview.decide(request.execution_id,request.approval_id,'approve');
  expect(String(await running)).toContain('MANAGED_NATIVE_RECONCILIATION_PENDING');
  expect(await readFile(join(root,'source.ts'),'utf8')).toBe('source after');
  expect(await host.readExecution(request.execution_id)).toMatchObject({status:'reconciliation_pending',authority_active:false,graph_receipt_ids:[]});
 }finally{panel.abortController.abort();await running;panel.dispose();}
},15000);

async function operatorPanelFixture() {
 const host=client(),probe=await host.beginExecution({id:'operator-fixture-probe',adapter:'vscode/operator',query:'Host context'});
 await host.finishExecution(probe.execution.execution_id,'completed','confirmed');
 const fixture=nativePanelFixture(host);fixture.panel.currentInstanceId=probe.execution.instance_id;
 realSourceOwners=true;
 return {host,...fixture,authority:{endpoint:host.baseUrl,instanceId:probe.execution.instance_id}};
}
async function recordedReview(service:any,authority:any,file:string,before:Buffer|null,after:Buffer|null) {
 service.listReviewableWorkspacePaths=async()=>[file];
 if(before!==null)await writeFile(file,before);else await rm(file,{force:true});
 const snapshot=await service.captureWorkspaceSnapshot(authority);
 if(after!==null)await writeFile(file,after);else await rm(file,{force:true});
 await service.recordWorkspaceChanges(snapshot);
 return service.getPendingReview(file);
}
async function undoWithPanel(service:any,panel:any,review:any){
 return service.undo(review.filePath,review.id,async(action:any)=>{
  const returned=await panel._executeOperatorTool(action.tool,action.arguments,action.authority);
  if(panel._ownerResultFailed(returned.result))throw new Error(JSON.stringify(returned.result));
  return {executionId:returned.execution.execution_id,closureStatus:returned.execution.status};
 });
}

it('compiled editor Undo restores exact Unicode/BOM/mixed newline bytes through actual HTTP/MCP source owners and retains graph debt',async()=>{
 const {host,panel,changeReviewService:service,authority,events}=await operatorPanelFixture(),file=join(root,'source.ts');
 const baseline=Buffer.from('\uFEFFconst 🌿 = "漢字";\r\n// 🌊\n','utf8'),review=await recordedReview(service,authority,file,baseline,Buffer.from('changed source\n'));
 try{
  const result=await undoWithPanel(service,panel,review);expect(result).toMatchObject({ok:true,status:'undone'});
  expect(await readFile(file)).toEqual(baseline);expect(service.getPendingReview(file)).toBeUndefined();expect(modelRequests).toHaveLength(0);
  const event=events.find(event=>event.type==='tool-progress'&&event.tool==='DreamGraph operator execution');
  expect(event.message).toContain('reconciliation_pending');const executionId=event.message.split(': reconciliation_pending')[0];
  expect(await host.readExecution(executionId)).toMatchObject({status:'reconciliation_pending',authority_active:false,graph_receipt_ids:[]});
  const owner=[...contexts.values()].find(value=>!value.execution_policy)!;
  const journal=await withSessionContext(owner,()=>readManagedContext(executionId));expect(journal.effects).toHaveLength(1);
  expect(journal.effects[0].tool).toBe('create_file');expect(journal.obligation_ids).toHaveLength(1);
 }finally{panel.dispose();}
},15000);

it.each(['created','deleted'] as const)('compiled editor Undo for a %s file uses the actual source owner and exact absent/hash precondition',async kind=>{
 const {panel,changeReviewService:service,authority}=await operatorPanelFixture(),file=join(root,'review.ts'),baseline=Buffer.from('original 🌿\r\n');
 const review=await recordedReview(service,authority,file,kind==='created'?null:baseline,kind==='created'?Buffer.from('new source'):null);
 try{
  expect(await undoWithPanel(service,panel,review)).toMatchObject({ok:true,status:'undone'});
  if(kind==='created')await expect(readFile(file)).rejects.toMatchObject({code:'ENOENT'});else expect(await readFile(file)).toEqual(baseline);
  expect(modelRequests).toHaveLength(0);
 }finally{panel.dispose();}
},15000);

it('Undo refuses a file changed after its review without dispatching authority or overwriting user bytes',async()=>{
 const {panel,changeReviewService:service,authority,events}=await operatorPanelFixture(),file=join(root,'source.ts');
 const review=await recordedReview(service,authority,file,Buffer.from('baseline'),Buffer.from('agent change'));
 await writeFile(file,'later user edit');
 try{
  expect(await undoWithPanel(service,panel,review)).toMatchObject({ok:false,status:'conflict'});
  expect(await readFile(file,'utf8')).toBe('later user edit');expect(events.some(event=>event.type==='operatorExecution')).toBe(false);
  expect(service.getPendingReview(file)).toMatchObject({id:review.id});expect(modelRequests).toHaveLength(0);
 }finally{panel.dispose();}
});

it('a changed editor authority refuses Undo before admission and retains a retryable original review',async()=>{
 const {panel,changeReviewService:service,authority,events}=await operatorPanelFixture(),file=join(root,'source.ts');
 const review=await recordedReview(service,authority,file,Buffer.from('baseline'),Buffer.from('agent change'));
 panel.currentInstanceId='another-instance';
 try{
  expect(await undoWithPanel(service,panel,review)).toMatchObject({ok:false,status:'conflict'});
  expect(await readFile(file,'utf8')).toBe('agent change');expect(events.some(event=>event.type==='operatorExecution')).toBe(false);
  expect(service.getPendingReview(file)).toMatchObject({id:review.id,undoUnconfirmed:false});
  panel.currentInstanceId=authority.instanceId;expect(await undoWithPanel(service,panel,review)).toMatchObject({ok:true,status:'undone'});
 }finally{panel.dispose();}
},15000);

it('a lost operator closure acknowledgement retains recovery and duplicate Undo/Keep cannot repeat or erase it',async()=>{
 const {host,panel,changeReviewService:service,authority}=await operatorPanelFixture(),file=join(root,'source.ts');
 const review=await recordedReview(service,authority,file,Buffer.from('baseline'),Buffer.from('agent change'));
 const finish=host.finishExecution.bind(host);let closed=0;
 host.finishExecution=async(...args)=>{const result=await finish(...args);closed++;throw new Error('declared lost acknowledgement after actual closure');};
 try{
  expect(await undoWithPanel(service,panel,review)).toMatchObject({ok:false,status:'conflict'});expect(await readFile(file,'utf8')).toBe('baseline');
  expect(service.getPendingReview(file)).toMatchObject({id:review.id,undoUnconfirmed:true});expect(panel._requiresOperatorRecovery()).toBe(true);
  expect(await undoWithPanel(service,panel,review)).toMatchObject({ok:false});expect(await service.keep(file,review.id)).toMatchObject({ok:false});expect(closed).toBe(1);
  await expect(panel._executeOperatorTool('read_source_code',{filePath:file},authority)).rejects.toThrow('RECOVERY_REQUIRED');
  expect(await host.readExecution(panel._operatorRecovery.executionId)).toMatchObject({status:'reconciliation_pending',authority_active:false});
  const executionId=panel._operatorRecovery.executionId;
  const restored=await service.recoverUndo(file,review.id,async(id:string,binding:any)=>{
    const execution=await panel._recoverOperatorExecution(id,binding);
    return {executionId:execution.execution_id,closureStatus:execution.status,authorityActive:execution.authority_active};
  });
  expect(restored).toMatchObject({ok:true,status:'undone'});expect(service.getPendingReview(file)).toBeUndefined();expect(closed).toBe(1);
  expect(panel._requiresOperatorRecovery()).toBe(false);expect((await host.readExecution(executionId)).obligation_ids).toHaveLength(1);
 }finally{host.finishExecution=finish;panel.dispose();}
},15000);

it('captured review copies cannot mutate the baseline/authority and stale IDs cannot clear or undo a later edit',async()=>{
 const {panel,changeReviewService:service,authority}=await operatorPanelFixture(),file=join(root,'source.ts');
 const original=Buffer.from('baseline 🌿\r\n'),review=await recordedReview(service,authority,file,original,Buffer.from('first agent change'));
 try{
  const exposed=service.getPendingReviews()[0];exposed.authority.endpoint='http://foreign';exposed.baselineContent.fill(0);exposed.id='forged';exposed.undoUnconfirmed=true;
  expect(service.getPendingReview(file)).toMatchObject({id:review.id,authority});expect(Buffer.from(service.getPendingReview(file).baselineContent)).toEqual(original);
  const snapshot=await service.captureWorkspaceSnapshot(authority);await writeFile(file,'second agent change');await service.recordWorkspaceChanges(snapshot);
  const current=service.getPendingReview(file);expect(current.id).not.toBe(review.id);
  expect(await service.keep(file,review.id)).toMatchObject({ok:false});expect(await undoWithPanel(service,panel,review)).toMatchObject({ok:false});
  expect(await readFile(file,'utf8')).toBe('second agent change');expect(await undoWithPanel(service,panel,current)).toMatchObject({ok:true});expect(await readFile(file)).toEqual(original);
 }finally{panel.dispose();}
},15000);

it('lost operator admission can close the same original lease without dispatching any tool or minting a replacement',async()=>{
 const {host,panel,authority}=await operatorPanelFixture(),begin=host.beginExecution.bind(host);let calls=0;
 host.beginExecution=async(...args)=>{calls++;await begin(...args);throw new Error('declared lost original admission acknowledgement');};
 try{
  await expect(panel._executeOperatorTool('create_file',{filePath:join(root,'source.ts'),content:'must not run'},authority)).rejects.toThrow('ADMISSION_UNCONFIRMED');
  const executionId=panel._operatorRecovery.executionId;expect((await host.readExecution(executionId)).authority_active).toBe(true);
  await expect(panel._recoverOperatorExecution('another-id',authority)).rejects.toThrow('TARGET_CHANGED');
  expect(await panel._recoverOperatorExecution(executionId,authority)).toMatchObject({status:'no_change',authority_active:false});
  expect(panel._requiresOperatorRecovery()).toBe(false);expect(calls).toBe(1);expect(await readFile(join(root,'source.ts'),'utf8')).toBe('source before');
  const owner=[...contexts.values()].find(value=>!value.execution_policy)!;expect((await withSessionContext(owner,()=>readManagedContext(executionId))).effects).toEqual([]);
 }finally{host.beginExecution=begin;panel.dispose();}
},15000);

it('operator recovery cannot turn actual unknown termination into a successful closure or redirect to a different instance',async()=>{
 const {host,panel,authority}=await operatorPanelFixture(),lease=await host.beginExecution({id:'operator-unknown',adapter:'vscode/operator',query:'Host context'});
 await host.finishExecution(lease.execution.execution_id,'cancelled','unconfirmed');let finishCalls=0;
 panel._operatorRecovery={executionId:lease.execution.execution_id,authority,port:host,finish:async(signal:AbortSignal)=>{finishCalls++;return host.finishExecution(lease.execution.execution_id,'cancelled','unconfirmed',signal);}};
 try{
  panel.currentInstanceId='other-instance';await expect(panel._recoverOperatorExecution(lease.execution.execution_id)).rejects.toThrow('TARGET_CHANGED');expect(finishCalls).toBe(0);
  panel.currentInstanceId=authority.instanceId;expect(await panel._recoverOperatorExecution(lease.execution.execution_id)).toMatchObject({status:'recovery_required',authority_active:false});
  expect(panel._requiresOperatorRecovery()).toBe(true);expect(finishCalls).toBe(1);
  const owner=[...contexts.values()].find(value=>!value.execution_policy)!;expect((await withSessionContext(owner,()=>readManagedContext(lease.execution.execution_id))).effects).toContainEqual(expect.objectContaining({tool:'host_adapter_termination',outcome:'unknown'}));
 }finally{panel.dispose();}
},15000);

it('Stop invalidates queued review clicks before their second owner dispatch',async()=>{
 const {panel}=await operatorPanelFixture();let enter!:()=>void,release!:()=>void;
 const entered=new Promise<void>(resolve=>enter=resolve),wait=new Promise<void>(resolve=>release=resolve),calls:string[]=[];
 try{
  const first=panel._queueReviewAction(async()=>{calls.push('first');enter();await wait;});await entered;
  const second=panel._queueReviewAction(async()=>{calls.push('second');});panel.abortGeneration();release();await Promise.all([first,second]);
  expect(calls).toEqual(['first']);expect(modelRequests).toHaveLength(0);
 }finally{release();panel.dispose();}
});

it('operator message-action errors retain the complete actual owner payload and a failed trace, with no local alias fallback',async()=>{
 const {host,panel,authority}=await operatorPanelFixture();
 try{
  const result=await panel._executeMessageActionTool('read_source_code',{filePath:join(root,'missing.ts')});
  expect(panel._ownerResultFailed(result.result)).toBe(true);expect(result.execution.status).toBe('no_change');
  expect(panel._lastToolTrace.at(-1)).toMatchObject({tool:'read_source_code',status:'failed'});
  expect(JSON.parse(result.result.content[0].text)).toMatchObject({success:false});
  await expect(panel._executeOperatorTool('write_file',{filePath:join(root,'source.ts'),content:'must not escape'},authority)).rejects.toThrow('LOCAL_TOOL_UNAVAILABLE');
  expect(await readFile(join(root,'source.ts'),'utf8')).toBe('source before');expect(modelRequests).toHaveLength(0);
  expect(panel._requiresOperatorRecovery()).toBe(false);
 }finally{panel.dispose();}
},15000);

it('an explicit operator message action records changed-file review under its original daemon and retains the actual source closure',async()=>{
 const {panel,changeReviewService:service,authority}=await operatorPanelFixture(),file=join(root,'source.ts');
 service.listReviewableWorkspacePaths=async()=>[file];
 try{
  const returned=await panel._executeMessageActionTool('create_file',{filePath:file,content:'operator changed 🌿\r\n'});
  expect(returned.execution).toMatchObject({status:'reconciliation_pending',authority_active:false});expect(returned.reviewError).toBeUndefined();
  expect(service.getPendingReview(file)).toMatchObject({authority,baselineKind:'existing',currentKind:'existing'});
  expect(panel._lastToolTrace.at(-1)).toMatchObject({tool:'create_file',status:'completed'});expect(modelRequests).toHaveLength(0);
 }finally{panel.dispose();}
},15000);

it('a returned message action persists its original instance outcome and never labels pending source debt as completed after selection changes',async()=>{
 const {panel,authority,events}=await operatorPanelFixture(),source={id:'operator-source-message',instanceId:authority.instanceId,role:'assistant',content:'Declared operator action',timestamp:new Date().toISOString()};
 const saved:Array<{instance:string;messages:any[]}>=[],execute=panel._executeMessageActionTool.bind(panel);
 panel.messages=[source];panel.memory={save:async(instance:string,messages:any[])=>{saved.push({instance,messages:JSON.parse(JSON.stringify(messages))});}};
 panel._buildMessageActions=()=>[{id:'declared-operator-action',actionType:'tool',label:'Apply original source action',toolName:'create_file',toolArgs:{filePath:join(root,'source.ts'),content:'explicit operator edit'},destructive:false}];
 panel._executeMessageActionTool=async(...args:any[])=>{const result=await execute(...args);panel.currentInstanceId='new-selection';panel.messages=[];return result;};
 try{
  await panel._runMessageAction(source.id,'declared-operator-action');
  expect(saved).toHaveLength(1);expect(saved[0].instance).toBe(authority.instanceId);expect(saved[0].messages.at(-1)).toMatchObject({instanceId:authority.instanceId,role:'system'});
  expect(saved[0].messages.at(-1).content).toContain('status: reconciliation_pending');expect(panel.messages).toEqual([]);
  expect(events.some(event=>event.type==='addMessage')).toBe(false);
  expect(events.findLast(event=>event.type==='messageActionState')).toMatchObject({status:'failed',error:expect.stringContaining('closure is incomplete')});
  expect(await readFile(join(root,'source.ts'),'utf8')).toBe('explicit operator edit');expect(modelRequests).toHaveLength(0);
 }finally{panel.memory=undefined;panel.dispose();}
},15000);

it('expired lost-ack review recovers only by reading the original settled closure, without renewing approval or repeating its effect',async()=>{
 const host=client(),approve=host.approveExecution.bind(host);let approved=0,ran=0;
 host.approveExecution=async request=>{approved++;await approve(request);throw new Error('declared lost approved review acknowledgement');};
 // Allow actual transport/admission work under the shared root suite load.
 // The case still waits for real authority expiry before closure inspection.
 const lease=await host.beginExecution({id:'review-inspection-expired',adapter:'vscode/native',query:'Host context',timeout_ms:4000}),review=new ExecutionReviewController(()=>undefined,10);
 await host.deliverExecution(lease.workerBearer,lease.execution.pack.receipt.id,lease.execution.block);await review.start(host,lease.execution.execution_id);
 const owner=[...contexts.values()].find(value=>!value.execution_policy)!,args={filePath:'source.ts',content:'source before'};
 const effect=withSessionContext(owner,()=>withHostExecution(lease.execution.execution_id,()=>invokeToolBoundary({name:'create_file',shape:{filePath:z.string(),content:z.string()},args,
  handler:async()=>{ran++;return {content:[{type:'text',text:JSON.stringify({obligation:await managedSourceEffect({changes:[{file:join(root,'source.ts'),content:args.content}],apply:()=>writeFile(join(root,'source.ts'),args.content)})})}]};}})));
 try{
  await vi.waitFor(()=>expect(review.view.status).toBe('pending'),{timeout:4000});const request=review.view.request!;
  await expect(review.decide(request.execution_id,request.approval_id,'approve')).rejects.toThrow('lost');await effect;
  await vi.waitFor(async()=>expect((await host.readExecution(request.execution_id)).authority_active).toBe(false),{timeout:4000});
  expect(await host.finishExecution(request.execution_id,'completed','confirmed')).toMatchObject({status:'no_change'});
  expect(await review.inspect(request.execution_id,request.approval_id)).toMatchObject({status:'no_change',authority_active:false});
  expect(review.view).toMatchObject({status:'closed',request,inspection:{status:'no_change'},canInspect:false});expect(review.blocksContinuation).toBe(false);
  expect(approved).toBe(1);expect(ran).toBe(1);await expect(review.decide(request.execution_id,request.approval_id,'approve')).rejects.toThrow('TARGET_CHANGED');
 }finally{review.stop();host.approveExecution=approve;await host.finishExecution(lease.execution.execution_id,'cancelled','confirmed').catch(()=>undefined);await effect;}
},15000);

it('review inspection retains actual unknown termination and disables historical approval after revocation',async()=>{
 const host=client(),approve=host.approveExecution.bind(host);let approved=0;
 host.approveExecution=async request=>{approved++;await approve(request);throw new Error('declared lost review acknowledgement');};
 const lease=await host.beginExecution({id:'review-inspection-unknown',adapter:'vscode/native',query:'Host context'}),review=new ExecutionReviewController(()=>undefined,10);
 await host.deliverExecution(lease.workerBearer,lease.execution.pack.receipt.id,lease.execution.block);await review.start(host,lease.execution.execution_id);
 const owner=[...contexts.values()].find(value=>!value.execution_policy)!,args={filePath:'source.ts',content:'source before'};
 const effect=withSessionContext(owner,()=>withHostExecution(lease.execution.execution_id,()=>invokeToolBoundary({name:'create_file',shape:{filePath:z.string(),content:z.string()},args,
  handler:async()=>{
   const obligation=await managedSourceEffect({changes:[{file:join(root,'source.ts'),content:args.content}],apply:()=>writeFile(join(root,'source.ts'),args.content)});
   return {content:[{type:'text',text:JSON.stringify({obligation})}]};
  }
 })));
 try{
  await vi.waitFor(()=>expect(review.view.status).toBe('pending'),{timeout:3000});const request=review.view.request!;
  await expect(review.decide(request.execution_id,request.approval_id,'approve')).rejects.toThrow('lost');await effect;
  await host.finishExecution(request.execution_id,'cancelled','unconfirmed');
  expect(await review.inspect(request.execution_id,request.approval_id)).toMatchObject({status:'recovery_required',authority_active:false});
  expect(review.view).toMatchObject({status:'unconfirmed',request,inspection:{status:'recovery_required'},canInspect:true});expect(review.blocksContinuation).toBe(true);
  await expect(review.decide(request.execution_id,request.approval_id,'approve')).rejects.toThrow('AUTHORITY_REVOKED');expect(approved).toBe(1);
  await expect(review.start(host,'must-not-replace-unknown')).rejects.toThrow('RECOVERY_REQUIRED');
 }finally{review.stop();host.approveExecution=approve;await effect;}
},15000);

it('inspection of a pending review fences continuation when its original authority was revoked with unknown termination',async()=>{
 const host=client(),lease=await host.beginExecution({id:'review-inspection-revoked-pending',adapter:'vscode/native',query:'Host context'}),review=new ExecutionReviewController(()=>undefined,10);
 await host.deliverExecution(lease.workerBearer,lease.execution.pack.receipt.id,lease.execution.block);await review.start(host,lease.execution.execution_id);
 const owner=[...contexts.values()].find(value=>!value.execution_policy)!;
 const effect=withSessionContext(owner,()=>withHostExecution(lease.execution.execution_id,()=>invokeToolBoundary({name:'create_file',shape:{filePath:z.string(),content:z.string()},args:{filePath:'source.ts',content:'must not run'},handler:()=>{throw new Error('must not dispatch');}})));
 try{
  await vi.waitFor(()=>expect(review.view.status).toBe('pending'),{timeout:3000});const request=review.view.request!;
  await host.finishExecution(request.execution_id,'cancelled','unconfirmed');expect((await effect).isError).toBe(true);
  expect(await review.inspect(request.execution_id,request.approval_id)).toMatchObject({status:'recovery_required',authority_active:false});
  expect(review.view).toMatchObject({status:'unconfirmed',inspection:{status:'recovery_required'},canInspect:true});expect(review.blocksContinuation).toBe(true);
  await expect(review.decide(request.execution_id,request.approval_id,'approve')).rejects.toThrow('AUTHORITY_REVOKED');
  review.stop();expect(review.blocksContinuation).toBe(true);expect(review.view.request).toEqual(request);
  expect(await readFile(join(root,'source.ts'),'utf8')).toBe('source before');
 }finally{review.stop();await effect;}
},15000);

it('Stop during a noncooperative inspection cannot resurrect a retired pending review from a late original-host reply',async()=>{
 const host=client(),lease=await host.beginExecution({id:'review-inspection-stop',adapter:'vscode/native',query:'Host context'}),review=new ExecutionReviewController(()=>undefined,10);
 await host.deliverExecution(lease.workerBearer,lease.execution.pack.receipt.id,lease.execution.block);await review.start(host,lease.execution.execution_id);
 const owner=[...contexts.values()].find(value=>!value.execution_policy)!;
 const effect=withSessionContext(owner,()=>withHostExecution(lease.execution.execution_id,()=>invokeToolBoundary({name:'create_file',shape:{filePath:z.string(),content:z.string()},args:{filePath:'source.ts',content:'must not run'},handler:()=>{throw new Error('must not dispatch');}})));
 let release!:()=>void,entered!:()=>void;const late=new Promise<void>(resolve=>release=resolve),started=new Promise<void>(resolve=>entered=resolve),read=host.readExecution.bind(host);
 try{
  await vi.waitFor(()=>expect(review.view.status).toBe('pending'),{timeout:3000});const request=review.view.request!;
  host.readExecution=async id=>{const result=await read(id);entered();await late;return result;};
  const inspecting=review.inspect(request.execution_id,request.approval_id).catch(error=>error);await started;review.stop();release();
  expect(String(await inspecting)).toContain('INSPECTION_STOPPED');expect(review.view.status).toBe('idle');expect(review.view.request).toBeUndefined();expect(review.blocksContinuation).toBe(false);
  await host.finishExecution(lease.execution.execution_id,'cancelled','confirmed');expect((await effect).isError).toBe(true);
  expect(await readFile(join(root,'source.ts'),'utf8')).toBe('source before');
 }finally{release();host.readExecution=read;review.stop();await host.finishExecution(lease.execution.execution_id,'cancelled','confirmed').catch(()=>undefined);await effect;}
},15000);

it('a compiled palette command uses the original daemon owner, records actual source change and keeps reconciliation separate from exit zero',async()=>{
 const {host,panel,authority:binding,changeReviewService:service}=await operatorPanelFixture(),file=join(root,'source.ts');
 service.listReviewableWorkspacePaths=async()=>[file];
 const run=panel.captureManualCommand(),command=`node -e "require('node:fs').writeFileSync('source.ts','palette source after')"`;
 try{
  const returned=await run({command,timeoutMs:5000});
  expect(returned.result.isError).not.toBe(true);const result=JSON.parse(returned.result.content[0].text);
  expect(result).toMatchObject({exitCode:0,execution_id:returned.execution.execution_id});
  expect(returned.execution).toMatchObject({status:'reconciliation_pending',authority_active:false,obligation_ids:[expect.any(String)]});
  expect(await readFile(file,'utf8')).toBe('palette source after');
  expect(service.getPendingReview(file)).toMatchObject({authority:binding,baselineContent:expect.anything()});
  expect((await host.readExecution(returned.execution.execution_id)).pack.receipt.delivery).toBe('delivered');expect(modelRequests).toHaveLength(0);
 }finally{panel.dispose();}
},15000);

it('a compiled palette capture refuses a later instance selection before any execution admission or local shell fallback',async()=>{
 const {host,panel}=await operatorPanelFixture(),begin=vi.spyOn(host,'beginExecution'),run=panel.captureManualCommand();
 panel.currentInstanceId='later-selected-instance';
 try{
  await expect(run({command:`node -e "require('node:fs').writeFileSync('source.ts','must not run')"`})).rejects.toThrow('AUTHORITY_CHANGED');
  expect(begin).not.toHaveBeenCalled();expect(await readFile(join(root,'source.ts'),'utf8')).toBe('source before');expect(modelRequests).toHaveLength(0);
 }finally{panel.dispose();}
});

it('palette invocation without an original daemon refuses before dispatch and leaves source unchanged',async()=>{
 const {ChatPanel}=compiledEditor(),panel=new ChatPanel({});
 try{
  await expect(panel.captureManualCommand()({command:`node -e "require('node:fs').writeFileSync('source.ts','must not run')"`})).rejects.toThrow('AUTHORITY_CHANGED');
  expect(await readFile(join(root,'source.ts'),'utf8')).toBe('source before');expect(modelRequests).toHaveLength(0);
 }finally{panel.dispose();}
});

/** Palette-only UI doubles; compiled callback/projection are actual shipped code, no local command runs. */
function paletteFixture(){
 const {editor,registerRunnerCommands}=compiledEditor(),commands=new Map<string,()=>Promise<void>>(),output:string[]=[],messages:Array<{kind:string;text:string}>=[];
 editor.commands.registerCommand=(name:string,handler:()=>Promise<void>)=>{commands.set(name,handler);return {dispose:()=>commands.delete(name)};};
 editor.window.createOutputChannel=()=>({appendLine:(text:string)=>output.push(text),show:()=>undefined});
 for(const [method,kind] of [['showInformationMessage','info'],['showWarningMessage','warning'],['showErrorMessage','error']])
  editor.window[method]=async(text:string)=>{messages.push({kind,text});};
 editor.workspace.workspaceFolders=[{uri:{fsPath:root}}];
 return {editor,registerRunnerCommands,commands,output,messages};
}
it('the actual palette captures before prompting and shows complete owner evidence with a pending warning despite exit zero',async()=>{
 const fixture=paletteFixture(),events:string[]=[],invocations:any[]=[],original={instance:'original-instance'};let selected=original;
 fixture.editor.window.showInputBox=async()=>{events.push('prompt');selected={instance:'new-selection'};return `node -e "require('node:fs').writeFileSync('source.ts','must not run locally')"`;};
 const outcome={result:{content:[{type:'text',text:JSON.stringify({exitCode:0,stdout:'whole Unicode 漢🌿 '+ 'data'.repeat(10000)})}]},execution:{execution_id:'palette-captured',status:'reconciliation_pending',authority_active:false}};
 fixture.registerRunnerCommands({subscriptions:[]},()=>{events.push('capture');const captured=selected;return async(input:any)=>{invocations.push({captured,input});return outcome;};});
 await fixture.commands.get('dreamgraph.runCommand')!();
 expect(events).toEqual(['capture','prompt']);expect(invocations).toHaveLength(1);expect(invocations[0].captured).toBe(original);
 expect(JSON.parse(fixture.output[0])).toEqual(outcome);expect(fixture.messages).toEqual([{kind:'warning',text:expect.stringContaining('reconciliation_pending')}]);
 expect(await readFile(join(root,'source.ts'),'utf8')).toBe('source before');expect(modelRequests).toHaveLength(0);
});

it('the actual build palette preserves literal root ext-prefixed script identity and refuses unsafe script names without dispatch',async()=>{
 const fixture=paletteFixture(),invocations:any[]=[];
 await writeFile(join(root,'package.json'),JSON.stringify({scripts:{'ext:build':'declared build','bad&name':'declared unsafe name'}}));
 fixture.editor.window.showQuickPick=async(items:any[])=>items.find(item=>item.script==='ext:build');
 fixture.registerRunnerCommands({subscriptions:[]},()=>async(input:any)=>{invocations.push(input);return {result:{content:[{type:'text',text:JSON.stringify({exitCode:0})}]},execution:{execution_id:'build-captured',status:'no_change',authority_active:false}};});
 await fixture.commands.get('dreamgraph.runBuild')!();expect(invocations).toEqual([{command:'npm run -- ext:build',cwd:root}]);
 expect(fixture.messages[0]).toMatchObject({kind:'info',text:expect.stringContaining('no_change')});
 fixture.editor.window.showQuickPick=async(items:any[])=>items.find(item=>item.script==='bad&name');
 await fixture.commands.get('dreamgraph.runBuild')!();expect(invocations).toHaveLength(1);expect(fixture.messages.at(-1)).toMatchObject({kind:'error',text:expect.stringContaining('safely')});
 fixture.editor.window.showQuickPick=async()=>undefined;await fixture.commands.get('dreamgraph.runBuild')!();expect(invocations).toHaveLength(1);
 expect(await readFile(join(root,'source.ts'),'utf8')).toBe('source before');expect(modelRequests).toHaveLength(0);
});

function hostModelAllocation() {
 for(const [suffix,value] of Object.entries({RUN_BUDGET:'10',DAY_BUDGET:'10',PRICING_VERSION:'native-host.offline.v1',BUDGET_CURRENCY:'USD',BILLING_PRINCIPAL:'offline:host',CONTEXT_TOKENS:'65536',MAX_CALLS:'4',MAX_RETRIES:'0'}))
  vi.stubEnv('DREAMGRAPH_LLM_ARCHITECT_'+suffix,value);
 vi.stubEnv('DREAMGRAPH_LLM_PRICING',JSON.stringify([{provider:'openai',model:'gpt-4.1',currency:'USD',version:'native-host.offline.v1',source:'Synthetic native-host fixture; no provider price or request',input_per_million:1,output_per_million:1,input_includes_images:true,output_includes_reasoning:true}]));
}
async function hostModelFixture(id:string,timeout_ms=300000) {
 hostModelAllocation();const host=client(),lease=await host.beginExecution({id,adapter:'vscode/openai',query:'Host context',timeout_ms});
 await host.deliverExecution(lease.workerBearer,lease.execution.pack.receipt.id,lease.execution.block);
 const request:ManagedModelAdmissionRequest={execution_id:id,request_id:id+':call',binding:{provider:'openai',model:'gpt-4.1',adapter:'native_api',api:'chat_completions',base_url:'https://offline.invalid/v1',output_tokens:100},
  payload:JSON.stringify({model:'gpt-4.1',max_tokens:100,messages:[{role:'user',content:lease.execution.block+'\nUnicode 漢🙂'}]}),output_tokens:100};
 return {host,lease,request};
}
const modelReport=(permit:ManagedModelPermit)=>({execution_id:permit.execution_id,request_id:permit.request_id,attempt_id:permit.attempt_id,acknowledged:true,work_termination:'confirmed' as const,usage:{inputTokens:100,outputTokens:10}});

it('native-host API accounting reserves the complete Unicode wire before any provider dispatch and recovers exact settlement after closure',async()=>{
 const {host,request}=await hostModelFixture('host-model-api');
 try{
  const before=await loadPublicationState(),permit=await host.admitModel(request);
  expect(permit).toMatchObject({execution_id:request.execution_id,request_id:request.request_id,billing_channel:'api',attests:'possible_dispatch_liability_only',input_token_allowance:Buffer.byteLength(request.payload,'utf8')+2048});
  const ledger=JSON.parse(await readFile(join(root,'data/spend_ledger.json'),'utf8'));expect(ledger.attempts[permit.attempt_id]).toMatchObject({state:'dispatched',acknowledged:false,usage:null,provider:'openai',model:'gpt-4.1',credential_reference:'HOST_NATIVE_CREDENTIAL'});
  expect(JSON.stringify(ledger)).not.toContain('Unicode');expect(modelRequests).toHaveLength(0);
  expect((await loadPublicationState()).revision.graph_revision).toBe(before.revision.graph_revision);
  await expect(host.admitModel(request)).rejects.toThrow('REDISPATCH_FORBIDDEN');
  const report=modelReport(permit),result=await host.settleModel(report);expect(result).toMatchObject({state:'host_reported',settlement:report,report_attests:'trusted_host_observation_only'});
  expect(await host.settleModel(report)).toEqual(result);await expect(host.settleModel({...report,usage:{inputTokens:99,outputTokens:10}})).rejects.toThrow('SETTLEMENT_CHANGED');
  expect(await host.finishExecution(request.execution_id,'completed','confirmed')).toMatchObject({status:'no_change'});
  expect(await host.readModel(request.execution_id,request.request_id)).toMatchObject({state:'host_reported',permit:null,settlement:report});
 }finally{await host.finishExecution(request.execution_id,'failed','unconfirmed').catch(()=>undefined);}
});

it('native-host permits require whole delivered context, original owner and host-only transport',async()=>{
 const {host,lease,request}=await hostModelFixture('host-model-owner'),other=client();
 try{
  await expect(host.admitModel({...request,payload:JSON.stringify({model:'gpt-4.1',max_tokens:100,messages:[]})})).rejects.toThrow('REQUIRED_CONTEXT_MISSING');
  await expect(other.admitModel(request)).rejects.toThrow('AUTHORITY_UNAVAILABLE');
  const response=await fetch(`http://127.0.0.1:${port}/api/executions/v1/model/admit`,{method:'POST',headers:{'Content-Type':'application/json','X-DreamGraph-Session':lease.workerBearer},body:JSON.stringify(request)});expect(response.status).toBe(403);
  expect(modelRequests).toHaveLength(0);expect(await host.finishExecution(request.execution_id,'completed','confirmed')).toMatchObject({status:'no_change'});
 }finally{await host.finishExecution(request.execution_id,'failed','unconfirmed').catch(()=>undefined);}
});

it('zero paid allocation or unknown exact tariff cannot issue native-host permits',async()=>{
 const {host,request}=await hostModelFixture('host-model-zero');
 try{vi.stubEnv('DREAMGRAPH_LLM_ARCHITECT_RUN_BUDGET','0');await expect(host.admitModel(request)).rejects.toThrow('ZERO_PAID_ALLOCATION');
  expect(await host.readModel(request.execution_id,request.request_id)).toMatchObject({state:'refused',permit:null});
  expect(await host.finishExecution(request.execution_id,'failed','confirmed')).toMatchObject({status:'no_change'});
 }finally{await host.finishExecution(request.execution_id,'failed','unconfirmed').catch(()=>undefined);}
 const second=await hostModelFixture('host-model-unpriced');
 try{vi.stubEnv('DREAMGRAPH_LLM_PRICING','[]');await expect(second.host.admitModel(second.request)).rejects.toThrow('EXACT_PRICING_REQUIRED');expect(modelRequests).toHaveLength(0);}
 finally{await second.host.finishExecution(second.request.execution_id,'failed','confirmed').catch(()=>undefined);}
});

it('native-host requests keep one policy and a shared cumulative run/retry ceiling across changed configuration',async()=>{
 const {host,request}=await hostModelFixture('host-model-pin');vi.stubEnv('DREAMGRAPH_LLM_ARCHITECT_MAX_CALLS','2');
 try{
  const first=await host.admitModel(request);await host.settleModel(modelReport(first));
  await expect(host.admitModel({...request,request_id:'unapproved-retry',retry:true})).rejects.toThrow('RETRY_LIMIT');
  await expect(host.admitModel({...request,request_id:'different-route',binding:{...request.binding,model:'gpt-4.1-mini'},payload:request.payload.replaceAll('gpt-4.1','gpt-4.1-mini')})).rejects.toThrow('BINDING_CHANGED');
  vi.stubEnv('DREAMGRAPH_LLM_ARCHITECT_MAX_CALLS','100');vi.stubEnv('DREAMGRAPH_LLM_PRICING','[]');
  const second=await host.admitModel({...request,request_id:'second'});expect(second.policy_fingerprint).toBe(first.policy_fingerprint);await host.settleModel(modelReport(second));
  await expect(host.admitModel({...request,request_id:'third'})).rejects.toThrow('REQUEST_LIMIT');
  expect(await host.finishExecution(request.execution_id,'completed','confirmed')).toMatchObject({status:'no_change'});
 }finally{await host.finishExecution(request.execution_id,'failed','unconfirmed').catch(()=>undefined);}
});

it('a lost native permit response retains liability, read-only recovery and unknown closure instead of authorizing retry',async()=>{
 const {host,request}=await hostModelFixture('host-model-lost');
 try{
  const original=host.admitModel.bind(host);host.admitModel=async(value,signal)=>{await original(value,signal);throw new Error('Declared lost admission acknowledgement');};
  await expect(host.admitModel(request)).rejects.toThrow('lost admission');const outcome=await host.readModel(request.execution_id,request.request_id);expect(outcome.state).toBe('awaiting_host');
  await expect(original(request)).rejects.toThrow('REDISPATCH_FORBIDDEN');
  const closed=await host.finishExecution(request.execution_id,'failed','confirmed');expect(closed.status).toBe('recovery_required');
  await vi.waitFor(async()=>expect((await host.readModel(request.execution_id,request.request_id)).state).toBe('unknown'));
  const next=await hostModelFixture('host-model-overlap');
  try{await expect(next.host.admitModel(next.request)).rejects.toThrow('CONCURRENCY_LIMIT');}finally{await next.host.finishExecution(next.request.execution_id,'failed','confirmed');}
  expect(modelRequests).toHaveLength(0);
 }finally{await host.finishExecution(request.execution_id,'failed','unconfirmed').catch(()=>undefined);}
});

it('native-host deadline stops permit waiting without attesting native work stopped or dropping its liability',async()=>{
 const {host,request}=await hostModelFixture('host-model-expiry',4000);let permit:ManagedModelPermit;
 try{
  permit=await host.admitModel(request);await vi.waitFor(async()=>expect((await host.readModel(request.execution_id,request.request_id)).state).toBe('unknown'),{timeout:5000});
  expect(await host.readExecution(request.execution_id)).toMatchObject({authority_active:false});
  expect(await host.finishExecution(request.execution_id,'cancelled','unconfirmed')).toMatchObject({status:'recovery_required'});
  const attempt=JSON.parse(await readFile(join(root,'data/spend_ledger.json'),'utf8')).attempts[permit.attempt_id];expect(attempt).toMatchObject({state:'uncertain',acknowledged:false,usage:null});
 }finally{await host.finishExecution(request.execution_id,'failed','unconfirmed').catch(()=>undefined);}
},10000);

it('CLI host accounting stays subscription-unmeasured and cannot borrow an API monetary allowance',async()=>{
 const {host,request}=await hostModelFixture('host-model-cli');
 const cli={...request,binding:{...request.binding,adapter:'codex-cli' as const,api:'native_cli' as const,model:'gpt-6.1-sol',effort:'high'},payload:(await host.readExecution(request.execution_id)).block+'\nNative CLI prompt'};
 try{
  vi.stubEnv('DREAMGRAPH_LLM_ARCHITECT_BUDGET_CURRENCY','subscription_units');vi.stubEnv('DREAMGRAPH_LLM_ARCHITECT_RUN_BUDGET','0');vi.stubEnv('DREAMGRAPH_LLM_ARCHITECT_DAY_BUDGET','0');
  const permit=await host.admitModel(cli);expect(permit.billing_channel).toBe('subscription');await host.settleModel({...modelReport(permit),usage:null});
  const attempt=JSON.parse(await readFile(join(root,'data/spend_ledger.json'),'utf8')).attempts[permit.attempt_id];expect(attempt).toMatchObject({usage:null,charge_source:'unmeasured_subscription',acknowledged:true,state:'uncertain'});
  expect(await host.finishExecution(request.execution_id,'completed','confirmed')).toMatchObject({status:'no_change'});
 }finally{await host.finishExecution(request.execution_id,'failed','unconfirmed').catch(()=>undefined);}
 const second=await hostModelFixture('host-model-cli-currency');
 try{vi.stubEnv('DREAMGRAPH_LLM_ARCHITECT_BUDGET_CURRENCY','subscription_units');await expect(second.host.admitModel({...cli,execution_id:second.request.execution_id,request_id:'currency',payload:second.lease.execution.block})).rejects.toThrow('SUBSCRIPTION_CURRENCY_UNQUALIFIED');}
 finally{await second.host.finishExecution(second.request.execution_id,'failed','confirmed').catch(()=>undefined);}
});

it('the portable SDK admission port preserves original permit/report identities and read-only outcomes',async()=>{
 hostModelAllocation();const sdk=new ManagedExecutionClient({baseUrl:`http://127.0.0.1:${port}`}),id='sdk-model-admission';
 try{
  const lease=await sdk.begin({id,adapter:'sdk/native',query:'Host context'});await sdk.deliver(lease.workerBearer,lease.execution.pack.receipt.id,lease.execution.block);
  const request:ManagedModelAdmissionRequest={execution_id:id,request_id:'sdk-call',binding:{provider:'openai',model:'gpt-4.1',adapter:'native_api',api:'responses',base_url:'https://offline.invalid/v1',output_tokens:100,retention:'store_false'},output_tokens:100,
   payload:JSON.stringify({model:'gpt-4.1',max_output_tokens:100,store:false,input:[{role:'user',content:lease.execution.block}]})};
  const permit=await sdk.admitModel(request);expect(await sdk.settleModel(modelReport(permit))).toMatchObject({state:'host_reported'});
  expect(await sdk.readModel(id,'sdk-call')).toMatchObject({permit:{attempt_id:permit.attempt_id},state:'host_reported'});
  expect(await sdk.finish(id,'completed','confirmed')).toMatchObject({status:'no_change'});
 }finally{await sdk.finish(id,'failed','unconfirmed').catch(()=>undefined);sdk.dispose();}
});

it('native wire model/output/retention/effort and frontier temperature mismatches refuse before ledger dispatch',async()=>{
 const {host,request}=await hostModelFixture('host-model-wire');
 const body=JSON.parse(request.payload);
 try{
  await expect(host.admitModel({...request,payload:JSON.stringify({...body,model:'other'})})).rejects.toThrow('WIRE_MODEL_MISMATCH');
  await expect(host.admitModel({...request,payload:JSON.stringify({...body,max_tokens:101})})).rejects.toThrow('WIRE_OUTPUT_MISMATCH');
  await expect(host.admitModel({...request,binding:{...request.binding,retention:'store_false'}})).rejects.toThrow('WIRE_RETENTION_MISMATCH');
  const frontier={...request,binding:{...request.binding,model:'gpt-6.1-sol',api:'responses' as const,effort:'high'}};
  await expect(host.admitModel({...frontier,payload:JSON.stringify({model:'gpt-6.1-sol',input:[{role:'user',content:body.messages[0].content}],max_output_tokens:100,reasoning:{effort:'high'},temperature:.2})})).rejects.toThrow('TEMPERATURE_UNSUPPORTED');
  await expect(host.admitModel({...frontier,payload:JSON.stringify({model:'gpt-6.1-sol',input:[{role:'user',content:body.messages[0].content}],max_output_tokens:100,reasoning:{effort:'low'}})})).rejects.toThrow('WIRE_EFFORT_MISMATCH');
  expect(modelRequests).toHaveLength(0);await expect(readFile(join(root,'data/spend_ledger.json'))).rejects.toMatchObject({code:'ENOENT'});
 }finally{await host.finishExecution(request.execution_id,'failed','confirmed');}
});

it('an unconfirmed native report keeps actual partial usage, blocks another permit and cannot strengthen termination on retry',async()=>{
 const {host,request}=await hostModelFixture('host-model-unconfirmed');
 try{
  const permit=await host.admitModel(request),report={...modelReport(permit),usage:{inputTokens:100},work_termination:'unconfirmed' as const};
  expect(await host.settleModel(report)).toMatchObject({state:'unknown',settlement:report});
  await expect(host.settleModel({...report,work_termination:'confirmed'})).rejects.toThrow('SETTLEMENT_CHANGED');
  await expect(host.admitModel({...request,request_id:'do-not-continue'})).rejects.toThrow('OUTCOME_UNCONFIRMED');
  const attempt=JSON.parse(await readFile(join(root,'data/spend_ledger.json'),'utf8')).attempts[permit.attempt_id];
  expect(attempt).toMatchObject({state:'uncertain',acknowledged:false,usage:{inputTokens:100}});expect(attempt.resources.output_tokens).toBe(100);
  expect(await host.finishExecution(request.execution_id,'failed','confirmed')).toMatchObject({status:'recovery_required'});
 }finally{await host.finishExecution(request.execution_id,'failed','unconfirmed').catch(()=>undefined);}
});

it('native-host permits preserve a shorter configured model timeout independently of the longer host authority',async()=>{
 const {host,request}=await hostModelFixture('host-model-role-timeout');vi.stubEnv('DREAMGRAPH_LLM_ARCHITECT_TIMEOUT_MS','2500');
 try{
  const started=Date.now(),permit=await host.admitModel(request);expect(Date.parse(permit.expires_at)).toBeLessThanOrEqual(started+3000);
  await vi.waitFor(async()=>expect((await host.readModel(request.execution_id,request.request_id)).state).toBe('unknown'),{timeout:4500});
  expect(await host.readExecution(request.execution_id)).toMatchObject({authority_active:true});
  expect(await host.finishExecution(request.execution_id,'cancelled','confirmed')).toMatchObject({status:'recovery_required'});
 }finally{await host.finishExecution(request.execution_id,'failed','unconfirmed').catch(()=>undefined);}
});

async function admittedNativeFixture(id:string,provider:'openai'|'anthropic'|'ollama'='openai') {
 hostModelAllocation();
 if(provider!=='openai')vi.stubEnv('DREAMGRAPH_LLM_PRICING',JSON.stringify([{provider,model:provider==='anthropic'?'claude-haiku-4-5':'qwen3:8b',currency:'USD',version:'native-host.offline.v1',source:'Synthetic fixture tariff, no paid provider',input_per_million:1,output_per_million:1,input_includes_images:true,output_includes_reasoning:true}]));
 const host=client(),pass=await ManagedNativePass.begin(host,{id,adapter:'vscode/'+provider,query:'Host context'});
 const fixture=compiledEditor(),llm=new fixture.ArchitectLlm({});
 llm._config={provider,model:provider==='anthropic'?'claude-haiku-4-5':provider==='ollama'?'qwen3:8b':'gpt-4.1',baseUrl:`http://127.0.0.1:${port}/v1`,apiKey:'fixture-native-secret-stays-local'};
 const messages=[{role:'user' as const,content:'Host context Unicode 漢🙂'}];
 const prepared=await pass.prepare(messages,[],messages,pass.signal);
 return {host,pass,llm,prepared,editor:fixture.editor};
}
const nativeAttempts=async()=>Object.values(JSON.parse(await readFile(join(root,'data/spend_ledger.json'),'utf8')).attempts) as any[];

it.each(['openai','anthropic'] as const)('compiled %s client refuses unmapped native tools under real admission and retains known usage',async provider=>{
 const {pass,llm,prepared,editor}=await admittedNativeFixture('unmapped-native-'+provider,provider);
 if(provider==='openai')editor.workspace.getConfiguration=()=>({get:(key:string)=>key==='openai.api'?'responses':undefined});
 modelReplies.push(()=>provider==='openai'?{status:'completed',output:[{type:'computer_call',call_id:'unmapped',actions:[{type:'click',x:1,y:1}],secret:'DO_NOT_LOG_NATIVE_SECRET'}],usage:{input_tokens:100,output_tokens:10,total_tokens:110}}
  :{stop_reason:'end_turn',content:[{type:'server_tool_use',id:'unmapped',name:'computer',input:{secret:'DO_NOT_LOG_NATIVE_SECRET'}}],usage:{input_tokens:100,output_tokens:10}});
 try{
  await expect(pass.runModel(llm,()=>llm.callWithTools(prepared.messages,[],prepared.raw,pass.signal),pass.signal)).rejects.toMatchObject({code:'PROVIDER_OUTPUT_INVALID',stopReason:'unmapped_tool_output',usage:{inputTokens:100,outputTokens:10}});
  expect(modelRequests).toHaveLength(1);expect(await nativeAttempts()).toMatchObject([{state:'settled',acknowledged:true,usage:{inputTokens:100,outputTokens:10}}]);
  expect(pass.workTermination).toBe('confirmed');expect(await pass.finish('failed')).toMatchObject({status:'no_change',authority_active:false});
  const persisted=await readFile(join(root,'data/execution_contexts.json'),'utf8');expect(persisted).not.toContain('DO_NOT_LOG_NATIVE_SECRET');
 }finally{await pass.finish('failed').catch(()=>undefined);}
});

function coreSeamHost(llm:any,instanceId:string) {
 const persisted:any[]=[],recorded:any[]=[],fallbacks:any[]=[];
 const host={architectLlm:llm,contextBuilder:{},budgetCoordinator:undefined,priorMessages:[],task:'chat',
  envelope:{workspaceRoot:root,instanceId,activeFile:null,visibleFiles:[],changedFiles:[],pinnedFiles:[],environmentContext:null,graphContext:null,intentMode:'assess',intentConfidence:1},
  contextResult:{assembledContext:'Declared local host envelope; original daemon receipt must supersede it.',reasoningPacket:null},
  autonomyState:{mode:'manual',remainingAutoPasses:0,completedAutoPasses:0},autonomyEnabled:false,stopContextBlock:undefined,
  contentBlocks:undefined,droppedAttachmentNames:[],attachmentSummary:'',persistUserMessage:async()=>{},clearAttachments:async()=>{},
  persistAssistantMessage:async(args:any)=>{persisted.push(args);},recordPassCompleted:async(args:any)=>{recorded.push(args);},
  executeTool:async(call:any)=>{fallbacks.push(call);throw new Error('Private host fallback must never run');},
  getProviderCapabilities:()=>llm.getModelCapabilities()};
 return {host,persisted,recorded,fallbacks};
}
const coreSourceTools=[{name:'read_source_code',description:'Declared source owner',inputSchema:{type:'object',properties:{filePath:{type:'string'}},required:['filePath'],additionalProperties:false}},
 {name:'create_file',description:'Declared source owner',inputSchema:{type:'object',properties:{filePath:{type:'string'},content:{type:'string'}},required:['filePath','content'],additionalProperties:false}}];

it('compiled v1 API seam refuses an absent original managed pass before model, persistence or private tool fallback',async()=>{
 const {pass,llm}=await admittedNativeFixture('core-absent');const fixture=compiledEditor(),state=coreSeamHost(llm,pass.instanceId);
 try{
  await expect(fixture.runPassViaCore({host:state.host,text:'No unmanaged inference'})).rejects.toThrow('MANAGED_CORE_PASS_REQUIRED');
  await expect(fixture.createCoreProviderPort(state.host).callProvider({prompt:{system:'',conversation:[]},tools:[],iterationHistory:[]})).rejects.toThrow('MANAGED_CORE_PASS_REQUIRED');
  await expect(fixture.createCoreToolExecutorPort(state.host).executeTool({call:{id:'no-fallback',name:'read_source_code',input:{filePath:'source.ts'}}})).rejects.toThrow('MANAGED_CORE_PASS_REQUIRED');
  expect(modelRequests).toHaveLength(0);expect(state.persisted).toEqual([]);expect(state.fallbacks).toEqual([]);
 }finally{await pass.finish('failed');}
});

it('compiled v1 API seam refreshes whole graph context and literal raw dialogue under one ledger before settled persistence',async()=>{
 const {host,pass,llm}=await admittedNativeFixture('core-source-replay'),fixture=compiledEditor(),state=coreSeamHost(llm,pass.instanceId);
 await writeFile(join(root,'source.ts'),'source before'); // unchanged source baseline
 state.host.priorMessages=[{role:'assistant',content:'Prior Unicode 漢🙂'}] as any;
 state.host.persistAssistantMessage=async(args:any)=>{expect(await host.readExecution(pass.executionId)).toMatchObject({authority_active:false,status:'no_change'});state.persisted.push(args);};
 modelReplies.push(nativeReply('read_source_code',{filePath:'source.ts'}),nativeReply());
 try{
  const result=await fixture.runPassViaCore({host:state.host,text:'Read Host context Unicode 漢🙂',tools:coreSourceTools,managedPass:pass});
  expect(result).toMatchObject({stopReason:'complete',execution:{execution_id:pass.executionId,status:'no_change',authority_active:false}});
  expect(result.toolInvocations).toHaveLength(1);const whole=JSON.parse(result.toolInvocations[0].resultText);
  expect(JSON.parse(whole.content[0].text)).toEqual({source:'source before'});expect(result.toolInvocations[0].isError).toBe(false);
  expect(state.fallbacks).toEqual([]);expect(state.recorded).toHaveLength(1);expect(state.persisted[0]).toMatchObject({stopReason:'complete',execution:{execution_id:pass.executionId,status:'no_change'}});
  expect(modelRequests).toHaveLength(2);expect(JSON.stringify(modelRequests[1])).toContain('Prior Unicode 漢🙂');expect(JSON.stringify(modelRequests[1])).toContain('Read Host context Unicode 漢🙂');
  expect(modelRequests[1].messages.find((message:any)=>message.role==='tool').content).toBe(result.toolInvocations[0].resultText);
  expect(JSON.stringify(modelRequests[1])).toContain(JSON.stringify(result.execution.block).slice(1,-1));
  const attempts=await nativeAttempts();expect(attempts).toHaveLength(2);expect(attempts.every(attempt=>attempt.state==='settled'&&attempt.acknowledged)).toBe(true);
 }finally{await pass.finish('failed').catch(()=>undefined);}
});

it('compiled v1 API seam records literal MCP errors without transforming them into successful tool prose',async()=>{
 const {pass,llm}=await admittedNativeFixture('core-literal-error'),fixture=compiledEditor(),state=coreSeamHost(llm,pass.instanceId);
 modelReplies.push(nativeReply('read_source_code',{filePath:'absent.ts'}),nativeReply(undefined,{},'The source owner returned an error.'));
 try{
  const result=await fixture.runPassViaCore({host:state.host,text:'Inspect missing source',tools:coreSourceTools,managedPass:pass});
  expect(result.toolInvocations).toHaveLength(1);expect(result.toolInvocations[0].isError).toBe(true);
  expect(JSON.parse(result.toolInvocations[0].resultText)).toMatchObject({isError:true});
  expect(modelRequests[1].messages.find((message:any)=>message.role==='tool').content).toBe(result.toolInvocations[0].resultText);
  expect(state.fallbacks).toEqual([]);expect(result.execution.status).toBe('no_change');
 }finally{await pass.finish('failed').catch(()=>undefined);}
});

it('compiled v1 API seam separates a complete model loop from source reconciliation and cannot advance autonomy',async()=>{
 const {host,pass:probe,llm}=await admittedNativeFixture('core-effect-probe');await probe.finish('completed');
 const args={filePath:'source.ts',content:'source after'},pass=await ManagedNativePass.begin(host,{id:'core-source-pending',adapter:'vscode/openai',query:'Host context',approved_actions:[{tool:'create_file',arguments:args,scope_id:'fixture',calls:1}]});
 const fixture=compiledEditor(),state=coreSeamHost(llm,pass.instanceId);modelReplies.push(nativeReply('create_file',args),nativeReply(undefined,{},'Source changed; graph reconciliation is pending.'));
 try{
  const result=await fixture.runPassViaCore({host:state.host,text:'Edit Host context source',tools:coreSourceTools,managedPass:pass});
  expect(await readFile(join(root,'source.ts'),'utf8')).toBe('source after');expect(result.stopReason).toBe('complete');
  expect(result.execution).toMatchObject({execution_id:pass.executionId,status:'reconciliation_pending',authority_active:false,graph_receipt_ids:[],obligation_ids:[expect.any(String)]});
  expect(state.persisted[0]).toMatchObject({execution:{status:'reconciliation_pending'}});expect(state.recorded).toEqual([]);expect(state.fallbacks).toEqual([]);
  const panel=new fixture.ChatPanel({}),events:any[]=[];let continued=0;
  panel.setArchitectLlm(llm);panel.currentInstanceId=pass.instanceId;panel._autonomyEnabled=true;
  panel.persistMessages=async()=>{};panel.postMessage=async(event:any)=>events.push(event);panel._handleAutonomyPassComplete=async()=>{continued++;};
  const panelHost=panel._buildCorePassHost(state.host.envelope,'chat',state.host.contextResult,[],[],{contentBlocks:undefined,droppedAttachmentNames:[],attachmentSummary:'',stopContextBlock:undefined});
  await panelHost.persistAssistantMessage(state.persisted[0]);expect(continued).toBe(0);
  expect(events.find(event=>event.type==='tool-progress').message).toContain('reconciliation_pending');
  panel.currentInstanceId='different-instance';const messageCount=panel.messages.length;
  await expect(panelHost.persistAssistantMessage(state.persisted[0])).rejects.toThrow('MANAGED_CORE_PERSIST_TARGET_CHANGED');
  expect(panel.messages).toHaveLength(messageCount);expect(continued).toBe(0);
 }finally{await pass.finish('failed').catch(()=>undefined);}
});

it('compiled v1 API seam zero allocation refuses before inference and does not record a completed autonomy pass',async()=>{
 const {pass,llm}=await admittedNativeFixture('core-zero');vi.stubEnv('DREAMGRAPH_LLM_ARCHITECT_RUN_BUDGET','0');const fixture=compiledEditor(),state=coreSeamHost(llm,pass.instanceId);
 try{
  const result=await fixture.runPassViaCore({host:state.host,text:'No paid dispatch',tools:coreSourceTools,managedPass:pass});
  expect(result).toMatchObject({stopReason:'error',execution:{status:'no_change',authority_active:false}});expect(modelRequests).toHaveLength(0);
  expect(state.persisted[0].content).toContain('Pass aborted:');expect(state.recorded).toEqual([]);
 }finally{await pass.finish('failed').catch(()=>undefined);}
});

it('compiled v1 API seam retains a lost original closure reply without assistant persistence, renewal or redispatch',async()=>{
 const {host,pass,llm}=await admittedNativeFixture('core-lost-closure'),finish=host.finishExecution.bind(host);let finishes=0;
 host.finishExecution=async(...args:Parameters<typeof finish>)=>{finishes++;await finish(...args);throw new Error('Declared lost reply after actual closure');};
 const fixture=compiledEditor(),state=coreSeamHost(llm,pass.instanceId);modelReplies.push(nativeReply());
 await expect(fixture.runPassViaCore({host:state.host,text:'One original closure',tools:coreSourceTools,managedPass:pass})).rejects.toThrow('MANAGED_CORE_CLOSURE_UNCONFIRMED: retain core-lost-closure');
 expect(finishes).toBe(1);expect(state.persisted).toEqual([]);expect(state.recorded).toEqual([]);expect(modelRequests).toHaveLength(1);
 expect(await host.readExecution(pass.executionId)).toMatchObject({authority_active:false,status:'no_change'});
 await expect(pass.prepare([{role:'user',content:'No renewed pass'}],[],[],pass.signal)).rejects.toThrow();
});

it('compiled v1 API seam forwards Stop to a pending original worker tool and retains unconfirmed termination',async()=>{
 const {host,pass,llm}=await admittedNativeFixture('core-tool-stop'),fixture=compiledEditor(),state=coreSeamHost(llm,pass.instanceId),controller=new AbortController(),review=new ExecutionReviewController(()=>undefined,10);
 modelReplies.push(nativeReply('create_file',{filePath:'source.ts',content:'never written'}));await review.start(host,pass.executionId,pass.signal);
 const running=fixture.runPassViaCore({host:state.host,text:'Review before writing',tools:coreSourceTools,managedPass:pass,abortSignal:controller.signal});
 try{
  await vi.waitFor(()=>expect(review.view.status).toBe('pending'),{timeout:3000});controller.abort(new Error('Operator stopped pending tool'));
  const result=await running;expect(result).toMatchObject({stopReason:'aborted',execution:{status:'recovery_required',authority_active:false}});
  expect(await readFile(join(root,'source.ts'),'utf8')).toBe('source before');expect(modelRequests).toHaveLength(1);expect(state.recorded).toEqual([]);expect(state.fallbacks).toEqual([]);
 }finally{controller.abort();review.stop();await running.catch(()=>undefined);await pass.finish('cancelled').catch(()=>undefined);}
});

it('compiled v1 API streaming seam reports terminal Responses usage before closing and persisting a live answer',async()=>{
 const {pass,llm,editor}=await admittedNativeFixture('core-stream'),fixture=compiledEditor(),state=coreSeamHost(llm,pass.instanceId),chunks:string[]=[];
 editor.workspace.getConfiguration=()=>({get:(key:string)=>key==='openai.api'?'responses':undefined});
 const envelope=JSON.stringify({narrative:'Live seam 漢🙂',summary:'Observed',goal_status:'complete',progress_status:'advancing',uncertainty:'low',recommended_next_steps:[]});
 modelHandlers.push((_body,res)=>{res.writeHead(200,{'Content-Type':'text/event-stream'});
  res.end('data: '+JSON.stringify({type:'response.output_text.delta',delta:envelope})+'\n\ndata: '+JSON.stringify({type:'response.completed',response:{status:'completed',model:'gpt-4.1',usage:{input_tokens:100,output_tokens:10},output:[{type:'message',status:'completed',role:'assistant',content:[{type:'output_text',text:envelope}]}]}})+'\n\n');});
 try{
  const result=await fixture.runPassViaCore({host:state.host,text:'Stream Host context',managedPass:pass,onStreamChunk:(chunk:string)=>chunks.push(chunk)});
  expect(chunks.join('')).toContain('Live seam 漢🙂');expect(result).toMatchObject({stopReason:'complete',execution:{status:'no_change',authority_active:false}});
  expect(state.persisted[0]).toMatchObject({execution:{execution_id:pass.executionId,status:'no_change'}});expect(await nativeAttempts()).toMatchObject([{state:'settled',acknowledged:true,usage:{inputTokens:100,outputTokens:10}}]);
 }finally{await pass.finish('failed').catch(()=>undefined);}
});

it('the actual compiled native serializer reserves the whole Unicode wire before provider HTTP and reports real reply usage',async()=>{
 const {pass,llm,prepared}=await admittedNativeFixture('native-final-wire');
 try{
  modelReplies.push(nativeReply());
  const result=await pass.runModel(llm,()=>llm.callWithTools(prepared.messages,[],prepared.raw,pass.signal),pass.signal);
  expect(result.usage).toEqual({inputTokens:100,outputTokens:10});expect(modelRequests).toHaveLength(1);
  const before=Object.values(modelDispatchEvidence[0].attempts) as any[];expect(before).toHaveLength(1);
  expect(before[0]).toMatchObject({state:'dispatched',acknowledged:false,usage:null,credential_reference:'HOST_NATIVE_CREDENTIAL',resources:{input_tokens:Buffer.byteLength(JSON.stringify(modelRequests[0]),'utf8')+2048,output_tokens:16384}});
  expect(JSON.stringify(modelRequests[0])).toContain('漢🙂');expect(JSON.stringify(modelDispatchEvidence)).not.toContain('fixture-native-secret');
  expect(await nativeAttempts()).toMatchObject([{state:'settled',acknowledged:true,usage:{inputTokens:100,outputTokens:10}}]);
  expect(await pass.finish('completed')).toMatchObject({status:'no_change',authority_active:false});
 }finally{await pass.finish('failed').catch(()=>undefined);}
});

it('a known zero paid allocation refuses the compiled native provider before dispatch without inventing unsettled work',async()=>{
 const {pass,llm,prepared}=await admittedNativeFixture('native-zero');vi.stubEnv('DREAMGRAPH_LLM_ARCHITECT_RUN_BUDGET','0');
 try{
  await expect(pass.runModel(llm,()=>llm.call(prepared.messages,pass.signal),pass.signal)).rejects.toThrow('ADMISSION_ZERO_PAID_ALLOCATION');
  expect(modelRequests).toHaveLength(0);expect(pass.workTermination).toBe('confirmed');
  expect(await pass.finish('failed')).toMatchObject({status:'no_change'});
 }finally{await pass.finish('failed').catch(()=>undefined);}
});

it('a lost native permit reply cannot launch or retry through the compiled adapter',async()=>{
 const {host,pass,llm,prepared}=await admittedNativeFixture('native-lost-permit'),admit=host.admitModel.bind(host);
 host.admitModel=async request=>{await admit(request);throw new Error('Declared response loss after actual durable permit');};
 try{
  await expect(pass.runModel(llm,()=>llm.call(prepared.messages,pass.signal),pass.signal)).rejects.toThrow('ADMISSION_UNCONFIRMED');
  expect(modelRequests).toHaveLength(0);expect(await nativeAttempts()).toMatchObject([{state:'dispatched',acknowledged:false}]);
  await expect(pass.runModel(llm,()=>llm.call(prepared.messages,pass.signal),pass.signal)).rejects.toThrow('OUTCOME_UNCONFIRMED');
  expect(await pass.finish('failed')).toMatchObject({status:'recovery_required'});
 }finally{await pass.finish('failed').catch(()=>undefined);}
});

it('a lost actual native settlement report fences continuation while preserving settled usage and the original report',async()=>{
 const {host,pass,llm,prepared}=await admittedNativeFixture('native-lost-report'),settle=host.settleModel.bind(host);let originalReport:any;
 host.settleModel=async report=>{originalReport=structuredClone(report);await settle(report);throw new Error('Declared response loss after actual durable settlement');};
 try{
  modelReplies.push(nativeReply());
  await expect(pass.runModel(llm,()=>llm.call(prepared.messages,pass.signal),pass.signal)).rejects.toThrow('REPORT_REQUIRED');
  expect(modelRequests).toHaveLength(1);expect(await nativeAttempts()).toMatchObject([{state:'settled',acknowledged:true,usage:{inputTokens:100,outputTokens:10}}]);
  expect(await host.readModel(pass.executionId,originalReport.request_id)).toMatchObject({state:'host_reported',settlement:originalReport});
  await expect(pass.runModel(llm,()=>llm.call(prepared.messages,pass.signal),pass.signal)).rejects.toThrow('OUTCOME_UNCONFIRMED');
  expect(await pass.finish('failed')).toMatchObject({status:'recovery_required'});
 }finally{await pass.finish('failed').catch(()=>undefined);}
});

it('successive native requests share the original cumulative call ceiling and a refused continuation cannot reach provider HTTP',async()=>{
 const {pass,llm,prepared}=await admittedNativeFixture('native-cumulative');vi.stubEnv('DREAMGRAPH_LLM_ARCHITECT_MAX_CALLS','1');
 try{
  modelReplies.push(nativeReply());await pass.runModel(llm,()=>llm.call(prepared.messages,pass.signal),pass.signal);
  const next=await pass.prepare([{role:'user',content:'Continue using current graph context'}],[],[],pass.signal);
  await expect(pass.runModel(llm,()=>llm.call(next.messages,pass.signal),pass.signal)).rejects.toThrow('ADMISSION_REQUEST_LIMIT');
  expect(modelRequests).toHaveLength(1);expect(await nativeAttempts()).toHaveLength(1);
  expect(pass.workTermination).toBe('confirmed');expect(await pass.finish('failed')).toMatchObject({status:'no_change'});
 }finally{await pass.finish('failed').catch(()=>undefined);}
});

it('native Responses streaming remains live while admission and terminal usage stay with the original host',async()=>{
 const {pass,llm,prepared,editor}=await admittedNativeFixture('native-responses-live');
 editor.workspace.getConfiguration=()=>({get:(key:string)=>key==='openai.api'?'responses':undefined});
 let terminal!:()=>void,received!:()=>void;const release=new Promise<void>(done=>terminal=done),chunk=new Promise<void>(done=>received=done);const previews:string[]=[];
 const envelope=JSON.stringify({narrative:'Live Unicode 漢🙂',summary:'Observed',goal_status:'complete',progress_status:'advancing',uncertainty:'low',recommended_next_steps:[]});
 modelHandlers.push(async(body,res)=>{expect(body).toMatchObject({stream:true,store:false,max_output_tokens:16384});res.writeHead(200,{'Content-Type':'text/event-stream'});
  const delta=Buffer.from('data: '+JSON.stringify({type:'response.output_text.delta',delta:envelope})+'\n\n');res.write(delta.subarray(0,Math.floor(delta.length/2)));res.write(delta.subarray(Math.floor(delta.length/2)));await release;
  res.end('data: '+JSON.stringify({type:'response.completed',response:{status:'completed',model:'gpt-4.1',usage:{input_tokens:110,output_tokens:20},output:[{type:'message',status:'completed',role:'assistant',content:[{type:'output_text',text:envelope}]}]}})+'\n\n');});
 let ended=false;const result=pass.runModel(llm,()=>llm.stream(prepared.messages,(value:string)=>{previews.push(value);received();},pass.signal),pass.signal).finally(()=>ended=true);
 try{
  await Promise.race([chunk,new Promise((_,reject)=>setTimeout(()=>reject(new Error('No live preview')),3000))]);expect(ended).toBe(false);expect(previews.join('')).toContain('Live Unicode 漢🙂');
  expect(await nativeAttempts()).toMatchObject([{state:'dispatched',acknowledged:false}]);terminal();
  expect((await result).usage).toEqual({inputTokens:110,outputTokens:20});expect(await nativeAttempts()).toMatchObject([{state:'settled',acknowledged:true}]);
  expect(await pass.finish('completed')).toMatchObject({status:'no_change'});
 }finally{terminal();await result.catch(()=>undefined);await pass.finish('failed').catch(()=>undefined);}
});

it('an actual native stream ending without provider completion retains uncertainty and never authorizes another request',async()=>{
 const {pass,llm,prepared,editor}=await admittedNativeFixture('native-missing-terminal');
 editor.workspace.getConfiguration=()=>({get:(key:string)=>key==='openai.api'?'responses':undefined});
 modelHandlers.push((_body,res)=>{res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({type:'response.output_text.delta',delta:'partial'})+'\n\ndata: [DONE]\n\n');});
 try{
  await expect(pass.runModel(llm,()=>llm.stream(prepared.messages,()=>{},pass.signal),pass.signal)).rejects.toThrow('PROVIDER_INCOMPLETE');
  expect(await nativeAttempts()).toMatchObject([{state:'uncertain',acknowledged:false}]);expect(pass.workTermination).toBe('unconfirmed');
  await expect(pass.prepare([{role:'user',content:'Do not redispatch'}],[],[],pass.signal)).rejects.toThrow('OUTCOME_UNCONFIRMED');
  expect(await pass.finish('failed')).toMatchObject({status:'recovery_required'});
 }finally{await pass.finish('failed').catch(()=>undefined);}
});

it('native local streaming handles fragmented NDJSON and reports local usage only after an explicit completion',async()=>{
 const {pass,llm,prepared}=await admittedNativeFixture('native-local-fragments','ollama');const previews:string[]=[];
 modelHandlers.push((body,res)=>{expect(body.options.num_predict).toBe(8192);res.writeHead(200,{'Content-Type':'application/x-ndjson'});
  const data=Buffer.from(JSON.stringify({message:{content:'Local 漢🙂'},done:false})+'\n'+JSON.stringify({done:true,prompt_eval_count:31,eval_count:7,done_reason:'stop'})+'\n');
  res.write(data.subarray(0,9));res.end(data.subarray(9));});
 try{
  const result=await pass.runModel(llm,()=>llm.stream(prepared.messages,(value:string)=>previews.push(value),pass.signal),pass.signal);
  expect(result.content).toContain('Local 漢🙂');expect(previews.join('')).toBe('Local 漢🙂');expect(result.usage).toEqual({inputTokens:31,outputTokens:7});
  // Local model reasoning-token accounting is unavailable; the known work can close while that reservation remains held.
  expect(await nativeAttempts()).toMatchObject([{channel:'local',state:'uncertain',acknowledged:true,usage:{inputTokens:31,outputTokens:7}}]);
  expect(await pass.finish('completed')).toMatchObject({status:'no_change'});
 }finally{await pass.finish('failed').catch(()=>undefined);}
});

it('native Anthropic messages retain the selected model, finite output and actual terminal usage without transporting credentials to the daemon',async()=>{
 const {pass,llm,prepared}=await admittedNativeFixture('native-anthropic','anthropic');
 modelReplies.push(body=>{expect(body).toMatchObject({model:'claude-haiku-4-5',max_tokens:8192});return {model:body.model,stop_reason:'end_turn',content:[{type:'text',text:'Evidence retained.'}],usage:{input_tokens:42,output_tokens:12}};});
 try{
  expect((await pass.runModel(llm,()=>llm.call(prepared.messages,pass.signal),pass.signal)).usage).toEqual({inputTokens:42,outputTokens:12});
  expect(await nativeAttempts()).toMatchObject([{provider:'anthropic',model:'claude-haiku-4-5',state:'settled',acknowledged:true}]);
  expect(JSON.stringify(modelDispatchEvidence)).not.toContain('fixture-native-secret');expect(await pass.finish('completed')).toMatchObject({status:'no_change'});
 }finally{await pass.finish('failed').catch(()=>undefined);}
});

it('a native 429 is a known request rejection while a disallowed explicit retry remains fenced before another provider request',async()=>{
 const {pass,llm,prepared}=await admittedNativeFixture('native-retry-ceiling');
 modelHandlers.push((_body,res)=>{res.writeHead(429,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'Declared rate limit'}}));});
 try{
  await expect(pass.runModel(llm,()=>llm.callWithTools(prepared.messages,[],prepared.raw,pass.signal),pass.signal)).rejects.toThrow('429');
  expect(pass.workTermination).toBe('confirmed');expect(await nativeAttempts()).toMatchObject([{state:'uncertain',acknowledged:true,usage:null}]);
  const next=await pass.prepare([{role:'user',content:'Retry explicitly'}],[],[],pass.signal);
  await expect(pass.runModel(llm,()=>llm.callWithTools(next.messages,[],next.raw,pass.signal,true),pass.signal)).rejects.toThrow('ADMISSION_RETRY_LIMIT');
  expect(modelRequests).toHaveLength(1);expect(pass.workTermination).toBe('confirmed');expect(await pass.finish('failed')).toMatchObject({status:'no_change'});
 }finally{await pass.finish('failed').catch(()=>undefined);}
});

it('native API cancellation stops the host wait without claiming a still-running provider fixture terminated',async()=>{
 const {pass,llm,prepared,editor}=await admittedNativeFixture('native-cancel-live');editor.workspace.getConfiguration=()=>({get:(key:string)=>key==='openai.api'?'responses':undefined});
 const round=new AbortController();let release!:()=>void,preview!:()=>void,finished=false;
 const waiting=new Promise<void>(done=>release=done),visible=new Promise<void>(done=>preview=done);let handlerFinished!:()=>void;const done=new Promise<void>(resolve=>handlerFinished=resolve);
 modelHandlers.push(async(_body,res)=>{try{res.writeHead(200,{'Content-Type':'text/event-stream'});res.write('data: '+JSON.stringify({type:'response.output_text.delta',delta:'{"narrative":"partial'})+'\n\n');await waiting;res.end();}finally{finished=true;handlerFinished();}});
 const work=pass.runModel(llm,()=>llm.stream(prepared.messages,()=>preview(),round.signal),round.signal).catch((error:unknown)=>error);
 try{
  await Promise.race([visible,new Promise((_,reject)=>setTimeout(()=>reject(new Error('No cancellable native preview')),3000))]);round.abort(new Error('Declared native operator cancellation'));expect(String(await work)).toContain('operator cancellation');expect(finished).toBe(false);
  expect(pass.signal.aborted).toBe(false);expect(pass.workTermination).toBe('unconfirmed');
  await vi.waitFor(async()=>expect(await nativeAttempts()).toMatchObject([{state:'uncertain',acknowledged:false}]),{timeout:3000});
  expect(await pass.finish('cancelled')).toMatchObject({status:'recovery_required'});expect(finished).toBe(false);
 }finally{release();await done;await work;await pass.finish('failed').catch(()=>undefined);}
});

it('an oversized native provider response is refused whole with unknown liability and cannot resume model dispatch',async()=>{
 const {pass,llm,prepared}=await admittedNativeFixture('native-response-bound');
 modelHandlers.push((_body,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end('x'.repeat(8*1024*1024+1));});
 try{
  await expect(pass.runModel(llm,()=>llm.call(prepared.messages,pass.signal),pass.signal)).rejects.toThrow('NATIVE_MODEL_RESPONSE_UTF8_BYTE_BOUND');
  expect(await nativeAttempts()).toMatchObject([{state:'uncertain',acknowledged:false}]);expect(pass.workTermination).toBe('unconfirmed');
  expect(await pass.finish('failed')).toMatchObject({status:'recovery_required'});expect(modelRequests).toHaveLength(1);
 }finally{await pass.finish('failed').catch(()=>undefined);}
});

it('the production native model guard refuses all bare API methods before provider dispatch',async()=>{
 const {pass,llm,prepared}=await admittedNativeFixture('native-required-scope');llm.requireModelAdmission();
 try{
  await expect(llm.call(prepared.messages)).rejects.toThrow('MANAGED_SCOPE_REQUIRED');
  await expect(llm.stream(prepared.messages,()=>{})).rejects.toThrow('MANAGED_SCOPE_REQUIRED');
  await expect(llm.callWithTools(prepared.messages,[],prepared.raw)).rejects.toThrow('MANAGED_SCOPE_REQUIRED');
  expect(modelRequests).toHaveLength(0);expect(await pass.finish('failed')).toMatchObject({status:'no_change'});
 }finally{await pass.finish('failed').catch(()=>undefined);}
});

it('the compiled read-only model helper supplies whole fresh graph context and closes its original host scope',async()=>{
 const {host,pass,llm}=await admittedNativeFixture('native-readonly-probe');await pass.finish('completed');llm.requireModelAdmission();
 const helper=compiledEditor().managedReadOnlyModel;modelReplies.push(nativeReply());
 const result=await helper(host,llm,[{role:'user',content:'Explain Host context with provenance'}],(messages:any,signal:AbortSignal)=>llm.call(messages,signal),{id:'native-readonly-call',expectedInstance:pass.instanceId});
 expect(result.response.usage).toEqual({inputTokens:100,outputTokens:10});expect(result.execution).toMatchObject({execution_id:'native-readonly-call',status:'no_change',authority_active:false,pack:{receipt:{delivery:'delivered'}}});
 expect(JSON.stringify(modelRequests[0])).toContain(JSON.stringify(result.execution.block).slice(1,-1));expect(await nativeAttempts()).toMatchObject([{state:'settled',acknowledged:true}]);
});

it('read-only native admission refuses a changed selected instance before provider dispatch',async()=>{
 const {host,pass,llm}=await admittedNativeFixture('native-readonly-owner-probe');await pass.finish('completed');const helper=compiledEditor().managedReadOnlyModel;
 await expect(helper(host,llm,[{role:'user',content:'Host context'}],()=>{throw new Error('must not invoke');},{id:'native-readonly-foreign',expectedInstance:'another-instance'})).rejects.toThrow('INSTANCE_CHANGED');
 expect(modelRequests).toHaveLength(0);expect(await host.readExecution('native-readonly-foreign')).toMatchObject({status:'no_change',authority_active:false});
});

it('a read-only native admission acknowledgement loss retains the exact original identity and cannot call the provider',async()=>{
 const {host,pass,llm}=await admittedNativeFixture('native-readonly-lost-probe');await pass.finish('completed');const begin=host.beginExecution.bind(host),helper=compiledEditor().managedReadOnlyModel;
 host.beginExecution=async request=>{await begin(request);throw new Error('Declared original lease reply loss');};
 await expect(helper(host,llm,[{role:'user',content:'Host context'}],()=>{throw new Error('must not invoke');},{id:'native-readonly-lost'})).rejects.toThrow('retain native-readonly-lost');
 expect(modelRequests).toHaveLength(0);expect(await host.readExecution('native-readonly-lost')).toMatchObject({status:'assembled',authority_active:true});
 // The fixture proves no provider callback entered; this explicit cleanup is not helper recovery or redispatch.
 await host.finishExecution('native-readonly-lost','failed','confirmed');
});

it('an uncertain managed timeout cannot silently spend through a fresh recovery stream',async()=>{
 const fixture=compiledEditor(),panel=new fixture.ChatPanel({});panel.setArchitectLlm(new fixture.ArchitectLlm({}));panel.architectLlm._config={provider:'openai',model:'gpt-4.1',baseUrl:`http://127.0.0.1:${port}/v1`,apiKey:'fixture'};
 const events:any[]=[];panel.postMessage=async(value:any)=>events.push(value);
 const before=await loadPublicationState();
 expect(await panel._recoverFromLlmTimeout(new Error('MANAGED_NATIVE_RECOVERY_REQUIRED: original model timeout'),'Host context',null)).toBe(false);
 expect(modelRequests).toHaveLength(0);expect(events).toHaveLength(0);expect((await loadPublicationState()).publication_sequence).toBe(before.publication_sequence);panel.dispose();
});

async function commandModelFixture() {
 const {host,pass,llm}=await admittedNativeFixture('native-command-probe');await pass.finish('completed');llm.requireModelAdmission();
 const fixture=compiledEditor(),messages:any[]=[],errors:string[]=[];let selected=pass.instanceId;
 fixture.editor.ProgressLocation={Notification:1};fixture.editor.window.activeTextEditor={document:{uri:{fsPath:join(root,'source.ts')}}};
 fixture.editor.window.withProgress=async(_options:any,work:any)=>work({}, {isCancellationRequested:false,onCancellationRequested:()=>({dispose(){}})});fixture.editor.window.showErrorMessage=async(message:string)=>errors.push(message);
 const envelope={workspaceRoot:root,instanceId:pass.instanceId,activeFile:null,visibleFiles:[],changedFiles:[],pinnedFiles:[],environmentContext:null,graphContext:null,intentMode:'assess',intentConfidence:1};
 const svc={daemonClient:host,architectLlm:llm,getInstance:()=>({uuid:selected}),
  contextBuilder:{buildEnvelope:async()=>envelope,buildReasoningPacket:async()=>({tokenUsage:{used:1,budget:1000}}),renderReasoningPacket:()=>({text:'Declared old context packet; current graph receipt must supersede it.'})},
  chatPanel:{isVisible:true,addExternalMessage:(role:string,content:string)=>messages.push({role,content})},contextInspector:{showRawOutput:()=>{}}};
 return {fixture,svc,messages,errors,setSelected:(value:string)=>selected=value};
}

it('compiled Explain File and ADR Compliance use the same original host graph/model authority',async()=>{
 const {fixture,svc,messages,errors}=await commandModelFixture();modelReplies.push(nativeReply(),nativeReply());
 await fixture.explainFileCommand(svc);await fixture.checkAdrComplianceCommand(svc);
 expect(errors).toEqual([]);expect(messages.filter(value=>value.role==='assistant')).toHaveLength(2);expect(modelRequests).toHaveLength(2);
 for(const body of modelRequests)expect(JSON.stringify(body)).toContain('DreamGraph required execution context');
 expect(await nativeAttempts()).toMatchObject([{state:'settled',acknowledged:true},{state:'settled',acknowledged:true}]);
});

it('compiled command authority is captured before asynchronous context reads and refuses changed selection without inference',async()=>{
 const {fixture,svc,errors,setSelected}=await commandModelFixture(),read=svc.contextBuilder.buildEnvelope;
 svc.contextBuilder.buildEnvelope=async()=>{const envelope=await read();setSelected('changed-selected-instance');return envelope;};
 await fixture.explainFileCommand(svc);expect(errors).toHaveLength(1);expect(errors[0]).toContain('OWNER_CHANGED');expect(modelRequests).toHaveLength(0);
});

it('compiled native commands honour an already-cancelled progress token before context or paid work starts',async()=>{
 const {fixture,svc,messages,errors}=await commandModelFixture();let envelopes=0,disposed=0;const build=svc.contextBuilder.buildEnvelope;
 svc.contextBuilder.buildEnvelope=async()=>{envelopes++;return build();};
 fixture.editor.window.withProgress=async(options:any,work:any)=>{expect(options.cancellable).toBe(true);return work({},
  {isCancellationRequested:true,onCancellationRequested:()=>({dispose(){disposed++;}})});};
 await fixture.explainFileCommand(svc);await fixture.checkAdrComplianceCommand(svc);
 expect(envelopes).toBe(0);expect(modelRequests).toHaveLength(0);expect(messages).toEqual([]);expect(errors).toEqual([]);expect(disposed).toBe(2);
});
it('compiled command Cancel propagates to native HTTP and cannot publish a successful answer or confirm remote termination',async()=>{
 const {fixture,svc,messages,errors}=await commandModelFixture();let cancel!:()=>void,enter!:()=>void,release!:()=>void,disposed=0;
 const entered=new Promise<void>(resolve=>enter=resolve),held=new Promise<void>(resolve=>release=resolve);
 fixture.editor.window.withProgress=async(options:any,work:any)=>{expect(options.cancellable).toBe(true);return work({},
  {isCancellationRequested:false,onCancellationRequested:(handler:()=>void)=>{cancel=handler;return {dispose(){disposed++;}};}});};
 modelHandlers.push(async(_body,res)=>{enter();await held;if(!res.destroyed){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(nativeReply()({})));}});
 try{const command=fixture.explainFileCommand(svc);await entered;cancel();await command;
  expect(messages.filter(value=>value.role==='assistant')).toHaveLength(0);expect(errors).toHaveLength(1);expect(disposed).toBe(1);
  expect(await nativeAttempts()).toMatchObject([{acknowledged:false,state:'uncertain'}]);expect(modelRequests).toHaveLength(1);
 }finally{release?.();}
});

const cliInvocationBinding=(adapter:'codex-cli'|'copilot-cli')=>({provider:'none' as const,model:'auto',adapter,api:'native_cli' as const,
 base_url:'',effort:null,retention:'provider_default' as const,strict_schema:false,output_tokens:8192});
const successfulNativeObservation={ok:true,spawn:{exitCode:0,signal:null,timedOut:false,aborted:false}};
function nativeCliAllocation() {
 hostModelAllocation();vi.stubEnv('DREAMGRAPH_LLM_ARCHITECT_BUDGET_CURRENCY','subscription_units');
 vi.stubEnv('DREAMGRAPH_LLM_ARCHITECT_RUN_BUDGET','0');vi.stubEnv('DREAMGRAPH_LLM_ARCHITECT_DAY_BUDGET','0');
}
it('native CLI prompt reserves original invocation liability with unclaimed API provenance and unmeasured usage',async()=>{
 nativeCliAllocation();const host=client(),pass=await ManagedCliPass.begin(host,{id:'cli-admitted',adapter:'vscode/copilot-cli',query:'Host context'});
 const whole=await pass.admitPrompt('Unicode 漢🌿',cliInvocationBinding('copilot-cli'));
 expect(whole).toContain((await host.readExecution(pass.executionId)).block);expect(whole).not.toContain(pass.workerBearer);
 expect(await nativeAttempts()).toMatchObject([{provider:'none',model:'auto',channel:'subscription',state:'dispatched',acknowledged:false,usage:null}]);
 expect(pass.admissionSignal?.aborted).toBe(false);await expect(pass.admitPrompt('duplicate',cliInvocationBinding('copilot-cli'))).rejects.toThrow('RECOVERY_REQUIRED');
 await pass.settleRun(successfulNativeObservation);expect(await nativeAttempts()).toMatchObject([{state:'uncertain',acknowledged:true,charge_source:'unmeasured_subscription',usage:null}]);
 expect(await pass.finish()).toMatchObject({status:'no_change',authority_active:false});expect(modelRequests).toHaveLength(0);
});
it('native CLI continues under the same cumulative ledger, never a fresh allocation after each prompt',async()=>{
 nativeCliAllocation();vi.stubEnv('DREAMGRAPH_LLM_ARCHITECT_MAX_CALLS','1');const host=client(),pass=await ManagedCliPass.begin(host,{id:'cli-one-call',adapter:'vscode/codex-cli',query:'Host context'});
 await pass.admitPrompt('First',cliInvocationBinding('codex-cli'));await pass.settleRun(successfulNativeObservation);
 await expect(pass.admitPrompt('Second',cliInvocationBinding('codex-cli'))).rejects.toThrow('REQUEST_LIMIT');expect(await nativeAttempts()).toHaveLength(1);
 expect(await pass.finish()).toMatchObject({status:'no_change'});
});
it('lost native CLI permit acknowledgement cannot allocate a replacement or confirm closure',async()=>{
 nativeCliAllocation();const host=client(),admit=host.admitModel.bind(host);host.admitModel=async(input,signal)=>{await admit(input,signal);throw new Error('Declared CLI permit loss');};
 const pass=await ManagedCliPass.begin(host,{id:'cli-lost-permit',adapter:'vscode/codex-cli',query:'Host context'});
 await expect(pass.admitPrompt('Original',cliInvocationBinding('codex-cli'))).rejects.toThrow('ADMISSION_UNCONFIRMED');
 await expect(pass.admitPrompt('Replacement',cliInvocationBinding('codex-cli'))).rejects.toThrow('RECOVERY_REQUIRED');
 expect(await nativeAttempts()).toHaveLength(1);expect(await pass.finish()).toMatchObject({status:'recovery_required',authority_active:false});
});
it('native CLI cancellation/report loss retains original liability and cannot strengthen descendant termination',async()=>{
 nativeCliAllocation();const host=client(),pass=await ManagedCliPass.begin(host,{id:'cli-termination',adapter:'vscode/copilot-cli',query:'Host context'});
 await pass.admitPrompt('Original',cliInvocationBinding('copilot-cli'));
 const report=host.settleModel.bind(host);host.settleModel=async value=>{await report(value);throw new Error('Declared CLI report loss');};
 await expect(pass.settleRun({ok:false,failure:{preSpawn:false},spawn:{exitCode:null,signal:'SIGTERM',timedOut:false,aborted:true}})).rejects.toThrow('SETTLEMENT_UNCONFIRMED');
 await expect(pass.admitPrompt('Fresh',cliInvocationBinding('copilot-cli'))).rejects.toThrow('RECOVERY_REQUIRED');
 host.settleModel=report;expect(await pass.finish(true)).toMatchObject({status:'recovery_required'});expect(await nativeAttempts()).toMatchObject([{acknowledged:false,state:'uncertain'}]);
});
it('native CLI enforces its shorter core permit deadline without proving native work stopped',async()=>{
 // Real disk/HTTP admission must finish before testing the admitted permit's
 // deadline. This remains much shorter than the original five-minute host lease.
 nativeCliAllocation();vi.stubEnv('DREAMGRAPH_LLM_ARCHITECT_TIMEOUT_MS','2000');const host=client(),pass=await ManagedCliPass.begin(host,{id:'cli-deadline',adapter:'vscode/codex-cli',query:'Host context'});
 await pass.admitPrompt('Original',cliInvocationBinding('codex-cli'));const signal=pass.admissionSignal!;
 await vi.waitFor(()=>expect(signal.aborted).toBe(true),{timeout:3000});
 expect(await pass.finish()).toMatchObject({status:'recovery_required'});expect(await nativeAttempts()).toMatchObject([{acknowledged:false,state:'uncertain'}]);
});
it('native API still refuses an unresolved provider despite the CLI binding amendment',async()=>{
 const {host,request}=await hostModelFixture('api-provider-required');
 await expect(host.admitModel({...request,binding:{...request.binding,provider:'none'}})).rejects.toThrow('API_PROVIDER_REQUIRED');
 expect(modelRequests).toHaveLength(0);expect(await host.finishExecution(request.execution_id,'failed','confirmed')).toMatchObject({status:'no_change'});
});
it('compiled native CLI option builders require the original pass and await its model reservation and report',async()=>{
 nativeCliAllocation();const host=client(),fixture=compiledEditor();fixture.editor.Uri.joinPath=(uri:any,...parts:string[])=>({fsPath:join(uri.fsPath,...parts)});
 const panel=new fixture.ChatPanel({globalStorageUri:{fsPath:root},extensionUri:{fsPath:root}});panel.mcpClient={mcpUrl:`http://127.0.0.1:${port}/mcp`};
 try{for(const adapter of ['codex-cli','copilot-cli'] as const){
  panel.setArchitectLlm({provider:adapter,currentConfig:{model:'auto'}});const build=adapter==='codex-cli'?panel._buildCodexCliProviderOptions.bind(panel):panel._buildCopilotCliProviderOptions.bind(panel);
  expect(()=>build()).toThrow('MANAGED_CLI_PASS_REQUIRED');const pass=await ManagedCliPass.begin(host,{id:'compiled-'+adapter,adapter:'vscode/'+adapter,query:'Host context'}),options=build(pass);
  expect(options.model).toBeUndefined();const prompt=await options.preparePrompt('Captured native prompt');expect(prompt).toContain((await host.readExecution(pass.executionId)).block);
  expect(options.admissionSignal()).toBe(pass.admissionSignal);await options.settleRun(successfulNativeObservation);expect(await pass.finish()).toMatchObject({status:'no_change'});
 }expect(await nativeAttempts()).toMatchObject([{provider:'none',model:'auto',charge_source:'unmeasured_subscription'},{provider:'none',model:'auto',charge_source:'unmeasured_subscription'}]);}
 finally{panel.dispose();}
});

async function sdkModelFixture(id:string,decorate?:(host:ManagedExecutionClient)=>void){
 hostModelAllocation();const host=sdkHost();decorate?.(host);const pass=new ManagedGraphPass(host,{id,adapter:'sdk/native_api',query:'Host context'});
 await pass.begin();let block='';await pass.prepare(async context=>{block=context.block;return wholeHandoff(context);});
 const request={request_id:id+':call',binding:{provider:'openai' as const,model:'gpt-4.1',adapter:'native_api' as const,api:'chat_completions' as const,
  base_url:`http://127.0.0.1:${port}/v1`,output_tokens:100},payload:JSON.stringify({model:'gpt-4.1',max_tokens:100,messages:[{role:'user',content:block+'\nUnicode 漢🌿'}]}),output_tokens:100};
 return {host,pass,request};
}
it('portable SDK model execution reserves before actual native HTTP and reports observed protocol usage under the same graph pass',async()=>{
 const {host,pass,request}=await sdkModelFixture('sdk-native-http');vi.stubEnv('DREAMGRAPH_LLM_ARCHITECT_MAX_CALLS','1');modelReplies.push(nativeReply());
 try{const response=await pass.runModel(request,async worker=>{
  expect(worker.permit.billing_channel).toBe('api');expect(worker.request.payload).toBe(request.payload);
  const reply=await fetch(worker.request.binding.base_url+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json'},body:worker.request.payload,signal:worker.signal}).then(response=>response.json());
  expect(reply.choices[0].finish_reason).toBe('stop');return {result:reply.choices[0].message.content,acknowledged:true,workTermination:'confirmed',usage:{inputTokens:reply.usage.prompt_tokens,outputTokens:reply.usage.completion_tokens}};
 });expect(JSON.parse(response).narrative).toBe('Source observed and context retained.');expect(modelDispatchEvidence[0].attempts).toMatchObject({[Object.keys(modelDispatchEvidence[0].attempts)[0]]:{state:'dispatched',acknowledged:false}});
  expect(await nativeAttempts()).toMatchObject([{acknowledged:true,state:'settled'}]);expect(pass.workTermination).toBe('confirmed');
  await pass.prepare(async context=>{request.payload=JSON.stringify({model:'gpt-4.1',max_tokens:100,messages:[{role:'user',content:context.block+'\nRefreshed next request'}]});return wholeHandoff(context);});
  await expect(pass.runModel({...request,request_id:'sdk-second'},async()=>{throw new Error('must not launch');})).rejects.toThrow('REQUEST_LIMIT');
  expect(modelRequests).toHaveLength(1);expect(pass.workTermination).toBe('confirmed');expect(await pass.finish('completed')).toMatchObject({status:'no_change'});
 }finally{await pass.finish('completed').catch(()=>undefined);host.dispose();}
});
it('portable SDK lost model admission keeps original inspection and never invokes a replacement callback',async()=>{
 let dispatched=0;const {host,pass,request}=await sdkModelFixture('sdk-native-lost',host=>{const admit=host.admitModel.bind(host);host.admitModel=async(...args)=>{await admit(...args);throw new Error('Declared native permit acknowledgement loss');};});
 try{await expect(pass.runModel(request,async()=>{dispatched++;return {result:'must not run',acknowledged:true,workTermination:'confirmed'};})).rejects.toThrow('retain sdk-native-lost/sdk-native-lost:call');
  expect(dispatched).toBe(0);expect(await pass.inspectModel()).toMatchObject({state:'awaiting_host',request_id:request.request_id});
  await expect(pass.prepare(wholeHandoff)).rejects.toThrow('NOT_READY');expect(await nativeAttempts()).toHaveLength(1);
  expect(await pass.finish('failed')).toMatchObject({status:'recovery_required'});
 }finally{await pass.finish('failed').catch(()=>undefined);host.dispose();}
});
it('portable SDK report loss permits exact report recovery without a stronger termination claim or new request',async()=>{
 let lose=true;const reports:any[]=[];const {host,pass,request}=await sdkModelFixture('sdk-native-report',host=>{const settle=host.settleModel.bind(host);host.settleModel=async report=>{reports.push(structuredClone(report));const result=await settle(report);if(lose)throw new Error('Declared original report reply loss');return result;};});
 try{await expect(pass.runModel(request,async()=>({result:'Declared native work termination; no paid provider',acknowledged:true,workTermination:'confirmed',usage:{inputTokens:10,outputTokens:5}}))).rejects.toThrow('reply loss');
  expect((await pass.inspectModel()).state).toBe('host_reported');lose=false;expect((await pass.retryModelReport()).state).toBe('host_reported');expect(reports[1]).toEqual(reports[0]);
  expect(pass.workTermination).toBe('unconfirmed');expect(await nativeAttempts()).toHaveLength(1);await expect(pass.prepare(wholeHandoff)).rejects.toThrow('NOT_READY');
  expect(await pass.finish('failed')).toMatchObject({status:'recovery_required'});
 }finally{await pass.finish('failed').catch(()=>undefined);host.dispose();}
});
it('portable SDK model timeout rejects waiting while its declared noncooperative callback remains running',async()=>{
 // Admission persists the permit before dispatch. Allow that real I/O to finish
 // before this fixture exercises a held callback's expiry, even on a busy host.
 const {host,pass,request}=await sdkModelFixture('sdk-native-timeout');vi.stubEnv('DREAMGRAPH_LLM_ARCHITECT_TIMEOUT_MS','2000');
 let entered!:()=>void,release!:()=>void,finished=false;const started=new Promise<void>(resolve=>entered=resolve),held=new Promise<void>(resolve=>release=resolve);
 try{const outcome=pass.runModel(request,async()=>{entered();await held;finished=true;return {result:'late callback',acknowledged:true,workTermination:'confirmed'};}).catch(error=>error);
  // An early admission failure must fail visibly, never hang awaiting a callback
  // that could not start. The real permit deadline still cancels the held work.
  await Promise.race([started,outcome.then(error=>{throw error;})]);
  expect(await outcome).toBeInstanceOf(Error);expect(finished).toBe(false);expect(pass.workTermination).toBe('unconfirmed');
  const firstReport=(await pass.inspectModel()).settlement;expect(firstReport).toMatchObject({work_termination:'unconfirmed',acknowledged:false});expect(await pass.finish('failed')).toMatchObject({status:'recovery_required'});
  release();await vi.waitFor(()=>expect(finished).toBe(true));expect(pass.workTermination).toBe('unconfirmed');
  // Closed authority retains the first whole durable report and cannot promote the late successful callback.
  expect(await pass.inspectModel()).toMatchObject({state:'unknown',permit:null,settlement:firstReport});
 }finally{release?.();await pass.finish('failed').catch(()=>undefined);host.dispose();}
});
it('portable SDK rejects successful prose without explicit provider observation and preserves unknown work',async()=>{
 const {host,pass,request}=await sdkModelFixture('sdk-native-prose');
 try{await expect(pass.runModel(request,async()=>({result:'Everything done'}) as any)).rejects.toThrow('OBSERVATION_REQUIRED');
  expect(pass.workTermination).toBe('unconfirmed');expect((await pass.inspectModel()).settlement).toMatchObject({usage:null,acknowledged:false,work_termination:'unconfirmed'});
  expect(await pass.finish('failed')).toMatchObject({status:'recovery_required'});
 }finally{await pass.finish('failed').catch(()=>undefined);host.dispose();}
});
it('portable SDK callback gets the captured final request despite mutation during asynchronous admission',async()=>{
 let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(resolve=>enter=resolve),held=new Promise<void>(resolve=>release=resolve);
 const {host,pass,request}=await sdkModelFixture('sdk-native-captured',host=>{const admit=host.admitModel.bind(host);host.admitModel=async value=>{enter();await held;return admit(value);};});
 try{const original=request.payload,outcome=pass.runModel(request,async worker=>{expect(worker.request.payload).toBe(original);expect(worker.request.binding.model).toBe('gpt-4.1');return {result:'Captured native fixture',workTermination:'confirmed',acknowledged:true};});
  await entered;request.payload='changed';request.binding.model='gpt-4.1-mini';release();expect(await outcome).toBe('Captured native fixture');expect(await pass.finish('completed')).toMatchObject({status:'no_change'});
 }finally{release?.();await pass.finish('completed').catch(()=>undefined);host.dispose();}
});
