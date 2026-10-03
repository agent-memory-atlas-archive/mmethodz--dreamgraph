/** Actual local kernel arbitration in different worker processes, not qualification of physical input. */
import {afterEach,expect,it} from "vitest";
import {fork,type ChildProcess} from "node:child_process";
import {randomUUID} from "node:crypto";
import {once} from "node:events";
import {acquirePhysicalSeat,physicalSeatEndpoint} from "../src/computer/physical-seat.js";
const children:ChildProcess[]=[];
afterEach(async()=>{for(const child of children.splice(0))if(child.exitCode===null&&child.signalCode===null){const exited=once(child,"exit");child.kill();await exited;}});
const spawn=(seat:{host:string;interactive_session:string;seat:string})=>{const child=fork("tests/helpers/computer-seat-worker.mjs",[JSON.stringify(seat)],{execArgv:["--import","tsx"],stdio:["ignore","ignore","ignore","ipc"],windowsHide:true});children.push(child);return child;};
const state=async(child:ChildProcess)=>{let timer:NodeJS.Timeout;try{return await Promise.race([once(child,"message").then(([value])=>value.state),new Promise<never>((_,reject)=>timer=setTimeout(()=>reject(new Error("Bounded seat fixture timeout")),5000))]);}finally{clearTimeout(timer!);}};
it("a second session/daemon cannot steal a seat; release permits the next original owner",async()=>{
 const seat={host:"fixture:"+randomUUID(),interactive_session:"same-user-session",seat:"keyboard"},first=await acquirePhysicalSeat(seat,new AbortController().signal);
 try{await expect(acquirePhysicalSeat(seat,new AbortController().signal)).rejects.toThrow("BUSY");expect(await state(spawn(seat))).toBe("busy");}
 finally{await first.release();}
 const next=spawn(seat);expect(await state(next)).toBe("held");next.send("release");expect(await state(next)).toBe("released");
});
it("the helper owns the kernel lifetime; crash releases its own seat without stale path stealing",async()=>{
 const seat={host:"fixture:"+randomUUID(),interactive_session:"same-user-session",seat:"keyboard"},worker=spawn(seat);expect(await state(worker)).toBe("held");
 await expect(acquirePhysicalSeat(seat,new AbortController().signal)).rejects.toThrow("BUSY_OR_UNAVAILABLE");
 const exited=once(worker,"exit");worker.kill();await exited;
 const lease=await acquirePhysicalSeat(seat,new AbortController().signal);await lease.release();await lease.release();
});
it("different isolated seats do not alias; aborted acquisition is rejected",async()=>{
 const host="fixture:"+randomUUID(),one={host,interactive_session:"one",seat:"keyboard"},two={...one,interactive_session:"two"};
 expect(physicalSeatEndpoint(one)).not.toEqual(physicalSeatEndpoint(two));
 const a=await acquirePhysicalSeat(one,new AbortController().signal),b=await acquirePhysicalSeat(two,new AbortController().signal);await a.release();await b.release();
 const controller=new AbortController();controller.abort(new Error("fixture cancellation"));await expect(acquirePhysicalSeat(one,controller.signal)).rejects.toThrow("cancellation");
});
