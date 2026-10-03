import { createHash } from "node:crypto";

/** A prompt budget is not permission to turn a machine result into clipped prose. */
export function boundMachineResult(text: string, maxChars: number): {content:string;originalChars:number;finalChars:number;mode:string}|null {
  let payload: unknown;try {payload=JSON.parse(text);}catch{return null;}
  if(!payload||typeof payload!=="object")return null;
  if(text.length<=maxChars)return {content:text,originalChars:text.length,finalChars:text.length,mode:"verbatim"};
  const anchors:unknown[]=[];
  const visit=(value:unknown,depth:number):void=>{
    if(depth>6||!value||typeof value!=="object")return;
    if(Array.isArray(value)){for(const item of value)visit(item,depth+1);return;}
    const record=value as Record<string,unknown>,schema=record.schema;
    if(schema==="dreamgraph.context_pack.v1"){
      anchors.push({schema,id:record.id,instance_id:record.instance_id,revision:record.revision,currency:record.currency,state:record.state,
        mandatory_satisfied:false,original_mandatory_satisfied:record.mandatory_satisfied,context_omitted:true,
        receipt:record.receipt&&typeof record.receipt==="object"?{...record.receipt,delivery:"unattested"}:record.receipt,
        mandatory_records:Array.isArray(record.records)?record.records.filter((item:any)=>item?.mandatory===true):[]});return;
    }
    if(typeof schema==="string"&&/dreamgraph\.(context_receipt|commit_receipt|change_obligation|result_state|plan_state|computer_receipt)\./.test(schema)){anchors.push(record);return;}
    for(const [key,value]of Object.entries(record)){
      if(["error","errors","operation_id","receipt_id","obligation_id","change_obligation_id","effect_status"].includes(key))anchors.push({[key]:value});
      else visit(value,depth+1);
    }
  };visit(payload,0);
  const record=payload as Record<string,unknown>;
  // MCP commonly carries owner JSON in text content. Decode only this transport
  // layer, never arbitrary source/prose strings or recursively encoded documents.
  // Anchors retain owner claims; finding a schema name does not validate its truth.
  const mcpOwner = record.owner_result && typeof record.owner_result === "object"
    ? record.owner_result as Record<string, unknown> : record;
  if (Array.isArray(mcpOwner.content)) {
    for (const item of mcpOwner.content) {
      if (item && typeof item === "object" && item.type === "text" && typeof item.text === "string") {
        try { visit(JSON.parse(item.text), 0); } catch { /* Literal source text remains source. */ }
      }
    }
  }
  if (record.host_error !== undefined) anchors.push({host_error:record.host_error});
  const content=JSON.stringify({schema:"dreamgraph.tool_result_omission.v1",omitted:true,reason:"whole_result_exceeds_prompt_budget",
    original_chars:text.length,sha256:createHash("sha256").update(text).digest("hex"),required_anchors:anchors,
    isError:record.isError===true||record.success===false||mcpOwner.isError===true||record.host_error!==undefined,error:anchors.some((value:any)=>value.schema==="dreamgraph.context_pack.v1")?{code:"INSUFFICIENT_CONTEXT_BUDGET",message:"Required context is not delivered. Narrow the query or explicitly revise its budget before acting."}:undefined,
    effect_status:"consult_original_owner_receipt; omission_is_not_failure_or_rollback",
    recovery:"Use a bounded owner query or exact receipt lookup. Complete original payload is not retained in this prompt. Never repeat an uncertain mutation."});
  if(content.length>maxChars)throw new Error("MANDATORY_ANCHORS_EXCEED_PROMPT_BUDGET: no evidence was silently clipped; narrow the request");
  return {content,originalChars:text.length,finalChars:content.length,mode:"whole_result_omission"};
}

/** These blocks must not be clipped by generic prose compaction. Overflow is reported by the caller. */
export function hasRequiredEvidence(text:string):boolean {
  return /dreamgraph\.(?:context_pack|context_receipt|change_obligation|commit_receipt)\.|DreamGraph evidence|\bADR-\d{3}\b/.test(text);
}
