
import {it,expect} from "vitest";
import {JSDOM} from "jsdom";
import {PASS_REPORT_SCRIPT,PASS_REPORT_CSS} from "../src/architect/pass-report-ui.js";
it("renders expandable framed report sections, safe links, code and complete formatted raw evidence",()=>{
 const dom=new JSDOM('<section id="report"></section>',{runScripts:"outside-only"});
 dom.window.eval('function parseContinuationToolLine(){return null;}'+PASS_REPORT_SCRIPT);
 const panel=dom.window.document.getElementById("report")!;
 const append=(title:string,value:unknown)=>(dom.window as any).appendContinuationReportSection(panel,title,value);
 append("Executive Summary","Completed. See [evidence](https://example.test/proof) and `src/source.ts`.");
 append("Work Completed",["Changed selection"]);
 append("Tool Trace",Array.from({length:100},(_,i)=>"read "+i));
 append("Blockers And Uncertainty",["Compiler failed","uncertainty: 1"]);
 append("Raw report data",JSON.stringify({evidence:"line one\nline two",payload:"<img src=x onerror=alert(1)>"}));
 const sections=[...panel.querySelectorAll("details")];
 expect(sections.map(section=>section.open)).toEqual([true,false,false,true,false]);
 expect(sections[2].querySelectorAll("li")).toHaveLength(0);
 sections[2].open=true;sections[2].dispatchEvent(new dom.window.Event("toggle"));
 expect(sections[2].querySelectorAll("li")).toHaveLength(100);
 sections[4].open=true;sections[4].dispatchEvent(new dom.window.Event("toggle"));
 expect(panel.querySelector("a")?.href).toBe("https://example.test/proof");
 expect(panel.querySelector("a")?.rel).toBe("noopener noreferrer");
 expect(panel.querySelector("code")?.textContent).toBe("src/source.ts");
 expect(panel.querySelector("img")).toBeNull();
 expect(panel.querySelector("pre")?.textContent).toContain('\n  "evidence"');
 expect(PASS_REPORT_CSS).toContain(".report-blockers");
 append("Evidence",["[bad](javascript:alert(1))",'<script>bad()</script>']);
 const evidence=panel.lastElementChild as HTMLDetailsElement;evidence.open=true;evidence.dispatchEvent(new dom.window.Event("toggle"));
 expect(panel.querySelectorAll("a")).toHaveLength(1);
 expect(panel.querySelector("script")).toBeNull();
 append("Files / Graph Entities Touched",[]);
 append("Graph / Plan Updates Recorded",null);
 append("Blockers And Uncertainty",["uncertainty: 0"]);
 expect(panel.querySelectorAll("details")).toHaveLength(6);
 append("Recommended Next Step","Review the changes");
 expect((panel.lastElementChild as HTMLDetailsElement).open).toBe(false);
 append("Provenance",["runtime: claude-cli"]);
 expect((panel.lastElementChild as HTMLDetailsElement).open).toBe(false);
 append("Blockers And Uncertainty",["uncertainty: 0.5"]);
 expect((panel.lastElementChild as HTMLDetailsElement).open).toBe(true);
 expect(panel.lastElementChild?.querySelector(".report-count")?.textContent).toBe("1");
 append("Blockers And Uncertainty",["uncertainty: unknown"]);
 expect((panel.lastElementChild as HTMLDetailsElement).open).toBe(false);
 dom.window.close();
});

it("reads daemon reconciliation status and refreshes without dispatching any effect",async()=>{
 const dom=new JSDOM('<section id="report"></section>',{runScripts:"outside-only"});
 let status="pending";
 const requests:Array<{url:string;body:unknown}>=[];
 (dom.window as any).fetch=async(url:string,options:any)=>{
  requests.push({url,body:JSON.parse(options.body)});
  if(status==="offline")throw new Error("offline");
  return {ok:true,json:async()=>({execution_id:"host-run",checked_at:"2026-10-08T12:00:00Z",status,
    counts:{pending:status==="pending"?1:0,reconciled:status==="reconciled"?1:0,recovery_required:0},
    changes:[{id:"change-1",state:status,receipt_id:status==="reconciled"?"receipt-1":null}],total:1})};
 };
 dom.window.eval(PASS_REPORT_SCRIPT);
 const panel=dom.window.document.getElementById("report")!;
 (dom.window as any).appendReconciliationStatus(panel,"host-run");
 await new Promise(resolve=>setTimeout(resolve,0));
 expect(panel.querySelector(".report-count")?.textContent).toBe("Pending");
 expect(panel.textContent).toContain("daemon");
 status="reconciled";(panel.querySelector("button") as HTMLButtonElement).click();
 await new Promise(resolve=>setTimeout(resolve,0));
 expect(panel.querySelector(".report-count")?.textContent).toBe("Confirmed");
 expect(panel.textContent).toContain("receipt-1");
 status="offline";(panel.querySelector("button") as HTMLButtonElement).click();
 await new Promise(resolve=>setTimeout(resolve,0));
 expect(panel.querySelector(".report-count")?.textContent).toBe("Unavailable");
 expect(requests).toEqual(Array(3).fill({url:"/api/executions/v1/reconciliation/read",body:{execution_id:"host-run"}}));
 dom.window.close();
});
