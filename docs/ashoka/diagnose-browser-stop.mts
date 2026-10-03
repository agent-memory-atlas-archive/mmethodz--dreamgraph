/** Local diagnostics only: actual worker messages, no changed deadline or reply. */
import {performance} from 'node:perf_hooks';
import {BrowserHarnessWorker} from '../../src/computer/browser-harness.js';
import {qualifyBrowserRuntime,browserQualificationFailureDetails} from '../../src/computer/qualify-browser.js';
const baseline=performance.now(),ids=new WeakMap<object,number>();let count=0;
const emit=(value:unknown)=>console.log(JSON.stringify({ms:performance.now()-baseline,...value as object}));
const create=BrowserHarnessWorker.create;
BrowserHarnessWorker.create=async(...args:Parameters<typeof create>)=>{
 const worker=await create.apply(BrowserHarnessWorker,args),id=++count;ids.set(worker,id);
 const child=(worker as unknown as {child:import('node:child_process').ChildProcess}).child;
 child.on('message',(raw:any)=>{if(raw?.body?.terminated!==undefined)emit({worker:id,event:'original_stop_reply',terminated:raw.body.terminated,input_released:raw.body.input_released});});
 child.on('exit',(code,signal)=>emit({worker:id,event:'original_child_exit',code,signal}));
 return worker;
};
const stop=BrowserHarnessWorker.prototype.stop;
BrowserHarnessWorker.prototype.stop=function(){const start=performance.now(),id=ids.get(this);emit({worker:id,event:'stop_called'});
 return stop.call(this).then(value=>{emit({worker:id,event:'stop_resolved',elapsed_ms:performance.now()-start});return value;},error=>{emit({worker:id,event:'stop_rejected',elapsed_ms:performance.now()-start,reason:error.message,phase:error.cause?.phase});throw error;});
};
try{const result=await qualifyBrowserRuntime({browser_executable:'C:/Program Files/Google/Chrome/Application/chrome.exe',browser_version:'153.0.8010.50',worker_id:'stop-diagnostic'},AbortSignal.timeout(60000));emit({status:'passed',checks:result.evidence.traces.length});}
catch(error){emit({status:'failed',details:browserQualificationFailureDetails(error)});process.exitCode=1;}
