/** Read-only runtime diagnosis against the explicitly authorized WSL test bed; zero models. */
import {chromium} from '/home/mmethodz/.dreamgraph/bin/node_modules/playwright-core/index.mjs';
import {qualifyBrowserRuntime} from '/home/mmethodz/.dreamgraph/bin/dist/computer/qualify-browser.js';
import {BrowserHarnessWorker} from '/home/mmethodz/.dreamgraph/bin/dist/computer/browser-harness.js';
const executable='/tmp/dg-ashoka-wsl-3e20aba0-2617-4c9e-8b89-93779607a2a6/browsers/chromium-1234/chrome-linux64/chrome';
let browser;
for(const name of ['open','stop','qualifyControlLoss']){
  const original=BrowserHarnessWorker.prototype[name];
  BrowserHarnessWorker.prototype[name]=async function(...args){
    const start=performance.now();
    console.log(JSON.stringify({phase:name,state:'start',mode:name==='qualifyControlLoss'?args[0]:undefined,child:this.child?.pid}));
    try{const result=await original.apply(this,args);console.log(JSON.stringify({phase:name,state:'complete',elapsed_ms:performance.now()-start,child:this.child?.pid,result:name==='open'?undefined:result}));return result;}
    catch(error){console.log(JSON.stringify({phase:name,state:'failed',reason:error.message,cause:error.cause,elapsed_ms:performance.now()-start,child:this.child?.pid,exit:this.child?.exitCode,signal:this.child?.signalCode}));throw error;}
  };
}
try{
  browser=await chromium.launch({executablePath:executable,headless:true,chromiumSandbox:true,timeout:15000});
  console.log(JSON.stringify({phase:'direct_sandboxed_launch',version:browser.version(),model_requests:0}));
  await browser.close();browser=undefined;
  const result=await qualifyBrowserRuntime({browser_executable:executable,browser_version:'151.0.7922.34',worker_id:'ashoka-wsl-diagnostic'},AbortSignal.timeout(120000));
  console.log(JSON.stringify({phase:'installed_qualification',checks:result.evidence.traces.length,stop:result.worker.qualification.stop_release_ms,control_loss:result.worker.qualification.control_loss_stop_ms,model_requests:0}));
}catch(error){console.error(JSON.stringify({phase:'failed',reason:error.message,cause:error.cause,model_requests:0}));process.exitCode=1;}
finally{if(browser)await browser.close();}
