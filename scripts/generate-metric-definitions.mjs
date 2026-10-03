import {readFile,writeFile} from 'node:fs/promises';
import {ANALYTICS_DEFINITIONS,AnalyticsPayloadSchema} from '../src/observability/analytics-snapshot.ts';
function schema(z){const d=z._def;switch(d.typeName){
case 'ZodObject':{const entries=Object.entries(d.shape());return {type:'object',properties:Object.fromEntries(entries.map(([key,value])=>[key,schema(value)])),required:entries.filter(([,value])=>!value.isOptional()).map(([key])=>key),additionalProperties:d.unknownKeys==='passthrough'};}
case 'ZodString':{const result={type:'string'};for(const c of d.checks){if(c.kind==='min')result.minLength=c.value;else if(c.kind==='max')result.maxLength=c.value;else if(c.kind==='datetime')result.format='date-time';else throw Error('Unrepresented metric string check '+c.kind);}return result;}
case 'ZodNumber':{const result={type:d.checks.some(c=>c.kind==='int')?'integer':'number'};for(const c of d.checks){if(c.kind==='min')result[c.inclusive?'minimum':'exclusiveMinimum']=c.value;else if(c.kind==='max')result[c.inclusive?'maximum':'exclusiveMaximum']=c.value;else if(c.kind!=='int'&&c.kind!=='finite')throw Error('Unrepresented metric number check '+c.kind);}return result;}
case 'ZodBoolean':return {type:'boolean'};case 'ZodLiteral':return {const:d.value};case 'ZodEnum':return {type:'string',enum:d.values};
case 'ZodRecord':return {type:'object',propertyNames:schema(d.keyType),additionalProperties:schema(d.valueType)};
case 'ZodArray':{const result={type:'array',items:schema(d.type)};if(d.maxLength)result.maxItems=d.maxLength.value;if(d.minLength)result.minItems=d.minLength.value;return result;}
case 'ZodNullable':return {anyOf:[schema(d.innerType),{type:'null'}]};case 'ZodOptional':return schema(d.innerType);case 'ZodUnknown':return {};
default:throw Error('Unrepresented metric schema '+d.typeName);}}
const body=JSON.stringify(ANALYTICS_DEFINITIONS,null,2)+'\n',files=['python/analytics/metric-definitions.json','docs/contracts/metric-definitions.v2.json'];
for(const file of files){if(process.argv.includes('--check')){if(await readFile(file,'utf8')!==body)throw new Error(`METRIC_DEFINITION_DRIFT:${file}`);}else await writeFile(file,body);}
const schemaBody=JSON.stringify({$schema:'https://json-schema.org/draft/2020-12/schema',$id:'dreamgraph://analytics/payload/v1',...schema(AnalyticsPayloadSchema)},null,2)+'\n';
for(const file of ['python/analytics/snapshot-schema.json','docs/contracts/analytics-payload.v1.json']){if(process.argv.includes('--check')){if(await readFile(file,'utf8')!==schemaBody)throw Error(`METRIC_SCHEMA_DRIFT:${file}`);}else await writeFile(file,schemaBody);}
console.log(`Qualified ${Object.keys(ANALYTICS_DEFINITIONS).length} shared metric definitions`);
