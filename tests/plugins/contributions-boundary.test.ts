/** Actual manager, MCP transport and shared wire boundary; plugin work/results are declared doubles. */
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {z} from 'zod';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {configureToolBoundary} from '../../src/server/server.js';
import {issueExecutionPolicy} from '../../src/server/execution-policy.js';
import {_resetPluginManagerForTest,bootstrapPlugins,getContributedTools,getContributedResources,unloadPluginById} from '../../src/plugins/manager.js';
import {registerPluginContributions} from '../../src/plugins/contributions.js';
import {graphEventBus,type GraphEvent} from '../../src/graph/events.js';
import * as lifecycle from '../../src/instance/lifecycle.js';
import {InstanceScope} from '../../src/instance/scope.js';
import {getDataDir,setDataDirOverride} from '../../src/utils/paths.js';
import {releaseGraphWriter} from '../../src/graph/writer-lease.js';

const uuid='11111111-2222-3333-4444-ffffffffffff',id='fixture.boundary',toolName='fixture_boundary_effect',uri='plugin://fixture.boundary/evidence';
let root:string,previous:string,oldAllow:string|undefined;
const connections:Array<{server:McpServer;client:Client}>=[],events:GraphEvent[]=[];let unsubscribe:()=>void;
beforeEach(async()=>{
 _resetPluginManagerForTest();previous=getDataDir();oldAllow=process.env.DG_ALLOW_INPROCESS_PLUGINS;process.env.DG_ALLOW_INPROCESS_PLUGINS='true';
 root=await mkdtemp(join(tmpdir(),'dg-plugin-boundary-'));const plugin=join(root,uuid,'plugins',id);
 await mkdir(plugin,{recursive:true});await mkdir(join(root,uuid,'data'),{recursive:true});setDataDirOverride(join(root,uuid,'data'));
 await writeFile(join(root,uuid,'instance.json'),JSON.stringify({uuid,name:'fixture',plugins:[{path:'./plugins/'+id,trusted:true}]}));
 await writeFile(join(plugin,'plugin.json'),JSON.stringify({id,version:'1.0.0',displayName:'Boundary fixture',engine:{dreamgraph:'>=13.4.0'},main:'./index.mjs',intent:'Qualify host-mediated results and cancellation',capabilities:['tools:register','resources:register'],expectedEffects:['emit_tool','emit_resource'],tools:[{name:toolName}],resources:[{uriNamespace:uri}]}));
 await writeFile(join(plugin,'index.mjs'),`export function activate(ctx){globalThis.__ashokaBoundaryUnregister=ctx.tools.register({name:'${toolName}',description:'Declared fixture',inputSchema:{},expectedEffects:['emit_tool'],handler:()=>({ok:true})});ctx.resources.register({uriNamespace:'${uri}',name:'Evidence',expectedEffects:['emit_resource'],handler:()=>({ok:true})});}`);
 vi.spyOn(lifecycle,'getActiveScope').mockReturnValue(new InstanceScope(uuid,root));
 unsubscribe=graphEventBus.subscribe(event=>{if(event.kind.startsWith('plugin.handler.'))events.push(event);});await bootstrapPlugins();
});
afterEach(async()=>{
 await unloadPluginById(id);for(const connection of connections.splice(0)){await connection.client.close();await connection.server.close();}
 unsubscribe();events.splice(0);delete(globalThis as any).__ashokaBoundaryUnregister;
 _resetPluginManagerForTest();vi.restoreAllMocks();if(oldAllow===undefined)delete process.env.DG_ALLOW_INPROCESS_PLUGINS;else process.env.DG_ALLOW_INPROCESS_PLUGINS=oldAllow;
 await releaseGraphWriter(getDataDir());setDataDirOverride(previous);await rm(root,{recursive:true,force:true});
});
async function connect(server=new McpServer({name:'actual-plugin-boundary',version:'1'})){
 configureToolBoundary(server);registerPluginContributions(server);const client=new Client({name:'actual-plugin-client',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();
 connections.push({server,client});await server.connect(a);await client.connect(b);return client;
}
const completed=()=>events.filter(event=>event.kind==='plugin.handler.completed');

it('retains complete MCP errors/media/structured receipts and records failure rather than successful prose',async()=>{
 const owner={isError:true,content:[{type:'text',text:'Literal owner failure'}, {type:'image',mimeType:'image/png',data:'AA=='}],structuredContent:{receipt:{operation_id:'original-owner',revision:7},error:{code:'DECLARED_FAILURE'}},_meta:{owner_provenance:'fixture'}};
 getContributedTools()[0].definition.handler=()=>owner;const client=await connect(),result=await client.callTool({name:toolName,arguments:{}});
 expect(result.isError).toBe(true);expect(result.content).toEqual(owner.content);expect(result.structuredContent).toEqual(owner.structuredContent);expect(result._meta?.owner_provenance).toBe('fixture');
 expect(result._meta?.plugin_handler).toMatchObject({callback_settled:true,cancellation_requested:false});expect(completed().at(-1)?.payload).toMatchObject({ok:false});
});
it('retains legacy failure objects and rejects invalid or unserializable MCP results without reporting success',async()=>{
 const contribution=getContributedTools()[0],client=await connect();
 contribution.definition.handler=()=>({isError:true,receipt_id:'legacy-receipt',detail:'whole failure'});
 const legacy=await client.callTool({name:toolName,arguments:{}});expect(legacy.isError).toBe(true);expect(legacy.structuredContent).toMatchObject({receipt_id:'legacy-receipt'});
 contribution.definition.handler=()=>({content:[{type:'not-an-mcp-block'}]});expect((await client.callTool({name:toolName,arguments:{}})).isError).toBe(true);
 contribution.definition.handler=()=>undefined;expect((await client.callTool({name:toolName,arguments:{}})).isError).toBe(true);
 expect(completed().every(event=>event.payload?.ok===false)).toBe(true);
});
it('propagates actual MCP cancellation to a cooperative plugin handler and keeps effect termination unconfirmed in its failure',async()=>{
 const controller=new AbortController();let enter!:()=>void,settled!:()=>void;const started=new Promise<void>(resolve=>enter=resolve),done=new Promise<void>(resolve=>settled=resolve);let received:AbortSignal|undefined;
 getContributedTools()[0].definition.handler=async(_args,context)=>{received=context.signal;enter();try{await new Promise<void>((_resolve,reject)=>context.signal!.addEventListener('abort',()=>reject(context.signal!.reason),{once:true}));}finally{settled();}};
 const client=await connect(),operation=client.callTool({name:toolName,arguments:{}},undefined,{signal:controller.signal}).catch(error=>error);
 await started;controller.abort(new Error('declared caller cancellation'));expect(await operation).toBeInstanceOf(Error);await done;expect(received?.aborted).toBe(true);
 await vi.waitFor(()=>expect(completed().at(-1)?.payload).toMatchObject({ok:false}),{timeout:3000});
});
it('does not claim a noncooperative plugin callback stopped when the cancelled client wait rejects',async()=>{
 const controller=new AbortController();let enter!:()=>void,release!:()=>void;const started=new Promise<void>(resolve=>enter=resolve),late=new Promise<void>(resolve=>release=resolve);let finished=false,signal:AbortSignal|undefined;
 getContributedTools()[0].definition.handler=async(_args,context)=>{signal=context.signal;enter();await late;finished=true;return {content:[{type:'text',text:'late literal owner result'}]};};
 const client=await connect(),operation=client.callTool({name:toolName,arguments:{}},undefined,{signal:controller.signal}).catch(error=>error);
 try{await started;controller.abort();expect(await operation).toBeInstanceOf(Error);expect(finished).toBe(false);expect(completed()).toHaveLength(0);
  await vi.waitFor(()=>expect(signal?.aborted).toBe(true),{timeout:3000});release();await vi.waitFor(()=>expect(finished).toBe(true),{timeout:3000});
 }finally{release();await late;}
});
it('unregister aborts an in-flight original contribution and rejects new calls without repeating its handler',async()=>{
 let enter!:()=>void;const started=new Promise<void>(resolve=>enter=resolve);let calls=0;
 getContributedTools()[0].definition.handler=async(_args,context)=>{calls++;enter();await new Promise<void>(resolve=>context.signal!.addEventListener('abort',()=>resolve(),{once:true}));return {content:[{type:'text',text:'Original callback returned after cancellation'}]};};
 const client=await connect(),operation=client.callTool({name:toolName,arguments:{}});await started;(globalThis as any).__ashokaBoundaryUnregister();
 const result=await operation;expect(result._meta?.plugin_handler).toMatchObject({callback_settled:true,cancellation_requested:true});
 expect((await client.callTool({name:toolName,arguments:{}})).isError).toBe(true);expect(calls).toBe(1);
});
it('resource unload reaches the original handler and preserves whole binary/text contents and owner metadata',async()=>{
 let enter!:()=>void;const started=new Promise<void>(resolve=>enter=resolve);const owner={contents:[{uri,mimeType:'application/octet-stream',blob:'AA=='},{uri,mimeType:'text/plain',text:'whole Unicode 🌿漢'}],_meta:{owner_receipt:'literal-original'}};
 getContributedResources()[0].definition.handler=async(_request,context)=>{enter();await new Promise<void>(resolve=>context.signal!.addEventListener('abort',()=>resolve(),{once:true}));return owner;};
 const client=await connect(),operation=client.readResource({uri});await started;await unloadPluginById(id);const result=await operation;
 expect(result.contents).toEqual(owner.contents);expect(result._meta?.owner_receipt).toBe(owner._meta.owner_receipt);expect(result._meta?.plugin_handler).toMatchObject({cancellation_requested:true,callback_settled:true});
});
it('the actual modern registration wire fence rejects original invalid arguments and consumes an exact allowance once',async()=>{
 const context={principal:'modern-fixture',session_id:'modern-owner',directory:getDataDir(),environment:{},continuation_key:'fixture',channel:'mcp' as const};
 const args={value:'exact original'},lease=issueExecutionPolicy(context,{id:'modern-wire',autonomy:'manual',verbosity:'balanced',approvals:[{tool:'fixture_modern_write',arguments:args,scope_id:'fixture',calls:1}],timeout_ms:5000,signal:new AbortController().signal});
 const server=new McpServer({name:'modern-wire-owner',version:'1'});configureToolBoundary(server,{...context,execution_policy:lease.policy});let calls=0;
 server.registerTool('fixture_modern_write',{inputSchema:{value:z.string()}},async()=>{calls++;return {content:[{type:'text',text:'literal outcome'}],structuredContent:{receipt_id:'declared-modern-receipt'}};});
 const client=new Client({name:'modern-wire-client',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();connections.push({server,client});await server.connect(a);await client.connect(b);
 try{expect((await client.callTool({name:'fixture_modern_write',arguments:{...args,undeclared:true}})).structuredContent?.error).toMatchObject({code:'INVALID_INPUT'});expect(calls).toBe(0);
  expect((await client.callTool({name:'fixture_modern_write',arguments:args})).structuredContent?.receipt_id).toBe('declared-modern-receipt');expect(calls).toBe(1);expect(lease.policy.effects_started).toBe(1);
  expect((await client.callTool({name:'fixture_modern_write',arguments:args})).isError).toBe(true);expect(calls).toBe(1);
 }finally{lease.close();}
});
