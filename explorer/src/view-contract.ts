import {GraphIdentitySchema,GraphCurrencySchema,RevisionVectorSchema,ResultStateSchema,AssertionClassSchema,graphIdentityKey} from "../../packages/sdk/src/graph-contracts";
import type {GraphSnapshot} from "./types";

/** Rendering receives canonical truth; a malformed response is not an empty healthy graph. */
export function validateExplorerSnapshot(snapshot:GraphSnapshot):GraphSnapshot{
  if(snapshot.version!==2||snapshot.representation!=="canonical")throw new Error("EXPLORER_CANONICAL_SNAPSHOT_REQUIRED");
  RevisionVectorSchema.parse(snapshot.revision);GraphCurrencySchema.parse(snapshot.currency);ResultStateSchema.parse(snapshot.state);
  if(!Array.isArray(snapshot.nodes)||snapshot.nodes.length>10000||!Array.isArray(snapshot.edges)||snapshot.edges.length>30000)throw new Error("EXPLORER_RENDER_LIMIT");
  const ids=new Set<string>();
  for(const node of snapshot.nodes){
    const identity=GraphIdentitySchema.parse(node.identity);AssertionClassSchema.parse(node.assertion_class);
    if(identity.instance_id!==snapshot.instance_uuid||graphIdentityKey(identity)!==node.id||ids.has(node.id)||!Number.isFinite(node.health)||!Number.isFinite(node.confidence))throw new Error("EXPLORER_IDENTITY_INVALID");
    ids.add(node.id);
  }
  for(const edge of snapshot.edges)if(!ids.has(edge.s)||!ids.has(edge.t)||!edge.id||!Number.isFinite(edge.conf))throw new Error("EXPLORER_EDGE_INVALID");
  return snapshot;
}

export function resolveViewIdentity(snapshot:GraphSnapshot,id:string):string|null{
  if(snapshot.nodes.some(node=>node.id===id))return id;
  const matches=snapshot.nodes.filter(node=>node.identity?.id===id);
  if(matches.length>1)throw new Error("This ID is ambiguous. Choose its entity type in Search.");
  return matches[0]?.id??null;
}

/** Discard out-of-order replies and retain layout when graph content/revision has not changed. */
export function newerSnapshot(previous:GraphSnapshot|null,incoming:GraphSnapshot):GraphSnapshot{
  if(previous?.instance_uuid===incoming.instance_uuid){
    if(previous.etag===incoming.etag)return previous;
    if((incoming.revision?.publication_sequence??-1)<(previous.revision?.publication_sequence??-1))return previous;
  }
  return incoming;
}
