/** Derived text is a revision-bound view, never a new independent evidence root. */
import { loadCanonicalGraph, type CanonicalGraphRead } from "../graph/read-model.js";
import { loadPublicationState, publicationContentHash } from "../graph/publication.js";
import { withGraphRead } from "../utils/graph-reconciliation-barrier.js";
import { getActiveScope } from "../instance/index.js";
import { readFile } from "node:fs/promises";
import { dataPath } from "../utils/paths.js";
import { riskDigest } from "./risk-lifecycle.js";
export interface CognitiveProjectionContext {
  schema:"dreamgraph.cognitive_projection.v1";
  instance_id:string;
  revision:CanonicalGraphRead["revision"];
  currency:CanonicalGraphRead["currency"];
  state:CanonicalGraphRead["state"];
  dependencies:Record<string,string|null>;
  evidence_fingerprint:string;
  assertion_class:"historical";
  derived:true;
  generated_at:string;
}
export const COGNITIVE_PROJECTION_FILES=["features.json","workflows.json","data_model.json","capabilities.json","datastores.json","auxiliary_entities.json","ui_registry.json","adr_log.json","dream_graph.json","dream_history.json","candidate_edges.json","validated_edges.json","tension_log.json","normalization_evidence.json","structural_evidence.json","graph_maintenance.json","plan_state.json"];
export async function captureCognitiveProjection(files=COGNITIVE_PROJECTION_FILES):Promise<{context:CognitiveProjectionContext;graph:CanonicalGraphRead}> {
  return withGraphRead(async()=>{
    const graph=await loadCanonicalGraph(getActiveScope()?.uuid??process.env.DREAMGRAPH_INSTANCE_UUID??"legacy"),publication=await loadPublicationState();
    const dependencies:Record<string,string|null>={};
    for(const file of files){try{const body=await readFile(dataPath(file),"utf8");dependencies[file]=publicationContentHash(body);
      if(publication.stores[file]&&publication.stores[file].hash!==dependencies[file])throw new Error(`PROJECTION_UNPUBLISHED_SOURCE:${file}`);
    }catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT"||publication.stores[file])throw error;dependencies[file]=null;}}
    return {graph,context:{schema:"dreamgraph.cognitive_projection.v1",instance_id:graph.instance_id,revision:graph.revision,currency:graph.currency,state:graph.state,dependencies,
      evidence_fingerprint:riskDigest(graph.entities.filter(e=>e.identity.kind==="validated"||e.payload.origin==="rem").map(e=>[e.identity,e.assertion_class,e.payload.current_evidence_assessment,e.evidence.map(({revision,...original})=>original)])),
      assertion_class:"historical",derived:true,generated_at:new Date().toISOString()}};
  });
}
export async function projectionCurrentness(context?:CognitiveProjectionContext):Promise<"current"|"superseded"|"unknown"> {
  if(!context)return "unknown";
  const fresh=(await captureCognitiveProjection(Object.keys(context.dependencies))).context;
  return compareProjectionContext(context,fresh);
}
/** Compare against one captured read; callers serving many chapters must not reread the graph per chapter. */
export function compareProjectionContext(context:CognitiveProjectionContext|undefined,fresh:CognitiveProjectionContext):"current"|"superseded"|"unknown" {
  if(!context)return "unknown";
  if(Object.keys(context.dependencies).some(file=>!(file in fresh.dependencies)))return "unknown";
  const relevant=Object.fromEntries(Object.keys(context.dependencies).map(file=>[file,fresh.dependencies[file]]));
  return fresh.instance_id===context.instance_id&&fresh.evidence_fingerprint===context.evidence_fingerprint&&riskDigest(relevant)===riskDigest(context.dependencies)?"current":"superseded";
}
