/** Test-only timing of the original browser owner. No clocks or replies are replaced. */
import childProcess from 'node:child_process';
import {performance} from 'node:perf_hooks';
let started;
const report=(event,extra={})=>{if(started!==undefined&&process.connected)process.send?.({test_trace:'original_browser_stop',event,ms:performance.now()-started,...extra});};
process.on('message',message=>{if(message?.operation==='stop'&&started===undefined){started=performance.now();report('stop_received');}});
const spawn=childProcess.spawn,spawnSync=childProcess.spawnSync;
childProcess.spawn=function(command,args,...options){
 const force=String(command).endsWith('taskkill.exe');if(force)report('owner_async_force_start');
 const child=spawn.call(this,command,args,...options);
 if(force)child.once('close',status=>report('owner_async_force_return',{status}));
 if(Array.isArray(args)&&args.includes('--remote-debugging-pipe')){
  child.once('exit',()=>report('browser_exit'));
  child.once('close',()=>report('browser_close'));
 }
 return child;
};
childProcess.spawnSync=function(command,...args){
 if(String(command).startsWith('taskkill ')){report('owner_force_start');const result=spawnSync.call(this,command,...args);report('owner_force_return',{status:result.status});return result;}
 return spawnSync.call(this,command,...args);
};
