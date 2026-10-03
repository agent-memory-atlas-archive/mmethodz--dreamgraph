/** Compiled inner ChatPanel dispatch/history; UI, provider replies and execution host are declared doubles. Actual MCP transport remains real. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';
import vm from 'node:vm';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// Load the real compiled extension dependency graph with a narrow VS Code UI stub.
// Node/package dependencies and the production MCP client remain real.
const root = join(__dirname, '..');
const cache = new Map<string, { exports: any }>();
const sandbox = vm.createContext({
  Buffer, process, console, Error, AbortController, AbortSignal, URL, TextDecoder, TextEncoder, structuredClone,
  fetch, Response, Headers, Request, setTimeout, clearTimeout, setInterval, clearInterval,
});
const editor = { workspace: { getConfiguration: () => ({ get: () => undefined }) }, window: {}, commands: {}, languages: {} };
function load(filename: string): any {
  const existing = cache.get(filename); if (existing) return existing.exports;
  const module = { exports: {} }; cache.set(filename, module);
  const localRequire = createRequire(filename);
  const requirePort = (id: string) => {
    if (id === 'vscode') return editor;
    const resolved = localRequire.resolve(id);
    return resolved.startsWith(root + sep) && resolved.endsWith('.js') ? load(resolved) : localRequire(id);
  };
  const wrapper = new vm.Script(`(function(exports,require,module,__filename,__dirname){${readFileSync(filename, 'utf8')}\n})`, { filename });
  wrapper.runInContext(sandbox)(module.exports, requirePort, module, filename, dirname(filename));
  return module.exports;
}
const { ChatPanel } = load(join(root, 'chat-panel.js'));
const { McpClient } = load(join(root, 'mcp-client.js'));
function managedFixture(client: any, panel: any) {
  return { signal: panel.abortController.signal,
    prepare: async (messages: any, _tools: any, raw: any) => ({ messages, raw }),
    run: async (work: any, signal: AbortSignal) => { signal.throwIfAborted(); const value = await work(); signal.throwIfAborted(); return value; },
    // Native provider/admission is an explicit double in these MCP/history-only fixtures.
    runModel: async (_llm: unknown, work: any, signal: AbortSignal) => { signal.throwIfAborted(); const value = await work(); signal.throwIfAborted(); return value; },
    callTool: (name: string, args: any, signal: AbortSignal, timeout: number) => client.callToolRaw(name, args, timeout, undefined, signal),
  };
}

async function ownerFixture(result: unknown) {
  const server = new Server({ name: 'compiled-editor-owner', version: '1' }, { capabilities: { tools: {} } });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID });
  let calls = 0;
  server.setRequestHandler(CallToolRequestSchema, () => { calls++; return result as any; });
  await server.connect(transport);
  const http = createServer(async (req, res) => {
    try { await transport.handleRequest(req, res); }
    catch { if (!res.headersSent) res.writeHead(500); res.end(); }
  });
  await new Promise<void>(done => http.listen(0, '127.0.0.1', done));
  const client = new McpClient(`http://127.0.0.1:${(http.address() as { port: number }).port}`);
  await client.connect();
  return { client, calls: () => calls, close: async () => {
    await client.disconnect(); await server.close(); http.closeAllConnections(); await new Promise<void>(done => http.close(() => done()));
  } };
}

function panelFor(client: unknown, replies: (round: number) => unknown) {
  const panel = new ChatPanel({}), requests: any[] = [], events: any[] = [];
  panel.setMcpClient(client); panel.abortController = new AbortController();
  panel.postMessage = async (event: unknown) => { events.push(event); };
  panel.setArchitectLlm({ provider: 'openai', currentConfig: { model: 'fixture' }, callWithTools: async (_messages: unknown, _tools: unknown, raw: unknown) => {
    requests.push(JSON.parse(JSON.stringify(raw))); return replies(requests.length);
  } });
  return { panel, requests, events };
}
const task = [{ role: 'user', content: 'Explain the graph with provenance' }];
const call = { id: 'call-one', name: 'query_resource', input: {} };

test('compiled agent dispatch preserves daemon error/metadata/commit receipts and marks its trace failed', async () => {
  const literal = { content: [{ type: 'text', text: JSON.stringify({ receipt: { schema: 'dreamgraph.commit_receipt.v1', operation_id: 'effect-returned' } }) }],
    structuredContent: { obligation_id: 'source-debt' }, _meta: { revision: 11 }, isError: true };
  const owner = await ownerFixture(literal);
  try {
    const { panel, requests } = panelFor(owner.client, round => round === 1 ? { content: '', toolCalls: [call] } : { content: 'Owner result retained', toolCalls: [] });
    assert.equal(await panel._runManagedAgenticLoop(task, [], managedFixture(owner.client, panel)), 'Owner result retained');
    const returned = requests[1].at(-1).content[0];
    assert.equal(returned.is_error, true); assert.deepEqual(JSON.parse(returned.content), literal);
    assert.equal(panel._lastToolTrace[0].status, 'failed'); assert.equal(owner.calls(), 1);
  } finally { await owner.close(); }
});

test('compiled agent preserves the original owner receipt when local accounting fails after a result', async () => {
  const literal = { content: [{ type: 'text', text: 'source result' }], structuredContent: {
    receipt: { schema: 'dreamgraph.commit_receipt.v1', operation_id: 'already-committed' },
  }, isError: false };
  const owner = await ownerFixture(literal);
  try {
    const { panel, requests } = panelFor(owner.client, round => round === 1 ? { content: '', toolCalls: [call] } : { content: 'Host failure retained', toolCalls: [] });
    panel._currentBudgetCoordinator = { getPressure: () => 1, recordComponentActual: () => { throw new Error('fixture accounting failure'); } };
    await panel._runManagedAgenticLoop(task, [], managedFixture(owner.client, panel));
    const returned = requests[1].at(-1).content[0], failure = JSON.parse(returned.content);
    assert.equal(returned.is_error, true); assert.deepEqual(failure.owner_result, literal);
    assert.equal(failure.host_error.message, 'fixture accounting failure');
    assert.match(failure.effect_status, /not_failure_or_rollback/); assert.equal(owner.calls(), 1);
  } finally { await owner.close(); }
});

test('compiled history elision retains an earlier MCP text receipt as whole JSON with matching call ID', async () => {
  const receipt = { schema: 'dreamgraph.commit_receipt.v1', operation_id: 'earlier-owner', revision: 3 };
  const literal = { content: [{ type: 'text', text: JSON.stringify({ before: 'x'.repeat(8_000), receipt, after: '🌿'.repeat(8_000) }) }], isError: false };
  const owner = await ownerFixture(literal);
  try {
    const { panel, requests } = panelFor(owner.client, round => round < 8 ? { content: '', toolCalls: [{ ...call, id: `call-${round}` }] } : { content: 'History retained', toolCalls: [] });
    await panel._runManagedAgenticLoop(task, [], managedFixture(owner.client, panel));
    const earlier = requests[7].find((message: any) => Array.isArray(message.content) && message.content[0]?.tool_use_id === 'call-1').content[0];
    const omission = JSON.parse(earlier.content);
    assert.equal(omission.schema, 'dreamgraph.tool_result_omission.v1'); assert.equal(omission.omitted, true);
    assert.deepEqual(omission.required_anchors.find((anchor: any) => anchor.operation_id === 'earlier-owner'), receipt);
    assert.equal(earlier.tool_use_id, 'call-1'); assert.equal(owner.calls(), 7);
  } finally { await owner.close(); }
});

test('a compiled provider reply delivered after operator abort cannot dispatch an MCP effect', async () => {
  const owner = await ownerFixture({ content: [{ type: 'text', text: 'must not run' }] });
  try {
    const { panel } = panelFor(owner.client, () => {
      panel.abortController.abort(new Error('operator stop'));
      return { content: '', toolCalls: [call] };
    });
    await assert.rejects(panel._runManagedAgenticLoop(task, [], managedFixture(owner.client, panel)), /operator stop/);
    assert.equal(owner.calls(), 0); assert.equal(panel._lastToolTrace.length, 0);
  } finally { await owner.close(); }
});


test('compiled ordinary native execution refuses missing daemon authority before a model or local effect',async()=>{
 const {panel,requests}=panelFor(undefined,()=>({content:'must not dispatch',toolCalls:[]}));
 await assert.rejects(panel.runAgenticLoop(task,[]),/MANAGED_EDITOR_AUTHORITY_UNAVAILABLE/);
 assert.equal(requests.length,0);
});
function computerPanel(){
 const {panel,requests,events}=panelFor(undefined,()=>{throw new Error('Local model must not run for the explicit daemon role');});
 const id='93110f83-ab61-4e1e-a77c-50e0c0b92d2a',executionId='execution:'+id,calls:any[]=[];
 const scope={instance_id:'instance',worker:'isolated_playwright',host:'declared',model:{role:'computer_use',provider:'openai',model:'declared'},limits:{expires_at:new Date(Date.now()+60000).toISOString()}};
 const execution={instance_id:'instance',execution_id:executionId,status:'graph_committed',record_revision:2,authority_active:false,graph_receipt_ids:['separate-graph-receipt'],obligation_ids:[]};
 const port={baseUrl:'http://declared:1',readComputerPassSetup:async()=>({ok:true,available:true,...scope}),prepareComputerPass:async()=>({...scope,id,execution_id:executionId}),
  confirmComputerPass:async()=>({id,execution_id:executionId,grant_id:'grant',expires_at:scope.limits.expires_at}),readExecution:async()=>execution,
  runComputerPass:async(request:unknown)=>{calls.push(request);return {execution_id:executionId,content:'Literal scoped result',provider:'openai',model:'declared',execution};},
  controlComputer:async(execution:string,computer:string,action:string)=>{calls.push({execution,computer,action});return {session:{id,execution_id:executionId,instance_id:'instance',state:'stopped'},targets:[]};}};
 panel.setDaemonClient(port);panel.setInstance('instance');return {panel,requests,events,id,executionId,port,calls};
}
async function confirmComputerPanel(h:ReturnType<typeof computerPanel>){await h.panel._computerPass.setup(h.port,'instance');await h.panel._computerPass.prepare(h.port,'instance',{interact:false,duration_ms:30000});await h.panel._computerPass.confirm(h.port,'instance',h.id);}
test('compiled ChatPanel explicit daemon pass preserves normal model selection, canonical closure and text-only history',async()=>{
 const h=computerPanel();await confirmComputerPanel(h);await h.panel.runComputerPass(h.id,'Observe the named target');
 assert.equal(h.requests.length,0);assert.equal(h.calls.length,1);assert.equal(h.calls[0].computer_preparation_id,h.id);assert.equal(h.calls[0].message,'Observe the named target');
 assert.equal(h.calls[0].model,undefined);assert.equal(h.calls[0].adapter,undefined);assert.equal(h.panel.architectLlm.provider,'openai');
 assert.equal(h.panel.messages.length,2);assert.match(h.panel.messages[1].content,/Literal scoped result/);assert.match(h.panel.messages[1].content,/1 graph receipts/);
 assert.equal(h.panel.streaming,false);assert(h.events.some((event:any)=>event.type==='stream-end'));h.panel.dispose();
});
test('compiled global chat Stop targets the explicit original pass and a lost reply cannot append a success or start another pass',async()=>{
 const h=computerPanel();await confirmComputerPanel(h);let started!:()=>void;const dispatched=new Promise<void>(done=>started=done);
 h.port.runComputerPass=async(...args:any[])=>new Promise((resolve,reject)=>{started();const signal=args[2] as AbortSignal;signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});
 const running=h.panel.runComputerPass(h.id,'Observe').catch((error:unknown)=>error);await dispatched;h.panel.abortGeneration();assert.match(String(await running),/OPERATOR_STOP/);
 for(let i=0;i<10&&!h.calls.length;i++)await new Promise(done=>setImmediate(done));assert.deepEqual(h.calls[0],{execution:h.executionId,computer:h.id,action:'stop'});
 assert.equal(h.panel.messages.filter((message:any)=>message.role==='assistant').length,0);assert.equal(h.panel._computerPass.blocksContinuation,true);assert.equal(h.panel.streaming,false);
 await h.panel._computerPass.inspect(h.port,'instance');assert.equal(h.panel._computerPass.blocksContinuation,false);h.panel.dispose();
});
