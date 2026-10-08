
import {afterEach,it,expect,vi} from "vitest";
import {JSDOM} from "jsdom";
import {EXECUTION_REVIEW_MARKUP,EXECUTION_REVIEW_SCRIPT} from "../src/architect/execution-review-ui.js";
let dom:JSDOM;
afterEach(()=>dom?.window.close());
const request={execution_id:"original",approval_id:"review-one",expected_record_revision:2,context_receipt_id:"context-one",approved_actions:[{tool:"edit_file",arguments:{filePath:"source.ts"},scope_id:"task",calls:1}]};
function fixture(handler:(route:string,body:any)=>Promise<any>){
 dom=new JSDOM(EXECUTION_REVIEW_MARKUP+'<p id="status"></p>',{runScripts:"outside-only"});
 dom.window.eval("const chatStatusEl=document.getElementById('status');"+EXECUTION_REVIEW_SCRIPT);
 (dom.window as any).executionReviewRequest=handler;
 (dom.window as any).showExecutionReview(request);
 return dom.window.document;
}
it("recovers a lost approval reply with a read-only acknowledgement, without requesting another effect",async()=>{
 const calls:string[]=[];
 const doc=fixture(async(route,body)=>{
  calls.push(route);expect(body).toEqual(request);
  if(route==="approve-compact")throw new Error("lost reply");
  expect(route).toBe("reviews/ack");
  return {execution:{execution_id:"original"},approval_id:"review-one",review_activated:true};
 });
 (doc.getElementById("execution-review-approve") as HTMLButtonElement).click();
 await vi.waitFor(()=>expect((doc.getElementById("execution-review-panel") as HTMLElement).hidden).toBe(true));
 expect(calls).toEqual(["approve-compact","reviews/ack"]);
});
it("auto accept is an explicit original-task policy request",async()=>{
 const calls:any[]=[];
 const doc=fixture(async(route,body)=>{calls.push({route,body});return body;});
 (doc.getElementById("execution-review-auto") as HTMLButtonElement).click();
 await vi.waitFor(()=>expect((doc.getElementById("execution-review-panel") as HTMLElement).hidden).toBe(true));
 expect(calls).toEqual([{route:"reviews/policy",body:{execution_id:"original",approval_mode:"auto_accept"}}]);
});
it("unconfirmed approval retains the captured request and does not enable a fresh policy click",async()=>{
 const doc=fixture(async(route)=>{if(route==="approve-compact")throw new Error("timeout");return {execution:{execution_id:"original"},approval_id:"review-one",review_activated:false};});
 (doc.getElementById("execution-review-approve") as HTMLButtonElement).click();
 await vi.waitFor(()=>expect((doc.getElementById("execution-review-approve") as HTMLButtonElement).disabled).toBe(false));
 expect((doc.getElementById("execution-review-panel") as HTMLElement).hidden).toBe(false);
 expect((doc.getElementById("execution-review-auto") as HTMLButtonElement).disabled).toBe(true);
 expect(doc.getElementById("execution-review-status")?.textContent).toContain("unconfirmed");
});
