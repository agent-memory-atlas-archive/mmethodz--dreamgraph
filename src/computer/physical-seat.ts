/** Call from the physical input helper itself. Its kernel lease outlives a disconnected daemon until local stop. */
import {createServer,type Server} from "node:net";
import {createHash} from "node:crypto";
import {z} from "zod";
const id=z.string().min(1).max(256);
export const PhysicalSeatSchema=z.object({host:id,interactive_session:id,seat:id}).strict();
export type PhysicalSeat=z.infer<typeof PhysicalSeatSchema>;
const held=new Set<string>();
export function physicalSeatEndpoint(input:PhysicalSeat):{path:string;exclusive:true}|{host:string;port:number;exclusive:true}{
  const seat=PhysicalSeatSchema.parse(input),digest=createHash("sha256").update(JSON.stringify([seat.host,seat.interactive_session,seat.seat])).digest("hex");
  if(process.platform==="win32")return {path:`\\\\.\\pipe\\dreamgraph-input-seat-${digest}`,exclusive:true};
  const [major,minor]=process.versions.node.split(".").map(Number);
  if(process.platform==="linux"&&(major>20||major===20&&minor>=8))return {path:`\0dreamgraph-input-seat-${digest}`,exclusive:true};
  // Port collisions fail closed. No stale filesystem socket may be unlinked to steal a live seat.
  return {host:"127.0.0.1",port:42000+parseInt(digest.slice(0,8),16)%20000,exclusive:true};
}
export async function acquirePhysicalSeat(input:PhysicalSeat,signal:AbortSignal){
  signal.throwIfAborted();const seat=PhysicalSeatSchema.parse(input),key=JSON.stringify(seat);
  if(held.has(key))throw new Error("COMPUTER_PHYSICAL_SEAT_BUSY");held.add(key);
  let server:Server|undefined;
  try{
    server=await new Promise<Server>((resolve,reject)=>{const value=createServer(socket=>socket.destroy());
      value.once("error",()=>{value.close();reject(new Error("COMPUTER_PHYSICAL_SEAT_BUSY_OR_UNAVAILABLE"));});
      value.listen(physicalSeatEndpoint(seat),()=>{value.unref();resolve(value);});});
    signal.throwIfAborted();let released=false;
    return {seat,release:async()=>{if(released)return;released=true;await new Promise<void>((resolve,reject)=>server!.close(error=>error?reject(error):resolve()));held.delete(key);}};
  }catch(error){if(server?.listening)await new Promise<void>(resolve=>server!.close(()=>resolve()));held.delete(key);throw error;}
}
