/** Real durable publication/context owner, declared synthetic worker; no physical GUI qualification. */
import {afterEach,beforeEach,expect,it} from "vitest";
import {mkdtemp,readFile,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createServer} from "node:http";
import type {AddressInfo} from "node:net";
import {config} from "../src/config/config.js";
import {getDataDir,setDataDirOverride} from "../src/utils/paths.js";
import {commitGraphWrites,loadPublicationState} from "../src/graph/publication.js";
import {releaseGraphWriter} from "../src/graph/writer-lease.js";
import {withSessionContext,type SessionContext} from "../src/server/session-context.js";
import {beginManagedContext,deliverManagedContext,finishManagedContext,managedContextPrompt,readManagedContext,listManagedComputerSessions} from "../src/graph/execution-context.js";
import {computerDigest,computerRegistrationDigest,prepareComputerAction,readComputerJournal,readyComputerJournal,recordComputerObservation,registerComputerJournal,settleComputerAction,stopComputerJournal} from "../src/computer/journal.js";
import type {ComputerJournal} from "../src/computer/journal-schema.js";
import {handleComputerHttp} from "../src/computer/http.js";
let root:string,previous:string,repos:Record<string,string>,instanceId:string;
const owner=(session_id="one"):SessionContext=>({principal:"owner",session_id,directory:join(root,"data"),channel:"browser",environment:{},continuation_key:"fixture"});
const within=<T>(work:()=>T,session="one")=>withSessionContext(owner(session),work);
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),"dg-computer-journal-"));previous=getDataDir();repos={...config.repos};config.repos={fixture:root};setDataDirOverride(join(root,"data"));
 await writeFile(join(root,"source.ts"),"export const ui = true;\n");await commitGraphWrites({actor:"fixture",scope:["features.json"],writes:[{file:"features.json",content:JSON.stringify({features:[{id:"ui",name:"Controlled UI",source_repo:"fixture",source_files:["source.ts"]}]})}]});
 await within(async()=>{const entry=await beginManagedContext({id:"execution",adapter:"fixture",query:"Controlled UI"});instanceId=entry.instance_id;await deliverManagedContext(entry.id,managedContextPrompt(entry));});
});
afterEach(async()=>{await releaseGraphWriter(join(root,"data"));setDataDirOverride(previous);config.repos=repos;await rm(root,{recursive:true,force:true});});
function initial(patch:Partial<ComputerJournal>={}):ComputerJournal{
 const now=new Date().toISOString(),value:Omit<ComputerJournal,"intent_hash">={session:{schema:"dreamgraph.computer_session.v1",id:"computer",instance_id:instanceId,session_id:"one",execution_id:"execution",job_id:"job",owner:"owner",host_id:"fixture-host",target_ids:["target"],grant_id:"grant",capability_id:"fixture-capability",fence:0,policy_revision:"policy",state:"created",created_at:now,updated_at:now,terminal_reason:null},
  targets:[{schema:"dreamgraph.computer_target.v1",id:"target",instance_id:instanceId,session_id:"one",host_id:"fixture-host",surface:"browser",generation:1,origin:"https://fixture.example",application:null}],
  capability:{schema:"dreamgraph.computer_capability.v1",id:"fixture-capability",adapter:"declared-fixture",adapter_version:"1",backend_version:"1",route:"dreamgraph_harness",requested:["click","type"],supported:["click","type"],permitted:["click","type"],effective:["click","type"],evidence_granularity:"action",independent_stop:true,reasons:["DECLARED_OFFLINE_WORKER"],qualified_at:now},
  profile_hash:computerDigest("fixture-profile"),worker_epoch:"worker:one",limits:{max_actions:2,max_images:1,max_image_bytes:1024,observation_bytes:1024,expires_at:new Date(Date.now()+60_000).toISOString()},stop_state:"not_requested",observations:[],actions:[],usage:{actions:0,images:0,image_bytes:0,observation_bytes:0},...patch};
 return {...value,intent_hash:computerRegistrationDigest(value)};
}
const observation=(id="obs",generation=1,kind:"dom"|"postcondition"|"interpretation"="dom",verified=false)=>({schema:"dreamgraph.computer_observation.v1" as const,id,target_id:"target",target_generation:generation,execution_id:"execution",kind,observed_at:new Date().toISOString(),expires_at:new Date(Date.now()+20_000).toISOString(),artifact_ref:null,content_hash:computerDigest({id,generation}),evidence_ids:[],verified});
const usage={bytes:100,images:0,image_bytes:0};
const action=(id="action",patch:Record<string,unknown>={})=>({schema:"dreamgraph.computer_action.v1" as const,id,execution_id:"execution",target_id:"target",target_generation:1,observation_id:"obs",grant_id:"grant",operation:"type" as const,parameters:{text:"SYNTHETIC_SECRET_Å日本語"},postcondition:"value-matches",fence:1,...patch});
async function ready(){const input=initial();await registerComputerJournal("execution",input);await readyComputerJournal("execution","computer","worker:one");await recordComputerObservation("execution","computer",observation(),usage);return input;}
it("reconnect pages existing owner descriptors without reading archived transcripts or creating authority",()=>within(async()=>{
 await ready();await registerComputerJournal("execution",initial({session:{...initial().session,id:"computer-two"}}));
 const publication=await loadPublicationState(),first=await listManagedComputerSessions({limit:1});expect(first.total).toBe(2);expect(first.next_cursor).toBeTruthy();
 const second=await listManagedComputerSessions({limit:1,cursor:first.next_cursor!,snapshot_hash:first.snapshot_hash});
 expect(new Set([...first.sessions,...second.sessions].map(row=>row.journal.session.id))).toEqual(new Set(["computer","computer-two"]));expect(second.next_cursor).toBeNull();
 expect(first.history_scope).toBe("active_execution_store");expect(first.sessions[0].journal).not.toHaveProperty("observations");expect(first.sessions[0].journal).not.toHaveProperty("actions");
 first.sessions[0].journal.session.host_id="MUTATED_VIEW";expect((await readManagedContext("execution")).computer_sessions.every(item=>item.session.host_id==="fixture-host")).toBe(true);
 expect(await loadPublicationState()).toEqual(publication);expect((await within(()=>listManagedComputerSessions(),"two")).sessions).toEqual([]);
}));
it("changed and foreign reconnect cursors cannot turn partial pages into a current complete session list",()=>within(async()=>{
 await ready();await registerComputerJournal("execution",initial({session:{...initial().session,id:"computer-two"}}));const first=await listManagedComputerSessions({limit:1});
 await expect(listManagedComputerSessions({cursor:first.next_cursor!})).rejects.toThrow("PAGE_CHANGED");
 await expect(within(()=>listManagedComputerSessions({cursor:first.next_cursor!,snapshot_hash:first.snapshot_hash}),"two")).rejects.toThrow("PAGE_CHANGED");
 await recordComputerObservation("execution","computer",observation("new"),usage);
 await expect(listManagedComputerSessions({cursor:first.next_cursor!,snapshot_hash:first.snapshot_hash})).rejects.toThrow("PAGE_CHANGED");
 await expect(listManagedComputerSessions({limit:33})).rejects.toThrow();
}));
it("execution workers cannot discover other original passes or use reconnect as permission",()=>within(async()=>{
 await ready();await expect(withSessionContext({...owner(),execution_policy:{id:"execution"} as never},()=>listManagedComputerSessions())).rejects.toThrow("HOST_EXECUTION_CONTROL_REQUIRED");
}));
it("the real HTTP reconnect projection keeps declared transport identities isolated, bounded and read-only",()=>within(async()=>{
 await ready();let transport=owner();const http=createServer((req,res)=>withSessionContext(transport,()=>handleComputerHttp(req,res,new URL(req.url!,"http://local").pathname)));
 await new Promise<void>(resolve=>http.listen(0,"127.0.0.1",resolve));const base=`http://127.0.0.1:${(http.address() as AddressInfo).port}/api/architect/v1/computer/`;
 try{const before=await loadPublicationState(),page=await (await fetch(base+"sessions?limit=1")).json();expect(page.total).toBe(1);expect(page.sessions[0].worker_available).toBe(false);
  expect(JSON.stringify(page)).not.toContain("SYNTHETIC_SECRET");expect(page.sessions[0].journal).not.toHaveProperty("actions");
  expect((await fetch(base+"sessions?limit=999")).status).toBe(400);expect((await fetch(base+"sessions?caller_backend=injected")).status).toBe(400);
  transport=owner("two");expect((await (await fetch(base+"sessions")).json()).sessions).toEqual([]);
  expect((await fetch(base+"status?execution_id=execution&id=computer")).status).toBe(400);
  transport={...owner(),channel:"mcp"};expect((await fetch(base+"sessions")).status).toBe(403);
  transport={...owner(),execution_policy:{id:"execution"} as never};expect((await fetch(base+"sessions")).status).toBe(403);
  expect(await loadPublicationState()).toEqual(before);
 }finally{await new Promise<void>(resolve=>http.close(()=>resolve()));}
}));
it("requires delivered original authority, sealed intent and explicitly qualified route",()=>within(async()=>{
 const bad=initial();bad.profile_hash=computerDigest("changed");await expect(registerComputerJournal("execution",bad)).rejects.toThrow("DIGEST_REJECTED");
 const unqualified=initial({capability:{...initial().capability,qualified_at:null}});await expect(registerComputerJournal("execution",unqualified)).rejects.toThrow("NOT_QUALIFIED");
 const foreign=initial({session:{...initial().session,session_id:"two"}});await expect(registerComputerJournal("execution",foreign)).rejects.toThrow("OWNER_MISMATCH");
 const pending=await beginManagedContext({id:"pending",adapter:"fixture",query:"Controlled UI"});const notDelivered=initial({session:{...initial().session,execution_id:pending.id}});
 await expect(registerComputerJournal(pending.id,notDelivered)).rejects.toThrow("NOT_DELIVERED");
}));
it("replays original intent/receipt across service recreation and never persists raw action text",()=>within(async()=>{
 const original=await ready();const first=await prepareComputerAction("execution","computer",action());
 const reread=await within(()=>readComputerJournal("execution","computer"));expect(reread.actions[0].receipt).toEqual(first.receipt);
 expect(await registerComputerJournal("execution",original)).toMatchObject({replayed:true});expect(await prepareComputerAction("execution","computer",action())).toEqual({...first,replayed:true});
 await expect(prepareComputerAction("execution","computer",action("action",{parameters:{text:"different"}}))).rejects.toThrow("IDENTITY_CONFLICT");
 const disk=await readFile(join(root,"data/execution_contexts.json"),"utf8");expect(disk).not.toContain("SYNTHETIC_SECRET");expect(disk).not.toContain("日本語");
 expect((await readComputerJournal("execution","computer")).usage.actions).toBe(1);
}));
it("does not cross sessions, host epochs, target generations or grants",()=>within(async()=>{
 await ready();await expect(within(()=>readComputerJournal("execution","computer"),"two")).rejects.toThrow("OWNER_MISMATCH");
 await expect(readyComputerJournal("execution","computer","worker:old")).rejects.toThrow("EPOCH_REJECTED");
 for(const patch of [{grant_id:"other"},{target_id:"other"},{fence:2},{target_generation:0}])await expect(prepareComputerAction("execution","computer",action("bad",patch))).rejects.toThrow("PRECONDITION_REJECTED");
}));
it("invalidates old observations on target changes and cannot verify a model interpretation",()=>within(async()=>{
 await ready();await recordComputerObservation("execution","computer",observation("new",2),usage);
 await expect(prepareComputerAction("execution","computer",action())).rejects.toThrow("PRECONDITION_REJECTED");
 await expect(recordComputerObservation("execution","computer",observation("back",1),usage)).rejects.toThrow("TARGET_REJECTED");
 await expect(recordComputerObservation("execution","computer",observation("model",2,"interpretation",true),usage)).rejects.toThrow("NOT_VERIFICATION");
 const expired={...observation("expired",2),expires_at:new Date(Date.now()-1).toISOString()};await expect(recordComputerObservation("execution","computer",expired,usage)).rejects.toThrow("EXPIRED");
}));
it("reserves finite actions/images/bytes once and refuses oversize or unsupported operations",()=>within(async()=>{
 await ready();await prepareComputerAction("execution","computer",action("one"));await prepareComputerAction("execution","computer",action("two"));
 await expect(prepareComputerAction("execution","computer",action("three"))).rejects.toThrow("ACTION_BUDGET");
 await expect(prepareComputerAction("execution","computer",action("oversize",{parameters:{text:"x".repeat(70000)}}))).rejects.toThrow("BYTE_BOUND");
 await expect(prepareComputerAction("execution","computer",action("navigate",{operation:"navigate"}))).rejects.toThrow("UNAVAILABLE");
 await recordComputerObservation("execution","computer",observation("image"),{bytes:100,images:1,image_bytes:1024});
 await expect(recordComputerObservation("execution","computer",observation("image2"),{bytes:100,images:1,image_bytes:1})).rejects.toThrow("BUDGET");
 await expect(recordComputerObservation("execution","computer",observation("large"),{bytes:1025,images:0,image_bytes:0})).rejects.toThrow("BUDGET");
}));
it("postcondition proof, terminal immutability and graph receipt owner remain separate",()=>within(async()=>{
 await ready();const {receipt}=await prepareComputerAction("execution","computer",action());
 await expect(settleComputerAction("execution","computer",{...receipt,state:"verified",reason:null})).rejects.toThrow("PROOF_REQUIRED");
 await expect(settleComputerAction("execution","computer",{...receipt,state:"unknown",reason:"SYNTHETIC_SECRET"})).rejects.toThrow("REASON_INVALID");
 await recordComputerObservation("execution","computer",{...observation("proof",1,"postcondition",true),evidence_ids:[computerDigest({action_id:"action",postcondition_hash:computerDigest("value-matches")})]},usage);
 const verified={...receipt,state:"verified" as const,observation_ids:["proof"],reason:null};
 await expect(settleComputerAction("execution","computer",{...verified,graph_receipt_id:"made-up"})).rejects.toThrow("OWNER_RECEIPT");
 await settleComputerAction("execution","computer",verified);expect(await settleComputerAction("execution","computer",verified)).toEqual(verified);
 await expect(settleComputerAction("execution","computer",{...verified,state:"unknown"})).rejects.toThrow("IMMUTABLE");
}));
it("a lost physical result stays recoverable after acknowledged stop and cannot redispatch",()=>within(async()=>{
 await ready();const first=await prepareComputerAction("execution","computer",action());await stopComputerJournal("execution","computer","requested","COMPUTER_OPERATOR_STOP");
 await stopComputerJournal("execution","computer","acknowledged","COMPUTER_STOP_ACKNOWLEDGED");
 expect((await finishManagedContext("execution")).status).toBe("recovery_required");
 expect(await prepareComputerAction("execution","computer",action())).toEqual({...first,replayed:true});
 await expect(prepareComputerAction("execution","computer",action("later"))).rejects.toThrow("NOT_ACTIVE");
 await expect(stopComputerJournal("execution","computer","unknown","COMPUTER_STOP_UNKNOWN")).rejects.toThrow("IMMUTABLE");
}));
it("active workers prevent completion and stopped proved work remains a state receipt, never graph truth",()=>within(async()=>{
 await ready();expect((await finishManagedContext("execution")).status).toBe("work_pending");
 await stopComputerJournal("execution","computer","acknowledged","COMPUTER_STOP_ACKNOWLEDGED");const revision=(await loadPublicationState()).revision.graph_revision;
 expect((await finishManagedContext("execution")).status).toBe("state_committed");expect((await loadPublicationState()).revision.graph_revision).toBe(revision);
 await expect(registerComputerJournal("execution",initial())).rejects.toThrow("CLOSED");
}));
it("late unknown-result bookkeeping does not pretend worker termination was acknowledged",()=>within(async()=>{
 await ready();const {receipt}=await prepareComputerAction("execution","computer",action());await stopComputerJournal("execution","computer","unknown","COMPUTER_WORKER_LOST");
 await settleComputerAction("execution","computer",{...receipt,state:"unknown",reason:"COMPUTER_EFFECT_UNKNOWN"});
 expect((await finishManagedContext("execution")).status).toBe("recovery_required");expect((await readManagedContext("execution")).computer_sessions[0].stop_state).toBe("unknown");
}));
