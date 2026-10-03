import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {CANONICAL_CONTRACTS} from '../src/graph/contracts.ts';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const check=process.argv.includes('--check');
// Fail explicitly for a newly introduced schema kind rather than emitting a
// permissive or incomplete artifact. Only canonical supported Zod types occur.
function schema(z){
 const d=z._def;
 switch(d.typeName){
  case 'ZodObject':{
   const shape=d.shape(), properties={}, required=[];
   for(const [key,value] of Object.entries(shape)){
    properties[key]=schema(value);
    if(!value.isOptional())required.push(key);
   }
   return {type:'object',properties,required,additionalProperties:d.unknownKeys==='passthrough'};
  }
  case 'ZodString':{
   const result={type:'string'};
   for(const c of d.checks){if(c.kind==='min')result.minLength=c.value;else if(c.kind==='max')result.maxLength=c.value;else if(c.kind==='datetime')result.format='date-time';else throw Error('Unrepresented string check '+c.kind);}
   return result;
  }
  case 'ZodNumber':{
   const result={type:d.checks.some(c=>c.kind==='int')?'integer':'number'};
   for(const c of d.checks){if(c.kind==='min')result[c.inclusive?'minimum':'exclusiveMinimum']=c.value;else if(c.kind==='max')result[c.inclusive?'maximum':'exclusiveMaximum']=c.value;else if(c.kind!=='int'&&c.kind!=='finite')throw Error('Unrepresented number check '+c.kind);}
   return result;
  }
  case 'ZodBoolean':return {type:'boolean'};
  case 'ZodNull':return {type:'null'};
  case 'ZodLiteral':return {const:d.value};
  case 'ZodEnum':return {type:'string',enum:d.values};
  case 'ZodArray':{
   const result={type:'array',items:schema(d.type)};
   if(d.minLength)result.minItems=d.minLength.value;
   if(d.maxLength)result.maxItems=d.maxLength.value;
   if(d.exactLength)result.minItems=result.maxItems=d.exactLength.value;
   return result;
  }
  case 'ZodRecord':return {type:'object',propertyNames:schema(d.keyType),additionalProperties:schema(d.valueType)};
  case 'ZodOptional':return schema(d.innerType);
  case 'ZodDefault':return {...schema(d.innerType),default:d.defaultValue()};
  case 'ZodNullable':return {anyOf:[schema(d.innerType),{type:'null'}]};
  case 'ZodUnion':return {anyOf:d.options.map(schema)};
  case 'ZodUnknown':return {};
  default:throw Error('Unsupported canonical schema node '+d.typeName);
 }
}
const source=await fs.readFile(path.join(root,'src/graph/contracts.ts'),'utf8');
const hash=createHash('sha256').update(source).digest('hex');
const sdk='// GENERATED from src/graph/contracts.ts — run npm run contracts:generate.\n'+source;
const json=JSON.stringify({$schema:'https://json-schema.org/draft/2020-12/schema',$id:'dreamgraph://contracts/v1',source_sha256:hash,$defs:Object.fromEntries(Object.entries(CANONICAL_CONTRACTS).map(([name,z])=>[name,schema(z)]))},null,2)+'\n';
// The extension can also host dependencies using Zod4; use its supported v3 compatibility entry.
const extension=sdk.replace('from "zod"','from "zod/v3"');
const nativePassSource=await fs.readFile(path.join(root,'src/computer/native-pass-schema.ts'),'utf8');
const nativePass='// GENERATED from src/computer/native-pass-schema.ts — run npm run contracts:generate.\n'+nativePassSource;
for(const [name,content] of [['packages/sdk/src/graph-contracts.ts',sdk],['extensions/vscode/src/generated/graph-contracts.ts',extension],['docs/contracts/graph-contracts.v1.json',json],
 ['packages/sdk/src/seams/computer-pass.ts',nativePass.replace("from '../graph/contracts.js'","from '../graph-contracts.js'")],
 ['extensions/vscode/src/generated/computer-pass.ts',nativePass.replace("from 'zod'","from 'zod/v3'").replace("from '../graph/contracts.js'","from './graph-contracts.js'")]]){
 const destination=path.join(root,name);
 if(check){if(await fs.readFile(destination,'utf8')!==content)throw Error('Generated contract drift: '+name);}
 else{await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,content);}
}
console.log(JSON.stringify({status:check?'verified':'generated',contracts:Object.keys(CANONICAL_CONTRACTS).length,source_sha256:hash}));
