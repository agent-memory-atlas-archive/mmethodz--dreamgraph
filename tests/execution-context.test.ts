/** Actual journal/effect/fence integration in disposable repositories; no inference. */
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { config } from "../src/config/config.js";
import { getDataDir, setDataDirOverride } from "../src/utils/paths.js";
import { commitGraphWrites, loadPublicationState } from "../src/graph/publication.js";
import { releaseGraphWriter } from "../src/graph/writer-lease.js";
import { beginManagedContext, deliverManagedContext, refreshManagedContext, managedContextPrompt, assertManagedContext, readManagedContext, finishManagedContext, recordManagedEffect, archiveManagedContexts } from "../src/graph/execution-context.js";
import { managedSourceEffect, readChangeObligations, prepareChangeReconciliation } from "../src/graph/change-obligations.js";
import { withSessionContext, type SessionContext } from "../src/server/session-context.js";
import { issueExecutionPolicy } from "../src/server/execution-policy.js";
import { invokeToolBoundary } from "../src/server/tool-boundary.js";
import { executeScopedCommand } from "../src/server/scoped-command.js";
import { EngineJobs } from "../src/cognitive/jobs.js";

let root: string, prior: string, repos: Record<string,string>, file: string;
const feature = () => ({ id:"execution-context", name:"Execution context", description:"Exact source boundary and required constraints", source_repo:"fixture", source_files:["source.ts"], links:[] });
const owner = (session_id="one"): SessionContext => ({ principal:"fixture-owner", session_id, directory:join(root,"data"), channel:"browser", environment:{}, continuation_key:"fixture" });
const within = <T>(work:()=>T, id="one") => withSessionContext(owner(id),work);
const begin = (id="execution-one") => beginManagedContext({ id, adapter:"fixture", query:"Execution context", token_budget:4000 });
const deliver = async (id="execution-one") => { const entry=await begin(id); return deliverManagedContext(id, "system prefix\n"+managedContextPrompt(entry)); };
beforeEach(async()=>{ prior=getDataDir(); repos={...config.repos};root=await mkdtemp(join(tmpdir(),"dg-execution-context-"));file=join(root,"source.ts");
 config.repos={fixture:root};setDataDirOverride(join(root,"data"));await writeFile(file,"export const original = true;\n");
 await commitGraphWrites({ actor:"fixture",scope:["features.json"],writes:[{file:"features.json",content:JSON.stringify({features:[feature()]})}]});
});
afterEach(async()=>{vi.restoreAllMocks();await releaseGraphWriter(join(root,"data"));setDataDirOverride(prior);config.repos=repos;await rm(root,{recursive:true,force:true});});

it("distinguishes assembled from delivered context and rejects a clipped or fabricated injection",()=>within(async()=>{
 const before=await loadPublicationState(),entry=await begin();expect(entry.pack.receipt.delivery).toBe("unattested");
 await expect(assertManagedContext(entry.id)).rejects.toThrow("NOT_DELIVERED");
 await expect(deliverManagedContext(entry.id,entry.pack.context_text)).rejects.toThrow("DELIVERY_MISMATCH");
 await deliverManagedContext(entry.id,managedContextPrompt(entry));await assertManagedContext(entry.id);
 const acknowledged=await readManagedContext(entry.id);
 expect(await deliverManagedContext(entry.id,managedContextPrompt(entry))).toEqual(acknowledged);
 expect((await readManagedContext(entry.id)).pack.receipt.delivery).toBe("delivered");
 expect((await loadPublicationState()).revision.graph_revision).toBe(before.revision.graph_revision);
 expect((await finishManagedContext(entry.id)).status).toBe("no_change");
 await expect(assertManagedContext(entry.id)).rejects.toThrow("NOT_DELIVERED");
}));
it("an unchanged source edit closes as no_change and returns no unnecessary reconciliation claim",()=>within(async()=>{
 await deliver();const text=await readFile(file,"utf8"),args={filePath:"source.ts",text};
 const lease=issueExecutionPolicy(owner(),{id:"execution-one",context_id:"execution-one",autonomy:"manual",verbosity:"concise",timeout_ms:10000,signal:new AbortController().signal,
  approvals:[{tool:"edit_file",arguments:args,scope_id:"fixture",calls:1}]});
 try {await withSessionContext({...owner(),execution_policy:lease.policy},async()=>{
  const result=await invokeToolBoundary({name:"edit_file",shape:{filePath:z.string(),text:z.string()},args,handler:async()=>{
   const obligation=await managedSourceEffect({changes:[{file,content:text,expected_content:text}],apply:()=>writeFile(file,text)});
   return {content:[{type:"text",text:JSON.stringify({obligation})}]};}});
  expect(result.isError).not.toBe(true);
 });expect((await finishManagedContext("execution-one")).status).toBe("no_change");
 expect((await readChangeObligations()).entries[0].state).toBe("failed");
 }finally{lease.close();}
}));
it("recovers exact context and pending state across a new owner object, without crossing sessions or reusing execution IDs",()=>within(async()=>{
 await deliver();const expected=await readManagedContext("execution-one");
 expect(await within(()=>readManagedContext("execution-one"))).toEqual(expected);
 await expect(within(()=>readManagedContext("execution-one"),"other")).rejects.toThrow("OWNER_MISMATCH");
 await expect(begin()).rejects.toThrow("EXECUTION_ID_ALREADY_USED");
}));
it("revalidates actual named source content and affected graph constraints, while ignoring unrelated activity",()=>within(async()=>{
 await deliver();await commitGraphWrites({actor:"unrelated",scope:["features.json"],writes:[{file:"features.json",content:JSON.stringify({features:[feature(),{id:"other",name:"Unrelated",description:"Distinct invoice"}]})}]});
 await assertManagedContext("execution-one");
 await writeFile(file,"export const original = false;\n");await expect(assertManagedContext("execution-one")).rejects.toThrow("REFRESH_REQUIRED");
 await writeFile(file,"export const original = true;\n");
 await commitGraphWrites({actor:"changed",scope:["features.json"],writes:[{file:"features.json",content:JSON.stringify({features:[{...feature(),description:"Changed required constraint"}]})}]});
 await expect(assertManagedContext("execution-one")).rejects.toThrow("REFRESH_REQUIRED");
}));
it("refuses effects when a mandatory anchor does not fit, rather than dropping it",()=>within(async()=>{
 await commitGraphWrites({actor:"fixture",scope:["adr_log.json"],writes:[{file:"adr_log.json",content:JSON.stringify({decisions:[{id:"ADR-execution",title:"Execution context",decision:"Execution context stays bounded."}]})}]});
 const entry=await beginManagedContext({id:"insufficient",adapter:"fixture",query:"Execution context",token_budget:1});
 expect(entry.pack.mandatory_satisfied).toBe(false);await deliverManagedContext(entry.id,managedContextPrompt(entry));
 await expect(assertManagedContext(entry.id)).rejects.toThrow("INSUFFICIENT");
}));
it("does not require a selected plan that the graph does not project (a reported plans/ document)",()=>within(async()=>{
 const entry=await beginManagedContext({id:"unprojected-plan",adapter:"fixture",query:"Execution context",plan_id:"missing-plan",token_budget:4000});
 expect(entry.request.plan_id).toBeUndefined();expect(entry.pack.mandatory_satisfied).toBe(true);
 expect(entry.pack.state.reasons.some(reason=>reason.code==="MANDATORY_CONTEXT_MISSING")).toBe(false);
}));
it("binds actual source effects to the host execution and retains a durable reconciliation obligation at closure",()=>within(async()=>{
 await deliver();const args={filePath:"source.ts",text:"export const changed = true;\n"},lease=issueExecutionPolicy(owner(),{id:"execution-one",context_id:"execution-one",autonomy:"manual",verbosity:"concise",timeout_ms:10000,signal:new AbortController().signal,approvals:[{tool:"edit_file",arguments:args,scope_id:"fixture",calls:1}]});
 try {
  const result=await withSessionContext({...owner(),execution_policy:lease.policy},()=>invokeToolBoundary({name:"edit_file",shape:{filePath:z.string(),text:z.string()},args,handler:async()=>{
   const obligation=await managedSourceEffect({changes:[{file,content:args.text,expected_content:"export const original = true;\n"}],apply:()=>writeFile(file,args.text)});
   return {content:[{type:"text",text:JSON.stringify({obligation})}]};
  }}));
  expect(result.isError).not.toBe(true);expect(await readFile(file,"utf8")).toBe(args.text);
  const obligations=(await readChangeObligations()).entries;expect(obligations).toHaveLength(1);expect(obligations[0]).toMatchObject({execution_id:"execution-one",state:"reconciliation_pending"});
  const closure=await finishManagedContext("execution-one");expect(closure.status).toBe("reconciliation_pending");expect(closure.obligation_ids).toEqual([obligations[0].id]);
 } finally {lease.close();}
}));
it("an owner failure after a real write cannot become no-change or authorize a blind retry",()=>within(async()=>{
 await deliver();const args={filePath:"source.ts",text:"changed"},lease=issueExecutionPolicy(owner(),{id:"execution-one",context_id:"execution-one",autonomy:"manual",verbosity:"concise",timeout_ms:10000,signal:new AbortController().signal,approvals:[{tool:"edit_file",arguments:args,scope_id:"fixture",calls:1}]});
 const handler=vi.fn(async()=>{await managedSourceEffect({changes:[{file,content:"changed"}],apply:async()=>{await writeFile(file,"changed");throw new Error("reply lost after effect");}});return {content:[]};});
 const invoke=()=>withSessionContext({...owner(),execution_policy:lease.policy},()=>invokeToolBoundary({name:"edit_file",shape:{filePath:z.string(),text:z.string()},args,handler}));
 try {expect((await invoke()).isError).toBe(true);expect((await invoke()).isError).toBe(true);expect(handler).toHaveBeenCalledOnce();expect(await readFile(file,"utf8")).toBe("changed");expect((await finishManagedContext("execution-one")).status).toBe("recovery_required");}
 finally {lease.close();}
}));
it("actual shell source observation distinguishes no-source-change from process exit; external effects remain unattested",()=>within(async()=>{
 await deliver();const args={command:'node -e "process.stdout.write(\'fixture\')"'},lease=issueExecutionPolicy(owner(),{id:"execution-one",context_id:"execution-one",autonomy:"manual",verbosity:"concise",timeout_ms:10000,signal:new AbortController().signal,approvals:[{tool:"run_command",arguments:args,scope_id:"fixture",calls:1}]});
 try {const result=await executeScopedCommand(lease.policy,args,root);expect(result.exitCode).toBe(0);expect(result.stdout).toBe("fixture");expect(result.source_obligation?.state,JSON.stringify(result.source_obligation)).toBe("failed");expect(result.source_observation).toContain("external effects unattested");expect((await finishManagedContext("execution-one")).status).toBe("no_change");}
 finally {lease.close();}
}));
it("observes actual native additions/deletions as exact pending scopes while excluding instance metadata",()=>within(async()=>{
 const script=join(root,"command.mjs");await writeFile(script,"import {writeFile,unlink} from 'node:fs/promises';await writeFile('added.ts','export const newFile = true;');await unlink('source.ts');");
 await deliver();const args={command:`node "${script}"`},lease=issueExecutionPolicy(owner(),{id:"execution-one",context_id:"execution-one",autonomy:"manual",verbosity:"concise",timeout_ms:10000,signal:new AbortController().signal,approvals:[{tool:"run_command",arguments:args,scope_id:"fixture",calls:1}]});
 try {const result=await executeScopedCommand(lease.policy,args,root);
  expect(result.exitCode).toBe(0);expect(result.source_obligation).toMatchObject({state:"reconciliation_pending",scope:["source:fixture/added.ts","source:fixture/source.ts"]});
  expect(result.source_obligation?.before_hashes["source:fixture/added.ts"]).toBe("absent");expect(result.source_obligation?.after_hashes["source:fixture/source.ts"]).toBe("absent");
  expect((await finishManagedContext("execution-one")).status).toBe("reconciliation_pending");
 }finally{lease.close();}
}));
it("refresh keeps an unchanged context block byte-identical so the provider prompt cache stays valid",()=>within(async()=>{
 const delivered=await deliver();const before=managedContextPrompt(delivered);
 await new Promise(resolve=>setTimeout(resolve,5));
 const refreshed=await refreshManagedContext("execution-one");
 expect(managedContextPrompt(refreshed)).toBe(before);expect(refreshed.pack.receipt.issued_at).toBe(delivered.pack.receipt.issued_at);
 await deliverManagedContext(refreshed.id,"system prefix\n"+managedContextPrompt(refreshed));await assertManagedContext(refreshed.id);
}));
it("refresh never launders a concrete untracked named-source mismatch into current graph context",()=>within(async()=>{
 await deliver();const content="export const original = false;\n";await writeFile(file,content);
 const refreshed=await refreshManagedContext("execution-one");expect(refreshed.pack.receipt.delivery).toBe("unattested");
 expect(refreshed.pack.state.reasons.some(reason=>reason.code==="NAMED_SOURCE_CONTEXT_CHANGED")).toBe(true);
 await expect(assertManagedContext(refreshed.id)).rejects.toThrow("NOT_DELIVERED");
 await deliverManagedContext(refreshed.id,managedContextPrompt(refreshed));await expect(assertManagedContext(refreshed.id)).rejects.toThrow("REFRESH_REQUIRED");
 await commitGraphWrites({actor:"source-fixture-reconciliation",scope:["features.json"],writes:[{file:"features.json",content:JSON.stringify({features:[{...feature(),source_hashes:{"source.ts":"sha256:"+createHash("sha256").update(content).digest("hex")}}]})}]});
 const reconciled=await refreshManagedContext(refreshed.id);expect(reconciled.source_gaps).toEqual([]);
 await deliverManagedContext(reconciled.id,managedContextPrompt(reconciled));await assertManagedContext(reconciled.id);
}));
it("legacy source patterns stay contextual without inventing missing files or blocking commands",()=>within(async()=>{
 await commitGraphWrites({actor:"legacy-pattern",scope:["features.json"],writes:[{file:"features.json",content:JSON.stringify({features:[{...feature(),source_files:["src/cognitive/*.ts","source.ts"]}]})}]});
 const entry=await deliver();
 expect(Object.keys(entry.source_hashes)).toEqual(["fixture/source.ts"]);
 expect(entry.source_gaps).toEqual([]);
 expect(entry.pack.context_text).toContain("src/cognitive/*.ts");
 await assertManagedContext(entry.id);
 const refreshed=await refreshManagedContext(entry.id);await deliverManagedContext(entry.id,managedContextPrompt(refreshed));
 await assertManagedContext(entry.id);
 // A real file remains authoritative even alongside a historical region pattern.
 await writeFile(file,"changed outside DreamGraph");
 await expect(assertManagedContext(entry.id)).rejects.toThrow("REFRESH_REQUIRED");
}));

it("missing named source is disclosed on the initial prompt and cannot authorize ordinary effects",()=>within(async()=>{
 await rm(file);const entry=await begin();
 expect(entry.source_gaps).toEqual(["fixture/source.ts"]);
 expect(entry.pack.state.reasons.some(reason=>reason.code==="NAMED_SOURCE_CONTEXT_CHANGED")).toBe(true);
 await deliverManagedContext(entry.id,managedContextPrompt(entry));
 await expect(assertManagedContext(entry.id)).rejects.toThrow("REFRESH_REQUIRED");
 expect((await finishManagedContext(entry.id)).status).toBe("recovery_required");
}));
it("an established source hash is verified before initial execution, with repository identity encoded without slash collisions",()=>within(async()=>{
 config.repos={"team/fixture":root};
 await commitGraphWrites({actor:"fixture-source-hash",scope:["features.json"],writes:[{file:"features.json",content:JSON.stringify({features:[{...feature(),source_repo:"team/fixture",source_hashes:{"source.ts":"sha256:"+"f".repeat(64)}}]})}]});
 const entry=await begin();expect(entry.source_gaps).toEqual(["team%2Ffixture/source.ts"]);
 expect(entry.pack.state.reasons.find(reason=>reason.code==="NAMED_SOURCE_CONTEXT_CHANGED")?.scope).toEqual(["source:team%2Ffixture/source.ts"]);
 await deliverManagedContext(entry.id,managedContextPrompt(entry));await expect(assertManagedContext(entry.id)).rejects.toThrow("REFRESH_REQUIRED");
}));
it("a refreshed concrete gap admits only the canonical explicitly approved structural repair, preserving the gap until proof commits",()=>within(async()=>{
 await deliver();const content="untracked changed source";await writeFile(file,content);
 const refreshed=await refreshManagedContext("execution-one");await deliverManagedContext(refreshed.id,managedContextPrompt(refreshed));
 await expect(assertManagedContext(refreshed.id)).rejects.toThrow("REFRESH_REQUIRED");
 const repairArgs={mode:"incremental",enrich:false},paidArgs={mode:"incremental",enrich:true},handler=vi.fn(async()=>({content:[]}));
 const lease=issueExecutionPolicy(owner(),{id:"execution-one",context_id:"execution-one",autonomy:"supervised",verbosity:"concise",timeout_ms:10000,signal:new AbortController().signal,
  approvals:[{tool:"scan_project",arguments:repairArgs,scope_id:"fixture",calls:1},{tool:"scan_project",arguments:paidArgs,scope_id:"fixture",calls:1}]});
 try {await withSessionContext({...owner(),execution_policy:lease.policy},async()=>{
  const denied=await invokeToolBoundary({name:"scan_project",shape:{mode:z.enum(["full","incremental"]),enrich:z.boolean()},args:paidArgs,handler});
  expect(denied.isError).toBe(true);expect(handler).not.toHaveBeenCalled();
  const result=await invokeToolBoundary({name:"scan_project",shape:{mode:z.enum(["full","incremental"]),enrich:z.boolean()},args:repairArgs,handler:async()=>{
   const committed=await commitGraphWrites({actor:"fixture-source-repair",operation_id:"explicit-gap-repair",scope:["source:fixture/source.ts"],writes:[{file:"features.json",content:JSON.stringify({features:[{...feature(),source_hashes:{"source.ts":"sha256:"+createHash("sha256").update(content).digest("hex")}}]})}],source_reconciliation:{revision:"explicit-gap-repair",scope:["source:fixture/source.ts"],full:false}});
   return {content:[{type:"text",text:JSON.stringify({receipt:committed.receipt})}]};}});
  expect(result.isError,JSON.stringify(result)).not.toBe(true);
 });const repaired=await refreshManagedContext(refreshed.id);expect(repaired.source_gaps).toEqual([]);
 await deliverManagedContext(repaired.id,managedContextPrompt(repaired));await assertManagedContext(repaired.id);
 expect((await finishManagedContext(repaired.id)).status).toBe("graph_committed");
 }finally{lease.close();}
}));
it("a delivered known source obligation admits only an explicitly approved repair and retains the execution-bound graph receipt",()=>within(async()=>{
 await deliver();const editArgs={filePath:"source.ts",text:"export const changed = true;\n"},scanArgs={mode:"incremental"};
 const lease=issueExecutionPolicy(owner(),{id:"execution-one",context_id:"execution-one",autonomy:"supervised",verbosity:"concise",timeout_ms:10000,signal:new AbortController().signal,
  approvals:[{tool:"edit_file",arguments:editArgs,scope_id:"fixture",calls:1},{tool:"scan_project",arguments:scanArgs,scope_id:"fixture",calls:1}]});
 try {await withSessionContext({...owner(),execution_policy:lease.policy},async()=>{
  const edited=await invokeToolBoundary({name:"edit_file",shape:{filePath:z.string(),text:z.string()},args:editArgs,handler:async()=>{
   const obligation=await managedSourceEffect({changes:[{file,content:editArgs.text}],apply:()=>writeFile(file,editArgs.text)});return {content:[{type:"text",text:JSON.stringify({obligation})}]};}});
  expect(edited.isError).not.toBe(true);
  const refreshed=await refreshManagedContext("execution-one");await deliverManagedContext(refreshed.id,managedContextPrompt(refreshed));
  await expect(assertManagedContext(refreshed.id)).rejects.toThrow("REFRESH_REQUIRED");
  const repair=await invokeToolBoundary({name:"scan_project",shape:{mode:z.enum(["full","incremental"])},args:scanArgs,handler:async()=>{
   // Actual atomic graph owner over a disposable source fixture; no paid parser/model qualification is inferred.
   const obligations=(await readChangeObligations()).entries;
   const writes=await prepareChangeReconciliation(obligations.map(item=>item.id),"fixture-source-repair");
   const result=await commitGraphWrites({actor:"fixture-reconciliation",operation_id:"fixture-source-repair",scope:["source:fixture/source.ts"],writes:[...writes,
    {file:"features.json",content:JSON.stringify({features:[{...feature(),description:"Reconciled changed source"}]})}],source_reconciliation:{revision:"fixture-repaired",scope:["source:fixture/source.ts"],full:false}});
   return {content:[{type:"text",text:JSON.stringify({receipt:result.receipt})}]};}});
  expect(repair.isError,JSON.stringify(repair)).not.toBe(true);
  const current=await refreshManagedContext("execution-one");await deliverManagedContext(current.id,managedContextPrompt(current));await assertManagedContext(current.id);
  const closed=await finishManagedContext(current.id);expect(closed.status).toBe("graph_committed");
  expect(closed.effects.flatMap(effect=>effect.receipt_ids)).toEqual(["fixture-source-repair"]);
 });}finally{lease.close();}
}));
it("permits verification and further source work on delivered own changes without pretending debt is settled",()=>within(async()=>{
 await deliver();
 const args={command:'node -e "process.stdout.write(\'verified\')"'};
 const lease=issueExecutionPolicy(owner(),{id:"execution-one",context_id:"execution-one",autonomy:"autonomous",verbosity:"concise",timeout_ms:30000,signal:new AbortController().signal,
  approvals:[{tool:"run_command",arguments:args,scope_id:"fixture",calls:1},{tool:"edit_file",arguments:{filePath:"source.ts"},scope_id:"fixture",calls:1}]});
 try {await withSessionContext({...owner(),execution_policy:lease.policy},async()=>{
  await managedSourceEffect({changes:[{file,content:"changed",expected_content:"export const original = true;\n"}],apply:()=>writeFile(file,"changed")});
  const refreshed=await refreshManagedContext("execution-one");await deliverManagedContext(refreshed.id,managedContextPrompt(refreshed));
  await expect(assertManagedContext(refreshed.id)).rejects.toThrow("REFRESH_REQUIRED");
  await assertManagedContext(refreshed.id,{source_work:true});
  const verification=await executeScopedCommand(lease.policy,args,root);
  expect(verification.stdout).toBe("verified");
  const edit=await invokeToolBoundary({name:"edit_file",shape:{filePath:z.string()},args:{filePath:"source.ts"},handler:async()=>{
   await managedSourceEffect({changes:[{file,content:"changed twice",expected_content:"changed"}],apply:()=>writeFile(file,"changed twice")});
   return {content:[]};
  }});
  expect(edit.isError,JSON.stringify(edit)).not.toBe(true);
  const after=await refreshManagedContext(refreshed.id);await deliverManagedContext(after.id,managedContextPrompt(after));
  expect((await readChangeObligations()).entries.filter(e=>e.state==="reconciliation_pending")).toHaveLength(2);
  expect(after.pack.state.freshness).toBe("stale");
  await writeFile(file,"unknown external edit");
  await expect(assertManagedContext(after.id,{source_work:true})).rejects.toThrow("REFRESH_REQUIRED");
 });}finally{lease.close();}
}));

it("does not grant continued source work for another execution's pending effect",()=>within(async()=>{
 await managedSourceEffect({changes:[{file,content:"earlier edit",expected_content:"export const original = true;\n"}],apply:()=>writeFile(file,"earlier edit")});
 const entry=await deliver();
 await expect(assertManagedContext(entry.id,{source_work:true})).rejects.toThrow("REFRESH_REQUIRED");
}));

it("a pending closed execution can recover its verified reconciliation without redispatching the source effect",()=>within(async()=>{
 await deliver();const obligation=await managedSourceEffect({execution_id:"execution-one",changes:[{file,content:"changed"}],apply:()=>writeFile(file,"changed")});
 expect((await finishManagedContext("execution-one")).status).toBe("reconciliation_pending");
 const writes=await prepareChangeReconciliation([obligation.id],"fixture-recovery");
 await commitGraphWrites({actor:"fixture-recovery",operation_id:"fixture-recovery",scope:obligation.scope,writes});
 expect((await finishManagedContext("execution-one")).status).toBe("graph_committed");
 expect(await readFile(file,"utf8")).toBe("changed");
}));
it("a managed staged scan does not hold the global graph barrier while its worker waits",()=>within(async()=>{
 await deliver();const args={incremental:true},lease=issueExecutionPolicy(owner(),{id:"execution-one",context_id:"execution-one",autonomy:"manual",verbosity:"concise",timeout_ms:10000,
  signal:new AbortController().signal,approvals:[{tool:"scan_project",arguments:args,scope_id:"fixture",calls:1}]});
 let ready!:()=>void,release!:()=>void;
 const entered=new Promise<void>(done=>{ready=done;}),work=new Promise<void>(done=>{release=done;});
 const running=withSessionContext({...owner(),execution_policy:lease.policy},()=>invokeToolBoundary({name:"scan_project",shape:{incremental:z.boolean()},args,handler:async()=>{ready();await work;return {content:[]};}}));
 try {await entered;
  // A different session must see a stable committed view while slow work is staged.
  await expect(Promise.race([within(()=>loadPublicationState(),"reader"),new Promise((_,reject)=>setTimeout(()=>reject(new Error("READ_BLOCKED_BY_STAGED_WORK")),2000))])).resolves.toHaveProperty("revision");
 }finally{release();await running;lease.close();}
}));
it("unapproved managed cognition is rejected before a durable engine job or owner handler starts",()=>within(async()=>{
 await deliver();const lease=issueExecutionPolicy(owner(),{id:"execution-one",context_id:"execution-one",autonomy:"manual",verbosity:"concise",timeout_ms:10000,signal:new AbortController().signal});
 const handler=vi.fn(()=>({content:[]}));
 try {const before=await loadPublicationState();
  const result=await withSessionContext({...owner(),execution_policy:lease.policy},()=>invokeToolBoundary({name:"dream_cycle",shape:{},args:{},handler}));
  expect(result.structuredContent?.error).toMatchObject({code:"EXECUTION_POLICY_DENIED"});expect(handler).not.toHaveBeenCalled();
  expect((await loadPublicationState()).stores["jobs.json"]).toEqual(before.stores["jobs.json"]);
 }finally{lease.close();}
}));
it("unrelated execution debt does not prevent explicitly approved repair of the affected source",()=>within(async()=>{
 await deliver();
 await managedSourceEffect({execution_id:"execution-one",changes:[{file,content:"owned change"}],apply:()=>writeFile(file,"owned change")});
 const other=join(root,"other.ts");await writeFile(other,"unrelated before");
 await managedSourceEffect({execution_id:"other-execution",changes:[{file:other,content:"unrelated after"}],apply:()=>writeFile(other,"unrelated after")});
 const refreshed=await refreshManagedContext("execution-one");await deliverManagedContext(refreshed.id,managedContextPrompt(refreshed));
 await expect(assertManagedContext(refreshed.id)).rejects.toThrow("REFRESH_REQUIRED");
 await assertManagedContext(refreshed.id,{repair_source:true});
 expect((await readChangeObligations()).entries.filter(item=>item.state==="reconciliation_pending")).toHaveLength(2);
}));
it("separates an execution-bound operational commit from graph publication and rejects invented closure receipts",()=>within(async()=>{
 await deliver();const lease=issueExecutionPolicy(owner(),{id:"execution-one",context_id:"execution-one",autonomy:"manual",verbosity:"concise",timeout_ms:10000,signal:new AbortController().signal});
 try {await withSessionContext({...owner(),execution_policy:lease.policy},async()=>{
  await commitGraphWrites({actor:"fixture-state-owner",operation_id:"fixture-operational-commit",scope:["event_log.json"],writes:[{file:"event_log.json",content:JSON.stringify({events:[]})}]});
  await recordManagedEffect("execution-one",{tool:"fixture-operational",outcome:"owner_returned",receipt_ids:[],state_receipt_ids:["fixture-operational-commit"]});
 });const closed=await finishManagedContext("execution-one");expect(closed.status).toBe("state_committed");
 expect(closed.effects[0].receipt_ids).toEqual([]);expect(closed.effects[0].state_receipt_ids).toEqual(["fixture-operational-commit"]);
 await deliver("fabricated");await recordManagedEffect("fabricated",{tool:"fixture",outcome:"owner_returned",receipt_ids:["invented"]});
 expect((await finishManagedContext("fabricated")).status).toBe("recovery_required");
 }finally{lease.close();}
}));
it("closure stays pending while an execution-owned durable job has not settled, then reads back its actual cancellation",()=>within(async()=>{
 await deliver();const jobs=new EngineJobs(),record=await jobs.accept({operation_id:"fixture-queued",action:"fixture",owner:owner().principal,
  session_id:owner().session_id,execution_id:"execution-one",scope:["fixture"],role_policies:{},
  budget:{requests:0,input_tokens:0,output_tokens:0,reasoning_tokens:0,retries:0,elapsed_ms:10000,concurrency:1,max_hops:0,max_neighbors:0,
   run_amount:0,day_amount:0,currency:"USD",pricing_version:null,billing_principal:"fixture"}});
 expect((await finishManagedContext("execution-one")).status).toBe("work_pending");
 const cancelled=await jobs.cancel(record.job.id,"fixture-operator-cancel",{expected_fence:0,operation_id:"fixture-queued-cancel"});
 expect(cancelled.work_settled).toBe(true);expect((await finishManagedContext("execution-one")).status).toBe("no_change");
}));
it("per-request command cancellation stops the actual managed process and retains independently observed source debt",()=>within(async()=>{
 await deliver();const args={command:`node -e "require('fs').writeFileSync('running.marker','started');setTimeout(()=>require('fs').writeFileSync('late.marker','must not appear'),5000);setInterval(()=>{},1000)"`,timeoutMs:20000};
 const lease=issueExecutionPolicy(owner(),{id:"execution-one",context_id:"execution-one",autonomy:"manual",verbosity:"concise",timeout_ms:30000,
  signal:new AbortController().signal,approvals:[{tool:"run_command",arguments:args,scope_id:"fixture",calls:1}]}),request=new AbortController();
 const running=executeScopedCommand(lease.policy,args,root,request.signal);
 try {let started=false;
  for(let i=0;i<200;i++){if(await readFile(join(root,"running.marker"),"utf8").catch(()=>"")==="started"){started=true;break;}await new Promise(done=>setTimeout(done,20));}
  expect(started).toBe(true);request.abort(new Error("fixture request cancelled"));const result=await running;
  expect(result.exitCode).not.toBe(0);expect(result.source_obligation).toMatchObject({state:"reconciliation_pending",scope:["source:fixture/running.marker"]});
  await expect(readFile(join(root,"late.marker"))).rejects.toMatchObject({code:"ENOENT"});expect((await finishManagedContext("execution-one")).status).toBe("reconciliation_pending");
 }finally{request.abort();await running.catch(()=>undefined);lease.close();}
}));
it("archival retains complete settled context and idempotent readback, blocks ID reuse, and refuses unsettled or foreign records",()=>within(async()=>{
 await deliver();const closed=await finishManagedContext("execution-one"),before=await loadPublicationState();
 const archive=await archiveManagedContexts([closed.id]);
 expect(await readManagedContext(closed.id)).toEqual(closed);expect(await archiveManagedContexts([closed.id])).toEqual(archive);
 expect((await loadPublicationState()).revision.graph_revision).toBe(before.revision.graph_revision);
 await expect(begin()).rejects.toThrow("EXECUTION_ID_ALREADY_USED");
 await expect(within(()=>readManagedContext(closed.id),"other")).rejects.toThrow("OWNER_MISMATCH");
 await deliver("unfinished");await expect(archiveManagedContexts(["unfinished"])).rejects.toThrow("UNSETTLED");
 const current=JSON.parse(await readFile(join(root,"data","execution_contexts.json"),"utf8"));expect(current.entries.map((entry:any)=>entry.id)).toEqual(["unfinished"]);
 await writeFile(join(root,"data",archive.archive),"tampered");await expect(readManagedContext(closed.id)).rejects.toThrow("ARCHIVE_UNAVAILABLE");
}));

it("commands stream source observation beyond the old per-file and repository byte limits",()=>within(async()=>{
 // Sparse on disk but all bytes are actually hashed before/after the command.
 const {open}=await import("node:fs/promises");
 const large=await open(join(root,"large-fixture.txt"),"w");try{await large.truncate(129*1024*1024);}finally{await large.close();}
 await deliver();const args={command:'node -e "process.stdout.write(\'large repo works\')"'};
 const lease=issueExecutionPolicy(owner(),{id:"execution-one",context_id:"execution-one",autonomy:"manual",verbosity:"concise",timeout_ms:30000,signal:new AbortController().signal,approvals:[{tool:"run_command",arguments:args,scope_id:"fixture",calls:1}]});
 try{const result=await executeScopedCommand(lease.policy,args,root);expect(result.exitCode).toBe(0);expect(result.stdout).toBe("large repo works");expect(result.source_obligation?.state).toBe("failed");}
 finally{lease.close();}
}),30000);

it("command observation follows scanner gitignore patterns and negations without losing included source changes",()=>within(async()=>{
 const {mkdir}=await import("node:fs/promises");await mkdir(join(root,"ignored"));
 await writeFile(join(root,".gitignore"),"ignored/\n*.tmp\n!keep.tmp\n");
 await writeFile(join(root,"ignored","generated.ts"),"before");
 await writeFile(join(root,"discard.tmp"),"before");await writeFile(join(root,"keep.tmp"),"before");
 const script=join(root,"command.mjs");await writeFile(script,"import {writeFile} from 'node:fs/promises';await writeFile('ignored/generated.ts','after');await writeFile('discard.tmp','after');await writeFile('keep.tmp','after');await writeFile('source.ts','export const changed = true;');");
 await deliver();const args={command:`node "${script}"`},lease=issueExecutionPolicy(owner(),{id:"execution-one",context_id:"execution-one",autonomy:"manual",verbosity:"concise",timeout_ms:10000,signal:new AbortController().signal,approvals:[{tool:"run_command",arguments:args,scope_id:"fixture",calls:1}]});
 try{const result=await executeScopedCommand(lease.policy,args,root);expect(result.exitCode).toBe(0);
  expect(result.source_obligation?.scope).toEqual(["source:fixture/keep.tmp","source:fixture/source.ts"]);
  expect(JSON.stringify(result.source_obligation)).not.toContain("generated.ts");expect(JSON.stringify(result.source_obligation)).not.toContain("discard.tmp");
 }finally{lease.close();}
}));
