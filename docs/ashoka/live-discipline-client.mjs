// Persistent local governance transport. Reads JSON commands from stdin;
// it does not run scans, models, migration, installation or restart.
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {createInterface} from 'node:readline';
import {appendFile} from 'node:fs/promises';
const client = new Client({name:'ashoka-authorized-implementation',version:'1'});
const transport = new StreamableHTTPClientTransport(new URL('http://127.0.0.1:8010/mcp'));
await client.connect(transport);
console.log(JSON.stringify({connected:true,transport_session:transport.sessionId}));
try {
  for await (const line of createInterface({input:process.stdin})) {
    if (!line.trim()) continue;
    try {
      const input=JSON.parse(line);
      if (input.close) break;
      const result=input.discover ? await client.listTools() : await client.callTool({name:input.name,arguments:input.arguments??{}},undefined,{timeout:120000});
      await appendFile(new URL('./live-discipline-continuation.jsonl',import.meta.url),JSON.stringify({at:new Date().toISOString(),request:input,result})+'\n');
      if (input.discover) console.log(JSON.stringify({tools:result.tools.filter(tool=>input.names?.includes(tool.name)).map(({name,inputSchema})=>({name,inputSchema}))}));
      else {
        let value=result.structuredContent;
        if (!value) { const text=result.content?.find(item=>item.type==='text')?.text; try { value=JSON.parse(text); } catch { value={text}; } }
        const selected=input.fields ? Object.fromEntries(input.fields.map(key=>[key,value?.[key]])) : value;
        console.log(JSON.stringify({name:input.name,isError:result.isError??false,result:selected}));
      }
    } catch (error) { console.log(JSON.stringify({error:String(error?.stack??error)})); }
  }
} finally { await transport.terminateSession().catch(()=>{}); await client.close(); }
