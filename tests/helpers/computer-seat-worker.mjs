import {acquirePhysicalSeat} from '../../src/computer/physical-seat.ts';
const seat=JSON.parse(process.argv[2]);
try{const lease=await acquirePhysicalSeat(seat,new AbortController().signal);process.send({state:'held'});process.on('message',async()=>{await lease.release();process.send({state:'released'});process.exit(0);});setInterval(()=>{},1000);}
catch{process.send({state:'busy'});process.exit(0);}
